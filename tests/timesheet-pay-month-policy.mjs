import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  isCurrentPayMonthRecord,
  monthKeyInTimeZone,
  projectRow,
  recordMonthKey
} from '../cloudflare-worker/src/index.js';

const historyFrame = fs.readFileSync(new URL('../portal/history-frame.js', import.meta.url), 'utf8');
const historyPage = fs.readFileSync(new URL('../portal/timesheets.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../cloudflare-worker/src/index.js', import.meta.url), 'utf8');
const contract = JSON.parse(fs.readFileSync(new URL('../power-platform/portal-timesheet-history-contract.json', import.meta.url), 'utf8'));

const timeZone = 'Europe/London';
const currentPayMonth = monthKeyInTimeZone(new Date(), timeZone);
const [year, month] = currentPayMonth.split('-').map(Number);
const previousDate = new Date(Date.UTC(year, month - 2, 1, 12, 0, 0));
const previousPayMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;

const currentRecord = {
  record_id: 'timesheet-current-pay-month',
  owner_upn: 'employee@gmt-services.co.uk',
  employee_name: 'Employee',
  kind: 'timesheets',
  action: 'submission',
  status: 'Submitted',
  start_date: `${currentPayMonth}-01`,
  end_date: `${currentPayMonth}-07`,
  record_date: `${currentPayMonth}-01`,
  submitted_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  payload_json: '{}'
};
const previousRecord = {
  ...currentRecord,
  record_id: 'timesheet-previous-pay-month',
  employee_name: 'Previous employee',
  start_date: `${previousPayMonth}-01`,
  end_date: `${previousPayMonth}-07`,
  record_date: `${previousPayMonth}-01`
};

assert.equal(recordMonthKey(currentRecord.start_date, timeZone), currentPayMonth);
assert.equal(isCurrentPayMonthRecord(currentRecord, timeZone), true);
assert.equal(isCurrentPayMonthRecord(previousRecord, timeZone), false);
assert.equal(projectRow(currentRecord).can_edit, true);
assert.equal(projectRow(previousRecord).can_edit, false);

const elements = {
  'history-frame-status': { textContent: '', innerHTML: '' },
  'history-frame-list': { textContent: '', innerHTML: '' }
};
let domReady;
const historyContext = {
  window: {
    GMT_APP_CONFIG: { portalApiEndpoint: '/api/history' },
    GMTPortalApi: { history: async () => ({ records: [projectRow(currentRecord), projectRow(previousRecord)], meta: {} }) },
    location: { search: '' },
    addEventListener() {}
  },
  document: {
    getElementById(id) { return elements[id] || null; },
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady = callback; }
  },
  URLSearchParams
};
vm.runInNewContext(historyFrame, historyContext, { filename: 'portal/history-frame.js' });
await domReady();
assert.match(elements['history-frame-list'].innerHTML, /Employee/);
assert.match(elements['history-frame-list'].innerHTML, /Previous employee/);
assert.match(elements['history-frame-list'].innerHTML, /history-frame\.html\?edit=timesheet-current-pay-month/);
assert.doesNotMatch(elements['history-frame-list'].innerHTML, /history-frame\.html\?edit=timesheet-previous-pay-month/);
assert.match(elements['history-frame-list'].innerHTML, /Viewable at any time; editing is limited to the current pay month\./);

assert.match(historyPage, /All timesheets made by this user may be viewed, but only timesheets made within the current pay month may be edited\./);
assert.match(historyFrame, /Viewable at any time; editing is limited to the current pay month\./);
assert.match(historyFrame, /function currentPayMonth\(\)/);
assert.match(historyFrame, /Only timesheets made within the current pay month may be edited\./);
assert.match(worker, /isCurrentPayMonthRecord/);
assert.match(worker, /Only timesheets made within the current pay month may be edited\./);
assert.equal(contract.editing.window, 'current-pay-month');
assert.equal(contract.visibility.timesheetHistory, 'all authorised timesheets remain viewable');

console.log(JSON.stringify({
  currentPayMonth,
  currentRecordEditable: projectRow(currentRecord).can_edit,
  previousRecordEditable: projectRow(previousRecord).can_edit,
  historyRemainsVisible: true
}));
