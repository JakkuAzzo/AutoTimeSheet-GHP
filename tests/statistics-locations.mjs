import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';
const ctx=vm.createContext({window:{},console,Intl,Date});
for(const f of ['portal/calendar-data.js','portal/pay-month-workbook.js','portal/statistics-data.js','tools/stats-locations.js'])vm.runInContext(readFileSync(f,'utf8'),ctx,{filename:f});
const records=[
 {kind:'clock',record_id:'a',employee_upn:'a@example.com',record_date:'2026-10-01',status:'Approved',payload:{source:'approved-offsite-shift',date:'2026-10-01',location:'Croydon site'}},
 {kind:'clock',record_id:'a-copy',employee_upn:'a@example.com',record_date:'2026-10-01',status:'Approved',payload:{source:'approved-offsite-shift',date:'2026-10-01',location:'Croydon site'}},
 {kind:'clock',record_id:'b',employee_upn:'a@example.com',record_date:'2026-10-02',status:'Approved',payload:{source:'approved-offsite-shift',date:'2026-10-02',location:'Croydon site'}},
 {kind:'clock',record_id:'c',employee_upn:'b@example.com',record_date:'2026-10-02',status:'Approved',payload:{source:'approved-offsite-shift',date:'2026-10-02',location:'Other site'}},
 {kind:'clock',record_id:'office',employee_upn:'a@example.com',record_date:'2026-10-03',action:'clock_in',payload:{locationMode:'in_office',date:'2026-10-03',action:'clock_in'}},
 {kind:'clock',record_id:'absence',employee_upn:'a@example.com',record_date:'2026-10-04',action:'absent',payload:{locationMode:'in_office',date:'2026-10-04',action:'absent'}},
 {kind:'timesheets',record_id:'leave-with-site',employee_upn:'a@example.com',payload:{rows:[{date:'2026-10-05',start:'09:00',absenceReason:'Holiday',location:'Not a visit'}]}},
 {kind:'job-cards',record_id:'job',employee_upn:'a@example.com',record_date:'2026-10-03',site:'Not proof of attendance'},
 {kind:'clock',record_id:'rejected',employee_upn:'a@example.com',record_date:'2026-10-04',status:'Rejected',payload:{source:'approved-offsite-shift',location:'Rejected site'}}
];
const result=ctx.window.GMTStatsLocations.collect(records,{identity:{upn:'a@example.com'},period:'all'});
assert.equal(result.visits.length,3,'duplicate employee/date/site counts once and explicitly recorded office attendance appears');
assert.equal(result.places.length,2);assert.equal(result.places[0].name,'Croydon site');assert.equal(result.places[0].visits,2);assert.match(result.places[1].name,/GMT workshop/);
assert.equal(ctx.window.GMTStatsLocations.collect(records,{identity:{upn:'a@example.com'},period:'year',year:'2025'}).visits.length,0);
assert.equal(ctx.window.GMTStatsLocations.collect(records,{admin:true,employee:'b@example.com',period:'all'}).places[0].name,'Other site');
console.log('Work-location scope, attendance, deduplication and periods: PASS');
