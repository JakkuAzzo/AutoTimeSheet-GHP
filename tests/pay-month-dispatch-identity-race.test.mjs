import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dispatchQueued } from '../cloudflare-worker/src/index.js';
import { syntheticQueueCapability } from '../cloudflare-worker/src/synthetic-queue-capability.js';
import { seedAttachmentGuards } from './helpers/seed-attachment-guards.mjs';

for (const [field, replacement] of [
  ['owner_oid', 'other-employee-oid'],
  ['owner_upn', 'other@example.test'],
  ['employee_name', 'Other employee'],
  ['kind', 'clock'],
  ['action', 'other_action'],
  ['status', 'Changed during verification'],
  ['start_date', '2026-09-22'],
  ['end_date', '2026-10-17'],
  ['record_date', '2026-10-01'],
  ['submitted_at', '2026-10-02'],
  ['updated_at', '2026-10-02'],
  ['issue', 'Changed during verification'],
  ['payload_json', '{"payMonth":"2026-11"}']
]) {
  test(`dispatch refuses a correction when ${field} changes during destination verification`, async () => {
    const sql = new DatabaseSync(':memory:');
    sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql', import.meta.url), 'utf8'));
    sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql', import.meta.url), 'utf8'));
    const editedAt='2026-10-03T10:00:00Z';
    const payload = JSON.stringify({ payMonth:'2026-10',weekStart:'2026-09-21',editedAt,editedBy:'Employee',rows:[{date:'2026-10-05',start:'09:00',finish:'12:00',breakMinutes:0}],deletedDays:[] });
    const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'correction',employeeUpn:'employee@example.test',payMonth:'2026-10',submittedAt:editedAt,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:'correction|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'',changeNote:`Edited by Employee at ${editedAt}`}]});
    const encoded=Buffer.from(source).toString('base64');
    sql.prepare('INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('correction', 'employee-oid', 'employee@example.test', 'Employee', 'timesheets', 'pay_month_correction', 'Queued for Accounts', '2026-10-01', '2026-10-01', payload);
    sql.prepare("INSERT INTO dispatch_queue VALUES ('correction','queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run();
    for (const [name, file, type] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['attachment_csv','a.csv','text/csv'], ['attachment_record','a.json','application/json']]) {
      sql.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?,?)').run('correction', name, file, type, 'eA==', 1, '2026-10-01');
    }
    sql.prepare("UPDATE record_attachments SET content_base64=?,size_bytes=? WHERE record_id='correction' AND field_name='attachment_record'").run(encoded,Buffer.byteLength(source));
    sql.prepare("INSERT INTO timesheet_queue_source_guards SELECT 'correction','employee@example.test',revision,? FROM timesheet_owner_revisions WHERE owner_upn='employee@example.test'").run(encoded);
    seedAttachmentGuards(sql);
    const wrap = (statement, args = []) => ({
      async all() { return { results: sql.prepare(statement).all(...args) }; },
      async first() { return sql.prepare(statement).get(...args) || null; },
      async run() { return { meta: { changes: sql.prepare(statement).run(...args).changes } }; }
    });
    const DB = { prepare(statement) { return { ...wrap(statement), bind(...args) { return wrap(statement, args); } }; } };
    let sends = 0;
    const env = { DB, FORM_SUBMIT_TIMESHEET_ENDPOINT: 'https://example.test', PAY_MONTH_REPLAY_READY: 'true', PRIVATE_TIMESHEET_DESTINATION_VERIFIED: 'true', TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED: 'true', TIMESHEET_WORKBOOK_PROVISIONING_ENABLED: 'true', TIMESHEET_DELIVERY_CALLBACK_KEY: 'synthetic-test-key-with-at-least-thirty-two-characters' };
    await dispatchQueued(env, {
      fixtureDispatchCapability:syntheticQueueCapability,
      now: '2026-11-03T10:00:00.000Z',
      privateDestinationCheck: async () => { sql.prepare(`UPDATE records SET ${field}=? WHERE record_id='correction'`).run(replacement); return { id: 'fixture' }; },
      fetchImpl: async () => { sends++; return new Response('{"success":true}', { status: 200 }); }
    });
    assert.equal(sends, 0, 'a stale destination check must not send the record');
    assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='correction'").get().status, 'queued');
    sql.close();
  });
}

