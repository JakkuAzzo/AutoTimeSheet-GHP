import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, {dispatchQueued} from '../cloudflare-worker/src/index.js';
import {syntheticQueueCapability} from '../cloudflare-worker/src/synthetic-queue-capability.js';
import {seedAttachmentGuards} from './helpers/seed-attachment-guards.mjs';

test('the real queue route holds local conflicts and a changed local snapshot', async () => {
  const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', aud='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', oid='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='queue-conflict-fixture';
  const b64=x=>Buffer.from(x).toString('base64url');const unsigned=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid,preferred_username:'reviewer@example.test'}));
  const token=unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));
  const oldFetch=globalThis.fetch;globalThis.fetch=async url=>{if(String(url).includes('/discovery/v2.0/keys'))return Response.json({keys:[jwk]});throw Error('Unexpected network request')};
  try {
    for (const mode of ['legacy-extra','extra-unreviewed','conflict','claimed-authoritative','claimed-variant','race','review','empty','altered-local','omitted-local','clear','handoff-locked','handoff-timeout','new-day','changed-attachment','changed-workbook','changed-csv','renamed-workbook','extra-attachment','changed-after-claim','source-after-claim','legacy-unverified','legacy-attachment-unverified']) {
      const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
      const insert=(id,action,rows)=>sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,?,'Fictional','timesheets',?,'Submitted','2026-10-01','2026-10-01',?)`).run(id,oid,'reviewer@example.test',action,JSON.stringify(action==='pay_month_correction'?{payMonth:'2026-10',editedAt:'2026-10-03T10:00:00Z',rows,deletedDays:[]}:{rows}));
      insert('current','pay_month_correction',[]);insert('source-a','submission',[{date:'2026-10-05',start:'08:00',finish:'17:00',breakMinutes:60}]);
      if(mode==='handoff-locked')sql.prepare("UPDATE records SET status='Draft' WHERE record_id='source-a'").run();
      if(['conflict','claimed-authoritative','claimed-variant'].includes(mode))insert('source-b','submission',[{date:'2026-10-05',start:'08:00',finish:'18:00',breakMinutes:60}]);
      if(mode==='claimed-authoritative')sql.prepare("UPDATE records SET payload_json=? WHERE record_id='source-a'").run(JSON.stringify({reconciliation:{status:'authoritative'},rows:[{date:'2026-10-05',start:'08:00',finish:'17:00',breakMinutes:60}]}));
      if(mode==='claimed-variant')sql.prepare("UPDATE records SET payload_json=? WHERE record_id='source-b'").run(JSON.stringify({reconciliation:{status:'source-variant'},rows:[{date:'2026-10-05',start:'08:00',finish:'18:00',breakMinutes:60}]}));
      let injected=false,afterClaimInjected=false;const wrap=(statement,args=[])=>({bind(...v){return wrap(statement,v)},async first(){return sql.prepare(statement).get(...args)||null},async all(){if(!afterClaimInjected && /SELECT field_name, file_name, content_type, content_base64, size_bytes/.test(statement)){afterClaimInjected=true;if(mode==='changed-after-claim')sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='current' AND field_name='attachment'").run();if(mode==='source-after-claim')insert('source-b','submission',[{date:'2026-10-06',start:'08:00',finish:'17:00',breakMinutes:60}]);}return {results:sql.prepare(statement).all(...args)}},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
      const DB={prepare:statement=>wrap(statement),async batch(statements){if(!injected){injected=true;if(mode==='race')insert('source-b','submission',[{date:'2026-10-05',start:'08:00',finish:'18:00',breakMinutes:60}]);if(mode==='review')sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES('source-a',1,?,?,?,'fictional-evidence','2026-10-03')`).run('a'.repeat(64),oid,oid)}sql.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sql.exec('COMMIT');return out}catch(error){sql.exec('ROLLBACK');throw error}}};
      const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:aud,SUBMISSIONS_ADMIN_UPNS:'reviewer@example.test',ALLOWED_ORIGINS:'https://gmt.test'};
      const envelope={schemaVersion:2,mode:'replace-pay-month',recordId:'current',employeeUpn:'reviewer@example.test',payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:'2026-10-03T10:00:00Z',rows:[{recordId:'current|2026-10-05',date:'2026-10-05',startTime:'08:00',finishTime:'17:00',breakMinutes:60,absenceReason:'NA',totalMinutes:480,workedHours:8,note:'',changeNote:''}],deletedDays:[]};
      if (mode==='extra-unreviewed') envelope.rows.push({...envelope.rows[0],recordId:'current|2026-10-06',date:'2026-10-06'});
      if (mode==='empty') envelope.rows=[];
      if (mode==='altered-local') envelope.rows[0]={...envelope.rows[0],finishTime:'18:00',totalMinutes:540,workedHours:9};
      if (mode==='omitted-local') envelope.rows=[{...envelope.rows[0],recordId:'current|2026-10-06',date:'2026-10-06'}];
      const attachment=(fieldName,fileName,data)=>({fieldName,fileName,contentBase64:Buffer.from(data).toString('base64')});
      const body={attachments:[attachment('attachment','fictional.xlsx','x'),attachment('attachment_csv','fictional.csv','x'),attachment('attachment_record','fictional.json',JSON.stringify(envelope))]};
      const response=await worker.fetch(new Request('https://gmt.test/api/records/current/attachments',{method:'POST',headers:{authorization:`Bearer ${token}`,origin:'https://gmt.test','content-type':'application/json'},body:JSON.stringify(body)}),env,{});
      const queued=!['extra-unreviewed','conflict','claimed-authoritative','claimed-variant','race','review','empty','altered-local','omitted-local'].includes(mode);
      assert.equal(response.status,queued?202:409,`${mode}: ${await response.clone().text()}`);
      if(mode==='clear')assert.equal((await response.clone().json()).providerStatus,'awaiting-source-review','queueing must not imply source review or delivery');
      assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,queued?1:0);
      assert.equal(sql.prepare('SELECT count(*) AS n FROM record_attachments').get().n,queued?3:0);
      if (queued) {
        if (mode==='legacy-extra') {
          const previous={...envelope,rows:[...envelope.rows,{...envelope.rows[0],recordId:'current|2026-10-06',date:'2026-10-06'}]};
          const encoded=Buffer.from(JSON.stringify(previous)).toString('base64');
          sql.prepare("UPDATE record_attachments SET content_base64=?,size_bytes=? WHERE record_id='current' AND field_name='attachment_record'").run(encoded,Buffer.byteLength(JSON.stringify(previous)));
          sql.prepare("UPDATE timesheet_queue_source_guards SET source_base64=? WHERE record_id='current'").run(encoded);
          seedAttachmentGuards(sql);
        }
        if (mode==='new-day') insert('source-b','submission',[{date:'2026-10-06',start:'08:00',finish:'17:00',breakMinutes:60}]);
        if (mode==='changed-attachment') sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='current' AND field_name='attachment_record'").run();
        if (mode==='changed-workbook') sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='current' AND field_name='attachment'").run();
        if (mode==='changed-csv') sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='current' AND field_name='attachment_csv'").run();
        if (mode==='renamed-workbook') sql.prepare("UPDATE record_attachments SET file_name='other.xlsx' WHERE record_id='current' AND field_name='attachment'").run();
        if (mode==='extra-attachment') sql.prepare("INSERT INTO record_attachments VALUES('current','attachment_calendar_sync','extra.json','application/json','eA==',1,'t')").run();
        if (mode==='legacy-unverified') sql.prepare("DELETE FROM timesheet_queue_source_guards WHERE record_id='current'").run();
        if (mode==='legacy-attachment-unverified') sql.prepare("DELETE FROM timesheet_queue_attachment_guards WHERE record_id='current'").run();
        let sends=0,handoffError;
        await dispatchQueued({...env,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-key-with-at-least-32-characters'},
          {now:'2030-01-01T00:00:00Z',fixtureDispatchCapability:syntheticQueueCapability,privateDestinationCheck:async()=>({id:'fixture'}),fetchImpl:async(_url,options)=>{
            sends++;
            if(mode==='handoff-timeout') {try{assert.ok(options.signal instanceof AbortSignal,'the request has a bounded handoff')}catch(error){handoffError=error;throw error}throw new Error('fictional timeout');}
            if(mode==='handoff-locked') try {
              assert.throws(()=>insert('source-b','submission',[{date:'2026-10-06',start:'08:00',finish:'17:00',breakMinutes:60}]),/gmt_timesheet_handoff_in_progress/);
              assert.throws(()=>sql.prepare("UPDATE records SET payload_json='{}' WHERE record_id='source-a'").run(),/gmt_timesheet_handoff_in_progress/);
              assert.throws(()=>sql.prepare("DELETE FROM records WHERE record_id='source-a'").run(),/gmt_timesheet_handoff_in_progress/);
              assert.throws(()=>sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='current' AND field_name='attachment'").run(),/gmt_timesheet_handoff_in_progress/);
              assert.throws(()=>sql.prepare("DELETE FROM record_attachments WHERE record_id='current' AND field_name='attachment'").run(),/gmt_timesheet_handoff_in_progress/);
              assert.throws(()=>sql.prepare("INSERT INTO record_attachments VALUES('current','new','x','text/plain','eA==',1,'t')").run(),/gmt_timesheet_handoff_in_progress/);
              assert.throws(()=>sql.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES('source-a',1,?,?,?,'fictional-evidence','2026-10-03')`).run('a'.repeat(64),oid,oid),/gmt_timesheet_handoff_in_progress/);
              sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES('other','other-oid','other@example.test','Other','timesheets','submission','Submitted','t','t','{"rows":[]}')`).run();
              assert.throws(()=>sql.prepare("UPDATE records SET owner_upn='reviewer@example.test' WHERE record_id='other'").run(),/gmt_timesheet_handoff_in_progress/);
              sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES('estimate',?,?,'Fictional','estimates','draft','Draft','t','t','{}')`).run(oid,'reviewer@example.test');
              const edit=await worker.fetch(new Request('https://gmt.test/api/records/source-a',{method:'DELETE',headers:{authorization:`Bearer ${token}`,origin:'https://gmt.test'}}),env,{});
              assert.equal(edit.status,409);assert.match((await edit.json()).error,/delivery is being handed off/i);
            } catch (error) {handoffError=error;throw error;}
            return new Response('{"success":true}');
          }});
        if(handoffError)throw handoffError;
        assert.equal(sends,['clear','handoff-locked','handoff-timeout'].includes(mode)?1:0,`${mode}: only the unchanged generation can be sent`);
        if(mode==='handoff-locked') {assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='current'").get().status,'sent');insert('source-b','submission',[{date:'2026-10-06',start:'08:00',finish:'17:00',breakMinutes:60}]);}
        if(mode==='handoff-timeout') {assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='current'").get().status,'uncertain');insert('source-b','submission',[{date:'2026-10-06',start:'08:00',finish:'17:00',breakMinutes:60}]);}
      }
      sql.close();
    }
  } finally { globalThis.fetch=oldFetch; }
});
