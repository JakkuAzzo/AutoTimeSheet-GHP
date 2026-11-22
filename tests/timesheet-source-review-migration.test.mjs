import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync} from 'node:fs';

const migration=new URL('../cloudflare-worker/migrations/0029_timesheet_source_review.sql',import.meta.url);
const schema=readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8');
function make(){const db=new DatabaseSync(':memory:');db.exec(schema);return db}
function adopt(db,etag='"v1"',subject='alice-oid') {return db.prepare(`INSERT INTO timesheet_source_reviews(site_id,list_id,item_id,source_etag,fields_sha256,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at)
  VALUES('site','list','17',?,?,?,'alice@example.test','reviewer','source-evidence','2026-11-16T12:00:00Z')`).run(etag,'a'.repeat(64),subject).lastInsertRowid;}

test('source review migration preserves existing records and grants nothing',()=>{
  assert.ok(existsSync(migration),'a separate version-aware source review migration must exist');
  const db=make();db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('existing','owner','alice@example.test','Alice','timesheets','submission','Submitted','t','t','{"rows":[]}')`).run();
  const before=db.prepare("SELECT * FROM records WHERE record_id='existing'").get();db.exec(readFileSync(migration,'utf8'));
  assert.deepEqual(db.prepare("SELECT * FROM records WHERE record_id='existing'").get(),before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_source_reviews').get().n,0);db.close();
});
test('a source decision is immutable, version-bound and can be revoked and re-reviewed',()=>{
  const db=make();const id=adopt(db);
  assert.equal(db.prepare('SELECT event_type FROM timesheet_source_review_events WHERE review_id=?').get(id).event_type,'adopted');
  assert.throws(()=>adopt(db,'"v2"','bob-oid'),/active source review/i);
  assert.throws(()=>db.prepare('UPDATE timesheet_source_reviews SET subject_oid=? WHERE review_id=?').run('other',id));
  assert.throws(()=>db.prepare('DELETE FROM timesheet_source_reviews WHERE review_id=?').run(id));
  const revoke=()=>db.prepare("INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked','reviewer','2026-11-16T12:01:00Z')").run(id);
  revoke();assert.throws(revoke,/not active/i);assert.ok(adopt(db,'"v2"','bob-oid'));
  assert.throws(()=>db.prepare('DELETE FROM timesheet_source_review_events WHERE review_id=?').run(id));
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_ownership_reviews').get().n,0,'a source decision does not grant a local current-record decision');db.close();
});
test('migration is idempotent and stores fingerprints, never source contents',()=>{
  assert.ok(existsSync(migration));const db=make();const id=adopt(db);db.exec(readFileSync(migration,'utf8'));
  const review=db.prepare('SELECT * FROM timesheet_source_reviews WHERE review_id=?').get(id);
  assert.equal(review.source_etag,'"v1"');assert.equal(review.fields_sha256,'a'.repeat(64));
  assert.equal('payload_json' in review,false);assert.equal('fields_json' in review,false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_source_review_events WHERE review_id=?').get(id).n,1);db.close();
});
