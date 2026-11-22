import assert from 'node:assert/strict';
import {ensurePrivateTimesheetFolder as rawEnsure} from '../cloudflare-worker/src/private-timesheet-access.js';
const group='e0d972cd-46ed-4930-a9c6-51db65474f1f',employee='0244eee3-2f7f-4d41-a6e9-af4a5a07fbd2';
const defaultOwner='b89b71c6-ba9a-4712-bf29-57f50d1c2969',testParent='test-private-parent';
function checkedFolder(context,io){
  const needsOwner=!context.siteOwnerGroupId;
  const attachParent=item=>item?{...item,parentReference:item.parentReference||{id:testParent}}:item;
  return rawEnsure({...context,parentId:testParent,siteOwnerGroupId:context.siteOwnerGroupId||defaultOwner,employeeUpn:context.employeeUpn||'employee@example.test'},
    {...io,verifyParent:async()=>{},find:async(...args)=>attachParent(await io.find(...args)),createEmpty:async(...args)=>attachParent(await io.createEmpty(...args)),
      permissions:async(...args)=>{const value=await io.permissions(...args);return needsOwner?[...value,{roles:['owner'],grantedToV2:{group:{id:defaultOwner}}}]:value;}});
}
let created=0,invited=0,permissions=[];
const io={find:async()=>null,createEmpty:async()=>{created++;return {id:'folder-1',folder:{childCount:0}}},markCreated:async()=>{},wasCreatedByApp:async()=>false,grantPrivate:async(id,recipients,options)=>{invited++;assert.equal(id,'folder-1');assert.deepEqual(recipients,[employee]);assert.equal(options.retainInheritedPermissions,true);permissions=[group,...recipients].map(id=>({roles:['write'],grantedToV2:id===group?{group:{id}}:{user:{id}}}));},permissions:async()=>permissions};
const result=await checkedFolder({adminGroupId:group,employeeId:employee},io);assert.equal(result.id,'folder-1');assert.equal(created,1);assert.equal(invited,1);
const broad={...io,find:async()=>({id:'existing',folder:{}}),permissions:async()=>[...permissions,{link:{scope:'organization',type:'edit'},roles:['write']}]};await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},broad),/access|permission/i);
const missing={...io,permissions:async()=>permissions.slice(0,1)};await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},missing),/access|permission/i);
const other={...io,permissions:async()=>[...permissions,{roles:['read'],grantedToV2:{user:{id:'unexpected-user'}}}]};await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},other),/access|permission/i);
const hiddenPrincipal={...io,permissions:async()=>[...permissions,{roles:['read'],grantedToV2:{user:{id:employee},application:{id:'unrecognised-app'}}}]};await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},hiddenPrincipal),/access|permission/i);
assert.equal(invited,4,'new empty folders are secured before they can be used');
let persisted=false,firstGrant=true;const recovery={find:async()=>persisted?{id:'retry-folder',folder:{childCount:0}}:null,refresh:async()=>({id:'retry-folder',folder:{childCount:0}}),createEmpty:async()=>({id:'retry-folder',folder:{childCount:0}}),markCreated:async()=>{persisted=true},wasCreatedByApp:async()=>persisted,grantPrivate:async()=>{if(firstGrant){firstGrant=false;throw new Error('temporary failure')}permissions=[group,employee].map(id=>({roles:['write'],grantedToV2:id===group?{group:{id}}:{user:{id}}}))},permissions:async()=>firstGrant?[]:permissions};
permissions=[];await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},recovery),/temporary/);permissions=[];await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},recovery),/permission/i,'an interrupted permission grant is held for review, not retried on an existing folder');
let unsafeGrant=false;const occupied={...recovery,find:async()=>({id:'retry-folder',folder:{childCount:1}}),permissions:async()=>[],grantPrivate:async()=>{unsafeGrant=true}};await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},occupied),/permission/i);assert.equal(unsafeGrant,false,'never change permissions on a nonempty folder');
// Shape observed from the live SharePoint permission listing: siteUser is
// returned alongside the Entra principal, and a separate site-owners grant
// persists after inheritance is broken. Neither may be silently ignored.
const observedSiteOwner='b89b71c6-ba9a-4712-bf29-57f50d1c2969';
const observedProviderGrants=[
  {roles:['write'],grantedToV2:{group:{id:group},siteUser:{id:'6'}}},
  {roles:['write'],grantedToV2:{user:{id:employee},siteUser:{id:'25'}}},
  {roles:['owner'],grantedToV2:{group:{id:observedSiteOwner},siteUser:{id:'7'}}}
];
const observedProvider={...occupied,permissions:async()=>observedProviderGrants};
await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},observedProvider),/permission/i,'provider owner grants must not be mistaken for Admin access');
// The real provider also returns a site-local identity alongside each Entra
// identity. Accept it only when its claim matches the expected principal.
const employeeUpn='employee@gmt-services.co.uk';
const verifiedProviderGrants=[
  {roles:['write'],grantedToV2:{group:{id:group},siteUser:{id:'26',loginName:`c:0t.c|tenant|${group}`}}},
  {roles:['write'],grantedToV2:{user:{id:employee},siteUser:{id:'27',loginName:`i:0#.f|membership|${employeeUpn}`}}},
  {roles:['owner'],grantedToV2:{group:{id:observedSiteOwner},siteUser:{id:'6',loginName:`c:0o.c|federateddirectoryclaimprovider|${observedSiteOwner}_o`}}}
];
const verifiedContext={adminGroupId:group,employeeId:employee,employeeUpn,siteOwnerGroupId:observedSiteOwner};
const verifiedIo={...occupied,permissions:async()=>verifiedProviderGrants};
assert.equal((await checkedFolder(verifiedContext,verifiedIo)).id,'retry-folder','accept the verified owner group and matching site identities');
await assert.rejects(()=>checkedFolder(verifiedContext,{...verifiedIo,wasCreatedByApp:async()=>false}),/permission/i,
  'a pre-existing folder without its application creation marker is held for review');
