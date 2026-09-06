import fs from 'node:fs';

const contract = JSON.parse(fs.readFileSync(new URL('../power-platform/portal-timesheet-history-contract.json', import.meta.url)));
const config = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../portal/timesheets.js', import.meta.url), 'utf8');

if (contract.securityModel !== 'server-enforced Entra identity mapping') throw new Error('History must be server-enforced');
if (contract.visibility.ordinaryEmployees !== 'own records only') throw new Error('Employee scope is not own-records-only');
if (contract.visibility.rawWorkbookLinks !== false) throw new Error('Raw workbook links must remain hidden');
if (!config.includes('timesheetHistoryEndpoint:')) throw new Error('History endpoint config is missing');
if (!page.includes('credentials: "include"')) throw new Error('History request must include authenticated credentials');
if (!page.includes('not exposed here')) throw new Error('Blank endpoint must not expose the SharePoint register');

console.log(JSON.stringify({
  securityModel: contract.securityModel,
  employeeVisibility: contract.visibility.ordinaryEmployees,
  administrators: contract.visibility.allEmployeeAdministrators,
  rawWorkbookLinks: contract.visibility.rawWorkbookLinks,
  endpointConfigured: /timesheetHistoryEndpoint:\s*"[^"]+"/.test(config)
}));
