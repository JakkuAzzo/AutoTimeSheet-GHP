// Local workbook construction only. This function does not authenticate a
// reader, establish roster coverage, write to a provider, or publish files.
// The source model and every resulting workbook require separate validation.
const headers=['Pay month','Employee','Employee account','Date','Start','Finish','Absence','Break (minutes)','Worked (hours)','Source basic (hours)','Source overtime 1.5x (hours)','Source overtime 2x (hours)','Change note','Note','Source record ID','Source generation'];
const hours=value=>value===null?null:value/60;
const values=row=>[row.payMonth,row.employeeName,row.employeeUpn,row.date,row.startTime,row.finishTime,row.absenceReason,row.breakMinutes,hours(row.totalMinutes),hours(row.sourceBasicMinutes),hours(row.sourceOt15Minutes),hours(row.sourceOt20Minutes),row.changeNote,row.note,row.recordId,row.sourceGeneration];
const totals=month=>['worked','basic','ot15','ot20'].map(key=>hours(month.totals[key].value));

export function createCompanyTimesheetWorkbook(XLSX,model,{kind,payMonth}={}){
 if(!XLSX?.utils?.book_new||!Array.isArray(model?.months)||model.months.length!==12||!model.yearly)throw new Error('Invalid workbook input');
 let selected;
 if(kind==='monthly'){
   selected=model.months.find(month=>month.payMonth===payMonth);
   if(!selected?.available)throw new Error('Pay month source is unavailable');
 }else if(kind==='annual')selected=model.yearly;
 else throw new Error('Unsupported workbook view');
 const summary=[['Company timesheet',kind==='monthly'?payMonth:String(model.yearly.year)],['Coverage','Unverified: employee roster and source completeness have not been established.'],[],['Pay month','Source rows','Worked hours','Source basic hours','Source overtime 1.5x hours','Source overtime 2x hours']];
 for(const month of kind==='monthly'?[selected]:model.months)summary.push([month.payMonth,month.available?month.rows.length:null,...totals(month)]);
 if(kind==='annual')summary.push(['Year total',selected.rows.length,...totals(selected)]);
 const book=XLSX.utils.book_new();
 const summarySheet=XLSX.utils.aoa_to_sheet(summary);
 summarySheet['!cols']=[{wch:18},{wch:76},{wch:18},{wch:22},{wch:26},{wch:26}];
 const entrySheet=XLSX.utils.aoa_to_sheet([headers,...selected.rows.map(values)]);
 entrySheet['!cols']=[{wch:12},{wch:25},{wch:32},{wch:12},{wch:9},{wch:9},{wch:18},{wch:17},{wch:16},{wch:22},{wch:27},{wch:27},{wch:36},{wch:36},{wch:30},{wch:66}];
 entrySheet['!autofilter']={ref:entrySheet['!ref']};
 XLSX.utils.book_append_sheet(book,summarySheet,'Summary');XLSX.utils.book_append_sheet(book,entrySheet,'Entries');
 return book;
}
