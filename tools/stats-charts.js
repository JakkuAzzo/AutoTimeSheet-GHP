(function () {
  'use strict';
  function validDay(value) {
    var key=String(value||'').slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
    var date=new Date(key+'T12:00:00Z');
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==key ? '' : key;
  }
  function series(items, options, metric) {
    options=options||{}; var buckets=[], index=Object.create(null);
    function add(key,label) { var item={key:key,label:label,value:0};index[key]=item;buckets.push(item); }
    if(options.period==='month') {
      var start=validDay(options.start),end=validDay(options.end);
      if(!start || !end) {
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.month||'')) return [];
        start=options.month+'-01';var last=new Date(Date.UTC(Number(options.month.slice(0,4)),Number(options.month.slice(5,7)),0,12));end=last.toISOString().slice(0,10);
      }
      var day=new Date(start+'T12:00:00Z'), stop=new Date(end+'T12:00:00Z');
      for(var i=0;day<=stop && i<370;i++,day.setUTCDate(day.getUTCDate()+1)) {
        var key=day.toISOString().slice(0,10);add(key,new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(day));
      }
    } else if(options.period==='year') {
      var year=String(options.year||'');if(!/^\d{4}$/.test(year))return [];
      for(var m=1;m<=12;m++){var key=year+'-'+String(m).padStart(2,'0');add(key,new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'}).format(new Date(key+'-01T12:00:00Z')));}
    } else {
      var years=(items||[]).map(function(item){return validDay(item.date).slice(0,4);}).filter(Boolean).map(Number);
      if(!years.length)return [];
      var first=Math.min.apply(null,years),last=Math.max.apply(null,years);
      if(last-first>200)return [];
      for(var y=first;y<=last;y++)add(String(y),String(y));
    }
    (items||[]).forEach(function(item){
      var day=validDay(item.date);if(!day)return;
      var key=options.period==='month'?day:options.period==='year'?day.slice(0,7):day.slice(0,4);
      if(!index[key])return;
      var amount=metric==='worked-hours'?Number(item.minutes):1;
      if(Number.isFinite(amount)&&amount>=0)index[key].value+=amount;
    });
    return buckets;
  }
  function display(value,metric) { return metric==='worked-hours' && window.GMTStatistics ? window.GMTStatistics.formatMinutes(value) : String(value); }
  function draw(svg, tbody, values, metric, mode, title) {
    var ns='http://www.w3.org/2000/svg';svg.replaceChildren();tbody.replaceChildren();
    var width=Math.max(680,values.length*30+90),height=250,left=52,right=20,top=22,bottom=45,plotWidth=width-left-right,plotHeight=height-top-bottom;
    svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.style.minWidth=width+'px';
    svg.setAttribute('aria-label',title+' '+(mode==='line'?'line graph':'bar chart')+'. '+(values.length?'Chart data is also available in the table below.':'No recorded data for this period.'));
    function shape(type,attrs,parent){var el=document.createElementNS(ns,type);Object.keys(attrs||{}).forEach(function(k){el.setAttribute(k,attrs[k]);});(parent||svg).appendChild(el);return el;}
    function label(x,y,value,cls){var t=shape('text',{x:x,y:y,'class':cls});t.textContent=value;return t;}
    var max=Math.max(1,...values.map(function(x){return x.value;}));
    for(var tick=0;tick<=4;tick++){var y=top+plotHeight*(1-tick/4);shape('line',{x1:left,y1:y,x2:width-right,y2:y,'class':'stats-chart-grid'});var amount=max*tick/4;var axis=metric==='worked-hours'?(Math.round(amount/60*10)/10)+'h':String(Math.round(amount*10)/10);label(left-8,y+4,axis,'stats-chart-axis stats-chart-y');}
    var points=[],spacing=values.length?plotWidth/values.length:plotWidth;
    values.forEach(function(item,i){
      var x=left+(i+.5)*spacing,y=top+plotHeight-(item.value/max)*plotHeight;
      if(mode==='bar'){var bar=shape('rect',{x:x-Math.min(spacing*.32,15),y:y,width:Math.max(1,Math.min(spacing*.64,30)),height:Math.max(0,top+plotHeight-y),rx:3,'class':'stats-chart-bar'});var tip=shape('title',{},bar);tip.textContent=item.label+': '+display(item.value,metric);}
      else points.push(x+','+y);
      if(i===0 || i===values.length-1 || i%Math.max(1,Math.ceil(values.length/9))===0)label(x,height-18,item.label,'stats-chart-axis stats-chart-x');
      var row=document.createElement('tr'),a=document.createElement('th'),b=document.createElement('td');a.scope='row';a.textContent=item.label;b.textContent=display(item.value,metric);row.append(a,b);tbody.append(row);
    });
    if(mode==='line'&&points.length){shape('polyline',{points:points.join(' '),'class':'stats-chart-line'});values.forEach(function(item,i){var x=left+(i+.5)*spacing,y=top+plotHeight-(item.value/max)*plotHeight;var dot=shape('circle',{cx:x,cy:y,r:4,'class':'stats-chart-point'});var tip=shape('title',{},dot);tip.textContent=item.label+': '+display(item.value,metric);});}
    if(!values.length)label(width/2,height/2,'No recorded data for this period','stats-chart-empty');
  }
  window.GMTStatsCharts={series:series,draw:draw};
}());
