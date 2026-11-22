import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../cloudflare-worker/src/index.js';
import { syntheticQueueCapability } from '../cloudflare-worker/src/synthetic-queue-capability.js';

test('HTTP cannot enable fictional queueing; trusted internal context can only queue an explicit test correction', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE records(record_id TEXT PRIMARY KEY, owner_oid TEXT, action TEXT, owner_upn TEXT, employee_name TEXT, payload_json TEXT, status TEXT, issue TEXT, updated_at TEXT,kind TEXT);
    CREATE TABLE profile_settings(owner_oid TEXT, owner_upn TEXT);
    CREATE TABLE portal_access_assignments(owner_oid TEXT, owner_upn TEXT, role TEXT);
    CREATE TABLE pay_month_start_settings(month_key TEXT,start_date TEXT);
    CREATE TABLE record_attachments(record_id TEXT,field_name TEXT,file_name TEXT,content_type TEXT,content_base64 TEXT,size_bytes INTEGER,created_at TEXT,PRIMARY KEY(record_id,field_name));
    CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT,queued_at TEXT,updated_at TEXT,attempts INTEGER,next_attempt_at TEXT,last_sent_at TEXT,last_error TEXT);`);
  sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0028_timesheet_ownership_review.sql',import.meta.url),'utf8'));
  const payload = JSON.stringify({ testMode:true, payMonth:'2026-10', editedAt:'2026-11-03T10:00:00.000Z' });
  sql.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)').run('fixture','actor','pay_month_correction','alice@example.test','TEST Alice',payload,'Submitted','','now','timesheets');
  let queueReads=0, queuedRowsSeen=0, injectSkippedReview=false, injectSkippedEdit=false;
  const DB = { prepare(statement) { if (statement.includes('SELECT q.record_id, q.status AS dispatch_status')) queueReads++; return { async all() { return { results:sql.prepare(statement).all() }; }, bind(...args) { return {
    async first() { return sql.prepare(statement).get(...args) || null; },
    async all() { const results=sql.prepare(statement).all(...args); if (statement.includes('SELECT q.record_id, q.status AS dispatch_status')) queuedRowsSeen+=results.length; return { results }; },
    async run() { if(injectSkippedEdit && statement.includes("SET status = 'Test - not sent'")){injectSkippedEdit=false;sql.prepare("UPDATE records SET payload_json=? WHERE record_id='fixture-race-edit'").run(JSON.stringify({testMode:true,note:"changed"}));}if(injectSkippedReview && statement.includes("SET status = 'Test - not sent'")){injectSkippedReview=false;sql.prepare("INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES('fixture-race',1,?,'subject','reviewer','evidence','t')").run('a'.repeat(64));}const before=sql.prepare('SELECT total_changes() AS n').get().n;sql.prepare(statement).run(...args);return { meta:{ changes:sql.prepare('SELECT total_changes() AS n').get().n-before } }; }
  }; } }; }, async batch(statements) { sql.exec('BEGIN'); try { const result=[]; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', audience='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey); jwk.kid='fictional-queue-route';
  const b64=x=>Buffer.from(x).toString('base64url');
  const data=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud:audience,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid:'actor',preferred_username:'alice@example.test'}));
  const bearer=data+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))));
  const encode=x=>Buffer.from(x).toString('base64');
  const envelope={schemaVersion:2,mode:'replace-pay-month',recordId:'fixture',employeeUpn:'alice@example.test',payMonth:'2026-10',submittedAt:'2026-11-03T10:00:00.000Z',rows:[{recordId:'fixture|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'',changeNote:''}]};
  const body={ syntheticQueueCapability:true, attachments:[{fieldName:'attachment',fileName:'test.xlsx',contentBase64:encode('x')},
    {fieldName:'attachment_csv',fileName:'test.csv',contentBase64:encode('x')},
    {fieldName:'attachment_record',fileName:'test.json',contentBase64:encode(JSON.stringify(envelope))}] };
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:audience,SUBMISSIONS_ADMIN_UPNS:'alice@example.test',
    SYNTHETIC_TEST_QUEUE_ENABLED:'true',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',
    PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://blocked.example.invalid/'};
  const makeRequest=(id='fixture')=>new Request('https://worker.example/api/records/'+id+'/attachments',{method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify(body)});
  const previousFetch=globalThis.fetch;
  let sends=0;
  globalThis.fetch=async url=>String(url).includes('/discovery/v2.0/keys')?new Response(JSON.stringify({keys:[jwk]}),{status:200}):(sends++,new Response('',{status:404}));
  try {
    const untrusted=await worker.fetch(makeRequest(),env,{});
    assert.equal(untrusted.status,200);
    assert.equal((await untrusted.json()).skipped,true);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
    sql.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)').run('fixture-race','actor','pay_month_correction','alice@example.test','TEST Alice',payload,'Submitted','','now','timesheets');
    injectSkippedReview=true;const raced=await worker.fetch(makeRequest('fixture-race'),env,{});
    assert.equal(raced.status,409,'a newly reviewed record cannot be marked as a skipped test from a stale request');
    assert.equal(sql.prepare('SELECT status FROM records WHERE record_id=?').get('fixture-race').status,'Submitted');
    sql.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)').run('fixture-race-edit','actor','pay_month_correction','alice@example.test','TEST Alice',payload,'Submitted','','now','timesheets');
    injectSkippedEdit=true;const edited=await worker.fetch(makeRequest('fixture-race-edit'),env,{});
    assert.equal(edited.status,409,'a changed synthetic record cannot be marked from a stale request');
    assert.equal(sql.prepare('SELECT status FROM records WHERE record_id=?').get('fixture-race-edit').status,'Submitted');
    sql.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)').run('fixture-flight','actor','pay_month_correction','alice@example.test','TEST Alice',payload,'Submitted','','now','timesheets');
    sql.prepare("INSERT INTO dispatch_queue(record_id,status) VALUES('fixture-flight','sending')").run();
    const inFlight=await worker.fetch(makeRequest('fixture-flight'),env,{});assert.equal(inFlight.status,409,'an in-flight delivery cannot be relabelled as unsent');
    assert.equal(sql.prepare('SELECT status FROM records WHERE record_id=?').get('fixture-flight').status,'Submitted');
    sql.prepare("DELETE FROM dispatch_queue WHERE record_id='fixture-flight'").run();
    sql.prepare("UPDATE records SET status='Submitted' WHERE record_id='fixture'").run();
    const tasks=[];
    const context=payloadJson=>({[syntheticQueueCapability]:{capability:syntheticQueueCapability,payloadJson,ownerOid:'actor',
      ownerUpn:'alice@example.test',employeeName:'TEST Alice',kind:'timesheets',action:'pay_month_correction',status:'Submitted'},waitUntil:promise=>tasks.push(promise)});
    const stale=await worker.fetch(makeRequest(),env,context('a different saved correction'));
    assert.equal(stale.status,409,'the internally verified payload must still match the saved correction');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
    const isolated=await worker.fetch(makeRequest(),env,context(payload));
    assert.equal(isolated.status,202);
    assert.equal((await isolated.json()).queued,true);
    await Promise.all(tasks);
    assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get('fixture').status,'queued');
    assert.equal(queueReads,1,'the automatic dispatcher inspected the queued correction');
    assert.equal(queuedRowsSeen,1,'the dispatcher found the fictional correction before leaving it held');
    assert.equal(sends,0,'the production dispatcher must not send this fictional record');
  } finally { globalThis.fetch=previousFetch; sql.close(); }
});
