import {createRequire} from 'node:module';
import {syntheticAttachmentExample} from './synthetic-attachments.mjs';
import {rateFixture as f,rateEvidence} from '../../cloudflare-worker/src/synthetic-rate-fixture.js';
const require=createRequire(import.meta.url),workbook=require('../../portal/pay-month-workbook.js'),periods=require('../../pay-periods.js'),xlsx=require('xlsx');

export function syntheticRateExample(){
  const payload=syntheticAttachmentExample().payload;
  payload.rows.forEach((row,i)=>{row.note='Fictional portal rate test '+(i?'B':'A');row.description=row.note;row.sourceEvidence=rateEvidence(i)});
  const period=periods.periodForMonth('2026-10'),matrices=workbook.toWorkbookMatrices({rows:payload.rows.map(row=>({row}))},period,{includeSourceRates:true});
  const book=xlsx.utils.book_new();xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(matrices.dailyMatrix),'Daily Entries');xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(matrices.weeklyMatrix),'Weekly Totals');
  const excel=Buffer.from(xlsx.write(book,{bookType:'xlsx',type:'array'}));
  const csv=Buffer.from(matrices.dailyMatrix.map(row=>row.map(value=>'"'+String(value==null?'':value).replace(/"/g,'""')+'"').join(',')).join('\r\n'));
  const envelope={schemaVersion:3,mode:'replace-pay-month',recordId:f.recordId,submissionId:f.recordId,employeeName:f.employeeName,employeeEmail:f.employeeUpn,employeeUpn:f.employeeUpn,payMonth:'2026-10',weekStart:period.start,weekEnd:period.cycleEnd,cycleStart:period.start,cycleEnd:period.cycleEnd,payrollFriday:period.payrollFriday,submittedAt:payload.editedAt,editedBy:payload.editedBy,deletedDays:[],rows:matrices.data.dailyEntries.map(entry=>({recordId:f.recordId+'|'+entry.Date,date:entry.Date,startTime:entry.Start,finishTime:entry.Finish,breakMinutes:entry.Break,absenceReason:entry.Absence,totalMinutes:entry['Total hours'],workedHours:Number((entry['Total hours']/60).toFixed(4)),note:entry.Notes,changeNote:`Edited by ${payload.editedBy} at ${payload.editedAt}`,sourceBasicMinutes:entry['Source basic hours']===''?null:entry['Source basic hours'],sourceOt15Minutes:entry['Source overtime 1.5× hours']===''?null:entry['Source overtime 1.5× hours'],sourceOt20Minutes:entry['Source overtime 2× hours']===''?null:entry['Source overtime 2× hours']}))};
  const stem='GMT Timesheet - Nathan-Private-Synthetic - Pay Month 2026-10',attach=(fieldName,fileName,contentType,bytes)=>({fieldName,fileName,contentType,sizeBytes:bytes.length,contentBase64:bytes.toString('base64')});
  const correction={recordId:f.recordId,kind:'timesheets',action:'pay_month_correction',status:'Submitted',editMode:true,employeeName:f.employeeName,employeeEmail:f.employeeUpn,startDate:period.start,endDate:period.cycleEnd,recordDate:payload.editedAt.slice(0,10),updatedAt:payload.editedAt,baseCorrectionExists:false,baseCorrectionUpdatedAt:'',baseOwnerRevision:0,importReview:{dates:f.rows.map(row=>row.date),historyFingerprint:'A'.repeat(43),localRevision:0},payload};
  return {correction,body:{attachments:[attach('attachment',stem+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',excel),attach('attachment_csv',stem+'.csv','text/csv',csv),attach('attachment_record','GMT Timesheet Record - Nathan-Private-Synthetic - Pay Month 2026-10.json','application/json',Buffer.from(JSON.stringify(envelope)))]}};
}
