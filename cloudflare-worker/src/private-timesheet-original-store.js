// The caller must authenticate and authorise creation of the immutable filing
// intent. A pending file binding is not a source review or a delivery permit.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier=/^[A-Za-z0-9!_-]{1,256}$/;
const reference=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const date=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
async function sha256(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
const validTime=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
function sourceDatesMatch(recordPayload,dates,sourceSha256){
  let payload;try{payload=JSON.parse(recordPayload);}catch(_){return false;}
  if(!payload || typeof payload!=='object' || !Array.isArray(payload.rows) || payload.rows.length>62)return false;
  return dates.every(day=>{
    const rows=payload.rows.filter(row=>row && typeof row==='object' && row.date===day);
    return rows.length===1 && String(rows[0].sourceEvidence?.sourceId||'').toLowerCase()===sourceSha256;
  });
}

// `authorise` is supplied by an authenticated route and must check the
// current caller's rights over the resolved employee and correction. A filing
// intent only permits storing an original; it does not approve its contents.
export async function createPrivateOriginalIntent(DB,input,authorise,at=new Date().toISOString()){
  const recordId=String(input?.recordId||''),employee=String(input?.employeeOid||'').toLowerCase(),owner=String(input?.ownerUpn||'').trim().toLowerCase(),source=String(input?.sourceSha256||'').toLowerCase();
  const dates=Array.isArray(input?.dates)?input.dates.slice().sort():[],actor=String(input?.actorOid||'').toLowerCase(),payload=input?.recordPayload;
  if(!DB || typeof DB.prepare!=='function' || typeof authorise!=='function' || !reference.test(recordId) || !uuid.test(employee) || !uuid.test(actor) ||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) || !/^[a-f0-9]{64}$/.test(source) || !Number.isSafeInteger(input?.ownerRevision) || input.ownerRevision<0 ||
     !dates.length || dates.length>62 || !dates.every(date) || new Set(dates).size!==dates.length || typeof payload!=='string' || payload.length>1000000 || !validTime(at) || !sourceDatesMatch(payload,dates,source))return null;
  if(await authorise({actorOid:actor,employeeOid:employee,ownerUpn:owner,recordId})!==true)return null;
  const intentId=crypto.randomUUID(),payloadHash=await sha256(payload),expires=new Date(Date.parse(at)+15*60*1000).toISOString(),datesJson=JSON.stringify(dates);
  const result=await DB.prepare(`INSERT INTO timesheet_original_filing_intents(intent_id,record_id,employee_oid,owner_upn,source_sha256,payload_sha256,owner_revision,dates_json,actor_oid,created_at,expires_at)
    SELECT ?,r.record_id,?,?,?, ?,?,?, ?,?,? FROM records r WHERE r.record_id=? AND lower(r.owner_oid)=? AND lower(r.owner_upn)=?
      AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted' AND r.payload_json=?
      AND EXISTS(SELECT 1 FROM private_timesheet_subjects s WHERE lower(s.employee_upn)=? AND lower(s.employee_oid)=?)
      AND EXISTS(SELECT 1 FROM timesheet_owner_revisions v WHERE lower(v.owner_upn)=? AND v.revision=?)
      AND NOT EXISTS(SELECT 1 FROM dispatch_queue q WHERE q.record_id=r.record_id AND q.status IN ('queued','sending','sent','failed','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records origin ON origin.record_id=review.record_id WHERE lower(review.subject_oid)=? OR lower(origin.owner_upn)=?)`)
    .bind(intentId,employee,owner,source,payloadHash,input.ownerRevision,datesJson,actor,at,expires,recordId,employee,owner,payload,owner,employee,owner,input.ownerRevision,employee,owner).run();
  if(Number(result?.meta?.changes||0)<1)return null;
  return readPrivateOriginalIntent(DB,intentId,details=>authorise({...details,actorOid:actor}),at);
}

