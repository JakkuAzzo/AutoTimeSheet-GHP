import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

test('the test portal sends only verified fictional bytes and invalidates earlier proof first', async () => {
  const calls=[];
  const context=vm.createContext({crypto:webcrypto,Uint8Array,File,console,
    GMT_APP_CONFIG:{portalApiEndpoint:'https://gmt-timesheet-portal-e2e-20261116.raspy-breeze-e230.workers.dev',portalApiScopes:['openid']},
    GMT_PORTAL_AUTH:{acquireToken:async()=>'fixture-token'},
    fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:url.endsWith('/invalidate')?204:200}}});
  context.window=context;
  vm.runInContext(fs.readFileSync('tools/synthetic-fixture-proof.js','utf8'),context);
  const bytes=fs.readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json');
  await context.GMTSyntheticVerifyUpload(new File([bytes],'GMT-FICTIONAL-PORTAL-UPLOAD.json'));
  assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/api/synthetic-fixture-invalidate','/api/synthetic-fixture-proof']);
  assert.equal(calls[1].options.headers.Authorization,'Bearer fixture-token');
  assert.equal(calls[1].options.credentials,'include');
  assert.deepEqual(Buffer.from(calls[1].options.body),bytes);
  calls.length=0;
  await assert.rejects(()=>context.GMTSyntheticVerifyUpload(new File(['not fictional'],'other.json')));
  assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/api/synthetic-fixture-invalidate'],
    'an unexpected file is never sent to the service');
  calls.length=0;
  await assert.rejects(()=>context.GMTSyntheticVerifyUpload(new File(['not fictional'],'GMT-FICTIONAL-PORTAL-UPLOAD.json')));
  assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/api/synthetic-fixture-invalidate'],
    'using the expected filename does not send different bytes');
  calls.length=0;context.GMT_APP_CONFIG.portalApiEndpoint='https://gmt-portal-api.example';
  await assert.rejects(()=>context.GMTSyntheticVerifyUpload(new File([bytes],'GMT-FICTIONAL-PORTAL-UPLOAD.json')));
  assert.equal(calls.length,0,'the helper refuses any non-test service');
});
