import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../cloudflare-worker/src/index.js';
const tenant='cfed39ec-21cf-446c-be9f-c932923a123b',audience='b14e2daa-b4ed-4a52-823a-e3c5e89b19bd';
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='reviewed-original-test';jwk.use='sig';
const b64=x=>Buffer.from(x).toString('base64url');
async function token(oid,upn){const unsigned=b64(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud:audience,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid,preferred_username:upn,name:'Fictional'}));return unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));}
const editor=await token('old-editor','accounts@example.test');
const realFetch=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('/discovery/v2.0/keys')?Response.json({keys:[jwk]}):new Response('',{status:404});
function fixture({review=false,inject=false}={}){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  const id='document-import-original';
  const today=new Date().toISOString().slice(0,10);
  db.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,record_date,submitted_at,updated_at,payload_json) VALUES(?,'old-editor','accounts@example.test','Fictional','timesheets','submission','Submitted',?,'t','t','{"importSourceId":"source","importSourceName":"sheet.xlsx"}')`).run(id,today);
  db.prepare(`INSERT INTO document_import_files(record_id,kind,source_id,file_name,size_bytes,sharepoint_item_id,sharepoint_path,sharing_url,filed_at) VALUES(?,'timesheets','source','sheet.xlsx',1,'file','/test','https://example.test/private','t')`).run(id);
  const adopt=()=>db.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,1,?,'subject-oid','reviewer-oid','review-1','t')`).run(id,'a'.repeat(64));
  if(review)adopt();let pending=inject;
  const wrap=(sql,args=[])=>({async first(){if(pending && sql.includes('document_import_files')){pending=false;adopt()}return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}}});
  const DB={prepare(sql){return {...wrap(sql),bind(...args){return wrap(sql,args)}}}};
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:audience};
  return {db,request:(method='GET')=>worker.fetch(new Request('https://example.test/api/document-import/'+id+'/original',{method,headers:{authorization:`Bearer ${editor}`},...(method==='PUT'?{body:'fictional'}:{})}),env,{})};
}
test('the original owner can still read an unreviewed filed original',async()=>{const f=fixture();const r=await f.request();assert.equal(r.status,200);assert.equal((await r.json()).filed,true);f.db.close()});
test('a record ownership decision does not release its independent original to the former editor',async()=>{const f=fixture({review:true});const r=await f.request();assert.equal(r.status,403);f.db.close()});
test('adopting a review while the original is being read prevents release',async()=>{const f=fixture({inject:true});const r=await f.request();assert.equal(r.status,403);f.db.close()});
test('revocation does not restore the former editor original access',async()=>{const f=fixture({review:true});const id=f.db.prepare('SELECT review_id FROM timesheet_ownership_reviews').get().review_id;f.db.prepare("INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked','reviewer-oid','t')").run(id);assert.equal((await f.request()).status,403);f.db.close()});
test('an unreviewed record with no filed original reports that it has not been filed',async()=>{const f=fixture();f.db.prepare('DELETE FROM document_import_files').run();const r=await f.request();assert.equal(r.status,200);assert.equal((await r.json()).filed,false);f.db.close()});
test('a non-reviewer cannot file a timesheet original while no independent handoff lock exists',async()=>{const f=fixture();const r=await f.request('PUT');assert.equal(r.status,403);f.db.close()});
process.on('exit',()=>{globalThis.fetch=realFetch});
