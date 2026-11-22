const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied=()=>Object.assign(new Error('The private timesheet folder permissions could not be verified.'),{status:503});
function identities(permission,employeeUpn,admin,employee,owner){
  const modern=[permission?.grantedToV2,...(Array.isArray(permission?.grantedToIdentitiesV2)?permission.grantedToIdentitiesV2:[])].filter(Boolean);
  if(modern.some(grant=>{
    const user=String(grant.user?.id||'').toLowerCase(),group=String(grant.group?.id||'').toLowerCase();
    return (user && user!==employee)||(group && group!==admin && group!==owner)||(user && group);
  }))return null;
  const grants=[permission?.grantedToV2,permission?.grantedTo,...(Array.isArray(permission?.grantedToIdentitiesV2)?permission.grantedToIdentitiesV2:[]),...(Array.isArray(permission?.grantedToIdentities)?permission.grantedToIdentities:[])].filter(Boolean);
  if(grants.some(grant=>Object.keys(grant).some(key=>!['user','group','siteUser','@odata.type'].includes(key) && grant[key]!=null)))return null;
  for(const grant of grants){
    if(!grant.siteUser)continue;
    const user=String(grant.user?.id||'').toLowerCase(),group=String(grant.group?.id||'').toLowerCase();
    const login=String(grant.siteUser.loginName||'').toLowerCase();
    if(Boolean(user)===Boolean(group))return null;
    if(user && (!employeeUpn || login!==`i:0#.f|membership|${employeeUpn}`))return null;
    if(group && login!==`c:0t.c|tenant|${group}` && login!==`c:0o.c|federateddirectoryclaimprovider|${group}_o`)return null;
  }
  return [...new Set(grants.flatMap(grant=>[grant.user?.id,grant.group?.id]).filter(Boolean).map(value=>String(value).toLowerCase()))];
}
export async function ensurePrivateTimesheetFolder({adminGroupId,employeeId,employeeUpn,siteOwnerGroupId,parentId},io){
  const admin=String(adminGroupId||'').toLowerCase(),employee=String(employeeId||'').toLowerCase();
  const owner=String(siteOwnerGroupId||'').toLowerCase(),upn=String(employeeUpn||'').trim().toLowerCase();
  const parent=String(parentId||'');
  if(!UUID.test(admin)||!UUID.test(employee)||!UUID.test(owner)||new Set([admin,employee,owner]).size!==3||!upn||!parent||typeof io.verifyParent!=='function')throw denied();
  await io.verifyParent(parent);
  const path='Submitted Documents/Timesheets/'+employee;
  let folder=await io.find(path);
  if(!folder){folder=await io.createEmpty(path);if(!folder?.id||!folder.folder||folder.parentReference?.id!==parent)throw denied();await io.markCreated(folder.id,employee,admin);await io.verifyParent(parent);await io.grantPrivate(folder.id,[employee],{retainInheritedPermissions:true});}
  else if(!folder?.id||!await io.wasCreatedByApp(folder.id,employee,admin))throw denied();
  if(!folder.id||!folder.folder||folder.parentReference?.id!==parent)throw denied();
  const permissions=await io.permissions(folder.id);
  if(!permissionsArePrivate(permissions,admin,employee,owner,upn,true))throw denied();
  await io.verifyParent(parent);
  return {id:folder.id,path};
}
export function verifyPrivateTimesheetParent(context,permissions,options={}){
  const admin=String(context?.adminGroupId||'').toLowerCase(),owner=String(context?.siteOwnerGroupId||'').toLowerCase();
  if(!UUID.test(admin)||!UUID.test(owner)||admin===owner||!Array.isArray(permissions)||!permissions.length)throw denied();
  let adminWrite=false,ownerSeen=false;
  for(const permission of permissions){
    const ids=identities(permission,'',admin,'',owner);
    const inherited=permission?.inheritedFrom;
    if(permission?.link||(inherited && (!Array.isArray(options.inheritedFromIds)||!options.inheritedFromIds.includes(String(inherited.id||''))))||!ids?.length||ids.some(id=>id!==admin&&id!==owner)||!Array.isArray(permission.roles)||!permission.roles.length)throw denied();
    if(ids.includes(owner)){if(ids.length!==1||permission.roles.some(role=>role!=='owner'))throw denied();ownerSeen=true;}
    else {if(permission.roles.some(role=>role!=='read'&&role!=='write'))throw denied();if(permission.roles.includes('write'))adminWrite=true;}
  }
  if(!adminWrite||!ownerSeen)throw denied();
}
// For an explicitly pinned test hierarchy only, Graph may report inherited
// permissions without an ancestor ID. Verify the exact parent link and the
// anchor's direct, private permissions before accepting those empty markers.
export async function verifyPinnedInheritedParent(context,parentId,anchorId,io){
  if(!parentId||!anchorId||parentId===anchorId||typeof io?.metadata!=='function'||typeof io?.permissions!=='function')throw denied();
  for(let pass=0;pass<2;pass++){
    const parent=await io.metadata(parentId);
    if(parent?.id!==parentId||!parent.folder||parent.file||parent.remoteItem||parent.parentReference?.id!==anchorId)throw denied();
    verifyPrivateTimesheetParent(context,await io.permissions(anchorId));
    verifyPrivateTimesheetParent(context,await io.permissions(parentId),{inheritedFromIds:['',anchorId]});
  }
}
function permissionsArePrivate(permissions,admin,employee,owner,upn,allowInherited=false){
  if(!Array.isArray(permissions)||!permissions.length)return false;
  const allowed=new Set([admin,employee,...(owner?[owner]:[])]),seen=new Set(),writable=new Set();
  for(const permission of permissions){
    const ids=identities(permission,upn,admin,employee,owner);
    if(permission?.link||(!allowInherited&&permission?.inheritedFrom)||!ids?.length||ids.some(id=>!allowed.has(id))||!Array.isArray(permission.roles)||!permission.roles.length)return false;
    if(ids.includes(owner)){if(!owner||ids.length!==1||permission.roles.some(role=>role!=='owner'))return false;}
    else if(permission.roles.some(role=>role!=='read'&&role!=='write'))return false;
    ids.forEach(id=>seen.add(id));
    if(permission.roles.includes('write'))ids.forEach(id=>writable.add(id));
  }
  return seen.has(admin)&&seen.has(employee)&&writable.has(admin)&&writable.has(employee)&&(!owner||seen.has(owner));
}

