import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { jobCardBatchId, upsertJobCardArchive, queryJobCardArchive } from '../cloudflare-worker/src/job-card-archive.js';
import worker from '../cloudflare-worker/src/index.js';

const migration = await readFile(new URL('../cloudflare-worker/migrations/0010_job_card_archive.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`CREATE TABLE records (
  record_id TEXT PRIMARY KEY, owner_oid TEXT NOT NULL, owner_upn TEXT NOT NULL, employee_name TEXT NOT NULL,
  kind TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, start_date TEXT, end_date TEXT,
  record_date TEXT, submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL, issue TEXT, payload_json TEXT NOT NULL,
  source_message_key TEXT, source_attachment_ids TEXT, reconciliation_key TEXT, source_variant_status TEXT,
  reconciled_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(migration);

const tableNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map(({ name }) => name));
for (const table of ['job_card_import_batches', 'job_card_source_files', 'job_card_upload_sessions', 'job_card_archive', 'job_card_archive_fts', 'job_card_archive_review_audit']) {
  assert.ok(tableNames.has(table), `migration creates ${table}`);
}
const sessionColumns = new Set(db.prepare('PRAGMA table_info(job_card_upload_sessions)').all().map(({ name }) => name));
assert.ok(!sessionColumns.has('upload_url'), 'preauthenticated upload URLs are never stored in D1');
for (const index of ['idx_job_card_archive_batch_source', 'idx_job_card_upload_sessions_expiry', 'idx_job_card_review_audit_record']) {
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index), `index ${index} exists`);
}

