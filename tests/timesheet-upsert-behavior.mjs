import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../power-platform/office-scripts/upsert-monthly-timesheet-row.ts', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(source), context);

function workbook(employee) {
  const sheets = {};
  function makeSheet(name) {
    const rows = [];
    const fills = {};
    const columnIndex = letters => [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const sheet = { rows, fills,
    getRange(address) {
      const [, firstColumn, start, lastColumn, end] = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address);
      const first = columnIndex(firstColumn);
      const width = columnIndex(lastColumn) - first + 1;
      return {
        setNumberFormat() {},
        getFormat: () => ({ getFill: () => ({ setColor: color => { fills[address] = color; } }), getFont: () => ({ setBold() {} }), setColumnWidth() {}, setWrapText() {}, autofitRows() {} }),
        setValues(values) {
          values.forEach((row, i) => {
            assert.equal(row.length, width, `width for ${address}`);
            const target = rows[Number(start) - 1 + i] ||= [];
            row.forEach((value, j) => { target[first + j] = value; });
          });
        },
        getValues() {
          return Array.from({ length: Number(end) - Number(start) + 1 }, (_, i) => Array.from({ length: width }, (_, j) => rows[Number(start) - 1 + i]?.[first + j] ?? ''));
        }
      };
    },
    getUsedRange(valuesOnly) {
      assert.equal(valuesOnly, true, 'ignore formatting-only rows');
      return { getRowIndex: () => 0, getRowCount: () => rows.length };
    }
    };
    sheets[name] = sheet;
    return sheet;
  }
  const main = makeSheet('Timesheet Events');
  return { rows: main.rows, sheets, getName: () => `GMT Timesheet - ${employee} - 2026-09.xlsx`, getWorksheet: name => sheets[name], addWorksheet: makeSheet };
}

const simon = workbook('Simon');
const jason = workbook('Jason');
const submit = (book, records) => JSON.parse(JSON.stringify(context.main(book, JSON.stringify(records))));
const submitPayload = (book, payload) => JSON.parse(JSON.stringify(context.main(book, payload)));
const record = (employeeName, recordId, action, workedHours) => ({ employeeName, recordId, action, workedHours, status: 'Submitted', date: '2026-09-01' });

function assertMissingSourceIdRejected(book, payload, source) {
  assert.throws(
    () => context.main(book, payload),
    /original source record ID/,
    `${source} without an original source ID must not be used for workbook reconciliation`
  );
  assert.equal(book.rows.length, 0, `${source} without an original source ID must not write workbook rows`);
}

const missingFormId = workbook('Jason');
assertMissingSourceIdRejected(missingFormId, [
  'gmt_employee: Jason',
  'email: jason@gmt-services.co.uk',
  'gmt_action: clock_in',
  'gmt_clock_date: 2026-09-01',
  'gmt_clock_time: 08:00'
].join('\n'), 'FormSubmit body');

const missingCsvId = workbook('Jason');
assertMissingSourceIdRejected(missingCsvId, [
  'GMT Timesheet - Jason - 2026-09-01.csv',
  'Employee email,Week start,Week end,Date,Action,Status,Absence reason,Start,Lunch start,Lunch end,Finish,Worked hours,Basic hours,OT x1.5 hours,OT x2.0 hours',
  'jason@gmt-services.co.uk,2026-09-01,2026-09-07,2026-09-01,submission,Recorded,,08:00,12:00,12:30,17:00,8,8,0,0'
].join('\n'), 'CSV attachment');

const missingCalendarId = workbook('Jason');
assertMissingSourceIdRejected(missingCalendarId, JSON.stringify({
  employeeName: 'Jason',
  employeeEmail: 'jason@gmt-services.co.uk',
  weekStart: '2026-09-01',
  events: [{ startDate: '2026-09-01', syncEventId: 'event-1' }]
}), 'calendar-sync payload');

const missingRowId = workbook('Jason');
assertMissingSourceIdRejected(missingRowId, JSON.stringify({
  employeeName: 'Jason',
  employeeEmail: 'jason@gmt-services.co.uk',
  weekStart: '2026-09-01',
  rows: [{ date: '2026-09-01', action: 'submission', workedHours: 8 }]
}), 'row envelope');

