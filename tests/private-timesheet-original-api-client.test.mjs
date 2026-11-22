import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('private original upload and download use authenticated bounded routes and preserve bytes',async()=>{
 const calls=[];const window={GMT_APP_CONFIG:{portalApiEndpoint:'https://worker.example',portalApiScopes:['scope']},GMT_PORTAL_AUTH:{acquireToken:async()=> 'fictional-token'}};
 const fetch=async(url,options)=>{calls.push({url,options});return options.method==='GET'?new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'application/octet-stream'}}):Response.json({reviewState:'pending'})};
 runInNewContext(readFileSync(new URL('../portal-api.js',import.meta.url),'utf8'),{window,fetch,Blob,URL,console});
 const file=new Blob([new Uint8Array([1,2,3])]);Object.defineProperty(file,'name',{value:'fictional.docx'});
 await window.GMTPortalApi.createTimesheetOriginalIntent({recordId:'fictional'});await window.GMTPortalApi.uploadTimesheetOriginal('intent',file);const result=await window.GMTPortalApi.downloadPrivateTimesheetOriginal('intent');
 assert.equal(calls.length,3);assert.equal(calls[0].options.headers.Authorization,'Bearer fictional-token');assert.equal(calls[1].options.headers['X-GMT-Original-Extension'],'docx');assert.equal(calls[1].options.body,file);assert.equal(calls[2].options.cache,'no-store');assert.equal(calls[2].url,'https://worker.example/api/admin/private-timesheet-original-review/intent/content');assert.deepEqual(new Uint8Array(await result.arrayBuffer()),new Uint8Array([1,2,3]));
 assert.throws(()=>window.GMTPortalApi.uploadTimesheetOriginal('intent',{name:'unsafe.exe'}),/not supported/i);assert.equal(calls.length,3);
});
test('an unsuccessful private download raises the server error instead of exposing an error page as a file',async()=>{
 const window={GMT_APP_CONFIG:{portalApiEndpoint:'https://worker.example'}};runInNewContext(readFileSync(new URL('../portal-api.js',import.meta.url),'utf8'),{window,fetch:async()=>Response.json({error:'Source changed'},{status:409}),Blob,URL,console});
 await assert.rejects(()=>window.GMTPortalApi.downloadPrivateTimesheetOriginal('intent'),error=>error.status===409&&error.message==='Source changed');
});
