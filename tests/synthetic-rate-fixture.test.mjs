import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rateFixture,verifyRateFixtureBytes,validateRateTarget,validateRateCorrection,validateRateAttachments} from '../cloudflare-worker/src/synthetic-rate-fixture.js';
import {syntheticRateExample} from './helpers/synthetic-rate-attachments.mjs';

test('rate fixture accepts only the prepared fictional source, correction and three matching attachments',async()=>{
  const bytes=readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv');
  assert.equal(await verifyRateFixtureBytes(new Uint8Array(bytes)),true);
  const changedBytes=Uint8Array.from(bytes);changedBytes[20]^=1;
  assert.equal(await verifyRateFixtureBytes(changedBytes),false);
  const {correction,body}=syntheticRateExample();
  assert.equal(validateRateTarget({employeeEmail:'',employee:rateFixture.employeeName,dates:rateFixture.rows.map(row=>row.date)}),true);
  assert.equal(validateRateTarget({employeeEmail:'',employee:'Other',dates:rateFixture.rows.map(row=>row.date)}),false);
  assert.equal(validateRateTarget({employeeEmail:'',employee:rateFixture.employeeName,dates:rateFixture.rows.map(row=>row.date),extra:'private'}),false);
  assert.equal(validateRateCorrection(correction),true);
  assert.equal(await validateRateAttachments(body,correction.payload),true);
  const safari=structuredClone(correction);
  for (let i=0;i<2;i++) { const raw=JSON.parse(safari.payload.rows[i].sourceEvidence.raw); raw.Date=rateFixture.rows[i].date; safari.payload.rows[i].sourceEvidence.raw=JSON.stringify(raw); }
  assert.equal(validateRateCorrection(safari),true,'accept the same pinned CSV dates as ISO strings in WebKit');
  assert.equal(await validateRateAttachments(body,safari.payload),true);
  const alteredSafari=structuredClone(safari);const alteredRaw=JSON.parse(alteredSafari.payload.rows[0].sourceEvidence.raw);alteredRaw.Date='2026-10-07';alteredSafari.payload.rows[0].sourceEvidence.raw=JSON.stringify(alteredRaw);
  assert.equal(validateRateCorrection(alteredSafari),false,'a different date is not the fixture');
  for(const change of [
    c=>c.payload.rows[0].sourceEvidence.claimedOt15=0,
    c=>c.payload.rows[1].sourceEvidence.claimedBasic=0,
    c=>c.payload.rows[0].sourceEvidence.raw='other data',
    c=>c.payload.rows[0].note='other data',
    c=>c.employeeEmail='other@example.test',
    c=>c.payload.extra='other data'
  ]){const value=structuredClone(correction);change(value);assert.equal(validateRateCorrection(value),false)}
  const flip=(b,index)=>{const bytes=Buffer.from(b.attachments[index].contentBase64,'base64');bytes[10]^=1;b.attachments[index].contentBase64=bytes.toString('base64')};
  for(const change of [b=>b.attachments.pop(),b=>b.attachments.push(b.attachments[0]),b=>b.attachments[0].contentBase64=Buffer.from('other').toString('base64'),b=>flip(b,0),b=>flip(b,1),b=>flip(b,2),b=>b.attachments[1].fileName='other.csv',b=>b.attachments[2].contentBase64=Buffer.from('{}').toString('base64'),b=>b.attachments[0].sizeBytes++,b=>b.attachments[0].privateText='other',b=>b.extra='other']){const value=structuredClone(body);change(value);assert.equal(await validateRateAttachments(value,correction.payload),false)}
  assert.notEqual(rateFixture.sourceId,'0cf90b548d91ddc025e34db539bf98aab6c6e6d649476d075437ab5589cc514c');
});
