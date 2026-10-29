import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../portal/calendar-data.js', import.meta.url), 'utf8'), context);
const load = context.window.GMTCalendarData.loadHistory;
assert.equal(typeof load, 'function', 'the calendar must load all authorised history pages');
const calls = [];
const shared = { source_record_id: 'shared', kind: 'calendar' };
const result = await load({ history: async (kind, options) => {
  calls.push([kind, options.offset, options.limit]);
  if (options.offset === 0) return { records: [shared, { source_record_id: 'new' }], meta: { completion: { employees: [] }, history_pagination: { has_more: true, next_offset: 1000 } } };
  return { records: [shared, { source_record_id: 'old' }], meta: { history_pagination: { has_more: false } } };
}});
assert.deepEqual(calls, [['all', 0, 1000], ['all', 1000, 1000]]);
assert.deepEqual(Array.from(result.records, r => r.source_record_id), ['shared', 'new', 'old']);
assert.ok(result.meta.completion);
await assert.rejects(() => load({ history: async () => ({ records: [], meta: { history_pagination: { has_more: true, next_offset: 0 } } }) }), /pagination/i);
await assert.rejects(() => load({ history: async (_, options) => options.offset ? Promise.reject(new Error('failed page')) : ({ records: [], meta: { history_pagination: { has_more: true, next_offset: 1000 } } }) }), /failed page/);
console.log('Calendar history pagination: PASS');
const calendar = context.window.GMTCalendarData;
const offSchedule = calendar.recordsToEvents([{ kind: 'timesheets', source_record_id: 'extra', employee_name: 'Test Person', employee_upn: 'test@example.invalid', payload: { rows: [
  { date: '2026-10-29', start: '09:00', finish: '17:00', lunchMinutes: 30 },
  { date: '2026-10-30', absenceStatus: 'Un-Paid', start: '09:00', finish: '17:00' }
] } }], { employees: [{ name: 'Test Person', upn: 'test@example.invalid', workdays: [1, 2] }] });
assert.ok(offSchedule.some(event => event.date === '2026-10-29'), 'actual work remains visible outside the normal roster');
assert.ok(!offSchedule.some(event => event.date === '2026-10-30'), 'an unscheduled absence placeholder is not invented as a work day');
const incomplete = await load({ history: async () => ({ records: [{ source_record_id: 'local' }], meta: { upstream: 'flow-permission-not-configured', history_pagination: { has_more: false } } }) });
assert.equal(incomplete.meta.calendar_history_incomplete, true, 'failed upstream must be surfaced as incomplete');
const complete = await load({ history: async () => ({ records: [], meta: { upstream: 'ok', history_pagination: { has_more: false } } }) });
assert.notEqual(complete.meta.calendar_history_incomplete, true);
let probeOptions;
await load({ history: async (_kind, options) => { probeOptions = options; return { records: [], meta: {} }; } }, { source: 'sharepoint-check' });
assert.equal(probeOptions.source, 'sharepoint-check', 'the restricted diagnostic source reaches each page request');