const wrongSiteUser=structuredClone(verifiedProviderGrants);wrongSiteUser[1].grantedToV2.siteUser.loginName='i:0#.f|membership|other@gmt-services.co.uk';
await assert.rejects(()=>checkedFolder(verifiedContext,{...verifiedIo,permissions:async()=>wrongSiteUser}),/permission/i,'reject a site identity that names a different employee');
const unexpectedOwner=structuredClone(verifiedProviderGrants);unexpectedOwner[2].grantedToV2.group.id='11111111-1111-4111-8111-111111111111';
await assert.rejects(()=>checkedFolder(verifiedContext,{...verifiedIo,permissions:async()=>unexpectedOwner}),/permission/i,'reject an unapproved owner');
const extraIdentity=structuredClone(verifiedProviderGrants);extraIdentity[1].grantedToV2.application={id:'11111111-1111-4111-8111-111111111111'};
await assert.rejects(()=>checkedFolder(verifiedContext,{...verifiedIo,permissions:async()=>extraIdentity}),/permission/i,'reject an additional identity even with valid site metadata');
const wrongIdentityType=structuredClone(verifiedProviderGrants);wrongIdentityType[2].grantedToV2={user:{id:observedSiteOwner},siteUser:{id:'6',loginName:`i:0#.f|membership|${employeeUpn}`}};
await assert.rejects(()=>checkedFolder(verifiedContext,{...verifiedIo,permissions:async()=>wrongIdentityType}),/permission/i,'do not treat a user as the approved owner group');
await assert.rejects(()=>checkedFolder(verifiedContext,{...verifiedIo,permissions:async()=>verifiedProviderGrants.slice(0,2)}),/permission/i,'the configured owner group must be present');
let racedInvites=0;const raced={find:async()=>null,createEmpty:async()=>({id:'raced-folder',folder:{childCount:0}}),markCreated:async()=>{},wasCreatedByApp:async()=>true,grantPrivate:async()=>{racedInvites++},permissions:async()=>[],refresh:async()=>({id:'raced-folder',folder:{childCount:1}})};
await assert.rejects(()=>checkedFolder({adminGroupId:group,employeeId:employee},raced),/permission/i);
assert.equal(racedInvites,1,'do not retry a permission grant based on a stale empty-folder snapshot');
console.log('PASS: a timesheet folder is usable only after exact Admin and employee permissions are verified');
