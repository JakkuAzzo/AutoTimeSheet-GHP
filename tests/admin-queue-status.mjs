import assert from 'node:assert/strict';
import { adminQueueStatus } from '../cloudflare-worker/src/index.js';

function mockDb(rows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      return { all: async () => ({ results: rows }) };
    }
  };
}

const rows = [
  { record_id: 'correction-1', employee_name: 'Michelle', record_date: '2026-09-12', status: 'queued', attempts: 0, queued_at: '2026-09-28T10:00:00Z', sent_at: '', updated_at: '2026-09-28T10:00:00Z', error: '' },
  { record_id: 'correction-2', employee_name: 'Simon', record_date: '2026-09-13', status: 'failed', attempts: 2, queued_at: '2026-09-28T09:00:00Z', sent_at: '', updated_at: '2026-09-28T09:30:00Z', error: 'Workbook route not certified' },
  { record_id: 'correction-3', employee_name: 'Ainsley', record_date: '2026-09-14', status: 'sent', attempts: 1, queued_at: '2026-09-28T08:00:00Z', sent_at: '2026-09-28T08:01:00Z', updated_at: '2026-09-28T08:01:00Z', error: '' }
];

const db = mockDb(rows);
const pending = await adminQueueStatus({ DB: db, FORM_SUBMIT_TIMESHEET_ENDPOINT: 'https://formsubmit.co/example', PAY_MONTH_REPLAY_READY: 'false' }, { isAdmin: true });
assert.equal(pending.providerStatus, 'awaiting-workbook-route');
assert.deepEqual(pending.counts, { queued: 1, sending: 0, failed: 1, sent: 1, skipped: 0 });
assert.equal(pending.records[1].error, 'Workbook route not certified');
assert.equal(pending.records[2].status, 'sent');
assert.equal('owner_upn' in pending.records[0], false, 'the read-only status response exposes no mailbox identity');
assert.equal(JSON.stringify(pending).includes('formsubmit.co'), false, 'provider endpoint details stay private');
assert.equal(db.calls.length, 1);

const unconfigured = await adminQueueStatus({ DB: mockDb([]) , PAY_MONTH_REPLAY_READY: 'true' }, { isAdmin: true });
assert.equal(unconfigured.providerStatus, 'not-configured');

const deniedDb = mockDb([]);
await assert.rejects(adminQueueStatus({ DB: deniedDb }, { isAdmin: false }), error => error.status === 403);
assert.equal(deniedDb.calls.length, 0, 'non-Accounts users cannot read the correction queue');
console.log('PASS: Accounts queue status reports provider readiness and queue errors without sending or mutating records.');