test('a newly reviewed record cannot dispatch previously queued attachments without an attachment decision',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
  sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','old-editor','person@example.test','Person','timesheets','pay_month_correction','Queued for Accounts','2026-10-01','2026-10-01','{"rows":[]}')`).run();
  sql.prepare("INSERT INTO dispatch_queue VALUES ('r1','queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run();
  for(const [name,file,type] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['attachment_csv','a.csv','text/csv'],['attachment_record','a.json','application/json']])sql.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?,?)').run('r1',name,file,type,'eA==',1,'t');
  const wrap=(statement,args=[])=>({async all(){return {results:sql.prepare(statement).all(...args)}},async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
  const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}}};
  const env={DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-test-key-at-least-thirty-two-characters'};
  let sends=0;
  await dispatchQueued(env,{now:'2026-11-03T10:00:00.000Z',fixtureDispatchCapability:syntheticQueueCapability,privateDestinationCheck:async()=>{
    sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
      VALUES('r1',1,?,'subject-oid','reviewer-oid','review-1','t')`).run('a'.repeat(64));return {id:'fixture'};
  },fetchImpl:async()=>{sends++;return new Response('{"success":true}')}});
  assert.equal(sends,0);assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='r1'").get().status,'queued');sql.close();
});

test('a reviewed weekly timesheet cannot send unreviewed attachments',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
  sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','old-editor','person@example.test','Person','timesheets','weekly_correction','Queued for Accounts','2026-10-01','2026-10-01','{"rows":[]}')`).run();
  sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
    VALUES('r1',1,?,'subject-oid','reviewer-oid','review-1','t')`).run('a'.repeat(64));
  sql.prepare("INSERT INTO dispatch_queue VALUES ('r1','queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run();
  for(const [name,file,type] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['attachment_csv','a.csv','text/csv']])sql.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?,?)').run('r1',name,file,type,'eA==',1,'t');
  const wrap=(statement,args=[])=>({async all(){return {results:sql.prepare(statement).all(...args)}},async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
  const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}}};
  let sends=0;await dispatchQueued({DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test'},{now:'2026-11-03T10:00:00.000Z',fetchImpl:async()=>{sends++;return new Response('{"success":true}')}});
  assert.equal(sends,0);assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='r1'").get().status,'queued');sql.close();
});

test('a claim without a verifiable database result never sends the queued correction',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
  const editedAt='2026-10-03T10:00:00Z';
  const payload=JSON.stringify({payMonth:'2026-10',editedAt,editedBy:'Person',rows:[{date:'2026-10-05',start:'09:00',finish:'12:00',breakMinutes:0}],deletedDays:[]});
  const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'r1',employeeUpn:'person@example.test',payMonth:'2026-10',submittedAt:editedAt,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:'r1|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'',changeNote:`Edited by Person at ${editedAt}`}]});
  const encoded=Buffer.from(source).toString('base64');
  sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
    VALUES('r1','employee','person@example.test','Person','timesheets','pay_month_correction','Queued for Accounts','2026-10-01','2026-10-01',?)`).run(payload);
  sql.prepare("INSERT INTO dispatch_queue VALUES ('r1','queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run();
  for(const [name,file,type] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['attachment_csv','a.csv','text/csv'],['attachment_record','a.json','application/json']])sql.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?,?)').run('r1',name,file,type,'eA==',1,'t');
  sql.prepare("UPDATE record_attachments SET content_base64=?,size_bytes=? WHERE record_id='r1' AND field_name='attachment_record'").run(encoded,Buffer.byteLength(source));
  const wrap=(statement,args=[])=>({async all(){return {results:sql.prepare(statement).all(...args)}},async first(){return sql.prepare(statement).get(...args)||null},async run(){const result=sql.prepare(statement).run(...args);return statement.includes("SET status='sending'")?{}:{meta:{changes:result.changes}}}});
  sql.prepare("INSERT INTO timesheet_queue_source_guards SELECT 'r1','person@example.test',revision,? FROM timesheet_owner_revisions WHERE owner_upn='person@example.test'").run(encoded);
  seedAttachmentGuards(sql);
  const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}}};
  const env={DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-test-key-at-least-thirty-two-characters'};
  let sends=0;const result=await dispatchQueued(env,{now:'2026-11-03T10:00:00.000Z',fixtureDispatchCapability:syntheticQueueCapability,privateDestinationCheck:async()=>({id:'fixture'}),fetchImpl:async()=>{sends++;return new Response('{"success":true}')}});
  assert.equal(sends,0);assert.equal(result.status,'claim-unverified');
  assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='r1'").get().status,'sending','an unverified claim is not automatically retried');sql.close();
});
