import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

test('the fictional upload is parsed and reviewed as two exact timesheet days', async () => {
  const bytes = fs.readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json');
  const context = vm.createContext({ crypto:webcrypto, TextEncoder, TextDecoder, File, console,
    document:{getElementById(){return null}}, GMT_APP_CONFIG:{} });
  context.window=context;
  vm.runInContext(fs.readFileSync('portal/document-reader.js','utf8'),context);
  vm.runInContext(fs.readFileSync('portal/submission-upload-review.js','utf8'),context);
  const file=new File([bytes], 'GMT-FICTIONAL-PORTAL-UPLOAD.json', {type:'application/json'});
  const parsed=await context.GMTDocumentReader.parse(file);
  const reviewed=context.GMTSubmissionUploadReview.review(parsed);
  assert.equal(reviewed.length,2);
  assert.deepEqual(Array.from(reviewed,item=>({valid:item.valid,employeeEmail:item.data.employeeEmail,date:item.data.date,
    start:item.data.start,finish:item.data.finish,lunchMinutes:item.data.lunchMinutes,notes:item.data.notes})),[
    {valid:true,employeeEmail:'nathanbrown-bennett@gmt-services.co.uk',date:'2026-10-05',start:'09:00',finish:'12:00',lunchMinutes:0,notes:'Fictional portal test A'},
    {valid:true,employeeEmail:'nathanbrown-bennett@gmt-services.co.uk',date:'2026-10-06',start:'10:00',finish:'12:00',lunchMinutes:null,notes:'Fictional portal test B'}
  ]);
  assert.match(parsed.sourceId,/^[a-f0-9]{64}$/);
});
