import assert from 'node:assert/strict';
import { normaliseInput, isCurrentPayMonthRecord, canAccessRecord, validatePayMonthCorrection, listRecords } from '../cloudflare-worker/src/index.js';

const env = { STAFF_DIRECTORY_JSON: JSON.stringify([
  { name: 'Matthew', upn: 'matthew@gmt-services.co.uk' },
  { name: 'Simon', upn: 'simon@gmt-services.co.uk' }
]) };
const admin = { oid: 'accounts-oid', upn: 'acc.gmtelect@gmt-services.co.uk', name: 'Accounts', isAdmin: true };
const correction = {
  recordId: 'gmt-paymonth-2026-09-matthew-gmt-services-co-uk',
  kind: 'timesheets', action: 'pay_month_correction', editMode: true,
  employeeName: 'Matthew', employeeEmail: 'matthew@gmt-services.co.uk',
  payload: { payMonth: '2026-09', rows: [{ date: '2026-09-03', start: '08:00', finish: '18:00', lunchMinutes: 30 }] }
};

const onBehalf = normaliseInput(correction, admin, null, env);
assert.equal(onBehalf.employeeName, 'Matthew');
assert.equal(onBehalf.ownerUpn, 'matthew@gmt-services.co.uk');
assert.equal(onBehalf.ownerOid, 'accounts-oid');
assert.equal(JSON.parse(onBehalf.payloadJson).payMonth, '2026-09');

assert.throws(() => normaliseInput({ ...correction, employeeEmail: 'unknown@example.com' }, admin, null, env), /GMT address|roster/i);
const historical = normaliseInput({ ...correction, employeeName: 'Lidia Alemayoh', employeeEmail: 'lidiaa.admin@gmt-services.co.uk' }, admin, null, env);
assert.equal(historical.ownerUpn, 'lidiaa.admin@gmt-services.co.uk');
const simon = normaliseInput(correction, { oid: 'simon-oid', upn: 'simon@gmt-services.co.uk', name: 'Simon', isAdmin: false }, null, env);
assert.equal(simon.employeeName, 'Simon');
assert.equal(simon.ownerUpn, 'simon@gmt-services.co.uk');

const now = new Date('2026-09-27T12:00:00Z');
assert.equal(isCurrentPayMonthRecord({ kind: 'timesheets', payload_json: JSON.stringify({ payMonth: '2026-09' }) }, 'Europe/London', now), true);
assert.equal(isCurrentPayMonthRecord({ kind: 'timesheets', payload_json: JSON.stringify({ payMonth: '2026-08' }) }, 'Europe/London', now), false);

validatePayMonthCorrection(correction, now);
assert.throws(() => validatePayMonthCorrection({ ...correction, payload: { ...correction.payload, rows: [{ date: '2026-09-22' }] } }, now), /pay month/i);
assert.throws(() => validatePayMonthCorrection({ ...correction, payload: { ...correction.payload, payMonth: '2026-08' } }, now), /editable/i);
const stored = { kind: 'timesheets', action: 'pay_month_correction', owner_oid: 'accounts-oid', owner_upn: 'matthew@gmt-services.co.uk' };
assert.equal(canAccessRecord({ oid: 'matthew-oid', upn: 'matthew@gmt-services.co.uk', isAdmin: false }, stored), true);
assert.equal(canAccessRecord({ oid: 'simon-oid', upn: 'simon@gmt-services.co.uk', isAdmin: false }, stored), false);

let historyQuery = null;
const historyEnv = {
  DB: { prepare(sql) { return { bind(...bindings) { historyQuery = { sql, bindings }; return { async all() { return { results: [] }; } }; } }; } }
};
await listRecords(new Request('https://gmt-portal-api.example/api/history?kind=timesheets'), historyEnv, { oid: 'matthew-oid', upn: 'matthew@gmt-services.co.uk', isAdmin: false });
assert.match(historyQuery.sql, /pay_month_correction/);
assert.deepEqual(historyQuery.bindings.slice(0, 3), ['matthew-oid', 'matthew@gmt-services.co.uk', 'timesheets']);
