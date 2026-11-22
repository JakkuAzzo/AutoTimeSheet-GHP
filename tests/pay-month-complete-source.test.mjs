import test from 'node:test';
import assert from 'node:assert/strict';
import * as worker from '../cloudflare-worker/src/index.js';

const record={record_id:'correction',owner_upn:'alice@example.test',payload_json:JSON.stringify({
  payMonth:'2026-10',editedAt:'2026-11-03T10:00:00Z',editedBy:'Alice',
  rows:[{date:'2026-10-06',start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA',note:'Workshop'}],
  deletedDays:['2026-10-07']
})};
const history=[{date:'2026-10-05',start:'10:00',finish:'12:00',breakMinutes:null,absence:'NA',note:'Site'},
  {date:'2026-10-06',start:'08:00',finish:'12:00',breakMinutes:0,absence:'NA',note:'Earlier'},
  {date:'2026-10-07',start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA',note:'Removed'}];
const period={start:'2026-09-21',cycleEnd:'2026-10-18'};
const source={schemaVersion:2,mode:'replace-pay-month',recordId:'correction',employeeUpn:'alice@example.test',payMonth:'2026-10',submittedAt:'2026-11-03T10:00:00Z',cycleStart:period.start,cycleEnd:period.cycleEnd,deletedDays:['2026-10-07'],rows:[
  {recordId:'correction|2026-10-05',date:'2026-10-05',startTime:'10:00',finishTime:'12:00',breakMinutes:'',absenceReason:'NA',totalMinutes:120,workedHours:2,note:'Site · Break not recorded; total before any break deduction',changeNote:''},
  {recordId:'correction|2026-10-06',date:'2026-10-06',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'Workshop',changeNote:'Edited by Alice at 2026-11-03T10:00:00Z'}
]};
const attachment=data=>[{fieldName:'attachment_record',contentBase64:Buffer.from(JSON.stringify(data)).toString('base64')}];

test('an empty replacement is rejected before it can enter the delivery queue',()=>{
  const emptyRecord={...record,payload_json:JSON.stringify({...JSON.parse(record.payload_json),rows:[],deletedDays:[]})};
  assert.throws(()=>worker.validatePayMonthAttachmentVersion(emptyRecord,attachment({...source,rows:[],deletedDays:[]})),/workbook|saved timesheet/i);
});

test('complete source matches the independently selected history and saved corrections',()=>{
  assert.equal(typeof worker.validateCompletePayMonthSource,'function','the complete source validator must exist');
  assert.doesNotThrow(()=>worker.validateCompletePayMonthSource(record,history,attachment(source),period));
});
test('complete source binds source-rate evidence for historical and corrected days',()=>{
  const rateHistory=history.map((row,index)=>index===0?{...row,sourceEvidence:{rateEvidenceVersion:1,claimedBasic:60,claimedOt15:60,claimedOt20:null}}:row);
  const payload=JSON.parse(record.payload_json);
  payload.rows[0].sourceEvidence={rateEvidenceVersion:1,claimedBasic:180,claimedOt15:0,claimedOt20:null};
  const rateRecord={...record,payload_json:JSON.stringify(payload)};
  const rateSource={...source,schemaVersion:3,rows:[{...source.rows[0],sourceBasicMinutes:60,sourceOt15Minutes:60,sourceOt20Minutes:null},{...source.rows[1],sourceBasicMinutes:180,sourceOt15Minutes:0,sourceOt20Minutes:null}]};
  assert.doesNotThrow(()=>worker.validateCompletePayMonthSource(rateRecord,rateHistory,attachment(rateSource),period));
  for(const change of [{sourceBasicMinutes:61},{sourceOt15Minutes:null},{sourceOt20Minutes:0},{sourceOt20Minutes:undefined}]){
    const rows=[{...rateSource.rows[0],...change},rateSource.rows[1]];
    assert.throws(()=>worker.validateCompletePayMonthSource(rateRecord,rateHistory,attachment({...rateSource,rows}),period),/match|invalid|rate/i);
  }
  const extra={...rateSource.rows[0],recordId:'correction|2026-10-08',date:'2026-10-08'};
  assert.doesNotThrow(()=>worker.validateKnownPayMonthSource(rateRecord,rateHistory,attachment({...rateSource,rows:[...rateSource.rows,extra]}),period));
  assert.throws(()=>worker.validateKnownPayMonthSource(rateRecord,rateHistory,attachment({...rateSource,rows:[...rateSource.rows,{...extra,sourceOt20Minutes:undefined}]}),period),/match|invalid|rate/i,'additional unreviewed rows still require a complete rate shape');
});
test('known local history must match while additional external days remain subject to separate review',()=>{
  const extra={...source.rows[0],recordId:'correction|2026-10-08',date:'2026-10-08'};
  assert.doesNotThrow(()=>worker.validateKnownPayMonthSource(record,history,attachment({...source,rows:[...source.rows,extra]}),period));
  for(const rows of [[source.rows[1]],[{...source.rows[0],startTime:'08:00'},source.rows[1]],
    [{...source.rows[0],note:'Different'},source.rows[1]]])
    assert.throws(()=>worker.validateKnownPayMonthSource(record,history,attachment({...source,rows}),period),/match|invalid/i);
});
test('a missing, added, altered, or resurrected historical day is rejected',()=>{
  assert.equal(typeof worker.validateCompletePayMonthSource,'function','the complete source validator must exist');
  const first=source.rows[0];
  for(const rows of [[source.rows[1]],[...source.rows,{...first,date:'2026-10-08',recordId:'correction|2026-10-08'}],
    [{...first,startTime:'08:00'},source.rows[1]],[{...first,breakMinutes:0},source.rows[1]],
    [{...first,note:'Other'},source.rows[1]],[...source.rows,{...first,date:'2026-10-07',recordId:'correction|2026-10-07'}]]) {
    assert.throws(()=>worker.validateCompletePayMonthSource(record,history,attachment({...source,rows}),period),/match|invalid/i);
  }
});
test('unavailable, duplicate or out-of-cycle history cannot be treated as a complete snapshot',()=>{
  assert.equal(typeof worker.validateCompletePayMonthSource,'function','the complete source validator must exist');
  for(const rows of [null,[history[0],history[0]],[...history,{date:'2026-08-01',start:'09:00'}]])
    assert.throws(()=>worker.validateCompletePayMonthSource(record,rows,attachment(source),period),/match|invalid/i);
});
