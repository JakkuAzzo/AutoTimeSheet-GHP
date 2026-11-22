import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { syntheticFixture, validateSyntheticTarget, validateSyntheticCorrection } from '../cloudflare-worker/src/synthetic-portal-fixture.js';

test('the validator accepts the expected fictional values and rejects altered or additional content', () => {
  const bytes=fs.readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),syntheticFixture.sourceId);
  const evidence={raw:'',claimedBasic:null,claimedOt15:null,claimedOt20:null,reviewNote:'',
    sourceFile:syntheticFixture.fileName,sourceId:syntheticFixture.sourceId};
  const rows=syntheticFixture.rows.map((row,index)=>({...row,description:row.note,lunchHad:row.lunchMinutes===null?null:false,
    ...(index===0?{workedMinutes:180,workedHours:3}:{}),basicHours:index===0?3:2,ot15Hours:0,ot20Hours:0,weightedHours:index===0?3:2,sourceEvidence:{...evidence}}));
  const editor='Nathan Brown-Bennett';
  const body={recordId:syntheticFixture.recordId,kind:'timesheets',action:'pay_month_correction',status:'Submitted',editMode:true,
    employeeName:syntheticFixture.employeeName,employeeEmail:syntheticFixture.employeeUpn,startDate:'2026-09-21',endDate:'2026-10-18',
    recordDate:'2026-11-16',updatedAt:'2026-11-16T13:00:00.000Z',baseCorrectionExists:false,baseCorrectionUpdatedAt:'',baseOwnerRevision:0,
    importReview:{dates:rows.map(row=>row.date),historyFingerprint:'A'.repeat(43),localRevision:0},
    payload:{employeeName:syntheticFixture.employeeName,employeeEmail:syntheticFixture.employeeUpn,payMonth:'2026-10',
      weekStart:'2026-09-21',weekEnd:'2026-10-18',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',payrollFriday:'2026-10-16',
      rows,deletedDays:[],editedAt:'2026-11-16T13:00:00.000Z',editedBy:editor,
      editNote:`Edited on behalf of ${syntheticFixture.employeeName} by ${editor}.`}};
  assert.equal(validateSyntheticTarget({employeeEmail:syntheticFixture.employeeUpn,dates:rows.map(row=>row.date)}),true);
  assert.equal(validateSyntheticTarget({employeeEmail:syntheticFixture.employeeUpn,employee:syntheticFixture.employeeName,dates:rows.map(row=>row.date)}),true);
  assert.equal(validateSyntheticTarget({employeeEmail:syntheticFixture.employeeUpn,employee:'Another employee',dates:rows.map(row=>row.date)}),false);
  assert.equal(validateSyntheticCorrection(body),true);
  const recovery=structuredClone(body);
  recovery.baseCorrectionExists=true;
  recovery.baseCorrectionUpdatedAt='2026-11-16T12:59:00.000Z';
  recovery.baseOwnerRevision=1;
  delete recovery.importReview;
  assert.equal(validateSyntheticCorrection(recovery),true,'an exact previously saved fictional correction can be recovered');
  assert.equal(validateSyntheticCorrection({...recovery,baseCorrectionUpdatedAt:''}),false);
  assert.equal(validateSyntheticCorrection({...recovery,baseOwnerRevision:0}),false);
  assert.equal(validateSyntheticCorrection({...recovery,payload:{...recovery.payload,employeeName:'Other'}}),false);
  const period=createRequire(import.meta.url)('../pay-periods.js').periodForMonth('2026-10');
  assert.deepEqual([body.startDate,body.endDate,body.payload.payrollFriday],[period.start,period.cycleEnd,period.payrollFriday]);
  const changed = fn => { const value=structuredClone(body); fn(value); return value; };
  for (const invalid of [
    changed(x=>x.payload.rows[0].note='different'), changed(x=>x.payload.rows[1].lunchMinutes=0),
    changed(x=>x.payload.rows[0].sourceEvidence.sourceId='f'.repeat(64)),
    changed(x=>x.payload.rows[0].sourceEvidence.raw='private text'), changed(x=>x.payload.extra='private text'),
    changed(x=>x.payload.rows[0].privateNote='private text'), changed(x=>x.employeeEmail='other@example.test'),
    changed(x=>x.baseCorrectionExists=true), changed(x=>x.payload.deletedDays=['2026-10-04']),
    changed(x=>x.startDate='2026-02-31'), changed(x=>x.payload.editedBy='Other Person'),
    changed(x=>x.startDate='2026-09-22'), changed(x=>x.endDate='2026-10-19'),
    changed(x=>x.recordDate='2026-11-17'),
    changed(x=>x.payload.rows[0].workedMinutes=179), changed(x=>x.payload.rows[1].basicHours=99),
    ...['weekStart','weekEnd','cycleStart','cycleEnd','payrollFriday'].map(key=>changed(x=>x.payload[key]='2026-10-23'))
  ]) assert.equal(validateSyntheticCorrection(invalid),false);
  assert.equal(validateSyntheticTarget({employeeEmail:'other@example.test',dates:rows.map(row=>row.date)}),false);
});
