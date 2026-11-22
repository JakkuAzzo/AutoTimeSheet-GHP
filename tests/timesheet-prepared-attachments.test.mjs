import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {verifyPreparedAttachments as verify} from '../cloudflare-worker/src/timesheet-prepared-attachments.js';
const source={schemaVersion:3,cycleStart:'2026-10-05',cycleEnd:'2026-10-11',rows:[
  {date:'2026-10-05',startTime:'09:00',finishTime:'17:00',breakMinutes:60,absenceReason:'NA',totalMinutes:420,note:'Site',sourceBasicMinutes:420,sourceOt15Minutes:0,sourceOt20Minutes:null},
  {date:'2026-10-06',startTime:'10:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:120,note:'',sourceBasicMinutes:null,sourceOt15Minutes:60,sourceOt20Minutes:0}
]};
const daily=[['Date','Start','Finish','Break','Absence','Total hours','Notes','Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours'],
  ['2026-10-05','09:00','17:00',60,'NA','7h 00m','Site','7h 00m','0h 00m',''],
  ['2026-10-06','10:00','12:00',0,'NA','2h 00m','','','1h 00m','0h 00m'],
  ['Pay month total','','','','','9h 00m','','','','']];
const weekly=[['Week Start','Week End','Total hours'],['2026-10-05','2026-10-11','9h 00m'],['Month total','','9h 00m']];
const csv=rows=>rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
function fixture(change){
  const copy=structuredClone(daily),weeks=structuredClone(weekly);change?.(copy,weeks);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(copy),'Daily Entries');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(weeks),'Weekly Totals');
  return {xlsx:new Uint8Array(XLSX.write(book,{type:'buffer',bookType:'xlsx'})),csv:new TextEncoder().encode(csv(daily))};
}
test('accepts independently consistent prepared XLSX and CSV including zero and unknown rates',async()=>{
  assert.equal(await verify(source,fixture()),true);
});
test('rejects a workbook with a changed worked total or rate',async()=>{
  for(const change of [(d)=>{d[1][5]='8h 00m'},(d)=>{d[2][7]='0h 00m'}])await assert.rejects(verify(source,fixture(change)));
});
test('rejects an altered CSV even when the workbook is correct',async()=>{
  const input=fixture();input.csv=new TextEncoder().encode(csv(daily).replace('"Site"','"Altered"'));await assert.rejects(verify(source,input));
});
test('rejects tampered weekly totals and unexpected workbook sheets',async()=>{
  await assert.rejects(verify(source,fixture((d,w)=>{w[1][2]='10h 00m'})));
  const input=fixture(),book=XLSX.read(input.xlsx,{type:'array'});XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['hidden']]),'Extra');input.xlsx=new Uint8Array(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));await assert.rejects(verify(source,input));
});
test('rejects a formula disguised as the expected value and data outside the expected range',async()=>{
  for(const mutate of [book=>{book.Sheets['Daily Entries'].F2.f='1+6';},book=>{book.Sheets['Daily Entries'].K2={t:'s',v:'unexpected'};book.Sheets['Daily Entries']['!ref']='A1:K4';}]){
    const input=fixture(),book=XLSX.read(input.xlsx,{type:'array',cellFormula:true});mutate(book);input.xlsx=new Uint8Array(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));await assert.rejects(verify(source,input));
  }
});
test('rejects a missing source rate instead of treating it as unknown',async()=>{
  const altered=structuredClone(source);delete altered.rows[0].sourceOt20Minutes;await assert.rejects(verify(altered,fixture()));
});
