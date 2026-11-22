// Directory entries supplied here must come from a trusted server-side source,
// never from the uploaded document or a request body.
export function resolveImportOwner(identity, requestedUpn, trustedDirectory) {
  const upn = String(requestedUpn || '').trim().toLowerCase();
  const ownUpn = String(identity?.upn || '').trim().toLowerCase();
  if (!upn || !identity?.oid || !ownUpn) throw Object.assign(new Error('Employee identity not found'), {status:400});
  if (upn === ownUpn) return {oid:identity.oid,upn:ownUpn};
  if (!identity.isAdmin && !identity.isSubmissionAdmin) throw Object.assign(new Error('Importing for this employee is not permitted'), {status:403});
  const matches = (Array.isArray(trustedDirectory) ? trustedDirectory : []).filter(entry => String(entry?.upn || '').trim().toLowerCase() === upn && entry?.oid);
  if (matches.length > 1) throw Object.assign(new Error('Employee identity is ambiguous'), {status:409});
  if (!matches.length) throw Object.assign(new Error('Employee identity not found'), {status:400});
  return matches[0];
}

async function knownOwnerIds(db, upn) {
  const result=await db.prepare(`SELECT owner_oid AS oid, lower(owner_upn) AS upn FROM profile_settings WHERE lower(owner_upn) = ?
    UNION SELECT owner_oid AS oid, lower(owner_upn) AS upn FROM records WHERE lower(owner_upn) = ? AND action <> 'pay_month_correction'
      AND NOT (action = 'email_archive' AND owner_oid = 'shared-estimate-archive')`).bind(upn,upn).all();
  return new Set((result?.results || []).filter(row=>row?.oid && String(row.upn||'').toLowerCase()===upn).map(row=>String(row.oid).toLowerCase()));
}

export async function assertNoHistoricalOwnerConflict(identity, db) {
  const upn=String(identity?.upn||'').trim().toLowerCase(), oid=String(identity?.oid||'').trim().toLowerCase();
  if (!upn || !oid) throw Object.assign(new Error('Employee identity not found'),{status:400});
  const known=await knownOwnerIds(db,upn);
  if ([...known].some(savedOid=>savedOid!==oid)) throw Object.assign(new Error('Employee identity needs reconciliation'),{status:409});
}

export async function resolveImportOwnerFromDatabase(identity, requestedUpn, roster, db, lookupDirectory) {
  const upn=String(requestedUpn || '').trim().toLowerCase();
  const ownUpn=String(identity?.upn || '').trim().toLowerCase();
  const isSelf=Boolean(upn && ownUpn && upn===ownUpn && identity?.oid);
  if (!isSelf && !identity?.isAdmin && !identity?.isSubmissionAdmin) throw Object.assign(new Error('Importing for this employee is not permitted'),{status:403});
  const matches=(Array.isArray(roster)?roster:[]).filter(entry=>String(entry?.upn||'').trim().toLowerCase()===upn);
  if (!isSelf && matches.length!==1) throw Object.assign(new Error('Employee must match the approved roster uniquely'),{status:400});
  const unique=new Map([...await knownOwnerIds(db,upn)].map(oid=>[oid,{oid,upn,name:matches[0]?.name}]));
  // A valid current token alone cannot prove that an address belonged to the
  // same person when its older records were created. Hold known conflicts for
  // review before a self-import can merge that history into a new correction.
  if (isSelf) {
    if ([...unique.keys()].some(savedOid=>savedOid!==String(identity.oid).toLowerCase())) throw Object.assign(new Error('Employee identity needs reconciliation'),{status:409});
    return resolveImportOwner(identity,upn,[]);
  }
  if (typeof lookupDirectory==='function') {
    let match;
    try { match=await lookupDirectory(upn); }
    catch (_) { throw Object.assign(new Error('Employee directory identity could not be verified'),{status:503}); }
    const oid=String(match?.oid||'').toLowerCase();
    if (String(match?.upn||'').trim().toLowerCase()!==upn || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid)) throw Object.assign(new Error('Employee identity not found'),{status:400});
    // Historic records may outlive a directory account. A recycled address
    // must never silently associate old records with a different person.
    if ([...unique.keys()].some(savedOid=>savedOid!==oid)) throw Object.assign(new Error('Employee identity needs reconciliation'),{status:409});
    return {oid,upn,name:matches[0].name};
  }
  return resolveImportOwner(identity,upn,[...unique.values()]);
}

