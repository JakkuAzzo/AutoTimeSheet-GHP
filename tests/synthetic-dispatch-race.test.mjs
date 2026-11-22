import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dispatchQueued } from '../cloudflare-worker/src/index.js';

for (const race of ['none','edit','review','claimed']) test(`synthetic queue skip preserves consistency: ${race}`,async()=>{
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
  sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','owner','person@example.test','Fictional','timesheets','weekly_correction','Queued for Accounts','t','t','{"testMode":true}')`).run();
  sql.prepare("INSERT INTO dispatch_queue VALUES ('r1','queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run();
  const wrap=(statement,args=[])=>({statement,args,async all(){return {results:sql.prepare(statement).all(...args)}},async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
  const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}},async batch(statements){
    if(race==='edit')sql.prepare("UPDATE records SET payload_json='{}' WHERE record_id='r1'").run();
    if(race==='claimed')sql.prepare("UPDATE dispatch_queue SET status='sending' WHERE record_id='r1'").run();
    if(race==='review')sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
      VALUES('r1',1,?,'subject','reviewer','evidence','t')`).run('a'.repeat(64));
    sql.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}
  }};
  const result=await dispatchQueued({DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test'},{now:'2026-11-03T10:00:00Z',fetchImpl:async()=>{throw new Error('synthetic data must never be sent')}});
  const queue=sql.prepare("SELECT status,last_error FROM dispatch_queue WHERE record_id='r1'").get();
  const row=sql.prepare("SELECT status,payload_json FROM records WHERE record_id='r1'").get();
  if(race==='none'){
    assert.equal(result.skipped,1);assert.equal(queue.status,'skipped');assert.match(queue.last_error,/Synthetic/);assert.equal(row.status,'Test - not sent');
  }else{
    assert.equal(result.skipped,0);assert.equal(queue.status,race==='claimed'?'sending':'queued');assert.equal(row.status,'Queued for Accounts');
  }
  sql.close();
});
