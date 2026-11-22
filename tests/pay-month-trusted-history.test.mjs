import test from 'node:test';
import assert from 'node:assert/strict';
import * as worker from '../cloudflare-worker/src/index.js';

const period={start:'2026-09-21',cycleEnd:'2026-10-18'};
const subject={oid:'alice-oid',upn:'alice@example.test'};
const entry=(id,action,updated,payload,extra={})=>({record_id:id,owner_oid:'alice-oid',owner_upn:'alice@example.test',kind:'timesheets',action,status:'Submitted',updated_at:updated,payload_json:JSON.stringify(payload),...extra});
const older=entry('old','submission','2026-10-01T00:00:00Z',{rows:[{date:'2026-10-05',start:'09:00'},{date:'2026-10-07',start:'09:00'},{date:'2026-11-01',start:'08:00'}]});
const corrected=entry('prior','pay_month_correction','2026-10-03T00:00:00Z',{rows:[{date:'2026-10-05',start:'10:00'}],deletedDays:['2026-10-07']});

test('server selects the most authoritative day and honours earlier corrections and deletions',()=>{
  assert.equal(typeof worker.selectTrustedPayMonthHistory,'function','server history selection must exist');
  const rows=worker.selectTrustedPayMonthHistory([older,corrected],subject,period);
  assert.deepEqual(rows,[{date:'2026-10-05',start:'10:00'}]);
});
test('identity conflicts, duplicate sources, and ambiguous equal-priority rows are held',()=>{
  assert.equal(typeof worker.selectTrustedPayMonthHistory,'function','server history selection must exist');
  const conflict=entry('wrong','submission','2026-10-04T00:00:00Z',{rows:[{date:'2026-10-05'}]},{owner_oid:'other'});
  const tied=entry('tied','submission','2026-10-01T00:00:00Z',{rows:[{date:'2026-10-05',start:'07:00'}]});
  for(const records of [[older,conflict],[older,older],[older,tied]])
    assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review|history.*invalid/i);
});
test('different submission times do not resolve conflicting ordinary source days',()=>{
  const earlier=entry('source-a','submission','2026-10-01T10:00:00Z',{rows:[{date:'2026-10-05',start:'08:00',finish:'17:00',lunchMinutes:60}]});
  const later=entry('source-b','submission','2026-10-01T11:00:00Z',{rows:[{date:'2026-10-05',start:'08:00',finish:'18:00',lunchMinutes:60}]});
  for(const records of [[earlier,later],[later,earlier]])assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review/i);
  const latestCopy=entry('source-c','submission','2026-10-01T12:00:00Z',{rows:[{date:'2026-10-05',start:'08:00',finish:'18:00',lunchMinutes:60}]});
  for(const records of [[earlier,later,latestCopy],[latestCopy,earlier,later]])assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review/i);
  const correction=entry('correction','pay_month_correction','2026-10-02T00:00:00Z',{rows:[{date:'2026-10-05',start:'08:00',finish:'18:00',lunchMinutes:60}]});
  for(const records of [[earlier,later,correction],[correction,later,earlier]])assert.deepEqual(worker.selectTrustedPayMonthHistory(records,subject,period),[{date:'2026-10-05',start:'08:00',finish:'18:00',lunchMinutes:60}]);
});
test('source rate disagreements are not hidden by matching clock totals',()=>{
  const day={date:'2026-10-05',start:'08:00',finish:'17:00',lunchMinutes:60};
  const first=entry('rate-a','submission','2026-10-01T10:00:00Z',{rows:[{...day,sourceEvidence:{rateEvidenceVersion:1,claimedBasic:480,claimedOt15:0,claimedOt20:null}}]});
  const other=entry('rate-b','submission','2026-10-01T11:00:00Z',{rows:[{...day,sourceEvidence:{rateEvidenceVersion:1,claimedBasic:420,claimedOt15:60,claimedOt20:null}}]});
  for(const records of [[first,other],[other,first]])assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review/i);
});
test('a correction cannot silently discard or change source-reported rates',()=>{
  const rates={rateEvidenceVersion:1,claimedBasic:480,claimedOt15:60,claimedOt20:null};
  const ordinary=entry('rate-original','submission','2026-10-01T10:00:00Z',{rows:[{date:'2026-10-05',start:'08:00',finish:'18:00',breakMinutes:60,sourceEvidence:rates}]});
  const correction=(id,evidence)=>entry(id,'pay_month_correction','2026-10-02T10:00:00Z',{rows:[{date:'2026-10-05',start:'08:00',finish:'18:00',breakMinutes:30,...(evidence?{sourceEvidence:evidence}:{})}]});
  for(const changed of [correction('missing'),correction('changed',{...rates,claimedOt15:0})])for(const records of [[ordinary,changed],[changed,ordinary]])assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review/i);
  const preserved=correction('preserved',rates);
  for(const records of [[ordinary,preserved],[preserved,ordinary]])assert.equal(worker.selectTrustedPayMonthHistory(records,subject,period)[0].sourceEvidence.claimedOt15,60);
});
test('a source payload cannot resolve a conflict by labelling itself authoritative or another source a variant',()=>{
  const normal=entry('normal','submission','2026-10-01T10:00:00Z',{rows:[{date:'2026-10-05',start:'08:00',finish:'17:00',lunchMinutes:60}]});
  for (const status of ['authoritative','source-variant']) {
    const labelled=entry('labelled','submission','2026-10-01T11:00:00Z',{reconciliation:{status},rows:[{date:'2026-10-05',start:'08:00',finish:'18:00',lunchMinutes:60}]});
    for(const records of [[normal,labelled],[labelled,normal]]) assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review/i);
  }
});
test('unsupported or unidentifiable source data is not silently dropped',()=>{
  assert.equal(typeof worker.selectTrustedPayMonthHistory,'function','server history selection must exist');
  const nested=entry('nested','submission','2026-10-01',{data:{rows:[{date:'2026-10-06'}]}});
  const undated=entry('undated','submission','2026-10-01',{rows:[{start:'08:00'}]});
  const empty=entry('empty','submission','2026-10-01',{rows:[]});
  for(const records of [[nested],[undated],[empty]])assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review|history.*invalid/i);
});

