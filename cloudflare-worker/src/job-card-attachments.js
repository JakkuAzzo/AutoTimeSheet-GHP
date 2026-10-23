const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_JOB_CARD_ATTACHMENT_BYTES = MAX_ATTACHMENT_BYTES;
const SHA256 = /^[a-f0-9]{64}$/;
const QUICK_XOR = /^[A-Za-z0-9+/]{27}=$/;
const MIME_BY_EXTENSION = new Map([
  ['.pdf', 'application/pdf'],
  ['.gif', 'image/gif'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function actorFields(actor) {
  const oid = clean(actor?.oid, 240);
  const upn = clean(actor?.upn, 320).toLowerCase();
  if (!oid || !upn) fail('Authenticated GMT identity is required', 401);
  return { oid, upn };
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function hasIsoBaseMediaFileType(bytes) {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 8) !== 'ftyp') return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > bytes.byteLength || (boxSize - 16) % 4 !== 0) return false;
  const brands = [ascii(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(bytes, offset, offset + 4));
  return brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'].includes(brand));
}

function hasJobCardAttachmentSignature(bytes, contentType) {
  const prefix = (expected) => bytes.byteLength >= expected.length && expected.every((byte, index) => bytes[index] === byte);
  switch (contentType) {
    case 'application/pdf': return ascii(bytes, 0, 5) === '%PDF-';
    case 'image/gif': return ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6));
    case 'image/heic':
    case 'image/heif': return hasIsoBaseMediaFileType(bytes);
    case 'image/jpeg': return prefix([0xff, 0xd8, 0xff]);
    case 'image/png': return prefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp': return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
    default: return false;
  }
}

export function normalizeJobCardAttachmentMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Attachment metadata is required');
  const rawFileName = String(input.fileName || input.file_name || '');
  if (rawFileName !== rawFileName.trim() || /["*:<>?\/\\|\u0000-\u001f\u007f]/.test(rawFileName)) {
    fail('Attachment filename contains characters or spaces SharePoint does not allow');
  }
  const fileName = clean(rawFileName, 220);
  const contentType = clean(input.contentType || input.content_type, 160).toLowerCase();
  const sizeBytes = Number(input.sizeBytes ?? input.size_bytes);
  const sha256 = clean(input.sha256, 64).toLowerCase();
  const quickXorHash = clean(input.quickXorHash || input.quick_xor_hash, 80);
  if (!fileName || fileName === '.' || fileName === '..') fail('Attachment filename is invalid');
  const extensionIndex = fileName.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : '';
  if (!MIME_BY_EXTENSION.has(extension) || MIME_BY_EXTENSION.get(extension) !== contentType) fail('Only image and PDF attachments with matching file types are supported');
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) fail('Attachment size is invalid');
  if (sizeBytes > MAX_ATTACHMENT_BYTES) fail('Attachments must not exceed 20 MiB each', 413);
  if (!SHA256.test(sha256)) fail('Attachment SHA-256 is invalid');
  if (!QUICK_XOR.test(quickXorHash)) fail('Attachment QuickXorHash is invalid');
  return { fileName, contentType, sizeBytes, sha256, quickXorHash };
}

export async function readJobCardAttachmentBytes(request, session) {
  const expectedSize = Number(session?.size_bytes);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_ATTACHMENT_BYTES) fail('Attachment size is invalid', 413);
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) !== expectedSize)) fail('Uploaded bytes must match the reserved attachment size', 413);
  const contentType = clean(request.headers.get('content-type'), 160).toLowerCase();
  if (contentType && contentType !== String(session.content_type || '').toLowerCase()) fail('Uploaded content type does not match the attachment metadata');
  if (!request.body) fail('Attachment content is required');

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > expectedSize || totalBytes > MAX_ATTACHMENT_BYTES) {
      try { await reader.cancel(); } catch (_) {}
      fail('Uploaded bytes exceed the reserved attachment size', 413);
    }
    chunks.push(value);
  }
  if (totalBytes !== expectedSize) fail('Uploaded bytes do not match the reserved attachment size', 409);

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== String(session.sha256 || '').toLowerCase()) fail('Uploaded bytes do not match the attachment SHA-256', 409);
  if (!hasJobCardAttachmentSignature(bytes, String(session.content_type || '').toLowerCase())) fail('Uploaded bytes do not match the declared image or PDF format', 415);
  return bytes;
}

