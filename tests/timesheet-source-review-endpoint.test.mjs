import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, * as workerModule from '../cloudflare-worker/src/index.js';

const tenant='a7c20f5b-e3a8-4a89-8577-b3def40a2691',aud='89cc3daf-695d-43dc-bd49-54d699fb22c4';
const reviewer='9bcbfba9-0a68-439f-a3c8-651fdc26728a',subject='db9f99d4-7980-4f1d-927a-875221d4320a';
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='source-review-fixture';jwk.use='sig';
const b64=x=>Buffer.from(x).toString('base64url');
async function token(oid,upn){const unsigned=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({tid:tenant,aud,iss:`https://login.microsoftonline.com/${tenant}/v2.0`,exp:Math.floor(Date.now()/1000)+300,oid,preferred_username:upn,name:'Fictional'}));return unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(unsigned))));}
const admin=await token(reviewer,'reviewer@example.test'),employee=await token(subject,'employee@example.test');
const originalFetch=globalThis.fetch;
let source,additionalSource,directory,inject,inventoryInject,sourceReadInject,sourceReadCount,sourceStatus,directoryStatus,inventoryMissing,versions,versionInject,versionListCalls,secondVersionScan,versionDetailRequests,batchMutation;
function reset(){source={id:'17',eTag:'"v1"',webUrl:'https://tenant.example/sites/example/Lists/Timesheets/DispForm.aspx?ID=17',fields:{EmployeeName:'Fictional',Week_x0020_Start:'2026-10-05',Week_x0020_End:'2026-10-09',Issue:'private fictional content',nested:{a:1,b:2}}};additionalSource=null;directory={id:subject,userPrincipalName:'employee@example.test'};versions=[{id:'1.0',lastModifiedDateTime:'2026-10-01T10:00:00Z',fields:{EmployeeName:'Former fictional claim'}}];inject=null;inventoryInject=null;sourceReadInject=null;sourceReadCount=0;versionInject=null;versionListCalls=0;versionDetailRequests=0;batchMutation=null;secondVersionScan=null;inventoryMissing=false;sourceStatus=200;directoryStatus=200}
globalThis.fetch=async (value,init)=>{const url=String(value);
  if(url.includes('/discovery/v2.0/keys'))return Response.json({keys:[jwk]});
  if(url.includes('/oauth2/v2.0/token'))return Response.json({access_token:'fictional',expires_in:3600});
  if(url.startsWith('https://graph.microsoft.com/v1.0/users/')){if(inject){const fn=inject;inject=null;fn()}return Response.json(directory,{status:directoryStatus})}
  if(url==='https://graph.microsoft.com/v1.0/$batch'){versionDetailRequests++;const requests=JSON.parse(init.body).requests;assert.ok(requests.length<=20);let responses=requests.map(request=>{assert.equal(request.method,'GET');const match=request.url.match(/\/versions\/([^?]+)/);return {id:request.id,status:200,body:versions.find(v=>v.id===decodeURIComponent(match[1]))||{}}}).reverse();if(batchMutation)responses=batchMutation(responses);return Response.json({responses})}
  if(url.startsWith('https://graph.microsoft.com/v1.0/sites/')){if(url.includes('/versions')){if(versionInject){const fn=versionInject;versionInject=null;fn()}const match=url.match(/\/versions\/([^?]+)/);if(match)versionDetailRequests++;if(!match&&++versionListCalls===2&&secondVersionScan)secondVersionScan();return Response.json(match?versions.find(v=>v.id===decodeURIComponent(match[1]))||{}:{value:versions.map(({fields,...metadata})=>metadata)},{status:sourceStatus})}if(url.includes('/items?')&&inventoryInject){const fn=inventoryInject;inventoryInject=null;fn()}if(url.includes('/items/17?')&&++sourceReadCount===2&&sourceReadInject){const fn=sourceReadInject;sourceReadInject=null;fn()}return Response.json(url.includes('/items?')?{value:inventoryMissing?[]:[source,...(additionalSource?[additionalSource]:[])]}:source,{status:sourceStatus})}
  throw new Error('Unexpected request');};
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  const wrap=(statement,args=[])=>({async first(){return db.prepare(statement).get(...args)||null},async all(){return {results:db.prepare(statement).all(...args)}},async run(){return {meta:{changes:db.prepare(statement).run(...args).changes}}}});
  const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}}};
  const env={DB,ENTRA_TENANT_ID:tenant,ENTRA_AUDIENCES:aud,ADMIN_UPNS:'reviewer@example.test',TIMESHEET_VIEWER_UPNS:'reviewer@example.test',SHAREPOINT_GRAPH_CLIENT_ID:'fixture-client',SHAREPOINT_GRAPH_CLIENT_SECRET:'fixture',SHAREPOINT_SITE_ID:'tenant.example,site,web',SHAREPOINT_DRIVE_ID:'fixture-drive',SHAREPOINT_TIMESHEET_LIST_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  const request=(method='GET',body,auth=admin,path='/api/admin/timesheet-source-review/17')=>worker.fetch(new Request('https://example.test'+path,{method,headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  return {db,env,request};}
async function draft(f){const r=await f.request();assert.equal(r.status,200);return r.json()}
function decision(d){return {expectedEtag:d.etag,fieldsSha256:d.fieldsSha256,expectedReviewEventId:d.reviewEventId,expectedExclusionEventId:d.exclusionEventId,subjectOid:subject,subjectUpn:'employee@example.test',evidenceReference:'fictional-evidence'}}

test('reviewer can look up an exact employee sign-in without manually entering an object ID',async()=>{
  reset();const f=fixture();try {
    const path='/api/admin/timesheet-review-subject?upn=employee%40example.test';
    assert.equal((await f.request('GET',null,employee,path)).status,403);
    directory.displayName='Fictional Employee';directory.accountEnabled=true;
    const response=await f.request('GET',null,admin,path);assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{oid:subject,upn:'employee@example.test',name:'Fictional Employee',accountEnabled:true});
    directory.userPrincipalName='different@example.test';assert.equal((await f.request('GET',null,admin,path)).status,409);
    directory.userPrincipalName='employee@example.test';directory.accountEnabled=false;assert.equal((await (await f.request('GET',null,admin,path)).json()).accountEnabled,false);
    directoryStatus=503;assert.equal((await f.request('GET',null,admin,path)).status,503);
  }finally{f.db.close()}
});
test('only an authorised reviewer can bind one current provider snapshot and revoke it',async()=>{
  reset();const f=fixture();try {
    assert.equal((await f.request('GET',null,employee)).status,403);
    const d=await draft(f);assert.equal(d.itemId,'17');assert.equal(d.etag,'"v1"');assert.equal(d.fields.Issue,'private fictional content');assert.match(d.fieldsSha256,/^[a-f0-9]{64}$/);
    assert.equal((await f.request('POST',decision(d),employee)).status,403);
    const response=await f.request('POST',decision(d));assert.equal(response.status,201);const result=await response.json();
    const row=f.db.prepare('SELECT * FROM timesheet_source_reviews WHERE review_id=?').get(result.reviewId);
    assert.equal(row.subject_oid,subject);assert.equal(row.reviewer_oid,reviewer);assert.equal(row.fields_sha256,d.fieldsSha256);
    assert.doesNotMatch(JSON.stringify(row),/private fictional content/);
    assert.equal((await f.request('POST',{reviewId:result.reviewId},admin,'/api/admin/timesheet-source-review/18/revoke')).status,409,'one item cannot revoke another item’s decision');
    source.eTag='"v2"';const later=await draft(f);assert.equal((await f.request('POST',decision(later))).status,409,'a new version does not silently replace an active review');
    assert.equal((await f.request('POST',{reviewId:result.reviewId},employee,'/api/admin/timesheet-source-review/17/revoke')).status,403);
    assert.equal((await f.request('POST',{reviewId:result.reviewId},admin,'/api/admin/timesheet-source-review/17/revoke')).status,200);
    assert.equal((await f.request('POST',{reviewId:result.reviewId},admin,'/api/admin/timesheet-source-review/17/revoke')).status,409);
  } finally{f.db.close()}
});
for(const mode of ['etag changed','fields changed','wrong subject','wrong address','directory unavailable','changed review history','provider unavailable'])test(`source adoption holds when ${mode}`,async()=>{
  reset();const f=fixture();try {
    const d=await draft(f),body=decision(d);
    if(mode==='etag changed')inject=()=>{source.eTag='"v2"'};
    if(mode==='fields changed')inject=()=>{source.fields.Issue='changed'};
    if(mode==='wrong subject')directory.id='f2f68655-fbeb-463b-9635-bd91681ea5b5';
    if(mode==='wrong address')directory.userPrincipalName='other@example.test';
    if(mode==='directory unavailable')directoryStatus=503;
    if(mode==='provider unavailable')inject=()=>{sourceStatus=503};
    if(mode==='changed review history')inject=()=>{const x=f.db.prepare(`INSERT INTO timesheet_source_reviews(site_id,list_id,item_id,source_etag,fields_sha256,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'17',d.etag,d.fieldsSha256,subject,'employee@example.test',reviewer,'other','t');
      f.db.prepare("INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(x.lastInsertRowid,reviewer)};
    const r=await f.request('POST',body);assert.equal(r.status,['provider unavailable','directory unavailable'].includes(mode)?503:409);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM timesheet_source_reviews').get().n,mode==='changed review history'?1:0);
  } finally{f.db.close()}
});
test('source hashes ignore object key ordering but change for different content',async()=>{
  reset();const f=fixture();try {
    const first=await draft(f);source.fields={nested:{b:2,a:1},Issue:'private fictional content',Week_x0020_End:'2026-10-09',Week_x0020_Start:'2026-10-05',EmployeeName:'Fictional'};
    const reordered=await draft(f);assert.equal(reordered.fieldsSha256,first.fieldsSha256);
    source.fields.nested.b=3;const changed=await draft(f);assert.notEqual(changed.fieldsSha256,first.fieldsSha256);
  } finally{f.db.close()}
});
test('a source review link can only point to the configured SharePoint host',async()=>{
  reset();const f=fixture();try {
    const d=await draft(f);assert.equal(d.sourceUrl,source.webUrl);
    source.webUrl='https://attacker.example/phishing';assert.equal((await draft(f)).sourceUrl,'');
    source.webUrl='http://tenant.example/insecure';assert.equal((await draft(f)).sourceUrl,'');
    source.webUrl='https://tenant.example@attacker.example/';assert.equal((await draft(f)).sourceUrl,'');
  }finally{f.db.close()}
});
test('both administrator and timesheet viewer privileges are needed',async()=>{
  for(const role of ['admin-only','viewer-only','neither']){
    reset();const f=fixture();try{if(role!=='admin-only')f.env.ADMIN_UPNS='';if(role!=='viewer-only')f.env.TIMESHEET_VIEWER_UPNS='';assert.equal((await f.request()).status,403,role);assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review')).status,403,role);assert.equal((await (await f.request('GET',null,admin,'/api/access')).json()).canReviewTimesheetOwnership,false,role)}finally{f.db.close()}
  }
  reset();const f=fixture();try{assert.equal((await (await f.request('GET',null,admin,'/api/access')).json()).canReviewTimesheetOwnership,true)}finally{f.db.close()}
});
test('the reviewer inventory exposes current review status without exposing source contents',async()=>{
  reset();const f=fixture();try {
    const path='/api/admin/timesheet-source-review';
    assert.equal((await f.request('GET',null,employee,path)).status,403);
    const before=await f.request('GET',null,admin,path);assert.equal(before.status,200);
    const pending=await before.json();assert.equal(pending.items.length,1);assert.equal(pending.items[0].itemId,'17');assert.equal(pending.items[0].status,'unreviewed');
    assert.equal(pending.items[0].claimedName,'Fictional');assert.equal(pending.items[0].weekStart,'2026-10-05');assert.equal(pending.items[0].weekEnd,'2026-10-09');assert.doesNotMatch(JSON.stringify(pending),/private fictional content/);
    const d=await draft(f),adopted=await f.request('POST',decision(d));assert.equal(adopted.status,201);
    const current=await (await f.request('GET',null,admin,path)).json();assert.equal(current.items[0].status,'reviewed');assert.equal(current.items[0].subjectOid,subject);
    source.fields.Issue='new source contents';const changed=await (await f.request('GET',null,admin,path)).json();assert.equal(changed.items[0].status,'changed');
    inventoryMissing=true;const missing=await (await f.request('GET',null,admin,path)).json();assert.equal(missing.items[0].status,'missing');inventoryMissing=false;
    const {reviewId}=await adopted.json();await f.request('POST',{reviewId},admin,'/api/admin/timesheet-source-review/17/revoke');
    const revoked=await (await f.request('GET',null,admin,path)).json();assert.equal(revoked.items[0].status,'unreviewed');
  }finally{f.db.close()}
});
test('the reviewer inventory rejects decisions changed during the provider read',async()=>{
  reset();const f=fixture();try {
    const d=await draft(f),response=await f.request('POST',decision(d));const {reviewId}=await response.json();
    inventoryInject=()=>f.db.prepare("INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(reviewId,reviewer);
    assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review')).status,409);
  }finally{f.db.close()}
});
test('the reviewer inventory does not return a partial list when SharePoint is unavailable',async()=>{
  reset();const f=fixture();try{sourceStatus=503;assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review')).status,503)}finally{f.db.close()}
});
test('an internal source read verifies the current item, directory identity and active decision',async()=>{
  reset();const f=fixture();try {
    assert.equal(typeof workerModule.readReviewedTimesheetSource,'function','a source decision needs a protected reader');
    const d=await draft(f),response=await f.request('POST',decision(d));assert.equal(response.status,201);
    const read=()=>workerModule.readReviewedTimesheetSource(f.env,'17',{oid:subject,upn:'employee@example.test'});
    assert.equal((await read()).fields.Issue,'private fictional content');
    await assert.rejects(()=>workerModule.readReviewedTimesheetSource(f.env,'17',{oid:reviewer,upn:'employee@example.test'}),error=>error.status===409);
    source.fields.Issue='changed without changing the tag';await assert.rejects(read,error=>error.status===409);source.fields.Issue='private fictional content';
    directory.userPrincipalName='reassigned@example.test';await assert.rejects(read,error=>error.status===409);directory.userPrincipalName='employee@example.test';
    const {reviewId}=await response.json();inject=()=>f.db.prepare("INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(reviewId,reviewer);
    await assert.rejects(read,error=>error.status===409,'revocation while reading cannot release the source');
  } finally{f.db.close()}
});
test('an invalid source id or unversioned provider item is not reviewable',async()=>{
  reset();const f=fixture();try {
    assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review/not-an-id')).status,400);
    delete source.eTag;assert.equal((await f.request()).status,503);
  } finally{f.db.close()}
});
test('a current-source snapshot holds until every list item has an unchanged active owner review',async()=>{
  reset();const f=fixture();try{
    assert.equal(typeof workerModule.readClassifiedCurrentTimesheetSources,'function');
    const read=()=>workerModule.readClassifiedCurrentTimesheetSources(f.env,{oid:subject,upn:'employee@example.test'});
    await assert.rejects(read,error=>error.status===409,'unreviewed source holds the snapshot');
    const d=await draft(f);assert.equal((await f.request('POST',decision(d))).status,201);
    let result=await read();assert.deepEqual(result.items.map(x=>x.itemId),['17']);assert.match(result.sourceFingerprint,/^[a-f0-9]{64}$/);
    additionalSource={id:'18',eTag:'"other"',fields:{EmployeeName:'Other',Issue:'other source'}};
    await assert.rejects(read,error=>error.status===409,'an unreviewed item cannot be assumed to belong elsewhere');
    let inventory=await workerModule.readCompleteTimesheetSourceSnapshot(f.env),other=inventory.items.find(x=>x.itemId==='18');
    f.db.prepare(`INSERT INTO timesheet_source_reviews(site_id,list_id,item_id,source_etag,fields_sha256,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'18',other.etag,other.fieldsSha256,'f2f68655-fbeb-463b-9635-bd91681ea5b5','other@example.test',reviewer,'evidence','t');
    result=await read();assert.deepEqual(result.items.map(x=>x.itemId),['17'],'other reviewed employees are not included');
    additionalSource.fields.Issue='changed';await assert.rejects(read,error=>error.status===409,'changed source is no longer accounted for');additionalSource.fields.Issue='other source';
    additionalSource=null;await assert.rejects(read,error=>error.status===409,'a missing reviewed source is not silently ignored');
  }finally{f.db.close()}
});
test('a current-source snapshot rejects a source or review changing during directory verification',async()=>{
  for(const change of ['source','review']){reset();const f=fixture();try{
    const d=await draft(f),response=await f.request('POST',decision(d)),{reviewId}=await response.json();
    inject=change==='source'?()=>{source.fields.Issue='changed'}:()=>f.db.prepare("INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(reviewId,reviewer);
    await assert.rejects(()=>workerModule.readClassifiedCurrentTimesheetSources(f.env,{oid:subject,upn:'employee@example.test'}),error=>error.status===409,change);
  }finally{f.db.close()}}
});
test('a current-source snapshot holds an identity collision instead of excluding it as another employee',async()=>{
  for(const kind of ['same-upn','same-oid']){reset();const f=fixture();try{
    const d=await draft(f);assert.equal((await f.request('POST',decision(d))).status,201);
    additionalSource={id:'18',eTag:'"other"',fields:{EmployeeName:'Other',Issue:'other source'}};
    const snapshot=await workerModule.readCompleteTimesheetSourceSnapshot(f.env),other=snapshot.items.find(x=>x.itemId==='18');
    const oid=kind==='same-oid'?subject:'f2f68655-fbeb-463b-9635-bd91681ea5b5',upn=kind==='same-upn'?'employee@example.test':'other@example.test';
    f.db.prepare(`INSERT INTO timesheet_source_reviews(site_id,list_id,item_id,source_etag,fields_sha256,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'18',other.etag,other.fieldsSha256,oid,upn,reviewer,'evidence','t');
    await assert.rejects(()=>workerModule.readClassifiedCurrentTimesheetSources(f.env,{oid:subject,upn:'employee@example.test'}),error=>error.status===409,kind);
  }finally{f.db.close()}}
});
test('a reviewed non-timesheet item can be accounted for without assigning it an employee',async()=>{
  reset();const f=fixture();try{
    const d=await draft(f);assert.equal((await f.request('POST',decision(d))).status,201);
    additionalSource={id:'18',eTag:'"calendar"',fields:{Title:'Fictional calendar',Issue:'calendar-only'}};
    const inventory=await workerModule.readCompleteTimesheetSourceSnapshot(f.env),calendar=inventory.items.find(x=>x.itemId==='18');
    const {lastInsertRowid:id}=f.db.prepare(`INSERT INTO timesheet_source_exclusions(site_id,list_id,item_id,source_etag,fields_sha256,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,?,?,?)`).run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'18',calendar.etag,calendar.fieldsSha256,reviewer,'reviewed-calendar','t');
    const read=()=>workerModule.readClassifiedCurrentTimesheetSources(f.env,{oid:subject,upn:'employee@example.test'});
    const result=await read();assert.deepEqual(result.items.map(x=>x.itemId),['17']);assert.ok(result.exclusionEventId>0);
    additionalSource.fields.Issue='changed';await assert.rejects(read,error=>error.status===409);additionalSource.fields.Issue='calendar-only';
    inject=()=>f.db.prepare("INSERT INTO timesheet_source_exclusion_events(exclusion_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(id,reviewer);
    await assert.rejects(read,error=>error.status===409,'a revocation during provider access invalidates the snapshot');
  }finally{f.db.close()}
});
test('a reviewer can record and revoke an exact non-timesheet classification without assigning an employee',async()=>{
  reset();const f=fixture();try{
    const path='/api/admin/timesheet-source-review/17/not-timesheet',d=await draft(f);
    const body={expectedEtag:d.etag,fieldsSha256:d.fieldsSha256,expectedReviewEventId:d.reviewEventId,expectedExclusionEventId:d.exclusionEventId,evidenceReference:'calendar-original'};
    assert.equal((await f.request('POST',body,employee,path)).status,403);
    const response=await f.request('POST',body,admin,path);assert.equal(response.status,201);const {exclusionId}=await response.json();
    assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_source_reviews').get().n,0);
    const list=await (await f.request('GET',null,admin,'/api/admin/timesheet-source-review')).json();assert.equal(list.items[0].status,'excluded');assert.equal(list.items[0].exclusionId,exclusionId);
    source.fields.Issue='changed';const changed=await (await f.request('GET',null,admin,'/api/admin/timesheet-source-review')).json();assert.equal(changed.items[0].status,'changed');assert.equal(changed.items[0].exclusionId,exclusionId);source.fields.Issue='private fictional content';
    inventoryMissing=true;const missing=await (await f.request('GET',null,admin,'/api/admin/timesheet-source-review')).json();assert.equal(missing.items[0].status,'missing');assert.equal(missing.items[0].exclusionId,exclusionId);inventoryMissing=false;
    assert.equal((await f.request('POST',decision(d))).status,409,'an earlier owner review draft cannot override this classification');
    assert.equal((await f.request('POST',{exclusionId},employee,path+'/revoke')).status,403);
    assert.equal((await f.request('POST',{exclusionId},admin,path+'/revoke')).status,200);
    assert.equal((await f.request('POST',{exclusionId},admin,path+'/revoke')).status,409);
    assert.equal((await f.request('POST',decision(d))).status,409,'revocation still invalidates the older draft');
    const fresh=await draft(f);assert.equal((await f.request('POST',decision(fresh))).status,201);
  }finally{f.db.close()}
});
test('non-timesheet classification refuses a changed source or stale review state',async()=>{
  reset();const f=fixture();try{
    const d=await draft(f),path='/api/admin/timesheet-source-review/17/not-timesheet';
    const body={expectedEtag:d.etag,fieldsSha256:d.fieldsSha256,expectedReviewEventId:d.reviewEventId,expectedExclusionEventId:d.exclusionEventId,evidenceReference:'source-evidence'};
    source.fields.Issue='changed';assert.equal((await f.request('POST',body,admin,path)).status,409);
    assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_source_exclusions').get().n,0);
  }finally{f.db.close()}
});
test('an owner review cannot overwrite a non-timesheet classification adopted and revoked during lookup',async()=>{
  reset();const f=fixture();try{
    const d=await draft(f);inject=()=>{const id=f.db.prepare(`INSERT INTO timesheet_source_exclusions(site_id,list_id,item_id,source_etag,fields_sha256,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,?,?,?)`).run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'17',d.etag,d.fieldsSha256,reviewer,'evidence','t').lastInsertRowid;f.db.prepare("INSERT INTO timesheet_source_exclusion_events(exclusion_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(id,reviewer)};
    assert.equal((await f.request('POST',decision(d))).status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_source_reviews').get().n,0);
  }finally{f.db.close()}
});
test('a non-timesheet classification cannot override an owner review adopted and revoked during provider reads',async()=>{
  reset();const f=fixture();try{
    const d=await draft(f);sourceReadCount=0;sourceReadInject=()=>{const id=f.db.prepare(`INSERT INTO timesheet_source_reviews(site_id,list_id,item_id,source_etag,fields_sha256,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'17',d.etag,d.fieldsSha256,subject,'employee@example.test',reviewer,'evidence','t').lastInsertRowid;f.db.prepare("INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(id,reviewer)};
    const body={expectedEtag:d.etag,fieldsSha256:d.fieldsSha256,expectedReviewEventId:d.reviewEventId,expectedExclusionEventId:d.exclusionEventId,evidenceReference:'calendar-evidence'};
    assert.equal((await f.request('POST',body,admin,'/api/admin/timesheet-source-review/17/not-timesheet')).status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_source_exclusions').get().n,0);
  }finally{f.db.close()}
});
test('only authorised reviewers can inspect stable previous source versions without approving them',async()=>{
  reset();const f=fixture();try{
    const path='/api/admin/timesheet-source-review/17/versions';
    assert.equal((await f.request('GET',null,employee,path)).status,403);
    const response=await f.request('GET',null,admin,path);assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.itemId,'17');assert.equal(data.versions.length,1);assert.equal(data.versions[0].fields.EmployeeName,'Former fictional claim');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM timesheet_source_reviews').get().n,0);
  }finally{f.db.close()}
});
test('previous source versions fail closed if the current source changes during the read',async()=>{
  reset();const f=fixture();try{
    versionInject=()=>{source.eTag='"v2"'};
    assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review/17/versions')).status,409);
  }finally{f.db.close()}
});
test('a large version history remains reviewable without one network request per version',async()=>{
  reset();const f=fixture();try{
    versions=Array.from({length:100},(_,i)=>({id:`${i+1}.0`,fields:{Title:`fictional version ${i+1}`}}));
    const response=await f.request('GET',null,admin,'/api/admin/timesheet-source-review/17/versions');assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.versions.length,100);assert.equal(result.versions.find(v=>v.versionId==='89.0').fields.Title,'fictional version 89');
    assert.ok(versionDetailRequests<=10,`expected grouped version reads; got ${versionDetailRequests} detail requests`);
  }finally{f.db.close()}
});
test('partial, throttled or mismatched version batch responses cannot approve a partial history',async()=>{
  for(const fault of ['missing','duplicate','throttled','wrong body','unexpected id']){reset();const f=fixture();try{
    versions=[{id:'1.0',fields:{Title:'First'}},{id:'2.0',fields:{Title:'Second'}}];
    batchMutation=responses=>{if(fault==='missing')responses.pop();if(fault==='duplicate')responses[1].id=responses[0].id;if(fault==='throttled')responses[0].status=429;if(fault==='wrong body')responses[0].body.id='other';if(fault==='unexpected id')responses[0].id='unexpected';return responses};
    assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review/17/versions')).status,503,fault);
    assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_source_version_reviews').get().n,0);
  }finally{f.db.close()}}
});
test('previous source versions fail closed if an older version changes between scans',async()=>{
  reset();const f=fixture();try{
    secondVersionScan=()=>{versions[0].fields.EmployeeName='Changed fictional claim'};
    assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review/17/versions')).status,409);
  }finally{f.db.close()}
});
test('a malformed or duplicate version cannot produce a partial history',async()=>{
  reset();const f=fixture();try{
    versions.push({...versions[0]});assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review/17/versions')).status,503);
    for(const id of ['../other','..','.']){versions=[{id,fields:{}}];assert.equal((await f.request('GET',null,admin,'/api/admin/timesheet-source-review/17/versions')).status,503)}
  }finally{f.db.close()}
});
test('a historical version needs an independent reviewer decision bound to its exact fields',async()=>{
  reset();const f=fixture();try{
    const listPath='/api/admin/timesheet-source-review/17/versions',path=listPath+'/1.0/review';
    const list=await (await f.request('GET',null,admin,listPath)).json(),version=list.versions[0];
    assert.equal(version.reviewStatus,'unreviewed');assert.equal(version.reviewEventId,0);
    const body={classification:'employee',expectedCurrentEtag:list.currentEtag,expectedCurrentFieldsSha256:list.currentFieldsSha256,fieldsSha256:version.fieldsSha256,expectedReviewEventId:version.reviewEventId,subjectOid:subject,subjectUpn:'employee@example.test',evidenceReference:'historical-evidence'};
    assert.equal((await f.request('POST',body,employee,path)).status,403);
    const result=await f.request('POST',body,admin,path);assert.equal(result.status,201);const {reviewId}=await result.json();
    const row=f.db.prepare('SELECT * FROM timesheet_source_version_reviews WHERE review_id=?').get(reviewId);assert.equal(row.subject_oid,subject);assert.equal(row.reviewer_oid,reviewer);assert.equal(row.fields_sha256,version.fieldsSha256);assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_source_reviews').get().n,0);
    const current=await (await f.request('GET',null,admin,listPath)).json();assert.equal(current.versions[0].reviewStatus,'reviewed');assert.equal(current.versions[0].reviewId,reviewId);
    versions[0].fields.EmployeeName='Changed';const changed=await (await f.request('GET',null,admin,listPath)).json();assert.equal(changed.versions[0].reviewStatus,'changed');versions[0].fields.EmployeeName='Former fictional claim';
    const original=versions;versions=[];const missing=await (await f.request('GET',null,admin,listPath)).json();assert.equal(missing.versions[0].reviewStatus,'missing');assert.equal(missing.versions[0].reviewId,reviewId);versions=original;
    assert.equal((await f.request('POST',{reviewId},admin,path+'/revoke')).status,200);assert.equal((await f.request('POST',{reviewId},admin,path+'/revoke')).status,409);
    assert.equal((await f.request('POST',body,admin,path)).status,409,'a revoked decision invalidates an older draft');
  }finally{f.db.close()}
});
test('one-item historical selection requires every returned version to have its own unchanged review',async()=>{
  reset();const f=fixture();try{
    const path='/api/admin/timesheet-source-review/17/versions';
    versions.push({id:'2.0',fields:{Title:'Fictional calendar'}});
    const list=await (await f.request('GET',null,admin,path)).json();
    const expected={etag:list.currentEtag,fieldsSha256:list.currentFieldsSha256};
    const select=()=>workerModule.readClassifiedTimesheetSourceVersions(f.env,'17',expected,{oid:subject,upn:'employee@example.test'});
    await assert.rejects(select,error=>error.status===409);
    for(const version of list.versions){
      const employeeVersion=version.versionId==='1.0';
      const body={classification:employeeVersion?'employee':'not_timesheet',expectedCurrentEtag:list.currentEtag,expectedCurrentFieldsSha256:list.currentFieldsSha256,fieldsSha256:version.fieldsSha256,expectedReviewEventId:version.reviewEventId,evidenceReference:'fictional-history',...(employeeVersion?{subjectOid:subject,subjectUpn:'employee@example.test'}:{})};
      assert.equal((await f.request('POST',body,admin,path+'/'+version.versionId+'/review')).status,201);
    }
    const selected=await select();assert.deepEqual(selected.versions.map(version=>version.versionId),['1.0']);
    assert.equal(selected.itemId,'17');assert.equal(f.db.prepare('SELECT count(*) n FROM dispatch_queue').get().n,0);
    versions[0].fields.EmployeeName='Changed';await assert.rejects(select,error=>error.status===409);versions[0].fields.EmployeeName='Former fictional claim';
    const original=versions;versions=versions.slice(0,1);await assert.rejects(select,error=>error.status===409);versions=original;
    source.eTag='"v2"';await assert.rejects(select,error=>error.status===409);
  }finally{f.db.close()}
});
test('one-item historical selection rejects a review revoked during the directory check',async()=>{
  reset();const f=fixture();try{
    const path='/api/admin/timesheet-source-review/17/versions',list=await (await f.request('GET',null,admin,path)).json(),version=list.versions[0];
    const body={classification:'employee',expectedCurrentEtag:list.currentEtag,expectedCurrentFieldsSha256:list.currentFieldsSha256,fieldsSha256:version.fieldsSha256,expectedReviewEventId:version.reviewEventId,subjectOid:subject,subjectUpn:'employee@example.test',evidenceReference:'fictional-history'};
    const {reviewId}=await (await f.request('POST',body,admin,path+'/1.0/review')).json();
    inject=()=>f.db.prepare("INSERT INTO timesheet_source_version_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(reviewId,reviewer);
    await assert.rejects(()=>workerModule.readClassifiedTimesheetSourceVersions(f.env,'17',{etag:list.currentEtag,fieldsSha256:list.currentFieldsSha256},{oid:subject,upn:'employee@example.test'}),error=>error.status===409);
  }finally{f.db.close()}
});
test('historical selection respects each version owner independently of the current item',async()=>{
  reset();const f=fixture();try{
    const path='/api/admin/timesheet-source-review/17/versions';
    versions.push({id:'2.0',fields:{EmployeeName:'Different fictional employee'}});
    const list=await (await f.request('GET',null,admin,path)).json();
    for(const version of list.versions){
      const isSubject=version.versionId==='1.0';
      f.db.prepare(`INSERT INTO timesheet_source_version_reviews(site_id,list_id,item_id,version_id,fields_sha256,classification,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,'employee',?,?,?,?,?)`)
        .run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'17',version.versionId,version.fieldsSha256,isSubject?subject:'f2f68655-fbeb-463b-9635-bd91681ea5b5',isSubject?'employee@example.test':'other@example.test',reviewer,'fictional','t');
    }
    const read=()=>workerModule.readClassifiedTimesheetSourceVersions(f.env,'17',{etag:list.currentEtag,fieldsSha256:list.currentFieldsSha256},{oid:subject,upn:'employee@example.test'});
    assert.deepEqual((await read()).versions.map(version=>version.versionId),['1.0']);
    inject=()=>{versions[1].fields.EmployeeName='Changed during identity verification'};
    await assert.rejects(read,error=>error.status===409);
  }finally{f.db.close()}
});
test('historical review cannot ignore a competing decision that was adopted and revoked during identity lookup',async()=>{
  reset();const f=fixture();try{
    const listPath='/api/admin/timesheet-source-review/17/versions',path=listPath+'/1.0/review',list=await (await f.request('GET',null,admin,listPath)).json(),version=list.versions[0];
    const body={classification:'employee',expectedCurrentEtag:list.currentEtag,expectedCurrentFieldsSha256:list.currentFieldsSha256,fieldsSha256:version.fieldsSha256,expectedReviewEventId:version.reviewEventId,subjectOid:subject,subjectUpn:'employee@example.test',evidenceReference:'historical-evidence'};
    inject=()=>{const id=f.db.prepare(`INSERT INTO timesheet_source_version_reviews(site_id,list_id,item_id,version_id,fields_sha256,classification,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,'employee',?,?,?,?,?)`).run(f.env.SHAREPOINT_SITE_ID,f.env.SHAREPOINT_TIMESHEET_LIST_ID,'17','1.0',version.fieldsSha256,subject,'employee@example.test',reviewer,'other','t').lastInsertRowid;f.db.prepare("INSERT INTO timesheet_source_version_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(?,'revoked',?,'t')").run(id,reviewer)};
    assert.equal((await f.request('POST',body,admin,path)).status,409);assert.equal(f.db.prepare("SELECT count(*) n FROM timesheet_source_version_reviews WHERE evidence_reference='historical-evidence'").get().n,0);
  }finally{f.db.close()}
});
test('historical version classification holds if its contents or parent source change',async()=>{
  for(const mode of ['version','parent']){reset();const f=fixture();try{
    const listPath='/api/admin/timesheet-source-review/17/versions',path=listPath+'/1.0/review',list=await (await f.request('GET',null,admin,listPath)).json(),version=list.versions[0];
    const body={classification:'not_timesheet',expectedCurrentEtag:list.currentEtag,expectedCurrentFieldsSha256:list.currentFieldsSha256,fieldsSha256:version.fieldsSha256,expectedReviewEventId:version.reviewEventId,evidenceReference:'historical-calendar'};
    if(mode==='version')versions[0].fields.EmployeeName='Changed';else source.eTag='"v2"';
    assert.equal((await f.request('POST',body,admin,path)).status,409,mode);assert.equal(f.db.prepare('SELECT count(*) n FROM timesheet_source_version_reviews').get().n,0);
  }finally{f.db.close()}}
});
process.on('exit',()=>{globalThis.fetch=originalFetch});
