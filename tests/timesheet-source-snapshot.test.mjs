import test from 'node:test';
import assert from 'node:assert/strict';
import * as worker from '../cloudflare-worker/src/index.js';

const env={ENTRA_TENANT_ID:'snapshot-fixture-tenant',SHAREPOINT_GRAPH_CLIENT_ID:'snapshot-fixture-client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fictional',
  SHAREPOINT_SITE_ID:'tenant.example,site,web',SHAREPOINT_DRIVE_ID:'drive',SHAREPOINT_TIMESHEET_LIST_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const base=`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(env.SHAREPOINT_SITE_ID)}/lists/${env.SHAREPOINT_TIMESHEET_LIST_ID}/items`;
const item=(id,etag,value)=>({id,eTag:etag,fields:{EmployeeName:'Fictional',Issue:value}});
const previous=globalThis.fetch;
let mode,scans,requests;
function reset(value){mode=value;scans=0;requests=[];}
globalThis.fetch=async (value,opts={})=>{
  const url=String(value);requests.push({url,redirect:opts.redirect});
  if(url.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fictional',expires_in:3600});
  if(!url.startsWith(base))throw new Error('Unexpected or unsafe destination');
  if(!url.includes('$skiptoken')) {
    scans++;
    if(mode==='unavailable')return new Response('',{status:503});
    if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://attacker.example/'}});
    if(mode==='malformed')return Response.json({value:[{id:'1',fields:{Issue:'unversioned'}}]});
    if(mode==='unsafe-link')return Response.json({value:[item('1','"a"','first')],'@odata.nextLink':'https://attacker.example/steal'});
    if(mode==='wrong-list')return Response.json({value:[item('1','"a"','first')],'@odata.nextLink':base+'/../other/items?$skiptoken=next'});
    if(mode==='cycle')return Response.json({value:[item('1','"a"','first')],'@odata.nextLink':base+'?$skiptoken=cycle'});
    if(mode==='missing-items'&&scans===2)return Response.json({value:[item('1','"a"','first')]});
    const value1=mode==='fields-change'&&scans===2?'changed':'first';
    const tag=mode==='tag-change'&&scans===2?'"new"':'"a"';
    return Response.json({value:[item('1',tag,value1)],'@odata.nextLink':base+'?$skiptoken=next'});
  }
  if(mode==='cycle')return Response.json({value:[],'@odata.nextLink':base+'?$skiptoken=cycle'});
  if(mode==='duplicate')return Response.json({value:[item('1','"a"','first')]});
  return Response.json({value:[item('2','"b"','second')]});
};

test('a complete provider inventory is read twice and is stable across pages',async()=>{
  reset('normal');assert.equal(typeof worker.readCompleteTimesheetSourceSnapshot,'function','provider source inventory must exist');
  const snapshot=await worker.readCompleteTimesheetSourceSnapshot(env);
  assert.deepEqual(snapshot.items.map(x=>x.itemId),['1','2']);assert.match(snapshot.fingerprint,/^[a-f0-9]{64}$/);assert.equal(scans,2);
  assert.ok(requests.filter(x=>x.url.startsWith(base)).every(x=>x.redirect==='manual'),'provider redirects are not followed');
});
for(const kind of ['fields-change','tag-change','missing-items'])test(`provider inventory rejects ${kind} between reads`,async()=>{
  reset(kind);assert.equal(typeof worker.readCompleteTimesheetSourceSnapshot,'function');
  await assert.rejects(()=>worker.readCompleteTimesheetSourceSnapshot(env),error=>error.status===409);
});
for(const kind of ['unsafe-link','wrong-list','cycle','duplicate','malformed','unavailable','redirect'])test(`provider inventory fails closed for ${kind}`,async()=>{
  reset(kind);assert.equal(typeof worker.readCompleteTimesheetSourceSnapshot,'function');
  await assert.rejects(()=>worker.readCompleteTimesheetSourceSnapshot(env),error=>error.status===503);
  assert.ok(!requests.some(x=>x.url.startsWith('https://attacker.example/')),'no credentials are sent to a continuation or redirect host');
});
process.on('exit',()=>{globalThis.fetch=previous});
