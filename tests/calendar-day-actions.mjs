import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><body><script defer src="/portal/calendar-actions.js"></script></body></html>');
    return;
  }
  const filePath = normalize(join(repoRoot, url.pathname));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const day = await page.evaluate(() => `${window.GMTCalendarActions.currentPayMonth()}-15`);
  await page.evaluate((value) => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.dataset.calendarDay = value;
    trigger.textContent = '15';
    document.body.appendChild(trigger);
  }, day);
  await page.locator('[data-calendar-day]').click();
  assert.equal(await page.locator('dialog.calendar-day-actions-dialog').isVisible(), true);
  assert.equal(await page.locator('#calendar-day-actions-date').textContent(), day);
  const links = await page.locator('dialog.calendar-day-actions-dialog a').evaluateAll((elements) => elements.map((element) => ({
    action: element.dataset.calendarActionTimesheet || element.dataset.calendarActionEvents || element.dataset.calendarActionTask || element.dataset.calendarActionTimeOff || '',
    href: element.href,
    ariaDisabled: element.getAttribute('aria-disabled')
  })));
  const byPath = (path) => links.find((link) => new URL(link.href).pathname === path);
  assert.equal(new URL(byPath('/timesheets/create.html').href).search, `?day=${day}`);
  assert.equal(new URL(byPath('/timesheets/create.html').href).hash, `#day-${day}`);
  assert.equal(new URL(byPath('/portal/submissions.html').href).search, `?day=${day}`);
  assert.equal(new URL(byPath('/tasks/').href).search, `?date=${day}`);
  const timeOff = new URL(byPath('/calendar/').href);
  assert.equal(timeOff.search, `?request=time-off&date=${day}`);
  assert.equal(timeOff.hash, '#calendar-form');
  assert.equal(byPath('/timesheets/create.html').ariaDisabled, 'false');
  console.log(JSON.stringify({ day, links: links.map(({ href, ariaDisabled }) => ({ href, ariaDisabled })) }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
