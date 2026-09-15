import assert from 'node:assert/strict';
import { completionSummary, completionWeeks, listRecords, normaliseUpstreamRecord } from '../cloudflare-worker/src/index.js';

const env = {
  STAFF_DIRECTORY_JSON: JSON.stringify([
    { name: 'Jason', upn: 'jason@gmt-services.co.uk' },
    { name: 'Matthew', upn: 'matthew@gmt-services.co.uk' },
    { name: 'Ainsley', upn: 'ainsley@gmt-services.co.uk' },
    { name: 'Michelle', upn: 'michelle@gmt-services.co.uk' }
  ])
};
const now = new Date('2026-09-14T12:00:00Z');
const weeks = completionWeeks('2026-09', 'Europe/London', now);
assert.deepEqual(weeks.map((week) => week.start), ['2026-08-31', '2026-09-07']);

const recovered = normaliseUpstreamRecord({
  Id: 44,
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Michelle Reid | Week 2026-09-07',
  EmployeeName: 'Michelle Reid',
  Modified: '2026-09-09T07:00:00Z'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, env);
assert.equal(recovered.employee_name, 'Michelle');
assert.equal(recovered.employee_upn, 'michelle@gmt-services.co.uk');
assert.equal(recovered.start_date, '2026-09-07');
assert.equal(recovered.end_date, '2026-09-13');
assert.equal(recovered.record_date, '2026-09-07');
assert.equal(recovered.status, 'Submitted');
assert.equal(recovered.submitted_at, '2026-09-09T07:00:00Z');
assert.equal(recovered.source_record_id, 'sharepoint-timesheet-44');
assert.equal(recovered.synthetic, false);

const excludedAdminTest = normaliseUpstreamRecord({
  Id: 45,
  Title: '[GMT][TIMESHEET][SUBMISSION] Amanda | Week 2026-09-07',
  EmployeeName: 'Amanda',
  Employee_x0020_Email: 'acc.gmtelect@outlook.com'
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, env);
assert.equal(excludedAdminTest.synthetic, true);

const summary = completionSummary([
  {
    kind: 'timesheets', employee_name: 'Jason', employee_upn: 'jason@gmt-services.co.uk',
    start_date: '2026-09-07', end_date: '2026-09-13', status: 'Submitted', issue: ''
  },
  {
    kind: 'timesheets', employee_name: 'Ainsley', employee_upn: 'ainsley@gmt-services.co.uk',
    start_date: '2026-09-07', end_date: '2026-09-13', status: 'Pending', issue: 'Awaiting Accounts review'
  },
  {
    kind: 'timesheets', employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk',
    start_date: '2026-08-24', end_date: '2026-08-30', status: 'Submitted', issue: ''
  },
  {
    kind: 'timesheets', employee_name: 'TEST AUTOMATED USER', employee_upn: 'info@gmt-services.co.uk',
    start_date: '2026-09-07', end_date: '2026-09-13', status: 'Submitted', issue: ''
  }
], env, 'Europe/London', now);

const byName = Object.fromEntries(summary.employees.map((employee) => [employee.employee_name, employee]));
assert.equal(summary.directory_configured, true);
assert.equal(byName.Jason.status, 'incomplete');
assert.deepEqual(byName.Jason.missing, ['Timesheet week 2026-08-31 to 2026-09-06']);
assert.equal(byName.Ainsley.status, 'incomplete');
assert.match(byName.Ainsley.missing.join(' '), /Awaiting Accounts review/);
assert.equal(byName.Matthew.status, 'missing');
assert.equal(summary.employees.some((employee) => employee.employee_name === 'TEST AUTOMATED USER'), false);
assert.deepEqual(summary.counts, { completed: 0, incomplete: 2, missing: 2 });

const boundaryEnv = {
  STAFF_DIRECTORY_JSON: JSON.stringify([
    { name: 'Simon', upn: 'simon@gmt-services.co.uk' }
  ])
};
const boundarySummary = completionSummary([
  {
    kind: 'timesheets', employee_name: 'Simon', employee_upn: 'simon@gmt-services.co.uk',
    start_date: '2026-08-31', end_date: '2026-09-06', status: 'Submitted', issue: ''
  }
], boundaryEnv, 'Europe/London', now);
assert.equal(boundarySummary.employees[0].submitted_records, 1);
assert.deepEqual(boundarySummary.employees[0].completed_weeks, ['2026-08-31']);
assert.equal(boundarySummary.employees[0].status, 'incomplete');

const rows = [
  {
    record_id: 'real-jason', owner_oid: 'jason-oid', owner_upn: 'jason@gmt-services.co.uk', employee_name: 'Jason', kind: 'timesheets', action: 'submission', status: 'Submitted', start_date: '2026-09-07', end_date: '2026-09-13', record_date: '2026-09-07', submitted_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T10:00:00Z', issue: '', payload_json: '{}'
  },
  {
    record_id: 'synthetic-test', owner_oid: 'info-oid', owner_upn: 'info@gmt-services.co.uk', employee_name: 'TEST AUTOMATED USER', kind: 'timesheets', action: 'submission', status: 'Submitted', start_date: '2026-09-07', end_date: '2026-09-13', record_date: '2026-09-07', submitted_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T10:00:00Z', issue: '', payload_json: '{}'
  }
];
const db = { prepare() { return { bind() { return { all: async () => ({ results: rows }) }; } }; } };
const history = await listRecords(new Request('https://gmt.example/api/history?kind=all'), { DB: db, STAFF_DIRECTORY_JSON: env.STAFF_DIRECTORY_JSON }, { oid: 'accounts-oid', upn: 'acc.gmtelect@outlook.com', isAdmin: true, isJobCardAdmin: true });
assert.equal(history.records.length, 1);
assert.equal(history.records[0].employee_name, 'Jason');
assert.equal(history.meta.synthetic_record_count, 1);
assert.equal(history.meta.completion.counts.missing, 3);

console.log(JSON.stringify({
  payMonth: summary.pay_month,
  employees: summary.employees.map(({ employee_name, status, missing }) => ({ employee_name, status, missing })),
  counts: summary.counts
}, null, 2));
