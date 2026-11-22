import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
for (const [id,kind,action,status,error] of [
  ['legacy','timesheets','pay_month_correction','completed','earlier provider warning'],
  ['inflight','timesheets','pay_month_correction','sent',''],
  ['other','tasks','create','completed','']
]) {
  db.prepare('INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,\'oid\',\'test@example.test\',\'Test\',?,?,\'Submitted\',\'t\',\'t\',\'{}\')').run(id,kind,action);
  db.prepare('INSERT INTO dispatch_queue VALUES (?,?,\'queued\',\'updated\',1,\'next\',\'sent\',?)').run(id,status,error);
}
const migration=readFileSync(new URL('../cloudflare-worker/migrations/0027_hold_legacy_timesheet_completions.sql',import.meta.url),'utf8');
db.exec(migration);
const row=db.prepare("SELECT * FROM dispatch_queue WHERE record_id='legacy'").get();
assert.equal(row.status,'uncertain','legacy completion cannot release the next correction without reconciliation');
assert.match(row.last_error,/earlier provider warning/,'retain the prior delivery warning');
assert.match(row.last_error,/reconciliation/i,'explain the hold');
assert.equal(row.attempts,1);
assert.equal(row.last_sent_at,'sent');
assert.equal(db.prepare("SELECT status FROM dispatch_queue WHERE record_id='inflight'").get().status,'sent');
assert.equal(db.prepare("SELECT status FROM dispatch_queue WHERE record_id='other'").get().status,'completed');
db.exec(migration);
assert.deepEqual(db.prepare("SELECT * FROM dispatch_queue WHERE record_id='legacy'").get(),row,'the hold is idempotent');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: legacy completed timesheet deliveries are safely held for reconciliation');
