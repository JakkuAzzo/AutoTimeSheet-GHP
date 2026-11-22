import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {createRegisterWorkbook,runRegisterOfficeScript} from './helpers/pay-month-register-office-script.mjs';

const code=stripTypeScriptTypes(readFileSync(new URL('../power-platform/office-scripts/verify-pay-month-register-readonly.ts',import.meta.url),'utf8'));
const context={};vm.runInNewContext(code+'\nthis.verify=main;',context);
const id='fictional-correction',day='2026-10-05';
const source={schemaVersion:2,mode:'replace-pay-month',recordId:id,employeeName:'Fictional',employeeUpn:'fictional@example.test',payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:'2026-11-03T10:00:00Z',deletedDays:[],rows:[{recordId:`${id}|${day}`,date:day,startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,note:'Fictional',changeNote:'Edited by Accounts'}]};
const dailyHeader=['Date','Start','Finish','Break','Absence','Total hours','Notes'],weeklyHeader=['Week Start','Week End','Total hours'];
const dailyRows=[dailyHeader,[day,'09:00','12:00',0,'NA',180/1440,'Fictional | Edited by Accounts'],['Pay month total','','','','',180/1440,'']];
const weeklyRows=[weeklyHeader,['2026-09-21','2026-09-27',0],['2026-09-28','2026-10-04',0],['2026-10-05','2026-10-11',180/1440],['2026-10-12','2026-10-18',0],['Month total','',180/1440]];
function sheet(name,initial,formulaNote=false,mutateDuringRead=false,missingFormula=''){
  const rows=structuredClone(initial);
  const formulas=name==='Daily Entries' ? {
    F2:'=IF(E2<>"NA",0,IF(OR(B2="",C2="",D2=""),0.125,MOD(C2-B2,1)-D2/1440))',
    F3:'=SUM(F2:F2)'
  } : Object.fromEntries([2,3,4,5].map(n=>[`C${n}`,`=SUMIFS('Daily Entries'!$F$2:$F$2,'Daily Entries'!$A$2:$A$2,">="&A${n},'Daily Entries'!$A$2:$A$2,"<="&B${n})`]).concat([['C6','=SUM(C2:C5)']]));
  if(missingFormula.startsWith(name+':')) delete formulas[missingFormula.slice(name.length+1)];
  return {getName:()=>name,rows:()=>structuredClone(rows),getUsedRange:()=>({getRowIndex:()=>0,getRowCount:()=>rows.length,getColumnIndex:()=>0,getColumnCount:()=>Math.max(...rows.map(row=>row.length))}),getRange(ref){
    const match=/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/.exec(ref);if(!match)throw Error(`unexpected range ${ref}`);
    const startRow=Number(match[2])-1,endRow=Number(match[4]||match[2])-1,startCol=match[1].charCodeAt(0)-65,endCol=(match[3]||match[1]).charCodeAt(0)-65;
    const values=()=>Array.from({length:endRow-startRow+1},(_,r)=>Array.from({length:endCol-startCol+1},(_,c)=>rows[startRow+r]?.[startCol+c]??''));
    return {getValues:()=>{const snapshot=values();if(mutateDuringRead && ref==='F3')rows[1][1]='10:00';return snapshot},getFormulas:()=>{
      const result=values();
      for(let r=0;r<result.length;r++)for(let c=0;c<result[r].length;c++){
        const key=String.fromCharCode(65+startCol+c)+(startRow+r+1);
        if(formulas[key])result[r][c]=formulas[key];
      }
      if(formulaNote&&startCol===6)result[0][0]='=1+1';
      return result;
    }};
  }};
}
function workbook(daily=dailyRows,weekly=weeklyRows,options={}){
  const d=sheet('Daily Entries',daily,options.formulaNote,options.mutateDuringRead,options.missingFormula),w=sheet('Weekly Totals',weekly,false,false,options.missingFormula);
  return {daily:d,weekly:w,getName:()=>options.name||'GMT Timesheet - Fictional - Pay Month 2026-10.xlsx',getWorksheets:()=>[d,w]};
}
const run=(book,record=source)=>JSON.parse(JSON.stringify(context.verify(book,JSON.stringify(record))));

