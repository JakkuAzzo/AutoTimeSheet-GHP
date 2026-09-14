import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../portal/timesheets.js', import.meta.url), 'utf8');
const ids = [
  'timesheet-history-status', 'timesheet-history-scope', 'timesheet-history-edit-policy',
  'portal-history-filter', 'portal-history-employee-filter', 'portal-history-employee',
  'timesheet-completion', 'timesheet-completion-status', 'timesheet-completion-note',
  'timesheet-completion-table', 'timesheet-history-refresh', 'portal-history-frame'
];
function element(id) {
  return {
    id, hidden: false, disabled: false, value: id === 'portal-history-filter' ? 'all' : '',
    textContent: '', innerHTML: '', contentWindow: { postMessage(message) { this.lastMessage = message; } },
    listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }
  };
}
const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
let domReady;
let messageListener;
const context = {
  window: {
    GMT_APP_CONFIG: {}, location: { origin: 'https://gmt.test', search: '' },
    addEventListener(name, callback) { if (name === 'message') messageListener = callback; }
  },
  document: {
    getElementById(id) { return elements[id] || null; },
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady = callback; }
  }
};
vm.runInNewContext(source, context, { filename: 'portal/timesheets.js' });
await domReady();

const completion = {
  pay_month: '2026-09',
  directory_configured: true,
  employees: [
    { employee_name: 'Jason', employee_upn: 'jason@gmt-services.co.uk', status: 'completed', completed_weeks: ['2026-09-07'], missing: [] },
    { employee_name: 'Matthew', employee_upn: 'matthew@gmt-services.co.uk', status: 'missing', completed_weeks: [], missing: ['Timesheet week 2026-09-07 to 2026-09-13'] }
  ],
  counts: { completed: 1, incomplete: 0, missing: 1 }
};
messageListener({
  origin: 'https://gmt.test',
  data: { type: 'gmt:history-meta', meta: { is_admin: true, upstream: 'flow-permission-not-configured', synthetic_record_count: 1, completion } }
});
assert.equal(elements['portal-history-employee-filter'].hidden, false);
assert.match(elements['portal-history-employee'].innerHTML, /Jason/);
assert.equal(elements['timesheet-completion'].hidden, false);
assert.match(elements['timesheet-completion-table'].innerHTML, /Matthew/);
assert.match(elements['timesheet-completion-table'].innerHTML, /Missing/);
assert.match(elements['timesheet-completion-note'].textContent, /Microsoft 365 history source is not connected/);
assert.match(elements['timesheet-history-edit-policy'].textContent, /All employee timesheets are viewable/);

elements['portal-history-employee'].value = 'matthew@gmt-services.co.uk';
elements['portal-history-employee'].listeners.change();
assert.match(elements['timesheet-completion-table'].innerHTML, /Matthew/);
assert.doesNotMatch(elements['timesheet-completion-table'].innerHTML, /Jason/);

messageListener({ origin: 'https://gmt.test', data: { type: 'gmt:history-records', records: [], meta: { is_admin: true, completion } } });
assert.equal(elements['timesheet-completion'].hidden, false);

console.log('Accounts timesheet filter and completion UI: PASS');
