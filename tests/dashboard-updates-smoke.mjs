import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const payPeriods = require('./pay-periods.js');
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pageSource = readFileSync(resolve(repoRoot, 'portal/index.html'), 'utf8');
const stylesheet = readFileSync(resolve(repoRoot, 'portal.css'), 'utf8');

function extractSection(source, openingTag) {
  const start = source.indexOf(openingTag);
  assert.notEqual(start, -1, `could not find ${openingTag}`);
  const tags = /<\/?section\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(source))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(start, tags.lastIndex);
  }
  throw new Error(`unclosed section starting with ${openingTag}`);
}

const dashboardSection = extractSection(pageSource, '<section class="portal-updates"');
const tasks = Array.from({ length: 12 }, (_, index) => ({
  kind: 'tasks',
  source_record_id: `task-${index + 1}`,
  task_title: index === 0 ? 'Replace motor bearings at north wing '.repeat(4) : `Task ${index + 1}`,
  assignee: index === 0 ? 'Engineer with an intentionally long assigned name' : `Engineer ${index + 1}`,
  employee_name: 'Sample Engineer',
  status: index === 1 ? 'Complete' : 'In-Progress',
  job_reference: index === 0 ? `GMT-${'reference-'.repeat(8)}` : `GMT-${String(index + 1).padStart(3, '0')}`,
  due_date: `2026-10-${String(index + 1).padStart(2, '0')}`,
  updated_at: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z`
}));
const enquiries = Array.from({ length: 10 }, (_, index) => ({
  kind: 'enquiries',
  source_record_id: `enquiry-${index + 1}`,
  customer_name: `Customer update ${index + 1}`,
  request_type: 'Service enquiry',
  message: `Notification ${index + 1}`,
  status: 'Submitted',
  updated_at: `2026-10-${String(index + 1).padStart(2, '0')}T08:00:00Z`
}));
const notificationRecords = [
  ...tasks,
  ...enquiries,
  { kind: 'timesheets', source_record_id: 'timesheet-1', employee_name: 'Sample Engineer', updated_at: '2026-10-13T14:00:00Z' }
];
function londonDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
const todayDate = londonDateKey(new Date());
const configuredStartDates = { [todayDate.slice(0, 7)]: todayDate };
const configuredPeriods = payPeriods.createPayPeriods(configuredStartDates);
const currentPayMonth = configuredPeriods.payMonthKeyForDate(todayDate);
const priorPayMonth = configuredPeriods.previousPayMonthKey(currentPayMonth);
const currentPayPeriod = configuredPeriods.periodForMonth(currentPayMonth);
const priorPayPeriod = configuredPeriods.periodForMonth(priorPayMonth);
const currentWorkedDate = currentPayPeriod.start;
const secondWorkedDate = addDays(currentPayPeriod.start, 1);
const currentHolidayDate = addDays(currentPayPeriod.start, 2);
const priorWorkedDate = priorPayPeriod.start;
const personalRecords = [
  { kind: 'timesheets', source_record_id: 'my-timesheet-current', employee_upn: 'employee@example.com', payload: { rows: [
    { date: currentWorkedDate, workedHours: 7.5, start: '08:00', finish: '16:00' },
    { date: secondWorkedDate, workedHours: 8, start: '08:00', finish: '16:30' },
    { date: currentHolidayDate, workedHours: 0, absenceReason: 'Holiday' }
  ] } },
  { kind: 'timesheets', source_record_id: 'my-timesheet-duplicate-day', employee_upn: 'EMPLOYEE@example.com', payload: { rows: [
    { date: currentWorkedDate, workedHours: 1, start: '08:00', finish: '09:00' }
  ] } },
  { kind: 'estimates', source_record_id: 'my-estimate-current', employee_upn: 'employee@example.com', record_date: currentWorkedDate, estimate_number: 'EST-MINE' },
  { kind: 'job-cards', source_record_id: 'my-job-current', employee_upn: 'employee@example.com', record_date: secondWorkedDate, job_ref: 'JOB-MINE' },
  { kind: 'tasks', source_record_id: 'my-task-done-current', employee_upn: 'employee@example.com', status: 'Complete', completed_at: secondWorkedDate },
  { kind: 'tasks', source_record_id: 'my-task-completed-current', employee_upn: 'employee@example.com', status: 'Complete', record_date: priorWorkedDate, updated_at: `${currentWorkedDate}T16:00:00Z` },
  { kind: 'tasks', source_record_id: 'my-task-pending-current', employee_upn: 'employee@example.com', status: 'In-Progress', record_date: secondWorkedDate },
  { kind: 'timesheets', source_record_id: 'my-timesheet-prior', employee_upn: 'employee@example.com', payload: { rows: [
    { date: priorWorkedDate, workedHours: 7.5, start: '08:00', finish: '16:00' }
  ] } },
  { kind: 'estimates', source_record_id: 'my-estimate-prior', employee_upn: 'employee@example.com', record_date: priorWorkedDate, estimate_number: 'EST-PRIOR' },
  { kind: 'tasks', source_record_id: 'my-task-done-prior', employee_upn: 'employee@example.com', status: 'Complete', completed_at: priorWorkedDate },
  { kind: 'estimates', source_record_id: 'other-estimate-current', employee_upn: 'other@example.com', record_date: currentWorkedDate, estimate_number: 'EST-OTHER' },
  { kind: 'job-cards', source_record_id: 'other-job-current', employee_upn: 'other@example.com', record_date: currentWorkedDate, job_ref: 'JOB-OTHER' }
];

const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const pages = [];

async function createDashboardPage(viewport, scenario) {
  const page = await browser.newPage({ viewport });
  pages.push(page);
  await page.setContent(`<style>${stylesheet}</style><main class="app-main portal-dashboard-main">${dashboardSection}</main>`);
  const empty = scenario === 'empty';
  const disconnected = scenario === 'disconnected';
  const missingIdentity = scenario === 'identity-missing';
  const failTasks = scenario === 'error' || scenario === 'task-error';
  const failNotifications = scenario === 'error' || scenario === 'notification-error';
  const invalidNotifications = scenario === 'invalid-notifications';
  await page.evaluate(({ fixtureTasks, fixtureNotifications, failure, startDates }) => {
    const historyCalls = [];
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: (key) => key === 'gmt.portal.profile.v1' && !failure.missingIdentity ? JSON.stringify({ username: 'employee@example.com', subject: 'employee-object-id' }) : null }
    });
    window.GMTPortalApi = {
      enabled: () => !failure.disconnected,
      payMonthStarts: async () => ({ startDates }),
      history: async (kind, options) => {
        historyCalls.push({ kind, options: options || {} });
        if ((kind === 'tasks' && failure.tasks) || (kind !== 'tasks' && failure.notifications)) {
          throw new Error('Protected history unavailable for this check.');
        }
        if (kind !== 'tasks' && failure.invalidNotifications) return { unexpected: true };
        if (kind === 'tasks') return { records: fixtureTasks };
        return { records: fixtureNotifications };
      },
      calls: () => historyCalls.slice()
    };
  }, {
    fixtureTasks: empty ? [] : tasks,
    fixtureNotifications: empty ? [] : [...notificationRecords, ...personalRecords],
    startDates: configuredStartDates,
    failure: { tasks: failTasks, notifications: failNotifications, invalidNotifications, disconnected, missingIdentity }
  });
  await page.addScriptTag({ path: resolve(repoRoot, 'pay-periods.js') });
  await page.addScriptTag({ path: resolve(repoRoot, 'portal/dashboard-updates.js') });
  await page.waitForFunction(() => {
    const taskStatus = document.querySelector('#portal-task-board-status');
    const notificationStatus = document.querySelector('#portal-notification-status');
    const statisticsStatus = document.querySelector('#portal-statistics-status');
    return taskStatus && notificationStatus && statisticsStatus && !taskStatus.textContent.startsWith('Loading') && !notificationStatus.textContent.startsWith('Loading') && !statisticsStatus.textContent.startsWith('Loading');
  });
  return page;
}

try {
  const page = await createDashboardPage({ width: 390, height: 844 }, 'populated');
  assert.equal(await page.locator('[data-updates-slide]').count(), 3, 'dashboard carousel should contain three pages');
  assert.equal(await page.locator('[data-updates-dot]').count(), 3, 'carousel should have one indicator per page');
  assert.equal(await page.locator('[data-updates-slide="0"]').getAttribute('aria-label'), 'Page 1 of 3');
  assert.equal(await page.locator('[data-updates-slide="1"]').getAttribute('aria-label'), 'Page 2 of 3');
  assert.equal(await page.locator('[data-updates-slide="2"]').getAttribute('aria-label'), 'Page 3 of 3');
  assert.equal(await page.locator('[role="tablist"]').getAttribute('aria-label'), 'Dashboard pages');
  assert.equal(await page.locator('[data-updates-dot="0"]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('[data-updates-dot="0"]').getAttribute('tabindex'), '0');
  assert.equal(await page.locator('[data-updates-dot="1"]').getAttribute('tabindex'), '-1');
  assert.equal(await page.locator('[data-updates-dot="2"]').getAttribute('aria-label'), 'My statistics');
  assert.equal(await page.locator('#portal-updates-slide-1 #portal-notifications').count(), 1, 'Updates should be on page 2');
  assert.equal(await page.locator('#portal-updates-slide-1 #portal-task-board').count(), 1, 'Task Board should share page 2');
  assert.equal(await page.locator('#portal-statistics-pay-month').inputValue(), currentPayMonth, 'statistics should default to the current GMT pay month');
  assert.equal(await page.locator('[data-statistics-value="worked-days"]').innerText(), '2', 'distinct worked dates should exclude duplicates and holidays');
  assert.equal(await page.locator('[data-statistics-value="holiday-days"]').innerText(), '1', 'holiday rows should be counted separately');
  assert.equal(await page.locator('[data-statistics-value="estimates-written"]').innerText(), '1', 'only the signed-in employee estimate should count');
  assert.equal(await page.locator('[data-statistics-value="job-cards-raised"]').innerText(), '1', 'only the signed-in employee job card should count');
  assert.equal(await page.locator('[data-statistics-value="tasks-completed"]').innerText(), '2', 'pending tasks should not count, and task update dates should place completions in the correct month');
  assert.match(await page.locator('#portal-statistics-source-note').innerText(), /records currently available to your account/i);
  const statisticMonths = await page.locator('#portal-statistics-pay-month option').evaluateAll((options) => options.map((option) => option.value));
  assert.ok(statisticMonths.includes(priorPayMonth), 'the selector should offer a prior pay month present in personal history');
  await page.locator('[data-updates-dot="2"]').click();
  assert.equal(await page.locator('[data-updates-slide="2"]').getAttribute('hidden'), null, 'statistics should be reachable as the third slide');
  await page.locator('#portal-statistics-pay-month').selectOption(priorPayMonth);
  assert.equal(await page.locator('[data-statistics-value="worked-days"]').innerText(), '1');
  assert.equal(await page.locator('[data-statistics-value="holiday-days"]').innerText(), '0');
  assert.equal(await page.locator('[data-statistics-value="estimates-written"]').innerText(), '1');
  assert.equal(await page.locator('[data-statistics-value="job-cards-raised"]').innerText(), '0');
  assert.equal(await page.locator('[data-statistics-value="tasks-completed"]').innerText(), '1');
  await page.locator('#portal-statistics-pay-month').selectOption(currentPayMonth);
  await page.locator('[data-updates-dot="0"]').click();
  assert.match(await page.locator('#portal-notification-status').innerText(), /Showing the 8 most recent of 31 updates\./, 'the eight-notification limit should be visible to users');

  await page.locator('input[name="employee_name"]').fill('Retained dashboard entry');
  await page.locator('[data-updates-next]').click();
  await page.locator('[data-updates-next]').click();
  assert.equal(await page.locator('[data-updates-slide="2"]').getAttribute('hidden'), null, 'statistics should be reachable as the third slide');
  assert.equal(await page.locator('[data-updates-dot="2"]').getAttribute('aria-selected'), 'true');
  await page.locator('[data-updates-prev]').click();
  assert.equal(await page.locator('[data-updates-slide="0"]').getAttribute('hidden'), '');
  assert.equal(await page.locator('[data-updates-slide="1"]').getAttribute('hidden'), null);
  assert.equal(await page.locator('[data-updates-dot="1"]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#portal-task-board .portal-task-card').count(), tasks.length, 'every task should remain available');
  assert.equal(await page.locator('#portal-notifications [data-notification-index]').count(), 8, 'Updates should be capped at eight notifications');
  const firstTask = page.locator('#portal-task-board .portal-task-card').first();
  assert.match(await firstTask.innerText(), /Replace motor bearings at north wing/);
  assert.match(await firstTask.innerText(), /GMT-reference-/);
  assert.match(await firstTask.innerText(), /Engineer with an intentionally long assigned name/);
  assert.match(await firstTask.innerText(), /Sample Engineer/);
  assert.match(await firstTask.innerText(), /Due 2026-10-01/);
  assert.match(await firstTask.innerText(), /50%/);
  assert.match(await page.locator('#portal-task-board').innerText(), /Task 12/);

  await page.locator('[data-notification-index="0"]').click();
  assert.equal(await page.locator('.portal-notification-dialog[open]').count(), 1, 'notification details should still open');
  await page.locator('[data-notification-close]').click();
  await page.locator('[data-updates-prev]').click();
  assert.equal(await page.locator('[data-updates-slide="0"]').getAttribute('hidden'), null);
  assert.equal(await page.locator('input[name="employee_name"]').inputValue(), 'Retained dashboard entry', 'changing carousel pages should preserve clock-in form data');
  await page.locator('[data-updates-dot="0"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-updates-dot="1"]').getAttribute('aria-selected'), 'true', 'ArrowRight should navigate the carousel');
  assert.equal(await page.locator('[data-updates-dot="1"]').evaluate((element) => element === document.activeElement), true, 'keyboard navigation should move focus with selection');

  const responsiveResults = [];
  await page.locator('[data-updates-dot="2"]').click();
  for (const width of [1440, 1024, 851, 850, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await page.evaluate(() => {
      const grid = document.querySelector('.portal-statistics-grid');
      const cardColumns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        cardColumns
      };
    });
    responsiveResults.push(metrics);
    assert.ok(metrics.documentWidth <= width, `document overflows at ${width}px: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.bodyWidth <= width, `body overflows at ${width}px: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.cardColumns >= 1 && metrics.cardColumns <= 5, `statistics cards should fit their grid at ${width}px: ${JSON.stringify(metrics)}`);
    if (width === 390) assert.ok(metrics.cardColumns <= 2, 'phone widths should use a compact statistics grid');
    if (width >= 1024) assert.ok(metrics.cardColumns >= 4, 'desktop widths should show multiple statistics cards in one row');
  }

  const emptyPage = await createDashboardPage({ width: 390, height: 844 }, 'empty');
  assert.equal(await emptyPage.locator('#portal-statistics-status').innerText(), 'No personal records are available for this pay month.');
  for (const metric of ['worked-days', 'holiday-days', 'estimates-written', 'job-cards-raised', 'tasks-completed']) {
    assert.equal(await emptyPage.locator(`[data-statistics-value="${metric}"]`).innerText(), '0', `empty history should show a confirmed zero for ${metric}`);
  }
  assert.equal(await emptyPage.locator('#portal-statistics-pay-month').inputValue(), currentPayMonth, 'empty history should still expose the current pay month');
  assert.equal(await emptyPage.locator('#portal-task-board .portal-task-board-empty').count(), 1);
  assert.equal(await emptyPage.locator('#portal-task-board-status').innerText(), 'No submitted tasks yet.');
  assert.equal(await emptyPage.locator('#portal-notification-status').innerText(), 'No new notifications.');
  assert.match(await emptyPage.locator('#portal-notifications').innerText(), /no new notifications/i);
  assert.equal(await emptyPage.locator('#portal-notifications').getAttribute('aria-live'), null, 'notification count should be the only live announcement');
  assert.equal(await emptyPage.locator('#portal-notifications [role="status"]').count(), 0, 'the visual empty card should not create a second live announcement');

  const errorPage = await createDashboardPage({ width: 390, height: 844 }, 'error');
  assert.equal(await errorPage.locator('#portal-statistics-status').innerText(), 'Personal statistics are unavailable.');
  assert.equal(await errorPage.locator('#portal-task-board-status').innerText(), 'Protected history unavailable for this check.');
  assert.equal(await errorPage.locator('#portal-task-board .portal-task-board-empty').count(), 1);

  const notificationsErrorPage = await createDashboardPage({ width: 390, height: 844 }, 'notification-error');
  assert.equal(await notificationsErrorPage.locator('#portal-task-board .portal-task-card').count(), tasks.length, 'task cards should remain available when Updates fail independently');
  assert.equal(await notificationsErrorPage.locator('#portal-notification-status').innerText(), 'Notifications could not be loaded.');
  assert.match(await notificationsErrorPage.locator('#portal-notifications').innerText(), /Task Board status is shown separately/);
  assert.doesNotMatch(await notificationsErrorPage.locator('#portal-notifications').innerText(), /No new notifications/);

  const tasksErrorPage = await createDashboardPage({ width: 390, height: 844 }, 'task-error');
  assert.equal(await tasksErrorPage.locator('#portal-task-board-status').innerText(), 'Protected history unavailable for this check.');
  assert.equal(await tasksErrorPage.locator('#portal-task-board .portal-task-board-empty').count(), 1);
  assert.equal(await tasksErrorPage.locator('#portal-notifications [data-notification-index]').count(), 8, 'Updates should remain available when the Task Board fails independently');

  const disconnectedPage = await createDashboardPage({ width: 390, height: 844 }, 'disconnected');
  assert.equal(await disconnectedPage.locator('#portal-statistics-status').innerText(), 'Personal statistics are not connected.');
  assert.equal(await disconnectedPage.locator('#portal-notification-status').innerText(), 'Notifications are not connected.');
  assert.match(await disconnectedPage.locator('#portal-notifications').innerText(), /Protected notifications are unavailable in this portal/);

  const invalidNotificationsPage = await createDashboardPage({ width: 390, height: 844 }, 'invalid-notifications');
  assert.equal(await invalidNotificationsPage.locator('#portal-statistics-status').innerText(), 'Personal statistics are unavailable.');
  assert.equal(await invalidNotificationsPage.locator('#portal-notification-status').innerText(), 'Notifications could not be loaded.');
  assert.doesNotMatch(await invalidNotificationsPage.locator('#portal-notifications').innerText(), /No new notifications/);

  const missingIdentityPage = await createDashboardPage({ width: 390, height: 844 }, 'identity-missing');
  assert.equal(await missingIdentityPage.locator('#portal-statistics-status').innerText(), 'Personal statistics are unavailable.');
  for (const metric of ['worked-days', 'holiday-days', 'estimates-written', 'job-cards-raised', 'tasks-completed']) {
    assert.equal(await missingIdentityPage.locator(`[data-statistics-value="${metric}"]`).innerText(), '—', `statistics should fail closed without identity for ${metric}`);
  }

  const requestedHistory = await page.evaluate(() => window.GMTPortalApi.calls());
  assert.ok(requestedHistory.some((call) => call.kind === 'all' && call.options.limit === 500), 'personal statistics should reuse history with the Worker record bound');
  assert.equal(requestedHistory.filter((call) => call.kind === 'all').length, 1, 'notifications and personal statistics should share one history response');

  console.log(`Dashboard updates, task board and personal statistics acceptance: PASS (${responsiveResults.map((result) => `${result.width}px/${result.cardColumns}col`).join(', ')})`);
} finally {
  await Promise.all(pages.map((page) => page.close()));
  await browser.close();
}
