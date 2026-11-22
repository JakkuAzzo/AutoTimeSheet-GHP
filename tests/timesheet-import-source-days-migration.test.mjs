import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../cloudflare-worker/migrations/0038_timesheet_import_source_days.sql',import.meta.url),'utf8');
const imported=(days)=>JSON.stringify({importSourceId:'a'.repeat(64),rows:days.map(date=>({date}))});
test('imported day provenance is retained across edits, including old versions and unknown dates',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE records(record_id TEXT PRIMARY KEY,owner_oid TEXT,owner_upn TEXT,kind TEXT,action TEXT,payload_json TEXT);CREATE TABLE record_versions(record_id TEXT,owner_oid TEXT,payload_json TEXT)');
  const add=db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)');add.run('existing','oid-a','a@example.test','timesheets','submission',imported(['2026-10-05']));add.run('edited','oid-a','a@example.test','timesheets','submission','{"rows":[]}');
  db.prepare('INSERT INTO record_versions VALUES(?,?,?)').run('edited','oid-old',JSON.stringify({payload:JSON.parse(imported(['2026-09-05']))}));
  db.prepare('INSERT INTO record_versions VALUES(?,?,?)').run('edited','oid-old',JSON.stringify({payload:'not-json'}));
  add.run('unknown','oid-a','a@example.test','timesheets','submission',imported([]));add.run('ordinary','oid-a','a@example.test','timesheets','submission','{"rows":[]}');
  add.run('malformed','oid-a','a@example.test','timesheets','submission',JSON.stringify({importSourceId:'x',rows:['not an object',{date:'2026-02-30'}]}));
  add.run('document-import-lost','oid-a','a@example.test','timesheets','submission','{}');
  db.exec(migration);
  const rows=()=>db.prepare('SELECT record_id,owner_oid,source_day FROM timesheet_import_source_days ORDER BY record_id,owner_oid,source_day').all().map(x=>[x.record_id,x.owner_oid,x.source_day]);
  assert.deepEqual(rows(),[['document-import-lost','oid-a','*'],['edited','oid-old','2026-09-05'],['existing','oid-a','2026-10-05'],['malformed','oid-a','*'],['unknown','oid-a','*']]);
  db.prepare("UPDATE records SET payload_json='{}' WHERE record_id='existing'").run();
  add.run('new','oid-a','a@example.test','timesheets','submission',imported(['2026-11-01']));
  db.prepare("UPDATE records SET payload_json=? WHERE record_id='ordinary'").run(imported(['2026-12-01']));
  assert.deepEqual(rows(),[['document-import-lost','oid-a','*'],['edited','oid-old','2026-09-05'],['existing','oid-a','2026-10-05'],['malformed','oid-a','*'],['new','oid-a','2026-11-01'],['ordinary','oid-a','2026-12-01'],['unknown','oid-a','*']]);
  assert.throws(()=>db.prepare("DELETE FROM timesheet_import_source_days WHERE record_id='existing'").run(),/immutable/i);
 }finally{db.close()}
});
