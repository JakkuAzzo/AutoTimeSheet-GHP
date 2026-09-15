import assert from 'node:assert/strict';
import { normaliseUpstreamRecord, projectRow } from '../cloudflare-worker/src/index.js';

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
assert.equal(mismatchedWindow.start_date, '2026-09-07');
assert.equal(mismatchedWindow.end_date, '2026-09-13');
assert.equal(mismatchedWindow.record_date, '2026-09-07');
assert.deepEqual(mismatchedWindow.daily_dates, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
assert.equal(mismatchedWindow.payload.rows[0].sourceDate, '2026-08-31');
assert.match(mismatchedWindow.issue, /aligned to the declared week 2026-09-07 to 2026-09-13/);

// Ainsley’s legacy email contained four files: two empty helper files and a
// useful XLSX/CSV pair whose rows were stamped with the preceding week. The
// declared week and row order are authoritative; preserve each raw date for
// audit while exposing the corrected dates to the calendar and pay-month view.
const ainsleyDirectory = {
  STAFF_DIRECTORY_JSON: JSON.stringify([{ name: 'Ainsley', upn: 'ainsley@gmt-services.co.uk' }])
};
const ainsleyRows = [
  { date: '2026-08-31', startTime: '07:00', finishTime: '17:00', lunchMinutes: 60, workedHours: 9 },
  { date: '2026-09-01', startTime: '07:00', finishTime: '17:00', lunchMinutes: 60, workedHours: 9 },
  { date: '2026-09-02', startTime: '07:00', finishTime: '17:00', lunchMinutes: 60, workedHours: 9 },
  { date: '2026-09-03', startTime: '07:00', finishTime: '17:00', lunchMinutes: 60, workedHours: 9 },
  { date: '2026-09-04', startTime: '07:00', finishTime: '17:00', lunchMinutes: 60, workedHours: 9 }
];
const ainsleyLegacy = normaliseUpstreamRecord({
  Id: 20,
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Ainsley | Week 2026-09-07',
  EmployeeName: 'Ainsley',
  WeekStart: '2026-09-07',
  WeekEnd: '2026-09-13',
  Issue: JSON.stringify({
    attachments: [
      { name: 'empty-helper.json', content: {} },
      { name: 'empty-calendar.json', content: { events: [] } },
      { name: 'GMT Timesheet - Ainsley - 2026-09-07.xlsx', content: { values: ainsleyRows } },
      { name: 'GMT Timesheet - Ainsley - 2026-09-07.csv', content: { values: ainsleyRows } }
    ]
  }),
  Modified: '2026-09-15T07:00:00Z'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, ainsleyDirectory);
assert.equal(ainsleyLegacy.daily_rows_count, 5);
assert.deepEqual(ainsleyLegacy.daily_dates, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
assert.equal(ainsleyLegacy.payload.rows[0].date, '2026-09-07');
assert.equal(ainsleyLegacy.payload.rows[0].sourceDate, '2026-08-31');
assert.equal(ainsleyLegacy.payload.rows[4].sourceDate, '2026-09-04');
assert.match(ainsleyLegacy.date_correction_issue, /aligned to the declared week 2026-09-07 to 2026-09-13/);

const ainsleyAugust = normaliseUpstreamRecord({
  Id: 21,
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Ainsley | Week 2026-08-24',
  EmployeeName: 'Ainsley',
  WeekStart: '2026-08-24',
  WeekEnd: '2026-08-30',
  Issue: JSON.stringify({ rows: [
    { date: '2026-08-24', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-07-28', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-07-29', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-07-30', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-07-31', startTime: '08:00', finishTime: '17:00', workedHours: 8 }
  ] }),
  Modified: '2026-09-15T07:00:00Z'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, ainsleyDirectory);
assert.deepEqual(ainsleyAugust.daily_dates, ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']);
assert.equal(ainsleyAugust.payload.rows[1].sourceDate, '2026-07-28');

const sparseSubmission = normaliseUpstreamRecord({
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Matthew | Week 2026-09-07',
  EmployeeName: 'Matthew',
  Modified: '2026-09-09T07:00:00Z'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, directory);
assert.match(sparseSubmission.source_record_id, /^history-timesheets-matthew-gmt-services-co-uk-2026-09-07-/);
assert.match(sparseSubmission.daily_detail_issue, /Daily rows were not returned/);
assert.match(sparseSubmission.issue, /times, breaks and totals are unavailable/);
const michelleDirectory = { STAFF_DIRECTORY_JSON: JSON.stringify([{ name: 'Michelle', upn: 'michelle@gmt-services.co.uk', workdays: [2, 3] }]) };
const nestedMichelle = normaliseUpstreamRecord({
  Id: 19,
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Michelle Reid | Week 2026-09-07',
  EmployeeName: 'Michelle Reid',
  Issue: JSON.stringify({ data: { values: [
    { date: '2026-09-07', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-08', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-09', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-10', startTime: '08:00', finishTime: '17:00', workedHours: 8 }
  ] } }),
  Modified: '2026-09-11T07:00:00Z'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, michelleDirectory);
assert.equal(nestedMichelle.daily_rows_count, 4);
assert.deepEqual(nestedMichelle.daily_dates, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
assert.deepEqual(nestedMichelle.schedule_weekdays, [2, 3]);
assert.equal(nestedMichelle.payload.rows.find((row) => row.date === '2026-09-07').scheduled, false);
assert.equal(nestedMichelle.payload.rows.find((row) => row.date === '2026-09-08').scheduled, true);

// Local D1 history must expose the same bounded daily payload as the upstream
// projection. This is the path used by the portal history/calendar endpoints.
const localAinsley = projectRow({
  kind: 'timesheets',
  employee_name: 'Ainsley',
  owner_upn: 'ainsley@gmt-services.co.uk',
  start_date: '2026-09-07',
  end_date: '2026-09-13',
  record_date: '2026-09-07',
  action: 'submission',
  status: 'Submitted',
  submitted_at: '2026-09-15T07:00:00Z',
  updated_at: '2026-09-15T07:00:00Z',
  record_id: 'timesheet-ainsley-2026-09-07',
  payload_json: JSON.stringify({ rows: ainsleyRows })
}, true, ainsleyDirectory);
assert.equal(localAinsley.daily_rows_count, 5);
assert.deepEqual(localAinsley.daily_dates, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
assert.equal(localAinsley.payload.rows[0].date, '2026-09-07');
assert.equal(localAinsley.payload.rows[0].sourceDate, '2026-08-31');
assert.match(localAinsley.date_correction_issue, /aligned to the declared week 2026-09-07 to 2026-09-13/);
console.log('Upstream daily attachment: base64 decoding, stable submission IDs, breaks and metadata: PASS');
