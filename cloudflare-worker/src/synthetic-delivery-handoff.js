// One-shot coordinator for the isolated fictional test only. It performs no
// mail operation itself; a separately authorised sender must report whether
// the provider accepted the message or its outcome is uncertain.
import { correctionGeneration, releaseCompletedTimesheetDelivery } from './index.js';
import { syntheticFixture as fixture, validateSyntheticAttachments } from './synthetic-portal-fixture.js';
import {selectPublicationSource,claimPublicationHandoff,confirmPublicationHandoff,markPublicationHandoffUncertain} from './timesheet-source-publication-guard.js';

const conflict=()=>Object.assign(new Error('The isolated delivery cannot be claimed or completed'),{status:409});

async function snapshot(env, expectedStatus, expectedAttempts, validateAttachments) {
  const record=await env.DB.prepare(`SELECT r.*,q.status AS queue_status,q.attempts FROM records r
    JOIN dispatch_queue q ON q.record_id=r.record_id WHERE r.record_id=?`).bind(fixture.recordId).first();
  if (!record || record.queue_status!==expectedStatus || Number(record.attempts)!==expectedAttempts ||
      record.status!=='Queued for Accounts' || record.kind!=='timesheets' || record.action!=='pay_month_correction' ||
      String(record.owner_oid||'').toLowerCase()!==String(env.SYNTHETIC_TEST_SUBJECT_OID||'').toLowerCase() ||
      record.owner_upn!==fixture.employeeUpn || record.employee_name!==fixture.employeeName) throw conflict();
  let payload; try {payload=JSON.parse(record.payload_json);} catch (_) {throw conflict();}
  const result=await env.DB.prepare(`SELECT field_name,file_name,content_type,content_base64,size_bytes FROM record_attachments
    WHERE record_id=? ORDER BY field_name`).bind(fixture.recordId).all();
  const attachments=(result.results||[]).map(item=>({fieldName:item.field_name,fileName:item.file_name,
    contentType:item.content_type,contentBase64:item.content_base64,sizeBytes:item.size_bytes}));
  if (!(await validateAttachments({attachments},payload))) throw conflict();
  const source=attachments.find(item=>item.fieldName==='attachment_record').contentBase64;
  return {record,attachments,source,generation:await correctionGeneration(source)};
}

// Every checked field is compared inside the same statement that transitions
// the queue, preventing a changed record or attachment from being claimed.
function guard(item) {
  const record=item.record;
  let sql=`EXISTS (SELECT 1 FROM records r WHERE r.record_id=? AND r.status='Queued for Accounts'
    AND r.payload_json=? AND r.owner_oid IS ? AND r.owner_upn=? AND r.employee_name=? AND r.kind=? AND r.action=?)`;
  const args=[fixture.recordId,record.payload_json,record.owner_oid??null,record.owner_upn,record.employee_name,record.kind,record.action];
  for (const attachment of item.attachments) {
    sql+=` AND EXISTS (SELECT 1 FROM record_attachments a WHERE a.record_id=? AND a.field_name=? AND a.file_name=?
      AND a.content_type=? AND a.content_base64=? AND a.size_bytes=?)`;
    args.push(fixture.recordId,attachment.fieldName,attachment.fileName,attachment.contentType,attachment.contentBase64,attachment.sizeBytes);
  }
  sql+=' AND (SELECT count(*) FROM record_attachments a WHERE a.record_id=?)=3';
  args.push(fixture.recordId);
  return {sql,args};
}

export async function claimSyntheticDelivery(env, validateAttachments=validateSyntheticAttachments) {
  const item=await snapshot(env,'queued',0,validateAttachments), checked=guard(item), timestamp=new Date().toISOString();
  const result=await env.DB.prepare(`UPDATE dispatch_queue SET status='sending',attempts=1,updated_at=?
    WHERE record_id=? AND status='queued' AND attempts=0 AND ${checked.sql}`).bind(timestamp,fixture.recordId,...checked.args).run();
  if (Number(result?.meta?.changes||0)!==1) throw conflict();
  return {recordId:fixture.recordId,generation:item.generation,sourceBase64:item.source};
}

