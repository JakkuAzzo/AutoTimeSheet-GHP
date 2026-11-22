import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=stripTypeScriptTypes(readFileSync(new URL('../power-platform/office-scripts/prepare-pay-month-source-rate-columns.ts',import.meta.url),'utf8'));
const context={};vm.runInNewContext(source+'\nthis.run=main;',context);
const dailyHeader=['Date','Start','Finish','Break','Absence','Total hours','Notes'];
const rateHeader=['Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours'];
function makeSheet(name,rows,formulas={}){
  const cells=rows.map(row=>row.slice());
  return {getName:()=>name,rows:()=>cells.map(row=>row.slice()),
    getUsedRange(valuesOnly=false){let right=0,last=0;for(let r=0;r<cells.length;r++)for(let i=0;i<cells[r].length;i++)if(cells[r][i]!==''&&cells[r][i]!=null){right=Math.max(right,i+1);last=Math.max(last,r+1);}if(!valuesOnly)for(const key of Object.keys(formulas)){const [r,c]=key.split(',').map(Number);right=Math.max(right,c+1);last=Math.max(last,r+1)}return right?{getColumnIndex:()=>0,getColumnCount:()=>right,getRowIndex:()=>0,getRowCount:()=>last}:null;},
    getRange(ref){const col=s=>s.charCodeAt(0)-65;const match=/^([A-Z])(\d+):([A-Z])(\d+)$/.exec(ref);const start=col(match[1]),end=col(match[3]),r=Number(match[2])-1,last=Number(match[4])-1;
      const values=()=>Array.from({length:last-r+1},(_,j)=>Array.from({length:end-start+1},(_,i)=>cells[r+j]?.[start+i]??''));
      return {getValues:values,getFormulas:()=>values().map((row,j)=>row.map((value,i)=>formulas[`${r+j},${start+i}`]??value)),setValues(input){input[0].forEach((value,i)=>{cells[r][start+i]=value;});}};}};
}
function book(daily,weekly=[['Week Start','Week End','Total hours']],formulas={}){const d=makeSheet('Daily Entries',daily,formulas),w=makeSheet('Weekly Totals',weekly);return {d,w,getName:()=> 'GMT Timesheet - Fictional - Pay Month 2026-10.xlsx',getWorksheets:()=>[d,w]};}
test('prepares only blank rate headers and is idempotent',()=>{
  const workbook=book([dailyHeader,['2026-10-05','08:00','17:00',60,'NA',480,'Fictional note']]);
  const before=workbook.d.rows()[1];
  assert.equal(context.run(workbook).status,'prepared');
  assert.deepEqual(workbook.d.rows()[0],dailyHeader.concat(rateHeader));
  assert.deepEqual(workbook.d.rows()[1],before);
  assert.equal(context.run(workbook).status,'already-prepared');
});
test('extra or ambiguous data prevents any write',()=>{
  for(const workbook of [book([dailyHeader,['','','','','','','','other content']]),book([dailyHeader.concat(['Other'])]),book([dailyHeader],[['Week Start','Week End','Total hours','Other']]),book([['Date','Incorrect']])]){
    const before=workbook.d.rows();
    assert.throws(()=>context.run(workbook),/review|layout|columns/i);
    assert.deepEqual(workbook.d.rows(),before);
  }
});
test('a formula returning an empty string is still protected',()=>{
  const workbook=book([dailyHeader,['2026-10-05','08:00','17:00',60,'NA',480,'Note']],undefined,{'1,7':'=""'});
  assert.throws(()=>context.run(workbook),/formula|review/i);
  assert.deepEqual(workbook.d.rows()[0],dailyHeader);
});
