import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
const oid='db9f99d4-7980-4f1d-927a-875221d4320a',hash='a'.repeat(64);
const manifest={entries:[{record_id:'fictional-1',stored_updated_at:'2026-11-16T12:00:00Z',payload_sha256:hash,confirmed_employee_upn:'employee@example.test',current_directory_object_id:oid,version_scope:'current_payload_only',status:'reviewed_not_applied'}]};

test('reviewer can inspect other local history with explicit incomplete-source limits',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
  await page.evaluate(({oid,hash})=>{window.calls=[];window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>{window.calls.push(path);if(path.includes('review-subject'))return {oid,upn:'employee@example.test',name:'Fictional Employee',accountEnabled:true};if(path.includes('/local-history'))return {scope:'other-local-records-only',payMonth:'2026-10',rows:[{Date:'2026-10-05',Start:'09:00',Finish:'17:00',Break:60,Absence:'NA','Total hours':420,Notes:'<img src=x onerror=window.exploited=1>'}],queuedComparison:{status:'compared',dates:[{date:'2026-10-05',status:'different',fields:['Finish'],local:{Finish:'17:00'},queued:{Finish:'18:00'}},{date:'2026-10-06',status:'only-queued',fields:[],local:null,queued:{}}]}};return {record:{record_id:'fictional-1',action:'pay_month_correction',updated_at:'2026-11-16T12:00:00Z'},revision:1,reviewEventId:1,payloadSha256:hash,activeReview:{reviewId:1,subjectOid:oid,payloadSha256:hash}}}}},{oid,hash});
  await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});await page.getByRole('button',{name:'Review confirmed records'}).click();await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});await page.getByRole('button',{name:'Check records'}).click();await page.getByText(/Already reviewed/).waitFor();
  await page.getByRole('button',{name:'View other local history'}).click();await page.getByText('2026-10-05',{exact:false}).first().waitFor();
  let text=await page.locator('#ownership-review').innerText();assert.match(text,/does not include the selected correction/i);assert.match(text,/does not prove.*complete/i);assert.match(text,/<img src=x/);assert.match(text,/finish.*17:00.*18:00/i);assert.match(text,/2026-10-06.*only in the saved month/i);assert.equal(await page.evaluate(()=>window.exploited||0),0);
  assert.ok((await page.evaluate(()=>window.calls)).some(x=>x.endsWith('/local-history?upn=employee%40example.test')));
 }finally{await browser.close()}
});
test('reviewer sees conflicting source alternatives without the saved correction masking them',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
  await page.evaluate(({oid,hash})=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>{if(path.includes('review-subject'))return {oid,upn:'employee@example.test',name:'Fictional',accountEnabled:true};if(path.includes('/local-history'))return {scope:'other-local-records-only',payMonth:'2026-10',rows:[],conflicts:[{date:'2026-10-07',candidates:[{recordId:'source-a',deleted:false,row:{Date:'2026-10-07',Start:'08:00',Finish:'16:00',Break:0,Absence:'NA','Total hours':480,Notes:''}},{recordId:'source-b',deleted:false,row:{Date:'2026-10-07',Start:'09:00',Finish:'17:00',Break:0,Absence:'NA','Total hours':480,Notes:''}}]}],queuedComparison:{status:'compared',dates:[{date:'2026-10-07',status:'needs-review',fields:[],local:null,queued:{Finish:'17:00'}}]}};return {record:{record_id:'fictional-1',action:'pay_month_correction',updated_at:'2026-11-16T12:00:00Z'},revision:1,reviewEventId:1,payloadSha256:hash,activeReview:{reviewId:1,subjectOid:oid,payloadSha256:hash}}}}},{oid,hash});
  await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});await page.getByRole('button',{name:'Review confirmed records'}).click();await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});await page.getByRole('button',{name:'Check records'}).click();await page.getByText(/Already reviewed/).waitFor();await page.getByRole('button',{name:'View other local history'}).click();
  await page.getByText(/2026-10-07.*needs review/i).first().waitFor();let text=await page.locator('#ownership-review').innerText();assert.match(text,/source-a.*08:00.*16:00/i);assert.match(text,/source-b.*09:00.*17:00/i);assert.doesNotMatch(text,/returned dates and compared fields agree/i);
 }finally{await browser.close()}
});

