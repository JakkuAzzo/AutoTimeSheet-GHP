import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

test('reviewer must inspect a source and verify the selected employee before recording ownership',async()=>{
  const browser=await chromium.launch({headless:true});try {
    const page=await browser.newPage();await page.setContent('<main><section id="source-review" hidden></section></main>');
    for(const file of ['styles.css','portal.css','tools/estimates.css'])await page.addStyleTag({path:resolve(file)});
    await page.evaluate(()=>{window.calls=[];window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{
      window.calls.push({path,options});
      if(path==='/api/admin/timesheet-source-review')return {items:[{itemId:'17',status:'unreviewed'}]};
      if(path==='/api/admin/timesheet-source-review/17')return {itemId:'17',etag:'"v1"',fieldsSha256:'a'.repeat(64),reviewEventId:0,sourceUrl:'https://tenant.example/sites/example/Lists/Timesheets/17',fields:{EmployeeName:'Fictional',Attachments:true,Issue:'<img src=x onerror=alert(1)>','@odata.etag':'internal marker',LinkTitle:'repeated label'}};
      if(path.startsWith('/api/admin/timesheet-review-subject?'))return {oid:'db9f99d4-7980-4f1d-927a-875221d4320a',upn:'fictional@example.test',name:'Fictional Employee',accountEnabled:true};
      if(path==='/api/admin/timesheet-source-review/17'&&options?.method==='POST')return {reviewId:3};
      return {reviewId:3};
    }}});
    // Make POST distinguishable from the read of the same path.
    await page.evaluate(()=>{const previous=window.GMTPortalApi.request;window.GMTPortalApi.request=async(path,options)=>options?.method==='POST'?(window.calls.push({path,options}),{reviewId:3}):previous(path,options)});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});
    await page.getByRole('button',{name:'Review source ownership'}).click();
    await page.getByRole('button',{name:'Inspect record 17'}).click();
    assert.equal(await page.locator('#source-review img').count(),0,'source text must not become HTML');
    assert.match(await page.locator('#source-review').innerText(),/<img src=x/);
    assert.match(await page.locator('#source-review').innerText(),/attachment.*not shown here/i);
    assert.equal(await page.getByRole('link',{name:'Open original SharePoint record'}).getAttribute('href'),'https://tenant.example/sites/example/Lists/Timesheets/17');
    assert.equal(await page.getByText('internal marker').isVisible(),false);
    assert.equal(await page.getByText('repeated label').isVisible(),false);
    await page.getByLabel('Employee work sign-in').fill('fictional@example.test');
    await page.getByRole('button',{name:'Find employee'}).click();
    assert.match(await page.locator('#source-review').innerText(),/Fictional Employee/);
    await page.getByLabel('Evidence reference',{exact:true}).fill('confirmation-17');
    assert.equal(await page.getByRole('button',{name:'Confirm ownership'}).isDisabled(),true);
    assert.ok((await page.getByLabel('I have checked the original evidence and this source belongs to this employee').boundingBox()).width<40,'confirmation remains a usable checkbox under the portal styles');
    await page.getByLabel('I have checked the original evidence and this source belongs to this employee').check();
    await page.getByRole('button',{name:'Confirm ownership'}).click();
    const sent=await page.evaluate(()=>window.calls.filter(x=>x.options?.method==='POST'));
    assert.equal(sent.length,1);assert.equal(sent[0].options.body.subjectUpn,'fictional@example.test');assert.equal(sent[0].options.body.expectedEtag,'"v1"');assert.equal(sent[0].options.body.fieldsSha256,'a'.repeat(64));
  }finally{await browser.close()}
});

test('review control stays hidden when the account lacks the reviewer role',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:false}),request:async()=>{throw Error('unexpected')}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});
    await page.waitForTimeout(30);assert.equal(await page.locator('#source-review').isHidden(),true);
  }finally{await browser.close()}
});

test('changing the employee while a lookup is pending cannot confirm the earlier person',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>{
      if(path==='/api/admin/timesheet-source-review')return {items:[{itemId:'17',status:'unreviewed'}]};
      if(path.includes('review-subject'))return new Promise(resolve=>{window.completeLookup=resolve});
      return {itemId:'17',etag:'"v1"',fieldsSha256:'a'.repeat(64),reviewEventId:0,fields:{Name:'Fictional'}};
    }}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();
    await page.getByLabel('Employee work sign-in').fill('first@example.test');await page.getByRole('button',{name:'Find employee'}).click();
    await page.getByLabel('Employee work sign-in').fill('second@example.test');
    await page.evaluate(()=>window.completeLookup({oid:'oid',upn:'first@example.test',name:'First',accountEnabled:true}));
    await page.getByLabel('Evidence reference',{exact:true}).fill('evidence-17');await page.getByLabel('I have checked the original evidence and this source belongs to this employee').check();
    assert.equal(await page.getByRole('button',{name:'Confirm ownership'}).isDisabled(),true);
    assert.doesNotMatch(await page.locator('[data-person]').innerText(),/First/);
  }finally{await browser.close()}
});

