import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  const html=readFileSync(resolve('portal/submissions.html'),'utf8').replace(/<script\b[^>]*><\/script>/g,'');
  await page.route('https://gmt.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  await page.goto('https://gmt.test/portal/submissions');
  await page.locator('main').evaluate(el=>el.hidden=false);
  await page.evaluate(()=>{
    window.GMTPortalApi={enabled:()=>true,history:async()=>({records:[{kind:'tasks',action:'create_request',source_record_id:'own-task',status:'Pending approval',payload:{title:'Fictional current task'}}],meta:{timesheet_identity_review_required:true,timesheet_revision_consistent:false,visible_scope:'other authorised submissions'}})};
  });
  for(const file of ['pay-periods.js','timesheet-coverage.js','portal/pay-month-workbook.js','portal/submissions.js']) await page.addScriptTag({path:resolve(file)});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(()=>/contact Accounts/i.test(document.querySelector('#submissions-status')?.textContent||''),null,{timeout:3000});
  await page.locator('[data-submission-tab=tasks]').click();
  assert.equal(await page.getByText('Fictional current task').count()>0,true,'other documents remain accessible while timesheets are held');
  console.log('PASS: a timesheet identity hold gives a next step and leaves other records accessible');
} finally {await browser.close();}
