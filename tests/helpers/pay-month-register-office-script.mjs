import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const code=stripTypeScriptTypes(readFileSync(new URL('../../power-platform/office-scripts/upsert-pay-month-register.ts',import.meta.url),'utf8'));
const context={ExcelScript:{ClearApplyTo:{contents:'contents'},CalculationType:{full:'full'}}};
vm.runInNewContext(code+'\nthis.runScript = main;',context);

function makeSheet(name,initial){
  let cells=initial.map(row=>row.slice());
  const formulas=new Map();
  const format={getFont:()=>({setBold(){}}),setColumnWidth(){}};
  return {
    name,getName:()=>name,rows:()=>cells.map(row=>row.slice()),
    getUsedRange(){return cells.length?{getRowIndex:()=>0,getRowCount:()=>cells.length,getColumnIndex:()=>0,getColumnCount:()=>Math.max(...cells.map(row=>row.length)),clear:()=>{cells=[];formulas.clear()}}:null},
    getRange(ref){
      const match=/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if(!match){const single=/^([A-Z]+)(\d+)$/.exec(ref);return {getFormat:()=>format,getValues:()=>[[single?cells[Number(single[2])-1]?.[single[1].charCodeAt(0)-65]??'':'']],setFormula(value){if(!single)throw Error(`unexpected range ${ref}`);formulas.set(`${Number(single[2])-1},${single[1].charCodeAt(0)-65}`,value)},setNumberFormat(){}};}
      const sr=Number(match[2])-1,er=Number(match[4])-1,sc=match[1].charCodeAt(0)-65,ec=match[3].charCodeAt(0)-65;
      const values=()=>Array.from({length:er-sr+1},(_,r)=>Array.from({length:ec-sc+1},(_,c)=>cells[sr+r]?.[sc+c]??''));
      return {getValues:values,getFormulas:()=>values().map((row,r)=>row.map((value,c)=>formulas.get(`${sr+r},${sc+c}`)??value)),getFormat:()=>format,setFormulas(values){values.forEach((row,r)=>row.forEach((value,c)=>formulas.set(`${sr+r},${sc+c}`,value)))},setNumberFormat(){}};
    },
    getRangeByIndexes(sr,sc,nr,nc){return {setValues(values){assert.equal(values.length,nr);values.forEach((row,r)=>{assert.equal(row.length,nc);while(cells.length<=sr+r)cells.push([]);row.forEach((value,c)=>{cells[sr+r][sc+c]=value;formulas.delete(`${sr+r},${sc+c}`)})})}}},
    getFreezePanes:()=>({freezeRows(){}})
  };
}
export function createRegisterWorkbook(employee,month,options={}){
  const header=['Date','Start','Finish','Break','Absence','Total hours','Notes'];
  if(options.sourceRates)header.push('Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours');
  const daily=makeSheet('Daily Entries',[header]);
  const weekly=makeSheet('Weekly Totals',[['Week Start','Week End','Total hours']]);
  return {daily,weekly,getApplication:()=>({calculate(){}}),getName:()=>`GMT Timesheet - ${employee} - Pay Month ${month}.xlsx`,getWorksheets:()=>[daily,weekly]};
}
export function runRegisterOfficeScript(workbook,envelope){return JSON.parse(JSON.stringify(context.runScript(workbook,JSON.stringify(envelope))));}
