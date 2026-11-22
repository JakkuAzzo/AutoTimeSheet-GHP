import payPeriods from '../../pay-periods.js';
// Internal, database-only foundation. This module has no public route and
// does not prove that a provider file is immutable or that external history is
// complete. Call only after independent source and destination verification.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digestPattern=/^[0-9a-f]{64}$/;
const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
const conflict=()=>Object.assign(new Error('Publication source is stale or unavailable'),{status:409});
const watermark=(oid,upn)=>`COALESCE((SELECT MAX(mark_event.event_id) FROM timesheet_ownership_review_events mark_event
 JOIN timesheet_ownership_reviews mark_review ON mark_review.review_id=mark_event.review_id
 LEFT JOIN records mark_record ON mark_record.record_id=mark_review.record_id
 WHERE lower(mark_review.subject_oid)=${oid} OR lower(mark_record.owner_upn)=${upn} OR lower(mark_record.owner_oid)=${oid}),0)`;

// Re-evaluated in the same SQL statement that selects, verifies, publishes or
// reads a pointer. Review events affecting the subject invalidate the source.
const currentSource=(allowCompleted=false)=>`EXISTS (
 SELECT 1 FROM records r
 JOIN timesheet_review_record_revisions rr ON rr.record_id=r.record_id
 JOIN timesheet_owner_revisions o ON o.owner_upn=lower(r.owner_upn)
 JOIN timesheet_queue_source_guards proof ON proof.record_id=r.record_id
 JOIN record_attachments a ON a.record_id=r.record_id AND a.field_name='attachment_record'
 JOIN dispatch_queue q ON q.record_id=r.record_id
 JOIN private_timesheet_subjects subject ON subject.employee_upn=p.subject_upn AND subject.employee_oid=p.subject_oid
 WHERE r.record_id=p.record_id AND r.kind='timesheets' AND r.action='pay_month_correction'
 AND r.status<>'Deleted' AND lower(r.owner_oid)=p.record_owner_oid AND lower(r.owner_upn)=p.record_owner_upn
 AND r.payload_json=p.payload_json AND rr.revision=p.record_revision AND o.revision=p.owner_revision
 AND COALESCE((SELECT revision FROM timesheet_owner_revisions employee_revision WHERE employee_revision.owner_upn=p.subject_upn),0)=p.subject_revision
 AND lower(proof.owner_upn)=p.record_owner_upn AND proof.owner_revision=p.owner_revision
 AND proof.source_base64=p.source_base64 AND a.content_base64=p.source_base64
 AND (q.status IN ('queued','sending','sent') ${allowCompleted ? `OR (q.status='completed' AND EXISTS (
  SELECT 1 FROM timesheet_publication_completions done WHERE done.subject_oid=p.subject_oid AND done.pay_month=p.pay_month
   AND done.revision=p.desired_revision AND done.generation=p.generation AND done.revision=p.published_revision
   AND done.generation=p.published_generation AND done.drive_id=p.published_drive_id AND done.item_id=p.published_item_id AND done.etag=p.published_etag))` : ''})
 AND ${watermark('p.subject_oid','p.subject_upn')}=p.review_watermark
 AND (SELECT json_group_array(json_array(month_key,start_date)) FROM (SELECT month_key,start_date FROM pay_month_start_settings ORDER BY month_key))=p.period_settings_json
 AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_holds held WHERE held.record_id=p.record_id)
 AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_days day WHERE
  ((day.owner_oid<>'' AND lower(day.owner_oid)=p.subject_oid) OR (day.owner_upn<>'' AND lower(day.owner_upn)=p.subject_upn) OR (day.owner_oid='' AND day.owner_upn=''))
  AND (day.source_day='*' OR day.source_day BETWEEN p.cycle_start AND p.cycle_end))
 AND ((lower(r.owner_oid)=p.subject_oid AND lower(r.owner_upn)=p.subject_upn AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews old WHERE old.record_id=r.record_id))
   OR EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id AND review.record_revision=rr.revision
     AND lower(review.subject_oid)=p.subject_oid AND review.payload_sha256=p.payload_sha256
     AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_review_events event WHERE event.review_id=review.review_id AND event.event_type IN ('revoked','invalidated'))))
 AND NOT EXISTS (SELECT 1 FROM records other WHERE other.kind IN ('timesheets','clock') AND other.status<>'Deleted'
   AND ((lower(other.owner_oid)=p.subject_oid AND lower(other.owner_upn)<>p.subject_upn)
     OR (lower(other.owner_upn)=p.subject_upn AND lower(other.owner_oid)<>p.subject_oid AND NOT EXISTS (
       SELECT 1 FROM timesheet_ownership_reviews other_review JOIN timesheet_review_record_revisions other_revision ON other_revision.record_id=other_review.record_id
       WHERE other_review.record_id=other.record_id AND other_review.record_revision=other_revision.revision AND lower(other_review.subject_oid)=p.subject_oid
       AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_review_events other_event WHERE other_event.review_id=other_review.review_id AND other_event.event_type IN ('revoked','invalidated'))))))
)`;
const current=currentSource(),currentWithCompletion=currentSource(true);
const completeAttachments=`EXISTS (SELECT 1 FROM timesheet_queue_attachment_guards g WHERE g.record_id=p.record_id
 AND json_valid(g.manifest_json) AND json_type(g.manifest_json)='array' AND json_array_length(g.manifest_json)>=3
 AND json_array_length(g.manifest_json)=(SELECT count(*) FROM record_attachments a WHERE a.record_id=p.record_id)
 AND json_array_length(g.manifest_json)=(SELECT count(DISTINCT json_extract(item.value,'$.fieldName')) FROM json_each(g.manifest_json) item)
 AND NOT EXISTS (SELECT 1 FROM json_each(g.manifest_json) item WHERE NOT EXISTS (
  SELECT 1 FROM record_attachments a WHERE a.record_id=p.record_id AND a.field_name=json_extract(item.value,'$.fieldName')
   AND a.file_name=json_extract(item.value,'$.fileName') AND a.content_type=json_extract(item.value,'$.contentType')
   AND a.content_base64=json_extract(item.value,'$.contentBase64') AND a.size_bytes=json_extract(item.value,'$.sizeBytes')))
 AND EXISTS (SELECT 1 FROM record_attachments a WHERE a.record_id=p.record_id AND a.field_name='attachment')
 AND EXISTS (SELECT 1 FROM record_attachments a WHERE a.record_id=p.record_id AND a.field_name='attachment_csv')
 AND EXISTS (SELECT 1 FROM record_attachments a WHERE a.record_id=p.record_id AND a.field_name='attachment_record'))`;