test('a reviewer can find a claimed employee and inspect structured daily entries',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path==='/api/admin/timesheet-source-review'?{items:[{itemId:'17',status:'unreviewed',claimedName:'Fictional Employee',weekStart:'2026-10-05',weekEnd:'2026-10-09'}]}:{itemId:'17',etag:'"v1"',fieldsSha256:'a'.repeat(64),reviewEventId:0,fields:{EmployeeName:'Fictional Employee',Issue:JSON.stringify({employeeName:'Fictional Employee',employeeEmail:'employee@example.test',weekStart:'2026-10-05',weekEnd:'2026-10-09',rows:[{date:'2026-10-05',employeeName:'Other Person',start:'09:00',finish:'12:00',lunchMinutes:0,absenceStatus:'NA',note:'<img src=x onerror=alert(1)>'},{date:'2026-10-06',start:'10:00',finish:'12:00',lunchMinutes:null,absenceStatus:'NA',location:'Fictional location',note:'Fictional note'}]})}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByLabel('Find record or name').fill('fictional');
    await page.getByRole('button',{name:'Inspect record 17'}).click();const table=page.getByRole('table',{name:'Daily entries in this source'});assert.equal(await table.locator('tbody tr').count(),2);assert.match(await table.innerText(),/Not recorded/);assert.match(await table.innerText(),/0 minutes/);assert.match(await table.innerText(),/Fictional location/);assert.match(await table.innerText(),/Fictional note/);assert.equal(await page.getByRole('region',{name:'Scroll daily entries'}).getAttribute('tabindex'),'0');assert.equal(await table.locator('img').count(),0);assert.match(await table.innerText(),/<img src=x/);assert.match(await page.locator('#source-review').innerText(),/names or sign-ins differ/i);
  }finally{await browser.close()}
});

test('a reviewer can inspect earlier source versions without treating them as approved',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<section id="source-review" hidden></section>');
    page.setDefaultTimeout(1000);
    await page.evaluate(()=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path==='/api/admin/timesheet-source-review'?{items:[{itemId:'17',status:'unreviewed'}]}:path.endsWith('/versions')?{itemId:'17',versions:[{versionId:'1.0',modifiedAt:'2026-10-01T10:00:00Z',fields:{EmployeeName:'Earlier fictional name',Issue:'<img src=x onerror=alert(1)>'}}]}:{itemId:'17',fields:{EmployeeName:'Current fictional name'}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();
    await page.getByRole('button',{name:'View previous versions'}).click();await page.getByText('Version 1.0', {exact:false}).click();
    assert.match(await page.locator('#source-review').innerText(),/Earlier fictional name/);assert.match(await page.locator('#source-review').innerText(),/not approved/i);assert.equal(await page.locator('#source-review img').count(),0);
    assert.equal(await page.getByRole('button',{name:'Confirm ownership'}).isDisabled(),true);
  }finally{await browser.close()}
});
test('the review screen does not display history for a different current source snapshot',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path==='/api/admin/timesheet-source-review'?{items:[{itemId:'17',status:'unreviewed'}]}:path.endsWith('/versions')?{itemId:'17',currentEtag:'"same"',currentFieldsSha256:'changed',versions:[{versionId:'1.0',fields:{EmployeeName:'Stale fictional data'}}]}:{itemId:'17',etag:'"same"',fieldsSha256:'original',fields:{EmployeeName:'Current fictional name'}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();await page.getByRole('button',{name:'View previous versions'}).click();
    assert.match(await page.locator('#source-review').innerText(),/source changed/i);assert.doesNotMatch(await page.locator('#source-review').innerText(),/Stale fictional data/);
  }finally{await browser.close()}
});

