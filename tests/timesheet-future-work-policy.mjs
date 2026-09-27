import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { projectRow, validateNoFutureWork } from '../cloudflare-worker/src/index.js';

const require = createRequire(import.meta.url);
const rows = require('../timesheet-row-policy.js');
const beforeLondonMidnight = new Date('2026-09-27T22:30:00Z');
const afterLondonMidnight = new Date('2026-09-27T23:30:00Z');
assert.equal(rows.todayInLondon(beforeLondonMidnight), '2026-09-27');
assert.equal(rows.todayInLondon(afterLondonMidnight), '2026-09-28');
assert.equal(rows.futureWorkDate({ date: '2026-09-28', absenceStatus: 'NA' }, beforeLondonMidnight), true);
assert.equal(rows.futureWorkDate({ date: '2026-09-28', absenceStatus: 'NA' }, afterLondonMidnight), false);
for (const status of ['Sick', 'Holiday', 'Absent']) {
  assert.equal(rows.futureWorkDate({ date: '2026-09-28', absenceStatus: status }, beforeLondonMidnight), false);
  validateNoFutureWork('timesheets', 'submission', { rows: [{ date: '2026-09-28', absenceStatus: status }] }, beforeLondonMidnight);
}
assert.equal(rows.futureWorkDate({ date: '2026-09-28', absenceStatus: 'Time Off' }, beforeLondonMidnight), true);
assert.throws(() => validateNoFutureWork('timesheets', 'submission', { rows: [{ date: '2026-09-28', absenceStatus: 'NA' }] }, beforeLondonMidnight), /Future dates/);
assert.throws(() => validateNoFutureWork('timesheets', 'pay_month_correction', { rows: [{ date: '2026-09-28', absenceStatus: 'Time Off' }] }, beforeLondonMidnight), /Future dates/);
assert.throws(() => validateNoFutureWork('clock', 'clock_in', { date: '2026-09-28' }, beforeLondonMidnight), /Future clock/);
validateNoFutureWork('clock', 'absent', { date: '2026-09-28', rows: [{ date: '2026-09-28', absenceStatus: 'Other' }] }, beforeLondonMidnight);
const deletionOnly = projectRow({ kind: 'timesheets', action: 'pay_month_correction', record_id: 'correction', owner_upn: 'matthew@gmt-services.co.uk', employee_name: 'Matthew', status: 'Submitted', payload_json: JSON.stringify({ payMonth: '2026-09', rows: [], deletedDays: ['2026-09-19', '2026-09-20'] }) });
assert.deepEqual(deletionOnly.payload.deletedDays, ['2026-09-19', '2026-09-20']);
console.log('Future work dates are blocked; explicit future absences remain available.');
