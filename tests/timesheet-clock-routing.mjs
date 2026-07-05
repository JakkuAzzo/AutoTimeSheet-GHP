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
        fields: [...this.querySelectorAll('input[type="hidden"]')].map((input) => [input.name, input.value]),
        files: [...this.querySelectorAll('input[type="file"]')].map((input) => ({
          name: input.name,
          files: [...input.files]
        }))
      });
    };
  });

  const beforeSubmit = await page.evaluate(() => ({
    iframes: document.querySelectorAll('iframe').length,
    hiddenForms: document.querySelectorAll('form[hidden]').length,
    cards: document.querySelectorAll('[data-clock-form]').length,
    action: document.querySelector('[data-clock-form]')?.elements.clock_action.value || '',
    date: document.querySelector('[data-clock-form]')?.elements.clock_date.value || '',
    time: document.querySelector('[data-clock-form]')?.elements.clock_time.value || '',
    title: document.querySelector('[data-clock-title]')?.textContent || '',
    description: document.querySelector('[data-clock-description]')?.textContent || '',
    submit: document.querySelector('[data-clock-submit]')?.textContent || ''
  }));
  const layout = await page.evaluate(() => {
    const card = document.querySelector('[data-clock-form]');
    const date = document.querySelector('[name="clock_date"]');
    const time = document.querySelector('[name="clock_time"]');
    const cardBox = card.getBoundingClientRect();
    const dateBox = date.getBoundingClientRect();
    const timeBox = time.getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      cardLeft: cardBox.left,
      cardRight: cardBox.right,
      dateLeft: dateBox.left,
      dateRight: dateBox.right,
      dateWidth: dateBox.width,
      timeLeft: timeBox.left,
      timeRight: timeBox.right,
      timeWidth: timeBox.width,
      cardWidth: cardBox.width
    };
  });

  const submissions = [
    {
      value: 'clock_in',
      label: 'Clock In',
      time: '08:15',
      description: 'Record an arrival time and send it to accounts.',
      submit: 'Submit clock in',
      start: '08:15',
      finish: ''
    },
    {
      value: 'lunch_start',
      label: 'Lunch Start',
      time: '12:30',
      description: 'Record when lunch starts and send it to accounts.',
      submit: 'Submit lunch start',
      start: '12:30',
      finish: ''
    },
    {
      value: 'lunch_end',
      label: 'Lunch End',
      time: '13:00',
      description: 'Record when lunch ends and send it to accounts.',
      submit: 'Submit lunch end',
      start: '',
      finish: '13:00'
    },
    {
      value: 'clock_out',
      label: 'Clock Out',
      time: '17:05',
      description: 'Record a finish time and send it to accounts.',
      submit: 'Submit clock out',
      start: '',
      finish: '17:05'
    }
  ];
  const card = page.locator('[data-clock-form]');
  await card.locator('[name="employee_name"]').fill('Clock Tester');
  const actionStates = [];
  for (let index = 0; index < submissions.length; index += 1) {
    const submission = submissions[index];
    if (index > 0) {
      await card.locator('[name="clock_action"]').selectOption(submission.value);
      await page.waitForFunction((title) => document.querySelector('[data-clock-title]')?.textContent === title, submission.label, { timeout: 5000 });
    }
    actionStates.push(await page.evaluate(() => ({
      title: document.querySelector('[data-clock-title]')?.textContent || '',
      description: document.querySelector('[data-clock-description]')?.textContent || '',
      submit: document.querySelector('[data-clock-submit]')?.textContent || ''
    })));
    await card.locator('[name="clock_date"]').fill('2026-07-03');
    await card.locator('[name="clock_time"]').fill(submission.time);
    await card.locator('button[type="submit"]').click();
    await page.waitForFunction((count) => window.__submittedForms.length === count, index + 1, { timeout: 15000 });
  }

  const result = await page.evaluate(async () => Promise.all(window.__submittedForms.map(async (form) => {
    const files = await Promise.all(form.files.map(async (entry) => ({
      name: entry.name,
      files: await Promise.all(entry.files.map(async (file) => {
        const buffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(buffer, { type: 'array' });
        const allRows = window.XLSX.utils.sheet_to_json(workbook.Sheets.All, { defval: '' });
        const totalsRows = window.XLSX.utils.sheet_to_json(workbook.Sheets.Totals, { header: 1, defval: '' });
        return {
          name: file.name,
          type: file.type,
          size: file.size,
          sheets: workbook.SheetNames,
          firstAllRow: allRows[0],
          totalsRows
        };
      }))
    })));
    return {
      action: form.action,
      subject: form.subject,
      fields: form.fields,
      files
    };
  })));

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.equal(beforeSubmit.iframes, 0, 'clock submit iframe should not exist before submit');
  assert.equal(beforeSubmit.hiddenForms, 0, 'hidden FormSubmit forms should not exist before submit');
  assert.equal(beforeSubmit.cards, 1, 'one dynamic clock card should render');
  assert.equal(beforeSubmit.action, 'clock_in');
  assert.match(beforeSubmit.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(beforeSubmit.time, /^\d{2}:\d{2}$/);
  assert.equal(beforeSubmit.title, 'Clock In');
  assert.equal(beforeSubmit.description, 'Record an arrival time and send it to accounts.');
  assert.equal(beforeSubmit.submit, 'Submit clock in');
  assert.equal(layout.horizontalOverflow, false, 'clock page should not create horizontal overflow');
  assert.ok(layout.dateLeft >= layout.cardLeft, 'date input should not overflow card left edge');
  assert.ok(layout.dateRight <= layout.cardRight + 1, 'date input should not overflow card right edge');
  assert.ok(layout.dateWidth <= layout.cardWidth, 'date input should fit inside the card');
  assert.ok(layout.timeLeft >= layout.cardLeft, 'time input should not overflow card left edge');
  assert.ok(layout.timeRight <= layout.cardRight + 1, 'time input should not overflow card right edge');
  assert.ok(layout.timeWidth <= layout.cardWidth, 'time input should fit inside the card');
  assert.equal(actionStates.length, submissions.length);

  submissions.forEach((submission, index) => {
    const fields = new Map(result[index].fields);
    const workbook = result[index].files[0]?.files[0];
    assert.equal(actionStates[index].title, submission.label);
    assert.equal(actionStates[index].description, submission.description);
    assert.equal(actionStates[index].submit, submission.submit);
    assert.equal(result[index].action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
    assert.equal(result[index].subject, `[GMT][TIMESHEET][CLOCK] Clock Tester | ${submission.label} | 2026-07-03 ${submission.time}`);
    assert.equal(fields.get('gmt_type'), 'timesheet_clock');
    assert.equal(fields.get('gmt_action'), submission.value);
    assert.equal(fields.get('gmt_employee'), 'Clock Tester');
    assert.equal(fields.get('gmt_clock_date'), '2026-07-03');
    assert.equal(fields.get('clock_action'), submission.label);
    assert.equal(fields.get('clock_date'), '2026-07-03');
    assert.equal(fields.get('clock_time'), submission.time);
    assert.equal(fields.get('gmt_attachment_type'), 'xlsx');
    assert.equal(result[index].files[0]?.name, 'attachment');
    assert.equal(workbook.name, `GMT Clock - Clock Tester - 2026-07-03 - ${submission.label}.xlsx`);
    assert.equal(workbook.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(workbook.size > 1000, `${submission.label} workbook should not be empty`);
    assert.deepEqual(workbook.sheets, ['All', 'Totals', 'Notes']);
    assert.equal(workbook.firstAllRow.Status, 'Recorded');
    assert.equal(workbook.firstAllRow.Category, submission.label);
    assert.equal(workbook.firstAllRow.Date, '2026-07-03');
    assert.equal(workbook.firstAllRow.Start, submission.start);
    assert.equal(workbook.firstAllRow.Finish, submission.finish);
    assert.equal(workbook.firstAllRow['Worked hours'], 0);
  });

  console.log(JSON.stringify({
    beforeSubmit,
    layout,
    actionStates,
    forms: result.map((form) => ({
      action: form.action,
      subject: form.subject,
      attachments: form.files.flatMap((entry) => entry.files.map((file) => file.name))
    }))
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
