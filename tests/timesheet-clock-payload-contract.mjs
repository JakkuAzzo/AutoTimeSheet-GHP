import assert from 'node:assert/strict';
import { normaliseInput, validateNoFutureWork } from '../cloudflare-worker/src/index.js';

const identity = {
  oid: 'synthetic-clock-test-owner',
  upn: 'test-clock@example.test',
  name: 'TEST Clock QA',
  isAdmin: false,
  isTimesheetViewer: false
};

const record = normaliseInput({
  recordId: 'clock-test-clock-2026-10-16-clock_in-08-15',
  kind: 'clock',
  action: 'clock_in',
  status: 'Pending delivery',
  recordDate: '2026-10-16',
  employeeName: 'TEST Clock QA',
  employeeEmail: 'test-clock@example.test',
  payload: {
    schemaVersion: 2,
    action: 'clock_in',
    date: '2026-10-16',
    time: '08:15',
    row: { Date: '2026-10-16', Start: '08:15', Status: 'Recorded' },
    hours: { worked: 0, breakMinutes: 0 }
  }
}, identity);

const savedPayload = JSON.parse(record.payloadJson);
assert.equal(savedPayload.time, '08:15', 'protected clock history must retain the entered event time');
assert.deepEqual(savedPayload.row, { Date: '2026-10-16', Start: '08:15', Status: 'Recorded' });
assert.deepEqual(savedPayload.hours, { worked: 0, breakMinutes: 0 });
assert.throws(() => normaliseInput({
  recordId: 'clock-test-location-limit', kind: 'clock', action: 'clock_in', recordDate: '2026-10-16',
  employeeName: 'TEST Clock QA', employeeEmail: 'test-clock@example.test',
  payload: { action: 'clock_in', date: '2026-10-16', time: '08:15', location: 'x'.repeat(241) }
}, identity), /location.*240/i, 'clock location must be bounded before protected storage');
assert.throws(() => normaliseInput({
  recordId: 'clock-test-note-limit', kind: 'clock', action: 'clock_in', recordDate: '2026-10-16',
  employeeName: 'TEST Clock QA', employeeEmail: 'test-clock@example.test',
  payload: { action: 'clock_in', date: '2026-10-16', time: '08:15', note: 'x'.repeat(1001) }
}, identity), /note.*1000/i, 'clock note must be bounded before protected storage');

const beforeLondonMidnight = new Date('2026-09-27T22:30:00Z');
assert.throws(
  () => validateNoFutureWork('clock', 'clock_in', { date: '2026-09-27', time: '23:31' }, beforeLondonMidnight),
  /future clock times/i,
  'a same-day clock event cannot be recorded in the future in Europe/London'
);
assert.doesNotThrow(() => validateNoFutureWork('clock', 'clock_in', { date: '2026-09-27', time: '23:30' }, beforeLondonMidnight));
assert.throws(() => validateNoFutureWork('clock', 'clock_out', { date: '2026-09-27', time: '24:00' }, beforeLondonMidnight), /valid clock time/i);
assert.throws(() => validateNoFutureWork('clock', 'clock_in', { date: '2026-02-30', time: '08:15' }, beforeLondonMidnight), /valid clock date/i);
assert.throws(() => validateNoFutureWork('clock', 'clock_in', { date: '2026-09-27' }, beforeLondonMidnight), /valid clock time/i);
assert.throws(() => validateNoFutureWork('clock', 'full_day', {
  date: '2026-09-27', dayStart: '08:00', lunchStart: '12:00', lunchEnd: '13:00', dayFinish: '23:45'
}, beforeLondonMidnight), /future clock times/i);
assert.throws(() => validateNoFutureWork('clock', 'full_day', {
  date: '2026-09-27', dayStart: '09:00', lunchStart: '08:00', lunchEnd: '08:30', dayFinish: '17:00'
}, beforeLondonMidnight), /lunch must fall/i);
assert.doesNotThrow(() => validateNoFutureWork('clock', 'absent', { date: '2026-09-28' }, beforeLondonMidnight));

console.log('Protected clock payload retains event time, daily row and calculated hours.');
