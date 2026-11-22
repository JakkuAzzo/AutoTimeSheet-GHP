import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as worker from '../cloudflare-worker/src/index.js';

const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
const subject={oid:alice,upn:'alice@example.test'},period={start:'2026-09-21',cycleEnd:'2026-10-18'};
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  const wrap=(statement,args=[])=>({bind(...values){return wrap(statement,values)},async first(){return sql.prepare(statement).get(...args)||null},async all(){return {results:sql.prepare(statement).all(...args)}}});
  const DB={prepare(statement){return wrap(statement)}};
  const insert=(id,oid,upn,date,action='submission')=>sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,?,'Fictional','timesheets',?,'Submitted','2026-10-01','2026-10-01',?)`).run(id,oid,upn,action,JSON.stringify({rows:[{date,start:'09:00',finish:'17:00',lunchMinutes:60}]}));
  const review=(id,owner=alice,digest)=>{let row=sql.prepare('SELECT payload_json FROM records WHERE record_id=?').get(id),revision=sql.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get(id).revision;return sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,'fixture','2026-10-02')`).run(id,revision,digest||createHash('sha256').update(row.payload_json).digest('hex'),owner,bob).lastInsertRowid};
  const env={DB,ENTRA_TENANT_ID:'fixture',SHAREPOINT_GRAPH_CLIENT_ID:'review-preview-fixture',SHAREPOINT_GRAPH_CLIENT_SECRET:'fixture',SHAREPOINT_SITE_ID:'fixture',SHAREPOINT_DRIVE_ID:'fixture'};
  return {sql,insert,review,env};
}
const fetchOriginal=globalThis.fetch;let onDirectory=null;
globalThis.fetch=async(url)=>{url=String(url);if(url.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fixture',expires_in:3600});if(url.startsWith('https://graph.microsoft.com/v1.0/users/')){if(onDirectory){let hook=onDirectory;onDirectory=null;hook()}return Response.json({id:alice,userPrincipalName:'alice@example.test'})}throw Error('Unexpected request')};
process.on('exit',()=>{globalThis.fetch=fetchOriginal});
const preview=f=>worker.readOwnershipReviewedPayMonthPreview(f.env,subject,period,'target-correction');

test('a reviewed correction can contribute to a private preview without changing its stored owner',async()=>{
  const f=fixture();try{f.insert('ordinary',alice,subject.upn,'2026-10-05');f.insert('reviewed',bob,subject.upn,'2026-10-06','pay_month_correction');
    await assert.rejects(()=>preview(f),error=>error.status===409);
    f.review('reviewed');const result=await preview(f);
    assert.deepEqual(result.rows.map(x=>x.date),['2026-10-05','2026-10-06']);
    assert.equal(f.sql.prepare("SELECT owner_oid FROM records WHERE record_id='reviewed'").get().owner_oid,bob);
    assert.equal(result.scope,'review-only');
  }finally{f.sql.close()}
});
test('a review assigning a raw matching record to another employee excludes it',async()=>{
  const f=fixture();try{f.insert('other',alice,subject.upn,'2026-10-06');f.review('other',bob);assert.deepEqual((await preview(f)).rows,[])}finally{f.sql.close()}
});
for(const scenario of ['bad digest','revoked','changed','directory race'])test(`private preview holds for ${scenario}`,async()=>{
  const f=fixture();try{f.insert('reviewed',bob,subject.upn,'2026-10-06','pay_month_correction');let id=f.review('reviewed',alice,scenario==='bad digest'?'a'.repeat(64):undefined);
    if(scenario==='revoked')f.sql.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(id,bob);
    if(scenario==='changed')f.sql.prepare("UPDATE records SET payload_json=? WHERE record_id='reviewed'").run(JSON.stringify({rows:[{date:'2026-10-06',start:'10:00'}]}));
    if(scenario==='directory race')onDirectory=()=>f.sql.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(id,bob);
    await assert.rejects(()=>preview(f),error=>error.status===409);
  }finally{onDirectory=null;f.sql.close()}
});
test('a standalone imported day cannot be hidden by an ownership review',async()=>{
  const f=fixture();try{f.insert('reviewed',bob,subject.upn,'2026-10-06');f.review('reviewed');f.sql.prepare('INSERT INTO timesheet_import_source_days VALUES(?,?,?,?)').run('unreviewed',alice,subject.upn,'2026-10-06');await assert.rejects(()=>preview(f),error=>error.status===409)}finally{f.sql.close()}
});
test('a source inserted during directory verification invalidates the preview',async()=>{
  const f=fixture();try{f.insert('ordinary',alice,subject.upn,'2026-10-05');onDirectory=()=>f.insert('later',alice,subject.upn,'2026-10-06');await assert.rejects(()=>preview(f),error=>error.status===409)}finally{onDirectory=null;f.sql.close()}
});
test('a reviewed record whose stored address belongs elsewhere is found by its reviewed subject',async()=>{
  const f=fixture();try{f.insert('elsewhere',bob,'accounts@example.test','2026-10-06','pay_month_correction');f.review('elsewhere');assert.deepEqual((await preview(f)).rows.map(x=>x.date),['2026-10-06'])}finally{f.sql.close()}
});
test('competing sources are displayed as unresolved alternatives, not silently selected',async()=>{
  const f=fixture();try{f.insert('first',alice,subject.upn,'2026-10-06');f.insert('second',bob,subject.upn,'2026-10-06');f.sql.prepare("UPDATE records SET payload_json=? WHERE record_id='second'").run(JSON.stringify({rows:[{date:'2026-10-06',start:'10:00',finish:'18:00',lunchMinutes:60}]}));f.review('second');const result=await preview(f);
    assert.deepEqual(result.rows,[]);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].date,'2026-10-06');assert.deepEqual(result.conflicts[0].candidates.map(x=>x.recordId),['first','second']);assert.deepEqual(result.conflicts[0].candidates.map(x=>x.row.Finish),['17:00','18:00']);
  }finally{f.sql.close()}
});
test('a correction does not silently resolve a conflicting source in the review preview',async()=>{
  const f=fixture();try{f.insert('first',alice,subject.upn,'2026-10-06');f.insert('second',bob,subject.upn,'2026-10-06','pay_month_correction');f.sql.prepare("UPDATE records SET payload_json=? WHERE record_id='second'").run(JSON.stringify({rows:[{date:'2026-10-06',start:'10:00',finish:'18:00',lunchMinutes:60}]}));f.review('second');const result=await preview(f);assert.equal(result.rows.length,0);assert.equal(result.conflicts[0].date,'2026-10-06')
  }finally{f.sql.close()}
});
test('conflicting source rate claims preserve unknown versus explicit zero',async()=>{
  const f=fixture();try{f.insert('first',alice,subject.upn,'2026-10-06');f.insert('second',bob,subject.upn,'2026-10-06');f.sql.prepare("UPDATE records SET payload_json=? WHERE record_id='second'").run(JSON.stringify({rows:[{date:'2026-10-06',start:'09:00',finish:'17:00',lunchMinutes:60,sourceEvidence:{rateEvidenceVersion:1,claimedBasic:null,claimedOt15:0,claimedOt20:null}}]}));f.review('second');let result=await preview(f);assert.equal(result.conflicts.length,1);assert.deepEqual(result.conflicts[0].candidates.map(x=>x.row['Source overtime 1.5× hours']),['',0])
  }finally{f.sql.close()}
});
test('unversioned rate claims require review even when there is only one source',async()=>{
  const f=fixture();try{f.insert('legacy',alice,subject.upn,'2026-10-06');f.sql.prepare("UPDATE records SET payload_json=? WHERE record_id='legacy'").run(JSON.stringify({rows:[{date:'2026-10-06',start:'09:00',finish:'17:00',lunchMinutes:60,sourceEvidence:{claimedBasic:480,claimedOt15:0,claimedOt20:null}}]}));
    const result=await preview(f);assert.equal(result.rows.length,0);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].reason,'uninterpreted-source-rates');assert.equal(result.conflicts[0].candidates[0].recordId,'legacy');
  }finally{f.sql.close()}
});
test('a removed day and a recorded day remain separate alternatives',async()=>{
  const f=fixture();try{f.insert('first',alice,subject.upn,'2026-10-06');f.insert('second',bob,subject.upn,'2026-10-06','pay_month_correction');f.sql.prepare("UPDATE records SET payload_json=? WHERE record_id='second'").run(JSON.stringify({rows:[],deletedDays:['2026-10-06']}));f.review('second');const result=await preview(f);assert.equal(result.rows.length,0);assert.deepEqual(result.conflicts[0].candidates.map(x=>x.deleted),[false,true])}finally{f.sql.close()}
});
test('identical source values do not create an artificial conflict',async()=>{
  const f=fixture();try{f.insert('first',alice,subject.upn,'2026-10-06');f.insert('second',bob,subject.upn,'2026-10-06');f.review('second');const result=await preview(f);assert.deepEqual(result.conflicts,[]);assert.equal(result.rows.length,1)}finally{f.sql.close()}
});
