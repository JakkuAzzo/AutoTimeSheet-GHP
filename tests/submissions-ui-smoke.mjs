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
  await page.setContent('<p id="submissions-status"></p><select id="submissions-filter"><option value="all">All</option></select><button id="submissions-refresh"></button><div id="submissions-list"></div><article id="submissions-preview"></article>');
  await page.evaluate(() => {
    window.GMTPortalApi = { enabled: () => true, history: async () => ({ records: [], meta: { is_operations_admin: true, visible_scope: 'all non-timesheet submissions' } }) };
  });
  await page.addScriptTag({ path: resolve(repoRoot, 'portal/submissions.js') });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(() => document.querySelectorAll('#submissions-list [data-submission-index]').length === 3);
  const examples = await page.locator('#submissions-list').innerText();
  assert.match(examples, /Example job card/);
  assert.match(examples, /Example estimate/);
  assert.match(examples, /Example task/);
  assert.match(examples, /Example only/);
  await page.locator('#submissions-list [data-submission-index="0"]').click();
  assert.match(await page.locator('#submissions-preview').innerText(), /Example preview only/);

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
