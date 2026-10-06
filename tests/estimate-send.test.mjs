import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare-worker/src/index.js';
import { normalizeEstimateArchiveRecord, upsertEstimateArchive } from '../cloudflare-worker/src/estimate-archive.js';

const db = new DatabaseSync(':memory:');
db.exec(await readFile(new URL('../cloudflare-worker/schema.sql', import.meta.url), 'utf8'));
for (const name of ['0007_estimate_index.sql', '0008_estimate_mail_sources.sql', '0009_estimate_archive.sql']) {
  db.exec(await readFile(new URL(`../cloudflare-worker/migrations/${name}`, import.meta.url), 'utf8'));
}
const d1 = {
  prepare(sql) {
    const make = (args = []) => ({
      first() { return db.prepare(sql).get(...args) || null; },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() { return { success: true, meta: db.prepare(sql).run(...args) }; }
    });
    return { ...make(), bind(...args) { return make(args); } };
  }
};

const tenant = '8b182d6b-6f34-4ca2-84ad-50ca712b5488';
const audience = '01b5a6c6-f6c1-47cb-aebe-67f07f415e4b';
const owner = 'estimate-owner-oid';
const signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey);
jwk.kid = 'estimate-send-test-key';
jwk.use = 'sig';
const base64url = (value) => Buffer.from(value).toString('base64url');
const originalFetch = globalThis.fetch;
let flowCalls = 0;
let flowPayload;
let flowAuthorization = '';
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('/discovery/v2.0/keys')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (String(url).includes('.environment.api.powerplatform.com')) {
    flowCalls += 1;
    flowPayload = JSON.parse(init.body);
    flowAuthorization = init.headers.authorization || '';
    return new Response(JSON.stringify({ success: true, sentAt: '2026-10-06T12:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('', { status: 404 });
};
const claims = base64url(JSON.stringify({
  tid: tenant, aud: audience, iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
  exp: Math.floor(Date.now() / 1000) + 300, oid: owner,
  preferred_username: 'employee@gmt-services.co.uk', name: 'GMT Employee'
}));
const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }));
const signingInput = `${header}.${claims}`;
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(signingInput));
const token = `${signingInput}.${base64url(new Uint8Array(signature))}`;
const flowClaims = base64url(JSON.stringify({
  tid: tenant, aud: 'https://service.flow.microsoft.com/', iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
  exp: Math.floor(Date.now() / 1000) + 300, oid: owner,
  preferred_username: 'employee@gmt-services.co.uk', name: 'GMT Employee'
}));
const flowSigningInput = `${header}.${flowClaims}`;
const flowSignature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(flowSigningInput));
const flowToken = `${flowSigningInput}.${base64url(new Uint8Array(flowSignature))}`;
const wrongUserClaims = base64url(JSON.stringify({
  tid: tenant, aud: 'https://service.flow.microsoft.com/', iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
  exp: Math.floor(Date.now() / 1000) + 300, oid: 'different-employee-oid',
  preferred_username: 'other@gmt-services.co.uk', name: 'Other Employee'
}));
const wrongUserInput = `${header}.${wrongUserClaims}`;
const wrongUserSignature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(wrongUserInput));
const wrongUserFlowToken = `${wrongUserInput}.${base64url(new Uint8Array(wrongUserSignature))}`;

