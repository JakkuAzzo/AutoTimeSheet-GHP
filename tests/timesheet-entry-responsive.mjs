import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const path = normalize(join(repoRoot, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!path.startsWith(repoRoot) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }

  response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
  response.end(pathname === '/config.js'
    ? readFileSync(path, 'utf8').replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false').replace(/(portalApiEndpoint:\s*)"[^"]*"/, '$1""')
    : readFileSync(path));
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = resolve(repoRoot, 'output/playwright');
mkdirSync(screenshotDir, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/timesheets/create.html`, { waitUntil: 'load' });
  await page.locator('#week-start').fill('2026-09-14');
  await page.locator('#week-end').fill('2026-09-18');
  await page.locator('#generate-days-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('.day-card').length === 5, null, { timeout: 5000 });

  const firstCollapseButton = page.locator('.day-card .collapse-day').first();
  await firstCollapseButton.click();
  assert.equal(await firstCollapseButton.getAttribute('aria-expanded'), 'false');
  await firstCollapseButton.click();
  assert.equal(await firstCollapseButton.getAttribute('aria-expanded'), 'true');
  await page.locator('#add-day-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('.day-card').length === 6, null, { timeout: 5000 });
  await page.locator('.day-card:last-child .remove-day').click();
  await page.waitForFunction(() => document.querySelectorAll('.day-card').length === 5, null, { timeout: 5000 });
  if (await page.locator('.day-card').first().evaluate((card) => card.classList.contains('is-collapsed'))) await firstCollapseButton.click();
  await page.locator('.day-card [data-field="date"]').first().waitFor({ state: 'visible' });
  await page.locator('.day-card').first().locator('.additional-fields summary').click();
  await page.locator('.day-card [data-field="description"]').first().waitFor({ state: 'visible' });

  await firstCollapseButton.focus();
  await page.keyboard.press('Tab');
  const keyboardFocus = await page.evaluate(() => ({
    insideDayCard: Boolean(document.activeElement?.closest('.day-card')),
    focusable: Boolean(document.activeElement?.matches('input, select, textarea, button')),
    visible: Boolean(document.activeElement?.matches(':focus-visible')),
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth
  }));
  assert.deepEqual(keyboardFocus, { insideDayCard: true, focusable: true, visible: true, outlineWidth: '3px' });
  await page.evaluate(() => document.activeElement?.blur());

  const widths = [320, 375, 768, 960, 1024, 1440];
  const failures = [];
  const layouts = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.timesheet-grid').screenshot({ path: resolve(screenshotDir, `timesheet-entry-${width}.png`), animations: 'disabled' });
    await page.locator('#summary-output').screenshot({ path: resolve(screenshotDir, `timesheet-totals-${width}.png`), animations: 'disabled' });
    const layout = await page.evaluate(() => {
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const grid = document.querySelector('.timesheet-grid');
      const cards = [...document.querySelectorAll('.day-card')];
      const controls = [...document.querySelectorAll('.day-card [data-field]')].filter((element) => element.getClientRects().length > 0);
      const labels = [...document.querySelectorAll('.day-card label')].filter((element) => element.getClientRects().length > 0);
      const buttons = [...document.querySelectorAll('.day-card button')].filter((element) => element.getClientRects().length > 0);
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        grid: { ...rect(grid), scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth },
        totals: rect(document.querySelector('#summary-output')),
        cards: cards.map((card) => ({ ...rect(card), scrollWidth: card.scrollWidth, clientWidth: card.clientWidth })),
        controls: controls.map((element) => ({ field: element.dataset.field, ...rect(element) })),
        bodyResults: cards.map((card) => ({ bodyBottom: rect(card.querySelector('.day-card-body')).bottom, resultTop: rect(card.querySelector('.day-result')).top })),
        controlCount: controls.length,
        labels: labels.map((element) => {
          const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          const range = document.createRange();
          if (textNode) range.selectNodeContents(textNode);
          const control = element.querySelector('[data-field]');
          return {
            text: textNode?.textContent.trim() || '',
            textRects: [...range.getClientRects()].map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom })),
            control: control ? rect(control) : null,
            ...rect(element)
          };
        }),
        collapsedSummaries: [...document.querySelectorAll('.day-card.is-collapsed .day-mini-summary')].map((element) => {
          const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
          return { height: element.getBoundingClientRect().height, lineHeight };
        }),
        dayGridColumns: new Set(controls.slice(0, 5).map((element) => Math.round(element.getBoundingClientRect().left))).size,
        buttons: buttons.map((element) => ({ name: element.getAttribute('aria-label') || element.textContent.trim(), ...rect(element) }))
      };
    });
    layouts.push(layout);

    if (layout.documentWidth > width + 1) failures.push(`${width}px: document width ${layout.documentWidth}px exceeds viewport`);
    if (layout.grid.scrollWidth > layout.grid.clientWidth + 1) failures.push(`${width}px: timesheet grid scrolls horizontally`);
    if (layout.totals.left < -1 || layout.totals.right > width + 1 || layout.totals.top < layout.grid.bottom) failures.push(`${width}px: totals are clipped or no longer follow the day list`);
    if (layout.cards.some((card) => Math.abs(card.left - layout.cards[0].left) > 1)) failures.push(`${width}px: day cards are not in a single-column list`);
    if (layout.bodyResults.some(({ bodyBottom, resultTop }) => resultTop + 1 < bodyBottom)) failures.push(`${width}px: a calculated result overlaps its day controls or optional fields`);
    if (width <= 360 && layout.dayGridColumns !== 1) failures.push(`${width}px: narrow mobile controls used ${layout.dayGridColumns} columns from ${layout.controlCount} controls, expected one`);
    if (width > 360 && width <= 640 && layout.dayGridColumns !== 2) failures.push(`${width}px: mobile controls used ${layout.dayGridColumns} columns from ${layout.controlCount} controls, expected two`);
    if (width >= 1024 && layout.collapsedSummaries.some(({ height, lineHeight }) => height > lineHeight * 1.5)) failures.push(`${width}px: a collapsed day summary wraps into multiple lines`);
    layout.cards.forEach((card, index) => {
      if (card.scrollWidth > card.clientWidth + 1) failures.push(`${width}px: day ${index + 1} scrolls horizontally`);
    });
    layout.controls.forEach((control) => {
      if (control.left < -1 || control.right > width + 1) failures.push(`${width}px: ${control.field} control extends outside viewport`);
      if (control.width < 40 || control.height < 40) failures.push(`${width}px: ${control.field} control is below 40px`);
    });
    layout.labels.forEach((label) => {
      if (label.width < 1 || label.height < 1 || label.left < -1 || label.right > width + 1) failures.push(`${width}px: label '${label.text}' is hidden or clipped`);
      if (label.control && label.textRects.some((textRect) => textRect.bottom > label.control.top + 1)) failures.push(`${width}px: label '${label.text}' overlaps its control`);
    });
    layout.buttons.forEach((button) => {
      if (button.left < -1 || button.right > width + 1) failures.push(`${width}px: '${button.name}' action extends outside viewport`);
    });

    if (width >= 768) {
      const dateAndTimeControls = layout.controls.filter(({ field }) => ['date', 'start', 'finish'].includes(field));
      if (dateAndTimeControls.some(({ width: controlWidth }) => controlWidth < 96)) failures.push(`${width}px: a desktop date/time control is narrower than 96px`);
    }
  }

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(failures, [], `Responsive layout failures:\n${failures.join('\n')}`);
  console.log(`Responsive timesheet layout passed at ${widths.join(', ')}px.`);
  console.log(`Screenshots: ${widths.flatMap((width) => [`output/playwright/timesheet-entry-${width}.png`, `output/playwright/timesheet-totals-${width}.png`]).join(', ')}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
