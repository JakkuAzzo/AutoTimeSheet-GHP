import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const [page, ui, css] = await Promise.all([
  readFile(resolve(root, 'tools/invoices.html'), 'utf8'),
  readFile(resolve(root, 'tools/invoices.js'), 'utf8'),
  readFile(resolve(root, 'portal.css'), 'utf8')
]);

assert.match(page, /id="xero-invoice-search"/);
assert.match(page, /id="xero-invoice-customer"/);
assert.match(page, /id="xero-invoice-selected"/);
assert.match(page, /id="xero-record-search"/);
assert.match(ui, /function filterInvoiceRows/);
assert.match(ui, /data-xero-selected/);
assert.match(ui, /xero-invoice-links-chips/);
assert.match(css, /\.xero-invoice-workspace/);
assert.match(css, /@media[^{]*max-width/);

console.log('Invoice workspace UI contract: PASS');
