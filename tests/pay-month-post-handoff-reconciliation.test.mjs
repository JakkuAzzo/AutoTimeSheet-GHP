import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {releaseCompletedTimesheetDelivery,adminQueueStatus} from '../cloudflare-worker/src/index.js';
import {seedAttachmentGuards} from './helpers/seed-attachment-guards.mjs';

test('an unreadable protected source requires reconciliation before any release',async()=>{
  await assert.rejects(()=>releaseCompletedTimesheetDelivery({DB:{prepare(){throw new Error('must not reach database')}}},'correction','eA==','a'.repeat(64)),/source.*invalid/i);
});
for(const mode of ['unchanged','new-day','new-review','changed-workbook','no-proof','spoofed-synthetic','status-not-updated']) {
  test(`post-handoff completion reconciles current local source: ${mode}`,async()=>{
    const sql=new DatabaseSync(':memory:');
    try {
      sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
      const record=(id,action)=>sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
        VALUES(?,'alice-oid','alice@example.test','Fictional','timesheets',?,'Queued for Accounts','t','t','{"rows":[]}')`).run(id,action);
      record('correction','pay_month_correction');record('source','submission');
      if(mode==='spoofed-synthetic')sql.prepare("UPDATE records SET payload_json='{\"rows\":[],\"testMode\":true}' WHERE record_id='correction'").run();
      sql.prepare("INSERT INTO dispatch_queue VALUES('correction','sent','t','handoff',1,'t','handoff',NULL)").run();
      const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'correction',rows:[]});
      const encoded=Buffer.from(source).toString('base64');
      for(const [field,name,type] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['attachment_csv','a.csv','text/csv'],['attachment_record','a.json','application/json']])
        sql.prepare('INSERT INTO record_attachments VALUES(?,?,?,?,?,?,?)').run('correction',field,name,type,field==='attachment_record'?encoded:'eA==',field==='attachment_record'?Buffer.byteLength(source):1,'t');
      sql.prepare("INSERT INTO timesheet_queue_source_guards SELECT 'correction','alice@example.test',revision,? FROM timesheet_owner_revisions WHERE owner_upn='alice@example.test'").run(encoded);
      seedAttachmentGuards(sql);
      if(mode!=='status-not-updated')sql.prepare("UPDATE records SET status='Sent to Accounts',updated_at='handoff' WHERE record_id='correction'").run();
      if(mode==='new-day')record('source-two','submission');
      if(mode==='changed-workbook')sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='correction' AND field_name='attachment'").run();
      if(['no-proof','spoofed-synthetic'].includes(mode))sql.prepare("DELETE FROM timesheet_queue_source_guards WHERE record_id='correction'").run();
      if(mode==='new-review')sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
        VALUES('source',1,?,'alice-oid','reviewer','fictional-evidence','t')`).run('a'.repeat(64));
      const generation=createHash('sha256').update(source).digest('hex');
      const started='2026-11-03T10:00:00.000Z';
      sql.prepare("INSERT INTO timesheet_delivery_routes VALUES('correction','run',?,?,'employee','month','book',?)").run(started,generation,started);
      const receipt=sql.prepare('INSERT INTO timesheet_delivery_receipts(record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json) VALUES(?,?,?,?,?,?)');
      receipt.run('correction','run',started,'flow_started',started,JSON.stringify({generation}));
      receipt.run('correction','run',started,'workbook_verified',started,JSON.stringify({generation,workbookId:'book',sourceRowVerification:'source-row-v1',verifiedRows:[]}));
      receipt.run('correction','run',started,'flow_completed',started,JSON.stringify({generation}));
      const wrap=(statement,args=[])=>({bind(...values){return wrap(statement,values)},async all(){return {results:sql.prepare(statement).all(...args)}},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
      const DB={prepare:statement=>wrap(statement)};
      const environment=mode==='spoofed-synthetic'?{DB,SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false'}:{DB};
      await releaseCompletedTimesheetDelivery(environment,'correction',encoded,generation);
      assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='correction'").get().status,mode==='unchanged'?'completed':'sent');
      const view=await adminQueueStatus({DB},{isAdmin:true});
      assert.equal(view.records.find(row=>row.recordId==='correction').status,mode==='unchanged'?'completed':'uncertain');
      if(mode!=='unchanged')assert.match(view.records.find(row=>row.recordId==='correction').error,/reconciliation/i);
    } finally {sql.close()}
  });
}
