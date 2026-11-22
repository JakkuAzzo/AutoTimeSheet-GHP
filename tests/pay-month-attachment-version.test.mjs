import assert from 'node:assert/strict';
import { validatePayMonthAttachmentVersion,queueRecordAttachments } from '../cloudflare-worker/src/index.js';

const record={record_id:'gmt-paymonth-test',owner_upn:'alice@gmt-services.co.uk',payload_json:JSON.stringify({payMonth:'2026-10',editedAt:'2026-11-03T10:00:00.000Z'})};
const historyRow={recordId:record.record_id+'|2026-10-06',date:'2026-10-06',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'Workshop',changeNote:''};
const envelope={schemaVersion:2,mode:'replace-pay-month',recordId:record.record_id,employeeUpn:record.owner_upn,payMonth:'2026-10',submittedAt:'2026-11-03T10:00:00.000Z',rows:[historyRow]};
const attachment=value=>({fieldName:'attachment_record',contentBase64:Buffer.from(JSON.stringify(value)).toString('base64')});
assert.doesNotThrow(()=>validatePayMonthAttachmentVersion(record,[attachment(envelope)]));
for(const change of [{submittedAt:'2026-11-03T09:00:00.000Z'},{recordId:'other'},{employeeUpn:'bob@gmt-services.co.uk'},{payMonth:'2026-11'}]){
  assert.throws(()=>validatePayMonthAttachmentVersion(record,[attachment({...envelope,...change})]),/changed|match|invalid/i);
}
const corrected={...record,payload_json:JSON.stringify({payMonth:'2026-10',editedAt:'2026-11-03T10:00:00.000Z',deletedDays:['2026-10-05']})};
assert.doesNotThrow(()=>validatePayMonthAttachmentVersion(corrected,[attachment({...envelope,deletedDays:['2026-10-05']})]));
for(const deletedDays of [[],['2026-10-06'],['2026-10-05','2026-10-06'],['2026-10-05','2026-10-05']]) {
  assert.throws(()=>validatePayMonthAttachmentVersion(corrected,[attachment({...envelope,deletedDays})]),/match|invalid/i,'deletions must match the saved correction');
}
const savedRow={date:'2026-10-06',start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA',note:'Workshop'};
const saved={...record,payload_json:JSON.stringify({payMonth:'2026-10',editedAt:'2026-11-03T10:00:00.000Z',editedBy:'Alice',rows:[savedRow]})};
const sourceRow={recordId:record.record_id+'|2026-10-06',date:'2026-10-06',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'Workshop',changeNote:'Edited by Alice at 2026-11-03T10:00:00.000Z'};
assert.doesNotThrow(()=>validatePayMonthAttachmentVersion(saved,[attachment({...envelope,rows:[sourceRow]})]));
for(const change of [{startTime:'08:00'},{finishTime:'13:00'},{breakMinutes:30},{absenceReason:'Sick'},{totalMinutes:179},{note:'Changed'},{changeNote:'Edited by another person'},{start:'08:00'}]) {
  assert.throws(()=>validatePayMonthAttachmentVersion(saved,[attachment({...envelope,rows:[{...sourceRow,...change}]})]),/match|invalid/i,'a saved correction must match its delivered row');
}
for(const rows of [[],[sourceRow,sourceRow]])assert.throws(()=>validatePayMonthAttachmentVersion(saved,[attachment({...envelope,rows})]),/match|invalid/i,'saved dates must appear exactly once');
const unknown={...saved,payload_json:JSON.stringify({payMonth:'2026-10',editedAt:'2026-11-03T10:00:00.000Z',editedBy:'Alice',rows:[{...savedRow,breakMinutes:null}]})};
const unknownRow={...sourceRow,breakMinutes:'',note:'Workshop · Break not recorded; total before any break deduction'};
assert.doesNotThrow(()=>validatePayMonthAttachmentVersion(unknown,[attachment({...envelope,rows:[unknownRow]})]),'unknown breaks retain their provisional note');
assert.throws(()=>validatePayMonthAttachmentVersion(unknown,[attachment({...envelope,rows:[{...unknownRow,breakMinutes:0}]})]),/match|invalid/i);
assert.throws(()=>validatePayMonthAttachmentVersion(corrected,[attachment({...envelope,deletedDays:['2026-10-05'],rows:[{...sourceRow,date:'2026-10-05'}]})]),/match|invalid/i,'a deleted day cannot also be delivered');
const rateSaved={...saved,payload_json:JSON.stringify({payMonth:'2026-10',editedAt:'2026-11-03T10:00:00.000Z',editedBy:'Alice',rows:[{...savedRow,sourceEvidence:{rateEvidenceVersion:1,claimedBasic:120,claimedOt15:60,claimedOt20:null}}]})};
const rateSource={...sourceRow,sourceBasicMinutes:120,sourceOt15Minutes:60,sourceOt20Minutes:null};
const v3={...envelope,schemaVersion:3,rows:[rateSource]};
assert.doesNotThrow(()=>validatePayMonthAttachmentVersion(rateSaved,[attachment(v3)]),'the new format binds source rates to the saved correction');
for(const change of [{sourceBasicMinutes:0},{sourceOt15Minutes:null},{sourceOt20Minutes:0},{sourceBasicMinutes:undefined}])assert.throws(()=>validatePayMonthAttachmentVersion(rateSaved,[attachment({...v3,rows:[{...rateSource,...change}]})]),/match|invalid|rate/i,'changed or omitted source figures are rejected');
assert.throws(()=>validatePayMonthAttachmentVersion(rateSaved,[attachment({...envelope,rows:[rateSource]})]),/match|invalid/i,'legacy source cannot silently carry unverified rate evidence');
const queuedRecord={...rateSaved,kind:'timesheets',action:'pay_month_correction'};
const queuedFiles=[{fieldName:'attachment',fileName:'test.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',contentBase64:'eA=='},{fieldName:'attachment_csv',fileName:'test.csv',contentType:'text/csv',contentBase64:'eA=='},{...attachment(v3),fileName:'test.json',contentType:'application/json'}];
assert.throws(()=>queueRecordAttachments({},queuedRecord,{attachments:queuedFiles}),/rate.*not.*ready/i,'new-format delivery is held until the connected flow supports it');
assert.throws(()=>queueRecordAttachments({PAY_MONTH_RATE_DELIVERY_READY:'true'},queuedRecord,{attachments:queuedFiles}),/independent.*review/i,'a configuration switch cannot replace independent source review');
console.log('PASS: pay-month attachment identity and saved revision must match');
