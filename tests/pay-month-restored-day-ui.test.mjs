import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

async function openSheet(tied){
 const browser=await chromium.launch({headless:true}),page=await browser.newPage();
 const html=readFileSync(resolve('portal/submissions.html'),'utf8').replace(/<script\b[^>]*><\/script>/g,'');
 await page.route('https://gmt.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
 await page.goto('https://gmt.test/portal/submissions?record=restored');await page.locator('main').evaluate(el=>el.hidden=false);
 await page.evaluate(tied=>{
  const base={kind:'timesheets',employee_name:'Fictional Employee',employee_upn:'employee@example.test',can_edit:true,status:'Submitted'};
  const records=[{...base,source_record_id:'original',action:'submission',updated_at:'2026-10-01T00:00:00Z',payload:{rows:[{date:'2026-10-05',start:'09:00',finish:'12:00',lunchMinutes:0}]}},
   {...base,source_record_id:'deleted',action:'pay_month_correction',updated_at:'2026-10-02T00:00:00Z',payload:tied==='rows'?{payMonth:'2026-10',rows:[{date:'2026-10-05',start:'08:00',finish:'12:00',lunchMinutes:0}],deletedDays:[]}:{payMonth:'2026-10',rows:[],deletedDays:['2026-10-05']}},
   {...base,source_record_id:'restored',action:'pay_month_correction',updated_at:tied?'2026-10-02T00:00:00Z':'2026-10-03T00:00:00Z',payload:{payMonth:'2026-10',rows:[{date:'2026-10-05',start:'10:00',finish:'12:00',lunchMinutes:0}],deletedDays:[]}}];
  window.GMTPortalApi={enabled:()=>true,history:async()=>({records,meta:{is_submission_admin:true,is_admin:true,can_view_all_timesheets:true,timesheet_revision_consistent:true,completion:{employees:[{employee_name:'Fictional Employee',employee_upn:'employee@example.test'}]}}})};
 },tied);
 for(const file of ['pay-periods.js','timesheet-coverage.js','portal/pay-month-workbook.js','portal/submissions.js'])await page.addScriptTag({path:resolve(file)});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 await page.waitForSelector('[data-sheet-index]',{timeout:4000});await page.locator('[data-sheet-index]').filter({hasText:'Fictional Employee'}).first().click();
 return {browser,page};
}
test('a later restored day is visible in the pay-month editor',async()=>{const {browser,page}=await openSheet(false);try{
 const row=page.locator('[data-pay-month-edit-form] [data-sheet-row]').filter({has:page.locator('[data-sheet-field="date"][value="2026-10-05"]')});
 assert.equal(await row.count(),1);assert.equal(await row.locator('[data-sheet-field="start"]').inputValue(),'10:00');
}finally{await browser.close()}});
test('an equally timed deletion and restored day is held for review',async()=>{const {browser,page}=await openSheet(true);try{
 assert.match(await page.locator('#submissions-preview').innerText(),/conflict.*review/i);
 assert.equal(await page.getByRole('button',{name:'Save changes'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Download full pay-month spreadsheet'}).isDisabled(),true);
 assert.equal(await page.locator('[data-pay-month-total-hours]').innerText(),'Needs review');
}finally{await browser.close()}});
test('two differing corrections with the same timestamp are held for review',async()=>{const {browser,page}=await openSheet('rows');try{
 assert.match(await page.locator('#submissions-preview').innerText(),/conflict.*review/i);
 assert.equal(await page.getByRole('button',{name:'Save changes'}).count(),0);
}finally{await browser.close()}});
