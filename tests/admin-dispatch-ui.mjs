import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const page = await browser.newPage();
  await page.setContent('<main><p id="submissions-status"></p><button id="submissions-refresh"></button><div id="submissions-dispatch-tools" class="portal-history-toolbar" hidden><button id="submissions-dispatch">Send queued corrections now</button><p id="submissions-dispatch-status"></p></div><div id="submissions-list"></div><article id="submissions-preview"></article></main>');
  await page.addStyleTag({ path: resolve(root, 'portal.css') });
  await page.evaluate(() => {
    window.testAdmin = false;
    window.dispatchCalls = 0;
    window.GMTPortalApi = {
      enabled: () => true,
      history: async () => ({ records: [], meta: { is_admin: window.testAdmin } }),
      dispatchCorrections: async () => {
        window.dispatchCalls += 1;
        return window.dispatchCalls === 1
          ? { sent: 3, failed: 0, skipped: 0 }
          : { status: 'rate-limited', failed: 1, deferred: 2, retryAt: '2026-09-27T16:30:00.000Z' };
      }
    };
  });
  await page.addScriptTag({ path: resolve(root, 'portal/submissions.js') });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(() => document.querySelector('#submissions-status').textContent.includes('No submitted documents'));
  assert.equal(await page.locator('#submissions-dispatch-tools').isVisible(), false, 'staff cannot see the Accounts replay action');
  await page.evaluate(() => { window.testAdmin = true; });
  await page.locator('#submissions-refresh').click();
  await page.waitForFunction(() => !document.querySelector('#submissions-dispatch-tools').hidden);
  assert.equal(await page.locator('#submissions-dispatch-tools').isVisible(), true);
  await page.locator('#submissions-dispatch').click();
  await page.waitForFunction(() => window.dispatchCalls === 1);
  assert.match(await page.locator('#submissions-dispatch-status').innerText(), /3 accepted by the outbound service/);
  await page.locator('#submissions-dispatch').click();
  await page.waitForFunction(() => window.dispatchCalls === 2);
  assert.match(await page.locator('#submissions-dispatch-status').innerText(), /1 attempt failed; 2 remaining correction/);
} finally {
  await browser.close();
}

console.log('PASS: Accounts-only correction replay control is hidden for staff and invokes the protected request.');
