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
  await page.setContent(html);
  await page.locator('main').evaluate((main) => { main.hidden = false; });
  await page.evaluate(() => {
    window.GMTPortalApi = {
      enabled: () => true,
      saveRecord: async (record) => { window.__savedCorrection = record; return { ok: true }; },
      updateRecord: async () => { throw new Error('Original source records must not be overwritten'); },
      history: async () => ({
        meta: { is_admin: true, editable_pay_months: ['2026-09', '2026-10'], completion: { employees: [
          { employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk' },
          { employee_name: 'Ainsley', employee_upn: 'ainsley@gmt-services.co.uk' },
          { employee_name: 'Faith', employee_upn: 'faith.b@gmt-services.co.uk' }
        ] } },
        records: [
          { kind: 'timesheets', source_record_id: 'matthew-local', source: 'portal-d1', employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk', can_edit: true, start_date: '2026-09-07', updated_at: '2026-09-21T12:00:00Z', payload: { rows: [{ date: '2026-09-03', start: '08:00', finish: '18:00', lunchMinutes: 30 }] } },
          { kind: 'timesheets', source_record_id: 'matthew-upstream', source: 'microsoft-365', employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk', can_edit: false, start_date: '2026-09-07', updated_at: '2026-09-20T12:00:00Z', payload: { rows: [{ date: '2026-08-31', start: '08:00', finish: '17:00', lunchMinutes: 60 }, { date: '2026-09-01', start: '08:00', finish: '17:45', lunchMinutes: 0 }] } },
          { kind: 'timesheets', source_record_id: 'ainsley-local', source: 'portal-d1', employee_name: 'Ainsley', employee_upn: 'ainsley@gmt-services.co.uk', can_edit: true, start_date: '2026-08-24', updated_at: '2026-09-21T11:00:00Z', payload: { rows: [{ date: '2026-08-24', start: '08:00', finish: '17:00', lunchMinutes: 60 }] } },
          { kind: 'timesheets', source_record_id: 'lidia-upstream', source: 'microsoft-365', employee_name: 'Lidia Alemayoh', employee_upn: '', can_edit: false, updated_at: '2026-09-21T13:00:00Z', payload: { rows: [{ date: '2026-09-14', start: '08:00', finish: '18:00', lunchMinutes: 0 }] } },
          { kind: 'timesheets', source_record_id: 'lidia-local', source: 'portal-d1', employee_name: 'Lidia Alemayoh', employee_upn: 'lidia.admin@gmt-services.co.uk', can_edit: true, updated_at: '2026-09-21T12:00:00Z', payload: { rows: [{ date: '2026-09-15', start: '08:00', finish: '17:45', lunchMinutes: 30 }] } },
          { kind: 'timesheets', source_record_id: 'empty-demo-1', source: 'microsoft-365', employee_name: 'Canonical employee month workbook replay 2026-09-17-02', can_edit: false, updated_at: '2026-09-17T01:28:17Z', payload: {} },
          { kind: 'timesheets', source_record_id: 'empty-demo-2', source: 'microsoft-365', employee_name: 'ARCHIVE REAL', can_edit: false, updated_at: '2026-09-16T23:37:51Z', payload: {} }
        ]
      })
    };
  });
  await page.addScriptTag({ path: resolve(root, 'pay-periods.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/pay-month-workbook.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/submissions.js') });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(() => document.querySelectorAll('[data-sheet-index]').length >= 3);
  assert.equal(await page.locator('[data-sheet-index]').filter({ hasText: 'Lidia Alemayoh' }).count(), 1, 'the name-only source and unique signed-in mailbox share one pay-month sheet');
  assert.equal(await page.locator('[data-sheet-index]').filter({ hasText: 'Canonical employee month workbook replay' }).count(), 0);
  assert.equal(await page.locator('[data-sheet-index]').filter({ hasText: 'ARCHIVE REAL' }).count(), 0);
  assert.equal(await page.locator('[data-sheet-index]').filter({ hasText: 'Faith' }).count(), 1, 'Accounts can start an empty roster employee sheet');
  await page.locator('[data-sheet-index]').filter({ hasText: 'Matthew' }).click();
  const rows = page.locator('[data-pay-month-edit-form] [data-sheet-row]');
  assert.equal(await rows.count(), 3, 'the actual Date column places all Matthew days in the same pay month');
  for (let i = 0; i < 3; i++) assert.equal(await rows.nth(i).locator('[data-sheet-field="start"]').isEnabled(), true, `row ${i} is editable`);
  assert.equal(await page.getByRole('button', { name: /Add day/i }).count(), 1);
  assert.equal(await rows.first().getByRole('button', { name: /Remove day/i }).count(), 1);
  await rows.first().locator('[data-sheet-field="start"]').fill('07:30');
  await rows.nth(1).getByRole('button', { name: /Remove day/i }).click();
  await page.getByRole('button', { name: /Add day/i }).click();
  const added = page.locator('[data-new-row="true"]');
  assert.equal(await added.count(), 1);
  await added.locator('[data-sheet-field="date"]').fill('2026-09-02');
  await added.locator('[data-sheet-field="start"]').fill('08:00');
  await added.locator('[data-sheet-field="finish"]').fill('17:00');
  await added.locator('[data-sheet-field="break"]').selectOption('30');
  await page.getByRole('button', { name: /Save changes/i }).click();
  await page.waitForFunction(() => Boolean(window.__savedCorrection));
  const correction = await page.evaluate(() => window.__savedCorrection);
  assert.equal(correction.employeeEmail, 'matthew@gmt-services.co.uk');
  assert.equal(correction.action, 'pay_month_correction');
  assert.equal(correction.payload.payMonth, '2026-09');
  assert.deepEqual(correction.payload.deletedDays, ['2026-09-01']);
  assert.deepEqual(correction.payload.rows.map((row) => row.date).sort(), ['2026-08-31', '2026-09-02']);
  await page.addScriptTag({ path: resolve(root, 'portal/calendar-data.js') });
  await page.evaluate(async () => {
    const prior = await window.GMTPortalApi.history();
    const saved = window.__savedCorrection;
    const projection = { kind: 'timesheets', action: saved.action, source_record_id: saved.recordId, source: 'portal-d1', employee_name: saved.employeeName, employee_upn: saved.employeeEmail, updated_at: saved.updatedAt, can_edit: true, payload: saved.payload };
    window.GMTPortalApi.history = async () => ({ meta: prior.meta, records: [...prior.records, projection] });
    window.__calendarDates = window.GMTCalendarData.recordsToEvents([...prior.records, projection], { employees: prior.meta.completion.employees })
      .filter((event) => event.title === 'Matthew').map((event) => event.date).sort();
  });
  assert.deepEqual(await page.evaluate(() => window.__calendarDates), ['2026-08-31', '2026-09-02', '2026-09-03']);
  await page.locator('#submissions-refresh').click();
  await page.locator('[data-sheet-index]').filter({ hasText: 'Matthew' }).click();
  assert.equal(await page.locator('[data-pay-month-edit-form] [data-sheet-row]').count(), 3);
} finally {
  await browser.close();
}
