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
  const file = resolve(repoRoot, `.${pathname}`);
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
  pages.push(page);
  let accessCalls = 0;
  const historyKinds = [];
  const historyRequests = [];
  let historyFailuresRemaining = options.historyFailureCount || 0;
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
    if (options.historyFailure || historyFailuresRemaining > 0) {
      if (historyFailuresRemaining > 0) historyFailuresRemaining -= 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic history outage' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ records: options.historyRecords || [] }) });
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
  return { page, accessCalls: () => accessCalls, historyKinds: () => historyKinds.slice(), historyRequests: () => historyRequests.slice(), releaseAccess: () => releaseAccess && releaseAccess() };
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
  const slides = dashboardPage.locator('[data-updates-slide]');
  assert.equal(await slides.count(), 3, 'the dashboard should keep three carousel pages');
  assert.match(await slides.nth(0).innerText(), /Daily clock-in/i);
  assert.equal(await slides.nth(0).locator('[data-clock-form]').count(), 1, 'daily clock-in should remain on the first dashboard page');
  assert.equal(await slides.nth(0).getAttribute('hidden'), null, 'Daily Clock-In should be the initially selected page');
  assert.equal(await slides.nth(1).getAttribute('hidden'), '', 'the second dashboard page should stay behind the page control');
  assert.equal(await slides.nth(2).getAttribute('aria-label'), 'Page 3 of 3', 'personal statistics should be the third accessible carousel slide');
  assert.equal(await slides.nth(2).getAttribute('hidden'), '', 'personal statistics should stay behind the page control initially');
  assert.match(await slides.nth(2).innerText(), /My statistics/i);
  await dashboardPage.locator('#portal-statistics-pay-month').waitFor({ state: 'attached' });
  assert.match(await dashboardPage.locator('#portal-statistics-pay-month').inputValue(), /^\d{4}-\d{2}$/);
  assert.ok(dashboard.historyRequests().some((request) => request.kind === 'all' && request.limit === '500'), 'the dashboard should request the supported 500-record history bound');
  await dashboardPage.evaluate(() => window.GMTPortalApi.history('all', { limit: 999 }));
  assert.equal(dashboard.historyRequests().at(-1).limit, '500', 'the history API wrapper should cap requested history at 500 records');
  await dashboardPage.locator('[data-updates-dot="2"]').click();
  assert.equal(await slides.nth(2).getAttribute('hidden'), null, 'staff should be able to select personal statistics');
  await dashboardPage.locator('[data-updates-dot="0"]').click();
  assert.equal(await dashboardPage.locator('[data-admin-users-link]').isVisible(), false, 'User management should remain hidden from a standard employee');
  const secondPagePanels = await slides.nth(1).locator('.portal-updates-feed-panel h2').allTextContents();
  assert.deepEqual(secondPagePanels, ['Updates and notifications', 'Task Board'], 'Updates and Task Board should retain their intended panel order');
  assert.equal(await dashboardPage.locator('a[href="submissions.html"]').count(), 1, 'Submitted documents should use its local HTML route');
  assert.equal(await dashboardPage.locator('a[href="timesheets.html"]').count(), 1, 'the calendar should use its local HTML route');
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
  await notificationPage.page.locator('[data-updates-next]').click();
  await notificationPage.page.locator('[data-notification-index="0"]').click();
  const submittedDocumentLink = notificationPage.page.locator('.portal-notification-dialog a[href*="/portal/submissions"]');
  const submittedDocumentHref = await submittedDocumentLink.getAttribute('href');
  assert.equal(submittedDocumentHref, '/portal/submissions.html?record=synthetic-task-1', 'notification details should link to the served Submitted documents route');
  assert.equal((await notificationPage.page.request.get(`${origin}${submittedDocumentHref}`)).status(), 200, 'the notification destination should resolve locally');

  const dashboardError = await openRoute('/portal/', { access: employeeAccess, historyFailure: true });
  await dashboardError.page.locator('[data-updates-next]').click();
  await dashboardError.page.waitForFunction(() => !document.querySelector('#portal-task-board-status').textContent.startsWith('Loading'));
  assert.equal(await dashboardError.page.locator('#portal-task-board-status').innerText(), 'Synthetic history outage');
  assert.equal(await dashboardError.page.locator('#portal-notification-status').innerText(), 'Notifications could not be loaded.');

  const dashboardRetry = await openRoute('/portal/', { access: employeeAccess, historyFailureCount: 2 });
  await dashboardRetry.page.locator('[data-updates-next]').click();
  await dashboardRetry.page.waitForFunction(() => !document.querySelector('#portal-task-board-status').textContent.startsWith('Loading')
    && !document.querySelector('#portal-notification-status').textContent.startsWith('Loading'));
  assert.equal(await dashboardRetry.page.getByRole('button', { name: 'Retry task history' }).isVisible(), true, 'the Task Board error should offer a retry');
  assert.equal(await dashboardRetry.page.getByRole('button', { name: 'Retry notifications' }).isVisible(), true, 'the Updates error should offer a retry');
  await dashboardRetry.page.getByRole('button', { name: 'Retry task history' }).click();
  await dashboardRetry.page.getByRole('button', { name: 'Retry notifications' }).click();
  await dashboardRetry.page.waitForFunction(() => document.querySelector('#portal-task-board-status').textContent === 'No submitted tasks yet.'
    && document.querySelector('#portal-notification-status').textContent === 'No new notifications.');
  assert.equal(await dashboardRetry.page.getByRole('button', { name: 'Retry task history' }).isVisible(), false, 'a recovered Task Board should clear its retry');
  assert.equal(dashboardRetry.historyKinds().filter((kind) => kind === 'tasks').length, 2, 'retry should reload task history independently');
  assert.equal(dashboardRetry.historyKinds().filter((kind) => kind === 'all').length, 3, 'notification retry should share its own history request; calendar loading remains separate');

  console.log('Dashboard and Tools route navigation, role access and loading/error states: PASS');
} finally {
  await Promise.all(pages.map((page) => page.close()));
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
