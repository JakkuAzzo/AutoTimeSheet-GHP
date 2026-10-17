import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const baseAttachments = new Map([
  ['job-shared-reference-r1', [{ attachment_id: 'fixture-r1-photo', file_name: 'revision-one.png', content_type: 'image/png', size_bytes: pngBytes.length, uploaded_at: '2026-10-17T09:00:00.000Z' }]],
  ['job-shared-reference-r2', [{ attachment_id: 'fixture-r2-pdf', file_name: 'revision-two.pdf', content_type: 'application/pdf', size_bytes: pdfBytes.length, uploaded_at: '2026-10-17T09:05:00.000Z' }]]
]);
const jobRecords = new Map();
const uploadSessions = new Map();
const events = [];
let sessionSequence = 0;
let failedOneUpload = true;
const uploadRequests = [];

function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request);
  return body.length ? JSON.parse(body.toString('utf8')) : {};
}

function historyRecord(recordId, reference, revision) {
  return {
    source_record_id: recordId, job_ref: reference, client: 'Fixture Client', site: 'Fixture Site',
    engineer: 'Fixture Engineer', planned_date: '2026-10-17', description: `Revision ${revision}`,
    card_type: 'EC', status: 'Received', job_status: 'Received', job_revision: revision,
    record_date: '2026-10-17', action: 'create_request', employee_name: 'Fixture Engineer', employee_upn: 'fixture@gmt-services.co.uk'
  };
}

function allHistoryRecords() {
  return [historyRecord('job-shared-reference-r1', 'GMT-SHARED', 1), historyRecord('job-shared-reference-r2', 'GMT-SHARED', 2), ...jobRecords.values()];
}

