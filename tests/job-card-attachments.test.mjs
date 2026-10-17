import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../cloudflare-worker/src/index.js';
import { reserveJobCardAttachmentUploadSession } from '../cloudflare-worker/src/job-card-attachments.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = resolve(root, 'cloudflare-worker/migrations/0014_job_card_attachments.sql');
assert.ok(existsSync(migrationPath), 'job-card attachment migration exists');

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(resolve(root, 'cloudflare-worker/schema.sql'), 'utf8'));
db.exec(await readFile(migrationPath, 'utf8'));
let attachmentPriorLookupRace = null;
const tableNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => name));
for (const table of ['job_card_attachments', 'job_card_attachment_upload_sessions', 'job_card_attachment_audit']) {
  assert.ok(tableNames.has(table), `migration creates ${table}`);
}

const d1 = {
  prepare(sql) {
    const statement = (args = []) => ({
      sql,
      args,
      bind(...values) { return statement(values); },
      first() {
        if (attachmentPriorLookupRace && /FROM job_card_attachments\s+WHERE record_id=\?\s+AND file_name=\?\s+AND sha256=\?/.test(sql)) {
          const race = attachmentPriorLookupRace;
          race.reads += 1;
          if (race.reads === 2) race.release();
          return race.gate.then(() => db.prepare(sql).get(...args) || null);
        }
        return db.prepare(sql).get(...args) || null;
      },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() { const result = db.prepare(sql).run(...args); return { success: true, meta: result }; }
    });
    return statement();
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

const insertRecord = (recordId, ownerOid, ownerUpn, action = 'create_request') => db.prepare(`
  INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, record_date,
    submitted_at, updated_at, issue, payload_json)
  VALUES (?, ?, ?, ?, 'job-cards', ?, 'Submitted', '2026-10-17', ?, ?, '', ?)
`).run(recordId, ownerOid, ownerUpn, ownerUpn, action, new Date().toISOString(), new Date().toISOString(), JSON.stringify({ jobReference: 'GMT-TEST-001', jobRevision: recordId.endsWith('-r2') ? 2 : 1 }));

insertRecord('job-GMT-TEST-001-r1', 'owner-oid', 'owner@gmt-services.co.uk');
insertRecord('job-GMT-TEST-001-r2', 'owner-oid', 'owner@gmt-services.co.uk');
insertRecord('job-GMT-TEST-002-r1', 'other-oid', 'other@gmt-services.co.uk');
insertRecord('job-archive-001', 'accounts-oid', 'accounts@gmt-services.co.uk', 'archive_import');

const tenant = 'job-card-attachment-test-tenant';
const audience = 'job-card-attachment-test-audience';
const signing = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', signing.publicKey);
jwk.kid = `job-card-attachment-${crypto.randomUUID()}`;
jwk.use = 'sig';
const tokenFor = async (upn, oid) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'RS256', typ: 'JWT', kid: jwk.kid });
  const body = encode({ aud: audience, tid: tenant, iss: `https://login.microsoftonline.com/${tenant}/v2.0`, exp: Math.floor(Date.now() / 1000) + 3600, oid, preferred_username: upn, name: upn });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
};
const ownerToken = await tokenFor('owner@gmt-services.co.uk', 'owner-oid');
const otherToken = await tokenFor('other@gmt-services.co.uk', 'other-oid');
const accountsToken = await tokenFor('accounts@gmt-services.co.uk', 'accounts-oid');
const routeEnv = {
  DB: d1,
  ENTRA_TENANT_ID: tenant,
  ENTRA_AUDIENCES: audience,
  ADMIN_UPNS: 'accounts@gmt-services.co.uk',
  JOB_CARD_ADMIN_UPNS: 'cards@gmt-services.co.uk',
  ALLOWED_ORIGINS: 'https://gmt-services.co.uk',
  SHAREPOINT_GRAPH_CLIENT_ID: 'attachment-test-client',
  SHAREPOINT_GRAPH_CLIENT_SECRET: 'attachment-test-secret',
  SHAREPOINT_SITE_ID: 'attachment-test-site',
  SHAREPOINT_DRIVE_ID: 'attachment-test-drive'
};
const graphFolders = new Set();
const graphFiles = new Map();
const graphSessions = [];
const graphUploadBuffers = new Map();
const graphContentUploads = [];
const graphDeletedItems = [];
let graphObjectLookups = 0;
let graphNextItemOverride = null;
let graphSessionCount = 0;
let graphDeleteFailureCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const address = String(url);
  if (address.includes('/discovery/v2.0/keys')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (address.includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'attachment-test-graph-token' }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (address.includes('graph.microsoft.com') && init.method === 'POST' && /\/root(?:[^?]*)\/children$/.test(address)) {
    const parentPath = address.includes('/root:/') ? decodeURIComponent(address.split('/root:/')[1].split(':/children')[0]) : '';
    const folderName = JSON.parse(init.body || '{}').name;
    const path = parentPath ? `${parentPath}/${folderName}` : folderName;
    graphFolders.add(path);
    return new Response(JSON.stringify({ id: `private-folder-${graphFolders.size}`, name: folderName, folder: {} }), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (address.includes('graph.microsoft.com') && init.method === 'DELETE' && address.includes('/items/')) {
    const id = decodeURIComponent(address.split('/items/')[1].split(/[/?]/)[0]);
    if (graphDeleteFailureCount > 0) {
      graphDeleteFailureCount -= 1;
      return new Response('', { status: 503 });
    }
    graphDeletedItems.push(id);
    for (const [path, file] of graphFiles) if (file.item.id === id) graphFiles.delete(path);
    return new Response(null, { status: 204 });
  }
  if (address.includes('graph.microsoft.com') && address.includes(':/createUploadSession')) {
    const path = decodeURIComponent(address.split('/root:/')[1].split(':/createUploadSession')[0]);
    graphSessionCount += 1;
    graphSessions.push({ path, body: JSON.parse(init.body || '{}') });
    return new Response(JSON.stringify({ uploadUrl: `https://upload.example.test/attachment-${graphSessionCount}`, expirationDateTime: new Date(Date.now() + 3600_000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (address.includes('upload.example.test') && init.method === 'PUT') {
    const sessionIndex = Number(address.split('attachment-').at(-1)) - 1;
    const session = graphSessions[sessionIndex];
    const range = String(init.headers?.['Content-Range'] || init.headers?.['content-range'] || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!session || !range) return new Response('', { status: 400 });
    const start = Number(range[1]);
    const end = Number(range[2]) + 1;
    const total = Number(range[3]);
    const chunk = init.body instanceof Uint8Array || Buffer.isBuffer(init.body)
      ? Buffer.from(init.body)
      : Buffer.from(await new Response(init.body).arrayBuffer());
    let uploaded = graphUploadBuffers.get(address);
    if (!uploaded) uploaded = Buffer.alloc(total);
    chunk.copy(uploaded, start);
    graphUploadBuffers.set(address, uploaded);
    if (end < total) return new Response(JSON.stringify({ nextExpectedRanges: [`${end}-`] }), { status: 202, headers: { 'content-type': 'application/json' } });
    graphUploadBuffers.delete(address);
    graphContentUploads.push({ path: session.path, size: total });
    const override = graphNextItemOverride;
    graphNextItemOverride = null;
    const item = {
      id: `private-item-${crypto.randomUUID()}`,
      name: session.path.split('/').at(-1),
      size: override?.size ?? total,
      file: { hashes: { quickXorHash: override?.quickXorHash ?? quickXorHash } }
    };
    graphFiles.set(session.path, { item, content: uploaded, contentType: fileMetadata.contentType });
    return new Response(JSON.stringify(item), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (address.includes('upload.example.test') && init.method === 'DELETE') {
    graphUploadBuffers.delete(address);
    return new Response(null, { status: 204 });
  }
  if (address.includes('graph.microsoft.com') && address.includes('/items/') && address.endsWith('/content')) {
    const id = decodeURIComponent(address.split('/items/')[1].split('/content')[0]);
    const file = [...graphFiles.values()].find((entry) => entry.item.id === id);
    return file
      ? new Response(file.content, { status: 200, headers: { 'content-type': file.contentType } })
      : new Response('', { status: 404 });
  }
  if (address.includes('graph.microsoft.com') && address.includes('/root:/')) {
    const path = decodeURIComponent(address.split('/root:/')[1].split(':/')[0]);
    if (graphFolders.has(path)) return new Response(JSON.stringify({ id: `private-folder-${path}`, name: path.split('/').at(-1), folder: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    graphObjectLookups += 1;
    const file = graphFiles.get(path);
    return file
      ? new Response(JSON.stringify(file.item), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  return new Response('', { status: 404 });
};

const api = 'https://gmt-portal-api.example.workers.dev';
const call = async (path, token, { method = 'GET', body, rawBody, headers = {} } = {}) => worker.fetch(new Request(`${api}${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  ...(rawBody !== undefined ? { body: rawBody } : body ? { body: JSON.stringify(body) } : {})
}), routeEnv, {});

const quickXorHash = Buffer.alloc(20, 4).toString('base64');
const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sXcAAAAASUVORK5CYII=', 'base64');
const photoSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', photoBytes)).toString('hex');
const fileMetadata = { fileName: 'motor-room.png', contentType: 'image/png', sizeBytes: photoBytes.length, sha256: photoSha256, quickXorHash };
try {
  const anonymous = await call('/api/records/job-GMT-TEST-001-r1/attachments', '', { method: 'GET' });
  assert.equal(anonymous.status, 401, 'attachment listing requires authentication');

  const invalidType = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: { ...fileMetadata, fileName: 'unsafe.txt', contentType: 'text/plain' } });
  assert.equal(invalidType.status, 400, 'unsupported attachments are rejected before Graph access');
  const unsafeName = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: { ...fileMetadata, fileName: '../motor-room.png' } });
  assert.equal(unsafeName.status, 400, 'path traversal filenames are rejected');
  const oversized = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: { ...fileMetadata, sizeBytes: 20 * 1024 * 1024 + 1 } });
  assert.equal(oversized.status, 413, 'oversized files are rejected');

  const denied = await call('/api/records/job-GMT-TEST-001-r1/attachments', otherToken, { method: 'POST', body: fileMetadata });
  assert.equal(denied.status, 403, 'an employee cannot upload to another employee record');
  assert.equal(graphSessionCount, 0, 'validation and role denials happen before Graph upload-session creation');

  const created = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: fileMetadata });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.deepEqual(Object.keys(createdBody).sort(), ['attachmentId', 'expirationDateTime'].sort());
  const session = db.prepare('SELECT * FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(createdBody.attachmentId);
  assert.match(session.expected_path, /^JobCards\/Attachments\/job-GMT-TEST-001-r1\//, 'SharePoint path is server-derived and revision-specific');

  const concurrentDuplicateStart = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: fileMetadata });
  assert.equal(concurrentDuplicateStart.status, 201, 'an exact upload racing an unfinished request gets its own bounded reservation');
  const concurrentDuplicateBody = await concurrentDuplicateStart.json();
  const concurrentDuplicateSession = db.prepare('SELECT * FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(concurrentDuplicateBody.attachmentId);

  const lookupsBeforeActiveComplete = graphObjectLookups;
  const activeComplete = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${createdBody.attachmentId}/complete`, ownerToken, { method: 'POST' });
  assert.equal(activeComplete.status, 409, 'active sessions can only be completed by the actual-byte Worker upload route');
  assert.equal(graphObjectLookups, lookupsBeforeActiveComplete, 'active completion does not index pre-existing SharePoint objects');
  assert.equal(db.prepare('SELECT status FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(createdBody.attachmentId).status, 'uploading');

  const preseededBytes = Buffer.from('different-sharepoint-content');
  const preseededItem = {
    id: 'private-item-preseeded',
    name: `${createdBody.attachmentId}-${fileMetadata.fileName}`,
    size: fileMetadata.sizeBytes,
    file: { hashes: { quickXorHash } }
  };
  graphFiles.set(session.expected_path, { item: preseededItem, content: preseededBytes, contentType: fileMetadata.contentType });
  const uploadsBeforePreseededPath = graphContentUploads.length;

  const uploaded = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${createdBody.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': fileMetadata.contentType, 'content-length': String(fileMetadata.sizeBytes) }
  });
  assert.equal(uploaded.status, 200, 'Worker accepts a file only after checking its actual bytes');
  assert.ok(graphDeletedItems.includes(preseededItem.id), 'a pre-existing provider object is removed rather than trusted by its metadata');
  assert.equal(graphContentUploads.length, uploadsBeforePreseededPath + 1, 'the validated request body is uploaded through a fresh Graph session');
  assert.equal(graphFiles.get(session.expected_path).content.toString(), photoBytes.toString(), 'the stored provider bytes match the SHA-256 validated request bytes');
  const completedBody = await uploaded.json();
  assert.equal(completedBody.attachment.file_name, fileMetadata.fileName);

  const duplicateDeletesBefore = graphDeletedItems.length;
  graphDeleteFailureCount = 1;
  const raceDuplicateUpload = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${concurrentDuplicateBody.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': fileMetadata.contentType, 'content-length': String(fileMetadata.sizeBytes) }
  });
  assert.equal(raceDuplicateUpload.status, 503, 'a duplicate whose orphan cleanup fails is not reported as settled');
  assert.equal(db.prepare('SELECT status FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(concurrentDuplicateBody.attachmentId).status, 'duplicate');
  assert.ok(db.prepare('SELECT orphan_item_id FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(concurrentDuplicateBody.attachmentId).orphan_item_id, 'failed cleanup keeps the provider pointer for retry');
  assert.equal(graphFiles.has(concurrentDuplicateSession.expected_path), true, 'failed cleanup leaves the provider object tracked for recovery');
  const retryDuplicate = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: fileMetadata });
  assert.equal(retryDuplicate.status, 200, 'an exact completed retry resumes duplicate object cleanup');
  assert.equal((await retryDuplicate.json()).attachment.attachment_id, createdBody.attachmentId);
  assert.equal(graphDeletedItems.length, duplicateDeletesBefore + 1, 'a raced duplicate removes its unindexed SharePoint object');
  assert.equal(graphFiles.has(concurrentDuplicateSession.expected_path), false, 'duplicate provider bytes do not remain outside the protected attachment index');
  assert.equal(db.prepare('SELECT orphan_item_id FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(concurrentDuplicateBody.attachmentId).orphan_item_id, null, 'successful cleanup clears the retry pointer');

  const racingRecordId = 'job-card-attachment-completion-race';
  insertRecord(racingRecordId, 'owner-oid', 'owner@gmt-services.co.uk');
  const racingMetadata = { ...fileMetadata, fileName: 'racing.png' };
  const racingStarts = await Promise.all(Array.from({ length: 2 }, () => call(`/api/records/${racingRecordId}/attachments`, ownerToken, { method: 'POST', body: racingMetadata })));
  assert.deepEqual(racingStarts.map((response) => response.status), [201, 201], 'both concurrent requests reserve their own upload session before either completes');
  const racingBodies = await Promise.all(racingStarts.map((response) => response.json()));
  const racingSessions = racingBodies.map(({ attachmentId }) => db.prepare('SELECT * FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(attachmentId));
  let releasePriorReads;
  attachmentPriorLookupRace = {
    reads: 0,
    gate: new Promise((resolve) => { releasePriorReads = resolve; }),
    release: () => releasePriorReads()
  };
  const racingUploads = await Promise.all(racingBodies.map(({ attachmentId }) => call(`/api/records/${racingRecordId}/attachments/${attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': racingMetadata.contentType, 'content-length': String(racingMetadata.sizeBytes) }
  })));
  attachmentPriorLookupRace = null;
  assert.deepEqual(racingUploads.map((response) => response.status).sort(), [200, 200], 'both competing exact uploads settle successfully');
  const racingResults = await Promise.all(racingUploads.map((response) => response.json()));
  assert.equal(racingResults.filter((result) => result.duplicate).length, 1, 'one concurrent exact upload is indexed and one resolves as a duplicate');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_card_attachments WHERE record_id=? AND file_name=?').get(racingRecordId, racingMetadata.fileName).count, 1, 'the unique attachment index is preserved under concurrent completion');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_card_attachment_upload_sessions WHERE record_id=? AND status='duplicate' AND orphan_item_id IS NOT NULL").get(racingRecordId).count, 0, 'concurrent duplicate objects are deleted before either upload is reported settled');
  assert.equal(racingSessions.filter((item) => graphFiles.has(item.expected_path)).length, 1, 'only the indexed provider object remains');

  const collisionMetadata = { ...fileMetadata, fileName: 'folder-collision.png' };
  const collisionStart = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: collisionMetadata });
  const collisionStartBody = await collisionStart.json();
  const collisionSession = db.prepare('SELECT * FROM job_card_attachment_upload_sessions WHERE attachment_id=?').get(collisionStartBody.attachmentId);
  const unexpectedFolderId = `private-folder-${collisionSession.expected_path}`;
  graphFolders.add(collisionSession.expected_path);
  const graphSessionsBeforeCollision = graphSessionCount;
  const deletesBeforeCollision = graphDeletedItems.length;
  const folderCollision = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${collisionStartBody.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': collisionMetadata.contentType, 'content-length': String(collisionMetadata.sizeBytes) }
  });
  assert.equal(folderCollision.status, 409, 'an unexpected folder at the file path is rejected');
  assert.equal(graphSessionCount, graphSessionsBeforeCollision, 'a path collision is rejected before creating a Graph upload session');
  assert.equal(graphDeletedItems.length, deletesBeforeCollision, 'an unexpected folder is not deleted as if it were a stale file');
  assert.ok(!graphDeletedItems.includes(unexpectedFolderId));

  const completed = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${createdBody.attachmentId}/complete`, ownerToken, { method: 'POST' });
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).attachment.file_name, fileMetadata.fileName);
  assert.ok(!JSON.stringify(completedBody).includes('private-item-'));
  assert.ok(!JSON.stringify(completedBody).includes('JobCards/Attachments/'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_card_attachment_audit WHERE attachment_id=? AND action=?').get(createdBody.attachmentId, 'uploaded').count, 1);

  const repeatedComplete = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${createdBody.attachmentId}/complete`, ownerToken, { method: 'POST' });
  assert.equal(repeatedComplete.status, 200, 'repeating completion returns the same attachment');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_card_attachment_audit WHERE attachment_id=? AND action=?').get(createdBody.attachmentId, 'uploaded').count, 1, 'repeated completion does not duplicate its audit event');

  const sharedList = await call('/api/records/job-GMT-TEST-001-r1/attachments', otherToken);
  assert.equal(sharedList.status, 200, 'signed-in staff can read attachments through shared job-card history');
  const listBody = await sharedList.json();
  assert.equal(listBody.attachments.length, 1);
  assert.equal(listBody.attachments[0].file_name, fileMetadata.fileName);
  assert.ok(!JSON.stringify(listBody).includes('private-item-'));
  assert.ok(!JSON.stringify(listBody).includes('sharepoint_path'));
  const otherRevisionList = await call('/api/records/job-GMT-TEST-001-r2/attachments', otherToken);
  assert.equal((await otherRevisionList.json()).attachments.length, 0, 'another revision with the same job reference does not inherit files');

  const content = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${createdBody.attachmentId}/content`, otherToken);
  assert.equal(content.status, 200, 'shared job-card readers can download protected attachments');
  assert.equal(content.headers.get('content-type'), fileMetadata.contentType);
  assert.equal(await content.text(), photoBytes.toString());
  assert.ok(!content.headers.get('content-disposition')?.includes('private-item-'));

  const uploadsBeforeExactRetry = graphContentUploads.length;
  const duplicate = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: fileMetadata });
  assert.equal(duplicate.status, 200, 'retrying an exact completed file does not upload a duplicate');
  assert.equal((await duplicate.json()).attachment.attachment_id, createdBody.attachmentId);
  assert.equal(graphContentUploads.length, uploadsBeforeExactRetry, 'exact completed retries do not upload another copy');

  const adminCreated = await call('/api/records/job-GMT-TEST-002-r1/attachments', accountsToken, { method: 'POST', body: { ...fileMetadata, fileName: 'accounts-review.pdf', contentType: 'application/pdf', sha256: 'b'.repeat(64) } });
  assert.equal(adminCreated.status, 201, 'authorized Accounts identity can add an attachment to a shared job card');

  const archiveUpload = await call('/api/records/job-archive-001/attachments', accountsToken, { method: 'POST', body: fileMetadata });
  assert.equal(archiveUpload.status, 409, 'scanned archive rows remain managed by the Accounts review flow');

  const expireMetadata = { ...fileMetadata, fileName: 'late-upload.pdf', contentType: 'application/pdf', sha256: 'c'.repeat(64) };
  const expiring = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: expireMetadata });
  assert.equal(expiring.status, 201);
  const expiringBody = await expiring.json();
  db.prepare('UPDATE job_card_attachment_upload_sessions SET expires_at=? WHERE attachment_id=?').run('2000-01-01T00:00:00.000Z', expiringBody.attachmentId);
  const expired = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${expiringBody.attachmentId}/complete`, ownerToken, { method: 'POST' });
  assert.equal(expired.status, 410, 'expired uploads are not completed');
  const expiredList = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken);
  assert.ok(!(await expiredList.json()).attachments.some((item) => item.file_name === expireMetadata.fileName));

  const badSizeMetadata = { ...fileMetadata, fileName: 'wrong-size.png' };
  const badSizeSession = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: badSizeMetadata });
  const badSizeBody = await badSizeSession.json();
  graphNextItemOverride = { size: badSizeMetadata.sizeBytes + 1 };
  const wrongSize = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${badSizeBody.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': badSizeMetadata.contentType, 'content-length': String(badSizeMetadata.sizeBytes) }
  });
  assert.equal(wrongSize.status, 409, 'a Graph size mismatch blocks attachment visibility');
  assert.ok(graphDeletedItems.length >= 1, 'a Graph size mismatch deletes the stored file');

  const badHashMetadata = { ...fileMetadata, fileName: 'wrong-hash.png' };
  const badHashSession = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'POST', body: badHashMetadata });
  const badHashBody = await badHashSession.json();
  graphNextItemOverride = { quickXorHash: Buffer.alloc(20, 9).toString('base64') };
  const wrongHash = await call(`/api/records/job-GMT-TEST-001-r1/attachments/${badHashBody.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': badHashMetadata.contentType, 'content-length': String(badHashMetadata.sizeBytes) }
  });
  assert.equal(wrongHash.status, 409, 'a Graph QuickXorHash mismatch blocks attachment visibility');
  assert.ok(graphDeletedItems.length >= 2, 'a Graph hash mismatch deletes the stored file');

  const jobCardAdminToken = await tokenFor('cards@gmt-services.co.uk', 'cards-oid');
  const cappedRecordId = 'job-card-attachment-cap';
  insertRecord(cappedRecordId, 'owner-oid', 'owner@gmt-services.co.uk');
  for (let index = 1; index <= 10; index += 1) {
    const attachmentId = `attachment-${index}`;
    db.prepare(`INSERT INTO job_card_attachment_upload_sessions
      (attachment_id, record_id, file_name, content_type, size_bytes, sha256, quick_xor_hash,
       expected_path, expires_at, actor_oid, actor_upn, status, completed_at)
      VALUES (?, ?, ?, 'image/png', 1, ?, ?, NULL, ?, 'owner-oid', 'owner@gmt-services.co.uk', 'complete', ?)`)
      .run(attachmentId, cappedRecordId, `file-${index}.png`, `${String(index).repeat(64)}`.slice(0, 64), quickXorHash, new Date(Date.now() + 3600_000).toISOString(), new Date().toISOString());
    db.prepare(`INSERT INTO job_card_attachments
      (attachment_id, record_id, file_name, content_type, size_bytes, sha256, quick_xor_hash, sharepoint_item_id, sharepoint_path, uploaded_by_oid, uploaded_by_upn, uploaded_at)
      VALUES (?, ?, ?, 'image/png', 1, ?, ?, ?, ?, 'owner-oid', 'owner@gmt-services.co.uk', ?)`)
      .run(attachmentId, cappedRecordId, `file-${index}.png`, `${String(index).repeat(64)}`.slice(0, 64), quickXorHash, `private-${index}`, `JobCards/Attachments/${cappedRecordId}/file-${index}.png`, new Date().toISOString());
  }
  const uploadsBeforeOverCount = graphContentUploads.length;
  const overCount = await call(`/api/records/${cappedRecordId}/attachments`, jobCardAdminToken, { method: 'POST', body: { ...fileMetadata, fileName: 'eleventh.png', sha256: 'f'.repeat(64) } });
  assert.equal(overCount.status, 413, 'the per-revision attachment count is bounded');
  assert.equal(graphContentUploads.length, uploadsBeforeOverCount, 'the count limit is checked before Graph content upload');

  const deletedRecord = await call('/api/records/job-GMT-TEST-001-r1/attachments', ownerToken, { method: 'GET' });
  assert.equal(deletedRecord.status, 200);
  const mismatchRows = db.prepare("SELECT COUNT(*) AS count FROM job_card_attachments WHERE file_name IN ('wrong-size.png', 'wrong-hash.png')").get().count;
  assert.equal(mismatchRows, 0, 'mismatched files never become listable attachment rows');

  const raceRecordId = 'job-card-attachment-concurrent-cap';
  insertRecord(raceRecordId, 'owner-oid', 'owner@gmt-services.co.uk');
  const simultaneousStarts = await Promise.all(Array.from({ length: 12 }, (_, index) => call(
    `/api/records/${raceRecordId}/attachments`,
    ownerToken,
    {
      method: 'POST',
      body: {
        ...fileMetadata,
        fileName: `parallel-${index}.png`,
        sizeBytes: 10 * 1024 * 1024,
        sha256: String(index + 1).repeat(64).slice(0, 64)
      }
    }
  )));
  assert.equal(simultaneousStarts.filter((response) => response.status === 201).length, 10, 'concurrent starts reserve at most 10 files');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_card_attachment_upload_sessions WHERE record_id=? AND status='uploading'").get(raceRecordId).count, 10, 'concurrent reservations stay within the 100 MiB revision quota');

  const atomicRecordId = 'job-card-attachment-atomic-cap';
  insertRecord(atomicRecordId, 'owner-oid', 'owner@gmt-services.co.uk');
  const reservations = await Promise.all(Array.from({ length: 12 }, (_, index) => {
    const attachmentId = crypto.randomUUID();
    const metadata = {
      ...fileMetadata,
      fileName: `atomic-${index}.png`,
      sizeBytes: 10 * 1024 * 1024,
      sha256: String(index + 1).repeat(64).slice(0, 64)
    };
    return reserveJobCardAttachmentUploadSession({ DB: d1 }, {
      attachmentId,
      recordId: atomicRecordId,
      metadata,
      expectedPath: `JobCards/Attachments/${atomicRecordId}/${attachmentId}-${metadata.fileName}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      actor: { oid: 'owner-oid', upn: 'owner@gmt-services.co.uk' }
    });
  }));
  assert.equal(reservations.filter(Boolean).length, 10, 'atomic D1 reservations reject concurrent requests after the revision quota is full');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_card_attachment_upload_sessions WHERE record_id=? AND status='uploading'").get(atomicRecordId).count, 10, 'atomic reservations do not persist over-quota rows');

  const boundedRecordId = 'job-card-attachment-bounded-upload';
  insertRecord(boundedRecordId, 'owner-oid', 'owner@gmt-services.co.uk');
  const boundedMetadata = {
    ...fileMetadata,
    fileName: 'bounded-photo.png',
    sha256: Buffer.from(await crypto.subtle.digest('SHA-256', photoBytes)).toString('hex')
  };
  const boundedStart = await call(`/api/records/${boundedRecordId}/attachments`, ownerToken, { method: 'POST', body: boundedMetadata });
  assert.equal(boundedStart.status, 201);
  const boundedSession = await boundedStart.json();
  assert.equal(Object.hasOwn(boundedSession, 'uploadUrl'), false, 'the browser does not receive a direct SharePoint upload capability');
  const uploadsBeforeOversizedBody = graphContentUploads.length;
  const oversizedBody = Buffer.concat([photoBytes, Buffer.from('!')]);
  const oversizedBodyResponse = await call(`/api/records/${boundedRecordId}/attachments/${boundedSession.attachmentId}/content`, ownerToken, {
    method: 'PUT',
    rawBody: oversizedBody,
    headers: { 'content-type': boundedMetadata.contentType, 'content-length': String(boundedMetadata.sizeBytes) }
  });
  assert.equal(oversizedBodyResponse.status, 413, 'actual bytes above the reserved size are rejected');
  assert.equal(graphContentUploads.length, uploadsBeforeOversizedBody, 'oversized bytes are rejected before Graph storage');

  const boundedUpload = await call(`/api/records/${boundedRecordId}/attachments/${boundedSession.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': boundedMetadata.contentType, 'content-length': String(boundedMetadata.sizeBytes) }
  });
  assert.equal(boundedUpload.status, 200, 'a size-checked file is uploaded and completed by the Worker');
  assert.equal((await boundedUpload.json()).attachment.file_name, boundedMetadata.fileName);
  assert.equal(graphContentUploads.at(-1).size, photoBytes.length);

  const invalidImageRecordId = 'job-card-attachment-invalid-signature';
  insertRecord(invalidImageRecordId, 'owner-oid', 'owner@gmt-services.co.uk');
  const invalidImageBytes = Buffer.from('this content is not a PNG');
  const invalidImageMetadata = {
    ...boundedMetadata,
    fileName: 'mislabelled.png',
    sizeBytes: invalidImageBytes.length,
    sha256: Buffer.from(await crypto.subtle.digest('SHA-256', invalidImageBytes)).toString('hex')
  };
  const invalidImageStart = await call(`/api/records/${invalidImageRecordId}/attachments`, ownerToken, { method: 'POST', body: invalidImageMetadata });
  assert.equal(invalidImageStart.status, 201);
  const invalidImageSession = await invalidImageStart.json();
  const uploadsBeforeInvalidSignature = graphContentUploads.length;
  const sessionsBeforeInvalidSignature = graphSessionCount;
  const invalidImageUpload = await call(`/api/records/${invalidImageRecordId}/attachments/${invalidImageSession.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: invalidImageBytes,
    headers: { 'content-type': invalidImageMetadata.contentType, 'content-length': String(invalidImageMetadata.sizeBytes) }
  });
  assert.equal(invalidImageUpload.status, 415, 'bytes without the declared image signature are rejected');
  assert.equal(graphContentUploads.length, uploadsBeforeInvalidSignature, 'invalid file signatures are rejected before Graph upload');
  assert.equal(graphSessionCount, sessionsBeforeInvalidSignature, 'invalid file signatures do not create Graph upload sessions');

  const mismatchMetadata = { ...boundedMetadata, fileName: 'provider-mismatch.png', sha256: '1'.repeat(64) };
  const mismatchStart = await call(`/api/records/${boundedRecordId}/attachments`, ownerToken, { method: 'POST', body: mismatchMetadata });
  const mismatchSession = await mismatchStart.json();
  graphNextItemOverride = { size: photoBytes.length + 1 };
  const mismatchUpload = await call(`/api/records/${boundedRecordId}/attachments/${mismatchSession.attachmentId}/content`, ownerToken, {
    method: 'PUT', rawBody: photoBytes,
    headers: { 'content-type': mismatchMetadata.contentType, 'content-length': String(mismatchMetadata.sizeBytes) }
  });
  assert.equal(mismatchUpload.status, 409, 'provider metadata mismatches fail closed');
  assert.ok(graphDeletedItems.length > 0, 'provider objects that fail completion verification are deleted');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_card_attachments WHERE file_name=?').get(mismatchMetadata.fileName).count, 0, 'mismatched provider objects never become attachment rows');
} finally {
  globalThis.fetch = originalFetch;
  db.close();
}

console.log('Protected job-card attachments, bounded Worker uploads, shared reads, role checks and revision isolation: PASS');
