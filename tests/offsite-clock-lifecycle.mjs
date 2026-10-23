import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare-worker/src/index.js';

const db = new DatabaseSync(':memory:');
db.exec(await readFile(new URL('../cloudflare-worker/schema.sql', import.meta.url), 'utf8'));
let clockInRaceBarrier = null;
for (const name of ['0011_portal_access_assignments.sql', '0012_pay_month_start_settings.sql', '0013_offsite_clock.sql']) {
  db.exec(await readFile(new URL(`../cloudflare-worker/migrations/${name}`, import.meta.url), 'utf8'));
}
const migrationDb = new DatabaseSync(':memory:');
migrationDb.exec(await readFile(new URL('../cloudflare-worker/migrations/0013_offsite_clock.sql', import.meta.url), 'utf8'));
assert.ok(migrationDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'offsite_clock_entries'").get());
assert.ok(migrationDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'offsite_clock_audit_no_delete'").get());
migrationDb.close();

const d1 = {
  prepare(sql) {
    const make = (args = []) => ({
      sql,
      args,
      bind(...values) { return make(values); },
      first() {
        const result = db.prepare(sql).get(...args) || null;
        if (clockInRaceBarrier && sql.includes('FROM offsite_clock_audit WHERE event_id = ?') && args[0] === clockInRaceBarrier.eventId) {
          return clockInRaceBarrier.wait(result);
        }
        return result;
      },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() { return { success: true, meta: db.prepare(sql).run(...args) }; }
    });
    return make();
  },
  async batch(statements) {
    db.exec('BEGIN');
    try {
      const results = statements.map((statement) => db.prepare(statement.sql).run(...statement.args));
      db.exec('COMMIT');
      return results.map((meta) => ({ success: true, meta }));
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
};

const tenant = 'synthetic-offsite-tenant';
const audience = 'synthetic-offsite-portal';
const signing = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
}, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey);
jwk.kid = 'synthetic-offsite-key';
jwk.use = 'sig';
const base64url = (value) => Buffer.from(value).toString('base64url');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('/discovery/v2.0/keys')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(url, init);
};

async function tokenFor(upn, oid, name) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }));
  const claims = base64url(JSON.stringify({
    tid: tenant, aud: audience, iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 300, oid, preferred_username: upn, name
  }));
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

const tokens = {
  engineer: await tokenFor('engineer@example.test', 'synthetic-engineer-oid', 'TEST Engineer'),
  other: await tokenFor('other@example.test', 'synthetic-other-oid', 'TEST Other'),
  manager: await tokenFor('manager@example.test', 'synthetic-manager-oid', 'TEST Duty Manager'),
  selfManager: await tokenFor('self@example.test', 'synthetic-self-oid', 'TEST Self Manager')
};
const env = {
  DB: d1,
  ENTRA_TENANT_ID: tenant,
  ENTRA_AUDIENCES: audience,
  OFFSITE_DUTY_MANAGER_UPNS: 'manager@example.test,self@example.test'
};

