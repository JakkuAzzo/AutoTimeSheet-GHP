import assert from 'node:assert/strict';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = resolve(repoRoot, 'tests/fixtures/training-audit-sample.csv');
const recorderSource = readFileSync(resolve(repoRoot, 'tools/record-staff-walkthrough.mjs'), 'utf8');
const mime = {
  '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

test('audit walkthrough uses the shared sample and lets selection add it once', () => {
  assert.ok(recorderSource.includes('training-audit-sample.csv'), 'recorder must use the audited training fixture');
  assert.ok(!/page\.locator\('#addSourcesBtn'\)\.click\(\)/.test(recorderSource), 'recorder must not add the change-handler source a second time');
});

test('training CSV produces a real eight-hour calculation from its entered times', async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/config.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end('window.GMT_APP_CONFIG = { entraSpaAuth: { enabled: false }, portalApiEndpoint: "", portalApiScopes: [], formSubmitEndpoint: "", fallbackFormSubmitEndpoint: "" };');
      return;
    }
    let requestPath;
    try { requestPath = decodeURIComponent(url.pathname); } catch {
      response.writeHead(400); response.end('Bad path'); return;
    }
    if (requestPath.endsWith('/')) requestPath += 'index.html';
    const filePath = resolve(repoRoot, `.${requestPath}`);
    if (!(filePath === repoRoot || filePath.startsWith(`${repoRoot}${sep}`)) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl || (route.request().method() === 'GET' && ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'].includes(url.hostname))) {
        return route.continue();
      }
      return route.abort();
    });
    await page.addInitScript(() => {
      localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Demo Employee', username: 'demo.employee@example.invalid' }));
    });
    await page.goto(`${baseUrl}/audit/`, { waitUntil: 'networkidle' });
    await page.locator('main').waitFor({ state: 'visible' });
    await page.locator('#sourceInput').setInputFiles({
      name: 'TRAINING-ONLY-DEMO-NOT-PAYROLL.csv',
      mimeType: 'text/csv',
      buffer: readFileSync(fixturePath)
    });
    await page.locator('#sourceList .source-item').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sourceList .source-item').count(), 1, 'selecting the fixture should add exactly one source');
    assert.equal(await page.locator('#sourceInput').evaluate((input) => input.files.length), 0, 'the change handler clears its input after adding the source');
    assert.match(await page.locator('#status').textContent(), /1 source\(s\) ready/, 'source should be ready without clicking Add selected sources');

    await page.locator('#runBtn').click();
    await page.locator('#resultsCard:not(.hidden) #statusBanner').waitFor({ state: 'visible' });
    assert.match(await page.locator('#statusBanner').textContent(), /No issues found\. No action needed/, 'matching synthetic timesheet should need no review');
    const row = await page.locator('#rowsTable tbody tr').textContent();
    assert.match(row, /Actual\s*8h/, 'work interval minus a 60-minute break should calculate as eight hours');
    assert.match(row, /Lunch\s*60m/, 'the result should retain the explicitly minute-based break');
    assert.match(row, /Weekday basic time/, 'actual times should drive calculation instead of falling back to claimed totals');
    assert.match(await page.locator('#kpis').textContent(), /Actual hours8h 00mBasic8h 00mOT x1\.50h 00mOT x2\.00h 00mIssues0Source rows1/);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
