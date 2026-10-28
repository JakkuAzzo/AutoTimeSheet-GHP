import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium }=createRequire(import.meta.url)('playwright');
const executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,...(existsSync(executablePath)?{executablePath}:{})});
const page=await browser.newPage({viewport:{width:400,height:900}});
try {
 const html=readFileSync('portal/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 await page.route('https://stats.test/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
 await page.goto('https://stats.test/portal/');
 await page.evaluate(()=>{
  document.querySelector('main').hidden=false;
  Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify({username:'a@example.com'})}});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  window.GMTPayPeriods={payMonthKeyForDate:(d)=>d.slice(0,7),ready:Promise.resolve()};
  const rows=[{kind:'timesheets',record_id:'a',employee_upn:'a@example.com',employee_name:'A',payload:{rows:[{date:today,start:'09:00',finish:'17:00',lunchMinutes:30}]}}];
  window.GMTPortalApi={enabled:()=>true,access:async()=>({}),history:async(kind)=>({meta:{upstream:'ok',history_pagination:{has_more:false}},records:kind==='tasks'?[]:rows})};
 });
 for(const path of ['portal/calendar-data.js','portal/pay-month-workbook.js','portal/statistics-data.js','portal/dashboard-updates.js']) await page.addScriptTag({content:readFileSync(path,'utf8')});
 await page.evaluate(()=>window.GMT_PORTAL_DASHBOARD_READY);
 await page.waitForFunction(()=>document.querySelector('[data-statistics-value="worked-hours"]').textContent==='7h 30m');
 const link=await page.locator('[data-statistics-link="worked-hours"]').getAttribute('href');
 const parsed=new URL(link,'https://stats.test/portal/');
 assert.equal(parsed.pathname,'/tools/stats');assert.equal(parsed.searchParams.get('topic'),'worked-hours');assert.equal(parsed.searchParams.get('period'),'month');
 assert.match(parsed.searchParams.get('month'),/^\d{4}-\d{2}$/);
 for(const key of ['worked-days','worked-hours','holiday-days','estimates-written','job-cards-raised','tasks-completed']) assert.equal(await page.locator(`[data-statistics-link="${key}"]`).count(),1);
 console.log('Dashboard statistics links, pay-month context and worked hours: PASS');
} finally {await browser.close();}