// Checks the returned permission entries only. It does not resolve group
// membership, administrative bypass, hidden grants or effective access.
export function verifyPrivateCandidatePermissionListing(context,permissions){
  const admin=String(context?.adminGroupId||'').toLowerCase(),employee=String(context?.employeeId||'').toLowerCase();
  const owner=String(context?.siteOwnerGroupId||'').toLowerCase(),writer=String(context?.stagingWriterId||'').toLowerCase();
  const upn=String(context?.employeeUpn||'').trim().toLowerCase();
  if(![admin,employee,owner,writer].every(id=>UUID.test(id))||new Set([admin,employee,owner,writer]).size!==4||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(upn)||!Array.isArray(permissions)||permissions.length>100||
     !permissionsArePrivate(permissions,admin,employee,owner,upn,true))throw denied();
}

// Verify exact direct ancestry and each item's effective permission listing.
// A missing workbook stays missing: this read-only resolver never creates or
// overwrites an employee's file.
function workbookContext(context){
  const admin=String(context?.adminGroupId||'').toLowerCase(),employee=String(context?.employeeId||'').toLowerCase();
  const owner=String(context?.siteOwnerGroupId||'').toLowerCase(),upn=String(context?.employeeUpn||'').trim().toLowerCase();
  const root=String(context?.rootId||''),month=String(context?.payMonth||''),name=String(context?.employeeName||'').trim();
  if(!UUID.test(admin)||!UUID.test(employee)||!UUID.test(owner)||new Set([admin,employee,owner]).size!==3||!upn||
     !root||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!name||name.length>150||/[\\/<>:"|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name))throw denied();
  const fileName=`GMT Timesheet - ${name} - Pay Month ${month}.xlsx`;
  return {admin,employee,owner,upn,root,month,fileName};
}
async function checkWorkbookParent(context,io,root){
  const parent=String(context?.parentId||'');
  if(!parent)return false;
  if(typeof io.metadata!=='function')throw denied();
  if(typeof io.verifyParent==='function')await io.verifyParent(parent);
  else verifyPrivateTimesheetParent(context,await io.permissions(parent));
  const folder=await io.metadata(root);
  if(folder?.id!==root||!folder.folder||folder.file||folder.remoteItem||folder.parentReference?.id!==parent)throw denied();
  return true;
}
export async function verifyPrivateTimesheetWorkbook(context,io){
  const {admin,employee,owner,upn,root,month,fileName}=workbookContext(context);
  const check=async(id,inherited)=>{const grants=await io.permissions(id);if(!permissionsArePrivate(grants,admin,employee,owner,upn,inherited))throw denied();};
  const inheritedRoot=await checkWorkbookParent(context,io,root);
  await check(root,inheritedRoot);
  const folder=await io.findChild(root,month);
  if(!folder?.id||folder.name!==month||!folder.folder||folder.file||folder.remoteItem||folder.parentReference?.id!==root)throw denied();
  await check(folder.id,true);
  const workbook=await io.findChild(folder.id,fileName);
  if(!workbook?.id||workbook.name!==fileName||!workbook.file||workbook.folder||workbook.remoteItem||workbook.parentReference?.id!==folder.id||
     (workbook.file.mimeType&&workbook.file.mimeType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw denied();
  await check(workbook.id,true);
  await check(root,inheritedRoot);
  await checkWorkbookParent(context,io,root);
  return {folderId:folder.id,workbookId:workbook.id,fileName};
}

// Reserve one employee/month before creating an empty, application-owned
// workbook. Ambiguous attempts deliberately remain reserved for review.
export async function ensurePrivateTimesheetWorkbook(context,io){
  const {admin,employee,owner,upn,root,month,fileName}=workbookContext(context);
  const check=async(id,inherited)=>{if(!permissionsArePrivate(await io.permissions(id),admin,employee,owner,upn,inherited))throw denied();};
  const inheritedRoot=await checkWorkbookParent(context,io,root);
  await check(root,inheritedRoot);
  const marker=await io.getMarker(employee,month);
  if(marker){
    if(marker.state!=='ready'||marker.employeeId!==employee||marker.payMonth!==month||marker.rootId!==root)throw denied();
    const verified=await verifyPrivateTimesheetWorkbook(context,io);
    if(marker.folderId!==verified.folderId||marker.workbookId!==verified.workbookId||marker.fileName!==verified.fileName)throw denied();
    return verified;
  }
  if(!await io.reserve({employeeId:employee,payMonth:month,rootId:root,fileName}))throw denied();
  let folder=await io.findChild(root,month);
  if(!folder){
    const created=await io.createFolder(root,month);
    if(!created?.id)throw denied();
    folder=await io.findChild(root,month);
    if(folder?.id!==created.id)throw denied();
  }
  if(!folder?.id||folder.name!==month||!folder.folder||folder.file||folder.remoteItem||folder.parentReference?.id!==root)throw denied();
  await checkWorkbookParent(context,io,root);await check(root,inheritedRoot);await check(folder.id,true);
  if(await io.findChild(folder.id,fileName))throw denied();
  const created=await io.createBlankWorkbook(folder.id,fileName);
  if(!created?.id)throw denied();
  const found=await io.findChild(folder.id,fileName);
  if(found?.id!==created.id)throw denied();
  const verified=await verifyPrivateTimesheetWorkbook(context,io);
  if(verified.folderId!==folder.id||verified.workbookId!==created.id||!await io.verifyBlank(created.id,created))throw denied();
  await io.markReady({employeeId:employee,payMonth:month,rootId:root,folderId:folder.id,workbookId:created.id,fileName});
  const saved=await io.getMarker(employee,month);
  if(saved?.state!=='ready'||saved.rootId!==root||saved.folderId!==folder.id||saved.workbookId!==created.id||saved.fileName!==fileName)throw denied();
  return verified;
}
