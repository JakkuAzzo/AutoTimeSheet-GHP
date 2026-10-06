const MAX_FIELD = 6000;
const MAX_RECIPIENTS = 60;
const CLASSIFICATIONS = new Set(['candidate', 'confirmed', 'needs-review', 'excluded']);
const SOURCES = new Set(['email', 'app']);
const TARGET_KINDS = new Set(['estimate', 'job-card', 'invoice']);
const ASSOCIATION_STATES = new Set(['candidate', 'confirmed', 'needs-review', 'rejected']);
const ASSOCIATION_PROVENANCE = new Set(['exact-reference', 'conversation-id', 'shared-customer-date', 'manual-review', 'app-link']);

function clean(value, max = MAX_FIELD) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function email(value) {
  return clean(value, 320).toLowerCase();
}

function jsonObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  return JSON.stringify(value);
}

function recipientValues(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[;,\s]+/);
  return [...new Set(items.map(email).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))].slice(0, MAX_RECIPIENTS);
}

function canonicalRecord(input = {}) {
  const sourceKind = clean(input.source_kind || input.sourceKind || input.source || 'email', 16).toLowerCase();
  if (!SOURCES.has(sourceKind)) throw Object.assign(new Error('source_kind must be email or app'), { status: 400 });
  const mailbox = email(input.mailbox || input.source_mailbox);
  const sourceMessageId = clean(input.source_message_id || input.sourceMessageId || input.outlook_message_id, 2000);
  const internetMessageId = clean(input.internet_message_id || input.internetMessageId, 1000).toLowerCase();
  if (!sourceMessageId) throw Object.assign(new Error('source_message_id is required'), { status: 400 });
  if (sourceKind === 'email' && !mailbox) throw Object.assign(new Error('mailbox is required for email source'), { status: 400 });
  const canonicalId = clean(input.canonical_id || input.canonicalId || (internetMessageId ? `email:${internetMessageId}` : `${sourceKind}:${mailbox}:${sourceMessageId}`), 2200);
  if (!canonicalId) throw Object.assign(new Error('canonical_id is required'), { status: 400 });
  const classification = clean(input.classification_state || input.classificationState || 'candidate', 24);
  if (!CLASSIFICATIONS.has(classification)) throw Object.assign(new Error('classification_state is invalid'), { status: 400 });
  const recipients = recipientValues(input.recipient_emails || input.recipientEmails || input.to);
  const sender = email(input.sender_email || input.senderEmail || input.from);
  const provenance = jsonObject(input.provenance, 'provenance');
  const created = clean(input.created_at || input.createdAt, 80);
  return {
    id: clean(input.id, 220) || crypto.randomUUID(), canonical_id: canonicalId,
    source_kind: sourceKind, classification_state: classification,
    message_direction: clean(input.message_direction || input.direction, 16), mailbox,
    source_message_id: sourceMessageId, internet_message_id: internetMessageId,
    conversation_id: clean(input.conversation_id || input.conversationId, 1000),
    sender_email: sender, recipient_emails: JSON.stringify(recipients),
    normalized_sender_email: sender, normalized_recipient_emails: recipients.join(' '),
    subject: clean(input.subject),
    customer_display: clean(input.customer_display || input.customerDisplay || input.customer || input.client, 1000),
    normalized_customer: clean(input.normalized_customer || input.normalizedCustomer || input.customer_display || input.customerDisplay || input.customer || input.client, 1000).toLocaleLowerCase(),
    customer_email: email(input.customer_email || input.customerEmail || input.client_email),
    estimate_number: clean(input.estimate_number || input.estimateNumber, 500),
    reference: clean(input.reference || input.job_reference, 1000),
    sent_at: clean(input.sent_at || input.sentAt, 80), received_at: clean(input.received_at || input.receivedAt, 80),
    content_sha256: clean(input.content_sha256 || input.contentSha256, 128),
    sharepoint_eml_item_id: clean(input.sharepoint_eml_item_id || input.sharepointEmlItemId, 500),
    sharepoint_manifest_item_id: clean(input.sharepoint_manifest_item_id || input.sharepointManifestItemId, 500),
    provenance_json: provenance, created_at: created
  };
}

