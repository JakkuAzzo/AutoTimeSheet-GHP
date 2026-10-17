import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import portalWorker, { canAccessRecord, normaliseInput, validatePortalRequestDeletion, validatePortalRequestMutation } from '../cloudflare-worker/src/index.js';

const employee = {
  oid: 'employee-oid',
  upn: 'employee@gmt-services.co.uk',
  name: 'GMT Employee',
  isAdmin: false,
  isOperationsAdmin: false
};
assert.equal(canAccessRecord(employee, { kind: 'tasks', owner_oid: employee.oid, owner_upn: employee.upn, action: 'create_request' }), true);
assert.equal(canAccessRecord(employee, { kind: 'tasks', owner_oid: 'another-employee', owner_upn: 'another@gmt-services.co.uk', action: 'create_request' }), false, 'a staff member cannot mutate another requester’s task');

assert.doesNotThrow(() => validatePortalRequestMutation({
  kind: 'calendar', action: 'create_request', status: 'Pending approval'
}));
assert.doesNotThrow(() => validatePortalRequestMutation({
  kind: 'tasks', action: 'update_request', payload: { title: 'Repair pump' }
}, { kind: 'tasks', status: 'Pending approval' }));
assert.doesNotThrow(() => validatePortalRequestMutation({
  kind: 'calendar', action: 'update_request', status: 'Cancelled'
}, { kind: 'calendar', status: 'Pending approval', owner_oid: employee.oid }, employee));
assert.doesNotThrow(() => validatePortalRequestMutation({
  kind: 'calendar', action: 'update_request', status: 'Cancelled'
}, { kind: 'calendar', status: 'Saved', owner_oid: employee.oid }, employee), 'legacy submission states remain cancellable by their requester');
assert.throws(() => validatePortalRequestMutation({
  kind: 'tasks', action: 'update_request', status: 'Cancelled'
}, { kind: 'tasks', status: 'Pending approval', owner_oid: employee.oid }, employee), (error) => error.status === 403, 'portal users cannot cancel task requests or set operational task statuses');
const operationsAdmin = { ...employee, oid: 'operations-admin-oid', upn: 'ops@gmt-services.co.uk', isOperationsAdmin: true };
assert.throws(() => validatePortalRequestMutation({
  kind: 'calendar', action: 'update_request', status: 'Cancelled'
}, { kind: 'calendar', status: 'Pending approval', owner_oid: employee.oid }, operationsAdmin), (error) => error.status === 403, 'operations admins cannot cancel another requester’s calendar request through the portal');

