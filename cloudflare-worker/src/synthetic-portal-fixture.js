// This schema is for one explicitly fictional portal exercise. It is not an
// employee identity resolver and must never be used by the production route.
const employeeUpn='nathanbrown-bennett@gmt-services.co.uk';
const employeeName='Nathan Private Synthetic';
const rows=Object.freeze([
  Object.freeze({date:'2026-10-05',start:'09:00',finish:'12:00',lunchMinutes:0,absenceStatus:'NA',note:'Fictional portal test A'}),
  Object.freeze({date:'2026-10-06',start:'10:00',finish:'12:00',lunchMinutes:null,absenceStatus:'NA',note:'Fictional portal test B'})
]);
const recordId='gmt-paymonth-2026-10-'+Array.from(new TextEncoder().encode(employeeUpn), value=>value.toString(16).padStart(2,'0')).join('');
const period=Object.freeze({start:'2026-09-21',end:'2026-10-18',payrollFriday:'2026-10-16'});
export const syntheticFixture=Object.freeze({employeeUpn,employeeName,recordId,rows,
  fileName:'GMT-FICTIONAL-PORTAL-UPLOAD.json',sourceId:'0cf90b548d91ddc025e34db539bf98aab6c6e6d649476d075437ab5589cc514c'});

export async function verifySyntheticFixtureBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength===0 || bytes.byteLength>4096) return false;
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hex=Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
  return hex===syntheticFixture.sourceId;
}

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const keysOnly=(value,allowed)=>object(value) && Object.keys(value).every(key=>allowed.includes(key));
const datesMatch=value=>Array.isArray(value) && value.length===rows.length &&
  value.every((date,index)=>date===rows[index].date);
const date=value=>typeof value==='string' && /^2026-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string' && /^2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString()===value;
const editors=new Set(['Nathan Brown-Bennett','Amanda Brown-Bennett',employeeUpn,'Amanda.BB@GMTElectServsLtd.onmicrosoft.com']);

export function validateSyntheticTarget(value) {
  return keysOnly(value,['employeeEmail','employee','dates']) && value.employeeEmail===employeeUpn &&
    (value.employee===undefined || value.employee===employeeName) && datesMatch(value.dates);
}

export function validateSyntheticCorrection(value) {
  if (!keysOnly(value,['recordId','kind','action','status','editMode','employeeName','employeeEmail','startDate','endDate','recordDate','updatedAt',
    'baseCorrectionExists','baseCorrectionUpdatedAt','baseOwnerRevision','importReview','payload']) ||
    value.recordId!==recordId || value.kind!=='timesheets' || value.action!=='pay_month_correction' || value.status!=='Submitted' ||
    value.editMode!==true || value.employeeName!==employeeName || value.employeeEmail!==employeeUpn ||
    value.startDate!==period.start || value.endDate!==period.end || !date(value.recordDate) || !timestamp(value.updatedAt) || value.recordDate!==value.updatedAt.slice(0,10)) return false;
  const review=value.importReview;
  if (value.baseCorrectionExists===false) {
    if (value.baseCorrectionUpdatedAt!=='' || value.baseOwnerRevision!==0 ||
      !keysOnly(review,['dates','historyFingerprint','localRevision']) || !datesMatch(review.dates) ||
      typeof review.historyFingerprint!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(review.historyFingerprint) || review.localRevision!==0) return false;
  } else if (value.baseCorrectionExists===true) {
    if (!timestamp(value.baseCorrectionUpdatedAt) || value.baseCorrectionUpdatedAt>=value.updatedAt ||
      !Number.isSafeInteger(value.baseOwnerRevision) || value.baseOwnerRevision<1 || review!==undefined) return false;
  } else return false;
  const p=value.payload;
  if (!keysOnly(p,['employeeName','employeeEmail','payMonth','weekStart','weekEnd','cycleStart','cycleEnd','payrollFriday','rows','deletedDays','editedAt','editedBy','editNote','testMode']) ||
    p.employeeName!==employeeName || p.employeeEmail!==employeeUpn || p.payMonth!=='2026-10' ||
    p.weekStart!==period.start || p.weekEnd!==period.end || p.cycleStart!==period.start || p.cycleEnd!==period.end || p.payrollFriday!==period.payrollFriday ||
    !timestamp(p.editedAt) || p.editedAt!==value.updatedAt || !editors.has(p.editedBy) ||
    p.editNote!==`Edited on behalf of ${employeeName} by ${p.editedBy}.` ||
    (p.testMode!==undefined && p.testMode!==true) || !Array.isArray(p.deletedDays) || p.deletedDays.length || !Array.isArray(p.rows) || p.rows.length!==rows.length) return false;
  return p.rows.every((row,index)=>{
    const expected=rows[index];
    if (!keysOnly(row,['date','start','finish','lunchMinutes','absenceStatus','note','description','lunchHad',
      'workedMinutes','workedHours','basicHours','ot15Hours','ot20Hours','weightedHours','sourceEvidence']) ||
      !Object.keys(expected).every(key=>row[key]===expected[key]) || row.description!==expected.note ||
      row.lunchHad!==(expected.lunchMinutes===null?null:false)) return false;
    const hours=index===0?3:2;
    if (row.basicHours!==hours || row.weightedHours!==hours || row.ot15Hours!==0 || row.ot20Hours!==0 ||
        (index===0 ? row.workedMinutes!==180 || row.workedHours!==3 : row.workedMinutes!=null || row.workedHours!=null)) return false;
    const e=row.sourceEvidence;
    return keysOnly(e,['raw','claimedBasic','claimedOt15','claimedOt20','reviewNote','sourceFile','sourceId']) &&
      e.raw==='' && e.claimedBasic===null && e.claimedOt15===null && e.claimedOt20===null && e.reviewNote==='' &&
      e.sourceFile===syntheticFixture.fileName && e.sourceId===syntheticFixture.sourceId;
  });
}

