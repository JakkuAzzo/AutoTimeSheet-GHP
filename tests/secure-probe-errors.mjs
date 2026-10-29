import assert from 'node:assert/strict';
import {listRecords} from '../cloudflare-worker/src/index.js';
const env={DB:{prepare(){return {bind(){return {all:async()=>({results:[]})}}}}},ENTRA_TENANT_ID:'error-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fake',SHAREPOINT_SITE_ID:'site-test',SHAREPOINT_DRIVE_ID:'drive-test',SHAREPOINT_TIMESHEET_LIST_ID:'list-test'};
const old=globalThis.fetch;
try {
 globalThis.fetch=async()=>new Response('',{status:401});
 await assert.rejects(()=>listRecords(new Request('https://example.test/api/history?source=sharepoint-check'),env,{upn:'admin@example.test',isSubmissionAdmin:true}),err=>err.status===503 && /authentication failed/i.test(err.publicMessage||''));
 console.log('History probe diagnostic errors: PASS');
} finally {globalThis.fetch=old}
try {
 globalThis.fetch=async(url)=>String(url).includes('login.microsoftonline.com') ? Response.json({access_token:'fake',expires_in:3600}) : Promise.reject(new TypeError('private detail must not leak'));
 await assert.rejects(()=>listRecords(new Request('https://example.test/api/history?source=sharepoint-check'),{...env,ENTRA_TENANT_ID:'error-tenant-two'},{upn:'admin@example.test',isSubmissionAdmin:true}),err=>/request.*TypeError/i.test(err.publicMessage||'') && !/private detail/.test(err.publicMessage||''));
} finally {globalThis.fetch=old}
