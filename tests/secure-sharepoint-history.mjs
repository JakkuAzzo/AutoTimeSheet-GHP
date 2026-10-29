import assert from 'node:assert/strict';
import * as worker from '../cloudflare-worker/src/index.js';

assert.equal(typeof worker.readSharePointHistory, 'function', 'history must be read from SharePoint through the authorised portal');
const env = { ENTRA_TENANT_ID: 'tenant-test', SHAREPOINT_GRAPH_CLIENT_ID: 'client-test', SHAREPOINT_GRAPH_CLIENT_SECRET: 'fake', SHAREPOINT_SITE_ID: 'site-test', SHAREPOINT_DRIVE_ID: 'drive-test', SHAREPOINT_TIMESHEET_LIST_ID: 'list-test', STAFF_DIRECTORY_JSON: JSON.stringify([{ name:'Alex', upn:'alex@example.test' },{ name:'Blair', upn:'blair@example.test' }]) };
const row = (id, email, name, date) => ({ id, fields: { EmployeeName:name, Employee_x0020_Email:email, Source_x0020_Record_x0020_ID:id, Issue:JSON.stringify({rows:[{date,start:'09:00',finish:'17:00',lunchMinutes:30}]}) } });
let requests = [];
const oldFetch = globalThis.fetch;
try {
 globalThis.fetch = async (url, init) => {
  requests.push({url:String(url),method:init?.method || 'GET'});
  if (String(url).startsWith('https://login.microsoftonline.com/')) return Response.json({access_token:'synthetic-token',expires_in:3600});
  if (String(url).includes('$skiptoken=')) return Response.json({value:[row('older','alex@example.test','Alex','2024-01-01')]});
  return Response.json({value:[row('alex','alex@example.test','Alex','2026-08-10'),row('blair','blair@example.test','Blair','2026-08-10'),row('noemail','','Alex','2026-08-11'),row('unknown','','','2026-08-10')], '@odata.nextLink':'https://graph.microsoft.com/v1.0/sites/site-test/lists/list-test/items?$skiptoken=next'});
 };
 const employee = await worker.readSharePointHistory(env,{upn:'alex@example.test',name:'Alex'});
 assert.deepEqual(employee.records.map(r=>r.source_record_id).sort(),['alex','noemail','older']);
 assert.ok(!JSON.stringify(employee).includes('blair@example.test'), 'other staff records never enter the response');
 assert.equal(employee.records.find(r=>r.source_record_id==='older').payload.rows[0].date,'2024-01-01');
 assert.equal(requests.filter(r=>r.url.includes('graph.microsoft.com')).length,2);
 const admin = await worker.readSharePointHistory(env,{isSubmissionAdmin:true,upn:'admin@example.test'});
 assert.deepEqual(admin.records.map(r=>r.source_record_id).sort(),['alex','blair','noemail','older']);
 globalThis.fetch = async (url) => String(url).includes('graph.microsoft.com') ? Response.json({value:[], '@odata.nextLink':'https://attacker.invalid/steal'}) : Response.json({access_token:'fake',expires_in:3600});
 await assert.rejects(()=>worker.readSharePointHistory({...env,ENTRA_TENANT_ID:'other-tenant'}, {isSubmissionAdmin:true}), /continuation/i);
 globalThis.fetch = async (url) => String(url).includes('graph.microsoft.com') ? new Response('',{status:403}) : Response.json({access_token:'fake',expires_in:3600});
 await assert.rejects(()=>worker.readSharePointHistory({...env,ENTRA_TENANT_ID:'third-tenant'}, {isSubmissionAdmin:true}), /history/i);
 assert.ok(requests.every(r=>r.method==='GET'||r.url.startsWith('https://login.microsoftonline.com/')), 'source data must only be read');
 console.log('Protected SharePoint history: PASS');
} finally { globalThis.fetch = oldFetch; }
{
 const old=globalThis.fetch; let graphInit;
 try {
  globalThis.fetch=async(url,init)=>{if(String(url).includes('login.microsoftonline.com'))return Response.json({access_token:'fake',expires_in:3600}); graphInit=init; return new Response('',{status:302,headers:{Location:'https://attacker.invalid'}})};
  await assert.rejects(()=>worker.readSharePointHistory({...env,ENTRA_TENANT_ID:'redirect-tenant'}, {isSubmissionAdmin:true}),/HTTP 302/);
  assert.equal(graphInit.redirect,'manual','redirects must be inspected without following or forwarding tokens');
 } finally {globalThis.fetch=old}
}
{
 const old=globalThis.fetch;
 try {
  globalThis.fetch=async(url)=>String(url).includes('login.microsoftonline.com') ? Response.json({access_token:'fake',expires_in:3600}) : Response.json({value:[row('ambiguous','','Alex','2026-08-11'),{id:'conflict',fields:{EmployeeName:'Alex',Employee_x0020_Email:'alex@example.test',Source_x0020_Record_x0020_ID:'conflict',Issue:JSON.stringify({rows:[{date:'2026-08-12',start:'09:00',finish:'17:00',employeeEmail:'blair@example.test'}]})}}]});
  const ambiguousEnv={...env,ENTRA_TENANT_ID:'ambiguous-tenant',STAFF_DIRECTORY_JSON:JSON.stringify([{name:'Alex',upn:'alex@example.test'},{name:'Alex',upn:'other@example.test'}])};
  const response=await worker.readSharePointHistory(ambiguousEnv,{upn:'alex@example.test',name:'Alex'});
  assert.deepEqual(response.records,[],'ambiguous identities and conflicting embedded owners fail closed');
 } finally {globalThis.fetch=old}
}