export function projectJobCardAttachment(row) {
  if (!row) return null;
  return {
    attachment_id: row.attachment_id,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    uploaded_at: row.uploaded_at
  };
}

export async function findCompletedJobCardAttachment(env, recordId, metadata) {
  const row = await env.DB.prepare(`SELECT attachment_id, record_id, file_name, content_type, size_bytes,
      sha256, quick_xor_hash, sharepoint_item_id, sharepoint_path, uploaded_by_oid, uploaded_by_upn, uploaded_at
    FROM job_card_attachments WHERE record_id=? AND file_name=? AND sha256=?`)
    .bind(recordId, metadata.fileName, metadata.sha256).first();
  return row || null;
}

export async function reserveJobCardAttachmentUploadSession(env, { attachmentId, recordId, metadata, expectedPath, expiresAt, actor }) {
  const identity = actorFields(actor);
  const safeId = clean(attachmentId, 80);
  if (!/^[0-9a-f-]{36}$/i.test(safeId)) fail('Attachment upload session ID is invalid');
  const pathParts = String(expectedPath || '').split('/');
  if (pathParts.length !== 4 || pathParts[0] !== 'JobCards' || pathParts[1] !== 'Attachments' || !/^[A-Za-z0-9_-]{1,180}$/.test(pathParts[2]) || pathParts[3] !== `${safeId}-${metadata.fileName}` || String(expectedPath).includes('..')) fail('Attachment storage path is invalid');
  if (!Number.isFinite(Date.parse(expiresAt))) fail('Attachment upload expiry is invalid');
  const result = await env.DB.prepare(`WITH revision_files AS (
      SELECT size_bytes FROM job_card_attachments WHERE record_id=?
      UNION ALL
      SELECT s.size_bytes FROM job_card_attachment_upload_sessions s
        WHERE s.record_id=? AND s.status='uploading'
          AND s.expires_at > ?
          AND NOT EXISTS (SELECT 1 FROM job_card_attachments a WHERE a.attachment_id=s.attachment_id)
    )
    INSERT INTO job_card_attachment_upload_sessions
    (attachment_id, record_id, file_name, content_type, size_bytes, sha256, quick_xor_hash,
     expected_path, expires_at, actor_oid, actor_upn)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM revision_files) < ?
      AND COALESCE((SELECT SUM(size_bytes) FROM revision_files), 0) + ? <= ?`)
    .bind(recordId, recordId, new Date().toISOString(), safeId, recordId, metadata.fileName,
      metadata.contentType, metadata.sizeBytes, metadata.sha256, metadata.quickXorHash,
      expectedPath, expiresAt, identity.oid, identity.upn, MAX_ATTACHMENT_COUNT,
      metadata.sizeBytes, MAX_ATTACHMENT_TOTAL_BYTES).run();
  return Number(result?.meta?.changes || 0) === 1;
}

