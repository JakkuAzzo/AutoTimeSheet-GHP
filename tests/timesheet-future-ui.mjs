import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const path = normalize(join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
  response.end(pathname === '/config.js' ? readFileSync(path, 'utf8').replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false').replace(/(portalApiEndpoint:\s*)"[^"]*"/, '$1""') : readFileSync(path));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/timesheets/create.html`, { waitUntil: 'load' });
  const result = await page.evaluate(() => {
    const today = window.GMTTimesheetRows.todayInLondon();
    const tomorrow = window.GMTTimesheetRows.addDays(today, 1);
    const futureWork = calculateRows([{ date: tomorrow, start: '08:00', finish: '17:00', lunchMinutes: 0, absenceStatus: 'NA' }])[0];
    const futureHoliday = calculateRows([{ date: tomorrow, start: '', finish: '', lunchMinutes: 0, absenceStatus: 'Holiday' }])[0];
    const weekend = window.GMTTimesheetRows.addDays(today, (6 - new Date(today + 'T12:00:00Z').getUTCDay() + 7) % 7);
    addDay({ date: weekend, collapsed: true });
    const card = document.querySelector('.day-card:last-child');
    return { today, tomorrow, workError: futureWork.error, holidayError: futureHoliday.error, weekendClass: card.classList.contains('is-weekend'), weekendSummary: getComputedStyle(card.querySelector('.day-mini-summary'), '::before').content, dateMax: card.querySelector('[data-field="date"]').max };
  });
  assert.match(result.workError, /in the future/);
  assert.equal(result.holidayError, undefined);
  assert.equal(result.weekendClass, true);
  assert.match(result.weekendSummary, /Weekend/);
  assert.equal(result.dateMax, result.today);
  console.log('Weekly form blocks future work and highlights weekend days.');
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