test('authenticated reviewer stages the exact current record before applying a decision',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
  await page.evaluate(({oid,hash})=>{window.calls=[];window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{
   window.calls.push({path,options});if(path.includes('review-subject'))return {oid,upn:'employee@example.test',name:'Fictional Employee',accountEnabled:true};
   if(options?.method==='POST')return {reviewId:1};return {record:{record_id:'fictional-1',updated_at:'2026-11-16T12:00:00Z',start_date:'2026-10-01',end_date:'2026-10-31'},revision:1,reviewEventId:0,payloadSha256:hash,deliveryStatus:'queued',activeReview:null};
  }}} ,{oid,hash});
  await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});
  await page.getByRole('button',{name:'Review confirmed records'}).click();
  await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});
  await page.getByRole('button',{name:'Check records'}).click();
  await page.getByText('Fictional Employee',{exact:false}).waitFor();
  assert.match(await page.locator('#ownership-review').innerText(),/queued/i);
  assert.equal(await page.getByRole('button',{name:'Apply ownership decisions'}).isDisabled(),true);
  await page.getByLabel('Evidence reference').fill('confirmed-2026-11-16');
  await page.getByLabel('I confirm these current records belong to the listed employees').check();
  await page.getByRole('button',{name:'Apply ownership decisions'}).click();
  await page.getByText('1 ownership decision saved',{exact:false}).waitFor();
  const posts=await page.evaluate(()=>window.calls.filter(x=>x.options?.method==='POST'));assert.equal(posts.length,1);assert.equal(posts[0].options.body.payloadSha256,hash);assert.equal(posts[0].options.body.subjectOid,oid);assert.equal(posts[0].options.body.expectedRevision,1);
 }finally{await browser.close()}
});

test('changed records cannot be applied from an old confirmation file',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
  await page.evaluate(({oid})=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path.includes('review-subject')?{oid,upn:'employee@example.test',name:'Fictional Employee',accountEnabled:true}:{record:{record_id:'fictional-1',updated_at:'2026-11-16T12:00:00Z'},revision:1,reviewEventId:0,payloadSha256:'b'.repeat(64),deliveryStatus:null,activeReview:null}}},{oid});
  await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});await page.getByRole('button',{name:'Review confirmed records'}).click();await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});await page.getByRole('button',{name:'Check records'}).click();
  await page.getByText(/changed since confirmation/i).waitFor();assert.equal(await page.getByRole('button',{name:'Apply ownership decisions'}).isDisabled(),true);
 }finally{await browser.close()}
});

test('partial application stops and a fresh check skips the already saved decision',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
  await page.evaluate(({oid,hash})=>{window.posts=[];window.savedFirst=false;window.failSecond=true;window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{
   if(path.includes('review-subject'))return {oid,upn:'employee@example.test',name:'Fictional Employee',accountEnabled:true};
   const id=decodeURIComponent(path.split('/').pop());
   if(options?.method==='POST'){window.posts.push(id);if(id==='fictional-2'&&window.failSecond){window.failSecond=false;throw Error('Temporary conflict')}if(id==='fictional-1')window.savedFirst=true;return {reviewId:1}}
   return {record:{record_id:id,updated_at:'2026-11-16T12:00:00Z'},revision:1,reviewEventId:0,payloadSha256:hash,deliveryStatus:null,activeReview:id==='fictional-1'&&window.savedFirst?{reviewId:1,subjectOid:oid,payloadSha256:hash}:null};
  }}},{oid,hash});
  const entries=[manifest.entries[0],{...manifest.entries[0],record_id:'fictional-2'}];
  await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});await page.getByRole('button',{name:'Review confirmed records'}).click();await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({entries}))});
  await page.getByRole('button',{name:'Check records'}).click();await page.getByText(/All records checked/).waitFor();await page.getByLabel('Evidence reference').fill('confirmed-2026-11-16');await page.getByLabel('I confirm these current records belong to the listed employees').check();await page.getByRole('button',{name:'Apply ownership decisions'}).click();await page.getByText(/1 saved before the check stopped/).waitFor();
  await page.getByRole('button',{name:'Check records'}).click();await page.getByText(/Already reviewed/).waitFor();await page.getByLabel('I confirm these current records belong to the listed employees').check();await page.getByRole('button',{name:'Apply ownership decisions'}).click();await page.getByText(/1 ownership decision saved/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.posts),['fictional-1','fictional-2','fictional-2']);
 }finally{await browser.close()}
});

