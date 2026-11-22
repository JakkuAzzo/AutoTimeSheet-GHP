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
    results.append(group)});}
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
  api.access().then(function(access){var message=document.getElementById('ownership-unavailable');if(access && access.canReviewTimesheetOwnership===true){root.hidden=false;if(message)message.hidden=true;}else if(message)message.textContent='Your account cannot review timesheet ownership.'}).catch(function(){var message=document.getElementById('ownership-unavailable');if(message)message.textContent='Review access could not be checked. Please try again.'});
}());
