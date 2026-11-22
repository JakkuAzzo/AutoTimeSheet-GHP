import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../cloudflare-worker/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../cloudflare-worker/migrations/0042_reviewed_subject_write_lock.sql', import.meta.url), 'utf8');
const employee = '11111111-1111-4111-8111-111111111111';
const editor = '22222222-2222-4222-8222-222222222222';

function fixture(state, upgraded = false) {
  const db = new DatabaseSync(':memory:');
  if (upgraded) {
    const boundary = schema.indexOf('-- A correction may have been saved by Accounts');
    assert.ok(boundary > 0);
    db.exec(schema.slice(0, boundary));
    db.exec(migration);
  } else db.exec(schema);
  const insert = db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES (?,?,?,'Fictional','timesheets',?,'Queued for Accounts','t','t','{}')`);
  insert.run('correction', editor, 'accounts@example.test', 'pay_month_correction');
  insert.run('employee-source', employee, 'employee@example.test', 'submit');
  insert.run('other-editor-source', '44444444-4444-4444-8444-444444444444', 'other-editor@example.test', 'submit');
  insert.run('unreviewed-source', '55555555-5555-4555-8555-555555555555', 'unreviewed@example.test', 'submit');
  db.prepare(`INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at)
    VALUES ('employee-source','attachment','fictional.txt','text/plain','eA==',1,'t')`).run();
  db.prepare("INSERT INTO private_timesheet_subjects VALUES ('employee@example.test',?,'t')").run(employee);
  db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
    VALUES ('correction',1,?,?, 'reviewer','fictional','t')`).run('a'.repeat(64), employee);
  db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
    VALUES ('other-editor-source',1,?,?, 'reviewer','fictional','t')`).run('b'.repeat(64), employee);
  db.prepare(`INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at)
    VALUES ('correction',?,'t','t',0,'t')`).run(state);
  if (state !== 'sending') db.prepare(`INSERT INTO timesheet_delivery_routes
    VALUES ('correction','run','t','generation','employee-folder','month-folder','workbook','t')`).run();
  return { db, insert };
}

for (const state of ['sending', 'sent', 'failed', 'uncertain']) for (const upgraded of [false, true]) {
  test(`a reviewed employee's source is held while delivery is ${state} (${upgraded ? 'migration' : 'fresh schema'})`, () => {
    const { db, insert } = fixture(state, upgraded);
    assert.throws(() => insert.run('new-employee-source', employee, 'employee@example.test', 'submit'), /gmt_timesheet_.*in_progress/);
    assert.throws(() => db.prepare("UPDATE records SET payload_json='{} ' WHERE record_id='employee-source'").run(), /gmt_timesheet_.*in_progress/);
    assert.throws(() => db.prepare("DELETE FROM records WHERE record_id='employee-source'").run(), /gmt_timesheet_.*in_progress/);
    assert.throws(() => db.prepare("UPDATE records SET payload_json='{} ' WHERE record_id='other-editor-source'").run(), /gmt_timesheet_.*in_progress/);
    assert.throws(() => db.prepare(`INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at)
      VALUES ('employee-source','another','fictional.txt','text/plain','eA==',1,'t')`).run(), /gmt_timesheet_.*in_progress/);
    assert.throws(() => db.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='employee-source'").run(), /gmt_timesheet_.*in_progress/);
    assert.throws(() => db.prepare("DELETE FROM record_attachments WHERE record_id='employee-source'").run(), /gmt_timesheet_.*in_progress/);
    assert.throws(() => db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
      VALUES ('unreviewed-source',1,?,?,'reviewer','fictional','t')`).run('c'.repeat(64), employee), /gmt_timesheet_.*in_progress/);
    assert.doesNotThrow(() => insert.run('other-source', '33333333-3333-4333-8333-333333333333', 'other@example.test', 'submit'));
    db.close();
  });
}

test('revocation stays available and does not release the in-flight source lock', () => {
  const { db } = fixture('sending');
  const review = db.prepare("SELECT review_id FROM timesheet_ownership_reviews WHERE record_id='correction'").get().review_id;
  assert.doesNotThrow(() => db.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES (?,'revoked','reviewer','t')").run(review));
  assert.throws(() => db.prepare("UPDATE records SET payload_json='{} ' WHERE record_id='employee-source'").run(), /gmt_timesheet_.*in_progress/);
  db.close();
});

test('normal sender status transition does not bypass or break the subject lock', () => {
  const { db } = fixture('sent');
  assert.doesNotThrow(() => db.prepare("UPDATE records SET status='Sent to Accounts',updated_at='t' WHERE record_id='correction'").run());
  assert.throws(() => db.prepare("UPDATE records SET payload_json='{} ' WHERE record_id='employee-source'").run(), /gmt_timesheet_.*in_progress/);
  db.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='correction'").run();
  assert.doesNotThrow(() => db.prepare("UPDATE records SET payload_json='{} ' WHERE record_id='employee-source'").run());
  db.close();
});
