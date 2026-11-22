import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../cloudflare-worker/src/index.js';
import {createRegisterWorkbook,runRegisterOfficeScript} from './helpers/pay-month-register-office-script.mjs';

const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
const DB={prepare(sql){const s=(a=[])=>({bind(...v){return s(v)},first(){return db.prepare(sql).get(...a)||null},all(){return {results:db.prepare(sql).all(...a)}},run(){return {success:true,meta:db.prepare(sql).run(...a)}}});return s()}};
const recordId='edge-case-delivery',runStartedAt='2026-10-26T10:00:00.000Z',flowRunId='edge-case-run';
const source={mode:'replace-pay-month',recordId,employeeName:'Fictional',payMonth:'2026-10',rows:[
  {date:'2026-10-01',start:'22:00',finish:'02:00',breakMinutes:30,notes:'Overnight'},
  {date:'2026-10-02',absenceReason:'Sick',start:'',finish:'',breakMinutes:'',note:'No hours recorded'},
  {date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:'',note:'Break: 30 min'},
  {date:'2026-10-06',startTime:'09:00',finishTime:'12:00',breakMinutes:'',note:'Break not recorded'}
].map(row=>({...row,recordId:`${recordId}|${row.date}`}))};
const text=JSON.stringify(source),generation=createHash('sha256').update(text).digest('hex');
db.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,'fixture','fictional@example.test','Fictional','timesheets','pay_month_correction','Queued',?,?,'{}')").run(recordId,runStartedAt,runStartedAt);
db.prepare("INSERT INTO dispatch_queue VALUES (?,'sent',?,?,1,?,?,'')").run(recordId,runStartedAt,runStartedAt,runStartedAt,runStartedAt);
db.prepare("INSERT INTO record_attachments VALUES (?,'attachment_record','fixture.json','application/json',?,?,?)").run(recordId,Buffer.from(text).toString('base64'),Buffer.byteLength(text),runStartedAt);
db.prepare('INSERT INTO timesheet_delivery_routes VALUES (?,?,?,?,?,?,?,?)').run(recordId,flowRunId,runStartedAt,generation,'folder','month','book',runStartedAt);
const env={DB,TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-local-test-key-not-used-in-production'};
const callback=(event,extra={})=>worker.fetch(new Request('https://gmt.test/api/integrations/timesheet-delivery-receipts',{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':env.TIMESHEET_DELIVERY_CALLBACK_KEY},body:JSON.stringify({recordId,flowRunId,runStartedAt,generation,event,...extra})}),env,{});
const result=runRegisterOfficeScript(createRegisterWorkbook('Fictional','2026-10'),source);
assert.deepEqual(JSON.parse(result.verifiedRowsJson).map(({start,finish,breakMinutes,absence,totalMinutes})=>({start,finish,breakMinutes,absence,totalMinutes})),[
  {start:'22:00',finish:'02:00',breakMinutes:30,absence:'NA',totalMinutes:210},
  {start:'',finish:'',breakMinutes:null,absence:'Sick',totalMinutes:0},
  {start:'09:00',finish:'12:00',breakMinutes:30,absence:'NA',totalMinutes:150},
  {start:'09:00',finish:'12:00',breakMinutes:null,absence:'NA',totalMinutes:null}
]);
const started=await callback('flow_started');
assert.equal(started.status,200,await started.text());
const proof={workbookId:'book',created:result.created,updated:result.updated,unchanged:result.unchanged,verifiedRecordIds:result.verifiedRecordIds,verifiedRows:JSON.parse(result.verifiedRowsJson)};
assert.equal((await callback('workbook_verified',proof)).status,200,'the independently derived source agrees with saved edge-case rows');
assert.equal((await callback('flow_completed')).status,200);
const receipt=db.prepare("SELECT evidence_json FROM timesheet_delivery_receipts WHERE event_type='workbook_verified'").get().evidence_json;
assert.doesNotMatch(receipt,/Overnight|22:00|Sick/,'payroll row contents are not retained in the receipt audit');
console.log('PASS: independently checked receipts support overnight, sickness and recorded or unknown breaks');
