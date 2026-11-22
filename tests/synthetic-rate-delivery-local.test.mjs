import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../cloudflare-worker/src/index.js';
import {syntheticRateExample} from './helpers/synthetic-rate-attachments.mjs';
import {createRegisterWorkbook,runRegisterOfficeScript} from './helpers/pay-month-register-office-script.mjs';
import {seedAttachmentGuards} from './helpers/seed-attachment-guards.mjs';

test('the pinned fictional rate source survives script readback and a generation-bound local receipt',async()=>{
  const {correction,body}=syntheticRateExample(),file=body.attachments.find(item=>item.fieldName==='attachment_record'),source=JSON.parse(Buffer.from(file.contentBase64,'base64').toString());
  const book=createRegisterWorkbook('Nathan Private Synthetic','2026-10',{sourceRates:true}),result=runRegisterOfficeScript(book,source),rows=JSON.parse(result.verifiedRowsJson);
  assert.deepEqual(rows.map(row=>[row.sourceBasicMinutes,row.sourceOt15Minutes,row.sourceOt20Minutes]),[[120,60,0],[null,0,null]]);
  const db=new DatabaseSync(':memory:');try{
    db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
    const id=correction.recordId,owner=correction.employeeEmail,started='2026-11-16T13:00:00.000Z',generation=createHash('sha256').update(Buffer.from(file.contentBase64,'base64')).digest('hex');
    // Seed a fictional routed handoff to test the script/receipt contract.
    // This does not exercise or bypass the real imported-source queue hold.
    db.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,'fictional-oid',?,'Fictional','timesheets','pay_month_correction','Queued for Accounts',?,?,?)").run(id,owner,started,started,JSON.stringify({payMonth:'2026-10',editedAt:started,rows:[]}));
    for(const a of body.attachments)db.prepare('INSERT INTO record_attachments VALUES(?,?,?,?,?,?,?)').run(id,a.fieldName,a.fileName,a.contentType,a.contentBase64,a.sizeBytes,started);
    db.prepare('INSERT INTO timesheet_queue_source_guards SELECT ?,owner_upn,revision,? FROM timesheet_owner_revisions WHERE owner_upn=?').run(id,file.contentBase64,owner);seedAttachmentGuards(db);
    db.prepare("UPDATE records SET status='Sent to Accounts',updated_at=? WHERE record_id=?").run(started,id);
    db.prepare("INSERT INTO dispatch_queue VALUES(?,'sent',?,?,1,?,?,NULL)").run(id,started,started,started,started);
    db.prepare("INSERT INTO timesheet_delivery_routes VALUES(?,'fictional-run',?,?,'employee-folder','month-folder','fictional-book',?)").run(id,started,generation,started);
    const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values)},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}}});
    const env={DB:{prepare:sql=>wrap(sql)},TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-callback-key-at-least-thirty-two-characters'};
    const send=event=>worker.fetch(new Request('https://gmt.test/api/integrations/timesheet-delivery-receipts',{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':env.TIMESHEET_DELIVERY_CALLBACK_KEY},body:JSON.stringify({recordId:id,flowRunId:'fictional-run',runStartedAt:started,generation,...event})}),env,{});
    assert.equal((await send({event:'flow_started'})).status,200);
    const evidence={event:'workbook_verified',workbookId:'fictional-book',created:result.created,updated:result.updated,unchanged:result.unchanged,verifiedRecordIds:result.verifiedRecordIds,verifiedRows:rows};
    const altered=structuredClone(evidence);altered.verifiedRows[1].sourceBasicMinutes=0;assert.equal((await send(altered)).status,409,'an unknown basic value must not become zero');
    assert.equal((await send(evidence)).status,200);assert.equal((await send({event:'flow_completed'})).status,200);
    assert.equal(db.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(id).status,'completed');
    assert.equal(JSON.parse(db.prepare("SELECT evidence_json FROM timesheet_delivery_receipts WHERE event_type='workbook_verified'").get().evidence_json).generation,generation);
  }finally{db.close()}
});
