import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const schema=readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../cloudflare-worker/migrations/0045_timesheet_publication_source_lock.sql',import.meta.url),'utf8');
const runBinding=readFileSync(new URL('../cloudflare-worker/migrations/0047_timesheet_publication_run_binding.sql',import.meta.url),'utf8');
const employee='11111111-1111-4111-8111-111111111111',editor='22222222-2222-4222-8222-222222222222';

function fixture(state,reviewed,upgraded){
 const db=new DatabaseSync(':memory:');db.exec(schema);
 if(upgraded){
  for(const match of migration.matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)/g))db.exec(`DROP TRIGGER ${match[1]}`);
  for(const match of [...migration.matchAll(/CREATE VIEW IF NOT EXISTS (\w+)/g)].reverse())db.exec(`DROP VIEW ${match[1]}`);
  db.exec(migration);
  db.exec(runBinding);
 }
 const insert=db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
  VALUES (?,?,?,'Fictional','timesheets',?,'Queued for Accounts','t','t','{}')`);
 insert.run('correction',reviewed?editor:employee,reviewed?'accounts@example.test':'employee@example.test','pay_month_correction');
 insert.run('source',employee,'employee@example.test','submit');
 insert.run('unrelated','33333333-3333-4333-8333-333333333333','other@example.test','submit');
 db.prepare("INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES ('source','attachment','fictional','text/plain','eA==',1,'t')").run();
 db.prepare("INSERT INTO private_timesheet_subjects VALUES ('employee@example.test',?,'t')").run(employee);
 if(reviewed)db.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES ('correction',1,?,?,'reviewer','fictional','t')").run('a'.repeat(64),employee);
 db.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES ('correction','queued','t','t',0,'2026-11-20T11:00:00.000Z')").run();
 db.prepare(`INSERT INTO timesheet_publication_scopes(subject_oid,subject_upn,pay_month,cycle_start,cycle_end,record_id,record_owner_oid,record_owner_upn,payload_json,payload_sha256,source_base64,generation,owner_revision,subject_revision,record_revision,review_watermark,period_settings_json,desired_revision)
 VALUES (?,'employee@example.test','2026-10','2026-09-21','2026-10-18','correction',?,?,'{}',?,'e30=',?,1,1,1,0,'[]',1)`).run(employee,reviewed?editor:employee,reviewed?'accounts@example.test':'employee@example.test','a'.repeat(64),'b'.repeat(64));
 db.prepare("INSERT INTO timesheet_publication_attempts VALUES ('55555555-5555-4555-8555-555555555555','correction',?,'2026-10',1,?,'2026-11-20T12:00:00.000Z')").run(employee,'b'.repeat(64));
 db.prepare("UPDATE dispatch_queue SET status=? WHERE record_id='correction'").run(state);
 return db;
}

for(const state of ['sending','sent','failed','uncertain'])for(const reviewed of [false,true])for(const upgraded of [false,true])test(`source stays locked without an old writer route while ${state} (${reviewed?'reviewed':'employee-owned'}, ${upgraded?'migration':'fresh schema'})`,()=>{
 const db=fixture(state,reviewed,upgraded);
 try{
  assert.throws(()=>db.prepare("UPDATE records SET payload_json='{\"changed\":true}' WHERE record_id='source'").run(),/gmt_timesheet_.*in_progress/);
  assert.throws(()=>db.prepare("UPDATE records SET status='Sent to Accounts' WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/);
  assert.throws(()=>db.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='source'").run(),/gmt_timesheet_.*in_progress/);
  assert.throws(()=>db.prepare("INSERT INTO pay_month_start_settings VALUES ('2026-10','2026-09-21','a','a@example.test','t')").run(),/gmt_timesheet_.*in_progress/);
  assert.doesNotThrow(()=>db.prepare("UPDATE records SET payload_json='{\"changed\":true}' WHERE record_id='unrelated'").run());
  assert.throws(()=>db.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/,'a legacy completed state is not a matching receipt');
  assert.throws(()=>db.prepare("UPDATE dispatch_queue SET status='queued' WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/,'an uncertain handoff must not be silently retried');
  assert.throws(()=>db.prepare("DELETE FROM dispatch_queue WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/);
  assert.throws(()=>db.prepare("UPDATE timesheet_publication_scopes SET record_id='unrelated' WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/);
  assert.throws(()=>db.prepare("DELETE FROM timesheet_publication_scopes WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/);
  db.prepare("UPDATE dispatch_queue SET status='sent' WHERE record_id='correction'").run();
  db.prepare("INSERT INTO timesheet_publication_candidates VALUES (?,'2026-10',1,?,'drive','item','v1')").run(employee,'b'.repeat(64));
  db.prepare("UPDATE timesheet_publication_scopes SET published_revision=1,published_generation=?,published_drive_id='drive',published_item_id='item',published_etag='v1' WHERE record_id='correction'").run('b'.repeat(64));
  db.prepare("INSERT INTO timesheet_publication_run_bindings VALUES ('55555555-5555-4555-8555-555555555555','run','2026-11-20T12:00:00.000Z')").run();
  db.prepare("INSERT INTO timesheet_publication_completions VALUES (?,'2026-10',1,?,'drive','item','v1','run',?,'2026-11-20T12:00:00.000Z')").run(employee,'b'.repeat(64),'c'.repeat(64));
  assert.throws(()=>db.prepare("UPDATE dispatch_queue SET status='queued' WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/,'an already completed generation must not be replayed');
  assert.throws(()=>db.prepare("DELETE FROM dispatch_queue WHERE record_id='correction'").run(),/gmt_timesheet_.*in_progress/,'the completed generation must retain its queue identity');
  assert.doesNotThrow(()=>db.prepare("UPDATE records SET payload_json='{\"changed\":true}' WHERE record_id='source'").run());
 }finally{db.close();}
});

test('a completion predating run binding does not release the source lock',()=>{
 const db=fixture('sent',true,false);
 try{
  db.prepare("INSERT INTO timesheet_publication_candidates VALUES (?,'2026-10',1,?,'drive','item','v1')").run(employee,'b'.repeat(64));
  db.prepare("UPDATE timesheet_publication_scopes SET published_revision=1,published_generation=?,published_drive_id='drive',published_item_id='item',published_etag='v1' WHERE record_id='correction'").run('b'.repeat(64));
  db.exec('DROP TRIGGER timesheet_publication_completion_attempt_validate');
  db.prepare("INSERT INTO timesheet_publication_completions VALUES (?,'2026-10',1,?,'drive','item','v1','old-run',?,'2026-11-20T12:00:00.000Z')").run(employee,'b'.repeat(64),'c'.repeat(64));
  assert.equal(db.prepare("SELECT status FROM dispatch_queue WHERE record_id='correction'").get().status,'completed');
  assert.throws(()=>db.prepare("UPDATE records SET payload_json='{\"changed\":true}' WHERE record_id='source'").run(),/gmt_timesheet_.*in_progress/);
 }finally{db.close();}
});
