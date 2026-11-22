(function (root) {
  'use strict';
  const kinds = new Set(['timesheets','enquiries','job-cards','tasks','estimates','invoices','calendar']);
  const clean = value => String(value == null ? '' : value).trim();
  function minutes(value) {
    if (value === null || value === undefined || clean(value) === '') return null;
    const text = clean(value).toLowerCase();
    if (/^\d+$/.test(text)) return Number(text);
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(m(?:in(?:ute)?s?)?|h(?:ou)?rs?)$/);
    if (!match) return null;
    return Math.round(Number(match[1]) * (match[2].startsWith('h') ? 60 : 1));
  }
  function explicitTime(value) {
    if (typeof value==='number' && Number.isFinite(value) && value>=0 && value<1) {const mins=Math.round(value*1440);if(mins<1440)return {value:String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0'),warning:''};}
    const raw=clean(value);if (!raw) return {value:'',warning:''};
    const match=raw.toLowerCase().match(/^(\d{1,2})(?:(?::|\.)(\d{2}))?\s*(am|pm)?$/);
    if (!match || (!match[2] && !match[3])) return {value:raw,warning:''};
    let hour=Number(match[1]),minute=Number(match[2]||0),warning='';
    if (minute>59 || hour>23 || (match[3]==='am' && (hour===0 || hour>12)) || (match[3]==='pm' && hour===0)) return {value:raw,warning:''};
    if (match[3]==='am' && hour===12) hour=0;
    if (match[3]==='pm' && hour<12) hour+=12;
    else if (match[3]==='pm' && hour>12) warning='Time '+raw+' uses a 24-hour value with PM; confirm it.';
    return {value:String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0'),warning};
  }
  function inferStructuredText(value) {
    const lines=String(value || '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    const heading=(lines[0] || '').toLowerCase();
    const kinds=[[/^(?:gmt\s+)?job\s*card\b/,'job-cards'],[/^(?:gmt\s+)?invoice\b/,'invoices'],[/^(?:gmt\s+)?estimate\b/,'estimates'],[/^(?:gmt\s+)?enquiry\b/,'enquiries'],[/^(?:gmt\s+)?task\b/,'tasks'],[/^(?:gmt\s+)?calendar\s+request\b/,'calendar']];
    const match=kinds.find(([pattern])=>pattern.test(heading));
    if (!match) return null;
    const label=(...names)=>{ for(const line of lines.slice(1)){const parts=line.match(/^([^:]{1,40}):\s*(.*)$/);if(parts && names.includes(parts[1].trim().toLowerCase())) return parts[2].trim();}return ''; };
    const item={kind:match[1],employeeEmail:label('employee email','staff email','engineer email')};
    if(item.kind==='job-cards') Object.assign(item,{jobReference:label('job reference','job ref'),description:label('description','work description')});
    if(item.kind==='tasks') item.title=label('title','task title');
    if(item.kind==='calendar') Object.assign(item,{title:label('title','event title'),date:label('date','event date')});
    if(item.kind==='enquiries') Object.assign(item,{customerName:label('customer','customer name'),message:label('message','enquiry')});
    if(item.kind==='estimates') item.number=label('estimate number','estimate no');
    if(item.kind==='invoices') { item.invoiceNumber=label('invoice number','invoice no'); const amount=label('total','invoice total').replace(/^£/,'').replace(/,/g,''); if (/^\d+(?:\.\d{1,2})?$/.test(amount)) item.total=Number(amount); }
    return item;
  }
  function review(source) {
    let issues = Array.isArray(source.issues) ? source.issues : [];
    let records = Array.isArray(source.records) ? source.records : [];
    const rows = Array.isArray(source.rows) ? source.rows : [];
    if (!records.length && !rows.length && source.text) {
      const inferred=inferStructuredText(source.text);
      if (inferred) { records=[inferred]; issues=issues.filter(issue=>!/^No timesheet rows (?:could be detected|were recognised)/i.test(issue)); }
    }
    const recognitionWarning=source.recognitionWarning || (/OCR/i.test(String(source.meta?.sourceType || '')) ? 'Read from an image; verify every value against the source.' : '');
    const result = [];
    let nextIndex=0;
    records.forEach(record => {
      const kind = clean(record.kind).toLowerCase();
      const data=record.payload && typeof record.payload==='object' && !Array.isArray(record.payload) ? record.payload : record;
      const daily=[data.rows,data.dailyRows,data.daily_rows,data.gmtDailyRows].find(Array.isArray);
      if (kind==='timesheets' && daily && daily.length) {
        daily.forEach(row=>{
          const copy=Object.assign({},row,{employee:row.employee || record.employeeName || data.employeeName || '',employeeEmail:row.employeeEmail || record.employeeEmail || record.employeeUpn || data.employeeEmail || data.employeeUpn || ''});
          if (record.schemaVersion===3 && record.mode==='replace-pay-month') {
            const keys=['sourceBasicMinutes','sourceOt15Minutes','sourceOt20Minutes'];
            const valid=keys.every(key=>Object.hasOwn(row,key) && (row[key]===null || (Number.isInteger(row[key]) && row[key]>=0 && row[key]<=1440)));
            copy.sourceEvidence={raw:JSON.stringify(row),claimedBasic:valid?row.sourceBasicMinutes:null,claimedOt15:valid?row.sourceOt15Minutes:null,claimedOt20:valid?row.sourceOt20Minutes:null,reviewNote:'Imported rate figures need review against the original document.'};
            if (!valid) copy.rateIssues=['Imported source rate figures need review.'];
          }
          const item=review({file:source.file,sourceId:source.sourceId,text:source.text,recognitionWarning,rows:[copy],issues:[]})[0];item.sourceIndex=nextIndex++;result.push(item);
        });
        return;
      }
      const sourceIndex=nextIndex++;
      const problems = [];
      if (!kinds.has(kind)) problems.push('Record type is not supported.');
      const fields = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload : record;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(record.employeeEmail || record.employeeUpn || fields.employeeEmail || fields.employeeUpn))) problems.push('Employee identity needs review.');
      if (kind === 'tasks' && !clean(fields.title)) problems.push('Task title is missing.');
      if (kind === 'calendar' && (!clean(fields.title) || !clean(fields.date))) problems.push('Calendar title and date need review.');
      if (kind === 'enquiries' && (!clean(fields.customerName) || !clean(fields.message))) problems.push('Enquiry customer and message need review.');
      if (kind === 'job-cards') {
        if (!clean(fields.jobReference) || !clean(fields.description)) problems.push('Job card reference and description need review.');
        const prefix=clean(fields.jobReference).toUpperCase().match(/^(MTA|EC)(?=[\s/-]|\d)/)?.[1] || '';
        const cardType=clean(fields.cardType).toUpperCase() || prefix;
        if (!['EC','MTA'].includes(cardType) || (prefix && prefix!==cardType)) problems.push('Job-card type needs review.');
      }
      if (kind === 'estimates') {
        const numeric=value=>value!==null && value!==undefined && /^(?:\d+)(?:\.\d+)?$/.test(String(value).trim()) && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=1000000000;
        if (!clean(fields.number) || !Array.isArray(fields.items) || !fields.items.length || fields.items.length>80) problems.push('Estimate number and items need review.');
        else if (fields.items.some(item=>!clean(item?.description) || !numeric(item?.quantity) || !numeric(item?.unit ?? item?.unitPrice))) problems.push('Estimate line items need review.');
        if (!numeric(fields.vatRate) || Number(fields.vatRate)>100 || !numeric(fields.total)) problems.push('Estimate VAT and total need review.');
        else if (Array.isArray(fields.items) && fields.items.length && fields.items.every(item=>numeric(item?.quantity)&&numeric(item?.unit ?? item?.unitPrice))) {
          const roundMoney=value=>Math.round((value+Number.EPSILON)*100)/100;
          const subtotal=roundMoney(fields.items.reduce((sum,item)=>sum+Number(item.quantity)*Number(item.unit ?? item.unitPrice),0));
          const vat=roundMoney(subtotal*Number(fields.vatRate)/100),total=roundMoney(subtotal+vat);
          for (const [key,expected] of [['subtotal',subtotal],['vat',vat],['total',total]]) if (fields[key]!==undefined && (!numeric(fields[key]) || !/^\d+(?:\.\d{1,2})?$/.test(String(fields[key]).trim()) || Math.abs(Number(fields[key])-expected)>0.001)) problems.push('Estimate '+key+' does not match its line items.');
        }
      }
      if (kind === 'invoices') {
        const invoiceDate=clean(fields.date || fields.invoiceDate),currency=clean(fields.currency).toUpperCase();
        if (!clean(fields.invoiceNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || !Number.isFinite(Date.parse(invoiceDate)) || new Date(invoiceDate).toISOString().slice(0,10)!==invoiceDate || !/^[A-Z]{3}$/.test(currency) || fields.total == null || !/^-?\d+(?:\.\d+)?$/.test(clean(fields.total)) || !Number.isFinite(Number(fields.total))) problems.push('Invoice number, date, currency and total need review.');
      }
      if (kind === 'timesheets' && !(Array.isArray(fields.rows) && fields.rows.length)) problems.push('Timesheet entries need review.');
      result.push({kind, data:record, issues:problems, valid:problems.length === 0, warnings:recognitionWarning?[recognitionWarning]:[],recognitionWarning,source:source.file, sourceId:source.sourceId || '',sourceIndex,sourceText:clean(source.text).slice(0,50000)});
    });
    rows.forEach(row => {
      const sourceIndex=nextIndex++;
      const problems = [];
      const rateIssues=Array.isArray(row.rateIssues) ? row.rateIssues.map(clean).filter(Boolean) : [];
      rateIssues.forEach(issue => problems.push(issue));
      let raw = {}; try { raw = JSON.parse(row.raw || '{}'); } catch (_) {}
      const date = clean(row.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) problems.push('Date is missing or invalid.');
      const employeeEmail=clean(row.employeeEmail || row.employeeUpn);
      if (!clean(row.employee) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)) problems.push('Employee identity needs review.');
      if (employeeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)) problems.push('Employee email needs review.');
      const absence = clean(row.absence || row.absenceStatus || row.absenceReason || 'NA');
      if (!['NA','Sick','Holiday','Absent','Time Off','Un-Paid'].includes(absence)) problems.push('Absence status needs review.');
      const startResult=explicitTime(row.start ?? row.startTime ?? row.start_time),finishResult=explicitTime(row.finish ?? row.finishTime ?? row.finish_time);
      const start=startResult.value,finish=finishResult.value,warnings=[recognitionWarning,startResult.warning,finishResult.warning].filter(Boolean);
      if (absence.toUpperCase() === 'NA' && (!start || !finish)) problems.push('Start and finish are required for a worked day.');
      const isTime = value => /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(clean(value));
      if ((start && !isTime(start)) || (finish && !isTime(finish))) problems.push('Time needs review in 24-hour HH:MM format.');
      const lunch = row.breakInput !== undefined ? row.breakInput : (row.lunchMinutes ?? row.breakMinutes ?? row.break_minutes ?? row.lunch);
      const lunchMinutes = minutes(lunch);
      if (clean(lunch) && lunchMinutes === null) problems.push('Break needs review.');
      if (lunchMinutes !== null && (!Number.isInteger(lunchMinutes) || lunchMinutes < 0 || lunchMinutes > 1440)) problems.push('Break must be between 0 and 1440 minutes.');
      if (isTime(start) && isTime(finish)) {
        const toMinutes = value => { const [hours, mins] = clean(value).split(':').map(Number); return hours * 60 + mins; };
        const elapsed = toMinutes(finish) - toMinutes(start);
        if (elapsed < 0) problems.push('Finish is before start; review the time.');
        else if (lunchMinutes !== null && lunchMinutes > elapsed) problems.push('Break cannot exceed the recorded time.');
      }
      const priorEvidence=row.sourceEvidence && typeof row.sourceEvidence==='object' ? row.sourceEvidence : {};
      const sourceEvidence={raw:clean(priorEvidence.raw || row.raw).slice(0,3000),claimedBasic:priorEvidence.claimedBasic ?? row.claimedBasic ?? null,claimedOt15:priorEvidence.claimedOt15 ?? row.claimedOt15 ?? null,claimedOt20:priorEvidence.claimedOt20 ?? row.claimedOt20 ?? null,reviewNote:clean(priorEvidence.reviewNote).slice(0,1000)};
      // This identifies the reader's null/zero interpretation, not source authentication.
      if ((priorEvidence.rateEvidenceVersion ?? row.rateEvidenceVersion) === 1) sourceEvidence.rateEvidenceVersion=1;
      const notes=clean(row.notes || row.note || row.site || raw.site);
      if (/^[=+\-@]/.test(notes)) problems.push('Note begins with a formula-like character and needs review before workbook filing.');
      result.push({kind:'timesheets',data:{employee:clean(row.employee),employeeEmail,date,start,finish,lunchMinutes,breakInput:clean(lunch),absence,notes,sourceEvidence,rateIssues},issues:problems,warnings,recognitionWarning,valid:problems.length===0,source:source.file,sourceId:row.sourceId || source.sourceId || '',sourceIndex,sourceText:clean(source.text).slice(0,50000)});
    });
    issues.forEach((issue,index) => result.push({kind:'',data:{},issues:[clean(issue)],warnings:recognitionWarning?[recognitionWarning]:[],recognitionWarning,valid:false,source:source.file,sourceText:clean(source.text).slice(0,50000),sourceId:source.sourceId || '',sourceIndex:nextIndex+index}));
    if (!result.length) result.push({kind:'',data:{},issues:['No records were recognised in this file.'],warnings:recognitionWarning?[recognitionWarning]:[],recognitionWarning,valid:false,source:source.file,sourceText:clean(source.text).slice(0,50000),sourceId:source.sourceId || '',sourceIndex:0});
    return result;
  }
  root.GMTSubmissionUploadReview = {review};
})(globalThis);
