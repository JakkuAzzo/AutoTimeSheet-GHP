import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const start = source.indexOf('function buildTimesheetRecordFile(');
const end = source.indexOf('\nfunction submissionKeyPart', start);
assert.ok(start > 0 && end > start);
const rows = [
  {Date:'2026-08-31',Status:'Worked',Start:'08:00',Finish:'17:00',Break:'30 mins',
    'Worked hours':8.5,'Basic hours':8,'OT x1.5 hours':0.5,'OT x2.0 hours':0,'Absence reason':'NA',Note:'Original entry'},
  {Date:'2026-09-01',Status:'Absence',Start:'',Finish:'',Break:'No break',
    'Worked hours':0,'Basic hours':0,'OT x1.5 hours':0,'OT x2.0 hours':0,'Absence reason':'Sick',Note:''}
];
const context = vm.createContext({File, allRowsForExport:()=>rows,
  employeeName:{value:'Validation Employee'}, employeeEmail:{value:'validation@example.com'}});
vm.runInContext(source.slice(start,end),context);
const file = context.buildTimesheetRecordFile({weekStart:'2026-08-31',weekEnd:'2026-09-06',
  employeeUpn:'validation@example.com',submittedAt:'2026-09-06T16:00:00Z'}, [], 'validation-week');
const records = JSON.parse(await file.text());
assert.ok(Array.isArray(records));
assert.equal(records.length,2);
assert.equal(records[0].recordId,'validation-week|2026-08-31');
assert.equal(records[1].recordId,'validation-week|2026-09-01');
assert.equal(records[1].date,'2026-09-01');
assert.equal(records[0].basicHours,8);
assert.equal(records[0].startTime,'08:00');
assert.equal(records[0].finishTime,'17:00');
assert.equal(records[0].ot15Hours,0.5);
assert.equal(records[1].absenceReason,'Sick');
assert.equal(records[0].submittedAt,records[1].submittedAt);
assert.match(file.name,/2026-08-31.json$/);
assert.ok(records.every(record=>!Array.isArray(record)));
console.log('Daily timesheet records: dates, month boundaries, hours and absence preservation passed.');