for (const status of ['Approved', 'Rejected', 'Submitted', 'Saved', 'To-Do', 'In-Progress', 'Completed', 'Cancelled']) {
  if (status === 'Cancelled') continue;
  assert.throws(() => validatePortalRequestMutation({
    kind: 'calendar', action: 'create_request', status
  }), (error) => error.status === 403, `new requests cannot set ${status}`);
  assert.throws(() => validatePortalRequestMutation({
    kind: 'tasks', action: 'update_request', payload: { status }
  }, { kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 403, `pending requests cannot be changed to ${status}`);
}

for (const status of ['Approved', 'Rejected', 'Cancelled', 'Completed']) {
  assert.throws(() => validatePortalRequestMutation({
    kind: 'calendar', action: 'update_request', payload: { title: 'Changed' }
  }, { kind: 'calendar', status }), (error) => error.status === 409, `decided ${status} requests cannot be edited`);
}

assert.throws(() => validatePortalRequestMutation({ kind: 'tasks', action: 'approve_request' }), (error) => error.status === 400);
assert.throws(() => validatePortalRequestMutation({ kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 400);
assert.throws(() => validatePortalRequestMutation({ kind: 'calendar', action: 'create_request' }, { kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 409);
assert.throws(() => validatePortalRequestMutation({ kind: 'timesheets', action: 'update_request', status: 'Approved' }, { kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 409);
assert.doesNotThrow(() => validatePortalRequestDeletion({ kind: 'timesheets' }));
for (const kind of ['calendar', 'tasks']) {
  assert.throws(() => validatePortalRequestDeletion({ kind }), (error) => error.status === 409, `portal DELETE cannot remove ${kind} request history`);
}

const legacyPending = normaliseInput({
  recordId: 'task-legacy', action: 'update_request', payload: { title: 'Repair pump' }
}, employee, { kind: 'tasks', status: 'Saved', record_id: 'task-legacy', owner_oid: employee.oid, owner_upn: employee.upn });
assert.equal(legacyPending.kind, 'tasks', 'an update that omits kind preserves the existing request category');
assert.equal(legacyPending.status, 'Saved', 'an edit with no status preserves the existing request state');

const worker = readFileSync(new URL('../cloudflare-worker/src/index.js', import.meta.url), 'utf8');
assert.equal((worker.match(/validatePortalRequestMutation\(body, existing, identity\)/g) || []).length, 2, 'upsert and PATCH routes call the request lifecycle policy with the signed-in identity');
assert.match(worker, /async function deleteRecord\(env, existing, identity\) \{\s*validatePortalRequestDeletion\(existing\);/, 'the DELETE helper applies request deletion policy before soft delete');

const raceDb = new DatabaseSync(':memory:');
raceDb.exec(`
  CREATE TABLE portal_access_assignments (owner_oid TEXT, owner_upn TEXT, role TEXT);
  CREATE TABLE pay_month_start_settings (month_key TEXT, start_date TEXT);
  CREATE TABLE records (
    record_id TEXT PRIMARY KEY, owner_oid TEXT NOT NULL, owner_upn TEXT NOT NULL, employee_name TEXT NOT NULL,
    kind TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, start_date TEXT, end_date TEXT, record_date TEXT,
    submitted_at TEXT NOT NULL, updated_at TEXT, issue TEXT, payload_json TEXT
  );
  CREATE TABLE record_versions (record_id TEXT, owner_oid TEXT, payload_json TEXT, changed_at TEXT, changed_by_oid TEXT);
  INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, submitted_at, updated_at, payload_json)
    VALUES ('calendar-race-001', 'employee-oid', 'employee@gmt-services.co.uk', 'GMT Employee', 'calendar', 'create_request', 'Pending approval', '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z', '{"title":"Original"}');
`);
let racedDecision = false;
const raceDatabase = {
  prepare(sql) {
    let values = [];
    return {
      bind(...bound) { values = bound; return this; },
      all() { return { results: raceDb.prepare(sql).all(...values) }; },
      first() {
        const row = raceDb.prepare(sql).get(...values) || null;
        if (!racedDecision && /^SELECT \* FROM records WHERE record_id = \?$/i.test(sql)) {
          raceDb.prepare('UPDATE records SET status = ? WHERE record_id = ?').run('Approved', values[0]);
          racedDecision = true;
        }
        return row;
      },
      run() {
        const result = raceDb.prepare(sql).run(...values);
        return { meta: { changes: result.changes } };
      }
    };
  }
};
const raceTenant = 'a7c20f5b-e3a8-4a89-8577-b3def40a2691';
const raceAudience = '89cc3daf-695d-43dc-bd49-54d699fb22c4';
const signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey);
jwk.kid = 'portal-request-race-test-key';
jwk.use = 'sig';
const base64url = (value) => Buffer.from(value).toString('base64url');
const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }));
const claims = base64url(JSON.stringify({
  tid: raceTenant, aud: raceAudience, iss: `https://login.microsoftonline.com/${raceTenant}/v2.0`,
  exp: Math.floor(Date.now() / 1000) + 300, oid: employee.oid,
  preferred_username: employee.upn, name: employee.name
}));
const signedInput = `${header}.${claims}`;
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(signedInput));
const token = `${signedInput}.${base64url(new Uint8Array(signature))}`;
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url) => String(url).includes('/discovery/v2.0/keys')
  ? new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  : new Response('', { status: 404 });
try {
  const response = await portalWorker.fetch(new Request('https://gmt-portal-api.example.workers.dev/api/records', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'calendar-race-001', kind: 'calendar', action: 'update_request',
      payload: { title: 'Must not overwrite Accounts approval' }
    })
  }), { DB: raceDatabase, ENTRA_TENANT_ID: raceTenant, ENTRA_AUDIENCES: raceAudience }, {});
  assert.equal(response.status, 409, 'a status transition to Approved between read and write makes an in-flight portal edit conflict');
  assert.equal(raceDb.prepare('SELECT status FROM records WHERE record_id = ?').get('calendar-race-001').status, 'Approved', 'a concurrent Accounts approval remains authoritative');
  assert.equal(raceDb.prepare('SELECT COUNT(*) AS count FROM record_versions').get().count, 0, 'a rejected compare-and-set does not create a stale history version');
} finally {
  globalThis.fetch = previousFetch;
  raceDb.close();
}

console.log('Portal request lifecycle policy checks: PASS');
