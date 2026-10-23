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
const viewportMatrix = [[320, 568], [390, 844], [667, 375], [768, 1024], [1280, 720], [1440, 900]];
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

async function submitEnquiry({ response, failNetwork = false, viewport = { width: 1280, height: 800 }, reopenImmediatelyAfterSuccess = false, resubmitAfterReopen = false, retryAfterFailure = false }) {
  const page = await browser.newPage({ viewport });
  const postedUrls = [];
  const recordIds = [];
  const realFormSubmitRequests = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url === mockEndpoint) {
      postedUrls.push(url);
      const recordIdMatch = (route.request().postData() || '').match(/name="gmt_record_id"\r?\n\r?\n([^\r\n]+)/);
      if (recordIdMatch) recordIds.push(recordIdMatch[1].trim());
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
    if (reopenImmediatelyAfterSuccess) {
      await page.evaluate(() => {
        const form = document.querySelector('[data-workshop-enquiry-form]');
        const status = document.querySelector('[data-workshop-enquiry-status]');
        const readState = () => ({
          formHidden: form.hidden,
          formAriaHidden: form.getAttribute('aria-hidden'),
          formSubmitted: form.classList.contains('is-submitted'),
          enquiryRecordIdCached: form.dataset.enquiryRecordId || null,
          status: status.textContent.trim(),
          statusVisible: status.classList.contains('is-visible') && getComputedStyle(status).display !== 'none',
          dialogOpen: !document.querySelector('[data-contact-modal]').hidden
        });
        const observer = new MutationObserver(() => {
          if (!status.textContent.trim().startsWith('We’ve got your enquiry')) return;
          observer.disconnect();
          const completed = readState();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          document.querySelector('a[data-enquire-nav]').click();
          window.__publicEnquiryReopenRace = { completed, reopened: readState() };
        });
        observer.observe(status, { childList: true, characterData: true, subtree: true });
      });
    }
    await page.locator('[data-workshop-enquiry-form] button[type="submit"]').click();
    if (reopenImmediatelyAfterSuccess) {
      await page.waitForFunction(() => window.__publicEnquiryReopenRace);
      await page.waitForTimeout(520);
      const race = await page.evaluate(() => ({
        ...window.__publicEnquiryReopenRace,
        afterHideDelay: {
          formHidden: document.querySelector('[data-workshop-enquiry-form]').hidden,
          dialogOpen: !document.querySelector('[data-contact-modal]').hidden
        }
      }));
      if (resubmitAfterReopen) {
        await page.locator('#workshop-enquiry-name').fill('GMT Internal Web Test');
        await page.locator('#workshop-enquiry-email').fill('internal-test@example.invalid');
        await page.locator('#workshop-enquiry-email-confirmation').fill('internal-test@example.invalid');
        await page.locator('#workshop-enquiry-message').fill('A second synthetic enquiry after reopening.');
        await page.waitForTimeout(1250);
        await page.locator('[data-workshop-enquiry-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-workshop-enquiry-status]')?.textContent.includes('got your enquiry'));
      }
      return { ...race, postedUrls, recordIds, realFormSubmitRequests };
    }
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
        enquiryRecordIdCached: form.dataset.enquiryRecordId || null,
        liveRegion: status.getAttribute('aria-live'),
        confirmationTarget: location.hash === '#submission-received',
        dialogStillOpen: modal && !modal.hidden,
        submitDisabled: form.querySelector('button[type="submit"]').disabled
      };
    });
    if (state.confirmationTarget) {
      await page.setViewportSize({ width: 320, height: 568 });
      const statusLayout = await page.locator('[data-workshop-enquiry-status]').evaluate((status) => ({
        scrollHeight: status.scrollHeight,
        clientHeight: status.clientHeight
      }));
      await page.keyboard.press('Escape');
      await page.locator('a[data-enquire-nav]').first().click();
      await page.waitForFunction(() => !document.querySelector('[data-contact-modal]').hidden);
      const reopened = await page.evaluate(() => {
        const form = document.querySelector('[data-workshop-enquiry-form]');
        const status = document.querySelector('[data-workshop-enquiry-status]');
        return {
          formHidden: form.hidden,
          formAriaHidden: form.getAttribute('aria-hidden'),
          formSubmitted: form.classList.contains('is-submitted'),
          statusVisible: status.classList.contains('is-visible') && getComputedStyle(status).display !== 'none',
          status: status.textContent.trim()
        };
      });
      return { ...state, statusLayout, reopened, postedUrls, recordIds, realFormSubmitRequests };
    }
    if (retryAfterFailure) {
      const retryResponse = page.waitForResponse((networkResponse) => networkResponse.url() === mockEndpoint);
      await page.locator('[data-workshop-enquiry-form] button[type="submit"]').click();
      await retryResponse;
      await page.waitForFunction(() => !document.querySelector('[data-workshop-enquiry-form] button[type="submit"]').disabled);
    }
    return { ...state, postedUrls, recordIds, realFormSubmitRequests };
  } finally {
    await page.close();
  }
}

