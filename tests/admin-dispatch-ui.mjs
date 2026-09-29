import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.setContent('<main><p id="submissions-status"></p><button id="submissions-refresh"></button><button id="submissions-delivery-trigger" hidden>Correction delivery status</button><dialog id="submissions-delivery-dialog"><button type="button" data-delivery-close>Close</button><div id="submissions-delivery-details"></div></dialog><select id="submissions-pay-month"><option value=""></option></select><div id="submissions-employee-filter"><select id="submissions-employee"><option value=""></option></select></div><div id="pay-month-list-title"></div><div id="pay-month-list-count"></div><p data-pay-month-list-kicker></p><div id="submissions-list"></div><button id="download-all-sheets" hidden>Download All Sheets</button><span id="download-all-sheets-status"></span><article id="submissions-preview"></article></main>');
  await page.addStyleTag({ path: resolve(root, 'portal.css') });
  await page.evaluate(() => {
    window.testAdmin = false;
    window.dispatchCalls = 0;
    window.statusCalls = 0;
    window.historyCalls = 0;
    window.GMTPortalApi = {
      enabled: () => true,
      history: async () => {
        window.historyCalls += 1;
        return { records: [
          { record_id: 'waiting', kind: 'timesheets', employee_name: 'Michelle', employee_upn: 'michelle@gmt-services.co.uk', record_date: '2026-09-07', payload: { rows: [{ date: '2026-09-07', start: '08:00', finish: '17:00', breakMinutes: 0 }] }, dispatch: { status: 'queued', attempts: 0, queued_at: '2026-09-28T10:00:00Z', error: '' } },
          { record_id: 'failed', kind: 'timesheets', employee_name: 'Simon', employee_upn: 'simon@gmt-services.co.uk', record_date: '2026-09-08', payload: { rows: [{ date: '2026-09-08', start: '08:00', finish: '17:00', breakMinutes: 0 }] }, dispatch: { status: 'failed', attempts: 2, queued_at: '2026-09-28T09:00:00Z', error: 'Workbook route not certified' } },
          { record_id: 'sent', kind: 'timesheets', employee_name: 'Ainsley', employee_upn: 'ainsley@gmt-services.co.uk', record_date: '2026-09-09', payload: { rows: [{ date: '2026-09-09', start: '08:00', finish: '17:00', breakMinutes: 0 }] }, dispatch: { status: 'sent', attempts: 1, sent_at: '2026-09-28T08:00:00Z', error: '' } }
        ], meta: { is_admin: window.testAdmin, editable_pay_months: ['2026-09', '2026-10'] } };
      },
      correctionQueueStatus: async () => {
        window.statusCalls += 1;
        return {
          providerStatus: 'awaiting-workbook-route',
          counts: { queued: 1, sending: 0, failed: 1, sent: 1, skipped: 0 },
          records: [
            { employeeName: 'Michelle', date: '2026-09-07', status: 'queued', attempts: 0 },
            { employeeName: 'Simon', date: '2026-09-08', status: 'failed', attempts: 2, error: 'Workbook route not certified' },
            { employeeName: 'Ainsley', date: '2026-09-09', status: 'sent', attempts: 1 }
          ]
        };
      },
      dispatchCorrections: async () => {
        window.dispatchCalls += 1;
        return window.dispatchCalls === 1
          ? { sent: 3, failed: 0, skipped: 0 }
          : { status: 'rate-limited', failed: 1, deferred: 2, retryAt: '2026-09-27T16:30:00.000Z' };
      }
    };
  });
  await page.addScriptTag({ path: resolve(root, 'pay-periods.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/pay-month-workbook.js') });
  await page.addScriptTag({ path: resolve(root, 'portal/zip-store.js') });
  await page.evaluate(() => {
    window.XLSX = {
      utils: {
        book_new: () => ({ entries: [] }),
        aoa_to_sheet: matrix => ({ matrix }),
        book_append_sheet: (workbook, sheet, name) => workbook.entries.push({ name, matrix: sheet.matrix }),
        encode_cell: cell => String.fromCharCode(65 + cell.c) + (cell.r + 1)
      },
      write: workbook => new TextEncoder().encode(JSON.stringify(workbook.entries))
    };
    window.ensureXlsxLoaded = async () => window.XLSX;
  });
  await page.addScriptTag({ path: resolve(root, 'portal/submissions.js') });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(() => document.querySelector('#submissions-status').textContent.includes('Showing 3 submitted documents'));
  assert.equal(await page.locator('#submissions-delivery-trigger').isVisible(), false, 'staff cannot see Accounts queue status');
  await page.evaluate(() => { window.testAdmin = true; });
  await page.locator('#submissions-refresh').click();
  await page.waitForFunction(() => document.querySelector('#submissions-delivery-trigger').hidden === false);
  assert.equal(await page.locator('#submissions-delivery-trigger').isVisible(), true);
  assert.match(await page.locator('#submissions-delivery-trigger').innerText(), /1 queued.*1 failed/i);
  assert.equal(await page.locator('#submissions-pay-month option[value="2026-09"]').innerText(), 'September 2026');
  assert.equal(await page.locator('#submissions-pay-month option[value="2026-10"]').innerText(), 'Current - October 2026');
  await page.locator('#submissions-delivery-trigger').click();
  await page.waitForFunction(() => window.statusCalls === 1);
  assert.equal(await page.locator('#submissions-delivery-dialog').isVisible(), true);
  assert.match(await page.locator('#submissions-delivery-details').innerText(), /Michelle/);
  assert.match(await page.locator('#submissions-delivery-details').innerText(), /Simon/);
  assert.match(await page.locator('#submissions-delivery-details').innerText(), /Workbook route not certified/);
  assert.match(await page.locator('#submissions-delivery-details').innerText(), /does not confirm.*SharePoint/i);
  assert.equal(await page.evaluate(() => window.dispatchCalls), 0, 'opening status never retries or sends corrections');
  assert.equal(await page.evaluate(() => window.statusCalls), 1, 'opening the status dialog makes one read-only status request');
  await page.locator('[data-delivery-close]').click();
  assert.equal(await page.locator('#submissions-delivery-dialog').isVisible(), false);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-all-sheets').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'GMT Timesheets - 2026-09.zip');
  const folder = mkdtempSync(join(tmpdir(), 'gmt-all-sheets-ui-'));
  try {
    const archivePath = join(folder, download.suggestedFilename());
    await download.saveAs(archivePath);
    const listing = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(listing.length, 3, 'one workbook is included for each authorised employee sheet in the selected pay month');
    assert.ok(listing.some(name => name.includes('Michelle')));
    assert.ok(listing.some(name => name.includes('Simon')));
    assert.ok(listing.some(name => name.includes('Ainsley')));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}

console.log('PASS: correction status is Accounts-only and read-only, pay-month labels are clear, and all visible employee sheets download together.');
