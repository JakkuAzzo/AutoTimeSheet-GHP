import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, rawPath));

  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  if (rawPath === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(filePath, 'utf8').replace('enabled: true', 'enabled: false'));
    return;
  }

  res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromePath) ? { executablePath: chromePath } : {})
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()) && !/Failed to load resource: the server responded with a status of 404/.test(msg.text())) {
      logs.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  await page.goto(`http://127.0.0.1:${port}/timesheets/create.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__submittedForms = [];
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__submittedForms.push({
        action: this.action,
        subject: this.querySelector('[name="_subject"]')?.value || '',
        cc: this.querySelector('[name="_cc"]')?.value || '',
        replyTo: this.querySelector('[name="_replyto"]')?.value || '',
        files: [...this.querySelectorAll('input[type="file"]')].map((input) => ({
          name: input.name,
          files: [...input.files].map((file) => ({ name: file.name, type: file.type, size: file.size }))
        }))
      });
    };
  });

  await page.locator('#employee-name').fill('Routing Tester');
  await page.locator('#employee-email').fill('routing.tester@example.com');
  await page.locator('#week-start').fill('2026-06-22');
  await page.locator('#week-end').fill('2026-06-26');
  await page.locator('[data-field="date"]').first().fill('2026-06-22');
  await page.locator('[data-field="start"]').first().fill('08:00');
  await page.locator('[data-field="finish"]').first().fill('16:00');
  await page.locator('[data-field="lunchHad"]').first().selectOption('0');
  await page.locator('#submit-btn').click();
  await page.waitForFunction(() => window.__submittedForms.length === 1, null, { timeout: 15000 });

  const result = await page.evaluate(() => window.__submittedForms[0]);
  const config = await page.evaluate(() => ({
    timesheetFormSubmitEndpoint: window.GMT_APP_CONFIG?.timesheetFormSubmitEndpoint || '',
    auditFormSubmitEndpoint: window.GMT_APP_CONFIG?.auditFormSubmitEndpoint || '',
    jobCardFormSubmitEndpoint: window.GMT_APP_CONFIG?.jobCardFormSubmitEndpoint || '',
    fallbackFormSubmitEndpoint: window.GMT_APP_CONFIG?.fallbackFormSubmitEndpoint || '',
    legacyPersonalAccountsEmail: window.GMT_APP_CONFIG?.legacyPersonalAccountsEmail || ''
  }));

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.equal(config.timesheetFormSubmitEndpoint, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(config.auditFormSubmitEndpoint, '');
  assert.equal(config.jobCardFormSubmitEndpoint, '');
  assert.equal(config.fallbackFormSubmitEndpoint, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(config.legacyPersonalAccountsEmail, 'acc.gmtelect@outlook.com');
  assert.equal(result.action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(result.subject, '[GMT][TIMESHEET][SUBMISSION] Routing Tester | Week 2026-06-22');
  assert.equal(result.cc, 'routing.tester@example.com');
  assert.equal(result.replyTo, 'routing.tester@example.com');
  assert.deepEqual(result.files.map((entry) => entry.name), ['attachment', 'attachment_csv']);
  assert.ok(result.files[0].files[0].name.includes('GMT Timesheet - Routing Tester - 2026-06-22.xlsx'));
  assert.ok(result.files[0].files[0].size > 1000);
  assert.ok(result.files[1].files[0].name.includes('GMT Timesheet - Routing Tester - 2026-06-22.csv'));
  assert.ok(result.files[1].files[0].size > 100);

  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
