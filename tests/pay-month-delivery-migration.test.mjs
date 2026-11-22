import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const db=new DatabaseSync(':memory:');
const schema=readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8').replace("'skipped', 'completed'", "'skipped'");
db.exec(schema);
// The publication source lock is installed after the historical queue rebuilds.
const publicationLock=readFileSync(new URL('../cloudflare-worker/migrations/0045_timesheet_publication_source_lock.sql',import.meta.url),'utf8');
const publicationAttempts=readFileSync(new URL('../cloudflare-worker/migrations/0046_timesheet_publication_attempts.sql',import.meta.url),'utf8');
const publicationBinding=readFileSync(new URL('../cloudflare-worker/migrations/0047_timesheet_publication_run_binding.sql',import.meta.url),'utf8');
for(const match of publicationLock.matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)/g))db.exec(`DROP TRIGGER ${match[1]}`);
for(const match of publicationAttempts.matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)/g))db.exec(`DROP TRIGGER ${match[1]}`);
for(const match of [...publicationLock.matchAll(/CREATE VIEW IF NOT EXISTS (\w+)/g)].reverse())db.exec(`DROP VIEW ${match[1]}`);
// The rebuilt queue migrations precede ownership review migration 0028.
// The fresh schema already contains its trigger, so remove that later trigger
// while testing the earlier migration sequence.
db.exec('DROP TRIGGER timesheet_review_validate');
// The handoff triggers also postdate the queue-rebuilding migrations.
for(const name of ['timesheet_handoff_record_insert','timesheet_handoff_record_update','timesheet_handoff_record_delete','timesheet_handoff_attachment_insert','timesheet_handoff_attachment_update','timesheet_handoff_attachment_delete','timesheet_handoff_review_insert','timesheet_write_record_insert','timesheet_write_record_update','timesheet_write_record_delete','timesheet_write_attachment_insert','timesheet_write_attachment_update','timesheet_write_attachment_delete','timesheet_write_review_insert','timesheet_write_period_insert','timesheet_write_period_update','timesheet_write_period_delete'])db.exec(`DROP TRIGGER ${name}`);
// Migration 0042 is also later than this historical starting point. Its
// views and triggers must not exist while 0025 and 0026 rebuild the queue.
for(const name of ['timesheet_reviewed_subject_record_insert','timesheet_reviewed_subject_record_update','timesheet_reviewed_subject_record_delete','timesheet_reviewed_subject_attachment_insert','timesheet_reviewed_subject_attachment_update','timesheet_reviewed_subject_attachment_delete','timesheet_reviewed_subject_review_insert'])db.exec(`DROP TRIGGER ${name}`);
db.exec('DROP VIEW timesheet_reviewed_locked_source_records; DROP VIEW timesheet_reviewed_locked_subjects');
// Completion triggers are installed only after the older queue rebuilds.
for(const name of ['timesheet_publication_completion_validate','timesheet_publication_completion_queue','timesheet_publication_completions_no_update','timesheet_publication_completions_no_delete'])db.exec(`DROP TRIGGER ${name}`);
db.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('id','oid','person@example.test','Person','timesheets','pay_month_correction','Submitted','t','t','{}')").run();
db.prepare("INSERT INTO dispatch_queue VALUES ('id','sent','queued','updated',2,'next','sent','error')").run();
const before=db.prepare('SELECT * FROM dispatch_queue').get();
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0025_completed_timesheet_delivery.sql',import.meta.url),'utf8'));
assert.deepEqual(db.prepare('SELECT * FROM dispatch_queue').get(),before,'migration preserves the queued delivery');
db.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='id'").run();
assert.equal(db.prepare('SELECT status FROM dispatch_queue').get().status,'completed');
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_dispatch_queue_due'").get().n,1);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: completed-delivery migration preserves the dispatch queue and its foreign keys');

const beforeUncertain = db.prepare('SELECT * FROM dispatch_queue').get();
db.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('old-failure','oid','person@example.test','Person','timesheets','pay_month_correction','Submitted','t','t','{}')").run();
db.prepare("INSERT INTO dispatch_queue VALUES ('old-failure','failed','queued','updated',1,'next',NULL,'prior error')").run();
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0026_uncertain_timesheet_handoff.sql',import.meta.url),'utf8'));
assert.deepEqual(db.prepare("SELECT * FROM dispatch_queue WHERE record_id='id'").get(),beforeUncertain,'uncertain migration preserves completed rows');
assert.equal(db.prepare("SELECT status FROM dispatch_queue WHERE record_id='old-failure'").get().status,'uncertain','historical attempted failures require reconciliation before replay');
assert.equal(db.prepare("SELECT last_error FROM dispatch_queue WHERE record_id='old-failure'").get().last_error,'prior error');
db.prepare("UPDATE dispatch_queue SET status='uncertain' WHERE record_id='id'").run();
assert.equal(db.prepare('SELECT status FROM dispatch_queue').get().status,'uncertain');
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0028_timesheet_ownership_review.sql',import.meta.url),'utf8'));
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='timesheet_review_validate'").get().n,1);
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0042_reviewed_subject_write_lock.sql',import.meta.url),'utf8'));
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='view' AND name='timesheet_reviewed_locked_subjects'").get().n,1);
db.exec(readFileSync(new URL('../cloudflare-worker/migrations/0043_timesheet_publication_completion.sql',import.meta.url),'utf8'));
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='timesheet_publication_completion_queue'").get().n,1);
db.exec(publicationLock);
db.exec(publicationAttempts);
db.exec(publicationBinding);
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='view' AND name='timesheet_publication_locked_subjects'").get().n,1);