// Isolated test only. Selection uses the normal publication guard, including
// every imported-source hold. A successful claim is a single attempt; a lost
// response must be reconciled, not retried as a new send.
export async function claimBoundSyntheticDelivery(env,validateAttachments=validateSyntheticAttachments){
  const item=await snapshot(env,'queued',0,validateAttachments);
  let payload;try{payload=JSON.parse(item.record.payload_json)}catch(_){throw conflict()}
  const proof=await env.DB.prepare('SELECT owner_revision,source_base64 FROM timesheet_queue_source_guards WHERE record_id=?').bind(fixture.recordId).first();
  if(!proof || !Number.isSafeInteger(proof.owner_revision) || proof.source_base64!==item.source)throw conflict();
  const subjectOid=String(env.SYNTHETIC_TEST_SUBJECT_OID||'').toLowerCase(),subjectUpn=fixture.employeeUpn.toLowerCase();
  const prior=await env.DB.prepare('SELECT desired_revision FROM timesheet_publication_scopes WHERE subject_oid=? AND pay_month=?').bind(subjectOid,payload.payMonth).first();
  const expectedRevision=prior?Number(prior.desired_revision):0;
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw conflict();
  const request={recordId:fixture.recordId,subjectOid,subjectUpn,payMonth:payload.payMonth,sourceBase64:item.source,generation:item.generation,ownerRevision:proof.owner_revision,payloadJson:item.record.payload_json,expectedRevision};
  const publicationRevision=await selectPublicationSource(env,request);
  if(!Number.isSafeInteger(publicationRevision)||publicationRevision<1)throw conflict();
  const claim=await claimPublicationHandoff(env,{...request,publicationRevision,claimedAt:new Date().toISOString()});
  if(!claim?.attemptId)throw conflict();
  return {recordId:fixture.recordId,generation:item.generation,attemptId:claim.attemptId};
}

// Record only the sender's outcome for an existing isolated attempt. This
// never sends a message, completes a workbook, or changes the source record.
export async function finishBoundSyntheticDelivery(env,input){
  const attemptId=String(input?.attemptId||'').toLowerCase(),generation=String(input?.generation||''),outcome=input?.outcome;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(attemptId)||!/^[a-f0-9]{64}$/.test(generation)||!['sent','uncertain'].includes(outcome))throw conflict();
  const row=await env.DB.prepare(`SELECT a.subject_oid,a.pay_month,a.revision,q.status FROM timesheet_publication_attempts a
    JOIN timesheet_publication_scopes p ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month AND p.desired_revision=a.revision AND p.generation=a.generation
    JOIN dispatch_queue q ON q.record_id=a.record_id JOIN records r ON r.record_id=a.record_id
    WHERE a.attempt_id=? AND a.record_id=? AND a.generation=? AND lower(a.subject_oid)=? AND lower(p.subject_upn)=?
      AND r.employee_name=? AND json_valid(r.payload_json) AND json_extract(r.payload_json,'$.testMode')=1`)
    .bind(attemptId,fixture.recordId,generation,String(env.SYNTHETIC_TEST_SUBJECT_OID||'').toLowerCase(),fixture.employeeUpn.toLowerCase(),fixture.employeeName).first();
  if(!row||!Number.isSafeInteger(row.revision))throw conflict();
  if(row.status===outcome)return {accepted:true,outcome};
  if(row.status!=='sending')throw conflict();
  const value={attemptId,generation,subjectOid:row.subject_oid,payMonth:row.pay_month,publicationRevision:row.revision,claimedAt:new Date().toISOString()};
  const updated=outcome==='sent'?await confirmPublicationHandoff(env,value):await markPublicationHandoffUncertain(env,value);
  if(!updated)throw conflict();
  return {accepted:true,outcome};
}

export async function finishSyntheticDelivery(env, generation, outcome, validateAttachments=validateSyntheticAttachments) {
  if (!/^[a-f0-9]{64}$/.test(String(generation||'')) || !['sent','uncertain'].includes(outcome)) throw conflict();
  const item=await snapshot(env,'sending',1,validateAttachments);
  if (item.generation!==generation) throw conflict();
  const checked=guard(item), timestamp=new Date().toISOString();
  const issue=outcome==='uncertain'?'Email handoff outcome is uncertain; reconcile before retrying.':null;
  const result=await env.DB.prepare(`UPDATE dispatch_queue SET status=?,updated_at=?,last_sent_at=?,last_error=?
    WHERE record_id=? AND status='sending' AND attempts=1 AND ${checked.sql}`)
    .bind(outcome,timestamp,outcome==='sent'?timestamp:null,issue,fixture.recordId,...checked.args).run();
  if (Number(result?.meta?.changes||0)!==1) throw conflict();
  // The queue is the handoff state. Updating the saved correction here would
  // change its revision and invalidate the source evidence used by the newer
  // generation-bound path. An early receipt release can still need review.
  let reconciliationPending=false;
  try {
    await releaseCompletedTimesheetDelivery(env,fixture.recordId,item.source,generation);
  } catch (_) {reconciliationPending=true;}
  return {accepted:true,outcome,reconciliationPending};
}
