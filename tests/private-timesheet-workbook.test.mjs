import assert from 'node:assert/strict';
import * as route from '../cloudflare-worker/src/private-timesheet-access.js';

assert.equal(typeof route.verifyPrivateTimesheetWorkbook,'function','the workbook verifier exists');
const admin='e0d972cd-46ed-4930-a9c6-51db65474f1f',employee='bb420999-c705-4dc2-9b0e-33846b43ae2c',owner='b89b71c6-ba9a-4712-bf29-57f50d1c2969';
const settings={rootId:'private-root',adminGroupId:admin,employeeId:employee,employeeUpn:'employee@example.test',siteOwnerGroupId:owner,employeeName:'Example Employee',payMonth:'2026-10'};
const filename='GMT Timesheet - Example Employee - Pay Month 2026-10.xlsx';
const permissions=[{roles:['write'],grantedToV2:{group:{id:admin}}},{roles:['write'],grantedToV2:{user:{id:employee}}},{roles:['owner'],grantedToV2:{group:{id:owner}}}];
const items={ 'private-root':{id:'private-root',folder:{}}, 'month-folder':{id:'month-folder',name:'2026-10',folder:{},parentReference:{id:'private-root'}}, 'workbook':{id:'workbook',name:filename,file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},parentReference:{id:'month-folder'}} };
const io={findChild:async(parent,name)=>parent==='private-root'&&name==='2026-10'?items['month-folder']:parent==='month-folder'&&name===filename?items.workbook:null,permissions:async()=>structuredClone(permissions)};
assert.deepEqual(await route.verifyPrivateTimesheetWorkbook(settings,io),{folderId:'month-folder',workbookId:'workbook',fileName:filename});
await assert.rejects(route.verifyPrivateTimesheetWorkbook({...settings,employeeName:'../Other'},io),/workbook|permission|destination/i);
await assert.rejects(route.verifyPrivateTimesheetWorkbook(settings,{...io,findChild:async(parent,name)=>parent==='private-root'?{...items['month-folder'],parentReference:{id:'other-root'}}:items.workbook}),/workbook|permission|destination/i);
await assert.rejects(route.verifyPrivateTimesheetWorkbook(settings,{...io,permissions:async id=>id==='workbook'?[...permissions,{roles:['read'],link:{scope:'organization'}}]:permissions}),/workbook|permission|destination/i);
await assert.rejects(route.verifyPrivateTimesheetWorkbook(settings,{...io,permissions:async id=>id==='month-folder'?permissions.slice(0,2):permissions}),/workbook|permission|destination/i);
await assert.rejects(route.verifyPrivateTimesheetWorkbook(settings,{...io,findChild:async(parent,name)=>parent==='private-root'?items['month-folder']:null}),/workbook|permission|destination/i);
const parentId='private-parent';
const inheritedRoot=permissions.map(p=>({...p,inheritedFrom:{}}));
const withParent={...io,metadata:async()=>({id:'private-root',folder:{},parentReference:{id:parentId}}),
  permissions:async id=>id===parentId?[permissions[0],permissions[2]]:id==='private-root'?inheritedRoot:permissions};
assert.equal((await route.verifyPrivateTimesheetWorkbook({...settings,parentId},withParent)).workbookId,'workbook',
  'the employee folder may inherit only from its verified private parent');
await assert.rejects(route.verifyPrivateTimesheetWorkbook({...settings,parentId},{...withParent,metadata:async()=>({id:'private-root',folder:{},parentReference:{id:'different-parent'}})}),/permission/i);
await assert.rejects(route.verifyPrivateTimesheetWorkbook({...settings,parentId},{...withParent,permissions:async id=>id===parentId?[permissions[0],permissions[1],permissions[2]]:permissions}),/permission/i);
console.log('PASS: private workbook routing checks identity, ancestry and each item permission');
