import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateOriginalGraphIo} from '../cloudflare-worker/src/private-timesheet-original-graph.js';

const name='a'.repeat(64)+'.docx';
function fixture({url='https://tenant.sharepoint.com/upload?secret=fictional',page=false,reply}={}){
  const calls=[],uploads=[];
  const graph=async(path,init={})=>{
    calls.push({path,init});
    if(path.endsWith('/permissions'))return Response.json({value:[{id:'fictional'}],...(page?{'@odata.nextLink':'next'}:{})});
    if(path.endsWith('/createUploadSession'))return Response.json({uploadUrl:url});
    if(path.endsWith('/content'))return new Response(new Uint8Array([1,2,3]));
    if(path.includes('missing'))return new Response('',{status:404});
    return Response.json({id:'fictional-item',name});
  };
  const upload=async(url,init)=>{uploads.push({url,init});return reply?reply(uploads.length,init):Response.json({id:'fictional-item'},{status:201});};
  return {io:createPrivateOriginalGraphIo({siteHost:'tenant.sharepoint.com',graphRequest:graph,uploadRequest:upload}),calls,uploads};
}
test('metadata, missing child, permissions and bounded byte read use the selected drive',async()=>{
  const {io,calls}=fixture();assert.equal((await io.metadata('item')).id,'fictional-item');assert.equal(await io.findChild('parent','missing'),null);assert.equal((await io.permissions('item')).length,1);assert.deepEqual(await io.read('item'),new Uint8Array([1,2,3]));
  assert.deepEqual(calls.map(x=>x.path),['/items/item','/items/parent:/missing','/items/item/permissions','/items/item/content']);
});
test('incomplete permission results are rejected rather than treated as private',async()=>{const {io}=fixture({page:true});await assert.rejects(()=>io.permissions('item'),/incomplete/i)});
test('private readback checks redirects and never forwards credentials to the download address',async()=>{
  const destinations=[];
  const graph=async(path,init)=>{assert.equal(path,'/items/item/content');assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://tenant.sharepoint.com/download?token=fictional'}})};
  const download=async(url,init)=>{destinations.push({url,init});return new Response(new Uint8Array([1,2,3]))};
  const io=createPrivateOriginalGraphIo({siteHost:'tenant.sharepoint.com',graphRequest:graph,uploadRequest:download});
  assert.deepEqual(await io.read('item'),new Uint8Array([1,2,3]));assert.equal(destinations.length,1);assert.equal(destinations[0].init.redirect,'error');assert.equal(destinations[0].init.headers,undefined);
});
test('a private readback cannot follow an untrusted redirect',async()=>{
  let downloads=0;const io=createPrivateOriginalGraphIo({siteHost:'tenant.sharepoint.com',graphRequest:async()=>new Response(null,{status:302,headers:{location:'https://other.example/download'}}),uploadRequest:async()=>{downloads++;return new Response('x')}});
  await assert.rejects(()=>io.read('item'),/readback/i);assert.equal(downloads,0);
});
test('a verified upload session uses exclusive creation and sends no credentials',async()=>{
  const {io,calls,uploads}=fixture();const item=await io.createExclusive('parent',name,new Uint8Array([1,2,3]));assert.equal(item.id,'fictional-item');
  assert.equal(calls[0].path,`/items/parent:/${name}:/createUploadSession`);assert.equal(JSON.parse(calls[0].init.body).item['@microsoft.graph.conflictBehavior'],'fail');
  assert.equal(uploads.length,1);assert.equal(uploads[0].init.redirect,'error');assert.equal(uploads[0].init.headers['content-range'],'bytes 0-2/3');assert.equal(uploads[0].init.headers.authorization,undefined);
});
for(const url of ['http://tenant.sharepoint.com/upload','https://evil.test/upload','https://tenant.sharepoint.com.evil.test/upload','https://user@tenant.sharepoint.com/upload','https://tenant.sharepoint.com:444/upload','https://tenant.sharepoint.com/upload#fragment'])test(`untrusted upload address is rejected before file bytes leave`,async()=>{const {io,uploads}=fixture({url});await assert.rejects(()=>io.createExclusive('parent',name,new Uint8Array([1])),/session/i);assert.equal(uploads.length,0)});
test('multi-part uploads use ordered 320 KiB aligned chunks',async()=>{
  const {io,uploads}=fixture({reply:(count)=>count===1?Response.json({nextExpectedRanges:['10485760-']},{status:202}):Response.json({id:'fictional-item'},{status:201})});
  await io.createExclusive('parent',name,new Uint8Array(10485761));assert.equal(uploads.length,2);assert.equal(uploads[0].init.headers['content-range'],'bytes 0-10485759/10485761');assert.equal(uploads[1].init.headers['content-range'],'bytes 10485760-10485760/10485761');
});
for(const mode of ['conflict','ambiguous response','unexpected range'])test(`${mode} is held without retry`,async()=>{
  const {io,uploads}=fixture({reply:()=>mode==='conflict'?new Response('',{status:409}):mode==='unexpected range'?Response.json({nextExpectedRanges:['0-']},{status:202}):new Response('',{status:200})});
  await assert.rejects(()=>io.createExclusive('parent',name,new Uint8Array(mode==='unexpected range'?10485761:1)),/filing|upload/i);assert.equal(uploads.length,1);
});
test('unsafe paths and invalid sizes are rejected before provider calls',async()=>{const {io,calls}=fixture();for(const [parent,file,bytes] of [['../parent',name,new Uint8Array([1])],['parent','bad/name.docx',new Uint8Array([1])],['parent',name,new Uint8Array(0)],['parent',name,new Uint8Array(20*1024*1024+1)]])await assert.rejects(()=>io.createExclusive(parent,file,bytes));assert.equal(calls.length,0)});
