import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const submissionsHtml = readFileSync(resolve(repoRoot, 'portal/submissions.html'), 'utf8');
assert.match(submissionsHtml, /class="submission-list-controls"/);
assert.ok(submissionsHtml.indexOf('estimate-history-layout') < submissionsHtml.indexOf('submission-list-controls'), 'document filters should live in the document list section');
assert.doesNotMatch(submissionsHtml, /portal-history-toolbar[^<]*<[^>]+id="submissions-filter"/, 'document filters should not be attached to the status toolbar');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const page = await browser.newPage();
  await page.setContent('<p id="submissions-status"></p><select id="submissions-filter"><option value="all">All</option></select><label id="submissions-employee-filter" hidden>Employee <select id="submissions-employee"><option value="">All employees</option></select></label><button id="submissions-refresh"></button><p id="submissions-admin-timesheet-notice" hidden></p><section id="submissions-admin-timesheet-summary" hidden><p id="submissions-admin-timesheet-status"></p><p id="submissions-admin-timesheet-note"></p><table id="submissions-admin-timesheet-table"></table></section><div id="submissions-list"></div><article id="submissions-preview"></article>');
  await page.evaluate(() => {
    window.GMTPortalApi = { enabled: () => true, history: async () => ({ records: [], meta: { is_admin: true, upstream: 'flow-permission-not-configured', visible_scope: 'all employee submissions', completion: { pay_month: '2026-09', counts: { completed: 0, incomplete: 1, missing: 1 }, directory_configured: true, employees: [{ employee_name: 'Jason', employee_upn: 'jason@gmt-services.co.uk', status: 'incomplete', submitted_records: 0, missing: ['Timesheet week 2026-09-07 to 2026-09-13'] }, { employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk', status: 'missing', submitted_records: 0, missing: ['Timesheet week 2026-09-07 to 2026-09-13'] }] } } }) };
  });
  await page.addScriptTag({ path: resolve(repoRoot, 'portal/submissions.js') });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(() => document.querySelectorAll('#submissions-list [data-submission-index]').length === 3);
  const examples = await page.locator('#submissions-list').innerText();
  assert.match(examples, /Example job card/);
  assert.match(examples, /Example estimate/);
  assert.match(examples, /Example task/);
  assert.match(examples, /Example only/);
  assert.equal(await page.locator('#submissions-admin-timesheet-summary').getAttribute('hidden'), null);
  assert.match(await page.locator('#submissions-admin-timesheet-table').innerText(), /Jason/);
  assert.equal(await page.locator('#submissions-admin-timesheet-notice a').getAttribute('href'), 'timesheets.html?connect-history=1');
  assert.match(await page.locator('#submissions-admin-timesheet-notice').innerText(), /Connect Microsoft 365 history access/);
  assert.equal(await page.locator('#submissions-list .submission-record-header').count(), 1);
  assert.equal(await page.locator('#submissions-list .submission-record-row').count(), 3);
  assert.deepEqual(await page.locator('#submissions-list .submission-record-type').allTextContents(), ['Job card', 'Estimate', 'Task']);
  assert.equal(await page.locator('#submissions-employee-filter').getAttribute('hidden'), null);
  assert.deepEqual(await page.locator('#submissions-employee option').allTextContents(), ['All employees', 'Jason', 'Matthew']);
  assert.equal(await page.locator('#submissions-list .submission-record-row').first().locator('.submission-record-cell').count(), 4);
  await page.locator('#submissions-employee').selectOption('jason@gmt-services.co.uk');
  assert.equal(await page.locator('#submissions-list [data-submission-index]').count(), 0);
  await page.locator('#submissions-employee').selectOption('');
  assert.equal(await page.locator('#submissions-list [data-submission-index]').count(), 3);
  await page.locator('#submissions-list [data-submission-index="0"]').click();
  assert.match(await page.locator('#submissions-preview').innerText(), /Example preview only/);
  assert.equal(await page.locator('#submissions-preview .job-card-sheet').count(), 1);
  assert.equal(await page.locator('#submissions-preview .job-sheet-logo').count(), 1);
  await page.locator('#submissions-preview [data-submission-card-type="MTA"]').click();
  assert.equal(await page.locator('#submissions-preview .job-card-sheet-mta').count(), 1);
  await page.locator('#submissions-list [data-submission-index="1"]').click();
  assert.equal(await page.locator('#submissions-preview .estimate-paper-logo').count(), 1);
  assert.equal(await page.locator('#submissions-preview .estimate-paper-table').count(), 1);
  await page.locator('#submissions-list [data-submission-index="2"]').click();
  assert.equal(await page.locator('#submissions-preview .submission-task-preview-logo').count(), 1);
  assert.match(await page.locator('#submissions-preview').innerText(), /Example task/);

  const calendarPage = await browser.newPage();
  await calendarPage.setContent('<p id="submissions-calendar-status"></p><h3 data-submissions-calendar-title></h3><button data-submissions-calendar-prev></button><button data-submissions-calendar-next></button><div data-submissions-calendar></div>');
  await calendarPage.evaluate(() => {
    window.GMTPortalApi = { enabled: () => false };
    window.fetch = async () => ({ ok: true, json: async () => ({ events: [] }) });
  });
  await calendarPage.addScriptTag({ path: resolve(repoRoot, 'portal/submissions-calendar.js') });
  await calendarPage.waitForFunction(() => document.querySelector('.portal-calendar-grid'));
  assert.equal(await calendarPage.locator('.portal-calendar-weekday').count(), 7);
  assert.ok((await calendarPage.locator('[data-submissions-calendar-title]').innerText()).length > 0);
  await calendarPage.addScriptTag({ path: resolve(repoRoot, 'portal/calendar-data.js') });
  const sparseCalendarEvents = await calendarPage.evaluate(() => window.GMTCalendarData.recordsToEvents([{
    kind: 'timesheets', employee_name: 'Jason', record_date: '2026-09-01',
    source_record_id: 'history-timesheets-jason-2026-09-01',
    daily_detail_issue: 'Daily rows were not returned by the Microsoft 365 history source; times, breaks and totals are unavailable.'
  }]));
  assert.equal(sparseCalendarEvents.length, 0, 'a weekly header without daily rows must not create a misleading submission-day label');
  const scheduleEvents = await calendarPage.evaluate(() => window.GMTCalendarData.recordsToEvents([{
    kind: 'timesheets', employee_name: 'Michelle', employee_upn: 'michelle@gmt-services.co.uk', schedule_weekdays: [2, 3],
    source_record_id: 'michelle-week', payload: { data: { values: [
      { date: '2026-09-07', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
      { date: '2026-09-08', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
      { date: '2026-09-09', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
      { date: '2026-09-10', startTime: '08:00', finishTime: '17:00', workedHours: 8 }
    ] } }
  }]));
  assert.deepEqual(scheduleEvents.map((event) => event.date), ['2026-09-08', '2026-09-09']);
  assert.equal(scheduleEvents.every((event) => event.scheduled !== false), true);

  const duplicateVersionEvents = await calendarPage.evaluate(() => window.GMTCalendarData.recordsToEvents([
    {
      kind: 'timesheets', employee_name: 'Michelle', employee_upn: 'michelle@gmt-services.co.uk',
      start_date: '2026-09-07', end_date: '2026-09-13', updated_at: '2026-09-15T09:00:00Z',
      source_record_id: 'michelle-invalid-latest', payload: { rows: [
        { date: '2026-09-09', startTime: '05:00', finishTime: '05:00', lunchMinutes: 0, workedHours: 8 }
      ] }
    },
    {
      kind: 'timesheets', employee_name: 'Michelle', employee_upn: 'michelle@gmt-services.co.uk',
      start_date: '2026-09-07', end_date: '2026-09-13', updated_at: '2026-09-14T09:00:00Z',
      source_record_id: 'michelle-valid-version', payload: { rows: [
        { date: '2026-09-09', startTime: '09:00', finishTime: '17:00', lunchMinutes: 0, workedHours: 8 }
      ] }
    }
  ]));
  assert.equal(duplicateVersionEvents.length, 1, 'calendar should select one authoritative weekly version');
  assert.match(duplicateVersionEvents[0].detail, /09:00–17:00/);
  assert.doesNotMatch(duplicateVersionEvents[0].detail, /05:00/);

  const overlappingWeekEvents = await calendarPage.evaluate(() => window.GMTCalendarData.recordsToEvents([
    {
      kind: 'timesheets', employee_name: 'Michelle Reid', employee_upn: 'michelle@gmt-services.co.uk',
      start_date: '2026-09-01', end_date: '2026-09-21', updated_at: '2026-09-15T09:00:00Z',
      source_record_id: 'michelle-overlap-older', payload: { rows: [
        { date: '2026-09-15', startTime: '09:00', finishTime: '17:00', lunchMinutes: 30, workedHours: 7.5 }
      ] }
    },
    {
      kind: 'timesheets', employee_name: 'Michelle Reid', employee_upn: 'michelle@gmt-services.co.uk',
      start_date: '2026-09-14', end_date: '2026-09-21', updated_at: '2026-09-16T09:00:00Z',
      source_record_id: 'michelle-overlap-latest', payload: { rows: [
        { date: '2026-09-15', startTime: '09:05', finishTime: '17:30', lunchMinutes: 35, workedHours: 7.83 }
      ] }
    }
  ]));
  assert.equal(overlappingWeekEvents.filter((event) => event.date === '2026-09-15').length, 1, 'overlapping weekly versions should render one employee/day label');
  assert.match(overlappingWeekEvents.find((event) => event.date === '2026-09-15').detail, /09:05–17:30/);

  const dashboardCalendarPage = await browser.newPage();
  await dashboardCalendarPage.setContent('<p id="portal-calendar-status"></p><div class="portal-calendar-toolbar"><button data-portal-calendar-prev></button><button data-portal-calendar-picker><span data-portal-calendar-title></span></button><input id="portal-calendar-month-input" data-portal-calendar-input type="month"><button data-portal-calendar-next></button></div><div data-portal-calendar></div>');
  await dashboardCalendarPage.evaluate(() => {
    window.GMTPortalApi = { enabled: () => false };
    window.fetch = async () => ({ ok: true, json: async () => ({ events: [] }) });
    const input = document.querySelector('[data-portal-calendar-input]');
    input.showPicker = () => { input.dataset.pickerOpened = 'true'; };
  });
  await dashboardCalendarPage.addScriptTag({ path: resolve(repoRoot, 'portal/calendar-preview.js') });
  await dashboardCalendarPage.waitForFunction(() => document.querySelector('.portal-calendar-grid'));
  const dashboardTitle = dashboardCalendarPage.locator('[data-portal-calendar-title]');
  assert.ok((await dashboardTitle.innerText()).length > 0);
  await dashboardCalendarPage.locator('[data-portal-calendar-picker]').click();
  assert.equal(await dashboardCalendarPage.locator('[data-portal-calendar-input]').getAttribute('data-picker-opened'), 'true');
  await dashboardCalendarPage.locator('[data-portal-calendar-input]').evaluate((input) => {
    input.value = '2025-02';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await dashboardTitle.innerText(), 'February 2025');

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobilePage.setContent('<main class="app-main estimate-main"><section class="card estimate-history-panel"><div class="portal-history-toolbar"><p class="small-text">No submitted documents are currently available for this account. Labelled examples are shown below. Access: all employee submissions.</p><label class="portal-history-filter">Show <select><option>All documents</option></select></label></div><p class="portal-history-warning">Accounts access is enabled. The protected Microsoft 365 history source is currently flow-permission-not-configured. <a href="timesheets.html?connect-history=1">Connect Microsoft 365 history access →</a></p><section class="timesheet-completion"><div class="table-scroll"><table class="portal-table"><tbody><tr><td>' + 'x'.repeat(1000) + '</td></tr></tbody></table></div></section><div class="estimate-history-layout"><div class="estimate-history-list"><button class="estimate-history-item">Example</button></div><article class="estimate-paper estimate-history-preview">Preview</article></div></section></main>');
  await mobilePage.addStyleTag({ path: resolve(repoRoot, 'styles.css') });
  await mobilePage.addStyleTag({ path: resolve(repoRoot, 'portal.css') });
  await mobilePage.addStyleTag({ path: resolve(repoRoot, 'tools/estimates.css') });
  const mobileMetrics = await mobilePage.evaluate(() => ({ viewport: window.innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
  assert.ok(mobileMetrics.body <= mobileMetrics.viewport, `submitted documents overflow mobile viewport: ${JSON.stringify(mobileMetrics)}`);
  assert.ok(mobileMetrics.document <= mobileMetrics.viewport, `submitted documents document overflow: ${JSON.stringify(mobileMetrics)}`);
  console.log('Submitted documents examples and calendar UI: PASS');
} finally {
  await browser.close();
}
