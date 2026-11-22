// Local-only connection from structured source bytes to company workbooks.
// The caller must authenticate the reader, select reviewed current snapshots,
// establish roster/history completeness and verify versions again before any
// provider write. Hash matching here does not establish any of those facts.
import {buildTimesheetWorkbookHierarchy} from './timesheet-workbook-hierarchy.js';
import {createCompanyTimesheetWorkbook} from './timesheet-company-workbooks.js';

const invalid=()=>new Error('Company workbook source is incomplete or inconsistent');
const rates=['sourceBasicMinutes','sourceOt15Minutes','sourceOt20Minutes'];
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');

export async function buildCompanyWorkbooksFromSources(XLSX,{year,payMonth,sources}={}){
 if(!Array.isArray(sources)||!sources.length||sources.length>500)throw invalid();
 const snapshots=[];
 for(const item of sources){
  if(!item||typeof item!=='object'||!(item.sourceBytes instanceof Uint8Array)||!item.sourceBytes.length||item.sourceBytes.length>1024*1024||
    typeof item.generation!=='string'||!/^[0-9a-f]{64}$/.test(item.generation)||typeof item.recordId!=='string'||!item.recordId||
    typeof item.employeeUpn!=='string'||typeof item.payMonth!=='string')throw invalid();
  // Copy before hashing so a mutable input cannot change between verification and parsing.
  const bytes=new Uint8Array(item.sourceBytes),actual=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
  if(actual!==item.generation)throw invalid();
  let source;try{source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(_){throw invalid();}
  if(!source||![2,3].includes(source.schemaVersion)||source.mode!=='replace-pay-month'||source.recordId!==item.recordId||
   typeof source.employeeUpn!=='string'||source.employeeUpn.toLowerCase()!==item.employeeUpn.toLowerCase()||source.payMonth!==item.payMonth||!Array.isArray(source.rows))throw invalid();
  const rows=source.rows.map(row=>{
   if(!row||typeof row!=='object'||typeof row.date!=='string'||row.recordId!==`${item.recordId}|${row.date}`)throw invalid();
   if(source.schemaVersion===3){
    if(!rates.every(key=>Object.hasOwn(row,key)&&(row[key]===null||(Number.isInteger(row[key])&&row[key]>=0&&row[key]<=1440))))throw invalid();
   }else if(rates.some(key=>Object.hasOwn(row,key)))throw invalid();
   return {...row,...(source.schemaVersion===2?Object.fromEntries(rates.map(key=>[key,null])):{})};
  });
  snapshots.push({employeeOid:item.employeeOid,employeeUpn:item.employeeUpn,employeeName:item.employeeName,payMonth:item.payMonth,
   cycleStart:source.cycleStart,cycleEnd:source.cycleEnd,sourceGeneration:item.generation,rows});
 }
 const model=buildTimesheetWorkbookHierarchy({year,snapshots});
 return {monthly:createCompanyTimesheetWorkbook(XLSX,model,{kind:'monthly',payMonth}),annual:createCompanyTimesheetWorkbook(XLSX,model,{kind:'annual'})};
}
