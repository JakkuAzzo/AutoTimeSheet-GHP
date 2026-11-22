import assert from 'node:assert/strict';
import * as access from '../cloudflare-worker/src/private-timesheet-access.js';
assert.equal(typeof access.ensurePrivateTimesheetWorkbook,'function','private workbook provisioning is available');
const admin='e0d972cd-46ed-4930-a9c6-51db65474f1f',employee='bb420999-c705-4dc2-9b0e-33846b43ae2c',owner='b89b71c6-ba9a-4712-bf29-57f50d1c2969';
const context={rootId:'private-root',adminGroupId:admin,employeeId:employee,employeeUpn:'employee@example.test',siteOwnerGroupId:owner,employeeName:'Example Employee',payMonth:'2026-10'};
const grants=[{roles:['write'],grantedToV2:{group:{id:admin}}},{roles:['write'],grantedToV2:{user:{id:employee}}},{roles:['owner'],grantedToV2:{group:{id:owner}}}];
function provider(){
  let folder=null,workbook=null,marker=null; const calls=[];
  return {calls,
    async permissions(id){return structuredClone(grants)},
    async findChild(parent,name){return parent==='private-root'?folder:workbook},
    async getMarker(){return marker},
    async reserve(){calls.push('reserve');if(marker)return false;marker={state:'reserved'};return true},
    async createFolder(parent,name){calls.push('createFolder');folder={id:'month-id',name,folder:{},parentReference:{id:parent}};return folder},
    async createBlankWorkbook(parent,name){calls.push('createBlank');workbook={id:'book-id',name,file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},parentReference:{id:parent}};return workbook},
    async verifyBlank(id){calls.push('verifyBlank');return id==='book-id'},
    async markReady(value){calls.push('markReady');marker={state:'ready',...value}},
    forceMarker(value){marker=value},forceWorkbook(value){workbook=value}
  };
}
const io=provider();
const result=await access.ensurePrivateTimesheetWorkbook(context,io);
assert.equal(result.workbookId,'book-id');
assert.deepEqual(io.calls,['reserve','createFolder','createBlank','verifyBlank','markReady']);
assert.equal((await access.ensurePrivateTimesheetWorkbook(context,io)).workbookId,'book-id');
assert.deepEqual(io.calls,['reserve','createFolder','createBlank','verifyBlank','markReady'],'existing marked workbook is never overwritten');
const untrusted=provider();untrusted.permissions=async()=>[...grants,{roles:['read'],link:{scope:'organization'}}];
await assert.rejects(access.ensurePrivateTimesheetWorkbook(context,untrusted),/workbook|permission|destination/i);
assert.deepEqual(untrusted.calls,[],'do not reserve or create under a broad employee folder');
const interrupted=provider();interrupted.verifyBlank=async()=>false;
await assert.rejects(access.ensurePrivateTimesheetWorkbook(context,interrupted),/workbook|permission|destination/i);
await assert.rejects(access.ensurePrivateTimesheetWorkbook(context,interrupted),/workbook|permission|destination|pending/i);
assert.equal(interrupted.calls.filter(x=>x==='createBlank').length,1,'an ambiguous attempt cannot overwrite or create another file');
const unknown=provider();unknown.forceWorkbook({id:'unmarked',name:'GMT Timesheet - Example Employee - Pay Month 2026-10.xlsx',file:{},parentReference:{id:'month-id'}});
await assert.rejects(access.ensurePrivateTimesheetWorkbook(context,unknown),/workbook|permission|destination/i);
assert.ok(!unknown.calls.includes('createBlank'),'an existing unmarked workbook is never overwritten');
const changed=provider();const originalPermissions=changed.permissions;changed.permissions=async id=>id==='book-id'?[...grants,{roles:['read'],link:{scope:'organization'}}]:originalPermissions(id);
await assert.rejects(access.ensurePrivateTimesheetWorkbook(context,changed),/workbook|permission|destination/i);
assert.ok(!changed.calls.includes('markReady'),'unexpected workbook access prevents the creation marker becoming ready');
const concurrent=provider();const createFolder=concurrent.createFolder;let unblock,started;
const inFolder=new Promise(resolve=>{started=resolve}),gate=new Promise(resolve=>{unblock=resolve});
concurrent.createFolder=async(...args)=>{started();await gate;return createFolder(...args)};
const first=access.ensurePrivateTimesheetWorkbook(context,concurrent);await inFolder;
await assert.rejects(access.ensurePrivateTimesheetWorkbook(context,concurrent),/workbook|permission|destination/i);
unblock();assert.equal((await first).workbookId,'book-id');
assert.equal(concurrent.calls.filter(x=>x==='createBlank').length,1,'concurrent requests cannot create two workbooks');
console.log('PASS: private workbook creation is reserved, blank-verified and never overwrites');
