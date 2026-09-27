import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseUpstreamRecord, projectRow, staffDirectory } from '../cloudflare-worker/src/index.js';

const config = readFileSync(new URL('../cloudflare-worker/wrangler.toml', import.meta.url), 'utf8');
const roster = config.match(/^STAFF_DIRECTORY_JSON = '(.*)'$/m);
assert.ok(roster, 'Worker roster must be configured');
const env = { STAFF_DIRECTORY_JSON: roster[1] };
const directory = staffDirectory(env);
assert.deepEqual(directory.find((entry) => entry.upn === 'micheller.admin@gmt-services.co.uk')?.workdays, [2, 3]);
assert.deepEqual(directory.find((entry) => entry.upn === 'lidiaa.admin@gmt-services.co.uk')?.workdays, [1, 4, 5]);
assert.equal(directory.some((entry) => entry.upn === 'michelle@gmt-services.co.uk'), false, 'phantom Michelle roster identity is removed');

const microsoft = normaliseUpstreamRecord({
  EmployeeName: 'Michelle Reid', EmployeeEmail: 'MichelleR.admin@gmt-services.co.uk',
  Title: '[GMT][TIMESHEET][SUBMISSION] Michelle Reid | Week 2026-09-07',
  payload: { rows: [
    { date: '2026-09-07', start: '08:00', finish: '17:00' },
    { date: '2026-09-08', start: '09:30', finish: '17:40', lunchMinutes: 30 }
  ] }
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, env);
assert.equal(microsoft.synthetic, false);
assert.equal(microsoft.employee_upn, 'micheller.admin@gmt-services.co.uk');
assert.deepEqual(microsoft.schedule_weekdays, [2, 3]);
assert.equal(microsoft.payload.rows[0].scheduled, false);
assert.equal(microsoft.payload.rows[1].scheduled, true);

const local = projectRow({
  record_id: 'michelle-real', owner_oid: 'owner', owner_upn: 'micheller.admin@gmt-services.co.uk',
  employee_name: 'Michelle Reid', kind: 'timesheets', action: 'submission', status: 'Submitted',
  start_date: '2026-09-14', end_date: '2026-09-18', record_date: '2026-09-15', payload_json: JSON.stringify({ rows: [{ date: '2026-09-15', start: '09:05', finish: '17:30' }] })
}, true, env);
assert.equal(local.synthetic, false);
assert.deepEqual(local.schedule_weekdays, [2, 3]);

console.log('Michelle and Lidia roster identity checks passed.');
