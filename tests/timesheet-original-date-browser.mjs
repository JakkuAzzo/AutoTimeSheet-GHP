import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const calendarSource = fs.readFileSync(new URL('../portal/calendar-data.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(calendarSource, context);
const calendar = context.window.GMTCalendarData;

const oldImport = {
  kind: 'timesheets',
  source_record_id: 'ainsley-august',
  employee_upn: 'ainsley@gmt-services.co.uk',
  employee_name: 'Ainsley',
  start_date: '2026-08-24',
  end_date: '2026-08-28',
  payload: { rows: [
    { date: '2026-08-24', start: '08:00', finish: '17:00', lunchMinutes: 60 },
    { date: '2026-08-25', sourceDate: '2026-07-28', start: '08:00', finish: '17:00', lunchMinutes: 60 }
  ] }
};
assert.deepEqual(
  Array.from(calendar.recordsToEvents([oldImport], {}).map((event) => event.date)),
  ['2026-08-24', '2026-07-28'],
  'calendar events must follow the original Date column, even in a historical shifted import'
);
assert.equal(calendar.rowsFor(oldImport)[1].legacyAlignedDate, '2026-08-25');

const undated = {
  ...oldImport,
  source_record_id: 'undated',
  payload: { rows: [{ label: 'Day 1', start: '08:00', finish: '17:00' }] }
};
assert.deepEqual(Array.from(calendar.recordsToEvents([undated], {})), [],
  'a week header must not create a dated calendar entry when the day has no Date');

const timesheetSource = fs.readFileSync(new URL('../portal/timesheets.js', import.meta.url), 'utf8');
const alignFunction = timesheetSource.match(/function alignTimesheetRows\([^)]*\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(alignFunction, 'timesheet date-preservation helper is present');
const alignTimesheetRows = new Function('rowDateValue', 'objectValue', `${alignFunction}; return alignTimesheetRows;`)(
  (row) => String(row?.date || '').slice(0, 10),
  (row, keys) => keys.map((key) => row?.[key]).find((value) => value !== undefined) || ''
);
assert.deepEqual(alignTimesheetRows(oldImport.payload.rows, oldImport).map((row) => row.date),
  ['2026-08-24', '2026-07-28'], 'timesheet metrics must use the original Date column');
assert.equal(alignTimesheetRows(undated.payload.rows, undated)[0].date, undefined,
  'timesheet metrics must not derive a missing Date from the week header');

const submissionsSource = fs.readFileSync(new URL('../portal/submissions.js', import.meta.url), 'utf8');
const updateFunction = submissionsSource.match(/function updatePayloadRow\([^)]*\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(updateFunction, 'pay-month row editor helper is present');
const updatePayloadRow = new Function('rowValue', 'rowMetrics', `${updateFunction}; return updatePayloadRow;`)(
  (row, keys, fallback = '') => keys.map((key) => row?.[key]).find((value) => value !== undefined) ?? fallback,
  () => ({ workedActual: 540, basic: 480, ot15: 60, ot20: 0 })
);
const corrected = updatePayloadRow({ date: '2026-08-25', sourceDate: '2026-07-28', legacyAlignedDate: '2026-08-25', start: '08:00', finish: '17:00', lunchMinutes: 60 },
  { date: '2026-07-29', start: '08:00', finish: '18:00', breakMinutes: 60, absence: 'NA', note: 'Corrected date' });
assert.equal(corrected.date, '2026-07-29');
assert.equal(corrected.sourceDate, undefined, 'a new correction must not retain the prior source Date override');
assert.equal(corrected.legacyAlignedDate, undefined);

console.log('Browser calendar and timesheet original Date projection: PASS');
