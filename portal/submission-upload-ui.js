(function (root) {
  'use strict';
  function parseDates(value) {
    const dates=[];const seen=new Set();
    for(const match of String(value||'').matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/g)) {
      const iso=match[3]+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');
      const date=new Date(iso+'T00:00:00Z');
      if(Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===iso && !seen.has(iso)){dates.push(iso);seen.add(iso);}
    }
    return dates;
  }
  function mount(panel, options) {
    options = options || {};
    panel.innerHTML = '<h3>Upload documents</h3><p>Choose files to review. Nothing is saved until you select entries and save. Unfinished reviews are lost when you leave this page. '+(typeof options.fileOriginal==='function'?'Other originals can be filed in shared SharePoint folders when available. '+(options.privateTimesheetOriginals?'Timesheet originals are filed privately when available; keep your own copy until filing is confirmed.':'Timesheet originals are not retained; keep your own copy.'):'Originals are not retained unless you choose to attach one to a job card; keep your own copy.')+'</p><label>Documents <input type="file" multiple accept=".docx,.docm,.xlsx,.xls,.csv,.txt,.pdf,.zip,.json,.png,.jpg,.jpeg"></label> <button type="button" data-review>Review documents</button><p role="status" data-status></p><div data-sources></div><div data-results></div><button type="button" data-stage hidden disabled>Open selected days in timesheet</button> <button type="button" data-save disabled>Save selected</button>';
    const input = panel.querySelector('input[type=file]');
    const reviewButton = panel.querySelector('[data-review]');
    const saveButton = panel.querySelector('[data-save]');
    const stageButton = panel.querySelector('[data-stage]');stageButton.hidden=typeof options.stageTimesheets!=='function';
    const status = panel.querySelector('[data-status]');
    const results = panel.querySelector('[data-results]');
    const sources = panel.querySelector('[data-sources]');
    let previewUrls = [];
    let candidates = [];
    let originals=new Map();
    let sourceFiles=new Map();
    let sharedSources=new Map();
    let reviewGeneration=0;
    let busy=false;
    if(typeof options.listSharedOriginals==='function') {
      const shared=document.createElement('section');shared.className='portal-shared-originals';
      const heading=document.createElement('h3');heading.textContent='Shared documents';
      const description=document.createElement('p');description.textContent='Browse filed originals available to GMT staff. Timesheets remain private.';
      const browse=document.createElement('button');browse.type='button';browse.textContent='Browse shared documents';
      const message=document.createElement('p');message.setAttribute('role','status');
      const list=document.createElement('ul');
      const more=document.createElement('button');more.type='button';more.textContent='Load more';more.hidden=true;
      const labels={'job-cards':'Job card',tasks:'Task',calendar:'Calendar request',enquiries:'Enquiry',estimates:'Estimate',invoices:'Invoice'};
      let offset=0;
      async function loadShared(reset){
        browse.disabled=true;more.disabled=true;message.textContent='Loading shared documents…';
        try {
          const start=reset?0:offset,result=await options.listSharedOriginals(start);
          if(reset)list.replaceChildren();
          (Array.isArray(result?.documents)?result.documents:[]).forEach(item=>{
            if(!Object.hasOwn(labels,item.kind))return;let url;try{url=new URL(String(item.url||''));}catch(_){return;}
            if(url.protocol!=='https:'||!url.hostname.toLowerCase().endsWith('.sharepoint.com')||url.username||url.password)return;
            const entry=document.createElement('li'),link=document.createElement('a');
            link.textContent=String(item.fileName||'Document');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
            entry.append(document.createTextNode(labels[item.kind]+' · '),link);list.append(entry);
          });
          const next=Number(result?.nextOffset);offset=Number.isInteger(next)&&next>start?next:start;
          more.hidden=!(result?.hasMore&&offset>start);
          message.textContent=list.children.length?'Shared documents available below.':(more.hidden?'No shared documents have been filed yet.':'No documents on this page.');
        } catch(_){message.textContent='Shared documents are unavailable. Try again.';} finally {browse.disabled=false;more.disabled=false;}
      }
      browse.addEventListener('click',()=>loadShared(true));more.addEventListener('click',()=>loadShared(false));
      shared.append(heading,description,browse,message,list,more);panel.append(shared);
    }
    function safeToShare(sourceId){const matching=candidates.filter(item=>item.sourceId===sourceId);return matching.length>0&&matching.every(item=>item.kind&&item.kind!=='timesheets');}
    function invalidateShared(sourceId){const source=sharedSources.get(sourceId);if(source){source.confirmed=false;if(source.box)source.box.checked=false;}}
    function setBusy(value){busy=value;reviewButton.disabled=value;input.disabled=value;results.inert=value;sources.inert=value;if(value){saveButton.disabled=true;stageButton.disabled=true;}else draw();}
    document.addEventListener('gmt:upload-stage-cleared',function(event){candidates.forEach(item=>{if(item.staged&&(!event.detail || (item.sourceId===event.detail.sourceId&&item.data.date===event.detail.date)))item.staged=false;});draw();});
    if (typeof options.save !== 'function') status.textContent='Saving is not connected yet. Documents can be reviewed only.';
    function draw() {
      results.replaceChildren();
      candidates.forEach((item, index) => {
        const row = document.createElement('section');
        row.setAttribute('data-candidate',String(index));
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type='checkbox'; box.disabled=!item.valid || item.saved || item.staged; box.value=String(index); box.checked=!!item.selected && item.valid;
        box.addEventListener('change', function () { item.selected=box.checked; });
        label.append(box, document.createTextNode(' '+(item.kind || 'Unrecognised')+' — '+(item.data.title || item.data.employee || item.source || 'Document')));
        const detail = document.createElement('p');
        detail.textContent = item.saved ? ('Saved. '+(item.savedMessage || '')) : item.staged ? 'Opened in the timesheet editor; not saved yet.' : item.issues.length ? item.issues.join(' ') : (item.data.date || item.data.employeeEmail || 'Ready for review');
        row.append(label, detail);
        if(item.fileUrl){const link=document.createElement('a');link.textContent='Open filed original';link.href=item.fileUrl;link.target='_blank';link.rel='noopener noreferrer';row.append(link);}
        if(item.saved && item.fileError && sourceFiles.has(item.sourceId) && typeof options.fileOriginal==='function'){
          const retryFile=document.createElement('button');retryFile.type='button';retryFile.textContent='Retry SharePoint filing';
          retryFile.addEventListener('click',async()=>{if(busy)return;if(!safeToShare(item.sourceId)){item.savedMessage='The original was not shared because the source includes timesheets or unclassified material.';item.fileError=false;draw();return;}if(!sharedSources.get(item.sourceId)?.confirmed){item.savedMessage='Confirm that this source contains no private payroll information before retrying.';draw();return;}setBusy(true);try{const filed=await options.fileOriginal(item.recordId,sourceFiles.get(item.sourceId));item.fileError=false;item.fileUrl=filed?.url||'';item.savedMessage='Saved and original filed in SharePoint.';}catch(error){item.savedMessage='Saved, but SharePoint filing failed: '+(error?.message||'try again.');}finally{setBusy(false);}});row.append(retryFile);
        }
        if(item.saved && item.attachmentError && originals.has(item.sourceId) && typeof options.attach==='function') {
          const retry=document.createElement('button');retry.type='button';retry.textContent='Retry original attachment';
          retry.addEventListener('click',async()=>{if(busy)return;setBusy(true);try{await options.attach(item.recordId,originals.get(item.sourceId).file);item.attachmentError=false;item.savedMessage+=' Original attached.';}catch(_){item.savedMessage='Saved, but the original attachment failed. Retry while this review remains open.';}finally{setBusy(false);}});row.append(retry);
        }
        if (item.warnings && item.warnings.length) {const warning=document.createElement('p');warning.textContent=item.warnings.join(' ');row.append(warning);}
        if (item.sourceId && !item.locked && !item.saved) {
          const typeLabel=document.createElement('label');typeLabel.textContent='Document type ';
          const select=document.createElement('select');
          [['','Choose a type'],['timesheets','Timesheet'],['enquiries','Enquiry'],['job-cards','Job card'],['tasks','Task'],['estimates','Estimate'],['invoices','Invoice'],['calendar','Calendar request']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);});
          select.value=item.kind || '';
          select.addEventListener('change',function () {
            if (!select.value || select.value===item.kind) return;
            invalidateShared(item.sourceId);
            const source={file:item.source,sourceId:item.sourceId,recognitionWarning:item.recognitionWarning,issues:[]};
            if(select.value==='timesheets') source.rows=[Object.assign({employee:'',date:'',start:'',finish:'',absence:'NA'},item.data)];
            else source.records=[Object.assign({},item.data,{kind:select.value})];
            const updated=root.GMTSubmissionUploadReview.review(source)[0];updated.sourceIndex=item.sourceIndex;updated.sourceText=item.sourceText;candidates[index]=updated;draw();
          });
          typeLabel.append(select);row.append(typeLabel);
        }
        if (item.sourceText) {
          const extra=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Extracted text';
          const content=document.createElement('pre');content.textContent=item.sourceText;content.style.whiteSpace='pre-wrap';
          extra.append(summary,content);row.append(extra);
        }
        if (item.kind === 'timesheets') {
          [['employee','Employee','text'],['employeeEmail','Employee email','email'],['date','Date','date'],['start','Start','text'],['finish','Finish','text'],['lunchMinutes','Break minutes','text'],['notes','Notes','text']].forEach(function (field) {
            const editLabel=document.createElement('label'); editLabel.textContent=field[1]+' ';
            const edit=document.createElement('input'); edit.type=field[2]; edit.disabled=!!item.locked || !!item.saved; edit.value=field[0]==='lunchMinutes' ? String(item.data.breakInput || '') : (item.data[field[0]] == null ? '' : String(item.data[field[0]]));
            edit.addEventListener('change',function () {
              const copy=Object.assign({},item.data); copy[field[0]]=edit.value; if(field[0]==='lunchMinutes') copy.breakInput=edit.value;
              const updated=root.GMTSubmissionUploadReview.review({file:item.source,sourceId:item.sourceId,recognitionWarning:item.recognitionWarning,rows:[copy],issues:[]})[0];
              updated.sourceIndex=item.sourceIndex; updated.sourceText=item.sourceText; updated.selected=!!item.selected && updated.valid; candidates[index]=updated; draw();
            });
            editLabel.append(edit); row.append(editLabel);
          });
          const absenceLabel=document.createElement('label');absenceLabel.textContent='Absence ';const absence=document.createElement('select');absence.disabled=!!item.locked||!!item.saved;
          [['NA','None'],['Sick','Sick'],['Holiday','Holiday'],['Absent','Absent'],['Time Off','Time Off'],['Un-Paid','Un-Paid']].forEach(([value,title])=>{const option=document.createElement('option');option.value=value;option.textContent=title;absence.append(option);});
          absence.value=item.data.absence || 'NA';absence.addEventListener('change',function(){const copy=Object.assign({},item.data,{absence:absence.value});const updated=root.GMTSubmissionUploadReview.review({file:item.source,sourceId:item.sourceId,recognitionWarning:item.recognitionWarning,rows:[copy],issues:[]})[0];updated.sourceIndex=item.sourceIndex;updated.sourceText=item.sourceText;updated.selected=!!item.selected&&updated.valid;candidates[index]=updated;draw();});absenceLabel.append(absence);row.append(absenceLabel);
          const reviewLabel=document.createElement('label');reviewLabel.textContent='Source review note ';const reviewNote=document.createElement('input');reviewNote.type='text';reviewNote.disabled=!!item.locked||!!item.saved;reviewNote.value=item.data.sourceEvidence?.reviewNote || '';
          reviewNote.addEventListener('change',function(){const copy=Object.assign({},item.data,{sourceEvidence:Object.assign({},item.data.sourceEvidence,{reviewNote:reviewNote.value})});const updated=root.GMTSubmissionUploadReview.review({file:item.source,sourceId:item.sourceId,recognitionWarning:item.recognitionWarning,rows:[copy],issues:[]})[0];updated.sourceIndex=item.sourceIndex;updated.sourceText=item.sourceText;updated.selected=!!item.selected&&updated.valid;candidates[index]=updated;draw();});reviewLabel.append(reviewNote);row.append(reviewLabel);
          if(item.sourceId && !item.saved && !item.locked){
            const apply=document.createElement('button');apply.type='button';apply.textContent='Apply employee to this document';
            apply.addEventListener('click',()=>{candidates=candidates.map(other=>{if(other.kind!=='timesheets'||other.sourceId!==item.sourceId||other.saved||other.locked||other.staged)return other;const copy=Object.assign({},other.data,{employee:item.data.employee||'',employeeEmail:item.data.employeeEmail||''});const updated=root.GMTSubmissionUploadReview.review({file:other.source,sourceId:other.sourceId,recognitionWarning:other.recognitionWarning,rows:[copy],issues:[]})[0];updated.sourceIndex=other.sourceIndex;updated.sourceText=other.sourceText;updated.selected=!!other.selected&&updated.valid;return updated;});draw();});row.append(apply);
          }
        } else if (item.kind) {
          const definitions={tasks:[['title','Title'],['jobReference','Job reference'],['assignee','Assignee'],['due','Due date'],['priority','Priority']],calendar:[['title','Title'],['date','Date'],['type','Event type'],['notes','Notes']],enquiries:[['customerName','Customer name'],['customerEmail','Customer email'],['customerPhone','Customer phone'],['requestType','Request type'],['message','Message']], 'job-cards':[['jobReference','Job reference'],['description','Description'],['client','Client'],['site','Site'],['engineer','Engineer'],['cardType','Card type']], estimates:[['number','Estimate number'],['date','Date'],['company','Company'],['attention','Attention'],['email','Client email'],['validity','Validity'],['preparedBy','Prepared by'],['reference','Reference'],['opening','Opening'],['terms','Terms'],['vatRate','VAT rate'],['subtotal','Subtotal'],['vat','VAT amount'],['total','Total']],invoices:[['invoiceNumber','Invoice number'],['date','Date'],['currency','Currency'],['total','Total'],['company','Company'],['reference','Reference']]};
          const fields=[['employeeEmail','Employee email']].concat(definitions[item.kind] || []);
          fields.forEach(function (field) {
            const editLabel=document.createElement('label');editLabel.textContent=field[1]+' ';
            const edit=document.createElement('input');edit.type=field[0]==='date'?'date':'text';edit.disabled=!!item.locked || !!item.saved;
            const nested=item.data.payload && typeof item.data.payload==='object' && field[0]!=='employeeEmail';
            const target=nested?item.data.payload:item.data; edit.value=target[field[0]] == null ? (field[0]==='employeeEmail' && item.data.payload ? String(item.data.payload.employeeEmail || item.data.payload.employeeUpn || '') : '') : String(target[field[0]]);
            edit.addEventListener('change',function () {
              const copy=Object.assign({},item.data); if(nested) { copy.payload=Object.assign({},item.data.payload); copy.payload[field[0]]=edit.value; } else copy[field[0]]=edit.value;
              const updated=root.GMTSubmissionUploadReview.review({file:item.source,sourceId:item.sourceId,recognitionWarning:item.recognitionWarning,records:[copy],issues:[]})[0];
              updated.sourceIndex=item.sourceIndex;updated.sourceText=item.sourceText;updated.selected=!!item.selected && updated.valid;candidates[index]=updated;draw();
            });
            editLabel.append(edit);row.append(editLabel);
          });
          if (item.kind==='estimates') {
            const fields=item.data.payload && typeof item.data.payload==='object' ? item.data.payload : item.data;
            const items=Array.isArray(fields.items)?fields.items:[];
            const updateItems=function(next) {
              const copy=Object.assign({},item.data);
              if(item.data.payload && typeof item.data.payload==='object') {copy.payload=Object.assign({},item.data.payload,{items:next});} else copy.items=next;
              const updated=root.GMTSubmissionUploadReview.review({file:item.source,sourceId:item.sourceId,recognitionWarning:item.recognitionWarning,records:[copy],issues:[]})[0];
              updated.sourceIndex=item.sourceIndex;updated.sourceText=item.sourceText;updated.selected=!!item.selected && updated.valid;candidates[index]=updated;draw();
            };
            items.forEach((line,lineIndex)=>{
              const group=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent='Line '+(lineIndex+1);group.append(legend);
              [['description','Description'],['quantity','Quantity'],['unit','Unit price']].forEach(([key,title])=>{
                const fieldLabel=document.createElement('label');fieldLabel.textContent=title+' ';const edit=document.createElement('input');edit.type=key==='description'?'text':'number';edit.disabled=!!item.locked||!!item.saved;edit.value=line[key] == null?'':String(line[key]);
                edit.addEventListener('change',function(){const next=items.map(entry=>Object.assign({},entry));next[lineIndex][key]=edit.value;updateItems(next);});fieldLabel.append(edit);group.append(fieldLabel);
              });
              const remove=document.createElement('button');remove.type='button';remove.textContent='Remove line item';remove.disabled=!!item.locked||!!item.saved;remove.addEventListener('click',()=>updateItems(items.filter((_,i)=>i!==lineIndex)));group.append(remove);row.append(group);
            });
            const add=document.createElement('button');add.type='button';add.textContent='Add line item';add.disabled=!!item.locked||!!item.saved||items.length>=80;add.addEventListener('click',()=>updateItems(items.concat([{description:'',quantity:'',unit:''}])));row.append(add);
          }
        }
        results.append(row);
      });
      saveButton.disabled = busy || !candidates.some(item => item.valid && !item.saved && !item.staged && (typeof options.stageTimesheets!=='function' || item.kind!=='timesheets')) || typeof options.save !== 'function';
      stageButton.disabled=busy||!candidates.some(item=>item.valid&&!item.saved&&!item.staged&&item.kind==='timesheets');
    }
    reviewButton.addEventListener('click', async function () {
      if(busy)return;
      const generation=++reviewGeneration;
      candidates=[];originals=new Map();sourceFiles=new Map();sharedSources=new Map();previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];sources.replaceChildren();setBusy(true);draw();status.textContent='Reading documents…';
      try {
        const seen = new Set();
        const reviewFiles=[];
        for (const selected of input.files) {
          try { reviewFiles.push(...(typeof root.GMTDocumentReader.expandForReview==='function' ? await root.GMTDocumentReader.expandForReview(selected) : [selected])); }
          catch(error) { candidates.push({kind:'',data:{},source:selected.name,valid:false,issues:[error?.message||'Unable to read this archive.']}); }
        }
        for (const file of reviewFiles) {
          if (file.size > 20 * 1024 * 1024) { candidates.push({kind:'',data:{},source:file.name,valid:false,issues:['File is larger than 20 MB.']}); continue; }
          try {
            const parsed = await root.GMTDocumentReader.parse(file);
            if(file.gmtArchivePath) parsed.file=file.gmtArchivePath;
            if (parsed.sourceId && seen.has(parsed.sourceId)) candidates.push({kind:'',data:{},source:file.name,valid:false,issues:['This file duplicates another selected document.']});
            else {
              if (parsed.sourceId) seen.add(parsed.sourceId);
              if(parsed.sourceId)sourceFiles.set(parsed.sourceId,file);
              const reviewed=root.GMTSubmissionUploadReview.review(parsed);candidates.push(...reviewed);
              if(parsed.sourceId && typeof options.fileOriginal==='function'){
                const allowed=reviewed.every(item=>item.kind && item.kind!=='timesheets');
                const state={allowed,confirmed:false};sharedSources.set(parsed.sourceId,state);
                const notice=document.createElement('p');
                if(!allowed)notice.textContent=(file.gmtArchivePath||file.name)+' contains timesheets or unclassified content. Select a separate non-timesheet file for shared filing.';
                else {const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';state.box=box;box.addEventListener('change',()=>{state.confirmed=box.checked;});label.append(box,document.createTextNode(' '+(file.gmtArchivePath||file.name)+' contains no timesheets or private payroll information; file the original where all staff can view it.'));notice.append(label);}
                sources.append(notice);
              }
              if(parsed.sourceId && /\.(?:pdf|jpe?g|png)$/i.test(file.name) && typeof options.attach==='function'){
                const original={file,selected:false};originals.set(parsed.sourceId,original);
                const attachLabel=document.createElement('label'),attachBox=document.createElement('input');attachBox.type='checkbox';attachBox.addEventListener('change',()=>{original.selected=attachBox.checked;});
                attachLabel.append(attachBox,document.createTextNode(' Attach the original '+file.name+' to selected job cards. The whole file will be visible to people who can view those cards.'));sources.append(attachLabel);
              }
              if (parsed.sourceId && /^image\/(?:png|jpeg)$/i.test(file.type)) {
                const source=document.createElement('details');const summary=document.createElement('summary');summary.textContent='View source image: '+file.name;
                const img=document.createElement('img');img.alt='Source document: '+file.name;img.style.maxWidth='100%';img.style.display='block';img.style.touchAction='none';const url=URL.createObjectURL(file);previewUrls.push(url);img.src=url;
                const imageWrap=document.createElement('div');imageWrap.style.cssText='position:relative;display:inline-block;max-width:100%';const rectangle=document.createElement('div');rectangle.style.cssText='position:absolute;pointer-events:none;border:2px solid #126bb3;display:none;box-sizing:border-box';imageWrap.append(img,rectangle);
                const guidance=document.createElement('p');guidance.textContent='To read printed dates, drag a box around the date column, then choose Read selected dates. Check every date against the image.';
                let startPoint=null,selection=null;
                const point=event=>{const rect=img.getBoundingClientRect();return {x:Math.max(0,Math.min(rect.width,event.clientX-rect.left)),y:Math.max(0,Math.min(rect.height,event.clientY-rect.top))};};
                img.addEventListener('pointerdown',event=>{event.preventDefault();startPoint=point(event);selection=null;img.setPointerCapture(event.pointerId);});
                img.addEventListener('pointermove',event=>{if(!startPoint)return;const end=point(event);selection={x:Math.min(startPoint.x,end.x),y:Math.min(startPoint.y,end.y),w:Math.abs(startPoint.x-end.x),h:Math.abs(startPoint.y-end.y)};Object.assign(rectangle.style,{display:'block',left:selection.x+'px',top:selection.y+'px',width:selection.w+'px',height:selection.h+'px'});});
                img.addEventListener('pointerup',()=>{startPoint=null;});
                const add=document.createElement('button');add.type='button';add.textContent='Add timesheet day';
                function addDay(date){
                  invalidateShared(parsed.sourceId);
                  const related=candidates.filter(item=>item.sourceId===parsed.sourceId);
                  const next=Math.max(4999,...related.map(item=>Number.isInteger(item.sourceIndex)?item.sourceIndex:0))+1;
                  if(next>10000){status.textContent='Too many entries for this document.';return false;}
                  const previous=related.find(item=>item.kind==='timesheets' && item.data.employeeEmail);
                  const item=root.GMTSubmissionUploadReview.review({file:file.name,sourceId:parsed.sourceId,rows:[{employee:previous?.data.employee||'',employeeEmail:previous?.data.employeeEmail||'',date:date||'',start:'',finish:'',absence:'NA'}],issues:[]})[0];
                  item.sourceIndex=next;candidates.push(item);draw();status.textContent='Enter and review the new timesheet day against the source image.';
                  return true;
                }
                add.addEventListener('click',()=>addDay(''));
                const readDates=document.createElement('button');readDates.type='button';readDates.textContent='Read selected dates';
                readDates.addEventListener('click',async function(){
                  if(!selection || selection.w<5 || selection.h<5 || !img.naturalWidth || !root.GMTDocumentOCR?.recogniseDates){status.textContent='Select a date area in a loaded image first.';return;}
                  if(busy)return;setBusy(true);readDates.disabled=true;status.textContent='Reading selected dates…';
                  try {
                    const rect=img.getBoundingClientRect(),sx=img.naturalWidth/rect.width,sy=img.naturalHeight/rect.height;
                    const width=Math.ceil(selection.w*sx),height=Math.ceil(selection.h*sy);
                    if(width*height>10000000)throw new Error('Selected area is too large.');
                    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
                    canvas.getContext('2d').drawImage(img,selection.x*sx,selection.y*sy,width,height,0,0,width,height);
                    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
                    if(!blob)throw new Error('The selected area could not be read.');
                    const found=parseDates((await root.GMTDocumentOCR.recogniseDates(blob)).text);
                    if(generation!==reviewGeneration)return;
                    let count=0;for(const date of found){if(candidates.some(item=>item.sourceId===parsed.sourceId && item.kind==='timesheets' && item.data.date===date))continue;if(addDay(date))count++;}
                    status.textContent=count?count+' dates added. Check every date and enter times and breaks from the image.':'No new complete dates found; adjust the selection or add a day manually.';
                  } catch(error){if(generation===reviewGeneration)status.textContent=error?.message || 'Could not read selected dates.';} finally {readDates.disabled=false;setBusy(false);}
                });
                source.append(summary,guidance,imageWrap,readDates,add);sources.append(source);
              }
            }
          }
          catch (error) { candidates.push({kind:'',data:{},source:file.name,valid:false,issues:[error.message || 'Could not read this file.']}); }
        }
        draw(); status.textContent = candidates.length ? (typeof options.save === 'function' ? 'Review each entry and select those you want to save.' : 'Review only: saving is not connected yet.') : 'Choose at least one file.';
      } finally { setBusy(false); }
    });
    stageButton.addEventListener('click',async function(){
      if(busy || typeof options.stageTimesheets!=='function')return;
      const chosen=Array.from(results.querySelectorAll('input[type=checkbox]:checked')).map(box=>candidates[Number(box.value)]).filter(Boolean);
      if(!chosen.length||chosen.some(item=>item.kind!=='timesheets')){status.textContent='Select timesheet days only; open one employee and pay month at a time.';return;}
      setBusy(true);status.textContent='Checking the employee, pay month and existing days…';
      try {const chosenFiles=new Map(chosen.map(item=>[item.sourceId,sourceFiles.get(item.sourceId)]));await options.stageTimesheets(chosen,chosenFiles);chosen.forEach(item=>{item.staged=true;item.selected=false;});status.textContent='Days opened in the timesheet editor. Review them and choose Save changes.';}
      catch(error){status.textContent=error?.message||'The selected days could not be opened.';}finally{setBusy(false);}
    });
    saveButton.addEventListener('click', async function () {
      if(busy)return;
      const chosen = Array.from(results.querySelectorAll('input[type=checkbox]:checked')).map(box => candidates[Number(box.value)]).filter(item => item && item.valid);
      if (!chosen.length) { status.textContent='Select at least one valid entry.'; return; }
      if(typeof options.stageTimesheets==='function' && chosen.some(item=>item.kind==='timesheets')){status.textContent='Open selected timesheet days in the timesheet editor; save other document types separately.';return;}
      if(typeof options.fileOriginal==='function' && chosen.some(item=>{const source=sharedSources.get(item.sourceId);return source?.allowed&&safeToShare(item.sourceId)&&!source.confirmed;})){status.textContent='Confirm which source files contain no private payroll information before filing them for all staff.';return;}
      setBusy(true);status.textContent='Saving selected entries…';
      try {
      let savedCount=0,unknown=false;
      for (let offset=0; offset<chosen.length; offset+=100) {
        const batch=chosen.slice(offset,offset+100);
        try {
          const payload=batch.map(item=>({kind:item.kind,data:item.data,source:item.source,sourceId:item.sourceId,sourceIndex:item.sourceIndex}));
          const result=await options.save(payload);
          if (!result || !Array.isArray(result.results) || result.results.length!==batch.length) throw new Error('Unknown save outcome');
          result.results.forEach((entry,index)=>{
            if (entry && (entry.status==='saved'||(entry.status==='duplicate'&&entry.record_id))) {batch[index].saved=true;batch[index].recordId=entry.record_id;batch[index].savedMessage=entry.message||'';batch[index].selected=false;if(entry.status==='saved')savedCount++;}
            else {batch[index].issues=[entry && entry.message || 'Not saved; review before retrying.'];batch[index].valid=false;batch[index].selected=false;}
          });
          for(const item of batch){
            const original=originals.get(item.sourceId);
            if(item.saved && item.kind==='job-cards' && original?.selected && typeof options.attach==='function'){
              try{if(!item.recordId)throw new Error('Missing record ID');await options.attach(item.recordId,original.file);item.savedMessage+=' Original attached.';}
              catch(_){item.attachmentError=true;item.savedMessage+=' Original attachment failed; retry while this review remains open.';}
            }
            if(item.saved && typeof options.fileOriginal==='function'){
              const file=sourceFiles.get(item.sourceId);
              const shared=sharedSources.get(item.sourceId);
              if(!shared?.allowed || !safeToShare(item.sourceId)){item.savedMessage+=' The original was not shared because it contains timesheets, unclassified material, or an archive entry.';}
              else if(!shared.confirmed){item.savedMessage+=' The original was not shared; confirm that it contains no private payroll information before saving.';}
              else if(!file){item.fileError=true;item.savedMessage+=' The original could not be filed; select the individual file separately.';}
              else try{if(!item.recordId)throw new Error('Missing record ID');const filed=await options.fileOriginal(item.recordId,file);item.fileUrl=filed?.url||'';item.savedMessage+=' Original filed in SharePoint.';}
              catch(error){item.fileError=true;item.savedMessage+=' SharePoint filing failed: '+(error?.message||'retry while this review remains open.');}
            }
          }
        } catch (_) {
          batch.forEach(item=>{item.valid=false;item.locked=true;item.selected=false;item.issues=['Save status is unknown. Refresh and check records before retrying.'];});
          unknown=true;break;
        }
      }
      status.textContent=unknown ? savedCount+' saved; a batch has an unknown status. Refresh and check records before retrying.' : savedCount+' of '+chosen.length+' selected entries saved.';
      draw();
      } finally {setBusy(false);}
    });
  }
  root.GMTSubmissionUploadUI = {mount,parseDates};
})(globalThis);
