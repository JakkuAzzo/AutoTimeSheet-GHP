import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const page = await browser.newPage();
  await page.setContent('<p id="submissions-status"></p><select id="submissions-filter"><option value="all">All</option></select><button id="submissions-refresh"></button><p id="submissions-admin-timesheet-notice" hidden></p><section id="submissions-admin-timesheet-summary" hidden><p id="submissions-admin-timesheet-status"></p><p id="submissions-admin-timesheet-note"></p><table id="submissions-admin-timesheet-table"></table></section><div id="submissions-list"></div><article id="submissions-preview"></article>');
  await page.evaluate(() => {
    window.GMTPortalApi = { enabled: () => true, history: async () => ({ records: [], meta: { is_admin: true, upstream: 'flow-permission-not-configured', visible_scope: 'all employee submissions', completion: { pay_month: '2026-09', counts: { completed: 0, incomplete: 1, missing: 1 }, directory_configured: true, employees: [{ employee_name: 'Jason', employee_upn: 'jason@gmt-services.co.uk', status: 'incomplete', submitted_records: 0, missing: ['Timesheet week 2026-09-07 to 2026-09-13'] }, { employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk', status: 'missing', submitted_records: 0, missing: ['Timesheet week 2026-09-07 to 2026-09-13'] }] } } }) };
  });
  await page.addScriptTag({ path: resolve(repoRoot, 'portal/submissions.js') });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(() => document.querySelectorAll('#submissions-list [data-submission-index]').length === 3);
  const examples = await page.locator('#submissions-list').innerText();
  assert.match(examples, /Example job card/);
  assert.match(examples, /Example estimate/);
  assert.match(examples, /Example task/);
  assert.match(examples, /Example only/);
  assert.equal(await page.locator('#submissions-admin-timesheet-summary').getAttribute('hidden'), null);
  assert.match(await page.locator('#submissions-admin-timesheet-table').innerText(), /Jason/);
  await page.locator('#submissions-list [data-submission-index="0"]').click();
  assert.match(await page.locator('#submissions-preview').innerText(), /Example preview only/);
  assert.equal(await page.locator('#submissions-preview .job-card-sheet').count(), 1);
  assert.equal(await page.locator('#submissions-preview .job-sheet-logo').count(), 1);
  await page.locator('#submissions-preview [data-submission-card-type="MTA"]').click();
  assert.equal(await page.locator('#submissions-preview .job-card-sheet-mta').count(), 1);
  await page.locator('#submissions-list [data-submission-index="1"]').click();
  assert.equal(await page.locator('#submissions-preview .estimate-paper-logo').count(), 1);
  assert.equal(await page.locator('#submissions-preview .estimate-paper-table').count(), 1);
  await page.locator('#submissions-list [data-submission-index="2"]').click();
  assert.equal(await page.locator('#submissions-preview .submission-task-preview-logo').count(), 1);
  assert.match(await page.locator('#submissions-preview').innerText(), /Example task/);

  const calendarPage = await browser.newPage();
  await calendarPage.setContent('<p id="submissions-calendar-status"></p><h3 data-submissions-calendar-title></h3><button data-submissions-calendar-prev></button><button data-submissions-calendar-next></button><div data-submissions-calendar></div>');
  await calendarPage.evaluate(() => {
    window.GMTPortalApi = { enabled: () => false };
    window.fetch = async () => ({ ok: true, json: async () => ({ events: [] }) });
  });
  await calendarPage.addScriptTag({ path: resolve(repoRoot, 'portal/submissions-calendar.js') });
  await calendarPage.waitForFunction(() => document.querySelector('.portal-calendar-grid'));
  assert.equal(await calendarPage.locator('.portal-calendar-weekday').count(), 7);
  assert.ok((await calendarPage.locator('[data-submissions-calendar-title]').innerText()).length > 0);
  console.log('Submitted documents examples and calendar UI: PASS');
} finally {
  await browser.close();
}
