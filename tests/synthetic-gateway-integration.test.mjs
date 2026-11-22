import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import gateway, {createSyntheticPortalGateway} from '../cloudflare-worker/src/synthetic-portal-gateway.js';
import worker from '../cloudflare-worker/src/index.js';
import { syntheticFixture as f } from '../cloudflare-worker/src/synthetic-portal-fixture.js';
import { syntheticAttachmentExample } from './helpers/synthetic-attachments.mjs';

const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='synthetic-integration';

for (const fullSchema of [false,true]) test(`a signed test participant can queue and hand off the fictional correction (${fullSchema?'fresh schema':'minimal schema'})`, async () => {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../cloudflare-worker/test-only/synthetic-portal-guard.sql',import.meta.url),'utf8'));
  if (fullSchema) {
    sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
    sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
  } else {
    sql.exec(`CREATE TABLE portal_access_assignments(owner_oid TEXT,owner_upn TEXT,role TEXT);
    CREATE TABLE pay_month_start_settings(month_key TEXT,start_date TEXT);
    CREATE TABLE profile_settings(owner_oid TEXT,owner_upn TEXT);
    CREATE TABLE records(record_id TEXT PRIMARY KEY,owner_oid TEXT NOT NULL,owner_upn TEXT NOT NULL,employee_name TEXT NOT NULL,kind TEXT NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,start_date TEXT,end_date TEXT,record_date TEXT,submitted_at TEXT NOT NULL,updated_at TEXT,issue TEXT,payload_json TEXT);
    CREATE TABLE xero_connections(tenant_id TEXT PRIMARY KEY,tenant_name TEXT,connection_id TEXT,refresh_token_ciphertext TEXT,refresh_token_iv TEXT,scopes TEXT,updated_at TEXT,last_error TEXT);
    CREATE TABLE xero_refresh_locks(token_hash TEXT PRIMARY KEY,lease_id TEXT,lease_expires_at INTEGER NOT NULL);
    CREATE TABLE estimate_index(estimate_number TEXT,number_aliases_json TEXT);
    CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT,attempts INTEGER,queued_at TEXT,updated_at TEXT,next_attempt_at TEXT,last_sent_at TEXT,last_error TEXT);
    CREATE TABLE record_attachments(record_id TEXT,field_name TEXT,file_name TEXT,content_type TEXT,content_base64 TEXT,size_bytes INTEGER,created_at TEXT,PRIMARY KEY(record_id,field_name));
    CREATE TABLE timesheet_delivery_routes(record_id TEXT,flow_run_id TEXT,run_started_at TEXT,generation TEXT,workbook_id TEXT);
    CREATE TABLE timesheet_delivery_receipts(record_id TEXT,flow_run_id TEXT,run_started_at TEXT,event_type TEXT,evidence_json TEXT);
    CREATE TABLE record_versions(record_id TEXT,owner_oid TEXT,payload_json TEXT,changed_at TEXT,changed_by_oid TEXT);`);
  for(const migration of ['0018_imported_invoice_records.sql','0019_document_import_files.sql','0020_timesheet_revision_guard.sql','0028_timesheet_ownership_review.sql','0032_timesheet_queue_source_guard.sql','0033_timesheet_queue_attachment_guard.sql','0037_timesheet_import_source_hold.sql','0038_timesheet_import_source_days.sql'])
    sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/'+migration,import.meta.url),'utf8'));
  }
  const employeeOid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorOid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if (fullSchema) sql.prepare('INSERT INTO profile_settings (owner_oid,owner_upn,updated_at) VALUES (?,?,?)').run(employeeOid,f.employeeUpn,'2026-11-16T13:00:00.000Z');
  else sql.prepare('INSERT INTO profile_settings VALUES (?,?)').run(employeeOid,f.employeeUpn);
  const DB={prepare(statement){const perform=(method,args)=>{try{return sql.prepare(statement)[method](...args)}catch(error){console.error('Synthetic fixture SQL:',statement,error.message);throw error}};const bound=(args=[])=>({bind(...values){return bound(values)},async first(){return perform('get',args)||null},
    async all(){return {results:perform('all',args)}},async run(){const before=sql.prepare('SELECT total_changes() AS n').get().n;perform('run',args);return {meta:{changes:sql.prepare('SELECT total_changes() AS n').get().n-before}}}});return bound()},
    async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
  const tenant='8b182d6b-6f34-4ca2-84ad-50ca712b5488',aud='01b5a6c6-f6c1-47cb-aebe-67f07f415e4b',origin='http://localhost:4179',actor='amanda.bb@gmtelectservsltd.onmicrosoft.com';
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:aud,ALLOWED_ORIGINS:origin,SYNTHETIC_TEST_ALLOWED_OID:actorOid,SYNTHETIC_TEST_SUBJECT_OID:employeeOid,
    PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',DOCUMENT_IMPORT_SHARED_STORAGE_READY:'false',
    SHAREPOINT_GRAPH_CLIENT_ID:'fixture-client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fixture-secret',SHAREPOINT_SITE_ID:'fixture-site',SHAREPOINT_DRIVE_ID:'fixture-drive',
    ADMIN_UPNS:actor,SUBMISSIONS_ADMIN_UPNS:actor,STAFF_DIRECTORY_JSON:JSON.stringify([{name:f.employeeName,upn:f.employeeUpn}]),SYNTHETIC_TEST_QUEUE_ENABLED:'true',
    TIMESHEET_DELIVERY_CALLBACK_KEY:'isolated-test-key-with-at-least-thirty-two-characters',SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false',
    SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFPFOELOEM7HDJB2SOQSB3IBWSRN',SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFLBI6XSXPOOSRCIKDR2EUSAR3I5',SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH'};
  const b64=x=>Buffer.from(x).toString('base64url');
  const data=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid:actorOid,preferred_username:actor,name:'Amanda Brown-Bennett'}));
  const token=data+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))));
  const post=(url,body)=>new Request('https://isolated.test'+url,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  let unexpectedRequests=0;
  const prev=globalThis.fetch;globalThis.fetch=async url=>{
    const value=String(url);
    if(value.includes('/discovery/v2.0/keys'))return new Response(JSON.stringify({keys:[jwk]}),{status:200});
    if(value.includes('/oauth2/v2.0/token'))return new Response(JSON.stringify({access_token:'fictional-token',expires_in:300}),{status:200});
    if(value.includes('/v1.0/users/'))return new Response(JSON.stringify({id:employeeOid,userPrincipalName:f.employeeUpn}),{status:200});
    unexpectedRequests++;return new Response('',{status:404});
  };
  try {
    const denied=await gateway.fetch(post('/api/document-import/timesheet-target',{employeeEmail:f.employeeUpn,dates:f.rows.map(row=>row.date)}),env,{});
    assert.equal(denied.status,403,'the target requires a server-verified file');
    const proof=()=>new Request('https://isolated.test/api/synthetic-fixture-proof',{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/octet-stream'},
      body:readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json')});
    assert.equal((await gateway.fetch(proof(),env,{})).status,200);
    sql.prepare('UPDATE synthetic_test_fixture_proofs SET expires_at=0').run();
    assert.equal((await gateway.fetch(post('/api/document-import/timesheet-target',{employeeEmail:f.employeeUpn,dates:f.rows.map(row=>row.date)}),env,{})).status,403,'expired proof is refused');
    assert.equal((await gateway.fetch(proof(),env,{})).status,200);
    const target=await gateway.fetch(post('/api/document-import/timesheet-target',{employeeEmail:f.employeeUpn,dates:f.rows.map(row=>row.date)}),env,{});
    const review=await target.json();
    assert.equal(target.status,200,JSON.stringify(review));
    assert.equal(review.employeeUpn,f.employeeUpn); assert.deepEqual(review.conflicts,[]); assert.equal(review.localRevision,0);
    const evidence={raw:'',claimedBasic:null,claimedOt15:null,claimedOt20:null,reviewNote:'',sourceFile:f.fileName,sourceId:f.sourceId};
    const rows=f.rows.map((row,index)=>({...row,description:row.note,lunchHad:row.lunchMinutes===null?null:false,...(index===0?{workedMinutes:180,workedHours:3}:{}),basicHours:index===0?3:2,ot15Hours:0,ot20Hours:0,weightedHours:index===0?3:2,sourceEvidence:{...evidence}}));
    const when='2026-11-16T13:00:00.000Z',editor='Amanda Brown-Bennett';
    const body={recordId:f.recordId,kind:'timesheets',action:'pay_month_correction',status:'Submitted',editMode:true,employeeName:f.employeeName,employeeEmail:f.employeeUpn,
      startDate:'2026-09-21',endDate:'2026-10-18',recordDate:'2026-11-16',updatedAt:when,baseCorrectionExists:false,baseCorrectionUpdatedAt:'',baseOwnerRevision:0,
      importReview:{dates:f.rows.map(row=>row.date),historyFingerprint:review.historyFingerprint,localRevision:0},payload:{employeeName:f.employeeName,employeeEmail:f.employeeUpn,payMonth:'2026-10',
        weekStart:'2026-09-21',weekEnd:'2026-10-18',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',payrollFriday:'2026-10-16',rows,deletedDays:[],editedAt:when,editedBy:editor,
        editNote:`Edited on behalf of ${f.employeeName} by ${editor}.`}};
    const altered=structuredClone(body);altered.payload.rows[1].lunchMinutes=0;
    assert.equal((await gateway.fetch(post('/api/records',altered),env,{})).status,400);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM records').get().n,0);
    const saved=await gateway.fetch(post('/api/records',body),env,{});const result=await saved.json();
    assert.equal(saved.status,201,JSON.stringify(result));
    const stored=sql.prepare('SELECT payload_json,owner_oid FROM records WHERE record_id=?').get(f.recordId);
    assert.equal(stored.owner_oid,employeeOid,'a reviewed on-behalf correction belongs to the verified employee, not its editor');
    assert.equal(JSON.parse(stored.payload_json).testMode,true);
    assert.equal(JSON.parse(stored.payload_json).rows[1].lunchMinutes,null);
    const visible=await gateway.fetch(new Request('https://isolated.test/api/history?kind=all&limit=1000',
      {headers:{origin,authorization:`Bearer ${token}`}}),env,{});
    assert.equal(visible.status,200);
    assert.deepEqual((await visible.json()).records.map(row=>row.source_record_id),[f.recordId],
      'the isolated portal can recover its one saved fictional correction');
    // An older correction whose stored object ID points to the editor must be
    // held for reconciliation, not silently reassigned when more days import.
    sql.prepare('UPDATE records SET owner_oid=? WHERE record_id=?').run(actorOid,f.recordId);
    const extraTarget=await worker.fetch(post('/api/document-import/timesheet-target',{employeeEmail:f.employeeUpn,dates:['2026-10-07']}),env,{});
    assert.equal(extraTarget.status,200,await extraTarget.clone().text());
    const extraReview=await extraTarget.json();
    const legacyEdit=structuredClone(body); legacyEdit.baseCorrectionExists=true;
    legacyEdit.baseCorrectionUpdatedAt=sql.prepare('SELECT updated_at FROM records WHERE record_id=?').get(f.recordId).updated_at;
    legacyEdit.baseOwnerRevision=extraReview.localRevision;
    legacyEdit.importReview={dates:['2026-10-07'],historyFingerprint:extraReview.historyFingerprint,localRevision:extraReview.localRevision};
    legacyEdit.payload.rows.push({...legacyEdit.payload.rows[0],date:'2026-10-07'});
    const held=await worker.fetch(post('/api/records',legacyEdit),env,{});
    assert.equal(held.status,409,'a mismatched legacy owner is not silently rebound');
    assert.equal(sql.prepare('SELECT owner_oid FROM records WHERE record_id=?').get(f.recordId).owner_oid,actorOid);
    sql.prepare('UPDATE records SET owner_oid=? WHERE record_id=?').run(employeeOid,f.recordId);
    const attachments=syntheticAttachmentExample();
    assert.deepEqual(JSON.parse(stored.payload_json),attachments.payload);
    const queueUrl='/api/records/'+encodeURIComponent(f.recordId)+'/attachments';
    const invalid=structuredClone(attachments.body); invalid.attachments[1].contentBase64=Buffer.from('private data').toString('base64');
    assert.equal((await gateway.fetch(post(queueUrl,invalid),env,{})).status,400);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
    assert.equal((await gateway.fetch(post('/api/records/other/attachments',attachments.body),env,{})).status,404);
    assert.equal((await gateway.fetch(post(queueUrl,attachments.body),{...env,SYNTHETIC_TEST_QUEUE_ENABLED:'false'},{})).status,403);
    const racingGateway=createSyntheticPortalGateway({fetch:async(request,raceEnv,ctx)=>{
      sql.prepare('UPDATE records SET payload_json=? WHERE record_id=?').run(JSON.stringify({...attachments.payload,editNote:'changed'}),f.recordId);
      return worker.fetch(request,raceEnv,ctx);
    }});
    assert.equal((await racingGateway.fetch(post(queueUrl,attachments.body),env,{})).status,409,'a change after validation prevents queueing');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
    sql.prepare('UPDATE records SET payload_json=? WHERE record_id=?').run(stored.payload_json,f.recordId);
    const changedOwner=createSyntheticPortalGateway({fetch:async(request,raceEnv,ctx)=>{
      sql.prepare('UPDATE records SET employee_name=? WHERE record_id=?').run('Other employee',f.recordId);
      return worker.fetch(request,raceEnv,ctx);
    }});
    assert.equal((await changedOwner.fetch(post(queueUrl,attachments.body),env,{})).status,409,'a changed destination identity prevents queueing');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
    sql.prepare('UPDATE records SET employee_name=? WHERE record_id=?').run(f.employeeName,f.recordId);
    sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
      VALUES('fictional-existing-history',?,?,?,'timesheets','submission','Submitted','t','t',?)`)
      .run(employeeOid,f.employeeUpn,f.employeeName,JSON.stringify({rows:[{date:'2026-10-07',start:'08:00',finish:'12:00'}]}));
    assert.equal((await gateway.fetch(post(queueUrl,attachments.body),env,{})).status,409,'a file omitting an existing day cannot be queued');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
    sql.prepare("DELETE FROM records WHERE record_id='fictional-existing-history'").run();
    const racingHistory=createSyntheticPortalGateway({fetch:async(request,raceEnv,ctx)=>{
      sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
        VALUES('fictional-racing-history',?,?,?,'timesheets','submission','Submitted','t','t',?)`)
        .run(employeeOid,f.employeeUpn,f.employeeName,JSON.stringify({rows:[{date:'2026-10-07',start:'08:00',finish:'12:00'}]}));
      return worker.fetch(request,raceEnv,ctx);
    }});
    assert.equal((await racingHistory.fetch(post(queueUrl,attachments.body),env,{})).status,409,'a new history row after validation prevents queueing an incomplete snapshot');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
    sql.prepare("DELETE FROM records WHERE record_id='fictional-racing-history'").run();
    const tasks=[];
    const queued=await gateway.fetch(post(queueUrl,attachments.body),env,{waitUntil:promise=>tasks.push(promise)});
    assert.equal(queued.status,202,await queued.clone().text());
    await Promise.all(tasks);
    assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(f.recordId).status,'queued');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM record_attachments WHERE record_id=?').get(f.recordId).n,3);
    assert.equal(unexpectedRequests,0,'the normal dispatcher does not transmit the synthetic record');
    const machine=(path,body,key=env.TIMESHEET_DELIVERY_CALLBACK_KEY)=>new Request('https://isolated.test'+path,{method:'POST',
      headers:{'content-type':'application/json','x-gmt-delivery-key':key},body:JSON.stringify(body)});
    assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/claim',{},'wrong'),env,{})).status,401);
    const claims=await Promise.all([gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{}),gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{})]);
    assert.deepEqual(claims.map(x=>x.status).sort(),[200,409],'only one sender may claim a generation');
    const claim=await claims.find(x=>x.status===200).json();
    assert.equal(claim.recordId,f.recordId);
    assert.equal(claim.sourceBase64,attachments.body.attachments[2].contentBase64);
    assert.match(claim.generation,/^[a-f0-9]{64}$/);
    assert.equal(sql.prepare('SELECT status,attempts FROM dispatch_queue WHERE record_id=?').get(f.recordId).status,'sending');
    assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/finish',{generation:'f'.repeat(64),outcome:'sent'}),env,{})).status,409);
    if (fullSchema) sql.prepare('INSERT INTO timesheet_delivery_routes VALUES (?,?,?,?,?,?,?,?)').run(f.recordId,'flow-one','2026-11-16T13:01:00.000Z',claim.generation,'employee-folder','month-folder','fixture-workbook','2026-11-16T13:01:01.000Z');
    else sql.prepare('INSERT INTO timesheet_delivery_routes VALUES (?,?,?,?,?)').run(f.recordId,'flow-one','2026-11-16T13:01:00.000Z',claim.generation,'fixture-workbook');
    const addReceipt=fullSchema
      ? (event,evidence)=>sql.prepare('INSERT INTO timesheet_delivery_receipts (record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json) VALUES (?,?,?,?,?,?)').run(f.recordId,'flow-one','2026-11-16T13:01:00.000Z',event,'2026-11-16T13:02:00.000Z',JSON.stringify(evidence))
      : (event,evidence)=>sql.prepare('INSERT INTO timesheet_delivery_receipts VALUES (?,?,?,?,?)').run(f.recordId,'flow-one','2026-11-16T13:01:00.000Z',event,JSON.stringify(evidence));
    addReceipt('workbook_verified',{generation:claim.generation,sourceRowVerification:'source-row-v1'});
    addReceipt('flow_completed',{generation:claim.generation});
    const finished=await gateway.fetch(machine('/api/synthetic-delivery/finish',{generation:claim.generation,outcome:'sent'}),env,{});
    assert.equal(finished.status,200);
    assert.equal((await finished.json()).reconciliationPending,false,'trigger bookkeeping is not a failed record update');
    assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(f.recordId).status,'completed','an earlier verified receipt releases the finished handoff');
    assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{})).status,409,'a completed handoff cannot be sent again');
    const completedStatus=sql.prepare('SELECT status FROM records WHERE record_id=?').get(f.recordId).status;
    sql.prepare("UPDATE records SET status='Submitted' WHERE record_id=?").run(f.recordId);
    const duplicate=await gateway.fetch(post(queueUrl,attachments.body),env,{});
    assert.equal(duplicate.status,409,'even a stale submitted state cannot queue the same completed generation again');
    assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(f.recordId).status,'completed');
    sql.prepare('UPDATE records SET status=? WHERE record_id=?').run(completedStatus,f.recordId);
    if (fullSchema) {
      const ordinary=structuredClone(body);delete ordinary.importReview;
      ordinary.recordId=f.recordId.replace('2026-10','2026-11');
      ordinary.baseOwnerRevision=sql.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(f.employeeUpn).revision;
      ordinary.payload.payMonth='2026-11';ordinary.payload.rows=ordinary.payload.rows.slice(0,1);
      ordinary.payload.rows[0].date='2026-11-02';
      const result=await worker.fetch(post('/api/records',ordinary),env,{});
      assert.equal(result.status,201,await result.clone().text());
      assert.equal(sql.prepare('SELECT owner_oid FROM records WHERE record_id=?').get(ordinary.recordId).owner_oid,employeeOid,
        'an ordinary on-behalf correction is also bound to the verified employee');
      sql.prepare('UPDATE records SET owner_oid=? WHERE record_id=?').run(actorOid,ordinary.recordId);
      ordinary.baseCorrectionExists=true;
      ordinary.baseCorrectionUpdatedAt=sql.prepare('SELECT updated_at FROM records WHERE record_id=?').get(ordinary.recordId).updated_at;
      ordinary.baseOwnerRevision=sql.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(f.employeeUpn).revision;
      const ordinaryHeld=await worker.fetch(post('/api/records',ordinary),env,{});
      assert.equal(ordinaryHeld.status,409,'an ordinary edit cannot silently reassign a mismatched legacy correction');
      assert.equal(sql.prepare('SELECT count(*) AS n FROM record_versions WHERE record_id=?').get(ordinary.recordId).n,0);
    }
    // Reset the minimal in-memory test only; the full schema is append-only.
    if (!fullSchema) {
    sql.exec('DELETE FROM timesheet_delivery_receipts; DELETE FROM timesheet_delivery_routes;');
    sql.prepare("UPDATE dispatch_queue SET status='queued',attempts=0 WHERE record_id=?").run(f.recordId);
    sql.prepare("UPDATE records SET status='Queued for Accounts' WHERE record_id=?").run(f.recordId);
    const savedCsv=sql.prepare("SELECT content_base64 FROM record_attachments WHERE record_id=? AND field_name='attachment_csv'").get(f.recordId).content_base64;
    sql.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_csv'").run(Buffer.from('wrong').toString('base64'),f.recordId);
    assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{})).status,409,'changed queued files cannot be claimed');
    sql.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id=? AND field_name='attachment_csv'").run(savedCsv,f.recordId);
    const secondClaim=await (await gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{})).json();
    sql.prepare('UPDATE records SET owner_oid=? WHERE record_id=?').run('other-subject',f.recordId);
    assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/finish',{generation:secondClaim.generation,outcome:'sent'}),env,{})).status,409,'the test subject cannot change while a handoff is in flight');
    sql.prepare('UPDATE records SET owner_oid=? WHERE record_id=?').run(employeeOid,f.recordId);
    const uncertain=await gateway.fetch(machine('/api/synthetic-delivery/finish',{generation:secondClaim.generation,outcome:'uncertain'}),env,{});
    assert.equal(uncertain.status,200);
    assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(f.recordId).status,'uncertain');
    assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/claim',{}),env,{})).status,409,'uncertain handoffs cannot be resent automatically');
    assert.equal((await gateway.fetch(machine('/api/synthetic-delivery/finish',{generation:secondClaim.generation,outcome:'sent'}),env,{})).status,409,'an uncertain outcome cannot be relabelled as sent');
    }
  } finally {globalThis.fetch=prev;sql.close();}
});
