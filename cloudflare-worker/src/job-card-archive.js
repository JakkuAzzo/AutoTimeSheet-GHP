const CARD_TYPES = new Set(['EC', 'MTA']);
const REVIEW_STATES = new Set(['ready', 'needs-review', 'confirmed']);
const CONFIRMED_FIELDS = new Map([
  ['cardNumber', 240], ['date', 80], ['customer', 1000], ['orderNumber', 500],
  ['site', 2000], ['engineer', 500], ['report', 6000], ['amount', 240]
]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function clean(value, max = 6000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function isQuickXorHash(value) {
  return /^[A-Za-z0-9+/]{27}=$/.test(String(value || ''));
}

function sourceFilename(value) {
  const name = clean(value, 180);
  if (!/^(?:EC|MTA)[A-Za-z0-9._-]*\.pdf$/i.test(name) || name.includes('..')) fail('source PDF filename is invalid');
  return name;
}

function normalizeSource(value) {
  const fileName = sourceFilename(value?.fileName || value?.file_name);
  const pageCount = Number(value?.pageCount ?? value?.page_count);
  const sizeBytes = Number(value?.sizeBytes ?? value?.size_bytes);
  const sha256 = clean(value?.sha256, 64).toLowerCase();
  const quickXorHash = clean(value?.quickXorHash || value?.quick_xor_hash, 80);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || !isSha256(sha256) || !isQuickXorHash(quickXorHash)) {
    fail(`source inventory is invalid for ${fileName}`);
  }
  return { fileName, pageCount, sizeBytes, sha256, quickXorHash };
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function jobCardBatchId(sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 100) fail('source inventory is invalid');
  const normalized = sources.map(normalizeSource).sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (new Set(normalized.map((source) => source.fileName.toLowerCase())).size !== normalized.length) fail('source filenames must be unique');
  const identity = normalized.map(({ fileName, sha256 }) => `${fileName}\n${sha256}`).join('\n');
  return `jobcard-batch-${await sha256Hex(identity)}`;
}

function actorFields(actor) {
  const oid = clean(actor?.oid, 240);
  const upn = clean(actor?.upn, 320).toLowerCase();
  if (!oid || !upn) fail('authenticated Accounts identity is required', 401);
  return { oid, upn, name: clean(actor?.name, 240) || upn };
}

export async function startJobCardBatch(env, input, actor) {
  if (!env?.DB) fail('Protected storage is not configured', 503);
  const identity = actorFields(actor);
  const sources = Array.isArray(input?.sources) ? input.sources.map(normalizeSource).sort((a, b) => a.fileName.localeCompare(b.fileName)) : [];
  const sourceCount = Number(input?.sourceCount ?? input?.source_count ?? sources.length);
  const pageCount = Number(input?.pageCount ?? input?.page_count);
  if (!sources.length || sources.length !== sourceCount || !Number.isSafeInteger(pageCount) || pageCount < 1 || sources.reduce((sum, source) => sum + source.pageCount, 0) !== pageCount) {
    fail('job-card batch inventory does not reconcile');
  }
  if (new Set(sources.map((source) => source.fileName.toLowerCase())).size !== sources.length) fail('source filenames must be unique');
  const batchId = clean(input?.batchId || input?.batch_id, 100);
  if (!/^jobcard-batch-[a-f0-9]{64}$/.test(batchId) || await jobCardBatchId(sources) !== batchId) fail('batch ID does not match its source inventory');
  const sourcesJson = JSON.stringify(sources);
  const current = await env.DB.prepare('SELECT source_count, page_count, sources_json, status FROM job_card_import_batches WHERE batch_id=?').bind(batchId).first();
  if (current) {
    if (current.source_count !== sourceCount || current.page_count !== pageCount || current.sources_json !== sourcesJson) fail('batch ID is already registered with different source metadata', 409);
    return { batchId, status: current.status, duplicate: true };
  }
  await env.DB.prepare(`INSERT INTO job_card_import_batches
    (batch_id, source_count, page_count, sources_json, status, created_by_oid, created_by_upn)
    VALUES (?, ?, ?, ?, 'uploading', ?, ?)`)
    .bind(batchId, sourceCount, pageCount, sourcesJson, identity.oid, identity.upn).run();
  return { batchId, status: 'uploading', duplicate: false };
}

export async function getJobCardBatch(env, batchId) {
  const id = clean(batchId, 100);
  if (!/^jobcard-batch-[a-f0-9]{64}$/.test(id)) fail('job-card batch was not found', 404);
  const row = await env.DB.prepare('SELECT batch_id, source_count, page_count, sources_json, status FROM job_card_import_batches WHERE batch_id=?').bind(id).first();
  if (!row) fail('job-card batch was not found', 404);
  let sources;
  try { sources = JSON.parse(row.sources_json); } catch (_) { fail('job-card batch inventory is invalid', 500); }
  return { ...row, sources: Array.isArray(sources) ? sources : [] };
}

export async function jobCardBatchStatus(env, batchId) {
  const batch = await getJobCardBatch(env, batchId);
  const sources = await env.DB.prepare('SELECT source_file FROM job_card_source_files WHERE batch_id=? ORDER BY source_file').bind(batch.batch_id).all();
  const pages = await env.DB.prepare('SELECT record_id FROM job_card_archive WHERE batch_id=? ORDER BY record_id').bind(batch.batch_id).all();
  return {
    batchId: batch.batch_id,
    status: batch.status,
    expectedSources: batch.source_count,
    uploadedSources: (sources.results || []).map((row) => row.source_file),
    expectedPages: batch.page_count,
    importedRecordIds: (pages.results || []).map((row) => row.record_id)
  };
}

export async function normalizeJobCardEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('job-card manifest entry is required');
  const batchId = clean(input.batchId || input.batch_id, 100);
  const sourceFile = sourceFilename(input.sourceFile || input.source_file);
  const sourceSha256 = clean(input.sourceSha256 || input.source_sha256, 64).toLowerCase();
  const sourceQuickXorHash = clean(input.sourceQuickXorHash || input.source_quick_xor_hash, 80);
  const sourcePage = Number(input.sourcePage ?? input.source_page);
  const sizeBytes = Number(input.sizeBytes ?? input.size_bytes);
  const sha256 = clean(input.sha256, 64).toLowerCase();
  const quickXorHash = clean(input.quickXorHash || input.quick_xor_hash, 80);
  const recordId = clean(input.recordId || input.record_id, 180);
  const cardType = clean(input.cardType || input.card_type, 8).toUpperCase();
  const expectedCardType = sourceFile.match(/^(EC|MTA)/i)?.[1].toUpperCase();
  if (!/^jobcard-batch-[a-f0-9]{64}$/.test(batchId) || !isSha256(sourceSha256) || !isQuickXorHash(sourceQuickXorHash) || !Number.isSafeInteger(sourcePage) || sourcePage < 1) fail('job-card source page identity is invalid');
  if (!isSha256(sha256) || !isQuickXorHash(quickXorHash) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) fail('job-card page file metadata is invalid');
  if (recordId !== `jobcard-${sourceSha256}-${String(sourcePage).padStart(4, '0')}`) fail('job-card record ID does not match its source page');
  if (!CARD_TYPES.has(cardType) || cardType !== expectedCardType) fail('job-card type does not match its source file');
  const rawCandidates = input.candidates && typeof input.candidates === 'object' && !Array.isArray(input.candidates) ? input.candidates : {};
  const candidates = {};
  for (const field of CONFIRMED_FIELDS.keys()) {
    const value = rawCandidates[field];
    if (value != null && typeof value !== 'string') fail(`job-card candidate ${field} is invalid`);
    candidates[field] = clean(value, CONFIRMED_FIELDS.get(field));
  }
  const ocrText = String(input.ocrText ?? input.ocr_text ?? '').slice(0, 500_000);
  const confidenceValue = input.meanOcrConfidence ?? input.mean_ocr_confidence;
  const meanOcrConfidence = confidenceValue == null ? null : Number(confidenceValue);
  if (meanOcrConfidence !== null && (!Number.isFinite(meanOcrConfidence) || meanOcrConfidence < 0 || meanOcrConfidence > 100)) fail('OCR confidence is invalid');
  const reviewReasons = Array.isArray(input.reviewReasons || input.review_reasons)
    ? [...new Set((input.reviewReasons || input.review_reasons).map((reason) => clean(reason, 80)).filter(Boolean))].slice(0, 40)
    : [];
  const requestedReviewState = clean(input.reviewState || input.review_state, 24);
  if (requestedReviewState && !REVIEW_STATES.has(requestedReviewState)) fail('job-card review state is invalid');
  const reviewState = requestedReviewState === 'ready' && !reviewReasons.length ? 'ready' : 'needs-review';
  return {
    batchId, recordId, sourceFile, sourceSha256, sourceQuickXorHash, sourcePage,
    cardType, sizeBytes, sha256, quickXorHash, candidates, ocrText, meanOcrConfidence,
    reviewState, reviewReasons
  };
}

