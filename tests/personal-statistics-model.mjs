import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({ console, Intl, Date, URLSearchParams, window: {} });
for (const file of ['portal/calendar-data.js', 'portal/pay-month-workbook.js', 'portal/statistics-data.js']) vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
const stats = context.window.GMTStatistics;
const rows = [
  { kind:'timesheets', record_id:'work-a', employee_upn:'a@example.com', employee_name:'A', updated_at:'2026-10-01T00:00:00Z', payload:{rows:[{date:'2026-10-01',start:'09:00',finish:'17:00',lunchMinutes:30}]} },
  { kind:'timesheets', record_id:'work-b', employee_upn:'a@example.com', employee_name:'A', updated_at:'2026-10-02T00:00:00Z', payload:{rows:[{date:'2026-10-01',start:'09:00',finish:'17:00',lunchMinutes:30},{date:'2026-10-02',absenceReason:'Holiday'}]} },
  { kind:'timesheets', record_id:'work-c', employee_upn:'b@example.com', employee_name:'B', payload:{rows:[{date:'2026-10-01',start:'08:00',finish:'10:00',lunchMinutes:0}]} },
  { kind:'tasks', record_id:'done', employee_upn:'a@example.com', status:'Complete', completed_at:'2026-10-03' },
  { kind:'tasks', record_id:'pending', employee_upn:'a@example.com', status:'Pending', record_date:'2026-10-03' },
  { kind:'estimates', record_id:'estimate', employee_upn:'a@example.com', record_date:'2026-10-03' },
  { kind:'job-cards', record_id:'job', employee_upn:'a@example.com', record_date:'2026-10-03' }
];
const result=stats.calculate(rows,{identity:{upn:'a@example.com'},period:'all'});
assert.equal(result.values['worked-days'],1,'duplicate source rows count once');
assert.equal(result.values['worked-hours'],450,'only net minutes of the signed-in user');
assert.equal(result.values['holiday-days'],1);
assert.equal(result.values['tasks-completed'],1);
assert.equal(result.values['estimates-written'],1);
assert.equal(result.values['job-cards-raised'],1);
assert.equal(stats.calculate(rows,{identity:{upn:'b@example.com'},period:'all'}).values['worked-hours'],120);
assert.equal(stats.calculate(rows,{identity:{upn:'a@example.com'},period:'year',year:'2025'}).values['worked-days'],0);
assert.equal(stats.calculate(rows,{admin:true,employee:'b@example.com',period:'all'}).values['worked-hours'],120);
assert.equal(stats.formatMinutes(450),'7h 30m');
console.log('Statistics ownership, deduplication, net hours, dates and statuses: PASS');
