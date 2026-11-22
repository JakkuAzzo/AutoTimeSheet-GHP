// Build-only candidate for a separate fictional rate test. The original
// synthetic gateway remains pinned to its own fixture; this is not deployable.
import {syntheticFixture as original,validateSyntheticCorrection,validateSyntheticTarget} from './synthetic-portal-fixture.js';

const sourceId='e3ba5c9463a2402c6eba7a2972562ebe941035e250ea155c1b612d756d510a39';
const fileName='GMT-FICTIONAL-PORTAL-RATES.csv';
const rawRows=[
  {Date:46300,Employee:'Nathan Private Synthetic',Start:0.375,Finish:0.5,Break:0,Notes:'Fictional portal rate test A','Basic hours':2,'OT x1.5 hours':1,'O/T 2.0 hours':0},
  {Date:46301,Employee:'Nathan Private Synthetic',Start:0.41666666666666674,Finish:0.5,Break:'',Notes:'Fictional portal rate test B','Basic hours':'','OT x1.5 hours':0,'O/T 2.0 hours':''}
];
const rates=[{claimedBasic:120,claimedOt15:60,claimedOt20:0},{claimedBasic:null,claimedOt15:0,claimedOt20:null}];
export const rateFixture=Object.freeze({...original,fileName,sourceId,rows:Object.freeze(original.rows.map((row,index)=>Object.freeze({...row,note:rawRows[index].Notes})))});
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export async function verifyRateFixtureBytes(bytes){return bytes instanceof Uint8Array && bytes.byteLength>0 && bytes.byteLength<=4096 && await hash(bytes)===sourceId;}
export function validateRateTarget(value){
  if(validateSyntheticTarget(value))return true;
  return exactKeys(value,['employeeEmail','employee','dates']) && value.employeeEmail==='' && value.employee===original.employeeName &&
    Array.isArray(value.dates) && value.dates.length===original.rows.length && value.dates.every((day,index)=>day===original.rows[index].date);
}
export function rateEvidence(index){return {raw:JSON.stringify(rawRows[index]),...rates[index],reviewNote:'',rateEvidenceVersion:1,sourceFile:fileName,sourceId};}
const exact=(value,expected)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===Object.keys(expected).length && Object.keys(expected).every(key=>value[key]===expected[key]);
export function validateRateCorrection(value){
  if(!value?.payload || !Array.isArray(value.payload.rows) || value.payload.rows.length!==2)return false;
  const copy=structuredClone(value);
  for(let i=0;i<2;i++){
    const row=copy.payload.rows[i],note=rawRows[i].Notes;
    const expected=rateEvidence(i), safariRaw=JSON.stringify({...rawRows[i],Date:original.rows[i].date});
    if(!row || row.note!==note || row.description!==note || !row.sourceEvidence)return false;
    if(row.sourceEvidence.raw===safariRaw) row.sourceEvidence.raw=expected.raw;
    if(!exact(row.sourceEvidence,expected))return false;
    row.note=original.rows[i].note;row.description=original.rows[i].note;
    row.sourceEvidence={raw:'',claimedBasic:null,claimedOt15:null,claimedOt20:null,reviewNote:'',sourceFile:original.fileName,sourceId:original.sourceId};
  }
  return validateSyntheticCorrection(copy);
}
const attachmentKeys=['fieldName','fileName','contentType','sizeBytes','contentBase64'];
export async function validateRateAttachments(body,payload){
  if(!payload || payload.testMode!==true || typeof payload.editedAt!=='string' || !validateRateCorrection({recordId:original.recordId,kind:'timesheets',action:'pay_month_correction',status:'Submitted',editMode:true,employeeName:original.employeeName,employeeEmail:original.employeeUpn,startDate:'2026-09-21',endDate:'2026-10-18',recordDate:payload.editedAt.slice(0,10),updatedAt:payload.editedAt,baseCorrectionExists:false,baseCorrectionUpdatedAt:'',baseOwnerRevision:0,importReview:{dates:original.rows.map(row=>row.date),historyFingerprint:'A'.repeat(43),localRevision:0},payload}))return false;
  if(!exactKeys(body,['attachments']) || !Array.isArray(body.attachments) || body.attachments.length!==3)return false;
  const stem='GMT Timesheet - Nathan-Private-Synthetic - Pay Month 2026-10';
  const files={attachment:{name:stem+'.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',hash:'5cc6296ea6f02bcec31c3624c067ae701e7e7f70f15c9a2cd0513e4a68133843'},attachment_csv:{name:stem+'.csv',type:'text/csv',hash:'2d656aabbf86ebe65b1eb4582daff9a2211802cce244529b6017db50e8bf050b'},attachment_record:{name:'GMT Timesheet Record - Nathan-Private-Synthetic - Pay Month 2026-10.json',type:'application/json'}};
  const entries=original.rows.map((row,i)=>({recordId:original.recordId+'|'+row.date,date:row.date,startTime:row.start,finishTime:row.finish,breakMinutes:i===0?0:'',absenceReason:'NA',totalMinutes:i===0?180:120,workedHours:i===0?3:2,note:i===0?rawRows[i].Notes:rawRows[i].Notes+' · Break not recorded; total before any break deduction',changeNote:`Edited by ${payload.editedBy} at ${payload.editedAt}`,sourceBasicMinutes:rates[i].claimedBasic,sourceOt15Minutes:rates[i].claimedOt15,sourceOt20Minutes:rates[i].claimedOt20}));
  const expectedSource=JSON.stringify({schemaVersion:3,mode:'replace-pay-month',recordId:original.recordId,submissionId:original.recordId,employeeName:original.employeeName,employeeEmail:original.employeeUpn,employeeUpn:original.employeeUpn,payMonth:'2026-10',weekStart:'2026-09-21',weekEnd:'2026-10-18',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',payrollFriday:'2026-10-16',submittedAt:payload.editedAt,editedBy:payload.editedBy,deletedDays:[],rows:entries});
  const seen=new Set();
  for(const item of body.attachments){
    if(!exactKeys(item,attachmentKeys)||!Object.hasOwn(files,item.fieldName)||seen.has(item.fieldName))return false;
    seen.add(item.fieldName);const expected=files[item.fieldName],encoded=item.contentBase64;
    if(item.fileName!==expected.name||item.contentType!==expected.type||typeof encoded!=='string'||!encoded.length||encoded.length>30000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))return false;
    let binary;try{binary=atob(encoded)}catch(_){return false}if(btoa(binary)!==encoded||item.sizeBytes!==binary.length)return false;
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    if(expected.hash){if(await hash(bytes)!==expected.hash)return false;}
    else {let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch(_){return false}if(source!==expectedSource)return false;}
  }
  return seen.size===3;
}
function exactKeys(value,keys){return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && Object.keys(value).every(key=>keys.includes(key));}
