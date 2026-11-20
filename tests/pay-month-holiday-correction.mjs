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

assert.equal(workbook.workedMinutesForRow(correctedHoliday), 480);
const data = workbook.toWorkbookData(
  { rows: [{ row: correctedHoliday }] },
  { start: '2026-08-24', end: '2026-09-18' }
);
assert.equal(data.dailyEntries[0]['Total hours'], 480);
assert.equal(data.weeklyTotals.at(-1)['Total hours'], 480);

// Existing clock fields can remain on a corrected holiday. The editor records
// the paid holiday as eight hours, so the export must use the same total.
const holidayWithClocks = {
  date: '2026-09-05', start: '09:00', finish: '16:00', lunchMinutes: 30,
  absenceStatus: 'Holiday', workedMinutes: 480, workedHours: 8
};
assert.equal(workbook.workedMinutesForRow(holidayWithClocks), 480);
const withClocks = workbook.toWorkbookData(
  { rows: [{ row: holidayWithClocks }] },
  { start: '2026-08-24', end: '2026-09-18' }
);
assert.equal(withClocks.dailyEntries[0]['Total hours'], 480);
assert.equal(withClocks.weeklyTotals.at(-1)['Total hours'], 480);
assert.equal(workbook.workedMinutesForRow({ ...holidayWithClocks, workedMinutes: 390, workedHours: 6.5 }), 390);

console.log('Holiday correction clears stale worked hours');
