import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync} from 'node:fs';

const migration=new URL('../cloudflare-worker/migrations/0030_timesheet_source_exclusions.sql',import.meta.url);
const schema=readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8');
function db(){const sql=new DatabaseSync(':memory:');sql.exec(schema);return sql;}
function exclude(sql,item='17',etag='"v1"'){return sql.prepare(`INSERT INTO timesheet_source_exclusions(site_id,list_id,item_id,source_etag,fields_sha256,reviewer_oid,evidence_reference,reviewed_at)
 VALUES('site','list',?,?,?,'reviewer','evidence','2026-11-16T12:00:00Z')`).run(item,etag,'a'.repeat(64)).lastInsertRowid;}
function own(sql,item='17'){return sql.prepare(`INSERT INTO timesheet_source_reviews(site_id,list_id,item_id,source_etag,fields_sha256,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at)
 VALUES('site','list',?,'"v1"',?,'employee','employee@example.test','reviewer','evidence','2026-11-16T12:00:00Z')`).run(item,'a'.repeat(64)).lastInsertRowid;}
test('non-timesheet classification migration is separate, idempotent and does not change existing records',()=>{
 assert.ok(existsSync(migration));const sql=db();try{sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES('record','owner','owner@example.test','Owner','timesheets','submission','Submitted','t','t','{}')`).run();const before=sql.prepare('SELECT * FROM records').all();sql.exec(readFileSync(migration,'utf8'));sql.exec(readFileSync(migration,'utf8'));assert.deepEqual(sql.prepare('SELECT * FROM records').all(),before);assert.equal(sql.prepare('SELECT count(*) n FROM timesheet_source_exclusions').get().n,0)}finally{sql.close()}
});
test('an exclusion is immutable, version-bound, revocable and cannot coexist with an owner review',()=>{
 const sql=db();try{const id=exclude(sql);const entry=sql.prepare('SELECT * FROM timesheet_source_exclusions WHERE exclusion_id=?').get(id);assert.equal(entry.source_etag,'"v1"');assert.equal(entry.fields_sha256,'a'.repeat(64));assert.equal('fields_json' in entry,false);assert.equal(sql.prepare('SELECT event_type FROM timesheet_source_exclusion_events WHERE exclusion_id=?').get(id).event_type,'adopted');assert.throws(()=>exclude(sql),/active.*classification/i);assert.throws(()=>own(sql),/active.*classification/i);assert.throws(()=>sql.prepare('UPDATE timesheet_source_exclusions SET source_etag=? WHERE exclusion_id=?').run('changed',id));assert.throws(()=>sql.prepare('DELETE FROM timesheet_source_exclusions WHERE exclusion_id=?').run(id));const revoke=()=>sql.prepare("INSERT INTO timesheet_source_exclusion_events(exclusion_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked','reviewer','t')").run(id);revoke();assert.throws(revoke,/not active/i);assert.ok(own(sql));assert.throws(()=>exclude(sql),/active.*classification/i)}finally{sql.close()}
});
test('an active owner review prevents a conflicting non-timesheet classification',()=>{
 const sql=db();try{own(sql);assert.throws(()=>exclude(sql),/active.*classification/i);assert.equal(sql.prepare('SELECT count(*) n FROM timesheet_source_exclusions').get().n,0)}finally{sql.close()}
});
test('upgrading an existing source-review database preserves decisions and enforces exclusivity',()=>{
 const sql=new DatabaseSync(':memory:');try{
  const marker='-- A reviewer may classify an exact current source';assert.ok(schema.includes(marker));sql.exec(schema.slice(0,schema.indexOf(marker)));
  const id=own(sql);const before=sql.prepare('SELECT * FROM timesheet_source_reviews WHERE review_id=?').get(id);
  sql.exec(readFileSync(migration,'utf8'));assert.deepEqual(sql.prepare('SELECT * FROM timesheet_source_reviews WHERE review_id=?').get(id),before);
  assert.throws(()=>exclude(sql),/active.*classification/i);assert.equal(sql.prepare('SELECT count(*) n FROM timesheet_source_exclusions').get().n,0);
 }finally{sql.close()}
});
