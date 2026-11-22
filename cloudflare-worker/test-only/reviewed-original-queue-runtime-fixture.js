// Disposable, fictional local-D1 fixture. Never route or deploy this module.
import {stageReviewedOriginalQueue} from '../src/index.js';

export default {async fetch(request,env){
  if(new URL(request.url).hostname!=='127.0.0.1'||request.headers.get('x-test-key')!==env.TEST_KEY||request.method!=='POST')return new Response(null,{status:403});
  try{
    const ddl=[
      'CREATE TABLE records(record_id TEXT PRIMARY KEY,owner_oid TEXT,owner_upn TEXT,kind TEXT,action TEXT,status TEXT,payload_json TEXT)',
      'CREATE TABLE timesheet_owner_revisions(owner_upn TEXT PRIMARY KEY,revision INTEGER)',
      'CREATE TABLE pay_month_start_settings(month_key TEXT,start_date TEXT)',
      'CREATE TABLE record_versions(version_id INTEGER PRIMARY KEY,record_id TEXT,payload_json TEXT)',
      'CREATE TABLE timesheet_private_original_reviews(review_id INTEGER PRIMARY KEY,intent_id TEXT,record_id TEXT)',
      'CREATE TABLE timesheet_private_original_review_events(review_id INTEGER,event_type TEXT)',
      'CREATE TABLE timesheet_original_filing_revocations(intent_id TEXT)',
      'CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT,queued_at TEXT,updated_at TEXT,attempts INTEGER,next_attempt_at TEXT,last_sent_at TEXT,last_error TEXT)',
      'CREATE TABLE record_attachments(record_id TEXT,field_name TEXT,file_name TEXT,content_type TEXT,content_base64 TEXT,size_bytes INTEGER,created_at TEXT,PRIMARY KEY(record_id,field_name))',
      "CREATE TRIGGER reject_fixture_attachment BEFORE INSERT ON record_attachments WHEN (NEW.record_id='rollback' AND NEW.field_name='attachment_csv') OR NEW.file_name='break' BEGIN SELECT RAISE(ABORT,'fictional failure'); END"
    ];
    await env.DB.batch(ddl.map(sql=>env.DB.prepare(sql)));
    const attachments=['attachment','attachment_csv','attachment_record'].map(fieldName=>({fieldName,fileName:'fictional',contentType:'application/octet-stream',contentBase64:'Zg==',sizeBytes:1}));
    async function setup(id,reviewId){
      const record={record_id:id,owner_oid:'fictional-oid',owner_upn:id+'@example.test',payload_json:'{}',revision:1};
      await env.DB.batch([
        env.DB.prepare("INSERT INTO records VALUES (?,?,?,'timesheets','pay_month_correction','Submitted',?)").bind(id,record.owner_oid,record.owner_upn,record.payload_json),
        env.DB.prepare('INSERT INTO timesheet_owner_revisions VALUES (?,1)').bind(record.owner_upn),
        env.DB.prepare('INSERT INTO timesheet_private_original_reviews VALUES (?,?,?)').bind(reviewId,'intent-'+id,id)
      ]);
      return {record,versions:[],reviews:[{review_id:reviewId,intent_id:'intent-'+id}],settings:'[]'};
    }
    const success=await setup('success',1);
    // A history larger than D1's parameter limit still uses a fixed number of bindings.
    success.versions=Array.from({length:110},(_,index)=>({version_id:index+1,payload_json:JSON.stringify({fictional:index})}));
    await env.DB.batch(success.versions.map(v=>env.DB.prepare('INSERT INTO record_versions VALUES (?, ?, ?)').bind(v.version_id,'success',v.payload_json)));
    await stageReviewedOriginalQueue(env,'success',success,attachments);
    await stageReviewedOriginalQueue(env,'success',success,attachments);
    const beforeRetry=await env.DB.prepare("SELECT last_error FROM dispatch_queue WHERE record_id='success'").first();
    let failedReplacementRejected=false;try{await stageReviewedOriginalQueue(env,'success',success,attachments.map(a=>a.fieldName==='attachment_csv'?{...a,fileName:'break'}:a))}catch(_){failedReplacementRejected=true}
    const afterRetry=await env.DB.prepare("SELECT last_error FROM dispatch_queue WHERE record_id='success'").first();
    const oldAttachment=await env.DB.prepare("SELECT file_name FROM record_attachments WHERE record_id='success' AND field_name='attachment_csv'").first();
    const row=await env.DB.prepare("SELECT status,attempts,last_sent_at FROM dispatch_queue WHERE record_id='success'").first();
    const count=async(id,table)=>Number((await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE record_id=?`).bind(id).first()).n);
    const revoked=await setup('revoked',2);await env.DB.prepare("INSERT INTO timesheet_private_original_review_events VALUES (2,'revoked')").run();
    let revocationRejected=false;try{await stageReviewedOriginalQueue(env,'revoked',revoked,attachments)}catch(_){revocationRejected=true}
    const collision=await setup('collision',3);await env.DB.prepare("INSERT INTO dispatch_queue VALUES ('collision','skipped','t','t',0,'t',NULL,'Awaiting complete source and provider verification.')").run();
    let collisionRejected=false;try{await stageReviewedOriginalQueue(env,'collision',collision,attachments)}catch(_){collisionRejected=true}
    const rollback=await setup('rollback',4);let failedInsertRejected=false;try{await stageReviewedOriginalQueue(env,'rollback',rollback,attachments)}catch(_){failedInsertRejected=true}
    return Response.json({status:row?.status,attempts:row?.attempts,lastSent:row?.last_sent_at,successAttachments:await count('success','record_attachments'),failedReplacementRejected,priorHeldEntryPreserved:beforeRetry?.last_error===afterRetry?.last_error&&oldAttachment?.file_name==='fictional',revocationRejected,revokedQueue:await count('revoked','dispatch_queue'),collisionRejected,collisionAttachments:await count('collision','record_attachments'),failedInsertRejected,rollbackQueue:await count('rollback','dispatch_queue'),rollbackAttachments:await count('rollback','record_attachments')});
  }catch(error){return Response.json({error:String(error.message||error)},{status:500})}
}};
