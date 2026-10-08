export function normaliseHistoryRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const items = Array.isArray(record.items)
    ? record.items.map((item) => ({
      description: item.description || item.Description || '',
      quantity: Number(item.quantity ?? item.Quantity) || 0,
      unit: Number(item.unit ?? item.Unit ?? item.unitPrice) || 0
    })).filter((item) => item.description)
    : [];
  const sourceMailboxes = Array.isArray(record.source_mailboxes)
    ? record.source_mailboxes
    : Array.isArray(record.sourceMailboxes)
      ? record.sourceMailboxes
      : Array.isArray(record.mail_sources)
        ? [...new Set(record.mail_sources.map((item) => item.mailbox).filter(Boolean))]
        : [];
  const recordId = record.source_record_id || record.sourceRecordId || record.recordId || '';
  const canonicalId = record.canonical_id || record.canonicalId || record.reconciliation?.source_message_key || record.source_message_key || recordId || `${record.number || 'estimate'}|${record.sentAt || record.submittedAt || ''}`;
  return {
    number: record.estimate_number || record.estimateNumber || record.number || '',
    date: record.estimate_date || record.estimateDate || record.date || '',
    attention: record.client_contact || record.clientContact || record.attention || '',
    company: record.client_company || record.clientCompany || record.client || record.company || record.customer || '',
    email: record.client_email || record.clientEmail || record.email || '',
    validity: record.validity || '30',
    preparedBy: record.prepared_by || record.preparedBy || '',
    vatRate: Number(record.vat_rate ?? record.vatRate) || 0,
    reference: record.reference || '',
    opening: record.opening || '',
    terms: record.terms || '',
    items,
    subtotal: Number(record.subtotal) || 0,
    vat: Number(record.vat) || 0,
    total: Number(record.total) || 0,
    sentAt: record.sent_at || record.sentAt || record.submitted_at || record.submittedAt || '',
    status: record.status || record.correlation_status || 'Sent',
    source: record.source || '',
    sourceMailboxes,
    sharepointUrl: record.sharepoint_url || record.sharepointUrl || '',
    attachmentUrl: record.attachment_url || record.attachmentUrl || '',
    outlookUrl: record.outlook_url || record.outlookUrl || '',
    canonicalId,
    recordId: recordId || canonicalId
  };
}

export function mergeSharedEstimateIndex(records, estimates) {
  const byId = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const apiRecordId = String(record?.source_record_id || record?.sourceRecordId || record?.recordId || '').trim();
    const canonicalId = String(record?.canonical_id || record?.canonicalId || record?.reconciliation?.source_message_key || record?.source_message_key || apiRecordId).trim();
    if (!canonicalId) return;
    byId.set(canonicalId, { ...record, canonical_id: canonicalId, source_record_id: apiRecordId || record?.source_record_id, recordId: apiRecordId || canonicalId });
  });
  (Array.isArray(estimates) ? estimates : []).forEach((estimate) => {
    const id = String(estimate?.canonical_id || '').trim();
    if (!id) return;
    const current = byId.get(id) || {};
    const sourceRecordId = current.source_record_id || current.sourceRecordId || current.recordId || estimate.source_record_id || '';
    byId.set(id, {
      ...current,
      ...estimate,
      canonical_id: id,
      source_record_id: sourceRecordId,
      recordId: sourceRecordId || id,
      estimate_number: estimate.estimate_number || current.estimate_number || current.estimateNumber || current.number || '',
      client: estimate.client || current.client || current.client_company || current.clientCompany || current.company || '',
      client_email: estimate.client_email || current.client_email || current.clientEmail || current.email || '',
      source_mailboxes: estimate.source_mailboxes || current.source_mailboxes || current.sourceMailboxes || [],
      reference: estimate.reference || current.reference || '',
      estimate_date: estimate.estimate_date || current.estimate_date || current.estimateDate || current.date || '',
      source: estimate.source || current.source || 'email'
    });
  });
  return [...byId.values()];
}
