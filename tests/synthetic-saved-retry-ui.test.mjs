import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {syntheticFixture as fixture} from '../cloudflare-worker/src/synthetic-portal-fixture.js';

test('fictional recovery queues the existing saved snapshot without resaving or sending another notice',async()=>{
 const build=JSON.parse(execFileSync(process.execPath,['tools/prepare-synthetic-portal.mjs','--build-only'],{encoding:'utf8'}));const site=path.join(build.directory,'site');const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();page.setDefaultTimeout(5000);const html=fs.readFileSync(path.join(site,'portal/submissions.html'),'utf8').replace(/<script\b[^>]*><\/script>/g,'');
  await page.route('https://gmt.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));await page.goto('https://gmt.test/portal/submissions');await page.locator('main').evaluate(x=>x.hidden=false);
  await page.evaluate(f=>{window.__saves=0;window.__notices=0;window.__queues=[];window.GMT_APP_CONFIG={timesheetFormSubmitEndpoint:'https://fictional.invalid'};window.fetch=async()=>{window.__notices++;return {ok:true,json:async()=>({success:true})}};
   window.ensureXlsxLoaded=async()=>({utils:{book_new:()=>({}),aoa_to_sheet:matrix=>({matrix}),book_append_sheet:()=>{}},write:()=>new Uint8Array([1,2,3]).buffer});
   const p={testMode:true,employeeName:f.employeeName,employeeEmail:f.employeeUpn,payMonth:'2026-10',editedAt:'2026-11-16T13:00:00.000Z',editedBy:'Amanda Brown-Bennett',deletedDays:[],rows:f.rows.map(r=>({...r,description:r.note}))};
   window.GMTPortalApi={enabled:()=>true,history:async()=>({meta:{is_admin:true,can_view_all_timesheets:true,timesheet_revision_consistent:true,timesheet_owner_revisions:{[f.employeeUpn]:1},editable_pay_months:['2026-10'],completion:{employees:[{employee_name:f.employeeName,employee_upn:f.employeeUpn}]}},records:[{kind:'timesheets',action:'pay_month_correction',source_record_id:f.recordId,employee_name:f.employeeName,employee_upn:f.employeeUpn,can_edit:true,status:'Submitted',payload:p}]}),saveRecord:async()=>{window.__saves++;return {ok:true}},queueAttachments:async(id,attachments)=>{window.__queues.push({id,attachments});return {queued:true}}};
  },fixture);
  for(const f of ['pay-periods.js','timesheet-coverage.js','portal/pay-month-workbook.js','portal/submissions.js'])await page.addScriptTag({path:path.join(site,f)});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));const retry=page.getByRole('button',{name:'Retry fictional workbook filing'});await retry.waitFor();
  const firstStart=page.locator('[data-pay-month-edit-form] [data-sheet-row]').first().locator('[data-sheet-field="start"]');const original=await firstStart.inputValue();await firstStart.fill('08:00');await retry.click();
  await page.getByText(/undo unsaved changes before retrying/i).waitFor();assert.deepEqual(await page.evaluate(()=>({saves:window.__saves,notices:window.__notices,queues:window.__queues.length})),{saves:0,notices:0,queues:0});
  await firstStart.fill(original);await retry.click();await page.waitForFunction(()=>window.__queues.length===1);
  const result=await page.evaluate(()=>({saves:window.__saves,notices:window.__notices,queue:window.__queues[0]}));assert.equal(result.saves,0);assert.equal(result.notices,0);assert.equal(result.queue.id,fixture.recordId);
  const source=JSON.parse(Buffer.from(result.queue.attachments.find(x=>x.fieldName==='attachment_record').contentBase64,'base64').toString());assert.equal(source.submittedAt,'2026-11-16T13:00:00.000Z');assert.equal(source.rows.length,2);
 }finally{await browser.close();fs.rmSync(build.directory,{recursive:true,force:true})}
});
