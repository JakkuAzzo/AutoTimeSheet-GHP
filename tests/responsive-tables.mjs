import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir as readdirAsync } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
async function htmlFiles(directory) {
  const entries = await readdirAsync(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? htmlFiles(join(directory, entry.name))
    : entry.name.endsWith('.html') ? [join(directory, entry.name)] : []));
  return files.flat();
}
const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const path = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
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
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/portal/users.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.querySelector('main').hidden = false;
    document.querySelector('[data-users-list]').innerHTML = '<tr><td>Michelle Reid</td><td>michelle.admin@gmt-services.co.uk</td><td>Full administrator</td><td>Worker configuration</td><td><button>Remove role</button></td></tr>';
    document.querySelector('main').insertAdjacentHTML('beforeend', `
      <div class="table-scroll"><table class="timesheet-editor-grid"><thead><tr><th>Date</th><th>Start</th><th>Finish</th><th>Break (min)</th><th>Absence</th><th>Notes</th></tr></thead><tbody><tr><td>2026-10-12</td><td><input value="08:00"></td><td><input value="17:00"></td><td><input value="60"></td><td><select><option>NA</option></select></td><td>A longer timesheet note for wrapping</td></tr></tbody></table></div>
      <div class="table-scroll"><table class="timesheet-paper-rows"><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Break</th><th>Worked</th><th>Basic</th><th>OT x1.5</th><th>OT x2</th><th>Absence / status</th><th>Notes</th></tr></thead><tbody><tr><td>2026-10-12</td><td>08:00</td><td>17:00</td><td>60 minutes</td><td>8 hours</td><td>8 hours</td><td>0</td><td>0</td><td>None</td><td>Notes wrap inside this row</td></tr></tbody></table></div>
      <div class="pay-month-table-scroll"><table class="timesheet-paper-rows pay-month-edit-table"><thead><tr><th>Date</th><th>Start</th><th>Finish</th><th>Break</th><th>Absence</th><th>Total hours</th><th>Notes</th><th>Actions</th></tr></thead><tbody><tr><td><input type="date" value="2026-10-12"></td><td><input type="time" value="08:00"></td><td><input type="time" value="17:00"></td><td><input type="number" value="60"></td><td><select><option>NA</option></select></td><td>8</td><td><input value="A longer note"></td><td><button>Remove day</button></td></tr></tbody></table></div>`);
    const estimatesCss = document.createElement('link');
    estimatesCss.rel = 'stylesheet';
    estimatesCss.href = '/tools/estimates.css?v=responsive-test';
    document.head.appendChild(estimatesCss);
  });

  const widths = [320, 375, 768, 1024, 1366, 1920];
  const failures = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const state = await page.evaluate(() => {
      const wrappers = [...document.querySelectorAll('.table-scroll, .pay-month-table-scroll')];
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        wrappers: wrappers.map((wrapper) => ({
          width: wrapper.clientWidth,
          scrollWidth: wrapper.scrollWidth,
          tables: [...wrapper.querySelectorAll('table')].map((table) => ({
            width: table.getBoundingClientRect().width,
            display: getComputedStyle(table).display,
            labels: [...table.querySelectorAll('tbody td:not([colspan])')].map((cell) => cell.dataset.label || ''),
            firstLabel: table.querySelector('tbody td:not([colspan])') && getComputedStyle(table.querySelector('tbody td:not([colspan])'), '::before').content
          }))
        }))
      };
    });
    if (state.documentWidth > width + 1) failures.push(`${width}px viewport overflows document (${state.documentWidth}px)`);
    state.wrappers.forEach((wrapper) => {
      if (wrapper.scrollWidth > wrapper.width + 1) failures.push(`${width}px table wrapper scrolls horizontally (${wrapper.scrollWidth}px > ${wrapper.width}px)`);
      if (width <= 900 && wrapper.tables.some((table) => table.labels.some((label) => !label))) failures.push(`${width}px table cells do not expose their column labels`);
      if (width <= 900 && wrapper.tables.some((table) => table.display !== 'block' || table.firstLabel === 'none' || table.firstLabel === 'normal')) failures.push(`${width}px table rows are not visibly reflowed as labeled cards`);
      if (wrapper.tables.some((table) => table.width > wrapper.width + 1)) failures.push(`${width}px a table exceeds its panel`);
    });
  }

  assert.deepEqual(failures, [], failures.join('\n'));

  const pageRoutes = [];
  for (const file of await htmlFiles(root)) {
    const html = readFileSync(file, 'utf8');
    if (html.includes('responsive-tables.js')) pageRoutes.push('/' + file.slice(root.length + 1));
  }
  const routeFailures = [];
  for (const route of pageRoutes) {
    await page.goto(`http://127.0.0.1:${server.address().port}${route}`, { waitUntil: 'domcontentloaded' });
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        document.querySelectorAll('main[hidden]').forEach((main) => { main.hidden = false; });
        return {
          documentWidth: document.documentElement.scrollWidth,
          body: { clientWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth },
          html: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
          mainChildren: [...document.querySelector('main').children].map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            rect: Math.round(element.getBoundingClientRect().width)
          })),
          scrollers: [...document.querySelectorAll('body *')].map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            id: element.id,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth
          })).filter((element) => element.scrollWidth > element.clientWidth + 1).slice(0, 6),
          offenders: [...document.querySelectorAll('body *')].map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            id: element.id,
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width)
          })).filter((element) => element.width > 0 && element.right > window.innerWidth + 1).slice(0, 4)
        };
      });
      if (layout.documentWidth > width + 1) routeFailures.push(`${route} at ${width}px overflows to ${layout.documentWidth}px: ${JSON.stringify({ body: layout.body, html: layout.html, mainChildren: layout.mainChildren, scrollers: layout.scrollers, offenders: layout.offenders })}`);
    }
  }
  assert.deepEqual(routeFailures, [], routeFailures.join('\n'));
  console.log(`Responsive tables and ${pageRoutes.length} portal page layouts at 320–1920px: PASS`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