const server = createServer(async (request, response) => {
  const address = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname = address.pathname;
  try {
    if (pathname === '/config.js') {
      const source = await (await import('node:fs/promises')).readFile(join(repoRoot, 'config.js'), 'utf8');
      const config = source
        .replace(/portalApiEndpoint:\s*"[^"]*"/, `portalApiEndpoint: "http://127.0.0.1:${server.address().port}"`)
        .replace(/portalApiScopes:\s*\[[^\]]*\]/, 'portalApiScopes: []')
        .replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false');
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(config);
      return;
    }
    if (pathname === '/__form-submit' && request.method === 'POST') {
      const body = await readJson(request);
      events.push({ type: 'form-submit', completeCount: Number(body.completeCount) || 0 });
      json(response, { ok: true }, 201);
      return;
    }
    if (pathname === '/api/history' && request.method === 'GET') {
      json(response, { records: allHistoryRecords(), meta: { is_admin: false, is_job_card_admin: false } });
      return;
    }
    if (pathname === '/api/job-cards/archive/access' && request.method === 'GET') { json(response, { canImport: false }); return; }
    if (pathname === '/api/job-cards/archive/search' && request.method === 'GET') { json(response, { records: [], nextCursor: null }); return; }
    if (pathname.startsWith('/api/records/') && pathname.endsWith('/invoices') && request.method === 'GET') { json(response, { invoices: [], links: [] }); return; }
    if (pathname === '/api/records' && request.method === 'POST') {
      const record = await readJson(request);
      jobRecords.set(record.recordId, historyRecord(record.recordId, record.payload?.jobReference || 'Untitled job', record.payload?.jobRevision || 1));
      events.push({ type: 'record-save', recordId: record.recordId });
      json(response, { ok: true, record_id: record.recordId, created: true }, 201);
      return;
    }
    const recordUpdate = pathname.match(/^\/api\/records\/([^/]+)$/);
    if (recordUpdate && request.method === 'PATCH') { json(response, { ok: true, record_id: decodeURIComponent(recordUpdate[1]) }); return; }
    const listAttachments = pathname.match(/^\/api\/records\/([^/]+)\/attachments$/);
    if (listAttachments && request.method === 'GET') {
      const recordId = decodeURIComponent(listAttachments[1]);
      json(response, { attachments: [...(baseAttachments.get(recordId) || []), ...[...uploadSessions.values()].filter((session) => session.completed && session.recordId === recordId).map((session) => session.attachment)] });
      return;
    }
    if (listAttachments && request.method === 'POST') {
      const recordId = decodeURIComponent(listAttachments[1]);
      const metadata = await readJson(request);
      const attachmentId = `fixture-upload-${++sessionSequence}`;
      const session = { recordId, attachmentId, metadata, completed: false };
      uploadSessions.set(attachmentId, session);
      events.push({ type: 'session', attachmentId });
      json(response, { attachmentId, expirationDateTime: new Date(Date.now() + 30 * 60_000).toISOString() }, 201);
      return;
    }
    const contentUpload = pathname.match(/^\/api\/records\/([^/]+)\/attachments\/([^/]+)\/content$/);
    if (contentUpload && request.method === 'PUT') {
      const recordId = decodeURIComponent(contentUpload[1]);
      const attachmentId = decodeURIComponent(contentUpload[2]);
      const session = uploadSessions.get(attachmentId);
      if (!session || session.recordId !== recordId) { json(response, { error: 'Unknown test upload' }, 404); return; }
      const bytes = await readBody(request);
      uploadRequests.push({ url: pathname, bytes: bytes.length, contentType: request.headers['content-type'] || '' });
      if (bytes.length !== session.metadata.sizeBytes) { json(response, { error: 'wrong file size' }, 413); return; }
      if (failedOneUpload) {
        failedOneUpload = false;
        events.push({ type: 'upload-failed', attachmentId });
        json(response, { error: 'Synthetic Worker upload interruption' }, 503);
        return;
      }
      session.completed = true;
      session.attachment = {
        attachment_id: attachmentId, file_name: session.metadata.fileName,
        content_type: session.metadata.contentType, size_bytes: session.metadata.sizeBytes,
        uploaded_at: new Date().toISOString()
      };
      events.push({ type: 'upload-complete', attachmentId });
      json(response, { ok: true, attachment: session.attachment, duplicate: false });
      return;
    }
    const content = pathname.match(/^\/api\/records\/([^/]+)\/attachments\/([^/]+)\/content$/);
    if (content && request.method === 'GET') {
      const body = content[2] === 'fixture-r2-pdf' ? pdfBytes : pngBytes;
      response.writeHead(200, { 'content-type': content[2] === 'fixture-r2-pdf' ? 'application/pdf' : 'image/png', 'cache-control': 'no-store' });
      response.end(body);
      return;
    }

    const rawPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const filePath = normalize(join(repoRoot, rawPath.replace(/^\//, '')));
    if (!filePath.startsWith(`${repoRoot}/`) || !existsSync(filePath) || !statSync(filePath).isFile()) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    json(response, { error: error.message || 'test server error' }, 500);
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 980 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Fixture Engineer', username: 'fixture@gmt-services.co.uk' })); });
  await page.goto(`http://127.0.0.1:${server.address().port}/jobs/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#job-card-list [data-job-select]').length >= 2, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('[data-job-card-attachments]')?.innerText.includes('revision-one.png'), null, { timeout: 5000 });
  assert.doesNotMatch(await page.locator('[data-job-card-attachments]').innerText(), /revision-two\.pdf/, 'revision one does not inherit revision two attachments');
  await page.locator('[data-job-select="job-shared-reference-r2"]').click();
  await page.waitForFunction(() => document.querySelector('[data-job-card-attachments]')?.innerText.includes('revision-two.pdf'), null, { timeout: 5000 });
  assert.doesNotMatch(await page.locator('[data-job-card-attachments]').innerText(), /revision-one\.png/, 'revision two does not inherit revision one attachments');
  await page.locator('[data-job-select="job-shared-reference-r1"]').click();
  await page.locator('[data-job-attachment-open="fixture-r1-photo"]').click();
  await page.locator('[data-job-attachment-preview] img').waitFor({ state: 'attached', timeout: 5000 });
  assert.match(await page.locator('[data-job-attachment-preview] a').getAttribute('href'), /^blob:/, 'history opens protected content through an authenticated Blob URL');

  await page.evaluate(() => {
    window.__submittedForms = [];
    window.__attachmentUploadCount = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input.url;
      const response = await originalFetch(input, init);
      if (String(url).includes('/attachments/') && String(url).endsWith('/content') && response.ok) window.__attachmentUploadCount += 1;
      return response;
    };
    HTMLFormElement.prototype.submit = function submitStub() {
      const files = [...this.querySelectorAll('input[type="file"]')].flatMap((input) => [...input.files].map((file) => file.name));
      window.__submittedForms.push({ files, completeCount: window.__attachmentUploadCount });
      fetch('/__form-submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completeCount: window.__attachmentUploadCount }) });
    };
  });
  await page.locator('#job-ref').fill('GMT-INVALID-NAME');
  await page.locator('#job-client').fill('Synthetic Invalid Filename Client');
  await page.locator('#job-site').fill('Test Site');
  await page.locator('#job-description').fill('This submission must be rejected before the protected record is saved.');
  await page.locator('#job-image').setInputFiles([{ name: 'inspection:photo.png', mimeType: 'image/png', buffer: pngBytes }]);
  await page.locator('#job-card-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-attachment-status')?.textContent.trim(), null, { timeout: 5000 });
  assert.match(await page.locator('#job-attachment-status').innerText(), /SharePoint/i, 'unsupported filename is explained before saving the record');
  assert.equal(events.filter((event) => event.type === 'record-save').length, 0, 'a forbidden filename cannot create a protected record');
  assert.equal(events.filter((event) => event.type === 'session').length, 0, 'a forbidden filename cannot reserve upload quota');
  assert.equal(events.filter((event) => event.type === 'form-submit').length, 0, 'a forbidden filename cannot submit a notification');
  await page.locator('#job-card-form').evaluate((form) => form.reset());
  await page.locator('#job-attachment-status').evaluate((status) => { status.textContent = ''; });
  await page.locator('#job-ref').fill('GMT-ATTACH-001');
  await page.locator('#job-client').fill('Synthetic Attachment Client');
  await page.locator('#job-site').fill('Test Site');
  await page.locator('#job-description').fill('Synthetic attachment UI fixture.');
  await page.locator('#job-image').setInputFiles([
    { name: 'completion.png', mimeType: 'application/octet-stream', buffer: pngBytes },
    { name: 'site-report.pdf', mimeType: 'application/pdf', buffer: pdfBytes }
  ]);
  await page.locator('#job-card-form button[type="submit"]').click();
  await page.getByRole('button', { name: 'Retry saved job card' }).waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(events.filter((event) => event.type === 'record-save').length, 1, 'a failed file completion leaves one saved protected record');
  assert.equal(events.filter((event) => event.type === 'form-submit').length, 0, 'notification waits until attachment completion');
  assert.equal(await page.locator('#job-ref').isDisabled(), true, 'the saved form is locked to the same revision during retry');
  await page.locator('#job-card-form button[type="submit"]').click();
  await page.waitForFunction(() => window.__submittedForms.length === 1, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#job-card-list [data-job-select]').length >= 3, null, { timeout: 5000 });
  assert.equal(events.filter((event) => event.type === 'record-save').length, 1, 'retry reuses the original record ID');
  assert.equal(events.filter((event) => event.type === 'upload-complete').length, 2, 'both selected attachments upload before notification');
  assert.equal(events.filter((event) => event.type === 'form-submit').at(-1).completeCount, 2, 'the existing notification route runs after the protected uploads complete');
  assert.equal(uploadSessions.size, 2);
  assert.deepEqual([...uploadSessions.values()].map((session) => session.metadata.fileName), ['completion.png', 'site-report.pdf']);
  assert.ok([...uploadSessions.values()].every((session) => /^[a-f0-9]{64}$/.test(session.metadata.sha256) && /^[A-Za-z0-9+/]{27}=$/.test(session.metadata.quickXorHash)), 'browser sends SHA-256 and QuickXorHash metadata');
  assert.ok([...uploadSessions.values()].every((session) => !Object.hasOwn(session, 'uploadUrl')), 'the Worker reservation response contains no SharePoint upload URL');
  assert.equal(uploadRequests.length, 3, 'the interrupted Worker upload retries once, then the second file uploads');
  assert.deepEqual(uploadRequests.map((upload) => upload.bytes), [pngBytes.length, pngBytes.length, pdfBytes.length], 'the browser sends the file bytes through the protected Worker endpoint');
  assert.deepEqual(uploadRequests.map((upload) => upload.contentType), ['image/png', 'image/png', 'application/pdf'], 'the upload uses the extension-validated type even when the browser reports a generic file type');
  assert.ok(uploadRequests.every((upload) => upload.url.endsWith('/content')), 'attachment bytes never go to a provider upload URL from the browser');
  assert.deepEqual(windowResult(await page.evaluate(() => window.__submittedForms[0])), { files: ['completion.png'], completeCount: 2 }, 'the existing notification submission occurs after both protected files are complete');
  await page.locator('[data-job-select]').filter({ hasText: 'GMT-ATTACH-001' }).click();
  await page.waitForFunction(() => document.querySelector('[data-job-card-attachments]')?.innerText.includes('site-report.pdf'), null, { timeout: 5000 });
  assert.match(await page.locator('[data-job-card-attachments]').innerText(), /completion\.png[\s\S]*site-report\.pdf/);
  assert.equal(pageErrors.length, 0, `unexpected browser errors: ${pageErrors.join('; ')}`);
  console.log('Job-card attachment upload, retry, protected history preview, and revision isolation UI: PASS');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}

function windowResult(value) { return value; }
