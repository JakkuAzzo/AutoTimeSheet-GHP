import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  const rawPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const filePath = normalize(join(repoRoot, rawPath));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  if (pathname.endsWith('/config.js')) {
    const config = readFileSync(filePath, 'utf8')
      .replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false')
      .replace(/(portalApiEndpoint:\s*)"[^"]*"/, '$1""')
      .replace(/(portalHistoryEndpoint:\s*)"[^"]*"/, '$1""');
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(config);
    return;
  }
  if (pathname.endsWith('/auth.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(`
      window.GMT_PORTAL_AUTH_READY = Promise.resolve({});
      window.GMT_PORTAL_PROFILE_READY = Promise.resolve(JSON.parse(localStorage.getItem('gmt.portal.profile.v1') || '{}'));
      const main = document.querySelector('main');
      if (main) main.hidden = false;
    `);
    return;
  }
  if (pathname.endsWith('/analytics.js') || pathname.endsWith('/viewport-effects.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript' }).end('');
    return;
  }
  response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  response.end(readFileSync(filePath));
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({
      name: 'Saved Profile Tester',
      username: 'profile.tester@example.test',
      subject: 'synthetic-profile'
    }));
    localStorage.setItem('gmt.timesheet.submitted.v1:synthetic-source', JSON.stringify({
      schemaVersion: 1,
      employeeName: 'Original Employee',
      employeeEmail: 'original.employee@example.test',
      weekStart: '2026-10-12',
      weekEnd: '2026-10-16',
      absenceRanges: [],
      rows: [{ date: '2026-10-12', start: '08:00', finish: '17:00', breakMinutes: 60, status: 'Recorded', note: '' }]
    }));
  });

  await page.goto(`${baseUrl}/timesheets/create.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('employee-name')?.value === 'Saved Profile Tester');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('gmtportalprofile', {
    detail: { name: 'Updated Profile Tester', username: 'profile.tester@example.test' }
  })));
  assert.equal(await page.locator('#employee-name').inputValue(), 'Updated Profile Tester', 'weekly entry updates when the saved profile hydrates');

  await page.goto(`${baseUrl}/portal/`, { waitUntil: 'load' });
  const clockName = page.locator('[data-clock-form] [name="employee_name"]');
  await page.waitForFunction(() => document.querySelector('[data-clock-form] [name="employee_name"]')?.value === 'Saved Profile Tester');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('gmtportalprofile', {
    detail: { name: 'Updated Profile Tester', username: 'profile.tester@example.test' }
  })));
  assert.equal(await clockName.inputValue(), 'Updated Profile Tester', 'clock-in updates when the saved profile hydrates');

  await page.goto(`${baseUrl}/timesheets/create.html?edit=synthetic-source`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#timesheet-edit-status')?.textContent.includes('browser-saved copy was loaded'));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('gmtportalprofile', {
    detail: { name: 'Different Editor Name', username: 'different.editor@example.test' }
  })));
  assert.equal(await page.locator('#employee-name').inputValue(), 'Original Employee', 'late profile hydration preserves the protected employee identity during an edit');
  await page.close();
  console.log('GMT saved profile name prefills weekly timesheet and clock-in; protected edit identity is preserved: PASS');
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
