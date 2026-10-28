(function () {
  'use strict';
  var section=document.getElementById('stats-holiday-calendar');
  if(!section) return;
  var grid=document.getElementById('holiday-grid'), title=document.getElementById('holiday-month-title'), detail=document.getElementById('holiday-detail');
  var displayed='', items=[], lastSignature='';
  function dateOffset(date, days) { var d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); }
  function format(date) { return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')); }
  function paint() {
    if(!displayed) return;
    var parts=displayed.split('-').map(Number), first=new Date(Date.UTC(parts[0],parts[1]-1,1,12));
    title.textContent=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
    var byDate=Object.create(null);
    items.forEach(function(item){ if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date))return; (byDate[item.date]||(byDate[item.date]=[])).push(item); });
    function key(date) { return JSON.stringify(Array.from(new Set((byDate[date]||[]).map(function(x){return x.employeeKey || x.title;}))).sort()); }
    grid.replaceChildren();
    var offset=(first.getUTCDay()+6)%7, days=new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate();
    for(var blank=0;blank<offset;blank++){var empty=document.createElement('span');empty.className='holiday-empty';grid.append(empty);}
    for(var day=1;day<=days;day++){
      var date=displayed+'-'+String(day).padStart(2,'0'), entry=byDate[date]||[], cell=document.createElement('button');
      cell.type='button';cell.className='holiday-day';cell.dataset.holidayDate=date;cell.textContent=day;
      if(entry.length){
        var k=key(date), before=key(dateOffset(date,-1))===k, after=key(dateOffset(date,1))===k;
        cell.dataset.holidayPosition=before?(after?'middle':'end'):(after?'start':'single');
        var labels=Array.from(new Set(entry.map(function(x){return x.title||'Employee';})));
        cell.setAttribute('aria-label',format(date)+': holiday recorded for '+labels.join(', '));
        cell.addEventListener('click',function(event){var selected=event.currentTarget.dataset.holidayDate;var names=Array.from(new Set(byDate[selected].map(function(x){return x.title||'Employee';})));var firstDate=selected,lastDate=selected, selectedKey=key(selected); while(key(dateOffset(firstDate,-1))===selectedKey)firstDate=dateOffset(firstDate,-1); while(key(dateOffset(lastDate,1))===selectedKey)lastDate=dateOffset(lastDate,1); var range=firstDate===lastDate?format(firstDate):format(firstDate)+' – '+format(lastDate); detail.textContent=range+' — holiday recorded for '+names.join(', ')+'.';});
      } else {cell.setAttribute('aria-label',format(date)+': no holiday recorded');cell.disabled=true;}
      grid.append(cell);
    }
  }
  function move(n){var parts=displayed.split('-').map(Number), d=new Date(Date.UTC(parts[0],parts[1]-1+n,1,12));displayed=d.toISOString().slice(0,7);detail.textContent='Select a highlighted date to see whose holiday is recorded.';paint();}
  document.getElementById('holiday-previous').addEventListener('click',function(){move(-1);});
  document.getElementById('holiday-next').addEventListener('click',function(){move(1);});
  window.GMTHolidayCalendar={update:function(show,next,options){section.hidden=!show;if(!show)return;items=next||[];options=options||{};var signature=JSON.stringify(options)+'|'+items.map(function(x){return x.date+'|'+x.employeeKey;}).join(';');if(signature!==lastSignature || !displayed){var fallback=options.period==='year'?String(options.year)+'-01':options.period==='month'?options.month:new Date().toISOString().slice(0,7);displayed=items.length?items[0].date.slice(0,7):fallback;lastSignature=signature;detail.textContent='Select a highlighted date to see whose holiday is recorded.';}paint();}};
}());