try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

  for (const [width, height] of viewportMatrix) {
    const viewport = { width, height };
    const success = await submitEnquiry({ response: { status: 200, body: { success: 'true', message: 'Received' } }, viewport });
    assert.deepEqual(success.postedUrls, [mockEndpoint], `${width}x${height}: the form posts only to the local test endpoint`);
    assert.deepEqual(success.realFormSubmitRequests, [], `${width}x${height}: the test never contacts the production FormSubmit endpoint`);
    assert.match(success.status, /got your enquiry/i, `${width}x${height}: successful response shows confirmation text`);
    assert.equal(success.formHidden, true, `${width}x${height}: success hides the form after confirmation is displayed`);
    assert.equal(success.formAriaHidden, 'true');
    assert.equal(success.statusVisible, true);
    assert.equal(success.liveRegion, 'polite');
    assert.equal(success.confirmationTarget, true);
    assert.equal(success.dialogStillOpen, true, `${width}x${height}: the confirmation remains in the open dialog`);
    assert.equal(success.submitDisabled, false);
    assert.equal(success.enquiryRecordIdCached, null, `${width}x${height}: successful submission clears the cached source ID`);
    assert.equal(success.recordIds.length, 1);
    assert.ok(success.statusLayout.scrollHeight <= success.statusLayout.clientHeight + 1, 'the full confirmation fits at 320px width');
    assert.equal(success.reopened.formHidden, false, 'reopening starts a fresh enquiry');
    assert.equal(success.reopened.formAriaHidden, null, 'the reopened form is exposed to assistive technology');
    assert.equal(success.reopened.formSubmitted, false, 'the reopened form no longer has completed styling');
    assert.equal(success.reopened.statusVisible, false, 'the old confirmation is cleared when a fresh enquiry opens');
    assert.equal(success.reopened.status, '');

    const providerFailure = await submitEnquiry({ response: { status: 200, body: { success: false, message: 'Rejected' } }, viewport, retryAfterFailure: true });
    assert.deepEqual(providerFailure.postedUrls, [mockEndpoint, mockEndpoint]);
    assert.deepEqual(providerFailure.realFormSubmitRequests, []);
    assert.match(providerFailure.status, /could not send/i, `${width}x${height}: provider failure shows retry guidance`);
    assert.equal(providerFailure.statusVisible, true);
    assert.equal(providerFailure.formHidden, false);
    assert.equal(providerFailure.submitDisabled, false);
    assert.equal(providerFailure.confirmationTarget, false);
    assert.equal(providerFailure.recordIds.length, 2);
    assert.ok(providerFailure.recordIds[0], `${width}x${height}: a source ID is attached to the first attempt`);
    assert.equal(providerFailure.recordIds[1], providerFailure.recordIds[0], `${width}x${height}: failed retry retains its source ID`);

    const networkFailure = await submitEnquiry({ response: { status: 200, body: {} }, failNetwork: true, viewport });
    assert.deepEqual(networkFailure.postedUrls, [mockEndpoint]);
    assert.deepEqual(networkFailure.realFormSubmitRequests, []);
    assert.match(networkFailure.status, /could not send/i, `${width}x${height}: network failure shows retry guidance`);
    assert.equal(networkFailure.statusVisible, true);
    assert.equal(networkFailure.formHidden, false);
    assert.equal(networkFailure.submitDisabled, false);
  }

  const delayedHide = await submitEnquiry({
    response: { status: 200, body: { success: 'true', message: 'Received' } },
    viewport: { width: 320, height: 568 },
    reopenImmediatelyAfterSuccess: true,
    resubmitAfterReopen: true
  });
  assert.deepEqual(delayedHide.postedUrls, [mockEndpoint, mockEndpoint]);
  assert.deepEqual(delayedHide.realFormSubmitRequests, []);
  assert.equal(delayedHide.recordIds.length, 2);
  assert.ok(delayedHide.recordIds[0]);
  assert.notEqual(delayedHide.recordIds[1], delayedHide.recordIds[0], 'a reopened successful enquiry receives a new source ID');
  assert.match(delayedHide.completed.status, /got your enquiry/i);
  assert.equal(delayedHide.completed.enquiryRecordIdCached, null);
  assert.equal(delayedHide.completed.formSubmitted, true);
  assert.equal(delayedHide.reopened.formHidden, false);
  assert.equal(delayedHide.reopened.formAriaHidden, null);
  assert.equal(delayedHide.reopened.formSubmitted, false);
  assert.equal(delayedHide.reopened.status, '');
  assert.equal(delayedHide.afterHideDelay.formHidden, false, 'a stale 480ms callback must not hide the freshly reopened form');
  assert.equal(delayedHide.afterHideDelay.dialogOpen, true);

  const stringProviderFailure = await submitEnquiry({ response: { status: 200, body: { success: 'false', message: 'Rejected' } } });
  assert.match(stringProviderFailure.status, /could not send/i, 'a string provider failure must not show success');
  assert.equal(stringProviderFailure.statusVisible, true);

  console.log(`Public enquiry success, failure retries, source-ID lifecycle, delayed-hide cancellation, visible feedback, and fresh re-open state across ${viewportMatrix.length} viewports: PASS (mock-only routing)`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
