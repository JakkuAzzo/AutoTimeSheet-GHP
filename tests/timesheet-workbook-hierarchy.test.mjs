import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimesheetWorkbookHierarchy } from '../cloudflare-worker/src/timesheet-workbook-hierarchy.js';

const personA='11111111-1111-4111-8111-111111111111',personB='22222222-2222-4222-8222-222222222222';
const period={payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18'};
const row=(id,date,total,basic,ot15,ot20)=>({recordId:id,date,totalMinutes:total,breakMinutes:0,sourceBasicMinutes:basic,sourceOt15Minutes:ot15,sourceOt20Minutes:ot20,note:'fictional'});
const snap=(employeeOid,employeeUpn,employeeName,rows,other={})=>({...period,employeeOid,employeeUpn,employeeName,sourceGeneration:'a'.repeat(64),rows,...other});

test('company month and year use the same employee snapshots and preserve unknown rates',()=>{
 const first=snap(personA,'one@example.test','One',[row('one-a','2026-09-25',180,120,60,0),row('one-b','2026-10-06',120,null,0,null)]);
 const second=snap(personB,'two@example.test','Two',[row('two-a','2026-10-07',240,240,0,0)]);
 const out=buildTimesheetWorkbookHierarchy({year:2026,snapshots:[second,first]});
 assert.equal(out.employeeMonths.length,2);assert.equal(out.months.length,12);
 const month=out.months[9];assert.equal(month.payMonth,'2026-10');assert.equal(month.available,true);assert.equal(month.rows.length,3);
 assert.equal(month.coverage,'unverified');assert.equal(out.yearly.coverage,'unverified');
 assert.deepEqual(month.totals.worked,{value:540,known:540,unknownRows:0});
 assert.deepEqual(month.totals.basic,{value:null,known:360,unknownRows:1});
 assert.deepEqual(month.totals.ot15,{value:60,known:60,unknownRows:0});
 assert.deepEqual(month.totals.ot20,{value:null,known:0,unknownRows:1});
 assert.equal(out.months[0].available,false);assert.equal(out.months[0].totals.worked.value,null);
 assert.equal(out.yearly.rows.length,3);assert.equal(out.yearly.totals.worked.value,null);assert.equal(out.yearly.totals.worked.known,540);
 assert.equal(out.yearly.missingPayMonths.length,11);
 assert.deepEqual(month.rows.map(r=>r.recordId),['one-a','one-b','two-a']);
});

test('rejects ambiguous or incomplete snapshots instead of double counting',()=>{
 const first=snap(personA,'one@example.test','One',[row('one-a','2026-10-05',180,120,60,0)]);
 for(const bad of [
  [first,first],
  [first,snap(personA,'other@example.test','One',[row('two','2026-10-05',60,60,0,0)])],
  [snap(personA,'one@example.test','One',[row('one-a','2026-10-05',180,120,60,0),row('two','2026-10-05',30,30,0,0)])],
  [snap(personA,'one@example.test','One',[row('one-a','2026-10-19',180,120,60,0)])],
  [snap(personA,'one@example.test','One',[row('one-a','2026-10-05',180,-1,60,0)])],
  [snap(personA,'one@example.test','One',[])],
  [first,snap(personB,'two@example.test','Two',[row('two','2026-10-05',60,60,0,0)],{cycleEnd:'2026-10-19'})],
 ]) assert.throws(()=>buildTimesheetWorkbookHierarchy({year:2026,snapshots:bad}));
});

test('preserves source note whitespace and rejects overlapping pay periods',()=>{
 const original=row('one-a','2026-10-05',180,120,60,0);original.note='  first line\nsecond line  ';original.changeNote='  audited  ';
 const first=snap(personA,'one@example.test','One',[original]);
 const out=buildTimesheetWorkbookHierarchy({year:2026,snapshots:[first]});
 assert.equal(out.months[9].rows[0].note,original.note);assert.equal(out.months[9].rows[0].changeNote,original.changeNote);
 const overlapping=snap(personB,'two@example.test','Two',[row('two-a','2026-10-18',60,60,0,0)],{payMonth:'2026-11',cycleStart:'2026-10-18',cycleEnd:'2026-11-15'});
 assert.throws(()=>buildTimesheetWorkbookHierarchy({year:2026,snapshots:[first,overlapping]}));
});
