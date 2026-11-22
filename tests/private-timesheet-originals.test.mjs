import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {filePrivateTimesheetOriginal,verifyPrivateTimesheetOriginal} from '../cloudflare-worker/src/private-timesheet-originals.js';

const admin='e0d972cd-46ed-4930-a9c6-51db65474f1f',owner='b89b71c6-ba9a-4712-bf29-57f50d1c2969';
const employee='0244eee3-2f7f-4d41-a6e9-af4a5a07fbd2',bytes=new TextEncoder().encode('fictional original timesheet');
const sha=createHash('sha256').update(bytes).digest('hex');
const context={adminGroupId:admin,siteOwnerGroupId:owner,parentId:'admin-parent',vaultId:'admin-vault'};
const request={recordId:'correction-one',employeeOid:employee,sourceSha256:sha,fileName:'week.docx',bytes};
const grants=ancestor=>[{roles:['write'],grantedToV2:{group:{id:admin}},...(ancestor?{inheritedFrom:{id:ancestor}}:{})},{roles:['owner'],grantedToV2:{group:{id:owner}},...(ancestor?{inheritedFrom:{id:ancestor}}:{})}];
function fixture(options={}){
  let item=null,creates=0,binds=0,reads=0,metadataCalls=0;
  const binding={recordId:request.recordId,employeeOid:employee,sourceSha256:sha,reviewId:'review-one',recordRevision:7,dates:['2026-10-05']};
  const io={
    authorize:async()=>options.denied?null:binding,
    metadata:async id=>{metadataCalls++;if(id==='admin-vault')return {id,folder:{},parentReference:{id:options.badParent||(options.vaultMoves&&reads)?'other':'admin-parent'}};if(id===item?.id)return options.changeVersion&&reads?{...item,eTag:'changed'}:item;return null;},
    permissions:async id=>options.badVaultAncestor&&id==='admin-vault'?grants('unverified-parent'):options.employeeAccess&&id==='admin-vault'?[...grants('admin-parent'),{roles:['read'],grantedToV2:{user:{id:employee}}}]:((options.badPermission&&id==='source-item')||(options.permissionChanges&&id==='admin-vault'&&reads))?[...grants('admin-vault'),{roles:['read'],link:{scope:'organization'}}]:grants(id==='admin-parent'?null:id==='admin-vault'?'admin-parent':'admin-vault'),
    findChild:async()=>item,
    createExclusive:async(parent,name,value)=>{creates++;if(options.uncertain)throw Error('response lost');item={id:'source-item',name,file:{},size:value.length,eTag:'version-one',parentReference:{id:parent}};return item;},
    read:async()=>{reads++;return options.changedBytes?new TextEncoder().encode('different'):bytes;},
    bind:async()=>{binds++;return !options.bindRace;}
  };
  if(options.existing)item={id:'source-item',name:sha+'.docx',file:{},size:bytes.length,eTag:'version-one',parentReference:{id:'admin-vault'}};
  return {io,stats:()=>({creates,binds,reads,metadataCalls})};
}
test('files verified bytes under an admin-only vault and binds the exact item version',async()=>{
  const {io,stats}=fixture();const result=await filePrivateTimesheetOriginal(context,request,io);
  assert.equal(result.sourceSha256,sha);assert.equal(result.itemId,'source-item');assert.equal(result.eTag,'version-one');assert.equal(result.reviewState,'pending');assert.equal(stats().creates,1);assert.equal(stats().binds,1);
});
test('a matching existing original is read back without an overwrite',async()=>{
  const {io,stats}=fixture({existing:true});await filePrivateTimesheetOriginal(context,request,io);assert.equal(stats().creates,0);assert.equal(stats().binds,1);
});
test('a conflicting existing file is held and never overwritten',async()=>{
  const {io,stats}=fixture({existing:true,changedBytes:true});await assert.rejects(()=>filePrivateTimesheetOriginal(context,request,io),/readback/i);assert.equal(stats().creates,0);assert.equal(stats().binds,0);
});
test('an existing source is rechecked without creating a link, writing or approving the review',async()=>{
  const {io,stats}=fixture({existing:true});const proof={sourceSha256:sha,itemId:'source-item',vaultId:'admin-vault',eTag:'version-one',fileName:sha+'.docx',reviewState:'pending'};
  const result=await verifyPrivateTimesheetOriginal(context,proof,io);
  assert.equal(result.reviewState,'pending');assert.equal(stats().creates,0);assert.equal(stats().binds,0);
});
for(const [name,options] of [['permission',{badPermission:true}],['bytes',{existing:true,changedBytes:true}],['version',{existing:true,changeVersion:true}],['parent',{existing:true,badParent:true}]])test(`a changed ${name} invalidates later source checks`,async()=>{
  const {io,stats}=fixture({...options,existing:true});const proof={sourceSha256:sha,itemId:'source-item',vaultId:'admin-vault',eTag:'version-one',fileName:sha+'.docx',reviewState:'pending'};
  await assert.rejects(()=>verifyPrivateTimesheetOriginal(context,proof,io));assert.equal(stats().creates,0);assert.equal(stats().binds,0);
});
for(const [name,options] of [['unauthorised',{denied:true}],['wrong parent',{badParent:true}],['unverified inherited access',{badVaultAncestor:true}],['employee access to a mixed source',{employeeAccess:true}],['broad sharing',{badPermission:true}],['different bytes',{changedBytes:true}],['changed version',{changeVersion:true}],['vault moved',{vaultMoves:true}],['permission changed',{permissionChanges:true}],['binding race',{bindRace:true}],['uncertain create',{uncertain:true}]])test(`${name} cannot establish a source binding`,async()=>{
  const {io,stats}=fixture(options);await assert.rejects(()=>filePrivateTimesheetOriginal(context,request,io));
  if(!options.bindRace)assert.equal(stats().binds,0);
  if(options.badVaultAncestor||options.employeeAccess)assert.equal(stats().creates,0,'a wider vault is rejected before upload');
  if(options.uncertain)assert.equal(stats().creates,1,'an uncertain create is not retried');
});
test('bad digest, unsafe extension and oversized files are rejected before any provider call',async()=>{
  for(const change of [{sourceSha256:'0'.repeat(64)},{fileName:'week.exe'},{bytes:new Uint8Array(20*1024*1024+1)}]){
    const {io,stats}=fixture();await assert.rejects(()=>filePrivateTimesheetOriginal(context,{...request,...change},io));assert.equal(stats().creates,0);assert.equal(stats().metadataCalls,0);
  }
});
