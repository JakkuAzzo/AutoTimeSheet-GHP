import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolvePrivateTimesheetRoute,adminQueueStatus} from '../cloudflare-worker/src/index.js';
import {seedAttachmentGuards} from './helpers/seed-attachment-guards.mjs';

for(const mode of ['clear','sending','sender-after-route','lock-after-route','new-day-before','new-day-during-provider','other-address-during-provider','new-day-after-route','pay-period-after-route','changed-workbook','missing-proof','spoofed-synthetic']) {
  test(`the workbook route requires the current queued source: ${mode}`,async()=>{
    const sql=new DatabaseSync(':memory:');
    try {
      sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
      sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
      const started='2026-10-26T10:00:00.000Z', id='fixture', owner='alice@example.test';
      const payload={payMonth:'2026-10',editedAt:started,rows:[],deletedDays:[],...(mode==='spoofed-synthetic'?{testMode:true}:{})};
      const source={schemaVersion:2,mode:'replace-pay-month',recordId:id,employeeName:'Fictional',employeeUpn:owner,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:started,rows:[{recordId:`${id}|2026-10-01`,date:'2026-10-01'}],deletedDays:[]};
      const encoded=Buffer.from(JSON.stringify(source)).toString('base64'),generation=createHash('sha256').update(JSON.stringify(source)).digest('hex');
      sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
        VALUES(?,'alice-oid',?,'Fictional','timesheets','pay_month_correction','Queued for Accounts',?,?,?)`).run(id,owner,started,started,JSON.stringify(payload));
      for(const [field,name,type,data] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','eA=='],['attachment_csv','a.csv','text/csv','eA=='],['attachment_record','a.json','application/json',encoded]])
        sql.prepare('INSERT INTO record_attachments VALUES(?,?,?,?,?,?,?)').run(id,field,name,type,data,1,started);
      sql.prepare("INSERT INTO timesheet_queue_source_guards SELECT ?,owner_upn,revision,? FROM timesheet_owner_revisions WHERE owner_upn=?").run(id,encoded,owner);
      seedAttachmentGuards(sql);
      if(!['sending','sender-after-route'].includes(mode))sql.prepare("UPDATE records SET status='Sent to Accounts',updated_at=? WHERE record_id=?").run(started,id);
      sql.prepare('INSERT INTO dispatch_queue VALUES(?,?,?,?,1,?,?,NULL)').run(id,['sending','sender-after-route'].includes(mode)?'sending':'sent',started,started,started,started);
      const insertDay=()=>sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
        VALUES('new-day','alice-oid',?,'Fictional','timesheets','submission','Submitted',?,?,'{"rows":[]}')`).run(owner,started,started);
      if(mode==='new-day-before')insertDay();
      if(mode==='changed-workbook')sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id=? AND field_name='attachment'").run(id);
      if(['missing-proof','spoofed-synthetic'].includes(mode))sql.prepare('DELETE FROM timesheet_queue_source_guards WHERE record_id=?').run(id);
      let injected=false,afterRouteBlocked=false;
      const wrap=(statement,args=[])=>({bind(...values){return wrap(statement,values)},async first(){const value=sql.prepare(statement).get(...args)||null;
        if(!injected && ['new-day-after-route','pay-period-after-route'].includes(mode) && statement.includes('SELECT run_started_at,generation,employee_folder_id')){injected=true;try{if(mode==='new-day-after-route')insertDay();else sql.prepare("INSERT INTO pay_month_start_settings VALUES('2026-11','2026-10-26','reviewer','reviewer@example.test','t')").run()}catch(error){if(!String(error.message).includes('gmt_timesheet_delivery_in_progress'))throw error;afterRouteBlocked=true}}return value},
        async all(){return {results:sql.prepare(statement).all(...args)}},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
      const DB={prepare:statement=>wrap(statement)};let providerChecks=0;
      const options={privateDestinationCheck:async()=>{providerChecks++;if(mode==='new-day-during-provider')insertDay();if(mode==='other-address-during-provider')sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
        VALUES('other-address','alice-oid','alice-old@example.test','Fictional','timesheets','submission','Submitted',?,?,'{"rows":[]}')`).run(started,started);return {id:'employee-folder'}},workbookCheck:async()=>({folderId:'month-folder',workbookId:'book'})};
      const request={recordId:id,generation,flowRunId:'run',runStartedAt:started};
      const env=mode==='spoofed-synthetic'?{DB,SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false'}:{DB};
      if(['clear','sending','sender-after-route','lock-after-route','new-day-after-route','pay-period-after-route'].includes(mode)) {
        assert.equal((await resolvePrivateTimesheetRoute(env,request,options)).workbookId,'book');
        if(['new-day-after-route','pay-period-after-route'].includes(mode))assert.equal(afterRouteBlocked,true,'the issued route holds concurrent source changes');
        if(mode==='lock-after-route'){
          const held=(await adminQueueStatus({DB},{isAdmin:true})).records.find(row=>row.recordId===id);
          assert.equal(held.workbookWriteHold,true);
          assert.equal(held.deliveryReceipt.flowRunId,'run','Accounts can locate a routed run even if it sent no receipt');
          assert.equal(held.deliveryReceipt.workbookId,'book','the protected destination is available for review');
          assert.equal(held.deliveryReceipt.generation,generation,'the exact source generation is available for comparison');
          assert.deepEqual(held.deliveryReceipt.events,{});
          assert.throws(insertDay,/gmt_timesheet_delivery_in_progress/);
          assert.throws(()=>sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id=? AND field_name='attachment'").run(id),/gmt_timesheet_delivery_in_progress/);
          assert.throws(()=>sql.prepare("INSERT INTO pay_month_start_settings VALUES('2026-11','2026-10-26','reviewer','reviewer@example.test','t')").run(),/gmt_timesheet_delivery_in_progress/);
          sql.prepare("UPDATE dispatch_queue SET status='uncertain' WHERE record_id=?").run(id);
          assert.throws(insertDay,/gmt_timesheet_delivery_in_progress/,'an uncertain workbook write stays held');
          sql.prepare(`INSERT INTO timesheet_delivery_receipts(record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json)
            VALUES(?,'run',?,'flow_failed',?,?)`).run(id,started,started,JSON.stringify({generation,stage:'workbook_upsert'}));
          assert.throws(insertDay,/gmt_timesheet_delivery_in_progress/,'a failure receipt alone cannot prove that no workbook write occurred');
          sql.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id=?").run(id);
          assert.equal((await adminQueueStatus({DB},{isAdmin:true})).records.find(row=>row.recordId===id).workbookWriteHold,false);
          insertDay();
        }
        if(mode==='sender-after-route'){
          sql.prepare("UPDATE dispatch_queue SET status='sent' WHERE record_id=?").run(id);
          assert.throws(()=>sql.prepare("UPDATE records SET status='Sent to Accounts',updated_at=?,payload_json='{}' WHERE record_id=?").run(started,id),/gmt_timesheet_delivery_in_progress/);
          assert.throws(()=>sql.prepare("UPDATE records SET status='Sent to Accounts',updated_at=?,source_message_key='changed' WHERE record_id=?").run(started,id),/gmt_timesheet_delivery_in_progress/);
          sql.prepare("UPDATE records SET status='Sent to Accounts',updated_at=? WHERE record_id=?").run(started,id);
          assert.throws(insertDay,/gmt_timesheet_delivery_in_progress/,'the ordinary sender transition does not release the workbook lock');
        }
      }
      else {await assert.rejects(()=>resolvePrivateTimesheetRoute(env,request,options),error=>error.status===409);
        if(['new-day-before','changed-workbook','missing-proof','spoofed-synthetic'].includes(mode))assert.equal(providerChecks,0,'stale source cannot reach provider checks');}
    } finally {sql.close()}
  });
}
