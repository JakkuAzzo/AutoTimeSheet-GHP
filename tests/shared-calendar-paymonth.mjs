import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<p id="portal-calendar-status"></p><button type="button" data-portal-calendar-retry hidden>Retry load</button>
    <div class="portal-calendar-toolbar"><button data-portal-calendar-prev></button><button data-portal-calendar-picker><span data-portal-calendar-title></span></button><input data-portal-calendar-input type="month"><button data-portal-calendar-next></button></div>
    <fieldset data-calendar-filters><label><input type="checkbox" data-calendar-filter="timesheets" checked></label><label><input type="checkbox" data-calendar-filter="tasks" checked></label></fieldset>
    <div data-portal-calendar></div>`);
  await page.evaluate(() => {
    window.__historyCalls = 0;
    window.__localEventCalls = 0;
    window.__calendarNextResponse = 'deferred';
    window.fetch = async () => {
      if (window.__calendarNextResponse === 'deferred') return new Promise((resolve) => { window.__resolveCalendarFeed = resolve; });
      if (window.__calendarNextResponse instanceof Error) throw window.__calendarNextResponse;
      return window.__calendarNextResponse;
    };
    window.GMTPortalApi = { enabled: () => true, history: async () => { window.__historyCalls += 1; return { records: [{ kind: 'tasks', source_record_id: 'private-task', status: 'Approved', record_date: '2026-08-27', task_title: 'Private task' }] }; } };
  });
  await page.addScriptTag({ path: resolve(root, 'pay-periods.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/calendar-data.js') });
  await page.evaluate(() => {
    window.GMTCalendarData.localEvents = () => { window.__localEventCalls += 1; return [{ id: 'local-private', date: '2026-08-27', type: 'calendar', title: 'Private local request' }]; };
  });
  await page.evaluate(() => { window.__calendarResponse = { ok: true, json: async () => ({ events: [
      { id: 'w1', date: '2026-08-24', type: 'timesheet', title: 'Ainsley', detail: '08:00–17:00', canEdit: true, recordId: 'a1' },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `day-${index}`, date: '2026-08-27', type: 'timesheet', title: `Employee ${index + 1}`, detail: '08:00–17:00', canEdit: index === 0, recordId: `record-${index}` })),
      { id: 'task-1', date: '2026-08-27', type: 'task', title: 'Inspect pump', detail: 'Due today', recordId: 'task-record' }
    ] }) }; });
  await page.addScriptTag({ path: resolve(root, 'portal/calendar-actions.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/calendar-preview.js') });
  assert.match(await page.locator('#portal-calendar-status').textContent(), /Loading published shared calendar/i);
  await page.evaluate(() => { window.__resolveCalendarFeed(window.__calendarResponse); });
  await page.waitForFunction(() => document.querySelector('#portal-calendar-status').textContent.includes('Published shared calendar'));
  assert.equal(await page.evaluate(() => window.__historyCalls), 0, 'the shared preview must not merge protected request history');
  assert.equal(await page.evaluate(() => window.__localEventCalls), 0, 'the shared preview must not read browser-local requests');
  assert.equal(await page.locator('.calendar-event').filter({ hasText: 'Private' }).count(), 0, 'private local and history entries must not appear in shared calendar');
  assert.equal(await page.locator('[data-portal-calendar-retry]').isVisible(), true);
  await page.locator('[data-portal-calendar-input]').fill('2026-08');
  await page.locator('[data-portal-calendar-input]').dispatchEvent('change');
  const weekStart = page.locator('.portal-calendar-day.is-pay-week-start').filter({ has: page.locator('[data-calendar-day="2026-08-24"]') });
  assert.equal(await weekStart.count(), 1);
  assert.equal(await weekStart.locator('.calendar-week-badge').textContent(), '(W1)');

  const dayCell = page.locator('.portal-calendar-day').filter({ has: page.locator('[data-calendar-day="2026-08-27"]') });
  assert.equal(await dayCell.locator('.calendar-event').count(), 7, 'all entries stay in the day cell, including the collapsed overflow');
  assert.equal(await dayCell.locator('.calendar-more').textContent(), '+3 more');
  await dayCell.locator('[data-calendar-day]').click();
  assert.equal(await page.locator('.calendar-day-entry-choice').count(), 7, 'clicking the day previews every timesheet and task for the date');
  await page.locator('.calendar-day-entry-choice').first().click();
  assert.equal(await page.locator('[data-calendar-action-edit-entry]').isVisible(), true, 'selecting an editable entry exposes its permitted edit action');

  await page.locator('dialog.calendar-day-actions-dialog [data-calendar-actions-close]').click();
  await dayCell.locator('.calendar-more').click();
  assert.equal(await page.locator('.calendar-day-entry-choice').count(), 7, '+N opens the same complete day list');
  await page.locator('dialog.calendar-day-actions-dialog [data-calendar-actions-close]').click();
  await page.locator('[data-calendar-filter="timesheets"]').uncheck();
  assert.equal(await page.locator('.portal-calendar-day').filter({ has: page.locator('[data-calendar-day="2026-08-27"]') }).locator('.calendar-event').count(), 1, 'calendar type filters update the visible day entries');
  await page.evaluate(() => { window.__calendarNextResponse = { ok: false, status: 503 }; });
  await page.locator('[data-portal-calendar-retry]').click();
  await page.waitForFunction(() => document.querySelector('#portal-calendar-status').textContent.includes('unavailable'));
  assert.equal(await page.locator('.calendar-event').count(), 0, 'a failed reload clears stale published events');
  assert.equal(await page.locator('[data-portal-calendar-retry]').isVisible(), true, 'an unavailable feed exposes retry');
  assert.equal(await page.locator('[data-portal-calendar-retry]').textContent(), 'Retry calendar load');
  await page.evaluate(() => { window.__calendarNextResponse = { ok: true, json: async () => ({ events: [] }) }; });
  await page.locator('[data-portal-calendar-retry]').click();
  await page.waitForFunction(() => document.querySelector('#portal-calendar-status').textContent.includes('No published events'));
  assert.equal(await page.locator('[data-portal-calendar-retry]').isVisible(), true);
  console.log('PASS: pay-month week-one marker, calendar type filters, and complete day previews work on a mobile viewport.');
} finally {
  await browser.close();
}
