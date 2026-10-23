import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [page, ui, css] = await Promise.all([
  readFile(resolve(root, 'tools/invoices.html'), 'utf8'),
  readFile(resolve(root, 'tools/invoices.js'), 'utf8'),
  readFile(resolve(root, 'portal.css'), 'utf8')
]);
const [jobs, portal, estimates] = await Promise.all([
  readFile(resolve(root, 'jobs/index.html'), 'utf8'),
  readFile(resolve(root, 'portal.js'), 'utf8'),
  readFile(resolve(root, 'tools/estimates.js'), 'utf8')
]);

assert.match(page, /id="xero-invoice-search"/);
assert.match(page, /id="xero-invoice-customer"/);
assert.match(page, /id="xero-invoice-selected"/);
assert.match(page, /id="xero-invoice-preview"/);
assert.doesNotMatch(page, /4 · Tracking/);
assert.doesNotMatch(page, /xero-invoice-lookup/);
assert.doesNotMatch(page, /xero-status/);
assert.match(page, /id="xero-record-search"/);
assert.match(ui, /function filterInvoiceRows/);
assert.doesNotMatch(ui, /linkNewestInvoices|xero-invoice-link-newest/);
assert.doesNotMatch(page, /xero-invoice-link-newest|Link newest 10 exact matches/);
assert.match(ui, /data-xero-selected/);
assert.match(ui, /xero-invoice-links-chips/);
assert.match(ui, /sessionStorage/);
assert.match(ui, /invoiceNumber/);
assert.doesNotMatch(ui, /delivery_status.*payment_status/);
assert.match(css, /\.xero-invoice-workspace/);
assert.match(css, /@media[^{]*max-width/);
assert.match(jobs, /id="job-card-invoice-links"/);
assert.match(portal, /recordInvoiceLinks/);
assert.match(ui, /record\.title[\s\S]*OCR candidate/, 'invoice linking labels OCR-derived job-card names as candidates');
assert.match(ui, /record_title[\s\S]*OCR candidate/, 'invoice related-records avoid showing scanned job-card hashes as names');
assert.match(ui, /function searchRecordPage\(/, 'invoice record lookup uses remote search');
assert.match(ui, /xeroRecords\(normalized, 100, offset\)/, 'lookup requests are bounded and paginated');
assert.match(ui, /xero-record-load-more/, 'Accounts can continue beyond the initial record page');
assert.match(ui, /selectedRecordIds\(\)/, 'remote search retains selected record links');
assert.match(estimates, /No linked job card, estimate, or invoice record yet/);

console.log('Invoice workspace UI contract: PASS');
