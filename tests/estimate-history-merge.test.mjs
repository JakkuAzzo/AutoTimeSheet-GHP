import assert from 'node:assert/strict';
import { mergeSharedEstimateIndex, normaliseHistoryRecord } from '../tools/estimate-history-data.mjs';
import { emailEstimatePortalRecordId } from '../cloudflare-worker/src/index.js';

const merged = mergeSharedEstimateIndex([
  {
    recordId: 'email-estimate:message-1',
    reconciliation: { source_message_key: 'email:<estimate-1@example.com>' },
    estimate_number: 'EST-1042',
    client_company: 'Artic Building Services Ltd',
    source_mailboxes: ['info@gmt-services.co.uk']
  }
], [
  {
    canonical_id: 'email:<estimate-1@example.com>',
    estimate_number: 'EST-1042',
    client: 'Artic Building Services Ltd',
    source_mailboxes: ['info@gmt-services.co.uk']
  },
  { canonical_id: 'estimate-app-2', estimate_number: 'EST-2042', client: 'Other Client' }
]);

assert.equal(merged.length, 2, 'the shared history and mail index surfaces merge into unique estimates');
const archived = merged.find((record) => record.canonical_id === 'email:<estimate-1@example.com>');
assert.ok(archived);
assert.equal(archived.recordId, 'email-estimate:message-1', 'the record API id remains available for detail and invoice links');
assert.equal(archived.source_record_id, 'email-estimate:message-1');
assert.equal(archived.client, 'Artic Building Services Ltd');
const normalized = normaliseHistoryRecord(archived);
assert.equal(normalized.recordId, 'email-estimate:message-1', 'normalisation must not replace the API record id with the canonical mail key');
assert.equal(normalized.canonicalId, 'email:<estimate-1@example.com>');
assert.equal(normalized.company, 'Artic Building Services Ltd');
assert.deepEqual(normalized.sourceMailboxes, ['info@gmt-services.co.uk']);

const projectionCanonicalId = 'email:<norton-estimate@example.com>';
const projectionRecordId = await emailEstimatePortalRecordId(projectionCanonicalId);
const projectionWithoutMessageKey = mergeSharedEstimateIndex([
  {
    source_record_id: projectionRecordId,
    estimate_number: 'EST-3001',
    client_company: 'Norton Group'
  }
], [
  {
    canonical_id: projectionCanonicalId,
    source_record_id: projectionRecordId,
    estimate_number: 'EST-3001',
    client: 'Norton Group'
  }
]);
assert.equal(projectionWithoutMessageKey.length, 1, 'the shared index crosswalk deduplicates history projections without raw message keys');
assert.equal(projectionWithoutMessageKey[0].recordId, projectionRecordId);
assert.equal(projectionWithoutMessageKey[0].canonical_id, projectionCanonicalId);

console.log('Estimate history merge and detail identity: PASS');
