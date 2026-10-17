import assert from 'node:assert/strict';
import '../tools/invoice-register-state.js';

const state = globalThis.GMTInvoiceRegisterState;
assert.ok(state, 'the browser state helper is available to the test runtime');

const pages = [
  { archive: { source: 'sharepoint', cached_at: '2026-10-17T08:00:00.000Z', stored: true } },
  { archive: { source: 'xero', cached_at: '2026-10-17T09:00:00.000Z', stored: true }, refreshed_at: '2026-10-17T09:00:00.000Z' },
  { archive: { source: 'xero', cached_at: '', stored: false }, refreshed_at: '2026-10-17T10:00:00.000Z' }
];
const summary = state.summarizePages(pages);
assert.deepEqual(summary.source_counts, { sharepoint: 1, xero: 2, unarchived: 1 });
assert.deepEqual(summary.timestamps, {
  oldest_at: '2026-10-17T08:00:00.000Z',
  newest_at: '2026-10-17T10:00:00.000Z'
}, 'source timestamp summary preserves the exact oldest and newest page timestamps');

const storage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) || null; },
  setItem(key, value) { this.values.set(key, value); }
};
const saved = state.makeSnapshot('tenant-a', '2026-10-17T11:00:00.000Z', pages, [{ InvoiceID: 'inv-1' }], true);
assert.equal(state.save(storage, 'register', saved, 'tenant-a'), true);
assert.equal(state.load(storage, 'register', 'tenant-b'), null, 'a complete snapshot is bound to its tenant ID');
assert.equal(state.load(storage, 'register', 'tenant-a').tenant_id, 'tenant-a');

const partial = state.makeSnapshot('tenant-a', '2026-10-17T12:00:00.000Z', pages, [{ InvoiceID: 'partial' }], false);
assert.equal(state.save(storage, 'register', partial, 'tenant-a'), false, 'partial snapshots are rejected');
assert.deepEqual(state.load(storage, 'register', 'tenant-a'), saved, 'rejected partial data cannot replace the prior complete snapshot');

console.log('Xero invoice register snapshot state: PASS');
