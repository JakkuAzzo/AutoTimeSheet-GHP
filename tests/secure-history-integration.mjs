import assert from 'node:assert/strict';
import { listRecords } from '../cloudflare-worker/src/index.js';
const env={DB:{prepare(){return {bind(){return {all:async()=>({results:[]})}}}}},HISTORY_SOURCE:'sharepoint',HISTORY_UPSTREAM_URL:'https://legacy.example.test/flow',ENTRA_TENANT_ID:'cutover-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fake',SHAREPOINT_SITE_ID:'site-test',SHAREPOINT_DRIVE_ID:'drive-test',SHAREPOINT_TIMESHEET_LIST_ID:'list-test',STAFF_DIRECTORY_JSON:JSON.stringify([{name:'Alex',upn:'alex@example.test'},{name:'Blair',upn:'blair@example.test'}])};
const item=(id,email,name)=>({id,fields:{EmployeeName:name,Employee_x0020_Email:email,Source_x0020_Record_x0020_ID:id,Issue:JSON.stringify({rows:[{date:'2026-08-10',start:'09:00',finish:'17:00'}]})}});
let seen=[];const old=globalThis.fetch;
try {
 globalThis.fetch=async(url)=>{url=String(url);seen.push(url);if(url.includes('login.microsoftonline.com'))return Response.json({access_token:'fake',expires_in:3600});if(url.includes('graph.microsoft.com'))return Response.json({value:[item('a','alex@example.test','Alex'),item('b','blair@example.test','Blair')]});throw new Error('legacy source must never be called')};
 const own=await listRecords(new Request('https://portal.example.test/api/history?kind=all'),env,{oid:'alex-id',upn:'alex@example.test',name:'Alex'});
 assert.equal(own.meta.upstream,'ok');assert.deepEqual(own.records.map(r=>r.source_record_id),['a']);assert.ok(!JSON.stringify(own).includes('blair@example.test'));
 const admin=await listRecords(new Request('https://portal.example.test/api/history?kind=all'),env,{oid:'admin-id',upn:'admin@example.test',isSubmissionAdmin:true});
 assert.deepEqual(admin.records.map(r=>r.source_record_id).sort(),['a','b']);assert.ok(!seen.some(x=>x.includes('legacy.example.test')));
 globalThis.fetch=async()=>new Response('',{status:403});
 const failure=await listRecords(new Request('https://portal.example.test/api/history?kind=all'),env,{oid:'admin-id',upn:'admin@example.test',isSubmissionAdmin:true});
 assert.equal(failure.meta.upstream,'sharepoint-unavailable');assert.deepEqual(failure.records,[]);
 console.log('Protected history cutover: PASS');
} finally {globalThis.fetch=old}
