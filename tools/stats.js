(function () {
  'use strict';
  var names={'worked-days':'Worked days','worked-hours':'Worked hours','holiday-days':'Holiday days recorded','estimates-written':'Estimates written','job-cards-raised':'Job cards raised','tasks-completed':'Tasks completed','locations':'Work locations'};
  var params=new URLSearchParams(location.search), topic=names[params.get('topic')]?params.get('topic'):'worked-days';
  var period=document.getElementById('stats-period'), month=document.getElementById('stats-month'), year=document.getElementById('stats-year'), employee=document.getElementById('stats-employee'), status=document.getElementById('stats-status'), retry=document.getElementById('stats-retry');
  var records=[], identity={}, admin=false, complete=true, loaded=false, visibleItems=50, chartType="bar";
  var current=new Date(); var today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(current);
  function text(node,value) { node.textContent=String(value); }
  function selectedMonth() { return window.GMTPayPeriods && window.GMTPayPeriods.payMonthKeyForDate ? window.GMTPayPeriods.payMonthKeyForDate(today) : today.slice(0,7); }
  function syncUrl() {
    var q=new URLSearchParams({topic:topic,period:period.value});
    if(period.value==='month') q.set('month',month.value);
    if(period.value==='year') q.set('year',year.value);
    if(admin && employee.value) q.set('employee',employee.value);
    history.replaceState(null,'','?'+q.toString());
    document.querySelectorAll('[data-topic]').forEach(function(link){var x=new URLSearchParams(q);x.set('topic',link.dataset.topic);link.href='?'+x.toString();link.removeAttribute('aria-current');if(link.dataset.topic===topic)link.setAttribute('aria-current','page');});
  }
  function render(preserveCount) {
    if (preserveCount !== true) visibleItems=50;
    document.getElementById('stats-month-label').hidden=period.value!=='month';
    document.getElementById('stats-year-label').hidden=period.value!=='year';
    syncUrl();
    if (!loaded) { text(document.getElementById('stats-heading'),names[topic]); text(document.getElementById('stats-result-title'),names[topic]); return; }
    var filters={identity:identity,admin:admin,employee:employee.value,period:period.value,month:month.value,year:year.value};
    var result=window.GMTStatistics.calculate(records,filters);
    var locations=window.GMTStatsLocations.collect(records,filters);
    result.items.locations=locations.visits; result.values.locations=locations.places.length;
    document.getElementById('stats-map-section').hidden=topic!=='locations';
    if (topic==='locations') window.GMTStatsMap.render(locations.places, identity.upn||identity.oid);
    var caption=period.value==='month'?'Pay month '+month.value:period.value==='year'?'Calendar year '+year.value:'All recorded time';
    text(document.getElementById('stats-heading'),names[topic]);text(document.getElementById('stats-result-title'),names[topic]);text(document.getElementById('stats-period-caption'),caption);
    text(document.getElementById('stats-total'),topic==='worked-hours'?window.GMTStatistics.formatMinutes(result.values[topic]):result.values[topic]);
    var note=topic==='locations'?'Distinct named places from recorded attendance; the chart shows recorded site workdays.':'Only records available to your account are included.';
    if(topic==='worked-hours') note+=' '+result.provisionalHours+' day(s) include provisional hours; '+result.unknownHours+' worked day(s) have no calculable hours.';
    if(result.missingDaily) note+=' '+result.missingDaily+' timesheet record(s) have no daily detail and cannot contribute dated work.';
    if(!complete) note+=' Some history could not be loaded; totals are incomplete.';
    text(document.getElementById('stats-note'),note);
    var items=result.items[topic], container=document.getElementById('stats-items');container.replaceChildren();
    var options={period:period.value,month:month.value,year:year.value};
    if (options.period==='month' && window.GMTPayPeriods && typeof window.GMTPayPeriods.periodForMonth==='function') { var p=window.GMTPayPeriods.periodForMonth(options.month); if(p){options.start=p.start;options.end=p.cycleEnd||p.end;} }
    var chartData=window.GMTStatsCharts.series(items,options,topic);
    text(document.getElementById('stats-chart-heading'),(topic==='locations'?'Recorded site workdays':names[topic])+' over time');
    text(document.getElementById('stats-chart-caption'),options.period==='month'?'Daily totals across the selected pay month.':options.period==='year'?'Monthly totals across the selected calendar year.':'Yearly totals across the available history.');
    window.GMTStatsCharts.draw(document.getElementById('stats-chart'),document.getElementById('stats-chart-table-body'),chartData,topic,chartType,names[topic]);
    text(document.getElementById('stats-limit-note'),items.length ? items.length+' recorded '+(items.length===1?'entry':'entries')+'.' : 'No matching recorded activity for this selection.');
    var more=document.getElementById('stats-more');more.hidden=items.length<=visibleItems;
    items.slice(0,visibleItems).forEach(function(item){var row=document.createElement('div');row.className='stats-row';var body=document.createElement('div'), title=document.createElement('strong'), detail=document.createElement('small'),date=document.createElement('time');title.textContent=item.title || names[topic];detail.textContent=item.detail || '';date.dateTime=item.date;date.textContent=item.date;body.append(title,detail);row.append(body,date);container.append(row);});
    text(status,complete?'Statistics loaded.':'Some history is unavailable. Totals may be incomplete.');
  }
  async function load(){
    retry.hidden=true;status.textContent='Loading authorised records…';
    try {
      if(window.GMT_PORTAL_AUTH_READY) await window.GMT_PORTAL_AUTH_READY;
      if(window.GMTPayPeriods && window.GMTPayPeriods.ready) await window.GMTPayPeriods.ready;
      if(!window.GMTPortalApi || !window.GMTPortalApi.enabled()) throw new Error('Statistics are not connected.');
      var profile=JSON.parse(localStorage.getItem('gmt.portal.profile.v1')||'{}');identity={upn:String(profile.username||profile.upn||profile.email||'').toLowerCase(),oid:String(profile.subject||profile.oid||'').toLowerCase()};
      if(!identity.upn && !identity.oid) throw new Error('Your signed-in profile is unavailable.');
      var access=await window.GMTPortalApi.access();admin=Boolean(access && (access.isAdmin||access.canManageSubmissions));
      if (!params.get('month')) month.value=selectedMonth();
      var result=await window.GMTCalendarData.loadHistory(window.GMTPortalApi);records=result.records;loaded=true;complete=!(result.meta&&result.meta.calendar_history_incomplete);
      if(admin){var currentChoice=params.get('employee')||employee.value, choices={};records.forEach(function(r){var key=window.GMTStatistics.employee(r);if(key)choices[key]=r.employee_name || key;});employee.replaceChildren(new Option('All employees',''));Object.keys(choices).sort().forEach(function(key){employee.add(new Option(choices[key],key));});if(choices[currentChoice])employee.value=currentChoice;document.getElementById('stats-employee-label').hidden=false;}
      render();
    }catch(error){records=[];loaded=false;status.textContent=error && error.message ? error.message : 'Statistics could not be loaded.';document.getElementById('stats-total').textContent='—';retry.hidden=false;}
  }
  period.value=['month','year','all'].indexOf(params.get('period'))>=0?params.get('period'):'month';
  month.value=/^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month')||'')?params.get('month'):selectedMonth();
  year.value=/^\d{4}$/.test(params.get('year')||'')?params.get('year'):today.slice(0,4);
  [period,month,year,employee].forEach(function(el){el.addEventListener('change',render);});
  document.querySelectorAll('[data-topic]').forEach(function(link){link.addEventListener('click',function(event){event.preventDefault();topic=link.dataset.topic;render();});});
  document.querySelectorAll('[data-chart-type]').forEach(function(button){button.addEventListener('click',function(){chartType=button.dataset.chartType;document.querySelectorAll('[data-chart-type]').forEach(function(item){item.setAttribute('aria-pressed',String(item===button));});render(true);});});
  document.getElementById('stats-more').addEventListener('click',function(){visibleItems+=50;render(true);});
  retry.addEventListener('click',load);syncUrl();load();
}());