// The authorisation callback must check the *current* authenticated caller;
// the creator identity returned below is context, not the caller's identity.
export async function readPrivateOriginalIntent(DB,intentId,authorise,at=new Date().toISOString()){
  if(!DB || typeof DB.prepare!=='function' || !reference.test(String(intentId||'')) || typeof authorise!=='function' || !validTime(at))return null;
  const row=await DB.prepare(`SELECT i.*,r.payload_json FROM timesheet_original_filing_intents i JOIN records r ON r.record_id=i.record_id
    WHERE i.intent_id=? AND i.created_at<=? AND i.expires_at>? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted'
      AND lower(r.owner_oid)=lower(i.employee_oid) AND lower(r.owner_upn)=lower(i.owner_upn)
      AND EXISTS(SELECT 1 FROM private_timesheet_subjects s WHERE lower(s.employee_upn)=lower(i.owner_upn) AND lower(s.employee_oid)=lower(i.employee_oid))
      AND EXISTS(SELECT 1 FROM timesheet_owner_revisions v WHERE lower(v.owner_upn)=lower(i.owner_upn) AND v.revision=i.owner_revision)
      AND NOT EXISTS(SELECT 1 FROM timesheet_original_filing_revocations x WHERE x.intent_id=i.intent_id)
      AND NOT EXISTS(SELECT 1 FROM dispatch_queue q WHERE q.record_id=i.record_id AND q.status IN ('queued','sending','sent','failed','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records origin ON origin.record_id=review.record_id WHERE lower(review.subject_oid)=lower(i.employee_oid) OR lower(origin.owner_upn)=lower(i.owner_upn))`)
    .bind(intentId,at,at).first();
  if(!row || await authorise({intentCreatorOid:row.actor_oid,employeeOid:row.employee_oid,ownerUpn:row.owner_upn,recordId:row.record_id})!==true)return null;
  let dates;try{dates=JSON.parse(row.dates_json);}catch(_){return null;}
  if(!Array.isArray(dates)||!dates.length||dates.length>62||!dates.every(date)||new Set(dates).size!==dates.length||
     await sha256(row.payload_json)!==row.payload_sha256||!sourceDatesMatch(row.payload_json,dates,row.source_sha256))return null;
  return {reviewId:row.intent_id,recordId:row.record_id,employeeOid:row.employee_oid,sourceSha256:row.source_sha256,recordRevision:row.owner_revision,dates,recordPayload:row.payload_json};
}

// Once a provider create is attempted, a lost response is ambiguous. Reserve
// the vault and byte digest globally across intents and extensions, and never
// remove the reservation automatically. A matching existing file can still be
// verified and bound without another create. The INSERT repeats the current
// correction and identity checks in the same database statement.
export async function reservePrivateOriginalCreate(DB,binding,vaultId,fileName,at=new Date().toISOString()){
  if(!DB || typeof DB.prepare!=='function' || !binding || !reference.test(String(binding.reviewId||'')) || !reference.test(String(binding.recordId||'')) ||
     !uuid.test(String(binding.employeeOid||'')) || !/^[a-f0-9]{64}$/.test(String(binding.sourceSha256||'')) || !identifier.test(String(vaultId||'')) ||
     !new RegExp('^'+binding.sourceSha256+'\\.(?:pdf|doc|docx|docm|xls|xlsx|csv|txt|json|png|jpg|jpeg)$').test(String(fileName||'')) ||
     !Number.isSafeInteger(binding.recordRevision) || binding.recordRevision<0 || !Array.isArray(binding.dates) || !binding.dates.length || binding.dates.length>62 ||
     !binding.dates.every(date) || new Set(binding.dates).size!==binding.dates.length || typeof binding.recordPayload!=='string' || binding.recordPayload.length>1000000 ||
     !validTime(at) || !sourceDatesMatch(binding.recordPayload,binding.dates,binding.sourceSha256))return false;
  const hash=await sha256(binding.recordPayload),dates=JSON.stringify(binding.dates.slice().sort()),employee=String(binding.employeeOid).toLowerCase();
  const result=await DB.prepare(`INSERT INTO timesheet_original_create_reservations(vault_id,source_sha256,intent_id,record_id,file_name,reserved_at)
    SELECT ?,i.source_sha256,i.intent_id,i.record_id,?,? FROM timesheet_original_filing_intents i JOIN records r ON r.record_id=i.record_id
    WHERE i.intent_id=? AND i.record_id=? AND lower(i.employee_oid)=? AND i.source_sha256=? AND i.payload_sha256=? AND i.owner_revision=? AND i.dates_json=?
      AND i.created_at<=? AND i.expires_at>? AND r.payload_json=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted'
      AND lower(r.owner_oid)=lower(i.employee_oid) AND lower(r.owner_upn)=lower(i.owner_upn)
      AND EXISTS(SELECT 1 FROM private_timesheet_subjects s WHERE lower(s.employee_upn)=lower(i.owner_upn) AND lower(s.employee_oid)=lower(i.employee_oid))
      AND EXISTS(SELECT 1 FROM timesheet_owner_revisions v WHERE lower(v.owner_upn)=lower(i.owner_upn) AND v.revision=i.owner_revision)
      AND NOT EXISTS(SELECT 1 FROM timesheet_original_filing_revocations x WHERE x.intent_id=i.intent_id)
      AND NOT EXISTS(SELECT 1 FROM dispatch_queue q WHERE q.record_id=i.record_id AND q.status IN ('queued','sending','sent','failed','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records origin ON origin.record_id=review.record_id WHERE lower(review.subject_oid)=lower(i.employee_oid) OR lower(origin.owner_upn)=lower(i.owner_upn))
    ON CONFLICT(vault_id,source_sha256) DO NOTHING`)
    .bind(vaultId,fileName,at,binding.reviewId,binding.recordId,employee,binding.sourceSha256,hash,binding.recordRevision,dates,at,at,binding.recordPayload).run();
  return Number(result?.meta?.changes||0)===1;
}

