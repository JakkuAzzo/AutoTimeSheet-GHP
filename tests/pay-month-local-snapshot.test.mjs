import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as worker from '../cloudflare-worker/src/index.js';

function fixture(race='') {
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  const insert=(id,oid='alice-oid',date='2026-10-05')=>sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES(?,?,'alice@example.test','Alice','timesheets','submission','Submitted','2026-10-01','2026-10-01',?)`).run(id,oid,JSON.stringify({rows:[{date,start:'09:00'}]}));
  insert('old');let fired=false;
  const DB={prepare(statement){const wrap=(args=[])=>({bind(...values){return wrap(values)},async first(){return sql.prepare(statement).get(...args)||null},async all(){
    const rows=sql.prepare(statement).all(...args);
    if(!fired && statement.includes('FROM records r') && race){fired=true;if(race==='record')insert('new','alice-oid','2026-10-06');if(race==='review')sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
      VALUES('old',1,?,'alice-oid','reviewer','evidence','t')`).run('a'.repeat(64));}
    if(fired && race==='other-address' && !sql.prepare("SELECT 1 FROM records WHERE record_id='other-address'").get())sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
      VALUES('other-address','alice-oid','alice-old@example.test','Alice','timesheets','submission','Submitted','2026-10-01','2026-10-01','{"rows":[{"date":"2026-10-06"}]}')`).run();
    return {results:rows};
  }});return wrap()}};
  return {sql,DB,insert};
}
const subject={oid:'alice-oid',upn:'alice@example.test'},period={start:'2026-09-21',cycleEnd:'2026-10-18'};
test('local snapshot selects matching records and carries their revision',async()=>{
  assert.equal(typeof worker.readLocalPayMonthSnapshot,'function','local snapshot reader must exist');
  const f=fixture();try{const snapshot=await worker.readLocalPayMonthSnapshot({DB:f.DB},subject,period,'correction');
    assert.deepEqual(snapshot.rows,[{date:'2026-10-05',start:'09:00'}]);assert.equal(snapshot.revision,1);
  }finally{f.sql.close()}
});
for(const race of ['record','review','other-address'])test(`a ${race} change during the local snapshot is rejected`,async()=>{
  assert.equal(typeof worker.readLocalPayMonthSnapshot,'function','local snapshot reader must exist');
  const f=fixture(race);try{await assert.rejects(()=>worker.readLocalPayMonthSnapshot({DB:f.DB},subject,period,'correction'),error=>error.status===409)}finally{f.sql.close()}
});
test('a different stored owner at the same address is not included',async()=>{
  assert.equal(typeof worker.readLocalPayMonthSnapshot,'function','local snapshot reader must exist');
  const f=fixture();try{f.insert('other','other-oid');await assert.rejects(()=>worker.readLocalPayMonthSnapshot({DB:f.DB},subject,period,'correction'),error=>error.status===409)}finally{f.sql.close()}
});
test('a source with the same account ID at a different address requires review',async()=>{
  const f=fixture();try{
    f.sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
      VALUES('old-address','alice-oid','alice-old@example.test','Alice','timesheets','submission','Submitted','2026-10-01','2026-10-01',?)`)
      .run(JSON.stringify({rows:[{date:'2026-10-06',start:'09:00'}]}));
    await assert.rejects(()=>worker.readLocalPayMonthSnapshot({DB:f.DB},subject,period,'correction'),error=>error.status===409);
  }finally{f.sql.close()}
});
for(const [day,oid,upn,held] of [['2026-10-05','alice-oid','alice@example.test',true],['2026-08-01','alice-oid','alice@example.test',false],['2026-10-05','bob-oid','bob@example.test',false],['*','alice-oid','alice@example.test',true]])test(`standalone imported source ${day} for ${upn} ${held?'holds':'does not hold'} this month`,async()=>{
  const f=fixture();try{f.sql.prepare('INSERT INTO timesheet_import_source_days VALUES(?,?,?,?)').run('source',oid,upn,day);if(held)await assert.rejects(()=>worker.readLocalPayMonthSnapshot({DB:f.DB},subject,period,'correction'),error=>error.status===409);else assert.equal((await worker.readLocalPayMonthSnapshot({DB:f.DB},subject,period,'correction')).rows.length,1)}finally{f.sql.close()}
});
