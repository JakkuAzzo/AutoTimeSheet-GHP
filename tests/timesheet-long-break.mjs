import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const server = createServer((request, response) => {
  const name = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const file = normalize(join(root, name));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  if (name === '/config.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(readFileSync(file, 'utf8').replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false'));
    return;
  }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream';
  response.writeHead(200, { 'content-type': type });
  createReadStream(file).pipe(response);
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  const pageResponse = await page.goto(`http://127.0.0.1:${server.address().port}/timesheets/create.html`, { waitUntil: 'load' });
  assert.equal(pageResponse.status(), 200, 'the timesheet form is served');
  await page.locator('#clear-draft-btn').click();
  const card = page.locator('.day-card').first();
  const breakField = card.locator('[data-field="lunchHad"]');
  assert.equal(await breakField.getAttribute('type'), 'number');
  await card.locator('[data-field="date"]').fill('2026-09-14');
  await card.locator('[data-field="start"]').fill('07:00');
  await card.locator('[data-field="finish"]').fill('18:00');
  await breakField.fill('120');
  await page.waitForFunction(() => {
    const row = JSON.parse(document.querySelector('#timesheet-payload').value).rows[0];
    return row.date === '2026-09-14' && row.lunchMinutes === 120 && row.workedActual === 540;
  });
  assert.match(await card.locator('.day-mini-summary').textContent(), /120 minutes deducted/);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
