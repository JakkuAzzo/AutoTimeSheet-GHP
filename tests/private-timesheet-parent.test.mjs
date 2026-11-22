import assert from 'node:assert/strict';
import * as access from '../cloudflare-worker/src/private-timesheet-access.js';
assert.equal(typeof access.verifyPrivateTimesheetParent,'function');
const admin='e0d972cd-46ed-4930-a9c6-51db65474f1f',owner='b89b71c6-ba9a-4712-bf29-57f50d1c2969';
const context={adminGroupId:admin,siteOwnerGroupId:owner};
const grants=[{roles:['write'],grantedToV2:{group:{id:admin}}},{roles:['owner'],grantedToV2:{group:{id:owner}}}];
assert.doesNotThrow(()=>access.verifyPrivateTimesheetParent(context,grants));
for(const bad of [
  [...grants,{roles:['read'],link:{scope:'organization'}}],
  [...grants,{roles:['read'],grantedToV2:{user:{id:'0244eee3-2f7f-4d41-a6e9-af4a5a07fbd2'}}}],
  [{...grants[0],inheritedFrom:{id:'wider-parent'}},grants[1]],
  [{...grants[0],roles:['read']},grants[1]],
  [grants[0]]
])assert.throws(()=>access.verifyPrivateTimesheetParent(context,bad),/permission/i);
const inherited=[{...grants[0],inheritedFrom:{id:'verified-root'}},{...grants[1],inheritedFrom:{id:'verified-root'}}];
assert.throws(()=>access.verifyPrivateTimesheetParent(context,inherited),/permission/i,'inheritance is denied by default');
assert.doesNotThrow(()=>access.verifyPrivateTimesheetParent(context,inherited,{inheritedFromIds:['verified-root']}));
assert.throws(()=>access.verifyPrivateTimesheetParent(context,inherited,{inheritedFromIds:['other-root']}),/permission/i,'inheritance must refer to a verified ancestor');
const parentMeta={id:'fictional-parent',folder:{},parentReference:{id:'fictional-anchor'}};
const inheritedEmpty=grants.map(grant=>({...grant,inheritedFrom:{}}));
const pinnedIo={metadata:async()=>parentMeta,permissions:async id=>id==='fictional-anchor'?grants:inheritedEmpty};
await access.verifyPinnedInheritedParent(context,'fictional-parent','fictional-anchor',pinnedIo);
await assert.rejects(()=>access.verifyPinnedInheritedParent(context,'fictional-parent','fictional-anchor',{...pinnedIo,metadata:async()=>({...parentMeta,parentReference:{id:'other'}})}),/permission/i);
await assert.rejects(()=>access.verifyPinnedInheritedParent(context,'fictional-parent','fictional-anchor',{...pinnedIo,permissions:async id=>id==='fictional-anchor'?[...grants,{roles:['read'],link:{scope:'organization'}}]:inheritedEmpty}),/permission/i);
const employee='bb420999-c705-4dc2-9b0e-33846b43ae2c',parentId='private-parent';let checks=0,invited=[];
const io={verifyParent:async id=>{assert.equal(id,parentId);checks++},find:async()=>null,
  createEmpty:async()=>({id:'employee-folder',folder:{},parentReference:{id:parentId}}),markCreated:async()=>{},
  grantPrivate:async(_id,recipients,options)=>{invited=recipients;assert.equal(options.retainInheritedPermissions,true)},
  permissions:async()=>[{...grants[0],inheritedFrom:{}},{roles:['write'],grantedToV2:{user:{id:employee}}},{...grants[1],inheritedFrom:{}}]};
const folder=await access.ensurePrivateTimesheetFolder({...context,parentId,employeeId:employee,employeeUpn:'employee@example.test'},io);
assert.equal(folder.id,'employee-folder');assert.deepEqual(invited,[employee],'only the employee is newly granted access under the private parent');
assert.ok(checks>=2,'the parent is checked before creation and after the grant');
console.log('PASS: the timesheet parent must be private to Admin and the site owners');
