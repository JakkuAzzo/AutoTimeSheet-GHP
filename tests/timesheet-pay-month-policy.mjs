import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import payPeriods from '../pay-periods.js';
import {
  isCurrentPayMonthRecord,
  monthKeyInTimeZone,
  projectRow,
  recordMonthKey
} from '../cloudflare-worker/src/index.js';

const historyFrame = fs.readFileSync(new URL('../portal/history-frame.js', import.meta.url), 'utf8');
const historyPage = fs.readFileSync(new URL('../portal/timesheets.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../cloudflare-worker/src/index.js', import.meta.url), 'utf8');
const calendarActions = fs.readFileSync(new URL('../portal/calendar-actions.js', import.meta.url), 'utf8');
const contract = JSON.parse(fs.readFileSync(new URL('../power-platform/portal-timesheet-history-contract.json', import.meta.url), 'utf8'));

const timeZone = 'Europe/London';
const todayParts = new Intl.DateTimeFormat('en-GB', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).formatToParts(new Date());
const today = `${todayParts.find((part) => part.type === 'year')?.value}-${todayParts.find((part) => part.type === 'month')?.value}-${todayParts.find((part) => part.type === 'day')?.value}`;
const currentPayMonth = payPeriods.payMonthKeyForDate(today);
const previousPayMonth = payPeriods.previousPayMonthKey(currentPayMonth);
const olderPayMonth = payPeriods.previousPayMonthKey(previousPayMonth);
const currentPeriod = payPeriods.periodForMonth(currentPayMonth);
const previousPeriod = payPeriods.periodForMonth(previousPayMonth);
const olderPeriod = payPeriods.periodForMonth(olderPayMonth);
assert.ok(currentPeriod && previousPeriod && olderPeriod, 'pay-period helper should resolve current, previous, and older cycles');

const knownPeriod = payPeriods.periodForDate('2026-08-24');
assert.equal(knownPeriod.cycleEnd, '2026-09-20', 'the cycle includes Sunday 20 September');
assert.equal(knownPeriod.payrollFriday, '2026-09-18', 'the payroll processing date is the preceding Friday');
assert.notEqual(knownPeriod.cycleEnd, knownPeriod.payrollFriday, 'cycle end and payroll Friday remain distinct dates');

const currentRecord = {
  record_id: 'timesheet-current-pay-month',
  owner_upn: 'employee@gmt-services.co.uk',
  employee_name: 'Employee',
  kind: 'timesheets',
  action: 'submission',
  status: 'Submitted',
  start_date: currentPeriod.start,
  end_date: `${currentPayMonth}-07`,
  record_date: currentPeriod.start,
  submitted_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  payload_json: '{}'
};
const previousRecord = {
  ...currentRecord,
  record_id: 'timesheet-previous-pay-month',
  employee_name: 'Previous employee',
  start_date: previousPeriod.start,
  end_date: previousPeriod.end,
  record_date: previousPeriod.start
};
const olderRecord = {
  ...currentRecord,
  record_id: 'timesheet-older-pay-month',
  employee_name: 'Older employee',
  start_date: olderPeriod.start,
  end_date: olderPeriod.end,
  record_date: olderPeriod.start
};

assert.equal(recordMonthKey(currentRecord.start_date, timeZone), currentPeriod.start.slice(0, 7));
assert.equal(payPeriods.payMonthKeyForDate(currentRecord.start_date), currentPayMonth);
assert.equal(isCurrentPayMonthRecord(currentRecord, timeZone), true);
assert.equal(isCurrentPayMonthRecord(previousRecord, timeZone), true);
assert.equal(isCurrentPayMonthRecord(olderRecord, timeZone), false);
assert.equal(projectRow(currentRecord).can_edit, true);
assert.equal(projectRow(previousRecord).can_edit, true);
assert.equal(projectRow(olderRecord).can_edit, false);

const elements = {
  'history-frame-status': { textContent: '', innerHTML: '' },
  'history-frame-list': { textContent: '', innerHTML: '' }
};
let domReady;
const historyContext = {
  window: {
    GMT_APP_CONFIG: { portalApiEndpoint: '/api/history' },
    GMTPortalApi: { history: async () => ({ records: [projectRow(currentRecord), projectRow(previousRecord), projectRow(olderRecord)], meta: {} }) },
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
assert.match(elements['history-frame-list'].innerHTML, /Older employee/);
assert.match(elements['history-frame-list'].innerHTML, /history-frame\.html\?edit=timesheet-current-pay-month/);
assert.doesNotMatch(elements['history-frame-list'].innerHTML, /history-frame\.html\?edit=timesheet-previous-pay-month/);
assert.doesNotMatch(elements['history-frame-list'].innerHTML, /history-frame\.html\?edit=timesheet-older-pay-month/);
assert.match(elements['history-frame-list'].innerHTML, /Viewable at any time; editing is limited to the current pay month\./);

assert.match(historyPage, /All timesheets may be viewed\. New entries can be filed for any date; permitted users can correct records in the current or previous pay month\. Earlier pay months remain read-only\./);
assert.match(historyFrame, /Viewable at any time; editing is limited to the current pay month\./);
assert.match(historyFrame, /function currentPayMonth\(\)/);
assert.match(historyFrame, /Only timesheets made within the current pay month may be edited\./);
assert.match(worker, /isCurrentPayMonthRecord/);
assert.match(worker, /Only the current and previous pay months may be edited\./);
assert.match(worker, /import payPeriods from ['"]\.\.\/\.\.\/pay-periods\.js['"]/);
assert.match(worker, /function defaultPayPeriods\(\)\s*\{\s*return payPeriods;\s*\}/);
assert.match(calendarActions, /Cycle start:/);
assert.match(calendarActions, /Cycle end:/);
assert.match(calendarActions, /Payroll Friday:/);
assert.doesNotMatch(worker, /globalThis\.GMTPayPeriods/);
assert.equal(contract.editing.window, 'current-pay-month');
assert.equal(contract.visibility.timesheetHistory, 'all authorised timesheets remain viewable');

console.log(JSON.stringify({
  currentPayMonth,
  currentRecordEditable: projectRow(currentRecord).can_edit,
  previousRecordEditable: projectRow(previousRecord).can_edit,
  olderRecordEditable: projectRow(olderRecord).can_edit,
  historyRemainsVisible: true
}));
