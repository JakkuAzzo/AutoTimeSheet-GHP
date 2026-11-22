import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../cloudflare-worker/src/index.js';

const tenant = 'a7c20f5b-e3a8-4a89-8577-b3def40a2691';
const audience = '89cc3daf-695d-43dc-bd49-54d699fb22c4';
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
jwk.kid = 'delete-race-test';
jwk.use = 'sig';
const b64 = value => Buffer.from(value).toString('base64url');
const unsigned = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })) + '.' + b64(JSON.stringify({ tid: tenant, aud: audience, iss: `https://login.microsoftonline.com/${tenant}/v2.0`, exp: Math.floor(Date.now() / 1000) + 300, oid: 'employee-oid', preferred_username: 'employee@example.test', name: 'Employee' }));
const token = unsigned + '.' + b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(unsigned))));
const realFetch = globalThis.fetch;
globalThis.fetch = async url => String(url).includes('/discovery/v2.0/keys') ? new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 });

async function exercise(queueStatus, changeBeforeWrite = null, failDuringWrite = false) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql', import.meta.url), 'utf8'));
  const payload = JSON.stringify({ payMonth: '2026-10', rows: [{ date: '2026-10-05' }] });
  sql.prepare('INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('correction', 'employee-oid', 'employee@example.test', 'Employee', 'timesheets', 'pay_month_correction', 'Submitted', '2026-10-01', '2026-10-01', payload);
  if (queueStatus) sql.prepare("INSERT INTO dispatch_queue VALUES (? ,?,'2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run('correction', queueStatus);
  let injection = changeBeforeWrite;
  let writes = 0;
  const applyInjection = () => { if (injection) { const action = injection; injection = null; action(sql); } };
  const wrap = (statement, args = []) => ({
    async first() { return sql.prepare(statement).get(...args) || null; },
    async all() { return { results: sql.prepare(statement).all(...args) }; },
    async run() { applyInjection(); if (failDuringWrite && ++writes === 2) throw new Error('simulated transactional failure'); const before=sql.prepare('SELECT total_changes() AS n').get().n; sql.prepare(statement).run(...args); return { meta: { changes: sql.prepare('SELECT total_changes() AS n').get().n-before } }; }
  });
  const DB = {
    prepare(statement) { return { ...wrap(statement), bind(...args) { return wrap(statement, args); } }; },
    async batch(statements) { applyInjection(); sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }
  };
  const env = { DB, ENTRA_TENANT_ID: tenant, ENTRA_AUDIENCES: audience, ADMIN_UPNS: 'employee@example.test', TIMESHEET_VIEWER_UPNS: 'employee@example.test' };
  const response = await worker.fetch(new Request('https://gmt.test/api/records/correction', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }), env, {});
  const result = { status: response.status, record: sql.prepare("SELECT status,payload_json FROM records WHERE record_id='correction'").get(), queue: sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='correction'").get()?.status || null, versions: sql.prepare("SELECT payload_json FROM record_versions WHERE record_id='correction'").all(), payload };
  sql.close();
  return result;
}

for (const status of ['sending', 'sent', 'failed', 'uncertain', 'completed']) {
  test(`deletion holds a correction with delivery status ${status}`, async () => {
    const result = await exercise(status);
    assert.equal(result.status, 409);
    assert.equal(result.record.status, 'Submitted');
    assert.equal(result.record.payload_json, result.payload);
    assert.equal(result.queue, status);
    assert.equal(result.versions.length, 0);
  });
}

test('a delivery claim racing deletion holds the source and leaves no false version', async () => {
  const result = await exercise('queued', sql => sql.prepare("UPDATE dispatch_queue SET status='sending' WHERE record_id='correction'").run());
  assert.equal(result.status, 409);
  assert.equal(result.record.payload_json, result.payload);
  assert.equal(result.queue, 'sending');
  assert.equal(result.versions.length, 0);
});

test('a newer snapshot racing deletion is preserved', async () => {
  const newer = JSON.stringify({ payMonth: '2026-10', rows: [{ date: '2026-10-06' }] });
  const result = await exercise('queued', sql => sql.prepare("UPDATE records SET payload_json=?,updated_at='newer' WHERE record_id='correction'").run(newer));
  assert.equal(result.status, 409);
  assert.equal(result.record.payload_json, newer);
  assert.equal(result.queue, 'queued');
  assert.equal(result.versions.length, 0);
});

test('an identity change racing deletion is preserved', async () => {
  const result = await exercise('queued', sql => sql.prepare("UPDATE records SET owner_oid='different-oid' WHERE record_id='correction'").run());
  assert.equal(result.status, 409);
  assert.equal(result.record.status, 'Submitted');
  assert.equal(result.record.payload_json, result.payload);
  assert.equal(result.queue, 'queued');
  assert.equal(result.versions.length, 0);
});

test('deleting an unclaimed correction preserves its version and retires the queue', async () => {
  const result = await exercise('queued');
  assert.equal(result.status, 200);
  assert.equal(result.record.status, 'Deleted');
  assert.equal(result.queue, 'skipped');
  assert.equal(result.versions.length, 1);
  assert.deepEqual(JSON.parse(result.versions[0].payload_json).payload, JSON.parse(result.payload));
});

for (const status of [null, 'skipped']) {
  test(`deleting a correction with ${status || 'no'} queue preserves its prior version`, async () => {
    const result = await exercise(status);
    assert.equal(result.status, 200);
    assert.equal(result.record.status, 'Deleted');
    assert.equal(result.queue, status);
    assert.equal(result.versions.length, 1);
    assert.deepEqual(JSON.parse(result.versions[0].payload_json).payload, JSON.parse(result.payload));
  });
}

test('a write failure rolls back both version and deletion', async () => {
  const result = await exercise('queued', null, true);
  assert.equal(result.status, 500);
  assert.equal(result.record.payload_json, result.payload);
  assert.equal(result.queue, 'queued');
  assert.equal(result.versions.length, 0);
});

process.on('exit', () => { globalThis.fetch = realFetch; });
