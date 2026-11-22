import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {blankPayMonthWorkbookBase64} from '../cloudflare-worker/src/pay-month-template.js';

const xlsx=createRequire(import.meta.url)('xlsx');
const book=xlsx.read(Buffer.from(blankPayMonthWorkbookBase64,'base64'),{type:'buffer',bookVBA:true});
assert.deepEqual(book.SheetNames,['Daily Entries','Weekly Totals']);
assert.equal(book.vbaraw,undefined,'the system template has no macros');
assert.deepEqual(xlsx.utils.sheet_to_json(book.Sheets['Daily Entries'],{header:1}),[['Date','Start','Finish','Break','Absence','Total hours','Notes']]);
assert.deepEqual(xlsx.utils.sheet_to_json(book.Sheets['Weekly Totals'],{header:1}),[['Week Start','Week End','Total hours']]);
console.log('PASS: the bundled workbook template has only the required blank sheets');
