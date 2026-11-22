import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { adminDispatchQueued, dispatchQueued } from '../cloudflare-worker/src/index.js';
import { syntheticQueueCapability } from '../cloudflare-worker/src/synthetic-queue-capability.js';
import { seedAttachmentGuards } from './helpers/seed-attachment-guards.mjs';

for (const mode of ['conflict', 'source-race', 'other-address-race', 'review-race', 'source-hold-race','import-day-race','source-replaced-at-claim', 'failed-routed', 'failed-route-race', 'failed-unrouted', 'clear','unreviewed-v2','unreviewed-v2-dry-run','admin-unreviewed-v2','unreviewed-v2-wrong-host','unreviewed-v2-string','unreviewed-v2-no-destination','unreviewed-v2-no-fetch','rate-disabled','rate-enabled','import-hold']) {
  test(`dispatch checks local timesheet history: ${mode}`, async () => {
    const sql = new DatabaseSync(':memory:');
    try {
      sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql', import.meta.url), 'utf8'));
      sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql', import.meta.url), 'utf8'));
      const insert = (id, action, rows) => sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
        VALUES(?,?,?,'Fictional','timesheets',?,?, '2026-10-01','2026-10-01',?)`)
        .run(id, 'alice-oid', 'alice@example.test', action, action === 'pay_month_correction' ? 'Queued for Accounts' : 'Submitted',
          JSON.stringify(action === 'pay_month_correction' ? {payMonth:'2026-10',rows:[]} : {rows}));
      const day = finish => [{date:'2026-10-05',start:'08:00',finish,breakMinutes:60}];
      insert('correction','pay_month_correction',[]);
      const editedAt='2026-10-03T10:00:00Z';
      sql.prepare("UPDATE records SET payload_json=? WHERE record_id='correction'").run(JSON.stringify({payMonth:'2026-10',editedAt,rows:[],deletedDays:[]}));
      insert('source-a','submission',day('17:00'));
      if(mode==='import-hold')sql.prepare("INSERT INTO timesheet_import_source_holds VALUES('correction','2026-10-01')").run();
      if (mode === 'conflict') insert('source-b','submission',day('18:00'));
      sql.prepare("INSERT INTO dispatch_queue VALUES ('correction','queued','2026-10-01','2026-10-01',0,'2026-10-01',NULL,NULL)").run();
      const rates=mode.startsWith('rate-')?{sourceBasicMinutes:null,sourceOt15Minutes:null,sourceOt20Minutes:null}:{};
      const source=JSON.stringify({schemaVersion:mode.startsWith('rate-')?3:2,mode:'replace-pay-month',recordId:'correction',employeeUpn:'alice@example.test',payMonth:'2026-10',submittedAt:editedAt,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:'correction|2026-10-05',date:'2026-10-05',startTime:'08:00',finishTime:'17:00',breakMinutes:60,absenceReason:'NA',totalMinutes:480,workedHours:8,note:'',changeNote:'',...rates}]});
      const encoded=Buffer.from(source).toString('base64');
      for (const [field,file,type,data] of [['attachment','a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','eA=='],['attachment_csv','a.csv','text/csv','eA=='],['attachment_record','a.json','application/json',encoded]])
        sql.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?,?)').run('correction',field,file,type,data,Buffer.from(data,'base64').length,'2026-10-01');
      sql.prepare(`INSERT INTO timesheet_queue_source_guards SELECT 'correction','alice@example.test',revision,? FROM timesheet_owner_revisions WHERE owner_upn='alice@example.test'`).run(encoded);
      seedAttachmentGuards(sql);
      if (mode.startsWith('failed-')) {
        sql.prepare("UPDATE dispatch_queue SET status='failed' WHERE record_id='correction'").run();
      }
      if (mode === 'failed-routed') {
        sql.prepare("INSERT INTO timesheet_delivery_routes VALUES('correction','old-run','2026-10-02',?,'employee','month','workbook','2026-10-02')").run('a'.repeat(64));
      }
      let injected = false;
      const wrap = (statement, args = []) => ({
        bind(...values) { return wrap(statement, values); },
        async all() { return {results:sql.prepare(statement).all(...args)}; },
        async first() { return sql.prepare(statement).get(...args) || null; },
        async run() {
          if (!injected && statement.includes("SET status='sending'")) {
            injected = true;
            if (mode === 'source-race') insert('source-b','submission',day('18:00'));
            if (mode === 'other-address-race') sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
              VALUES('source-b','alice-oid','alice-old@example.test','Fictional','timesheets','submission','Submitted','2026-10-01','2026-10-01',?)`).run(JSON.stringify({rows:day('18:00')}));
            if (mode === 'source-replaced-at-claim') {
              const changed=Buffer.from(JSON.stringify({...JSON.parse(source),rows:[...JSON.parse(source).rows,{...JSON.parse(source).rows[0],recordId:'correction|2026-10-06',date:'2026-10-06'}]})).toString('base64');
              sql.prepare("UPDATE record_attachments SET content_base64=?,size_bytes=? WHERE record_id='correction' AND field_name='attachment_record'").run(changed,Buffer.from(changed,'base64').length);
              sql.prepare("UPDATE timesheet_queue_source_guards SET source_base64=? WHERE record_id='correction'").run(changed);
              seedAttachmentGuards(sql);
            }
            if (mode === 'review-race') sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
              VALUES('source-a',1,?,'alice-oid','reviewer','fictional-evidence','2026-10-03')`).run('a'.repeat(64));
            if (mode === 'source-hold-race') sql.prepare("INSERT INTO timesheet_import_source_holds VALUES('correction','2026-10-01')").run();
            if (mode === 'import-day-race') sql.prepare("INSERT INTO timesheet_import_source_days VALUES('imported','alice-oid','alice@example.test','2026-10-05')").run();
            if (mode === 'failed-route-race') sql.prepare("INSERT INTO timesheet_delivery_routes VALUES('correction','old-run','2026-10-02',?,'employee','month','workbook','2026-10-02')").run('a'.repeat(64));
          }
          return {meta:{changes:sql.prepare(statement).run(...args).changes}};
        }
      });
      const env = {DB:{prepare:statement=>wrap(statement)},FORM_SUBMIT_TIMESHEET_ENDPOINT:mode==='unreviewed-v2-wrong-host'?'https://formsubmit.co/ajax/fixture':'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-key-with-at-least-32-characters'};
      if(mode==='rate-enabled')env.PAY_MONTH_RATE_DELIVERY_READY='true';
      let sends = 0;
      const options={now:'2026-11-03T10:00:00.000Z',...(mode==='unreviewed-v2'||mode==='unreviewed-v2-dry-run'?{}:{fixtureDispatchCapability:mode==='unreviewed-v2-string'?'synthetic':syntheticQueueCapability}),...(mode==='unreviewed-v2-dry-run'?{dryRun:true}:{}),...(mode==='unreviewed-v2-no-destination'?{}:{privateDestinationCheck:async()=>({id:'fixture'})}),...(mode==='unreviewed-v2-no-fetch'?{}:{fetchImpl:async()=>{sends++;return new Response('{"success":true}');}})};
      const result = mode==='admin-unreviewed-v2' ? await adminDispatchQueued(env,{isAdmin:true},options) : await dispatchQueued(env,options);
      if (['source-race','other-address-race','review-race','source-hold-race','import-day-race','source-replaced-at-claim','failed-route-race'].includes(mode)) assert.ok(injected, 'the race must be injected at the send claim');
      assert.equal(sends,['clear','failed-unrouted'].includes(mode) ? 1 : 0);
      assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='correction'").get().status,
        ['clear','failed-unrouted'].includes(mode) ? 'sent' : mode.startsWith('failed-') ? 'failed' : 'queued');
      if(mode.includes('unreviewed-v2')){assert.equal(result.status,'awaiting-source-review');assert.equal(sql.prepare("SELECT attempts FROM dispatch_queue WHERE record_id='correction'").get().attempts,0);}
      if (mode === 'conflict') assert.equal(result.deferred,1);
    } finally { sql.close(); }
  });
}
