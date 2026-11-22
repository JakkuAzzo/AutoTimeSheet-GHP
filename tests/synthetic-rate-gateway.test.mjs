import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRateSyntheticPortalGateway} from '../cloudflare-worker/src/synthetic-portal-gateway.js';
import {rateFixture} from '../cloudflare-worker/src/synthetic-rate-fixture.js';
import {syntheticRateExample} from './helpers/synthetic-rate-attachments.mjs';

test('rate gateway uses a different isolated marker and cannot reach an existing workbook',async()=>{
 const tenant='8b182d6b-6f34-4ca2-84ad-50ca712b5488',aud='01b5a6c6-f6c1-47cb-aebe-67f07f415e4b',oid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',origin='http://localhost:4179';
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='rate-gateway';const b64=x=>Buffer.from(x).toString('base64url');
 const data=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid,preferred_username:'fictional@example.test'})),token=data+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))));
 let verified=false,calls=0;const gateway=createRateSyntheticPortalGateway({fetch:async()=>{calls++;return new Response(null,{status:204})}});
 const DB={prepare:statement=>({bind:(...args)=>({first:async()=>statement.includes('synthetic_test_environment')?{marker:'gmt-timesheet-rate-build-only'}:verified&&args[0]===oid&&args[1]===rateFixture.sourceId?{verified:1}:null,run:async()=>{verified=!statement.startsWith('DELETE');return {meta:{changes:1}}}})})};
 const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:aud,ALLOWED_ORIGINS:origin,SYNTHETIC_TEST_ALLOWED_OID:oid,SYNTHETIC_TEST_SUBJECT_OID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',DOCUMENT_IMPORT_SHARED_STORAGE_READY:'false',SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false',SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFPFOELOEM7HDJB2SOQSB3IBWSRN',SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFLBI6XSXPOOSRCIKDR2EUSAR3I5',SYNTHETIC_TEST_WORKBOOK_ID:'RATE-DESTINATION-NOT-PROVISIONED',SYNTHETIC_RATE_TEST_MODE:'build-only-v1',PAY_MONTH_RATE_DELIVERY_READY:'true'};
 const request=(path,body,type='application/json')=>new Request('https://isolated.test'+path,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':type},body:type==='application/json'?JSON.stringify(body):body});
 const previous=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('/discovery/v2.0/keys')?Response.json({keys:[jwk]}):new Response('',{status:404});
 try{
  const proof=bytes=>request('/api/synthetic-fixture-proof',bytes,'application/octet-stream');
  assert.equal((await gateway.fetch(proof(readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json')),env,{})).status,400);
  assert.equal((await gateway.fetch(proof(readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv')),env,{})).status,200);
  const {correction}=syntheticRateExample();assert.equal((await gateway.fetch(request('/api/records',correction),env,{})).status,204);assert.equal(calls,1);
  const altered=structuredClone(correction);altered.payload.rows[0].note='private text';assert.equal((await gateway.fetch(request('/api/records',altered),env,{})).status,400);assert.equal(calls,1);
  for(const changes of [{SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH'},{SYNTHETIC_RATE_TEST_MODE:''},{PAY_MONTH_RATE_DELIVERY_READY:'false'},{DISPATCH_ENABLED:'true'}])assert.equal((await gateway.fetch(proof(readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv')),{...env,...changes},{})).status,503);
  const oldDB={prepare:()=>({bind:()=>({first:async()=>({marker:'gmt-timesheet-portal-e2e-20261116'})})})};assert.equal((await gateway.fetch(proof(readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv')),{...env,DB:oldDB},{})).status,503);
 }finally{globalThis.fetch=previous}
});
