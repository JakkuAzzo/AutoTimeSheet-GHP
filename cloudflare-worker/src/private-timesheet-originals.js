import {verifyPrivateTimesheetParent} from './private-timesheet-access.js';

// Local contract only: a caller must provide authenticated authorisation,
// provider IO and an atomic, revision-bound database binding. No public link
// is created, and a failed/uncertain create is never retried here.
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const id=/^[A-Za-z0-9!_-]{1,256}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const extensions=new Set(['pdf','doc','docx','docm','xls','xlsx','csv','txt','json','png','jpg','jpeg']);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
const day=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
async function verifyAdminVault(context,io,parent,vault){
  verifyPrivateTimesheetParent(context,await io.permissions(parent));
  const metadata=await io.metadata(vault);
  if(!metadata||metadata.id!==vault||!metadata.folder||metadata.file||metadata.remoteItem||metadata.parentReference?.id!==parent)fail('The private source vault needs review.');
  verifyPrivateTimesheetParent(context,await io.permissions(vault),{inheritedFromIds:[parent]});
}

export async function filePrivateTimesheetOriginal(context,request,io){
  const parent=String(context?.parentId||''),vault=String(context?.vaultId||'');
  const recordId=String(request?.recordId||''),employeeOid=String(request?.employeeOid||'').toLowerCase();
  const expected=String(request?.sourceSha256||'').toLowerCase(),name=String(request?.fileName||'');
  const ext=name.split('.').pop().toLowerCase();
  if(!id.test(parent)||!id.test(vault)||parent===vault||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(recordId)||!uuid.test(employeeOid)||
     !/^[a-f0-9]{64}$/.test(expected)||!name||name.length>180||/[\\/\x00-\x1f]/.test(name)||!extensions.has(ext)||
     !(request?.bytes instanceof Uint8Array)||request.bytes.length<1||request.bytes.length>20*1024*1024)fail('The private source document is invalid.',400);
  const bytes=new Uint8Array(request.bytes);
  if(await digest(bytes)!==expected)fail('The private source bytes do not match the reviewed file.');
  if(!io || ['authorize','metadata','permissions','findChild','createExclusive','read','bind'].some(key=>typeof io[key]!=='function'))fail('Private source filing is not configured.',503);
  const binding=await io.authorize({recordId,employeeOid,sourceSha256:expected});
  if(!binding || binding.recordId!==recordId || String(binding.employeeOid||'').toLowerCase()!==employeeOid || binding.sourceSha256!==expected ||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(String(binding.reviewId||'')) || !Number.isSafeInteger(binding.recordRevision) || binding.recordRevision<0 ||
     !Array.isArray(binding.dates) || !binding.dates.length || binding.dates.length>62 || !binding.dates.every(day) || new Set(binding.dates).size!==binding.dates.length)fail('The source review is no longer authorised.');
  const safeBinding={recordId,employeeOid,sourceSha256:expected,reviewId:binding.reviewId,recordRevision:binding.recordRevision,dates:binding.dates.slice().sort()};
  const verifyVault=()=>verifyAdminVault(context,io,parent,vault);
  const fileName=expected+'.'+ext;
  const verifyItem=async item=>{
    if(!item || !id.test(String(item.id||'')) || item.name!==fileName || !item.file || item.folder || item.remoteItem || item.parentReference?.id!==vault ||
       !Number.isSafeInteger(item.size) || item.size!==bytes.length || typeof item.eTag!=='string' || !item.eTag || item.eTag.length>512)fail('The private source file needs review.');
    verifyPrivateTimesheetParent(context,await io.permissions(item.id),{inheritedFromIds:[parent,vault]});
  };
  await verifyVault();
  let item=await io.findChild(vault,fileName);
  if(!item){
    // An exception or missing result may mean creation landed; do not retry.
    const created=await io.createExclusive(vault,fileName,bytes);
    if(!created?.id)fail('Private source creation has an uncertain outcome.');
    item=await io.findChild(vault,fileName);
    if(!item || item.id!==created.id)fail('Private source creation needs reconciliation.');
  }
  await verifyItem(item);
  const checkedVersion=item.eTag,stored=await io.read(item.id);
  if(!(stored instanceof Uint8Array) || stored.length!==bytes.length || await digest(stored)!==expected)fail('The private source readback does not match.');
  const after=await io.metadata(item.id),found=await io.findChild(vault,fileName);
  await verifyItem(after);
  if(after.eTag!==checkedVersion || !found || found.id!==item.id || found.eTag!==checkedVersion)fail('The private source changed during verification.');
  await verifyVault();
  // Filing is not independent source review or confirmation of its contents.
  const proof={...safeBinding,itemId:item.id,vaultId:vault,eTag:checkedVersion,fileName,reviewState:'pending'};
  // The implementation must atomically recheck review and record revisions.
  if(await io.bind(proof)!==true)fail('The source review changed before filing completed.');
  return proof;
}

// Server-side callers must first authorise the current actor and retrieve an
// active proof. This rechecks a provider object; it does not approve a source.
export async function verifyPrivateTimesheetOriginal(context,proof,io){
  const parent=String(context?.parentId||''),vault=String(context?.vaultId||''),itemId=String(proof?.itemId||''),expected=String(proof?.sourceSha256||'');
  const name=String(proof?.fileName||''),version=String(proof?.eTag||'');
  if(!id.test(parent)||!id.test(vault)||parent===vault||!id.test(itemId)||proof?.vaultId!==vault||!/^[a-f0-9]{64}$/.test(expected)||
     !new RegExp('^'+expected+'\\.(?:pdf|doc|docx|docm|xls|xlsx|csv|txt|json|png|jpg|jpeg)$').test(name)||!version||version.length>512||/[\x00-\x1f]/.test(version)||proof?.reviewState!=='pending')fail('The private source proof is invalid.',400);
  if(!io || ['metadata','permissions','findChild','read'].some(key=>typeof io[key]!=='function'))fail('Private source verification is not configured.',503);
  const checkItem=async item=>{
    if(!item||item.id!==itemId||item.name!==name||!item.file||item.folder||item.remoteItem||item.parentReference?.id!==vault||item.eTag!==version||
       !Number.isSafeInteger(item.size)||item.size<1||item.size>20*1024*1024)fail('The private source file needs review.');
    verifyPrivateTimesheetParent(context,await io.permissions(itemId),{inheritedFromIds:[parent,vault]});
  };
  await verifyAdminVault(context,io,parent,vault);
  const before=await io.metadata(itemId),found=await io.findChild(vault,name);
  await checkItem(before);
  if(!found||found.id!==itemId||found.eTag!==version)fail('The private source file needs review.');
  const bytes=await io.read(itemId);
  if(!(bytes instanceof Uint8Array)||bytes.length!==before.size||await digest(bytes)!==expected)fail('The private source readback does not match.');
  const after=await io.metadata(itemId),foundAgain=await io.findChild(vault,name);
  await checkItem(after);
  if(!foundAgain||foundAgain.id!==itemId||foundAgain.eTag!==version)fail('The private source changed during verification.');
  await verifyAdminVault(context,io,parent,vault);
  return {itemId,vaultId:vault,eTag:version,sourceSha256:expected,reviewState:'pending'};
}
