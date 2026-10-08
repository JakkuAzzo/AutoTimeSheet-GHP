import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { queryEstimateArchive, upsertEstimateArchive, upsertEstimateAssociation } from '../cloudflare-worker/src/estimate-archive.js';
import worker from '../cloudflare-worker/src/index.js';

const migrationPath = new URL('../cloudflare-worker/migrations/0009_estimate_archive.sql', import.meta.url);
const migration = await readFile(migrationPath, 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(await readFile(new URL('../cloudflare-worker/migrations/0007_estimate_index.sql', import.meta.url), 'utf8'));
db.exec(await readFile(new URL('../cloudflare-worker/migrations/0008_estimate_mail_sources.sql', import.meta.url), 'utf8'));
db.exec(migration);
db.exec(`CREATE TABLE records (
  record_id TEXT PRIMARY KEY, owner_oid TEXT NOT NULL DEFAULT '', owner_upn TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '', kind TEXT, action TEXT NOT NULL DEFAULT '', status TEXT,
  start_date TEXT, end_date TEXT, record_date TEXT, submitted_at TEXT NOT NULL DEFAULT '', updated_at TEXT,
  issue TEXT, payload_json TEXT, source_message_key TEXT, source_attachment_ids TEXT, reconciliation_key TEXT,
  source_variant_status TEXT, reconciled_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE dispatch_queue (record_id TEXT PRIMARY KEY, status TEXT, attempts INTEGER, queued_at TEXT, last_sent_at TEXT, last_error TEXT)`);
db.prepare(`INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, record_date, submitted_at, payload_json, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('job-101', 'owner', 'owner@example.test', 'Owner', 'job-cards', 'job-card', 'Open', '2026-01-01', '2026-01-01T00:00:00Z', JSON.stringify({ jobReference: 'JOB-101', company: 'Acme Ltd', xeroInvoiceId: 'provider-invoice-private', invoiceNumber: 'INV-009' }), '2026-01-01T00:00:00Z');

const tableNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => name));
for (const name of ['archive_messages', 'archive_attachments', 'archive_associations']) {
  assert.ok(tableNames.has(name), `migration creates ${name}`);
}

const messageColumns = new Set(db.prepare('PRAGMA table_info(archive_messages)').all().map(({ name }) => name));
for (const name of [
  'id', 'canonical_id', 'source_kind', 'classification_state', 'mailbox',
  'source_message_id', 'internet_message_id', 'conversation_id', 'sender_email',
  'recipient_emails', 'normalized_sender_email', 'normalized_recipient_emails', 'subject',
  'normalized_customer', 'customer_display', 'customer_email', 'estimate_number',
  'reference', 'sent_at', 'received_at', 'sharepoint_eml_item_id', 'sharepoint_manifest_item_id',
  'provenance_json', 'created_at', 'updated_at'
]) assert.ok(messageColumns.has(name), `archive_messages stores ${name}`);

const insertMessage = db.prepare(`
  INSERT INTO archive_messages (
    id, canonical_id, source_kind, classification_state, mailbox, source_message_id,
    internet_message_id, conversation_id, sender_email, recipient_emails,
    normalized_sender_email, normalized_recipient_emails, subject, normalized_customer,
    customer_email, estimate_number, reference, sent_at, received_at, content_sha256,
    sharepoint_eml_item_id, sharepoint_manifest_item_id, provenance_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const message = (id, internetId) => insertMessage.run(
  id, `email:${internetId}`, 'email', 'confirmed', 'info@gmt-services.co.uk', id,
  internetId, 'conversation-1', 'info@gmt-services.co.uk', '["customer@example.test"]',
  'info@gmt-services.co.uk', 'customer@example.test', 'Estimate for ACME', 'acme ltd',
  'customer@example.test', 'EST-001', 'JOB-0042', '2025-04-15T09:00:00Z',
  '2025-04-15T09:00:00Z', 'content-hash', `sp-${id}`, `manifest-${id}`,
  JSON.stringify({ method: 'internet-message-id', observedMailbox: 'info@gmt-services.co.uk' })
);

message('mail-1', '<estimate-1@example.test>');
message('mail-2', '<revision-2@example.test>');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM archive_messages WHERE conversation_id = ?').get('conversation-1').count, 2,
  'separate email revisions in one conversation remain independently searchable');

assert.throws(() => message('mail-1-copy', '<estimate-1@example.test>'), /UNIQUE constraint failed/,
  'internet message identity is unique across duplicate mailbox copies');
assert.throws(() => db.prepare(`INSERT INTO archive_messages (id, canonical_id, source_kind, classification_state, provenance_json)
  VALUES ('missing-provenance', 'x', 'email', 'candidate', '')`).run(), /CHECK constraint failed/,
  'records without provenance are rejected');

const attachmentColumns = new Set(db.prepare('PRAGMA table_info(archive_attachments)').all().map(({ name }) => name));
for (const name of ['id', 'message_id', 'source_attachment_id', 'file_name', 'mime_type', 'size_bytes', 'sha256', 'sharepoint_item_id', 'provenance_json']) {
  assert.ok(attachmentColumns.has(name), `archive_attachments stores ${name}`);
}
db.prepare(`INSERT INTO archive_attachments (id, message_id, source_attachment_id, file_name, mime_type, size_bytes, sha256, sharepoint_item_id, provenance_json)
  VALUES ('att-1', 'mail-1', 'source-att-1', 'estimate.pdf', 'application/pdf', 100, 'abc123', 'sp-att-1', '{"source":"outlook"}')`).run();
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM archive_attachments WHERE message_id = ?').get('mail-1').count, 1,
  'attachments are separate addressable records linked to an email');

const associationColumns = new Set(db.prepare('PRAGMA table_info(archive_associations)').all().map(({ name }) => name));
for (const name of ['id', 'message_id', 'target_kind', 'target_id', 'target_reference', 'relationship', 'confidence', 'state', 'provenance_kind', 'evidence_json']) {
  assert.ok(associationColumns.has(name), `archive_associations stores ${name}`);
}
const associate = db.prepare(`INSERT INTO archive_associations (id, message_id, target_kind, target_id, target_reference, relationship, confidence, state, provenance_kind, evidence_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
associate.run('link-job', 'mail-1', 'job-card', 'job-42', 'JOB-0042', 'supports', 1, 'confirmed', 'exact-reference', '{"field":"reference"}');
associate.run('link-invoice', 'mail-1', 'invoice', 'invoice-9', 'SI-009', 'billed-as', 0.75, 'candidate', 'conversation-id', '{"conversation":"conversation-1"}');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM archive_associations WHERE message_id = ?').get('mail-1').count, 2,
  'one estimate email can link to a job card and multiple invoice records');

const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(({ name }) => name));
for (const index of [
  'idx_archive_messages_estimate_number', 'idx_archive_messages_customer', 'idx_archive_messages_sender',
  'idx_archive_messages_customer_email', 'idx_archive_messages_reference', 'idx_archive_messages_sent_at',
  'idx_archive_messages_received_at', 'idx_archive_messages_classification', 'idx_archive_messages_internet_identity',
  'idx_archive_messages_source_identity', 'idx_archive_messages_recipient_emails',
  'idx_archive_messages_conversation', 'idx_archive_attachments_message', 'idx_archive_associations_target'
]) assert.ok(indexes.has(index), `search index ${index} exists`);

const invalidTarget = () => associate.run('bad-link', 'missing-message', 'job-card', 'job-43', 'JOB-0043', 'supports', 0.5, 'candidate', 'manual-review', '{}');
assert.throws(invalidTarget, /FOREIGN KEY constraint failed/, 'association edges cannot outlive a missing source message');

const d1 = {
  prepare(sql) {
    const statement = (args = []) => ({
      first() { return db.prepare(sql).get(...args) || null; },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() { const result = db.prepare(sql).run(...args); return { success: true, meta: result }; }
    });
    return { ...statement(), bind(...args) { return statement(args); } };
  }
};
const archiveRecord = {
  id: 'mail-3', canonical_id: 'email:<new@example.test>', source_kind: 'email',
  mailbox: 'info@gmt-services.co.uk', source_message_id: 'provider-3',
  internet_message_id: '<new@example.test>', classification_state: 'candidate',
  conversation_id: 'conversation-2', subject: 'Estimate EST-777 for Acme',
  sender_email: 'info@gmt-services.co.uk', recipient_emails: ['customer@example.test'],
  customer: 'Acme Ltd', customer_email: 'customer@example.test', estimate_number: 'EST-777',
  reference: 'JOB-0077', received_at: '2026-01-02T12:00:00Z',
  sharepoint_eml_item_id: 'sp-mail-3', sharepoint_manifest_item_id: 'sp-manifest-3',
  provenance: { method: 'internet-message-id', mailbox: 'info@gmt-services.co.uk' }
};
const inserted = await upsertEstimateArchive({ DB: d1 }, archiveRecord);
assert.deepEqual(inserted, { id: 'mail-3', created: true, updated: false });
const updated = await upsertEstimateArchive({ DB: d1 }, { ...archiveRecord, subject: 'Revised estimate EST-777' });
assert.deepEqual(updated, { id: 'mail-3', created: false, updated: true }, 'replaying the same source message updates its existing archive row');
const duplicateCopy = await upsertEstimateArchive({ DB: d1 }, {
  ...archiveRecord, id: 'unsafe-caller-id', mailbox: 'accounts@gmt-services.co.uk', source_message_id: 'provider-copy-3',
  subject: '', customer: '', estimate_number: '', reference: '', sharepoint_eml_item_id: '', sharepoint_manifest_item_id: '',
  recipient_emails: [], provenance: { source: 'second-mailbox-copy' }
});
assert.equal(duplicateCopy.id, 'mail-3', 'copies in a second mailbox merge into their canonical record');
const duplicateRow = db.prepare('SELECT mailbox, source_message_id, subject, customer_display, normalized_customer, estimate_number, sharepoint_eml_item_id FROM archive_messages WHERE id = ?').get('mail-3');
assert.equal(duplicateRow.mailbox, 'info@gmt-services.co.uk', 'duplicate copy does not replace the canonical mailbox identity');
assert.equal(duplicateRow.subject, 'Revised estimate EST-777', 'incomplete duplicate does not erase existing metadata');
assert.equal(duplicateRow.customer_display, 'Acme Ltd', 'customer capitalization is retained for display');
assert.equal(duplicateRow.normalized_customer, 'acme ltd', 'customer normalization remains available for searching');
assert.equal(duplicateRow.estimate_number, 'EST-777', 'incomplete duplicate does not erase the estimate number');
assert.equal(duplicateRow.sharepoint_eml_item_id, 'sp-mail-3', 'incomplete duplicate does not erase the archived EML pointer');
await upsertEstimateAssociation({ DB: d1 }, 'mail-3', {
  target_kind: 'job-card', target_id: 'job-77', target_reference: 'JOB-0077', relationship: 'supports',
  confidence: 1, state: 'confirmed', provenance_kind: 'exact-reference', evidence: { field: 'reference' }
});
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM archive_associations WHERE message_id='mail-3' AND target_reference='JOB-0077'").get().count, 1,
  'trusted archive ingestion can upsert explicit job, estimate, or invoice links');
await assert.rejects(() => upsertEstimateArchive({ DB: d1 }, { ...archiveRecord, provenance: null }), /provenance/,
  'mail archive ingest rejects missing provenance');
const page1 = await queryEstimateArchive({ DB: d1 }, { limit: 1 });
assert.equal(page1.records.length, 1);
assert.ok(page1.nextCursor, 'bounded result pages return a continuation cursor');
const page2 = await queryEstimateArchive({ DB: d1 }, { limit: 1, cursor: page1.nextCursor });
assert.equal(page2.records.length, 1);
assert.notEqual(page1.records[0].id, page2.records[0].id, 'cursor pages do not repeat the previous row');
assert.equal((await queryEstimateArchive({ DB: d1 }, { estimateNumber: 'EST-777' })).records[0].id, 'mail-3');
assert.equal((await queryEstimateArchive({ DB: d1 }, { q: 'acme' })).records[0].id, 'mail-3');
assert.deepEqual((await queryEstimateArchive({ DB: d1 }, { from: '2026-01-02', to: '2026-01-02' })).records.map((row) => row.id), ['mail-3'],
  'custom date filters include the full selected end date');

const tenant = '8b182d6b-6f34-4ca2-84ad-50ca712b5488';
const audience = '01b5a6c6-f6c1-47cb-aebe-67f07f415e4b';
const signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey);
jwk.kid = 'estimate-archive-test-key';
jwk.use = 'sig';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => String(url).includes('/discovery/v2.0/keys')
  ? new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  : new Response('', { status: 404 });
const base64url = (value) => Buffer.from(value).toString('base64url');
async function signedToken(overrides = {}) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }));
  const claims = base64url(JSON.stringify({
    tid: tenant, aud: audience, iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 300, oid: 'ordinary-staff-oid',
    preferred_username: 'employee@gmt-services.co.uk', ...overrides
  }));
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
const routeEnv = { DB: d1, ENTRA_TENANT_ID: tenant, ENTRA_AUDIENCES: audience, ALLOWED_ORIGINS: 'https://gmt-services.co.uk' };
const archiveListUrl = 'https://gmt-portal-api.example.workers.dev/api/archive/estimates?limit=1';
assert.equal((await worker.fetch(new Request(archiveListUrl), routeEnv, {})).status, 401,
  'shared archive is denied without a signed-in tenant identity');
const staffToken = await signedToken();
const listed = await worker.fetch(new Request(archiveListUrl, { headers: { authorization: `Bearer ${staffToken}` } }), routeEnv, {});
assert.equal(listed.status, 200, 'ordinary authenticated GMT employees can search the shared archive');
const listedBody = await listed.json();
assert.equal(listedBody.records.length, 1);
for (const privateField of ['source_message_id', 'internet_message_id', 'conversation_id', 'sharepoint_eml_item_id', 'sharepoint_manifest_item_id', 'provenance_json']) {
  assert.ok(!(privateField in listedBody.records[0]), `shared archive search redacts ${privateField}`);
}
assert.ok(!JSON.stringify(listedBody).includes('provider-3'), 'provider message IDs never reach the browser');
assert.ok(!('canonical_id' in listedBody.records[0]), 'canonical provider identity never reaches the browser');
assert.ok(!JSON.stringify(listedBody).includes('<new@example.test>'), 'Internet Message-ID values never reach the browser');
const detailUrl = 'https://gmt-portal-api.example.workers.dev/api/archive/estimates/mail-3';
const detailResponse = await worker.fetch(new Request(detailUrl, { headers: { authorization: `Bearer ${staffToken}` } }), routeEnv, {});
assert.equal(detailResponse.status, 200, 'ordinary authenticated staff can open archive message details');
const detailBody = await detailResponse.json();
for (const privateField of ['source_message_id', 'internet_message_id', 'conversation_id', 'sharepoint_eml_item_id', 'sharepoint_manifest_item_id', 'provenance_json']) {
  assert.ok(!(privateField in detailBody.message), `shared archive detail redacts ${privateField}`);
}
assert.ok(!('canonical_id' in detailBody.message), 'canonical provider identity never reaches the browser');
assert.ok(!JSON.stringify(detailBody).includes('sp-mail-3'), 'SharePoint item IDs never reach the browser');
assert.ok(!JSON.stringify(detailBody).includes('provider-3'), 'source provider message IDs never reach the browser');
assert.ok(!JSON.stringify(detailBody).includes('<new@example.test>'), 'Internet Message-ID values never reach the browser');
const threadResponse = await worker.fetch(new Request('https://gmt-portal-api.example.workers.dev/api/archive/estimates/mail-1', { headers: { authorization: `Bearer ${staffToken}` } }), routeEnv, {});
const threadBody = await threadResponse.json();
assert.deepEqual(threadBody.conversation.map((item) => item.id), ['mail-1', 'mail-2'], 'conversation messages are ordered and paged through internal archive identifiers');
assert.equal(threadBody.conversation[0].attachments[0].file_name, 'estimate.pdf', 'conversation detail includes attachment metadata for every archived message');
assert.equal(threadBody.associations.find((item) => item.target_kind === 'job-card').target_id, 'job-42', 'staff can follow an exact linked job card');
assert.ok(!('target_id' in threadBody.associations.find((item) => item.target_kind === 'invoice')), 'Xero invoice provider IDs remain private');
const wrongTenantToken = await signedToken({ tid: 'wrong-tenant' });
assert.equal((await worker.fetch(new Request(archiveListUrl, { headers: { authorization: `Bearer ${wrongTenantToken}` } }), routeEnv, {})).status, 401,
  'signed-in identities from another tenant cannot query the archive');
const contentUrl = 'https://gmt-portal-api.example.workers.dev/api/archive/estimates/mail-1/content/eml';
assert.equal((await worker.fetch(new Request(contentUrl), routeEnv, {})).status, 401,
  'SharePoint content cannot be proxied without portal authentication');
assert.equal((await worker.fetch(new Request(contentUrl, { headers: { authorization: `Bearer ${staffToken}` } }), routeEnv, {})).status, 503,
  'authenticated content retrieval fails closed until SharePoint service credentials are configured');
const ingestUrl = 'https://gmt-portal-api.example.workers.dev/api/archive/sync/estimates';
assert.equal((await worker.fetch(new Request(ingestUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), routeEnv, {})).status, 503,
  'estimate ingestion fails closed when the dedicated secret is not configured');
assert.equal((await worker.fetch(new Request(ingestUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'wrong' }, body: '{}' }), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {})).status, 401,
  'estimate ingestion rejects callers without the isolated flow secret');
const invalidAttachmentIngest = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'info@gmt-services.co.uk', outlook_message_id: 'test-source-id', internet_message_id: '<test@example.test>', sharepoint_eml_item_id: 'sp-test-eml', attachments: [{ file_name: 'estimate.pdf' }] })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(invalidAttachmentIngest.status, 400, 'ingest rejects attachment metadata without a private SharePoint item ID before writing records');
const missingEmlIngest = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'info@gmt-services.co.uk', outlook_message_id: 'no-eml', archive_id: 'mail-1' })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(missingEmlIngest.status, 400, 'mail is not indexed as a successful archive record unless its EML is already stored');
const collisionIngest = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'info@gmt-services.co.uk', outlook_message_id: 'new-provider-id', internet_message_id: '<distinct@example.test>', archive_id: 'mail-1', sharepoint_eml_item_id: 'sp-new-eml', subject: 'New distinct message', provenance: { source: 'test' } })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(collisionIngest.status, 200, 'valid stored email can be ingested');
const collisionBody = await collisionIngest.json();
assert.notEqual(collisionBody.archive.id, 'mail-1', 'ingest caller cannot select or collide with an existing archive primary key');
assert.equal(db.prepare("SELECT subject FROM archive_messages WHERE id='mail-1'").get().subject, 'Estimate for ACME', 'caller-supplied archive ID cannot overwrite an existing record');
assert.equal(collisionBody.associations.length, 0);
const duplicateMailboxIngest = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'accounts@gmt-services.co.uk', outlook_message_id: 'new-provider-copy', internet_message_id: '<distinct@example.test>', sharepoint_eml_item_id: 'sp-copy-eml', subject: '', estimate_number: '' })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(duplicateMailboxIngest.status, 200);
const duplicateMailboxBody = await duplicateMailboxIngest.json();
assert.equal(duplicateMailboxBody.archive.id, collisionBody.archive.id, 'duplicate copies share one canonical archive message');
const duplicateDetailResponse = await worker.fetch(new Request(`https://gmt-portal-api.example.workers.dev/api/archive/estimates/${collisionBody.archive.id}`, { headers: { authorization: `Bearer ${staffToken}` } }), routeEnv, {});
const duplicateDetailBody = await duplicateDetailResponse.json();
assert.deepEqual(duplicateDetailBody.sourceCopies.map((item) => item.mailbox).sort(), ['accounts@gmt-services.co.uk', 'info@gmt-services.co.uk'],
  'both mailbox occurrences remain visible as safe source-copy labels');
const linkedIngest = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'accounts@gmt-services.co.uk', outlook_message_id: 'linked-provider-id', internet_message_id: '<linked@example.test>', sharepoint_eml_item_id: 'sp-linked-eml', reference: 'JOB-101', associations: [{ target_kind: 'job-card', target_id: 'job-101', target_reference: 'JOB-101', relationship: 'supports', confidence: 1, state: 'confirmed', provenance_kind: 'exact-reference', evidence: { field: 'reference' } }] })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(linkedIngest.status, 200, 'ingest accepts validated explicit record relationships');
const linkedBody = await linkedIngest.json();
assert.equal(linkedBody.associations[0].target_reference, 'JOB-101');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM archive_associations WHERE message_id=?').get(linkedBody.archive.id).count, 1,
  'archive ingest persists explicit record relationships for portal detail');