const d1 = {
  prepare(sql) {
    const createStatement = (args = []) => ({
      sql,
      args,
      bind(...values) { return createStatement(values); },
      first() { return db.prepare(sql).get(...args) || null; },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() { const result = db.prepare(sql).run(...args); return { success: true, meta: result }; }
    });
    return createStatement();
  },
  async batch(statements) {
    db.exec('BEGIN');
    try {
      const result = statements.map((statement) => db.prepare(statement.sql).run(...statement.args));
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
};

const sourceFiles = [
  { fileName: 'EC09200.pdf', pageCount: 2, sizeBytes: 100, sha256: '1'.repeat(64), quickXorHash: Buffer.alloc(20, 1).toString('base64') },
  { fileName: 'MTA22900.pdf', pageCount: 1, sizeBytes: 120, sha256: '2'.repeat(64), quickXorHash: Buffer.alloc(20, 2).toString('base64') }
];
const batchId = await jobCardBatchId(sourceFiles);
const batch = { batchId, sourceCount: sourceFiles.length, pageCount: 3, sources: sourceFiles };
const archiveBatchId = `jobcard-batch-${'b'.repeat(64)}`;
db.prepare(`INSERT INTO job_card_import_batches
  (batch_id, source_count, page_count, sources_json, status, created_by_oid, created_by_upn)
  VALUES (?, ?, ?, ?, 'source-complete', 'accounts-oid', 'acc.gmtelect@gmt-services.co.uk')`)
  .run(archiveBatchId, batch.sourceCount, batch.pageCount, JSON.stringify(sourceFiles));

const baseEntry = {
  batchId: archiveBatchId,
  recordId: `jobcard-${sourceFiles[0].sha256}-0001`,
  sourceFile: 'EC09200.pdf',
  sourceSha256: sourceFiles[0].sha256,
  sourceQuickXorHash: sourceFiles[0].quickXorHash,
  sourcePage: 1,
  cardType: 'EC',
  sizeBytes: 123,
  sha256: createHash('sha256').update('page one').digest('hex'),
  quickXorHash: Buffer.alloc(20, 3).toString('base64'),
  candidates: { cardNumber: 'EC09200', date: '06/10/2026', customer: 'ACME Electrical', orderNumber: 'PO-99', site: '', engineer: '', report: 'Replace lighting', amount: '£240.00' },
  ocrText: 'ACME Electrical EC09200 job card reconciliationmarker',
  meanOcrConfidence: 48.2,
  reviewState: 'needs-review',
  reviewReasons: ['low-ocr-confidence'],
  purpose: 'job-card-page'
};
const accounts = { oid: 'accounts-oid', upn: 'acc.gmtelect@gmt-services.co.uk', name: 'Accounts User' };
await upsertJobCardArchive({ DB: d1 }, {
  manifestEntry: baseEntry,
  sharepointItemId: 'private-sharepoint-item-1',
  sharepointPath: `JobCards/Records/${baseEntry.recordId}.pdf`
}, accounts);
const initial = db.prepare('SELECT * FROM job_card_archive WHERE record_id=?').get(baseEntry.recordId);
assert.equal(initial.review_state, 'needs-review');
assert.deepEqual(JSON.parse(initial.candidates_json), baseEntry.candidates);
assert.deepEqual(JSON.parse(initial.confirmed_json), {}, 'OCR candidates are separate from Accounts-confirmed values');

const audit = await import('../cloudflare-worker/src/job-card-archive.js');
await audit.reviewJobCardArchive({ DB: d1 }, baseEntry.recordId, {
  confirmedFields: { cardNumber: 'EC09200', date: '2026-10-06', customer: 'ACME Electrical Ltd' },
  state: 'confirmed', note: 'Checked against the scan.'
}, accounts);
const reviewed = db.prepare('SELECT * FROM job_card_archive WHERE record_id=?').get(baseEntry.recordId);
assert.deepEqual(JSON.parse(reviewed.candidates_json), baseEntry.candidates, 'review preserves raw OCR candidates');
assert.deepEqual(JSON.parse(reviewed.confirmed_json), { cardNumber: 'EC09200', date: '2026-10-06', customer: 'ACME Electrical Ltd' });
assert.equal(reviewed.review_state, 'confirmed');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_card_archive_review_audit WHERE record_id=?').get(baseEntry.recordId).count, 1);

for (let index = 1; index <= 560; index += 1) {
  const sourceSha256 = 'f'.repeat(64);
  const entry = {
    ...baseEntry,
    batchId: archiveBatchId,
    recordId: `jobcard-${sourceSha256}-${String(index).padStart(4, '0')}`,
    sourceFile: 'EC09200-bulk.pdf',
    sourceSha256,
    sourcePage: index,
    ocrText: `ACME Electrical archivepaginationmarker unique-card-${index}`,
    sha256: createHash('sha256').update(`page-${index}`).digest('hex'),
    quickXorHash: Buffer.alloc(20, index % 256).toString('base64')
  };
  await upsertJobCardArchive({ DB: d1 }, {
    manifestEntry: entry,
    sharepointItemId: `private-bulk-${index}`,
    sharepointPath: `JobCards/Records/${entry.recordId}.pdf`
  }, accounts);
}

const firstPage = await queryJobCardArchive({ DB: d1 }, { q: 'archivepaginationmarker', limit: 100 });
assert.equal(firstPage.records.length, 100, 'search is bounded to one result page');
assert.ok(firstPage.nextCursor, 'search returns a continuation cursor');
const pagedIds = new Set(firstPage.records.map((record) => record.record_id));
let cursor = firstPage.nextCursor;
while (cursor) {
  const page = await queryJobCardArchive({ DB: d1 }, { q: 'archivepaginationmarker', limit: 100, cursor });
  for (const record of page.records) assert.ok(!pagedIds.has(record.record_id), 'keyset pages do not repeat records');
  page.records.forEach((record) => pagedIds.add(record.record_id));
  cursor = page.nextCursor;
}
assert.equal(pagedIds.size, 560, 'FTS search pages through all 560 matching job cards');
await assert.rejects(() => queryJobCardArchive({ DB: d1 }, { q: 'ab' }), /three characters/i, 'substring search rejects terms too short for trigram FTS');
const safePage = await queryJobCardArchive({ DB: d1 }, { q: 'archivepaginationmarker', limit: 2 });
assert.ok(!JSON.stringify(safePage).includes('private-sharepoint-item'), 'search results never include SharePoint item IDs');
assert.ok(!JSON.stringify(safePage).includes('sharepointPath'), 'search results never include SharePoint paths');

const tenant = 'job-card-test-tenant';
const audience = 'job-card-test-audience';
const signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey);
jwk.kid = `job-card-${crypto.randomUUID()}`;
jwk.use = 'sig';
const tokenFor = async (upn, oid, name = 'GMT Staff') => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'RS256', typ: 'JWT', kid: jwk.kid });
  const body = encode({ aud: audience, tid: tenant, iss: `https://login.microsoftonline.com/${tenant}/v2.0`, exp: Math.floor(Date.now() / 1000) + 3600, oid, preferred_username: upn, name });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
};
const employeeToken = await tokenFor('jason@gmt-services.co.uk', 'employee-oid');
const accountsToken = await tokenFor('acc.gmtelect@gmt-services.co.uk', 'accounts-oid', 'Accounts User');
const routeEnv = {
  DB: d1,
  ENTRA_TENANT_ID: tenant,
  ENTRA_AUDIENCES: audience,
  ADMIN_UPNS: 'acc.gmtelect@gmt-services.co.uk',
  JOB_CARD_ADMIN_UPNS: 'acc.gmtelect@gmt-services.co.uk',
  ALLOWED_ORIGINS: 'https://gmt-services.co.uk',
  SHAREPOINT_GRAPH_CLIENT_ID: 'test-client',
  SHAREPOINT_GRAPH_CLIENT_SECRET: 'test-secret',
  SHAREPOINT_SITE_ID: 'test-site',
  SHAREPOINT_DRIVE_ID: 'test-drive'
};
const completedObjects = new Map();
const sharepointFolders = new Set();
const graphSessions = [];
let mismatchNextHash = false;
let graphCreateCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const address = String(url);
  if (address.includes('/discovery/v2.0/keys')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (address.includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'sharepoint-test-token' }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (address.includes('graph.microsoft.com') && init.method === 'POST' && /\/root(?:[^?]*)\/children$/.test(address)) {
    const parentPath = address.includes('/root:/') ? decodeURIComponent(address.split('/root:/')[1].split(':/children')[0]) : '';
    const folderName = JSON.parse(init.body || '{}').name;
    const path = parentPath ? `${parentPath}/${folderName}` : folderName;
    sharepointFolders.add(path);
    return new Response(JSON.stringify({ id: `private-folder-${sharepointFolders.size}`, name: folderName, folder: {} }), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (address.includes('graph.microsoft.com') && address.includes(':/createUploadSession')) {
    const path = decodeURIComponent(address.split('/root:/')[1].split(':/createUploadSession')[0]);
    graphSessions.push({ path, body: JSON.parse(init.body || '{}') });
    graphCreateCount += 1;
    return new Response(JSON.stringify({ uploadUrl: `https://upload.example.test/session-${graphCreateCount}`, expirationDateTime: new Date(Date.now() + 3600_000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (address.includes('graph.microsoft.com') && address.includes('/root:/')) {
    const path = decodeURIComponent(address.split('/root:/')[1]);
    if (sharepointFolders.has(path)) return new Response(JSON.stringify({ id: `private-folder-${path}`, name: path.split('/').at(-1), folder: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    const record = completedObjects.get(path);
    if (!record) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    const result = mismatchNextHash ? { ...record, file: { hashes: { quickXorHash: 'wrong-qx' } } } : record;
    mismatchNextHash = false;
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (address.includes('graph.microsoft.com') && address.endsWith('/content')) return new Response('%PDF-1.4 test page', { status: 200, headers: { 'content-type': 'application/pdf' } });
  return new Response('', { status: 404 });
};

const api = 'https://gmt-portal-api.example.workers.dev';
const call = async (path, token, { method = 'GET', body } = {}) => worker.fetch(new Request(`${api}${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {})
}), routeEnv, {});
try {
  const employeeSearch = await call('/api/job-cards/archive/search?q=ACME', employeeToken);
  assert.equal(employeeSearch.status, 200, 'staff can search shared job cards');
  assert.ok(!JSON.stringify(await employeeSearch.clone().json()).includes('private-sharepoint-item'));
  const anonymous = await call('/api/job-cards/archive/search?q=ACME', '');
  assert.equal(anonymous.status, 401, 'anonymous users cannot search the protected archive');
  const deniedStart = await call('/api/admin/job-card-batches/start', employeeToken, { method: 'POST', body: batch });
  assert.equal(deniedStart.status, 403, 'employees cannot start an archive import');
  assert.equal(graphCreateCount, 0, 'role denial happens before any SharePoint request');

  const start = await call('/api/admin/job-card-batches/start', accountsToken, { method: 'POST', body: batch });
  assert.equal(start.status, 201);
  const sourceSessionIds = [];
  for (const source of sourceFiles) {
    const session = await call('/api/admin/job-card-upload-sessions', accountsToken, {
      method: 'POST', body: { purpose: 'source-batch', batchId, fileName: source.fileName, sizeBytes: source.sizeBytes, sha256: source.sha256, quickXorHash: source.quickXorHash, pageCount: source.pageCount }
    });
    assert.equal(session.status, 201);
    const sessionBody = await session.json();
    assert.deepEqual(Object.keys(sessionBody).sort(), ['expirationDateTime', 'sessionId', 'uploadUrl'].sort(), 'only the Accounts upload response receives the one-time URL and opaque metadata');
    assert.ok(sessionBody.uploadUrl.startsWith('https://upload.example.test/'));
    assert.ok(!JSON.stringify(sessionBody).includes('private-sharepoint-item'));
    sourceSessionIds.push(sessionBody.sessionId);
    const path = graphSessions.at(-1).path;
    completedObjects.set(path, { id: `private-source-item-${sourceFiles.indexOf(source)}`, name: source.fileName, size: source.sizeBytes, file: { hashes: { quickXorHash: source.quickXorHash } } });
    const completion = await call('/api/admin/job-card-batches/complete', accountsToken, { method: 'POST', body: { sessionId: sessionBody.sessionId } });
    assert.equal(completion.status, 200);
  }
  assert.equal(db.prepare('SELECT status FROM job_card_import_batches WHERE batch_id=?').get(batchId).status, 'source-complete');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_card_source_files WHERE batch_id=?').get(batchId).count, 2);

  const pageEntry = { ...baseEntry, batchId, sourcePage: 2, recordId: `jobcard-${sourceFiles[0].sha256}-0002` };
  const pageSession = await call('/api/admin/job-card-upload-sessions', accountsToken, {
    method: 'POST', body: { purpose: 'job-card-page', batchId, manifestEntry: pageEntry }
  });
  assert.equal(pageSession.status, 201);
  const pageSessionBody = await pageSession.json();
  const pagePath = graphSessions.at(-1).path;
  completedObjects.set(pagePath, { id: 'private-sharepoint-item-1', name: `${pageEntry.recordId}.pdf`, size: pageEntry.sizeBytes, file: { hashes: { quickXorHash: pageEntry.quickXorHash } } });
  mismatchNextHash = true;
  const failedImport = await call('/api/admin/job-cards/import', accountsToken, { method: 'POST', body: { sessionId: pageSessionBody.sessionId } });
  assert.equal(failedImport.status, 409, 'a Graph hash mismatch blocks archive indexing');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_card_archive').get().count, 561, 'only directly seeded local fixtures exist after failed upload verification');

  const imported = await call('/api/admin/job-cards/import', accountsToken, { method: 'POST', body: { sessionId: pageSessionBody.sessionId } });
  assert.equal(imported.status, 201);
  const importedBody = await imported.json();
  assert.equal(importedBody.recordId, pageEntry.recordId);
  assert.ok(!JSON.stringify(importedBody).includes('private-sharepoint-item'));
  const replay = await call('/api/admin/job-cards/import', accountsToken, { method: 'POST', body: { sessionId: pageSessionBody.sessionId } });
  assert.equal(replay.status, 200, 'completed page import is safely retryable');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM records WHERE record_id=?').get(pageEntry.recordId).count, 1);

  const employeeReview = await call(`/api/job-cards/archive/${pageEntry.recordId}/review`, employeeToken, { method: 'PATCH', body: { confirmedFields: { cardNumber: 'EC09200' }, state: 'confirmed' } });
  assert.equal(employeeReview.status, 403, 'employees cannot alter confirmed metadata');
  const review = await call(`/api/job-cards/archive/${pageEntry.recordId}/review`, accountsToken, { method: 'PATCH', body: { confirmedFields: { cardNumber: 'EC09200', date: '2026-10-06', customer: 'ACME Electrical Ltd' }, state: 'confirmed', note: 'Verified against scan.' } });
  assert.equal(review.status, 200);
  assert.deepEqual((await review.json()).confirmedFields, { cardNumber: 'EC09200', date: '2026-10-06', customer: 'ACME Electrical Ltd' });

  const content = await call(`/api/job-cards/archive/${pageEntry.recordId}/content`, employeeToken);
  assert.equal(content.status, 200, 'staff can preview an indexed shared job card');
  assert.match(content.headers.get('content-type') || '', /application\/pdf/);
  assert.ok(!content.headers.get('content-disposition')?.includes('private-sharepoint-item'));
  assert.equal(await content.text(), '%PDF-1.4 test page');

  const afterRouteResponse = await call('/api/job-cards/archive/search?q=archivepaginationmarker&limit=2', employeeToken);
  assert.equal(afterRouteResponse.status, 200);
  const afterRoute = await afterRouteResponse.json();
  assert.ok(!JSON.stringify(afterRoute).includes('private-sharepoint-item'));
  assert.ok(!JSON.stringify(afterRoute).includes('sharepointPath'));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_card_upload_sessions WHERE status='complete' AND expected_path IS NULL AND manifest_entry_json IS NULL AND expected_sha256 IS NULL AND expected_quick_xor_hash IS NULL").get().count, 3, 'completed upload metadata is cleared from D1');
} finally {
  globalThis.fetch = originalFetch;
}

db.close();
console.log('Scanned job-card archive schema, upload policy, indexing, search, review, content and pagination: PASS');
