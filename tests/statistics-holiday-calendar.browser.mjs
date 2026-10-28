import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url); const { chromium }=require('playwright');
const executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,...(existsSync(executablePath)?{executablePath}:{})});
const page=await browser.newPage({viewport:{width:390,height:844}}); page.setDefaultTimeout(3000);
try {
 const html=readFileSync('tools/stats.html','utf8');
 await page.route('https://stats.test/**',r=>r.fulfill({status:200,contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}));
 await page.goto('https://stats.test/tools/stats?topic=holiday-days&period=year&year=2026');
 for(const path of ['styles.css','portal.css','tools/stats.css']) await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.evaluate(()=>{
  document.querySelector('main').hidden=false;
  Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify({username:'admin@example.com'})}});
  window.GMT_PORTAL_AUTH_READY=Promise.resolve(); window.GMTPayPeriods={payMonthKeyForDate:d=>d.slice(0,7),ready:Promise.resolve()};
  window.GMTPortalApi={enabled:()=>true,access:async()=>({isAdmin:true}),history:async()=>({meta:{upstream:'ok',history_pagination:{has_more:false}},records:[
   {kind:'timesheets',record_id:'a',employee_upn:'a@example.com',employee_name:'Alice',payload:{rows:[{date:'2026-10-30',absenceReason:'Holiday'},{date:'2026-10-31',absenceReason:'Holiday'},{date:'2026-11-01',absenceReason:'Holiday'},{date:'2026-11-03',absenceReason:'Holiday'}]}},
   {kind:'timesheets',record_id:'b',employee_upn:'b@example.com',employee_name:'Bob',payload:{rows:[{date:'2026-11-02',absenceReason:'Holiday'}]}}
  ]})};
 });
 for(const path of ['portal/calendar-data.js','portal/pay-month-workbook.js','portal/statistics-data.js','tools/stats-locations.js','tools/stats-map.js','tools/stats-charts.js','tools/stats-holiday-calendar.js','tools/stats.js']) if(existsSync(path)) await page.addScriptTag({content:readFileSync(path,'utf8')});
 await page.waitForFunction(()=>document.getElementById('stats-status').textContent==='Statistics loaded.');
 assert.equal(await page.locator('#stats-holiday-calendar').isVisible(),true,'Holiday calendar should be visible');
 await page.selectOption('#stats-employee','a@example.com');
 assert.match(await page.locator('#holiday-month-title').textContent(),/November 2026/);
 assert.equal(await page.locator('[data-holiday-date="2026-11-01"]').getAttribute('data-holiday-position'),'end','cross-month range ends on 1 November');
 assert.equal(await page.locator('[data-holiday-date="2026-11-02"]').getAttribute('data-holiday-position'),null,'another employee does not fill a gap');
 assert.equal(await page.locator('[data-holiday-date="2026-11-03"]').getAttribute('data-holiday-position'),'single');
 await page.locator('[data-holiday-date="2026-11-01"]').click();
 assert.match(await page.locator('#holiday-detail').textContent(),/Alice/);
 assert.match(await page.locator('#holiday-detail').textContent(),/30 October 2026.*1 November 2026/,'selecting a day shows the recorded period');
 await page.locator('#holiday-previous').click();
 assert.match(await page.locator('#holiday-month-title').textContent(),/October 2026/);
 assert.equal(await page.locator('[data-holiday-date="2026-10-30"]').getAttribute('data-holiday-position'),'start');
 assert.equal(await page.locator('[data-holiday-date="2026-10-31"]').getAttribute('data-holiday-position'),'middle');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no mobile overflow');
 if(process.env.HOLIDAY_SCREENSHOT) await page.locator('#stats-holiday-calendar').screenshot({path:process.env.HOLIDAY_SCREENSHOT});
 await page.locator('[data-topic="worked-days"]').click(); assert.equal(await page.locator('#stats-holiday-calendar').isHidden(),true);
 console.log('Holiday calendar: dates, gaps, employee filter, month boundaries and mobile layout PASS');
} finally {await browser.close();}
