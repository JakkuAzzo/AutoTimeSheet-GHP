import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(join(repoRoot, 'package.json'));
const { chromium } = require('playwright');
const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png' };

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname === '/config.js') {
    response.writeHead(200, { 'content-type':'text/javascript' });
    response.end('window.GMT_APP_CONFIG={portalApiEndpoint:"https://worker.test",portalApiScopes:[]};');
    return;
  }
  if (url.pathname === '/auth.js') {
    response.writeHead(200, { 'content-type':'text/javascript' });
    response.end('document.querySelector("main").hidden=false;');
    return;
  }
  if (url.pathname === '/portal-api.js') {
    response.writeHead(200, { 'content-type':'text/javascript' });
    response.end(`window.GMTPortalApi={
      enabled(){return true},
      async searchEstimateArchive(filters){window.__filters=filters;return {records:[{id:"message-1",estimate_number:"EST-1",customer:"Client",sent_at:"2026-10-08T12:00:00Z",mailbox:"info@gmt-services.co.uk"}],nextCursor:null}},
      async getEstimateArchiveRecord(){return {message:{id:"message-1",source_kind:"email",subject:"Estimate EST-1",sender_email:"info@gmt-services.co.uk",sent_at:"2026-10-08T12:00:00Z",customer:"Client"},conversation:[{id:"message-1",subject:"Estimate EST-1",sender_email:"info@gmt-services.co.uk",sent_at:"2026-10-08T12:00:00Z",attachments:[]}],attachments:[],associations:[],sourceCopies:[]}},
      async fetchEstimateArchiveContent(){return new Blob(["From: info@gmt-services.co.uk\\r\\nContent-Type: text/plain; charset=UTF-8\\r\\nContent-Transfer-Encoding: quoted-printable\\r\\n\\r\\nHello client, =C3=A9<script>alert(1)</script>"])}
    };`);
    return;
  }
  const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, relative.replace(/^\//, '')));
  if (!filePath.startsWith(`${repoRoot}/`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type':mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/estimates.html`);
  await page.locator('[data-view-conversation]').waitFor();
  assert.equal(await page.locator('#estimate-archive-from').isEnabled(), true, 'From date is directly editable');
  assert.equal(await page.locator('#estimate-archive-to').isEnabled(), true, 'To date is directly editable');
  await page.locator('#estimate-archive-from').fill('2026-10-01');
  await page.locator('#estimate-archive-to').fill('2026-10-31');
  await page.locator('#estimate-archive-search button[type="submit"]').click();
  await page.waitForFunction(() => window.__filters?.from === '2026-10-01' && window.__filters?.to === '2026-10-31');
  await page.locator('[data-view-conversation]').click();
  assert.equal(await page.locator('#estimate-conversation-dialog').evaluate((dialog) => dialog.open), true, 'conversation opens in a browser dialog');
  await page.locator('[data-view-archive-message]').click();
  await page.waitForFunction(() => document.querySelector('#estimate-conversation-message-body')?.textContent.includes('Hello client'));
  const body = await page.locator('#estimate-conversation-message-body').innerText();
  assert.match(body, /Hello client, é<script>alert\(1\)<\/script>/, 'the archived email body is decoded and displayed as text');
  assert.equal(await page.locator('#estimate-conversation-message-body script').count(), 0, 'email markup remains inert in the portal');
  console.log('Estimate date filters and in-browser conversation viewer: PASS');
} finally {
  await browser.close();
  server.close();
}