test('an in-progress delivery holds the decision for reconciliation',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
  await page.evaluate(({oid,hash})=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path.includes('review-subject')?{oid,upn:'employee@example.test',name:'Fictional Employee',accountEnabled:true}:{record:{record_id:'fictional-1',updated_at:'2026-11-16T12:00:00Z'},revision:1,reviewEventId:0,payloadSha256:hash,deliveryStatus:'sending',activeReview:null}}},{oid,hash});
  await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});await page.getByRole('button',{name:'Review confirmed records'}).click();await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});await page.getByRole('button',{name:'Check records'}).click();
  await page.getByText(/Delivery needs reconciliation/).waitFor();assert.equal(await page.getByRole('button',{name:'Apply ownership decisions'}).isDisabled(),true);
 }finally{await browser.close()}
});

test('an unchanged record without an update timestamp can still be checked by fingerprint',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
  await page.evaluate(({oid,hash})=>{window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path)=>path.includes('review-subject')?{oid,upn:'employee@example.test',name:'Fictional Employee',accountEnabled:true}:{record:{record_id:'fictional-1',updated_at:''},revision:1,reviewEventId:0,payloadSha256:hash,deliveryStatus:null,activeReview:null}}},{oid,hash});
  await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});await page.getByRole('button',{name:'Review confirmed records'}).click();await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({entries:[{...manifest.entries[0],stored_updated_at:''}]}))});await page.getByRole('button',{name:'Check records'}).click();
  await page.getByText(/All records checked/).waitFor();
 }finally{await browser.close()}
});


test('inactive or unverified employee accounts cannot be adopted',async()=>{
 const browser=await chromium.launch({headless:true});try{
  for(const accountEnabled of [false,undefined]){
   const page=await browser.newPage();await page.setContent('<section id="ownership-review" hidden></section>');
   await page.evaluate(({oid,hash,accountEnabled})=>{window.posts=0;window.GMTPortalApi={access:async()=>({canReviewTimesheetOwnership:true}),request:async(path,options)=>{if(options?.method==='POST')window.posts++;if(path.includes('review-subject'))return {oid,upn:'employee@example.test',name:'Fictional',accountEnabled};return {record:{record_id:'fictional-1',updated_at:'2026-11-16T12:00:00Z'},revision:1,reviewEventId:0,payloadSha256:hash,deliveryStatus:null,activeReview:null}}}},{oid,hash,accountEnabled});
   await page.addScriptTag({path:resolve(process.env.GMT_OWNERSHIP_UI_SCRIPT || 'portal/timesheet-ownership-review.js')});await page.getByRole('button',{name:'Review confirmed records'}).click();await page.getByLabel('Ownership review file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});await page.getByRole('button',{name:'Check records'}).click();await page.getByText(/account is inactive or could not be verified/i).waitFor();assert.equal(await page.getByRole('button',{name:'Apply ownership decisions'}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.posts),0);await page.close();
  }
 }finally{await browser.close()}
});