export function normalizeImportCandidate(candidate) {
  const kind=String(candidate?.kind || '').trim().toLowerCase();
  const raw=candidate?.data;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('Record data is invalid'),{status:400});
  const fields=raw.payload && typeof raw.payload==='object' && !Array.isArray(raw.payload) ? raw.payload : raw;
  const text=(value,limit=500)=>String(value == null ? '' : value).trim().slice(0,limit);
  if (kind === 'timesheets') {
    const date=text(fields.date,40),start=text(fields.start,10).replace(/^(\d:)/,'0$1'),finish=text(fields.finish,10).replace(/^(\d:)/,'0$1'),absence=text(fields.absence || fields.absenceStatus || 'NA',40);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw Object.assign(new Error('Timesheet date is invalid'),{status:400});
    if (!['NA','Sick','Holiday','Absent','Time Off','Un-Paid'].includes(absence)) throw Object.assign(new Error('Absence status needs review'),{status:400});
    const time=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if ((start && !time(start)) || (finish && !time(finish)) || (!start !== !finish) || (absence==='NA' && (!start || !finish))) throw Object.assign(new Error('Timesheet start and finish need review'),{status:400});
    const rawBreak=fields.lunchMinutes;
    const pause=rawBreak===null || rawBreak===undefined || (typeof rawBreak==='string' && rawBreak.trim()==='') ? null : /^(?:\d+)$/.test(typeof rawBreak==='string' || typeof rawBreak==='number' ? String(rawBreak).trim() : '') ? Number(rawBreak) : NaN;
    if (pause!==null && (!Number.isInteger(pause)||pause<0||pause>1440)) throw Object.assign(new Error('Break is invalid'),{status:400});
    if(start && finish) {
      const mins=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
      const elapsed=mins(finish)-mins(start);
      if(elapsed<0) throw Object.assign(new Error('Timesheet finish is before start'),{status:400});
      if(pause!==null && pause>elapsed) throw Object.assign(new Error('Break exceeds worked time'),{status:400});
    }
    const rawEvidence=fields.sourceEvidence && typeof fields.sourceEvidence==='object' && !Array.isArray(fields.sourceEvidence) ? fields.sourceEvidence : {};
    const claim=value=>typeof value!=='number' && typeof value!=='string' || !/^-?\d+(?:\.\d+)?$/.test(String(value).trim()) || !Number.isFinite(Number(value)) ? null : Number(value);
    const sourceEvidence={raw:text(rawEvidence.raw,3000),claimedBasic:claim(rawEvidence.claimedBasic),claimedOt15:claim(rawEvidence.claimedOt15),claimedOt20:claim(rawEvidence.claimedOt20),reviewNote:text(rawEvidence.reviewNote,1000)};
    // A format marker records interpretation only; it does not authenticate the document.
    if(rawEvidence.rateEvidenceVersion===1) sourceEvidence.rateEvidenceVersion=1;
    const row={date,start,finish,lunchMinutes:pause,absenceStatus:absence,note:text(fields.notes || fields.note,1000),sourceEvidence};
    return {kind,action:'submission',status:'Submitted',recordDate:date,payload:{rows:[row]}};
  }
  if (kind === 'invoices') {
    const number=text(fields.invoiceNumber,160),date=text(fields.date || fields.invoiceDate,40),currency=text(fields.currency,4).toUpperCase(),total=fields.total;
    if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || !/^[A-Z]{3}$/.test(currency) || total===null || total===undefined || !/^-?\d+(?:\.\d+)?$/.test(String(total).trim()) || !Number.isFinite(Number(total)) || Math.abs(Number(total))>1000000000) throw Object.assign(new Error('Invoice number, date, currency and total need review'),{status:400});
    return {kind,action:'invoice_review',status:'Needs reconciliation',recordDate:date,payload:{invoiceNumber:number,date,currency,total:Number(total),company:text(fields.company),reference:text(fields.reference)}};
  }
  if (kind === 'estimates') {
    if (!text(fields.number,160) || !Array.isArray(fields.items) || !fields.items.length || fields.items.length>80) throw Object.assign(new Error('Estimate number and line items are required'),{status:400});
    const numeric=value=>value!==null && value!==undefined && /^(?:\d+)(?:\.\d+)?$/.test(String(value).trim()) && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=1000000000;
    if (!numeric(fields.vatRate) || Number(fields.vatRate)>100 || !numeric(fields.total)) throw Object.assign(new Error('Estimate VAT and total need review'),{status:400});
    const items=fields.items.map(item=>{
      if (!text(item?.description) || !numeric(item?.quantity) || !numeric(item?.unit ?? item?.unitPrice)) throw Object.assign(new Error('Estimate line item needs review'),{status:400});
      return {description:text(item.description),quantity:Number(item.quantity),unit:Number(item.unit ?? item.unitPrice)};
    });
    const roundMoney=value=>Math.round((value+Number.EPSILON)*100)/100;
    const subtotal=roundMoney(items.reduce((sum,item)=>sum+item.quantity*item.unit,0)),vat=roundMoney(subtotal*Number(fields.vatRate)/100),total=roundMoney(subtotal+vat);
    for (const [key,expected] of [['subtotal',subtotal],['vat',vat],['total',total]]) if (fields[key]!==undefined && (!numeric(fields[key]) || !/^\d+(?:\.\d{1,2})?$/.test(String(fields[key]).trim()) || Math.abs(Number(fields[key])-expected)>0.001)) throw Object.assign(new Error('Estimate '+key+' does not match its line items'),{status:400});
    return {kind,action:'submission',status:'Submitted',payload:{number:text(fields.number,160),date:text(fields.date,40),company:text(fields.company),attention:text(fields.attention),email:text(fields.email),validity:text(fields.validity,80),preparedBy:text(fields.preparedBy,240),reference:text(fields.reference),opening:text(fields.opening,3000),terms:text(fields.terms,3000),vatRate:Number(fields.vatRate),items,subtotal:fields.subtotal===undefined?subtotal:Number(fields.subtotal),vat:fields.vat===undefined?vat:Number(fields.vat),total:Number(fields.total)}};
  }
  if (kind === 'enquiries') {
    if (!text(fields.customerName) || !text(fields.message,3000)) throw Object.assign(new Error('Enquiry customer and message are required'),{status:400});
    return {kind,action:'submission',status:'Submitted',payload:{customerName:text(fields.customerName),customerEmail:text(fields.customerEmail),customerPhone:text(fields.customerPhone,120),requestType:text(fields.requestType,120),message:text(fields.message,3000)}};
  }
  if (kind === 'job-cards') {
    if (!text(fields.jobReference,180) || !text(fields.description,3000)) throw Object.assign(new Error('Job-card reference and description are required'),{status:400});
    const prefix=text(fields.jobReference,180).toUpperCase().match(/^(MTA|EC)(?=[\s/-]|\d)/)?.[1] || '';
    const cardType=text(fields.cardType,20).toUpperCase() || prefix;
    if (!['EC','MTA'].includes(cardType) || (prefix && prefix!==cardType)) throw Object.assign(new Error('Job-card type needs review'),{status:400});
    return {kind,action:'submission',status:'Submitted',payload:{jobReference:text(fields.jobReference,180),description:text(fields.description,3000),client:text(fields.client),site:text(fields.site,1000),engineer:text(fields.engineer,240),cardType,jobStatus:'Received'}};
  }
  if (kind === 'tasks') {
    if (!text(fields.title)) throw Object.assign(new Error('Task title is required'),{status:400});
    return {kind,action:'create_request',status:'Pending approval',payload:{title:text(fields.title),jobReference:text(fields.jobReference,180),assignee:text(fields.assignee,240),due:text(fields.due,40),priority:text(fields.priority,40)||'Normal'}};
  }
  if (kind === 'calendar') {
    const date=text(fields.date,40);
    if (!text(fields.title) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw Object.assign(new Error('Calendar title and valid date are required'),{status:400});
    return {kind,action:'create_request',status:'Pending approval',recordDate:date,payload:{title:text(fields.title),date,type:text(fields.type,80)||'General',notes:text(fields.notes,3000)}};
  }
  throw Object.assign(new Error(kind === 'invoices' ? 'Invoice import requires the protected invoice workflow' : 'This document type is not connected to the protected import workflow'),{status:400});
}

