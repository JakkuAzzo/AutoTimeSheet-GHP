import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as worker from '../cloudflare-worker/src/index.js';
import {syntheticFixture} from '../cloudflare-worker/src/synthetic-portal-fixture.js';
import {seedAttachmentGuards} from './helpers/seed-attachment-guards.mjs';

assert.equal(typeof worker.resolvePrivateTimesheetRoute, 'function', 'the trusted route resolver is available');

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE records(record_id TEXT PRIMARY KEY, owner_upn TEXT, employee_name TEXT, kind TEXT, action TEXT, status TEXT, payload_json TEXT,owner_oid TEXT,updated_at TEXT);
CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY, status TEXT, attempts INTEGER,updated_at TEXT);
CREATE TABLE record_attachments(record_id TEXT, field_name TEXT, content_base64 TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER);
CREATE TABLE pay_month_start_settings(month_key TEXT, start_date TEXT);
CREATE TABLE timesheet_queue_source_guards(record_id TEXT,owner_upn TEXT,owner_revision INTEGER,source_base64 TEXT);
CREATE TABLE timesheet_queue_attachment_guards(record_id TEXT PRIMARY KEY,manifest_json TEXT);
CREATE TABLE timesheet_owner_revisions(owner_upn TEXT,revision INTEGER);
CREATE TABLE timesheet_ownership_reviews(record_id TEXT,subject_oid TEXT);`);
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0022_private_timesheet_workbooks.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0021_private_timesheet_folders.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0024_private_timesheet_subjects.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0023_timesheet_delivery_routes.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0017_timesheet_delivery_receipts.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0041_timesheet_source_publication_guard.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0044_timesheet_writer_candidate_exclusion.sql',import.meta.url),'utf8'));
const DB = { prepare(sql) { const make = (args = []) => ({bind(...values) { return make(values); }, first() { return db.prepare(sql).get(...args) || null; }, all() { return {results: db.prepare(sql).all(...args)}; },run(){return {meta:db.prepare(sql).run(...args)}}}); return make(); } };
const id = 'synthetic-route-test', upn = 'employee@example.test', editedAt = '2026-10-26T10:00:00.000Z';
const payload = {payMonth: '2026-10', editedAt};
const source = {schemaVersion: 2, mode:'replace-pay-month', recordId:id, employeeName:'Example', employeeUpn:upn, payMonth:payload.payMonth, cycleStart:'2026-09-21',cycleEnd:'2026-10-18', submittedAt:editedAt, rows:[{recordId:`${id}|2026-10-01`,date:'2026-10-01',startTime:'09:00',finishTime:'12:00',breakMinutes:0,note:'Fictional café test note'}]};
const encoded = Buffer.from(JSON.stringify(source)).toString('base64');
const generation = createHash('sha256').update(JSON.stringify(source)).digest('hex');
db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?,?,?)').run(id,upn,'Example','timesheets','pay_month_correction','Queued for Accounts',JSON.stringify(payload),'employee-oid',editedAt);
db.prepare('INSERT INTO dispatch_queue VALUES (?, ?, ?,?)').run(id,'sending',1,editedAt);
for(const [field,name,type,data] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','eA=='],['attachment_csv','a.csv','text/csv','eA=='],['attachment_record','a.json','application/json',encoded]])db.prepare('INSERT INTO record_attachments VALUES(?,?,?,?,?,?)').run(id,field,data,name,type,1);
db.prepare('INSERT INTO timesheet_owner_revisions VALUES (?,1)').run(upn);
const seedProof=()=>{const value=db.prepare("SELECT content_base64 FROM record_attachments WHERE record_id=? AND field_name='attachment_record'").get(id).content_base64;db.prepare('DELETE FROM timesheet_queue_source_guards').run();db.prepare('INSERT INTO timesheet_queue_source_guards VALUES(?,?,1,?)').run(id,upn,value);seedAttachmentGuards(db)};
seedProof();
let checks = 0;
const options = {privateDestinationCheck: async (_env, row) => { checks++; assert.equal(row.owner_upn,upn); return {id:'verified-folder-id',employeeId:'0244eee3-2f7f-4d41-a6e9-af4a5a07fbd2',employeeUpn:upn}; },
  workbookCheck: async (_env, folder, row, month) => {assert.equal(folder.id,'verified-folder-id');assert.equal(row.employee_name,'Example');assert.equal(month,'2026-10');return {folderId:'verified-month-folder',workbookId:'verified-workbook'};}};
const request = {recordId:id,generation,flowRunId:'synthetic-route-run',runStartedAt:editedAt};
const apiRequest = (body,key='wrong') => new Request('https://gmt-portal-api.test/api/integrations/private-timesheet-route',{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':key},body:JSON.stringify(body)});
const apiEnv = {DB,TIMESHEET_DELIVERY_CALLBACK_KEY:'synthetic-route-key-only-not-a-production-secret',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true'};
assert.equal((await worker.default.fetch(apiRequest(request),{...apiEnv,TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'false'},{})).status,503,'the endpoint is off by default');
assert.equal((await worker.default.fetch(apiRequest(request),apiEnv,{})).status,401,'the endpoint rejects an invalid delivery key');
assert.equal((await worker.default.fetch(apiRequest({...request,folderId:'attacker-choice'},apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),apiEnv,{})).status,400,'the caller cannot choose a folder');
assert.equal((await worker.default.fetch(apiRequest({...request,sourceBase64:Buffer.from('{"rows":[]}').toString('base64')},apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),apiEnv,{})).status,400,'the caller cannot supply a replacement source');
let routeReads=0;const heldEnv={...apiEnv,DB:{prepare(){routeReads++;throw new Error('held delivery must not read a destination')}},DISPATCH_ENABLED:'true',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true'};
assert.equal((await worker.default.fetch(apiRequest(request,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),heldEnv,{})).status,503,'an already-started real flow cannot resolve a workbook while source and concurrency review remain incomplete');
assert.equal(routeReads,0,'held routing must stop before any source or destination lookup');
let fixtureReads=0;const fixtureDB={prepare(){fixtureReads++;return {bind(){return {async first(){return null}}}}}};
const fixtureEnv={...apiEnv,DB:fixtureDB,SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false'};
const fixtureRequest={...request,recordId:syntheticFixture.recordId};
assert.equal((await worker.default.fetch(apiRequest(fixtureRequest,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),fixtureEnv,{})).status,409,'the fixed fictional fixture is admitted to normal route verification');
assert.equal(fixtureReads,1);
fixtureReads=0;
assert.equal((await worker.default.fetch(apiRequest(fixtureRequest,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),{...fixtureEnv,TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true'},{})).status,503,'a fictional route cannot create a workbook');
assert.equal(fixtureReads,0);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},request,{...options,workbookCheck:async()=>{
 db.prepare("INSERT INTO timesheet_publication_candidates(subject_oid,pay_month,revision,generation,drive_id,item_id,etag) VALUES ('fictional-subject','2026-10',1,?,'fictional-drive','fictional-sealed','v1')").run(generation);
 return {folderId:'verified-month-folder',workbookId:'fictional-sealed'};
}}),e=>e.status===409,'a candidate created while the resolver is checking the provider cannot be routed to the old writer');
assert.equal(db.prepare("SELECT count(*) AS n FROM timesheet_delivery_routes WHERE workbook_id='fictional-sealed'").get().n,0);
checks=0;
assert.deepEqual(await worker.resolvePrivateTimesheetRoute({DB},request,options), {employeeFolderId:'verified-folder-id',folderId:'verified-month-folder',workbookId:'verified-workbook',payMonth:'2026-10',generation,sourceBase64:encoded}, 'the route returns the exact generation-verified source for the workbook, including hours and notes');
assert.equal(checks,1);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},{...request,generation:'0'.repeat(64)},options), e=>e.status===409);
assert.equal(checks,1,'stale generations never reach the provider');
const wrongBounds={...source,cycleEnd:'2026-10-25'};
db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(Buffer.from(JSON.stringify(wrongBounds)).toString('base64'),id);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},{...request,generation:createHash('sha256').update(JSON.stringify(wrongBounds)).digest('hex')},options),e=>e.status===409);
assert.equal(checks,1,'source cycle bounds must match the configured pay period before accessing the provider');
db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(encoded,id);
db.prepare("UPDATE records SET employee_name='Different Employee' WHERE record_id=?").run(id);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},request,options),e=>e.status===409);
assert.equal(checks,1,'the source employee name must match the protected record');
db.prepare("UPDATE records SET employee_name='Example' WHERE record_id=?").run(id);
db.prepare("UPDATE records SET owner_upn = 'other@example.test' WHERE record_id = ?").run(id);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},request,options), e=>e.status===409);
assert.equal(checks,1,'a source with a different saved owner never reaches the provider');
db.prepare('UPDATE records SET owner_upn = ? WHERE record_id = ?').run(upn,id);
const wrongMonth={...source,rows:[{recordId:`${id}|2026-11-30`,date:'2026-11-30'}]};
const wrongEncoded=Buffer.from(JSON.stringify(wrongMonth)).toString('base64');
db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(wrongEncoded,id);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},{...request,generation:createHash('sha256').update(JSON.stringify(wrongMonth)).digest('hex')},options), e=>e.status===409);
assert.equal(checks,1,'a date outside the selected pay cycle never reaches the provider');
db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(encoded,id);
db.prepare("UPDATE dispatch_queue SET status = 'queued' WHERE record_id = ?").run(id);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},request,options), e=>e.status===409);
assert.equal(checks,1,'unsent records never reach the provider');
db.prepare("UPDATE dispatch_queue SET status = 'sending' WHERE record_id = ?").run(id);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},request,{privateDestinationCheck:async()=>{throw new Error('unverified permissions');}}), /unverified permissions/);
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},request,{...options,workbookCheck:async()=>{
  db.prepare("INSERT INTO pay_month_start_settings VALUES ('2026-11','2026-10-26')").run();
  return {folderId:'verified-month-folder',workbookId:'verified-workbook'};
}}),e=>e.status===409,'a pay-period change during verification holds the route');
db.prepare('DELETE FROM pay_month_start_settings').run();
const extended={...source,cycleEnd:'2026-10-25',rows:[{recordId:`${id}|2026-10-24`,date:'2026-10-24'}]};
const extendedGeneration=createHash('sha256').update(JSON.stringify(extended)).digest('hex');
db.prepare("INSERT INTO pay_month_start_settings VALUES ('2026-11','2026-10-26')").run();
db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(Buffer.from(JSON.stringify(extended)).toString('base64'),id);
seedProof();
assert.equal((await worker.resolvePrivateTimesheetRoute({DB},{...request,generation:extendedGeneration,flowRunId:'synthetic-extended-run'},options)).workbookId,'verified-workbook',
  'a configured five-week pay period routes its final Saturday to the correct workbook');
db.prepare('DELETE FROM pay_month_start_settings').run();
db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(encoded,id);
seedProof();
await assert.rejects(worker.resolvePrivateTimesheetRoute({DB},request,{privateDestinationCheck:async()=>{ db.prepare("UPDATE dispatch_queue SET status='queued' WHERE record_id=?").run(id); return {id:'verified-folder-id'}; },workbookCheck:options.workbookCheck}), e=>e.status===409);
db.prepare("UPDATE dispatch_queue SET status='sending' WHERE record_id=?").run(id);
const admin='e0d972cd-46ed-4930-a9c6-51db65474f1f', employee='0244eee3-2f7f-4d41-a6e9-af4a5a07fbd2', owner='b89b71c6-ba9a-4712-bf29-57f50d1c2969';
db.prepare('INSERT INTO private_timesheet_folders VALUES (?,?,?,?)').run(employee,'verified-folder-id',admin,'2026-10-26T10:00:00.000Z');
const originalFetch=globalThis.fetch;
let parentBroad=false,parentIdReads=0,directoryId=employee,sharePointReads=0,missingFolder=false,providerWrites=0;
globalThis.fetch=async (url,init={})=>{
  if (init.method && init.method!=='GET' && !String(url).includes('oauth2/v2.0/token')) {providerWrites++;return new Response('{}',{status:500});}
  const send=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  if(String(url).includes('oauth2/v2.0/token'))return send({access_token:'synthetic',expires_in:3600});
  if(String(url).includes('/users/'))return send({id:directoryId,userPrincipalName:upn});
  sharePointReads++;
  if(String(url).endsWith('/items/verified-parent')){parentIdReads++;return send({id:'verified-parent',folder:{}})}
  if(missingFolder&&String(url).includes('/items/verified-parent:/'+employee))return new Response('{}',{status:404});
  if(String(url).endsWith('/root:/Submitted%20Documents/Timesheets'))return send({id:'verified-parent',folder:{}});
  if(String(url).endsWith('/permissions'))return send({value:[
    {roles:['write'],grantedToV2:{group:{id:admin}}},
    ...(!String(url).includes('/items/verified-parent/')||parentBroad?[{roles:['write'],grantedToV2:{user:{id:employee}}}]:[]),
    {roles:['owner'],grantedToV2:{group:{id:owner}}}
  ]});
  if(String(url).includes('/items/verified-folder-id:/2026-10'))return send({id:'verified-month-folder',name:'2026-10',folder:{},parentReference:{id:'verified-folder-id'}});
  if(String(url).includes('/items/verified-month-folder:/'))return send({id:'verified-workbook',name:'GMT Timesheet - Example - Pay Month 2026-10.xlsx',file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},parentReference:{id:'verified-month-folder'}});
  return send({id:'verified-folder-id',folder:{childCount:0},parentReference:{id:'verified-parent'}});
};
// The public route intentionally holds real deliveries. Exercise the underlying
// resolver against a mocked provider separately so its destination checks
// remain covered while the public release gate is closed.
async function providerResponse(request,env){
  try{return Response.json(await worker.resolvePrivateTimesheetRoute(env,await request.json()))}
  catch(error){return Response.json({error:'held'},{status:error.status||503})}
}
try {
  const response=await providerResponse(apiRequest(request,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),{...apiEnv,ENTRA_TENANT_ID:'synthetic-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'synthetic-app',SHAREPOINT_GRAPH_CLIENT_SECRET:'synthetic-only',SHAREPOINT_SITE_ID:'synthetic-site',SHAREPOINT_DRIVE_ID:'synthetic-drive',PRIVATE_TIMESHEET_ADMIN_GROUP_ID:admin,PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID:owner},{});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{employeeFolderId:'verified-folder-id',folderId:'verified-month-folder',workbookId:'verified-workbook',payMonth:'2026-10',generation,sourceBase64:encoded});
  assert.equal(db.prepare('SELECT employee_oid FROM private_timesheet_subjects WHERE employee_upn=?').get(upn).employee_oid,employee);
  assert.throws(()=>db.prepare('UPDATE private_timesheet_subjects SET employee_oid=? WHERE employee_upn=?').run('9b2296bc-4b45-4aae-b4dc-1d422c0aec55',upn),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM private_timesheet_subjects WHERE employee_upn=?').run(upn),/immutable/);
  directoryId='9b2296bc-4b45-4aae-b4dc-1d422c0aec55';
  sharePointReads=0;
  const changedIdentity=await providerResponse(apiRequest(request,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),{...apiEnv,ENTRA_TENANT_ID:'synthetic-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'synthetic-app',SHAREPOINT_GRAPH_CLIENT_SECRET:'synthetic-only',SHAREPOINT_SITE_ID:'synthetic-site',SHAREPOINT_DRIVE_ID:'synthetic-drive',PRIVATE_TIMESHEET_ADMIN_GROUP_ID:admin,PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID:owner},{});
  assert.equal(changedIdentity.status,503,'a reused employee address must not silently target a different account');
  assert.equal(sharePointReads,0,'identity reassignment is held before reading or creating any employee folder');
  directoryId=employee;
  const pinned=await providerResponse(apiRequest(request,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),{...apiEnv,ENTRA_TENANT_ID:'synthetic-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'synthetic-app',SHAREPOINT_GRAPH_CLIENT_SECRET:'synthetic-only',SHAREPOINT_SITE_ID:'synthetic-site',SHAREPOINT_DRIVE_ID:'synthetic-drive',PRIVATE_TIMESHEET_PARENT_ID:'verified-parent',PRIVATE_TIMESHEET_ADMIN_GROUP_ID:admin,PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID:owner},{});
  assert.equal(pinned.status,200);assert.ok(parentIdReads>0,'a configured isolated parent is addressed by immutable item ID');
  const wrongWorkbook=await providerResponse(apiRequest(request,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),{...apiEnv,ENTRA_TENANT_ID:'synthetic-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'synthetic-app',SHAREPOINT_GRAPH_CLIENT_SECRET:'synthetic-only',SHAREPOINT_SITE_ID:'synthetic-site',SHAREPOINT_DRIVE_ID:'synthetic-drive',PRIVATE_TIMESHEET_PARENT_ID:'verified-parent',PRIVATE_TIMESHEET_ADMIN_GROUP_ID:admin,PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID:owner,SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'verified-folder-id',SYNTHETIC_TEST_MONTH_FOLDER_ID:'verified-month-folder',SYNTHETIC_TEST_WORKBOOK_ID:'another-workbook'},{});
  assert.equal(wrongWorkbook.status,409,'a replacement workbook with the same name cannot become the test destination');
  missingFolder=true;providerWrites=0;
  const missing=await providerResponse(apiRequest(request,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),{...apiEnv,ENTRA_TENANT_ID:'synthetic-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'synthetic-app',SHAREPOINT_GRAPH_CLIENT_SECRET:'synthetic-only',SHAREPOINT_SITE_ID:'synthetic-site',SHAREPOINT_DRIVE_ID:'synthetic-drive',PRIVATE_TIMESHEET_PARENT_ID:'verified-parent',PRIVATE_TIMESHEET_ADMIN_GROUP_ID:admin,PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID:owner,SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true'},{});
  assert.equal(missing.status,503,'a missing test folder must stop the route');
  assert.equal(providerWrites,0,'a read-only test route must not create folders or change permissions');
  missingFolder=false;
  parentBroad=true;
  assert.equal((await providerResponse(apiRequest(request,apiEnv.TIMESHEET_DELIVERY_CALLBACK_KEY),{...apiEnv,ENTRA_TENANT_ID:'synthetic-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'synthetic-app',SHAREPOINT_GRAPH_CLIENT_SECRET:'synthetic-only',SHAREPOINT_SITE_ID:'synthetic-site',SHAREPOINT_DRIVE_ID:'synthetic-drive',PRIVATE_TIMESHEET_ADMIN_GROUP_ID:admin,PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID:owner},{})).status,503,'a broadly accessible parent blocks routing');
} finally { globalThis.fetch=originalFetch; }
let createdMonth=false,createdBook=false,uploaded=null,providerBytes=null,writeCount=0;
const provisionId='synthetic-provision-test',provisionSource={...source,recordId:provisionId,rows:[{recordId:`${provisionId}|2026-10-01`,date:'2026-10-01'}]};
const provisionGeneration=createHash('sha256').update(JSON.stringify(provisionSource)).digest('hex');
db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?,?,?)').run(provisionId,upn,'Example','timesheets','pay_month_correction','Queued for Accounts',JSON.stringify(payload),'employee-oid',editedAt);
db.prepare('INSERT INTO dispatch_queue VALUES (?, ?, ?,?)').run(provisionId,'sending',1,editedAt);
const provisionEncoded=Buffer.from(JSON.stringify(provisionSource)).toString('base64');
for(const [field,name,type,data] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','eA=='],['attachment_csv','a.csv','text/csv','eA=='],['attachment_record','a.json','application/json',provisionEncoded]])db.prepare('INSERT INTO record_attachments VALUES(?,?,?,?,?,?)').run(provisionId,field,data,name,type,1);
db.prepare('INSERT INTO timesheet_queue_source_guards VALUES(?,?,1,?)').run(provisionId,upn,provisionEncoded);seedAttachmentGuards(db);
const provisionRequest={recordId:provisionId,generation:provisionGeneration,flowRunId:'synthetic-provision-run',runStartedAt:editedAt};
const uploadUrl='https://synthetic-upload.example.test/session';
globalThis.fetch=async (url,init={})=>{
  const address=String(url),method=init.method||'GET',send=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(address.includes('oauth2/v2.0/token'))return send({access_token:'synthetic-create',expires_in:3600});
  if(address.includes('/users/'))return send({id:employee,userPrincipalName:upn});
  if(address.endsWith('/root:/Submitted%20Documents/Timesheets'))return send({id:'verified-parent',folder:{}});
  if(address.endsWith('/permissions'))return send({value:[{roles:['write'],grantedToV2:{group:{id:admin}}},...(!address.includes('/items/verified-parent/')?[{roles:['write'],grantedToV2:{user:{id:employee}}}]:[]),{roles:['owner'],grantedToV2:{group:{id:owner}}}]});
  if(address===uploadUrl){assert.equal(method,'PUT');writeCount++;uploaded=Buffer.from(init.body);providerBytes=Buffer.concat([uploaded,Buffer.from('provider-metadata')]);createdBook=true;return send({id:'created-workbook',eTag:'"upload-version"'},201)}
  if(address.includes('/items/verified-folder-id/children')){assert.equal(method,'POST');writeCount++;createdMonth=true;return send({id:'created-month'},201)}
  if(address.includes('/createUploadSession')){assert.equal(method,'POST');writeCount++;return send({uploadUrl})}
  if(address.includes('/items/created-workbook/content'))return new Response(providerBytes);
  if(address.endsWith('/items/created-workbook'))return send({id:'created-workbook',eTag:'"upload-version"',file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},size:providerBytes.length});
  if(address.includes('/items/verified-folder-id:/2026-10'))return createdMonth?send({id:'created-month',name:'2026-10',folder:{},parentReference:{id:'verified-folder-id'}}):new Response('',{status:404});
  if(address.includes('/items/created-month:/'))return createdBook?send({id:'created-workbook',name:'GMT Timesheet - Example - Pay Month 2026-10.xlsx',file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},parentReference:{id:'created-month'}}):new Response('',{status:404});
  return send({id:'verified-folder-id',folder:{childCount:0},parentReference:{id:'verified-parent'}});
};
try {
  const env={...apiEnv,TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',ENTRA_TENANT_ID:'synthetic-create-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'synthetic-create-app',SHAREPOINT_GRAPH_CLIENT_SECRET:'synthetic-only',SHAREPOINT_SITE_ID:'synthetic-create-site',SHAREPOINT_DRIVE_ID:'synthetic-create-drive',PRIVATE_TIMESHEET_ADMIN_GROUP_ID:admin,PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID:owner};
  const response=await providerResponse(apiRequest(provisionRequest,env.TIMESHEET_DELIVERY_CALLBACK_KEY),env,{});
  assert.equal(response.status,200,'the resolver creates a blank workbook in the verified private folder');
  assert.equal((await response.json()).workbookId,'created-workbook');
  assert.equal(writeCount,3);
  const again=await providerResponse(apiRequest(provisionRequest,env.TIMESHEET_DELIVERY_CALLBACK_KEY),env,{});
  assert.equal(again.status,200);
  assert.equal(writeCount,3,'retries reuse the marked workbook without another provider write');
} finally {globalThis.fetch=originalFetch;}
console.log('PASS: a private route is derived from the current dispatched generation and trusted destination');
