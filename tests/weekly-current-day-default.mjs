import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const generate = source.match(/function generateDaysFromRange\(preserveRows = false\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(generate);
let rendered;
const context = {
  clearMessage() {}, initialiseWeekDates() {}, showError(message) { throw Error(message); },
  weekStart: { value: '2026-10-26' }, weekEnd: { value: '2026-11-01' },
  dateObj: (date) => new Date(date + 'T12:00:00Z'), getRows: () => [],
  isWeekendDate: () => false, isUntouchedWeekendRow: () => true, absenceRanges: [],
  rangeIncludesWeekend: () => false, includeWeekendsInput: { checked: false },
  timesheetRowPolicy: { weekDates: () => ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'], todayInLondon: () => '2026-10-28' },
  absenceForDate: () => 'NA', requestedDay: '',
  renderRows(rows) { rendered = rows; }, updatePeriodSummary() {},
};
vm.runInNewContext(generate + '; generateDaysFromRange();', context);
assert.equal(rendered.find((row) => row.date === '2026-10-28').collapsed, false, 'today is the open daily entry on a new form');
assert.equal(rendered.find((row) => row.date === '2026-10-26').collapsed, true, 'other generated days keep their own dates');
context.requestedDay = '2026-10-27';
vm.runInNewContext('generateDaysFromRange();', context);
assert.equal(rendered.find((row) => row.date === '2026-10-27').collapsed, false, 'an explicitly requested day remains the open entry');
context.requestedDay = '';
context.getRows = () => [{ date: '2026-10-26', collapsed: false, start: '07:00' }, { date: '2026-10-27', collapsed: true }];
vm.runInNewContext('generateDaysFromRange(true);', context);
assert.equal(rendered.find((row) => row.date === '2026-10-26').start, '07:00', 'existing entries keep their data');
assert.equal(rendered.find((row) => row.date === '2026-10-26').collapsed, false, 'existing expansion state is preserved');
const initialiseAbsence = source.match(/function initialiseAbsenceDates\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(initialiseAbsence, 'absence date defaults are initialised');
context.absenceStart = { value: '' };
context.absenceEnd = { value: '' };
context.requestedDay = '';
vm.runInNewContext(initialiseAbsence + '; initialiseAbsenceDates();', context);
assert.equal(context.absenceStart.value, '2026-10-28');
assert.equal(context.absenceEnd.value, '2026-10-28');
context.absenceStart.value = '2026-10-01';
context.absenceEnd.value = '2026-10-02';
vm.runInNewContext('initialiseAbsenceDates();', context);
assert.equal(context.absenceStart.value, '2026-10-01', 'do not overwrite an entered date');
assert.equal(context.absenceEnd.value, '2026-10-02');
console.log('Weekly current-day entry defaults: PASS');
