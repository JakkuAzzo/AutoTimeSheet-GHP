import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dispatchQueued } from '../cloudflare-worker/src/index.js';
import { syntheticQueueCapability } from '../cloudflare-worker/src/synthetic-queue-capability.js';
import { seedAttachmentGuards } from './helpers/seed-attachment-guards.mjs';

const sql = new DatabaseSync(':memory:');
for (const path of ['schema.sql', 'migrations/0012_pay_month_start_settings.sql']) {
  sql.exec(readFileSync(new URL(`../cloudflare-worker/${path}`, import.meta.url), 'utf8'));
}
const seedGuards=()=>sql.prepare("INSERT INTO timesheet_queue_source_guards SELECT r.record_id,r.owner_upn,(SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=r.owner_upn),a.content_base64 FROM records r JOIN record_attachments a ON a.record_id=r.record_id AND a.field_name='attachment_record' WHERE 1 ON CONFLICT(record_id) DO UPDATE SET owner_upn=excluded.owner_upn,owner_revision=excluded.owner_revision,source_base64=excluded.source_base64").run();
const editedAt='2026-10-03T10:00:00Z';
const payload = JSON.stringify({payMonth:'2026-10',weekStart:'2026-09-21',editedAt,editedBy:'Alice',rows:[{date:'2026-10-05',start:'08:00',finish:'17:00',breakMinutes:60}],deletedDays:[]});
for (const id of ['first','second']) {
  sql.prepare('INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,'oid','alice@example.test','Alice','timesheets','pay_month_correction','Submitted','2026-10-01','2026-10-01',payload);
  sql.prepare("INSERT INTO dispatch_queue VALUES (?,'queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run(id);
  const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:id,employeeUpn:'alice@example.test',payMonth:'2026-10',submittedAt:editedAt,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:`${id}|2026-10-05`,date:'2026-10-05',startTime:'08:00',finishTime:'17:00',breakMinutes:60,absenceReason:'NA',totalMinutes:480,workedHours:8,note:'',changeNote:`Edited by Alice at ${editedAt}`}]});
  for (const [field,name,type,data] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','eA=='],['attachment_csv','a.csv','text/csv','eA=='],['attachment_record','a.json','application/json',Buffer.from(source).toString('base64')]]) sql.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?,?)').run(id,field,name,type,data,Buffer.from(data,'base64').length,'2026-10-01');
}
seedGuards();
seedAttachmentGuards(sql);
const wrap=(statement,args=[])=>({async all(){return {results:sql.prepare(statement).all(...args)}},async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
const env={DB:{prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}}},FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'synthetic-test-key-with-at-least-thirty-two-characters'};
let calls=0;
const options={now:'2026-11-03T10:00:00.000Z',fixtureDispatchCapability:syntheticQueueCapability,privateDestinationCheck:async()=>({id:'fixture'}),fetchImpl:async()=>{calls++;throw new Error('connection lost after request');}};
const result=await dispatchQueued(env,options);
assert.equal(result.status,'awaiting-reconciliation');
assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='first'").get().status,'uncertain');
assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='second'").get().status,'queued');
await dispatchQueued(env,{...options,now:'2027-01-01T00:00:00.000Z'});
assert.equal(calls,1,'neither the uncertain handoff nor another correction for the same employee may be sent automatically');
sql.prepare("UPDATE dispatch_queue SET status='queued', next_attempt_at='2026-10-01'").run();
seedGuards();
const unavailable=await dispatchQueued(env,{...options,fetchImpl:async()=>new Response('',{status:503})});
assert.equal(unavailable.status,'awaiting-reconciliation','a provider error does not prove no delivery occurred');
assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='first'").get().status,'uncertain');
sql.prepare("UPDATE dispatch_queue SET status='queued', next_attempt_at='2026-10-01'").run();
sql.prepare("UPDATE records SET owner_oid='bob-oid',owner_upn='bob@example.test' WHERE record_id='second'").run();
seedGuards();
let throttledCalls=0;
await dispatchQueued(env,{...options,fetchImpl:async()=>{throttledCalls++;return new Response('',{status:429,headers:{'Retry-After':'600'}})}});
assert.equal(throttledCalls,1,'provider throttling stops the batch, even though the attempted handoff is held as uncertain');
assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='second'").get().status,'queued');
console.log('PASS: uncertain handoffs and overlapping employee corrections remain held');
