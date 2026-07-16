import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, rawPath));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
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

async function submittedForm(page, selector) {
  await page.locator(selector).click();
  await page.waitForFunction((count) => window.__submittedForms.length >= count, await page.evaluate(() => window.__submittedForms.length), { timeout: 5000 });
  return page.evaluate(() => window.__submittedForms.at(-1));
}

try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Unlicensed Engineer' })));
  await page.addInitScript(() => {
    window.__submittedForms = [];
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__submittedForms.push({
        action: this.action,
        subject: this.querySelector('[name="_subject"]')?.value || '',
        fields: Object.fromEntries([...this.querySelectorAll('input[type="hidden"]')].map((input) => [input.name, input.value]))
      });
    };
  });

  await page.goto(`http://127.0.0.1:${port}/tasks/`, { waitUntil: 'load' });
  assert.equal(await page.locator('#task-assignee').inputValue(), 'Unlicensed Engineer');
  await page.locator('#task-title').fill('Inspect workshop pump');
  await page.locator('#task-job-ref').fill('GMT-TASK-001');
  await page.locator('#task-due').fill('2026-07-20');
  const task = await submittedForm(page, '#task-form button[type="submit"]');
  assert.equal(task.action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(task.subject, '[GMT][TASK][REQUEST] Inspect workshop pump');
  assert.equal(task.fields.gmt_type, 'task');
  assert.equal(task.fields.gmt_action, 'create_request');
  assert.equal(task.fields.gmt_status, 'Pending approval');
  assert.equal(task.fields.gmt_employee, 'Unlicensed Engineer');
  assert.ok(task.fields.gmt_record_id);
  assert.equal(await page.locator('#task-board').innerText().then((text) => text.includes('Awaiting licensed accounts approval.')), true);

  await page.goto(`http://127.0.0.1:${port}/calendar/`, { waitUntil: 'load' });
  assert.equal(await page.locator('#calendar-owner').inputValue(), 'Unlicensed Engineer');
  await page.locator('#calendar-title').fill('Site survey');
  await page.locator('#calendar-date').fill('2026-07-21');
  const calendar = await submittedForm(page, '#calendar-form button[type="submit"]');
  assert.equal(calendar.action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(calendar.subject, '[GMT][CALENDAR][REQUEST] 2026-07-21 | Site survey');
  assert.equal(calendar.fields.gmt_type, 'calendar');
  assert.equal(calendar.fields.gmt_action, 'create_request');
  assert.equal(calendar.fields.gmt_status, 'Pending approval');
  assert.equal(calendar.fields.gmt_employee, 'Unlicensed Engineer');
  assert.equal(calendar.fields.gmt_calendar_name, 'GMT Operational Calendar');
  assert.ok(calendar.fields.gmt_record_id);
  assert.equal(await page.locator('#calendar-list').innerText().then((text) => text.includes('Awaiting licensed accounts approval.')), true);
  console.log(JSON.stringify({ task: { action: task.action, subject: task.subject }, calendar: { action: calendar.action, subject: calendar.subject } }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
