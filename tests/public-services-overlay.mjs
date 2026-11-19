import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const path = normalize(join(root, name.endsWith('/') ? `${name}index.html` : name));
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 725, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/#why-gmt`, { waitUntil: 'domcontentloaded' });
    const carousel = page.locator('[data-section-navigation-label="Why GMT"]');
    await page.waitForFunction(() => document.querySelector('[data-section-navigation-label="Why GMT"]').classList.contains('is-carousel-enhanced'));
    const heights = () => carousel.locator('.content-carousel-panel').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    const before = await heights();
    await carousel.locator('[data-content-next]').click();
    await page.waitForFunction(() => document.querySelector('#what-we-offer').classList.contains('is-active'));
    const after = await heights();
    assert.ok(Math.max(...after) - Math.min(...after) < 1 && Math.abs(before[0] - after[0]) < 1, `${viewport.width}: panel heights stay equal`);
    const sizing = await carousel.evaluate(root => {
      const panels = [...root.querySelectorAll('.content-carousel-panel')];
      const trackHeight = root.querySelector('[data-content-track]').getBoundingClientRect().height;
      return { trackHeight, offerHeight: root.querySelector('#what-we-offer').scrollHeight, contentsFit: panels.every(panel => panel.scrollHeight <= panel.getBoundingClientRect().height + 2) };
    });
    assert.ok(Math.abs(sizing.trackHeight - sizing.offerHeight) < 1 && sizing.contentsFit, `${viewport.width}: section fits What we offer without clipping`);
    const layers = await page.evaluate(() => ({ footer: Number(getComputedStyle(document.querySelector('.site-footer')).zIndex), control: Number(getComputedStyle(document.querySelector('.public-next-section-control')).zIndex) }));
    assert.ok(layers.footer > layers.control, `${viewport.width}: footer is above floating control`);
    const trigger = page.locator('#what-we-offer [data-services-overlay-open]');
    assert.equal(await page.locator('main > #services').isHidden(), true);
    await trigger.click();
    const dialog = page.locator('[data-services-overlay]');
    assert.equal(await dialog.evaluate(element => element.open), true);
    assert.equal(await dialog.locator('.service-card').count(), 9);
    assert.equal(await page.locator('[data-services-overlay-close]').evaluate(element => element === document.activeElement), true);
    assert.ok(await dialog.evaluate(element => element.scrollHeight > element.clientHeight), `${viewport.width}: cards can be scrolled`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-services-overlay]').open && !!document.querySelector('main > #services[hidden]'));
    await trigger.click();
    await dialog.locator('.service-card [data-enquire-nav]').first().click();
    assert.equal(await dialog.evaluate(element => element.open), false);
    assert.equal(await page.locator('[data-contact-modal]').isVisible(), true);
    await page.locator('[data-contact-modal] .contact-close').click();
    assert.equal(await page.locator('[data-site-nav] [data-services-overlay-open]').evaluate(element => element === document.activeElement), true);
    await page.locator('[data-site-nav] [data-services-overlay-open]').click();
    assert.equal(await dialog.evaluate(element => element.open), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !!document.querySelector('main > #services[hidden]'));
    assert.ok(await page.evaluate(() => {
      const sections = [...document.querySelectorAll('main > [data-scroll-snap]')].filter(element => !element.hidden);
      const reviews = sections.findIndex(element => element.classList.contains('google-reviews-section'));
      return reviews >= 0 && sections[reviews + 1].getAttribute('data-section-navigation-label') === 'Our story and how to reach out';
    }), 'Reviews are followed by Our story');
    await page.close();
  }
  console.log('Services overlay and equal carousel heights: PASS');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