export async function upsertJobCardSourceFile(env, batchId, sourceInput, item, actor) {
  const identity = actorFields(actor);
  const batch = await getJobCardBatch(env, batchId);
  const source = normalizeSource(sourceInput);
  const expected = batch.sources.find((candidate) => candidate.fileName === source.fileName);
  if (!expected || JSON.stringify(expected) !== JSON.stringify(source)) fail('uploaded source does not match the registered batch inventory', 409);
  if (!item?.id || !item?.file?.hashes?.quickXorHash || Number(item.size) !== source.sizeBytes || item.file.hashes.quickXorHash !== source.quickXorHash) {
    fail('SharePoint source size or QuickXorHash did not match the local source', 409);
  }
  const path = `JobCards/Source Batches/${batch.batch_id}/${source.fileName}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO job_card_source_files
      (batch_id, source_file, page_count, size_bytes, sha256, quick_xor_hash, sharepoint_item_id, sharepoint_path, uploaded_by_oid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id, source_file) DO UPDATE SET page_count=excluded.page_count, size_bytes=excluded.size_bytes,
        sha256=excluded.sha256, quick_xor_hash=excluded.quick_xor_hash, sharepoint_item_id=excluded.sharepoint_item_id,
        sharepoint_path=excluded.sharepoint_path, uploaded_by_oid=excluded.uploaded_by_oid, uploaded_at=CURRENT_TIMESTAMP`)
      .bind(batch.batch_id, source.fileName, source.pageCount, source.sizeBytes, source.sha256, source.quickXorHash, item.id, path, identity.oid),
    env.DB.prepare(`UPDATE job_card_import_batches SET status=CASE
        WHEN (SELECT COUNT(*) FROM job_card_source_files WHERE batch_id=?) = source_count
          AND (SELECT COALESCE(SUM(page_count), 0) FROM job_card_source_files WHERE batch_id=?) = page_count
        THEN 'source-complete' ELSE 'uploading' END, updated_at=CURRENT_TIMESTAMP
      WHERE batch_id=?`)
      .bind(batch.batch_id, batch.batch_id, batch.batch_id)
  ]);
  const latest = await getJobCardBatch(env, batch.batch_id);
  return { batchId: latest.batch_id, status: latest.status, uploadedSourceCount: await sourceFileCount(env, batch.batch_id) };
}