const portalEstimateIngest = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({
    mailbox: 'info@gmt-services.co.uk', outlook_message_id: 'portal-estimate-mail',
    internet_message_id: '<portal-estimate@example.test>', sharepoint_eml_item_id: 'sp-portal-estimate-eml',
    classification_state: 'confirmed', portal_record: true, estimate_number: 'EST-PORTAL-1',
    client: 'Client Ltd', client_email: 'client@example.test', reference: 'JOB-202',
    subject: 'Estimate EST-PORTAL-1 for Client Ltd', sent_at: '2026-10-07T09:00:00Z'
  })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(portalEstimateIngest.status, 200);
const portalEstimateBody = await portalEstimateIngest.json();
const portalRecord = db.prepare('SELECT * FROM records WHERE record_id=?').get(portalEstimateBody.portal_record.record_id);
assert.equal(portalRecord.kind, 'estimates', 'confirmed email estimates can appear in shared submitted-document and calendar views');
assert.equal(portalRecord.action, 'email_archive');
assert.equal(JSON.parse(portalRecord.payload_json).estimateNumber, 'EST-PORTAL-1');
assert.equal(JSON.parse(portalRecord.payload_json).archiveMessageId, portalEstimateBody.archive.id);
const historyWithImportedEstimate = await worker.fetch(new Request('https://gmt-portal-api.example.workers.dev/api/history?kind=estimates', { headers: { authorization: `Bearer ${staffToken}` } }), routeEnv, {});
assert.equal(historyWithImportedEstimate.status, 200);
const historyWithImportedEstimateBody = await historyWithImportedEstimate.json();
assert.ok(historyWithImportedEstimateBody.records.some((record) => record.source_record_id === portalRecord.record_id && record.estimate_number === 'EST-PORTAL-1'),
  'authenticated employees see confirmed imported estimate emails in the shared submitted-document history');
