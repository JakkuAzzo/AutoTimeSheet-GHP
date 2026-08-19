import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
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

try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const logs = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()) && !/Failed to load resource: the server responded with a status of 404/.test(msg.text())) logs.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  await page.goto(`http://127.0.0.1:${port}/timesheets/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Clock Profile Tester', username: 'clock.tester@gmt-services.co.uk' })));
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => {
    window.__submittedForms = [];
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__submittedForms.push({
        action: this.action,
        subject: this.querySelector('[name="_subject"]')?.value || '',
        fields: [...this.querySelectorAll('input[type="hidden"]')].map((input) => [input.name, input.value]),
        files: [...this.querySelectorAll('input[type="file"]')].map((input) => ({ name: input.name, files: [...input.files] }))
      });
    };
  });

  const beforeSubmit = await page.evaluate(() => {
    const card = document.querySelector('[data-clock-form]');
    return {
      iframes: document.querySelectorAll('iframe').length,
      hiddenForms: document.querySelectorAll('form[hidden]').length,
      cards: document.querySelectorAll('[data-clock-form]').length,
      employeeName: card?.elements.employee_name.value || '',
      employeeEmail: JSON.parse(localStorage.getItem('gmt.portal.profile.v1') || '{}').username,
      action: card?.elements.clock_action.value || '',
      actionButtons: card?.querySelectorAll('[data-clock-action]').length || 0,
      date: card?.elements.clock_date.value || '',
      time: card?.elements.clock_time.value || '',
      title: document.querySelector('[data-clock-title]')?.textContent || '',
      submit: document.querySelector('[data-clock-submit]')?.textContent || ''
    };
  });
  const layout = await page.evaluate(() => {
    const card = document.querySelector('[data-clock-form]');
    const time = document.querySelector('[name="clock_time"]');
    const cardBox = card.getBoundingClientRect();
    const timeBox = time.getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      timeLeft: timeBox.left, timeRight: timeBox.right, timeWidth: timeBox.width, cardLeft: cardBox.left, cardRight: cardBox.right, cardWidth: cardBox.width
    };
  });

  const entries = [
    { action: 'clock_in', label: 'Clock In', time: '08:15', subjectKind: 'CLOCK', start: '08:15', finish: '', status: 'Recorded', worked: 0 },
    { action: 'lunch_start', label: 'Lunch Start', time: '12:30', subjectKind: 'CLOCK', start: '12:30', finish: '', status: 'Recorded', worked: 0 },
    { action: 'lunch_end', label: 'Lunch End', time: '13:00', subjectKind: 'CLOCK', start: '', finish: '13:00', status: 'Recorded', worked: 0 },
    { action: 'clock_out', label: 'Clock Out', time: '17:05', subjectKind: 'CLOCK', start: '', finish: '17:05', status: 'Recorded', worked: 0 },
    { action: 'absent', label: 'Absent', time: '', subjectKind: 'DAY', absence: 'Sick', start: '', finish: '', status: 'Absent', worked: 0 },
    { action: 'full_day', label: 'Full Day', time: '', subjectKind: 'DAY', start: '08:00', finish: '17:00', lunchStart: '12:00', lunchEnd: '13:00', status: 'Recorded', worked: 8, note: 'Workshop repair call-out.' }
  ];
  const card = page.locator('[data-clock-form]');
  await card.locator('[name="employee_name"]').fill('Clock Tester');

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    await card.locator(`[data-clock-action="${entry.action}"]`).click();
    await page.waitForFunction((action) => document.querySelector('[data-clock-form]')?.elements.clock_action.value === action, entry.action);
    if (entry.action === 'absent') {
      await card.locator('[name="absence_reason"]').selectOption(entry.absence);
    } else if (entry.action === 'full_day') {
      await card.locator('[name="day_start"]').fill(entry.start);
      await card.locator('[name="day_lunch_start"]').fill(entry.lunchStart);
      await card.locator('[name="day_lunch_end"]').fill(entry.lunchEnd);
      await card.locator('[name="day_finish"]').fill(entry.finish);
      await card.locator('.clock-note-details summary').click();
      await card.locator('[name="clock_note"]').fill(entry.note);
    } else {
      await card.locator('[name="clock_time"]').fill(entry.time);
    }
    await card.locator('[name="clock_date"]').fill('2026-07-03');
    await card.locator('button[type="submit"]').click();
    await page.waitForFunction((count) => window.__submittedForms.length === count, index + 1, { timeout: 15000 });
  }

  const result = await page.evaluate(async () => Promise.all(window.__submittedForms.map(async (form) => {
    const files = await Promise.all(form.files.map(async (entry) => ({
      name: entry.name,
      files: await Promise.all(entry.files.map(async (file) => {
        const buffer = await file.arrayBuffer();
        if (file.name.endsWith('.csv')) return { name: file.name, type: file.type, size: file.size, csv: new TextDecoder().decode(buffer) };
        const workbook = window.XLSX.read(buffer, { type: 'array' });
        return {
          name: file.name, type: file.type, size: file.size, sheets: workbook.SheetNames,
          firstAllRow: window.XLSX.utils.sheet_to_json(workbook.Sheets.All, { defval: '' })[0],
          totalsRows: window.XLSX.utils.sheet_to_json(workbook.Sheets.Totals, { header: 1, defval: '' })
        };
      }))
    })));
    return { action: form.action, subject: form.subject, fields: form.fields, files };
  })));

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.equal(beforeSubmit.iframes, 0, 'submit iframe should not exist before submit');
  assert.equal(beforeSubmit.hiddenForms, 0, 'hidden FormSubmit forms should not exist before submit');
  assert.equal(beforeSubmit.cards, 1, 'one quick record card should render');
  assert.equal(beforeSubmit.employeeName, 'Clock Profile Tester', 'clock card should inherit portal profile name');
  assert.equal(beforeSubmit.employeeEmail, 'clock.tester@gmt-services.co.uk');
  assert.equal(beforeSubmit.action, 'clock_in');
  assert.equal(beforeSubmit.actionButtons, 6, 'action row should include four clock actions, absent and full-day plus control');
  assert.match(beforeSubmit.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(beforeSubmit.time, /^\d{2}:\d{2}$/);
  assert.equal(beforeSubmit.title, 'Clock In');
  assert.equal(beforeSubmit.submit, 'Submit clock in');
  assert.equal(layout.horizontalOverflow, false, 'quick record page should not create horizontal overflow');
  assert.ok(layout.timeLeft >= layout.cardLeft && layout.timeRight <= layout.cardRight + 1 && layout.timeWidth <= layout.cardWidth, 'time input should fit inside its card');

  entries.forEach((entry, index) => {
    const form = result[index];
    const fields = new Map(form.fields);
    const fileList = form.files.flatMap((entry) => entry.files);
    const workbook = fileList.find((file) => file.name.endsWith('.xlsx'));
    const csv = fileList.find((file) => file.name.endsWith('.csv'));
    assert.equal(form.action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
    assert.equal(form.subject, `[GMT][TIMESHEET][${entry.subjectKind}] Clock Tester | ${entry.label} | 2026-07-03${entry.time ? ` ${entry.time}` : ''}`);
    assert.equal(fields.get('gmt_schema_version'), '2');
    assert.equal(fields.get('gmt_type'), 'timesheet_clock');
    assert.equal(fields.get('gmt_action'), entry.action);
    assert.equal(fields.get('gmt_employee'), 'Clock Tester');
    assert.equal(fields.get('gmt_employee_email'), 'clock.tester@gmt-services.co.uk');
    assert.equal(fields.get('gmt_clock_date'), '2026-07-03');
    assert.equal(fields.get('gmt_year'), '2026');
    assert.equal(fields.get('gmt_month'), '2026-07');
    assert.equal(fields.get('gmt_attachment_manifest'), 'xlsx,csv');
    assert.equal(fields.get('gmt_workbook_key'), 'clock-clock-tester-gmt-services-co-uk-2026-07');
    assert.equal(fields.get('gmt_filing_mode'), 'monthly-upsert');
    assert.equal(fields.get('gmt_absence_reason'), entry.absence || '');
    assert.deepEqual(form.files.map((entry) => entry.name), ['attachment', 'attachment_csv']);
    assert.equal(fileList.length, 2, 'each quick record should attach XLSX and CSV');
    assert.ok(workbook.size > 1000, 'XLSX attachment should not be empty');
    assert.deepEqual(workbook.sheets, ['All', 'Totals', 'Notes']);
    assert.equal(workbook.firstAllRow.Employee, 'Clock Tester');
    assert.equal(workbook.firstAllRow['Employee email'], 'clock.tester@gmt-services.co.uk');
    assert.equal(workbook.firstAllRow.Status, entry.status);
    assert.equal(workbook.firstAllRow.Category, entry.label);
    assert.equal(workbook.firstAllRow.Date, '2026-07-03');
    assert.equal(workbook.firstAllRow.Start, entry.start);
    assert.equal(workbook.firstAllRow.Finish, entry.finish);
    assert.equal(workbook.firstAllRow['Worked hours'], entry.worked);
    assert.match(csv.csv, /Clock Tester/);
    assert.match(csv.csv, new RegExp(entry.label));
    if (entry.absence) assert.equal(workbook.firstAllRow['Absence reason'], entry.absence);
    if (entry.action === 'full_day') {
      assert.equal(workbook.firstAllRow['Lunch start'], entry.lunchStart);
      assert.equal(workbook.firstAllRow['Lunch end'], entry.lunchEnd);
      assert.equal(workbook.firstAllRow.Note, entry.note);
      assert.equal(fields.get('gmt_worked_hours'), '8');
    }
  });

  console.log(JSON.stringify({ beforeSubmit, layout, submissions: result.map((form) => ({ action: form.action, subject: form.subject, attachments: form.files.flatMap((entry) => entry.files.map((file) => file.name)) })) }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
