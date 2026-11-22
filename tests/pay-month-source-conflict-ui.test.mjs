import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = readFileSync(resolve(root, 'portal/submissions.html'), 'utf8').replace(/<script\b[^>]*><\/script>/g, '');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const mode of ['clocks','rates','missing-rate-correction']) for (const reverse of [false, true]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(4000);
    await page.route('https://gmt.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto('https://gmt.test/portal/submissions');
    await page.locator('main').evaluate(main => { main.hidden = false; });
    await page.evaluate(({reverse,mode}) => {
      const rows = [
        { kind:'timesheets', action:'submission', source_record_id:'first', employee_name:'Fictional', employee_upn:'fictional@example.test', updated_at:'2026-09-21T12:00:00Z', can_edit:true, payload:{rows:[{date:'2026-09-16',start:'08:00',finish:'17:00',lunchMinutes:60}]} },
        { kind:'timesheets', action:'submission', source_record_id:'second', employee_name:'Fictional', employee_upn:'fictional@example.test', updated_at:'2026-09-21T16:00:00Z', can_edit:true, payload:{rows:[{date:'2026-09-16',start:'08:00',finish:'18:00',lunchMinutes:60}]} }
      ];
      if(mode!=='clocks'){
        rows[0].payload.rows[0].sourceEvidence={rateEvidenceVersion:1,claimedBasic:480,claimedOt15:60,claimedOt20:null};
        rows[1].payload.rows[0].finish='17:00';
        if(mode==='rates')rows[1].payload.rows[0].sourceEvidence={rateEvidenceVersion:1,claimedBasic:420,claimedOt15:120,claimedOt20:null};
        else rows[1].action='pay_month_correction';
      }
      window.GMTPortalApi = {enabled:()=>true,history:async()=>({meta:{is_submission_admin:true,can_view_all_timesheets:true,completion:{employees:[{employee_name:'Fictional',employee_upn:'fictional@example.test'}]}},records:reverse?rows.reverse():rows})};
    }, {reverse,mode});
    for (const path of ['pay-periods.js','timesheet-coverage.js','portal/pay-month-workbook.js','portal/submissions.js']) await page.addScriptTag({path:resolve(root,path)});
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    await page.locator('[data-sheet-index]').filter({hasText:'Fictional'}).first().click();
    assert.match(await page.locator('#submissions-preview [role="alert"]').innerText(), /Conflicting entries need review.*2026-09-16/);
    assert.equal(await page.locator('[data-pay-month-download]').isDisabled(), true);
    assert.equal(await page.locator('[data-pay-month-total-hours]').innerText(), 'Needs review');
    assert.equal(await page.getByRole('button',{name:'Save changes'}).count(), 0);
    await page.close();
  }
} finally { await browser.close(); }
