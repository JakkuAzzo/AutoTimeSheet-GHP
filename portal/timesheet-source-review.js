(function () {
  "use strict";
  var root=document.getElementById('source-review'),api=window.GMTPortalApi;
  if(!root || !api || typeof api.access!=='function' || typeof api.request!=='function')return;
  root.innerHTML='<div class="estimate-preview-toolbar"><div><p class="portal-card-kicker">Accounts review</p><h2>Timesheet source ownership</h2></div><button type="button" class="secondary" data-open>Review source ownership</button></div>'+
    '<div data-workspace hidden><p>Inspect a record and confirm its employee only when the source evidence is clear. This review covers the current record only; older versions and attachments need separate checks.</p>'+
    '<button type="button" class="secondary" data-refresh>Refresh records</button> <span role="status" data-status></span>'+
    '<div class="pay-month-layout"><section class="pay-month-list-panel"><h3>Source records</h3><label>Find record or name <input type="search" data-filter></label><label> Review status <select data-filter-status><option value="">All records</option><option value="unreviewed">Needs review</option><option value="reviewed">Reviewed</option><option value="excluded">Not a timesheet</option><option value="changed">Changed since review</option><option value="missing">No longer in current list</option></select></label><div data-list></div></section>'+
    '<section class="estimate-paper"><h3 data-title>Select a record</h3><div data-fields></div><div data-review hidden>'+
    '<label>Employee work sign-in <input type="email" data-upn autocomplete="off"></label> <button type="button" class="secondary" data-find>Find employee</button><p data-person role="status"></p>'+
    '<label>Evidence reference <input type="text" data-evidence maxlength="180" placeholder="e.g. confirmation-17"></label>'+
    '<p class="small-text">Use a short reference to the evidence you checked, using letters, numbers, dots, hyphens or underscores.</p>'+
    '<p><label class="source-review-confirm"><input type="checkbox" data-confirm> <span>I have checked the original evidence and this source belongs to this employee</span></label></p>'+
    '<button type="button" data-save disabled>Confirm ownership</button></div><section data-exclusion hidden><h4>Not a timesheet</h4><p>Use this only when the original evidence establishes that this current item contains no timesheet data. Earlier versions and attachments require separate checks.</p><label>Non-timesheet evidence reference <input type="text" data-exclusion-evidence maxlength="180" placeholder="e.g. calendar-evidence"></label><p><label class="source-review-confirm"><input type="checkbox" data-exclusion-confirm> <span>I checked the original evidence and this current item contains no timesheet data</span></label></p><button type="button" data-exclusion-save disabled>Mark as non-timesheet</button></section><div data-revoke-area hidden><p>To change an existing decision, first withdraw it and inspect the current source again.</p><button type="button" class="secondary" data-revoke>Withdraw review</button></div></section></div></div>';
  var q=function(name){return root.querySelector('[data-'+name+']')},workspace=q('workspace'),list=q('list'),status=q('status'),fields=q('fields'),review=q('review'),upn=q('upn'),person=q('person'),evidence=q('evidence'),confirm=q('confirm'),save=q('save'),revokeArea=q('revoke-area'),exclusion=q('exclusion'),exclusionEvidence=q('exclusion-evidence'),exclusionConfirm=q('exclusion-confirm'),exclusionSave=q('exclusion-save');
  var selected=null,snapshot=null,subject=null,sequence=0,lookupSequence=0,refreshSequence=0,busy=false,inventory=[];
  function setStatus(value){status.textContent=value;}
  function clearDetail(){sequence++;lookupSequence++;selected=null;snapshot=null;subject=null;fields.replaceChildren();q('title').textContent='Select a record';review.hidden=true;exclusion.hidden=true;revokeArea.hidden=true;upn.value='';evidence.value='';confirm.checked=false;exclusionEvidence.value='';exclusionConfirm.checked=false;person.textContent='';updateSave();}
  function updateSave(){save.disabled=busy || !snapshot || !subject || !confirm.checked || !/^[a-zA-Z0-9._:/-]{1,180}$/.test(evidence.value.trim()) || upn.value.trim().toLowerCase()!==subject.upn;exclusionSave.disabled=busy||!snapshot||!exclusionConfirm.checked||!/^[a-zA-Z0-9._:/-]{1,180}$/.test(exclusionEvidence.value.trim());}
  function renderList(){list.replaceChildren();var term=q('filter').value.trim().toLowerCase(),wanted=q('filter-status').value;
    inventory.filter(function(item){return (!term||String(item.itemId).includes(term)||String(item.claimedName||'').toLowerCase().includes(term))&&(!wanted||item.status===wanted)}).forEach(function(item){var button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Inspect record '+item.itemId;button.setAttribute('aria-label','Inspect record '+item.itemId);button.addEventListener('click',function(){inspect(item)});var line=document.createElement('p');var label=item.claimedName?' · '+item.claimedName+' (claimed)':'';if(item.weekStart)label+=' · '+item.weekStart+(item.weekEnd?' – '+item.weekEnd:'');line.append(button,document.createTextNode(label+' · '+({unreviewed:'Needs review',reviewed:'Reviewed',excluded:'Not a timesheet',changed:'Changed since review',missing:'No longer in current list'}[item.status]||'Needs attention')));list.append(line)});
  }
  function parseSourceCsv(raw){
    if(raw.length>500000)return null;
    var rows=[],row=[],value='',state='start';
    function field(){row.push(value);value='';state='start';if(row.length>40)throw new Error('Too many fields')}
    function line(){field();if(row.some(function(v){return v!==''}))rows.push(row);row=[];if(rows.length>201)throw new Error('Too many rows')}
    try{for(var i=0;i<raw.length;i++){var c=raw[i];
      if(state==='quoted'){if(c==='"'){if(raw[i+1]==='"'){value+='"';i++}else state='closed'}else value+=c;}
      else if(c===',' ){field()}
      else if(c==='\r'||c==='\n'){if(c==='\r'&&raw[i+1]==='\n')i++;line()}
      else if(c==='"'&&state==='start'){state='quoted'}
      else if(c==='"'||state==='closed'){throw new Error('Invalid quote')}
      else{value+=c;state='plain'}
      if(value.length>10000)throw new Error('Oversized field');
    }
    if(state==='quoted')throw new Error('Unclosed quote');if(value!==''||row.length)line();
    if(rows.length<2)return null;var header=rows.shift();header[0]=header[0].replace(/^\uFEFF/,'');
    if(new Set(header).size!==header.length || !['Date','Start','Finish'].every(function(k){return header.includes(k)}) || rows.some(function(r){return r.length!==header.length}))return null;
    return {header:header,rows:rows};}catch(_){return null;}
  }
  function showStructuredSource(raw){var data,csv=null,sourceRows;try{data=JSON.parse(raw)}catch(_){csv=parseSourceCsv(raw)}
    if(csv){sourceRows=csv.rows.map(function(row){var result=Object.create(null);csv.header.forEach(function(key,i){result[key]=row[i]});return result});data={rows:sourceRows};}
    else if(Array.isArray(data)){data={rows:data};}
    if(!data||typeof data!=='object'||!Array.isArray(data.rows)||data.rows.length>200||data.rows.some(function(row){return !row||typeof row!=='object'||Array.isArray(row)}))return false;
    var heading=document.createElement('h4');heading.textContent='Claimed source details';fields.append(heading);
    var identity=document.createElement('p');identity.textContent=[data.employeeName||data.employee||'',data.employeeEmail||data.employeeUpn||'',data.weekStart||'',data.weekEnd||''].filter(Boolean).join(' · ');fields.append(identity);
    var normalise=function(value){return typeof value==='string'?value.trim().toLowerCase():''};
    var names=new Set([snapshot?.fields?.EmployeeName,data.employeeName,data.employee].concat(data.rows.map(function(row){return row.employeeName})).map(normalise).filter(Boolean));
    var addresses=new Set([snapshot?.fields?.Employee_x0020_Email,data.employeeEmail,data.employeeUpn].concat(data.rows.flatMap(function(row){return [row.employeeEmail,row.employeeUpn]})).map(normalise).filter(Boolean));
    if(names.size>1||addresses.size>1){var warning=document.createElement('p');warning.className='portal-history-warning';warning.textContent='Names or sign-ins differ within this source. Check the original evidence before confirming its owner.';fields.append(warning)}
    var weekStart=String(snapshot?.fields?.Week_x0020_Start||'').slice(0,10),weekEnd=String(snapshot?.fields?.Week_x0020_End||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(weekStart)&&/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)&&data.rows.some(function(row){var date=String(csv?row.Date:row.date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(date)&&(date<weekStart||date>weekEnd)})){
      var dateWarning=document.createElement('p');dateWarning.className='portal-history-warning';dateWarning.textContent='Some dates fall outside the declared week. Check the original evidence before confirming its owner.';fields.append(dateWarning);
    }
    var hint=document.createElement('p');hint.className='small-text';hint.textContent='Scroll sideways to see all daily entry columns.';fields.append(hint);
    var wrap=document.createElement('div');wrap.style.overflowX='auto';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Scroll daily entries');var table=document.createElement('table');table.setAttribute('aria-label','Daily entries in this source');
    var labels=csv?csv.header:['Date','Person claimed','Sign-in claimed','Start','Finish','Break','Absence','Worked hours','Basic hours','Overtime 1.5','Overtime 2','Location','Notes'],head=document.createElement('thead'),header=document.createElement('tr');
    labels.forEach(function(label){var th=document.createElement('th');th.textContent=label;header.append(th)});head.append(header);table.append(head);
    var body=document.createElement('tbody');data.rows.forEach(function(row){var tr=document.createElement('tr');var breakValue=row.lunchMinutes===null||row.lunchMinutes===undefined||row.lunchMinutes===''?'Not recorded':String(row.lunchMinutes)+' minutes';
      var values=csv?labels.map(function(key){return row[key]}):[row.date,row.employeeName,row.employeeUpn||row.employeeEmail,row.start||row.startTime,row.finish||row.finishTime,breakValue,row.absenceStatus||row.absenceReason,row.workedHours,row.basicHours,row.ot15Hours,row.ot20Hours,row.location,row.note];
      values.forEach(function(value){var cell=document.createElement('td');cell.textContent=value===null||value===undefined||value===''?'Not recorded':String(value);tr.append(cell)});body.append(tr)});table.append(body);wrap.append(table);fields.append(wrap);
    var details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('pre');summary.textContent='Full source details';content.textContent=raw;details.append(summary,content);fields.append(details);return true;
  }
  function versionDetail(version,item,history,ticket){
    var id=String(version.versionId||''),detail=document.createElement('details'),label=document.createElement('summary'),value=document.createElement('pre');
    var state=version.reviewStatus||'unreviewed',stateText={unreviewed:'Needs review',reviewed:'Reviewed',changed:'Changed since review',missing:'No longer available'}[state]||'Needs attention';
    label.textContent='Version '+id+(version.modifiedAt?' · '+String(version.modifiedAt):'')+' · '+stateText;detail.append(label);
    value.textContent=version.fields?JSON.stringify(version.fields,null,2):'The original version is no longer available.';detail.append(value);
    var prefix='/api/admin/timesheet-source-review/'+encodeURIComponent(item.itemId)+'/versions/'+encodeURIComponent(id)+'/review';
    if(version.reviewId){var current=document.createElement('p');current.textContent=version.classification==='not_timesheet'?'Previously classified as not a timesheet.':'Previously reviewed for '+String(version.subjectUpn||'an employee')+'.';detail.append(current);
      var revoke=document.createElement('button');revoke.type='button';revoke.className='secondary';revoke.textContent='Withdraw review for version '+id;detail.append(revoke);
      revoke.addEventListener('click',async function(){if(busy||!window.confirm('Withdraw the review for version '+id+'?'))return;busy=true;updateSave();revoke.disabled=true;try{
        await api.request(prefix+'/revoke',{method:'POST',body:{reviewId:version.reviewId}});if(ticket===sequence){await inspect(item);setStatus('Review withdrawn for version '+id+'.');}
      }catch(error){if(ticket===sequence)setStatus(error.message||'Version review could not be withdrawn.')}finally{busy=false;revoke.disabled=false;updateSave()}});return detail;
    }
    if(state!=='unreviewed'||!/^[a-f0-9]{64}$/.test(String(version.fieldsSha256||''))||!Number.isSafeInteger(version.reviewEventId)){var unavailable=document.createElement('p');unavailable.textContent='This version cannot be reviewed until its source is available and verified.';detail.append(unavailable);return detail;}
    var choice=document.createElement('select'),choiceLabel=document.createElement('label');choiceLabel.textContent='Classification for version '+id+' ';[['','Choose classification'],['employee','Belongs to an employee'],['not_timesheet','Not a timesheet']].forEach(function(option){var o=document.createElement('option');o.value=option[0];o.textContent=option[1];choice.append(o)});choiceLabel.append(choice);detail.append(choiceLabel);
    var personArea=document.createElement('div'),personLabel=document.createElement('label'),personInput=document.createElement('input'),find=document.createElement('button'),personStatus=document.createElement('p');
    personArea.hidden=true;personInput.type='email';personInput.autocomplete='off';personLabel.textContent='Employee sign-in for version '+id+' ';personLabel.append(personInput);find.type='button';find.className='secondary';find.textContent='Find employee for version '+id;personStatus.setAttribute('role','status');personArea.append(personLabel,find,personStatus);detail.append(personArea);
    var evidenceLabel=document.createElement('label'),versionEvidence=document.createElement('input');versionEvidence.type='text';versionEvidence.maxLength=180;evidenceLabel.textContent='Evidence reference for version '+id+' ';evidenceLabel.append(versionEvidence);detail.append(evidenceLabel);
    var confirmLine=document.createElement('p'),confirmLabel=document.createElement('label'),versionConfirm=document.createElement('input'),confirmText=document.createElement('span');confirmLabel.className='source-review-confirm';versionConfirm.type='checkbox';confirmText.textContent='I checked the original evidence and version '+id+' belongs to this employee';confirmLabel.append(versionConfirm,confirmText);confirmLine.append(confirmLabel);detail.append(confirmLine);
    var versionSave=document.createElement('button'),feedback=document.createElement('p'),versionSubject=null,lookup=0;versionSave.type='button';versionSave.textContent='Save review for version '+id;feedback.setAttribute('role','status');detail.append(versionSave,feedback);
    function check(){versionSave.disabled=busy||!choice.value||!versionConfirm.checked||!/^[a-zA-Z0-9._:/-]{1,180}$/.test(versionEvidence.value.trim())||(choice.value==='employee'&&(!versionSubject||personInput.value.trim().toLowerCase()!==versionSubject.upn));}
    choice.addEventListener('change',function(){lookup++;versionSubject=null;personStatus.textContent='';versionConfirm.checked=false;personArea.hidden=choice.value!=='employee';confirmText.textContent=choice.value==='not_timesheet'?'I checked this version contains no timesheet data':'I checked the original evidence and version '+id+' belongs to this employee';check()});
    personInput.addEventListener('input',function(){lookup++;versionSubject=null;personStatus.textContent='';versionConfirm.checked=false;check()});versionEvidence.addEventListener('input',check);versionConfirm.addEventListener('change',check);
    find.addEventListener('click',async function(){var upn=personInput.value.trim().toLowerCase(),attempt=++lookup;versionSubject=null;versionConfirm.checked=false;personStatus.textContent='Checking employee…';check();try{
      var found=await api.request('/api/admin/timesheet-review-subject?upn='+encodeURIComponent(upn));if(attempt!==lookup||ticket!==sequence||choice.value!=='employee'||upn!==personInput.value.trim().toLowerCase())return;
      if(!found||found.upn!==upn||!found.oid)throw new Error('Employee sign-in could not be verified.');versionSubject=found;personStatus.textContent=(found.name||found.upn)+' · '+found.upn+(found.accountEnabled===false?' · Account inactive':'');check();
    }catch(error){if(attempt===lookup&&ticket===sequence)personStatus.textContent=error.message||'Employee could not be verified.'}});
    versionSave.addEventListener('click',async function(){check();if(versionSave.disabled||busy)return;busy=true;updateSave();check();var classification=choice.value,body={classification:classification,expectedCurrentEtag:history.currentEtag,expectedCurrentFieldsSha256:history.currentFieldsSha256,fieldsSha256:version.fieldsSha256,expectedReviewEventId:version.reviewEventId,evidenceReference:versionEvidence.value.trim()};if(classification==='employee'){body.subjectOid=versionSubject.oid;body.subjectUpn=versionSubject.upn}
      try{await api.request(prefix,{method:'POST',body:body});if(ticket===sequence){await inspect(item);setStatus('Review saved for version '+id+'.')}}catch(error){if(ticket===sequence)feedback.textContent=error.message||'Version review could not be saved.'}finally{busy=false;updateSave();check()}});
    check();return detail;
  }
  async function refresh(){var ticket=++refreshSequence;clearDetail();inventory=[];list.replaceChildren();setStatus('Loading source records…');try{
    var result=await api.request('/api/admin/timesheet-source-review');if(!result || !Array.isArray(result.items))throw new Error('The source list is unavailable.');
    if(ticket!==refreshSequence)return;inventory=result.items;renderList();
    setStatus(result.items.length+' source record(s) found.');
  }catch(error){if(ticket===refreshSequence)setStatus(error.message||'Unable to load source records.');}}
  async function inspect(item){clearDetail();selected=item;var ticket=sequence;q('title').textContent='Record '+item.itemId;revokeArea.hidden=!(item.reviewId||item.exclusionId);
    if(item.status==='missing'){fields.textContent='This reviewed record is no longer in the current list.';return;}
    fields.textContent='Loading record…';try{var data=await api.request('/api/admin/timesheet-source-review/'+encodeURIComponent(item.itemId));if(ticket!==sequence)return;
      if(!data || data.itemId!==item.itemId || !data.fields || typeof data.fields!=='object')throw new Error('The source record is unavailable.');
      snapshot=data;fields.replaceChildren();
      var notice=document.createElement('p');notice.textContent=data.fields.Attachments===true || data.fields.Attachments==='true'?'This record has an attachment. The attachment is not shown here; open and inspect the original evidence separately.':'Inspect the original evidence separately; this view only shows the current list record.';fields.append(notice);
      var versionButton=document.createElement('button'),versionPanel=document.createElement('div');versionButton.type='button';versionButton.className='secondary';versionButton.textContent='View previous versions';fields.append(versionButton,versionPanel);
      versionButton.addEventListener('click',async function(){versionButton.disabled=true;versionPanel.textContent='Loading previous versions…';try{
        var history=await api.request('/api/admin/timesheet-source-review/'+encodeURIComponent(item.itemId)+'/versions');if(ticket!==sequence)return;
        if(!history||history.itemId!==item.itemId||!Array.isArray(history.versions)||(data.etag&&history.currentEtag!==data.etag)||(data.fieldsSha256&&history.currentFieldsSha256!==data.fieldsSha256))throw new Error('The source changed; refresh and inspect it again.');
        versionPanel.replaceChildren();var explanation=document.createElement('p');explanation.textContent='Previous versions are not approved by a current-record review. Check their ownership separately.';versionPanel.append(explanation);
        if(!history.versions.length){var empty=document.createElement('p');empty.textContent='No previous versions were returned.';versionPanel.append(empty)}
        history.versions.forEach(function(version){versionPanel.append(versionDetail(version,item,history,ticket))});
      }catch(error){if(ticket===sequence)versionPanel.textContent=error.message||'Previous versions could not be loaded.'}finally{versionButton.disabled=false}});
      try{var sourceLink=new URL(data.sourceUrl);if(sourceLink.protocol==='https:'){var link=document.createElement('a'),linkLine=document.createElement('p');link.href=sourceLink.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open original SharePoint record';linkLine.append(link);fields.append(linkLine)}}catch(_){}
      var technical=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Record details';technical.append(summary);
      var systemKeys=new Set(['id','ContentType','AuthorLookupId','EditorLookupId','AppAuthorLookupId','AppEditorLookupId','Edit','LinkTitle','LinkTitleNoMenu','ItemChildCount','FolderChildCount']);
      Object.keys(data.fields).forEach(function(key){if(key==='Attachments')return;var v=data.fields[key];if(key==='Issue'&&typeof v==='string'&&showStructuredSource(v))return;var heading=document.createElement('strong'),value=document.createElement('pre');heading.textContent=key.replace(/_x([0-9a-f]{4})_/gi,function(_,hex){return String.fromCharCode(parseInt(hex,16))}).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');value.textContent=typeof v==='string'?v:JSON.stringify(v,null,2);value.style.whiteSpace='pre-wrap';value.style.overflowWrap='anywhere';(systemKeys.has(key)||key.startsWith('@')||key.startsWith('_')?technical:fields).append(heading,value)});
      if(technical.childElementCount>1)fields.append(technical);
      review.hidden=Boolean(item.reviewId||item.exclusionId);exclusion.hidden=review.hidden;setStatus('Inspect the record before confirming its employee or classifying it.');
    }catch(error){if(ticket===sequence){snapshot=null;fields.textContent=error.message||'Unable to open the record.';}}}
  upn.addEventListener('input',function(){lookupSequence++;subject=null;person.textContent='';confirm.checked=false;updateSave()});
  evidence.addEventListener('input',updateSave);confirm.addEventListener('change',updateSave);exclusionEvidence.addEventListener('input',updateSave);exclusionConfirm.addEventListener('change',updateSave);
  q('find').addEventListener('click',async function(){var value=upn.value.trim().toLowerCase(),ticket=++lookupSequence,selection=sequence;subject=null;confirm.checked=false;updateSave();person.textContent='Checking employee…';try{
    var found=await api.request('/api/admin/timesheet-review-subject?upn='+encodeURIComponent(value));if(ticket!==lookupSequence || selection!==sequence || value!==upn.value.trim().toLowerCase())return;
    if(!found || found.upn!==value || !found.oid)throw new Error('Employee sign-in could not be verified.');subject=found;person.textContent=(found.name||found.upn)+' · '+found.upn+(found.accountEnabled===false?' · Account inactive':'');updateSave();
  }catch(error){if(ticket===lookupSequence && selection===sequence)person.textContent=error.message||'Employee could not be verified.';}});
  save.addEventListener('click',async function(){updateSave();if(save.disabled || !selected)return;busy=true;updateSave();var item=selected,data=snapshot,employee=subject;try{
    await api.request('/api/admin/timesheet-source-review/'+encodeURIComponent(item.itemId),{method:'POST',body:{expectedEtag:data.etag,fieldsSha256:data.fieldsSha256,expectedReviewEventId:data.reviewEventId,expectedExclusionEventId:data.exclusionEventId,subjectOid:employee.oid,subjectUpn:employee.upn,evidenceReference:evidence.value.trim()}});
    await refresh();setStatus('Ownership review saved for record '+item.itemId+'.');
  }catch(error){setStatus(error.message||'Review could not be saved.');}finally{busy=false;updateSave()}});
  exclusionSave.addEventListener('click',async function(){updateSave();if(exclusionSave.disabled||!selected)return;busy=true;updateSave();var item=selected,data=snapshot;try{
    await api.request('/api/admin/timesheet-source-review/'+encodeURIComponent(item.itemId)+'/not-timesheet',{method:'POST',body:{expectedEtag:data.etag,fieldsSha256:data.fieldsSha256,expectedReviewEventId:data.reviewEventId,expectedExclusionEventId:data.exclusionEventId,evidenceReference:exclusionEvidence.value.trim()}});
    await refresh();setStatus('Non-timesheet classification saved for record '+item.itemId+'.');
  }catch(error){setStatus(error.message||'Classification could not be saved.');}finally{busy=false;updateSave()}});
  q('revoke').addEventListener('click',async function(){if(busy || !selected || !(selected.reviewId||selected.exclusionId))return;var item=selected;if(!window.confirm('Withdraw the source review for record '+item.itemId+'?'))return;busy=true;q('revoke').disabled=true;try{
    var isExclusion=Boolean(item.exclusionId),path='/api/admin/timesheet-source-review/'+encodeURIComponent(item.itemId)+(isExclusion?'/not-timesheet/revoke':'/revoke');
    await api.request(path,{method:'POST',body:isExclusion?{exclusionId:item.exclusionId}:{reviewId:item.reviewId}});await refresh();setStatus('Review withdrawn for record '+item.itemId+'.');
  }catch(error){setStatus(error.message||'Review could not be withdrawn.');}finally{busy=false;q('revoke').disabled=false;updateSave()}});
  q('open').addEventListener('click',function(){workspace.hidden=!workspace.hidden;if(!workspace.hidden)refresh();else {refreshSequence++;clearDetail()}});q('refresh').addEventListener('click',refresh);q('filter').addEventListener('input',renderList);q('filter-status').addEventListener('change',renderList);
  api.access().then(function(access){if(access && access.canReviewTimesheetOwnership===true)root.hidden=false}).catch(function(){});
}());