test('a reviewer can inspect CSV source rows, including quoted notes and dates outside the declared week',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();page.setDefaultTimeout(1000);await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{const csv='Status,Date,Start,Finish,Break,Absence reason,Worked hours,Note\r\nSubmitted,2026-10-05,09:00,12:00,30 minutes deducted,NA,2.5,"Workshop, north\n<img src=x onerror=alert(1)>"';window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path==='/api/admin/timesheet-source-review'?{items:[{itemId:'17',status:'unreviewed'}]}:{itemId:'17',fields:{EmployeeName:'Fictional',Week_x0020_Start:'2026-10-12',Week_x0020_End:'2026-10-18',Issue:csv}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();
    const table=page.getByRole('table',{name:'Daily entries in this source'});assert.equal(await table.locator('tbody tr').count(),1);assert.match(await table.innerText(),/30 minutes deducted/);assert.match(await table.innerText(),/Workshop, north/);assert.match(await table.innerText(),/2\.5/);assert.equal(await table.locator('img').count(),0);assert.match(await page.locator('#source-review').innerText(),/outside.*declared week/i);assert.equal(await page.getByText('Week Start',{exact:true}).count(),1);
    await page.getByText('Full source details').click();assert.match(await page.locator('#source-review').innerText(),/Status,Date,Start,Finish/);
  }finally{await browser.close()}
});
test('a reviewer can inspect legacy JSON arrays without inventing a missing break',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();page.setDefaultTimeout(1000);await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path==='/api/admin/timesheet-source-review'?{items:[{itemId:'17',status:'unreviewed'}]}:{itemId:'17',fields:{EmployeeName:'Fictional',Issue:JSON.stringify([{date:'2026-10-05',employeeName:'Fictional',employeeUpn:'other@example.test',employeeEmail:'employee@example.test',startTime:'09:00',finishTime:'12:00',absenceReason:'NA',workedHours:3,note:'Fictional note'}])}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();
    const table=page.getByRole('table',{name:'Daily entries in this source'});assert.match(await table.innerText(),/09:00/);assert.match(await table.innerText(),/Not recorded/);assert.match(await table.innerText(),/3/);assert.match(await page.locator('#source-review').innerText(),/names or sign-ins differ/i);
  }finally{await browser.close()}
});
test('malformed CSV remains visible as raw source instead of an incomplete table',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path==='/api/admin/timesheet-source-review'?{items:[{itemId:'17',status:'unreviewed'}]}:{itemId:'17',fields:{Issue:'Date,Start,Finish,Note\n2026-10-05,09:00,12:00,"unfinished'}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();
    assert.equal(await page.getByRole('table',{name:'Daily entries in this source'}).count(),0);assert.match(await page.locator('#source-review').innerText(),/unfinished/);
  }finally{await browser.close()}
});
test('a reviewer explicitly confirms evidence before classifying a current source as non-timesheet',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();page.setDefaultTimeout(1000);await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.sent=[];window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{if(options?.method==='POST'){window.sent.push({path,body:options.body});return {exclusionId:7}}if(path==='/api/admin/timesheet-source-review')return {items:[{itemId:'17',status:'unreviewed'}]};return {itemId:'17',etag:'"v1"',fieldsSha256:'a'.repeat(64),reviewEventId:2,exclusionEventId:3,fields:{Title:'Fictional calendar'}}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();
    const button=page.getByRole('button',{name:'Mark as non-timesheet'});assert.equal(await button.isDisabled(),true);
    await page.getByLabel('Non-timesheet evidence reference').fill('calendar-evidence');assert.equal(await button.isDisabled(),true);
    await page.getByLabel('I checked the original evidence and this current item contains no timesheet data').check();await button.click();
    const sent=await page.evaluate(()=>window.sent);assert.equal(sent.length,1);assert.equal(sent[0].path,'/api/admin/timesheet-source-review/17/not-timesheet');assert.deepEqual(sent[0].body,{expectedEtag:'"v1"',fieldsSha256:'a'.repeat(64),expectedReviewEventId:2,expectedExclusionEventId:3,evidenceReference:'calendar-evidence'});
  }finally{await browser.close()}
});
test('an excluded source can be withdrawn without offering a competing decision',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.sent=[];window.confirm=()=>true;window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{if(options?.method==='POST'){window.sent.push({path,body:options.body});return {revoked:true}}if(path==='/api/admin/timesheet-source-review')return {items:[{itemId:'17',status:'excluded',exclusionId:7}]};return {itemId:'17',fields:{Title:'Fictional calendar'}}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();
    assert.equal(await page.getByRole('button',{name:'Confirm ownership'}).isVisible(),false);assert.equal(await page.getByRole('button',{name:'Mark as non-timesheet'}).isVisible(),false);
    await page.getByRole('button',{name:'Withdraw review'}).click();const sent=await page.evaluate(()=>window.sent);assert.deepEqual(sent,[{path:'/api/admin/timesheet-source-review/17/not-timesheet/revoke',body:{exclusionId:7}}]);
  }finally{await browser.close()}
});
test('a historical version requires its own verified employee and explicit evidence',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();page.setDefaultTimeout(1200);await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.sent=[];window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{if(options?.method==='POST'){window.sent.push({path,body:options.body});return {reviewId:9}}if(path==='/api/admin/timesheet-source-review')return {items:[{itemId:'17',status:'unreviewed'}]};if(path.includes('review-subject'))return {oid:'db9f99d4-7980-4f1d-927a-875221d4320a',upn:'employee@example.test',name:'Fictional Employee'};if(path.endsWith('/versions'))return {itemId:'17',currentEtag:'"v1"',currentFieldsSha256:'a'.repeat(64),versions:[{versionId:'1.0',reviewStatus:'unreviewed',reviewEventId:0,fieldsSha256:'b'.repeat(64),fields:{EmployeeName:'Earlier fictional'}}]};return {itemId:'17',etag:'"v1"',fieldsSha256:'a'.repeat(64),reviewEventId:0,exclusionEventId:0,fields:{EmployeeName:'Current fictional'}}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();await page.getByRole('button',{name:'View previous versions'}).click();await page.locator('summary').filter({hasText:'Version 1.0'}).click();
    await page.getByLabel('Classification for version 1.0').selectOption('employee');await page.getByLabel('Employee sign-in for version 1.0').fill('employee@example.test');await page.getByRole('button',{name:'Find employee for version 1.0'}).click();await page.getByText('Fictional Employee · employee@example.test',{exact:true}).waitFor();
    await page.getByLabel('Evidence reference for version 1.0').fill('version-evidence');const save=page.getByRole('button',{name:'Save review for version 1.0'});assert.equal(await save.isDisabled(),true);await page.getByLabel('I checked the original evidence and version 1.0 belongs to this employee').check();await save.click();
    const sent=await page.evaluate(()=>window.sent);assert.equal(sent.length,1);assert.equal(sent[0].path,'/api/admin/timesheet-source-review/17/versions/1.0/review');assert.deepEqual(sent[0].body,{classification:'employee',expectedCurrentEtag:'"v1"',expectedCurrentFieldsSha256:'a'.repeat(64),fieldsSha256:'b'.repeat(64),expectedReviewEventId:0,subjectOid:'db9f99d4-7980-4f1d-927a-875221d4320a',subjectUpn:'employee@example.test',evidenceReference:'version-evidence'});
  }finally{await browser.close()}
});
test('a historical non-timesheet classification requires a fresh explicit confirmation',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();page.setDefaultTimeout(1200);await page.setContent('<section id="source-review" hidden></section>');
    await page.evaluate(()=>{window.sent=[];window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{if(options?.method==='POST'){window.sent.push({path,body:options.body});return {reviewId:9}}if(path==='/api/admin/timesheet-source-review')return {items:[{itemId:'17',status:'unreviewed'}]};if(path.endsWith('/versions'))return {itemId:'17',currentEtag:'"v1"',currentFieldsSha256:'a'.repeat(64),versions:[{versionId:'1.0',reviewStatus:'unreviewed',reviewEventId:0,fieldsSha256:'b'.repeat(64),fields:{Title:'Fictional calendar'}}]};return {itemId:'17',etag:'"v1"',fieldsSha256:'a'.repeat(64),fields:{Title:'Current item'}}}}});
    await page.addScriptTag({path:resolve('portal/timesheet-source-review.js')});await page.getByRole('button',{name:'Review source ownership'}).click();await page.getByRole('button',{name:'Inspect record 17'}).click();await page.getByRole('button',{name:'View previous versions'}).click();await page.locator('summary').filter({hasText:'Version 1.0'}).click();
    await page.getByLabel('Classification for version 1.0').selectOption('not_timesheet');await page.getByLabel('Evidence reference for version 1.0').fill('calendar-evidence');const save=page.getByRole('button',{name:'Save review for version 1.0'});assert.equal(await save.isDisabled(),true);await page.getByLabel('I checked this version contains no timesheet data').check();await save.click();const sent=await page.evaluate(()=>window.sent);assert.equal(sent[0].body.classification,'not_timesheet');assert.equal('subjectOid' in sent[0].body,false);
  }finally{await browser.close()}
});
