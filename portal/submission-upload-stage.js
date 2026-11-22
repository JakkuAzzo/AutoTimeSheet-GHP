(function(root){
  'use strict';
  function prepare(candidates,target,existingDates,payMonthForDate){
    if(!target?.canEdit)throw new Error('This pay month is not editable for this account.');
    if(!Array.isArray(candidates)||!candidates.length)throw new Error('Select at least one timesheet day.');
    const seen=new Set(),existing=new Set(existingDates||[]),upn=String(target.employeeUpn||'').trim().toLowerCase();
    return candidates.map(item=>{
      const data=item.data||{},date=String(data.date||'');
      if(item.kind!=='timesheets'||item.valid!==true)throw new Error('Only valid timesheet days can be staged.');
      if(!upn||String(data.employeeEmail||'').trim().toLowerCase()!==upn)throw new Error('Select days for one verified employee at a time.');
      if(payMonthForDate(date)!==target.payMonth)throw new Error('Select days from one pay month at a time.');
      if(seen.has(date))throw new Error('The selected days contain a duplicate date.');
      if(existing.has(date))throw new Error('A day is already recorded for '+date+'; review the existing day.');
      seen.add(date);
      return {date,staged:true,row:{date,start:data.start||'',finish:data.finish||'',lunchMinutes:data.lunchMinutes==null?null:data.lunchMinutes,absenceStatus:data.absence||'NA',note:data.notes||'',sourceEvidence:Object.assign({},data.sourceEvidence||{},{sourceFile:String(item.source||''),sourceId:String(item.sourceId||'')})}};
    });
  }
  root.GMTSubmissionUploadStage={prepare};
})(globalThis);
