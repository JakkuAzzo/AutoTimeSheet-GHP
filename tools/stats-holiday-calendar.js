(function () {
  'use strict';
  var section=document.getElementById('stats-holiday-calendar');
  if(!section) return;
  var grid=document.getElementById('holiday-grid'), title=document.getElementById('holiday-month-title'), detail=document.getElementById('holiday-detail'), legend=document.getElementById('holiday-legend'), tooltip=document.getElementById('holiday-tooltip');
  var displayed='', items=[], roster=[], lastSignature='', view='month';
  var prompt='Hover over or select a highlighted date to see recorded holiday periods.';
  var palette=['#14683e','#245db8','#a73c30','#884ca4','#a15b00','#00787e','#ae326b','#614fa4','#6a6b00','#156c89','#9a4e19','#506339'];
  function person(item) { return item.employeeKey || item.title || 'Employee'; }
  function dateOffset(date, days) { var d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); }
  function format(date) { return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')); }
  function hide(){ tooltip.hidden=true; }
  function paint() {
    if(!displayed) return;
    hide();
    var parts=displayed.split('-').map(Number), first=new Date(Date.UTC(parts[0],parts[1]-1,1,12));
    title.textContent=view==='year'?String(parts[0]):new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
    document.getElementById('holiday-previous').setAttribute('aria-label','Previous '+view);document.getElementById('holiday-next').setAttribute('aria-label','Next '+view);
    var byDate=Object.create(null), people=Object.create(null), colours=Object.create(null);
    roster.forEach(function(item){people[person(item)]=item.title||'Employee';});
    Object.keys(people).sort().forEach(function(id,index){colours[id]=index<palette.length?palette[index]:'hsl('+Math.round(index*137.508%360)+' 65% 38%)';});
    items.forEach(function(item){ if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date))return; (byDate[item.date]||(byDate[item.date]=[])).push(item); });
    var visiblePeople=Object.create(null);
    items.forEach(function(item){visiblePeople[person(item)]=item.title||'Employee';});
    legend.replaceChildren();
    Object.keys(visiblePeople).sort(function(a,b){return visiblePeople[a].localeCompare(visiblePeople[b])||a.localeCompare(b);}).forEach(function(id){
      var row=document.createElement('div'),dot=document.createElement('span'),name=document.createElement('span');
      row.className='holiday-legend-entry';dot.className='holiday-colour';dot.style.backgroundColor=colours[id]||palette[0];dot.setAttribute('aria-hidden','true');name.textContent=visiblePeople[id];row.append(dot,name);legend.append(row);
    });
    if(!Object.keys(visiblePeople).length) legend.textContent='No recorded holidays in this selection.';
    function keys(date) { return Array.from(new Set((byDate[date]||[]).map(person))).sort(); }
    function contains(date,id) { return keys(date).indexOf(id)!==-1; }
    function summary(date) {
      var rows=[], names=Object.create(null);
      (byDate[date]||[]).forEach(function(item){names[person(item)]=item.title||'Employee';});
      keys(date).forEach(function(id){
        var start=date,end=date;
        while(contains(dateOffset(start,-1),id)) start=dateOffset(start,-1);
        while(contains(dateOffset(end,1),id)) end=dateOffset(end,1);
        rows.push(names[id]+': '+(start===end?format(start):format(start)+' – '+format(end)));
      });
      return rows;
    }
    function show(cell,point) {
      var date=cell.dataset.holidayDate, lines=summary(date);tooltip.replaceChildren();
      var head=document.createElement('strong');head.textContent=format(date);tooltip.append(head);
      lines.forEach(function(line){var span=document.createElement('span');span.textContent=line;tooltip.append(span);});
      tooltip.hidden=false;
      var rect=cell.getBoundingClientRect(), bounds=tooltip.getBoundingClientRect(), x=point?point.clientX+14:rect.right+8, y=point?point.clientY+14:rect.top;
      tooltip.style.left=Math.max(8,Math.min(x,window.innerWidth-bounds.width-8))+'px';
      tooltip.style.top=Math.max(8,Math.min(y,window.innerHeight-bounds.height-8))+'px';
    }
    grid.replaceChildren();grid.classList.toggle('holiday-year-view',view==='year');
    var months=view==='year'?Array.from({length:12},function(_,i){return i+1;}):[parts[1]];
    months.forEach(function(monthNumber){
    var monthKey=String(parts[0])+'-'+String(monthNumber).padStart(2,'0'), firstOfMonth=new Date(Date.UTC(parts[0],monthNumber-1,1,12));
    var panel=document.createElement('div');panel.className=view==='year'?'holiday-year-month':'holiday-single-month';
    if(view==='year'){var heading=document.createElement('h4');heading.textContent=new Intl.DateTimeFormat('en-GB',{month:'long',timeZone:'UTC'}).format(firstOfMonth);panel.append(heading);}
    var weekdays=document.createElement('div');weekdays.className='holiday-weekdays';weekdays.setAttribute('aria-hidden','true');
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(day){var label=document.createElement('span');label.textContent=view==='year'?day.slice(0,1):day;weekdays.append(label);});panel.append(weekdays);
    var monthGrid=document.createElement('div');monthGrid.className='holiday-grid';panel.append(monthGrid);grid.append(panel);
    var offset=(firstOfMonth.getUTCDay()+6)%7, days=new Date(Date.UTC(parts[0],monthNumber,0)).getUTCDate();
    for(var blank=0;blank<offset;blank++){var empty=document.createElement('span');empty.className='holiday-empty';monthGrid.append(empty);}
    for(var day=1;day<=days;day++){
      var date=monthKey+'-'+String(day).padStart(2,'0'), entry=byDate[date]||[], cell=document.createElement('button');
      cell.type='button';cell.className='holiday-day';cell.dataset.holidayDate=date;
      var number=document.createElement('span');number.textContent=day;cell.append(number);
      if(entry.length){
        var ids=keys(date), k=JSON.stringify(ids), before=JSON.stringify(keys(dateOffset(date,-1)))===k, after=JSON.stringify(keys(dateOffset(date,1)))===k;
        cell.dataset.holidayPosition=before?(after?'middle':'end'):(after?'start':'single');
        var markers=document.createElement('span');markers.className='holiday-markers';markers.setAttribute('aria-hidden','true');
        ids.forEach(function(id){var dot=document.createElement('span');dot.className='holiday-marker';dot.style.backgroundColor=colours[id]||palette[0];markers.append(dot);});cell.append(markers);
        cell.setAttribute('aria-label',format(date)+': '+summary(date).join('; '));cell.setAttribute('aria-describedby','holiday-tooltip');
        cell.addEventListener('pointerenter',function(e){if(e.pointerType!=='touch')show(e.currentTarget,e);});
        cell.addEventListener('pointermove',function(e){if(e.pointerType!=='touch')show(e.currentTarget,e);});
        cell.addEventListener('pointerleave',function(e){if(e.pointerType!=='touch')hide();});
        cell.addEventListener('pointerdown',function(e){if(e.pointerType==='touch')show(e.currentTarget);});
        cell.addEventListener('focus',function(e){show(e.currentTarget);});cell.addEventListener('blur',hide);
        cell.addEventListener('keydown',function(e){if(e.key==='Escape')hide();});
        cell.addEventListener('click',function(e){var selected=e.currentTarget.dataset.holidayDate;detail.textContent=summary(selected).join(' · ');show(e.currentTarget);});
      } else {cell.setAttribute('aria-label',format(date)+': no holiday recorded');cell.disabled=true;}
      monthGrid.append(cell);
    }
    });
  }
  function selectYear(y){var period=document.getElementById('stats-period'), year=document.getElementById('stats-year');period.value='year';year.value=String(y);period.dispatchEvent(new Event('change',{bubbles:true}));}
  function move(n){var parts=displayed.split('-').map(Number), d=new Date(Date.UTC(parts[0],parts[1]-1+n*(view==='year'?12:1),1,12));displayed=d.toISOString().slice(0,7);detail.textContent=prompt;if(view==='year'){selectYear(d.getUTCFullYear());}else{paint();}}
  document.getElementById('holiday-previous').addEventListener('click',function(){move(-1);});
  document.getElementById('holiday-next').addEventListener('click',function(){move(1);});
  document.querySelectorAll('[data-holiday-view]').forEach(function(button){button.addEventListener('click',function(){view=button.dataset.holidayView;document.querySelectorAll('[data-holiday-view]').forEach(function(item){item.setAttribute('aria-pressed',String(item===button));});detail.textContent=prompt;if(view==='year'){selectYear(Number(displayed.slice(0,4)));}else{paint();}});});
  document.addEventListener('pointerdown',function(e){if(!grid.contains(e.target))hide();});
  window.GMTHolidayCalendar={update:function(show,next,options,colourRoster){section.hidden=!show;if(!show){hide();return;}items=next||[];roster=colourRoster||items;options=options||{};if(view==='year' && options.period!=='year'){view='month';document.querySelectorAll('[data-holiday-view]').forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.holidayView==='month'));});}var signature=JSON.stringify(options)+'|'+items.map(function(x){return x.date+'|'+x.employeeKey;}).join(';');if(signature!==lastSignature || !displayed){var fallback=options.period==='year'?String(options.year)+'-01':options.period==='month'?options.month:new Date().toISOString().slice(0,7);displayed=items.length?items[0].date.slice(0,7):fallback;lastSignature=signature;detail.textContent=prompt;}paint();}};
}());
