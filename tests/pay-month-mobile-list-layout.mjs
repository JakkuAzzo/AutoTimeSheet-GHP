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
  const names = ['Michelle Reid', 'Matthew', 'Simon', 'Jason', 'Ainsley', 'Lidia Alemayoh', 'Faith'];
  const cards = names.map((name) => `<button type="button" class="estimate-history-item pay-month-list-item">
    <span class="pay-month-list-item-heading"><strong>${name}</strong><span class="portal-status approved">Editable</span></span>
    <span class="pay-month-list-item-month">Pay month 2026-09 · 2026-08-24 to 2026-09-18</span>
    <small>${name.toLowerCase().replaceAll(' ', '.')}@gmt-services.co.uk · 20 daily rows · updated 2026-09-27T16:02:24Z</small>
  </button>`).join('');
  await page.setContent(`<main class="app-main estimate-main"><section class="card estimate-history-panel pay-month-workspace"><div class="pay-month-layout"><section class="pay-month-list-panel"><div id="submissions-list" class="estimate-history-list submissions-record-list pay-month-list">${cards}</div></section></div></section></main>`);
  for (const file of ['styles.css', 'portal.css', 'tools/estimates.css']) {
    await page.addStyleTag({ path: resolve(root, file) });
  }

  const layout = await page.locator('.pay-month-list-item').evaluateAll((buttons) => buttons.map((button) => {
    const card = button.getBoundingClientRect();
    const detail = button.querySelector('small').getBoundingClientRect();
    return { name: button.querySelector('strong').textContent, cardBottom: card.bottom, detailBottom: detail.bottom };
  }));
  for (const item of layout) {
    assert.ok(item.detailBottom <= item.cardBottom + 1, `${item.name} details spill outside the sheet card`);
  }
  assert.ok(await page.locator('#submissions-list').evaluate((list) => list.scrollHeight > list.clientHeight), 'sheet list should scroll after cards keep their full height');
} finally {
  await browser.close();
}
