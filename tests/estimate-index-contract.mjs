import assert from 'node:assert/strict';
import { createEstimateIndexStore, canonicalEstimateInput, correlateEstimateRecords } from '../cloudflare-worker/src/estimate-index.js';

const rows = [];
const db = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('outlook_message_id')) return rows.find((row) => row.outlook_message_id === args[0]) || null;
            if (sql.includes('canonical_id')) return rows.find((row) => row.canonical_id === args[0]) || null;
            return null;
          },
          async all() { return { results: rows.slice() }; },
          async run() { return { success: true }; }
        };
      }
    };
  }
};

const store = createEstimateIndexStore(db);
const first = canonicalEstimateInput({ canonical_id: 'estimate-artic-001', estimate_number: 'EST-001', number_aliases: [], client: 'Artic Building Services Ltd', source: 'email', outlook_message_id: 'msg-1', outlook_url: 'https://outlook.office.com/mail/id/msg-1' });
assert.equal(first.canonical_id, 'estimate-artic-001');
assert.deepEqual(first.number_aliases, []);
assert.equal(first.source, 'email');

const saved = await store.upsert(first);
assert.equal(saved.canonical_id, 'estimate-artic-001');
const replay = await store.upsert({ ...first, number_aliases: ['EST-001-R1'] });
assert.equal(replay.canonical_id, 'estimate-artic-001');
assert.deepEqual(replay.number_aliases, ['EST-001-R1']);

assert.throws(() => canonicalEstimateInput({ canonical_id: '', source: 'email' }), /canonical_id/);
assert.deepEqual(correlateEstimateRecords([
  { canonical_id: 'estimate-artic-001', estimate_number: 'EST-001', number_aliases: ['EST-001-R1'], client: 'Artic Building Services Ltd' }
], { invoice_number: 'SI-100', reference: 'EST-001-R1', contact_name: 'Artic Building Services Ltd' }, []), {
  matches: [{ canonical_id: 'estimate-artic-001', rule: 'estimate-number-alias' }],
  candidates: [],
  explanation: 'Matched by estimate-number-alias'
});
console.log('Estimate index contract: PASS');
