import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const types = { '.css':'text/css', '.png':'image/png' };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const relative = path === '/styles.css' ? 'styles.css'
    : path === '/portal.css' ? 'portal.css'
      : path === '/estimates.css' ? 'tools/estimates.css'
        : path === '/image.png' ? 'image.png' : '';
  if (!relative) { response.writeHead(404).end(); return; }
  try {
    response.writeHead(200, { 'content-type': types[extname(relative)] || 'application/octet-stream' });
    response.end(await readFile(resolve(root, relative)));
  } catch { response.writeHead(404).end(); }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
try {
  browser = await chromium.launch({ headless:true, ...(existsSync(chromePath) ? { executablePath:chromePath } : {}) });
  const page = await browser.newPage();
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${base}/styles.css"><link rel="stylesheet" href="${base}/portal.css"><link rel="stylesheet" href="${base}/estimates.css"><main class="app-main estimate-main"><div class="estimate-layout"><form class="card estimate-form"><h2>Estimate details</h2><label>Estimate number<input value="GMT-EST-001"></label><label>Company<input value="Client company"></label></form><section class="card estimate-preview-panel"><h2>Estimate preview</h2><article class="estimate-paper"><header class="estimate-paper-header"><img class="estimate-paper-logo" src="${base}/image.png"><div class="estimate-paper-company"><p>GMT Electrical Services Ltd</p><p>93-95 Gloucester Rd</p></div></header><h2 class="estimate-paper-title">Estimate</h2><div class="estimate-paper-meta"><div><p><b>For the attention of:</b> Client contact</p><p><b>Company:</b> Client company</p><p>Re: Estimate</p></div><div><p><b>Date:</b> 2026-10-08</p><p><b>Estimate no:</b> GMT-EST-001</p></div></div><p>We thank you for your recent enquiry and are pleased to submit our estimate as follows.</p><table class="estimate-paper-table"><tbody><tr><td>No line items added.</td><td>Qty</td><td>Unit</td><td>Total</td></tr></tbody></table><p class="estimate-paper-terms">All works quoted are for normal working hours. This estimate is valid for 30 days.</p></article></section></div><section id="estimate-archive" class="card estimate-history-panel"><h2>Estimate emails and conversations</h2><div class="estimate-archive-layout"><div>Archive results</div><article class="estimate-archive-detail">Archive detail</article></div></section></main>`);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height:844 });
    const sizes = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      return {
        viewport:document.documentElement.clientWidth,
        document:document.documentElement.scrollWidth,
        main:rect('.estimate-main').width,
        preview:rect('.estimate-preview-panel').width,
        paper:rect('.estimate-paper').width,
        archive:rect('#estimate-archive').width
      };
    });
    assert.ok(sizes.document <= width + 1, `${width}px viewport must not scroll horizontally: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.main >= width - 2, `estimate page should use the mobile viewport: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.paper >= sizes.preview * 0.75, `document preview should fill its card: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.archive >= sizes.main * 0.9, `shared archive should use the mobile viewport: ${JSON.stringify(sizes)}`);
    if (width === 390) await page.screenshot({ path:'/tmp/gmt-estimate-mobile.png', fullPage:true });
  }
  console.log('Estimate page layout at 320, 390, and 430px: PASS');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
