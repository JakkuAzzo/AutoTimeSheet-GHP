import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bindPrivateOriginalProof,createPrivateOriginalIntent,readPrivateOriginalIntent,reservePrivateOriginalCreate} from '../cloudflare-worker/src/private-timesheet-original-store.js';
import {filePrivateTimesheetOriginal} from '../cloudflare-worker/src/private-timesheet-originals.js';

const employee='0244eee3-2f7f-4d41-a6e9-af4a5a07fbd2',actor='11111111-1111-4111-8111-111111111111',bytes=new TextEncoder().encode('fictional original timesheet'),hash=createHash('sha256').update(bytes).digest('hex'),now='2026-11-17T18:00:00.000Z';
const payload=JSON.stringify({payMonth:'2026-10',rows:[{date:'2026-10-05',sourceEvidence:{sourceId:hash}}]});
const payloadHash=createHash('sha256').update(payload).digest('hex');
const proof={recordId:'correction-one',employeeOid:employee,sourceSha256:hash,reviewId:'intent-one',recordRevision:7,dates:['2026-10-05'],itemId:'source-item',vaultId:'admin-vault',eTag:'version-one',fileName:hash+'.docx',reviewState:'pending'};
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE records(record_id TEXT PRIMARY KEY,owner_oid TEXT,owner_upn TEXT,kind TEXT,action TEXT,status TEXT,payload_json TEXT);
    CREATE TABLE timesheet_owner_revisions(owner_upn TEXT PRIMARY KEY,revision INTEGER);
    CREATE TABLE private_timesheet_subjects(employee_upn TEXT PRIMARY KEY,employee_oid TEXT);
    CREATE TABLE dispatch_queue(record_id TEXT,status TEXT);
    CREATE TABLE timesheet_ownership_reviews(record_id TEXT,subject_oid TEXT);`);
  sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0036_timesheet_original_filing.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0039_timesheet_original_create_reservations.sql',import.meta.url),'utf8'));
  sql.prepare("INSERT INTO records VALUES(?,?,?,'timesheets','pay_month_correction','Submitted',?)").run(proof.recordId,employee,'person@example.test',payload);
  sql.prepare('INSERT INTO timesheet_owner_revisions VALUES(?,?)').run('person@example.test',7);
  sql.prepare('INSERT INTO private_timesheet_subjects VALUES(?,?)').run('person@example.test',employee);
  sql.prepare('INSERT INTO timesheet_original_filing_intents VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('intent-one',proof.recordId,employee,'person@example.test',hash,payloadHash,7,JSON.stringify(proof.dates),actor,'2026-11-17T17:00:00.000Z','2026-11-17T19:00:00.000Z');
  const DB={prepare(statement){const wrap=(args=[])=>({bind(...v){return wrap(v)},async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:sql.prepare(statement).run(...args)}}});return wrap()}};
  return {sql,DB};
}
test('only an authorised current correction can create and read a short-lived filing intent',async()=>{
  const {sql,DB}=fixture();try{
    const input={recordId:proof.recordId,employeeOid:employee,ownerUpn:'person@example.test',sourceSha256:hash,ownerRevision:7,dates:['2026-10-05'],recordPayload:payload,actorOid:actor};
    assert.equal(await createPrivateOriginalIntent(DB,input,async()=>false,now),null);
    const intent=await createPrivateOriginalIntent(DB,input,async value=>value.actorOid===actor,now);
    assert.ok(intent?.reviewId);assert.equal(intent.recordRevision,7);
    const allowed=await readPrivateOriginalIntent(DB,intent.reviewId,async details=>details.intentCreatorOid===actor && !Object.hasOwn(details,'actorOid'),now);
    assert.equal(allowed.recordPayload,payload);assert.equal(allowed.sourceSha256,hash);
    assert.equal(await readPrivateOriginalIntent(DB,intent.reviewId,async()=>false,now),null);
    assert.equal(await readPrivateOriginalIntent(DB,intent.reviewId,async()=>true,'2026-11-17T18:16:00.000Z'),null);
    sql.prepare("UPDATE records SET payload_json='{}'").run();
    assert.equal(await readPrivateOriginalIntent(DB,intent.reviewId,async()=>true,now),null,'the original authorisation cannot survive an edited source record');
  }finally{sql.close()}
});
test('filing intent cannot name a different date, file, employee or revision',async()=>{
  const {sql,DB}=fixture();try{
    const input={recordId:proof.recordId,employeeOid:employee,ownerUpn:'person@example.test',sourceSha256:hash,ownerRevision:7,dates:['2026-10-05'],recordPayload:payload,actorOid:actor};
    for(const change of [{dates:['2026-10-06']},{sourceSha256:'b'.repeat(64)},{employeeOid:actor},{ownerRevision:6},{recordPayload:'{}'}])assert.equal(await createPrivateOriginalIntent(DB,{...input,...change},async()=>true,now),null);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_original_filing_intents').get().n,1,'no unauthorised intent was added');
  }finally{sql.close()}
});
test('an exact, current intent binds one immutable pending original',async()=>{
  const {sql,DB}=fixture();try{
    assert.equal(await bindPrivateOriginalProof(DB,proof,payload,now),true);
    assert.equal(await bindPrivateOriginalProof(DB,proof,payload,now),true,'an exact retry is idempotent');
    const rows=sql.prepare('SELECT * FROM timesheet_private_originals').all();assert.equal(rows.length,1);assert.equal(rows[0].review_state,'pending');assert.equal(rows[0].source_sha256,hash);
    assert.throws(()=>sql.prepare("UPDATE timesheet_private_originals SET item_etag='other'").run(),/immutable/i);
    assert.throws(()=>sql.prepare('DELETE FROM timesheet_private_originals').run(),/immutable/i);
    assert.equal(await bindPrivateOriginalProof(DB,{...proof,eTag:'other'},payload,now),false,'different proof cannot replace an earlier binding');
  }finally{sql.close()}
});
test('a create reservation is unique for a vault and digest across intents and extensions',async()=>{
  const {sql,DB}=fixture();try{const binding={...proof,recordPayload:payload};assert.equal(await reservePrivateOriginalCreate(DB,binding,'admin-vault',hash+'.docx',now),true);assert.equal(await reservePrivateOriginalCreate(DB,binding,'admin-vault',hash+'.pdf',now),false);assert.throws(()=>sql.prepare('DELETE FROM timesheet_original_create_reservations').run(),/immutable/i);assert.throws(()=>sql.prepare("UPDATE timesheet_original_create_reservations SET file_name='changed'").run(),/immutable/i)}finally{sql.close()}
});
for(const [name,change] of [
  ['record changed',sql=>sql.prepare("UPDATE records SET payload_json='{}'").run()],
  ['owner revision changed',sql=>sql.prepare('UPDATE timesheet_owner_revisions SET revision=8').run()],
  ['employee identity changed',sql=>sql.prepare("UPDATE private_timesheet_subjects SET employee_oid='other'").run()],
  ['intent revoked',sql=>sql.prepare('INSERT INTO timesheet_original_filing_revocations VALUES(?,?,?)').run('intent-one',actor,now)],
  ['delivery active',sql=>sql.prepare("INSERT INTO dispatch_queue VALUES('correction-one','sending')").run()],
  ['ownership under review',sql=>sql.prepare("INSERT INTO timesheet_ownership_reviews VALUES('correction-one',?)").run(employee)]
])test(`${name} prevents a new create reservation`,async()=>{const {sql,DB}=fixture();try{change(sql);assert.equal(await reservePrivateOriginalCreate(DB,{...proof,recordPayload:payload},'admin-vault',hash+'.docx',now),false);assert.equal(sql.prepare('SELECT count(*) n FROM timesheet_original_create_reservations').get().n,0)}finally{sql.close()}});
test('expired, mismatched and invalid source reservations are rejected',async()=>{const {sql,DB}=fixture();try{const binding={...proof,recordPayload:payload};for(const [item,vault,name,at] of [[binding,'admin-vault',hash+'.docx','2026-11-17T20:00:00.000Z'],[{...binding,dates:['2026-10-06']},'admin-vault',hash+'.docx',now],[binding,'../unsafe',hash+'.docx',now],[binding,'admin-vault',hash+'.exe',now]])assert.equal(await reservePrivateOriginalCreate(DB,item,vault,name,at),false);assert.equal(sql.prepare('SELECT count(*) n FROM timesheet_original_create_reservations').get().n,0)}finally{sql.close()}});
for(const [name,change] of [
  ['record changed',sql=>sql.prepare("UPDATE records SET payload_json='{}'").run()],
  ['owner revision changed',sql=>sql.prepare('UPDATE timesheet_owner_revisions SET revision=8').run()],
  ['owner revision missing',sql=>sql.prepare('DELETE FROM timesheet_owner_revisions').run()],
  ['employee identity changed',sql=>sql.prepare("UPDATE private_timesheet_subjects SET employee_oid='other'").run()],
  ['review revoked',sql=>sql.prepare('INSERT INTO timesheet_original_filing_revocations VALUES(?,?,?)').run('intent-one',actor,now)],
  ['delivery already active',sql=>sql.prepare("INSERT INTO dispatch_queue VALUES('correction-one','sending')").run()],
  ['ownership under review',sql=>sql.prepare("INSERT INTO timesheet_ownership_reviews VALUES('correction-one',?)").run(employee)]
])test(`${name} prevents a source binding`,async()=>{
  const {sql,DB}=fixture();try{change(sql);assert.equal(await bindPrivateOriginalProof(DB,proof,payload,now),false);assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_private_originals').get().n,0);}finally{sql.close()}
});
test('expiry, changed dates and wrong digest cannot be bound',async()=>{
  const {sql,DB}=fixture();try{
    for(const [candidate,at] of [[proof,'2026-11-17T20:00:00.000Z'],[{...proof,dates:['2026-10-06']},now],[{...proof,sourceSha256:'b'.repeat(64)},now]])assert.equal(await bindPrivateOriginalProof(DB,candidate,payload,at),false);
  }finally{sql.close()}
});
for(const raced of [false,true])test(`private filing verifies provider bytes before the guarded database binding${raced?' and holds a changed record':''}`,async()=>{
  const {sql,DB}=fixture();try{
    const admin='e0d972cd-46ed-4930-a9c6-51db65474f1f',owner='b89b71c6-ba9a-4712-bf29-57f50d1c2969';
    const permissions=ancestor=>[{roles:['write'],grantedToV2:{group:{id:admin}},...(ancestor?{inheritedFrom:{id:ancestor}}:{})},{roles:['owner'],grantedToV2:{group:{id:owner}},...(ancestor?{inheritedFrom:{id:ancestor}}:{})}];
    let item=null;
    const io={authorize:async()=>({...proof}),metadata:async id=>id==='admin-vault'?{id,folder:{},parentReference:{id:'admin-parent'}}:item,
      permissions:async id=>permissions(id==='admin-parent'?null:id==='admin-vault'?'admin-parent':'admin-vault'),findChild:async()=>item,
      createExclusive:async(parent,name,value)=>item={id:'source-item',name,file:{},size:value.length,eTag:'version-one',parentReference:{id:parent}},
      read:async()=>{if(raced)sql.prepare("UPDATE records SET payload_json='{}'").run();return bytes},bind:candidate=>bindPrivateOriginalProof(DB,candidate,payload,now)};
    const filing=filePrivateTimesheetOriginal({adminGroupId:admin,siteOwnerGroupId:owner,parentId:'admin-parent',vaultId:'admin-vault'},{recordId:proof.recordId,employeeOid:employee,sourceSha256:hash,fileName:'week.docx',bytes},io);
    if(raced){await assert.rejects(()=>filing,/changed/i);assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_private_originals').get().n,0);}
    else {assert.equal((await filing).reviewState,'pending');assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_private_originals').get().n,1);}
  }finally{sql.close()}
});
