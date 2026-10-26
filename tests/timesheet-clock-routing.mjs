import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTimesheetWorkbook, parseCsvThroughOfficeScript } from './helpers/monthly-timesheet-office-script.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, firefox, webkit } = require('playwright');
const browserTypes = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit]
];
const requestedBrowsers = String(process.env.CLOCK_TEST_BROWSERS || '').split(',').map((name) => name.trim()).filter(Boolean);
const selectedBrowsers = requestedBrowsers.length
  ? browserTypes.filter(([name]) => requestedBrowsers.includes(name))
  : browserTypes;
if (!selectedBrowsers.length) throw new Error('CLOCK_TEST_BROWSERS must name chromium, firefox or webkit.');

const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, rawPath));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  if (rawPath === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    const config = readFileSync(filePath, 'utf8')
      // Never let a local test read a live FormSubmit route or recipient.
      .replace(/(timesheetFormSubmitEndpoint:\s*)(["'])[^"']*\2/, '$1"https://formsubmit.co/clock-test-endpoint"')
      .replace(/(formSubmitTimesheetEndpoint:\s*)(["'])[^"']*\2/, '$1""')
      .replace(/(formSubmitEndpoint:\s*)(["'])[^"']*\2/, '$1""')
      .replace(/(fallbackFormSubmitEndpoint:\s*)(["'])[^"']*\2/, '$1""')
      .replace(/(contactFormSubmitEndpoint:\s*)(["'])[^"']*\2/, '$1""')
      .replace(/(formSubmitCc:\s*)(["'])[^"']*\2/, '$1"test-recipient@example.test"')
      .replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false')
      // This suite validates the email-only clock transport. Avoid an
      // unauthenticated protected API request in the local harness.
      .replace(/(portalApiEndpoint:\s*)"[^"]*"/, '$1""')
      .replace(/(portalHistoryEndpoint:\s*)"[^"]*"/, '$1""');
    res.end(config);
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
  for (const [browserName, browserType] of selectedBrowsers) {
    const launchOptions = { headless: true };
    if (browserName === 'chromium' && existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await browserType.launch(launchOptions);
    const pageOptions = { viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London' };
    // Playwright Firefox does not implement isMobile. Keep its explicit mobile
    // viewport so responsive CSS is still exercised in the same test matrix.
    if (browserName !== 'firefox') pageOptions.isMobile = true;
    const page = await browser.newPage(pageOptions);
    await page.clock.install({ time: new Date('2026-10-16T15:00:00.000Z') });
    await page.addInitScript(() => {
      window.__submittedForms = [];
      window.__fetchResponses = [];
      window.__holdNextFetchResponse = false;
      window.__releaseFetchResponse = null;
      window.__queueFetchResponse = (status) => window.__fetchResponses.push(status);
      window.fetch = async (input, init = {}) => {
        const body = init && init.body;
        if (body instanceof FormData) {
          const entries = [...body.entries()];
          window.__submittedForms.push({
            action: typeof input === 'string' ? input : input?.url || '',
            referrerPolicy: init.referrerPolicy,
            subject: entries.find(([name]) => name === '_subject')?.[1] || '',
            fields: entries.filter(([, value]) => !(value instanceof File)).map(([name, value]) => [name, value]),
            files: entries.filter(([, value]) => value instanceof File).map(([name, value]) => ({ name, files: [value] }))
          });
        }
        if (window.__holdNextFetchResponse) {
          window.__holdNextFetchResponse = false;
          await new Promise((resolve) => { window.__releaseFetchResponse = resolve; });
        }
        const status = window.__fetchResponses.shift() || 200;
        return new Response(JSON.stringify(status < 400 ? { success: true } : { success: false, message: 'Synthetic test failure' }), { status, headers: { 'content-type': 'application/json' } });
      };
    });
    const logs = [];
    page.on('console', (msg) => {
      const driverLayoutWarning = /chrome:\/\/juggler\/content\/content\/main\.js/.test(msg.text());
      if (['error', 'warning'].includes(msg.type()) && !driverLayoutWarning && !/Failed to load resource: the server responded with a status of 404/.test(msg.text())) logs.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

    // The daily clock-in form lives on the authenticated dashboard; the weekly
    // timesheet landing page does not render it.
    await page.goto(`http://127.0.0.1:${port}/portal/`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'TEST Clock QA', username: 'test-clock@example.test' })));
    await page.reload({ waitUntil: 'load' });
    const responsiveContext = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      mobileBreakpoint: window.matchMedia('(max-width: 600px)').matches,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }));
    assert.deepEqual(responsiveContext, {
      width: 390, height: 844, mobileBreakpoint: true, timeZone: 'Europe/London'
    }, `${browserName} must run the routing checks with the intended mobile viewport and London timezone`);
    // This suite inspects multipart contents and failure/retry behavior. Keep
    // every submit inside the browser mock, never at the FormSubmit route.
    await page.evaluate(() => { window.GMTClockTransport.shouldUseNativeFallback = () => false; });

  const beforeSubmit = await page.evaluate(() => {
    const card = document.querySelector('[data-clock-form]');
    return {
      iframes: document.querySelectorAll('iframe').length,
      hiddenForms: document.querySelectorAll('form[hidden]').length,
      cards: document.querySelectorAll('[data-clock-form]').length,
      employeeName: card?.elements.employee_name.value || '',
      employeeEmail: JSON.parse(localStorage.getItem('gmt.portal.profile.v1') || '{}').username,
      action: card?.elements.clock_action.value || '',
      locationMode: card?.elements.clock_location_mode.value || '',
      actionButtons: card?.querySelectorAll('[data-clock-action]').length || 0,
      date: card?.elements.clock_date.value || '',
      time: card?.elements.clock_time.value || '',
      locationMaxLength: card?.elements.clock_location.maxLength || 0,
      locationControlHidden: card?.querySelector('.clock-location-control')?.hidden ?? false,
      locationDisabled: card?.elements.clock_location.disabled ?? false,
      noteMaxLength: card?.elements.clock_note.maxLength || 0,
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

  const futureCard = page.locator('[data-clock-form]');
  await futureCard.locator('[name="employee_name"]').fill('TEST Clock QA');
  await futureCard.locator('[name="clock_date"]').fill('2026-10-16');
  await futureCard.locator('[name="clock_time"]').fill('16:01');
  await futureCard.locator('[data-clock-submit]').click();
  await page.waitForTimeout(100);
  const futureTimeAttempt = await page.evaluate(() => ({
    requests: window.__submittedForms.length,
    status: document.querySelector('.clock-status')?.textContent || ''
  }));
  assert.equal(futureTimeAttempt.requests, 0, 'a future same-day clock event must be rejected before delivery');
  assert.match(futureTimeAttempt.status, /future clock time/i);

  await futureCard.locator('[name="clock_time"]').fill('15:00');
  await page.evaluate(() => window.__queueFetchResponse(503));
  await futureCard.locator('[data-clock-submit]').click();
  await page.waitForFunction(() => window.__submittedForms.length === 1);
  await page.waitForFunction(() => /Timesheet delivery failed \(503\)/.test(document.querySelector('.clock-status')?.textContent || ''));
  const failedAttempt = await page.evaluate(() => ({
    fields: Object.fromEntries(window.__submittedForms[0].fields),
    hiddenForms: document.querySelectorAll('form[hidden]').length,
    status: document.querySelector('.clock-status')?.textContent || ''
  }));
  assert.equal(failedAttempt.hiddenForms, 0, 'failed hidden forms must be removed so a retry starts cleanly');

  await futureCard.locator('[data-clock-submit]').click();
  await page.waitForFunction(() => window.__submittedForms.length === 2);
  await page.waitForFunction(() => /Clock In saved/.test(document.querySelector('.clock-status')?.textContent || ''));
  const retryAttempt = await page.evaluate(() => ({
    fields: Object.fromEntries(window.__submittedForms[1].fields),
    hiddenForms: document.querySelectorAll('form[hidden]').length,
    status: document.querySelector('.clock-status')?.textContent || ''
  }));
  assert.equal(retryAttempt.fields.gmt_record_id, failedAttempt.fields.gmt_record_id, 'retry must reuse the event ID for idempotent filing');
  assert.equal(retryAttempt.hiddenForms, 0);
  assert.match(retryAttempt.status, /Clock In saved/);

  const card = page.locator('[data-clock-form]');
  await card.locator('[name="clock_date"]').fill('2026-08-30');
  await card.locator('[name="clock_time"]').fill('08:00');
  await page.evaluate(() => { window.__holdNextFetchResponse = true; });
  await card.locator('[data-clock-submit]').click();
  await page.waitForFunction(() => window.__submittedForms.length === 3);
  await card.evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.__submittedForms.length), 3, 'a second submit while delivery is pending must not create a duplicate request');
  await page.evaluate(() => window.__releaseFetchResponse?.());
  await page.waitForFunction(() => /Clock In saved/.test(document.querySelector('.clock-status')?.textContent || ''));

  const entries = [
    { action: 'clock_in', label: 'Clock In', time: '08:15', subjectKind: 'CLOCK', start: '08:15', finish: '', status: 'Recorded', worked: 0 },
    { action: 'lunch_start', label: 'Lunch Start', time: '12:30', subjectKind: 'CLOCK', start: '12:30', finish: '', status: 'Recorded', worked: 0 },
    { action: 'lunch_end', label: 'Lunch End', time: '13:00', subjectKind: 'CLOCK', start: '', finish: '13:00', status: 'Recorded', worked: 0 },
    { action: 'clock_out', label: 'Clock Out', time: '17:05', subjectKind: 'CLOCK', start: '', finish: '17:05', status: 'Recorded', worked: 0 },
    { action: 'absent', label: 'Absent', time: '', subjectKind: 'DAY', absence: 'Sick', start: '', finish: '', status: 'Absent', worked: 0 },
    { action: 'full_day', label: 'Full Day', time: '', subjectKind: 'DAY', start: '08:00', finish: '17:00', lunchStart: '12:00', lunchEnd: '13:00', status: 'Recorded', worked: 8, note: 'Workshop repair call-out.' }
  ];
  await card.locator('[name="employee_name"]').fill('TEST Clock QA');

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
    await card.locator('[name="clock_date"]').fill('2026-08-31');
    await card.locator('button[type="submit"]').click();
    await page.waitForFunction((count) => window.__submittedForms.length === count, index + 4, { timeout: 15000 });
  }

  const allResults = await page.evaluate(async () => Promise.all(window.__submittedForms.map(async (form) => {
    const files = await Promise.all(form.files.map(async (entry) => ({
      name: entry.name,
      files: await Promise.all(entry.files.map(async (file) => {
        const buffer = await file.arrayBuffer();
        if (file.name.endsWith('.json')) return { name: file.name, type: file.type, size: file.size, json: JSON.parse(new TextDecoder().decode(buffer)) };
        if (file.name.endsWith('.csv')) return { name: file.name, type: file.type, size: file.size, csv: new TextDecoder().decode(buffer) };
        const workbook = window.XLSX.read(buffer, { type: 'array' });
        return {
          name: file.name, type: file.type, size: file.size, sheets: workbook.SheetNames,
          firstAllRow: window.XLSX.utils.sheet_to_json(workbook.Sheets.All, { defval: '' })[0],
          totalsRows: window.XLSX.utils.sheet_to_json(workbook.Sheets.Totals, { header: 1, defval: '' })
        };
      }))
    })));
    return { action: form.action, referrerPolicy: form.referrerPolicy, subject: form.subject, fields: form.fields, files };
  })));
  const result = allResults.slice(3);

  assert.equal(logs.length, 0, `Unexpected ${browserName} browser logs: ${logs.join('\n')}`);
  assert.equal(beforeSubmit.iframes, 0, 'submit iframe should not exist before submit');
  assert.equal(beforeSubmit.hiddenForms, 0, 'hidden FormSubmit forms should not exist before submit');
  assert.equal(beforeSubmit.cards, 1, 'one quick record card should render');
  assert.ok(allResults.every((entry) => entry.referrerPolicy === 'strict-origin-when-cross-origin'));
  assert.equal(beforeSubmit.employeeName, 'TEST Clock QA', 'clock card should inherit portal profile name');
  assert.equal(beforeSubmit.employeeEmail, 'test-clock@example.test');
  assert.equal(beforeSubmit.action, 'clock_in');
  assert.equal(beforeSubmit.locationMode, 'in_office');
  assert.equal(beforeSubmit.actionButtons, 6, 'action row should include four clock actions, absent and full-day plus control');
  assert.match(beforeSubmit.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(beforeSubmit.time, /^\d{2}:\d{2}$/);
  assert.equal(beforeSubmit.locationMaxLength, 240);
  assert.equal(beforeSubmit.locationControlHidden, true, 'in-office mode hides the separate site field');
  assert.equal(beforeSubmit.locationDisabled, true, 'in-office mode disables the separate site field');
  assert.equal(beforeSubmit.noteMaxLength, 1000);
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
    assert.equal(form.action, 'https://formsubmit.co/ajax/clock-test-endpoint');
    assert.equal(form.subject, `[GMT][TIMESHEET][${entry.subjectKind}] TEST Clock QA | ${entry.label} | 2026-08-31${entry.time ? ` ${entry.time}` : ''}`);
    assert.equal(fields.get('_cc'), 'test-recipient@example.test,test-clock@example.test');
    assert.match(fields.get('summary'), /Pay-month coverage could not be checked/);
    assert.match(fields.get('summary'), /2026-08-31/);
    assert.equal(fields.get('gmt_schema_version'), '2');
    assert.equal(fields.get('gmt_type'), 'timesheet_clock');
    assert.equal(fields.get('gmt_action'), entry.action);
    assert.equal(fields.get('gmt_employee'), 'TEST Clock QA');
    assert.equal(fields.get('gmt_employee_email'), 'test-clock@example.test');
    assert.equal(fields.get('gmt_clock_date'), '2026-08-31');
    assert.equal(fields.get('gmt_year'), '2026');
    assert.equal(fields.get('gmt_month'), '09');
    assert.equal(fields.get('gmt_pay_month'), '2026-09');
    assert.equal(fields.get('gmt_attachment_manifest'), 'record-json,xlsx,csv');
    assert.equal(fields.get('gmt_workbook_key'), 'timesheet-test-clock-example-test-2026-09');
    assert.equal(fields.get('gmt_filing_mode'), 'monthly-upsert');
    assert.equal(fields.get('gmt_absence_reason'), entry.absence || '');
    assert.equal(fields.get('gmt_location'), '', 'in-office clock records do not carry an unused site label');
    assert.equal(fields.get('location'), '', 'in-office clock records do not carry an unused site label');
    assert.deepEqual(form.files.map((entry) => entry.name), ['attachment_record', 'attachment', 'attachment_csv']);
    assert.equal(fileList.length, 3, 'each quick record should attach record JSON, XLSX and CSV');
    const recordFile = fileList.find((file) => file.name.endsWith('.json'));
    assert.ok(recordFile.size > 100, 'record JSON attachment should not be empty');
    assert.equal(recordFile.json.recordId, fields.get('gmt_record_id'));
    assert.equal(recordFile.json.employeeName, 'TEST Clock QA');
    assert.equal(recordFile.json.action, entry.action);
    assert.equal(recordFile.json.date, '2026-08-31');
    assert.ok(workbook.size > 1000, 'XLSX attachment should not be empty');
    assert.deepEqual(workbook.sheets, ['All', 'Totals', 'Notes']);
    assert.equal(workbook.firstAllRow.Employee, 'TEST Clock QA');
    assert.equal(workbook.firstAllRow['Employee email'], 'test-clock@example.test');
    assert.equal(workbook.firstAllRow.Status, entry.status);
    assert.equal(workbook.firstAllRow.Category, entry.label);
    assert.equal(workbook.firstAllRow.Date, '2026-08-31');
    assert.equal(workbook.firstAllRow.Start, entry.start);
    assert.equal(workbook.firstAllRow.Finish, entry.finish);
    assert.equal(workbook.firstAllRow['Worked hours'], entry.worked);
    assert.match(csv.csv, /TEST Clock QA/);
    assert.match(csv.csv, new RegExp(entry.label));
    const parsedClockCsvBook = createTimesheetWorkbook('TEST Clock QA', '2026-09');
    const parsedClockCsv = parseCsvThroughOfficeScript(parsedClockCsvBook, csv.name, csv.csv);
    assert.equal(parsedClockCsv.created, 1, 'clock CSV from the browser producer must parse through the Office Script');
    assert.equal(parsedClockCsvBook.rows[1][0], 'TEST Clock QA');
    assert.equal(parsedClockCsvBook.rows[1][5], entry.action, 'clock CSV preserves the event action');
    assert.equal(parsedClockCsvBook.rows[1][16], '', 'in-office clock records use the work-setting selection without a duplicate site field');
    assert.equal(parsedClockCsvBook.rows[1][19], fields.get('gmt_record_id'),
      'clock CSV carries the same original source ID as the clock record attachment');
    if (entry.absence) assert.equal(workbook.firstAllRow['Absence reason'], entry.absence);
    assert.equal(workbook.firstAllRow['Location / site'], '');
    if (entry.action === 'full_day') {
      assert.equal(workbook.firstAllRow['Lunch start'], entry.lunchStart);
      assert.equal(workbook.firstAllRow['Lunch end'], entry.lunchEnd);
      assert.equal(workbook.firstAllRow.Note, entry.note);
      assert.equal(fields.get('gmt_worked_hours'), '8');
    }
  });

  await page.evaluate(() => {
    window.__offsiteEvents = [];
    window.__offsiteEntries = [];
    window.GMTPortalApi = {
      enabled: () => true,
      offsiteClockMine: async () => ({ entries: window.__offsiteEntries }),
      offsiteClockIn: async (body) => {
        window.__offsiteEvents.push({ action: 'clock_in', ...body });
        const entry = { entryId: 'TEST-dashboard-offsite-001', status: 'clocked_in', site: body.site, workDate: '2026-10-16', clockInAt: '2026-10-16T15:00:00.000Z' };
        window.__offsiteEntries = [entry];
        return { entry };
      },
      offsiteClockLunchStart: async (body) => {
        window.__offsiteEvents.push({ action: 'lunch_start', ...body });
        window.__offsiteEntries[0].lunchStartAt = '2026-10-16T15:05:00.000Z';
        return { entry: window.__offsiteEntries[0] };
      },
      offsiteClockLunchEnd: async (body) => {
        window.__offsiteEvents.push({ action: 'lunch_end', ...body });
        window.__offsiteEntries[0].lunchEndAt = '2026-10-16T15:10:00.000Z';
        return { entry: window.__offsiteEntries[0] };
      },
      offsiteClockOut: async (body) => {
        window.__offsiteEvents.push({ action: 'clock_out', ...body });
        window.__offsiteEntries[0].status = 'awaiting_approval';
        window.__offsiteEntries[0].clockOutAt = '2026-10-16T15:15:00.000Z';
        return { entry: window.__offsiteEntries[0] };
      }
    };
  });
  const beforeOffsiteEmailCount = await page.evaluate(() => window.__submittedForms.length);
  await card.locator('[name="clock_location_mode"]').selectOption('off_site');
  await page.waitForFunction(() => document.querySelector('[data-clock-action="clock_in"]')?.hidden === false);
  await card.locator('[name="clock_location"]').fill('51.3762, -0.0982');
  await card.locator('[data-clock-submit]').click();
  await page.waitForFunction(() => /instead of coordinates/.test(document.querySelector('.clock-status')?.textContent || ''));
  assert.equal(await page.evaluate(() => window.__offsiteEvents.length), 0, 'coordinate-like off-site labels are rejected before the protected endpoint');
  await card.locator('[name="clock_location"]').fill('TEST Client Road, Croydon');
  await card.locator('[data-clock-submit]').click();
  await page.waitForFunction(() => window.__offsiteEvents.length === 1);
  for (let eventIndex = 1; eventIndex < 4; eventIndex += 1) {
    await card.locator('[data-clock-submit]').click();
    await page.waitForFunction((count) => window.__offsiteEvents.length === count, eventIndex + 1);
  }
  const offsiteRouting = await page.evaluate(() => ({
    events: window.__offsiteEvents,
    locationRequired: document.querySelector('[name="clock_location"]').required,
    dateTimeHidden: document.querySelector('.portal-clock-date-time').hidden,
    fullDayHidden: document.querySelector('[data-clock-action="full_day"]').hidden,
    emailCount: window.__submittedForms.length,
    status: document.querySelector('.clock-status')?.textContent || ''
  }));
  assert.deepEqual(offsiteRouting.events.map((event) => event.action), ['clock_in', 'lunch_start', 'lunch_end', 'clock_out']);
  assert.equal(offsiteRouting.events[0].site, 'TEST Client Road, Croydon');
  assert.ok(offsiteRouting.events.every((event) => event.requestId && !('time' in event) && !('date' in event)), 'off-site timestamps come from the protected server path');
  assert.equal(offsiteRouting.locationRequired, true);
  assert.equal(offsiteRouting.dateTimeHidden, true);
  assert.equal(offsiteRouting.fullDayHidden, true);
  assert.equal(offsiteRouting.emailCount, beforeOffsiteEmailCount, 'off-site events never use the direct-to-Accounts email path');
  assert.match(offsiteRouting.status, /awaiting Duty Manager approval/i);

    console.log(JSON.stringify({ browser: browserName, responsiveContext, futureTimeAttempt, retryStatus: retryAttempt.status, beforeSubmit, layout, offsiteRouting: { actions: offsiteRouting.events.map((event) => event.action), emailCount: offsiteRouting.emailCount }, submissions: result.map((form) => ({ subject: form.subject, attachments: form.files.flatMap((entry) => entry.files.map((file) => file.name)) })) }, null, 2));
    await browser.close();
    browser = null;
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
