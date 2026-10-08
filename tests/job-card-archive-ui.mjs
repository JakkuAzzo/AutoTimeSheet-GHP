import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { quickXorHash } from '../tools/prepare-job-card-import.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const jobsPageHtml = await readFile(new URL('../jobs/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(jobsPageHtml, /3 · Job card history|View job cards/, 'job cards use one shared archive section instead of the duplicate history heading');
assert.match(jobsPageHtml, /Job cards and shared archive/);
assert.ok(jobsPageHtml.indexOf('id="job-card-list"') < jobsPageHtml.indexOf('id="job-card-scanned-archive"'), 'new submitted cards and scanned scans appear in the same archive section');
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const archiveId = `jobcard-${'a'.repeat(64)}-0001`;
const secondArchiveId = `jobcard-${'b'.repeat(64)}-0001`;
const queries = [];
const reviews = [];
const uploads = [];
const batchStarts = [];
const sessions = new Map();
const uploadedSources = new Set();
const importedPages = new Set();
const confirmedRecords = new Set();
let activeRole = 'accounts';
let sessionSequence = 0;
const largeUploadRanges = [];
let largeUploadHadAuthorization = false;

function onePagePdf() {
  const stream = Buffer.from('BT /F1 20 Tf 36 720 Td (GMT scanned job card preview) Tj ET\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}endstream`
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

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
  const bytes = await readBody(request);
  return bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
}

function archiveResult(recordId, pageNumber = 1) {
  const confirmed = confirmedRecords.has(recordId);
  return {
    record_id: recordId,
    batch_id: `jobcard-batch-${'c'.repeat(64)}`,
    source_file: pageNumber === 1 ? 'EC09200.pdf' : 'MTA22900.pdf',
    source_page: pageNumber,
    card_type: pageNumber === 1 ? 'EC' : 'MTA',
    mean_ocr_confidence: pageNumber === 1 ? 23.4 : 91.2,
    candidates: {
      cardNumber: pageNumber === 1 ? 'EC09200' : 'MTA22900',
      date: '15/03/2026',
      customer: 'ACME Bearings Ltd',
      orderNumber: 'PO 8842',
      site: 'Croydon workshop',
      engineer: 'J Brown',
      report: 'Motor winding and bearing replacement',
      amount: ''
    },
    confirmed_fields: confirmed ? { cardNumber: pageNumber === 1 ? 'EC09200' : 'MTA22900', date: '2026-03-15', customer: 'ACME Bearings Ltd', orderNumber: 'PO 8842', site: 'Croydon workshop', engineer: 'J Brown', report: 'Motor winding and bearing replacement', amount: '' } : {},
    review_state: confirmed ? 'confirmed' : 'needs-review',
    review_note: '',
    ocr_text: '<img src=x onerror=window.__jobCardXss=1> EC09200 ACME Bearings PO 8842 J Brown motor winding'
  };
}

const server = createServer(async (request, response) => {
  const address = new URL(request.url || '/', `http://127.0.0.1`);
  const pathname = address.pathname;
  try {
    if (pathname === '/config.js') {
      const source = await readFile(join(repoRoot, 'config.js'), 'utf8');
      const config = source
        .replace(/portalApiEndpoint:\s*"[^"]*"/, `portalApiEndpoint: "http://127.0.0.1:${server.address().port}"`)
        .replace(/portalApiScopes:\s*\[[^\]]*\]/, 'portalApiScopes: []')
        .replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false');
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(config);
      return;
    }

    if (pathname === '/chunk-test' && request.method === 'PUT') {
      largeUploadHadAuthorization ||= Boolean(request.headers.authorization);
      const payload = await readBody(request);
      largeUploadRanges.push({ range: request.headers['content-range'], byteLength: payload.length });
      if (largeUploadRanges.length === 1) json(response, { nextExpectedRanges: ['10485760-'] }, 202);
      else response.writeHead(201).end();
      return;
    }
    if (pathname.startsWith('/upload-session/') && request.method === 'PUT') {
      const id = pathname.split('/').at(-1);
      const payload = await readBody(request);
      uploads.push({ sessionId: id, range: request.headers['content-range'], byteLength: payload.length, authorization: request.headers.authorization || '' });
      response.writeHead(201).end();
      return;
    }
    if (pathname.startsWith('/upload-session/') && request.method === 'GET') {
      json(response, { nextExpectedRanges: ['0-'] });
      return;
    }

    if (pathname === '/api/history' && request.method === 'GET') {
      json(response, { records: [], meta: { is_admin: activeRole === 'accounts', is_job_card_admin: activeRole === 'accounts' } });
      return;
    }
    if (pathname === '/api/xero/status' && request.method === 'GET') {
      json(response, { configured: false, connections: [] });
      return;
    }
    if (pathname === '/api/job-cards/archive/access' && request.method === 'GET') {
      json(response, { canImport: activeRole === 'accounts' });
      return;
    }
    if (pathname === '/api/job-cards/archive/search' && request.method === 'GET') {
      const filters = Object.fromEntries(address.searchParams.entries());
      queries.push(filters);
      if (filters.q === 'no-results') {
        json(response, { records: [], nextCursor: null });
        return;
      }
      if (filters.cursor) {
        json(response, { records: [archiveResult(secondArchiveId, 2)], nextCursor: null });
        return;
      }
      json(response, { records: [archiveResult(archiveId)], nextCursor: filters.q ? null : 'next-page' });
      return;
    }
    if (pathname === `/api/job-cards/archive/${archiveId}` || pathname === `/api/job-cards/archive/${secondArchiveId}`) {
      const record = archiveResult(pathname.endsWith(secondArchiveId) ? secondArchiveId : archiveId, pathname.endsWith(secondArchiveId) ? 2 : 1);
      json(response, { record });
      return;
    }
    if (pathname === `/api/job-cards/archive/${archiveId}/content` || pathname === `/api/job-cards/archive/${secondArchiveId}/content`) {
      response.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
      response.end(onePagePdf());
      return;
    }
    if ((pathname === `/api/records/job-cards/${archiveId}/invoices`) || (pathname === `/api/records/job-cards/${secondArchiveId}/invoices`)) {
      json(response, { invoices: [{ invoice_number: 'INV-TEST-001', status: 'AUTHORISED', amount_due: 125.5, currency: 'GBP' }], links: [] });
      return;
    }
    if ((pathname === `/api/job-cards/archive/${archiveId}/review` || pathname === `/api/job-cards/archive/${secondArchiveId}/review`) && request.method === 'PATCH') {
      const body = await readJson(request);
      reviews.push({ recordId: pathname.includes(secondArchiveId) ? secondArchiveId : archiveId, body });
      if (body.state === 'confirmed') confirmedRecords.add(reviews.at(-1).recordId);
      json(response, { ok: true, recordId: reviews.at(-1).recordId, confirmedFields: body.confirmedFields, reviewState: body.state, reviewedAt: '2026-10-06T12:00:00.000Z' });
      return;
    }

    if (pathname === '/api/admin/job-card-batches/start' && request.method === 'POST') {
      const body = await readJson(request);
      batchStarts.push(body);
      json(response, { ok: true, batchId: body.batchId, status: 'uploading', duplicate: false }, 201);
      return;
    }
    if (pathname.startsWith('/api/admin/job-card-batches/') && pathname.endsWith('/status') && request.method === 'GET') {
      const status = importedPages.size ? 'pages-complete' : (uploadedSources.size ? 'source-complete' : 'uploading');
      json(response, { batchId: pathname.split('/')[5], status, expectedSources: 1, uploadedSources: [...uploadedSources], expectedPages: 1, importedRecordIds: [...importedPages] });
      return;
    }
    if (pathname === '/api/admin/job-card-upload-sessions' && request.method === 'POST') {
      const body = await readJson(request);
      const sessionId = `upload-session-${++sessionSequence}`;
      sessions.set(sessionId, body);
      json(response, { sessionId, uploadUrl: `https://upload.example.test/${sessionId}`, expirationDateTime: new Date(Date.now() + 3600_000).toISOString() }, 201);
      return;
    }
    if (pathname === '/api/admin/job-card-batches/complete' && request.method === 'POST') {
      const body = await readJson(request);
      const uploadSession = sessions.get(body.sessionId);
      uploadedSources.add(uploadSession.fileName);
      json(response, { ok: true, batchId: 'test-batch', status: 'source-complete', uploadedSourceCount: uploadedSources.size });
      return;
    }
    if (pathname === '/api/admin/job-cards/import' && request.method === 'POST') {
      const body = await readJson(request);
      const uploadSession = sessions.get(body.sessionId);
      importedPages.add(uploadSession.manifestEntry.recordId);
      json(response, { ok: true, recordId: uploadSession.manifestEntry.recordId, reviewState: 'needs-review', duplicate: false }, 201);
      return;
    }

    const pathnameForFile = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const diskPath = normalize(join(repoRoot, pathnameForFile.replace(/^\//, '')));
    if (!diskPath.startsWith(`${repoRoot}/`) || !existsSync(diskPath) || !statSync(diskPath).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': mime[extname(diskPath)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(await readFile(diskPath));
  } catch (error) {
    json(response, { error: error.message || 'test server error' }, 500);
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = resolve(repoRoot, 'output/playwright');
const tempDir = await mkdtemp(join(tmpdir(), 'gmt-job-card-ui-'));
await mkdir(screenshotDir, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/jobs/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.job-card-archive-result').length === 1, null, { timeout: 10000 });
  await page.locator('#job-card-archive-preview').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#job-card-archive-preview')?.src.startsWith('blob:'), null, { timeout: 5000 });
  await page.waitForTimeout(700);
  await page.locator('#job-card-scanned-archive').screenshot({ path: join(screenshotDir, 'job-card-archive-1280.png'), animations: 'disabled' });
  await page.getByText('INV-TEST-001').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#job-card-archive-review-form').count(), 1, 'Accounts can correct OCR candidates');
  assert.equal(await page.locator('#job-card-import-link').isVisible(), true, 'Accounts can reach the import screen');

  const widths = [320, 375, 768, 1024, 1440];
  const layoutFailures = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 980 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.job-card-archive-result').length === 1, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#job-card-archive-preview')?.src.startsWith('blob:'), null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    const archive = page.locator('#job-card-scanned-archive');
    await archive.screenshot({ path: join(screenshotDir, `job-card-archive-${width}.png`), animations: 'disabled' });
    const layout = await page.evaluate(() => {
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height };
      };
      const archive = document.querySelector('#job-card-scanned-archive');
      const visible = [...archive.querySelectorAll('input, select, button, a, iframe, .job-card-archive-result, .job-card-archive-detail')]
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      return {
        viewport: innerWidth,
        archive: rect(archive),
        archiveScrollWidth: archive.scrollWidth,
        archiveClientWidth: archive.clientWidth,
        elements: visible.map((element) => ({ tag: element.tagName, label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 24), ...rect(element) }))
      };
    });
    if (layout.archive.left < -1 || layout.archive.right > width + 1) layoutFailures.push(`${width}px archive section is outside the viewport`);
    if (layout.archiveScrollWidth > layout.archiveClientWidth + 1) layoutFailures.push(`${width}px archive section scrolls horizontally`);
    for (const item of layout.elements) {
      if (item.left < -1 || item.right > width + 1) layoutFailures.push(`${width}px ${item.tag} '${item.label}' is outside the viewport`);
      if ((item.tag === 'INPUT' || item.tag === 'SELECT' || item.tag === 'BUTTON') && (item.width < 40 || item.height < 40)) layoutFailures.push(`${width}px ${item.tag} '${item.label}' is below 40px`);
    }
  }
  assert.deepEqual(layoutFailures, [], `Scanned archive layout failures:\n${layoutFailures.join('\n')}`);

  await page.setViewportSize({ width: 320, height: 980 });
  assert.equal(await page.locator('#job-card-archive-open-preview').count(), 1, 'mobile provides a full-width native PDF preview action');
  assert.equal(await page.locator('#job-card-archive-open-preview').isVisible(), true);
  assert.match(await page.locator('#job-card-archive-open-preview').getAttribute('href'), /^blob:/);
  const pdfPopupPromise = page.waitForEvent('popup');
  await page.locator('#job-card-archive-open-preview').click();
  const pdfPopup = await pdfPopupPromise;
  await pdfPopup.waitForLoadState('load');
  await pdfPopup.waitForTimeout(700);
  assert.match(pdfPopup.url(), /^blob:/, 'the mobile action opens the authenticated page Blob in a separate native viewer tab');
  await pdfPopup.screenshot({ path: join(screenshotDir, 'job-card-archive-mobile-pdf.png'), animations: 'disabled' });
  await pdfPopup.close();

  await page.locator('#job-card-archive-query').fill('EC09200');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  await page.locator('#job-card-archive-query').fill('ACME Bearings Ltd');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  await page.locator('#job-card-archive-query').fill('15/03/2026');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  await page.locator('#job-card-archive-query').fill('PO 8842');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  await page.locator('#job-card-archive-query').fill('J Brown');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  await page.locator('#job-card-archive-query').fill('motor winding');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  for (const term of ['EC09200', 'ACME Bearings Ltd', '15/03/2026', 'PO 8842', 'J Brown', 'motor winding']) {
    assert.ok(queries.some((query) => query.q === term), `archive search submits '${term}'`);
  }

  await page.locator('#job-card-archive-query').fill('motor winding');
  await page.locator('#job-card-archive-type').selectOption('EC');
  await page.locator('#job-card-archive-from').fill('2026-03-01');
  await page.locator('#job-card-archive-to').fill('2026-03-31');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  assert.ok(queries.some((query) => query.q === 'motor winding' && query.cardType === 'EC' && query.from === '2026-03-01' && query.to === '2026-03-31'), 'card type and confirmed date filters reach the archive API');

  await page.locator('#job-card-archive-search').evaluate((form) => form.reset());
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-status')?.textContent.includes('1 scanned records loaded'));
  assert.match(await page.locator('#job-card-archive-results').innerText(), /OCR confidence 23%/);
  await page.locator('#job-card-archive-detail details summary').click();
  assert.equal(await page.locator('#job-card-archive-detail img').count(), 0, 'OCR text is rendered as inert escaped text');
  assert.match(await page.locator('#job-card-archive-detail').innerText(), /<img src=x onerror=window.__jobCardXss=1>/);
  assert.equal(await page.evaluate(() => window.__jobCardXss === true), false);
  assert.equal(await page.locator('#job-card-archive-preview').getAttribute('sandbox'), null, 'the authenticated Blob PDF opens in the browser native PDF viewer');

  await page.locator('#job-card-archive-more').click();
  await page.waitForFunction(() => document.querySelectorAll('#job-card-archive-results [data-job-archive-select]').length === 2);
  assert.match(await page.locator('#job-card-archive-results').innerText(), /MTA22900/);
  assert.equal(await page.locator('#job-card-archive-more').isHidden(), true, 'the last cursor page hides pagination');

  await page.locator('#job-card-archive-query').fill('no-results');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.locator('#job-card-archive-results').getByText('No scanned job cards match this search.', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#job-card-archive-detail').innerText(), 'No scanned job cards match this search.');

  await page.locator('#job-card-archive-query').fill('EC09200');
  await page.locator('#job-card-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#job-card-archive-review-form') !== null);
  await page.locator('#job-card-archive-review-form [name="cardNumber"]').fill('EC09200');
  await page.locator('#job-card-archive-review-form [name="state"]').selectOption('confirmed');
  await page.locator('#job-card-archive-review-form button[type="submit"]').click();
  await page.getByText('Accounts review saved.').waitFor({ state: 'visible' });
  assert.deepEqual(reviews.at(-1).body.confirmedFields.cardNumber, 'EC09200');
  assert.equal(reviews.at(-1).body.state, 'confirmed');
  await page.getByText('Accounts confirmed record').waitFor({ state: 'visible' });

  activeRole = 'employee';
  const employeeHistoryResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/history');
  await page.reload({ waitUntil: 'load' });
  await employeeHistoryResponse;
  await page.waitForFunction(() => document.querySelectorAll('.job-card-archive-result').length === 1, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#job-card-archive-preview')?.src.startsWith('blob:'), null, { timeout: 5000 });
  assert.equal(await page.locator('#job-card-archive-review-form').count(), 0, 'employees can search and preview but cannot edit confirmed fields');
  assert.equal(await page.locator('#job-card-import-link').isVisible(), false, 'employees do not see the import control');
  assert.equal(await page.getByText('INV-TEST-001').count(), 1, 'existing invoice display still appears for an employee');
  assert.equal(await page.locator('#job-card-archive-invoice-links [data-record-invoice-link]').count(), 0, 'employees cannot use Accounts invoice linking controls');

  await page.goto(`${baseUrl}/tools/job-card-import.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('#job-card-import-denied')?.hidden, null, { timeout: 5000 });
  assert.equal(await page.locator('#job-card-import-main').isHidden(), true, 'employees who open the import URL are denied');
  assert.equal(await page.locator('#job-card-import-denied').isVisible(), true);

  activeRole = 'accounts';
  await page.goto(`${baseUrl}/tools/job-card-import.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('#job-card-import-main')?.hidden, null, { timeout: 5000 });
  await page.getByText('Accounts access verified. Select the archive files to begin.').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#job-card-manifest-file').count(), 1, 'Safari can select the manifest as an ordinary file');
  assert.equal(await page.locator('#job-card-page-files').count(), 1, 'Safari can select page PDFs as ordinary files');
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    const layout = await page.locator('#job-card-import-main').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    assert.ok(layout.scrollWidth <= layout.clientWidth, `import form does not overflow at ${width}px`);
    await page.locator('#job-card-import-main').screenshot({ path: join(screenshotDir, `job-card-import-${width}.png`), animations: 'disabled' });
  }

  await page.route('https://upload.example.test/**', async (route) => {
    const address = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': baseUrl,
        'access-control-allow-methods': 'PUT, GET, OPTIONS',
        'access-control-allow-headers': 'Accept, Content-Type, Content-Range'
      } });
      return;
    }
    const request = route.request();
    const byteLength = request.postDataBuffer()?.length || 0;
    if (address.pathname === '/chunk-test') {
      largeUploadHadAuthorization ||= Boolean(request.headers().authorization);
      largeUploadRanges.push({ range: request.headers()['content-range'], byteLength });
    } else {
      uploads.push({ sessionId: address.pathname.slice(1), range: request.headers()['content-range'], byteLength, authorization: request.headers().authorization || '' });
    }
    if (address.pathname === '/chunk-test' && largeUploadRanges.length === 1) {
      await route.fulfill({ status: 202, contentType: 'application/json', headers: { 'access-control-allow-origin': baseUrl }, body: JSON.stringify({ nextExpectedRanges: ['10485760-'] }) });
    } else {
      await route.fulfill({ status: 201, headers: { 'access-control-allow-origin': baseUrl } });
    }
  });
  const chunkResult = await page.evaluate(async () => {
    const size = 10 * 1024 * 1024 + 17;
    const file = new File([new Uint8Array(size)], 'large-test.pdf', { type: 'application/pdf' });
    const progress = [];
    await window.GMTPortalApi.uploadJobCardFile(file, 'https://upload.example.test/chunk-test', (sent, total) => progress.push([sent, total]));
    return { size, progress };
  });
  assert.equal(chunkResult.size, 10 * 1024 * 1024 + 17);
  assert.deepEqual(largeUploadRanges.map((chunk) => chunk.range), [
    'bytes 0-10485759/10485777', 'bytes 10485760-10485776/10485777'
  ], 'the 10 MiB first chunk and remaining final chunk use exact sequential byte ranges');
  assert.deepEqual(largeUploadRanges.map((chunk) => chunk.byteLength), [10 * 1024 * 1024, 17]);
  assert.equal(largeUploadHadAuthorization, false, 'the preauthenticated upload URL does not receive the portal bearer token');
  assert.deepEqual(chunkResult.progress.at(-1), [10 * 1024 * 1024 + 17, 10 * 1024 * 1024 + 17]);

  const sourceDir = join(tempDir, 'originals');
  const preparedDir = join(tempDir, 'prepared');
  const pagesDir = join(preparedDir, 'pages');
  await mkdir(sourceDir, { recursive: true });
  await mkdir(pagesDir, { recursive: true });
  const sourceBytes = Buffer.from('%PDF-1.4 source bytes for import\n');
  const mismatchedSourceBytes = Buffer.from(sourceBytes);
  mismatchedSourceBytes[10] ^= 1;
  assert.equal(mismatchedSourceBytes.length, sourceBytes.length, 'the mismatch fixture keeps the manifest size valid');
  const pageBytes = Buffer.from('%PDF-1.4 single page derivative\n');
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const pageSha256 = createHash('sha256').update(pageBytes).digest('hex');
  const batchId = `jobcard-batch-${createHash('sha256').update(`EC09200.pdf\n${sourceSha256}`).digest('hex')}`;
  const recordId = `jobcard-${sourceSha256}-0001`;
  await writeFile(join(sourceDir, 'EC09200.pdf'), mismatchedSourceBytes);
  await writeFile(join(pagesDir, `${recordId}.pdf`), pageBytes);
  const manifest = {
    batchId,
    inventory: { sourceCount: 1, pageCount: 1, needsReviewCount: 1 },
    sources: [{ fileName: 'EC09200.pdf', pageCount: 1, sizeBytes: sourceBytes.length, sha256: sourceSha256, quickXorHash: quickXorHash(sourceBytes) }],
    pages: [{
      batchId, recordId, sourceFile: 'EC09200.pdf', sourceSha256, sourceQuickXorHash: quickXorHash(sourceBytes), sourcePage: 1,
      file: `pages/${recordId}.pdf`, sizeBytes: pageBytes.length, sha256: pageSha256, quickXorHash: quickXorHash(pageBytes),
      cardType: 'EC', candidates: { cardNumber: 'EC09200', customer: 'ACME Bearings Ltd' }, ocrText: 'EC09200 ACME Bearings Ltd',
      meanOcrConfidence: 24, reviewState: 'needs-review', reviewReasons: ['low-ocr-confidence']
    }]
  };
  await writeFile(join(preparedDir, 'manifest.json'), JSON.stringify(manifest));
  const sourceInput = page.locator('#job-card-source-folder');
  const manifestInput = page.locator('#job-card-manifest-file');
  const preparedInput = page.locator('#job-card-page-files');
  await sourceInput.setInputFiles({ name: 'EC09200.pdf', mimeType: 'application/pdf', buffer: mismatchedSourceBytes });
  await manifestInput.setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: await readFile(join(preparedDir, 'manifest.json')) });
  await preparedInput.setInputFiles({ name: `${recordId}.pdf`, mimeType: 'application/pdf', buffer: pageBytes });
  await page.getByText('1 original PDFs and 1 scanned pages match the manifest.', { exact: false }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#job-card-import-start').isEnabled(), true, 'matching source and derivative file hashes enable import');

  await page.locator('#job-card-import-start').click();
  await page.getByText(/does not match the SHA-256 and QuickXorHash/, { exact: false }).waitFor({ state: 'visible' });
  assert.equal(batchStarts.length, 0, 'local source hashes are verified before a SharePoint batch is created');
  assert.equal(sessionSequence, 0, 'a source hash mismatch creates no upload session');

  await writeFile(join(sourceDir, 'EC09200.pdf'), sourceBytes);
  await sourceInput.setInputFiles({ name: 'EC09200.pdf', mimeType: 'application/pdf', buffer: sourceBytes });
  await page.getByText('1 original PDFs and 1 scanned pages match the manifest.', { exact: false }).waitFor({ state: 'visible' });
  await page.locator('#job-card-import-start').click();
  try {
    await page.waitForFunction(() => /Archive import complete|\bRetry the batch\b|\bdoes not match\b|\bnot confirmed\b|\bnot available\b|\bnot found\b|\bfailed\b/i.test(document.querySelector('#job-card-import-status')?.textContent || ''), null, { timeout: 10000 });
  } catch (_) {
    throw new Error(`Importer status did not settle: ${await page.locator('#job-card-import-status').innerText()}`);
  }
  assert.match(await page.locator('#job-card-import-status').innerText(), /Archive import complete/, 'the initial archive upload completes');
  assert.equal(uploadedSources.has('EC09200.pdf'), true, 'the original scan is confirmed before derivative indexing');
  assert.equal(importedPages.has(recordId), true, 'the page derivative is indexed after upload');
  const sessionsAfterFirstRun = sessionSequence;
  assert.equal(uploads.every((upload) => !upload.authorization), true, 'SharePoint upload chunks have no Authorization header');
  assert.ok(uploads.some((upload) => upload.sessionId === 'upload-session-1'), 'the unchanged source bundle is uploaded');
  assert.ok(uploads.some((upload) => upload.sessionId === 'upload-session-2'), 'the one-page derivative is uploaded');

  await page.locator('#job-card-import-start').click();
  await page.waitForFunction(() => /Archive import complete|\bRetry the batch\b|\bdoes not match\b|\bnot confirmed\b|\bnot available\b|\bnot found\b|\bfailed\b/i.test(document.querySelector('#job-card-import-status')?.textContent || ''), null, { timeout: 10000 });
  assert.match(await page.locator('#job-card-import-status').innerText(), /Archive import complete/, 'the retried archive import reports completion');
  assert.equal(sessionSequence, sessionsAfterFirstRun, 'a retry skips source and page files already verified by batch status');
  assert.equal(importedPages.size, 1, 'retry preserves the deterministic single page record');

  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
  assert.equal(await stat(join(screenshotDir, 'job-card-archive-320.png')).then((info) => info.size > 0), true);
  console.log(`Scanned job-card archive browser, Accounts importer, upload chunks, access gates and ${widths.join(', ')}px responsive layouts: PASS`);
  console.log(`Screenshots: ${widths.map((width) => `output/playwright/job-card-archive-${width}.png`).join(', ')}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await rm(tempDir, { recursive: true, force: true });
}
