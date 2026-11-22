import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {validateRateCorrection,validateRateAttachments} from '../cloudflare-worker/src/synthetic-rate-fixture.js';

test('the actual upload editor produces only the pinned fictional rate correction and attachments',{timeout:20000},async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage(),html=readFileSync(resolve('portal/submissions.html'),'utf8').replace(/<script\b[^>]*><\/script>/g,'');page.setDefaultTimeout(4000);
    await page.route('https://gmt.test/**',route=>route.request().url().includes('/vendor/xlsx-0.20.3.min.js')?route.fulfill({status:200,contentType:'text/javascript',body:readFileSync(resolve('vendor/xlsx-0.20.3.min.js'))}):route.request().url().includes('/portal/spreadsheet-worker.js')?route.fulfill({status:200,contentType:'text/javascript',body:readFileSync(resolve('portal/spreadsheet-worker.js'))}):route.fulfill({status:200,contentType:'text/html',body:html}));
    await page.goto('https://gmt.test/portal/submissions');await page.locator('main').evaluate(el=>el.hidden=false);
    await page.addScriptTag({path:resolve('node_modules/xlsx/dist/xlsx.full.min.js')});
    await page.evaluate(()=>{window.GMT_APP_CONFIG={timesheetSourceRateColumns:true};window.ensureXlsxLoaded=async()=>window.XLSX;window.__writes=[];window.__queues=[];localStorage.setItem('gmt.portal.profile.v1',JSON.stringify({name:'Amanda Brown-Bennett'}));
      window.GMTPortalApi={enabled:()=>true,history:async()=>({meta:{is_submission_admin:true,timesheet_revision_consistent:true,timesheet_owner_revisions:{},editable_pay_months:['2026-10'],history_pagination:{has_more:false},completion:{employees:[{employee_name:'Nathan Private Synthetic',employee_upn:'nathanbrown-bennett@gmt-services.co.uk',schedule_weekdays:[1,2,3,4,5]}]}},records:[]}),documentTimesheetTarget:async()=>({employeeName:'Nathan Private Synthetic',employeeUpn:'nathanbrown-bennett@gmt-services.co.uk',payMonth:'2026-10',canEdit:true,conflicts:[],historyFingerprint:'A'.repeat(43),localRevision:0}),saveRecord:async record=>{window.__writes.push(record);return {ok:true}},queueAttachments:async(id,attachments)=>{window.__queues.push({id,attachments});return {queued:true,providerStatus:'awaiting-provider'}}};});
    for(const file of ['pay-periods.js','timesheet-coverage.js','portal/pay-month-workbook.js','portal/document-reader.js','portal/submission-upload-review.js','portal/submission-upload-stage.js','portal/submission-upload-ui.js','portal/submissions.js'])await page.addScriptTag({path:resolve(file)});
    await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));await page.locator('[data-submission-tab=upload]').waitFor();
    await page.locator('[data-submission-tab=upload]').click();await page.locator('#submission-upload-panel input[type=file]').setInputFiles({name:'GMT-FICTIONAL-PORTAL-RATES.csv',mimeType:'text/csv',buffer:readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv')});await page.locator('[data-review]').click();const candidates=page.locator('[data-candidate] input[type=checkbox]');await candidates.first().waitFor();assert.equal(await candidates.count(),2);await candidates.nth(0).check();await candidates.nth(1).check();await page.locator('[data-stage]').click();await page.locator('[data-pay-month-edit-form]').waitFor();await page.locator('[data-pay-month-edit-form] button[type=submit]').click();await page.waitForFunction(()=>window.__queues.length===1,{timeout:5000});
    const output=await page.evaluate(()=>({correction:window.__writes[0],queue:window.__queues[0]}));assert.equal(validateRateCorrection(output.correction),true);assert.equal(await validateRateAttachments({attachments:output.queue.attachments},{...output.correction.payload,testMode:true}),true);
  }finally{await browser.close()}
});
