import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';

const migration = new URL('../cloudflare-worker/migrations/0028_timesheet_ownership_review.sql', import.meta.url);
const schema = readFileSync(new URL('../cloudflare-worker/schema.sql', import.meta.url), 'utf8');
const legacySchema = schema.split('-- Foundation only: these records confer no access')[0];

test('historical ownership review migration exists and preserves records before any review', () => {
  assert.ok(existsSync(migration), 'a separate historical review migration is required');
  const db = new DatabaseSync(':memory:');
  db.exec(legacySchema);
  db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','original-editor','accounts@example.test','Person','timesheets','pay_month_correction','Submitted','t','t','{"value":1}')`).run();
  db.prepare(`INSERT INTO record_versions(record_id,owner_oid,payload_json,changed_at,changed_by_oid)
    VALUES('r1','original-editor','{"old":true}','t','original-editor')`).run();
  const original = db.prepare('SELECT * FROM records WHERE record_id=?').get('r1');
  const version = db.prepare('SELECT * FROM record_versions WHERE record_id=?').get('r1');
  db.exec(readFileSync(migration, 'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM records WHERE record_id=?').get('r1'), original);
  assert.deepEqual(db.prepare('SELECT * FROM record_versions WHERE record_id=?').get('r1'), version);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_ownership_reviews').get().n, 0);
  assert.equal(db.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get('r1').revision, 1);
  db.close();
});

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec(readFileSync(migration, 'utf8'));
  db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','original-editor','accounts@example.test','Person','timesheets','pay_month_correction','Submitted','t','t','{"value":1}')`).run();
  return db;
}
function adopt(db, revision = 1) {
  return db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
    VALUES('r1',? ,?, 'employee-oid','reviewer-oid','review-1','2026-11-16T00:00:00Z')`).run(revision, 'a'.repeat(64)).lastInsertRowid;
}
test('review adoption is append-only, limited to the current revision, and records no payload', () => {
  const db = database();
  const id = adopt(db);
  assert.equal(db.prepare('SELECT event_type FROM timesheet_ownership_review_events WHERE review_id=?').get(id).event_type, 'adopted');
  assert.throws(() => adopt(db), /active review/);
  assert.throws(() => db.prepare('UPDATE timesheet_ownership_reviews SET subject_oid=? WHERE review_id=?').run('other',id));
  assert.throws(() => db.prepare('DELETE FROM timesheet_ownership_reviews WHERE review_id=?').run(id));
  assert.throws(() => db.prepare('DELETE FROM timesheet_ownership_review_events WHERE review_id=?').run(id));
  assert.throws(() => adopt(db, 99), /revision/);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM timesheet_ownership_reviews').get()).includes('"value"'));
  db.close();
});
test('record mutation atomically invalidates the review; rollback restores both', () => {
  const db = database();
  const id = adopt(db);
  db.exec('BEGIN');
  db.prepare("UPDATE records SET payload_json=? WHERE record_id='r1'").run('{"value":2}');
  assert.equal(db.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get('r1').revision,2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=? AND event_type='invalidated'").get(id).n,1);
  db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get('r1').revision,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=? AND event_type='invalidated'").get(id).n,0);
  db.prepare("UPDATE records SET payload_json=? WHERE record_id='r1'").run('{"value":2}');
  assert.throws(() => adopt(db, 1), /revision/);
  assert.ok(adopt(db, 2));
  db.close();
});
test('a reviewer can revoke once, then re-review the same snapshot', () => {
  const db = database();
  const id = adopt(db);
  const revoke = () => db.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked','reviewer-oid','2026-11-16T00:01:00Z')").run(id);
  revoke();
  assert.throws(revoke, /not active/);
  assert.ok(adopt(db));
  db.close();
});
test('record deletion and ID reuse never resurrect an old decision', () => {
  const db = database();
  const id = adopt(db);
  db.prepare("DELETE FROM records WHERE record_id='r1'").run();
  assert.equal(db.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=? AND event_type='invalidated'").get(id).n,1);
  db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','other','other@example.test','Other','timesheets','pay_month_correction','Submitted','t','t','{}')`).run();
  assert.throws(() => adopt(db,1), /revision/);
  assert.equal(db.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get('r1').revision,3);
  db.close();
});

test('fresh databases include the review protections without a migration', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='timesheet_ownership_reviews'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='timesheet_review_revision_update'").get());
  db.close();
});
test('running the migration again preserves revisions and review history', () => {
  const db = database();
  const id = adopt(db);
  db.exec(readFileSync(migration, 'utf8'));
  assert.equal(db.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get('r1').revision,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=?').get(id).n,1);
  db.close();
});

test('identity and status changes invalidate the existing decision', () => {
  for (const [field, value] of [['owner_oid','different'], ['owner_upn','another@example.test'], ['employee_name','Another'], ['status','Deleted'], ['kind','clock']]) {
    const db = database();
    const id = adopt(db);
    db.prepare(`UPDATE records SET ${field}=? WHERE record_id='r1'`).run(value);
    assert.equal(db.prepare("SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=? AND event_type='invalidated'").get(id).n,1,field);
    assert.throws(() => adopt(db,1), /revision|unavailable/,field);
    db.close();
  }
});
test('the audit is rolled back if invalidation cannot be recorded', () => {
  const db = database();
  const id = adopt(db);
  db.exec("CREATE TRIGGER reject_invalidation BEFORE INSERT ON timesheet_ownership_review_events WHEN NEW.event_type='invalidated' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
  assert.throws(() => db.prepare("UPDATE records SET owner_oid='other' WHERE record_id='r1'").run(), /injected audit failure/);
  assert.equal(db.prepare("SELECT owner_oid FROM records WHERE record_id='r1'").get().owner_oid,'original-editor');
  assert.equal(db.prepare('SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?').get('r1').revision,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_ownership_review_events WHERE review_id=?').get(id).n,1);
  db.close();
});

test('a review cannot be adopted while workbook delivery is in flight or uncertain',()=>{
  for(const status of ['sending','sent','failed','uncertain']){
    const db=database();
    db.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES('r1',?,'t','t',1,'t')").run(status);
    assert.throws(()=>adopt(db),/delivery|gmt_timesheet_handoff_in_progress/,status);
    assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_ownership_reviews').get().n,0,status);db.close();
  }
});
