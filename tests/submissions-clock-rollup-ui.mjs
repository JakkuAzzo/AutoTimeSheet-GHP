import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const calendarSource = fs.readFileSync(new URL('../portal/calendar-data.js', import.meta.url), 'utf8');
const calendarContext = { window: {} };
vm.runInNewContext(calendarSource, calendarContext, { filename: 'portal/calendar-data.js' });
const calendar = calendarContext.window.GMTCalendarData;
const source = fs.readFileSync(new URL('../portal/submissions.js', import.meta.url), 'utf8');

function element(id, attributes = {}) {
  return {
    id, value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', attributes,
    listeners: {}, classList: { toggle() {}, add() {}, remove() {} }, dataset: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelectorAll() { return []; }, querySelector() { return null; },
    insertAdjacentHTML() {}
  };
}

const ids = [
  'submissions-status', 'submissions-list', 'submissions-preview', 'submissions-filter',
  'submissions-pay-month', 'submissions-day', 'pay-month-list-title', 'pay-month-list-count',
  'submissions-employee-filter', 'submissions-employee', 'submissions-refresh',
  'submissions-delivery-trigger', 'submissions-delivery-dialog', 'submissions-delivery-details',
  'download-all-sheets', 'download-all-sheets-status'
];
const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
const tabs = ['all', 'timesheets', 'calendar', 'enquiries', 'job-cards', 'estimates', 'tasks'].map((value) => element('tab-' + value, { 'data-submission-tab': value }));
const kicker = element('pay-month-kicker');
let domReady;
const employee = { employee_name: 'Michelle Reid', employee_upn: 'MichelleR.admin@gmt-services.co.uk' };
const roster = [{ employee_name: 'Michelle Reid', employee_upn: 'micheller.admin@gmt-services.co.uk' }];
const records = [
  { employee_name: 'Michelle Reid', employee_upn: 'micheller.admin@gmt-services.co.uk', kind: 'timesheets', action: 'submission', status: 'Queued for Accounts', record_date: '2026-10-13', source_record_id: 'timesheet-week', updated_at: '2026-10-13T16:09:00Z', payload: { rows: [{ Date: '2026-10-13', Start: '08:45', Finish: '17:00', 'Lunch start': '14:00', 'Lunch end': '14:30', Break: 30, 'Worked hours': 7.75 }] } },
  { ...employee, kind: 'clock', action: 'clock_in', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'clock-in', updated_at: '2026-10-13T08:45:00Z', payload: { row: { Date: '2026-10-13', Start: '08:45' } } },
  { ...employee, kind: 'clock', action: 'lunch_start', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'lunch-start', updated_at: '2026-10-13T14:00:00Z', payload: { row: { Date: '2026-10-13', 'Lunch start': '14:00' } } },
  { ...employee, kind: 'clock', action: 'lunch_end', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'lunch-end', updated_at: '2026-10-13T14:30:00Z', payload: { row: { Date: '2026-10-13', 'Lunch end': '14:30' } } },
  { ...employee, kind: 'clock', action: 'clock_out', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'clock-out', updated_at: '2026-10-13T17:00:00Z', payload: { row: { Date: '2026-10-13', Finish: '17:00' } } },
  { ...employee, kind: 'calendar', action: 'calendar_request', status: 'Pending approval', record_date: '2026-10-13', source_record_id: 'calendar-request', updated_at: '2026-10-13T17:10:00Z', payload: { rows: [{ date: '2026-10-13' }] } },
  { ...employee, kind: 'timesheets', action: 'submission', status: 'Submitted', start_date: '2026-10-13', end_date: '2026-11-02', source_record_id: 'timesheet-cross-month', updated_at: '2026-11-02T17:10:00Z', payload: { rows: [{ Date: '2026-10-13' }, { Date: '2026-11-02' }] } },
  { ...employee, kind: 'enquiries', action: 'customer_enquiry', status: 'New', record_date: '2026-10-13', source_record_id: 'enquiry-source', customer_name: 'Customer', payload: { rows: [{ date: '2026-10-13' }] } },
  { ...employee, kind: 'job-cards', action: 'job_card', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'job-card-source', payload: { rows: [{ date: '2026-10-13' }] } },
  { ...employee, kind: 'estimates', action: 'estimate', status: 'Submitted', record_date: '2026-10-13', source_record_id: 'estimate-source', payload: { rows: [{ date: '2026-10-13' }] } },
  { ...employee, kind: 'tasks', action: 'task', status: 'Open', record_date: '2026-10-13', source_record_id: 'task-source', payload: { rows: [{ date: '2026-10-13' }] } }
];
const context = {
  window: {
    location: { search: '?day=2026-10-13' },
    GMTCalendarData: calendar,
    GMTPayPeriods: { payMonthKeyForDate(date) { return String(date).slice(0, 7); } },
    GMTPortalApi: { enabled() { return true; }, async history() { return { records, meta: { can_view_all_timesheets: false, visible_scope: 'this account submissions', completion: { employees: roster } } }; } }
  },
  document: {
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) { return selector === '[data-submission-tab]' ? tabs : []; },
    querySelector(selector) { return selector === '[data-pay-month-list-kicker]' ? kicker : null; },
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady = callback; }
  }
};

vm.runInNewContext(source, context, { filename: 'portal/submissions.js' });
await domReady();
assert.equal(elements['submissions-status'].textContent, '11 authorised records loaded. Access: this account submissions.');
tabs[0].listeners.click();
assert.equal(elements['pay-month-list-count'].textContent, '11 items', 'the all-records view count matches the authorised source-record count');
assert.match(elements['submissions-list'].innerHTML, /Timesheet/);
assert.match(elements['submissions-list'].innerHTML, /Clock \/ breaks/, 'the all-records view retains individual clock source records');
assert.match(elements['submissions-preview'].innerHTML, /Source record ID:<\/strong> timesheet-week/, 'the selected source version is identifiable by its authoritative record ID');
assert.match(elements['submissions-preview'].innerHTML, /Queued for Accounts/);
tabs[2].listeners.click();
assert.equal(elements['pay-month-list-count'].textContent, '1 item', 'the category filter reduces the all-records list to matching records');
assert.match(elements['submissions-list'].innerHTML, /Calendar request/);
tabs[0].listeners.click();
elements['submissions-day'].value = '2026-10-13';
elements['submissions-day'].listeners.change();
elements['submissions-pay-month'].value = '2026-11';
elements['submissions-pay-month'].listeners.change();
assert.equal(elements['pay-month-list-count'].textContent, '0 items', 'month and day filters cannot be satisfied by different rows in the same source record');
elements['submissions-day'].value = '2026-11-02';
elements['submissions-day'].listeners.change();
assert.equal(elements['pay-month-list-count'].textContent, '1 item', 'a multi-month source record appears once for a matching later pay month');
assert.match(elements['submissions-preview'].innerHTML, /Source record ID:<\/strong> timesheet-cross-month/);
elements['submissions-pay-month'].value = '2026-10';
elements['submissions-pay-month'].listeners.change();
elements['submissions-day'].value = '2026-10-13';
elements['submissions-day'].listeners.change();
for (const [index, sourceId] of [[3, 'enquiry-source'], [4, 'job-card-source'], [5, 'estimate-source'], [6, 'task-source']]) {
  tabs[index].listeners.click();
  assert.match(elements['submissions-preview'].innerHTML, new RegExp('Source record ID:<\\/strong> ' + sourceId), 'specialized previews expose their authoritative source record ID');
}

console.log('Submitted Documents source-record count and identity: PASS');
