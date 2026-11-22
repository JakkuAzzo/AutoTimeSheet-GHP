// Fictional local runtime fixture only; do not deploy or route this module.
import {verifyWorkerWorkbookReadback} from '../src/timesheet-workbook-readback.js';
import {verifyGraphWorkbookReadback,verifyPrivateGraphWorkbookReadback} from '../src/timesheet-workbook-graph-readback.js';
import {verifyPreparedAttachments} from '../src/timesheet-prepared-attachments.js';
import {buildCompanyWorkbooksFromSources} from '../src/timesheet-company-source-adapter.js';
import * as XLSX from 'xlsx';
export default {async fetch(request,env){
 if(new URL(request.url).hostname!=='127.0.0.1'||request.method!=='POST'||request.headers.get('x-test-key')!==env.TEST_KEY)return new Response(null,{status:403});
 try{
  const body=await request.json(),expected=body.expected,source=JSON.parse(expected.recordJson);
  if(source.recordId!=='fictional-worker'||source.employeeUpn!=='fictional@example.test'||expected.itemId!=='fictional-item'||typeof body.base64!=='string'||body.base64.length>1000000)throw Error('fixture only');
  if(body.company){
   const sources=[{employeeOid:'11111111-1111-4111-8111-111111111111',employeeUpn:source.employeeUpn,employeeName:'Fictional',recordId:source.recordId,payMonth:source.payMonth,generation:expected.generation,sourceBytes:new TextEncoder().encode(expected.recordJson)}];
   const books=await buildCompanyWorkbooksFromSources(XLSX,{year:2026,payMonth:'2026-10',sources});
   const monthly=XLSX.utils.sheet_to_json(books.monthly.Sheets.Entries,{header:1,defval:null});
   const annual=XLSX.utils.sheet_to_json(books.annual.Sheets.Entries,{header:1,defval:null});
   return Response.json({monthlyRows:monthly.length-1,annualRows:annual.length-1,monthlyWorkedHours:monthly[1][8],annualWorkedHours:annual[1][8]});
  }
  if(body.prepared){
   const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
   await verifyPreparedAttachments(body.prepared.source,{xlsx:decode(body.prepared.xlsx),csv:decode(body.prepared.csv)});
   return Response.json({prepared:true});
  }
  const bytes=Uint8Array.from(atob(body.base64),c=>c.charCodeAt(0));let reads=0;
  const metadata=()=>({id:expected.itemId,name:expected.fileName,eTag:body.changeAfterRead&&++reads===2?'changed':expected.eTag,size:bytes.length,parentReference:{driveId:expected.driveId,id:expected.parentId},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  const policy={adminGroupId:'11111111-1111-4111-8111-111111111111',employeeId:'22222222-2222-4222-8222-222222222222',employeeUpn:'fictional@example.test',siteOwnerGroupId:'33333333-3333-4333-8333-333333333333',stagingWriterId:'44444444-4444-4444-8444-444444444444'};
  const grants=[{roles:['write'],grantedToV2:{group:{id:policy.adminGroupId}}},{roles:['write'],grantedToV2:{user:{id:policy.employeeId}}},{roles:['owner'],grantedToV2:{group:{id:policy.siteOwnerGroupId}}}];
  const graphIo={siteHost:'gmtfictional.sharepoint.com',driveId:expected.driveId,
   graphRequest:async(path,init)=>path.endsWith('/permissions')?Response.json({value:body.badPermissions?[...grants,{roles:['write'],grantedToV2:{user:{id:policy.stagingWriterId}}}]:grants}):path.endsWith('/content')?new Response(null,{status:302,headers:{location:body.badRedirect?'https://attacker.invalid/file':'https://gmtfictional.sharepoint.com/fake'}}):Response.json(metadata()),
   downloadRequest:async(_url,init)=>{if(init?.headers?.authorization)throw Error('credential leak');return new Response(bytes);}
  };
  const result=body.usePrivateGraph?await verifyPrivateGraphWorkbookReadback(expected,policy,graphIo):body.useGraph?await verifyGraphWorkbookReadback(expected,graphIo):await verifyWorkerWorkbookReadback(expected,{metadata:async()=>metadata(),content:async()=>bytes});
  return Response.json({rowCount:result.rowCount,totalMinutes:result.totalMinutes,contentSha256:result.contentSha256,verificationDigest:result.verificationDigest,effectiveAccess:result.effectiveAccess,stagingWriterExclusion:result.stagingWriterExclusion});
 }catch(_){return Response.json({error:'held'}, {status:409});}
}};
