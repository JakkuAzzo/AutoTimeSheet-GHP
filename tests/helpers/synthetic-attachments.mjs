import {createRequire} from 'node:module';
import {syntheticFixture as f} from '../../cloudflare-worker/src/synthetic-portal-fixture.js';

const require=createRequire(import.meta.url);
const workbook=require('../../portal/pay-month-workbook.js');
const periods=require('../../pay-periods.js');
const xlsx=require('xlsx');

export function syntheticAttachmentExample() {
  const editedAt='2026-11-16T13:00:00.000Z',editedBy='Amanda Brown-Bennett';
  const evidence={raw:'',claimedBasic:null,claimedOt15:null,claimedOt20:null,reviewNote:'',sourceFile:f.fileName,sourceId:f.sourceId};
  const rows=f.rows.map((row,index)=>({...row,description:row.note,lunchHad:index===0?false:null,
    ...(index===0?{workedMinutes:180,workedHours:3}:{}),basicHours:index===0?3:2,ot15Hours:0,ot20Hours:0,weightedHours:index===0?3:2,sourceEvidence:{...evidence}}));
  const p=periods.periodForMonth('2026-10');
  const payload={employeeName:f.employeeName,employeeEmail:f.employeeUpn,payMonth:'2026-10',weekStart:p.start,weekEnd:p.cycleEnd,
    cycleStart:p.start,cycleEnd:p.cycleEnd,payrollFriday:p.payrollFriday,rows,deletedDays:[],editedAt,editedBy,
    editNote:`Edited on behalf of ${f.employeeName} by ${editedBy}.`,testMode:true};
  const matrices=workbook.toWorkbookMatrices({rows:rows.map(row=>({row}))},p);
  const book=xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(matrices.dailyMatrix),'Daily Entries');
  xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(matrices.weeklyMatrix),'Weekly Totals');
  const excel=Buffer.from(xlsx.write(book,{bookType:'xlsx',type:'array'}));
  const csv=Buffer.from(matrices.dailyMatrix.map(row=>row.map(value=>'"'+String(value==null?'':value).replace(/"/g,'""')+'"').join(',')).join('\r\n'));
  const envelope={schemaVersion:2,mode:'replace-pay-month',recordId:f.recordId,submissionId:f.recordId,
    employeeName:f.employeeName,employeeEmail:f.employeeUpn,employeeUpn:f.employeeUpn,payMonth:'2026-10',
    weekStart:p.start,weekEnd:p.cycleEnd,cycleStart:p.start,cycleEnd:p.cycleEnd,payrollFriday:p.payrollFriday,
    submittedAt:editedAt,editedBy,deletedDays:[],rows:matrices.data.dailyEntries.map(entry=>({
      recordId:f.recordId+'|'+entry.Date,date:entry.Date,startTime:entry.Start,finishTime:entry.Finish,breakMinutes:entry.Break,
      absenceReason:entry.Absence,totalMinutes:entry['Total hours'],workedHours:Number((entry['Total hours']/60).toFixed(4)),
      note:entry.Notes,changeNote:`Edited by ${editedBy} at ${editedAt}`}))};
  const stem='GMT Timesheet - Nathan-Private-Synthetic - Pay Month 2026-10';
  const attach=(fieldName,fileName,contentType,bytes)=>({fieldName,fileName,contentType,sizeBytes:bytes.length,contentBase64:bytes.toString('base64')});
  return {payload,body:{attachments:[
    attach('attachment',stem+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',excel),
    attach('attachment_csv',stem+'.csv','text/csv',csv),
    attach('attachment_record','GMT Timesheet Record - Nathan-Private-Synthetic - Pay Month 2026-10.json','application/json',Buffer.from(JSON.stringify(envelope)))
  ]}};
}
