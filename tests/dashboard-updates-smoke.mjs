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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`
    <section class="portal-updates"><div class="portal-updates-carousel" data-updates-carousel>
      <div id="portal-updates-slide-0" data-updates-slide="0"><h2>Updates and notifications</h2><p>No new notifications</p></div>
      <div id="portal-updates-slide-1" data-updates-slide="1" hidden><h2>Task Board</h2><p id="portal-task-board-status" role="status"></p><div id="portal-task-board"></div><a href="../tasks/">Open task tools</a></div>
      <div><button type="button" data-updates-prev>Previous</button><button type="button" data-updates-dot="0">1</button><button type="button" data-updates-dot="1">2</button><button type="button" data-updates-next>Next</button></div>
    </div></section>`);
  await page.evaluate(() => {
    window.GMTPortalApi = {
      enabled: () => true,
      history: async () => ({ records: [{ kind: 'tasks', source_record_id: 'task-1', task_title: 'Replace motor bearings', assignee: 'Ainsley', employee_name: 'Amanda', status: 'In-Progress', job_reference: 'GMT-001', due_date: '2026-09-18' }] })
    };
  });
  await page.addScriptTag({ path: resolve(repoRoot, 'portal/dashboard-updates.js') });
  await page.waitForFunction(() => document.querySelector('#portal-task-board .portal-task-card'));
  assert.equal(await page.locator('[data-updates-slide="0"]').getAttribute('hidden'), null);
  assert.equal(await page.locator('[data-updates-slide="1"]').getAttribute('hidden'), '');
  assert.match(await page.locator('#portal-task-board').innerText(), /Replace motor bearings/);
  assert.match(await page.locator('#portal-task-board').innerText(), /Ainsley/);
  assert.match(await page.locator('#portal-task-board').innerText(), /Amanda/);
  assert.match(await page.locator('#portal-task-board').innerText(), /50%/);
  await page.locator('[data-updates-next]').click();
  assert.equal(await page.locator('[data-updates-slide="0"]').getAttribute('hidden'), '');
  assert.equal(await page.locator('[data-updates-slide="1"]').getAttribute('hidden'), null);
  await page.locator('[data-updates-prev]').click();
  assert.equal(await page.locator('[data-updates-slide="0"]').getAttribute('hidden'), null);
  const metrics = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
  assert.ok(metrics.body <= metrics.viewport, `updates carousel overflows mobile viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.document <= metrics.viewport, `updates carousel document overflows mobile viewport: ${JSON.stringify(metrics)}`);
  console.log('Dashboard updates carousel and task board: PASS');
} finally {
  await browser.close();
}
