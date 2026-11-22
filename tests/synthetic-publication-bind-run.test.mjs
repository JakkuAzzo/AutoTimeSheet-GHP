import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';
import {createSyntheticPortalGateway} from '../cloudflare-worker/src/synthetic-portal-gateway.js';
import {syntheticFixture as fixture} from '../cloudflare-worker/src/synthetic-portal-fixture.js';
import {claimBoundSyntheticDelivery} from '../cloudflare-worker/src/synthetic-delivery-handoff.js';
import {syntheticAttachmentExample} from './helpers/synthetic-attachments.mjs';
import productionWorker from '../cloudflare-worker/src/index.js';

test('isolated callback binds only the authenticated claimed fictional generation',async()=>{
 const connector=JSON.parse(readFileSync(new URL('../power-platform/synthetic-publication-connector.openapi.json',import.meta.url),'utf8'));
 assert.equal(connector.swagger,'2.0');assert.deepEqual(connector.security,[{deliveryKey:[]}]);
 assert.deepEqual(connector.securityDefinitions.deliveryKey,{type:'apiKey',name:'X-GMT-Delivery-Key',in:'header'});
 assert.deepEqual(connector.definitions.AttemptRun.required,['attemptId','generation','flowRunId']);
 assert.ok(connector.paths['/api/synthetic-delivery/bind-run'].post);
 assert.ok(connector.paths['/api/synthetic-delivery/read-source'].post);
 assert.ok(connector.paths['/api/synthetic-delivery/claim-bound'].post);
 assert.ok(connector.paths['/api/synthetic-delivery/finish-bound'].post);
 assert.ok(connector.paths['/api/synthetic-delivery/verify-bound'].post);
 assert.equal(connector.paths['/api/synthetic-delivery/read-source'].post.responses['200'].schema.properties.workbookId,undefined);
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 db.exec("CREATE TABLE synthetic_test_environment(marker TEXT PRIMARY KEY); INSERT INTO synthetic_test_environment VALUES ('gmt-timesheet-portal-e2e-20261116')");
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values)},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}}});
 const DB={prepare:sql=>wrap(sql)};
 const oid='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',payMonth='2026-10';
 const env={DB,ENTRA_TENANT_ID:'8b182d6b-6f34-4ca2-84ad-50ca712b5488',ENTRA_AUDIENCES:'01b5a6c6-f6c1-47cb-aebe-67f07f415e4b',ALLOWED_ORIGINS:'http://localhost:4179',SYNTHETIC_TEST_ALLOWED_OID:actor,SYNTHETIC_TEST_SUBJECT_OID:oid,PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',DOCUMENT_IMPORT_SHARED_STORAGE_READY:'false',SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_QUEUE_ENABLED:'true',SYNTHETIC_TEST_BOUND_HANDOFF_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false',SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFPFOELOEM7HDJB2SOQSB3IBWSRN',SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFLBI6XSXPOOSRCIKDR2EUSAR3I5',SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-delivery-key-never-used-in-production'};
 const payloadJson=JSON.stringify({payMonth,testMode:true}),source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:fixture.recordId,employeeName:fixture.employeeName,employeeUpn:fixture.employeeUpn,payMonth,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:fixture.recordId+'|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,note:'Fictional'}]}),encoded=Buffer.from(source).toString('base64'),generation=createHash('sha256').update(source).digest('hex');
 const originalFetch=globalThis.fetch;
 try{
  db.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,?,'timesheets','pay_month_correction','Queued for Accounts','t','t',?)").run(fixture.recordId,oid,fixture.employeeUpn,fixture.employeeName,payloadJson);
  db.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES (?,'queued','t','t',0,'2000-01-01T00:00:00.000Z')").run(fixture.recordId);
  db.prepare("INSERT INTO private_timesheet_subjects(employee_upn,employee_oid,created_at) VALUES (?,?,'t')").run(fixture.employeeUpn,oid);
  const items=[['attachment_record','fictional.json','application/json',encoded],['attachment','fictional.xlsx','application/xlsx','eA=='],['attachment_csv','fictional.csv','text/csv','eA==']];
  for(const [field,name,type,content] of items)db.prepare("INSERT INTO record_attachments VALUES (?,?,?,?,?,1,'t')").run(fixture.recordId,field,name,type,content);
  db.prepare('INSERT INTO timesheet_queue_attachment_guards VALUES (?,?)').run(fixture.recordId,JSON.stringify(items.map(([fieldName,fileName,contentType,contentBase64])=>({fieldName,fileName,contentType,contentBase64,sizeBytes:1}))));
  const revision=db.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(fixture.employeeUpn).revision;
  db.prepare('INSERT INTO timesheet_queue_source_guards VALUES (?,?,?,?)').run(fixture.recordId,fixture.employeeUpn,revision,encoded);
  // A simplified fictional fixture exercises the production guard without
  // removing a real imported-source hold. The real gateway validates exact
  // fixture bytes; the separate browser test checks its hold is not bypassed.
  const claim=await claimBoundSyntheticDelivery(env,async()=>true);assert.ok(claim);assert.equal(claim.generation,generation);assert.equal(claim.recordId,fixture.recordId);assert.equal(claim.sourceBase64,undefined);
  const body={attemptId:claim.attemptId,generation,flowRunId:'fictional-run-1'};
  const gateway=createSyntheticPortalGateway(),callback=(b,key=env.TIMESHEET_DELIVERY_CALLBACK_KEY,e=env,path='bind-run')=>gateway.fetch(new Request('https://isolated.test/api/synthetic-delivery/'+path,{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':key},body:JSON.stringify(b)}),e,{});
  assert.equal((await callback(body,undefined,undefined,'read-source')).status,409,'an unbound run cannot read the source');
  assert.equal((await callback(body,'wrong')).status,401);
  assert.equal((await callback({},'wrong',undefined,'claim-bound')).status,401);
  assert.equal((await callback({extra:true},undefined,undefined,'claim-bound')).status,400);
  assert.equal((await callback({},undefined,undefined,'claim')).status,403,'the legacy handoff is disabled while bound mode is enabled');
  assert.equal((await callback(body,undefined,{...env,SYNTHETIC_TEST_BOUND_HANDOFF_ENABLED:'false'})).status,403);
  assert.equal((await callback({...body,subjectOid:oid})).status,400);
  assert.equal((await callback({...body,generation:'a'.repeat(64)})).status,409);
  assert.equal((await callback({...body,attemptId:'44444444-4444-4444-8444-444444444444'})).status,409);
  assert.equal((await callback({...body,flowRunId:'x'.repeat(241)})).status,400);
  assert.equal((await callback(body,env.TIMESHEET_DELIVERY_CALLBACK_KEY,{...env,DISPATCH_ENABLED:'true'})).status,503);
  const productionResponse=await productionWorker.fetch(new Request('https://production.test/api/synthetic-delivery/bind-run',{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':env.TIMESHEET_DELIVERY_CALLBACK_KEY},body:JSON.stringify(body)}),env,{});
  assert.notEqual(productionResponse.status,200,'the production Worker must not expose the fictional callback');
  const first=await callback(body);assert.equal(first.status,200,await first.clone().text());assert.deepEqual(await first.json(),{bound:true});
  assert.equal((await callback(body)).status,200);
  assert.equal((await callback({...body,flowRunId:'fictional-run-2'})).status,409);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_publication_run_bindings').get().n,1);
  assert.equal((await callback({...body,flowRunId:'fictional-run-2'},undefined,undefined,'read-source')).status,409);
  const read=await callback(body,undefined,undefined,'read-source');assert.equal(read.status,200,await read.clone().text());
  assert.equal(read.headers.get('cache-control'),'no-store');assert.deepEqual(await read.json(),{recordId:fixture.recordId,payMonth,generation,sourceBase64:encoded});
  const fileName='GMT Timesheet - '+fixture.employeeName+' - Pay Month 2026-10.xlsx',book=XLSX.utils.book_new();
  const daily=XLSX.utils.aoa_to_sheet([['Date','Start','Finish','Break','Absence','Total hours','Notes'],['2026-10-05','09:00','12:00',0,'NA',0.125,'Fictional'],['Pay month total','','','','',0.125,'']]);daily.F2.f='IF(E2<>"NA",0,IF(OR(B2="",C2="",D2=""),0.125,MOD(C2-B2,1)-D2/1440))';daily.F3.f='SUM(F2:F2)';
  const weekly=XLSX.utils.aoa_to_sheet([['Week Start','Week End','Total hours'],['2026-09-21','2026-09-27',0],['2026-09-28','2026-10-04',0],['2026-10-05','2026-10-11',0.125],['2026-10-12','2026-10-18',0],['Month total','',0.125]]);for(let n=2;n<=5;n++)weekly['C'+n].f=`SUMIFS('Daily Entries'!$F$2:$F$2,'Daily Entries'!$A$2:$A$2,">="&A${n},'Daily Entries'!$A$2:$A$2,"<="&B${n})`;weekly.C6.f='SUM(C2:C5)';XLSX.utils.book_append_sheet(book,daily,'Daily Entries');XLSX.utils.book_append_sheet(book,weekly,'Weekly Totals');const bytes=new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'}));
  Object.assign(env,{SHAREPOINT_SITE_ID:'fictional.sharepoint.com,site,web',SHAREPOINT_DRIVE_ID:'fictional-drive',SHAREPOINT_GRAPH_CLIENT_ID:'fictional-bound-check',SHAREPOINT_GRAPH_CLIENT_SECRET:'fictional'});
  let metadataReads=0,changeVersion=false,changeSource=false;globalThis.fetch=async(url,init={})=>{const target=String(url);if(target.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fictional',expires_in:3600});if(target.endsWith('/content')){if(changeSource)db.prepare('UPDATE timesheet_owner_revisions SET revision=revision+1 WHERE owner_upn=?').run(fixture.employeeUpn);return new Response(bytes)}if(target.includes('/items/')){metadataReads++;return Response.json({id:env.SYNTHETIC_TEST_WORKBOOK_ID,name:fileName,eTag:changeVersion&&metadataReads>1?'v2':'v1',size:bytes.length,parentReference:{driveId:'fictional-drive',id:env.SYNTHETIC_TEST_MONTH_FOLDER_ID},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}})}throw Error('Unexpected fictional provider request')};
  assert.equal((await callback(body,'wrong',undefined,'verify-bound')).status,401);assert.equal((await callback(body,undefined,{...env,SYNTHETIC_TEST_BOUND_HANDOFF_ENABLED:'false'},'verify-bound')).status,403);
  assert.equal((await callback({...body,flowRunId:'fictional-run-2'},undefined,undefined,'verify-bound')).status,409);assert.equal(metadataReads,0,'an unbound run cannot inspect the workbook');
  const verified=await callback(body,undefined,undefined,'verify-bound');assert.equal(verified.status,200,await verified.clone().text());const checked=await verified.json();assert.equal(checked.generation,generation);assert.equal(checked.verified,true);assert.equal(checked.publicationReleased,false);assert.equal(checked.stagingWriterExclusion,'not-established');assert.match(checked.contentSha256,/^[a-f0-9]{64}$/);
  assert.equal(db.prepare('SELECT count(*) n FROM timesheet_publication_completions').get().n,0,'a readback alone must not complete a publication');
  metadataReads=0;changeVersion=true;assert.equal((await callback(body,undefined,undefined,'verify-bound')).status,503,'a provider version change invalidates the readback');
  metadataReads=0;changeVersion=false;changeSource=true;assert.equal((await callback(body,undefined,undefined,'verify-bound')).status,409,'a source change during the provider read invalidates the result');changeSource=false;db.prepare('UPDATE timesheet_owner_revisions SET revision=? WHERE owner_upn=?').run(revision,fixture.employeeUpn);
  const finish={attemptId:claim.attemptId,generation,outcome:'sent'};
  assert.equal((await callback({...finish,attemptId:'44444444-4444-4444-8444-444444444444'},undefined,undefined,'finish-bound')).status,409);
  const sent=await callback(finish,undefined,undefined,'finish-bound');assert.equal(sent.status,200,await sent.clone().text());assert.deepEqual(await sent.json(),{accepted:true,outcome:'sent'});
  assert.equal((await callback(finish,undefined,undefined,'finish-bound')).status,200,'a lost acknowledgement can be reconciled without another send');
  assert.equal((await callback({...finish,outcome:'uncertain'},undefined,undefined,'finish-bound')).status,409);
  assert.equal(db.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(fixture.employeeUpn).revision,revision);
  assert.equal(db.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(fixture.recordId).status,'sent');
  db.prepare('UPDATE timesheet_owner_revisions SET revision=revision+1 WHERE owner_upn=?').run(fixture.employeeUpn);
  assert.equal((await callback(body,undefined,undefined,'read-source')).status,409,'changed source revision stays held');
 }finally{globalThis.fetch=originalFetch;db.close();}
});

test('isolated bound handoff uses one exact fictional generation when no source hold is present',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 // In-memory mechanics fixture only: this explicitly simulates an already
 // resolved hold and is not evidence that a real upload has been reviewed.
 db.exec('DROP TRIGGER timesheet_import_source_hold_insert; DROP TRIGGER timesheet_import_source_hold_update;');
 db.exec("CREATE TABLE synthetic_test_environment(marker TEXT PRIMARY KEY); INSERT INTO synthetic_test_environment VALUES ('gmt-timesheet-portal-e2e-20261116')");
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values)},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}}}),DB={prepare:sql=>wrap(sql)};
 const oid='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
 const env={DB,ENTRA_TENANT_ID:'8b182d6b-6f34-4ca2-84ad-50ca712b5488',ENTRA_AUDIENCES:'01b5a6c6-f6c1-47cb-aebe-67f07f415e4b',ALLOWED_ORIGINS:'http://localhost:4179',SYNTHETIC_TEST_ALLOWED_OID:actor,SYNTHETIC_TEST_SUBJECT_OID:oid,PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',DOCUMENT_IMPORT_SHARED_STORAGE_READY:'false',SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_QUEUE_ENABLED:'true',SYNTHETIC_TEST_BOUND_HANDOFF_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false',SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFPFOELOEM7HDJB2SOQSB3IBWSRN',SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFLBI6XSXPOOSRCIKDR2EUSAR3I5',SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-delivery-key-never-used-in-production'};
 try{
  const {payload,body}=syntheticAttachmentExample(),payloadJson=JSON.stringify(payload);
  db.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,?,'timesheets','pay_month_correction','Queued for Accounts','t','t',?)").run(fixture.recordId,oid,fixture.employeeUpn,fixture.employeeName,payloadJson);
  db.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES (?,'queued','t','t',0,'2000-01-01T00:00:00.000Z')").run(fixture.recordId);
  db.prepare("INSERT INTO private_timesheet_subjects(employee_upn,employee_oid,created_at) VALUES (?,?,'t')").run(fixture.employeeUpn,oid);
  for(const a of body.attachments)db.prepare("INSERT INTO record_attachments VALUES (?,?,?,?,?,?,'t')").run(fixture.recordId,a.fieldName,a.fileName,a.contentType,a.contentBase64,a.sizeBytes);
  const source=body.attachments.find(a=>a.fieldName==='attachment_record').contentBase64,revision=db.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(fixture.employeeUpn).revision;
  db.prepare('INSERT INTO timesheet_queue_source_guards VALUES (?,?,?,?)').run(fixture.recordId,fixture.employeeUpn,revision,source);
  db.prepare('INSERT INTO timesheet_queue_attachment_guards VALUES (?,?)').run(fixture.recordId,JSON.stringify(body.attachments));
  assert.equal(db.prepare('SELECT count(*) n FROM timesheet_import_source_holds').get().n,0);
  const gateway=createSyntheticPortalGateway(),post=(path,value,key=env.TIMESHEET_DELIVERY_CALLBACK_KEY)=>gateway.fetch(new Request('https://isolated.test/api/synthetic-delivery/'+path,{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':key},body:JSON.stringify(value)}),env,{});
  assert.equal((await post('claim-bound',{},'wrong')).status,401);assert.equal((await post('claim-bound',{unexpected:true})).status,400);
  const response=await post('claim-bound',{});assert.equal(response.status,200,await response.clone().text());const claim=await response.json();assert.equal(claim.recordId,fixture.recordId);assert.equal(claim.generation,createHash('sha256').update(Buffer.from(source,'base64')).digest('hex'));assert.equal(claim.sourceBase64,undefined);
  assert.equal((await post('claim-bound',{})).status,409);assert.equal(db.prepare('SELECT count(*) n FROM timesheet_publication_attempts').get().n,1);
  const run={attemptId:claim.attemptId,generation:claim.generation,flowRunId:'fictional-flow-run'};
  assert.equal((await post('read-source',run)).status,409);assert.equal((await post('bind-run',run)).status,200);const read=await post('read-source',run);assert.equal(read.status,200);assert.equal((await read.json()).sourceBase64,source);
  assert.equal((await post('finish',{generation:claim.generation,outcome:'sent'})).status,403);assert.equal((await post('finish-bound',{attemptId:claim.attemptId,generation:claim.generation,outcome:'sent'})).status,200);
  const legacyReceipt=await gateway.fetch(new Request('https://isolated.test/api/integrations/timesheet-delivery-receipts',{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':env.TIMESHEET_DELIVERY_CALLBACK_KEY},body:'{}'}),env,{});assert.equal(legacyReceipt.status,403,'legacy receipts cannot complete a bound attempt');
  assert.equal(db.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(fixture.employeeUpn).revision,revision);
 }finally{db.close()}
});
