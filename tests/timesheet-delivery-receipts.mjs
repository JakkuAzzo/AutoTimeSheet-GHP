import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker, { adminQueueStatus } from '../cloudflare-worker/src/index.js';
import { createTimesheetWorkbook, runRecordThroughOfficeScript } from './helpers/monthly-timesheet-office-script.mjs';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`CREATE TABLE records (
  record_id TEXT PRIMARY KEY, owner_oid TEXT NOT NULL, owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL,
  start_date TEXT, end_date TEXT, record_date TEXT, submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, issue TEXT, payload_json TEXT NOT NULL
);
CREATE TABLE record_attachments (
  record_id TEXT NOT NULL, field_name TEXT NOT NULL, file_name TEXT NOT NULL,
  content_type TEXT NOT NULL, content_base64 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (record_id, field_name),
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);
CREATE TABLE dispatch_queue (
  record_id TEXT PRIMARY KEY, status TEXT NOT NULL, queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL, last_sent_at TEXT, last_error TEXT,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);`);
db.exec(await readFile(new URL('../cloudflare-worker/migrations/0017_timesheet_delivery_receipts.sql', import.meta.url), 'utf8'));

const DB = {
  prepare(sql) {
    const statement = (args = []) => ({
      sql,
      args,
      bind(...values) { return statement(values); },
      first() { return db.prepare(sql).get(...args) || null; },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() { return { success: true, meta: db.prepare(sql).run(...args) }; }
    });
    return statement();
  }
};

const correctionId = 'qa-receipt-correction-20261026';
const rowDate = '2026-10-01';
const rowId = `${correctionId}|${rowDate}`;
const runId = 'qa-run-20261026-001';
const runStartedAt = '2026-10-26T10:00:00.000Z';
const correction = {
  mode: 'replace-pay-month',
  recordId: correctionId,
  rows: [{ recordId: rowId, date: rowDate }]
};

db.prepare(`INSERT INTO records
  (record_id, owner_oid, owner_upn, employee_name, kind, action, status, record_date, submitted_at, updated_at, payload_json)
  VALUES (?, 'qa-owner', 'qa@example.test', 'Synthetic QA', 'timesheets', 'pay_month_correction', 'Queued', ?, ?, ?, ?)`)
  .run(correctionId, rowDate, runStartedAt, runStartedAt, JSON.stringify({ rows: correction.rows }));
db.prepare(`INSERT INTO record_attachments
  (record_id, field_name, file_name, content_type, content_base64, size_bytes, created_at)
  VALUES (?, 'attachment_record', 'qa-correction.json', 'application/json', ?, ?, ?)`)
  .run(correctionId, Buffer.from(JSON.stringify(correction)).toString('base64'), Buffer.byteLength(JSON.stringify(correction)), runStartedAt);
db.prepare(`INSERT INTO dispatch_queue
  (record_id, status, queued_at, updated_at, attempts, next_attempt_at, last_sent_at, last_error)
  VALUES (?, 'sent', ?, ?, 1, ?, ?, '')`)
  .run(correctionId, runStartedAt, runStartedAt, runStartedAt, runStartedAt);

// Exercise the same Office Script used by Power Automate against an isolated
// in-memory workbook, then feed only its read-back evidence to the Worker.
const workbook = createTimesheetWorkbook('Synthetic QA', '2026-10');
const workbookResult = runRecordThroughOfficeScript(workbook, {
  employeeName: 'Synthetic QA',
  employeeEmail: 'qa@example.test',
  mode: 'replace-pay-month',
  recordId: correctionId,
  rows: [{
    recordId: rowId, date: rowDate, action: 'submission', status: 'Recorded',
    startTime: '08:00', finishTime: '16:30', workedHours: 8, basicHours: 8,
    ot15Hours: 0, ot20Hours: 0, location: 'QA workshop', note: 'Synthetic receipt integration test'
  }]
});
assert.deepEqual(workbookResult.verifiedRecordIds, [rowId]);
assert.deepEqual(workbookResult.verifiedRows, [{ recordId: rowId, date: rowDate }]);
assert.deepEqual(workbookResult.unverifiedRecordIds, []);

