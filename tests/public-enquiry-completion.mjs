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
const mockEndpoint = 'https://enquiry-test.invalid/submit';
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

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

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

async function submitEnquiry({ response, failNetwork = false }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const postedUrls = [];
  const realFormSubmitRequests = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url === mockEndpoint) {
      postedUrls.push(url);
      if (failNetwork) return route.abort();
      return route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body)
      });
    }
    if (url.startsWith('https://formsubmit.co/')) realFormSubmitRequests.push(url);
    return route.abort();
  });

  try {
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((endpoint) => {
      window.GMT_APP_CONFIG = window.GMT_APP_CONFIG || {};
      window.GMT_APP_CONFIG.contactFormSubmitEndpoint = endpoint;
    }, mockEndpoint);
    await page.locator('a[data-enquire-nav]').first().click();
    await page.locator('#workshop-enquiry-name').fill('GMT Internal Web Test');
    await page.locator('#workshop-enquiry-email').fill('internal-test@example.invalid');
    await page.locator('#workshop-enquiry-email-confirmation').fill('internal-test@example.invalid');
    await page.locator('#workshop-enquiry-message').fill('Synthetic enquiry used to verify the confirmation flow.');
    await page.waitForTimeout(1250);
    await page.locator('[data-workshop-enquiry-form] button[type="submit"]').click();
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-workshop-enquiry-status]');
      return status && status.textContent.trim() && status.textContent.trim() !== 'Sending your enquiry…';
    });
    await page.waitForTimeout(550);

    const state = await page.evaluate(() => {
      const form = document.querySelector('[data-workshop-enquiry-form]');
      const status = document.querySelector('[data-workshop-enquiry-status]');
      const modal = document.querySelector('[data-contact-modal]');
      return {
        formHidden: form.hidden,
        formAriaHidden: form.getAttribute('aria-hidden'),
        status: status.textContent.trim(),
        statusVisible: status.classList.contains('is-visible') && getComputedStyle(status).display !== 'none',
        liveRegion: status.getAttribute('aria-live'),
        confirmationTarget: location.hash === '#submission-received',
        dialogStillOpen: modal && !modal.hidden,
        submitDisabled: form.querySelector('button[type="submit"]').disabled
      };
    });
    return { ...state, postedUrls, realFormSubmitRequests };
  } finally {
    await page.close();
  }
}

try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

  const success = await submitEnquiry({ response: { status: 200, body: { success: 'true', message: 'Received' } } });
  assert.deepEqual(success.postedUrls, [mockEndpoint], 'the form posts only to the local test endpoint');
  assert.deepEqual(success.realFormSubmitRequests, [], 'the test never contacts the production FormSubmit endpoint');
  assert.match(success.status, /got your enquiry/i);
  assert.equal(success.formHidden, true, 'successful submission hides the form after confirmation is displayed');
  assert.equal(success.formAriaHidden, 'true');
  assert.equal(success.statusVisible, true);
  assert.equal(success.liveRegion, 'polite');
  assert.equal(success.confirmationTarget, true);
  assert.equal(success.dialogStillOpen, true, 'the confirmation remains visible inside the open dialog');
  assert.equal(success.submitDisabled, false);

  for (const providerFailureValue of [false, 'false']) {
    const providerFailure = await submitEnquiry({ response: { status: 200, body: { success: providerFailureValue, message: 'Rejected' } } });
    assert.deepEqual(providerFailure.postedUrls, [mockEndpoint]);
    assert.deepEqual(providerFailure.realFormSubmitRequests, []);
    assert.match(providerFailure.status, /could not send/i, 'an explicit provider failure must not show success');
    assert.equal(providerFailure.formHidden, false, 'the form remains available after a provider failure');
    assert.equal(providerFailure.submitDisabled, false, 'the visitor can retry after a provider failure');
    assert.equal(providerFailure.confirmationTarget, false);
  }

  const networkFailure = await submitEnquiry({ response: { status: 200, body: {} }, failNetwork: true });
  assert.deepEqual(networkFailure.postedUrls, [mockEndpoint]);
  assert.deepEqual(networkFailure.realFormSubmitRequests, []);
  assert.match(networkFailure.status, /could not send/i, 'a network failure must leave the visitor with retry guidance');
  assert.equal(networkFailure.formHidden, false);
  assert.equal(networkFailure.submitDisabled, false);

  console.log('Public enquiry success confirmation, explicit provider failure, network failure, retry availability, and mock-only routing: PASS');
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
