import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const workbook = require('../portal/pay-month-workbook.js');

// The source row was once recorded as worked. An Accounts correction later
// cleared its clocks and marked it Holiday; the old stored total must not win.
const correctedHoliday = {
  date: '2026-09-04',
  start: '',
  finish: '',
  lunchMinutes: 0,
  absenceStatus: 'Holiday',
  workedMinutes: 540,
  workedHours: 9
};

assert.equal(workbook.workedMinutesForRow(correctedHoliday), 0);
const data = workbook.toWorkbookData(
  { rows: [{ row: correctedHoliday }] },
  { start: '2026-08-24', end: '2026-09-18' }
);
assert.equal(data.dailyEntries[0]['Total hours'], 0);
assert.equal(data.weeklyTotals.at(-1)['Total hours'], 0);

console.log('Holiday correction clears stale worked hours');