async function call(actor, path, method = 'GET', body) {
  const request = new Request(`https://gmt.example${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tokens[actor]}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const response = await worker.fetch(request, env);
  return { status: response.status, body: await response.json() };
}

try {
  const managerAccess = await call('manager', '/api/access');
  assert.equal(managerAccess.status, 200);
  assert.equal(managerAccess.body.canReviewOffsite, true);
  assert.equal(managerAccess.body.isAdmin, false);

  const engineerAccess = await call('engineer', '/api/access');
  assert.equal(engineerAccess.body.canReviewOffsite, false);
  const pendingDenied = await call('engineer', '/api/offsite-clock/pending');
  assert.equal(pendingDenied.status, 403, 'only assigned duty managers may read the approval queue');

  const clockInRequest = { requestId: 'TEST-clock-in-request-0001', site: 'TEST off-site location' };
  const clockIn = await call('engineer', '/api/offsite-clock/clock-in', 'POST', clockInRequest);
  assert.equal(clockIn.status, 201, 'an authenticated engineer can start an off-site entry');
  const entryId = clockIn.body.entry.entryId;
  assert.equal(clockIn.body.entry.status, 'clocked_in');
  assert.equal(clockIn.body.entry.ownerUpn, 'engineer@example.test');
  assert.match(clockIn.body.entry.clockInAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);

  const duplicateClockIn = await call('engineer', '/api/offsite-clock/clock-in', 'POST', clockInRequest);
  assert.equal(duplicateClockIn.status, 200, 'retrying the same clock-in request is idempotent');
  assert.equal(duplicateClockIn.body.entry.entryId, entryId);
  assert.equal(duplicateClockIn.body.idempotent, true);
  const concurrentClockIn = await call('engineer', '/api/offsite-clock/clock-in', 'POST', { requestId: 'TEST-clock-in-request-0002', site: 'TEST second location' });
  assert.equal(concurrentClockIn.status, 409, 'a second active off-site shift is rejected');

  const mine = await call('engineer', '/api/offsite-clock/mine');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.entries.map((entry) => entry.entryId), [entryId]);
  const otherMine = await call('other', '/api/offsite-clock/mine');
  assert.equal(otherMine.body.entries.length, 0, 'engineers cannot read another employee’s entries');

  const clockOutRequest = { requestId: 'TEST-clock-out-request-0001', entryId };
  const clockOutRetries = await Promise.all([
    call('engineer', '/api/offsite-clock/clock-out', 'POST', clockOutRequest),
    call('engineer', '/api/offsite-clock/clock-out', 'POST', clockOutRequest)
  ]);
  const clockOut = clockOutRetries.find((result) => !result.body.idempotent) || clockOutRetries[0];
  assert.ok(clockOutRetries.every((result) => result.status === 200), 'concurrent identical clock-out retries both succeed');
  assert.equal(clockOut.status, 200);
  assert.equal(clockOut.body.entry.status, 'awaiting_approval');
  assert.match(clockOut.body.entry.clockOutAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  const duplicateClockOut = await call('engineer', '/api/offsite-clock/clock-out', 'POST', clockOutRequest);
  assert.equal(duplicateClockOut.status, 200, 'retrying the same clock-out request is idempotent');
  assert.equal(duplicateClockOut.body.idempotent, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM offsite_clock_audit WHERE entry_id = ?').get(entryId).count, 2);
  const clockOutAgain = await call('engineer', '/api/offsite-clock/clock-out', 'POST', { requestId: 'TEST-clock-out-request-0002', entryId });
  assert.equal(clockOutAgain.status, 409, 'a new clock-out request cannot repeat a completed transition');

  const pending = await call('manager', '/api/offsite-clock/pending');
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.body.entries.map((entry) => entry.entryId), [entryId]);
  assert.equal(pending.body.entries[0].canDecide, true);
  const nonManagerDecision = await call('engineer', `/api/offsite-clock/${encodeURIComponent(entryId)}/decision`, 'POST', {
    requestId: 'TEST-decision-request-0001', decision: 'approve'
  });
  assert.equal(nonManagerDecision.status, 403, 'engineers cannot approve or reject entries');
  const approvalRequest = { requestId: 'TEST-manager-approval-request-0001', decision: 'approve', note: 'TEST checked' };
  const approvalRetries = await Promise.all([
    call('manager', `/api/offsite-clock/${encodeURIComponent(entryId)}/decision`, 'POST', approvalRequest),
    call('manager', `/api/offsite-clock/${encodeURIComponent(entryId)}/decision`, 'POST', approvalRequest)
  ]);
  const approval = approvalRetries.find((result) => !result.body.idempotent) || approvalRetries[0];
  const approvalRetry = approvalRetries.find((result) => result.body.idempotent) || approvalRetries[1];
  assert.ok(approvalRetries.every((result) => result.status === 200), 'concurrent identical approval retries both succeed');
  assert.equal(approval.status, 200);
  assert.equal(approval.body.entry.status, 'approved');
  assert.equal(approval.body.entry.decidedByUpn, 'manager@example.test');
  assert.equal(approvalRetry.status, 200);
  assert.equal(approvalRetry.body.idempotent, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM offsite_clock_audit WHERE entry_id = ?').get(entryId).count, 3);
  assert.throws(() => db.prepare('UPDATE offsite_clock_audit SET next_status = ? WHERE entry_id = ?').run('TEST altered', entryId), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM offsite_clock_audit WHERE entry_id = ?').run(entryId), /cannot be deleted/);
  const secondDecision = await call('manager', `/api/offsite-clock/${encodeURIComponent(entryId)}/decision`, 'POST', {
    requestId: 'TEST-manager-approval-request-0002', decision: 'reject', note: 'TEST duplicate decision'
  });
  assert.equal(secondDecision.status, 409, 'a completed decision cannot be replaced by another decision');

  const history = await call('manager', '/api/history?kind=clock');
  assert.doesNotMatch(JSON.stringify(history.body), new RegExp(entryId), 'off-site records stay out of existing payroll clock history');

  let releaseClockInRaceReads;
  const clockInRaceReads = new Promise((resolve) => { releaseClockInRaceReads = resolve; });
  clockInRaceBarrier = {
    eventId: 'TEST-self-clock-in-race-0001',
    reads: 0,
    async wait(result) {
      this.reads += 1;
      if (this.reads === 2) releaseClockInRaceReads();
      await clockInRaceReads;
      return result;
    }
  };
  const mismatchedClockInRetries = await Promise.all([
    call('selfManager', '/api/offsite-clock/clock-in', 'POST', { requestId: 'TEST-self-clock-in-race-0001', site: 'TEST location A' }),
    call('selfManager', '/api/offsite-clock/clock-in', 'POST', { requestId: 'TEST-self-clock-in-race-0001', site: 'TEST location B' })
  ]);
  clockInRaceBarrier = null;
  const selfClockIn = mismatchedClockInRetries.find((result) => result.status === 201);
  assert.ok(selfClockIn, 'one concurrent clock-in request creates the entry');
  assert.equal(mismatchedClockInRetries.filter((result) => result.status === 409).length, 1,
    'a concurrent retry with the same request ID but a different site is rejected');
  const selfClockOut = await call('selfManager', '/api/offsite-clock/clock-out', 'POST', {
    requestId: 'TEST-self-clock-out-request-0001', entryId: selfClockIn.body.entry.entryId
  });
  assert.equal(selfClockOut.status, 200);
  const selfPending = await call('selfManager', '/api/offsite-clock/pending');
  assert.equal(selfPending.body.entries.find((entry) => entry.entryId === selfClockIn.body.entry.entryId).canDecide, false);
  const selfApprove = await call('selfManager', `/api/offsite-clock/${encodeURIComponent(selfClockIn.body.entry.entryId)}/decision`, 'POST', {
    requestId: 'TEST-self-approval-request-0001', decision: 'approve'
  });
  assert.equal(selfApprove.status, 403);

  const rejectedOwner = await call('other', '/api/offsite-clock/clock-in', 'POST', { requestId: 'TEST-other-clock-in-request-0001', site: 'TEST location' });
  assert.equal(rejectedOwner.status, 201);
  const rejectedClockOut = await call('other', '/api/offsite-clock/clock-out', 'POST', {
    requestId: 'TEST-other-clock-out-request-0001', entryId: rejectedOwner.body.entry.entryId
  });
  assert.equal(rejectedClockOut.status, 200);
  const rejected = await call('manager', `/api/offsite-clock/${encodeURIComponent(rejectedOwner.body.entry.entryId)}/decision`, 'POST', {
    requestId: 'TEST-manager-rejection-request-0001', decision: 'reject', note: 'TEST missing job reference'
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.entry.status, 'rejected');
  assert.equal(rejected.body.entry.decisionNote, 'TEST missing job reference');

  console.log('Off-site clock API enforces owner scope, manager decisions, self-approval denial, transitions, idempotency and payroll isolation.');
} finally {
  globalThis.fetch = originalFetch;
  db.close();
}
