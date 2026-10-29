(function () {
  'use strict';
  var map=null, markers=null, activePlaces=[], currentIdentity='', matches=Object.create(null), lastLookup=0, lookupQueue=Promise.resolve();
  function key(name){return currentIdentity+'|'+String(name||'').trim().toLowerCase();}
  function message(element,value){element.textContent=value;}
  function createMap(){
    if(map || !window.L)return;
    map=window.L.map('stats-map',{scrollWheelZoom:false}).setView([53.2,-2.3],5);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    markers=window.L.layerGroup().addTo(map);
  }
  function redraw(){
    if(!map)return;markers.clearLayers();var bounds=[];
    activePlaces.forEach(function(place){var match=matches[key(place.name)];if(!match)return;
      var popup=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('div');title.textContent=place.name;detail.textContent=place.visits+' recorded '+(place.visits===1?'workday':'workdays')+' · '+match.label;popup.append(title,detail);
      window.L.circleMarker([match.lat,match.lon],{radius:Math.min(20,6+Math.sqrt(place.visits)*2),color:'#0d4a22',fillColor:'#d5ad30',fillOpacity:.8,weight:2}).bindPopup(popup).addTo(markers);bounds.push([match.lat,match.lon]);
    });
    map.invalidateSize();if(bounds.length===1)map.setView(bounds[0],12);else if(bounds.length>1)map.fitBounds(bounds,{padding:[25,25],maxZoom:13});else map.setView([53.2,-2.3],5);
  }
  function label(properties){return [properties.name,properties.street,properties.housenumber,properties.city||properties.town||properties.village,properties.postcode,properties.country].filter(Boolean).filter(function(x,i,a){return a.indexOf(x)===i;}).join(', ');}
  async function requestCandidates(place,container,status){
    var wait=Math.max(0,1200-(Date.now()-lastLookup));if(wait)await new Promise(function(resolve){setTimeout(resolve,wait);});lastLookup=Date.now();
    status.textContent='Looking up suggested locations…';
    try{
      var postcode=String(place.name).toUpperCase().match(/\b(?:GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/), url, postcodeSearch=!!(postcode && !/^BT/.test(postcode[0]));
      if(postcodeSearch) url=new URL('https://api.postcodes.io/postcodes/'+encodeURIComponent(postcode[0].replace(/\s+/g,'')));
      else {url=new URL('https://photon.komoot.io/api/');url.searchParams.set('q',place.name);url.searchParams.set('limit','5');url.searchParams.set('lat','51.38');url.searchParams.set('lon','-0.10');}
      var response=await fetch(url.toString(),{credentials:'omit',referrerPolicy:'origin'});if(!response.ok)throw new Error('The location lookup is unavailable.');
      var body=await response.json(),results=postcodeSearch ? (body.result && body.result.longitude!=null && body.result.latitude!=null && body.result.longitude!=='' && body.result.latitude!==''?[{lon:Number(body.result.longitude),lat:Number(body.result.latitude),label:String(body.result.postcode||postcode[0])+' postcode area (approximate)'}]:[]) : (Array.isArray(body.features)?body.features:[]).map(function(feature){var c=feature&&feature.geometry&&feature.geometry.coordinates,p=feature&&feature.properties||{};if(!Array.isArray(c)||c[0]==null||c[1]==null||c[0]===''||c[1]===''||!Number.isFinite(Number(c[0]))||!Number.isFinite(Number(c[1])))return null;return {lon:Number(c[0]),lat:Number(c[1]),label:label(p)};});
      results=results.filter(function(x){return x&&x.label&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)&&Math.abs(x.lat)<=90&&Math.abs(x.lon)<=180;});
      if(!results.length){status.textContent='No match found. Add a fuller location to the work record if available.';return;}
      var select=document.createElement('select');select.setAttribute('aria-label','Choose a match for '+place.name);select.add(new Option('Choose a matching location',''));results.forEach(function(item,index){select.add(new Option(item.label,String(index)));});
      var confirm=document.createElement('button');confirm.type='button';confirm.className='secondary';confirm.textContent='Place on map';
      confirm.addEventListener('click',function(){if(select.value===''){status.textContent='Choose the matching place before adding it to the map.';return;}matches[key(place.name)]=results[Number(select.value)];status.textContent='Location selected: '+matches[key(place.name)].label;redraw();});
      container.append(select,confirm);status.textContent='Choose the matching result; suggestions may be approximate.';
    }catch(error){message(status,error&&error.message?error.message:'The location lookup could not be completed.');}
  }
  function search(place,container,status){
    lookupQueue=lookupQueue.catch(function(){}).then(function(){return requestCandidates(place,container,status);});
    return lookupQueue;
  }
  function render(places,identity){
    currentIdentity=String(identity||'');activePlaces=Array.isArray(places)?places:[];
    // Public CR0 2DN postcode centroid from Postcodes.io, not a rooftop position.
    activePlaces.forEach(function(place){if(place.name==='GMT workshop, 93–95 Gloucester Road, Croydon CR0 2DN' && !matches[key(place.name)])matches[key(place.name)]={lat:51.384945,lon:-0.089787,label:'CR0 2DN postcode area (approximate)'};});
    createMap();redraw();
    var list=document.getElementById('stats-location-list');list.replaceChildren();
    if(!activePlaces.length){var empty=document.createElement('p');empty.textContent='No named work locations are recorded for this selection.';list.append(empty);return;}
    activePlaces.forEach(function(place){
      var card=document.createElement('div');card.className='stats-location';var title=document.createElement('strong'),count=document.createElement('small'),button=document.createElement('button'),status=document.createElement('p'),choices=document.createElement('div');
      title.textContent=place.name;count.textContent=place.visits+' recorded '+(place.visits===1?'workday':'workdays');button.type='button';button.className='secondary';button.textContent='Find on map';status.className='stats-location-status';
      if(matches[key(place.name)])status.textContent='Mapped: '+matches[key(place.name)].label;
      button.addEventListener('click',async function(){button.disabled=true;choices.replaceChildren();await search(place,choices,status);button.disabled=false;});
      card.append(title,count,button,status,choices);list.append(card);
    });
  }
  window.GMTStatsMap={render:render};
}());
