import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../cloudflare-worker/src/index.js';
import payPeriods from '../pay-periods.js';
const tenant='cfed39ec-21cf-446c-be9f-c932923a123b',audience='b14e2daa-b4ed-4a52-823a-e3c5e89b19bd';
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='reviewed-detail-test';jwk.use='sig';
const b64=x=>Buffer.from(x).toString('base64url');
async function token(oid,upn){const unsigned=b64(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud:audience,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid,preferred_username:upn,name:'Fictional'}));return unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));}
const employee=await token('subject-oid','person@example.test'), editor=await token('old-editor','accounts@example.test'), other=await token('other-oid','other@example.test');
const realFetch=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('/discovery/v2.0/keys')?Response.json({keys:[jwk]}):new Response('',{status:404});
function fixture({review=true,inject=null,status='Submitted',action='pay_month_correction',recordDate=''}={}){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
  db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,record_date,submitted_at,updated_at,payload_json) VALUES('r1','old-editor','accounts@example.test','Fictional Person','timesheets',?,?,?,'t','t','{"days":[1]}')`).run(action,status,recordDate);
  let id;if(review)id=db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES('r1',1,?,'subject-oid','reviewer-oid','review-1','t')`).run('a'.repeat(64)).lastInsertRowid;
  let pending=inject;
  const applyInjection=statement=>{if(pending && statement.includes('timesheet_ownership_reviews')){const fn=pending;pending=null;fn(db,id)}};
  const wrap=(statement,args=[])=>({async first(){applyInjection(statement);return db.prepare(statement).get(...args)||null},async all(){applyInjection(statement);return {results:db.prepare(statement).all(...args)}},async run(){applyInjection(statement);const before=db.prepare('SELECT total_changes() AS n').get().n;db.prepare(statement).run(...args);return {meta:{changes:db.prepare('SELECT total_changes() AS n').get().n-before}}}});
  const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());db.exec('COMMIT');return out}catch(error){db.exec('ROLLBACK');throw error}}};
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:audience};
  return {db,id,request:(auth,path='/api/records/r1',method='GET',body)=>worker.fetch(new Request('https://example.test'+path,{method,headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{})};
}
test('the reviewed subject can see only the current reviewed record, read-only',async()=>{
  const f=fixture();const response=await f.request(employee);assert.equal(response.status,200);const body=await response.json();
  assert.deepEqual(body.payload,{days:[1]});assert.equal(body.record.can_edit,false);assert.equal(body.record.can_edit_record,false);
  assert.equal((await f.request(other)).status,403);assert.equal((await f.request(editor)).status,403);f.db.close();
});
test('without a review the mismatched subject cannot view the record',async()=>{const f=fixture({review:false});assert.equal((await f.request(employee)).status,403);f.db.close()});
test('an unreviewed correction requires both the original subject ID and address',async()=>{
  const f=fixture({review:false});
  f.db.prepare("UPDATE records SET owner_upn='person@example.test' WHERE record_id='r1'").run();
  assert.equal((await f.request(employee)).status,403,'an address match alone must not grant the earlier editor record');
  f.db.prepare("UPDATE records SET owner_oid='subject-oid' WHERE record_id='r1'").run();
  assert.equal((await f.request(employee)).status,200,'an unchanged matching subject can still read its own record');
  f.db.prepare("INSERT INTO profile_settings(owner_oid,owner_upn,display_name,updated_at) VALUES('older-oid','person@example.test','Person','t')").run();
  assert.equal((await f.request(employee)).status,403,'a conflicting historical subject holds the unreviewed correction');
  f.db.close();
});
test('an address match alone cannot delete another subject’s unreviewed correction',async()=>{
  const f=fixture({review:false,status:'Draft'});
  f.db.prepare("UPDATE records SET owner_upn='person@example.test' WHERE record_id='r1'").run();
  const response=await f.request(employee,'/api/records/r1','DELETE');
  assert.equal(response.status,403,'a matching sign-in without the saved subject must not authorise deletion');
  assert.equal(f.db.prepare("SELECT status FROM records WHERE record_id='r1'").get().status,'Draft');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,0);
  f.db.close();
});
test('an address match alone cannot queue another subject’s unreviewed correction',async()=>{
  const f=fixture({review:false,status:'Draft'});
  f.db.prepare("UPDATE records SET owner_upn='person@example.test' WHERE record_id='r1'").run();
  const response=await f.request(employee,'/api/records/r1/attachments','POST',{attachments:[]});
  assert.equal(response.status,403);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_attachments').get().n,0);
  f.db.close();
});
test('an address match alone cannot overwrite another subject’s current correction',async()=>{
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const payMonth=payPeriods.payMonthKeyForDate(date),payload={payMonth,rows:[],deletedDays:[]};
  const f=fixture({review:false,status:'Draft'});
  f.db.prepare("UPDATE records SET owner_upn='person@example.test',payload_json=? WHERE record_id='r1'").run(JSON.stringify(payload));
  const response=await f.request(employee,'/api/records','POST',{recordId:'r1',kind:'timesheets',action:'pay_month_correction',payload,baseCorrectionExists:true,baseCorrectionUpdatedAt:'t',baseOwnerRevision:0});
  assert.equal(response.status,403);
  assert.equal(f.db.prepare("SELECT payload_json FROM records WHERE record_id='r1'").get().payload_json,JSON.stringify(payload));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,0);
  f.db.close();
});
test('a matching account ID and address may delete its own unreviewed draft correction',async()=>{
  const f=fixture({review:false,status:'Draft'});
  f.db.prepare("UPDATE records SET owner_oid='subject-oid',owner_upn='person@example.test' WHERE record_id='r1'").run();
  const response=await f.request(employee,'/api/records/r1','DELETE');
  assert.equal(response.status,200);
  assert.equal(f.db.prepare("SELECT status FROM records WHERE record_id='r1'").get().status,'Deleted');
  f.db.close();
});
test('revoked or changed review never restores access to the original editor',async()=>{
  for(const change of ['revoke','update']){const f=fixture();
    if(change==='revoke')f.db.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked','reviewer-oid','t')").run(f.id);
    else f.db.prepare("UPDATE records SET payload_json='{}' WHERE record_id='r1'").run();
    assert.equal((await f.request(employee)).status,403,change);assert.equal((await f.request(editor)).status,403,change);f.db.close();}
});
test('revocation racing the record read is checked in the same database query',async()=>{
  const f=fixture({inject:(db,id)=>db.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked','reviewer-oid','t')").run(id)});
  assert.equal((await f.request(employee)).status,403);f.db.close();
});
test('the employee history lists the exact reviewed current record as read-only',async()=>{
  const f=fixture();
  for(const path of ['/api/history?kind=timesheets','/api/history']){
    const response=await f.request(employee,path);assert.equal(response.status,200,path);
    const body=await response.json(),row=body.records.find(x=>x.source_record_id==='r1');
    assert.ok(row,path);assert.equal(row.can_edit,false);assert.equal(row.can_edit_record,false);
    for(const auth of [other,editor]){const result=await f.request(auth,path);assert.equal(result.status,200);assert.ok(!(await result.json()).records.some(x=>x.source_record_id==='r1'));}
  }
  f.db.close();
});
test('a conflicting historical identity does not release unrelated rows or hide the reviewed record',async()=>{
  const f=fixture();
  f.db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('conflict','older-oid','person@example.test','Old Person','timesheets','submission','Submitted','t','t','{"old":true}')`).run();
  const response=await f.request(employee,'/api/history?kind=timesheets');assert.equal(response.status,200);
  const body=await response.json();assert.ok(body.records.some(x=>x.source_record_id==='r1'));assert.ok(!body.records.some(x=>x.source_record_id==='conflict'));
  assert.equal(body.meta.timesheet_identity_review_required,true);f.db.close();
});
test('revocation racing a history query prevents the reviewed record from appearing',async()=>{
  const f=fixture({inject:(db,id)=>db.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked','reviewer-oid','t')").run(id)});
  const response=await f.request(employee,'/api/history?kind=timesheets');assert.equal(response.status,200);assert.ok(!(await response.json()).records.some(x=>x.source_record_id==='r1'));f.db.close();
});
test('a former editor cannot delete a reviewed draft even when the old owner fields match',async()=>{
  const f=fixture({status:'Draft'});const response=await f.request(editor,'/api/records/r1','DELETE');
  assert.equal(response.status,409);assert.equal(f.db.prepare("SELECT status FROM records WHERE record_id='r1'").get().status,'Draft');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,0);f.db.close();
});
test('the same deletion hold covers a reviewed ordinary timesheet',async()=>{
  const f=fixture({status:'Draft',action:'submission'});const response=await f.request(editor,'/api/records/r1','DELETE');
  assert.equal(response.status,409);assert.equal(f.db.prepare("SELECT status FROM records WHERE record_id='r1'").get().status,'Draft');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,0);f.db.close();
});
test('a review adopted while a deletion is pending prevents deletion and a false version',async()=>{
  const f=fixture({review:false,status:'Draft',inject:db=>db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
    VALUES('r1',1,?,'subject-oid','reviewer-oid','review-1','t')`).run('a'.repeat(64))});
  const response=await f.request(editor,'/api/records/r1','DELETE');assert.equal(response.status,409);
  assert.equal(f.db.prepare("SELECT status FROM records WHERE record_id='r1'").get().status,'Draft');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,0);f.db.close();
});
test('the former editor cannot modify a reviewed ordinary timesheet',async()=>{
  const date=new Date().toISOString().slice(0,10),f=fixture({action:'submission',recordDate:date});
  const response=await f.request(editor,'/api/records/r1','PATCH',{kind:'timesheets',action:'submission',recordDate:date,payload:{rows:[{date,note:'changed'}]}});
  assert.equal(response.status,409);assert.equal(f.db.prepare("SELECT payload_json FROM records WHERE record_id='r1'").get().payload_json,'{"days":[1]}');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,0);f.db.close();
});
test('an unreviewed owner edit preserves the previous version atomically',async()=>{
  const date=new Date().toISOString().slice(0,10),f=fixture({review:false,action:'submission',recordDate:date});
  const response=await f.request(editor,'/api/records/r1','PATCH',{kind:'timesheets',action:'submission',recordDate:date,payload:{rows:[{date,note:'changed'}]}});
  assert.equal(response.status,200);assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,1);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT payload_json FROM record_versions').get().payload_json).payload,{days:[1]});f.db.close();
});
test('a review adopted while an edit is pending prevents the edit and false version',async()=>{
  const date=new Date().toISOString().slice(0,10),f=fixture({review:false,action:'submission',recordDate:date,inject:db=>db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
    VALUES('r1',1,?,'subject-oid','reviewer-oid','review-1','t')`).run('a'.repeat(64))});
  const response=await f.request(editor,'/api/records/r1','PATCH',{kind:'timesheets',action:'submission',recordDate:date,payload:{rows:[{date,note:'changed'}]}});
  assert.equal(response.status,409);assert.equal(f.db.prepare('SELECT count(*) AS n FROM record_versions').get().n,0);
  assert.equal(f.db.prepare("SELECT payload_json FROM records WHERE record_id='r1'").get().payload_json,'{"days":[1]}');f.db.close();
});
process.on('exit',()=>{globalThis.fetch=realFetch});
