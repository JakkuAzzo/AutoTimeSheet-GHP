import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('attachment guard migration preserves old queues without inventing evidence',()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec(`CREATE TABLE records(record_id TEXT PRIMARY KEY);
      CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT NOT NULL);
      INSERT INTO records VALUES('fictional'); INSERT INTO dispatch_queue VALUES('fictional','queued');`);
    const migration=readFileSync(new URL('../cloudflare-worker/migrations/0033_timesheet_queue_attachment_guard.sql',import.meta.url),'utf8');
    sql.exec(migration);sql.exec(migration);
    assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='fictional'").get().status,'queued');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_queue_attachment_guards').get().n,0);
  } finally { sql.close(); }
});