const producerStyleWeeklyCsv = [
  'GMT Timesheet - Jason - Pay Month 2026-09 - Week 2026-09-01.csv',
  'Employee,Employee email,Status,Category,Pay month,Week start,Week end,Day,Date,Weekday,Start,Finish,Break,Absence reason,Worked hours,Basic hours,OT x1.5 hours,OT x2.0 hours,Weighted hours,Note,Source record ID',
  'Jason,jason@gmt-services.co.uk,Recorded,Basic day,2026-09,2026-08-31,2026-09-06,Day 1,2026-09-01,Tuesday,08:00,17:00,No break,NA,8,8,0,0,8,,weekly-source|2026-09-01'
].join('\n');
const weeklyCsvBook = workbook('Jason');
assert.equal(submitPayload(weeklyCsvBook, producerStyleWeeklyCsv).created, 1,
  'weekly producer CSV columns parse through the monthly upsert');
assert.equal(weeklyCsvBook.rows[1][0], 'Jason');
assert.equal(weeklyCsvBook.rows[1][19], 'weekly-source|2026-09-01');

const producerStyleClockCsv = [
  'GMT Clock - Jason - Pay Month 2026-09 - 2026-09-01 - Clock In.csv',
  'Employee,Employee email,Status,Category,Action,Week start,Week end,Day,Date,Weekday,Start,Finish,Lunch start,Lunch end,Absence reason,Location / site,Worked hours,Basic hours,OT x1.5 hours,OT x2.0 hours,Weighted hours,Note,Source record ID',
  'Jason,jason@gmt-services.co.uk,Recorded,Clock In,clock_in,2026-09-01,2026-09-01,Clock In,2026-09-01,Tuesday,08:15,,,,NA,Workshop,0,0,0,0,0,Clock In timestamp only,clock-jason-2026-09-01-clock_in-08-15'
].join('\n');
const clockCsvBook = workbook('Jason');
assert.equal(submitPayload(clockCsvBook, producerStyleClockCsv).created, 1,
  'clock producer CSV columns parse through the monthly upsert');
assert.equal(clockCsvBook.rows[1][5], 'clock_in', 'clock CSV preserves its event action');
assert.equal(clockCsvBook.rows[1][19], 'clock-jason-2026-09-01-clock_in-08-15');

const sourcedForm = workbook('Jason');
context.main(sourcedForm, [
  'gmt_record_id: source-clock-20260901',
  'gmt_employee: Jason',
  'email: jason@gmt-services.co.uk',
  'gmt_action: clock_in',
  'gmt_clock_date: 2026-09-01',
  'gmt_clock_time: 08:00'
].join('\n'));
assert.equal(sourcedForm.rows[1][19], 'source-clock-20260901', 'FormSubmit preserves the original clock submission ID');

const sourcedCalendar = workbook('Jason');
context.main(sourcedCalendar, JSON.stringify({
  employeeName: 'Jason',
  employeeEmail: 'jason@gmt-services.co.uk',
  submissionId: 'source-week-20260901',
  events: [{ startDate: '2026-09-01', syncEventId: 'calendar-event-1' }]
}));
assert.equal(sourcedCalendar.rows[1][19], 'source-week-20260901|2026-09-01',
  'calendar rows derive their stable row key only from the original submission ID and date');

const sourcedCalendarByRecordId = workbook('Jason');
context.main(sourcedCalendarByRecordId, JSON.stringify({
  employeeName: 'Jason',
  employeeEmail: 'jason@gmt-services.co.uk',
  recordId: 'calendar-source-20260901',
  events: [{ startDate: '2026-09-01', syncEventId: 'calendar-event-record-id' }]
}));
assert.equal(sourcedCalendarByRecordId.rows[1][19], 'calendar-source-20260901|2026-09-01',
  'calendar event envelopes accept recordId as their original source ID');

const sourcedRows = workbook('Jason');
context.main(sourcedRows, JSON.stringify({
  employeeName: 'Jason',
  employeeEmail: 'jason@gmt-services.co.uk',
  submissionId: 'source-week-20260902',
  rows: [{ date: '2026-09-01', action: 'submission', workedHours: 8 }]
}));
assert.equal(sourcedRows.rows[1][19], 'source-week-20260902|2026-09-01',
  'row envelopes derive their stable row key only from the original submission ID and date');

const legacyArrayRows = workbook('Jason');
const legacyArrayResult = submitPayload(legacyArrayRows, JSON.stringify([
  { employeeName: 'Jason', employeeEmail: 'jason@gmt-services.co.uk', submissionId: 'legacy-week-20260901', date: '2026-09-01', workedHours: 8 },
  { employeeName: 'Jason', employeeEmail: 'jason@gmt-services.co.uk', submissionId: 'legacy-week-20260901', date: '2026-09-02', workedHours: 8 }
]));
assert.equal(legacyArrayResult.created, 2, 'dated legacy array rows with a parent submission ID remain separate records');
assert.equal(legacyArrayRows.rows[1][19], 'legacy-week-20260901|2026-09-01');
assert.equal(legacyArrayRows.rows[2][19], 'legacy-week-20260901|2026-09-02');

