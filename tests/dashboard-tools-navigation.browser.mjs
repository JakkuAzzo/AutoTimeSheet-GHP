import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (_) {
    response.writeHead(400).end('Bad path');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  let file = resolve(repoRoot, `.${pathname}`);
  if (!extname(file) && existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(repoRoot + sep) && file !== repoRoot) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream' });
  response.end(readFileSync(file));
});

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});

const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const apiOrigin = `${origin}/mock-api`;
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const pages = [];

async function openRoute(path, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  pages.push(page);
  let accessCalls = 0;
  const historyKinds = [];
  const historyRequests = [];
  const historyFailuresRemaining = { tasks: options.historyFailureCount ? 1 : 0, all: options.historyFailureCount ? 1 : 0 };
  let taskCalls = 0;
  let taskFailuresRemaining = options.taskFailureCount || 0;
  let releaseAccess;
  const accessGate = options.holdAccess ? new Promise((resolveAccess) => { releaseAccess = resolveAccess; }) : null;
  await page.route(`${apiOrigin}/api/access`, async (route) => {
    accessCalls += 1;
    if (options.accessFailure && accessCalls === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic access outage' }) });
      return;
    }
    if (accessGate) await accessGate;
    else if (options.accessDelayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, options.accessDelayMs));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(options.access || {}) });
  });
  await page.route(`${apiOrigin}/api/history**`, async (route) => {
    const url = new URL(route.request().url());
    historyKinds.push(url.searchParams.get('kind') || 'all');
    historyRequests.push({ kind: url.searchParams.get('kind') || 'all', limit: url.searchParams.get('limit') });
    const historyKind = url.searchParams.get('kind') || 'all';
    const failOnce = url.searchParams.get('limit') !== '1000' && (historyFailuresRemaining[historyKind] || 0) > 0;
    if (options.historyFailure || failOnce) {
      if (failOnce) historyFailuresRemaining[historyKind] -= 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic history outage' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ records: options.historyRecords || [] }) });
  });
  await page.route(`${apiOrigin}/api/tasks**`, async (route) => {
    taskCalls += 1;
    if (options.taskFailure || taskFailuresRemaining > 0) {
      if (taskFailuresRemaining > 0) taskFailuresRemaining -= 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic task outage' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ records: options.taskRecords || [], pending: [] }) });
  });
  await page.route('**/config.js?*', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.GMT_APP_CONFIG = { portalApiEndpoint: ${JSON.stringify(apiOrigin)}, entraSpaAuth: { enabled: false } };`
    });
  });
  await page.goto(`${origin}${path}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main && !main.hidden;
  });
  return { page, accessCalls: () => accessCalls, taskCalls: () => taskCalls, historyKinds: () => historyKinds.slice(), historyRequests: () => historyRequests.slice(), releaseAccess: () => releaseAccess && releaseAccess() };
}

async function assertInternalLinksResolve(page) {
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
  for (const href of links) {
    const url = new URL(href);
    if (url.origin !== origin || (url.pathname === new URL(page.url()).pathname && url.hash)) continue;
    const response = await page.request.get(url.href);
    assert.ok(response.status() < 400, `${href} should resolve locally, received ${response.status()}`);
  }
}