export async function getJobCardAttachmentUploadSession(env, recordId, attachmentId) {
  const id = clean(attachmentId, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail('Attachment was not found', 404);
  const row = await env.DB.prepare(`SELECT * FROM job_card_attachment_upload_sessions
    WHERE attachment_id=? AND record_id=?`).bind(id, recordId).first();
  if (!row) fail('Attachment was not found', 404);
  return row;
}

export async function expireJobCardAttachmentUploadSession(env, attachmentId) {
  await env.DB.prepare(`UPDATE job_card_attachment_upload_sessions
    SET status='expired', expected_path=NULL, completed_at=? WHERE attachment_id=? AND status='uploading'`)
    .bind(new Date().toISOString(), attachmentId).run();
}

export async function completeJobCardAttachmentUpload(env, session, item) {
  if (session.status === 'complete') {
    const current = await env.DB.prepare(`SELECT * FROM job_card_attachments WHERE attachment_id=?`).bind(session.attachment_id).first();
    if (!current) fail('Completed attachment metadata is unavailable', 500);
    return { attachment: current, duplicate: false };
  }
  if (session.status === 'duplicate' && session.duplicate_of) {
    const existing = await env.DB.prepare('SELECT * FROM job_card_attachments WHERE attachment_id=?').bind(session.duplicate_of).first();
    if (!existing) fail('Duplicate attachment metadata is unavailable', 500);
    return { attachment: existing, duplicate: true };
  }
  if (session.status !== 'uploading') fail('Attachment upload session is no longer active', 410);
  if (Date.parse(session.expires_at) <= Date.now()) {
    await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    fail('Attachment upload session expired; select the file again to retry', 410);
  }
  const expectedName = `${session.attachment_id}-${session.file_name}`;
  if (!session.expected_path || !item?.id || item.name !== expectedName || Number(item.size) !== Number(session.size_bytes) || item.file?.hashes?.quickXorHash !== session.quick_xor_hash) {
    fail('SharePoint attachment size, name, or QuickXorHash did not match the upload', 409);
  }

  const prior = await env.DB.prepare(`SELECT * FROM job_card_attachments
    WHERE record_id=? AND file_name=? AND sha256=?`).bind(session.record_id, session.file_name, session.sha256).first();
  if (prior) {
    return markDuplicateJobCardAttachmentUpload(env, session, prior, item.id);
  }

  const uploadedAt = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const event = JSON.stringify({ fileName: session.file_name, contentType: session.content_type, sizeBytes: Number(session.size_bytes), sha256: session.sha256 });
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO job_card_attachments
      (attachment_id, record_id, file_name, content_type, size_bytes, sha256, quick_xor_hash,
       sharepoint_item_id, sharepoint_path, uploaded_by_oid, uploaded_by_upn, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(session.attachment_id, session.record_id, session.file_name, session.content_type, session.size_bytes,
        session.sha256, session.quick_xor_hash, item.id, session.expected_path, session.actor_oid, session.actor_upn, uploadedAt),
    env.DB.prepare(`UPDATE job_card_attachment_upload_sessions SET status='complete', expected_path=NULL,
      completed_at=? WHERE attachment_id=? AND status='uploading'
        AND EXISTS (SELECT 1 FROM job_card_attachments WHERE attachment_id=?)`)
      .bind(uploadedAt, session.attachment_id, session.attachment_id),
    env.DB.prepare(`INSERT INTO job_card_attachment_audit
      (audit_id, record_id, attachment_id, actor_oid, actor_upn, action, event_json, created_at)
      SELECT ?, ?, ?, ?, ?, 'uploaded', ?, ?
      WHERE EXISTS (SELECT 1 FROM job_card_attachments WHERE attachment_id=?)`)
      .bind(auditId, session.record_id, session.attachment_id, session.actor_oid, session.actor_upn, event, uploadedAt, session.attachment_id)
  ]);
  const attachment = await env.DB.prepare('SELECT * FROM job_card_attachments WHERE attachment_id=?').bind(session.attachment_id).first();
  if (!attachment) {
    const concurrentPrior = await findCompletedJobCardAttachment(env, session.record_id, {
      fileName: session.file_name, sha256: session.sha256
    });
    if (concurrentPrior && concurrentPrior.attachment_id !== session.attachment_id) {
      return markDuplicateJobCardAttachmentUpload(env, session, concurrentPrior, item.id);
    }
    fail('Attachment metadata could not be committed', 500);
  }
  return { attachment, duplicate: false };
}

async function markDuplicateJobCardAttachmentUpload(env, session, prior, orphanItemId) {
  await env.DB.prepare(`UPDATE job_card_attachment_upload_sessions SET status='duplicate', duplicate_of=?,
    orphan_item_id=?, expected_path=NULL, completed_at=? WHERE attachment_id=? AND status='uploading'`)
    .bind(prior.attachment_id, orphanItemId, new Date().toISOString(), session.attachment_id).run();
  return { attachment: prior, duplicate: true };
}

export async function listJobCardAttachments(env, recordId) {
  const result = await env.DB.prepare(`SELECT attachment_id, record_id, file_name, content_type, size_bytes, uploaded_at
    FROM job_card_attachments WHERE record_id=? ORDER BY uploaded_at, attachment_id`).bind(recordId).all();
  return (result.results || []).map(projectJobCardAttachment);
}

export async function getJobCardAttachment(env, recordId, attachmentId) {
  const row = await env.DB.prepare(`SELECT * FROM job_card_attachments
    WHERE record_id=? AND attachment_id=?`).bind(recordId, attachmentId).first();
  if (!row) fail('Attachment was not found', 404);
  return row;
}
