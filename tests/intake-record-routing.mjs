import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionRecordAttachment, routeRecordAttachment } from '../power-platform/intake-record-routing.mjs';

const row = (date, extra = {}) => ({ date, employeeName: 'Simon', employeeEmail: 'simon@gmt-services.co.uk', submissionId: 'source-one', ...extra });

test('routes an older array by daily Dates when week start and submission month mislead', () => {
  const routed = routeRecordAttachment([row('2026-08-31', { weekStart: '2026-09-07' }), row('2026-09-01', { weekStart: '2026-09-07' })]);
  assert.equal(routed.payMonth, '2026-09');
  assert.equal(routed.recordId, 'source-one');
  assert.equal(routed.workbookPath, '/Timesheets/2026/09/Simon/GMT Timesheet - Simon - Pay Month 2026-09.xlsx');
});

test('routes a single older row without a declared pay month', () => {
  assert.equal(routeRecordAttachment(row('2026-08-25')).payMonth, '2026-09');
});

test('routes a portal replacement envelope whose rows inherit employee identity', () => {
  const routed = routeRecordAttachment({ mode: 'replace-pay-month', recordId: 'correction-one', employeeName: 'Michelle Reid', employeeEmail: 'michelle@gmt-services.co.uk', payMonth: '2026-09', rows: [{ date: '2026-09-15' }] });
  assert.equal(routed.mode, 'replace-pay-month');
  assert.equal(routed.recordId, 'correction-one');
  assert.match(routed.workbookPath, /Michelle Reid\/GMT Timesheet - Michelle Reid - Pay Month 2026-09\.xlsx$/);
});

test('rejects a declared month that disagrees with a dated row', () => {
  assert.throws(() => routeRecordAttachment([row('2026-08-31', { payMonth: '2026-08' })]), /disagrees with Date/);
});

test('splits mixed-cycle originals by Date without inventing August rows', () => {
  const routes = partitionRecordAttachment([row('2026-08-24'), row('2026-07-28'), row('2026-07-29')]);
  assert.deepEqual(routes.map(route => [route.payMonth, route.dates]), [
    ['2026-08', ['2026-07-28', '2026-07-29']],
    ['2026-09', ['2026-08-24']]
  ]);
  assert.equal(JSON.parse(routes[1].recordJson).length, 1);
  assert.throws(() => routeRecordAttachment([row('2026-09-18'), row('2026-09-21')]), /multiple pay months/);
});

test('rejects duplicate dates before choosing any workbook', () => {
  assert.throws(() => routeRecordAttachment([row('2026-09-01'), row('2026-09-01')]), /Duplicate Date/);
});

test('holds generated future and off-roster worked rows for source review', () => {
  assert.throws(() => routeRecordAttachment(row('2026-09-10', { submittedAt: '2026-09-09T16:27:09Z' })), /Future worked Date/);
  assert.throws(() => routeRecordAttachment(row('2026-09-07', { submittedAt: '2026-09-09T16:27:09Z' }), { rosterWeekdays: [2, 3] }), /Off-roster worked Date/);
  assert.equal(routeRecordAttachment(row('2026-09-10', { submittedAt: '2026-09-09T16:27:09Z', absenceReason: 'Holiday' })).payMonth, '2026-09');
});
