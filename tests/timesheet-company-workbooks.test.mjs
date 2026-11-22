import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {buildTimesheetWorkbookHierarchy} from '../cloudflare-worker/src/timesheet-workbook-hierarchy.js';
import {createCompanyTimesheetWorkbook} from '../cloudflare-worker/src/timesheet-company-workbooks.js';

const fixture=buildTimesheetWorkbookHierarchy({year:2026,snapshots:[{
 employeeOid:'11111111-1111-4111-8111-111111111111',employeeUpn:'fictional@example.test',employeeName:'=Fictional',payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',sourceGeneration:'a'.repeat(64),rows:[{recordId:'fictional-row',date:'2026-10-01',startTime:'08:00',finishTime:'11:00',breakMinutes:0,totalMinutes:180,sourceBasicMinutes:120,sourceOt15Minutes:60,sourceOt20Minutes:null,note:'=1+1'}]
}]});
function roundtrip(kind,payMonth){const workbook=createCompanyTimesheetWorkbook(XLSX,fixture,{kind,payMonth});return XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});}
test('monthly workbook preserves source values and writes text as text',()=>{
 const wb=roundtrip('monthly','2026-10');assert.deepEqual(wb.SheetNames,['Summary','Entries']);
 const sheet=wb.Sheets.Entries;const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null});
 assert.equal(rows.length,2);assert.equal(rows[1][0],'2026-10');assert.equal(rows[1][1],'=Fictional');
 assert.equal(rows[1][7],0);assert.equal(rows[1][8],3);assert.equal(rows[1][9],2);assert.equal(rows[1][10],1);assert.equal(rows[1][11],null);
 assert.equal(sheet.B2.t,'s');assert.equal(sheet.N2.t,'s');assert.equal(sheet.N2.f,undefined);
 const summary=XLSX.utils.sheet_to_json(wb.Sheets.Summary,{header:1,defval:null});assert.match(JSON.stringify(summary),/unverified/i);
});
test('annual workbook reports twelve pay months and keeps missing months blank',()=>{
 const wb=roundtrip('annual');const summary=XLSX.utils.sheet_to_json(wb.Sheets.Summary,{header:1,defval:null});
 assert.equal(summary[0][1],'2026');
 assert.equal(summary.filter(r=>/^2026-\d\d$/.test(r[0]||'')).length,12);
 const january=summary.find(r=>r[0]==='2026-01'),october=summary.find(r=>r[0]==='2026-10');
 assert.equal(january[2],null);assert.equal(october[2],3);assert.equal(october[5],null);
 const yearly=summary.find(r=>r[0]==='Year total');assert.ok(yearly);assert.equal(yearly[2],null);
});
test('rejects missing periods and unsupported selections',()=>{
 assert.throws(()=>createCompanyTimesheetWorkbook(XLSX,fixture,{kind:'monthly',payMonth:'2026-01'}));
 assert.throws(()=>createCompanyTimesheetWorkbook(XLSX,fixture,{kind:'other'}));
});
test('a changed snapshot appears in both monthly and annual exports',()=>{
 const source={employeeOid:'11111111-1111-4111-8111-111111111111',employeeUpn:'fictional@example.test',employeeName:'Fictional',payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',sourceGeneration:'b'.repeat(64),rows:[{recordId:'fictional-row',date:'2026-10-01',totalMinutes:240,sourceBasicMinutes:180,sourceOt15Minutes:60,sourceOt20Minutes:0}]};
 const updated=buildTimesheetWorkbookHierarchy({year:2026,snapshots:[source]});
 const month=createCompanyTimesheetWorkbook(XLSX,updated,{kind:'monthly',payMonth:'2026-10'});
 const annual=createCompanyTimesheetWorkbook(XLSX,updated,{kind:'annual'});
 for(const wb of [month,annual]){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets.Entries,{header:1,defval:null});
  assert.equal(rows[1][8],4);assert.equal(rows[1][9],3);assert.equal(rows[1][15],'b'.repeat(64));
 }
});
