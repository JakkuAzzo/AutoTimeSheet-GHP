import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readLocalPayMonthSnapshot, validateCompletePayMonthSource, queueRecordAttachments } from '../cloudflare-worker/src/index.js';

for(const race of ['none','record','other-address','review','import-source']) test(`queue binds the verified local snapshot when ${race} changes`,async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  const payload={payMonth:'2026-10',editedAt:'2026-11-03T10:00:00Z',editedBy:'Alice',rows:[{date:'2026-10-06',start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA',note:'Edited'}],deletedDays:[]};
  const insert=(id,action,data)=>sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES(?,'alice-oid','alice@example.test','Alice','timesheets',?,'Submitted','2026-10-01','2026-10-01',?)`).run(id,action,JSON.stringify(data));
  insert('old','submission',{rows:[{date:'2026-10-05',start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA',note:'Prior'}]});
  insert('current','pay_month_correction',payload);
  const record=sql.prepare("SELECT * FROM records WHERE record_id='current'").get();
  const period={start:'2026-09-21',cycleEnd:'2026-10-18'};
  const source={schemaVersion:2,mode:'replace-pay-month',recordId:'current',employeeUpn:'alice@example.test',payMonth:'2026-10',submittedAt:payload.editedAt,cycleStart:period.start,cycleEnd:period.cycleEnd,deletedDays:[],rows:[
    {recordId:'current|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'Prior',changeNote:''},
    {recordId:'current|2026-10-06',date:'2026-10-06',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'Edited',changeNote:'Edited by Alice at 2026-11-03T10:00:00Z'}]};
  const b64=value=>Buffer.from(value).toString('base64');
  const body={attachments:[{fieldName:'attachment',fileName:'file.xlsx',contentBase64:b64('x')},{fieldName:'attachment_csv',fileName:'file.csv',contentBase64:b64('x')},{fieldName:'attachment_record',fileName:'source.json',contentBase64:b64(JSON.stringify(source))}]};
  let injected=false;
  const DB={prepare(statement){const bound=(args=[])=>({bind(...values){return bound(values)},async first(){return sql.prepare(statement).get(...args)||null},async all(){return {results:sql.prepare(statement).all(...args)}},async run(){const before=sql.prepare('SELECT total_changes() AS n').get().n;sql.prepare(statement).run(...args);return {meta:{changes:sql.prepare('SELECT total_changes() AS n').get().n-before}}}});return bound()},async batch(statements){
    if(!injected){injected=true;if(race==='record')insert('new','submission',{rows:[{date:'2026-10-07'}]});
      if(race==='other-address')sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
        VALUES('new','alice-oid','alice-old@example.test','Alice','timesheets','submission','Submitted','2026-10-01','2026-10-01','{"rows":[{"date":"2026-10-07"}]}')`).run();
      if(race==='import-source')sql.prepare("INSERT INTO timesheet_import_source_days VALUES('imported','alice-oid','alice@example.test','2026-10-05')").run();
      if(race==='review')sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
        VALUES('old',1,?,'alice-oid','reviewer','evidence','t')`).run('a'.repeat(64));}
    sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}
  }};
  try {
    const snapshot=await readLocalPayMonthSnapshot({DB},{oid:'alice-oid',upn:'alice@example.test'},period,'current');
    validateCompletePayMonthSource(record,snapshot.rows,body.attachments,period);
    if(race==='none')assert.equal((await queueRecordAttachments({DB},record,body,null,snapshot.revision)).queued,true);
    else {await assert.rejects(()=>queueRecordAttachments({DB},record,body,null,snapshot.revision),error=>error.status===409);
      assert.equal(sql.prepare('SELECT count(*) AS n FROM record_attachments').get().n,0);assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);}
  } finally {sql.close()}
});
