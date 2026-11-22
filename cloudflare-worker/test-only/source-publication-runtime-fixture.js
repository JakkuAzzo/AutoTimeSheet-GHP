// Fictional local-D1 fixture only; never route or deploy this module.
import {selectPublicationSource,claimPublicationHandoff,findPublicationAttempt,bindPublicationFlow,readPublicationSourceForRun,confirmPublicationHandoff,recordPublicationCandidate,publishCandidate,completePublishedCandidate,readPublishedCandidate} from '../src/timesheet-source-publication-guard.js';
import {claimBoundSyntheticDelivery,finishBoundSyntheticDelivery} from '../src/synthetic-delivery-handoff.js';
import {syntheticFixture} from '../src/synthetic-portal-fixture.js';
import {verifyBoundSyntheticWorkbook} from '../src/synthetic-bound-workbook-readback.js';
export default {async fetch(request,env){
 if(new URL(request.url).hostname!=='127.0.0.1'||request.headers.get('x-test-key')!==env.TEST_KEY||request.method!=='POST')return new Response(null,{status:403});
 try{
  const {migration,workbookBase64}=await request.json();if(!Array.isArray(migration)||migration.length<25||typeof workbookBase64!=='string')throw Error('fixture migration');
  const definitions=[
   'CREATE TABLE records(record_id TEXT PRIMARY KEY,owner_oid TEXT,owner_upn TEXT,kind TEXT,action TEXT,status TEXT,payload_json TEXT)',
   'CREATE TABLE timesheet_review_record_revisions(record_id TEXT PRIMARY KEY,revision INTEGER)',
   'CREATE TABLE timesheet_owner_revisions(owner_upn TEXT PRIMARY KEY,revision INTEGER)',
   'CREATE TABLE timesheet_queue_source_guards(record_id TEXT PRIMARY KEY,owner_upn TEXT,owner_revision INTEGER,source_base64 TEXT)',
   'CREATE TABLE record_attachments(record_id TEXT,field_name TEXT,file_name TEXT,content_type TEXT,content_base64 TEXT,size_bytes INTEGER,PRIMARY KEY(record_id,field_name))',
   'CREATE TABLE timesheet_queue_attachment_guards(record_id TEXT PRIMARY KEY,manifest_json TEXT)',
   'CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT,updated_at TEXT,attempts INTEGER,next_attempt_at TEXT,last_sent_at TEXT,last_error TEXT)',
   'CREATE TABLE private_timesheet_subjects(employee_upn TEXT PRIMARY KEY,employee_oid TEXT)',
   'CREATE TABLE timesheet_ownership_reviews(review_id INTEGER PRIMARY KEY,record_id TEXT,record_revision INTEGER,subject_oid TEXT,payload_sha256 TEXT)',
   'CREATE TABLE timesheet_ownership_review_events(event_id INTEGER PRIMARY KEY,review_id INTEGER,event_type TEXT)',
   'CREATE TABLE timesheet_import_source_holds(record_id TEXT PRIMARY KEY,first_seen_at TEXT)',
   'CREATE TABLE timesheet_import_source_days(record_id TEXT,owner_oid TEXT,owner_upn TEXT,source_day TEXT)',
   'CREATE TABLE pay_month_start_settings(month_key TEXT PRIMARY KEY,start_date TEXT)',
   'CREATE TABLE private_timesheet_workbooks(workbook_id TEXT)',
   'CREATE TABLE timesheet_delivery_routes(workbook_id TEXT)',...migration];
  await env.DB.batch(definitions.map(s=>env.DB.prepare(s)));
  const oid='11111111-1111-4111-8111-111111111111',upn='person@example.test',recordId='fictional-correction',payMonth='2026-10',payloadJson=JSON.stringify({payMonth});
  const sourceBase64=btoa(JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId,employeeUpn:upn,payMonth,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',rows:[{date:'2026-10-05',totalMinutes:120}]}));
  const bytes=Uint8Array.from(atob(sourceBase64),c=>c.charCodeAt(0)),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),generation=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
  const seed=[
   env.DB.prepare("INSERT INTO records VALUES (?,?,?,'timesheets','pay_month_correction','Queued for Accounts',?)").bind(recordId,oid,upn,payloadJson),
   env.DB.prepare('INSERT INTO timesheet_review_record_revisions VALUES (?,1)').bind(recordId),env.DB.prepare('INSERT INTO timesheet_owner_revisions VALUES (?,1)').bind(upn),
   env.DB.prepare('INSERT INTO timesheet_queue_source_guards VALUES (?,?,1,?)').bind(recordId,upn,sourceBase64),
   env.DB.prepare("INSERT INTO record_attachments VALUES (?,'attachment_record','fictional.json','application/json',?,1)").bind(recordId,sourceBase64),
   env.DB.prepare("INSERT INTO record_attachments VALUES (?,'attachment','fictional.xlsx','application/xlsx','eA==',1)").bind(recordId),
   env.DB.prepare("INSERT INTO record_attachments VALUES (?,'attachment_csv','fictional.csv','text/csv','eA==',1)").bind(recordId),
   env.DB.prepare('INSERT INTO timesheet_queue_attachment_guards VALUES (?,?)').bind(recordId,JSON.stringify([
    {fieldName:'attachment_record',fileName:'fictional.json',contentType:'application/json',contentBase64:sourceBase64,sizeBytes:1},
    {fieldName:'attachment',fileName:'fictional.xlsx',contentType:'application/xlsx',contentBase64:'eA==',sizeBytes:1},
    {fieldName:'attachment_csv',fileName:'fictional.csv',contentType:'text/csv',contentBase64:'eA==',sizeBytes:1}])),
   env.DB.prepare("INSERT INTO dispatch_queue VALUES (?,'queued','t',0,'2026-11-20T11:00:00.000Z',NULL,NULL)").bind(recordId),env.DB.prepare('INSERT INTO private_timesheet_subjects VALUES (?,?)').bind(upn,oid),
   env.DB.prepare("INSERT INTO pay_month_start_settings VALUES ('2026-10','2026-09-21')")];
  await env.DB.batch(seed);
  const q={recordId,subjectOid:oid,subjectUpn:upn,payMonth,sourceBase64,generation,ownerRevision:1,payloadJson,expectedRevision:0};
  const initialRevision=await selectPublicationSource(env,q);const candidate={...q,publicationRevision:1,driveId:'fictional-drive',itemId:'fictional-item',etag:'fictional-v1'};
  await recordPublicationCandidate(env,candidate);
  const otherDriveRejected=!(await publishCandidate(env,{...candidate,driveId:'fictional-other-drive'}));
  const published=await publishCandidate(env,candidate);
  const receiptPendingHeld=(await readPublishedCandidate(env,{subjectOid:oid,payMonth}))===null;
  const retryRevisions=await Promise.all([selectPublicationSource(env,q),selectPublicationSource(env,{...q,expectedRevision:1})]);
  const firstHandoff={...candidate,claimedAt:'2026-11-20T12:00:00.000Z',flowRunId:'fictional-run-first'};
  const firstClaim=await claimPublicationHandoff(env,firstHandoff);await bindPublicationFlow(env,{...firstHandoff,...firstClaim});
  await confirmPublicationHandoff(env,{...firstHandoff,...firstClaim});
  const sentWithoutReceiptHeld=(await readPublishedCandidate(env,{subjectOid:oid,payMonth}))===null;
  let sentSourceHeld=false,retryHeld=false;
  try{await env.DB.prepare("UPDATE records SET payload_json='{}' WHERE record_id=?").bind(recordId).run();}catch(_){sentSourceHeld=true;}
  try{await env.DB.prepare("UPDATE dispatch_queue SET status='queued' WHERE record_id=?").bind(recordId).run();}catch(_){retryHeld=true;}
  await completePublishedCandidate(env,{...firstHandoff,...firstClaim,verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'});
  const publishedDrive=(await readPublishedCandidate(env,{subjectOid:oid,payMonth}))?.driveId;
  const sameSelectionRetained=retryRevisions.every(value=>value===1) && (await readPublishedCandidate(env,{subjectOid:oid,payMonth}))?.itemId===candidate.itemId;
  let oldRouteBlocked=false;try{await env.DB.prepare('INSERT INTO timesheet_delivery_routes VALUES (?)').bind(candidate.itemId).run();}catch(_){oldRouteBlocked=true;}
  const publishedStillAvailable=(await readPublishedCandidate(env,{subjectOid:oid,payMonth}))?.itemId===candidate.itemId;
  await env.DB.prepare('INSERT INTO timesheet_delivery_routes VALUES (?)').bind('fictional-existing-writer').run();
  let oldWriterCandidateBlocked=false;
  try{await env.DB.prepare("INSERT INTO timesheet_publication_candidates VALUES ('other-subject','2026-11',1,?,'fictional-drive','fictional-existing-writer','v1')").bind(generation).run();}catch(_){oldWriterCandidateBlocked=true;}
  await env.DB.prepare("UPDATE record_attachments SET content_base64='e30=' WHERE record_id=? AND field_name='attachment_record'").bind(recordId).run();
  const changedSourceHeld=(await readPublishedCandidate(env,{subjectOid:oid,payMonth}))===null,stalePublishRejected=!(await publishCandidate(env,candidate));
  const sharedOid='22222222-2222-4222-8222-222222222222',sharedUpn='other@example.test',editorOid='33333333-3333-4333-8333-333333333333',editorUpn='accounts@example.test',sharedId='fictional-shared';
  const sharedSource=btoa(JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:sharedId,employeeUpn:sharedUpn,payMonth,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',rows:[{date:'2026-10-05',totalMinutes:180}]}));
  const hashText=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const sharedGeneration=await hashText(Uint8Array.from(atob(sharedSource),c=>c.charCodeAt(0))),payloadHash=await hashText(new TextEncoder().encode(payloadJson));
  await env.DB.batch([
   env.DB.prepare("INSERT INTO records VALUES (?,?,?,'timesheets','pay_month_correction','Queued for Accounts',?)").bind(sharedId,editorOid,editorUpn,payloadJson),
   env.DB.prepare('INSERT INTO timesheet_review_record_revisions VALUES (?,1)').bind(sharedId),env.DB.prepare('INSERT INTO timesheet_owner_revisions VALUES (?,1)').bind(editorUpn),
   env.DB.prepare('INSERT INTO timesheet_queue_source_guards VALUES (?,?,1,?)').bind(sharedId,editorUpn,sharedSource),env.DB.prepare("INSERT INTO record_attachments VALUES (?,'attachment_record','fictional.json','application/json',?,1)").bind(sharedId,sharedSource),
   env.DB.prepare("INSERT INTO record_attachments VALUES (?,'attachment','fictional.xlsx','application/xlsx','eA==',1)").bind(sharedId),
   env.DB.prepare("INSERT INTO record_attachments VALUES (?,'attachment_csv','fictional.csv','text/csv','eA==',1)").bind(sharedId),
   env.DB.prepare('INSERT INTO timesheet_queue_attachment_guards VALUES (?,?)').bind(sharedId,JSON.stringify([
    {fieldName:'attachment_record',fileName:'fictional.json',contentType:'application/json',contentBase64:sharedSource,sizeBytes:1},
    {fieldName:'attachment',fileName:'fictional.xlsx',contentType:'application/xlsx',contentBase64:'eA==',sizeBytes:1},
    {fieldName:'attachment_csv',fileName:'fictional.csv',contentType:'text/csv',contentBase64:'eA==',sizeBytes:1}])),
   env.DB.prepare("INSERT INTO dispatch_queue VALUES (?,'queued','t',0,'2026-11-20T11:00:00.000Z',NULL,NULL)").bind(sharedId),env.DB.prepare('INSERT INTO private_timesheet_subjects VALUES (?,?)').bind(sharedUpn,sharedOid),
   env.DB.prepare('INSERT INTO timesheet_ownership_reviews VALUES (1,?,1,?,?)').bind(sharedId,sharedOid,payloadHash)]);
  const shared={recordId:sharedId,subjectOid:sharedOid,subjectUpn:sharedUpn,payMonth,sourceBase64:sharedSource,generation:sharedGeneration,ownerRevision:1,payloadJson,expectedRevision:0};
  const sharedRevision=await selectPublicationSource(env,shared),sharedCandidate={...shared,publicationRevision:1,driveId:'fictional-drive',itemId:'fictional-shared-item',etag:'v1'};
  const handoff={...sharedCandidate,claimedAt:'2026-11-20T12:00:00.000Z'};
  const claimed=await Promise.all([claimPublicationHandoff(env,handoff),claimPublicationHandoff(env,handoff)]);
  const oneHandoff=claimed.filter(Boolean).length===1;
  const recovered=await findPublicationAttempt(env,handoff),wrongAttempt=await findPublicationAttempt(env,{...handoff,generation:'f'.repeat(64)});
  const exactAttemptRecovered=recovered?.attemptId===claimed.find(Boolean)?.attemptId&&recovered?.status==='sending'&&recovered?.flowRunId===null&&wrongAttempt===null;
  await recordPublicationCandidate(env,sharedCandidate);const sharedPublished=await publishCandidate(env,sharedCandidate);
  await bindPublicationFlow(env,{...handoff,attemptId:claimed.find(Boolean)?.attemptId,flowRunId:'fictional-run'});
  const read=await readPublicationSourceForRun(env,{...handoff,attemptId:claimed.find(Boolean)?.attemptId,flowRunId:'fictional-run'});
  const boundSourceRead=read.sourceBase64===sharedSource && read.generation===sharedGeneration && read.recordId===sharedId;
  const handoffConfirmed=await confirmPublicationHandoff(env,{...handoff,attemptId:claimed.find(Boolean)?.attemptId});
  const completion={...sharedCandidate,attemptId:claimed.find(Boolean)?.attemptId,flowRunId:'fictional-run',verificationDigest:'b'.repeat(64),completedAt:'2026-11-20T12:00:00.000Z'};
  await Promise.all([completePublishedCandidate(env,completion),completePublishedCandidate(env,completion)]);
  const completionQueue=await env.DB.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').bind(sharedId).first();
  const sealedCompletion=completionQueue?.status==='completed' && (await readPublishedCandidate(env,{subjectOid:sharedOid,payMonth}))?.itemId===sharedCandidate.itemId;
  await env.DB.prepare('INSERT INTO timesheet_owner_revisions VALUES (?,1)').bind(sharedUpn).run();
  const employeeHistoryHeld=(await readPublishedCandidate(env,{subjectOid:sharedOid,payMonth}))===null;
  // No source hold is seeded in this disposable fixture. The imported-source
  // review and provider boundary are separate checks, not simulated here.
  await env.DB.prepare('ALTER TABLE records ADD COLUMN employee_name TEXT').run();
  const syntheticOid='44444444-4444-4444-8444-444444444444',syntheticPayload=JSON.stringify({payMonth,testMode:true}),syntheticId=syntheticFixture.recordId,syntheticUpn=syntheticFixture.employeeUpn;
  const syntheticSource=btoa(JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:syntheticId,employeeName:syntheticFixture.employeeName,employeeUpn:syntheticUpn,payMonth,cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:syntheticId+'|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,note:'Fictional'}]}));
  const syntheticItems=[{fieldName:'attachment_record',fileName:'fictional.json',contentType:'application/json',contentBase64:syntheticSource,sizeBytes:1},{fieldName:'attachment',fileName:'fictional.xlsx',contentType:'application/xlsx',contentBase64:'eA==',sizeBytes:1},{fieldName:'attachment_csv',fileName:'fictional.csv',contentType:'text/csv',contentBase64:'eA==',sizeBytes:1}];
  await env.DB.batch([
   env.DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,kind,action,status,payload_json,employee_name) VALUES (?,?,?,'timesheets','pay_month_correction','Queued for Accounts',?,?)").bind(syntheticId,syntheticOid,syntheticUpn,syntheticPayload,syntheticFixture.employeeName),
   env.DB.prepare('INSERT INTO timesheet_review_record_revisions VALUES (?,1)').bind(syntheticId),env.DB.prepare('INSERT INTO timesheet_owner_revisions VALUES (?,1)').bind(syntheticUpn),
   env.DB.prepare('INSERT INTO timesheet_queue_source_guards VALUES (?,?,1,?)').bind(syntheticId,syntheticUpn,syntheticSource),
   ...syntheticItems.map(a=>env.DB.prepare('INSERT INTO record_attachments VALUES (?,?,?,?,?,?)').bind(syntheticId,a.fieldName,a.fileName,a.contentType,a.contentBase64,a.sizeBytes)),
   env.DB.prepare('INSERT INTO timesheet_queue_attachment_guards VALUES (?,?)').bind(syntheticId,JSON.stringify(syntheticItems)),
   env.DB.prepare("INSERT INTO dispatch_queue VALUES (?,'queued','t',0,'2000-01-01T00:00:00.000Z',NULL,NULL)").bind(syntheticId),env.DB.prepare('INSERT INTO private_timesheet_subjects VALUES (?,?)').bind(syntheticUpn,syntheticOid)]);
  const syntheticEnv={...env,SYNTHETIC_TEST_SUBJECT_OID:syntheticOid,SHAREPOINT_SITE_ID:'fictional.sharepoint.com,site,web',SHAREPOINT_DRIVE_ID:'fictional-drive',SYNTHETIC_TEST_WORKBOOK_ID:'fictional-workbook',SYNTHETIC_TEST_MONTH_FOLDER_ID:'fictional-parent'};
  const syntheticClaim=await claimBoundSyntheticDelivery(syntheticEnv,async()=>true);let syntheticRetryHeld=false;try{await claimBoundSyntheticDelivery(syntheticEnv,async()=>true)}catch(_){syntheticRetryHeld=true}
  const syntheticBinding={...syntheticClaim,subjectOid:syntheticOid,payMonth,publicationRevision:1,flowRunId:'fictional-bound-run'};
  await bindPublicationFlow(syntheticEnv,{...syntheticBinding,boundAt:new Date().toISOString()});
  const syntheticRead=await readPublicationSourceForRun(syntheticEnv,syntheticBinding);
  const workbookBytes=Uint8Array.from(atob(workbookBase64),c=>c.charCodeAt(0)),metadata={id:'fictional-workbook',name:`GMT Timesheet - ${syntheticFixture.employeeName} - Pay Month 2026-10.xlsx`,eTag:'v1',size:workbookBytes.length,parentReference:{driveId:'fictional-drive',id:'fictional-parent'},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}};
  const readback=await verifyBoundSyntheticWorkbook(syntheticEnv,syntheticBinding,{graphRequest:async path=>path.endsWith('/content')?new Response(workbookBytes):Response.json(metadata),downloadRequest:async()=>{throw Error('Unexpected download')}});
  const syntheticBoundReadback=readback.verified===true&&readback.generation===syntheticClaim.generation&&readback.publicationReleased===false&&readback.stagingWriterExclusion==='not-established';
  const syntheticFinish=await finishBoundSyntheticDelivery(syntheticEnv,{...syntheticClaim,outcome:'sent'});
  const syntheticBoundHandoff=syntheticRetryHeld&&syntheticRead.sourceBase64===syntheticSource&&syntheticFinish.accepted===true&&(await env.DB.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').bind(syntheticId).first())?.status==='sent';
  return Response.json({initialRevision,otherDriveRejected,published,receiptPendingHeld,sentWithoutReceiptHeld,sentSourceHeld,retryHeld,publishedDrive,sameSelectionRetained,oldRouteBlocked,oldWriterCandidateBlocked,publishedStillAvailable,changedSourceHeld,stalePublishRejected,sharedRevision,oneHandoff,exactAttemptRecovered,sharedPublished,boundSourceRead,handoffConfirmed,sealedCompletion,employeeHistoryHeld,syntheticBoundHandoff,syntheticBoundReadback});
 }catch(e){return new Response(String(e?.message||'fixture failed'),{status:500});}
}};
