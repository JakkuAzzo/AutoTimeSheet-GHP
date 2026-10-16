import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
function listHtmlFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'output', 'coverage'].includes(entry.name)) return [];
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return listHtmlFiles(absolutePath, relativePath);
    if (!entry.isFile() || !entry.name.endsWith('.html')) return [];
    return [relativePath === 'index.html' ? '/' : relativePath.endsWith('/index.html')
      ? `/${relativePath.slice(0, -'index.html'.length)}`
      : `/${relativePath}`];
  });
}
const routes = listHtmlFiles(root).sort();
const viewports = [[320, 568], [390, 844], [667, 375], [768, 1024], [1280, 720], [1440, 900]];
const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  let path = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!existsSync(path) && !pathname.endsWith('.html') && existsSync(`${path}.html`)) path = `${path}.html`;
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
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
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: viewports[0][0], height: viewports[0][1] } });
  const failures = [];

  for (const route of routes) {
    await page.goto(`http://127.0.0.1:${server.address().port}${route}`, { waitUntil: 'load' });
    await page.evaluate(() => {
      document.querySelectorAll('main[hidden]').forEach((main) => { main.hidden = false; main.removeAttribute('aria-hidden'); });
      window.GMTViewportEffects?.init(document);
    });
    await page.waitForTimeout(40);
    const motion = await page.evaluate(() => {
      const reveal = document.querySelector('[data-scroll-reveal]');
      const duration = reveal ? getComputedStyle(reveal).transitionDuration.split(',')[0].trim() : '0s';
      return {
        ready: document.documentElement.getAttribute('data-viewport-effects-ready') === 'true',
        revealCount: document.querySelectorAll('[data-scroll-reveal]').length,
        revealTransition: duration
      };
    });
    if (!motion.ready) failures.push(`${route}: viewport and reveal effects did not initialize`);
    if (motion.revealCount && motion.revealTransition === '0s') failures.push(`${route}: scroll-reveal targets have no transition`);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(40);
      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const main = document.querySelector('main:not([hidden])');
        const firstSnapPanel = document.querySelector('[data-scroll-snap]');
        const firstSnapRect = firstSnapPanel?.getBoundingClientRect();
        const panels = [...document.querySelectorAll('[data-scroll-snap]')].map((panel) => {
          const rect = panel.getBoundingClientRect();
          const style = getComputedStyle(panel);
          return {
            className: typeof panel.className === 'string' ? panel.className : '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            clientHeight: panel.clientHeight,
            scrollHeight: panel.scrollHeight,
            overflowY: style.overflowY,
            snapAlign: style.scrollSnapAlign
          };
        });
        return {
          path: location.pathname,
          width: innerWidth,
          height: innerHeight,
          documentWidth: root.scrollWidth,
          documentHeight: root.scrollHeight,
          clientWidth: root.clientWidth,
          rootOverflowY: getComputedStyle(root).overflowY,
          scrollBehavior: getComputedStyle(main || root).scrollBehavior,
          mainScrollType: main ? getComputedStyle(main).scrollSnapType : 'none',
          mainOverflowY: main ? getComputedStyle(main).overflowY : 'visible',
          mainHeight: main ? Math.round(main.getBoundingClientRect().height) : null,
          mainBottom: main ? Math.round(main.getBoundingClientRect().bottom) : null,
          hasPortalShell: root.getAttribute('data-portal-viewport-shell') === 'true',
          firstPanelBottom: firstSnapPanel ? Math.round(firstSnapPanel.getBoundingClientRect().bottom) : null,
          firstPanelTop: firstSnapRect ? Math.round(firstSnapRect.top) : null,
          firstPanelHeight: firstSnapRect ? Math.round(firstSnapRect.height) : null,
          firstPanelOffset: getComputedStyle(root).getPropertyValue('--gmt-public-first-section-offset').trim(),
          panels
        };
      });
      if (layout.documentWidth > width + 1) failures.push(`${route} at ${width}x${height}: document width ${layout.documentWidth}px exceeds viewport`);
      if (layout.hasPortalShell && layout.mainBottom > height + 1) {
        failures.push(`${route} at ${width}x${height}: portal shell exceeds the viewport height (main bottom ${layout.mainBottom}px, main height ${layout.mainHeight}px)`);
      }
      if (layout.hasPortalShell && !['hidden', 'clip'].includes(layout.rootOverflowY)) failures.push(`${route} at ${width}x${height}: portal document root is not constrained to its viewport`);
      if (layout.hasPortalShell && layout.mainOverflowY !== 'auto') failures.push(`${route} at ${width}x${height}: portal content is not contained in a scrollable viewport panel`);
      if (layout.panels.length && layout.firstPanelBottom > height + 1) failures.push(`${route} at ${width}x${height}: first section ends at ${layout.firstPanelBottom}px (top ${layout.firstPanelTop}px, height ${layout.firstPanelHeight}px, offset ${layout.firstPanelOffset})`);
      for (const panel of layout.panels) {
        if (panel.left < -1 || panel.right > width + 1) failures.push(`${route} at ${width}x${height}: ${panel.className} extends beyond viewport width`);
        if (panel.height > height + 1) failures.push(`${route} at ${width}x${height}: ${panel.className} is ${panel.height}px tall`);
        if (panel.snapAlign !== 'start') failures.push(`${route} at ${width}x${height}: ${panel.className} does not align to the snap start`);
        if (panel.scrollHeight > panel.clientHeight + 1 && !['auto', 'scroll'].includes(panel.overflowY)) {
          failures.push(`${route} at ${width}x${height}: ${panel.className} clips ${panel.scrollHeight - panel.clientHeight}px of content`);
        }
      }
      if (route === '/') {
        await page.mouse.move(Math.floor(width / 2), Math.floor(height / 2));
        await page.mouse.wheel(0, 24);
        await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 24 })));
        const activeSnap = await page.evaluate(() => ({
          ready: document.documentElement.getAttribute('data-public-scroll-snap-ready'),
          type: getComputedStyle(document.documentElement).scrollSnapType,
          firstPanelBottom: document.querySelector('[data-scroll-snap]')?.getBoundingClientRect().bottom,
          viewportHeight: innerHeight
        }));
        if (activeSnap.ready !== 'true' || !activeSnap.type.includes('y')) failures.push(`/${width}x${height}: public scroll does not activate vertical snap`);
        if (activeSnap.firstPanelBottom > activeSnap.viewportHeight + 1) failures.push(`/${width}x${height}: first public section extends below viewport after snap activation`);
      }
      if (route === '/portal/') {
        await page.mouse.move(Math.floor(width / 2), Math.floor(height / 2));
        await page.mouse.wheel(0, 24);
        await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 24 })));
        const activeSnap = await page.evaluate(() => {
          const main = document.querySelector('main.app-main:not([hidden])');
          return { ready: main?.getAttribute('data-portal-scroll-snap-ready'), type: main ? getComputedStyle(main).scrollSnapType : 'none' };
        });
        if (activeSnap.ready !== 'true' || !activeSnap.type.includes('y')) failures.push(`/portal/ at ${width}x${height}: dashboard scroll does not activate vertical snap`);
      }
    }

    if (route === '/') {
      await page.mouse.move(160, 160);
      await page.mouse.wheel(0, 160);
      await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 160 })));
      const snap = await page.evaluate(() => ({
        ready: document.documentElement.getAttribute('data-public-scroll-snap-ready'),
        type: getComputedStyle(document.documentElement).scrollSnapType,
        firstPanelBottom: document.querySelector('[data-scroll-snap]')?.getBoundingClientRect().bottom,
        viewportHeight: innerHeight
      }));
      if (snap.ready !== 'true' || !snap.type.includes('y')) failures.push('/: public scroll does not enable vertical section snapping after user scroll');
      if (snap.firstPanelBottom > snap.viewportHeight + 1) failures.push('/: the first public section extends beyond the viewport after snap activation');
    }
    if (route === '/portal/') {
      await page.mouse.move(160, 160);
      await page.mouse.wheel(0, 160);
      await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 160 })));
      const snap = await page.evaluate(() => {
        const main = document.querySelector('main.app-main:not([hidden])');
        return { ready: main?.getAttribute('data-portal-scroll-snap-ready'), type: main ? getComputedStyle(main).scrollSnapType : 'none' };
      });
      if (snap.ready !== 'true' || !snap.type.includes('y')) failures.push('/portal/: dashboard does not enable vertical section snapping after user scroll');
    }
  }

  assert.deepEqual(failures, [], failures.slice(0, 30).join('\n'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const reducedMotion = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    snapType: getComputedStyle(document.documentElement).scrollSnapType
  }));
  assert.equal(reducedMotion.scrollBehavior, 'auto', 'public site respects reduced motion');
  assert.ok(!reducedMotion.snapType.includes('y'), 'public site disables snapping for reduced motion');
  await page.goto(`http://127.0.0.1:${server.address().port}/portal/`);
  await page.evaluate(() => {
    document.querySelectorAll('main[hidden]').forEach((main) => { main.hidden = false; main.removeAttribute('aria-hidden'); });
    window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 160 }));
  });
  const portalReducedMotion = await page.evaluate(() => {
    const main = document.querySelector('main.app-main:not([hidden])');
    return { scrollBehavior: main ? getComputedStyle(main).scrollBehavior : '', snapType: main ? getComputedStyle(main).scrollSnapType : 'none' };
  });
  assert.equal(portalReducedMotion.scrollBehavior, 'auto', 'staff portal respects reduced motion');
  assert.ok(!portalReducedMotion.snapType.includes('y'), 'staff portal disables snapping for reduced motion');
  console.log(`${routes.length} public and staff-portal pages × ${viewports.length} viewports: viewport-fit, no clipped snap content, smooth-scroll, snap activation and reduced-motion: PASS`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