const legacyGmtSubmissionRows = workbook('Jason');
submitPayload(legacyGmtSubmissionRows, JSON.stringify([
  { employeeName: 'Jason', employeeEmail: 'jason@gmt-services.co.uk', gmt_submission_id: 'legacy-gmt-week-20260901', date: '2026-09-01', workedHours: 8 },
  { employeeName: 'Jason', employeeEmail: 'jason@gmt-services.co.uk', gmt_submission_id: 'legacy-gmt-week-20260901', date: '2026-09-02', workedHours: 8 }
]));
assert.equal(legacyGmtSubmissionRows.rows[1][19], 'legacy-gmt-week-20260901|2026-09-01');
assert.equal(legacyGmtSubmissionRows.rows[2][19], 'legacy-gmt-week-20260901|2026-09-02');

const explicitLegacyRowIds = workbook('Jason');
submitPayload(explicitLegacyRowIds, JSON.stringify([
  { employeeName: 'Jason', employeeEmail: 'jason@gmt-services.co.uk', recordId: 'original-row-id-1', submissionId: 'legacy-week-20260901', date: '2026-09-01', workedHours: 8 },
  { employeeName: 'Jason', employeeEmail: 'jason@gmt-services.co.uk', gmt_record_id: 'original-row-id-2', gmt_submission_id: 'legacy-gmt-week-20260901', date: '2026-09-02', workedHours: 8 }
]));
assert.equal(explicitLegacyRowIds.rows[1][19], 'original-row-id-1', 'explicit recordId remains unchanged');
assert.equal(explicitLegacyRowIds.rows[2][19], 'original-row-id-2', 'explicit gmt_record_id remains unchanged');

const differentlyLabelledCompanion = workbook('Simon');
const sourceSummary = {
  employeeName: 'Simon',
  employeeEmail: 'simon@gmt-services.co.uk',
  recordId: 'source-week-20260901|2026-09-01',
  weekStart: '2026-08-31',
  weekEnd: '2026-09-06',
  date: '2026-09-01',
  action: 'submission',
  status: 'Recorded',
  workedHours: 0
};
const sourceDetail = {
  ...sourceSummary,
  weekStart: '2026-09-01',
  startTime: '08:00',
  finishTime: '17:00',
  workedHours: 8
};
assert.equal(submit(differentlyLabelledCompanion, sourceSummary).created, 1);
const companionResult = submit(differentlyLabelledCompanion, sourceDetail);
assert.equal(companionResult.updated, 1,
  'same-source companion records for the same employee and date enrich despite different week labels');
assert.equal(differentlyLabelledCompanion.rows.length, 2,
  'different week labels for one source ID and date must not create a duplicate row');
assert.equal(differentlyLabelledCompanion.rows[1][8], '08:00');
assert.equal(differentlyLabelledCompanion.rows[1][19], sourceSummary.recordId);

assert.equal(submit(simon, record('Simon', 's-week', 'submission', 40)).created, 1);
assert.equal(submit(jason, record('Jason', 'j-in', 'clock-in', 0)).created, 1);
assert.equal(submit(jason, record('Jason', 'j-out', 'clock-out', 8)).created, 1,
  'distinct source IDs on the same date remain separate events');