export async function upsertEstimateArchive(env, input) {
  if (!env?.DB) throw Object.assign(new Error('Protected storage is not configured'), { status: 503 });
  const row = canonicalRecord(input);
  const db = env.DB;
  const existing = row.internet_message_id
    ? await db.prepare('SELECT id, mailbox, source_message_id FROM archive_messages WHERE internet_message_id = ?').bind(row.internet_message_id).first()
    : await db.prepare('SELECT id, mailbox, source_message_id FROM archive_messages WHERE mailbox = ? AND source_message_id = ?').bind(row.mailbox, row.source_message_id).first();
  if (existing?.id) {
    row.id = existing.id;
    // The canonical archive row represents one copy. Preserve its mailbox-local
    // identity; estimate_mail_sources separately records every duplicate copy.
    if (existing.mailbox && row.mailbox !== existing.mailbox) {
      row.mailbox = existing.mailbox;
      row.source_message_id = existing.source_message_id;
    }
  }
  const current = await db.prepare('SELECT created_at FROM archive_messages WHERE id = ?').bind(row.id).first();
  await db.prepare(`INSERT INTO archive_messages (
      id, canonical_id, source_kind, classification_state, message_direction, mailbox,
      source_message_id, internet_message_id, conversation_id, sender_email, recipient_emails,
      normalized_sender_email, normalized_recipient_emails, subject, customer_display, normalized_customer,
      customer_email, estimate_number, reference, sent_at, received_at, content_sha256,
      sharepoint_eml_item_id, sharepoint_manifest_item_id, provenance_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      classification_state=CASE WHEN archive_messages.classification_state='confirmed' AND excluded.classification_state='candidate' THEN archive_messages.classification_state ELSE excluded.classification_state END,
      message_direction=COALESCE(NULLIF(excluded.message_direction, ''), archive_messages.message_direction),
      mailbox=COALESCE(NULLIF(excluded.mailbox, ''), archive_messages.mailbox),
      source_message_id=COALESCE(NULLIF(excluded.source_message_id, ''), archive_messages.source_message_id),
      internet_message_id=COALESCE(NULLIF(excluded.internet_message_id, ''), archive_messages.internet_message_id),
      conversation_id=COALESCE(NULLIF(excluded.conversation_id, ''), archive_messages.conversation_id),
      sender_email=COALESCE(NULLIF(excluded.sender_email, ''), archive_messages.sender_email),
      recipient_emails=CASE WHEN excluded.recipient_emails='[]' THEN archive_messages.recipient_emails ELSE excluded.recipient_emails END,
      normalized_sender_email=COALESCE(NULLIF(excluded.normalized_sender_email, ''), archive_messages.normalized_sender_email),
      normalized_recipient_emails=COALESCE(NULLIF(excluded.normalized_recipient_emails, ''), archive_messages.normalized_recipient_emails),
      subject=COALESCE(NULLIF(excluded.subject, ''), archive_messages.subject),
      customer_display=COALESCE(NULLIF(excluded.customer_display, ''), archive_messages.customer_display),
      normalized_customer=COALESCE(NULLIF(excluded.normalized_customer, ''), archive_messages.normalized_customer),
      customer_email=COALESCE(NULLIF(excluded.customer_email, ''), archive_messages.customer_email),
      estimate_number=COALESCE(NULLIF(excluded.estimate_number, ''), archive_messages.estimate_number),
      reference=COALESCE(NULLIF(excluded.reference, ''), archive_messages.reference),
      sent_at=COALESCE(NULLIF(excluded.sent_at, ''), archive_messages.sent_at),
      received_at=COALESCE(NULLIF(excluded.received_at, ''), archive_messages.received_at),
      content_sha256=COALESCE(NULLIF(excluded.content_sha256, ''), archive_messages.content_sha256),
      sharepoint_eml_item_id=COALESCE(NULLIF(excluded.sharepoint_eml_item_id, ''), archive_messages.sharepoint_eml_item_id),
      sharepoint_manifest_item_id=COALESCE(NULLIF(excluded.sharepoint_manifest_item_id, ''), archive_messages.sharepoint_manifest_item_id),
      provenance_json=CASE WHEN excluded.provenance_json='{}' THEN archive_messages.provenance_json ELSE excluded.provenance_json END,
      updated_at=CURRENT_TIMESTAMP`)
    .bind(row.id, row.canonical_id, row.source_kind, row.classification_state, row.message_direction,
      row.mailbox, row.source_message_id, row.internet_message_id, row.conversation_id, row.sender_email,
      row.recipient_emails, row.normalized_sender_email, row.normalized_recipient_emails, row.subject,
      row.customer_display, row.normalized_customer, row.customer_email, row.estimate_number, row.reference, row.sent_at,
      row.received_at, row.content_sha256, row.sharepoint_eml_item_id, row.sharepoint_manifest_item_id,
      row.provenance_json, row.created_at).run();
  return { id: row.id, created: !current, updated: Boolean(current) };
}

