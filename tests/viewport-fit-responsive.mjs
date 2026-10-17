import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
function listHtmlFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'output', 'coverage'].includes(entry.name)) return [];
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return listHtmlFiles(absolutePath, relativePath);
    if (!entry.isFile() || !entry.name.endsWith('.html')) return [];
    return [relativePath === 'index.html' ? '/' : relativePath.endsWith('/index.html')
      ? `/${relativePath.slice(0, -'index.html'.length)}`
      : `/${relativePath}`];
  });
}
const routes = listHtmlFiles(root).sort();
const authenticatedRoutes = new Set([
  '/portal/', '/portal/account.html', '/portal/submissions.html', '/portal/timesheets.html', '/portal/users.html',
  '/timesheets.html', '/timesheets/create.html', '/timesheets/',
  '/account.html', '/audit/', '/calendar/', '/jobs/', '/tasks/', '/tools/estimates.html', '/tools/', '/tools/invoices.html',
  '/tools/job-card-import.html', '/training/'
]);
const parentAuthenticatedRoutes = new Set(['/portal/history-frame.html']);
assert.deepEqual([...authenticatedRoutes].filter((route) => !routes.includes(route)), [], 'every protected route in the scope inventory must exist');
assert.deepEqual([...parentAuthenticatedRoutes].filter((route) => !routes.includes(route)), [], 'every parent-authenticated frame route in the scope inventory must exist');
const orderedRoutes = [...authenticatedRoutes, ...routes.filter((route) => !authenticatedRoutes.has(route))];
const selectedRoute = process.env.GMT_VIEWPORT_ROUTE || '';
assert.ok(!selectedRoute || orderedRoutes.includes(selectedRoute), `GMT_VIEWPORT_ROUTE must match a discovered page route: ${selectedRoute}`);
const routesToTest = selectedRoute ? [selectedRoute] : routes;
const viewports = [[320, 568], [390, 844], [667, 375], [768, 1024], [1280, 720], [1440, 900]];
const apiMutationAttempts = [];
const injectApiMutationAttempts = process.env.GMT_VIEWPORT_INJECT_API_MUTATIONS === '1';
const syntheticMsal = `window.msal = (function () {
  var account;
  function testAccount() {
    var config = window.GMT_APP_CONFIG && window.GMT_APP_CONFIG.entraSpaAuth || {};
    return {
      homeAccountId: 'portal-viewport-test-account',
      username: 'portal-viewport@example.test',
      name: 'Portal viewport test identity',
      tenantId: config.tenantId,
      idTokenClaims: { name: 'Portal viewport test identity', preferred_username: 'portal-viewport@example.test', tid: config.tenantId, groups: [] }
    };
  }
  function PublicClientApplication() {}
  PublicClientApplication.prototype.initialize = async function () {};
  PublicClientApplication.prototype.handleRedirectPromise = async function () {
    account = testAccount();
    return { account: account, idToken: 'synthetic-viewport-id-token' };
  };
  PublicClientApplication.prototype.getActiveAccount = function () { return account || null; };
  PublicClientApplication.prototype.setActiveAccount = function (value) { account = value || null; };
  PublicClientApplication.prototype.acquireTokenSilent = async function () {
    return { idToken: 'synthetic-viewport-id-token', accessToken: 'synthetic-viewport-access-token' };
  };
  PublicClientApplication.prototype.loginRedirect = async function () { throw new Error('Synthetic viewport account unexpectedly requested a sign-in redirect.'); };
  PublicClientApplication.prototype.acquireTokenRedirect = async function () { throw new Error('Synthetic viewport account unexpectedly requested a consent redirect.'); };
  PublicClientApplication.prototype.getTokenCache = function () { return { removeAccount: async function () {} }; };
  return { PublicClientApplication: PublicClientApplication };
}());`;

