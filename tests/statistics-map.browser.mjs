import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');const bin='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,...(existsSync(bin)?{executablePath:bin}:{})});const page=await browser.newPage({viewport:{width:390,height:844}});let lookups=0,postcodeLookups=0;
try{
 const html=readFileSync('tools/stats.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 await page.route('https://stats.test/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
 await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
 await page.route('https://api.postcodes.io/**',r=>{postcodeLookups++;return r.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({result:{postcode:'CR0 2DN',latitude:51.386,longitude:-0.09}})});});
 await page.route('https://photon.komoot.io/**',r=>{lookups++;return r.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({features:[{geometry:{coordinates:[-0.1,51.4]},properties:{name:'Croydon Workshop',city:'Croydon',country:'United Kingdom'}},{geometry:{coordinates:[-0.2,51.5]},properties:{name:'Other Workshop',city:'London',country:'United Kingdom'}}]})});});
 await page.goto('https://stats.test/tools/stats?topic=locations&period=all');
 for(const path of ['styles.css','portal.css','tools/vendor/leaflet/leaflet.css','tools/stats.css']) await page.addStyleTag({content:readFileSync(path,'utf8')});
 await page.evaluate(()=>{document.querySelector('main').hidden=false;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify({username:'a@example.com'})}});window.GMT_PORTAL_AUTH_READY=Promise.resolve();window.GMTPayPeriods={payMonthKeyForDate:d=>d.slice(0,7),ready:Promise.resolve()};window.GMTPortalApi={enabled:()=>true,access:async()=>({}),history:async()=>({meta:{upstream:'ok',history_pagination:{has_more:false}},records:[{kind:'clock',record_id:'site-1',employee_upn:'a@example.com',employee_name:'A',record_date:'2026-10-01',status:'Approved',payload:{source:'approved-offsite-shift',date:'2026-10-01',location:'Croydon Workshop'}},{kind:'clock',record_id:'site-2',employee_upn:'a@example.com',employee_name:'A',record_date:'2026-10-02',action:'clock_in',payload:{date:'2026-10-02',locationMode:'in_office',action:'clock_in'}}]})};});
 for(const p of ['portal/calendar-data.js','portal/pay-month-workbook.js','portal/statistics-data.js','tools/vendor/leaflet/leaflet.js','tools/stats-locations.js','tools/stats-map.js','tools/stats-charts.js','tools/stats.js'])await page.addScriptTag({content:readFileSync(p,'utf8')});
 await page.waitForFunction(()=>document.querySelector('#stats-status').textContent==='Statistics loaded.');
 assert.equal(await page.locator('#stats-map-section').isVisible(),true);assert.equal(await page.locator('#stats-total').textContent(),'2');assert.equal(lookups,0,'no external location request without user action');
 assert.equal(await page.locator('.leaflet-interactive').count(),1,'public GMT office postcode is shown when office attendance is recorded');
 await page.getByRole('button',{name:'Find on map'}).first().click();await page.waitForSelector('.stats-location select');assert.equal(lookups,1);
 assert.equal(await page.locator('.leaflet-interactive').count(),1,'ambiguous suggestions are not automatically plotted');
 await page.locator('.stats-location select').first().selectOption('0');await page.getByRole('button',{name:'Place on map'}).first().click();
 assert.equal(await page.locator('.leaflet-interactive').count(),2);assert.match(await page.locator('.stats-location-status').first().textContent(),/Location selected/);
 await page.getByRole('button',{name:'Find on map'}).last().click();await page.waitForFunction(()=>document.querySelectorAll('.stats-location select').length===2);assert.equal(postcodeLookups,1,'exact postcode lookup is used for the GMT workshop');
 assert.match(await page.locator('.stats-location select').last().textContent(),/postcode area/i);
 console.log('Work locations map, explicit geocoding and confirmed markers: PASS');
}finally{await browser.close();}