export function resolveRosterUpn(data, roster) {
  const direct=String(data?.employeeEmail || data?.employeeUpn || data?.payload?.employeeEmail || data?.payload?.employeeUpn || '').trim().toLowerCase();
  if (direct) return direct;
  const name=String(data?.employee || data?.employeeName || '').normalize('NFKC').trim().toLowerCase();
  const matches=(Array.isArray(roster)?roster:[]).filter(entry=>name && String(entry?.name||'').normalize('NFKC').trim().toLowerCase()===name && entry.upn);
  if(matches.length>1) throw Object.assign(new Error('Employee name is ambiguous'),{status:409});
  if(!matches.length) throw Object.assign(new Error('Employee name not found in the approved roster'),{status:400});
  return String(matches[0].upn).trim().toLowerCase();
}

export function timesheetRecordMayBelongTo(record, owner, roster) {
  const address=String(record?.employee_upn||record?.owner_upn||'').trim().toLowerCase();
  const target=String(owner?.upn||'').trim().toLowerCase();
  const name=String(record?.employee_name||'').normalize('NFKC').trim().toLowerCase();
  const targetName=String(owner?.name||'').normalize('NFKC').trim().toLowerCase();
  if (address===target && address) return true;
  if (!name || !targetName || name===targetName) return true;
  if (address) {
    const known=(Array.isArray(roster)?roster:[]).filter(entry=>String(entry?.upn||'').trim().toLowerCase()===address);
    if (known.length===1 && address!==target) return false;
    return true;
  }
  const matches=(Array.isArray(roster)?roster:[]).filter(entry=>String(entry?.name||'').normalize('NFKC').trim().toLowerCase()===name && entry.upn);
  if (matches.length!==1) return true;
  return String(matches[0].upn).trim().toLowerCase()===target;
}
