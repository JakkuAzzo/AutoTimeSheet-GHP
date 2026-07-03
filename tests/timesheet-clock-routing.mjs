import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, statSync, createReadStream } from 'node:fs';
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

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const logs = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()) && !/Failed to load resource: the server responded with a status of 404/.test(msg.text())) {
      logs.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  await page.goto(`http://127.0.0.1:${port}/timesheets/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__submittedForms = [];
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__submittedForms.push({
        action: this.action,
        subject: this.querySelector('[name="_subject"]')?.value || '',
        fields: [...this.querySelectorAll('input[type="hidden"]')].map((input) => [input.name, input.value])
      });
    };
  });

  const beforeSubmit = await page.evaluate(() => ({
    iframes: document.querySelectorAll('iframe').length,
    hiddenForms: document.querySelectorAll('form[hidden]').length,
    cards: document.querySelectorAll('[data-clock-form]').length,
    defaults: [...document.querySelectorAll('[data-clock-form]')].map((form) => ({
      action: form.elements.clock_action.value,
      time: form.elements.clock_time.value
    }))
  }));

  const cards = page.locator('[data-clock-form]');
  await cards.nth(0).locator('[name="employee_name"]').fill('Clock Tester');
  await cards.nth(0).locator('[name="clock_time"]').fill('08:15');
  await cards.nth(0).locator('button[type="submit"]').click();
  await page.waitForFunction(() => window.__submittedForms.length === 1, null, { timeout: 5000 });

  await cards.nth(1).locator('[name="employee_name"]').fill('Clock Tester');
  await cards.nth(1).locator('[name="clock_time"]').fill('17:05');
  await cards.nth(1).locator('button[type="submit"]').click();
  await page.waitForFunction(() => window.__submittedForms.length === 2, null, { timeout: 5000 });

  const result = await page.evaluate(() => window.__submittedForms);
  const inFields = new Map(result[0].fields);
  const outFields = new Map(result[1].fields);

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.equal(beforeSubmit.iframes, 0, 'clock submit iframe should not exist before submit');
  assert.equal(beforeSubmit.hiddenForms, 0, 'hidden FormSubmit forms should not exist before submit');
  assert.equal(beforeSubmit.cards, 2, 'two clock cards should render');
  assert.equal(beforeSubmit.defaults[0].action, 'clock_in');
  assert.equal(beforeSubmit.defaults[1].action, 'clock_out');
  assert.match(beforeSubmit.defaults[0].time, /^\d{2}:\d{2}$/);
  assert.match(beforeSubmit.defaults[1].time, /^\d{2}:\d{2}$/);

  assert.equal(result[0].action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(result[1].action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.match(result[0].subject, /^\[GMT\]\[TIMESHEET\]\[CLOCK\] Clock Tester \| Clock In \| \d{4}-\d{2}-\d{2} 08:15$/);
  assert.match(result[1].subject, /^\[GMT\]\[TIMESHEET\]\[CLOCK\] Clock Tester \| Clock Out \| \d{4}-\d{2}-\d{2} 17:05$/);
  assert.equal(inFields.get('gmt_type'), 'timesheet_clock');
  assert.equal(inFields.get('gmt_action'), 'clock_in');
  assert.equal(inFields.get('gmt_employee'), 'Clock Tester');
  assert.equal(inFields.get('clock_action'), 'Clock In');
  assert.equal(inFields.get('clock_time'), '08:15');
  assert.equal(outFields.get('gmt_type'), 'timesheet_clock');
  assert.equal(outFields.get('gmt_action'), 'clock_out');
  assert.equal(outFields.get('gmt_employee'), 'Clock Tester');
  assert.equal(outFields.get('clock_action'), 'Clock Out');
  assert.equal(outFields.get('clock_time'), '17:05');

  console.log(JSON.stringify({
    beforeSubmit,
    forms: result.map((form) => ({ action: form.action, subject: form.subject }))
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
