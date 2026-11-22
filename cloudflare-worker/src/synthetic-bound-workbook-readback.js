// Read-only, fictional test adapter. It neither establishes effective
// permissions nor fences a provider writer, and it never publishes a result.
import {graphSharePointRequest} from './index.js';
import {readPublicationSourceForRun} from './timesheet-source-publication-guard.js';
import {verifyGraphWorkbookReadback} from './timesheet-workbook-graph-readback.js';
import {syntheticFixture} from './synthetic-portal-fixture.js';

export async function verifyBoundSyntheticWorkbook(env,binding,io={}){
 const before=await readPublicationSourceForRun(env,binding);
 if(before.recordId!==syntheticFixture.recordId||before.generation!==binding.generation)throw new Error('Fictional source unavailable');
 let recordJson;try{recordJson=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(before.sourceBase64),c=>c.charCodeAt(0)))}catch(_){throw new Error('Fictional source unavailable')}
 const driveId=String(env.SHAREPOINT_DRIVE_ID||''),itemId=String(env.SYNTHETIC_TEST_WORKBOOK_ID||''),parentId=String(env.SYNTHETIC_TEST_MONTH_FOLDER_ID||'');
 if(![driveId,itemId,parentId].every(value=>/^[A-Za-z0-9!_-]{1,256}$/.test(value)))throw new Error('Fictional destination unavailable');
 const graphRequest=io.graphRequest||((path,init)=>graphSharePointRequest(env,path,init)),downloadRequest=io.downloadRequest||((url,init)=>fetch(url,init));
 const response=await graphRequest('/items/'+encodeURIComponent(itemId));
 if(!response.ok)throw new Error('Fictional destination unavailable');
 const metadata=await response.json();
 const expected={driveId,itemId,parentId,eTag:metadata?.eTag,fileName:`GMT Timesheet - ${syntheticFixture.employeeName} - Pay Month ${before.payMonth}.xlsx`,recordJson,generation:before.generation};
 const verified=await verifyGraphWorkbookReadback(expected,{siteHost:String(env.SHAREPOINT_SITE_ID||'').split(',')[0],driveId,graphRequest,downloadRequest});
 const after=await readPublicationSourceForRun(env,binding);
 if(after.recordId!==before.recordId||after.payMonth!==before.payMonth||after.generation!==before.generation||after.sourceBase64!==before.sourceBase64)throw new Error('Fictional source changed during verification');
 return {verified:true,attemptId:binding.attemptId,flowRunId:binding.flowRunId,generation:before.generation,workbookId:itemId,eTag:verified.eTag,contentSha256:verified.contentSha256,verificationDigest:verified.verificationDigest,effectiveAccess:'not-established',stagingWriterExclusion:'not-established',publicationReleased:false};
}
