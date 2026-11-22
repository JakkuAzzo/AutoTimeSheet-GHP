import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createProviderRateSyntheticGateway} from '../cloudflare-worker/src/synthetic-portal-gateway.js';
import {rateFixture as fixture} from '../cloudflare-worker/src/synthetic-rate-fixture.js';
import {syntheticRateExample} from './helpers/synthetic-rate-attachments.mjs';
import {selectPublicationSource} from '../cloudflare-worker/src/timesheet-source-publication-guard.js';

test('provider rate gateway saves and queues only its separate fictional source',{timeout:10000},async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../cloudflare-worker/test-only/synthetic-rate-portal-guard.sql',import.meta.url),'utf8').replaceAll('gmt-timesheet-rate-build-only','gmt-timesheet-rate-provider-20261119'));
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values)},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const before=db.prepare('SELECT total_changes() n').get().n;db.prepare(sql).run(...args);return {meta:{changes:db.prepare('SELECT total_changes() n').get().n-before}}}}),DB={prepare:sql=>wrap(sql),async batch(statements){db.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}};
 const tenant='8b182d6b-6f34-4ca2-84ad-50ca712b5488',aud='01b5a6c6-f6c1-47cb-aebe-67f07f415e4b',origin='http://localhost:4179',actorOid='084af2b4-4427-4986-b7e0-ec163c520282',employeeOid='bb420999-c705-4dc2-9b0e-33846b43ae2c',actor='amanda.bb@gmtelectservsltd.onmicrosoft.com';
 const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:aud,ALLOWED_ORIGINS:origin,SYNTHETIC_TEST_ALLOWED_OID:actorOid,SYNTHETIC_TEST_SUBJECT_OID:employeeOid,PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFIIINPOKIYCCZEJFTFMCUTRGBUL',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',DOCUMENT_IMPORT_SHARED_STORAGE_READY:'false',SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_QUEUE_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false',SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFLBUIMATW7STNBLMXO3VGLMSTCB',SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFOCW3CCKIKQRZFJYU6JYYWSK3UK',SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFKFZ6PPD3U36RHLN74B2KFNIR4F',SYNTHETIC_RATE_TEST_MODE:'provider-fixture-v1',PAY_MONTH_RATE_DELIVERY_READY:'true',ADMIN_UPNS:actor,SUBMISSIONS_ADMIN_UPNS:actor,STAFF_DIRECTORY_JSON:JSON.stringify([{name:fixture.employeeName,upn:fixture.employeeUpn}]),SHAREPOINT_GRAPH_CLIENT_ID:'fictional',SHAREPOINT_GRAPH_CLIENT_SECRET:'fictional',SHAREPOINT_SITE_ID:'fictional',SHAREPOINT_DRIVE_ID:'fictional',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-rate-callback-key-at-least-32-chars'};
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='synthetic-rate-integration';const b64=x=>Buffer.from(x).toString('base64url');
 const data=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid:actorOid,preferred_username:actor,name:'Amanda Brown-Bennett'})),token=data+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))));
 const gateway=createProviderRateSyntheticGateway(),post=(path,body,type='application/json')=>new Request('https://isolated.test'+path,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':type},body:type==='application/json'?JSON.stringify(body):body});
 const machine=(path,body)=>new Request('https://isolated.test'+path,{method:'POST',headers:{'x-gmt-delivery-key':env.TIMESHEET_DELIVERY_CALLBACK_KEY,'content-type':'application/json'},body:JSON.stringify(body)});
 const previous=globalThis.fetch;globalThis.fetch=async url=>{const target=String(url);if(target.includes('/discovery/v2.0/keys'))return Response.json({keys:[jwk]});if(target.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fictional',expires_in:300});if(target.includes('/v1.0/users/'))return Response.json({id:employeeOid,userPrincipalName:fixture.employeeUpn});throw Error('Unexpected network request')};
 try{
  assert.equal((await gateway.fetch(post('/api/synthetic-fixture-proof',readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv'),'application/octet-stream'),env,{})).status,200);
  const target=await gateway.fetch(post('/api/document-import/timesheet-target',{employeeEmail:fixture.employeeUpn,dates:fixture.rows.map(row=>row.date)}),env,{});assert.equal(target.status,200,await target.clone().text());const targetBody=await target.json();
  const {correction,body}=syntheticRateExample();correction.importReview.historyFingerprint=targetBody.historyFingerprint;const saved=await gateway.fetch(post('/api/records',correction),env,{});assert.equal(saved.status,201,await saved.clone().text());
  const queuePath='/api/records/'+encodeURIComponent(fixture.recordId)+'/attachments',bad=structuredClone(body);bad.attachments[1].contentBase64=Buffer.from('unrelated').toString('base64');assert.equal((await gateway.fetch(post(queuePath,bad),env,{})).status,400);
  const queued=await gateway.fetch(post(queuePath,body),env,{});assert.equal(queued.status,202,await queued.clone().text());
  // The isolated queue records the exact source and attachment evidence, but
  // its imported-source hold still prevents it from becoming a publication.
  db.prepare("INSERT INTO private_timesheet_subjects(employee_upn,employee_oid,created_at) VALUES (?,?,'t')").run(fixture.employeeUpn,employeeOid);
  const current=db.prepare('SELECT payload_json FROM records WHERE record_id=?').get(fixture.recordId);
  const proof=db.prepare('SELECT owner_revision,source_base64 FROM timesheet_queue_source_guards WHERE record_id=?').get(fixture.recordId);
  const savedSource=db.prepare("SELECT content_base64 FROM record_attachments WHERE record_id=? AND field_name='attachment_record'").get(fixture.recordId).content_base64;
  const revision=db.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(fixture.employeeUpn).revision;
  assert.equal(proof?.owner_revision,revision,'the isolated proof binds the current fictional owner revision');
  assert.equal(proof?.source_base64,savedSource,'the isolated proof binds the exact fictional source attachment');
  assert.ok(db.prepare('SELECT 1 FROM timesheet_queue_attachment_guards WHERE record_id=?').get(fixture.recordId),'the isolated queue records its exact attachment manifest');
  const publication={recordId:fixture.recordId,subjectOid:employeeOid,subjectUpn:fixture.employeeUpn,payMonth:'2026-10',sourceBase64:savedSource,generation:createHash('sha256').update(Buffer.from(savedSource,'base64')).digest('hex'),ownerRevision:revision,payloadJson:current.payload_json,expectedRevision:0};
  assert.ok(db.prepare('SELECT 1 FROM timesheet_import_source_holds WHERE record_id=?').get(fixture.recordId));
  assert.equal(await selectPublicationSource(env,publication),null,'unreviewed imported source remains held even with exact source and attachment proofs');
  const claimResponse=await gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{});assert.equal(claimResponse.status,200,await claimResponse.clone().text());const claim=await claimResponse.json(),source=Buffer.from(claim.sourceBase64,'base64');assert.equal(claim.generation,createHash('sha256').update(source).digest('hex'));assert.equal(JSON.parse(source).schemaVersion,3);
  assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{})).status,409);
  const finished=await gateway.fetch(machine('/api/synthetic-delivery/finish',{generation:claim.generation,outcome:'sent'}),env,{});assert.equal(finished.status,200,await finished.clone().text());assert.equal(db.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(fixture.recordId).status,'sent');
 }finally{globalThis.fetch=previous;db.close()}
});
