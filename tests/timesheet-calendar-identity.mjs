import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../portal/timesheets.js', import.meta.url), 'utf8');
const match = source.match(/function calendarEmployeeKey\([^)]*\) \{[\s\S]*?\n  \}/);
assert.ok(match, 'calendarEmployeeKey should be available in the timesheet calendar');
const calendarEmployeeKey = new Function(`${match[0]}; return calendarEmployeeKey;`)();

const roster = [{
  employee_name: 'Lidia Alemayoh',
  employee_upn: 'lidiaa.admin@gmt-services.co.uk'
}];
const microsoftRecord = {
  employee_upn: 'lidiaa.admin@gmt-services.co.uk',
  employee_name: 'Lidia Alemayoh'
};
const portalRecord = { employee_name: 'Lidia Alemayoh' };

assert.equal(
  calendarEmployeeKey(microsoftRecord, roster, [microsoftRecord, portalRecord]),
  calendarEmployeeKey(portalRecord, roster, [microsoftRecord, portalRecord]),
  'a unique roster-name match should share one calendar identity with its Microsoft 365 alias'
);

assert.match(
  source,
  /calendarEmployeeKey\(record, lastCompletion && lastCompletion\.employees, lastRecords\)/,
  'calendar grouping should supply roster and record context to the identity resolver'
);

console.log('Timesheet calendar identity reconciliation: PASS');
