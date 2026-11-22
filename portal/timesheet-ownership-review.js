(function(){
  'use strict';
  var root=document.getElementById('ownership-review'),api=window.GMTPortalApi;
  if(!root || !api || typeof api.access!=='function' || typeof api.request!=='function')return;
  root.innerHTML='<div class="estimate-preview-toolbar"><div><p class="portal-card-kicker">Accounts review</p><h2>Confirmed timesheet records</h2></div><button type="button" class="secondary" data-open>Review confirmed records</button></div>'+
    '<div data-workspace hidden><p>Choose the private ownership review file. Each current record and employee account will be checked again before a decision can be saved. Earlier versions, original files and hours are not approved by this step.</p>'+
    '<label>Ownership review file <input type="file" accept="application/json,.json" data-file></label> <button type="button" class="secondary" data-check>Check records</button>'+
    '<p role="status" data-status></p><div data-results></div><div data-apply-area hidden><p>Queued records remain queued; ownership review can hold their delivery until the separate delivery checks are complete.</p>'+
    '<label>Evidence reference <input type="text" data-evidence maxlength="180" placeholder="e.g. confirmed-2026-11-16"></label>'+
    '<p><label class="source-review-confirm"><input type="checkbox" data-confirm> <span>I confirm these current records belong to the listed employees</span></label></p>'+
    '<button type="button" data-apply disabled>Apply ownership decisions</button></div></div>';
  var q=function(key){return root.querySelector('[data-'+key+']')},file=q('file'),status=q('status'),results=q('results'),apply=q('apply'),evidence=q('evidence'),confirm=q('confirm'),area=q('apply-area');
  var candidates=[],valid=false,busy=false,sequence=0;
  function setStatus(message){status.textContent=message;}
  function updateApply(){apply.disabled=busy || !valid || !candidates.some(function(c){return c.state==='ready'}) || !confirm.checked || !/^[a-zA-Z0-9._:/-]{1,180}$/.test(evidence.value.trim());}
  function reset(){sequence++;candidates=[];valid=false;area.hidden=true;results.replaceChildren();confirm.checked=false;updateApply();}
  function validate(data){
    if(!data || !Array.isArray(data.entries) || !data.entries.length || data.entries.length>100)throw new Error('The review file has no usable records.');
    var seen=new Set();return data.entries.map(function(entry){
      var id=String(entry.record_id||''),upn=String(entry.confirmed_employee_upn||'').trim().toLowerCase(),oid=String(entry.current_directory_object_id||'').trim().toLowerCase();
      if(!id || id.length>250 || /[\x00-\x1f\x7f]/.test(id) || seen.has(id) || !/^[a-f0-9]{64}$/.test(entry.payload_sha256||'') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid) || upn.length>320 || !/^[^\s@]+@[^\s@]+$/.test(upn) ||
        typeof entry.stored_updated_at!=='string' || entry.version_scope!=='current_payload_only' || entry.status!=='reviewed_not_applied')throw new Error('The review file contains an invalid or duplicate record.');
      seen.add(id);return {id:id,upn:upn,oid:oid,digest:entry.payload_sha256,updated:entry.stored_updated_at};
    });
  }
  function render(){results.replaceChildren();candidates.forEach(function(c){var group=document.createElement('div'),line=document.createElement('p');var date=c.snapshot?.record?(c.snapshot.record.start_date||'')+' – '+(c.snapshot.record.end_date||''):'';line.textContent=c.id+' · '+(c.person?.name||c.upn)+' · '+c.upn+(c.person?.accountEnabled===false?' · Account inactive':'')+(date.trim()!=='–'?' · '+date:'')+' · '+c.message;group.append(line);
    if(c.state==='saved' && c.snapshot?.record?.action==='pay_month_correction'){
      var button=document.createElement('button'),details=document.createElement('div'),ticket=sequence;button.type='button';button.className='secondary';button.textContent='View other local history';group.append(button,details);
      button.addEventListener('click',async function(){button.disabled=true;details.textContent='Checking other local records…';try{
        var data=await api.request('/api/admin/timesheet-ownership-review/'+encodeURIComponent(c.id)+'/local-history?upn='+encodeURIComponent(c.upn));if(ticket!==sequence)return;
        if(!data||data.scope!=='other-local-records-only'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.payMonth||'')||!Array.isArray(data.rows)||data.rows.length>62)throw new Error('The history could not be verified.');
        details.replaceChildren();var warning=document.createElement('p');warning.textContent='Other current local records for '+data.payMonth+'. This does not include the selected correction and does not prove that the month is complete. Earlier versions, attachments and other sources need separate review. Nothing is queued or delivered by this view.';details.append(warning);
        if(!data.rows.length){var empty=document.createElement('p');empty.textContent='No unambiguous local dates were returned.';details.append(empty)}
        data.rows.forEach(function(row){if(!row||!/^\d{4}-\d{2}-\d{2}$/.test(String(row.Date||'')))throw new Error('The local history is invalid.');var entry=document.createElement('p'),minutes=row['Total hours'],hours=Number.isInteger(minutes)&&minutes>=0?Math.floor(minutes/60)+'h '+String(minutes%60).padStart(2,'0')+'m':'not recorded';entry.textContent=[row.Date,row.Start||'—',row.Finish||'—',row.Break===''?'break not recorded':'break '+row.Break+' min',row.Absence||'NA',hours,row.Notes||''].join(' · ');details.append(entry)});
        var conflicts=data.conflicts||[];if(!Array.isArray(conflicts)||conflicts.length>62)throw new Error('The local history is invalid.');
        conflicts.forEach(function(conflict){if(!conflict||!/^\d{4}-\d{2}-\d{2}$/.test(String(conflict.date||''))||!Array.isArray(conflict.candidates)||conflict.candidates.length<(conflict.reason==='uninterpreted-source-rates'?1:2)||conflict.candidates.length>1000)throw new Error('The local history is invalid.');var heading=document.createElement('h4');heading.textContent=conflict.date+' · Needs review';details.append(heading);if(conflict.reason==='uninterpreted-source-rates'){var rateWarning=document.createElement('p');rateWarning.textContent='Source rate figures need review against the original; their format is not recorded.';details.append(rateWarning)}
          var rateFields=['Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours'];var showRates=conflict.candidates.some(function(c){return c.row&&rateFields.some(function(f){return c.row[f]!==''&&c.row[f]!==undefined&&c.row[f]!==null})});
          conflict.candidates.forEach(function(candidate){if(!candidate||typeof candidate.recordId!=='string'||typeof candidate.deleted!=='boolean'||(!candidate.deleted&&!candidate.row))throw new Error('The local history is invalid.');var p=document.createElement('p');if(candidate.deleted)p.textContent=candidate.recordId+' · This source removes the date';else{var r=candidate.row,parts=[candidate.recordId,r.Start||'—',r.Finish||'—',r.Break===''?'break not recorded':'break '+r.Break+' min',r.Absence||'NA',r.Notes||''];if(candidate.rateReviewNeeded===true)parts.push('source rate format needs review');if(showRates)rateFields.forEach(function(f){var v=r[f];parts.push(f+': '+(Number.isInteger(v)&&v>=0?Math.floor(v/60)+'h '+String(v%60).padStart(2,'0')+'m':'not recorded'))});p.textContent=parts.join(' · ')}details.append(p)});
        });
        var comparison=data.queuedComparison,heading=document.createElement('h4');heading.textContent='Comparison with saved month';details.append(heading);
        if(!comparison||comparison.status==='missing'||comparison.status==='invalid'){
          var unavailable=document.createElement('p');unavailable.textContent=comparison?.status==='invalid'?'The saved structured month could not be checked.':'No saved structured month was available for comparison.';details.append(unavailable);
        }else{
          if(comparison.status!=='compared'||!Array.isArray(comparison.dates)||comparison.dates.length>124)throw new Error('The month comparison is invalid.');
          var note=document.createElement('p');note.textContent='This comparison combines the other local records with the selected saved correction. Differences need review; agreement does not prove the month is complete or approve delivery.';details.append(note);
          var fields=['Start','Finish','Break','Absence','Total hours','Notes','Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours'],differences=0;
          function value(field,v){if(v===null||v===undefined||v==='')return 'not recorded';if(Number.isInteger(v)&&(field==='Total hours'||field.indexOf('Source ')===0))return Math.floor(v/60)+'h '+String(v%60).padStart(2,'0')+'m';return String(v)}
          comparison.dates.forEach(function(item){if(!item||!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date||''))||!['match','different','only-local','only-queued','needs-review'].includes(item.status))throw new Error('The month comparison is invalid.');if(item.status==='match')return;differences++;var p=document.createElement('p');
            if(item.status==='only-local')p.textContent=item.date+' · Only in local records';else if(item.status==='only-queued')p.textContent=item.date+' · Only in the saved month';else if(item.status==='needs-review')p.textContent=item.date+(item.reason==='source-rates'?' · Source rate figures need review':' · Source disagreement needs review');else{if(!Array.isArray(item.fields)||!item.fields.length||item.fields.some(function(f){return !fields.includes(f)})||!item.local||!item.queued)throw new Error('The month comparison is invalid.');p.textContent=item.date+' · '+item.fields.map(function(f){return f+': local '+value(f,item.local[f])+'; saved '+value(f,item.queued[f])}).join(' · ')}details.append(p)});
          if(!differences){var same=document.createElement('p');same.textContent='The returned dates and compared fields agree.';details.append(same)}
        }
      }catch(error){if(ticket===sequence)details.textContent=error.message||'The local history could not be checked.'}finally{button.disabled=false}});
    }results.append(group)});}
  async function check(){if(busy)return;reset();var ticket=sequence;var selected=file.files&&file.files[0];if(!selected){setStatus('Choose an ownership review file first.');return;}if(selected.size>1000000){setStatus('The review file is too large.');return;}
    busy=true;q('check').disabled=true;setStatus('Checking current records and employee accounts…');try{
      var data=JSON.parse(await selected.text()),entries=validate(data);if(ticket!==sequence)return;
      if(!evidence.value && /^\d{4}-\d{2}-\d{2}$/.test(String(data.generated_utc||'')))evidence.value='confirmation-'+data.generated_utc;
      var subjects=new Map();
      for(var entry of entries){if(ticket!==sequence)return;setStatus('Checking record '+(candidates.length+1)+' of '+entries.length+'…');var candidate={...entry,state:'hold',message:'Needs review'};candidates.push(candidate);
        try{
          var snapshot=await api.request('/api/admin/timesheet-ownership-review/'+encodeURIComponent(entry.id));
          var person=subjects.get(entry.upn);if(!person){person=await api.request('/api/admin/timesheet-review-subject?upn='+encodeURIComponent(entry.upn));subjects.set(entry.upn,person)}
          if(ticket!==sequence)return;candidate.snapshot=snapshot;candidate.person=person;
          if(!snapshot || snapshot.record?.record_id!==entry.id || snapshot.record?.updated_at!==entry.updated || snapshot.payloadSha256!==entry.digest || !Number.isSafeInteger(snapshot.revision) || !Number.isSafeInteger(snapshot.reviewEventId))candidate.message='Changed since confirmation';
          else if(!person || String(person.oid||'').toLowerCase()!==entry.oid || String(person.upn||'').toLowerCase()!==entry.upn)candidate.message='Employee account no longer matches';
          else if(person.accountEnabled!==true)candidate.message='Employee account is inactive or could not be verified';
          else if(snapshot.activeReview){if(String(snapshot.activeReview.subjectOid||'').toLowerCase()===entry.oid && snapshot.activeReview.payloadSha256===entry.digest){candidate.state='saved';candidate.message='Already reviewed'}else candidate.message='Conflicting ownership review';}
          else if(['sending','sent','failed','uncertain'].includes(snapshot.deliveryStatus))candidate.message='Delivery needs reconciliation';
          else {candidate.state='ready';candidate.message=snapshot.deliveryStatus==='queued'?'Ready · queued for Accounts':'Ready';}
        }catch(_){candidate.message='Could not verify this record or employee';}
      }
      if(ticket!==sequence)return;render();valid=candidates.every(function(c){return c.state==='ready'||c.state==='saved'});area.hidden=false;
      setStatus(valid?'All records checked. Review the list before applying decisions.':'Some records need attention. No decisions can be applied from this check.');
    }catch(error){if(ticket===sequence){candidates=[];render();setStatus(error.message||'The review file could not be read.')}}finally{busy=false;q('check').disabled=false;updateApply()}}
  file.addEventListener('change',function(){reset();evidence.value='';setStatus('File selected. Check the records before applying decisions.')});
  evidence.addEventListener('input',updateApply);confirm.addEventListener('change',updateApply);q('check').addEventListener('click',check);
  apply.addEventListener('click',async function(){updateApply();if(apply.disabled)return;busy=true;file.disabled=true;q('check').disabled=true;q('open').disabled=true;evidence.disabled=true;confirm.disabled=true;updateApply();var saved=0,evidenceReference=evidence.value.trim();
    try{for(var c of candidates){if(c.state!=='ready')continue;setStatus('Saving ownership decision '+(saved+1)+'…');var result=await api.request('/api/admin/timesheet-ownership-review/'+encodeURIComponent(c.id),{method:'POST',body:{expectedRevision:c.snapshot.revision,expectedReviewEventId:c.snapshot.reviewEventId,payloadSha256:c.digest,subjectOid:c.oid,subjectUpn:c.upn,evidenceReference:evidenceReference}});if(!Number.isSafeInteger(result?.reviewId)||result.reviewId<1)throw new Error('The server did not confirm the decision.');c.state='saved';c.message='Reviewed';saved++;render()}
      valid=false;confirm.checked=false;setStatus(saved+' ownership decision'+(saved===1?'':'s')+' saved.');
    }catch(error){valid=false;confirm.checked=false;setStatus(saved+' saved before the check stopped. A decision may have been saved if the connection failed; check the file again before continuing. '+(error.message||''));}
    finally{busy=false;file.disabled=false;q('check').disabled=false;q('open').disabled=false;evidence.disabled=false;confirm.disabled=false;updateApply()}});
  q('open').addEventListener('click',function(){q('workspace').hidden=!q('workspace').hidden;if(q('workspace').hidden)reset()});
  api.access().then(function(access){if(access && access.canReviewTimesheetOwnership===true)root.hidden=false}).catch(function(){});
}());
