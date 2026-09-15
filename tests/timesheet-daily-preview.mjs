import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../portal/timesheets.js', import.meta.url), 'utf8');
const ids = [
  'timesheet-history-status', 'timesheet-history-link', 'timesheet-history-scope',
  'timesheet-history-list', 'timesheet-history-preview', 'timesheet-calendar-title',
  'timesheet-calendar-previous', 'timesheet-calendar-next', 'timesheet-calendar-picker',
  'portal-history-filter', 'portal-history-employee-filter', 'portal-history-employee',
  'timesheet-completion', 'timesheet-completion-status', 'timesheet-completion-note',
  'timesheet-completion-table', 'timesheet-history-refresh', 'timesheet-history-edit-policy'
];

function element(id) {
  const item = {
    id,
    hidden: false,
    disabled: false,
    value: id === 'portal-history-filter' ? 'all' : '',
    textContent: '',
    innerHTML: '',
    listeners: {},
    classList: { contains: (name) => id === 'timesheet-history-list' && name === 'timesheet-calendar-grid' },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    querySelectorAll() { return []; }
  };
  return item;
}

const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
let domReady;
let messageListener;
const context = {
  window: {
    GMT_APP_CONFIG: {},
    location: { origin: 'https://gmt.test', search: '' },
    addEventListener(name, callback) { if (name === 'message') messageListener = callback; }
  },
  document: {
    getElementById(id) { return elements[id] || null; },
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady = callback; }
  }
};
vm.runInNewContext(source, context, { filename: 'portal/timesheets.js' });
await domReady();

const weekly = {
  kind: 'timesheets', employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk',
  start_date: '2026-09-07', end_date: '2026-09-13', record_date: '2026-09-07',
  action: 'submission', status: 'Submitted', submitted_at: '2026-09-09T12:00:00Z',
  updated_at: '2026-09-09T12:00:00Z', source: 'microsoft-365', source_record_id: 'matthew-week',
  payload: { rows: [
    { recordId: 'matthew-week|2026-09-07', submissionId: 'matthew-week', date: '2026-09-07', startTime: '08:00', finishTime: '18:00', lunchHad: false, lunchMinutes: 0, workedHours: 10, basicHours: 10, absenceStatus: 'NA', note: 'No break' },
    { recordId: 'matthew-week|2026-09-08', submissionId: 'matthew-week', date: '2026-09-08', startTime: '08:00', finishTime: '18:00', workedHours: 9.5, basicHours: 9.5, note: 'Break: 30 minutes deducted' },
    { recordId: 'matthew-week|2026-09-09', submissionId: 'matthew-week', date: '2026-09-09', absenceStatus: 'NA' },
    { recordId: 'matthew-week|2026-09-10', submissionId: 'matthew-week', date: '2026-09-10', absenceStatus: 'Sick', status: 'Absent' }
  ] }
};
const clockIn = {
  kind: 'clock', action: 'clock_in', status: 'Submitted', employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk',
  record_date: '2026-09-09', source: 'microsoft-365', source_record_id: 'clock-matthew-2026-09-09-in',
  payload: { row: { Date: '2026-09-09', Start: '08:00', Status: 'Recorded', 'Absence reason': 'NA' } }
};
const request = {
  kind: 'calendar', action: 'request', status: 'Approved', employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk',
  record_date: '2026-09-11', event_date: '2026-09-11', event_title: 'Holiday', event_type: 'Holiday',
  source: 'portal-d1', source_record_id: 'calendar-matthew-holiday'
};
const michelleBatch = {
  kind: 'timesheets', employee_name: 'Michelle', employee_upn: 'michelle@gmt-services.co.uk', schedule_weekdays: [2, 3],
  start_date: '2026-09-07', end_date: '2026-09-13', record_date: '2026-09-07',
  action: 'submission', status: 'Submitted', source: 'microsoft-365', source_record_id: 'michelle-week',
  payload: { data: { values: [
    { date: '2026-09-07', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-08', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-09', startTime: '08:00', finishTime: '17:00', workedHours: 8 },
    { date: '2026-09-10', startTime: '08:00', finishTime: '17:00', workedHours: 8 }
  ] } }
};
messageListener({
  origin: 'https://gmt.test',
  data: {
    type: 'gmt:history-records',
    records: [weekly, clockIn, request, michelleBatch],
    meta: {
      is_admin: true,
      upstream: 'ok',
      completion: {
        pay_month: '2026-09', counts: { completed: 0, incomplete: 1, missing: 0 }, directory_configured: true,
        employees: [{ employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk', status: 'incomplete', submitted_records: 1, completed_weeks: [], missing: [] }]
      }
    }
  }
});

assert.match(elements['timesheet-history-preview'].innerHTML, /08:00/);
assert.match(elements['timesheet-history-preview'].innerHTML, /18:00/);
assert.match(elements['timesheet-history-preview'].innerHTML, /Confirmed not taken/);
assert.match(elements['timesheet-history-preview'].innerHTML, /Added · 30m/);
assert.match(elements['timesheet-history-preview'].innerHTML, /9h 30m/);
assert.match(elements['timesheet-history-preview'].innerHTML, /Clock out missing/);
assert.match(elements['timesheet-history-preview'].innerHTML, /data-label="Clock in">08:00/);
assert.match(elements['timesheet-history-preview'].innerHTML, /Sick/);
assert.match(elements['timesheet-history-preview'].innerHTML, /Pay-month spreadsheet/);
assert.match(elements['timesheet-history-preview'].innerHTML, /2026-09-08/);
assert.match(elements['timesheet-history-list'].innerHTML, /Matthew/);
assert.match(elements['timesheet-history-list'].innerHTML, /10h · 08:00–18:00/);
const calendarLabels = [...elements['timesheet-history-list'].innerHTML.matchAll(/data-calendar-date="([^"]+)"[^>]*><strong>([^<]+)/g)].map((match) => ({ date: match[1], employee: match[2] }));
assert.ok(calendarLabels.some((label) => label.date === '2026-09-08' && label.employee === 'Michelle'));
assert.equal(calendarLabels.some((label) => label.date === '2026-09-07' && label.employee === 'Michelle'), false);
assert.equal(calendarLabels.some((label) => label.date === '2026-09-10' && label.employee === 'Michelle'), false);
assert.match(elements['timesheet-completion-table'].innerHTML, /Absence \/ requests/);
assert.match(elements['timesheet-completion-table'].innerHTML, /Approved/);
assert.match(elements['timesheet-completion-table'].innerHTML, /19\.5h/);
console.log('Daily timesheet preview: joined clock events, break states, totals, flags and requests: PASS');
