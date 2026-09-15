import assert from 'node:assert/strict';
import { normaliseUpstreamRecord } from '../cloudflare-worker/src/index.js';

const directory = { STAFF_DIRECTORY_JSON: JSON.stringify([{ name: 'Matthew', upn: 'matthew@gmt-services.co.uk' }]) };
const attachment = [
  { recordId: 'week-matthew|2026-09-07', submissionId: 'week-matthew', date: '2026-09-07', startTime: '08:00', finishTime: '18:00', lunchHad: false, lunchMinutes: 0, workedHours: 10, basicHours: 10, absenceStatus: 'NA', note: 'No break', submittedAt: '2026-09-08T19:03:08.001Z' },
  { recordId: 'week-matthew|2026-09-08', submissionId: 'week-matthew', date: '2026-09-08', startTime: '08:00', finishTime: '18:00', workedHours: 9.5, basicHours: 9.5, note: 'Break: 30 minutes deducted' }
];
const encoded = Buffer.from(JSON.stringify(attachment), 'utf8').toString('base64');
const record = normaliseUpstreamRecord({
  Id: 17,
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Matthew | Week 2026-09-07',
  EmployeeName: 'Matthew',
  Issue: encoded,
  Modified: '2026-09-09T07:00:00Z'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, directory);

assert.equal(record.source_record_id, 'week-matthew');
assert.equal(record.submitted_at, '2026-09-08T19:03:08.001Z');
assert.equal(record.daily_rows_count, 2);
assert.deepEqual(record.daily_dates, ['2026-09-07', '2026-09-08']);
assert.equal(record.payload.rows[0].breakStatus, 'not-taken');
assert.equal(record.payload.rows[1].lunchMinutes, 30);
assert.equal(record.payload.rows[1].breakStatus, 'added');
assert.equal(record.issue, '');

const mismatchedWindow = normaliseUpstreamRecord({
  Id: 18,
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Matthew | Week 2026-09-07',
  EmployeeName: 'Matthew',
  Issue: JSON.stringify([
    { date: '2026-08-31', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-01', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-02', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-03', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-04', startTime: '08:00', finishTime: '17:00', workedHours: 8 }
  ]),
  Modified: '2026-09-09T07:00:00Z'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, directory);
assert.equal(mismatchedWindow.start_date, '2026-08-31');
assert.equal(mismatchedWindow.end_date, '2026-09-06');
assert.equal(mismatchedWindow.record_date, '2026-08-31');
assert.equal(mismatchedWindow.declared_start_date, '2026-09-07');
assert.match(mismatchedWindow.period_issue, /differs from daily rows 2026-08-31 to 2026-09-04/);
assert.match(mismatchedWindow.issue, /reporting uses the daily dates/);
console.log('Upstream daily attachment: base64 decoding, stable submission IDs, breaks and metadata: PASS');
