import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const workbook = require('../portal/pay-month-workbook.js');
const rowPolicy = require('../timesheet-row-policy.js');

const unpaidWithClockAndStaleTotals = {
  date: '2026-10-19',
  start: '08:00',
  finish: '17:00',
  lunchMinutes: 0,
  absenceStatus: 'Un-Paid',
  workedMinutes: 540,
  workedHours: 9,
  basicHours: 8,
  ot15Hours: 1,
  ot20Hours: 2,
  weightedHours: 13
};
const unpaidWithoutClockAndStaleTotals = {
  date: '2026-10-20',
  absenceStatus: 'Un-Paid',
  workedMinutes: 540,
  workedHours: 9,
  basicHours: 8,
  ot15Hours: 1,
  ot20Hours: 0,
  weightedHours: 9.5
};
const unpaidSixteenth = {
  date: '2026-10-16',
  start: '08:00',
  finish: '17:00',
  lunchMinutes: 0,
  absenceStatus: 'Un-Paid',
  workedMinutes: 540,
  workedHours: 9,
  basicHours: 8,
  ot15Hours: 1,
  weightedHours: 9.5
};

for (const row of [unpaidWithClockAndStaleTotals, unpaidWithoutClockAndStaleTotals, unpaidSixteenth]) {
  assert.equal(workbook.workedMinutesForRow(row), 0, 'Un-Paid must override clocks and stored worked totals');
  assert.equal(workbook.provisionalForRow(row), false, 'Un-Paid must not be treated as provisional work');
}

const exported = workbook.toWorkbookData(
  { rows: [{ row: unpaidWithClockAndStaleTotals }, { row: unpaidWithoutClockAndStaleTotals }, { row: unpaidSixteenth }] },
  { start: '2026-10-16', end: '2026-10-23' }
);
assert.deepEqual(exported.dailyEntries.map((row) => [row.Absence, row['Total hours']]), [
  ['Un-Paid', 0],
  ['Un-Paid', 0],
  ['Un-Paid', 0]
]);
assert.equal(exported.weeklyTotals.at(-1)['Total hours'], 0);
assert.equal(rowPolicy.futureWorkDate({ date: '2099-01-02', absenceStatus: 'Un-Paid' }), false, 'unpaid time off may be entered ahead of time');

console.log('Un-Paid time off overrides hours, workbook totals, provisional state and future-date policy: PASS');