export async function bindPrivateOriginalProof(DB,proof,recordPayload,at=new Date().toISOString()){
  if(!DB || typeof DB.prepare!=='function' || !proof || !reference.test(String(proof.reviewId||'')) || !reference.test(String(proof.recordId||'')) ||
     !uuid.test(String(proof.employeeOid||'')) || !/^[a-f0-9]{64}$/.test(String(proof.sourceSha256||'')) || !Number.isSafeInteger(proof.recordRevision) || proof.recordRevision<0 ||
     !Array.isArray(proof.dates) || !proof.dates.length || proof.dates.length>62 || !proof.dates.every(date) || new Set(proof.dates).size!==proof.dates.length ||
     !identifier.test(String(proof.vaultId||'')) || !identifier.test(String(proof.itemId||'')) || typeof proof.eTag!=='string' || !proof.eTag || proof.eTag.length>512 || /[\x00-\x1f]/.test(proof.eTag) ||
     proof.reviewState!=='pending' || typeof recordPayload!=='string' || recordPayload.length>1000000 || !validTime(at))return false;
  const fileName=String(proof.fileName||'');
  if(!new RegExp('^'+proof.sourceSha256+'\\.(?:pdf|doc|docx|docm|xls|xlsx|csv|txt|json|png|jpg|jpeg)$').test(fileName))return false;
  const dates=JSON.stringify(proof.dates.slice().sort()),payloadHash=await sha256(recordPayload),employee=String(proof.employeeOid).toLowerCase();
  // The guard is repeated in the INSERT itself; preflight reads alone cannot
  // protect against an edit, revocation, identity change or active delivery.
  const guard=`i.intent_id=? AND i.record_id=? AND lower(i.employee_oid)=? AND i.source_sha256=? AND i.payload_sha256=?
    AND i.owner_revision=? AND i.dates_json=? AND i.created_at<=? AND i.expires_at>?
    AND r.record_id=i.record_id AND lower(r.owner_oid)=lower(i.employee_oid) AND lower(r.owner_upn)=lower(i.owner_upn)
    AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted' AND r.payload_json=? AND json_valid(r.payload_json)
    AND EXISTS(SELECT 1 FROM private_timesheet_subjects s WHERE lower(s.employee_upn)=lower(i.owner_upn) AND lower(s.employee_oid)=lower(i.employee_oid))
    AND EXISTS(SELECT 1 FROM timesheet_owner_revisions v WHERE lower(v.owner_upn)=lower(i.owner_upn) AND v.revision=i.owner_revision)
    AND NOT EXISTS(SELECT 1 FROM timesheet_original_filing_revocations x WHERE x.intent_id=i.intent_id)
    AND NOT EXISTS(SELECT 1 FROM dispatch_queue q WHERE q.record_id=i.record_id AND q.status IN ('queued','sending','sent','failed','uncertain'))
    AND NOT EXISTS(SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records origin ON origin.record_id=review.record_id WHERE lower(review.subject_oid)=lower(i.employee_oid) OR lower(origin.owner_upn)=lower(i.owner_upn))
    AND NOT EXISTS(SELECT 1 FROM json_each(i.dates_json) d WHERE d.type<>'text' OR
      (SELECT count(*) FROM json_each(CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END,'$.rows') item WHERE json_extract(item.value,'$.date')=d.value)<>1 OR
      NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END,'$.rows') item WHERE json_extract(item.value,'$.date')=d.value AND lower(json_extract(item.value,'$.sourceEvidence.sourceId'))=i.source_sha256))`;
  const args=[proof.reviewId,proof.recordId,employee,proof.sourceSha256,payloadHash,proof.recordRevision,dates,at,at,recordPayload];
  await DB.prepare(`INSERT INTO timesheet_private_originals(intent_id,record_id,employee_oid,source_sha256,vault_id,item_id,item_etag,file_name,review_state,filed_at)
    SELECT i.intent_id,i.record_id,lower(i.employee_oid),i.source_sha256,?,?,?,?,'pending',? FROM timesheet_original_filing_intents i JOIN records r ON r.record_id=i.record_id
    WHERE ${guard} ON CONFLICT(intent_id) DO NOTHING`).bind(proof.vaultId,proof.itemId,proof.eTag,fileName,at,...args).run();
  const saved=await DB.prepare(`SELECT p.intent_id FROM timesheet_private_originals p JOIN timesheet_original_filing_intents i ON i.intent_id=p.intent_id JOIN records r ON r.record_id=i.record_id
    WHERE ${guard} AND p.record_id=i.record_id AND lower(p.employee_oid)=lower(i.employee_oid) AND p.source_sha256=i.source_sha256
      AND p.vault_id=? AND p.item_id=? AND p.item_etag=? AND p.file_name=? AND p.review_state='pending'`).bind(...args,proof.vaultId,proof.itemId,proof.eTag,fileName).first();
  return Boolean(saved);
}