test('a later correction can restore a day deleted by an earlier correction',()=>{
  const restored=entry('restored','pay_month_correction','2026-10-04T00:00:00Z',{rows:[{date:'2026-10-07',start:'11:00'}],deletedDays:[]});
  for(const records of [[older,corrected,restored],[restored,corrected,older]]){
    const rows=worker.selectTrustedPayMonthHistory(records,subject,period);
    assert.deepEqual(rows,[{date:'2026-10-05',start:'10:00'},{date:'2026-10-07',start:'11:00'}]);
  }
});
test('a later deletion removes a day restored by an earlier correction',()=>{
  const restored=entry('restored','pay_month_correction','2026-10-02T00:00:00Z',{rows:[{date:'2026-10-07',start:'11:00'}],deletedDays:[]});
  assert.deepEqual(worker.selectTrustedPayMonthHistory([older,corrected,restored],subject,period),[{date:'2026-10-05',start:'10:00'}]);
});
test('an equally timed deletion and correction of the same day is held for review',()=>{
  const tied=entry('restored','pay_month_correction','2026-10-03T00:00:00Z',{rows:[{date:'2026-10-07',start:'11:00'}],deletedDays:[]});
  for(const records of [[corrected,tied],[tied,corrected]])assert.throws(()=>worker.selectTrustedPayMonthHistory(records,subject,period),/history.*review/i);
});
test('an unambiguous later correction supersedes an older tied conflict regardless of input order',()=>{
  const tied=entry('tied','pay_month_correction','2026-10-03T00:00:00Z',{rows:[{date:'2026-10-07',start:'10:00'}],deletedDays:[]});
  const later=entry('later','pay_month_correction','2026-10-04T00:00:00Z',{rows:[{date:'2026-10-07',start:'11:00'}],deletedDays:[]});
  for(const records of [[corrected,tied,later],[later,tied,corrected]])assert.deepEqual(worker.selectTrustedPayMonthHistory(records,subject,period),[{date:'2026-10-05',start:'10:00'},{date:'2026-10-07',start:'11:00'}]);
});
test('a correction cannot both delete and restore the same day in one record',()=>{
  const contradictory=entry('contradictory','pay_month_correction','2026-10-04T00:00:00Z',{rows:[{date:'2026-10-07',start:'11:00'}],deletedDays:['2026-10-07']});
  assert.throws(()=>worker.selectTrustedPayMonthHistory([contradictory],subject,period),/history.*review/i);
});