const env = { DB, TIMESHEET_DELIVERY_CALLBACK_KEY: 'qa-only-callback-key-that-is-never-used-in-production-20261026' };
const callback = async (payload, key = env.TIMESHEET_DELIVERY_CALLBACK_KEY) => worker.fetch(
  new Request('https://gmt-portal-api.test/api/integrations/timesheet-delivery-receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gmt-delivery-key': key },
    body: JSON.stringify(payload)
  }), env, {}
);
const body = async response => response.json();

assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_started' }, 'wrong-key')).status, 401,
  'invalid callback credentials are rejected');
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'workbook_verified', created: 1, updated: 0, unchanged: 0, verifiedRecordIds: [rowId], verifiedRows: [{ recordId: rowId, date: rowDate }] })).status, 409,
  'workbook confirmation cannot precede flow start');

const started = await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_started' });
assert.equal(started.status, 200);
assert.deepEqual(await body(started), { accepted: true });

const mismatched = await callback({
  recordId: correctionId, flowRunId: runId, runStartedAt, event: 'workbook_verified',
  created: 1, updated: 0, unchanged: 0,
  verifiedRecordIds: [`${correctionId}|2026-10-02`],
  verifiedRows: [{ recordId: `${correctionId}|2026-10-02`, date: '2026-10-02' }]
});
assert.equal(mismatched.status, 409, 'Worker rejects workbook proof that differs from the protected source dates');

const verifiedPayload = {
  recordId: correctionId, flowRunId: runId, runStartedAt, event: 'workbook_verified',
  created: workbookResult.created, updated: workbookResult.updated, unchanged: workbookResult.unchanged,
  verifiedRecordIds: workbookResult.verifiedRecordIds, verifiedRows: workbookResult.verifiedRows
};
assert.equal((await callback(verifiedPayload)).status, 200);
assert.equal((await callback(verifiedPayload)).status, 200, 'identical callback retries are idempotent');
assert.equal((await callback({ ...verifiedPayload, created: 0, unchanged: 1 })).status, 409,
  'changed evidence cannot replace an accepted receipt');

assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_completed' })).status, 200);
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_failed', stage: 'history_index', safeError: 'later failure' })).status, 409,
  'a completed run cannot subsequently be marked failed');
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_completed' })).status, 200,
  'a duplicate terminal receipt remains idempotent');

const receipts = db.prepare('SELECT event_type, evidence_json FROM timesheet_delivery_receipts WHERE record_id = ? ORDER BY event_type').all(correctionId);
assert.deepEqual(receipts.map(row => row.event_type), ['flow_completed', 'flow_started', 'workbook_verified']);
const queueBefore = db.prepare('SELECT status, attempts, last_sent_at FROM dispatch_queue WHERE record_id = ?').get(correctionId);
const recordBefore = db.prepare('SELECT status, payload_json FROM records WHERE record_id = ?').get(correctionId);
const queueStatus = await adminQueueStatus({ DB, FORM_SUBMIT_TIMESHEET_ENDPOINT: 'https://example.test/submit', PAY_MONTH_REPLAY_READY: 'false' }, { isAdmin: true });
assert.equal(queueStatus.records[0].recordId, correctionId);
assert.equal(queueStatus.records[0].deliveryReceipt.flowRunId, runId);
assert.equal(queueStatus.records[0].deliveryReceipt.events.flow_started.receivedAt.length > 0, true);
assert.equal(queueStatus.records[0].deliveryReceipt.events.workbook_verified.verifiedRowCount, 1);
assert.ok(queueStatus.records[0].deliveryReceipt.events.flow_completed);
await assert.rejects(adminQueueStatus({ DB }, { isAdmin: false }), error => error.status === 403);
assert.deepEqual(db.prepare('SELECT status, attempts, last_sent_at FROM dispatch_queue WHERE record_id = ?').get(correctionId), queueBefore,
  'receipt callbacks do not mutate dispatch or replay state');
assert.deepEqual(db.prepare('SELECT status, payload_json FROM records WHERE record_id = ?').get(correctionId), recordBefore,
  'receipt callbacks do not edit payroll source data');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM timesheet_delivery_receipts').get().count, 3);

console.log('PASS: synthetic Office Script read-back → authenticated Worker callbacks → append-only D1 receipts → Accounts queue status; source and dispatch records unchanged.');