export async function upsertEstimateAssociation(env, messageId, input, createdBy = '') {
  const targetKind = clean(input?.target_kind || input?.targetKind, 32);
  const targetId = clean(input?.target_id || input?.targetId, 300);
  const targetReference = clean(input?.target_reference || input?.targetReference, 500);
  const relationship = clean(input?.relationship, 80) || 'related';
  const state = clean(input?.state, 24) || 'candidate';
  const provenanceKind = clean(input?.provenance_kind || input?.provenanceKind, 40);
  const confidence = Number(input?.confidence);
  const evidence = jsonObject(input?.evidence || {}, 'evidence');
  if (!TARGET_KINDS.has(targetKind) || !targetId || !ASSOCIATION_STATES.has(state) || !ASSOCIATION_PROVENANCE.has(provenanceKind) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw Object.assign(new Error('association is invalid'), { status: 400 });
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO archive_associations
    (id, message_id, target_kind, target_id, target_reference, relationship, confidence, state, provenance_kind, evidence_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id, target_kind, target_id, relationship) DO UPDATE SET
      target_reference=excluded.target_reference, confidence=excluded.confidence, state=excluded.state,
      provenance_kind=excluded.provenance_kind, evidence_json=excluded.evidence_json,
      created_by=excluded.created_by, updated_at=CURRENT_TIMESTAMP`)
    .bind(id, messageId, targetKind, targetId, targetReference, relationship, confidence, state, provenanceKind, evidence, clean(createdBy, 300)).run();
  return { message_id: messageId, target_kind: targetKind, target_id: targetId, target_reference: targetReference, relationship, confidence, state };
}

function encodeCursor(row) {
  const bytes = new TextEncoder().encode(JSON.stringify([row.received_at || '', row.id]));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string' || typeof decoded[1] !== 'string') throw new Error();
    return decoded;
  } catch (_) { throw Object.assign(new Error('cursor is invalid'), { status: 400 }); }
}

export async function queryEstimateArchive(env, filters = {}) {
  if (!env?.DB) throw Object.assign(new Error('Protected storage is not configured'), { status: 503 });
  const clauses = [];
  const params = [];
  const add = (clause, value) => { if (value) { clauses.push(clause); params.push(value); } };
  const term = clean(filters.q, 300);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(`(subject LIKE ? ESCAPE '\\' OR estimate_number LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\' OR normalized_customer LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\' OR normalized_sender_email LIKE ? ESCAPE '\\' OR normalized_recipient_emails LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like.toLocaleLowerCase(), like.toLocaleLowerCase(), like.toLocaleLowerCase(), like.toLocaleLowerCase());
  }
  add('estimate_number = ?', clean(filters.estimateNumber, 500));
  add('normalized_customer = ?', clean(filters.customer, 1000).toLocaleLowerCase());
  const emailFilter = email(filters.email);
  if (emailFilter) { clauses.push('(customer_email = ? OR normalized_sender_email = ? OR normalized_recipient_emails LIKE ?)'); params.push(emailFilter, emailFilter, `%${emailFilter}%`); }
  add('reference = ?', clean(filters.reference, 1000));
  const from = clean(filters.from, 80);
  const to = clean(filters.to, 80);
  add("COALESCE(NULLIF(sent_at, ''), received_at) >= ?", /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00.000Z` : from);
  add("COALESCE(NULLIF(sent_at, ''), received_at) <= ?", /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to);
  add('classification_state = ?', clean(filters.state, 24));
  if (filters.relatedJobId) {
    clauses.push("EXISTS (SELECT 1 FROM archive_associations a WHERE a.message_id=archive_messages.id AND a.target_kind='job-card' AND (a.target_id=? OR a.target_reference=?))");
    params.push(clean(filters.relatedJobId, 300), clean(filters.relatedJobId, 300));
  }
  if (filters.relatedInvoice) {
    clauses.push("EXISTS (SELECT 1 FROM archive_associations a WHERE a.message_id=archive_messages.id AND a.target_kind='invoice' AND (a.target_id=? OR a.target_reference=?))");
    params.push(clean(filters.relatedInvoice, 300), clean(filters.relatedInvoice, 300));
  }
  const cursor = decodeCursor(filters.cursor);
  if (cursor) { clauses.push('(received_at < ? OR (received_at = ? AND id < ?))'); params.push(cursor[0], cursor[0], cursor[1]); }
  const limit = Math.max(1, Math.min(Number.parseInt(filters.limit, 10) || 50, 100));
  const sql = `SELECT id, source_kind, classification_state, message_direction,
    mailbox, sender_email,
    recipient_emails, subject, customer_display AS customer, customer_email,
    estimate_number, reference, sent_at, received_at, created_at, updated_at
    FROM archive_messages ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY received_at DESC, id DESC LIMIT ?`;
  const result = await env.DB.prepare(sql).bind(...params, limit + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit).map((row) => ({
    ...row,
    recipient_emails: (() => { try { const parsed = JSON.parse(row.recipient_emails || '[]'); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } })()
  }));
  return { records, nextCursor: hasMore && records.length ? encodeCursor(records[records.length - 1]) : null, indexState: 'ready' };
}

export function normalizeEstimateArchiveRecord(input) {
  return canonicalRecord(input);
}
