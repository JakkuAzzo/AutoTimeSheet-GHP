import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';

const source={schemaVersion:2,mode:'replace-pay-month',recordId:'fictional-worker',employeeName:'Fictional',employeeUpn:'fictional@example.test',payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:'fictional-worker|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,note:'Fictional'}]};
const fileName='GMT Timesheet - Fictional - Pay Month 2026-10.xlsx',recordJson=JSON.stringify(source),generation=createHash('sha256').update(recordJson).digest('hex');
function workbook(change=()=>{}){
 const book=XLSX.utils.book_new();
 const daily=XLSX.utils.aoa_to_sheet([['Date','Start','Finish','Break','Absence','Total hours','Notes'],['2026-10-05','09:00','12:00',0,'NA',0.125,'Fictional'],['Pay month total','','','','',0.125,'']]);
 daily.F2.f='IF(E2<>"NA",0,IF(OR(B2="",C2="",D2=""),0.125,MOD(C2-B2,1)-D2/1440))';daily.F3.f='SUM(F2:F2)';
 const weekly=XLSX.utils.aoa_to_sheet([['Week Start','Week End','Total hours'],['2026-09-21','2026-09-27',0],['2026-09-28','2026-10-04',0],['2026-10-05','2026-10-11',0.125],['2026-10-12','2026-10-18',0],['Month total','',0.125]]);
 for(let n=2;n<=5;n++)weekly['C'+n].f=`SUMIFS('Daily Entries'!$F$2:$F$2,'Daily Entries'!$A$2:$A$2,">="&A${n},'Daily Entries'!$A$2:$A$2,"<="&B${n})`;
 weekly.C6.f='SUM(C2:C5)';XLSX.utils.book_append_sheet(book,daily,'Daily Entries');XLSX.utils.book_append_sheet(book,weekly,'Weekly Totals');change(book);
 return new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'}));
}
const expected={driveId:'fictional-drive',itemId:'fictional-item',parentId:'fictional-parent',eTag:'fictional-v1',fileName,recordJson,generation};
const metadata=bytes=>({id:expected.itemId,name:fileName,eTag:expected.eTag,size:bytes.length,parentReference:{driveId:expected.driveId,id:expected.parentId},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});

test('Worker-compatible verifier checks fictional workbook bytes and binds their source and version',async()=>{
 const {verifyWorkerWorkbookReadback}=await import('../cloudflare-worker/src/timesheet-workbook-readback.js');
 const bytes=workbook(),result=await verifyWorkerWorkbookReadback(expected,{metadata:async()=>metadata(bytes),content:async()=>bytes});
 const hash=createHash('sha256').update(bytes).digest('hex');
 const proof=['gmt-timesheet-provider-readback-v1',expected.driveId,expected.itemId,expected.parentId,expected.eTag,fileName,bytes.length,generation,hash];
 assert.equal(result.rowCount,1);assert.equal(result.totalMinutes,180);assert.equal(result.contentSha256,hash);
 assert.equal(result.verificationDigest,createHash('sha256').update(JSON.stringify(proof)).digest('hex'));
});

test('Worker verifier preserves unknown and zero source rates and rejects changed formulas',async()=>{
 const {verifyWorkerWorkbookReadback}=await import('../cloudflare-worker/src/timesheet-workbook-readback.js');
 const rateJson=JSON.stringify({...source,schemaVersion:3,rows:[{...source.rows[0],sourceBasicMinutes:120,sourceOt15Minutes:60,sourceOt20Minutes:null}]});
 const target={...expected,recordJson:rateJson,generation:createHash('sha256').update(rateJson).digest('hex')};
 const addRates=book=>{const sheet=book.Sheets['Daily Entries'];sheet.H1={t:'s',v:'Source basic hours'};sheet.I1={t:'s',v:'Source overtime 1.5× hours'};sheet.J1={t:'s',v:'Source overtime 2× hours'};sheet.H2={t:'n',v:120/1440};sheet.I2={t:'n',v:60/1440};sheet['!ref']='A1:J3'};
 const verify=async bytes=>verifyWorkerWorkbookReadback(target,{metadata:async()=>metadata(bytes),content:async()=>bytes});
 const accepted=await verify(workbook(addRates)),row=JSON.parse(accepted.verifiedRowsJson)[0];
 assert.equal(row.sourceBasicMinutes,120);assert.equal(row.sourceOt15Minutes,60);assert.equal(row.sourceOt20Minutes,null);
 await assert.rejects(()=>verify(workbook(book=>{addRates(book);book.Sheets['Daily Entries'].J2={t:'n',v:0}})));
 await assert.rejects(()=>verify(workbook(book=>{addRates(book);book.Sheets['Daily Entries'].F2.f='1+1'})));
});

test('Graph adapter reads only the pinned fictional item and does not forward Graph credentials to the download host',async()=>{
 const {verifyGraphWorkbookReadback}=await import('../cloudflare-worker/src/timesheet-workbook-graph-readback.js');
 const bytes=workbook(),paths=[],downloads=[];
 const io={siteHost:'gmtfictional.sharepoint.com',driveId:expected.driveId,
  graphRequest:async(path,init={})=>{paths.push({path,redirect:init.redirect});if(path.endsWith('/content'))return new Response(null,{status:302,headers:{location:'https://gmtfictional.sharepoint.com/fake-download'}});return Response.json(metadata(bytes));},
  downloadRequest:async(url,init)=>{downloads.push({url,init});return new Response(bytes,{headers:{'content-length':String(bytes.length)}})}};
 const verified=await verifyGraphWorkbookReadback(expected,io);
 assert.equal(verified.rowCount,1);assert.deepEqual(paths.map(v=>v.path),['/items/fictional-item','/items/fictional-item/content','/items/fictional-item']);
 assert.equal(paths[1].redirect,'manual');assert.equal(downloads.length,1);assert.equal(downloads[0].init.redirect,'error');
 assert.equal(downloads[0].init.headers?.authorization,undefined);
 await assert.rejects(()=>verifyGraphWorkbookReadback({...expected,driveId:'other-drive'},io));
 assert.equal(paths.length,3,'a different drive must be rejected before provider access');
 await assert.rejects(()=>verifyGraphWorkbookReadback(expected,{...io,graphRequest:async(path)=>path.endsWith('/content')?new Response(null,{status:302,headers:{location:'https://attacker.invalid/file'}}):Response.json(metadata(bytes))}));
 assert.equal(downloads.length,1,'an untrusted redirect must never receive a request');
 await assert.rejects(()=>verifyGraphWorkbookReadback(expected,{...io,downloadRequest:async()=>new Response(new Uint8Array(1024*1024+1))}),undefined,'the actual download must be capped even when metadata says it is small');
});

test('private Graph readback binds unchanged permissions and rejects the staging identity on the final file',async()=>{
 const {verifyPrivateGraphWorkbookReadback}=await import('../cloudflare-worker/src/timesheet-workbook-graph-readback.js');
 const bytes=workbook(),admin='11111111-1111-4111-8111-111111111111',employee='22222222-2222-4222-8222-222222222222',owner='33333333-3333-4333-8333-333333333333',writer='44444444-4444-4444-8444-444444444444';
 const policy={adminGroupId:admin,employeeId:employee,employeeUpn:'fictional@example.test',siteOwnerGroupId:owner,stagingWriterId:writer};
 const grants=[{roles:['write'],grantedToV2:{group:{id:admin}}},{roles:['write'],grantedToV2:{user:{id:employee}}},{roles:['owner'],grantedToV2:{group:{id:owner}}}];
 let permissionReads=0;
 const graphRequest=async(path)=>{if(path.endsWith('/permissions')){permissionReads++;return Response.json({value:grants})}if(path.endsWith('/content'))return new Response(bytes);return Response.json(metadata(bytes));};
 const io={siteHost:'gmtfictional.sharepoint.com',driveId:expected.driveId,graphRequest,downloadRequest:async()=>{throw Error('no redirects expected')}};
 const result=await verifyPrivateGraphWorkbookReadback(expected,policy,io);
 assert.equal(result.rowCount,1);assert.equal(permissionReads,2);assert.match(result.permissionSnapshotHash,/^[0-9a-f]{64}$/);assert.match(result.verificationDigest,/^[0-9a-f]{64}$/);
 await assert.rejects(()=>verifyPrivateGraphWorkbookReadback(expected,{...policy,stagingWriterId:employee},io));
 let calls=0;
 const changed=async(path)=>{if(path.endsWith('/permissions'))return Response.json({value:++calls===1?grants:[...grants,{roles:['write'],grantedToV2:{user:{id:writer}}}]});return graphRequest(path);};
 await assert.rejects(()=>verifyPrivateGraphWorkbookReadback(expected,policy,{...io,graphRequest:changed}));
 await assert.rejects(()=>verifyPrivateGraphWorkbookReadback(expected,policy,{...io,graphRequest:async(path)=>path.endsWith('/permissions')?Response.json({value:grants,'@odata.nextLink':'https://graph.microsoft.com/next'}):graphRequest(path)}));
 let metadataReads=0;
 const changedSize=async(path)=>{if(path.endsWith('/permissions')||path.endsWith('/content'))return graphRequest(path);const item=metadata(bytes);if(++metadataReads===3)item.size++;return Response.json(item);};
 await assert.rejects(()=>verifyPrivateGraphWorkbookReadback(expected,policy,{...io,graphRequest:changedSize}));
});

test('Worker-compatible verifier holds changed metadata and forged inflated sizes',async()=>{
 const {verifyWorkerWorkbookReadback}=await import('../cloudflare-worker/src/timesheet-workbook-readback.js');
 const bytes=workbook();let reads=0;
 await assert.rejects(()=>verifyWorkerWorkbookReadback(expected,{metadata:async()=>({...metadata(bytes),eTag:++reads===2?'changed':expected.eTag}),content:async()=>bytes}));
 const py=`import io,sys,zipfile,struct
src=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as dst:
 for entry in src.infolist():
  content=src.read(entry)
  if entry.filename=='xl/worksheets/sheet1.xml': content+=b' '*(21*1024*1024)
  dst.writestr(entry.filename,content)
data=bytearray(out.getvalue()); cursor=0; found=False
while True:
 cursor=data.find(b'PK\\x01\\x02',cursor)
 if cursor<0: break
 n,e,c=struct.unpack_from('<HHH',data,cursor+28)
 if bytes(data[cursor+46:cursor+46+n])==b'xl/worksheets/sheet1.xml': struct.pack_into('<I',data,cursor+24,128); found=True
 cursor+=46+n+e+c
assert found
sys.stdout.buffer.write(data)`;
 const bomb=new Uint8Array(execFileSync('python3',['-c',py],{input:Buffer.from(bytes),maxBuffer:5*1024*1024}));
 await assert.rejects(()=>verifyWorkerWorkbookReadback(expected,{metadata:async()=>metadata(bomb),content:async()=>bomb}));
});

test('fictional readback executes in the Cloudflare Worker runtime',{skip:!process.env.GMT_LOCAL_WRANGLER,timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gmt-worker-readback-'));fs.chmodSync(dir,0o700);const key=randomBytes(24).toString('hex');
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const config={name:'gmt-fictional-worker-readback',main:path.resolve('cloudflare-worker/test-only/workbook-readback-runtime-fixture.js'),compatibility_date:'2026-09-10',vars:{TEST_KEY:key}};
 const cfg=path.join(dir,'wrangler.json');fs.writeFileSync(cfg,JSON.stringify(config),{mode:0o600});
 const child=spawn(process.execPath,[process.env.GMT_LOCAL_WRANGLER,'dev','--local','--ip','127.0.0.1','--port',String(port),'--config',cfg,'--persist-to',path.join(dir,'state'),'--show-interactive-dev-session=false'],{stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{clearInterval(poll);reject(Error('Local Worker did not start: '+output.slice(-1200)))},15000);const poll=setInterval(()=>{if(output.includes('Ready on http://127.0.0.1:')){clearInterval(poll);clearTimeout(timeout);resolve()}else if(child.exitCode!==null){clearInterval(poll);clearTimeout(timeout);reject(Error('Local Worker exited: '+output.slice(-1200)))}},50)});
  const bytes=workbook(),body={expected,base64:Buffer.from(bytes).toString('base64')};
  const send=async value=>fetch(`http://127.0.0.1:${port}/verify`,{method:'POST',headers:{'x-test-key':key,'content-type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(7000)});
  const good=await send(body);assert.equal(good.status,200,await good.clone().text());const result=await good.json();
  assert.equal(result.rowCount,1);assert.equal(result.totalMinutes,180);assert.equal(result.contentSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal((await send({...body,changeAfterRead:true})).status,409);
  const graph=await send({...body,useGraph:true});assert.equal(graph.status,200,await graph.clone().text());assert.equal((await graph.json()).verificationDigest,result.verificationDigest);
  assert.equal((await send({...body,useGraph:true,badRedirect:true})).status,409);
  assert.equal((await send({...body,useGraph:true,changeAfterRead:true})).status,409);
  const privateResult=await send({...body,usePrivateGraph:true});assert.equal(privateResult.status,200,await privateResult.clone().text());
  const privateBody=await privateResult.json();assert.equal(privateBody.effectiveAccess,'not-established');assert.equal(privateBody.stagingWriterExclusion,'not-established');
  assert.equal((await send({...body,usePrivateGraph:true,badPermissions:true})).status,409);
  const preparedSource={schemaVersion:3,cycleStart:'2026-10-05',cycleEnd:'2026-10-11',rows:[{date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,note:'Fictional',sourceBasicMinutes:180,sourceOt15Minutes:0,sourceOt20Minutes:null}]};
  const daily=[['Date','Start','Finish','Break','Absence','Total hours','Notes','Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours'],['2026-10-05','09:00','12:00',0,'NA','3h 00m','Fictional','3h 00m','0h 00m',''],['Pay month total','','','','','3h 00m','','','','']];
  const weekly=[['Week Start','Week End','Total hours'],['2026-10-05','2026-10-11','3h 00m'],['Month total','','3h 00m']];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(daily),'Daily Entries');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(weekly),'Weekly Totals');
  const prepared={source:preparedSource,xlsx:Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx'})).toString('base64'),csv:Buffer.from(daily.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n')).toString('base64')};
  const verifiedPrepared=await send({...body,prepared});assert.equal(verifiedPrepared.status,200,await verifiedPrepared.clone().text());assert.equal((await verifiedPrepared.json()).prepared,true);
  const changed=await send({...body,prepared:{...prepared,csv:Buffer.from('wrong').toString('base64')}});assert.equal(changed.status,409);
  const company=await send({...body,company:true});assert.equal(company.status,200,await company.clone().text());
  assert.deepEqual(await company.json(),{monthlyRows:1,annualRows:1,monthlyWorkedHours:3,annualWorkedHours:3});
 }finally{if(child.pid&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([exited,new Promise(r=>setTimeout(r,2000))]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited}}fs.rmSync(dir,{recursive:true,force:true});}
});
