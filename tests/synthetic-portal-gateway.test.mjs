import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import actualGateway, { createSyntheticPortalGateway } from '../cloudflare-worker/src/synthetic-portal-gateway.js';
import { syntheticFixture } from '../cloudflare-worker/src/synthetic-portal-fixture.js';

const tenant = '8b182d6b-6f34-4ca2-84ad-50ca712b5488';
const audience = '01b5a6c6-f6c1-47cb-aebe-67f07f415e4b';
const permittedOid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const encode = value => Buffer.from(value).toString('base64url');

test('the synthetic gateway fails closed outside its isolated database and selected signed-in identity', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  jwk.kid = 'synthetic-gateway-test';
  async function token(oid) {
    const data = encode(JSON.stringify({ alg: 'RS256', kid: jwk.kid })) + '.' + encode(JSON.stringify({
      tid: tenant, aud: audience, iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
      exp: Math.floor(Date.now() / 1000) + 300, oid, preferred_username: 'fictional@example.test'
    }));
    return data + '.' + encode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data))));
  }
  let calls = 0, lastBody;
  const gateway = createSyntheticPortalGateway({ fetch: async request => { calls++; if(request.method==='POST')lastBody=await request.json(); return new Response(null, { status: 204 }); } });
  let fixtureProof=false;
  const DB = { prepare: statement => ({ bind: (...args) => ({
    first: async () => statement.includes('synthetic_test_environment') ? { marker: 'gmt-timesheet-portal-e2e-20261116' } : fixtureProof && args[0]===permittedOid && args[1]===syntheticFixture.sourceId ? { verified: 1 } : null,
    run: async () => { fixtureProof=!statement.startsWith('DELETE'); return {meta:{changes:1}}; }
  }) }) };
  const env = { DB, ENTRA_TENANT_ID: tenant, ENTRA_AUDIENCES: audience,
    ALLOWED_ORIGINS: 'http://localhost:4179', SYNTHETIC_TEST_ALLOWED_OID: permittedOid, SYNTHETIC_TEST_SUBJECT_OID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    PRIVATE_TIMESHEET_PARENT_ID: '01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',
    DISPATCH_ENABLED: 'false', PAY_MONTH_REPLAY_READY: 'false', DOCUMENT_IMPORT_SHARED_STORAGE_READY: 'false',SYNTHETIC_TEST_SERVICE_ENABLED:'true',
    SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false',
    SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFPFOELOEM7HDJB2SOQSB3IBWSRN',SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFLBI6XSXPOOSRCIKDR2EUSAR3I5',SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH' };
  const origin = 'http://localhost:4179';
  const allowedToken = await token(permittedOid), otherToken = await token(otherOid);
  const request = (url, bearer, overrides = {}) => new Request('https://isolated.test' + url,
    { headers: { origin, authorization: `Bearer ${bearer}`, ...(overrides.headers || {}) }, method: overrides.method || 'GET' });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('/discovery/v2.0/keys')
    ? new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : new Response('', { status: 404 });
  try {
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), env, {})).status, 204);
    assert.equal((await gateway.fetch(request('/api/profile', otherToken), env, {})).status, 403);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken, { headers: { origin: 'https://elsewhere.example' } }), env, {})).status, 403);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, DISPATCH_ENABLED: 'true' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, SYNTHETIC_TEST_SERVICE_ENABLED:'false' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, HISTORY_SOURCE: 'sharepoint' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, PRIVATE_TIMESHEET_PARENT_ID: 'production-folder' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, SYNTHETIC_TEST_ALLOWED_OID: '' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, SYNTHETIC_TEST_SUBJECT_OID: '' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, SYNTHETIC_TEST_READ_ONLY_DESTINATION:'false' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, SYNTHETIC_TEST_WORKBOOK_ID:'another-workbook' }, {})).status, 503);
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, DB: { prepare() { throw new Error('no marker'); } } }, {})).status, 503);
    const priorTestDB={prepare:()=>({bind:()=>({first:async()=>({marker:'gmt-timesheet-synthetic-20261110'})})})};
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken), { ...env, DB:priorTestDB }, {})).status, 503,
      'the earlier isolated database is not the clean portal-test database');
    assert.equal((await gateway.fetch(request('/api/profile', allowedToken.slice(0, -8) + 'invalid!'), env, {})).status, 401);
    assert.equal((await gateway.fetch(request('/api/xero/callback', allowedToken), env, {})).status, 404);
    assert.equal((await gateway.fetch(request('/api/records', allowedToken, { method: 'POST' }), env, {})).status, 415);
    const preflight = new Request('https://isolated.test/api/profile', { method: 'OPTIONS', headers: {
      origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    const preflightResponse=await gateway.fetch(preflight, env, {});
    assert.equal(preflightResponse.status,204);
    assert.equal(preflightResponse.headers.get('access-control-allow-credentials'),'true');
    const forgedPreflight = new Request('https://isolated.test/api/profile', { method: 'OPTIONS', headers: {
      origin, 'access-control-request-method': 'POST' } });
    assert.equal((await gateway.fetch(forgedPreflight, env, {})).status, 403);
    const callback = new Request('https://isolated.test/api/integrations/timesheet-delivery-receipts', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-gmt-delivery-key': 'incorrect' }, body: '{}' });
    const callbackEnv = { ...env, TIMESHEET_DELIVERY_CALLBACK_KEY: 'test-only-key-that-is-at-least-thirty-two-characters' };
    assert.equal((await actualGateway.fetch(callback, callbackEnv, {})).status, 401,
      'the real receipt handler still rejects an invalid connection key');
    assert.equal(calls, 1, 'denied requests never reach the underlying worker');
    const post=(url,body,who=allowedToken)=>new Request('https://isolated.test'+url,{method:'POST',
      headers:{origin,authorization:`Bearer ${who}`,'content-type':'application/json'},body:JSON.stringify(body)});
    const target={employeeEmail:syntheticFixture.employeeUpn,dates:syntheticFixture.rows.map(row=>row.date)};
    assert.equal((await gateway.fetch(post('/api/document-import/timesheet-target',target),env,{})).status,403,
      'a claimed file fingerprint alone cannot authorize a correction');
    const bytes=fs.readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json');
    const upload=data=>new Request('https://isolated.test/api/synthetic-fixture-proof',{method:'POST',
      headers:{origin,authorization:`Bearer ${allowedToken}`,'content-type':'application/octet-stream'},body:data});
    assert.equal((await gateway.fetch(upload(new Uint8Array([1,2,3])),env,{})).status,400);
    assert.equal(fixtureProof,false);
    const acceptedProof=await gateway.fetch(upload(bytes),env,{});
    assert.equal(acceptedProof.status,200);
    assert.equal(acceptedProof.headers.get('access-control-allow-credentials'),'true');
    assert.equal((await gateway.fetch(upload(new Uint8Array([1,2,3])),env,{})).status,400);
    assert.equal((await gateway.fetch(post('/api/document-import/timesheet-target',target),env,{})).status,403,
      'a later invalid upload invalidates the earlier proof');
    assert.equal((await gateway.fetch(upload(bytes),env,{})).status,200);
    assert.equal((await gateway.fetch(post('/api/synthetic-fixture-invalidate',{}),env,{})).status,204);
    assert.equal((await gateway.fetch(post('/api/document-import/timesheet-target',target),env,{})).status,403);
    assert.equal((await gateway.fetch(upload(bytes),env,{})).status,200);
    assert.equal((await gateway.fetch(post('/api/document-import/timesheet-target',target),env,{})).status,204);
    assert.equal((await gateway.fetch(post('/api/document-import/timesheet-target',{...target,employeeEmail:'other@example.test'}),env,{})).status,400);
    const evidence={raw:'',claimedBasic:null,claimedOt15:null,claimedOt20:null,reviewNote:'',sourceFile:syntheticFixture.fileName,sourceId:syntheticFixture.sourceId};
    const rows=syntheticFixture.rows.map((row,index)=>({...row,description:row.note,lunchHad:row.lunchMinutes===null?null:false,
      ...(index===0?{workedMinutes:180,workedHours:3}:{}),basicHours:index===0?3:2,ot15Hours:0,ot20Hours:0,weightedHours:index===0?3:2,sourceEvidence:{...evidence}}));
    const editor='Nathan Brown-Bennett';
    const correction={recordId:syntheticFixture.recordId,kind:'timesheets',action:'pay_month_correction',status:'Submitted',editMode:true,
      employeeName:syntheticFixture.employeeName,employeeEmail:syntheticFixture.employeeUpn,startDate:'2026-09-21',endDate:'2026-10-18',
      recordDate:'2026-11-16',updatedAt:'2026-11-16T13:00:00.000Z',baseCorrectionExists:false,baseCorrectionUpdatedAt:'',baseOwnerRevision:0,
      importReview:{dates:rows.map(row=>row.date),historyFingerprint:'A'.repeat(43),localRevision:0},
      payload:{employeeName:syntheticFixture.employeeName,employeeEmail:syntheticFixture.employeeUpn,payMonth:'2026-10',
        weekStart:'2026-09-21',weekEnd:'2026-10-18',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',payrollFriday:'2026-10-16',rows,
        deletedDays:[],editedAt:'2026-11-16T13:00:00.000Z',editedBy:editor,editNote:`Edited on behalf of ${syntheticFixture.employeeName} by ${editor}.`}};
    assert.equal((await gateway.fetch(post('/api/records',correction),env,{})).status,204);
    assert.equal(lastBody.payload.testMode,true,'the gateway marks the exact test correction before storage');
    const altered=structuredClone(correction); altered.payload.rows[0].note='real-world text';
    assert.equal((await gateway.fetch(post('/api/records',altered),env,{})).status,400);
    assert.equal((await gateway.fetch(post('/api/records',correction,otherToken),env,{})).status,403);
    assert.equal(calls,3,'invalid writes do not reach the underlying worker');
  } finally { globalThis.fetch = previousFetch; }
});
