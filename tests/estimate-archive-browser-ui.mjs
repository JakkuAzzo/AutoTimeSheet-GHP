import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(join(repoRoot, 'package.json'));
const { chromium } = require('playwright');
const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png' };

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname === '/config.js') {
    response.writeHead(200, { 'content-type':'text/javascript' });
    response.end('window.GMT_APP_CONFIG={portalApiEndpoint:"https://worker.test",portalApiScopes:[],estimateAccountsBcc:"accounts@gmt-services.co.uk"};');
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
      async saveRecord(record){window.__workflowCalls.push({name:"saveRecord",payload:record});return {ok:true,record_id:record.recordId}},
      async updateRecord(recordId,record){window.__workflowCalls.push({name:"updateRecord",recordId,payload:record});return {ok:true}},
      async estimateIndexUpsert(estimate){window.__workflowCalls.push({name:"estimateIndexUpsert",payload:estimate});return {ok:true}},
      async archiveAppEstimate(payload){window.__workflowCalls.push({name:"archiveAppEstimate",payload});return {ok:true,id:"synthetic-archive-message",attachment_id:"synthetic-attachment"}},
      async sendEstimate(payload){window.__workflowCalls.push({name:"sendEstimate",payload});window.__sendStarted=true;return new Promise(resolve=>{window.__resolveSend=()=>resolve({ok:true,status:"Sent to client",sent_at:"2026-10-17T12:00:00.000Z"})})},
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
  await page.addInitScript(() => {
    window.__workflowCalls = [];
    window.confirm = (message) => { window.__confirmation = message; return true; };
  });
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
  await page.locator('#estimate-conversation-dialog').evaluate((dialog) => dialog.close());

  const fill = async (selector, value) => page.locator(selector).fill(value);
  await fill('#estimate-number', 'TEST-ESTIMATE-20261017-001');
  await fill('#estimate-attention', 'GMT Accounts synthetic test');
  await fill('#estimate-company', 'GMT Internal Test Only');
  await fill('#estimate-client-email', 'accounts@gmt-services.co.uk');
  await fill('#estimate-prepared-by', 'GMT Accounts synthetic test');
  await fill('#estimate-reference', 'SYNTHETIC INTERNAL TEST');
  await fill('#estimate-vat-rate', '20');
  await fill('#estimate-lines [data-line="description"]', 'Synthetic test service');
  await fill('#estimate-lines [data-line="quantity"]', '2');
  await fill('#estimate-lines [data-line="unit"]', '1.50');
  const previewState = await page.evaluate(() => ({
    number: document.querySelector('#estimate-number').value,
    vat: document.querySelector('#estimate-vat-rate').value,
    description: document.querySelector('#estimate-lines [data-line="description"]')?.value,
    quantity: document.querySelector('#estimate-lines [data-line="quantity"]')?.value,
    unit: document.querySelector('#estimate-lines [data-line="unit"]')?.value,
    total: document.querySelector('#estimate-preview .grand-total strong')?.textContent
  }));
  assert.equal(previewState.total.trim(), '£3.60', `preview recalculates the synthetic item, VAT and total: ${JSON.stringify(previewState)}`);
  await page.locator('#send-estimate').click();
  await page.waitForFunction(() => window.__sendStarted === true);
  const calls = await page.evaluate(() => window.__workflowCalls);
  const archiveIndex = calls.findIndex((call) => call.name === 'archiveAppEstimate');
  const sendIndex = calls.findIndex((call) => call.name === 'sendEstimate');
  assert.ok(archiveIndex >= 0 && sendIndex > archiveIndex, 'the protected archive is written before the send route is called');
  assert.match(await page.evaluate(() => window.__confirmation), /To: accounts@gmt-services\.co\.uk/);
  assert.match(await page.evaluate(() => window.__confirmation), /GMT Internal Test Only/);
  assert.match(await page.locator('#estimate-status').innerText(), /Sending through the approved Accounts mailbox/);
  assert.doesNotMatch(await page.locator('#estimate-status').innerText(), /Estimate sent/,
    'the UI does not claim success while the mocked delivery result is pending');
  const archivePayload = calls[archiveIndex].payload;
  assert.equal(archivePayload.customer_email, 'accounts@gmt-services.co.uk');
  assert.equal(archivePayload.source_record_id, calls.find((call) => call.name === 'saveRecord').payload.recordId);
  const document = Buffer.from(archivePayload.contentBase64, 'base64').toString('utf8');
  assert.match(document, /GMT Internal Test Only/);
  assert.match(document, /Synthetic test service/);
  const sendPayload = calls[sendIndex].payload;
  assert.equal(sendPayload.to, 'accounts@gmt-services.co.uk');
  assert.equal(sendPayload.estimate.total, 3.6);
  await page.evaluate(() => window.__resolveSend());
  await page.waitForFunction(() => document.querySelector('#estimate-status')?.textContent.includes('Estimate sent through the approved Accounts route'));
  const finalCalls = await page.evaluate(() => window.__workflowCalls.filter((call) => call.name === 'estimateIndexUpsert'));
  assert.deepEqual(finalCalls.map((call) => call.payload.correlation_status), ['unmatched', 'ready'],
    'the app estimate index moves from draft to confirmed after the send route succeeds');
  console.log('Estimate preview, archive-before-send, mail-index reconciliation and conversation viewer: PASS');
} finally {
  await browser.close();
  server.close();
}
