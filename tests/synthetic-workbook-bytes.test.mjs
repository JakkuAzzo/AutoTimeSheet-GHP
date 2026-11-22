import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { syntheticFixture } from '../cloudflare-worker/src/synthetic-portal-fixture.js';

const require=createRequire(import.meta.url);
const workbookApi=require('../portal/pay-month-workbook.js');
const periods=require('../pay-periods.js');
const xlsx=require('xlsx');
const sha256=value=>createHash('sha256').update(value).digest('hex');

test('the generated fictional workbook preserves the two distinct break states and notes',()=>{
  const rows=syntheticFixture.rows.map((row,index)=>({row:{...row,description:row.note,
    lunchHad:index===0?false:null,...(index===0?{workedMinutes:180,workedHours:3}:{}),
    basicHours:index===0?3:2,ot15Hours:0,ot20Hours:0,weightedHours:index===0?3:2}}));
  const prepared=workbookApi.toWorkbookMatrices({rows},periods.periodForMonth('2026-10'));
  const book=xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(prepared.dailyMatrix),'Daily Entries');
  xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(prepared.weeklyMatrix),'Weekly Totals');
  const bytes=Buffer.from(xlsx.write(book,{bookType:'xlsx',type:'array'}));
  const readBack=xlsx.read(bytes,{type:'buffer'});
  const daily=xlsx.utils.sheet_to_json(readBack.Sheets['Daily Entries'],{header:1,defval:''});
  assert.deepEqual(daily.slice(1,3),[
    ['2026-10-05','09:00','12:00',0,'NA','3h 00m','Fictional portal test A'],
    ['2026-10-06','10:00','12:00','','NA','2h 00m','Fictional portal test B · Break not recorded; total before any break deduction']
  ]);
  assert.equal(sha256(bytes),'c70b75aa71cad92977fbcd933e1e3a33b22b80c4eaeb3498e8d4f55a73554101');
  const csv=prepared.dailyMatrix.map(row=>row.map(value=>'"'+String(value==null?'':value).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  assert.equal(sha256(csv),'da0523afa4ad6ed3e4a08a39fbe84f9c338463a8ed6053b766614e2028ac3801');
});