async function sourceFileCount(env, batchId) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM job_card_source_files WHERE batch_id=?').bind(batchId).first();
  return Number(row?.count) || 0;
}

export async function upsertJobCardArchive(env, input, actor) {
  if (!env?.DB) fail('Protected storage is not configured', 503);
  const identity = actorFields(actor);
  const entry = await normalizeJobCardEntry(input?.manifestEntry || input);
  const sharepointItemId = clean(input?.sharepointItemId || input?.sharepoint_item_id, 500);
  const sharepointPath = clean(input?.sharepointPath || input?.sharepoint_path, 1000);
  if (!sharepointItemId || !sharepointPath || sharepointPath !== `JobCards/Records/${entry.recordId}.pdf`) fail('SharePoint page pointer is invalid');
  const existing = await env.DB.prepare('SELECT kind, action FROM records WHERE record_id=?').bind(entry.recordId).first();
  if (existing && (existing.kind !== 'job-cards' || existing.action !== 'archive_import')) fail('record ID is already used by another GMT record', 409);
  const archive = await env.DB.prepare('SELECT batch_id, source_file, source_page, content_sha256, confirmed_json, review_state, reviewed_by_oid, reviewed_by_upn, reviewed_at, review_note FROM job_card_archive WHERE record_id=?').bind(entry.recordId).first();
  if (archive && (archive.source_file !== entry.sourceFile || archive.source_page !== entry.sourcePage || archive.content_sha256 !== entry.sha256)) {
    fail('stable job-card ID is already associated with different source page content', 409);
  }
  let confirmed = {};
  try { confirmed = archive?.confirmed_json ? JSON.parse(archive.confirmed_json) : {}; } catch (_) { confirmed = {}; }
  const reviewState = archive?.review_state === 'confirmed' ? 'confirmed' : entry.reviewState;
  const now = new Date().toISOString();
  const recordPayload = JSON.stringify({
    archiveType: 'scanned-job-card', batchId: entry.batchId, sourceFile: entry.sourceFile,
    sourcePage: entry.sourcePage, cardType: entry.cardType, jobReference: confirmed.cardNumber || '',
    company: confirmed.customer || '', date: confirmed.date || '',
    candidateFields: entry.candidates, confirmedFields: confirmed, reviewState
  });
  const recordDate = confirmed.date && /^\d{4}-\d{2}-\d{2}$/.test(confirmed.date) ? confirmed.date : null;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO records
      (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date, record_date,
       submitted_at, updated_at, issue, payload_json, source_message_key, source_attachment_ids,
       reconciliation_key, source_variant_status, reconciled_at)
      VALUES (?, ?, ?, 'GMT Scanned Archive', 'job-cards', 'archive_import', 'Archived', NULL, NULL, ?, ?, ?, '', ?, NULL, NULL, NULL, NULL, NULL)
      ON CONFLICT(record_id) DO UPDATE SET status='Archived', record_date=excluded.record_date,
        updated_at=excluded.updated_at, payload_json=excluded.payload_json
      WHERE records.kind='job-cards' AND records.action='archive_import'`)
      .bind(entry.recordId, identity.oid, identity.upn, recordDate, now, now, recordPayload),
    env.DB.prepare(`INSERT INTO job_card_archive
      (record_id, batch_id, source_file, source_page, card_type, sharepoint_item_id, sharepoint_path,
       size_bytes, content_sha256, quick_xor_hash, ocr_text, mean_ocr_confidence, candidates_json,
       confirmed_json, review_state, review_note, imported_by_oid, reviewed_by_oid, reviewed_by_upn, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET batch_id=excluded.batch_id, source_file=excluded.source_file,
        source_page=excluded.source_page, card_type=excluded.card_type, sharepoint_item_id=excluded.sharepoint_item_id,
        sharepoint_path=excluded.sharepoint_path, size_bytes=excluded.size_bytes, content_sha256=excluded.content_sha256,
        quick_xor_hash=excluded.quick_xor_hash, ocr_text=excluded.ocr_text, mean_ocr_confidence=excluded.mean_ocr_confidence,
        candidates_json=excluded.candidates_json, confirmed_json=job_card_archive.confirmed_json,
        review_state=CASE WHEN job_card_archive.review_state='confirmed' THEN 'confirmed' ELSE excluded.review_state END,
        review_note=job_card_archive.review_note, imported_by_oid=excluded.imported_by_oid,
        reviewed_by_oid=job_card_archive.reviewed_by_oid, reviewed_by_upn=job_card_archive.reviewed_by_upn,
        reviewed_at=job_card_archive.reviewed_at, updated_at=CURRENT_TIMESTAMP`)
      .bind(entry.recordId, entry.batchId, entry.sourceFile, entry.sourcePage, entry.cardType, sharepointItemId, sharepointPath,
        entry.sizeBytes, entry.sha256, entry.quickXorHash, entry.ocrText, entry.meanOcrConfidence,
        JSON.stringify(entry.candidates), JSON.stringify(confirmed), reviewState, archive?.review_note || '', identity.oid,
        archive?.reviewed_by_oid || null, archive?.reviewed_by_upn || null, archive?.reviewed_at || null)
  ]);
  const result = await env.DB.prepare('SELECT record_id, review_state FROM job_card_archive WHERE record_id=?').bind(entry.recordId).first();
  return { recordId: result.record_id, reviewState: result.review_state, duplicate: Boolean(archive) };
}

function decodeCursor(cursor) {
  if (!cursor) return '';
  try {
    const normalized = String(cursor).replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    if (!/^jobcard-[a-f0-9]{64}-\d{4,}$/.test(decoded)) fail('search cursor is invalid');
    return decoded;
  } catch (error) {
    if (error.status) throw error;
    fail('search cursor is invalid');
  }
}

function encodeCursor(recordId) {
  return btoa(recordId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseJson(value) {
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch (_) { return {}; }
}

export async function queryJobCardArchive(env, filters = {}) {
  if (!env?.DB) fail('Protected storage is not configured', 503);
  const clauses = ["r.kind='job-cards'", "r.action='archive_import'", "r.status <> 'Deleted'"];
  const params = [];
  const term = clean(filters.q, 300);
  if (term) {
    if (Array.from(term).length < 3) fail('Search terms must contain at least three characters');
    clauses.push('job_card_archive_fts MATCH ?');
    params.push(`"${term.replace(/"/g, '""')}"`);
  }
  const cardType = clean(filters.cardType || filters.card_type, 8).toUpperCase();
  if (cardType) {
    if (!CARD_TYPES.has(cardType)) fail('cardType must be EC or MTA');
    clauses.push('a.card_type=?'); params.push(cardType);
  }
  const from = clean(filters.from, 10);
  const to = clean(filters.to, 10);
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) fail('from must be an ISO date');
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail('to must be an ISO date');
  if (from) { clauses.push("json_extract(a.confirmed_json, '$.date') >= ?"); params.push(from); }
  if (to) { clauses.push("json_extract(a.confirmed_json, '$.date') <= ?"); params.push(to); }
  const cursor = decodeCursor(filters.cursor);
  if (cursor) { clauses.push('a.record_id > ?'); params.push(cursor); }
  const parsedLimit = Number.parseInt(filters.limit, 10) || 50;
  const limit = Math.max(1, Math.min(parsedLimit, 100));
  const ftsJoin = term ? 'JOIN job_card_archive_fts ON job_card_archive_fts.record_id=a.record_id' : '';
  const result = await env.DB.prepare(`SELECT a.record_id, a.batch_id, a.source_file, a.source_page, a.card_type,
      substr(a.ocr_text, 1, 1000) AS ocr_preview, a.mean_ocr_confidence, a.candidates_json, a.confirmed_json, a.review_state,
      a.review_note, a.imported_at, a.reviewed_at
    FROM job_card_archive a JOIN records r ON r.record_id=a.record_id ${ftsJoin}
    WHERE ${clauses.join(' AND ')}
    ORDER BY a.record_id ASC LIMIT ?`).bind(...params, limit + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit).map((row) => ({
    record_id: row.record_id, batch_id: row.batch_id, source_file: row.source_file,
    source_page: row.source_page, card_type: row.card_type, ocr_preview: row.ocr_preview,
    mean_ocr_confidence: row.mean_ocr_confidence, candidates: parseJson(row.candidates_json),
    confirmed_fields: parseJson(row.confirmed_json), review_state: row.review_state,
    review_note: row.review_note, imported_at: row.imported_at, reviewed_at: row.reviewed_at
  }));
  return { records, nextCursor: hasMore && records.length ? encodeCursor(records[records.length - 1].record_id) : null };
}

