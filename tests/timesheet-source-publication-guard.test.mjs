import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {selectPublicationSource,recordPublicationCandidate,publishCandidate,readPublishedCandidate} from '../cloudflare-worker/src/timesheet-source-publication-guard.js';
import * as publicationGuard from '../cloudflare-worker/src/timesheet-source-publication-guard.js';

const oid='11111111-1111-4111-8111-111111111111',upn='person@example.test',recordId='fictional-correction',month='2026-10';
const payload=JSON.stringify({payMonth:month});
const makeSource=amount=>Buffer.from(JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId,employeeUpn:upn,payMonth:month,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',rows:[{date:'2026-10-05',totalMinutes:amount}]})).toString('base64');
const digest=source=>createHash('sha256').update(Buffer.from(source,'base64')).digest('hex');
function fixture(ownerOid=oid,ownerUpn=upn){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0041_timesheet_source_publication_guard.sql',import.meta.url),'utf8'));
 sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,'Fictional','timesheets','pay_month_correction','Queued for Accounts','t','t',?)`).run(recordId,ownerOid,ownerUpn,payload);
 sql.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES (?,'queued','t','t',0,'t')").run(recordId);
 sql.prepare("INSERT INTO private_timesheet_subjects(employee_upn,employee_oid,created_at) VALUES (?,?,'t')").run(upn,oid);
 const source=makeSource(120);sql.prepare("INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES (?,'attachment_record','fictional.json','application/json',?,1,'t')").run(recordId,source);
 const revision=sql.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(ownerUpn).revision;
 sql.prepare('INSERT INTO timesheet_queue_source_guards VALUES (?,?,?,?)').run(recordId,ownerUpn,revision,source);
 const wrap=(query,args=[])=>({async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}}}});
 const env={DB:{prepare(query){return {...wrap(query),bind(...args){return wrap(query,args)}}}}};
 return {sql,env,source,revision};
}
const request=(source,revision,expectedRevision=0)=>({recordId,subjectOid:oid,subjectUpn:upn,payMonth:month,driveId:'fictional-drive',sourceBase64:source,generation:digest(source),ownerRevision:revision,payloadJson:payload,expectedRevision});
function attachFictional(sql){
 for(const [field,name,type] of [['attachment','fictional.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['attachment_csv','fictional.csv','text/csv']])
  sql.prepare("INSERT OR IGNORE INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES (?,?,?,?, 'eA==',1,'t')").run(recordId,field,name,type);
 const rows=sql.prepare('SELECT field_name,file_name,content_type,content_base64,size_bytes FROM record_attachments WHERE record_id=? ORDER BY field_name').all(recordId);
 const manifest=rows.map(r=>({fieldName:r.field_name,fileName:r.file_name,contentType:r.content_type,contentBase64:r.content_base64,sizeBytes:r.size_bytes}));
 sql.prepare('INSERT OR REPLACE INTO timesheet_queue_attachment_guards VALUES (?,?)').run(recordId,JSON.stringify(manifest));
 sql.prepare("UPDATE dispatch_queue SET next_attempt_at='2026-11-20T11:00:00.000Z' WHERE record_id=?").run(recordId);
}
async function startFictional(sql,env,candidate){
 attachFictional(sql);
 const claim=await publicationGuard.claimPublicationHandoff(env,{...candidate,claimedAt:'2026-11-20T12:00:00.000Z'});
 assert.ok(claim);
 const bound={...candidate,...claim,claimedAt:'2026-11-20T12:00:00.000Z',flowRunId:candidate.flowRunId||'fictional-run'};
 await publicationGuard.bindPublicationFlow(env,bound);
 assert.equal(await publicationGuard.confirmPublicationHandoff(env,bound),true);
 return bound;
}
async function completeFictional(sql,env,candidate){
 const bound=await startFictional(sql,env,candidate);
 await publicationGuard.completePublishedCandidate(env,{...bound,verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'});
}

async function claimFixture(reviewed=false){
 const editor='33333333-3333-4333-8333-333333333333';
 const f=reviewed?fixture(editor,'accounts@example.test'):fixture();
 if(reviewed)f.sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','confirmed-current','t')").run(recordId,createHash('sha256').update(payload).digest('hex'),oid);
 attachFictional(f.sql);
 const q={...request(f.source,f.revision),publicationRevision:1,claimedAt:'2026-11-20T12:00:00.000Z'};
 assert.equal(await selectPublicationSource(f.env,q),1);return {...f,q};
}

test('a reviewed generation is claimed once without changing its record or ownership review',async()=>{
 const {sql,env,q}=await claimFixture(true);
 const before=sql.prepare('SELECT * FROM records WHERE record_id=?').get(recordId);
 const claims=await Promise.all([publicationGuard.claimPublicationHandoff(env,q),publicationGuard.claimPublicationHandoff(env,q)]);
 assert.equal(claims.filter(Boolean).length,1);const claim=claims.find(Boolean);
 assert.match(claim.attemptId,/^[0-9a-f-]{36}$/);
 assert.deepEqual({...sql.prepare('SELECT status,attempts FROM dispatch_queue WHERE record_id=?').get(recordId)},{status:'sending',attempts:1});
 assert.deepEqual(sql.prepare('SELECT * FROM records WHERE record_id=?').get(recordId),before);
 assert.equal(sql.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE event_type='invalidated'").get().n,0);
 await publicationGuard.confirmPublicationHandoff(env,{...q,attemptId:claim.attemptId});
 assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'sent');
 assert.deepEqual(sql.prepare('SELECT * FROM records WHERE record_id=?').get(recordId),before);
 assert.equal(await publicationGuard.claimPublicationHandoff(env,q),null);sql.close();
});

test('a changed attachment and a prior attempt prevent a source-bound claim',async()=>{
 for(const mutate of [
  sql=>sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id=? AND field_name='attachment_csv'").run(recordId),
  sql=>sql.prepare('UPDATE dispatch_queue SET attempts=1 WHERE record_id=?').run(recordId),
  sql=>sql.prepare("UPDATE records SET payload_json='{}' WHERE record_id=?").run(recordId)
 ]){
  const {sql,env,q}=await claimFixture();mutate(sql);
  assert.equal(await publicationGuard.claimPublicationHandoff(env,q),null);
  assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'queued');sql.close();
 }
});

test('a source attachment changed immediately before the claim cannot be sent',async()=>{
 const {sql,env,q}=await claimFixture(),prepare=env.DB.prepare.bind(env.DB);let changed=false;
 env.DB.prepare=query=>{const stmt=prepare(query);if(!query.includes('INSERT INTO timesheet_publication_attempts'))return stmt;
  return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,async first(){if(!changed){changed=true;sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id=? AND field_name='attachment_csv'").run(recordId)}return bound.first()}}}}};
 assert.equal(await publicationGuard.claimPublicationHandoff(env,q),null);assert.equal(changed,true);
 assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'queued');
 assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_publication_attempts').get().n,0);sql.close();
});

test('a lost claim response cannot authorize a second handoff',async()=>{
 const {sql,env,q}=await claimFixture(),prepare=env.DB.prepare.bind(env.DB);let injected=false;
 env.DB.prepare=query=>{const stmt=prepare(query);if(!query.includes('INSERT INTO timesheet_publication_attempts'))return stmt;
  return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,async first(){const result=await bound.first();if(!injected){injected=true;throw Error('fictional lost claim response')}return result}}}}};
 await assert.rejects(()=>publicationGuard.claimPublicationHandoff(env,q),/lost claim response/);
 assert.equal(await publicationGuard.claimPublicationHandoff(env,q),null);
 assert.deepEqual({...sql.prepare('SELECT status,attempts FROM dispatch_queue WHERE record_id=?').get(recordId)},{status:'sending',attempts:1});
 const before=sql.prepare('SELECT * FROM timesheet_publication_attempts').all();
 assert.equal(before.length,1);
 const recovered=await publicationGuard.findPublicationAttempt(env,q);
 assert.deepEqual(recovered,{attemptId:before[0].attempt_id,status:'sending',flowRunId:null});
 assert.deepEqual(await publicationGuard.findPublicationAttempt(env,q),recovered);
 for(const alternate of [{recordId:'other'},{subjectOid:'22222222-2222-4222-8222-222222222222'},
  {generation:'a'.repeat(64)},{publicationRevision:2}])assert.equal(await publicationGuard.findPublicationAttempt(env,{...q,...alternate}),null);
 assert.deepEqual(sql.prepare('SELECT * FROM timesheet_publication_attempts').all(),before);
 assert.deepEqual({...sql.prepare('SELECT status,attempts FROM dispatch_queue WHERE record_id=?').get(recordId)},{status:'sending',attempts:1});sql.close();
});

test('an uncertain handoff remains locked and cannot be resent or confirmed by another attempt',async()=>{
 const {sql,env,q}=await claimFixture(true),before=sql.prepare('SELECT * FROM records WHERE record_id=?').get(recordId);
 const claim=await publicationGuard.claimPublicationHandoff(env,q);
 assert.equal(await publicationGuard.markPublicationHandoffUncertain(env,{...q,attemptId:'44444444-4444-4444-8444-444444444444'}),false);
 assert.equal(await publicationGuard.markPublicationHandoffUncertain(env,{...q,attemptId:claim.attemptId}),true);
 assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'uncertain');
 assert.deepEqual(await publicationGuard.findPublicationAttempt(env,q),{attemptId:claim.attemptId,status:'uncertain',flowRunId:null});
 assert.equal(await publicationGuard.confirmPublicationHandoff(env,{...q,attemptId:claim.attemptId}),false);
 assert.equal(await publicationGuard.claimPublicationHandoff(env,q),null);
 assert.throws(()=>sql.prepare("UPDATE records SET payload_json='{}' WHERE record_id=?").run(recordId),/gmt_timesheet_.*in_progress/);
 assert.deepEqual(sql.prepare('SELECT * FROM records WHERE record_id=?').get(recordId),before);sql.close();
});

test('completion requires the receiving run bound to the exact claimed attempt',async()=>{
 const {sql,env,q}=await claimFixture(true),claim=await publicationGuard.claimPublicationHandoff(env,q);
 const c={...q,...claim,itemId:'fictional-bound',etag:'v1',flowRunId:'fictional-flow',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'};
 assert.equal(await publicationGuard.confirmPublicationHandoff(env,c),true);
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,c),'an unbound run must not complete');
 await assert.rejects(()=>publicationGuard.bindPublicationFlow(env,{...c,attemptId:'44444444-4444-4444-8444-444444444444'}));
 await publicationGuard.bindPublicationFlow(env,c);
 await publicationGuard.bindPublicationFlow(env,c);
 assert.deepEqual(await publicationGuard.findPublicationAttempt(env,q),{attemptId:claim.attemptId,status:'sent',flowRunId:'fictional-flow'});
 await assert.rejects(()=>publicationGuard.bindPublicationFlow(env,{...c,flowRunId:'another-flow'}));
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,{...c,flowRunId:'another-flow'}));
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,{...c,attemptId:'44444444-4444-4444-8444-444444444444'}));
 await publicationGuard.completePublishedCandidate(env,c);await publicationGuard.completePublishedCandidate(env,c);
 assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'completed');sql.close();
});

test('a candidate verified in one drive cannot publish the same item ID from another drive',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);
 assert.equal(await selectPublicationSource(env,q),1);
 const candidate={...q,publicationRevision:1,driveId:'fictional-drive-a',itemId:'fictional-item',etag:'v1'};
 await assert.rejects(()=>recordPublicationCandidate(env,{...candidate,driveId:''}));
 await assert.rejects(()=>recordPublicationCandidate(env,{...candidate,driveId:'fictional\ndrive'}));
 await recordPublicationCandidate(env,candidate);
 await assert.rejects(()=>recordPublicationCandidate(env,{...candidate,driveId:'fictional-drive-b'}));
 assert.equal(await publishCandidate(env,{...candidate,driveId:'fictional-drive-b'}),false);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);
 assert.equal(await publishCandidate(env,candidate),true);
 await completeFictional(sql,env,candidate);
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).driveId,'fictional-drive-a');
 sql.close();
});

test('fresh databases contain the source-bound publication tables',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('timesheet_publication_scopes','timesheet_publication_candidates')").all();assert.equal(names.length,2);db.close();
});

test('repeating an identical selection after a lost response keeps the current revision and published pointer',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);
 assert.equal(await selectPublicationSource(env,q),1);
 const candidate={...q,publicationRevision:1,itemId:'fictional-retry',etag:'v1'};
 await recordPublicationCandidate(env,candidate);assert.equal(await publishCandidate(env,candidate),true);
 assert.equal(await selectPublicationSource(env,q),1,'a lost response can be retried with the original expected revision');
 assert.equal(await selectPublicationSource(env,{...q,expectedRevision:1}),1,'reselecting the same snapshot must not create a new revision');
 await completeFictional(sql,env,candidate);
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,'fictional-retry');
 sql.close();
});

test('only an exact sealed completion moves sent to completed and preserves the current pointer',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);
 assert.equal(await selectPublicationSource(env,q),1);
 const c={...q,publicationRevision:1,itemId:'fictional-completed',etag:'v1',flowRunId:'fictional-run-1',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null,'a published candidate is not readable before its exact completion');
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,c));
 Object.assign(c,await startFictional(sql,env,c));
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null,'a sent queue state alone is not a verified receipt');
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,{...c,itemId:'another-file'}));
 assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'sent');
 await publicationGuard.completePublishedCandidate(env,c);
 assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'completed');
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,c.itemId);
 await publicationGuard.completePublishedCandidate(env,c);
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,{...c,flowRunId:'another-run'}));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_publication_completions').get().n,1);
 assert.throws(()=>sql.prepare("UPDATE timesheet_publication_completions SET item_id='other'").run(),/immutable/);
 assert.throws(()=>sql.prepare('DELETE FROM timesheet_publication_completions').run(),/immutable/);
 sql.prepare("UPDATE record_attachments SET content_base64='e30=' WHERE record_id=? AND field_name='attachment_record'").run(recordId);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);
 sql.close();
});

test('a legacy completed queue row cannot expose or complete a sealed candidate',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);
 assert.equal(await selectPublicationSource(env,q),1);
 const c={...q,publicationRevision:1,itemId:'fictional-legacy',etag:'v1',flowRunId:'fictional-run',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 sql.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id=?").run(recordId);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,c));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_publication_completions').get().n,0);
 sql.close();
});

test('completion leaves a reviewed source unchanged and rejects stale evidence',async()=>{
 const editor='33333333-3333-4333-8333-333333333333',editorUpn='accounts@example.test';
 const {sql,env,source,revision}=fixture(editor,editorUpn),q=request(source,revision);
 const review=sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','confirmed-current','t')").run(recordId,createHash('sha256').update(payload).digest('hex'),oid);
 assert.equal(await selectPublicationSource(env,q),1);
 const c={...q,publicationRevision:1,itemId:'fictional-review-completion',etag:'v1',flowRunId:'fictional-run',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 Object.assign(c,await startFictional(sql,env,c));
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,{...c,verificationDigest:'invalid'}));
 await Promise.all([publicationGuard.completePublishedCandidate(env,c),publicationGuard.completePublishedCandidate(env,c)]);
 assert.equal(sql.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=? AND event_type='invalidated'").get(review.lastInsertRowid).n,0);
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,c.itemId);
 sql.prepare("UPDATE records SET payload_json='{}' WHERE record_id=?").run(recordId);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,c));
 sql.close();
});

test('a period change racing completion cannot mark the queue completed',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);
 assert.equal(await selectPublicationSource(env,q),1);
 const c={...q,publicationRevision:1,itemId:'fictional-race',etag:'v1',flowRunId:'fictional-run',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 Object.assign(c,await startFictional(sql,env,c));
 const prepare=env.DB.prepare.bind(env.DB);let injected=false;
 env.DB.prepare=query=>{const stmt=prepare(query);if(!query.includes('INSERT INTO timesheet_publication_completions'))return stmt;
  return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,async first(){if(!injected){injected=true;sql.prepare("INSERT INTO pay_month_start_settings(month_key,start_date,actor_oid,actor_upn,updated_at) VALUES ('2026-10','2026-09-28','a','a@example.test','t')").run()}return bound.first()}}}}};
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,c));
 assert.equal(injected,true);assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'sent');
 assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_publication_completions').get().n,0);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);
 sql.close();
});

test('a lost completion response is reconciled using the exact stored evidence',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);
 assert.equal(await selectPublicationSource(env,q),1);
 const c={...q,publicationRevision:1,itemId:'fictional-lost-response',etag:'v1',flowRunId:'fictional-run',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 Object.assign(c,await startFictional(sql,env,c));
 const prepare=env.DB.prepare.bind(env.DB);let injected=false;
 env.DB.prepare=query=>{const stmt=prepare(query);if(!query.includes('INSERT INTO timesheet_publication_completions'))return stmt;
  return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,async first(){const result=await bound.first();if(!injected){injected=true;throw new Error('fictional lost response')}return result}}}}};
 await publicationGuard.completePublishedCandidate(env,c);
 assert.equal(injected,true);assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'completed');
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,c.itemId);
 await assert.rejects(()=>publicationGuard.completePublishedCandidate(env,{...c,verificationDigest:'c'.repeat(64)}));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_publication_completions').get().n,1);sql.close();
});

test('concurrent identical selections resolve to one source revision',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);
 assert.deepEqual(await Promise.all([selectPublicationSource(env,q),selectPublicationSource(env,q)]),[1,1]);
 sql.close();
});

test('a changed snapshot cannot use the lost-response retry allowance',async()=>{
 const {sql,env,source,revision}=fixture();
 assert.equal(await selectPublicationSource(env,request(source,revision)),1);
 const next=makeSource(180);
 sql.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(next,recordId);
 sql.prepare('UPDATE timesheet_queue_source_guards SET source_base64=? WHERE record_id=?').run(next,recordId);
 assert.equal(await selectPublicationSource(env,request(next,revision,0)),null);
 assert.equal(await selectPublicationSource(env,request(next,revision,1)),2);
 assert.equal(await selectPublicationSource(env,request(next,revision,0)),null,'a much older revision cannot be retried as the current selection');
 sql.close();
});

test('a late candidate cannot replace a newer generation or revive an old pointer',async()=>{
 const {sql,env,source,revision}=fixture();const first=request(source,revision);assert.equal(await selectPublicationSource(env,first),1);
 await recordPublicationCandidate(env,{...first,publicationRevision:1,itemId:'fictional-old',etag:'old-v1'});
 const next=makeSource(180);sql.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(next,recordId);
 sql.prepare('UPDATE timesheet_queue_source_guards SET source_base64=? WHERE record_id=?').run(next,recordId);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);
 const second=request(next,revision,1);assert.equal(await selectPublicationSource(env,second),2);
 await recordPublicationCandidate(env,{...second,publicationRevision:2,itemId:'fictional-new',etag:'new-v1'});
 assert.equal(await publishCandidate(env,{...second,publicationRevision:2,itemId:'fictional-new',etag:'new-v1'}),true);
 assert.equal(await publishCandidate(env,{...first,publicationRevision:1,itemId:'fictional-old',etag:'old-v1'}),false);
 await completeFictional(sql,env,{...second,publicationRevision:2,itemId:'fictional-new',etag:'new-v1'});
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,'fictional-new');sql.close();
});

test('source, review and identity changes hide an already published pointer',async()=>{
 for(const mutate of [
  sql=>sql.prepare("UPDATE record_attachments SET content_base64='e30=' WHERE record_id=? AND field_name='attachment_record'").run(recordId),
  sql=>sql.prepare("UPDATE records SET payload_json='{}' WHERE record_id=?").run(recordId),
  sql=>sql.prepare("INSERT INTO timesheet_import_source_holds(record_id,first_seen_at) VALUES (?,'t')").run(recordId),
  sql=>sql.prepare("INSERT INTO timesheet_import_source_days(record_id,owner_oid,owner_upn,source_day) VALUES ('imported',?,?,'2026-10-05')").run(oid,upn),
  sql=>sql.prepare("INSERT INTO pay_month_start_settings(month_key,start_date,actor_oid,actor_upn,updated_at) VALUES ('2026-10','2026-09-28','a','a@example.test','t')").run(),
  sql=>sql.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('other',?,'alias@example.test','Fictional','timesheets','submit','Submitted','t','t','{}')").run(oid),
  sql=>sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','fixture','t')").run(recordId,'a'.repeat(64),oid)
 ]){
  const {sql,env,source,revision}=fixture(),q=request(source,revision),c={...q,publicationRevision:1,itemId:'fictional',etag:'v1'};await selectPublicationSource(env,q);await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);await completeFictional(sql,env,c);assert.ok(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}));mutate(sql);
  assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);sql.close();
 }
});

test('refuses unbound attachment, forged generation and changed employee',async()=>{
 const {sql,env,source,revision}=fixture();
 await assert.rejects(()=>selectPublicationSource(env,{...request(source,revision),generation:'a'.repeat(64)}));
 await assert.rejects(()=>selectPublicationSource(env,{...request(source,revision),subjectOid:'22222222-2222-4222-8222-222222222222'}));
 sql.prepare("UPDATE record_attachments SET content_base64='e30=' WHERE record_id=? AND field_name='attachment_record'").run(recordId);
 assert.equal(await selectPublicationSource(env,request(source,revision)),null);sql.close();
});

test('refuses an attachment for a different configured pay period',async()=>{
 const {sql,env,source,revision}=fixture(),bad=JSON.parse(Buffer.from(source,'base64').toString('utf8'));bad.cycleEnd='2026-10-19';
 const encoded=Buffer.from(JSON.stringify(bad)).toString('base64');
 sql.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_record'").run(encoded,recordId);
 sql.prepare('UPDATE timesheet_queue_source_guards SET source_base64=? WHERE record_id=?').run(encoded,recordId);
 await assert.rejects(()=>selectPublicationSource(env,request(encoded,revision)));sql.close();
});

test('accepts a matching configured pay period and invalidates it after a boundary change',async()=>{
 const {sql,env,source,revision}=fixture();sql.prepare("INSERT INTO pay_month_start_settings VALUES ('2026-10','2026-09-21','a','a@example.test','t')").run();
 const q=request(source,revision);assert.equal(await selectPublicationSource(env,q),1);const c={...q,publicationRevision:1,itemId:'fictional',etag:'v1'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 await completeFictional(sql,env,c);
 sql.prepare("UPDATE pay_month_start_settings SET start_date='2026-09-28' WHERE month_key='2026-10'").run();
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);sql.close();
});

test('refuses malformed saved pay-period settings instead of silently using defaults',async()=>{
 const {sql,env,source,revision}=fixture();sql.prepare("INSERT INTO pay_month_start_settings VALUES ('2026-02','2026-02-31','a','a@example.test','t')").run();
 await assert.rejects(()=>selectPublicationSource(env,request(source,revision)));sql.close();
});

test('accepts a current reviewed on-behalf record without treating the shared editor as the employee',async()=>{
 const editor='33333333-3333-4333-8333-333333333333';const {sql,env,source,revision}=fixture(editor);
 sql.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('another-employee',?,'other@example.test','Other','timesheets','submit','Submitted','t','t','{}')").run(editor);
 const q=request(source,revision);assert.equal(await selectPublicationSource(env,q),null);
 const payloadDigest=createHash('sha256').update(payload).digest('hex');
 sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','confirmed-current','t')").run(recordId,payloadDigest,oid);
 assert.equal(await selectPublicationSource(env,q),1);await recordPublicationCandidate(env,{...q,publicationRevision:1,itemId:'fictional-reviewed',etag:'v1'});
 assert.equal(await publishCandidate(env,{...q,publicationRevision:1,itemId:'fictional-reviewed',etag:'v1'}),true);
 await completeFictional(sql,env,{...q,publicationRevision:1,itemId:'fictional-reviewed',etag:'v1'});
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,'fictional-reviewed');sql.close();
});

test('reviewed shared-account source binds the editor revision and employee separately',async()=>{
 const editor='33333333-3333-4333-8333-333333333333',editorUpn='accounts@example.test';
 const {sql,env,source,revision}=fixture(editor,editorUpn),q=request(source,revision);
 assert.equal(await selectPublicationSource(env,q),null);
 const payloadDigest=createHash('sha256').update(payload).digest('hex');
 const review=sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','confirmed-current','t')").run(recordId,payloadDigest,oid);
 assert.equal(await selectPublicationSource(env,q),1);
 const candidate={...q,publicationRevision:1,itemId:'fictional-shared-editor',etag:'v1'};
 await recordPublicationCandidate(env,candidate);assert.equal(await publishCandidate(env,candidate),true);
 await completeFictional(sql,env,candidate);
 sql.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES (?,'revoked','reviewer','t')").run(review.lastInsertRowid);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);sql.close();
});

test('a legacy sent status update cannot invalidate an in-flight reviewed publication',async()=>{
 const editor='33333333-3333-4333-8333-333333333333';
 const {sql,env,source,revision}=fixture(editor,'accounts@example.test'),q=request(source,revision);
 const payloadDigest=createHash('sha256').update(payload).digest('hex');
 const review=sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','confirmed-current','t')").run(recordId,payloadDigest,oid);
 assert.equal(await selectPublicationSource(env,q),1);
 const candidate={...q,publicationRevision:1,itemId:'fictional-sent-transition',etag:'v1'};
 await recordPublicationCandidate(env,candidate);assert.equal(await publishCandidate(env,candidate),true);
 Object.assign(candidate,await startFictional(sql,env,candidate));
 assert.throws(()=>sql.prepare("UPDATE records SET status='Sent to Accounts',issue='',updated_at='sent-time' WHERE record_id=?").run(recordId),/gmt_timesheet_publication_in_progress/);
 assert.equal(sql.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=? AND event_type='invalidated'").get(review.lastInsertRowid).n,0);
 assert.equal(sql.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get(recordId).revision,1);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);
 await publicationGuard.completePublishedCandidate(env,{...candidate,flowRunId:'fictional-run',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'});
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,candidate.itemId);
 sql.close();
});

test('a reviewed shared-account publication becomes stale when the employee history changes',async()=>{
 const editor='33333333-3333-4333-8333-333333333333';
 const {sql,env,source,revision}=fixture(editor,'accounts@example.test'),q=request(source,revision);
 const payloadDigest=createHash('sha256').update(payload).digest('hex');
 sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','confirmed-current','t')").run(recordId,payloadDigest,oid);
 assert.equal(await selectPublicationSource(env,q),1);const candidate={...q,publicationRevision:1,itemId:'fictional-history-change',etag:'v1'};
 await recordPublicationCandidate(env,candidate);assert.equal(await publishCandidate(env,candidate),true);
 await completeFictional(sql,env,candidate);
 sql.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('new-employee-history',?,?,'Fictional','timesheets','submit','Submitted','t','t','{}')").run(oid,upn);
 assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);sql.close();
});

test('a concurrent employee-history change prevents shared-account source selection',async()=>{
 const editor='33333333-3333-4333-8333-333333333333';
 const {sql,env,source,revision}=fixture(editor,'accounts@example.test'),q=request(source,revision);
 sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES (?,1,?,?,'reviewer','confirmed-current','t')").run(recordId,createHash('sha256').update(payload).digest('hex'),oid);
 const prepare=env.DB.prepare.bind(env.DB);let injected=false;
 env.DB.prepare=query=>{const stmt=prepare(query);if(!query.includes('INSERT INTO timesheet_publication_scopes'))return stmt;
  return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,async first(){if(!injected){injected=true;sql.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('racing-history',?,?,'Fictional','timesheets','submit','Submitted','t','t','{}')").run(oid,upn)}return bound.first()}}}}};
 assert.equal(await selectPublicationSource(env,q),null);assert.equal(injected,true);sql.close();
});

test('an unrelated employee review does not invalidate this employee workbook',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);await selectPublicationSource(env,q);
 await recordPublicationCandidate(env,{...q,publicationRevision:1,itemId:'fictional',etag:'v1'});assert.equal(await publishCandidate(env,{...q,publicationRevision:1,itemId:'fictional',etag:'v1'}),true);
 await completeFictional(sql,env,{...q,publicationRevision:1,itemId:'fictional',etag:'v1'});
 const other='22222222-2222-4222-8222-222222222222';
 sql.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('unrelated',?,'other@example.test','Other','timesheets','submit','Submitted','t','t','{}')").run(other);
 sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES ('unrelated',1,?,?,'reviewer','fixture','t')").run('b'.repeat(64),other);
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}))?.itemId,'fictional');sql.close();
});

test('a source changed after inspection cannot be selected',async()=>{
 const {sql,env,source,revision}=fixture(),prepare=env.DB.prepare.bind(env.DB);let injected=false;
 env.DB.prepare=query=>{const stmt=prepare(query);if(!query.includes('INSERT INTO timesheet_publication_scopes'))return stmt;
  return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,async first(){if(!injected){injected=true;sql.prepare("UPDATE record_attachments SET content_base64='e30=' WHERE record_id=? AND field_name='attachment_record'").run(recordId)}return bound.first()}}}}};
 assert.equal(await selectPublicationSource(env,request(source,revision)),null);assert.equal(injected,true);sql.close();
});

test('verified candidate evidence cannot be edited or deleted and exact retries are harmless',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);await selectPublicationSource(env,q);const candidate={...q,publicationRevision:1,itemId:'fictional',etag:'v1'};
 await recordPublicationCandidate(env,candidate);await recordPublicationCandidate(env,candidate);
 assert.throws(()=>sql.prepare("UPDATE timesheet_publication_candidates SET item_id='other'").run());
 assert.throws(()=>sql.prepare('DELETE FROM timesheet_publication_candidates').run());
 await assert.rejects(()=>recordPublicationCandidate(env,{...candidate,etag:'v2'}));sql.close();
});

test('a previously registered writable workbook cannot be used as a sealed copy',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);await selectPublicationSource(env,q);
 sql.prepare("INSERT INTO private_timesheet_workbooks(employee_oid,pay_month,employee_folder_id,file_name,state,month_folder_id,workbook_id,created_at,updated_at) VALUES (?,?,'folder','fictional.xlsx','ready','month','existing-item','t','t')").run(oid,month);
 await assert.rejects(()=>recordPublicationCandidate(env,{...q,publicationRevision:1,itemId:'existing-item',etag:'v1'}));sql.close();
});

test('the database refuses a candidate for an already routed old-writer workbook',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);await selectPublicationSource(env,q);
 sql.prepare("INSERT INTO timesheet_delivery_routes(record_id,flow_run_id,run_started_at,generation,employee_folder_id,month_folder_id,workbook_id,created_at) VALUES (?,'old-run','t',?,'folder','month','old-book','t')").run(recordId,q.generation);
 assert.throws(()=>sql.prepare("INSERT INTO timesheet_publication_candidates(subject_oid,pay_month,revision,generation,drive_id,item_id,etag) VALUES (?,?,1,?,'fictional-drive','old-book','v1')").run(oid,month,q.generation));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_publication_candidates').get().n,0);sql.close();
});

test('a sealed candidate cannot subsequently be registered with an old workbook writer',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);await selectPublicationSource(env,q);
 const c={...q,publicationRevision:1,itemId:'fictional-sealed',etag:'v1'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 await completeFictional(sql,env,c);
 assert.throws(()=>sql.prepare("INSERT INTO timesheet_delivery_routes(record_id,flow_run_id,run_started_at,generation,employee_folder_id,month_folder_id,workbook_id,created_at) VALUES (?,'old-run','t',?,'folder','month','fictional-sealed','t')").run(recordId,q.generation));
 assert.throws(()=>sql.prepare("INSERT INTO private_timesheet_workbooks(employee_oid,pay_month,employee_folder_id,file_name,state,month_folder_id,workbook_id,created_at,updated_at) VALUES (?,?,'folder','fictional.xlsx','ready','month','fictional-sealed','t','t')").run(oid,month));
 sql.prepare("INSERT INTO private_timesheet_workbooks(employee_oid,pay_month,employee_folder_id,file_name,state,created_at,updated_at) VALUES (?,?,'folder','fictional.xlsx','reserved','t','t')").run(oid,month);
 assert.throws(()=>sql.prepare("UPDATE private_timesheet_workbooks SET state='ready',month_folder_id='month',workbook_id='fictional-sealed' WHERE employee_oid=? AND pay_month=?").run(oid,month));
 assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:month})).itemId,'fictional-sealed');sql.close();
});

test('a pre-existing conflicting route still hides a candidate pointer',async()=>{
 const {sql,env,source,revision}=fixture(),q=request(source,revision);await selectPublicationSource(env,q);const c={...q,publicationRevision:1,itemId:'fictional-candidate',etag:'v1'};
 await recordPublicationCandidate(env,c);assert.equal(await publishCandidate(env,c),true);
 await completeFictional(sql,env,c);
 // Emulate an inconsistent legacy database predating the exclusion trigger.
 sql.exec('DROP TRIGGER timesheet_old_route_excludes_candidate');
 sql.prepare("INSERT INTO timesheet_delivery_routes(record_id,flow_run_id,run_started_at,generation,employee_folder_id,month_folder_id,workbook_id,created_at) VALUES (?,'old-run','t',?,'folder','month','fictional-candidate','t')").run(recordId,q.generation);
 assert.equal(await publishCandidate(env,c),false);assert.equal(await readPublishedCandidate(env,{subjectOid:oid,payMonth:month}),null);sql.close();
});