async function sha(bytes){const result=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return Array.from(result,n=>n.toString(16).padStart(2,'0')).join('');}
function normal(value){return typeof value==='string'?value.trim().toLowerCase():'';}
function iso(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
function requireCandidate(value){
 if(!Number.isSafeInteger(value.publicationRevision)||value.publicationRevision<1||!digestPattern.test(value.generation||'')||
    typeof value.driveId!=='string'||!value.driveId.trim()||value.driveId.length>256||/[\x00-\x1f\x7f]/.test(value.driveId)||
    typeof value.itemId!=='string'||!value.itemId.trim()||value.itemId.length>256||/[\x00-\x1f\x7f]/.test(value.itemId)||typeof value.etag!=='string'||!value.etag||value.etag.length>500||/[\x00-\x1f\x7f]/.test(value.etag))throw conflict();
}

export async function selectPublicationSource(env,request){
 const subjectOid=normal(request.subjectOid),subjectUpn=normal(request.subjectUpn),payMonth=request.payMonth;
 if(!uuid.test(subjectOid)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subjectUpn)||!monthPattern.test(payMonth||'')||
    typeof request.recordId!=='string'||!request.recordId||request.recordId.length>256||
    !Number.isSafeInteger(request.ownerRevision)||request.ownerRevision<1||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0||
    typeof request.payloadJson!=='string'||typeof request.sourceBase64!=='string'||request.sourceBase64.length>300000||!digestPattern.test(request.generation||''))throw conflict();
 let bytes,source,payload;try{bytes=Uint8Array.from(atob(request.sourceBase64),c=>c.charCodeAt(0));source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));payload=JSON.parse(request.payloadJson);}catch(_){throw conflict();}
 if(await sha(bytes)!==request.generation||![2,3].includes(source?.schemaVersion)||source.mode!=='replace-pay-month'||source.recordId!==request.recordId||
    normal(source.employeeUpn)!==subjectUpn||source.payMonth!==payMonth||payload?.payMonth!==payMonth||!iso(source.cycleStart)||!iso(source.cycleEnd)||source.cycleStart>source.cycleEnd)throw conflict();
 const subject=await env.DB.prepare('SELECT employee_oid FROM private_timesheet_subjects WHERE employee_upn=?').bind(subjectUpn).first();
 if(normal(subject?.employee_oid)!==subjectOid)throw conflict();
 const settings=await env.DB.prepare('SELECT month_key AS monthKey,start_date AS startDate FROM pay_month_start_settings ORDER BY month_key').all();
 if(!Array.isArray(settings?.results)||settings.results.some(value=>!monthPattern.test(value.monthKey||'')||!iso(value.startDate)))throw conflict();
 const period=payPeriods.createPayPeriods(settings.results).periodForMonth(payMonth);
 if(!period||period.start!==source.cycleStart||period.cycleEnd!==source.cycleEnd)throw conflict();
 const periodSettings=JSON.stringify(settings.results.map(value=>[value.monthKey,value.startDate]));
 const row=await env.DB.prepare(`SELECT lower(r.owner_oid) AS owner_oid,lower(r.owner_upn) AS owner_upn,rr.revision AS record_revision,
   COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0) AS subject_revision,${watermark('?','?')} AS review_watermark
   FROM records r JOIN timesheet_review_record_revisions rr ON rr.record_id=r.record_id WHERE r.record_id=?`).bind(subjectUpn,subjectOid,subjectUpn,subjectOid,request.recordId).first();
 if(!row)return null;
 const payloadHash=await sha(new TextEncoder().encode(request.payloadJson));
 const sameSnapshot=['subject_upn','cycle_start','cycle_end','record_id','record_owner_oid','record_owner_upn',
   'payload_json','payload_sha256','source_base64','generation','owner_revision','subject_revision','record_revision',
   'review_watermark','period_settings_json'].map(column=>`timesheet_publication_scopes.${column} IS excluded.${column}`).join(' AND ');
 const query=`WITH input(subject_oid,subject_upn,pay_month,cycle_start,cycle_end,record_id,record_owner_oid,record_owner_upn,payload_json,payload_sha256,source_base64,generation,owner_revision,subject_revision,record_revision,review_watermark,period_settings_json) AS (VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?))
 INSERT INTO timesheet_publication_scopes(subject_oid,subject_upn,pay_month,cycle_start,cycle_end,record_id,record_owner_oid,record_owner_upn,payload_json,payload_sha256,source_base64,generation,owner_revision,subject_revision,record_revision,review_watermark,period_settings_json,desired_revision)
 SELECT p.*,1 FROM input p WHERE ${current} AND (?=0 OR EXISTS (SELECT 1 FROM timesheet_publication_scopes previous WHERE previous.subject_oid=p.subject_oid AND previous.pay_month=p.pay_month))
 ON CONFLICT(subject_oid,pay_month) DO UPDATE SET cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,record_id=excluded.record_id,record_owner_oid=excluded.record_owner_oid,record_owner_upn=excluded.record_owner_upn,payload_json=excluded.payload_json,
 payload_sha256=excluded.payload_sha256,source_base64=excluded.source_base64,generation=excluded.generation,owner_revision=excluded.owner_revision,subject_revision=excluded.subject_revision,
 record_revision=excluded.record_revision,review_watermark=excluded.review_watermark,period_settings_json=excluded.period_settings_json,
 desired_revision=CASE WHEN ${sameSnapshot} THEN timesheet_publication_scopes.desired_revision ELSE timesheet_publication_scopes.desired_revision+1 END
 WHERE timesheet_publication_scopes.subject_upn=excluded.subject_upn AND
   (timesheet_publication_scopes.desired_revision=? OR (${sameSnapshot} AND timesheet_publication_scopes.desired_revision=?+1))
 RETURNING desired_revision`;
 const result=await env.DB.prepare(query).bind(subjectOid,subjectUpn,payMonth,source.cycleStart,source.cycleEnd,request.recordId,normal(row.owner_oid),normal(row.owner_upn),request.payloadJson,payloadHash,request.sourceBase64,request.generation,request.ownerRevision,Number(row.subject_revision),Number(row.record_revision),Number(row.review_watermark),periodSettings,request.expectedRevision,request.expectedRevision,request.expectedRevision).first();
 return result?.desired_revision??null;
}

