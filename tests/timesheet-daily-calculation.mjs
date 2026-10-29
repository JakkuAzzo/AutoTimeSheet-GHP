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
    res.end(readFileSync(filePath, 'utf8').replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false'));
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

  const periodUi = await page.evaluate(() => {
    const legacy = document.querySelector('.timesheet-period-legacy');
    const planner = document.querySelector('#absence-planner');
    return {
      payMonth: document.querySelector('#timesheet-pay-month-display')?.textContent.trim() || '',
      period: document.querySelector('#timesheet-period-display')?.textContent.trim() || '',
      legacyAriaHidden: legacy?.getAttribute('aria-hidden') || '',
      legacyOpacity: legacy ? getComputedStyle(legacy).opacity : '',
      legacyPointerEvents: legacy ? getComputedStyle(legacy).pointerEvents : '',
      absencePlannerOpen: Boolean(planner?.open)
    };
  });
  assert.match(periodUi.payMonth, /^[A-Z][a-z]+ \d{4}$/);
  assert.match(periodUi.period, /^Cycle start: .+\. Cycle end: .+\. Payroll Friday: .+\. Entry dates route to .+\.$/);
  assert.equal(periodUi.legacyAriaHidden, 'true');
  assert.equal(periodUi.legacyOpacity, '0');
  assert.equal(periodUi.legacyPointerEvents, 'none');
  assert.equal(periodUi.absencePlannerOpen, false);

  await page.evaluate(() => {
    localStorage.setItem('gmt_guest_timesheet_manual_draft_v1', JSON.stringify({ rows: [] }));
    localStorage.setItem('gmt_guest_timesheet_manual_draft_v2:stale-profile', JSON.stringify({ rows: [] }));
  });
  await page.locator('#clear-draft-btn').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('gmt_guest_timesheet_manual_draft_v1')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('gmt_guest_timesheet_manual_draft_v2:stale-profile')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('gmt_guest_timesheet_draft_cleared_v1')), '1');

  const initialDefaults = await page.evaluate(() => ({
    start: document.querySelector('[data-field="start"]')?.value,
    finish: document.querySelector('[data-field="finish"]')?.value
  }));
  assert.deepEqual(initialDefaults, { start: '08:00', finish: '17:00' });

  // A plausible-looking zero-length shift must be rejected so it cannot be
  // selected as a valid calendar version or contribute hours.
  await page.evaluate(() => {
    const card = document.querySelector('.day-card');
    const start = card.querySelector('[data-field="start"]');
    const finish = card.querySelector('[data-field="finish"]');
    start.value = '05:00';
    finish.value = '05:00';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    finish.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const equalTimeResult = await page.evaluate(() => ({
    result: document.querySelector('.day-card .day-result')?.textContent.replace(/\s+/g, ' ').trim() || '',
    row: JSON.parse(document.querySelector('#timesheet-payload').value).rows[0]
  }));
  assert.match(equalTimeResult.result, /Start and finish cannot be the same time/);
  assert.equal(equalTimeResult.row.workedActual, null);

  const pmEquivalentResult = await page.evaluate(() => calculateRows([{
    date: '2026-10-12', start: '07:00', finish: '05:30', lunchMinutes: 0, absenceStatus: 'NA'
  }])[0]);
  assert.equal(pmEquivalentResult.workedActual, 630, '07:00–05:30 should use the plausible 17:30 PM-equivalent finish, not a 22h30 overnight shift');
  assert.equal(pmEquivalentResult.finish, '17:30');
  assert.equal(pmEquivalentResult.finishCorrection, 'PM equivalent');
  const pmEquivalentExport = await page.evaluate(() => allRowsForExport(calculateRows([{
    date: '2026-10-12', start: '07:00', finish: '05:30', lunchMinutes: 0, absenceStatus: 'NA'
  }]))[0]);
  assert.match(pmEquivalentExport.Note, /Finish 05:30 interpreted as 17:30 \(PM equivalent\)/);

  const explicitOvernightResult = await page.evaluate(() => calculateRows([{
    date: '2026-10-12', start: '07:00', finish: '05:30', finishNextDay: true, lunchMinutes: 0, absenceStatus: 'NA'
  }])[0]);
  assert.equal(explicitOvernightResult.workedActual, 1350, 'the explicit next-day option must preserve a genuine 22h30 shift');

  await page.evaluate(() => {
    const finish = document.querySelector('.day-card [data-field="finish"]');
    finish.value = '17:00';
    finish.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);

  await page.locator('#week-start').fill('2026-10-12');
  await page.locator('#week-end').fill('2026-10-16');
  await page.locator('#generate-days-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('.day-card').length === 5, null, { timeout: 5000 });

  const generatedDefaults = await page.evaluate(() => [...document.querySelectorAll('.day-card')].map((card) => ({
    date: card.querySelector('[data-field="date"]')?.value,
    start: card.querySelector('[data-field="start"]')?.value,
    finish: card.querySelector('[data-field="finish"]')?.value
  })));
  assert.deepEqual(generatedDefaults, [
    { date: '2026-10-12', start: '08:00', finish: '17:00' },
    { date: '2026-10-13', start: '08:00', finish: '17:00' },
    { date: '2026-10-14', start: '08:00', finish: '17:00' },
    { date: '2026-10-15', start: '08:00', finish: '17:00' },
    { date: '2026-10-16', start: '08:00', finish: '17:00' }
  ]);

  await page.evaluate(() => {
    const card = document.querySelector('.day-card');
    const start = card.querySelector('[data-field="start"]');
    const finish = card.querySelector('[data-field="finish"]');
    card.querySelector('[data-field="lunchHad"]').value = '0';
    start.value = '07:00';
    finish.value = '05:30';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    finish.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const pmEquivalentPreview = await page.evaluate(() => ({
    result: document.querySelector('.day-card .day-result')?.textContent.replace(/\s+/g, ' ').trim() || '',
    row: JSON.parse(document.querySelector('#timesheet-payload').value).rows[0]
  }));
  assert.match(pmEquivalentPreview.result, /Finish treated as 17:30 \(PM equivalent\)/);
  assert.equal(pmEquivalentPreview.row.finish, '17:30');
  assert.equal(pmEquivalentPreview.row.sourceFinish, '05:30');
  assert.equal(pmEquivalentPreview.row.workedActual, 630);

  await page.evaluate(() => {
    const checkbox = document.querySelector('.day-card [data-field="finishNextDay"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const overnightPreview = await page.evaluate(() => JSON.parse(document.querySelector('#timesheet-payload').value).rows[0]);
  assert.equal(overnightPreview.finishNextDay, true);
  assert.equal(overnightPreview.workedActual, 1350);
  await page.evaluate(() => {
    const checkbox = document.querySelector('.day-card [data-field="finishNextDay"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    const card = document.querySelector('.day-card');
    const start = card.querySelector('[data-field="start"]');
    const finish = card.querySelector('[data-field="finish"]');
    start.value = '08:00';
    finish.value = '17:00';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    finish.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const breaks = [...document.querySelectorAll('[data-field="lunchHad"]')];
    breaks[0].value = '0';
    breaks[1].value = '60';
    breaks[2].value = '60';
    breaks[3].value = '0';
    breaks[4].value = '0';
    const finishes = [...document.querySelectorAll('[data-field="finish"]')];
    finishes[3].value = '13:00';
    finishes[4].value = '16:00';
    const absences = [...document.querySelectorAll('[data-field="absenceStatus"]')];
    absences[3].value = 'Time Off';
    absences[4].value = 'Un-Paid';
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
    exportHeaders: Object.keys(allRowsForExport(JSON.parse(document.querySelector('#timesheet-payload').value).rows)[0] || {}),
    exportRows: allRowsForExport(JSON.parse(document.querySelector('#timesheet-payload').value).rows),
    staleUnpaid: calculateRows([{ date: '2026-10-16', start: '08:00', finish: '17:00', lunchMinutes: 0, absenceStatus: 'Un-Paid', workedMinutes: 540, workedHours: 9, totalMinutes: 540, basicHours: 8, ot15Hours: 1, ot20Hours: 2, weightedHours: 13, appliedBasic: 480, appliedOt15: 60, appliedOt20: 120, appliedTotal: 660 }])[0]
  }));

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.match(result.pills[0], /Monday Worked - 9h 00m Basic - 9h 00m OT 1\.5 - 0h 00m OT 2\.0 - 0h 00m/);
  assert.match(result.pills[1], /Tuesday Worked - 8h 00m Basic - 8h 00m OT 1\.5 - 0h 00m OT 2\.0 - 0h 00m/);
  assert.match(result.pills[2], /Wednesday Worked - 8h 00m Basic - 8h 00m OT 1\.5 - 0h 00m OT 2\.0 - 0h 00m/);
  assert.match(result.pills[3], /Thursday Worked - 5h 00m Basic - 5h 00m OT 1\.5 - 0h 00m OT 2\.0 - 0h 00m/);
  assert.match(result.pills[4], /Friday Worked - 0h 00m Basic - 0h 00m OT 1\.5 - 0h 00m OT 2\.0 - 0h 00m/);
  assert.equal(result.pills.some((text) => text.includes('Paid -')), false);

  assert.deepEqual(valuesFor(result.payload.rows[0]), { workedActual: 540, total: 540, basic: 480, ot15: 60, ot20: 0 });
  assert.deepEqual(valuesFor(result.payload.rows[1]), { workedActual: 480, total: 480, basic: 480, ot15: 0, ot20: 0 });
  assert.deepEqual(valuesFor(result.payload.rows[2]), { workedActual: 480, total: 480, basic: 480, ot15: 0, ot20: 0 });
  assert.deepEqual(valuesFor(result.payload.rows[3]), { workedActual: 300, total: 300, basic: 300, ot15: 0, ot20: 0 });
  assert.deepEqual(valuesFor(result.payload.rows[4]), { workedActual: 0, total: 0, basic: 0, ot15: 0, ot20: 0 });
  assert.equal(result.payload.rows[4].date, '2026-10-16', 'the 16th should be available as Un-Paid time off');
  assert.equal(result.payload.rows[4].absenceStatus, 'Un-Paid');
  assert.equal(result.payload.rows[4].reportedWorkedMinutes, 480, 'retain the clock-derived value separately for audit');
  assert.deepEqual({
    workedMinutes: result.staleUnpaid.workedMinutes,
    workedHours: result.staleUnpaid.workedHours,
    totalMinutes: result.staleUnpaid.totalMinutes,
    basicHours: result.staleUnpaid.basicHours,
    ot15Hours: result.staleUnpaid.ot15Hours,
    ot20Hours: result.staleUnpaid.ot20Hours,
    weightedHours: result.staleUnpaid.weightedHours,
    appliedBasic: result.staleUnpaid.appliedBasic,
    appliedOt15: result.staleUnpaid.appliedOt15,
    appliedOt20: result.staleUnpaid.appliedOt20,
    appliedTotal: result.staleUnpaid.appliedTotal
  }, { workedMinutes: 0, workedHours: 0, totalMinutes: 0, basicHours: 0, ot15Hours: 0, ot20Hours: 0, weightedHours: 0, appliedBasic: 0, appliedOt15: 0, appliedOt20: 0, appliedTotal: 0 }, 'Un-Paid must override stale row and payroll values in the entry calculator');
  assert.equal(result.exportRows.find((row) => row.Date === '2026-10-16')['Worked hours'], 0, 'payroll exports must carry zero on an Un-Paid row');
  assert.deepEqual(result.payload.rows.map((row) => ({
    appliedBasic: row.appliedBasic,
    appliedOt15: row.appliedOt15,
    appliedOt20: row.appliedOt20,
    overtimeHeld: row.overtimeHeld
  })), [
    { appliedBasic: 540, appliedOt15: 0, appliedOt20: 0, overtimeHeld: true },
    { appliedBasic: 480, appliedOt15: 0, appliedOt20: 0, overtimeHeld: false },
    { appliedBasic: 480, appliedOt15: 0, appliedOt20: 0, overtimeHeld: false },
    { appliedBasic: 300, appliedOt15: 0, appliedOt20: 0, overtimeHeld: false },
    { appliedBasic: 0, appliedOt15: 0, appliedOt20: 0, overtimeHeld: false }
  ]);
  assert.deepEqual(valuesFor(result.payload.totals), { workedActual: 1800, total: 1800, basic: 1800, ot15: 0, ot20: 0 });
  assert.deepEqual(result.summary.slice(0, 5), [
    { label: 'Worked hours', value: '30h 00m' },
    { label: 'Basic', value: '30h 00m' },
    { label: 'OT x1.5', value: '0h 00m' },
    { label: 'OT x2.0', value: '0h 00m' },
    { label: 'Weighted hours', value: '30.00h' }
  ]);
  assert.ok(result.summary.some((item) => item.label === 'Un-Paid days' && item.value === '1'));
  assert.match(result.calculatedSummary, /Un-Paid 1/);
  assert.equal(result.exportHeaders.some((header) => /paid/i.test(header)), false);
  assert.deepEqual(result.exportHeaders.filter((header) => /Basic|Worked|OT/.test(header)), [
    'Worked hours',
    'Basic hours',
    'OT x1.5 hours',
    'OT x2.0 hours'
  ]);

  await page.locator('.day-card[data-day-date="2026-10-13"] .remove-day').click();
  await page.locator('.day-card[data-day-date="2026-10-14"] .remove-day').click();
  await page.locator('#week-start').fill('2026-10-05');
  await page.locator('#week-end').fill('2026-10-09');
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
