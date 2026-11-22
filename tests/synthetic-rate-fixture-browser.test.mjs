import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {rateEvidence,rateFixture,verifyRateFixtureBytes} from '../cloudflare-worker/src/synthetic-rate-fixture.js';
import {syntheticRateExample} from './helpers/synthetic-rate-attachments.mjs';

test('the pinned fictional CSV is parsed with its separate rate values and generates the pinned browser workbook',{timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();
    await page.route('https://gmt.test/**',route=>route.request().url().includes('/vendor/xlsx-0.20.3.min.js')?route.fulfill({status:200,contentType:'text/javascript',body:readFileSync(resolve('vendor/xlsx-0.20.3.min.js'))}):route.request().url().includes('/portal/spreadsheet-worker.js')?route.fulfill({status:200,contentType:'text/javascript',body:readFileSync(resolve('portal/spreadsheet-worker.js'))}):route.fulfill({status:200,contentType:'text/html',body:'<!doctype html>'}));
    await page.goto('https://gmt.test/');await page.addScriptTag({path:resolve('portal/document-reader.js')});await page.addScriptTag({path:resolve('portal/submission-upload-review.js')});
    const bytes=readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv');assert.equal(await verifyRateFixtureBytes(new Uint8Array(bytes)),true);
    const parsed=await page.evaluate(async text=>{const source=await GMTDocumentReader.parse(new File([text],'GMT-FICTIONAL-PORTAL-RATES.csv'));return {id:source.sourceId,items:GMTSubmissionUploadReview.review(source)}},bytes.toString());
    assert.equal(parsed.id,rateFixture.sourceId);assert.equal(parsed.items.length,2);
    for(let i=0;i<2;i++){const item=parsed.items[i];assert.equal(item.valid,true);assert.equal(item.data.date,rateFixture.rows[i].date);assert.deepEqual({...item.data.sourceEvidence,sourceFile:rateFixture.fileName,sourceId:parsed.id},rateEvidence(i));}
    await page.addScriptTag({path:resolve('node_modules/xlsx/dist/xlsx.full.min.js')});await page.addScriptTag({path:resolve('portal/pay-month-workbook.js')});
    const {correction,body}=syntheticRateExample();const result=await page.evaluate(payload=>{const p={start:'2026-09-21',cycleEnd:'2026-10-18',payrollFriday:'2026-10-16'},m=GMTPayMonthWorkbook.toWorkbookMatrices({rows:payload.rows.map(row=>({row}))},p,{includeSourceRates:true});const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(m.dailyMatrix),'Daily Entries');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(m.weeklyMatrix),'Weekly Totals');const binary=XLSX.write(book,{bookType:'xlsx',type:'base64'}),csv=m.dailyMatrix.map(row=>row.map(value=>'"'+String(value==null?'':value).replace(/"/g,'""')+'"').join(',')).join('\r\n');return {binary,csv}},correction.payload);
    assert.equal(result.binary,body.attachments[0].contentBase64);assert.equal(Buffer.from(result.csv).toString('base64'),body.attachments[1].contentBase64);
  }finally{await browser.close()}
});
