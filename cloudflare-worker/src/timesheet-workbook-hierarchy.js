// Pure aggregation only. Callers must authenticate the reader, establish a
// complete reviewed source snapshot and verify its revision before using this
// model to create or publish any workbook.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=/^[0-9a-f]{64}$/;
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:|@-]{0,255}$/;
const fields={worked:'totalMinutes',basic:'sourceBasicMinutes',ot15:'sourceOt15Minutes',ot20:'sourceOt20Minutes'};

function invalid(){throw new Error('The timesheet summary source is incomplete or inconsistent');}
function iso(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid();
  const date=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)invalid();
  return value;
}
function text(value,max=5000){if(value===undefined||value===null)return '';if(typeof value!=='string'||value.length>max)invalid();return value.trim();}
function note(value){if(value===undefined||value===null)return '';if(typeof value!=='string'||value.length>5000)invalid();return value;}
function minutes(value){if(value===null||value===undefined||value==='')return null;if(!Number.isInteger(value)||value<0||value>1440)invalid();return value;}
function time(value){value=text(value,5);if(value&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))invalid();return value;}
function totals(rows,unavailableMonths=0){
  return Object.fromEntries(Object.entries(fields).map(([name,key])=>{
    const unknownRows=rows.filter(row=>row[key]===null).length;
    const known=rows.reduce((sum,row)=>sum+(row[key]??0),0);
    return [name,{value:rows.length&&!unknownRows&&!unavailableMonths?known:null,known,unknownRows}];
  }));
}

export function buildTimesheetWorkbookHierarchy({year,snapshots}={}){
  if(!Number.isInteger(year)||year<1900||year>9999||!Array.isArray(snapshots))invalid();
  const months=Array.from({length:12},(_,i)=>({payMonth:`${year}-${String(i+1).padStart(2,'0')}`,available:false,coverage:'unverified',rows:[],employeeCount:0}));
  const employees=new Map(),addresses=new Map(),periods=new Map(),pairs=new Set(),recordIds=new Set(),employeeDates=new Set(),employeeMonths=[];
  for(const source of snapshots){
    if(!source||typeof source!=='object'||Array.isArray(source))invalid();
    const employeeOid=text(source.employeeOid,36).toLowerCase(),employeeUpn=text(source.employeeUpn,320).toLowerCase(),employeeName=text(source.employeeName,150);
    const payMonth=text(source.payMonth,7),generation=text(source.sourceGeneration,64);
    if(!uuid.test(employeeOid)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeUpn)||!employeeName||!new RegExp(`^${year}-(0[1-9]|1[0-2])$`).test(payMonth)||!digest.test(generation))invalid();
    if((employees.has(employeeOid)&&employees.get(employeeOid)!==employeeUpn)||(addresses.has(employeeUpn)&&addresses.get(employeeUpn)!==employeeOid))invalid();
    employees.set(employeeOid,employeeUpn);addresses.set(employeeUpn,employeeOid);
    const pair=employeeOid+'|'+payMonth;if(pairs.has(pair))invalid();pairs.add(pair);
    const cycleStart=iso(source.cycleStart),cycleEnd=iso(source.cycleEnd);if(cycleStart>cycleEnd)invalid();
    const knownPeriod=periods.get(payMonth);if(knownPeriod&&(knownPeriod.start!==cycleStart||knownPeriod.end!==cycleEnd))invalid();
    periods.set(payMonth,{start:cycleStart,end:cycleEnd});
    if(!Array.isArray(source.rows)||!source.rows.length||source.rows.length>62)invalid();
    const rows=source.rows.map(input=>{
      if(!input||typeof input!=='object'||Array.isArray(input))invalid();
      const recordId=text(input.recordId,256),date=iso(input.date),dateKey=employeeOid+'|'+date;
      if(!idPattern.test(recordId)||date<cycleStart||date>cycleEnd||recordIds.has(recordId)||employeeDates.has(dateKey))invalid();
      recordIds.add(recordId);employeeDates.add(dateKey);
      const row={recordId,date,employeeOid,employeeUpn,employeeName,payMonth,sourceGeneration:generation,
        startTime:time(input.startTime),finishTime:time(input.finishTime),breakMinutes:minutes(input.breakMinutes),
        absenceReason:text(input.absenceReason,150),note:note(input.note),changeNote:note(input.changeNote)};
      for(const key of Object.values(fields))row[key]=minutes(input[key]);
      return row;
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.recordId.localeCompare(b.recordId));
    const item={employeeOid,employeeUpn,employeeName,payMonth,cycleStart,cycleEnd,sourceGeneration:generation,rows,totals:totals(rows)};
    employeeMonths.push(item);
    const month=months[Number(payMonth.slice(5))-1];month.available=true;month.employeeCount++;month.rows.push(...rows);
  }
  const periodList=[...periods.entries()].sort(([a],[b])=>a.localeCompare(b));
  for(let i=1;i<periodList.length;i++)if(periodList[i-1][1].end>=periodList[i][1].start)invalid();
  employeeMonths.sort((a,b)=>a.payMonth.localeCompare(b.payMonth)||a.employeeUpn.localeCompare(b.employeeUpn));
  for(const month of months){month.rows.sort((a,b)=>a.employeeUpn.localeCompare(b.employeeUpn)||a.date.localeCompare(b.date)||a.recordId.localeCompare(b.recordId));month.totals=totals(month.rows);}
  const missingPayMonths=months.filter(month=>!month.available).map(month=>month.payMonth);
  const allRows=months.flatMap(month=>month.rows);
  return {employeeMonths,months,yearly:{year,coverage:'unverified',rows:allRows,missingPayMonths,totals:totals(allRows,missingPayMonths.length)}};
}
