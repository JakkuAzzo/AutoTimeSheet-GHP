import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
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
const workflowTasks = tasks.map((task) => ({
  taskId: task.source_record_id,
  title: task.task_title,
  assigneeUpn: task.assignee,
  requesterName: task.employee_name,
  status: task.status === 'Complete' ? 'Completed' : task.status,
  jobReference: task.job_reference,
  dueDate: task.due_date,
  updatedAt: task.updated_at
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

const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const pages = [];

async function createDashboardPage(viewport, scenario) {
  const page = await browser.newPage({ viewport });
  pages.push(page);
  await page.setContent(`<style>${stylesheet}</style><main class="app-main portal-dashboard-main">${dashboardSection}</main>`);
  const empty = scenario === 'empty';
  const disconnected = scenario === 'disconnected';
  const failTasks = scenario === 'error' || scenario === 'task-error';
  const failNotifications = scenario === 'error' || scenario === 'notification-error';
  const invalidNotifications = scenario === 'invalid-notifications';
  const pendingTask = scenario === 'pending-task'
    ? { ...workflowTasks[0], title: 'Pending task retry', status: 'Pending approval' }
    : null;
  await page.evaluate(({ fixtureTasks, fixtureNotifications, failure }) => {
    window.GMTPortalApi = {
      enabled: () => !failure.disconnected,
      tasks: async () => {
        if (failure.tasks) throw new Error('Protected tasks unavailable for this check.');
        return { records: fixtureTasks, pending: failure.pendingTask ? [{ task: failure.pendingTask }] : [] };
      },
      history: async (kind) => {
        if (kind !== 'tasks' && failure.notifications) {
          throw new Error('Protected history unavailable for this check.');
        }
        if (failure.invalidNotifications) return { unexpected: true };
        return { records: fixtureNotifications };
      }
    };
  }, {
    fixtureTasks: empty ? [] : workflowTasks,
    fixtureNotifications: empty ? [] : notificationRecords,
    failure: { tasks: failTasks, notifications: failNotifications, invalidNotifications, disconnected, pendingTask }
  });
  await page.addScriptTag({ path: resolve(repoRoot, 'portal/dashboard-updates.js') });
  await page.waitForFunction(() => {
    const taskStatus = document.querySelector('#portal-task-board-status');
    const notificationStatus = document.querySelector('#portal-notification-status');
    return taskStatus && notificationStatus && !taskStatus.textContent.startsWith('Loading') && !notificationStatus.textContent.startsWith('Loading');
  });
  return page;
}

try {
  const page = await createDashboardPage({ width: 390, height: 844 }, 'populated');
  assert.equal(await page.locator('[data-updates-slide]').count(), 2, 'dashboard carousel should contain exactly two pages');
  assert.equal(await page.locator('[data-updates-dot]').count(), 2, 'carousel should have one indicator per page');
  assert.equal(await page.locator('[data-updates-slide="0"]').getAttribute('aria-label'), 'Page 1 of 2');
  assert.equal(await page.locator('[data-updates-slide="1"]').getAttribute('aria-label'), 'Page 2 of 2');
  assert.equal(await page.locator('[role="tablist"]').getAttribute('aria-label'), 'Dashboard pages');
  assert.equal(await page.locator('[data-updates-dot="0"]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('[data-updates-dot="0"]').getAttribute('tabindex'), '0');
  assert.equal(await page.locator('[data-updates-dot="1"]').getAttribute('tabindex'), '-1');
  assert.equal(await page.locator('#portal-updates-slide-1 #portal-notifications').count(), 1, 'Updates should be on page 2');
  assert.equal(await page.locator('#portal-updates-slide-1 #portal-task-board').count(), 1, 'Task Board should share page 2');
  assert.equal(await page.locator('#portal-notification-status').innerText(), 'Showing the 8 most recent of 22 updates.', 'the eight-notification limit should be visible to users');

  await page.locator('input[name="employee_name"]').fill('Retained dashboard entry');
  await page.locator('[data-updates-next]').click();
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
  for (const width of [1440, 1024, 851, 850, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector('[data-updates-slide="1"]');
      const columns = getComputedStyle(panel).gridTemplateColumns.trim().split(/\s+/).length;
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        columns,
        pageScrolls: document.documentElement.scrollHeight > innerHeight
      };
    });
    responsiveResults.push(metrics);
    assert.ok(metrics.documentWidth <= width, `document overflows at ${width}px: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.bodyWidth <= width, `body overflows at ${width}px: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.columns, width > 850 ? 2 : 1, `combined panels should ${width > 850 ? 'sit side by side' : 'stack'} at ${width}px`);
    if (width === 390) assert.equal(metrics.pageScrolls, true, 'long task lists should remain reachable through normal vertical page scrolling');
  }

  const emptyPage = await createDashboardPage({ width: 390, height: 844 }, 'empty');
  assert.equal(await emptyPage.locator('#portal-task-board .portal-task-board-empty').count(), 1);
  assert.equal(await emptyPage.locator('#portal-task-board-status').innerText(), 'No tasks yet.');
  assert.equal(await emptyPage.locator('#portal-notification-status').innerText(), 'No new notifications.');
  assert.match(await emptyPage.locator('#portal-notifications').innerText(), /no new notifications/i);
  assert.equal(await emptyPage.locator('#portal-notifications').getAttribute('aria-live'), null, 'notification count should be the only live announcement');
  assert.equal(await emptyPage.locator('#portal-notifications [role="status"]').count(), 0, 'the visual empty card should not create a second live announcement');

  const errorPage = await createDashboardPage({ width: 390, height: 844 }, 'error');
  assert.equal(await errorPage.locator('#portal-task-board-status').innerText(), 'Protected tasks unavailable for this check.');
  assert.equal(await errorPage.locator('#portal-task-board .portal-task-board-empty').count(), 1);

  const notificationsErrorPage = await createDashboardPage({ width: 390, height: 844 }, 'notification-error');
  assert.equal(await notificationsErrorPage.locator('#portal-task-board .portal-task-card').count(), tasks.length, 'task cards should remain available when Updates fail independently');
  assert.equal(await notificationsErrorPage.locator('#portal-notification-status').innerText(), 'Notifications could not be loaded.');
  assert.match(await notificationsErrorPage.locator('#portal-notifications').innerText(), /Task Board status is shown separately/);
  assert.doesNotMatch(await notificationsErrorPage.locator('#portal-notifications').innerText(), /No new notifications/);

  const tasksErrorPage = await createDashboardPage({ width: 390, height: 844 }, 'task-error');
  assert.equal(await tasksErrorPage.locator('#portal-task-board-status').innerText(), 'Protected tasks unavailable for this check.');
  assert.equal(await tasksErrorPage.locator('#portal-task-board .portal-task-board-empty').count(), 1);
  assert.equal(await tasksErrorPage.locator('#portal-notifications [data-notification-index]').count(), 8, 'Updates should remain available when the Task Board fails independently');

  const pendingTaskPage = await createDashboardPage({ width: 390, height: 844 }, 'pending-task');
  assert.equal(await pendingTaskPage.locator('#portal-task-board .portal-task-card').count(), tasks.length, 'pending sync tasks replace their older board record instead of appearing twice');
  assert.match(await pendingTaskPage.locator('#portal-task-board .portal-task-card').first().innerText(), /Pending task retry/);

  const disconnectedPage = await createDashboardPage({ width: 390, height: 844 }, 'disconnected');
  assert.equal(await disconnectedPage.locator('#portal-notification-status').innerText(), 'Notifications are not connected.');
  assert.match(await disconnectedPage.locator('#portal-notifications').innerText(), /Protected notifications are unavailable in this portal/);

  const invalidNotificationsPage = await createDashboardPage({ width: 390, height: 844 }, 'invalid-notifications');
  assert.equal(await invalidNotificationsPage.locator('#portal-notification-status').innerText(), 'Notifications could not be loaded.');
  assert.doesNotMatch(await invalidNotificationsPage.locator('#portal-notifications').innerText(), /No new notifications/);

  console.log(`Dashboard updates and task board acceptance: PASS (${responsiveResults.map((result) => `${result.width}px/${result.columns}col`).join(', ')})`);
} finally {
  await Promise.all(pages.map((page) => page.close()));
  await browser.close();
}
