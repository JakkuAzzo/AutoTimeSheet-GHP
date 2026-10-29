import assert from 'node:assert/strict';
import { listRecords } from '../cloudflare-worker/src/index.js';
const env={DB:{prepare(){return {bind(){return {all:async()=>({results:[]})}}}}},ENTRA_TENANT_ID:'probe-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'probe-client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fake',SHAREPOINT_SITE_ID:'site-test',SHAREPOINT_DRIVE_ID:'drive-test',SHAREPOINT_TIMESHEET_LIST_ID:'list-test'};
const request=()=>new Request('https://portal.example.test/api/history?kind=all&source=sharepoint-check');
const before=globalThis.fetch;
try {
 let calls=0;
 globalThis.fetch=async(url)=>{calls++;if(String(url).includes('login.microsoftonline.com'))return Response.json({access_token:'fake',expires_in:3600});return Response.json({value:[{id:'a',fields:{EmployeeName:'Alex',Employee_x0020_Email:'alex@example.test',Source_x0020_Record_x0020_ID:'historical-1',Issue:JSON.stringify({rows:[{date:'2024-01-01',start:'09:00',finish:'17:00'}]})}}]})};
 await assert.rejects(()=>listRecords(request(),env,{oid:'other',upn:'other@example.test'}),/access|authori|admin/i);
 assert.equal(calls,0,'non-admin probe must not call Microsoft Graph');
 const result=await listRecords(request(),env,{oid:'admin',upn:'admin@example.test',isSubmissionAdmin:true});
 assert.equal(result.meta.upstream,'ok');
 assert.ok(result.records.some(r=>r.source_record_id==='historical-1'));
 assert.ok(calls>0);
 console.log('Secure history diagnostic access: PASS');
}finally{globalThis.fetch=before}