assert.equal(submit(simon, record('Simon', 's-in', 'clock-in', 0)).created, 1);
assert.equal(submit(simon, record('Simon', 's-out', 'clock-out', 8)).created, 1);
assert.equal(submit(jason, record('Jason', 'j-week', 'submission', 40)).created, 1);
assert.deepEqual(simon.rows.slice(1).map(row => row[19]), ['s-week', 's-in', 's-out']);
assert.deepEqual(jason.rows.slice(1).map(row => row[19]), ['j-in', 'j-out', 'j-week']);
assert.ok(simon.rows.slice(1).every(row => row[0] === 'Simon'));
assert.ok(jason.rows.slice(1).every(row => row[0] === 'Jason'));
assert.equal(submit(jason, record('Jason', 'j-week', 'submission', 42)).created, 1);
assert.equal(jason.rows.length, 5, 'a changed submission is retained as another version');
assert.equal(jason.rows[3][12], 40, 'original is not overwritten');
assert.equal(jason.rows[4][12], 42);
assert.equal(submit(jason, record('Jason', 'j-week', 'submission', 42)).unchanged, 1);
assert.equal(jason.rows.length, 5, 'exact retry must not create another row');
assert.equal(jason.rows[2][12], 8, 'earlier clock event is retained');
assert.match(jason.rows[3][21], /Multiple submitted versions/);
assert.equal(jason.sheets['Timesheet Events'].fills['A4:W4'], '#FFF2CC');
assert.ok(jason.sheets.Reconciliation.rows.some(row => row[12] === 40));
assert.ok(jason.sheets.Reconciliation.rows.some(row => row[12] === 42));
jason.sheets.Reconciliation.rows[1][24] = 'Reviewer note';
submit(jason, record('Jason', 'j-week', 'submission', 42));
assert.equal(jason.sheets.Reconciliation.rows[1][24], 'Reviewer note');

const intervals = workbook('Simon');
const timed = (id, startTime, finishTime, date = '2026-09-01') => ({ ...record('Simon', id, 'submission', 4), basicHours: 4, startTime, finishTime, date });
submit(intervals, [timed('a', '08:00', '12:00'), timed('b', '12:00', '16:00')]);
assert.equal(intervals.rows[1][21], '', 'adjacent shifts do not overlap');
submit(intervals, timed('c', '10:00', '14:00'));
assert.match(intervals.rows[1][21], /Overlapping submitted time/);
assert.match(intervals.rows[2][21], /Overlapping submitted time/);
assert.match(intervals.rows[3][21], /Overlapping submitted time/);
assert.equal(intervals.sheets.Reconciliation.rows.length, 4);
const overnight = workbook('Simon');
submit(overnight, [timed('night', '22:00', '02:00'), timed('next', '01:00', '05:00', '2026-09-02')]);
assert.match(overnight.rows[1][21], /Overlapping/);
const legacy = workbook('Simon');
const old = timed('legacy', '08:00', '12:00');
submit(legacy, old);
legacy.rows[1][4] = 46266; // Excel serial date: 2026-09-01.
legacy.rows[1][8] = 8 / 24;
legacy.rows[1][11] = 12 / 24;
assert.equal(submit(legacy, old).unchanged, 1, 'Excel date/time coercion must not duplicate a retry');
const sameBatch = workbook('Simon');
assert.equal(submit(sameBatch, [timed('v', '08:00', '12:00'), timed('v', '09:00', '13:00')]).created, 2);
const invalidHours = workbook('Simon');
submit(invalidHours, { ...timed('invalid-hours', '08:00', '12:00'), workedHours: 'unknown' });
assert.equal(invalidHours.rows[1][12], 'unknown', 'retain malformed submitted hours instead of inventing zero');
assert.match(invalidHours.rows[1][21], /Invalid hours/);
const before = JSON.stringify(jason.rows);
assert.throws(() => submit(jason, record('Simon', 'wrong-person', 'submission', 40)), /Employee does not match/);
assert.throws(() => submit(jason, { ...record('Jason', 'wrong-month', 'submission', 40), date: '2026-10-01' }), /Record month/);
assert.throws(() => submit(jason, { employeeName: 'Jason' }), /No valid timesheet records/);
assert.equal(JSON.stringify(jason.rows), before, 'invalid routing must not modify the workbook');

const testBook = workbook('TEST');
const skippedTest = submit(testBook, { employeeName: 'TEST', recordId: 'TEST-ROUTE-20260907-002', date: '2026-09-07' });
assert.equal(skippedTest.skipped, 1, 'synthetic TEST records are skipped');
assert.deepEqual(skippedTest.skippedRecordIds, ['TEST-ROUTE-20260907-002']);
assert.equal(testBook.rows.length, 0, 'synthetic TEST records never enter a workbook');
const adminBook = workbook('Ainsley');
const skippedAdmin = submit(adminBook, { employeeName: 'Ainsley', employeeEmail: 'Amanda.BB@gmt-services.co.uk', recordId: 'admin-route-1', date: '2026-09-07' });
assert.equal(skippedAdmin.skipped, 1, 'admin-account submissions are skipped even if the display name is an employee');
assert.equal(adminBook.rows.length, 0, 'admin-account submissions never enter employee history');

console.log('PASS: all versions retained; exact retries skipped; overlaps and issues flagged on main and Reconciliation; reviewer notes preserved; invalid routing rejected.');
