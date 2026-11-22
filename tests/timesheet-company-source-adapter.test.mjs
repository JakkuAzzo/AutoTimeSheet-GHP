import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';
import {buildCompanyWorkbooksFromSources} from '../cloudflare-worker/src/timesheet-company-source-adapter.js';

const oid='11111111-1111-4111-8111-111111111111',upn='fictional@example.test';
function input(overrides={}){
 const source={schemaVersion:3,mode:'replace-pay-month',recordId:'correction',employeeUpn:upn,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',rows:[
  {recordId:'correction|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'17:00',breakMinutes:60,totalMinutes:420,note:'Fictional',sourceBasicMinutes:360,sourceOt15Minutes:60,sourceOt20Minutes:null},
  {recordId:'correction|2026-10-06',date:'2026-10-06',startTime:'09:00',finishTime:'12:00',breakMinutes:0,totalMinutes:180,note:'',sourceBasicMinutes:180,sourceOt15Minutes:0,sourceOt20Minutes:0}
 ],...overrides};
 const bytes=new TextEncoder().encode(JSON.stringify(source));
 return {employeeOid:oid,employeeUpn:upn,employeeName:'Fictional',recordId:'correction',payMonth:'2026-10',generation:createHash('sha256').update(bytes).digest('hex'),sourceBytes:bytes};
}
test('builds matching company month and year views from an exact structured snapshot',async()=>{
 const {monthly,annual}=await buildCompanyWorkbooksFromSources(XLSX,{year:2026,payMonth:'2026-10',sources:[input()]});
 for(const book of [monthly,annual]){
  const roundtrip=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const rows=XLSX.utils.sheet_to_json(roundtrip.Sheets.Entries,{header:1,defval:null});
  assert.equal(rows.length,3);assert.equal(rows[1][8],7);assert.equal(rows[1][9],6);assert.equal(rows[1][10],1);assert.equal(rows[1][11],null);assert.equal(rows[2][8],3);
 }
});
test('combines different employees and months without copying an employee into another month',async()=>{
 const secondSource={schemaVersion:3,mode:'replace-pay-month',recordId:'other',employeeUpn:'two@example.test',payMonth:'2026-11',cycleStart:'2026-10-19',cycleEnd:'2026-11-15',rows:[
  {recordId:'other|2026-11-02',date:'2026-11-02',totalMinutes:120,sourceBasicMinutes:120,sourceOt15Minutes:0,sourceOt20Minutes:0}
 ]};
 const bytes=new TextEncoder().encode(JSON.stringify(secondSource));
 const second={employeeOid:'22222222-2222-4222-8222-222222222222',employeeUpn:'two@example.test',employeeName:'Two',recordId:'other',payMonth:'2026-11',generation:createHash('sha256').update(bytes).digest('hex'),sourceBytes:bytes};
 const books=await buildCompanyWorkbooksFromSources(XLSX,{year:2026,payMonth:'2026-10',sources:[second,input()]});
 const monthly=XLSX.utils.sheet_to_json(books.monthly.Sheets.Entries,{header:1,defval:null});
 const annual=XLSX.utils.sheet_to_json(books.annual.Sheets.Entries,{header:1,defval:null});
 assert.equal(monthly.length,3);assert.ok(monthly.slice(1).every(row=>row[0]==='2026-10'&&row[2]===upn));
 assert.equal(annual.length,4);assert.deepEqual(annual.slice(1).map(row=>row[0]),['2026-10','2026-10','2026-11']);
 await assert.rejects(buildCompanyWorkbooksFromSources(XLSX,{year:2026,payMonth:'2026-10',sources:[input(),input()]}));
});
test('refuses changed bytes, wrong identity, wrong month and unrelated row identifiers',async()=>{
 for(const bad of [
  {...input(),generation:'a'.repeat(64)},
  {...input(),employeeUpn:'other@example.test'},
  {...input(),recordId:'other'},
  {...input(),payMonth:'2026-11'},
  input({rows:[{recordId:'other|2026-10-05',date:'2026-10-05',totalMinutes:60,sourceBasicMinutes:60,sourceOt15Minutes:0,sourceOt20Minutes:0}]})
 ])await assert.rejects(buildCompanyWorkbooksFromSources(XLSX,{year:2026,payMonth:'2026-10',sources:[bad]}));
});
test('preserves unknown legacy rates and rejects missing schema 3 rate evidence',async()=>{
 const old=input({schemaVersion:2,rows:[{recordId:'correction|2026-10-05',date:'2026-10-05',totalMinutes:60}]});
 const books=await buildCompanyWorkbooksFromSources(XLSX,{year:2026,payMonth:'2026-10',sources:[old]});
 const rows=XLSX.utils.sheet_to_json(books.monthly.Sheets.Entries,{header:1,defval:null});assert.deepEqual(rows[1].slice(9,12),[null,null,null]);
 const missing=input({rows:[{recordId:'correction|2026-10-05',date:'2026-10-05',totalMinutes:60,sourceBasicMinutes:60,sourceOt15Minutes:0}]});
 await assert.rejects(buildCompanyWorkbooksFromSources(XLSX,{year:2026,payMonth:'2026-10',sources:[missing]}));
});