const calendarContext = { window: {} };
vm.runInNewContext(await readFile(new URL('../portal/calendar-data.js', import.meta.url), 'utf8'), calendarContext);
const calendarEvents = calendarContext.window.GMTCalendarData.recordsToEvents(historyWithImportedEstimateBody.records, {});
assert.ok(calendarEvents.some((event) => event.recordId === portalRecord.record_id && event.date === '2026-10-07' && event.type === 'estimates'),
  'confirmed imported estimates with a date appear in the shared calendar');
const portalEstimateReplay = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({
    mailbox: 'accounts@gmt-services.co.uk', outlook_message_id: 'portal-estimate-copy',
    internet_message_id: '<portal-estimate@example.test>', sharepoint_eml_item_id: 'sp-portal-estimate-eml',
    classification_state: 'confirmed', portal_record: true, estimate_number: 'EST-PORTAL-1',
    client: 'Client Ltd', client_email: 'client@example.test', reference: 'JOB-202',
    subject: 'Estimate EST-PORTAL-1 for Client Ltd', sent_at: '2026-10-07T09:00:00Z'
  })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(portalEstimateReplay.status, 200);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM records WHERE action='email_archive'").get().count, 1,
  'duplicate copies do not create duplicate portal estimate records');
const candidatePortalRecord = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'info@gmt-services.co.uk', outlook_message_id: 'candidate-portal-record', internet_message_id: '<candidate@example.test>', sharepoint_eml_item_id: 'sp-candidate-eml', portal_record: true, subject: 'Supplier quotation candidate' })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(candidatePortalRecord.status, 200);
assert.equal((await candidatePortalRecord.json()).portal_record, null,
  'candidate and supplier mail remains out of Submitted Documents and the calendar even if a caller requests a portal record');
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM records WHERE action='email_archive'").get().count, 1);
const secondJobEmail = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'info@gmt-services.co.uk', outlook_message_id: 'other-thread-message', internet_message_id: '<other-thread@example.test>', sharepoint_eml_item_id: 'sp-other-thread', reference: ' JOB-101 ', invoice_number: 'INV-009' })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(secondJobEmail.status, 200);
const secondJobMessage = await secondJobEmail.json();
assert.equal(db.prepare('SELECT reference FROM archive_messages WHERE id=?').get(secondJobMessage.archive.id).reference, 'JOB-101', 'email ingest retains the exact job reference for deterministic correlation');
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='job-cards' AND status <> 'Deleted'").get().count, 1, 'correlation source job is available');
assert.equal(secondJobMessage.associations.find((item) => item.target_kind === 'job-card').target_id, 'job-101',
  'a unique exact job reference automatically creates a confirmed job-card association');
