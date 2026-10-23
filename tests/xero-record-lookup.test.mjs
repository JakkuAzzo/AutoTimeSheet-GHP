import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { xeroInvoiceRecords } from '../cloudflare-worker/src/index.js';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE records (
    record_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
    employee_name TEXT NOT NULL DEFAULT '', record_date TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
  );
  CREATE TABLE job_card_archive (
    record_id TEXT PRIMARY KEY, candidates_json TEXT NOT NULL DEFAULT '{}',
    confirmed_json TEXT NOT NULL DEFAULT '{}', review_state TEXT NOT NULL DEFAULT 'needs-review',
    source_file TEXT NOT NULL DEFAULT '', source_page INTEGER NOT NULL DEFAULT 1,
    ocr_text TEXT NOT NULL DEFAULT ''
  );
`);
for (let index = 0; index < 521; index += 1) {
  const recordId = index === 0 ? 'jobcard-archived-target' : `jobcard-recent-${String(index).padStart(4, '0')}`;
  const updatedAt = index === 0 ? '2020-01-01T00:00:00.000Z' : `2026-10-${String(17 - Math.floor(index / 48)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`;
  db.prepare(`INSERT INTO records (record_id, kind, status, record_date, payload_json, updated_at)
    VALUES (?, 'job-cards', 'Assigned', '2026-10-01', ?, ?)`)
    .run(recordId, JSON.stringify({ jobReference: index === 0 ? 'GMT-OLD-9042' : `GMT-${index}` }), updatedAt);
  if (index === 0) {
    db.prepare(`INSERT INTO job_card_archive
      (record_id, candidates_json, confirmed_json, review_state, source_file, source_page, ocr_text)
      VALUES (?, ?, ?, 'needs-review', 'MTA-archive.pdf', 8, 'equipment replacement invoice lookup needle')`)
      .run(recordId, JSON.stringify({ cardNumber: 'ARCHIVE-LOOKUP-42', customer: 'Legacy Client' }), JSON.stringify({}));
  }
}

const DB = {
  prepare(sql) {
    const statement = (values = []) => ({
      bind(...args) { return statement(args); },
      first() { return db.prepare(sql).get(...values) || null; },
      all() { return { results: db.prepare(sql).all(...values) }; },
      run() { return db.prepare(sql).run(...values); }
    });
    return statement();
  }
};
const env = { DB };
const admin = { isXeroAdmin: true };

const byOcr = await xeroInvoiceRecords(new Request('https://gmt.example/api/xero/records?q=lookup%20needle&limit=100&offset=0'), env, admin, '');
assert.equal(byOcr.status, 200);
const ocrResult = await byOcr.json();
assert.equal(ocrResult.records.length, 1, 'OCR search reaches the archive row beyond the newest 500 records');
assert.equal(ocrResult.records[0].record_id, 'jobcard-archived-target');
assert.equal(ocrResult.records[0].title, 'GMT-OLD-9042');
assert.equal(ocrResult.records[0].is_candidate, true, 'OCR-derived card numbers remain visibly unconfirmed candidates');

const byCandidate = await xeroInvoiceRecords(new Request('https://gmt.example/api/xero/records?q=ARCHIVE-LOOKUP-42'), env, admin, '');
assert.equal((await byCandidate.json()).records[0].record_id, 'jobcard-archived-target', 'candidate metadata is searchable');

const first = await (await xeroInvoiceRecords(new Request('https://gmt.example/api/xero/records?limit=100&offset=0'), env, admin, '')).json();
const second = await (await xeroInvoiceRecords(new Request('https://gmt.example/api/xero/records?limit=100&offset=100'), env, admin, '')).json();
assert.equal(first.records.length, 100);
assert.equal(first.pagination.has_more, true);
assert.equal(first.pagination.next_offset, 100);
assert.equal(second.pagination.next_offset, 200);
assert.equal(new Set([...first.records, ...second.records].map((record) => record.record_id)).size, 200,
  'offset pages do not repeat records');

await assert.rejects(
  () => xeroInvoiceRecords(new Request('https://gmt.example/api/xero/records'), env, { isXeroAdmin: false }, ''),
  (error) => error.status === 403,
  'record lookup remains protected by the Accounts administrator check'
);
db.close();
console.log('Xero searchable GMT record lookup: PASS');
