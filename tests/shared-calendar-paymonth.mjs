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
  await page.setContent(`<p id="portal-calendar-status"></p>
    <div class="portal-calendar-toolbar"><button data-portal-calendar-prev></button><button data-portal-calendar-picker><span data-portal-calendar-title></span></button><input data-portal-calendar-input type="month"><button data-portal-calendar-next></button></div>
    <fieldset data-calendar-filters><label><input type="checkbox" data-calendar-filter="timesheets" checked></label><label><input type="checkbox" data-calendar-filter="tasks" checked></label></fieldset>
    <div data-portal-calendar></div>`);
  await page.evaluate(() => {
    window.GMTPortalApi = { enabled: () => false };
    window.fetch = async () => ({ ok: true, json: async () => ({ events: [
      { id: 'w1', date: '2026-08-24', type: 'timesheet', title: 'Ainsley', detail: '08:00–17:00', canEdit: true, recordId: 'a1' },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `day-${index}`, date: '2026-08-27', type: 'timesheet', title: `Employee ${index + 1}`, detail: '08:00–17:00', canEdit: index === 0, recordId: `record-${index}` })),
      { id: 'task-1', date: '2026-08-27', type: 'task', title: 'Inspect pump', detail: 'Due today', recordId: 'task-record' }
    ] }) });
  });
  for (const script of ['pay-periods.js', 'portal/calendar-data.js', 'portal/calendar-actions.js', 'portal/calendar-preview.js']) {
    await page.addScriptTag({ path: resolve(root, script) });
  }
  await page.waitForFunction(() => document.querySelectorAll('.portal-calendar-day').length > 0 && document.querySelector('#portal-calendar-status').textContent.includes('Shared calendar'));
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
  console.log('PASS: pay-month week-one marker, calendar type filters, and complete day previews work on a mobile viewport.');
} finally {
  await browser.close();
}
