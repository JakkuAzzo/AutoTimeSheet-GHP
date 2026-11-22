import assert from 'node:assert/strict';
import { listRecords } from '../cloudflare-worker/src/index.js';
const env={DB:{prepare(){return {bind(){return {all:async()=>({results:[]})}}}}},HISTORY_SOURCE:'sharepoint',HISTORY_UPSTREAM_URL:'https://legacy.example.test/flow',ENTRA_TENANT_ID:'cutover-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fake',SHAREPOINT_SITE_ID:'site-test',SHAREPOINT_DRIVE_ID:'drive-test',SHAREPOINT_TIMESHEET_LIST_ID:'list-test',STAFF_DIRECTORY_JSON:JSON.stringify([{name:'Alex',upn:'alex@example.test'},{name:'Blair',upn:'blair@example.test'}])};
const item=(id,email,name)=>({id,fields:{EmployeeName:name,Employee_x0020_Email:email,Source_x0020_Record_x0020_ID:id,Issue:JSON.stringify({rows:[{date:'2026-08-10',start:'09:00',finish:'17:00'}]})}});
let seen=[];const old=globalThis.fetch;
try {
 const mixed=item('mixed','alex@example.test','Alex');mixed.fields.Issue=JSON.stringify({rows:[{date:'2026-08-11',start:'09:00',finish:'17:00',employeeEmail:'alex@example.test'},{date:'2026-08-11',start:'09:00',finish:'17:00',employeeEmail:'blair@example.test'}]});
 const nameOnly=item('name-only','','Alex');nameOnly.fields.Issue=JSON.stringify({rows:[{date:'2026-08-14',start:'09:00',finish:'17:00'}]});
 globalThis.fetch=async(url)=>{url=String(url);seen.push(url);if(url.includes('login.microsoftonline.com'))return Response.json({access_token:'fake',expires_in:3600});if(url.includes('graph.microsoft.com'))return Response.json({value:[item('a','alex@example.test','Alex'),item('b','blair@example.test','Blair'),nameOnly,mixed]});throw new Error('legacy source must never be called')};
 const own=await listRecords(new Request('https://portal.example.test/api/history?kind=all'),env,{oid:'alex-id',upn:'alex@example.test',name:'Alex'});
 assert.equal(own.meta.upstream,'ok');assert.deepEqual(own.records.map(r=>r.source_record_id),['a']);assert.ok(!JSON.stringify(own).includes('blair@example.test'));
 const admin=await listRecords(new Request('https://portal.example.test/api/history?kind=all'),env,{oid:'admin-id',upn:'admin@example.test',isSubmissionAdmin:true});
 assert.deepEqual(admin.records.map(r=>r.source_record_id).sort(),['a','b','mixed','name-only']);assert.ok(!seen.some(x=>x.includes('legacy.example.test')));
 const first=item('source-one','alex@example.test','Alex'),second=item('source-two','alex@example.test','Alex');
 first.fields.Source_x0020_Record_x0020_ID=second.fields.Source_x0020_Record_x0020_ID='fictional-shared-id';
 first.fields.Issue=JSON.stringify({rows:[{date:'2026-08-10',start:'09:00',finish:'17:00',breakMinutes:60}]});
 second.fields.Issue=JSON.stringify({rows:[{date:'2026-08-10',start:'09:00',finish:'18:00',breakMinutes:60}]});
 globalThis.fetch=async(url)=>String(url).includes('login.microsoftonline.com')?Response.json({access_token:'fake',expires_in:3600}):Response.json({value:[first,second]});
 await assert.rejects(()=>listRecords(new Request('https://portal.example.test/api/history?kind=timesheets'),env,{oid:'admin-id',upn:'admin@example.test',isSubmissionAdmin:true}),error=>error.status===409&&/review/i.test(error.message));
 first.fields.Source_x0020_Record_x0020_ID='fictional-message-one';second.fields.Source_x0020_Record_x0020_ID='fictional-message-two';
 first.fields.Issue=JSON.stringify({rows:[{recordId:'fictional-day-id',date:'2026-08-10',start:'09:00',finish:'17:00',breakMinutes:60}]});
 second.fields.Issue=JSON.stringify({rows:[{recordId:'fictional-day-id',date:'2026-08-10',start:'09:00',finish:'18:00',breakMinutes:60}]});
 await assert.rejects(()=>listRecords(new Request('https://portal.example.test/api/history?kind=timesheets'),env,{oid:'admin-id',upn:'admin@example.test',isSubmissionAdmin:true}),error=>error.status===409&&/review/i.test(error.message));
 globalThis.fetch=async()=>new Response('',{status:403});
 const failure=await listRecords(new Request('https://portal.example.test/api/history?kind=all'),env,{oid:'admin-id',upn:'admin@example.test',isSubmissionAdmin:true});
 assert.equal(failure.meta.upstream,'sharepoint-unavailable');assert.deepEqual(failure.records,[]);
 console.log('Protected history cutover: PASS');
} finally {globalThis.fetch=old}