assert.ok(secondJobMessage.associations.some((item) => item.target_kind === 'invoice' && item.target_reference === 'INV-009'),
  'an exact invoice number already linked to a job card creates a related invoice association');
const combinedJobDetail = await worker.fetch(new Request(`https://gmt-portal-api.example.workers.dev/api/archive/estimates/${linkedBody.archive.id}`, { headers: { authorization: `Bearer ${staffToken}` } }), routeEnv, {});
const combinedJobBody = await combinedJobDetail.json();
assert.ok(combinedJobBody.conversation.some((item) => item.id === secondJobMessage.archive.id),
  'opening an email associated with a job also surfaces a separate conversation linked to the same job');
assert.ok(!JSON.stringify(combinedJobBody).includes('provider-invoice-private'), 'invoice provider IDs remain hidden from all shared portal users');
const insertTestRecord = db.prepare(`INSERT INTO records
  (record_id, owner_oid, owner_upn, employee_name, kind, action, status, record_date, submitted_at, payload_json, updated_at)
  VALUES (?, 'test-owner', 'test@example.test', 'Test', ?, 'test', ?, ?, ?, ?, ?)`);
insertTestRecord.run('older-job-exact', 'job-cards', 'Open', '2018-01-01', '2018-01-01T00:00:00Z', JSON.stringify({ jobReference: 'OLD-JOB-EXACT' }), '2018-01-01T00:00:00Z');
for (let index = 0; index < 520; index += 1) {
  insertTestRecord.run(`newer-job-${index}`, 'job-cards', 'Open', '2026-01-01', '2026-01-01T00:00:00Z', JSON.stringify({ jobReference: `NEW-JOB-${index}` }), `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`);
}
const olderJobEmail = await worker.fetch(new Request(ingestUrl, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': 'secret' },
  body: JSON.stringify({ mailbox: 'info@gmt-services.co.uk', outlook_message_id: 'older-exact-reference', internet_message_id: '<older-exact@example.test>', sharepoint_eml_item_id: 'sp-older-exact', reference: 'OLD-JOB-EXACT' })
}), { ...routeEnv, ESTIMATE_MAIL_INGEST_KEY: 'secret' }, {});
assert.equal(olderJobEmail.status, 200);
assert.equal((await olderJobEmail.json()).associations.find((item) => item.target_kind === 'job-card')?.target_id, 'older-job-exact',
  'exact job matching finds records older than the newest 500 unrelated records');
