import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const filePath = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  response.end(readFileSync(filePath));
});

async function waitForNavigation(page, nextName) {
  const expectedLabel = `Next Section: ${nextName}`;
  await page.getByRole('button', { name: expectedLabel }).waitFor({ state: 'visible', timeout: 4000 });
  await page.waitForFunction((label) => {
    const control = document.querySelector('[data-next-section-control]');
    return control && !control.disabled && control.getAttribute('aria-label') === label;
  }, expectedLabel, { timeout: 4000 });
}

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

  const responsiveViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 667, height: 375 },
    { width: 768, height: 1024 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 }
  ];
  for (const viewport of responsiveViewports) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(5000);
    await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    try {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      const control = page.getByRole('button', { name: 'Next section: Why GMT' });
      await control.waitFor({ state: 'visible' });
      assert.match(await control.innerText(), /Next section:\s*Why GMT\s*↓/i, `${viewport.width}px: the visible control names the upcoming major section and shows a down arrow`);

      const floatingPosition = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { position: getComputedStyle(element).position, left: rect.left, right: rect.right, bottom: rect.bottom, height: rect.height };
      });
      assert.equal(floatingPosition.position, 'fixed', `${viewport.width}px: the next-section control floats above the page`);
      assert.ok(floatingPosition.left >= 0 && floatingPosition.right <= viewport.width, `${viewport.width}px: the control fits the viewport width`);
      assert.ok(floatingPosition.bottom <= viewport.height && floatingPosition.height >= 40, `${viewport.width}px: the control stays visible with a usable hit area`);

      const expectedNextSections = [
        'What customers say',
        'Repair services for essential equipment',
        'Our story and how to reach out',
        'A look at GMT’s engineering work',
        'Get in touch'
      ];
      for (const nextName of expectedNextSections) {
        const navigationControl = page.getByRole('button', { name: /^Next Section:/i });
        await navigationControl.click();
        assert.equal(await navigationControl.isDisabled(), true, `${viewport.width}px: prevent a second section jump while smooth scrolling is in progress`);
        await waitForNavigation(page, nextName);
      }

      const finalNavigationControl = page.getByRole('button', { name: /^Next Section:/i });
      await finalNavigationControl.click();
      assert.equal(await finalNavigationControl.isDisabled(), true, `${viewport.width}px: keep the final navigation locked while scrolling to the last section`);
      await page.waitForFunction(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1, { timeout: 4000 });
      const terminalState = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('main [data-scroll-snap]')).filter((section) => !section.parentElement?.closest('[data-scroll-snap]'));
        const lastSectionRect = sections.at(-1).getBoundingClientRect();
        return {
          atDocumentEnd: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1,
          lastSectionVisible: lastSectionRect.top < window.innerHeight && lastSectionRect.bottom > 0
        };
      });
      assert.equal(terminalState.atDocumentEnd, true, `${viewport.width}px: final navigation reaches the end of the document`);
      assert.equal(terminalState.lastSectionVisible, true, `${viewport.width}px: the final section is visible at the document end`);
      await page.getByRole('button', { name: /^Next Section:/i }).waitFor({ state: 'hidden', timeout: 4000 });
      assert.equal(await page.locator('#about-tab').getAttribute('aria-selected'), 'true', `${viewport.width}px: the story carousel remains on its first tab when treated as one page section`);
    } finally {
      await page.close();
    }
  }

  const processPage = await browser.newPage({ viewport: { width: 320, height: 568 } });
  processPage.setDefaultTimeout(5000);
  await processPage.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  try {
    await processPage.goto(`${origin}/process/electric-motor-repair/`, { waitUntil: 'domcontentloaded' });
    await processPage.getByRole('button', { name: 'Next Section: Prepare your enquiry' }).click();
    await waitForNavigation(processPage, 'Related services and guidance');
    await processPage.getByRole('button', { name: /^Next Section:/i }).click();
    await waitForNavigation(processPage, 'Get advice from the workshop');
    await processPage.getByRole('button', { name: /^Next Section:/i }).click();
    await processPage.getByRole('button', { name: /^Next Section:/i }).waitFor({ state: 'hidden', timeout: 4000 });
  } finally {
    await processPage.close();
  }

  const reducedMotionPage = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  reducedMotionPage.setDefaultTimeout(5000);
  await reducedMotionPage.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  try {
    await reducedMotionPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    const nextSectionControl = reducedMotionPage.getByRole('button', { name: 'Next section: Why GMT' });
    await nextSectionControl.focus();
    await nextSectionControl.press('Enter');
    await waitForNavigation(reducedMotionPage, 'What customers say');
    const focusMovedIntoDestination = await reducedMotionPage.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('main [data-scroll-snap]')).filter((section) => !section.parentElement?.closest('[data-scroll-snap]'));
      return sections[1].contains(document.activeElement);
    });
    assert.equal(focusMovedIntoDestination, true, 'keyboard activation moves focus to the destination section');
  } finally {
    await reducedMotionPage.close();
  }

  const clearancePage = await browser.newPage({ viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' });
  clearancePage.setDefaultTimeout(5000);
  await clearancePage.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  try {
    await clearancePage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    for (const nextName of ['What customers say', 'Repair services for essential equipment', 'Our story and how to reach out', 'A look at GMT’s engineering work']) {
      await clearancePage.getByRole('button', { name: /^Next Section:/i }).click();
      await waitForNavigation(clearancePage, nextName);
    }

    const storySection = clearancePage.locator('.content-carousel-wide');
    assert.equal(await storySection.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    }), true, 'the story section is in view before checking its final link');
    await storySection.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const storyLink = clearancePage.getByRole('link', { name: /See how to prepare a repair enquiry/i });
    await storyLink.waitFor({ state: 'visible' });
    const storyLinkMetrics = await storyLink.evaluate((link) => {
      const linkRect = link.getBoundingClientRect();
      const controlRect = document.querySelector('.public-next-section-control').getBoundingClientRect();
      const section = link.closest('.content-carousel-wide');
      const sectionRect = section.getBoundingClientRect();
      const linkHit = document.elementFromPoint(linkRect.left + linkRect.width / 2, linkRect.bottom - 2);
      return {
        clear: linkRect.bottom <= controlRect.top || linkRect.top >= controlRect.bottom || linkRect.right <= controlRect.left || linkRect.left >= controlRect.right,
        inViewport: linkRect.top >= 0 && linkRect.bottom <= window.innerHeight,
        receivesHit: linkHit === link || link.contains(linkHit),
        link: { top: linkRect.top, bottom: linkRect.bottom, left: linkRect.left, right: linkRect.right },
        control: { top: controlRect.top, bottom: controlRect.bottom, left: controlRect.left, right: controlRect.right },
        section: { top: sectionRect.top, bottom: sectionRect.bottom, scrollTop: section.scrollTop, scrollHeight: section.scrollHeight, clientHeight: section.clientHeight, paddingBottom: getComputedStyle(section).paddingBottom, clearance: section.style.getPropertyValue('--public-next-section-clearance') }
      };
    });
    assert.equal(storyLinkMetrics.inViewport, true, `the story section enquiry link can be brought fully into the 320 × 568 viewport: ${JSON.stringify(storyLinkMetrics)}`);
    assert.equal(storyLinkMetrics.clear, true, `the floating control does not cover the story section enquiry link at 320 × 568: ${JSON.stringify(storyLinkMetrics)}`);
    assert.equal(storyLinkMetrics.receivesHit, true, `the story section enquiry link receives taps at 320 × 568: ${JSON.stringify(storyLinkMetrics)}`);
  } finally {
    await clearancePage.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}

console.log('Public next-section navigation: PASS (6 phone, tablet, laptop and desktop viewports; repair guide; reduced motion; carousel grouping)');
