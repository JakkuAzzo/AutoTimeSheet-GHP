import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../portal/calendar-data.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'portal/calendar-data.js' });
const calendar = context.window.GMTCalendarData;

const roster = [{ employee_name: 'Michelle Reid', employee_upn: 'micheller.admin@gmt-services.co.uk' }];
const employee = { employee_name: 'Michelle Reid', employee_upn: 'MichelleR.admin@gmt-services.co.uk' };
const records = [
  { employee_name: 'Michelle Reid', employee_upn: 'micheller.admin@gmt-services.co.uk', kind: 'timesheets', action: 'submission', status: 'Queued for Accounts', record_date: '2026-10-13', source_record_id: 'timesheet-day', updated_at: '2026-10-13T17:09:00Z', payload: { rows: [{ Date: '2026-10-13', Start: '08:45', Finish: '17:00', 'Lunch start': '14:00', 'Lunch end': '14:30', Break: 30, 'Worked hours': 7.75 }] } },
  { ...employee, kind: 'clock', action: 'clock_in', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'clock-in', updated_at: '2026-10-13T08:45:00Z', payload: { row: { Date: '2026-10-13', Start: '08:45' } } },
  { ...employee, kind: 'clock', action: 'lunch_start', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'lunch-start', updated_at: '2026-10-13T14:00:00Z', payload: { row: { Date: '2026-10-13', 'Lunch start': '14:00' } } },
  { ...employee, kind: 'clock', action: 'lunch_end', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'lunch-end', updated_at: '2026-10-13T14:30:00Z', payload: { row: { Date: '2026-10-13', 'Lunch end': '14:30' } } },
  { ...employee, kind: 'clock', action: 'clock_out', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'clock-out', updated_at: '2026-10-13T17:00:00Z', payload: { row: { Date: '2026-10-13', Finish: '17:00' } } }
];

const options = { employees: roster };
const combined = calendar.combineDailyRecords(records, options);
assert.equal(combined.length, 1, 'the timesheet row and four clock actions become one employee/day record');
assert.deepEqual(Array.from(combined[0].source_record_ids).sort(), ['clock-in', 'clock-out', 'lunch-end', 'lunch-start', 'timesheet-day']);
const row = calendar.rowsFor(combined[0])[0];
assert.equal(row.date, '2026-10-13');
assert.equal(row.start, '08:45');
assert.equal(row.lunchStart, '14:00');
assert.equal(row.lunchEnd, '14:30');
assert.equal(row.lunchMinutes, 30);
assert.equal(row.finish, '17:00');
assert.equal(row.workedMinutes, 465);

const [event] = calendar.recordsToEvents(records, options);
assert.equal(calendar.recordsToEvents(records, options).length, 1, 'the shared calendar renders one event per employee/day');
assert.equal(event.row.start, '08:45');
assert.equal(event.row.finish, '17:00');
assert.match(event.detail, /7h 45m/);

const unpaidRecords = [
  { employee_name: 'Michelle Reid', employee_upn: 'micheller.admin@gmt-services.co.uk', kind: 'timesheets', action: 'submission', status: 'Submitted', record_date: '2026-10-16', source_record_id: 'timesheet-unpaid-day', payload: { rows: [{ date: '2026-10-16', start: '08:00', finish: '17:00', lunchMinutes: 0, workedMinutes: 540, workedHours: 9, absenceStatus: 'Un-Paid' }] } },
  { employee_name: 'Michelle Reid', employee_upn: 'micheller.admin@gmt-services.co.uk', kind: 'clock', action: 'clock_in', status: 'Submitted', record_date: '2026-10-16', source_record_id: 'clock-in-unpaid-day', payload: { row: { date: '2026-10-16', start: '08:00', absenceStatus: 'NA' } } },
  { employee_name: 'Michelle Reid', employee_upn: 'micheller.admin@gmt-services.co.uk', kind: 'clock', action: 'clock_out', status: 'Submitted', record_date: '2026-10-16', source_record_id: 'clock-out-unpaid-day', payload: { row: { date: '2026-10-16', finish: '17:00', absenceStatus: 'NA' } } }
];
const unpaidRollup = calendar.combineDailyRecords(unpaidRecords, options)[0];
assert.equal(calendar.rowsFor(unpaidRollup)[0].workedMinutes, 0, 'the calendar rollup must not recalculate hours from clocks on an Un-Paid day');
const unpaidEvent = calendar.recordsToEvents(unpaidRecords, options)[0];
assert.match(unpaidEvent.detail, /Un-Paid/);
assert.doesNotMatch(unpaidEvent.detail, /9h/);

console.log('Clock event daily rollup: PASS');
