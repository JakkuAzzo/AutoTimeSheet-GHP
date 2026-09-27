import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const coverage = require('../timesheet-coverage.js');
const payPeriods = require('../pay-periods.js');
const period = payPeriods.periodForMonth('2026-09');
const email = 'micheller.admin@gmt-services.co.uk';
const row = (date, start, finish, absenceStatus = 'NA') => ({ date, start, finish, absenceStatus });
const records = [
  { employee_upn: email, status: 'Submitted', updated_at: '2026-09-09T09:00:00Z', payload: { rows: [row('2026-08-25', '09:20', '16:00'), row('2026-08-26', '09:10', '18:00')] } },
  { employee_upn: email, status: 'Submitted', updated_at: '2026-09-09T10:00:00Z', payload: { rows: [row('2026-09-01', '09:15', '17:25'), row('2026-09-02', '09:30', '17:15')] } },
  { employee_upn: email, status: 'Submitted', updated_at: '2026-09-09T17:00:00Z', payload: { rows: [row('2026-09-08', '09:30', '17:40'), row('2026-09-09', '09:00', '17:35')] } },
  { employee_upn: email, status: 'Submitted', updated_at: '2026-09-15T16:40:11Z', payload: { rows: [row('2026-09-15', '09:05', '17:30'), row('2026-09-16', '05:00', '05:00')] } },
  { employee_upn: 'another@gmt-services.co.uk', status: 'Submitted', payload: { rows: [row('2026-09-16', '08:00', '17:00')] } },
  { employee_upn: email, status: 'Deleted', payload: { rows: [row('2026-09-16', '08:00', '17:00')] } }
];

const result = coverage.summarize({ period, employeeEmail: email, records, workdays: [2, 3], today: '2026-09-27' });
assert.equal(result.expected.length, 8, 'two roster days in each of four weeks');
assert.equal(result.recorded.length, 7, 'distinct dated rows count once');
assert.deepEqual(result.overdue, ['2026-09-16'], 'implausible same-time row does not satisfy attendance');
assert.match(coverage.receiptText(result), /7 of 8 scheduled days/);

const explained = coverage.summarize({ period, employeeEmail: email, records, submittedRows: [row('2026-09-16', '', '', 'Holiday')], workdays: [2, 3], today: '2026-09-27' });
assert.deepEqual(explained.overdue, []);
assert.deepEqual(explained.absent, ['2026-09-16']);

const clock = coverage.summarize({ period: payPeriods.periodForMonth('2026-10'), employeeEmail: email, records: [], submittedRows: [{ date: '2026-09-22', Start: '08:00', Finish: '' }], workdays: [2, 3], today: '2026-09-22' });
assert.deepEqual(clock.partial, ['2026-09-22']);
assert.deepEqual(clock.overdue, ['2026-09-22']);

console.log('Timesheet coverage and receipt checks passed.');
