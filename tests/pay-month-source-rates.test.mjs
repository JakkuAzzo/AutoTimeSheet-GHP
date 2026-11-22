import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const workbook=createRequire(import.meta.url)('../portal/pay-month-workbook.js');
const period={start:'2026-09-21',end:'2026-10-25'};
const row={date:'2026-10-05',start:'08:00',finish:'17:00',sourceEvidence:{rateEvidenceVersion:1,claimedBasic:480,claimedOt15:120,claimedOt20:0}};
const matrix=workbook.toWorkbookMatrices({rows:[{row}]},period,{includeSourceRates:true}).dailyMatrix;
assert.deepEqual(matrix[0].slice(-3),['Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours']);
assert.deepEqual(matrix[1].slice(-3),['8h 00m','2h 00m','0h 00m']);
const missing=workbook.toWorkbookMatrices({rows:[{row:{...row,sourceEvidence:{rateEvidenceVersion:1,claimedBasic:null,claimedOt15:0,claimedOt20:null}}}]},period,{includeSourceRates:true}).dailyMatrix;
assert.deepEqual(missing[1].slice(-3),['','0h 00m','']);
const legacy=workbook.toWorkbookMatrices({rows:[{row:{...row,sourceEvidence:{claimedBasic:480,claimedOt15:0,claimedOt20:0}}}]},period,{includeSourceRates:true}).dailyMatrix;
assert.deepEqual(legacy[1].slice(-3),['','',''],'legacy zero claims require separate review');
assert.throws(()=>workbook.toWorkbookMatrices({rows:[{row:{...row,sourceEvidence:{rateEvidenceVersion:1,claimedBasic:-1}}}]},period,{includeSourceRates:true}),/source.*rate/i);
assert.equal(workbook.toWorkbookMatrices({rows:[{row}]},period).dailyMatrix[0].length,7,'existing exports stay compatible until the delivery path is upgraded');