export async function getJobCardArchiveRecord(env, recordId) {
  const id = clean(recordId, 180);
  if (!/^jobcard-[a-f0-9]{64}-\d{4,}$/.test(id)) fail('job card was not found', 404);
  const row = await env.DB.prepare(`SELECT a.record_id, a.batch_id, a.source_file, a.source_page, a.card_type,
      a.sharepoint_item_id, a.sharepoint_path, a.size_bytes, a.content_sha256, a.quick_xor_hash,
      a.ocr_text, a.mean_ocr_confidence, a.candidates_json, a.confirmed_json, a.review_state,
      a.review_note, a.reviewed_at, r.kind, r.action, r.status
    FROM job_card_archive a JOIN records r ON r.record_id=a.record_id WHERE a.record_id=?`).bind(id).first();
  if (!row || row.status === 'Deleted' || row.action !== 'archive_import') fail('job card was not found', 404);
  return row;
}

export async function reviewJobCardArchive(env, recordId, input, actor) {
  if (!env?.DB) fail('Protected storage is not configured', 503);
  const identity = actorFields(actor);
  const current = await getJobCardArchiveRecord(env, recordId);
  const fields = input?.confirmedFields ?? input?.confirmed_fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('confirmedFields must be an object');
  const confirmed = parseJson(current.confirmed_json);
  for (const [field, max] of CONFIRMED_FIELDS) {
    if (!Object.hasOwn(fields, field)) continue;
    if (fields[field] != null && typeof fields[field] !== 'string') fail(`confirmed field ${field} must be text`);
    const value = clean(fields[field], max);
    if (field === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('confirmed date must use YYYY-MM-DD');
    confirmed[field] = value;
  }
  const requestedState = clean(input.state, 24) || 'needs-review';
  if (!['confirmed', 'needs-review'].includes(requestedState)) fail('review state must be confirmed or needs-review');
  const note = clean(input.note, 2000);
  const now = new Date().toISOString();
  const before = parseJson(current.confirmed_json);
  const action = requestedState === 'confirmed' ? (Object.keys(before).length ? 'correct' : 'confirm') : 'reopen';
  const auditId = crypto.randomUUID();
  const payload = await env.DB.prepare('SELECT payload_json FROM records WHERE record_id=?').bind(current.record_id).first();
  const recordPayload = parseJson(payload?.payload_json);
  recordPayload.confirmedFields = confirmed;
  recordPayload.jobReference = confirmed.cardNumber || '';
  recordPayload.company = confirmed.customer || '';
  recordPayload.date = confirmed.date || '';
  recordPayload.reviewState = requestedState;
  await env.DB.batch([
    env.DB.prepare(`UPDATE job_card_archive SET confirmed_json=?, review_state=?, review_note=?,
      reviewed_by_oid=?, reviewed_by_upn=?, reviewed_at=?, updated_at=? WHERE record_id=?`)
      .bind(JSON.stringify(confirmed), requestedState, note, identity.oid, identity.upn, now, now, current.record_id),
    env.DB.prepare('UPDATE records SET record_date=?, payload_json=?, updated_at=? WHERE record_id=? AND action=\'archive_import\'')
      .bind(confirmed.date || null, JSON.stringify(recordPayload), now, current.record_id),
    env.DB.prepare(`INSERT INTO job_card_archive_review_audit
      (audit_id, record_id, actor_oid, actor_upn, action, before_json, after_json, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(auditId, current.record_id, identity.oid, identity.upn, action, JSON.stringify(before), JSON.stringify(confirmed), note, now)
  ]);
  return { recordId: current.record_id, confirmedFields: confirmed, reviewState: requestedState, reviewedAt: now };
}