// The test queue must never accept arbitrary attachments merely because a
// client labels a record fictional. This intentionally accepts one exact
// workbook and its matching source, not a general-purpose workbook format.
export async function validateSyntheticAttachments(body,payload) {
  if (!payload || payload.testMode!==true || !timestamp(payload.editedAt) ||
      !validateSyntheticCorrection({recordId,kind:'timesheets',action:'pay_month_correction',status:'Submitted',editMode:true,
        employeeName,employeeEmail:employeeUpn,startDate:period.start,endDate:period.end,recordDate:payload.editedAt.slice(0,10),
        updatedAt:payload.editedAt,baseCorrectionExists:false,baseCorrectionUpdatedAt:'',baseOwnerRevision:0,
        importReview:{dates:rows.map(row=>row.date),historyFingerprint:'A'.repeat(43),localRevision:0},payload})) return false;
  if (!keysOnly(body,['attachments']) || !Array.isArray(body.attachments) || body.attachments.length!==3) return false;
  const stem='GMT Timesheet - Nathan-Private-Synthetic - Pay Month 2026-10';
  const expectedFiles={
    attachment:{name:stem+'.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',hash:'c70b75aa71cad92977fbcd933e1e3a33b22b80c4eaeb3498e8d4f55a73554101'},
    attachment_csv:{name:stem+'.csv',type:'text/csv',hash:'da0523afa4ad6ed3e4a08a39fbe84f9c338463a8ed6053b766614e2028ac3801'},
    attachment_record:{name:'GMT Timesheet Record - Nathan-Private-Synthetic - Pay Month 2026-10.json',type:'application/json'}
  };
  const entries=rows.map((row,index)=>({recordId:recordId+'|'+row.date,date:row.date,startTime:row.start,finishTime:row.finish,
    breakMinutes:index===0?0:'',absenceReason:'NA',totalMinutes:index===0?180:120,workedHours:index===0?3:2,
    note:index===0?row.note:row.note+' · Break not recorded; total before any break deduction',
    changeNote:`Edited by ${payload.editedBy} at ${payload.editedAt}`}));
  const expectedSource=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId,submissionId:recordId,employeeName,
    employeeEmail:employeeUpn,employeeUpn,payMonth:'2026-10',weekStart:period.start,weekEnd:period.end,cycleStart:period.start,
    cycleEnd:period.end,payrollFriday:period.payrollFriday,submittedAt:payload.editedAt,editedBy:payload.editedBy,deletedDays:[],rows:entries});
  const seen=new Set();
  for (const item of body.attachments) {
    if (!keysOnly(item,['fieldName','fileName','contentType','sizeBytes','contentBase64']) ||
        !Object.hasOwn(expectedFiles,item.fieldName) || seen.has(item.fieldName)) return false;
    seen.add(item.fieldName);
    const expected=expectedFiles[item.fieldName],encoded=item.contentBase64;
    if (item.fileName!==expected.name || item.contentType!==expected.type || typeof encoded!=='string' ||
        encoded.length===0 || encoded.length>30000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
    let binary;
    try { binary=atob(encoded); } catch (_) { return false; }
    if (btoa(binary)!==encoded || item.sizeBytes!==binary.length) return false;
    const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
    if (expected.hash) {
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
      if (Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('')!==expected.hash) return false;
    } else {
      let source; try { source=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch (_) { return false; }
      if (source!==expectedSource) return false;
    }
  }
  return seen.size===3;
}
