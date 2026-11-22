// Internal read-only composition. The caller must authenticate and authorize
// the actor, provide a Graph client bound to this exact drive, verify complete
// permissions, and fence provider writes; no public route calls this module.
import {createPrivateOriginalGraphIo} from './private-timesheet-original-graph.js';
import {verifyWorkerWorkbookReadback} from './timesheet-workbook-readback.js';
import {verifyPrivateCandidatePermissionListing} from './private-timesheet-access.js';

async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
function canonicalPermissions(value){
 let count=0;
 const visit=(input,depth)=>{
  if(++count>20000||depth>12)throw new Error('Workbook permissions cannot be verified');
  if(input===null||typeof input==='boolean'||typeof input==='string'||(typeof input==='number'&&Number.isFinite(input)))return JSON.stringify(input);
  if(Array.isArray(input))return '['+input.map(item=>visit(item,depth+1)).sort().join(',')+']';
  if(!input||typeof input!=='object')throw new Error('Workbook permissions cannot be verified');
  return '{'+Object.keys(input).sort().map(key=>JSON.stringify(key)+':'+visit(input[key],depth+1)).join(',')+'}';
 };
 return visit(value,0);
}

export async function verifyGraphWorkbookReadback(expected,{siteHost,driveId,graphRequest,downloadRequest}={}){
 if(typeof driveId!=='string'||!/^[A-Za-z0-9!_-]{1,256}$/.test(driveId)||expected?.driveId!==driveId)throw new Error('Workbook drive cannot be verified');
 const io=createPrivateOriginalGraphIo({siteHost,graphRequest,uploadRequest:downloadRequest,readLimit:1024*1024});
 return verifyWorkerWorkbookReadback(expected,{
  metadata:async(drive,item)=>{if(drive!==driveId)throw new Error('Workbook drive cannot be verified');return io.metadata(item);},
  content:async(drive,item)=>{if(drive!==driveId)throw new Error('Workbook drive cannot be verified');return io.read(item);}
 });
}

// Binds the returned permission listing to the content read. This does not
// establish effective access or exclude indirect group/admin access by the
// staging writer; no real delivery may treat it as a provider-side fence.
export async function verifyPrivateGraphWorkbookReadback(expected,policy,options={}){
 let source;try{source=JSON.parse(expected?.recordJson);}catch(_){throw new Error('Workbook source cannot be verified');}
 const upn=String(policy?.employeeUpn||'').trim().toLowerCase();
 const claims=[source?.employeeUpn,source?.employeeEmail].filter(value=>value!==undefined&&value!==null&&value!=='');
 if(!upn||!claims.length||claims.some(value=>typeof value!=='string'||value.trim().toLowerCase()!==upn))throw new Error('Workbook employee cannot be verified');
 if(expected?.driveId!==options.driveId)throw new Error('Workbook drive cannot be verified');
 const io=createPrivateOriginalGraphIo({siteHost:options.siteHost,graphRequest:options.graphRequest,uploadRequest:options.downloadRequest,readLimit:1024*1024});
 const before=await io.permissions(expected.itemId);verifyPrivateCandidatePermissionListing(policy,before);
 const permissionSnapshotHash=await digest(canonicalPermissions(before));
 const verified=await verifyGraphWorkbookReadback(expected,options);
 const after=await io.permissions(expected.itemId);verifyPrivateCandidatePermissionListing(policy,after);
 if(await digest(canonicalPermissions(after))!==permissionSnapshotHash)throw new Error('Workbook permissions changed during verification');
 const final=await io.metadata(expected.itemId);
 if(final?.id!==expected.itemId||final?.name!==expected.fileName||final?.eTag!==expected.eTag||
    final?.parentReference?.driveId!==expected.driveId||final?.parentReference?.id!==expected.parentId||
    final?.file?.mimeType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||final?.folder||final?.remoteItem||
    !Number.isSafeInteger(final?.size)||final.size!==verified.contentBytes)throw new Error('Workbook changed during permission verification');
 const tuple=['gmt-timesheet-private-readback-v1',verified.verificationDigest,permissionSnapshotHash,
  String(policy.adminGroupId).toLowerCase(),String(policy.employeeId).toLowerCase(),upn,String(policy.siteOwnerGroupId).toLowerCase(),String(policy.stagingWriterId).toLowerCase()];
 return {...verified,permissionSnapshotHash,verificationDigest:await digest(JSON.stringify(tuple)),effectiveAccess:'not-established',stagingWriterExclusion:'not-established'};
}
