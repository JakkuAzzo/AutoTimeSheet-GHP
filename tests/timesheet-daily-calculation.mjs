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

function valuesFor(row) {
  return {
    workedActual: row.workedActual,
    total: row.total,
    basic: row.basic,
    ot15: row.ot15,
    ot20: row.ot20
  };
}

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

  await page.goto(`http://127.0.0.1:${port}/timesheets/create.html`, { waitUntil: 'load' });

  const initialDefaults = await page.evaluate(() => ({
    start: document.querySelector('[data-field="start"]')?.value,
    finish: document.querySelector('[data-field="finish"]')?.value
  }));
  assert.deepEqual(initialDefaults, { start: '08:00', finish: '17:00' });

  await page.locator('#week-start').fill('2026-06-26');
  await page.locator('#week-end').fill('2026-06-30');
  await page.locator('#generate-days-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('.day-card').length === 5, null, { timeout: 5000 });

  const generatedDefaults = await page.evaluate(() => [...document.querySelectorAll('.day-card')].map((card) => ({
    date: card.querySelector('[data-field="date"]')?.value,
    start: card.querySelector('[data-field="start"]')?.value,
    finish: card.querySelector('[data-field="finish"]')?.value
  })));
  assert.deepEqual(generatedDefaults, [
    { date: '2026-06-26', start: '08:00', finish: '17:00' },
    { date: '2026-06-27', start: '08:00', finish: '17:00' },
    { date: '2026-06-28', start: '08:00', finish: '17:00' },
    { date: '2026-06-29', start: '08:00', finish: '17:00' },
    { date: '2026-06-30', start: '08:00', finish: '17:00' }
  ]);

  await page.evaluate(() => {
    const breaks = [...document.querySelectorAll('[data-field="lunchHad"]')];
    breaks[0].value = '0';
    breaks[1].value = '60';
    breaks[2].value = '60';
    breaks[3].value = '0';
    breaks[4].value = '0';
    const finishes = [...document.querySelectorAll('[data-field="finish"]')];
    finishes[3].value = '13:00';
    finishes[4].value = '13:00';
    const absences = [...document.querySelectorAll('[data-field="absenceStatus"]')];
    absences[3].value = 'Time Off';
    breaks.forEach((select) => select.dispatchEvent(new Event('change', { bubbles: true })));
    finishes.forEach((input) => input.dispatchEvent(new Event('input', { bubbles: true })));
    absences.forEach((select) => select.dispatchEvent(new Event('change', { bubbles: true })));
  });
  await page.waitForTimeout(250);

  const result = await page.evaluate(() => ({
    pills: [...document.querySelectorAll('.day-result')].map((resultEl) => (
      [...resultEl.querySelectorAll('span')].map((span) => span.textContent.replace(/\s+/g, ' ').trim()).join(' ')
    )),
    summary: [...document.querySelectorAll('#summary-output > div')].map((item) => ({
      label: item.querySelector('strong')?.textContent.trim(),
      value: item.querySelector('span')?.textContent.trim()
    })),
    calculatedSummary: document.querySelector('#calculated-summary')?.value || '',
    payload: JSON.parse(document.querySelector('#timesheet-payload').value),
    exportHeaders: Object.keys(allRowsForExport(JSON.parse(document.querySelector('#timesheet-payload').value).rows)[0] || {})
  }));

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.match(result.pills[0], /Friday Worked - 9h 00m Basic - 8h 00m OT 1\.5 - 1h 00m OT 2\.0 - 0h 00m/);
  assert.match(result.pills[1], /Saturday Worked - 8h 00m Basic - 0h 00m OT 1\.5 - 5h 00m OT 2\.0 - 3h 00m/);
  assert.match(result.pills[2], /Sunday Worked - 8h 00m Basic - 0h 00m OT 1\.5 - 0h 00m OT 2\.0 - 8h 00m/);
  assert.match(result.pills[3], /Monday Worked - 5h 00m Basic - 5h 00m OT 1\.5 - 0h 00m OT 2\.0 - 0h 00m/);
  assert.match(result.pills[4], /Tuesday Worked - 8h 00m Basic - 8h 00m OT 1\.5 - 0h 00m OT 2\.0 - 0h 00m/);
  assert.equal(result.pills.some((text) => text.includes('Paid -')), false);

  assert.deepEqual(valuesFor(result.payload.rows[0]), { workedActual: 540, total: 540, basic: 480, ot15: 60, ot20: 0 });
  assert.deepEqual(valuesFor(result.payload.rows[1]), { workedActual: 480, total: 480, basic: 0, ot15: 300, ot20: 180 });
  assert.deepEqual(valuesFor(result.payload.rows[2]), { workedActual: 480, total: 480, basic: 0, ot15: 0, ot20: 480 });
  assert.deepEqual(valuesFor(result.payload.rows[3]), { workedActual: 300, total: 300, basic: 300, ot15: 0, ot20: 0 });
  assert.deepEqual(valuesFor(result.payload.rows[4]), { workedActual: 480, total: 480, basic: 480, ot15: 0, ot20: 0 });
  assert.deepEqual(result.payload.rows.map((row) => ({
    appliedBasic: row.appliedBasic,
    appliedOt15: row.appliedOt15,
    appliedOt20: row.appliedOt20,
    overtimeHeld: row.overtimeHeld
  })), [
    { appliedBasic: 480, appliedOt15: 0, appliedOt20: 0, overtimeHeld: true },
    { appliedBasic: 0, appliedOt15: 0, appliedOt20: 0, overtimeHeld: true },
    { appliedBasic: 0, appliedOt15: 0, appliedOt20: 0, overtimeHeld: true },
    { appliedBasic: 300, appliedOt15: 0, appliedOt20: 0, overtimeHeld: false },
    { appliedBasic: 480, appliedOt15: 0, appliedOt20: 0, overtimeHeld: false }
  ]);
  assert.deepEqual(valuesFor(result.payload.totals), { workedActual: 2280, total: 1260, basic: 1260, ot15: 0, ot20: 0 });
  assert.deepEqual(result.summary.slice(0, 5), [
    { label: 'Worked hours', value: '38h 00m' },
    { label: 'Basic', value: '21h 00m' },
    { label: 'OT x1.5', value: '0h 00m' },
    { label: 'OT x2.0', value: '0h 00m' },
    { label: 'Weighted hours', value: '21.00h' }
  ]);
  assert.equal(result.summary.some((item) => /paid/i.test(item.label)), false);
  assert.equal(/paid/i.test(result.calculatedSummary), false);
  assert.equal(result.exportHeaders.some((header) => /paid/i.test(header)), false);
  assert.deepEqual(result.exportHeaders.filter((header) => /Basic|Worked|OT/.test(header)), [
    'Worked hours',
    'Basic hours',
    'OT x1.5 hours',
    'OT x2.0 hours'
  ]);

  await page.locator('#week-start').fill('2026-06-22');
  await page.locator('#week-end').fill('2026-06-26');
  await page.locator('#generate-days-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('.day-card').length === 5, null, { timeout: 5000 });
  await page.waitForTimeout(250);

  const thresholdResult = await page.evaluate(() => ({
    summary: [...document.querySelectorAll('#summary-output > div')].map((item) => ({
      label: item.querySelector('strong')?.textContent.trim(),
      value: item.querySelector('span')?.textContent.trim()
    })),
    payload: JSON.parse(document.querySelector('#timesheet-payload').value),
    exportRows: allRowsForExport(JSON.parse(document.querySelector('#timesheet-payload').value).rows)
  }));
  assert.deepEqual(valuesFor(thresholdResult.payload.totals), { workedActual: 2700, total: 2700, basic: 2400, ot15: 300, ot20: 0 });
  assert.deepEqual(thresholdResult.summary.slice(0, 5), [
    { label: 'Worked hours', value: '45h 00m' },
    { label: 'Basic', value: '40h 00m' },
    { label: 'OT x1.5', value: '5h 00m' },
    { label: 'OT x2.0', value: '0h 00m' },
    { label: 'Weighted hours', value: '47.50h' }
  ]);
  assert.equal(thresholdResult.exportRows.reduce((sum, row) => sum + row['OT x1.5 hours'], 0), 5);
  assert.equal(thresholdResult.exportRows.some((row) => /below 40h/.test(row.Note)), false);

  console.log(JSON.stringify({
    pills: result.pills,
    summary: result.summary,
    exportHeaders: result.exportHeaders,
    totals: valuesFor(result.payload.totals),
    thresholdTotals: valuesFor(thresholdResult.payload.totals)
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
