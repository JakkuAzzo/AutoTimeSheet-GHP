function requireXeroAccess(identity) {
  if (!identity?.isXeroAdmin) throw Object.assign(new Error('Invoice access is restricted to approved Accounts users'),{status:403});
}
export async function saveImportedInvoice({db,actor,owner,candidate,input,lookup}) {
  requireXeroAccess(actor);
  const existing=await db.prepare('SELECT record_id FROM imported_invoice_records WHERE record_id=?').bind(input.recordId).first();
  if (existing) return {status:'duplicate',record_id:input.recordId,message:'This document entry was already imported.'};
  let result;
  try { result=await lookup(input.payload.invoiceNumber); }
  catch (_) { throw Object.assign(new Error('Xero invoice lookup is unavailable; try again when it is connected.'),{status:503,publicMessage:'Xero invoice lookup is unavailable; try again when it is connected.'}); }
  if (!result?.tenant?.tenant_id || !Array.isArray(result.invoices)) throw Object.assign(new Error('Xero invoice lookup returned an invalid response'),{status:503,publicMessage:'Xero invoice lookup returned an invalid response.'});
  if (result.invoices.length) return {status:'duplicate',message:'An invoice with this number already exists in Xero; review it there.'};
  const number=String(input.payload.invoiceNumber).trim(),key=number.toLowerCase();
  const saved=await db.prepare(`INSERT INTO imported_invoice_records (record_id,tenant_id,invoice_number,invoice_key,invoice_date,currency,total,owner_oid,owner_upn,employee_name,payload_json,source_id,source_index,source_name,imported_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(input.recordId,result.tenant.tenant_id,number,key,input.recordDate,input.payload.currency,input.payload.total,owner.oid,owner.upn,owner.name || owner.upn,JSON.stringify(input.payload),candidate.sourceId,candidate.sourceIndex,String(candidate.source||'').slice(0,240),actor.upn,new Date().toISOString()).run();
  if (Number(saved?.meta?.changes || 0)!==1) return {status:'duplicate',message:'This invoice number is already in the import archive.'};
  return {status:'saved',record_id:input.recordId,message:'Saved for review; this is not a Xero invoice.'};
}
export async function listImportedInvoices(db,identity,{limit=1000,offset=0}={}) {
  requireXeroAccess(identity);
  limit=Math.max(1,Math.min(1000,Number(limit)||1000));offset=Math.max(0,Math.trunc(Number(offset)||0));
  const rows=await db.prepare('SELECT * FROM imported_invoice_records ORDER BY created_at DESC,record_id DESC LIMIT ? OFFSET ?').bind(limit+1,offset).all();
  const values=rows.results||[];
  return {records:values.slice(0,limit).map(row=>({kind:'invoices',source:'document-import',source_record_id:row.record_id,employee_upn:row.owner_upn,employee_name:row.employee_name,record_date:row.invoice_date,status:'Needs reconciliation',submitted_at:row.created_at,invoice_number:row.invoice_number,currency:row.currency,total:row.total,payload:JSON.parse(row.payload_json)})),has_more:values.length>limit,next_offset:values.length>limit?offset+limit:null};
}
