import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

try {
  const page = await browser.newPage();
  const html = readFileSync(resolve(root, 'portal/submissions.html'), 'utf8').replace(/<script\b[^>]*><\/script>/g, '');
  await page.route('https://gmt.test/**', (route) => route.fulfill({
    status: 200,
    contentType: route.request().url().includes('/portal/submissions?') ? 'text/html' : 'text/css',
    body: route.request().url().includes('/portal/submissions?') ? html : ''
  }));
  await page.goto('https://gmt.test/portal/submissions?record=ainsley-local');
  await page.locator('main').evaluate((main) => { main.hidden = false; });
  await page.evaluate(() => {
    window.GMTPortalApi = {
      enabled: () => true,
      saveRecord: async (record) => { window.__savedCorrection = record; return { ok: true }; },
      history: async () => ({
        meta: {
          is_admin: true,
          editable_pay_months: ['2026-09'],
          completion: { employees: [{ employee_name: 'Ainsley', employee_upn: 'ainsley@gmt-services.co.uk', schedule_weekdays: [1, 2, 3, 4, 5] }] }
        },
        records: [{
          kind: 'timesheets', source_record_id: 'ainsley-local', source: 'portal-d1',
          employee_name: 'Ainsley', employee_upn: 'ainsley@gmt-services.co.uk', can_edit: true,
          schedule_weekdays: [1, 2, 3, 4, 5], start_date: '2026-08-24', updated_at: '2026-09-21T11:00:00Z',
          payload: { rows: [
            { date: '2026-08-24', start: '08:00', finish: '17:00', lunchMinutes: 60 },
            { date: '2026-08-29', start: '08:00', finish: '12:00', lunchMinutes: 0 },
            { date: '2026-08-30', start: '08:00', finish: '12:00', lunchMinutes: 0 }
          ] }
        }]
      })
    };
  });
  await page.addScriptTag({ path: resolve(root, 'pay-periods.js') });
  await page.addScriptTag({ path: resolve(root, 'timesheet-coverage.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/pay-month-workbook.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/submissions.js') });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.locator('[data-sheet-index]').filter({ hasText: 'Ainsley' }).click();

  const rows = page.locator('[data-pay-month-edit-form] [data-sheet-row]');
  const dates = await rows.locator('[data-sheet-field="date"]').evaluateAll((fields) => fields.map((field) => field.value));
  assert.deepEqual(dates, ['2026-08-24', '2026-08-29', '2026-08-30'], 'the pay-month editor must retain Ainsley weekend rows so Accounts can remove them');
  assert.equal(await page.locator('[data-off-schedule-note]').count(), 1, 'off-schedule source rows are labelled for review');
  assert.equal(await page.locator('[data-pay-month-total-hours]').textContent(), '8h', 'off-schedule weekend hours stay outside the payable month total');

  for (const date of ['2026-08-29', '2026-08-30']) {
    const row = rows.filter({ has: page.locator('[data-sheet-field="date"][value="' + date + '"]') });
    assert.equal(await row.count(), 1, date + ' is present for Ainsley');
    await row.getByRole('button', { name: 'Remove day' }).click();
    assert.equal(await row.getByRole('button', { name: 'Undo remove' }).count(), 1, date + ' is marked for removal');
  }

  await page.getByRole('button', { name: /Save changes/i }).click();
  await page.waitForFunction(() => Boolean(window.__savedCorrection));
  const correction = await page.evaluate(() => window.__savedCorrection);
  assert.equal(correction.employeeEmail, 'ainsley@gmt-services.co.uk');
  assert.deepEqual(correction.payload.deletedDays, ['2026-08-29', '2026-08-30'], 'both Ainsley weekend rows are saved as deleted days');
} finally {
  await browser.close();
}

console.log('Ainsley Saturday and Sunday can be removed from the pay-month editor.');
