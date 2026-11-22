import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {chromium} from 'playwright';
import gateway from '../cloudflare-worker/src/synthetic-portal-gateway.js';
import {syntheticFixture as f} from '../cloudflare-worker/src/synthetic-portal-fixture.js';
import {syntheticAttachmentExample} from './helpers/synthetic-attachments.mjs';

test('saved fictional retry reaches the isolated queue without a second save or notice',async()=>{
 const tenant='8b182d6b-6f34-4ca2-84ad-50ca712b5488',aud='01b5a6c6-f6c1-47cb-aebe-67f07f415e4b',origin='http://localhost:4179';
 const workerBuild=JSON.parse(execFileSync(process.execPath,['tools/prepare-synthetic-worker.mjs','--build-only','--database-id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],{encoding:'utf8'}));
 const workerVars=JSON.parse(readFileSync(path.join(workerBuild.directory,'wrangler.json'),'utf8')).vars;
 const actorOid=workerVars.SYNTHETIC_TEST_ALLOWED_OID,employeeOid=workerVars.SYNTHETIC_TEST_SUBJECT_OID,actor='amanda.bb@gmtelectservsltd.onmicrosoft.com';
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='saved-retry-integration';
 const b64=x=>Buffer.from(x).toString('base64url');const unsigned=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid:actorOid,preferred_username:actor,name:'Amanda Brown-Bennett'}));const token=unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/test-only/synthetic-portal-guard.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../cloudflare-worker/migrations/0012_pay_month_start_settings.sql',import.meta.url),'utf8'));sql.prepare('INSERT INTO profile_settings(owner_oid,owner_upn,updated_at) VALUES(?,?,?)').run(employeeOid,f.employeeUpn,'2026-11-16T13:00:00.000Z');
 const wrap=(statement,args=[])=>({async first(){return sql.prepare(statement).get(...args)||null},async all(){return {results:sql.prepare(statement).all(...args)}},async run(){const n=sql.prepare('SELECT total_changes() AS n').get().n;sql.prepare(statement).run(...args);return {meta:{changes:sql.prepare('SELECT total_changes() AS n').get().n-n}}}});
 const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}},async batch(statements){sql.exec('BEGIN');try{let results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}}};
 const env={...workerVars,DB,SHAREPOINT_GRAPH_CLIENT_ID:'fixture',SHAREPOINT_GRAPH_CLIENT_SECRET:'fixture',SHAREPOINT_SITE_ID:'fixture',SHAREPOINT_DRIVE_ID:'fixture',SYNTHETIC_TEST_SERVICE_ENABLED:'true'};
 const originalFetch=globalThis.fetch;let unexpected=0;globalThis.fetch=async value=>{const url=String(value);if(url.includes('/discovery/v2.0/keys'))return Response.json({keys:[jwk]});if(url.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fictional',expires_in:300});if(url.includes('/v1.0/users/'))return Response.json({id:employeeOid,userPrincipalName:f.employeeUpn});unexpected++;return new Response('',{status:404})};
 const post=(url,body,type='application/json')=>new Request(origin+url,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':type},body:type==='application/json'?JSON.stringify(body):body});
 let build,browser;try{
  const proof=await gateway.fetch(post('/api/synthetic-fixture-proof',readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json'),'application/octet-stream'),env,{});assert.equal(proof.status,200);
  const targetResponse=await gateway.fetch(post('/api/document-import/timesheet-target',{employeeEmail:f.employeeUpn,dates:f.rows.map(x=>x.date)}),env,{});assert.equal(targetResponse.status,200);const target=await targetResponse.json();
  const {payload,body:attachmentBody}=syntheticAttachmentExample(),when=payload.editedAt;
  const body={recordId:f.recordId,kind:'timesheets',action:'pay_month_correction',status:'Submitted',editMode:true,employeeName:f.employeeName,employeeEmail:f.employeeUpn,startDate:payload.cycleStart,endDate:payload.cycleEnd,recordDate:when.slice(0,10),updatedAt:when,baseCorrectionExists:false,baseCorrectionUpdatedAt:'',baseOwnerRevision:0,importReview:{dates:f.rows.map(x=>x.date),historyFingerprint:target.historyFingerprint,localRevision:0},payload};
  const saved=await gateway.fetch(post('/api/records',body),env,{});assert.equal(saved.status,201,await saved.clone().text());const savedPayload=sql.prepare('SELECT payload_json FROM records WHERE record_id=?').get(f.recordId).payload_json;
  const firstQueue=await gateway.fetch(post('/api/records/'+encodeURIComponent(f.recordId)+'/attachments',attachmentBody),{...env,SYNTHETIC_TEST_QUEUE_ENABLED:'false'},{});
  assert.equal(firstQueue.status,403,'the first fictional queue attempt is deliberately held');assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n,0);
  const history=await gateway.fetch(new Request(origin+'/api/history',{headers:{origin,authorization:`Bearer ${token}`}}),env,{});assert.equal(history.status,200,'the prepared test actor must be able to recover its saved fictional correction');
  build=JSON.parse(execFileSync(process.execPath,['tools/prepare-synthetic-portal.mjs','--build-only'],{encoding:'utf8'}));const site=path.join(build.directory,'site');browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(6000);let saveRequests=0,noticeRequests=0;
  const html=readFileSync(path.join(site,'portal/submissions.html'),'utf8').replace(/<script\b[^>]*><\/script>/g,'');
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){noticeRequests++;return route.abort()}if(!url.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'text/html',body:html});if(url.pathname==='/api/records'&&req.method()==='POST')saveRequests++;
   const headers={...(await req.allHeaders()),origin};const init={method:req.method(),headers};if(!['GET','HEAD'].includes(req.method()))init.body=req.postDataBuffer();const response=await gateway.fetch(new Request(req.url(),init),env,{});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
  await page.goto(origin+'/portal/submissions');await page.locator('main').evaluate(x=>x.hidden=false);await page.evaluate(({origin,token})=>{window.GMT_APP_CONFIG={portalApiEndpoint:origin,portalApiScopes:['fictional'],timesheetFormSubmitEndpoint:'https://fictional.invalid/notice'};window.GMT_PORTAL_AUTH={acquireToken:async()=>token}}, {origin,token});
  await page.addScriptTag({path:path.join(site,'vendor/test-only/xlsx.full.min.js')});await page.evaluate(()=>window.ensureXlsxLoaded=async()=>window.XLSX);
  for(const name of ['portal-api.js','pay-periods.js','timesheet-coverage.js','portal/pay-month-workbook.js','portal/submissions.js'])await page.addScriptTag({path:path.join(site,name)});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));await page.getByRole('button',{name:'Retry fictional workbook filing'}).click();await page.getByText(/Fictional workbook queued; no additional notice was sent/).first().waitFor();
  assert.equal(saveRequests,0);assert.equal(noticeRequests,0);assert.equal(unexpected,0);assert.equal(sql.prepare('SELECT payload_json FROM records WHERE record_id=?').get(f.recordId).payload_json,savedPayload);assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(f.recordId).status,'queued');assert.equal(sql.prepare('SELECT count(*) AS n FROM record_attachments WHERE record_id=?').get(f.recordId).n,3);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM record_versions WHERE record_id=?').get(f.recordId).n,0,'the retry does not create a new saved version');
  assert.equal(await page.getByRole('button',{name:'Retry fictional workbook filing'}).count(),0,'the recovery action disappears once the saved correction is queued');
 }finally{await browser?.close();if(build)rmSync(build.directory,{recursive:true,force:true});rmSync(workerBuild.directory,{recursive:true,force:true});globalThis.fetch=originalFetch;sql.close()}
});
