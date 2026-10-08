import assert from 'node:assert/strict';
import worker, { canAccessRecord, canViewRecord, listEstimateIndex, listRecords } from '../cloudflare-worker/src/index.js';
import { createEstimateIndexStore, canonicalEstimateInput, correlateEstimateRecords } from '../cloudflare-worker/src/estimate-index.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const workerSource = await readFile(resolve(new URL('..', import.meta.url).pathname, 'cloudflare-worker/src/index.js'), 'utf8');

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
const mailboxCopy = canonicalEstimateInput({ canonical_id: 'email:<one@outlook.example>', source: 'email', mailbox: 'accounts@gmt-services.co.uk', outlook_message_id: 'accounts-local-id', internet_message_id: '<one@outlook.example>' });
assert.equal(mailboxCopy.mailbox, 'accounts@gmt-services.co.uk');
assert.equal(mailboxCopy.internet_message_id, '<one@outlook.example>');

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
assert.match(workerSource, /estimateIndexUpsertEndpoint/);
assert.match(workerSource, /estimateIndexListEndpoint/);
assert.match(workerSource, /\/api\/estimates\/index/);
const staffIdentity = { oid: 'staff-oid', upn: 'staff@gmt-services.co.uk', isAdmin: false, isOperationsAdmin: false, isJobCardAdmin: false };
assert.equal((await worker.fetch(new Request('https://gmt-portal-api.example.workers.dev/api/estimates/index', { method: 'GET', headers: { authorization: 'Bearer invalid' } }), { DB: db }, {})).status, 401);
await assert.doesNotReject(() => listEstimateIndex({ DB: db }, staffIdentity), 'authenticated staff identities can read the shared estimate index');
assert.equal(canViewRecord(staffIdentity, { kind: 'estimates', owner_oid: 'other-oid' }), true);
assert.equal(canViewRecord(staffIdentity, { kind: 'job-cards', owner_oid: 'other-oid' }), true);
assert.equal(canViewRecord(staffIdentity, { kind: 'timesheets', owner_oid: 'other-oid' }), false);
assert.equal(canAccessRecord(staffIdentity, { kind: 'job-cards', owner_oid: 'other-oid' }), false, 'shared read access does not grant edit access');
let listingSql = '';
const listDb = { prepare(sql) { listingSql = sql; return { bind() { return { async all() { return { results: [] }; } }; } }; } };
await listRecords(new Request('https://gmt-portal-api.example.workers.dev/api/records'), { DB: listDb }, staffIdentity);
assert.match(listingSql, /r\.kind IN \('estimates', 'job-cards', 'conversations', 'email-conversations'\)/, 'staff history includes shared business records alongside owned records');
const ambiguous = correlateEstimateRecords([
  { canonical_id: 'a', client: 'Artic Building Services Ltd' },
  { canonical_id: 'b', client: 'Artic Building Services Ltd' }
], { contact_name: 'Artic Building Services Ltd' }, []);
assert.equal(ambiguous.matches.length, 0);
assert.equal(ambiguous.candidates.length, 2);
const singleClientOnly = correlateEstimateRecords([
  { canonical_id: 'client-only', client: 'Artic Building Services Ltd' }
], { contact_name: 'Artic Building Services Ltd' }, []);
assert.equal(singleClientOnly.matches.length, 0, 'customer name alone never confirms an estimate link');
assert.deepEqual(singleClientOnly.candidates, [{ canonical_id: 'client-only', rule: 'client' }]);
assert.match(singleClientOnly.explanation, /review/i);

const archiveEnv = {
  ARCHIVE_INGEST_KEY: 'legacy-key-must-not-authorize-estimate-mail',
  ESTIMATE_MAIL_INGEST_KEY: 'test-only-estimate-mail-key',
  DB: {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() { return null; },
            async all() { return { results: [] }; },
            async run() { return { success: true }; }
          };
        }
      };
    }
  }
};
const archiveUrl = 'https://gmt-portal-api.example.workers.dev/api/archive/sync/estimates';
const archivePayload = {
  mailbox: 'info@gmt-services.co.uk',
  outlook_message_id: 'outlook-message-123',
  estimate_number: 'EST-2026-123',
  client: 'Artic Building Services Ltd',
  sharepoint_eml_item_id: 'sharepoint-eml-123',
  outlook_url: 'https://outlook.office.com/mail/id/outlook-message-123',
  sharepoint_url: 'https://gmtelectservsltd.sharepoint.com/sites/GMTWeb-App/Shared%20Documents/Estimates/quote.pdf'
};
const unauthorizedArchive = await worker.fetch(new Request(archiveUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(archivePayload) }), archiveEnv, {});
assert.equal(unauthorizedArchive.status, 401, 'the archive ingest endpoint rejects callers without the dedicated key');
const legacyKeyArchive = await worker.fetch(new Request(archiveUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': archiveEnv.ARCHIVE_INGEST_KEY }, body: JSON.stringify(archivePayload) }), archiveEnv, {});
assert.equal(legacyKeyArchive.status, 401, 'the legacy archive key does not authorize estimate mail ingestion');
const wrongMailboxArchive = await worker.fetch(new Request(archiveUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': archiveEnv.ESTIMATE_MAIL_INGEST_KEY }, body: JSON.stringify({ ...archivePayload, mailbox: 'other@example.com' }) }), archiveEnv, {});
assert.equal(wrongMailboxArchive.status, 403, 'the archive ingest endpoint rejects unapproved mailboxes');
for (const mailbox of ['info@gmt-services.co.uk', 'accounts@gmt-services.co.uk']) {
  const acceptedArchive = await worker.fetch(new Request(archiveUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': archiveEnv.ESTIMATE_MAIL_INGEST_KEY }, body: JSON.stringify({ ...archivePayload, mailbox, outlook_message_id: `message-${mailbox}`, internet_message_id: '<same-message@outlook.example>' }) }), archiveEnv, {});
  assert.equal(acceptedArchive.status, 200, `the approved mail archive payload is accepted for ${mailbox}`);
  const acceptedBody = await acceptedArchive.json();
  assert.equal(acceptedBody.estimate.canonical_id, 'email:<same-message@outlook.example>', 'duplicate copies across approved mailboxes share a canonical ID');
  assert.equal(acceptedBody.estimate.mailbox, mailbox, 'the index retains the source mailbox for distinguishing copies');
}
const excludedPersonalMailbox = await worker.fetch(new Request(archiveUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GMT-Archive-Key': archiveEnv.ESTIMATE_MAIL_INGEST_KEY }, body: JSON.stringify({ ...archivePayload, mailbox: 'acc.gmtelect@outlook.com' }) }), archiveEnv, {});
assert.equal(excludedPersonalMailbox.status, 403, 'the archive ingest endpoint excludes the inaccessible Outlook.com mailbox');
console.log('Estimate index contract: PASS');