async function seedSyntheticViewportState(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main:not([hidden])');
    if (!main) return { mainVisible: false };
    const longContent = 'Synthetic viewport fixture only. This deliberately long note checks that authenticated GMT forms and records expand, wrap, and remain reachable on narrow screens. '.repeat(7);
    window.__GMT_VIEWPORT_TEST_STATE__ = Object.freeze({ identity: 'portal-viewport@example.test', source: 'local-synthetic-fixture', writesBlocked: true });

    main.querySelector('#generate-days-btn')?.click();
    main.querySelector('#add-estimate-line')?.click();
    main.querySelector('#xero-add-invoice-line')?.click();

    let fieldIndex = 0;
    main.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea').forEach((field) => {
      if (field.closest('[hidden]')) return;
      const type = String(field.type || '').toLowerCase();
      if (['date', 'month', 'time', 'number'].includes(type)) return;
      fieldIndex += 1;
      const value = type === 'email'
        ? `viewport-${fieldIndex}@example.test`
        : type === 'url'
          ? `https://example.test/${'synthetic-record-'.repeat(4)}`
          : longContent;
      field.value = field.maxLength > 0 ? value.slice(0, field.maxLength) : value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });

    main.querySelectorAll('form:not([method="dialog"])').forEach((form) => {
      const message = document.createElement('p');
      message.className = 'small-text';
      message.setAttribute('role', 'alert');
      message.dataset.viewportValidation = 'synthetic';
      message.textContent = `Synthetic validation state: ${longContent}`;
      form.appendChild(message);
    });

    const tables = new Set([
      ...main.querySelectorAll('.table-scroll table'),
      ...main.querySelectorAll('table.portal-table, table.timesheet-editor-grid, table.pay-month-edit-table')
    ]);
    tables.forEach((table) => {
      if (table.matches('.estimate-paper-table')) return;
      const header = table.tHead?.rows[table.tHead.rows.length - 1];
      if (!header?.cells.length) return;
      const body = table.tBodies[0] || table.createTBody();
      const row = document.createElement('tr');
      row.dataset.viewportSyntheticRow = 'true';
      Array.from(header.cells).forEach((heading, index) => {
        const cell = document.createElement('td');
        cell.dataset.label = heading.textContent.trim() || `Column ${index + 1}`;
        if (index === header.cells.length - 1 && /action/i.test(heading.textContent)) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'secondary';
          button.textContent = 'Open synthetic row';
          cell.appendChild(button);
        } else {
          cell.textContent = `Synthetic record ${index + 1}: ${longContent.slice(0, 110)}`;
        }
        row.appendChild(cell);
      });
      body.appendChild(row);
    });

    let calendarGridCount = 0;
    const fillCalendar = (grid, portalCalendar) => {
      calendarGridCount += 1;
      grid.replaceChildren();
      for (let day = 1; day <= 35; day += 1) {
        const cell = document.createElement('article');
        cell.className = portalCalendar ? 'portal-calendar-day' : 'calendar-day';
        if (day === 17) cell.classList.add(portalCalendar ? 'is-today' : 'calendar-day-today');
        const date = `2026-10-${String(day).padStart(2, '0')}`;
        if (portalCalendar) {
          const dateButton = document.createElement('button');
          dateButton.type = 'button';
          dateButton.className = 'calendar-day-date';
          dateButton.textContent = String(day);
          cell.appendChild(dateButton);
        } else {
          const time = document.createElement('time');
          time.dateTime = date;
          time.textContent = String(day);
          cell.appendChild(time);
        }
        const eventCount = day === 12 ? 4 : day === 13 ? 1 : 0;
        for (let index = 0; index < eventCount; index += 1) {
          const event = document.createElement('button');
          event.type = 'button';
          event.className = `calendar-event ${portalCalendar ? 'calendar-event-calendar' : 'calendar-event-job'}`;
          event.dataset.viewportSyntheticEvent = 'true';
          event.textContent = `Synthetic calendar entry ${index + 1}: ${longContent.slice(0, 84)}`;
          cell.appendChild(event);
        }
        if (day === 12) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'calendar-more';
          more.textContent = '+1 more';
          cell.appendChild(more);
        }
        grid.appendChild(cell);
      }
    };
    main.querySelectorAll('.calendar-month-grid').forEach((grid) => fillCalendar(grid, false));
    main.querySelectorAll('[data-portal-calendar]').forEach((grid) => fillCalendar(grid, true));

    const jobArchive = main.querySelector('#job-card-archive-results');
    if (jobArchive) {
      const result = document.createElement('button');
      result.type = 'button';
      result.className = 'job-card-archive-result';
      result.dataset.jobArchiveSelect = 'viewport-synthetic-job-card';
      result.dataset.viewportSynthetic = 'true';
      result.innerHTML = '<strong>Synthetic job card VIEWPORT-001</strong><span>Synthetic customer with a deliberately long name for wrapping</span><small>EC · viewport-only-source.pdf page 1 · 2026-10-17</small><small>OCR candidate · Accounts review needed · OCR confidence 86%</small>';
      jobArchive.replaceChildren(result);
      const detail = main.querySelector('#job-card-archive-detail');
      if (detail) detail.innerHTML = `<header><h3>Synthetic archive detail · ${longContent}</h3></header><dl><dt>Work description</dt><dd>${longContent}</dd></dl><form class="job-card-archive-review-form"><label>Review note<textarea>${longContent}</textarea></label><button type="button">Save synthetic review</button></form>`;
    }

    const estimateArchive = main.querySelector('#estimate-archive-results');
    if (estimateArchive) {
      const result = document.createElement('button');
      result.type = 'button';
      result.className = 'estimate-history-item';
      result.dataset.archiveId = 'viewport-synthetic-estimate-email';
      result.dataset.viewportSynthetic = 'true';
      result.innerHTML = '<strong>Synthetic estimate email VIEWPORT-001</strong><span>Synthetic customer and reference with long content</span><small>2026-10-17 · local viewport fixture · candidate</small>';
      estimateArchive.replaceChildren(result);
      const detail = main.querySelector('#estimate-archive-detail');
      if (detail) detail.innerHTML = `<header><h3>Synthetic estimate archive detail</h3><p>${longContent}</p></header><section><h4>Attachments</h4><button type="button" class="secondary">Download synthetic attachment</button></section>`;
    }

    const submissionsList = main.querySelector('#submissions-list');
    if (submissionsList) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'estimate-history-item';
      item.dataset.viewportSynthetic = 'true';
      item.innerHTML = '<strong>Synthetic October 2026 record</strong><span>Viewport-only employee</span><small>Timesheet · 2026-10-17</small>';
      submissionsList.appendChild(item);
    }
    const historyFrameList = main.querySelector('#history-frame-list');
    if (historyFrameList) {
      const item = document.createElement('article');
      item.className = 'portal-history-entry';
      item.dataset.viewportSynthetic = 'true';
      item.textContent = `Synthetic parent-authenticated history entry: ${longContent}`;
      historyFrameList.replaceChildren(item);
    }

    document.querySelectorAll('dialog').forEach((dialog) => {
      const messages = dialog.querySelector('.estimate-conversation-messages');
      const details = dialog.querySelector('#submissions-delivery-details');
      if (messages) {
        messages.replaceChildren();
        for (let index = 0; index < 8; index += 1) {
          const message = document.createElement('article');
          message.className = 'estimate-conversation-message';
          message.dataset.viewportDialogFixture = 'true';
          message.innerHTML = `<div><strong>Synthetic message ${index + 1}</strong><span>${longContent.slice(0, 150)}</span></div><button type="button" class="secondary">View synthetic message</button>`;
          messages.appendChild(message);
        }
      } else if (details) {
        details.replaceChildren();
        for (let index = 0; index < 10; index += 1) {
          const detail = document.createElement('p');
          detail.dataset.viewportDialogFixture = 'true';
          detail.textContent = `Synthetic delivery item ${index + 1}: ${longContent}`;
          details.appendChild(detail);
        }
      } else {
        const fixture = document.createElement('div');
        fixture.dataset.viewportDialogFixture = 'true';
        fixture.textContent = longContent.repeat(3);
        dialog.appendChild(fixture);
      }
      dialog.querySelectorAll('pre').forEach((pre) => { pre.textContent = longContent.repeat(3); });
    });

    return {
      mainVisible: true,
      forms: main.querySelectorAll('form:not([method="dialog"])').length,
      validationMessages: main.querySelectorAll('[data-viewport-validation]').length,
      tableRows: main.querySelectorAll('tr[data-viewport-synthetic-row]').length,
      calendarGrids: calendarGridCount,
      calendarEvents: main.querySelectorAll('[data-viewport-synthetic-event]').length,
      jobCardArchiveRows: main.querySelectorAll('#job-card-archive-results [data-viewport-synthetic]').length,
      estimateArchiveRows: main.querySelectorAll('#estimate-archive-results [data-viewport-synthetic]').length,
      historyFrameRows: main.querySelectorAll('#history-frame-list [data-viewport-synthetic]').length,
      invoiceRows: main.querySelectorAll('#xero-invoice-table tr[data-viewport-synthetic-row]').length,
      dialogs: document.querySelectorAll('dialog').length,
      dialogFixtures: document.querySelectorAll('dialog [data-viewport-dialog-fixture]').length
    };
  });
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/api/')) {
    if (request.method !== 'GET') {
      apiMutationAttempts.push(`${request.method} ${pathname}`);
      response.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Viewport fixtures allow read-only requests only.' }));
      return;
    }
    const fixtures = {
      '/api/access': { isAdmin: true, isHrAdmin: true, isXeroAdmin: true, isOperationsAdmin: true, isJobCardAdmin: true, isJobCardArchiveAdmin: true },
      '/api/admin/users': { users: [{ display_name: 'Synthetic viewport administrator', owner_upn: 'portal-viewport@example.test', owner_oid: 'viewport-test-object', role: 'admin', updated_at: '2026-10-17T09:00:00Z' }], configured: [] },
      '/api/profile': { profile: { name: 'Portal viewport test identity', username: 'portal-viewport@example.test', notificationEmail: '' } },
      '/api/history': { records: [], meta: { is_admin: true, is_hr_admin: true, is_operations_admin: true, completion: { employees: [] } } },
      '/api/job-cards/archive/access': { allowed: true, can_import: true, is_admin: true },
      '/api/job-cards/archive/search': { records: [], nextCursor: null },
      '/api/archive/estimates': { records: [], nextCursor: null },
      '/api/estimates/index': { records: [] },
      '/api/xero/status': { configured: false, connections: [] },
      '/api/pay-month-starts': { starts: [] }
    };
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(fixtures[pathname] || {}));
    return;
  }
  let path = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!existsSync(path) && !pathname.endsWith('.html') && existsSync(`${path}.html`)) path = `${path}.html`;
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
  response.end(pathname === '/config.js'
    ? readFileSync(path, 'utf8').replace(/(portalApiEndpoint:\s*)"[^"]*"/, (_, prefix) => `${prefix}${JSON.stringify(`http://127.0.0.1:${server.address().port}`)}`)
    : readFileSync(path));
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: viewports[0][0], height: viewports[0][1] } });
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname === '/npm/@azure/msal-browser@4.25.1/lib/msal-browser.min.js') {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: syntheticMsal });
      return;
    }
    if (url.origin === localOrigin) {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  if (injectApiMutationAttempts) {
    await page.addInitScript(() => {
      const key = 'gmt-viewport-api-mutation-probe';
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'pending');
      Promise.all(['POST', 'PATCH', 'DELETE'].map((method) => fetch('/api/__viewport-mutation-guard__', { method })))
        .then((responses) => sessionStorage.setItem(key, responses.every((response) => response.status === 405) ? 'blocked' : 'unexpected-response'))
        .catch(() => sessionStorage.setItem(key, 'request-failed'));
    });
  }
  const failures = [];
  const dynamicCoverage = { forms: 0, validationMessages: 0, tableRows: 0, calendarGrids: 0, calendarEvents: 0, jobCardArchiveRows: 0, estimateArchiveRows: 0, historyFrameRows: 0, invoiceRows: 0, dialogs: 0, dialogFixtures: 0 };

  for (const route of routesToTest) {
    if (process.env.GMT_VIEWPORT_VERBOSE) console.log(`Checking ${route}`);
    let contentTarget = page;
    let dynamicState = null;
    if (parentAuthenticatedRoutes.has(route)) {
      await page.goto(`${localOrigin}/portal/`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.dataset.gmtAuthenticated === 'true', { timeout: 10000 });
      const authState = await page.evaluate(() => ({
        authenticated: document.documentElement.dataset.gmtAuthenticated === 'true',
        tokenProviderAvailable: typeof window.GMT_PORTAL_AUTH?.acquireToken === 'function',
        mainVisible: !!document.querySelector('main:not([hidden])')
      }));
      assert.equal(authState.authenticated, true, `${route}: parent did not pass through an authenticated sign-in state`);
      assert.equal(authState.tokenProviderAvailable, true, `${route}: parent authenticated token provider is unavailable`);
      assert.equal(authState.mainVisible, true, `${route}: parent authenticated main content is hidden`);
      await page.waitForTimeout(200);
      await page.evaluate(async (src) => {
        const frame = document.createElement('iframe');
        frame.id = 'viewport-history-frame';
        frame.title = 'Synthetic parent-authenticated history view';
        frame.style.cssText = 'position:fixed;inset:0;z-index:10000;width:100vw;height:100vh;border:0';
        const loaded = new Promise((resolve, reject) => {
          frame.addEventListener('load', resolve, { once: true });
          frame.addEventListener('error', reject, { once: true });
        });
        frame.src = src;
        document.body.appendChild(frame);
        await loaded;
      }, route);
      contentTarget = page.frames().find((frame) => new URL(frame.url()).pathname === route);
      assert.ok(contentTarget, `${route}: protected history frame did not load under its parent`);
      await contentTarget.waitForFunction(() => document.readyState === 'complete' && !!document.querySelector('main:not([hidden])'), { timeout: 5000 });
      const frameState = await contentTarget.evaluate(() => ({
        mainVisible: !!document.querySelector('main:not([hidden])'),
        parentAuthenticated: window.parent !== window && !!window.parent.GMT_PORTAL_AUTH_READY,
        tokenProviderAvailable: typeof window.parent.GMT_PORTAL_AUTH?.acquireToken === 'function'
      }));
      assert.equal(frameState.mainVisible, true, `${route}: embedded history content is hidden`);
      assert.equal(frameState.parentAuthenticated, true, `${route}: embedded history view is missing its authenticated parent context`);
      assert.equal(frameState.tokenProviderAvailable, true, `${route}: embedded history view cannot access the parent token provider`);
    } else {
      await page.goto(`${localOrigin}${route}`, { waitUntil: 'load' });
    }
    if (authenticatedRoutes.has(route)) {
      await page.waitForFunction(() => document.documentElement.dataset.gmtAuthenticated === 'true', { timeout: 10000 });
      const authState = await page.evaluate(() => ({
        authenticated: document.documentElement.dataset.gmtAuthenticated === 'true',
        tokenProviderAvailable: typeof window.GMT_PORTAL_AUTH?.acquireToken === 'function',
        mainVisible: !!document.querySelector('main:not([hidden])')
      }));
      assert.equal(authState.authenticated, true, `${route}: protected route did not pass through an authenticated sign-in state`);
      assert.equal(authState.tokenProviderAvailable, true, `${route}: authenticated token provider is unavailable`);
      assert.equal(authState.mainVisible, true, `${route}: authenticated main content is hidden`);
    }
    if (authenticatedRoutes.has(route) || parentAuthenticatedRoutes.has(route)) {
      await contentTarget.waitForTimeout(250);
      dynamicState = await seedSyntheticViewportState(contentTarget);
      assert.equal(dynamicState.mainVisible, true, `${route}: synthetic authenticated state could not be seeded`);
      Object.keys(dynamicCoverage).forEach((key) => { dynamicCoverage[key] += Number(dynamicState[key] || 0); });
      if (process.env.GMT_VIEWPORT_VERBOSE) console.log(`  synthetic coverage: ${JSON.stringify(dynamicState)}`);
    }
    await contentTarget.evaluate((isAuthenticatedRoute) => {
      if (!isAuthenticatedRoute) document.querySelectorAll('main[hidden]').forEach((main) => { main.hidden = false; main.removeAttribute('aria-hidden'); });
      window.GMTViewportEffects?.init(document);
    }, authenticatedRoutes.has(route) || parentAuthenticatedRoutes.has(route));
    await page.waitForTimeout(40);
    const motion = await contentTarget.evaluate(() => {
      const reveal = document.querySelector('[data-scroll-reveal]');
      const duration = reveal ? getComputedStyle(reveal).transitionDuration.split(',')[0].trim() : '0s';
      return {
        ready: document.documentElement.getAttribute('data-viewport-effects-ready') === 'true',
        revealCount: document.querySelectorAll('[data-scroll-reveal]').length,
        revealTransition: duration
      };
    });
    if (!motion.ready) failures.push(`${route}: viewport and reveal effects did not initialize`);
    if (motion.revealCount && motion.revealTransition === '0s') failures.push(`${route}: scroll-reveal targets have no transition`);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(40);
      const layout = await contentTarget.evaluate(() => {
        const root = document.documentElement;
        const main = document.querySelector('main:not([hidden])');
        const firstSnapPanel = document.querySelector('[data-scroll-snap]');
        const firstSnapRect = firstSnapPanel?.getBoundingClientRect();
        const panels = [...document.querySelectorAll('[data-scroll-snap]')].map((panel) => {
          const rect = panel.getBoundingClientRect();
          const style = getComputedStyle(panel);
          return {
            className: typeof panel.className === 'string' ? panel.className : '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            clientHeight: panel.clientHeight,
            scrollHeight: panel.scrollHeight,
            overflowY: style.overflowY,
            snapAlign: style.scrollSnapAlign
          };
        });
        const visible = (element) => {
          if (element.hidden || element.closest('[hidden], [aria-hidden="true"]') || element.classList.contains('sr-only')) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const controls = [...(main?.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a[href], video[controls], audio[controls], [tabindex]:not([tabindex="-1"])') || [])].filter(visible);
        const controlIssues = controls.map((element) => {
          const rect = element.getBoundingClientRect();
          const scrollHost = element.closest('.table-scroll, .pay-month-table-scroll');
          const hostStyle = scrollHost ? getComputedStyle(scrollHost) : null;
          const horizontallyScrollable = !!scrollHost && ['auto', 'scroll'].includes(hostStyle.overflowX);
          const name = element.id || element.getAttribute('aria-label') || element.textContent.trim().slice(0, 32) || element.tagName.toLowerCase();
          if (rect.width < 1 || rect.height < 1) return `${name} has no visible hit area`;
          if (!horizontallyScrollable && (rect.left < -1 || rect.right > innerWidth + 1)) return `${name} extends outside the viewport (${Math.round(rect.left)}–${Math.round(rect.right)}px)`;
          return null;
        }).filter(Boolean);
        const clippingCandidates = [...(main?.querySelectorAll('form, .card, .estimate-paper, .calendar-day, .portal-calendar-day') || [])].filter(visible);
        const clippedContainers = clippingCandidates.filter((element) => {
          const style = getComputedStyle(element);
          return ['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
        }).map((element) => element.id || element.className || element.tagName.toLowerCase());
        const tableScrollers = [...(main?.querySelectorAll('.table-scroll, .pay-month-table-scroll') || [])].filter(visible).map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: Math.round(rect.left), right: Math.round(rect.right), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX };
        });
        const dialogStates = [];
        document.querySelectorAll('dialog:not([hidden])').forEach((dialog) => {
          try {
            if (!dialog.open) dialog.showModal();
            const rect = dialog.getBoundingClientRect();
            const style = getComputedStyle(dialog);
            const nestedClips = [...dialog.querySelectorAll('.estimate-conversation-messages, #submissions-delivery-details, pre')]
              .filter((element) => element.scrollHeight > element.clientHeight + 2 && ['hidden', 'clip'].includes(getComputedStyle(element).overflowY))
              .map((element) => element.id || element.className || element.tagName.toLowerCase());
            dialogStates.push({
              left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom),
              scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight, overflowY: style.overflowY,
              focusInside: dialog.contains(document.activeElement), nestedClips
            });
            dialog.close();
          } catch (error) {
            dialogStates.push({ error: error.message || String(error) });
            if (dialog.open) dialog.close();
          }
        });
        return {
          path: location.pathname,
          width: innerWidth,
          height: innerHeight,
          documentWidth: root.scrollWidth,
          documentHeight: root.scrollHeight,
          clientWidth: root.clientWidth,
          rootOverflowY: getComputedStyle(root).overflowY,
          scrollBehavior: getComputedStyle(main || root).scrollBehavior,
          mainScrollType: main ? getComputedStyle(main).scrollSnapType : 'none',
          mainOverflowY: main ? getComputedStyle(main).overflowY : 'visible',
          rootScrollSnapType: getComputedStyle(root).scrollSnapType,
          mainHeight: main ? Math.round(main.getBoundingClientRect().height) : null,
          mainBottom: main ? Math.round(main.getBoundingClientRect().bottom) : null,
          hasPortalShell: root.getAttribute('data-portal-viewport-shell') === 'true',
          firstPanelBottom: firstSnapPanel ? Math.round(firstSnapPanel.getBoundingClientRect().bottom) : null,
          firstPanelTop: firstSnapRect ? Math.round(firstSnapRect.top) : null,
          firstPanelHeight: firstSnapRect ? Math.round(firstSnapRect.height) : null,
          firstPanelOffset: getComputedStyle(root).getPropertyValue('--gmt-public-first-section-offset').trim(),
          panels,
          visibleControlCount: controls.length,
          controlIssues,
          clippedContainers,
          tableScrollers,
          dialogStates
        };
      });
      if (layout.documentWidth > width + 1) failures.push(`${route} at ${width}x${height}: document width ${layout.documentWidth}px exceeds viewport`);
      if (layout.hasPortalShell && layout.mainBottom > height + 1) {
        failures.push(`${route} at ${width}x${height}: portal shell exceeds the viewport height (main bottom ${layout.mainBottom}px, main height ${layout.mainHeight}px)`);
      }
      if (layout.hasPortalShell && !['hidden', 'clip'].includes(layout.rootOverflowY)) failures.push(`${route} at ${width}x${height}: portal document root is not constrained to its viewport`);
      if (layout.hasPortalShell && layout.mainOverflowY !== 'auto') failures.push(`${route} at ${width}x${height}: portal content is not contained in a scrollable viewport panel`);
      if (authenticatedRoutes.has(route) && (layout.rootScrollSnapType.includes('y') || layout.mainScrollType.includes('y'))) {
        failures.push(`${route} at ${width}x${height}: authenticated workflow unexpectedly uses vertical scroll snapping`);
      }
      if (authenticatedRoutes.has(route) && !layout.visibleControlCount) failures.push(`${route} at ${width}x${height}: no visible authenticated controls were found`);
      if (layout.controlIssues.length) failures.push(`${route} at ${width}x${height}: unusable controls: ${layout.controlIssues.slice(0, 4).join('; ')}`);
      if (layout.clippedContainers.length) failures.push(`${route} at ${width}x${height}: content is clipped in ${layout.clippedContainers.slice(0, 4).join(', ')}`);
      for (const scroller of layout.tableScrollers) {
        if (scroller.left < -1 || scroller.right > width + 1) failures.push(`${route} at ${width}x${height}: table scroller extends outside the viewport`);
        if (scroller.scrollWidth > scroller.clientWidth + 1 && !['auto', 'scroll'].includes(scroller.overflowX)) failures.push(`${route} at ${width}x${height}: table overflow is not reachable through a horizontal scroll container`);
      }
      for (const dialog of layout.dialogStates) {
        if (dialog.error) failures.push(`${route} at ${width}x${height}: dialog could not open: ${dialog.error}`);
        if (dialog.left < -1 || dialog.right > width + 1 || dialog.top < -1 || dialog.bottom > height + 1) failures.push(`${route} at ${width}x${height}: dialog extends beyond the viewport`);
        if (dialog.scrollHeight > dialog.clientHeight + 2 && !['auto', 'scroll'].includes(dialog.overflowY)) failures.push(`${route} at ${width}x${height}: dialog clips overflow content`);
        if (!dialog.focusInside) failures.push(`${route} at ${width}x${height}: modal dialog did not receive focus`);
        if (dialog.nestedClips?.length) failures.push(`${route} at ${width}x${height}: dialog clips ${dialog.nestedClips.join(', ')}`);
      }
      if (layout.panels.length && layout.firstPanelBottom > height + 1) failures.push(`${route} at ${width}x${height}: first section ends at ${layout.firstPanelBottom}px (top ${layout.firstPanelTop}px, height ${layout.firstPanelHeight}px, offset ${layout.firstPanelOffset})`);
      for (const panel of layout.panels) {
        if (panel.left < -1 || panel.right > width + 1) failures.push(`${route} at ${width}x${height}: ${panel.className} extends beyond viewport width`);
        if (panel.height > height + 1) failures.push(`${route} at ${width}x${height}: ${panel.className} is ${panel.height}px tall`);
        if (panel.snapAlign !== 'start') failures.push(`${route} at ${width}x${height}: ${panel.className} does not align to the snap start`);
        if (panel.scrollHeight > panel.clientHeight + 1 && !['auto', 'scroll'].includes(panel.overflowY)) {
          failures.push(`${route} at ${width}x${height}: ${panel.className} clips ${panel.scrollHeight - panel.clientHeight}px of content`);
        }
      }
      if (route === '/portal/' && ((width === 1280 && height === 720) || (width === 1440 && height === 900))) {
        const viewportLabel = `${width}x${height}`;
        await page.evaluate(() => {
          const main = document.querySelector('main.app-main:not([hidden])');
          const quickActions = main?.querySelector('.portal-quick-actions');
          if (main) main.style.scrollBehavior = 'auto';
          if (main && quickActions) main.scrollTop += quickActions.getBoundingClientRect().top - main.getBoundingClientRect().top;
        });
        const dashboard = await page.evaluate(() => {
          const main = document.querySelector('main.app-main:not([hidden])');
          const quickActions = main?.querySelector('.portal-quick-actions');
          const adminLink = quickActions?.querySelector('[data-admin-users-link]');
          if (adminLink) {
            adminLink.hidden = false;
            adminLink.removeAttribute('aria-hidden');
          }
          const cards = [...(quickActions?.querySelectorAll('.portal-action-card') || [])]
            .filter((card) => getComputedStyle(card).display !== 'none');
          const actionCardBottoms = cards.map((card) => card.getBoundingClientRect().bottom);
          const quickActionsRect = quickActions?.getBoundingClientRect();
          return {
            snapPanelCount: main?.querySelectorAll('[data-scroll-snap]').length || 0,
            snapType: main ? getComputedStyle(main).scrollSnapType : 'none',
            mainTop: main?.getBoundingClientRect().top || 0,
            mainBottom: main?.getBoundingClientRect().bottom || 0,
            quickActionsTop: quickActionsRect?.top || 0,
            quickActionsBottom: quickActionsRect?.bottom || 0,
            cardTailGap: actionCardBottoms.length ? quickActionsRect.bottom - Math.max(...actionCardBottoms) : Infinity,
            actionCardBottoms
          };
        });
        if (dashboard.snapPanelCount) failures.push(`/portal/ at ${viewportLabel}: dashboard still uses full-screen snap panels`);
        if (dashboard.snapType.includes('y')) failures.push(`/portal/ at ${viewportLabel}: dashboard still snaps between full-screen panels`);
        if (dashboard.quickActionsTop < dashboard.mainTop - 1) failures.push(`/portal/ at ${viewportLabel}: quick actions begin above the visible dashboard viewport`);
        if (dashboard.quickActionsBottom > dashboard.mainBottom + 1) failures.push(`/portal/ at ${viewportLabel}: quick actions extend below the visible dashboard viewport`);
        if (dashboard.actionCardBottoms.some((bottom) => bottom > dashboard.mainBottom + 1)) failures.push(`/portal/ at ${viewportLabel}: quick-action cards end at ${Math.max(...dashboard.actionCardBottoms)}px below main bottom ${dashboard.mainBottom}px`);
        if (dashboard.cardTailGap > 16) failures.push(`/portal/ at ${viewportLabel}: Quick Actions has ${dashboard.cardTailGap}px of empty space below its last card`);
      }
      if (route === '/') {
        await page.mouse.move(Math.floor(width / 2), Math.floor(height / 2));
        await page.mouse.wheel(0, 24);
        await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 24 })));
        const activeSnap = await page.evaluate(() => ({
          ready: document.documentElement.getAttribute('data-public-scroll-snap-ready'),
          type: getComputedStyle(document.documentElement).scrollSnapType,
          firstPanelBottom: document.querySelector('[data-scroll-snap]')?.getBoundingClientRect().bottom,
          viewportHeight: innerHeight
        }));
        if (activeSnap.ready !== 'true' || !activeSnap.type.includes('y')) failures.push(`/${width}x${height}: public scroll does not activate vertical snap`);
        if (activeSnap.firstPanelBottom > activeSnap.viewportHeight + 1) failures.push(`/${width}x${height}: first public section extends below viewport after snap activation`);
      }
      if (route === '/portal/') {
        await page.mouse.move(Math.floor(width / 2), Math.floor(height / 2));
        await page.mouse.wheel(0, 24);
        await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 24 })));
        const activeSnap = await page.evaluate(() => {
          const main = document.querySelector('main.app-main:not([hidden])');
          return { ready: main?.getAttribute('data-portal-scroll-snap-ready'), type: main ? getComputedStyle(main).scrollSnapType : 'none' };
        });
        if (activeSnap.ready === 'true' || activeSnap.type.includes('y')) failures.push(`/portal/ at ${width}x${height}: dashboard unexpectedly activates full-screen snapping`);
      }
    }

    if (authenticatedRoutes.has(route) || parentAuthenticatedRoutes.has(route)) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reduced = await contentTarget.evaluate(() => {
        const root = document.documentElement;
        const main = document.querySelector('main:not([hidden])');
        const reveal = document.querySelector('[data-scroll-reveal]');
        return {
          scrollBehavior: getComputedStyle(main || root).scrollBehavior,
          rootSnapType: getComputedStyle(root).scrollSnapType,
          mainSnapType: main ? getComputedStyle(main).scrollSnapType : 'none',
          revealTransition: reveal ? getComputedStyle(reveal).transitionDuration.split(',')[0].trim() : '0s',
          revealOpacity: reveal ? getComputedStyle(reveal).opacity : '1'
        };
      });
      if (reduced.scrollBehavior !== 'auto') failures.push(`${route}: authenticated workflow does not disable smooth scrolling for reduced motion`);
      if (reduced.rootSnapType.includes('y') || reduced.mainSnapType.includes('y')) failures.push(`${route}: authenticated workflow retains vertical snapping for reduced motion`);
      if (reduced.revealTransition !== '0s' || reduced.revealOpacity !== '1') failures.push(`${route}: authenticated reveal effects remain animated or hidden for reduced motion`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }

    if (route === '/') {
      await page.mouse.move(160, 160);
      await page.mouse.wheel(0, 160);
      await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 160 })));
      const snap = await page.evaluate(() => ({
        ready: document.documentElement.getAttribute('data-public-scroll-snap-ready'),
        type: getComputedStyle(document.documentElement).scrollSnapType,
        firstPanelBottom: document.querySelector('[data-scroll-snap]')?.getBoundingClientRect().bottom,
        viewportHeight: innerHeight
      }));
      if (snap.ready !== 'true' || !snap.type.includes('y')) failures.push('/: public scroll does not enable vertical section snapping after user scroll');
      if (snap.firstPanelBottom > snap.viewportHeight + 1) failures.push('/: the first public section extends beyond the viewport after snap activation');
    }
    if (route === '/portal/') {
      await page.mouse.move(160, 160);
      await page.mouse.wheel(0, 160);
      await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 160 })));
      const snap = await page.evaluate(() => {
        const main = document.querySelector('main.app-main:not([hidden])');
        return { ready: main?.getAttribute('data-portal-scroll-snap-ready'), type: main ? getComputedStyle(main).scrollSnapType : 'none' };
      });
      if (snap.ready === 'true' || snap.type.includes('y')) failures.push('/portal/: dashboard unexpectedly enables vertical section snapping after user scroll');
    }
  }

  if (!selectedRoute) {
    const requiredCoverage = [
      ['authenticated forms', dynamicCoverage.forms],
      ['synthetic validation messages', dynamicCoverage.validationMessages],
      ['synthetic table rows', dynamicCoverage.tableRows],
      ['calendar grids', dynamicCoverage.calendarGrids],
      ['calendar events', dynamicCoverage.calendarEvents],
      ['job-card archive records', dynamicCoverage.jobCardArchiveRows],
      ['estimate archive records', dynamicCoverage.estimateArchiveRows],
      ['parent-authenticated history records', dynamicCoverage.historyFrameRows],
      ['invoice table rows', dynamicCoverage.invoiceRows],
      ['modal dialogs', dynamicCoverage.dialogs],
      ['dialog content fixtures', dynamicCoverage.dialogFixtures]
    ];
    requiredCoverage.forEach(([label, count]) => {
      if (!count) failures.push(`authenticated route inventory did not exercise ${label}`);
    });
  }

  if (injectApiMutationAttempts) {
    await page.waitForFunction(() => sessionStorage.getItem('gmt-viewport-api-mutation-probe') === 'blocked', { timeout: 5000 });
  }
  if (apiMutationAttempts.length) failures.push(`synthetic viewport run attempted API writes: ${apiMutationAttempts.slice(0, 5).join(', ')}`);

  assert.deepEqual(failures, [], failures.slice(0, 30).join('\n'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const reducedMotion = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    snapType: getComputedStyle(document.documentElement).scrollSnapType
  }));
  assert.equal(reducedMotion.scrollBehavior, 'auto', 'public site respects reduced motion');
  assert.ok(!reducedMotion.snapType.includes('y'), 'public site disables snapping for reduced motion');
  await page.goto(`http://127.0.0.1:${server.address().port}/portal/`);
  await page.waitForFunction(() => document.documentElement.dataset.gmtAuthenticated === 'true', { timeout: 10000 });
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 160 })));
  const portalReducedMotion = await page.evaluate(() => {
    const main = document.querySelector('main.app-main:not([hidden])');
    return { scrollBehavior: main ? getComputedStyle(main).scrollBehavior : '', snapType: main ? getComputedStyle(main).scrollSnapType : 'none' };
  });
  assert.equal(portalReducedMotion.scrollBehavior, 'auto', 'staff portal respects reduced motion');
  assert.ok(!portalReducedMotion.snapType.includes('y'), 'staff portal disables snapping for reduced motion');
  console.log(`${routesToTest.length} of ${routes.length} public and staff-portal pages × ${viewports.length} viewports: viewport fit, authenticated synthetic state, controls/forms/tables/dialogs/calendars/archive/invoices, motion preferences and API write isolation: PASS`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}

if (!injectApiMutationAttempts) {
  const probe = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      GMT_VIEWPORT_ROUTE: '/portal/',
      GMT_VIEWPORT_INJECT_API_MUTATIONS: '1',
      GMT_VIEWPORT_VERBOSE: ''
    }
  });
  assert.equal(probe.error, undefined, `API mutation guard regression process did not complete: ${probe.error?.message || ''}`);
  const probeOutput = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  assert.notEqual(probe.status, 0, 'focused viewport run must fail when API writes are attempted during initialization');
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    assert.ok(probeOutput.includes(`${method} /api/__viewport-mutation-guard__`), `${method} initialization attempt was not caught by the write-isolation assertion`);
  }
  console.log('API write-isolation regression: injected POST/PATCH/DELETE initialization attempts are blocked and fail the focused run: PASS');
}
