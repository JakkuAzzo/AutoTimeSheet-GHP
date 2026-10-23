import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, firefox, webkit } = require('playwright');
const browserTypes = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const server = createServer((req, res) => {
  const rawPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const relativePath = rawPath === '/' ? '/portal/offsite-clock.html' : rawPath;
  const filePath = resolve(join(repoRoot, relativePath.replace(/^\/+/, '')));
  if (filePath !== repoRoot && !filePath.startsWith(`${repoRoot}${sep}`)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (rawPath === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(filePath, 'utf8').replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false'));
    return;
  }
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const apiShim = `
window.__offsiteState = window.__offsiteState || { role: 'engineer', entries: [], pending: [] };
window.GMTPortalApi = {
  enabled: () => true,
  access: async () => ({ canReviewOffsite: window.__offsiteState.role === 'manager' }),
  offsiteClockMine: async () => ({ entries: window.__offsiteState.entries }),
  offsiteClockPending: async () => ({ entries: window.__offsiteState.pending.filter((entry) => entry.status === 'awaiting_approval') }),
  offsiteClockIn: async (body) => {
    const entry = { entryId: 'TEST-offsite-entry-001', ownerName: 'TEST Engineer', site: body.site, status: 'clocked_in', clockInAt: '2026-10-23T08:00:00.000Z' };
    window.__offsiteState.entries.unshift(entry);
    return { entry };
  },
  offsiteClockOut: async (body) => {
    const entry = window.__offsiteState.entries.find((item) => item.entryId === body.entryId);
    entry.status = 'awaiting_approval'; entry.clockOutAt = '2026-10-23T16:00:00.000Z';
    window.__offsiteState.pending.unshift(entry);
    return { entry };
  },
  offsiteClockDecision: async (entryId, body) => {
    const entry = window.__offsiteState.pending.find((item) => item.entryId === entryId);
    entry.status = body.decision === 'approve' ? 'approved' : 'rejected';
    entry.decisionNote = body.note || '';
    return { entry };
  }
};`;

try {
  for (const [browserName, browserType] of browserTypes) {
    const browser = await browserType.launch({ headless: true });
    try {
      const pageOptions = { viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London' };
      if (browserName !== 'firefox') pageOptions.isMobile = true;
      const engineerPage = await browser.newPage(pageOptions);
      await engineerPage.addInitScript(() => { window.__offsiteState = { role: 'engineer', entries: [], pending: [] }; });
      await engineerPage.route('**/portal-api.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: apiShim }));
      const engineerResponse = await engineerPage.goto(`http://127.0.0.1:${port}/portal/offsite-clock.html`, { waitUntil: 'load' });
      assert.equal(engineerResponse?.status(), 200, `${browserName} should load the authenticated off-site clock page`);
      const viewport = await engineerPage.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        mobileBreakpoint: window.matchMedia('(max-width: 600px)').matches,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      }));
      assert.deepEqual(viewport, { width: 390, height: 844, mobileBreakpoint: true, timeZone: 'Europe/London', horizontalOverflow: false }, `${browserName} engineer page remains usable at mobile width`);
      assert.equal(await engineerPage.locator('[data-offsite-clock-form]').count(), 1, `${browserName} renders the engineer clock form`);
      assert.equal(await engineerPage.locator('[data-offsite-manager-queue]').isVisible(), false, `${browserName} hides manager approval controls from engineers`);
      await engineerPage.locator('[name="offsite_site"]').fill('TEST client site');
      await engineerPage.locator('[data-offsite-clock-in]').click();
      await assert.doesNotReject(() => engineerPage.waitForFunction(() => /Clocked in/.test(document.querySelector('[data-offsite-status]')?.textContent || '')));
      await engineerPage.locator('[data-offsite-clock-out]').click();
      await engineerPage.waitForFunction(() => /Awaiting manager sign-off/.test(document.querySelector('[data-offsite-status]')?.textContent || ''));

      const managerPage = await browser.newPage(pageOptions);
      await managerPage.addInitScript(() => {
        window.__offsiteState = {
          role: 'manager', entries: [],
          pending: [
            { entryId: 'TEST-pending-entry-001', ownerName: 'TEST Engineer', site: 'TEST depot', status: 'awaiting_approval', canDecide: true, clockInAt: '2026-10-23T08:00:00.000Z', clockOutAt: '2026-10-23T16:00:00.000Z' },
            { entryId: 'TEST-self-entry-001', ownerName: 'TEST Duty Manager', site: 'TEST own site', status: 'awaiting_approval', canDecide: false, clockInAt: '2026-10-23T08:00:00.000Z', clockOutAt: '2026-10-23T16:00:00.000Z' }
          ]
        };
      });
      await managerPage.route('**/portal-api.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: apiShim }));
      await managerPage.goto(`http://127.0.0.1:${port}/portal/offsite-clock.html`, { waitUntil: 'load' });
      assert.equal(await managerPage.locator('[data-offsite-manager-queue]').isVisible(), true, `${browserName} shows the approval queue to assigned managers`);
      assert.equal(await managerPage.locator('[data-offsite-pending-entry]').count(), 2);
      assert.equal(await managerPage.locator('[data-offsite-pending-entry="TEST-self-entry-001"] button').count(), 0, `${browserName} cannot act on a manager's own entry`);
      await managerPage.locator('[data-offsite-reject]').click();
      await managerPage.waitForFunction(() => /Add a reason before rejecting/.test(document.querySelector('[data-offsite-manager-status]')?.textContent || ''));
      assert.equal(await managerPage.locator('[data-offsite-pending-entry]').count(), 2, `${browserName} requires a rejection note before changing the entry`);
      await managerPage.locator('[data-offsite-approve]').click();
      await managerPage.waitForFunction(() => /Approved/.test(document.querySelector('[data-offsite-manager-status]')?.textContent || ''));
      assert.equal(await managerPage.locator('[data-offsite-pending-entry]').count(), 1, `${browserName} removes the approved entry from the queue`);
      assert.equal(await managerPage.evaluate(() => window.__offsiteState.pending[0].status), 'approved');
      console.log(JSON.stringify({ browser: browserName, viewport, engineerClockFlow: 'clocked_in -> awaiting_approval', managerDecision: 'approved' }));
      await managerPage.close();
      await engineerPage.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
