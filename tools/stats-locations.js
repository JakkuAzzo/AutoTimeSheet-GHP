(function () {
  'use strict';
  function payload(record){var p=record&&record.payload;if(typeof p==='string'){try{return JSON.parse(p);}catch(_){return {};}}return p&&typeof p==='object'?p:{};}
  function day(value){var m=String(value||'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:'';}
  function collect(records,options){
    options=options||{};var visits=[], seen=Object.create(null),places=Object.create(null);
    (Array.isArray(records)?records:[]).forEach(function(r){
      if(!r||r.synthetic||!window.GMTStatistics.belongs(r,options))return;
      var kind=String(r.kind||'').toLowerCase(), p=payload(r), status=String(r.status||'').toLowerCase();
      if(['clock','timesheets'].indexOf(kind)<0||/rejected|deleted|cancelled/.test(status))return;
      var evidence=[];
      var mode=String(p.locationMode||p.location_mode||'').toLowerCase(), source=String(p.source||'').toLowerCase();
      if(kind==='clock' && (source==='approved-offsite-shift'||mode==='off_site') && (p.location||p.site)) evidence.push({date:day(p.date||r.record_date||r.start_date),site:p.location||p.site});
      var action=String(p.action||r.action||'').toLowerCase();
      if(kind==='clock' && mode==='in_office' && ['clock_in','clock_out','full_day'].indexOf(action)!==-1) evidence.push({date:day(p.date||r.record_date||r.start_date),site:'GMT workshop, 93–95 Gloucester Road, Croydon CR0 2DN'});
      var rows=Array.isArray(p.rows)?p.rows:[];
      rows.forEach(function(row){if(!row||!(row.location||row.site)||!(row.start||row.clockIn||row.workedMinutes||row.workedHours))return;evidence.push({date:day(row.date||row.workDate),site:row.location||row.site});});
      var who=window.GMTStatistics.employee(r)||String(r.owner_oid||r.employee_name||'').trim().toLowerCase();
      evidence.forEach(function(entry){
        var site=String(entry.site||'').trim().replace(/\s+/g,' ');if(!who||!site||site.length>500||!entry.date||!window.GMTStatistics.inPeriod(entry.date,options))return;
        var k=site.toLowerCase(), id=who+'|'+entry.date+'|'+k;if(seen[id])return;seen[id]=true;
        var item={date:entry.date,title:site,detail:String(r.employee_name||'Recorded site visit'),recordId:String(r.record_id||r.source_record_id||'')};visits.push(item);
        if(!places[k])places[k]={key:k,name:site,visits:0};places[k].visits++;
      });
    });
    visits.sort(function(a,b){return b.date.localeCompare(a.date);});
    return {visits:visits,places:Object.keys(places).map(function(k){return places[k];}).sort(function(a,b){return b.visits-a.visits||a.name.localeCompare(b.name);})};
  }
  window.GMTStatsLocations={collect:collect};
}());
