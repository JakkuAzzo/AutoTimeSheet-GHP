import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  await page.setContent('<p id="portal-calendar-status"></p><input type="month" data-portal-calendar-input><button data-portal-calendar-picker></button><div data-portal-calendar></div>');
  await page.evaluate(() => {
    window.fetch = async () => ({ ok: true, json: async () => ({ events: [] }) });
    window.__offsets = [];
    window.GMTPortalApi = { enabled: () => true, history: async (_, options) => {
      window.__offsets.push(options.offset);
      return options.offset === 0
        ? { records: [{ kind: 'tasks', source_record_id: 'new', record_date: '2026-10-01', event_title: 'New task' }], meta: { upstream: 'ok', history_pagination: { has_more: true, next_offset: 1000 } } }
        : { records: [{ kind: 'tasks', source_record_id: 'old', record_date: '2026-06-03', event_title: 'Older task' }], meta: { upstream: 'ok', history_pagination: { has_more: false } } };
    } };
  });
  await page.addScriptTag({ path: resolve(root, 'portal/calendar-data.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/calendar-preview.js') });
  await page.waitForFunction(() => document.querySelector('#portal-calendar-status').textContent.includes('Shared calendar:'));
  await page.locator('[data-portal-calendar-input]').fill('2026-06');
  await page.locator('[data-portal-calendar-input]').dispatchEvent('change');
  assert.deepEqual(await page.evaluate(() => window.__offsets), [0, 1000]);
  assert.equal(await page.locator('[data-calendar-record-id="old"]').count(), 1, 'an older record appears on its actual date');
  console.log('Calendar pagination browser test: PASS');
} finally { await browser.close(); }