let appUploads = 0;
const appUploadPaths = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'sharepoint-test-token' }), { status: 200 });
  if (String(url).includes('graph.microsoft.com') && init.method === 'PUT') {
    appUploads += 1;
    appUploadPaths.push(String(url));
    return new Response(JSON.stringify({ id: `sp-app-${appUploads}` }), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  return new Response('', { status: 404 });
};
const appEnv = { ...routeEnv, SHAREPOINT_GRAPH_CLIENT_ID: 'test-client', SHAREPOINT_GRAPH_CLIENT_SECRET: 'test-secret', SHAREPOINT_SITE_ID: 'test-site', SHAREPOINT_DRIVE_ID: 'test-drive' };
const appUrl = 'https://gmt-portal-api.example.workers.dev/api/archive/estimates/app';
const appBody = { fileName: 'estimate.doc', contentType: 'application/msword', contentBase64: Buffer.from('estimate bytes').toString('base64'), source_record_id: 'protected-estimate-record-1', estimate_number: 'EST-APP-1', customer: 'Acme Ltd', reference: 'JOB-101', invoice_number: 'INV-009' };
insertTestRecord.run('protected-estimate-record-1', 'estimates', 'Sent to client', '2026-01-02', '2026-01-02T00:00:00Z', JSON.stringify({ estimateNumber: 'EST-APP-1', reference: 'JOB-101' }), '2026-01-02T00:00:00Z');
const firstAppResponse = await worker.fetch(new Request(appUrl, { method: 'POST', headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' }, body: JSON.stringify(appBody) }), appEnv, {});
assert.equal(firstAppResponse.status, 201, 'first app archive request stores the document');
assert.match(appUploadPaths[0], /\/root:\/Estimates\/Sent%20from%20Portal\//,
  'estimates sent from the builder are stored in their dedicated SharePoint folder');
const firstApp = await firstAppResponse.json();
assert.ok(firstApp.associations.some((item) => item.target_kind === 'estimate' && item.target_id === 'protected-estimate-record-1'),
  'app-created estimate archive automatically links to its protected GMT estimate record');
assert.ok(firstApp.associations.some((item) => item.target_kind === 'job-card' && item.target_id === 'job-101'),
  'app-created estimate archive automatically links to a uniquely matching job card');
assert.ok(firstApp.associations.some((item) => item.target_kind === 'invoice' && item.target_reference === 'INV-009' && !('target_id' in item)),
  'app archive returns a visible invoice reference while redacting its Xero provider ID');
assert.ok(!JSON.stringify(firstApp).includes('provider-invoice-private'), 'app archive response never exposes Xero provider invoice IDs');
const retryAppResponse = await worker.fetch(new Request(appUrl, { method: 'POST', headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' }, body: JSON.stringify(appBody) }), appEnv, {});
assert.equal(retryAppResponse.status, 200, 'identical app archive retry returns the existing archive record');
const retryApp = await retryAppResponse.json();
assert.equal(retryApp.duplicate, true);
assert.equal(retryApp.id, firstApp.id, 'app archive retry is idempotent by protected record and content hash');
assert.equal(appUploads, 1, 'idempotent retry does not upload a second file');
const metadataRevision = await worker.fetch(new Request(appUrl, { method: 'POST', headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...appBody, customer: 'ACME Limited' }) }), appEnv, {});
assert.equal(metadataRevision.status, 201, 'metadata-only corrections create a separately indexed revision');
assert.notEqual((await metadataRevision.json()).id, firstApp.id);
assert.equal(appUploadPaths[1], appUploadPaths[0], 'identical file bytes reuse the deterministic SharePoint path across metadata revisions');
const conversationRevision = await worker.fetch(new Request(appUrl, { method: 'POST', headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...appBody, conversation_id: 'conversation-corrected' }) }), appEnv, {});
assert.equal(conversationRevision.status, 201, 'conversation metadata corrections create a separately indexed revision');
assert.notEqual((await conversationRevision.json()).id, firstApp.id, 'conversation ID participates in the app archive metadata fingerprint');
const changedApp = await worker.fetch(new Request(appUrl, { method: 'POST', headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...appBody, contentBase64: Buffer.from('revised estimate bytes').toString('base64') }) }), appEnv, {});
assert.equal(changedApp.status, 201, 'a changed document creates a separately archived revision');
assert.notEqual((await changedApp.json()).id, firstApp.id);
const missingAppKey = await worker.fetch(new Request(appUrl, { method: 'POST', headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...appBody, source_record_id: '' }) }), appEnv, {});
assert.equal(missingAppKey.status, 400, 'app archive rejects requests without a stable source-record id');
globalThis.fetch = originalFetch;
db.close();
console.log('Estimate archive schema and data contract: PASS');
