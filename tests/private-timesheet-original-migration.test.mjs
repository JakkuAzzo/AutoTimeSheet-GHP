import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('adding original-filing tables leaves existing records and attachments unchanged',()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON; CREATE TABLE records(record_id TEXT PRIMARY KEY,payload_json TEXT); CREATE TABLE record_attachments(record_id TEXT,content_base64 TEXT);');
    sql.prepare('INSERT INTO records VALUES(?,?)').run('existing','{"rows":[{"date":"2026-10-05"}]}');
    sql.prepare('INSERT INTO record_attachments VALUES(?,?)').run('existing','eA==');
    const before=JSON.stringify([sql.prepare('SELECT * FROM records').all(),sql.prepare('SELECT * FROM record_attachments').all()]);
    const migration=readFileSync(new URL('../cloudflare-worker/migrations/0036_timesheet_original_filing.sql',import.meta.url),'utf8');
    sql.exec(migration);sql.exec(migration);
    assert.equal(JSON.stringify([sql.prepare('SELECT * FROM records').all(),sql.prepare('SELECT * FROM record_attachments').all()]),before);
    for(const table of ['timesheet_original_filing_intents','timesheet_original_filing_revocations','timesheet_private_originals'])assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
  }finally{sql.close()}
});
