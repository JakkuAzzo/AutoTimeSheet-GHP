import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const worker=(await import(process.env.GMT_OWNERSHIP_TEST_WORKER || '../cloudflare-worker/src/index.js')).default;

const tenant='a7c20f5b-e3a8-4a89-8577-b3def40a2691', audience='89cc3daf-695d-43dc-bd49-54d699fb22c4';
const reviewer='9bcbfba9-0a68-439f-a3c8-651fdc26728a', subject='db9f99d4-7980-4f1d-927a-875221d4320a';
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='ownership-review-test';jwk.use='sig';
const b64=x=>Buffer.from(x).toString('base64url');
async function token(oid,upn){const unsigned=b64(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud:audience,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid,preferred_username:upn,name:'Test user'}));return unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));}
const adminToken=await token(reviewer,'reviewer@example.test'), otherToken=await token(subject,'employee@example.test');
const originalFetch=globalThis.fetch;
let directory={id:subject,userPrincipalName:'employee@example.test'}, inject=null, directoryStatus=200;
globalThis.fetch=async (url,opts)=>{
  const value=String(url);
  if(value.includes('/discovery/v2.0/keys'))return Response.json({keys:[jwk]});
  if(value.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fictional',expires_in:3600});
  if(value.startsWith('https://graph.microsoft.com/v1.0/users/')){if(inject){const fn=inject;inject=null;fn();}return Response.json({accountEnabled:true,...directory},{status:directoryStatus});}
  throw new Error('Unexpected network request');
};
function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','old-editor','accounts@example.test','Fictional Person','timesheets','pay_month_correction','Submitted','t','t','{"days":[1]}')`).run();
  const wrap=(statement,args=[])=>({async first(){return db.prepare(statement).get(...args)||null},async all(){return {results:db.prepare(statement).all(...args)}},async run(){return {meta:{changes:db.prepare(statement).run(...args).changes}}}});
  const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}}};
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:audience,ADMIN_UPNS:'reviewer@example.test',TIMESHEET_VIEWER_UPNS:'reviewer@example.test',SHAREPOINT_GRAPH_CLIENT_ID:'test-client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fictional',SHAREPOINT_SITE_ID:'site',SHAREPOINT_DRIVE_ID:'drive'};
  const request=(path,method='GET',body,auth=adminToken)=>worker.fetch(new Request('https://example.test'+path,{method,headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  return {db,env,request};
}
const path='/api/admin/timesheet-ownership-review/r1';
async function draft(f){const response=await f.request(path);assert.equal(response.status,200);return response.json()}
function submission(d){return {expectedRevision:d.revision,expectedReviewEventId:d.reviewEventId,payloadSha256:d.payloadSha256,subjectOid:subject,subjectUpn:'employee@example.test',evidenceReference:'review-1'}}

test('review availability and directory lookup require the privileged reviewer',async()=>{
 const f=fixture();directory={id:subject,userPrincipalName:'employee@example.test',displayName:'Fictional Employee',accountEnabled:true};
 const reviewerAccess=await (await f.request('/api/access')).json();assert.equal(reviewerAccess.canReviewTimesheetOwnership,true);
 const employeeAccess=await (await f.request('/api/access','GET',null,otherToken)).json();assert.equal(employeeAccess.canReviewTimesheetOwnership,false);
 const lookup='/api/admin/timesheet-review-subject?upn=employee%40example.test';
 assert.equal((await f.request(lookup,'GET',null,otherToken)).status,403);
 const response=await f.request(lookup);assert.equal(response.status,200);const person=await response.json();
 assert.equal(person.oid,subject);assert.equal(person.upn,'employee@example.test');assert.equal(person.accountEnabled,true);f.db.close();
});
test('only a privileged timesheet reviewer can inspect and adopt an exact current snapshot',async()=>{
  const f=fixture();assert.equal((await f.request(path,'GET',null,otherToken)).status,403);
  const d=await draft(f);assert.equal(d.record.record_id,'r1');assert.equal(d.record.owner_oid,'old-editor');assert.match(d.payloadSha256,/^[a-f0-9]{64}$/);
  assert.equal((await f.request(path,'POST',submission(d),otherToken)).status,403);
  const response=await f.request(path,'POST',submission(d));assert.equal(response.status,201);
  const review=await response.json();assert.equal(review.subjectOid,subject);
  assert.equal(f.db.prepare('SELECT owner_oid FROM records WHERE record_id=?').get('r1').owner_oid,'old-editor');
  const saved=f.db.prepare('SELECT * FROM timesheet_ownership_reviews').get();assert.equal(saved.reviewer_oid,reviewer);assert.equal(saved.payload_sha256,d.payloadSha256);
  assert.equal(f.db.prepare('SELECT event_type FROM timesheet_ownership_review_events').get().event_type,'adopted');f.db.close();
});
test('reviewer can preview other current local history only after the target ownership is reviewed',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;inject=null;
  const f=fixture();try{
    f.db.prepare("UPDATE records SET payload_json=? WHERE record_id='r1'").run(JSON.stringify({payMonth:'2026-10',rows:[{date:'2026-10-07',start:'10:00',finish:'17:00',lunchMinutes:0}]}));
    f.db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,'employee@example.test','Fictional','timesheets','submission','Submitted','t','t',?)`).run('source',subject,JSON.stringify({rows:[{date:'2026-10-05',start:'09:00',finish:'17:00',lunchMinutes:60}]}));
    const previewPath=path+'/local-history?upn=employee%40example.test';
    assert.equal((await f.request(previewPath,'GET',null,otherToken)).status,403);
    assert.equal((await f.request(previewPath)).status,409);
    const d=await draft(f);assert.equal((await f.request(path,'POST',submission(d))).status,201);
    const response=await f.request(previewPath);assert.equal(response.status,200);const body=await response.json();
    assert.equal(body.scope,'other-local-records-only');assert.equal(body.payMonth,'2026-10');assert.deepEqual(body.rows.map(x=>x.Date),['2026-10-05']);assert.equal(body.queuedComparison.status,'missing');
    assert.equal(f.db.prepare('SELECT count(*) n FROM dispatch_queue').get().n,0);
    assert.equal((await f.request(path+'/local-history?upn=other%40example.test')).status,409);
  }finally{f.db.close()}
});
test('reviewer can compare current local dates and the saved correction with the queued structured month',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;inject=null;const f=fixture();try{
    const editedAt='2026-10-12T10:00:00Z';
    f.db.prepare("UPDATE records SET payload_json=? WHERE record_id='r1'").run(JSON.stringify({payMonth:'2026-10',editedAt,editedBy:'Reviewer',rows:[{date:'2026-10-07',start:'10:00',finish:'17:00',lunchMinutes:0}]}));
    for(const [id,date] of [['source-a','2026-10-05'],['source-b','2026-10-06']])f.db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,'employee@example.test','Fictional','timesheets','submission','Submitted','t','t',?)`).run(id,subject,JSON.stringify({rows:[{date,start:'09:00',finish:'17:00',lunchMinutes:60}]}));
    const make=(date,startTime,finishTime,breakMinutes,totalMinutes,changeNote='')=>({recordId:'r1|'+date,date,startTime,finishTime,breakMinutes,absenceReason:'NA',totalMinutes,workedHours:totalMinutes/60,note:'',changeNote});
    const source={schemaVersion:2,mode:'replace-pay-month',recordId:'r1',employeeUpn:'employee@example.test',payMonth:'2026-10',submittedAt:editedAt,rows:[make('2026-10-05','09:00','18:00',60,480),make('2026-10-07','10:00','17:00',0,420,'Edited by Reviewer at '+editedAt),make('2026-10-08','09:00','17:00',60,420)]};
    f.db.prepare(`INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES('r1','attachment_record','test.json','application/json',?,?, 't')`).run(Buffer.from(JSON.stringify(source)).toString('base64'),Buffer.byteLength(JSON.stringify(source)));
    const d=await draft(f);assert.equal((await f.request(path,'POST',submission(d))).status,201);
    const r=await f.request(path+'/local-history?upn=employee%40example.test');assert.equal(r.status,200);let body=await r.json();
    assert.equal(body.queuedComparison.status,'compared');assert.deepEqual(body.queuedComparison.dates.map(x=>[x.date,x.status]),[['2026-10-05','different'],['2026-10-06','only-local'],['2026-10-07','match'],['2026-10-08','only-queued']]);
    assert.deepEqual(body.queuedComparison.dates[0].fields,['Finish','Total hours']);assert.equal(body.queuedComparison.dates[0].local.Finish,'17:00');assert.equal(body.queuedComparison.dates[0].queued.Finish,'18:00');
    source.rows[0].recordId='unrelated-record|2026-10-05';f.db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id='r1' AND field_name='attachment_record'").run(Buffer.from(JSON.stringify(source)).toString('base64'));
    assert.equal((await (await f.request(path+'/local-history?upn=employee%40example.test')).json()).queuedComparison.status,'invalid');
    source.rows[0].recordId='r1|2026-10-05';source.schemaVersion=3;for(const row of source.rows)Object.assign(row,{sourceBasicMinutes:null,sourceOt15Minutes:null,sourceOt20Minutes:null});source.rows[0].sourceOt15Minutes=0;
    f.db.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id='r1' AND field_name='attachment_record'").run(Buffer.from(JSON.stringify(source)).toString('base64'));
    const rate=await (await f.request(path+'/local-history?upn=employee%40example.test')).json();const first=rate.queuedComparison.dates[0];
    assert.equal(rate.queuedComparison.status,'compared');assert.ok(first.fields.includes('Source overtime 1.5× hours'));assert.equal(first.local['Source overtime 1.5× hours'],'');assert.equal(first.queued['Source overtime 1.5× hours'],0);
    for(const [id,start,finish] of [['source-c','08:00','16:00'],['source-d','09:00','17:00']])f.db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,'employee@example.test','Fictional','timesheets','submission','Submitted','t','t',?)`).run(id,subject,JSON.stringify({rows:[{date:'2026-10-07',start,finish,lunchMinutes:0}]}));
    const competing=await (await f.request(path+'/local-history?upn=employee%40example.test')).json();
    assert.equal(competing.conflicts[0].date,'2026-10-07');assert.equal(competing.conflicts[0].candidates.length,2);assert.equal(competing.queuedComparison.dates.find(x=>x.date==='2026-10-07').status,'needs-review');
  }finally{f.db.close()}
});
test('reviewer comparison holds if the queued source changes during the read',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;inject=null;const f=fixture();try{
    f.db.prepare("UPDATE records SET payload_json=? WHERE record_id='r1'").run(JSON.stringify({payMonth:'2026-10',rows:[{date:'2026-10-07',start:'10:00'}]}));
    f.db.prepare(`INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES('r1','attachment_record','test.json','application/json','e30=',2,'t')`).run();
    const d=await draft(f);assert.equal((await f.request(path,'POST',submission(d))).status,201);
    inject=()=>f.db.prepare("UPDATE record_attachments SET content_base64='W10=' WHERE record_id='r1' AND field_name='attachment_record'").run();
    assert.equal((await f.request(path+'/local-history?upn=employee%40example.test')).status,409);
  }finally{inject=null;f.db.close()}
});
test('reviewer history preview holds if the target review is invalidated during directory verification',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;inject=null;const f=fixture();try{
    f.db.prepare("UPDATE records SET payload_json=? WHERE record_id='r1'").run(JSON.stringify({payMonth:'2026-10',rows:[{date:'2026-10-07',start:'10:00'}]}));
    const d=await draft(f);assert.equal((await f.request(path,'POST',submission(d))).status,201);
    inject=()=>f.db.prepare("UPDATE records SET payload_json='{}' WHERE record_id='r1'").run();
    assert.equal((await f.request(path+'/local-history?upn=employee%40example.test')).status,409);
  }finally{inject=null;f.db.close()}
});
test('both administrator and timesheet-viewer roles are required for review',async()=>{
  for(const role of ['admin-only','viewer-only','neither']){
    const f=fixture();
    if(role!=='admin-only')f.env.ADMIN_UPNS='';
    if(role!=='viewer-only')f.env.TIMESHEET_VIEWER_UPNS='';
    assert.equal((await f.request(path)).status,403,role);f.db.close();
  }
});
test('client supplied reviewer identity is never accepted in place of the signed identity',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;
  const f=fixture(),d=await draft(f),body={...submission(d),reviewerOid:'untrusted-claim'};
  assert.equal((await f.request(path,'POST',body)).status,201);
  assert.equal(f.db.prepare('SELECT reviewer_oid FROM timesheet_ownership_reviews').get().reviewer_oid,reviewer);f.db.close();
});
for(const mode of ['wrong subject','wrong upn','disabled subject','missing account status','directory unavailable','changed record','bad fingerprint'])test(`adoption fails closed for ${mode}`,async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;inject=null;
  const f=fixture(),d=await draft(f),body=submission(d);
  if(mode==='wrong subject')directory.id='f2f68655-fbeb-463b-9635-bd91681ea5b5';
  if(mode==='wrong upn')directory.userPrincipalName='other@example.test';
  if(mode==='disabled subject')directory.accountEnabled=false;
  if(mode==='missing account status')directory.accountEnabled=undefined;
  if(mode==='directory unavailable')directoryStatus=503;
  if(mode==='changed record')inject=()=>f.db.prepare("UPDATE records SET payload_json='{}' WHERE record_id='r1'").run();
  if(mode==='bad fingerprint')body.payloadSha256='0'.repeat(64);
  const response=await f.request(path,'POST',body);assert.equal(response.status,mode==='directory unavailable'?503:409);assert.equal(f.db.prepare('SELECT count(*) AS n FROM timesheet_ownership_reviews').get().n,0);
  f.db.close();directoryStatus=200;inject=null;
});

test('a privileged reviewer can revoke the reviewed record once and then review again',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;
  const f=fixture(),d=await draft(f),adopt=await f.request(path,'POST',submission(d));assert.equal(adopt.status,201);
  const {reviewId}=await adopt.json();const revokePath=path+'/revoke';
  assert.equal((await f.request(revokePath,'POST',{reviewId},otherToken)).status,403);
  assert.equal((await f.request(revokePath,'POST',{reviewId})).status,200);
  assert.equal((await f.request(revokePath,'POST',{reviewId})).status,409);
  const refreshed=await draft(f);
  assert.equal((await f.request(path,'POST',submission(refreshed))).status,201);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE event_type='revoked'").get().n,1);f.db.close();
});
test('a draft made before another review is adopted and revoked cannot silently restore it',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;
  const f=fixture(),d=await draft(f);
  inject=()=>{
    const result=f.db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
      VALUES('r1',1,?,?,?,'review-2','2026-11-16T00:00:00Z')`).run(d.payloadSha256,subject,reviewer);
    f.db.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(result.lastInsertRowid,reviewer);
  };
  assert.equal((await f.request(path,'POST',submission(d))).status,409);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM timesheet_ownership_reviews').get().n,1);
  f.db.close();inject=null;
});
test('an in-flight workbook delivery holds adoption for reconciliation',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;
  const f=fixture(),d=await draft(f);
  f.db.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES('r1','sending','t','t',1,'t')").run();
  assert.equal((await f.request(path,'POST',submission(d))).status,409);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM timesheet_ownership_reviews').get().n,0);f.db.close();
});
test('reviewer can see a queued delivery and an existing current ownership decision',async()=>{
  directory={id:subject,userPrincipalName:'employee@example.test'};directoryStatus=200;
  const f=fixture();try {
    f.db.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES('r1','queued','t','t',0,'t')").run();
    const d=await draft(f);assert.equal(d.deliveryStatus,'queued');assert.equal(d.activeReview,null);
    const result=await f.request(path,'POST',submission(d));assert.equal(result.status,201);const adopted=await result.json();
    const current=await draft(f);assert.equal(current.activeReview.reviewId,adopted.reviewId);assert.equal(current.activeReview.subjectOid,subject);assert.equal(current.activeReview.payloadSha256,d.payloadSha256);
    assert.equal(f.db.prepare("SELECT status FROM dispatch_queue WHERE record_id='r1'").get().status,'queued');
  }finally{f.db.close()}
});
process.on('exit',()=>{globalThis.fetch=originalFetch});
