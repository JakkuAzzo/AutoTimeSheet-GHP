import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../cloudflare-worker/migrations/0037_timesheet_import_source_hold.sql',import.meta.url),'utf8');
const payload=sourceId=>JSON.stringify({rows:[{date:'2026-10-05',sourceEvidence:{sourceId}}]});
test('source holds backfill old imports and survive later edits',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE records(record_id TEXT PRIMARY KEY,kind TEXT,action TEXT,payload_json TEXT); CREATE TABLE record_versions(record_id TEXT,payload_json TEXT)');
  const add=db.prepare('INSERT INTO records VALUES(?,?,?,?)');add.run('old','timesheets','pay_month_correction',payload('a'.repeat(64)));add.run('manual','timesheets','pay_month_correction','{"rows":[]}');add.run('bad-json','timesheets','pay_month_correction','{');add.run('other-kind','tasks','pay_month_correction',payload('b'.repeat(64)));
  add.run('older','timesheets','pay_month_correction','{"rows":[]}');db.prepare('INSERT INTO record_versions VALUES(?,?)').run('older',JSON.stringify({payload:JSON.parse(payload('e'.repeat(64)))}));
  db.exec(migration);assert.deepEqual(db.prepare('SELECT record_id FROM timesheet_import_source_holds ORDER BY record_id').all().map(x=>x.record_id),['old','older']);
  db.prepare("UPDATE records SET payload_json='{}' WHERE record_id='old'").run();assert.equal(db.prepare('SELECT count(*) n FROM timesheet_import_source_holds').get().n,2);
  assert.throws(()=>db.prepare("DELETE FROM timesheet_import_source_holds WHERE record_id='old'").run(),/immutable/i);
  add.run('new','timesheets','pay_month_correction',payload('c'.repeat(64)));db.prepare("UPDATE records SET payload_json=? WHERE record_id='manual'").run(payload('d'.repeat(64)));
  assert.deepEqual(db.prepare('SELECT record_id FROM timesheet_import_source_holds ORDER BY record_id').all().map(x=>x.record_id),['manual','new','old','older']);
 }finally{db.close()}
});