for(const missingFormula of ['Daily Entries:F2','Daily Entries:F3','Weekly Totals:C2','Weekly Totals:C6'])
  test(`read-only recovery rejects a correct-looking total missing ${missingFormula}`,()=>{
    assert.throws(()=>run(workbook(dailyRows,weeklyRows,{missingFormula})),/formula/i);
  });

test('read-only recovery check verifies every row and total without workbook mutation',()=>{
  const book=workbook(),before=[book.daily.rows(),book.weekly.rows()];const result=run(book);
  assert.equal(result.rowCount,1);assert.equal(result.totalMinutes,180);
  assert.deepEqual(JSON.parse(result.verifiedRecordIdsJson),[`${id}|${day}`]);
  assert.deepEqual(JSON.parse(result.verifiedRowsJson),[{recordId:`${id}|${day}`,date:day,start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA',totalMinutes:180,notes:'Fictional | Edited by Accounts'}]);
  assert.deepEqual([book.daily.rows(),book.weekly.rows()],before);
});
test('read-only recovery check accepts a workbook written by the existing register script',()=>{
  const book=createRegisterWorkbook('Fictional','2026-10');
  runRegisterOfficeScript(book,source);
  const before=[book.daily.rows(),book.weekly.rows()];
  assert.equal(run(book).rowCount,1);
  assert.deepEqual([book.daily.rows(),book.weekly.rows()],before);
});
test('read-only recovery verifies source-rate fields without inventing values',()=>{
  const rates={sourceBasicMinutes:120,sourceOt15Minutes:60,sourceOt20Minutes:null};
  const source3={...source,schemaVersion:3,rows:[{...source.rows[0],...rates}]};
  const rows=structuredClone(dailyRows);
  rows[0].push('Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours');
  rows[1].push(120/1440,60/1440,'');rows[2].push('','','');
  const book=workbook(rows),before=[book.daily.rows(),book.weekly.rows()];
  const result=run(book,source3),verified=JSON.parse(result.verifiedRowsJson)[0];
  assert.equal(verified.sourceBasicMinutes,120);assert.equal(verified.sourceOt15Minutes,60);assert.equal(verified.sourceOt20Minutes,null);
  assert.deepEqual([book.daily.rows(),book.weekly.rows()],before);
  const changed=structuredClone(rows);changed[1][9]=0;assert.throws(()=>run(workbook(changed),source3));
  assert.throws(()=>run(workbook(rows),{...source3,rows:[{...source3.rows[0],sourceBasicMinutes:undefined}]}));
});
for(const [name,change] of [
  ['changed time',rows=>{rows[1][2]='13:00'}],['changed note',rows=>{rows[1][6]='Changed'}],
  ['extra day',rows=>{rows.splice(2,0,['2026-10-06','10:00','11:00',0,'NA',60/1440,'extra'])}],
  ['duplicate day',rows=>{rows.splice(2,0,rows[1].slice())}],['changed daily total',rows=>{rows[2][5]=99/1440}],
  ['extra column',rows=>{rows[1][7]='unexpected'}]
])test(`read-only recovery check holds ${name}`,()=>{const rows=structuredClone(dailyRows);change(rows);assert.throws(()=>run(workbook(rows)));});
test('read-only recovery check holds changed weekly totals and unsafe formulas',()=>{
  const rows=structuredClone(weeklyRows);rows[3][2]=99/1440;assert.throws(()=>run(workbook(dailyRows,rows)));
  assert.throws(()=>run(workbook(dailyRows,weeklyRows,{formulaNote:true})));
});
test('read-only recovery check holds a workbook that changes while it is being read',()=>{
  assert.throws(()=>run(workbook(dailyRows,weeklyRows,{mutateDuringRead:true})));
});
test('read-only recovery check requires the exact employee, period, source identity and deletions',()=>{
  assert.throws(()=>run(workbook(dailyRows,weeklyRows,{name:'GMT Timesheet - Other - Pay Month 2026-10.xlsx'})));
  assert.throws(()=>run(workbook(),{...source,cycleEnd:'2026-10-04'}));
  assert.throws(()=>run(workbook(),{...source,rows:[{...source.rows[0],recordId:'wrong'}]}));
  assert.throws(()=>run(workbook(),{...source,deletedDays:[day]}));
  assert.throws(()=>run(workbook(),{...source,deletedDays:null}));
  assert.throws(()=>run(workbook(),{...source,rows:[]}));
});