// A candidate must not be a workbook already addressable by the older writer.
// This check is necessary, but does not itself make a provider file immutable.
const notKnownToOldWriter = item => `NOT EXISTS (SELECT 1 FROM private_timesheet_workbooks w WHERE w.workbook_id=${item}) AND NOT EXISTS (SELECT 1 FROM timesheet_delivery_routes r WHERE r.workbook_id=${item})`;

// Database-only handoff primitives. A caller must establish source completeness,
// recipient authorization and the provider fence before sending. An error from
// the claim may mean it committed; never infer permission to resend from it.
export async function claimPublicationHandoff(env,request){
 const oid=normal(request.subjectOid),month=request.payMonth,at=request.claimedAt;
 if(!uuid.test(oid)||!monthPattern.test(month||'')||!Number.isSafeInteger(request.publicationRevision)||request.publicationRevision<1||
  !digestPattern.test(request.generation||'')||typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||
  !Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw conflict();
 const attemptId=crypto.randomUUID();
 const result=await env.DB.prepare(`INSERT INTO timesheet_publication_attempts(attempt_id,record_id,subject_oid,pay_month,revision,generation,claimed_at)
 SELECT ?,p.record_id,p.subject_oid,p.pay_month,p.desired_revision,p.generation,? FROM timesheet_publication_scopes p
 JOIN dispatch_queue q ON q.record_id=p.record_id
 WHERE p.subject_oid=? AND p.pay_month=? AND p.desired_revision=? AND p.generation=?
  AND q.status='queued' AND q.attempts=0 AND q.next_attempt_at<=? AND ${current} AND ${completeAttachments}
  AND NOT EXISTS (SELECT 1 FROM dispatch_queue other JOIN records r ON r.record_id=other.record_id
   WHERE other.record_id<>p.record_id AND other.status IN ('sending','sent','failed','uncertain')
    AND r.kind='timesheets' AND r.action='pay_month_correction' AND
    (lower(r.owner_oid)=p.subject_oid OR lower(r.owner_upn)=p.subject_upn OR EXISTS
     (SELECT 1 FROM timesheet_ownership_reviews reviewed WHERE reviewed.record_id=r.record_id AND lower(reviewed.subject_oid)=p.subject_oid)))
 ON CONFLICT DO NOTHING RETURNING attempt_id`)
 .bind(attemptId,at,oid,month,request.publicationRevision,request.generation,at).first();
 return result?.attempt_id===attemptId?{attemptId}:null;
}

// Internal, read-only recovery of the exact current claim after a lost response.
// The caller must authenticate and authorize access; this neither proves remote
// acceptance nor grants permission to resend or confirm the handoff.
export async function findPublicationAttempt(env,request){
 const oid=normal(request.subjectOid),month=request.payMonth,record=request.recordId;
 if(!uuid.test(oid)||!monthPattern.test(month||'')||!Number.isSafeInteger(request.publicationRevision)||request.publicationRevision<1||
  !digestPattern.test(request.generation||'')||typeof record!=='string'||!record.trim()||record.length>240||/[\x00-\x1f\x7f]/.test(record))throw conflict();
 const result=await env.DB.prepare(`SELECT a.attempt_id AS attemptId,q.status AS status,b.flow_run_id AS flowRunId
 FROM timesheet_publication_attempts a JOIN timesheet_publication_scopes p
  ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month AND p.desired_revision=a.revision AND p.generation=a.generation
 JOIN dispatch_queue q ON q.record_id=a.record_id LEFT JOIN timesheet_publication_run_bindings b ON b.attempt_id=a.attempt_id
 WHERE a.record_id=? AND a.subject_oid=? AND a.pay_month=? AND a.revision=? AND a.generation=?`)
  .bind(record,oid,month,request.publicationRevision,request.generation).first();
 return result?{attemptId:result.attemptId,status:result.status,flowRunId:result.flowRunId??null}:null;
}

// Records a known successful handoff without changing the reviewed record.
// The caller is responsible for establishing the remote acceptance.
export async function confirmPublicationHandoff(env,request){
 const oid=normal(request.subjectOid),month=request.payMonth,attemptId=normal(request.attemptId),at=request.sentAt||request.claimedAt;
 if(!uuid.test(oid)||!uuid.test(attemptId)||!monthPattern.test(month||'')||!Number.isSafeInteger(request.publicationRevision)||request.publicationRevision<1||
  !digestPattern.test(request.generation||'')||typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||
  !Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw conflict();
 const result=await env.DB.prepare(`UPDATE dispatch_queue SET status='sent',updated_at=?,last_sent_at=?,last_error=NULL
 WHERE status='sending' AND EXISTS (SELECT 1 FROM timesheet_publication_attempts a JOIN timesheet_publication_scopes p
  ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month AND p.desired_revision=a.revision AND p.generation=a.generation
  WHERE a.attempt_id=? AND a.record_id=dispatch_queue.record_id AND a.subject_oid=? AND a.pay_month=? AND a.revision=? AND a.generation=? AND a.claimed_at<=?)
 RETURNING record_id`).bind(at,at,attemptId,oid,month,request.publicationRevision,request.generation,at).first();
 return !!result;
}

export async function markPublicationHandoffUncertain(env,request){
 const oid=normal(request.subjectOid),month=request.payMonth,attemptId=normal(request.attemptId),at=request.uncertainAt||request.claimedAt;
 if(!uuid.test(oid)||!uuid.test(attemptId)||!monthPattern.test(month||'')||!Number.isSafeInteger(request.publicationRevision)||request.publicationRevision<1||
  !digestPattern.test(request.generation||'')||typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||
  !Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw conflict();
 const result=await env.DB.prepare(`UPDATE dispatch_queue SET status='uncertain',updated_at=?,last_error='Handoff outcome is uncertain; reconcile before retrying.'
 WHERE status='sending' AND EXISTS (SELECT 1 FROM timesheet_publication_attempts a JOIN timesheet_publication_scopes p
  ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month AND p.desired_revision=a.revision AND p.generation=a.generation
  WHERE a.attempt_id=? AND a.record_id=dispatch_queue.record_id AND a.subject_oid=? AND a.pay_month=? AND a.revision=? AND a.generation=? AND a.claimed_at<=?)
 RETURNING record_id`).bind(at,attemptId,oid,month,request.publicationRevision,request.generation,at).first();
 return !!result;
}

// Internal only: the calling route must independently authenticate the run.
export async function bindPublicationFlow(env,request){
 const oid=normal(request.subjectOid),month=request.payMonth,attemptId=normal(request.attemptId),at=request.boundAt||request.claimedAt,run=request.flowRunId;
 if(!uuid.test(oid)||!uuid.test(attemptId)||!monthPattern.test(month||'')||!Number.isSafeInteger(request.publicationRevision)||request.publicationRevision<1||
  !digestPattern.test(request.generation||'')||typeof run!=='string'||!run.trim()||run.length>240||/[\x00-\x1f\x7f]/.test(run)||
  typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw conflict();
 const existing=()=>env.DB.prepare(`SELECT 1 AS ok FROM timesheet_publication_run_bindings b JOIN timesheet_publication_attempts a ON a.attempt_id=b.attempt_id
  JOIN timesheet_publication_scopes p ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month AND p.desired_revision=a.revision AND p.generation=a.generation
  WHERE b.attempt_id=? AND b.flow_run_id=? AND a.subject_oid=? AND a.pay_month=? AND a.revision=? AND a.generation=?`).bind(attemptId,run,oid,month,request.publicationRevision,request.generation).first();
 if(await existing())return;
 const result=await env.DB.prepare(`INSERT INTO timesheet_publication_run_bindings(attempt_id,flow_run_id,bound_at)
 SELECT a.attempt_id,?,? FROM timesheet_publication_attempts a JOIN timesheet_publication_scopes p
  ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month AND p.desired_revision=a.revision AND p.generation=a.generation
 JOIN dispatch_queue q ON q.record_id=a.record_id
 WHERE a.attempt_id=? AND a.subject_oid=? AND a.pay_month=? AND a.revision=? AND a.generation=? AND a.claimed_at<=? AND q.status IN ('sending','sent','uncertain')
 ON CONFLICT DO NOTHING RETURNING attempt_id`).bind(run,at,attemptId,oid,month,request.publicationRevision,request.generation,at).first();
 if(result?.attempt_id===attemptId||await existing())return;
 throw conflict();
}

// The caller must authenticate the bound run and protect the returned source.
// This read does not authorize any destination or provider workbook write.
export async function readPublicationSourceForRun(env,request){
 const oid=normal(request.subjectOid),month=request.payMonth,attemptId=normal(request.attemptId),run=request.flowRunId;
 if(!uuid.test(oid)||!uuid.test(attemptId)||!monthPattern.test(month||'')||!Number.isSafeInteger(request.publicationRevision)||request.publicationRevision<1||
  !digestPattern.test(request.generation||'')||typeof run!=='string'||!run.trim()||run.length>240||/[\x00-\x1f\x7f]/.test(run))throw conflict();
 const result=await env.DB.prepare(`SELECT p.record_id AS recordId,p.pay_month AS payMonth,p.generation,p.source_base64 AS sourceBase64
  FROM timesheet_publication_scopes p JOIN timesheet_publication_attempts a ON a.record_id=p.record_id AND a.subject_oid=p.subject_oid
   AND a.pay_month=p.pay_month AND a.revision=p.desired_revision AND a.generation=p.generation
  JOIN timesheet_publication_run_bindings b ON b.attempt_id=a.attempt_id JOIN dispatch_queue q ON q.record_id=p.record_id
  WHERE p.subject_oid=? AND p.pay_month=? AND p.desired_revision=? AND p.generation=? AND a.attempt_id=? AND b.flow_run_id=?
   AND q.status IN ('sending','sent') AND ${current} AND ${completeAttachments}`)
  .bind(oid,month,request.publicationRevision,request.generation,attemptId,run).first();
 if(!result)throw conflict();
 return {recordId:result.recordId,payMonth:result.payMonth,generation:result.generation,sourceBase64:result.sourceBase64};
}

export async function recordPublicationCandidate(env,request){
 requireCandidate(request);const oid=normal(request.subjectOid),month=request.payMonth;if(!uuid.test(oid)||!monthPattern.test(month||''))throw conflict();
 const result=await env.DB.prepare(`INSERT INTO timesheet_publication_candidates(subject_oid,pay_month,revision,generation,drive_id,item_id,etag)
 SELECT p.subject_oid,p.pay_month,p.desired_revision,p.generation,?,?,? FROM timesheet_publication_scopes p
 WHERE p.subject_oid=? AND p.pay_month=? AND p.desired_revision=? AND p.generation=? AND ${current} AND ${notKnownToOldWriter('?')}
 ON CONFLICT DO NOTHING`)
 .bind(request.driveId,request.itemId,request.etag,oid,month,request.publicationRevision,request.generation,request.itemId,request.itemId).run();
 if(Number(result?.meta?.changes)===1)return;
 const existing=await env.DB.prepare(`SELECT 1 AS ok FROM timesheet_publication_candidates c JOIN timesheet_publication_scopes p
 ON p.subject_oid=c.subject_oid AND p.pay_month=c.pay_month AND p.desired_revision=c.revision AND p.generation=c.generation
 WHERE c.subject_oid=? AND c.pay_month=? AND c.revision=? AND c.generation=? AND c.drive_id=? AND c.item_id=? AND c.etag=? AND ${current} AND ${notKnownToOldWriter('c.item_id')}`)
 .bind(oid,month,request.publicationRevision,request.generation,request.driveId,request.itemId,request.etag).first();
 if(!existing)throw conflict();
}

export async function publishCandidate(env,request){
 requireCandidate(request);const oid=normal(request.subjectOid),month=request.payMonth;if(!uuid.test(oid)||!monthPattern.test(month||''))throw conflict();
 const result=await env.DB.prepare(`UPDATE timesheet_publication_scopes AS p SET published_revision=?,published_generation=?,published_drive_id=?,published_item_id=?,published_etag=?
 WHERE p.subject_oid=? AND p.pay_month=? AND p.desired_revision=? AND p.generation=? AND ${current}
 AND EXISTS(SELECT 1 FROM timesheet_publication_candidates c WHERE c.subject_oid=p.subject_oid AND c.pay_month=p.pay_month AND c.revision=? AND c.generation=? AND c.drive_id=? AND c.item_id=? AND c.etag=? AND ${notKnownToOldWriter('c.item_id')})
 AND (p.published_revision IS NULL OR p.published_revision<? OR (p.published_revision=? AND p.published_generation=? AND p.published_drive_id=? AND p.published_item_id=? AND p.published_etag=?)) RETURNING published_revision`)
 .bind(request.publicationRevision,request.generation,request.driveId,request.itemId,request.etag,oid,month,request.publicationRevision,request.generation,request.publicationRevision,request.generation,request.driveId,request.itemId,request.etag,request.publicationRevision,request.publicationRevision,request.generation,request.driveId,request.itemId,request.etag).first();
 return !!result;
}

// Internal entry point only. The caller must independently establish that
// the sealed candidate and run were verified; this function provides D1
// ordering and exact binding, not provider verification or immutability.
export async function completePublishedCandidate(env,request){
 requireCandidate(request);
 const oid=normal(request.subjectOid),month=request.payMonth,attemptId=normal(request.attemptId);
 if(!uuid.test(oid)||!uuid.test(attemptId)||!monthPattern.test(month||'')||typeof request.flowRunId!=='string'||!request.flowRunId.trim()||
    request.flowRunId.length>240||/[\x00-\x1f\x7f]/.test(request.flowRunId)||!digestPattern.test(request.verificationDigest||'')||
    typeof request.completedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(request.completedAt)||
    !Number.isFinite(Date.parse(request.completedAt))||new Date(request.completedAt).toISOString()!==request.completedAt)throw conflict();
 const values=[oid,month,request.publicationRevision,request.generation,request.driveId,request.itemId,request.etag,request.flowRunId,request.verificationDigest,request.completedAt];
 const existing=async()=>env.DB.prepare(`SELECT 1 AS ok FROM timesheet_publication_completions done JOIN timesheet_publication_scopes p
  ON p.subject_oid=done.subject_oid AND p.pay_month=done.pay_month AND p.desired_revision=done.revision
  JOIN dispatch_queue completed_queue ON completed_queue.record_id=p.record_id AND completed_queue.status='completed'
  JOIN timesheet_publication_attempts a ON a.record_id=p.record_id AND a.subject_oid=done.subject_oid AND a.pay_month=done.pay_month AND a.revision=done.revision AND a.generation=done.generation
  JOIN timesheet_publication_run_bindings b ON b.attempt_id=a.attempt_id AND b.flow_run_id=done.flow_run_id
  WHERE done.subject_oid=? AND done.pay_month=? AND done.revision=? AND done.generation=? AND done.drive_id=? AND done.item_id=? AND done.etag=?
   AND done.flow_run_id=? AND done.verification_digest=? AND done.completed_at=? AND a.attempt_id=? AND ${currentWithCompletion} AND ${notKnownToOldWriter('done.item_id')}`)
  .bind(...values,attemptId).first();
 if(await existing())return;
 let result;
 try{
  result=await env.DB.prepare(`INSERT INTO timesheet_publication_completions(subject_oid,pay_month,revision,generation,drive_id,item_id,etag,flow_run_id,verification_digest,completed_at)
   SELECT p.subject_oid,p.pay_month,p.desired_revision,p.generation,?,?,?,?,?,? FROM timesheet_publication_scopes p
   JOIN dispatch_queue q ON q.record_id=p.record_id
   WHERE p.subject_oid=? AND p.pay_month=? AND p.desired_revision=? AND p.generation=? AND q.status='sent' AND ${current}
    AND p.published_revision=? AND p.published_generation=? AND p.published_drive_id=? AND p.published_item_id=? AND p.published_etag=?
    AND EXISTS (SELECT 1 FROM timesheet_publication_attempts a JOIN timesheet_publication_run_bindings b ON b.attempt_id=a.attempt_id
      WHERE a.record_id=p.record_id AND a.subject_oid=p.subject_oid AND a.pay_month=p.pay_month AND a.revision=p.desired_revision AND a.generation=p.generation AND a.attempt_id=? AND b.flow_run_id=?)
    AND ${notKnownToOldWriter('?')}
   ON CONFLICT DO NOTHING RETURNING revision`)
   .bind(request.driveId,request.itemId,request.etag,request.flowRunId,request.verificationDigest,request.completedAt,
    oid,month,request.publicationRevision,request.generation,request.publicationRevision,request.generation,request.driveId,request.itemId,request.etag,attemptId,request.flowRunId,request.itemId,request.itemId).first();
 }catch(error){if(await existing())return;throw error;}
 if(result?.revision===request.publicationRevision || await existing())return;
 throw conflict();
}

export async function readPublishedCandidate(env,{subjectOid,payMonth}){
 const oid=normal(subjectOid);if(!uuid.test(oid)||!monthPattern.test(payMonth||''))throw conflict();
 const result=await env.DB.prepare(`SELECT p.published_drive_id AS driveId,p.published_item_id AS itemId,p.published_etag AS etag,p.published_revision AS revision,p.published_generation AS generation FROM timesheet_publication_scopes p
 WHERE p.subject_oid=? AND p.pay_month=? AND p.published_revision=p.desired_revision AND p.published_generation=p.generation
 AND EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=p.record_id AND q.status='completed')
 AND EXISTS (SELECT 1 FROM timesheet_publication_completions done JOIN timesheet_publication_attempts a
  ON a.record_id=p.record_id AND a.subject_oid=done.subject_oid AND a.pay_month=done.pay_month AND a.revision=done.revision AND a.generation=done.generation
  JOIN timesheet_publication_run_bindings b ON b.attempt_id=a.attempt_id AND b.flow_run_id=done.flow_run_id
  WHERE done.subject_oid=p.subject_oid AND done.pay_month=p.pay_month AND done.revision=p.published_revision AND done.generation=p.published_generation
  AND done.drive_id=p.published_drive_id AND done.item_id=p.published_item_id AND done.etag=p.published_etag)
 AND ${currentWithCompletion} AND ${notKnownToOldWriter('p.published_item_id')}`).bind(oid,payMonth).first();
 return result||null;
}