const estimate = {
  record_id: 'estimate-send-001', owner_oid: owner, owner_upn: 'employee@gmt-services.co.uk',
  employee_name: 'GMT Employee', kind: 'estimates', action: 'client_send', status: 'Pending client send',
  start_date: null, end_date: null, record_date: '2026-10-06', submitted_at: '2026-10-06T11:00:00.000Z',
  updated_at: '2026-10-06T11:00:00.000Z', issue: '', payload_json: JSON.stringify({ number: 'EST-001', company: 'Acme Ltd', email: 'client@example.com', total: 120 })
};
db.prepare(`INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, record_date, submitted_at, updated_at, issue, payload_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(estimate.record_id, estimate.owner_oid, estimate.owner_upn, estimate.employee_name, estimate.kind, estimate.action, estimate.status,
    estimate.record_date, estimate.submitted_at, estimate.updated_at, estimate.issue, estimate.payload_json);
const archiveInput = normalizeEstimateArchiveRecord({
  id: 'app-archive-send-001', canonical_id: 'app:send-001', source_kind: 'app', classification_state: 'confirmed',
  source_message_id: 'send-001', mailbox: '', sender_email: 'employee@gmt-services.co.uk', customer: 'Acme Ltd',
  customer_email: 'client@example.com', estimate_number: 'EST-001', sent_at: '2026-10-06T11:00:00.000Z',
  provenance: { source: 'portal-app', source_record_id: estimate.record_id }
});
await upsertEstimateArchive({ DB: d1 }, { ...archiveInput, provenance: JSON.parse(archiveInput.provenance_json) });

const env = {
  DB: d1, ENTRA_TENANT_ID: tenant, ENTRA_AUDIENCES: audience,
  ALLOWED_ORIGINS: 'https://gmt-services.co.uk',
  ESTIMATE_SEND_FLOW_URL: 'https://default.environment.api.powerplatform.com/send'
};
const sendUrl = 'https://gmt-portal-api.example.workers.dev/api/estimates/send';
const send = (body, accessToken = flowToken) => worker.fetch(new Request(sendUrl, {
  method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json',
    ...(accessToken ? { 'X-GMT-Upstream-Authorization': `Bearer ${accessToken}` } : {})
  }, body: JSON.stringify(body)
}), env, {});
const payload = {
  recordId: estimate.record_id, to: 'client@example.com', estimate: { number: 'EST-001', company: 'Acme Ltd', total: 120 },
  fileName: 'EST-001.doc', contentType: 'application/msword', contentBase64: Buffer.from('<doc/>').toString('base64')
};

const sent = await send(payload);
assert.equal(sent.status, 200, 'authenticated estimate can be sent only after its archive record exists');
assert.equal(flowCalls, 1);
assert.equal(flowAuthorization, `Bearer ${flowToken}`, 'the Worker forwards the delegated Flow token as the trigger authorization');
assert.equal(flowPayload.to, 'client@example.com');
assert.equal(flowPayload.bcc, 'accounts@gmt-services.co.uk', 'Accounts is always copied on a client estimate');
assert.equal(flowPayload.fileName, 'EST-001.doc', 'the payload exposes the attachment fields expected by the Power Automate trigger schema');
assert.equal(flowPayload.contentBase64, Buffer.from('<doc/>').toString('base64'));
assert.equal(flowPayload.contentType, 'application/msword');
assert.equal(db.prepare('SELECT status FROM records WHERE record_id=?').get(estimate.record_id).status, 'Sent to client');
assert.equal((await sent.json()).sent_at, '2026-10-06T12:00:00.000Z');

const noFlowToken = await send(payload, '');
assert.equal(noFlowToken.status, 401, 'the Worker requires the signed-in employee Flow token');
const wrongUserFlow = await send(payload, wrongUserFlowToken);
assert.equal(wrongUserFlow.status, 403, 'the Flow token must belong to the same employee as the portal token');
assert.equal(flowCalls, 1, 'missing or mismatched tokens never reach Power Automate');

const duplicate = await send(payload);
assert.equal(duplicate.status, 409, 'a sent estimate cannot be sent again by a retried browser request');
assert.equal(flowCalls, 1, 'duplicate sends never reach Power Automate');

db.prepare(`INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, record_date, submitted_at, updated_at, issue, payload_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('estimate-no-archive', owner, 'employee@gmt-services.co.uk', 'GMT Employee', 'estimates', 'client_send', 'Pending client send', '2026-10-06', '2026-10-06T11:00:00.000Z', '2026-10-06T11:00:00.000Z', '', '{}');
const noArchive = await send({ ...payload, recordId: 'estimate-no-archive' });
assert.equal(noArchive.status, 409, 'the client send route refuses to send before shared filing');
assert.equal(flowCalls, 1);

globalThis.fetch = originalFetch;
db.close();
console.log('Estimate client-send contract: PASS');
