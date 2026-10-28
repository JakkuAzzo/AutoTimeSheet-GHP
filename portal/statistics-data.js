(function () {
  'use strict';
  function payload(record) { var p = record && record.payload; if (typeof p === 'string') { try { return JSON.parse(p); } catch (_) { return {}; } } return p && typeof p === 'object' ? p : {}; }
  function value(record, fields) { var p = payload(record); for (var i = 0; i < fields.length; i++) { var v = record && record[fields[i]]; if (v === undefined || v === null || v === '') v = p[fields[i]]; if (v !== undefined && v !== null && v !== '') return v; } return ''; }
  function employee(record) { return String(value(record, ['employee_upn','employee_email','employeeEmail','employeeUpn','owner_upn','ownerUpn']) || '').trim().toLowerCase(); }
  function belongs(record, options) {
    if (options.admin && !options.employee) return true;
    var target = options.admin ? String(options.employee || '').toLowerCase() : String(options.identity && options.identity.upn || '').toLowerCase();
    var oid = String(options.identity && options.identity.oid || '').toLowerCase();
    var recordOid = String(value(record, ['owner_oid','ownerOid']) || '').toLowerCase();
    return Boolean(target && employee(record) === target || !options.admin && oid && recordOid === oid);
  }
  function iso(value) { var m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }
  function inPeriod(date, options) {
    if (!date) return false;
    if (options.period === 'year') return date.slice(0,4) === String(options.year);
    if (options.period === 'month') {
      var periods = window.GMTPayPeriods;
      return (periods && typeof periods.payMonthKeyForDate === 'function' ? periods.payMonthKeyForDate(date) : date.slice(0,7)) === options.month;
    }
    return true;
  }
  function activityDate(record, kind) {
    var fields = kind === 'tasks' ? ['completed_at','completedAt','completion_date','completionDate','completed_date','completedDate','updated_at','updatedAt','record_date','recordDate','date'] : kind === 'estimates' ? ['estimate_date','estimateDate','date','dateOfEstimate','record_date','recordDate','created_at','createdAt'] : ['record_date','recordDate','raised_at','raisedAt','job_card_date','jobCardDate','created_at','createdAt','date','planned_date','plannedDate'];
    for (var i=0;i<fields.length;i++) { var date=iso(value(record,[fields[i]])); if(date) return date; }
    return iso(value(record,['submitted_at','submittedAt']));
  }
  function label(record) { return String(value(record,['employee_name','employeeName','employee_upn','employeeEmail']) || 'Recorded activity'); }
  function formatMinutes(n) { n=Math.max(0,Math.round(Number(n)||0)); return Math.floor(n/60)+'h'+(n%60 ? ' '+String(n%60).padStart(2,'0')+'m' : ''); }
  function calculate(records, options) {
    options=options||{};
    var allowed=(Array.isArray(records)?records:[]).filter(function (r) { return r && !r.synthetic && belongs(r,options); });
    var items={'worked-days':[],'worked-hours':[],'holiday-days':[],'estimates-written':[],'job-cards-raised':[],'tasks-completed':[]};
    var seen=Object.create(null), unknown=0, provisional=0;
    var events=window.GMTCalendarData ? window.GMTCalendarData.recordsToEvents(allowed,{employees:options.employees||[]}) : [];
    events.forEach(function (event) {
      if (!event || !event.row || ['timesheets','clock'].indexOf(event.type)===-1 || !inPeriod(event.date,options)) return;
      var row=event.row, absence=String(row.absenceStatus||row.absence_status||row.absenceReason||row.absence_reason||row.absence||'').trim();
      var item={date:event.date, title:event.title, detail:event.detail, issue:event.issue||'', recordId:event.recordId};
      if (/holiday/i.test(absence) || row.holiday===true || row.isHoliday===true || row.is_holiday===true) { items['holiday-days'].push(item); return; }
      if (absence && !/^(n\/?a|none|no|false|working|no absence|not applicable)$/i.test(absence)) return;
      if (!event.hasRecordedWork) return;
      items['worked-days'].push(item);
      var minutes=window.GMTPayMonthWorkbook && window.GMTPayMonthWorkbook.workedMinutesForRow(row);
      if (minutes == null) {
        var components=['basicHours','basic_hours','ot15Hours','ot15_hours','ot20Hours','ot20_hours'].map(function (k) {return row[k];}).filter(function(x){return x!=='' && x!=null && Number.isFinite(Number(x));});
        if (components.length) minutes=components.reduce(function(a,x){return a+Number(x);},0)*60;
      }
      if (minutes == null || !Number.isFinite(Number(minutes))) { unknown++; return; }
      item.minutes=Math.max(0,Math.round(Number(minutes)));
      if (window.GMTPayMonthWorkbook.provisionalForRow(row)) { item.provisional=true; provisional++; }
      items['worked-hours'].push(item);
    });
    allowed.forEach(function(record) {
      var kind=String(record.kind||record.action||record.category||'').toLowerCase().replace(/_/g,'-');
      var metric=kind==='estimates'?'estimates-written':kind==='job-cards'?'job-cards-raised':kind==='tasks'?'tasks-completed':'';
      if(!metric) return;
      var state=String(value(record,['status'])||'').toLowerCase();
      if(kind==='tasks' && ['complete','completed','done'].indexOf(state)===-1 && value(record,['completed','is_complete','isComplete'])!==true) return;
      var date=activityDate(record,kind), id=String(value(record,['source_record_id','record_id','recordId','id','estimate_number','estimateNumber','job_ref','task_id'])||'');
      if(!id||!inPeriod(date,options)||seen[metric+'|'+id]) return;
      seen[metric+'|'+id]=true;
      items[metric].push({date:date,title:String(value(record,['title','subject','estimate_number','job_ref','job_reference','task_title'])||label(record)),detail:label(record),recordId:id});
    });
    Object.keys(items).forEach(function(k){items[k].sort(function(a,b){return b.date.localeCompare(a.date);});});
    var values={}; Object.keys(items).forEach(function(k){values[k]=k==='worked-hours'?items[k].reduce(function(a,x){return a+x.minutes;},0):items[k].length;});
    var missingDaily=allowed.filter(function(r){return String(r.kind||'').toLowerCase()==='timesheets' && window.GMTCalendarData && window.GMTCalendarData.rowsFor(r).length===0;}).length;
    return {values:values,items:items,unknownHours:unknown,provisionalHours:provisional,missingDaily:missingDaily,recordCount:allowed.length};
  }
  window.GMTStatistics={calculate:calculate,formatMinutes:formatMinutes,employee:employee};
}());
