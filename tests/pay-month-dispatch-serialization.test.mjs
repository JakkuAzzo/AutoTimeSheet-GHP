import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchQueued} from '../cloudflare-worker/src/index.js';
import {syntheticQueueCapability} from '../cloudflare-worker/src/synthetic-queue-capability.js';
import {seedAttachmentGuards} from './helpers/seed-attachment-guards.mjs';
const sql=new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
const editedAt='2026-10-03T10:00:00Z';
const payload=JSON.stringify({payMonth:'2026-10',weekStart:'2026-09-21',editedAt,editedBy:'Alice',rows:[{date:'2026-10-05',start:'08:00',finish:'17:00',breakMinutes:60}],deletedDays:[]});
for(const id of ['correction-one','correction-two']){
 sql.prepare('INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,'oid','alice@example.com','Alice','timesheets','pay_month_correction','Submitted','2026-10-01','2026-10-01',payload);
 sql.prepare("INSERT INTO dispatch_queue VALUES (?,'queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run(id);
 const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:id,employeeUpn:'alice@example.com',payMonth:'2026-10',submittedAt:editedAt,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:`${id}|2026-10-05`,date:'2026-10-05',startTime:'08:00',finishTime:'17:00',breakMinutes:60,absenceReason:'NA',totalMinutes:480,workedHours:8,note:'',changeNote:`Edited by Alice at ${editedAt}`}]});
 for(const [field,name,type,data] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','eA=='],['attachment_csv','a.csv','text/csv','eA=='],['attachment_record','a.json','application/json',Buffer.from(source).toString('base64')]])sql.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?,?)').run(id,field,name,type,data,Buffer.from(data,'base64').length,'2026-10-01');
}
sql.prepare("INSERT INTO timesheet_queue_source_guards SELECT r.record_id,r.owner_upn,(SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=r.owner_upn),a.content_base64 FROM records r JOIN record_attachments a ON a.record_id=r.record_id AND a.field_name='attachment_record'").run();
seedAttachmentGuards(sql);
const wrap=(statement,args=[])=>({async all(){return {results:sql.prepare(statement).all(...args)}},async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
const db={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}}};
let requests=0;
const result=await dispatchQueued({DB:db,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'synthetic-test-key-with-at-least-thirty-two-characters'},{now:'2026-11-03T10:00:00.000Z',fixtureDispatchCapability:syntheticQueueCapability,privateDestinationCheck:async()=>({id:'fixture'}),fetchImpl:async()=>{requests++;return new Response('{"success":true}',{status:200})}});
assert.equal(requests,1,'only one correction for an employee may be in flight');
assert.equal(result.sent,1);
assert.equal(sql.prepare("SELECT count(*) n FROM dispatch_queue WHERE status='queued'").get().n,1);
console.log('PASS: dispatch serializes correction records for an employee');
