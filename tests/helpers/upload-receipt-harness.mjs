import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker, {adminQueueStatus,dispatchQueued,resolvePrivateTimesheetRoute} from '../../cloudflare-worker/src/index.js';
import {syntheticQueueCapability} from '../../cloudflare-worker/src/synthetic-queue-capability.js';

// Local D1 substitute: exercise the actual Worker receipt handler using the
// unmodified attachment emitted by the browser upload/editor integration.
export async function verifyUploadReceipt(recordId, attachments, workbookResult, record) {
  const db=new DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  db.exec(await readFile(new URL('../../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){const perform=(method,args)=>{try{return db.prepare(sql)[method](...args)}catch(error){console.error('Fictional upload SQL failure:',sql,error.message);throw error}};const statement=(args=[])=>({bind(...values){return statement(values)},async first(){return perform('get',args)||null},async all(){return {results:perform('all',args)}},async run(){return {success:true,meta:perform('run',args)}}});return statement()},async batch(statements){db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results}catch(error){db.exec('ROLLBACK');throw error}}};
  const start='2026-09-30T12:00:00.000Z';
  const attachment=attachments.find(item=>item.fieldName==='attachment_record');
  assert.ok(attachment,'the editor must emit its source attachment');
  const ownerOid='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ownerUpn='matthew@gmt-services.co.uk';
  const insert=db.prepare('INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,record_date,submitted_at,updated_at,payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('previous',ownerOid,ownerUpn,'Matthew','timesheets','submission','Submitted','2026-09-03',start,start,JSON.stringify({rows:[{date:'2026-09-03',start:'08:00',finish:'17:00',lunchMinutes:30},{date:'2026-09-05',start:'10:00',finish:'12:00',lunchMinutes:0}]}));
  insert.run(recordId,ownerOid,ownerUpn,'Matthew','timesheets','pay_month_correction','Submitted','2026-09-02',start,start,JSON.stringify(record.payload));
  const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',aud='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',reviewer='reviewer@example.test';
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='upload-queue-fixture';
  const b64=value=>Buffer.from(value).toString('base64url');
  const unsigned=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',preferred_username:reviewer}));
  const token=unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:aud,SUBMISSIONS_ADMIN_UPNS:reviewer,ALLOWED_ORIGINS:'https://gmt.test',TIMESHEET_DELIVERY_CALLBACK_KEY:'local-fixture-callback-key-not-used-in-production'};
  const previousFetch=globalThis.fetch;
  let queued;
  try {
    globalThis.fetch=async url=>{if(String(url).includes('/discovery/v2.0/keys'))return Response.json({keys:[jwk]});throw new Error('Unexpected network request');};
    const queue=requestAttachments=>worker.fetch(new Request(`https://gmt.test/api/records/${encodeURIComponent(recordId)}/attachments`,{method:'POST',headers:{authorization:`Bearer ${token}`,origin:'https://gmt.test','content-type':'application/json'},body:JSON.stringify({attachments:requestAttachments})}),env,{});
    const source=JSON.parse(Buffer.from(attachment.contentBase64,'base64').toString('utf8'));
    if(source.schemaVersion===3){
      const notReady=await queue(attachments);
      assert.equal(notReady.status,409,'the real queue holds rate delivery until its receiver is ready');
      assert.equal(db.prepare('SELECT count(*) AS n FROM dispatch_queue WHERE record_id=?').get(recordId).n,0);
      env.PAY_MONTH_RATE_DELIVERY_READY='true';
    }
    const altered=structuredClone(attachments),changed=altered.find(item=>item.fieldName==='attachment_record');
    const changedSource=JSON.parse(Buffer.from(changed.contentBase64,'base64').toString('utf8'));
    changedSource.rows=changedSource.rows.filter(row=>row.date!=='2026-09-03');
    changed.contentBase64=Buffer.from(JSON.stringify(changedSource)).toString('base64');changed.sizeBytes=Buffer.from(changed.contentBase64,'base64').length;
    const held=await queue(altered);
    assert.equal(held.status,409,`a missing history day must be held: ${await held.clone().text()}`);
    if(source.schemaVersion===3){
      const alteredRates=structuredClone(attachments),rateFile=alteredRates.find(item=>item.fieldName==='attachment_record');
      const alteredSource=JSON.parse(Buffer.from(rateFile.contentBase64,'base64').toString('utf8'));
      alteredSource.rows.find(row=>row.date==='2026-09-02').sourceBasicMinutes++;
      rateFile.contentBase64=Buffer.from(JSON.stringify(alteredSource)).toString('base64');rateFile.sizeBytes=Buffer.from(rateFile.contentBase64,'base64').length;
      assert.equal((await queue(alteredRates)).status,409,'a source-rate change must be held');
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM dispatch_queue WHERE record_id=?').get(recordId).n,0);
    queued=await queue(attachments);
  } finally {globalThis.fetch=previousFetch;}
  if(JSON.parse(Buffer.from(attachment.contentBase64,'base64').toString('utf8')).schemaVersion===3 || record.payload.rows.some(row=>row.sourceEvidence?.sourceId)){
    assert.equal(queued.status,409,'an imported original remains held pending independent review');
    assert.equal(db.prepare('SELECT count(*) AS n FROM dispatch_queue WHERE record_id=?').get(recordId).n,0);
    db.close();
    return {queueProvenance:'source-review-held'};
  }
  assert.equal(queued.status,202,`actual guarded queue: ${await queued.clone().text()}`);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_queue_source_guards WHERE record_id=?').get(recordId).n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM timesheet_queue_attachment_guards WHERE record_id=?').get(recordId).n,1);
  let fakeSends=0;
  const dispatch=await dispatchQueued({...env,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true'},
    {now:new Date(Date.now()+1000).toISOString(),fixtureDispatchCapability:syntheticQueueCapability,privateDestinationCheck:async()=>({id:'local-private-folder'}),fetchImpl:async()=>{fakeSends++;return new Response('{"success":true}');}});
  assert.equal(dispatch.sent,1,'the guarded generation must reach the fake sender');
  assert.equal(fakeSends,1,'the upload test must never contact a real mail provider');
  const generation=createHash('sha256').update(Buffer.from(attachment.contentBase64,'base64')).digest('hex');
  const route=await resolvePrivateTimesheetRoute(env,{recordId,generation,flowRunId:'local-upload-integration',runStartedAt:start},{privateDestinationCheck:async(_env, row)=>{
    assert.equal(row.owner_upn,'matthew@gmt-services.co.uk');
    return {id:'local-private-folder'};
  },workbookCheck:async()=>({folderId:'local-private-month',workbookId:'local-private-workbook'})});
  const callback=async(event,evidence={})=>worker.fetch(new Request('https://gmt-portal-api.test/api/integrations/timesheet-delivery-receipts',{method:'POST',headers:{'content-type':'application/json','x-gmt-delivery-key':env.TIMESHEET_DELIVERY_CALLBACK_KEY},body:JSON.stringify({recordId,flowRunId:'local-upload-integration',runStartedAt:start,generation,event,...evidence})}),env,{});
  const started=await callback('flow_started');
  assert.equal(started.status,200,`flow_started: ${await started.text()}`);
  const incomplete=await callback('workbook_verified',{workbookId:route.workbookId,created:workbookResult.created,updated:workbookResult.updated,unchanged:workbookResult.unchanged,verifiedRows:JSON.parse(workbookResult.verifiedRowsJson).map(({recordId,date})=>({recordId,date})),verifiedRecordIds:workbookResult.verifiedRecordIds});
  assert.notEqual(incomplete.status,200,'IDs and dates alone must not verify a workbook that may have lost source notes');
  const missingNote=await callback('workbook_verified',{workbookId:route.workbookId,created:workbookResult.created,updated:workbookResult.updated,unchanged:workbookResult.unchanged,verifiedRows:JSON.parse(workbookResult.verifiedRowsJson).map((row,index)=>index===0?{...row,notes:''}:row),verifiedRecordIds:workbookResult.verifiedRecordIds});
  assert.equal(missingNote.status,409,'a workbook row missing its protected source note cannot be verified');
  const wrongStart=await callback('workbook_verified',{workbookId:route.workbookId,created:workbookResult.created,updated:workbookResult.updated,unchanged:workbookResult.unchanged,verifiedRows:JSON.parse(workbookResult.verifiedRowsJson).map((row,index)=>index===0?{...row,start:'00:00'}:row),verifiedRecordIds:workbookResult.verifiedRecordIds});
  assert.equal(wrongStart.status,409,'a workbook row with an altered start cannot be verified');
  for (const [field, value] of [['finish','00:00'],['breakMinutes',120],['absence','Sick'],['totalMinutes',1]]) {
    const altered=await callback('workbook_verified',{workbookId:route.workbookId,created:workbookResult.created,updated:workbookResult.updated,unchanged:workbookResult.unchanged,verifiedRows:JSON.parse(workbookResult.verifiedRowsJson).map((row,index)=>index===0?{...row,[field]:value}:row),verifiedRecordIds:workbookResult.verifiedRecordIds});
    assert.equal(altered.status,409,`a workbook row with altered ${field} cannot be verified`);
  }
  if(JSON.parse(Buffer.from(attachment.contentBase64,'base64').toString('utf8')).schemaVersion===3){
    const alteredRates=await callback('workbook_verified',{workbookId:route.workbookId,created:workbookResult.created,updated:workbookResult.updated,unchanged:workbookResult.unchanged,verifiedRows:JSON.parse(workbookResult.verifiedRowsJson).map((row,index)=>index===0?{...row,sourceBasicMinutes:0}:row),verifiedRecordIds:workbookResult.verifiedRecordIds});
    assert.equal(alteredRates.status,409,'altered workbook rates cannot produce a receipt');
  }
  for(const [event,evidence] of [['workbook_verified',{workbookId:route.workbookId,created:workbookResult.created,updated:workbookResult.updated,unchanged:workbookResult.unchanged,verifiedRowsJson:workbookResult.verifiedRowsJson,verifiedRecordIdsJson:workbookResult.verifiedRecordIdsJson}],['flow_completed',{}]]){
    const response=await callback(event,evidence);
    assert.equal(response.status,200,`${event}: ${await response.text()}`);
  }
  const status=await adminQueueStatus({DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test'}, {isAdmin:true});
  assert.equal(db.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'completed','the verified generation must release the guarded queue');
  assert.equal(status.records[0].deliveryReceipt.events.workbook_verified.verifiedRowCount,3);
  assert.ok(status.records[0].deliveryReceipt.events.flow_completed);
  assert.equal(JSON.parse(db.prepare("SELECT evidence_json FROM timesheet_delivery_receipts WHERE event_type='workbook_verified'").get().evidence_json).generation,generation);
  assert.doesNotMatch(db.prepare("SELECT evidence_json FROM timesheet_delivery_receipts WHERE event_type='workbook_verified'").get().evidence_json,/Workshop/,'notes are compared in memory rather than copied into the receipt audit');
  db.close();
  return {...route,queueProvenance:'authenticated-worker-route'};
}