try {
  const employeeAccess = {
    isAdmin: false,
    isHrAdmin: false,
    isXeroAdmin: false,
    isOperationsAdmin: false,
    isJobCardAdmin: false
  };
  const dashboard = await openRoute('/portal/', { access: employeeAccess });
  const dashboardPage = dashboard.page;
  const sections = await dashboardPage.locator('main > .portal-dashboard-carousel > section, main > section').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') || item.querySelector('h2')?.textContent?.trim() || ''));
  assert.deepEqual(sections.slice(0, 5), ['Today', 'My work', 'My statistics', 'What do you need to do?', 'Shared information'], 'dashboard sections should follow the staff task sequence');
  assert.equal(await dashboardPage.locator('[data-updates-slide], [data-updates-next], [data-updates-prev], [data-updates-dot]').count(), 0, 'dashboard tasks and statistics should not require carousel navigation');
  assert.equal(await dashboardPage.locator('[data-clock-form]').count(), 1, 'daily clock-in should remain on the dashboard');
  await dashboardPage.locator('[data-dashboard-next]').click();
  assert.equal(await dashboardPage.locator('#portal-task-board').isVisible(), true, 'the task board should be visible on the My work slide');
  assert.equal(await dashboardPage.locator('#portal-notifications').isVisible(), true, 'notifications should be visible without navigation');
  await dashboardPage.locator('[data-dashboard-next]').click();
  assert.equal(await dashboardPage.locator('#portal-statistics-title').isVisible(), true, 'personal statistics should be visible on their slide');
  await dashboardPage.locator('#portal-statistics-pay-month').waitFor({ state: 'attached' });
  assert.match(await dashboardPage.locator('#portal-statistics-pay-month').inputValue(), /^\d{4}-\d{2}$/);
  assert.ok(dashboard.historyRequests().some((request) => request.kind === 'all' && request.limit === '500'), 'the dashboard should request the supported 500-record history bound');
  await dashboardPage.evaluate(() => window.GMTPortalApi.history('all', { limit: 1999 }));
  assert.equal(dashboard.historyRequests().at(-1).limit, '1000', 'the history API wrapper should cap requested history at 1000 records');
  assert.equal(await dashboardPage.locator('[data-admin-users-link]').isVisible(), false, 'User management should remain hidden from a standard employee');
  const workPanels = await dashboardPage.locator('.portal-work-section h2').allTextContents();
  assert.deepEqual(workPanels, ['My work', 'Task Board', 'Updates and notifications'], 'My work should put the task board before notifications');
  assert.equal(await dashboardPage.locator('a[href="submissions.html"]').count(), 1, 'Submitted documents should use its local HTML route');
  assert.equal(await dashboardPage.locator('a[href="submissions.html?tab=calendar"]').count(), 1, 'the calendar should use its current submissions route');
  await assertInternalLinksResolve(dashboardPage);

  await dashboardPage.getByRole('link', { name: /Tools/ }).click();
  await dashboardPage.waitForURL('**/tools/');
  const toolsPage = dashboardPage;
  await toolsPage.locator('[data-tools-access-status]').waitFor({ state: 'hidden' });
  const employeeEstimateState = await toolsPage.locator('[data-tool-card="estimates"]').evaluate((element) => ({ hidden: element.hidden, display: getComputedStyle(element).display }));
  assert.equal(await toolsPage.locator('[data-tool-card="estimates"]').isVisible(), false, `estimates should be hidden from a standard employee (${JSON.stringify(employeeEstimateState)})`);
  assert.equal(await toolsPage.locator('[data-tool-card="invoices"]').isVisible(), false, 'invoices should be hidden from users without Xero access');
  assert.equal(await toolsPage.locator('[data-tool-card="job-cards"]').isVisible(), true, 'staff should be able to reach permitted job-card tools');
  assert.equal(await toolsPage.locator('[data-tool-card="tasks"]').isVisible(), true, 'staff should be able to reach their task requests');
  assert.equal(await toolsPage.locator('[data-tool-card="calendar"]').isVisible(), true, 'staff should be able to reach their calendar requests');
  assert.match(await toolsPage.locator('[data-tool-card="tasks"]').innerText(), /assigned work/i);
  assert.match(await toolsPage.locator('[data-tool-card="calendar"]').innerText(), /your requests/i);
  assert.equal(await toolsPage.locator('.header-actions a[href="../jobs/"]').count(), 0, 'Job Cards should have one destination in the Tools hub');
  assert.equal(await toolsPage.locator('.in-progress-badge').count(), 0, 'the Tasks card should not show a stale in-progress badge');
  await assertInternalLinksResolve(toolsPage);

  const admin = await openRoute('/tools/', {
    access: { ...employeeAccess, isAdmin: true, isHrAdmin: true, isXeroAdmin: true, isOperationsAdmin: true, isJobCardAdmin: true },
    holdAccess: true
  });
  assert.equal(await admin.page.locator('[data-tool-card="estimates"]').isVisible(), false, 'privileged cards should remain hidden while access is still loading');
  admin.releaseAccess();
  await admin.page.locator('[data-tools-access-status]').waitFor({ state: 'hidden' });
  assert.equal(await admin.page.locator('[data-tool-card="estimates"]').isVisible(), true, 'portal administrators should see Estimates');
  assert.equal(await admin.page.locator('[data-tool-card="invoices"]').isVisible(), true, 'Xero-authorized users should see Invoices');
  assert.match(await admin.page.locator('[data-tool-card="tasks"]').innerText(), /team/i, 'operations roles should see team task guidance');
  assert.match(await admin.page.locator('[data-tool-card="calendar"]').innerText(), /shared schedule/i, 'privileged calendar viewers should see shared-schedule guidance');
  assert.match(await admin.page.locator('[data-tool-card="job-cards"]').innerText(), /archive/i, 'job-card administrators should see archive guidance');
  await admin.page.goto(`${origin}/portal/`, { waitUntil: 'load' });
  await admin.page.locator('[data-admin-users-link]').waitFor({ state: 'visible' });
  assert.equal(await admin.page.locator('[data-admin-users-link]').isVisible(), true, 'the dashboard should expose User management to a full administrator');

  const hr = await openRoute('/tools/', { access: { ...employeeAccess, isHrAdmin: true, isXeroAdmin: true } });
  await hr.page.locator('[data-tools-access-status]').waitFor({ state: 'hidden' });
  assert.equal(await hr.page.locator('[data-tool-card="job-cards"]').isVisible(), false, 'the HR view should preserve its role-restricted job-card destination');
  assert.equal(await hr.page.locator('[data-tool-card="tasks"]').isVisible(), false, 'the HR view should preserve its role-restricted task destination');
  assert.match(await hr.page.locator('[data-tool-card="calendar"]').innerText(), /shared schedule/i, 'HR should see shared-calendar guidance');
  assert.equal(await hr.page.locator('[data-tool-card="estimates"]').isVisible(), false, 'HR without the full admin role should not see Estimates');
  assert.equal(await hr.page.locator('[data-tool-card="invoices"]').isVisible(), true, 'HR with the Xero role should see Invoices');

  const hrOperations = await openRoute('/tools/', { access: { ...employeeAccess, isHrAdmin: true, isOperationsAdmin: true, isJobCardAdmin: true } });
  await hrOperations.page.locator('[data-tools-access-status]').waitFor({ state: 'hidden' });
  assert.equal(await hrOperations.page.locator('[data-tool-card="job-cards"]').isVisible(), true, 'an additional job-card role should retain its permitted tool for HR');
  assert.equal(await hrOperations.page.locator('[data-tool-card="tasks"]').isVisible(), true, 'an additional operations role should retain its permitted tool for HR');
  assert.match(await hrOperations.page.locator('[data-tool-card="tasks"]').innerText(), /operations team/i);

  const hrJobCard = await openRoute('/tools/', { access: { ...employeeAccess, isHrAdmin: true, isJobCardAdmin: true } });
  await hrJobCard.page.locator('[data-tools-access-status]').waitFor({ state: 'hidden' });
  assert.equal(await hrJobCard.page.locator('[data-tool-card="job-cards"]').isVisible(), true, 'a job-card role should reveal only its authorized tool for HR');
  assert.equal(await hrJobCard.page.locator('[data-tool-card="tasks"]').isVisible(), false, 'a job-card role alone should not reveal task tools to HR');

  const xero = await openRoute('/tools/', { access: { ...employeeAccess, isXeroAdmin: true } });
  await xero.page.locator('[data-tools-access-status]').waitFor({ state: 'hidden' });
  assert.equal(await xero.page.locator('[data-tool-card="invoices"]').isVisible(), true, 'Xero-authorized staff should see Invoices');
  assert.equal(await xero.page.locator('[data-tool-card="estimates"]').isVisible(), false, 'Xero access alone should not grant estimate sending');

  const retry = await openRoute('/tools/', {
    access: { ...employeeAccess, isAdmin: true },
    accessFailure: true
  });
  await retry.page.getByRole('alert').waitFor();
  assert.equal(await retry.page.locator('[data-tool-card="estimates"]').isVisible(), false, 'privileged cards should stay hidden when access is unknown');
  assert.equal(await retry.page.getByRole('alert').innerText(), 'Role-specific tools could not be checked. Retry to refresh access.');
  await retry.page.getByRole('button', { name: 'Retry access check' }).click();
  await retry.page.locator('[data-tool-card="estimates"]').waitFor({ state: 'visible' });
  assert.equal(retry.accessCalls(), 2, 'retry should request the access policy again');

  const syntheticNotification = {
    kind: 'tasks',
    source_record_id: 'synthetic-task-1',
    task_title: 'Synthetic navigation check'
  };
  const notificationPage = await openRoute('/portal/', {
    access: employeeAccess,
    historyRecords: [syntheticNotification]
  });
  await notificationPage.page.locator('[data-dashboard-next]').click();
  await notificationPage.page.locator('[data-notification-index="0"]').click();
  const submittedDocumentLink = notificationPage.page.locator('.portal-notification-dialog a[href*="/portal/submissions"]');
  const submittedDocumentHref = await submittedDocumentLink.getAttribute('href');
  assert.equal(submittedDocumentHref, '/portal/submissions.html?record=synthetic-task-1', 'notification details should link to the served Submitted documents route');
  assert.equal((await notificationPage.page.request.get(`${origin}${submittedDocumentHref}`)).status(), 200, 'the notification destination should resolve locally');

  const dashboardError = await openRoute('/portal/', { access: employeeAccess, historyFailure: true, taskFailure: true });
  await dashboardError.page.waitForFunction(() => !document.querySelector('#portal-task-board-status').textContent.startsWith('Loading'));
  assert.equal(await dashboardError.page.locator('#portal-task-board-status').innerText(), 'Synthetic history outage');
  assert.equal(await dashboardError.page.locator('#portal-notification-status').innerText(), 'Notifications could not be loaded.');

  const dashboardRetry = await openRoute('/portal/', { access: employeeAccess, historyFailureCount: 2, taskFailureCount: 1 });
  await dashboardRetry.page.locator('[data-dashboard-next]').click();
  await dashboardRetry.page.waitForFunction(() => !document.querySelector('#portal-task-board-status').textContent.startsWith('Loading')
    && !document.querySelector('#portal-notification-status').textContent.startsWith('Loading'));
  assert.equal(await dashboardRetry.page.getByRole('button', { name: 'Retry task history' }).isVisible(), true, 'the Task Board error should offer a retry');
  assert.equal(await dashboardRetry.page.getByRole('button', { name: 'Retry notifications' }).isVisible(), true, `the Updates error should offer a retry; calls: ${JSON.stringify(dashboardRetry.historyRequests())}; status: ${await dashboardRetry.page.locator('#portal-notification-status').innerText()}`);
  await dashboardRetry.page.getByRole('button', { name: 'Retry task history' }).click();
  await dashboardRetry.page.getByRole('button', { name: 'Retry notifications' }).click();
  await dashboardRetry.page.waitForFunction(() => document.querySelector('#portal-task-board-status').textContent === 'No tasks yet.'
    && document.querySelector('#portal-notification-status').textContent === 'No new notifications.', null, { timeout: 8000 });
  assert.equal(await dashboardRetry.page.getByRole('button', { name: 'Retry task history' }).isVisible(), false, 'a recovered Task Board should clear its retry');
  assert.equal(dashboardRetry.historyKinds().filter((kind) => kind === 'tasks').length, 2, 'retry should reload task history independently');
  assert.equal(dashboardRetry.taskCalls(), 2, 'retry should reload the workflow task source independently');
  assert.equal(dashboardRetry.historyKinds().filter((kind) => kind === 'all').length, 3, 'notification retry should share its own history request; calendar loading remains separate');

  const groupedTools = readFileSync(resolve(repoRoot, 'tools/index.html'), 'utf8');
  assert.match(groupedTools, /aria-labelledby="tools-time-title"[\s\S]*?data-tool-card="calendar"[\s\S]*?data-tool-card="timesheets"[\s\S]*?data-tool-card="submissions"/, 'Time and attendance should group calendar, weekly timesheets and submission history');
  assert.match(groupedTools, /aria-labelledby="tools-workshop-title"[\s\S]*?data-tool-card="job-cards"[\s\S]*?data-tool-card="tasks"/, 'Workshop work should group job cards and tasks');
  assert.match(groupedTools, /aria-labelledby="tools-accounts-title"[\s\S]*?data-tool-card="estimates"[\s\S]*?data-tool-card="invoices"/, 'Accounts should group estimates and Xero invoices');

  console.log('Dashboard and Tools route navigation, role access and loading/error states: PASS');
} finally {
  await Promise.all(pages.map((page) => page.close()));
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
