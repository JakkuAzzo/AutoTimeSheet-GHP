import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../cloudflare-worker/src/index.js';
import {seedAttachmentGuards} from './helpers/seed-attachment-guards.mjs';

for(const schemaVersion of [2,3]) test(`lost receipt responses can be retried without repeating workbook writes, schema ${schemaVersion}`,async()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
    const id='fictional-correction',day='2026-10-05',started='2026-11-03T10:00:00.000Z',owner='alice@example.test';
    const rates=schemaVersion===3?{sourceBasicMinutes:120,sourceOt15Minutes:60,sourceOt20Minutes:null}:{};
    const source={schemaVersion,mode:'replace-pay-month',recordId:id,employeeName:'Fictional',employeeUpn:owner,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:started,rows:[{recordId:`${id}|${day}`,date:day,startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,note:'Fictional',...rates}],deletedDays:[]};
    const encoded=Buffer.from(JSON.stringify(source)).toString('base64'),generation=createHash('sha256').update(JSON.stringify(source)).digest('hex');
    sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
      VALUES(?,'alice-oid',?,'Fictional','timesheets','pay_month_correction','Queued for Accounts',?,?,?)`).run(id,owner,started,started,JSON.stringify({payMonth:'2026-10',editedAt:started,rows:[]}));
    for(const [field,name,type,data] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','eA=='],['attachment_csv','a.csv','text/csv','eA=='],['attachment_record','a.json','application/json',encoded]])
      sql.prepare('INSERT INTO record_attachments VALUES(?,?,?,?,?,?,?)').run(id,field,name,type,data,1,started);
    sql.prepare("INSERT INTO timesheet_queue_source_guards SELECT ?,owner_upn,revision,? FROM timesheet_owner_revisions WHERE owner_upn=?").run(id,encoded,owner);seedAttachmentGuards(sql);
    sql.prepare("UPDATE records SET status='Sent to Accounts',updated_at=? WHERE record_id=?").run(started,id);
    sql.prepare("INSERT INTO dispatch_queue VALUES(?,'sent',?,?,1,?,?,NULL)").run(id,started,started,started,started);
    sql.prepare("INSERT INTO timesheet_delivery_routes VALUES(?,'run-one',?,?,'employee-folder','month-folder','book',?)").run(id,started,generation,started);
    let failAfterInsert='';
    const wrap=(statement,args=[])=>({bind(...values){return wrap(statement,values)},async first(){return sql.prepare(statement).get(...args)||null},async all(){return {results:sql.prepare(statement).all(...args)}},async run(){
      const result=sql.prepare(statement).run(...args);
      if(failAfterInsert && statement.includes('INSERT INTO timesheet_delivery_receipts') && args[3]===failAfterInsert){failAfterInsert='';throw new Error('fictional response lost after commit')}
      return {meta:{changes:result.changes}};
    }});
    const env={DB:{prepare:statement=>wrap(statement)},TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-callback-key-at-least-thirty-two-characters'};
    const callback=event=>worker.fetch(new Request('https://gmt.test/api/integrations/timesheet-delivery-receipts',{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':env.TIMESHEET_DELIVERY_CALLBACK_KEY},body:JSON.stringify({recordId:id,flowRunId:'run-one',runStartedAt:started,generation,...event})}),env,{});
    const startedEvent={event:'flow_started'},verified={event:'workbook_verified',workbookId:'book',created:0,updated:0,unchanged:1,verifiedRecordIds:[`${id}|${day}`],verifiedRows:[{recordId:`${id}|${day}`,date:day,start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA',totalMinutes:180,notes:'Fictional',...rates}]},completed={event:'flow_completed'};
    failAfterInsert='flow_started';assert.equal((await callback(startedEvent)).status,500,'the start response can be lost after persistence');
    assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id=?").get(id).status,'sent');
    assert.equal(sql.prepare("SELECT count(*) AS n FROM timesheet_delivery_receipts WHERE record_id=? AND event_type='flow_started'").get(id).n,1);
    assert.equal((await callback(startedEvent)).status,200,'retrying the same start receipt does not create another event');
    failAfterInsert='workbook_verified';assert.equal((await callback(verified)).status,500,'the first response can be lost after persistence');
    assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id=?").get(id).status,'sent');
    assert.throws(()=>sql.prepare("UPDATE records SET payload_json='{}' WHERE record_id=?").run(id),/gmt_timesheet_delivery_in_progress/);
    assert.equal((await callback(verified)).status,200,'the same original evidence is idempotent');
    assert.equal((await callback({...verified,unchanged:0,updated:1})).status,409,'changed evidence is rejected');
    failAfterInsert='flow_completed';assert.equal((await callback(completed)).status,500);
    assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id=?").get(id).status,'sent');
    assert.equal((await callback(completed)).status,200,'retrying only the original completion releases the verified generation');
    assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id=?").get(id).status,'completed');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM timesheet_delivery_receipts WHERE record_id=?').get(id).n,3);
    sql.prepare("UPDATE records SET issue='fictional post-completion edit' WHERE record_id=?").run(id);
  } finally {sql.close()}
});
