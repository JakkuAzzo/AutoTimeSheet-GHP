import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../tools/invoice-order.js', import.meta.url), 'utf8');
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const newestFirst = context.globalThis.GMTInvoiceOrder.newestFirst;
const selectNewest = context.globalThis.GMTInvoiceOrder.selectNewest;
const invoices = [
  { invoice_id: 'old', date: '2020-03-24T00:00:00' },
  { invoice_id: 'newer', date: '2026-10-11T00:00:00' },
  { invoice_id: 'middle', date: '2024-02-13T00:00:00' },
  { invoice_id: 'same-b', date: '2026-10-11T00:00:00' },
  { invoice_id: 'missing', date: '' }
];
const sorted = newestFirst(invoices);
assert.deepEqual(Array.from(sorted, (invoice) => invoice.invoice_id), ['newer', 'same-b', 'middle', 'old', 'missing']);
assert.deepEqual(invoices.map((invoice) => invoice.invoice_id), ['old', 'newer', 'middle', 'same-b', 'missing'], 'sorting must not mutate the source cache');
assert.deepEqual(Array.from(selectNewest(invoices, 2), (invoice) => invoice.invoice_id), ['newer', 'same-b'], 'batch selection must take the newest records first');
assert.deepEqual(Array.from(selectNewest(invoices, 0), (invoice) => invoice.invoice_id), [], 'zero-sized batches must be empty');
console.log('Xero newest invoice ordering: PASS');
