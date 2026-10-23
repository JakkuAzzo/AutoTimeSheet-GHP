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
    const requestProfile = JSON.parse(localStorage.getItem('gmt.portal.profile.v1') || '{}');
    window.__offsiteState.requests = window.__offsiteState.requests || [];
    window.__offsiteState.requests.push({ requestId: body.requestId, subject: requestProfile.subject || '' });
    if (window.__offsiteState.loseResponseOnce) {
      window.__offsiteState.loseResponseOnce = false;
      window.__offsiteState.lostRequestId = body.requestId;
      window.__offsiteState.lostOwner = requestProfile.subject || '';
      throw new Error('TEST response lost after server acceptance');
    }
    if (body.requestId === window.__offsiteState.lostRequestId && requestProfile.subject !== window.__offsiteState.lostOwner) {
      throw new Error('Duplicate request ID belongs to another signed-in account');
    }
    const entry = { entryId: 'TEST-offsite-entry-001', ownerName: 'TEST Engineer', site: body.site, status: 'clocked_in', clockInAt: '2026-10-23T08:00:00.000Z', workDate: '2026-10-23' };
    window.__offsiteState.entries.unshift(entry);
    return { entry };
  },
  offsiteClockLunchStart: async (body) => {
    const entry = window.__offsiteState.entries.find((item) => item.entryId === body.entryId);
    entry.lunchStartAt = '2026-10-23T12:00:00.000Z';
    return { entry };
  },
  offsiteClockLunchEnd: async (body) => {
    const entry = window.__offsiteState.entries.find((item) => item.entryId === body.entryId);
    entry.lunchEndAt = '2026-10-23T12:30:00.000Z';
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
    if (body.decision === 'approve') window.__offsiteState.historyClockRecordCount = 1;
    return { entry };
  },
  offsiteBookingsMine: async () => ({ bookings: window.__offsiteState.bookings || [] }),
  offsiteBookingsPending: async () => ({ bookings: (window.__offsiteState.bookings || []).filter((booking) => booking.status === 'awaiting_approval') }),
  createOffsiteBooking: async (body) => {
    window.__offsiteState.bookings = window.__offsiteState.bookings || [];
    const booking = { bookingId: 'TEST-offsite-booking-001', ownerName: 'TEST Engineer', ownerUpn: 'engineer@example.test', workDate: body.workDate, start: body.start, end: body.end, site: body.site, note: body.note, status: 'awaiting_approval', version: 1, history: [{ eventType: 'book', version: 1, next: { workDate: body.workDate, start: body.start, end: body.end, site: body.site }, occurredAt: '2026-10-23T08:00:00.000Z' }] };
    window.__offsiteState.bookings.unshift(booking);
    return { booking };
  },
  amendOffsiteBooking: async (bookingId, body) => {
    const booking = window.__offsiteState.bookings.find((item) => item.bookingId === bookingId);
    const previous = { workDate: booking.workDate, start: booking.start, end: booking.end, site: booking.site, status: booking.status };
    booking.history.push({ eventType: 'amend', version: booking.version + 1, previous, next: { workDate: body.workDate, start: body.start, end: body.end, site: body.site }, occurredAt: '2026-10-23T08:30:00.000Z' });
    Object.assign(booking, { workDate: body.workDate, start: body.start, end: body.end, site: body.site, note: body.note, status: 'awaiting_approval', version: booking.version + 1 });
    return { booking };
  },
  offsiteBookingDecision: async (bookingId, body) => {
    const booking = window.__offsiteState.bookings.find((item) => item.bookingId === bookingId);
    booking.status = body.decision === 'approve' ? 'approved' : 'rejected';
    booking.decisionNote = body.note || '';
    return { booking };
  }
};`;

try {
  for (const [browserName, browserType] of browserTypes) {
    const browser = await browserType.launch({ headless: true });
    try {
      const pageOptions = { viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London' };
      if (browserName !== 'firefox') pageOptions.isMobile = true;
      const engineerPage = await browser.newPage(pageOptions);
      await engineerPage.addInitScript(() => { window.__offsiteState = { role: 'engineer', entries: [], pending: [], bookings: [] }; });
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
      assert.equal(await engineerPage.locator('[name="offsite_site"]').getAttribute('placeholder'), 'e.g. Acme Engineering, Croydon Road');
      assert.equal(await engineerPage.locator('[data-offsite-heading] .eyebrow').count(), 0);
      const eyebrowColor = await engineerPage.locator('.offsite-heading .eyebrow').evaluate((node) => getComputedStyle(node).color);
      assert.equal(eyebrowColor, 'rgb(18, 61, 29)', `${browserName} uses a readable dark green separation label`);
      await engineerPage.locator('[name="offsite_site"]').fill('TEST client site');
      await engineerPage.locator('[data-offsite-clock-in]').click();
      await assert.doesNotReject(() => engineerPage.waitForFunction(() => /Shift started/.test(document.querySelector('[data-offsite-status]')?.textContent || '')));
      assert.equal(await engineerPage.locator('[data-offsite-lunch-start]').isVisible(), true);
      await engineerPage.locator('[data-offsite-lunch-start]').click();
      await engineerPage.locator('[data-offsite-lunch-end]').click();
      await engineerPage.locator('[data-offsite-clock-out]').click();
      await engineerPage.waitForFunction(() => /awaiting manager sign-off/i.test(document.querySelector('[data-offsite-status]')?.textContent || ''));
      assert.match(await engineerPage.locator('[data-offsite-entries]').textContent(), /Lunch/);

      const bookingDate = await engineerPage.evaluate(() => {
        const date = new Date(); date.setDate(date.getDate() + 3);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      });
      await engineerPage.locator('[name="work_date"]').fill(bookingDate);
      await engineerPage.locator('[data-offsite-booking-form] [name="start"]').fill('09:00');
      await engineerPage.locator('[data-offsite-booking-form] [name="end"]').fill('17:00');
      await engineerPage.locator('[data-offsite-booking-form] [name="site"]').fill('TEST planned site');
      await engineerPage.locator('[data-offsite-booking-submit]').click();
      await engineerPage.waitForFunction(() => /Booking request sent/.test(document.querySelector('[data-offsite-booking-status]')?.textContent || ''));
      assert.match(await engineerPage.locator('[data-offsite-bookings]').textContent(), /Awaiting manager sign-off/);
      await engineerPage.locator('[data-booking-edit]').click();
      await engineerPage.locator('[data-booking-edit-form] [name="start"]').fill('10:00');
      await engineerPage.locator('[data-booking-edit-form] [name="site"]').fill('TEST amended site');
      await engineerPage.locator('[data-booking-edit-form] button[type="submit"]').click();
      await engineerPage.waitForFunction(() => /Amendment saved/.test(document.querySelector('[data-offsite-booking-status]')?.textContent || ''));
      assert.match(await engineerPage.locator('[data-offsite-bookings]').textContent(), /TEST amended site/);
      assert.match(await engineerPage.locator('[data-offsite-bookings]').textContent(), /TEST planned site/, 'the prior location remains visible in the booking change history');

      const managerPage = await browser.newPage(pageOptions);
      await managerPage.addInitScript(() => {
        window.__offsiteState = {
          role: 'manager', entries: [],
          bookings: [
            { bookingId: 'TEST-manager-booking-001', ownerName: 'TEST Engineer', ownerUpn: 'engineer@example.test', workDate: '2026-10-26', start: '08:00', end: '17:00', site: 'TEST planned depot', status: 'awaiting_approval', version: 1, canDecide: true }
          ],
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
      await managerPage.waitForTimeout(100);
      const approvalStatus = await managerPage.locator('[data-offsite-manager-status]').textContent();
      assert.match(approvalStatus || '', /approved/i, `${browserName} reports the manager result: ${approvalStatus}`);
      assert.equal(await managerPage.locator('[data-offsite-pending-entry]').count(), 1, `${browserName} removes the approved entry from the queue`);
      assert.equal(await managerPage.evaluate(() => window.__offsiteState.pending[0].status), 'approved');
      await managerPage.locator('[data-booking-approve]').click();
      await managerPage.waitForFunction(() => /Booking approved/.test(document.querySelector('[data-offsite-booking-manager-status]')?.textContent || ''));
      assert.equal(await managerPage.evaluate(() => window.__offsiteState.bookings[0].status), 'approved');
      assert.equal(await managerPage.evaluate(() => window.__offsiteState.historyClockRecordCount), 1, 'only approval of a completed shift creates a timesheet record');

      const retryPage = await browser.newPage(pageOptions);
      await retryPage.addInitScript(() => {
        window.__offsiteState = { role: 'engineer', entries: [], pending: [], bookings: [], loseResponseOnce: true };
        localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ subject: 'TEST-account-A', username: 'engineer-a@example.test' }));
      });
      await retryPage.route('**/portal-api.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: apiShim }));
      await retryPage.goto(`http://127.0.0.1:${port}/portal/offsite-clock.html`, { waitUntil: 'load' });
      await retryPage.locator('[name="offsite_site"]').fill('TEST account A site');
      await retryPage.locator('[data-offsite-clock-in]').click();
      await retryPage.waitForFunction(() => /response lost after server acceptance/.test(document.querySelector('[data-offsite-status]')?.textContent || ''));
      await retryPage.evaluate(() => localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ subject: 'TEST-account-B', username: 'engineer-b@example.test' })));
      await retryPage.locator('[data-offsite-clock-in]').click();
      await retryPage.waitForFunction(() => /Shift started|Duplicate request ID belongs/.test(document.querySelector('[data-offsite-status]')?.textContent || ''));
      const retryRequests = await retryPage.evaluate(() => window.__offsiteState.requests);
      assert.equal(retryRequests.length, 2, `${browserName} retries the uncertain request after an account switch`);
      assert.notEqual(retryRequests[0].requestId, retryRequests[1].requestId, `${browserName} scopes idempotency keys to the signed-in account`);
      assert.match(await retryPage.locator('[data-offsite-status]').textContent(), /Shift started/, `${browserName} completes after the account-scoped retry`);
      await retryPage.close();
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
