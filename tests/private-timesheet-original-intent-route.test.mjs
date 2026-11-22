import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../cloudflare-worker/src/index.js';

const tenant='11c20f5b-e3a8-4a89-8577-b3def40a2691', audience='19cc3daf-695d-43dc-bd49-54d699fb22c4';
const admin='19cbfba9-0a68-439f-a3c8-651fdc26728a',employee='1b9f99d4-7980-4f1d-927a-875221d4320a',other='1a9f99d4-7980-4f1d-927a-875221d4320a';
const source='a'.repeat(64), date='2026-10-05';
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='original-intent-test';jwk.use='sig';
const b64=x=>Buffer.from(x).toString('base64url');
async function token(oid,upn){const unsigned=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud:audience,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid,preferred_username:upn}));return unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));}
const adminToken=await token(admin,'admin@example.test'),otherToken=await token(other,'other@example.test');
const savedFetch=globalThis.fetch;
let directory={id:employee,userPrincipalName:'employee@example.test'}, duringLookup=null;
globalThis.fetch=async url=>{const value=String(url);if(value.includes('/discovery/v2.0/keys'))return Response.json({keys:[jwk]});if(value.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fixture',expires_in:3600});if(value.startsWith('https://graph.microsoft.com/v1.0/users/')){if(duringLookup){const fn=duringLookup;duringLookup=null;fn();}return Response.json(directory)}throw Error('Unexpected network request')};
function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  const payload=JSON.stringify({payMonth:'2026-10',rows:[{date,sourceEvidence:{sourceId:source}}]});
  db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES('r1',?,'employee@example.test','Fictional','timesheets','pay_month_correction','Submitted','t','t',?)`).run(employee,payload);
  db.prepare("INSERT INTO private_timesheet_subjects VALUES('employee@example.test',?,'t')").run(employee);
  const wrap=(sql,args=[])=>({async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}}});
  const DB={prepare(sql){return {...wrap(sql),bind(...args){return wrap(sql,args)}}}};
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:audience,SUBMISSIONS_ADMIN_UPNS:'admin@example.test',DOCUMENT_IMPORT_DIRECTORY_JSON:JSON.stringify([{name:'Fictional',email:'employee@example.test'}]),SHAREPOINT_GRAPH_CLIENT_ID:'fixture',SHAREPOINT_GRAPH_CLIENT_SECRET:'fixture',SHAREPOINT_SITE_ID:'fixture',SHAREPOINT_DRIVE_ID:'fixture',PRIVATE_TIMESHEET_ORIGINALS_ENABLED:'true'};
  const request=(body,auth=adminToken)=>worker.fetch(new Request('https://example.test/api/timesheet-original-intents',{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify(body)}),env,{});
  return {db,env,request};
}
const body={recordId:'r1',sourceSha256:source,dates:[date],ownerRevision:1};
test('disabled feature cannot create an intent',async()=>{const f=fixture();try{f.env.PRIVATE_TIMESHEET_ORIGINALS_ENABLED='false';assert.equal((await f.request(body)).status,503);assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_original_filing_intents').get().n,0)}finally{f.db.close()}});
test('authorised filing derives employee and actor from the saved record and signed identity',async()=>{const f=fixture();try{const res=await f.request({...body,actorOid:other,employeeOid:other,ownerUpn:'other@example.test'});assert.equal(res.status,201);const output=await res.json();assert.match(output.intentId,/^[0-9a-f-]{36}$/);assert.equal(output.reviewState,'pending');assert.equal(output.recordPayload,undefined);const row=f.db.prepare('SELECT * FROM timesheet_original_filing_intents').get();assert.equal(row.employee_oid,employee);assert.equal(row.actor_oid,admin);assert.equal(row.owner_upn,'employee@example.test');assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_private_originals').get().n,0)}finally{f.db.close()}});
test('another employee cannot create a filing intent for the record',async()=>{const f=fixture();try{assert.equal((await f.request(body,otherToken)).status,403);assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_original_filing_intents').get().n,0)}finally{f.db.close()}});
for(const mode of ['wrong source','stale revision','directory mismatch','changed correction','active delivery'])test(`${mode} cannot create an intent`,async()=>{const f=fixture();directory={id:employee,userPrincipalName:'employee@example.test'};try{const input={...body};if(mode==='wrong source')input.sourceSha256='b'.repeat(64);if(mode==='stale revision')input.ownerRevision=0;if(mode==='directory mismatch')directory={id:other,userPrincipalName:'employee@example.test'};if(mode==='changed correction')duringLookup=()=>f.db.prepare("UPDATE records SET payload_json='{}' WHERE record_id='r1'").run();if(mode==='active delivery')f.db.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES('r1','queued','t','t',0,'t')").run();const res=await f.request(input);assert.equal(res.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_original_filing_intents').get().n,0)}finally{f.db.close();duringLookup=null;directory={id:employee,userPrincipalName:'employee@example.test'}}});
process.on('exit',()=>{globalThis.fetch=savedFetch});
