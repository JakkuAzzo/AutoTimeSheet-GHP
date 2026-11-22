// Internal evidence store. The route must authenticate a timesheet reviewer
// and verify the actual private provider item before calling recordReview.
// No function here releases a queue or changes SharePoint permissions.
const ref=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier=/^[A-Za-z0-9!_-]{1,256}$/;
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const validTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
function validRows(payload,dates,source){
  let value;try{value=JSON.parse(payload)}catch(_){return false}
  if(!value||!Array.isArray(value.rows)||value.rows.length>62)return false;
  return dates.every(date=>{const rows=value.rows.filter(row=>row&&typeof row==='object'&&row.date===date);return rows.length===1&&String(rows[0].sourceEvidence?.sourceId||'').toLowerCase()===source;});
}
function ratesCanBeReviewed(snapshot){
  const rows=JSON.parse(snapshot.recordPayload).rows.filter(row=>snapshot.dates.includes(row.date));
  return rows.every(row=>{
    const evidence=row.sourceEvidence||{};
    return ['claimedBasic','claimedOt15','claimedOt20'].every(key=>{
      const value=evidence[key];
      return value===null||value===undefined||value===''||(evidence.rateEvidenceVersion===1&&Number.isInteger(value)&&value>=0&&value<=1440);
    });
  });
}
export async function getPrivateOriginalReviewSnapshot(DB,intentId){
  if(!DB||typeof DB.prepare!=='function'||!ref.test(String(intentId||'')))return null;
  const row=await DB.prepare(`SELECT i.intent_id,i.record_id,i.employee_oid,i.owner_upn,i.owner_revision,i.payload_sha256,i.source_sha256,i.dates_json,i.actor_oid,
    p.vault_id,p.item_id,p.item_etag,p.file_name,r.payload_json,
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_private_original_review_events e JOIN timesheet_private_original_reviews review ON review.review_id=e.review_id WHERE review.intent_id=i.intent_id),0) AS event_id
    FROM timesheet_original_filing_intents i JOIN timesheet_private_originals p ON p.intent_id=i.intent_id JOIN records r ON r.record_id=i.record_id
    WHERE i.intent_id=? AND p.record_id=i.record_id AND lower(p.employee_oid)=lower(i.employee_oid) AND p.source_sha256=i.source_sha256 AND p.review_state='pending'
      AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted' AND lower(r.owner_oid)=lower(i.employee_oid) AND lower(r.owner_upn)=lower(i.owner_upn)
      AND EXISTS(SELECT 1 FROM private_timesheet_subjects s WHERE lower(s.employee_upn)=lower(i.owner_upn) AND lower(s.employee_oid)=lower(i.employee_oid))
      AND EXISTS(SELECT 1 FROM timesheet_owner_revisions v WHERE lower(v.owner_upn)=lower(i.owner_upn) AND v.revision=i.owner_revision)
      AND NOT EXISTS(SELECT 1 FROM timesheet_original_filing_revocations x WHERE x.intent_id=i.intent_id)
      AND NOT EXISTS(SELECT 1 FROM dispatch_queue q WHERE q.record_id=i.record_id AND q.status IN ('queued','sending','sent','failed','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records origin ON origin.record_id=review.record_id WHERE lower(review.subject_oid)=lower(i.employee_oid) OR lower(origin.owner_upn)=lower(i.owner_upn))`).bind(intentId).first();
  if(!row||!uuid.test(String(row.employee_oid||''))||!/^[a-f0-9]{64}$/.test(String(row.source_sha256||''))||!identifier.test(String(row.vault_id||''))||!identifier.test(String(row.item_id||''))||
     !new RegExp('^'+row.source_sha256+'\\.(?:pdf|doc|docx|docm|xls|xlsx|csv|txt|json|png|jpg|jpeg)$').test(String(row.file_name||''))||typeof row.item_etag!=='string'||!row.item_etag||row.item_etag.length>512||/[\x00-\x1f]/.test(row.item_etag)||!Number.isSafeInteger(row.owner_revision)||!Number.isSafeInteger(row.event_id)||typeof row.payload_json!=='string'||row.payload_json.length>1000000)return null;
  let dates;try{dates=JSON.parse(row.dates_json)}catch(_){return null}
  if(!Array.isArray(dates)||!dates.length||dates.length>62||!dates.every(day)||new Set(dates).size!==dates.length||!validRows(row.payload_json,dates,row.source_sha256)||await digest(row.payload_json)!==row.payload_sha256)return null;
  return {intentId:row.intent_id,recordId:row.record_id,employeeOid:row.employee_oid.toLowerCase(),ownerUpn:row.owner_upn.toLowerCase(),ownerRevision:row.owner_revision,payloadSha256:row.payload_sha256,recordPayload:row.payload_json,sourceSha256:row.source_sha256,dates,creatorOid:row.actor_oid,eventId:row.event_id,
    original:{vaultId:row.vault_id,itemId:row.item_id,eTag:row.item_etag,fileName:row.file_name,sourceSha256:row.source_sha256,reviewState:'pending'}};
}
export async function recordPrivateOriginalReview(DB,input,verifyOriginal,at=new Date().toISOString()){
  if(!input||!uuid.test(String(input.reviewerOid||''))||input.confirmed!==true||!/^[a-f0-9]{64}$/.test(String(input.expectedPayloadSha256||''))||typeof input.expectedFileEtag!=='string'||!Number.isSafeInteger(input.expectedEventId)||input.expectedEventId<0||typeof verifyOriginal!=='function'||!validTime(at))return null;
  const current=await getPrivateOriginalReviewSnapshot(DB,input.intentId);
  if(!current||current.payloadSha256!==input.expectedPayloadSha256||current.original.eTag!==input.expectedFileEtag||current.eventId!==input.expectedEventId||!ratesCanBeReviewed(current))return null;
  if(await verifyOriginal(current.original)!==true)return null;
  const reviewId=crypto.randomUUID(),original=current.original,dates=JSON.stringify(current.dates.slice().sort());
  const result=await DB.prepare(`INSERT INTO timesheet_private_original_reviews(review_id,intent_id,record_id,employee_oid,owner_upn,owner_revision,payload_sha256,source_sha256,dates_json,vault_id,item_id,item_etag,file_name,reviewer_oid,reviewed_at,decision)
    SELECT ?,i.intent_id,i.record_id,lower(i.employee_oid),lower(i.owner_upn),i.owner_revision,i.payload_sha256,i.source_sha256,i.dates_json,p.vault_id,p.item_id,p.item_etag,p.file_name,?,?,'rows_match'
    FROM timesheet_original_filing_intents i JOIN timesheet_private_originals p ON p.intent_id=i.intent_id JOIN records r ON r.record_id=i.record_id
    WHERE i.intent_id=? AND i.record_id=? AND lower(i.employee_oid)=? AND lower(i.owner_upn)=? AND i.owner_revision=? AND i.payload_sha256=? AND i.source_sha256=? AND i.dates_json=?
      AND p.record_id=i.record_id AND lower(p.employee_oid)=lower(i.employee_oid) AND p.source_sha256=i.source_sha256 AND p.review_state='pending' AND p.vault_id=? AND p.item_id=? AND p.item_etag=? AND p.file_name=?
      AND r.payload_json=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted' AND lower(r.owner_oid)=lower(i.employee_oid) AND lower(r.owner_upn)=lower(i.owner_upn)
      AND EXISTS(SELECT 1 FROM private_timesheet_subjects s WHERE lower(s.employee_upn)=lower(i.owner_upn) AND lower(s.employee_oid)=lower(i.employee_oid))
      AND EXISTS(SELECT 1 FROM timesheet_owner_revisions v WHERE lower(v.owner_upn)=lower(i.owner_upn) AND v.revision=i.owner_revision)
      AND NOT EXISTS(SELECT 1 FROM timesheet_original_filing_revocations x WHERE x.intent_id=i.intent_id)
      AND NOT EXISTS(SELECT 1 FROM dispatch_queue q WHERE q.record_id=i.record_id AND q.status IN ('queued','sending','sent','failed','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records origin ON origin.record_id=review.record_id WHERE lower(review.subject_oid)=lower(i.employee_oid) OR lower(origin.owner_upn)=lower(i.owner_upn))
      AND COALESCE((SELECT MAX(e.event_id) FROM timesheet_private_original_review_events e JOIN timesheet_private_original_reviews prior ON prior.review_id=e.review_id WHERE prior.intent_id=i.intent_id),0)=?
      AND NOT EXISTS(SELECT 1 FROM timesheet_private_original_reviews prior WHERE prior.intent_id=i.intent_id AND NOT EXISTS(SELECT 1 FROM timesheet_private_original_review_events e WHERE e.review_id=prior.review_id AND e.event_type='revoked'))`)
    .bind(reviewId,String(input.reviewerOid).toLowerCase(),at,current.intentId,current.recordId,current.employeeOid,current.ownerUpn,current.ownerRevision,current.payloadSha256,current.sourceSha256,dates,original.vaultId,original.itemId,original.eTag,original.fileName,current.recordPayload,current.eventId).run();
  return Number(result?.meta?.changes||0)>0?{reviewId}:null;
}
export async function revokePrivateOriginalReview(DB,input,at=new Date().toISOString()){
  if(!DB||typeof DB.prepare!=='function'||!input||!ref.test(String(input.intentId||''))||!uuid.test(String(input.reviewId||''))||!uuid.test(String(input.actorOid||''))||!validTime(at))return false;
  const result=await DB.prepare(`INSERT INTO timesheet_private_original_review_events(review_id,event_type,actor_oid,occurred_at)
    SELECT review.review_id,'revoked',?,? FROM timesheet_private_original_reviews review WHERE review.review_id=? AND review.intent_id=?
      AND NOT EXISTS(SELECT 1 FROM timesheet_private_original_review_events e WHERE e.review_id=review.review_id AND e.event_type='revoked')`).bind(String(input.actorOid).toLowerCase(),at,input.reviewId,input.intentId).run();
  return Number(result?.meta?.changes||0)===1;
}
