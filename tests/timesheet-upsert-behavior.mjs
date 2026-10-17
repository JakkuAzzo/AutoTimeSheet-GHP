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
const record = (employeeName, recordId, action, workedHours) => ({ employeeName, recordId, action, workedHours, status: 'Submitted', date: '2026-09-01' });

assert.equal(submit(simon, record('Simon', 's-week', 'submission', 40)).created, 1);
assert.equal(submit(jason, record('Jason', 'j-in', 'clock-in', 0)).created, 1);
assert.equal(submit(jason, record('Jason', 'j-out', 'clock-out', 8)).created, 1);
assert.equal(submit(jason, record('Jason', 'j-in', 'clock-in', 0)).unchanged, 1, 'exact clock-in retry is idempotent');
assert.equal(submit(jason, record('Jason', 'j-out', 'clock-out', 8)).unchanged, 1, 'exact clock-out retry is idempotent');
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

const absenceCalendarSync = {
  employee: 'Simon',
  employeeEmail: 'simon@gmt-services.co.uk',
  weekStart: '2026-08-31',
  weekEnd: '2026-09-06',
  submissionId: 's-absence-companion',
  submittedAt: '2026-09-01T20:00:00Z',
  events: [{
    type: 'absence', title: 'Annual leave', startDate: '2026-09-01', endDateExclusive: '2026-09-02',
    absenceReason: 'Holiday', status: 'Absent', syncEventId: 's-absence-companion|2026-09-01'
  }]
};
const csvAbsenceCompanion = {
  ...record('Simon', 's-absence-companion|2026-09-01', 'submission', 7.5), ot15Hours: 0, ot20Hours: 0,
  weekStart: '2026-08-31', weekEnd: '2026-09-06', startTime: '08:00', finishTime: '15:30', basicHours: 7.5
};
const absenceFirst = workbook('Simon');
assert.equal(submit(absenceFirst, absenceCalendarSync).created, 1);
assert.equal(submit(absenceFirst, csvAbsenceCompanion).updated, 1, 'linked absence and submission companions enrich one row');
assert.equal(absenceFirst.rows.length, 2, 'a Calendar Sync absence and its CSV companion do not duplicate the day');
assert.equal(absenceFirst.rows[1][5], 'submission', 'the richer submission action is retained');
assert.equal(absenceFirst.rows[1][1], 'simon@gmt-services.co.uk', 'the Calendar Sync employee identity is retained');
assert.equal(absenceFirst.rows[1][7], 'Holiday', 'the Calendar Sync absence reason is retained');
assert.equal(absenceFirst.rows[1][8], '08:00');
assert.equal(absenceFirst.rows[1][11], '15:30');
assert.equal(absenceFirst.rows[1][12], 7.5);
assert.equal(absenceFirst.rows[1][18], '2026-09-01T20:00:00Z', 'the Calendar Sync submission timestamp is retained');
const csvCompanionRetry = submit(absenceFirst, csvAbsenceCompanion);
assert.equal(csvCompanionRetry.unchanged, 1, 'the enriched companion retry is idempotent');

const submissionFirst = workbook('Simon');
submit(submissionFirst, csvAbsenceCompanion);
assert.equal(submit(submissionFirst, absenceCalendarSync).updated, 1, 'companion enrichment is independent of arrival order');
assert.equal(submissionFirst.rows.length, 2);
assert.equal(submissionFirst.rows[1][5], 'submission');
assert.equal(submissionFirst.rows[1][7], 'Holiday');
assert.equal(submissionFirst.rows[1][8], '08:00');

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
