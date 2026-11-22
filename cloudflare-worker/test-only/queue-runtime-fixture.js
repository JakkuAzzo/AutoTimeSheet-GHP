// Disposable local D1 integration fixture. Never bind this Worker to live data.
import {queueRecordAttachments as queueRaw,correctionGeneration,validateKnownPayMonthSource,dispatchQueued} from '../src/index.js';
import {bindPrivateOriginalProof,createPrivateOriginalIntent,readPrivateOriginalIntent,reservePrivateOriginalCreate} from '../src/private-timesheet-original-store.js';
import {getPrivateOriginalReviewSnapshot,recordPrivateOriginalReview,revokePrivateOriginalReview} from '../src/private-timesheet-original-review-store.js';
import {syntheticQueueCapability} from '../src/synthetic-queue-capability.js';

export default {async fetch(request,env){
  if(!env.TEST_KEY || request.headers.get('x-test-key')!==env.TEST_KEY)return new Response('Not found',{status:404});
  try {
    const DB=env.DB;
    for(const sql of [
      'CREATE TABLE records(record_id TEXT PRIMARY KEY,owner_oid TEXT,owner_upn TEXT,employee_name TEXT,kind TEXT,action TEXT,status TEXT,issue TEXT,updated_at TEXT,payload_json TEXT,start_date TEXT,end_date TEXT,record_date TEXT,submitted_at TEXT,source_message_key TEXT,source_attachment_ids TEXT,reconciliation_key TEXT,source_variant_status TEXT,reconciled_at TEXT,created_at TEXT)',
      'CREATE TABLE record_versions(record_id TEXT,owner_oid TEXT,payload_json TEXT)',
      'CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT,queued_at TEXT,updated_at TEXT,attempts INTEGER,next_attempt_at TEXT,last_sent_at TEXT,last_error TEXT)',
      'CREATE TABLE record_attachments(record_id TEXT,field_name TEXT,file_name TEXT,content_type TEXT,content_base64 TEXT,size_bytes INTEGER,created_at TEXT,PRIMARY KEY(record_id,field_name))',
      'CREATE TABLE timesheet_ownership_reviews(record_id TEXT,subject_oid TEXT)',
      'CREATE TABLE timesheet_owner_revisions(owner_upn TEXT PRIMARY KEY,revision INTEGER NOT NULL)',
      'CREATE TABLE private_timesheet_subjects(employee_upn TEXT PRIMARY KEY,employee_oid TEXT)',
      'CREATE TABLE timesheet_queue_source_guards(record_id TEXT PRIMARY KEY,owner_upn TEXT NOT NULL,owner_revision INTEGER NOT NULL,source_base64 TEXT NOT NULL)',
      'CREATE TABLE timesheet_queue_attachment_guards(record_id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL)',
      'CREATE TABLE timesheet_import_source_holds(record_id TEXT PRIMARY KEY,first_seen_at TEXT NOT NULL)',
      'CREATE TABLE pay_month_start_settings(month_key TEXT PRIMARY KEY,start_date TEXT)',
      'CREATE TRIGGER fixture_revision_insert AFTER INSERT ON records BEGIN INSERT INTO timesheet_owner_revisions VALUES(lower(NEW.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1; END',
      'CREATE TRIGGER fixture_revision_update AFTER UPDATE ON records BEGIN INSERT INTO timesheet_owner_revisions VALUES(lower(NEW.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1; END',
      'CREATE TABLE timesheet_delivery_routes(record_id TEXT,flow_run_id TEXT,run_started_at TEXT,generation TEXT)',
      'CREATE TABLE timesheet_delivery_receipts(record_id TEXT,flow_run_id TEXT,run_started_at TEXT,event_type TEXT,evidence_json TEXT)'
    ])await DB.prepare(sql).run();
    const input=await request.json();
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,kind,action,status,payload_json) VALUES('probe-backfill','probe-oid','probe@example.test','timesheets','submission','Submitted',?)").bind(JSON.stringify({importSourceId:'fictional',rows:[{date:'2026-09-01'}]})).run();
    if(!Array.isArray(input.sourceDayStatements)||!input.sourceDayStatements.length)throw new Error('Imported source-day migration missing');
    for(const sql of input.sourceDayStatements)await DB.prepare(sql).run();
    const sourceDayBackfilled=Boolean(await DB.prepare("SELECT 1 FROM timesheet_import_source_days WHERE record_id='probe-backfill' AND source_day='2026-09-01'").first());
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,kind,action,status,payload_json) VALUES('probe-new','probe-oid','probe@example.test','timesheets','submission','Submitted',?)").bind(JSON.stringify({importSourceId:'fictional',rows:[{date:'2026-10-01'}]})).run();
    await DB.prepare("UPDATE records SET payload_json='{}' WHERE record_id='probe-new'").run();
    const sourceDayRetained=Boolean(await DB.prepare("SELECT 1 FROM timesheet_import_source_days WHERE record_id='probe-new' AND source_day='2026-10-01'").first());
    let sourceDayImmutable=false;try{await DB.prepare("DELETE FROM timesheet_import_source_days WHERE record_id='probe-new'").run()}catch(error){sourceDayImmutable=String(error.message).includes('immutable')}
    if(!Array.isArray(input.triggers) || input.triggers.length!==17)throw new Error('Local trigger fixture missing');
    for(const sql of input.triggers)await DB.prepare(sql).run();
    if(!Array.isArray(input.subjectLockStatements) || !input.subjectLockStatements.length)throw new Error('Reviewed subject lock migration missing');
    for(const sql of input.subjectLockStatements)await DB.prepare(sql).run();
    if(!Array.isArray(input.originalStatements) || !input.originalStatements.length)throw new Error('Original filing migration missing');
    for(const sql of input.originalStatements)await DB.prepare(sql).run();
    if(!Array.isArray(input.reservationStatements) || !input.reservationStatements.length)throw new Error('Original reservation migration missing');
    for(const sql of input.reservationStatements)await DB.prepare(sql).run();
    if(!Array.isArray(input.reviewStatements) || !input.reviewStatements.length)throw new Error('Original review migration missing');
    for(const sql of input.reviewStatements)await DB.prepare(sql).run();
    const queueRecordAttachments=async (args,record,body)=>queueRaw(args,record,body,null,(await DB.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').bind(record.owner_upn.toLowerCase()).first()).revision);
    const make=t=>{
      const record={record_id:'fixture',owner_oid:'subject',owner_upn:'person@example.test',employee_name:'Fictional',kind:'timesheets',action:'pay_month_correction',payload_json:JSON.stringify({payMonth:'2026-10',editedAt:t,rows:[],deletedDays:[]})};
      const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'fixture',employeeUpn:record.owner_upn,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:t,rows:[{recordId:'fixture|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'',changeNote:''}],deletedDays:[]});
      const a=(fieldName,fileName,data)=>({fieldName,fileName,contentBase64:btoa(data)});
      return {record,body:{attachments:[a('attachment','a.xlsx','x'),a('attachment_csv','a.csv','x'),a('attachment_record','a.json',source)]}};
    };
    const first=make('2026-11-03T10:00:00.000Z');
    const period={start:'2026-09-21',cycleEnd:'2026-10-18'};
    const known=[{date:'2026-10-05',start:'09:00',finish:'12:00',breakMinutes:0,absence:'NA'}];
    const sourceAttachment=first.body.attachments.find(item=>item.fieldName==='attachment_record');
    const source=JSON.parse(atob(sourceAttachment.contentBase64));
    const compare=rows=>validateKnownPayMonthSource(first.record,known,[{...sourceAttachment,contentBase64:btoa(JSON.stringify({...source,rows}))}],period);
    compare(source.rows);const knownSourceMatched=true;
    let changedKnownRejected=false,missingKnownRejected=false;
    try{compare([{...source.rows[0],finishTime:'13:00',totalMinutes:240,workedHours:4}])}catch(error){changedKnownRejected=error.status===409}
    const extra={...source.rows[0],date:'2026-10-06',recordId:'fixture|2026-10-06'};
    try{compare([extra])}catch(error){missingKnownRejected=error.status===409}
    compare([...source.rows,extra]);const additionalDayAllowed=true;
    const rates={sourceBasicMinutes:null,sourceOt15Minutes:null,sourceOt20Minutes:null};
    const rateSource={...source,schemaVersion:3,rows:source.rows.map(row=>({...row,...rates}))};
    const rateAttachment={...sourceAttachment,contentBase64:btoa(JSON.stringify(rateSource))};
    validateKnownPayMonthSource(first.record,known,[rateAttachment],period);const rateKnownMatched=true;
    let rateChangedRejected=false;try{validateKnownPayMonthSource(first.record,known,[{...rateAttachment,contentBase64:btoa(JSON.stringify({...rateSource,rows:[{...rateSource.rows[0],sourceBasicMinutes:0}]}))}],period)}catch(error){rateChangedRejected=error.status===409}
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,issue,updated_at,payload_json) VALUES(?,?,?,?,?,?,'Submitted','','t',?)").bind(first.record.record_id,first.record.owner_oid,first.record.owner_upn,first.record.employee_name,first.record.kind,first.record.action,first.record.payload_json).run();
    const rateBody=structuredClone(first.body);rateBody.attachments[2]=rateAttachment;
    let rateDisabledRejected=false;try{await queueRecordAttachments({DB},first.record,rateBody)}catch(error){rateDisabledRejected=error.status===409}
    let rateEnabledRejected=false;try{await queueRecordAttachments({DB,PAY_MONTH_RATE_DELIVERY_READY:'true'},first.record,rateBody)}catch(error){rateEnabledRejected=error.status===409&&/independent.*review/i.test(error.message)}
    await DB.prepare("INSERT INTO timesheet_import_source_holds VALUES('fixture','t')").run();
    let importedHeld=false;try{await queueRecordAttachments({DB},first.record,first.body)}catch(error){importedHeld=error.status===409&&/independent.*source.*review/i.test(error.message)}
    await DB.prepare("DELETE FROM timesheet_import_source_holds WHERE record_id='fixture'").run(); // disposable fixture; production hold rows are immutable
    const heldFixture=make('2026-11-03T10:00:00.000Z');heldFixture.record.record_id='held-fixture';heldFixture.record.owner_oid='held-subject';heldFixture.record.owner_upn='held@example.test';
    const heldSource=JSON.parse(atob(heldFixture.body.attachments[2].contentBase64));heldSource.recordId='held-fixture';heldSource.employeeUpn='held@example.test';heldSource.rows=heldSource.rows.map(row=>({...row,recordId:'held-fixture|'+row.date}));heldFixture.body.attachments[2].contentBase64=btoa(JSON.stringify(heldSource));
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,issue,updated_at,payload_json) VALUES(?,?,?,?,?,?,'Submitted','','t',?)").bind(heldFixture.record.record_id,heldFixture.record.owner_oid,heldFixture.record.owner_upn,heldFixture.record.employee_name,heldFixture.record.kind,heldFixture.record.action,heldFixture.record.payload_json).run();
    await DB.prepare("INSERT INTO timesheet_import_source_days VALUES('earlier','held-subject','held@example.test','2026-10-05')").run();
    let importedDayHeld=false;try{await queueRecordAttachments({DB},heldFixture.record,heldFixture.body)}catch(error){importedDayHeld=error.status===409&&/independent.*source.*review/i.test(error.message)}
    const firstQueued=await queueRecordAttachments({DB},first.record,first.body);
    // Isolated capability with a prevalidated local snapshot creates local
    // source proofs, but must not delete or bypass the source hold itself.
    const fictional=make('2026-11-03T10:00:00.000Z');fictional.record.record_id='synthetic-fixture';fictional.record.owner_oid='synthetic-oid';fictional.record.owner_upn='synthetic@example.test';fictional.record.payload_json=JSON.stringify({...JSON.parse(fictional.record.payload_json),testMode:true});
    const fictionalSource=JSON.parse(atob(fictional.body.attachments[2].contentBase64));fictionalSource.recordId=fictional.record.record_id;fictionalSource.employeeUpn=fictional.record.owner_upn;fictionalSource.rows=fictionalSource.rows.map(row=>({...row,recordId:'synthetic-fixture|'+row.date}));fictional.body.attachments[2].contentBase64=btoa(JSON.stringify(fictionalSource));
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,issue,updated_at,payload_json) VALUES(?,?,?,?,?,?,'Submitted','','t',?)").bind(fictional.record.record_id,fictional.record.owner_oid,fictional.record.owner_upn,fictional.record.employee_name,fictional.record.kind,fictional.record.action,fictional.record.payload_json).run();
    await DB.prepare("INSERT INTO timesheet_import_source_holds VALUES('synthetic-fixture','t')").run();
    const fictionalRevision=(await DB.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').bind(fictional.record.owner_upn).first()).revision;
    const fictionalQueued=await queueRaw({DB,SYNTHETIC_TEST_QUEUE_ENABLED:'true',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP'},fictional.record,fictional.body,syntheticQueueCapability,fictionalRevision);
    const fictionalProof=await DB.prepare("SELECT owner_revision,source_base64 FROM timesheet_queue_source_guards WHERE record_id='synthetic-fixture'").first(),fictionalManifest=await DB.prepare("SELECT manifest_json FROM timesheet_queue_attachment_guards WHERE record_id='synthetic-fixture'").first();
    const syntheticProofRetained=fictionalQueued.queued===true&&fictionalProof?.owner_revision===fictionalRevision+1&&fictionalProof?.source_base64===fictional.body.attachments[2].contentBase64&&JSON.parse(fictionalManifest?.manifest_json||'[]').length===3&&Boolean(await DB.prepare("SELECT 1 FROM timesheet_import_source_holds WHERE record_id='synthetic-fixture'").first());
    let fixtureSends=0;
    const dispatch=await dispatchQueued({DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'fictional-test-key-at-least-thirty-two-characters'}, {now:'2099-01-01T00:00:00.000Z',fetchImpl:async()=>{fixtureSends++;throw new Error('Unexpected sender')}});
    const gateRow=await DB.prepare("SELECT status,attempts FROM dispatch_queue WHERE record_id='fixture'").first();
    const legacyDispatchHeld=firstQueued.providerStatus==='awaiting-source-review' && dispatch.status==='awaiting-source-review' && fixtureSends===0 && gateRow.status==='queued' && gateRow.attempts===0;
    await DB.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='fixture'").run();
    const reformatted=structuredClone(first.body),attachment=reformatted.attachments.find(x=>x.fieldName==='attachment_record');attachment.contentBase64=btoa(JSON.stringify(JSON.parse(atob(attachment.contentBase64)),null,2));
    let duplicateRejected=false;try{await queueRecordAttachments({DB},first.record,reformatted)}catch(error){duplicateRejected=error.status===409}
    const generation=await correctionGeneration(first.body.attachments[2].contentBase64),started='2026-11-03T10:00:00.000Z';
    await DB.prepare("INSERT INTO timesheet_delivery_routes VALUES('fixture','run',?,?)").bind(started,generation).run();
    await DB.prepare("INSERT INTO timesheet_delivery_receipts VALUES('fixture','run',?,'workbook_verified',?)").bind(started,JSON.stringify({generation,sourceRowVerification:'source-row-v1'})).run();
    await DB.prepare("INSERT INTO timesheet_delivery_receipts VALUES('fixture','run',?,'flow_completed',?)").bind(started,JSON.stringify({generation})).run();
    const next=make('2026-11-03T10:01:00.000Z');
    await DB.prepare("UPDATE records SET payload_json=?,status='Submitted' WHERE record_id='fixture'").bind(next.record.payload_json).run();
    const queued=await queueRecordAttachments({DB},next.record,next.body),current=await DB.prepare("SELECT status,last_error FROM dispatch_queue WHERE record_id='fixture'").first();
    await DB.prepare("UPDATE dispatch_queue SET status='sending' WHERE record_id='fixture'").run();
    let handoffBlocked=false;try{await DB.prepare("UPDATE records SET payload_json='{}' WHERE record_id='fixture'").run()}catch(error){handoffBlocked=String(error.message).includes('gmt_timesheet_handoff_in_progress')}
    const active=await DB.prepare("SELECT updated_at FROM dispatch_queue WHERE record_id='fixture'").first();
    await DB.prepare("UPDATE dispatch_queue SET status='sent' WHERE record_id='fixture'").run();
    await DB.prepare("UPDATE records SET status='Sent to Accounts',updated_at=? WHERE record_id='fixture'").bind(active.updated_at).run();
    let writeBlocked=false;try{await DB.prepare("UPDATE records SET payload_json='{}' WHERE record_id='fixture'").run()}catch(error){writeBlocked=String(error.message).includes('gmt_timesheet_delivery_in_progress')}
    let periodBlocked=false;try{await DB.prepare("INSERT INTO pay_month_start_settings VALUES('2026-11','2026-10-26')").run()}catch(error){periodBlocked=String(error.message).includes('gmt_timesheet_delivery_in_progress')}
    await DB.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='fixture'").run();
    // Simulate an older completed v3 delivery solely to verify that a later
    // correction requires the v3 receipt marker. It is not newly dispatched.
    const nextSource=JSON.parse(atob(next.body.attachments[2].contentBase64));nextSource.schemaVersion=3;nextSource.rows=nextSource.rows.map(row=>({...row,...rates}));next.body.attachments[2].contentBase64=btoa(JSON.stringify(nextSource));
    await DB.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id='fixture' AND field_name='attachment_record'").bind(next.body.attachments[2].contentBase64).run();
    const secondGeneration=await correctionGeneration(next.body.attachments[2].contentBase64);
    await DB.prepare("INSERT INTO timesheet_delivery_routes VALUES('fixture','run2',?,?)").bind(started,secondGeneration).run();
    await DB.prepare("INSERT INTO timesheet_delivery_receipts VALUES('fixture','run2',?,'workbook_verified',?)").bind(started,JSON.stringify({generation:secondGeneration,sourceRowVerification:'source-row-v1'})).run();
    await DB.prepare("INSERT INTO timesheet_delivery_receipts VALUES('fixture','run2',?,'flow_completed',?)").bind(started,JSON.stringify({generation:secondGeneration})).run();
    const third=make('2026-11-03T10:02:00.000Z');await DB.prepare("UPDATE records SET payload_json=?,status='Submitted' WHERE record_id='fixture'").bind(third.record.payload_json).run();
    let oldRateProofRejected=false;try{await queueRecordAttachments({DB},third.record,third.body)}catch(error){oldRateProofRejected=error.status===409}
    await DB.prepare("UPDATE timesheet_delivery_receipts SET evidence_json=? WHERE record_id='fixture' AND flow_run_id='run2' AND event_type='workbook_verified'").bind(JSON.stringify({generation:secondGeneration,sourceRowVerification:'source-row-v2'})).run();
    await DB.prepare("CREATE TRIGGER fictional_change AFTER INSERT ON record_attachments WHEN NEW.field_name='attachment_csv' BEGIN UPDATE record_attachments SET content_base64='eQ==' WHERE record_id=NEW.record_id AND field_name=NEW.field_name; END").run();
    let changedFileRejected=false;try{await queueRecordAttachments({DB},third.record,third.body)}catch(error){changedFileRejected=error.status===409}
    const held=await DB.prepare("SELECT status FROM dispatch_queue WHERE record_id='fixture'").first();
    const employee='0244eee3-2f7f-4d41-a6e9-af4a5a07fbd2',owner='original@example.test',sha='a'.repeat(64),recordId='original-fixture',at='2026-11-17T18:00:00.000Z';
    const payload=JSON.stringify({rows:[{date:'2026-10-05',sourceEvidence:{sourceId:sha}}]}),payloadHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))),value=>value.toString(16).padStart(2,'0')).join('');
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,payload_json) VALUES(?,?,?,'Fictional','timesheets','pay_month_correction','Submitted',?)").bind(recordId,employee,owner,payload).run();
    await DB.prepare('INSERT INTO private_timesheet_subjects VALUES(?,?)').bind(owner,employee).run();
    const revision=(await DB.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').bind(owner).first()).revision;
    const intentInput={recordId,employeeOid:employee,ownerUpn:owner,sourceSha256:sha,ownerRevision:revision,dates:['2026-10-05'],recordPayload:payload,actorOid:'11111111-1111-4111-8111-111111111111'};
    const unauthorisedIntentRejected=(await createPrivateOriginalIntent(DB,intentInput,async()=>false,at))===null;
    const createdIntent=await createPrivateOriginalIntent(DB,intentInput,async()=>true,at),originalIntentCreated=Boolean(createdIntent?.reviewId);
    const originalCreateReserved=await reservePrivateOriginalCreate(DB,createdIntent,'admin-vault',sha+'.docx',at);
    const originalDuplicateCreateHeld=!await reservePrivateOriginalCreate(DB,createdIntent,'admin-vault',sha+'.pdf',at);
    let originalReservationImmutable=false;try{await DB.prepare("DELETE FROM timesheet_original_create_reservations WHERE vault_id='admin-vault'").run()}catch(error){originalReservationImmutable=String(error.message).includes('immutable')}
    await DB.prepare('INSERT INTO timesheet_original_filing_intents VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind('intent-one',recordId,employee,owner,sha,payloadHash,revision,JSON.stringify(['2026-10-05']),'11111111-1111-4111-8111-111111111111','2026-11-17T17:00:00.000Z','2026-11-17T19:00:00.000Z').run();
    const proof={recordId,employeeOid:employee,sourceSha256:sha,reviewId:'intent-one',recordRevision:revision,dates:['2026-10-05'],itemId:'source-item',vaultId:'admin-vault',eTag:'version-one',fileName:sha+'.docx',reviewState:'pending'};
    const originalBound=await bindPrivateOriginalProof(DB,proof,payload,at),originalRetry=await bindPrivateOriginalProof(DB,proof,payload,at);
    const draft=await getPrivateOriginalReviewSnapshot(DB,'intent-one');
    const reviewed=await recordPrivateOriginalReview(DB,{intentId:'intent-one',reviewerOid:'11111111-1111-4111-8111-111111111111',expectedPayloadSha256:payloadHash,expectedFileEtag:'version-one',expectedEventId:draft.eventId,confirmed:true},async candidate=>candidate.itemId==='source-item',at);
    const originalReviewRecorded=Boolean(reviewed?.reviewId),originalReviewRevoked=await revokePrivateOriginalReview(DB,{intentId:'intent-one',reviewId:reviewed.reviewId,actorOid:'11111111-1111-4111-8111-111111111111'},at);
    const staleOriginalReviewHeld=(await recordPrivateOriginalReview(DB,{intentId:'intent-one',reviewerOid:'11111111-1111-4111-8111-111111111111',expectedPayloadSha256:payloadHash,expectedFileEtag:'version-one',expectedEventId:0,confirmed:true},async()=>true,at))===null;
    const changedOriginalRejected=!await bindPrivateOriginalProof(DB,{...proof,eTag:'different'},payload,at);
    let originalImmutable=false;try{await DB.prepare("UPDATE timesheet_private_originals SET item_etag='changed' WHERE intent_id='intent-one'").run()}catch(error){originalImmutable=String(error.message).includes('immutable')}
    await DB.prepare("UPDATE records SET payload_json='{}' WHERE record_id=?").bind(recordId).run();
    const staleOriginalRejected=!await bindPrivateOriginalProof(DB,proof,payload,at);
    const staleIntentRejected=(await readPrivateOriginalIntent(DB,createdIntent.reviewId,async()=>true,at))===null;
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,kind,action,status,payload_json) VALUES('reviewed-correction','editor','editor@example.test','timesheets','pay_month_correction','Queued for Accounts','{}')").run();
    await DB.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,kind,action,status,payload_json) VALUES('reviewed-source','reviewed-employee','reviewed@example.test','timesheets','submit','Submitted','{}')").run();
    await DB.prepare("INSERT INTO private_timesheet_subjects VALUES('reviewed@example.test','reviewed-employee')").run();
    await DB.prepare("INSERT INTO timesheet_ownership_reviews VALUES('reviewed-correction','reviewed-employee')").run();
    await DB.prepare("INSERT INTO dispatch_queue(record_id,status) VALUES('reviewed-correction','sending')").run();
    let reviewedSubjectHandoffHeld=false;try{await DB.prepare("UPDATE records SET payload_json='changed' WHERE record_id='reviewed-source'").run()}catch(error){reviewedSubjectHandoffHeld=String(error.message).includes('gmt_timesheet_reviewed_delivery_in_progress')}
    await DB.prepare("INSERT INTO timesheet_delivery_routes VALUES('reviewed-correction','reviewed-run','t','fictional')").run();
    await DB.prepare("UPDATE dispatch_queue SET status='sent' WHERE record_id='reviewed-correction'").run();
    let reviewedSubjectWriteHeld=false;try{await DB.prepare("UPDATE records SET payload_json='changed' WHERE record_id='reviewed-source'").run()}catch(error){reviewedSubjectWriteHeld=String(error.message).includes('gmt_timesheet_reviewed_delivery_in_progress')}
    await DB.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='reviewed-correction'").run();
    await DB.prepare("UPDATE records SET payload_json='changed' WHERE record_id='reviewed-source'").run();
    const reviewedSubjectReleased=(await DB.prepare("SELECT payload_json FROM records WHERE record_id='reviewed-source'").first())?.payload_json==='changed';
    return Response.json({sourceDayBackfilled,sourceDayRetained,sourceDayImmutable,knownSourceMatched,changedKnownRejected,missingKnownRejected,additionalDayAllowed,rateKnownMatched,rateChangedRejected,rateDisabledRejected,rateEnabledRejected,importedHeld,importedDayHeld,syntheticProofRetained,legacyDispatchHeld,duplicateRejected,laterQueued:queued.queued,status:current.status,markerCleared:current.last_error===null,handoffBlocked,writeBlocked,periodBlocked,oldRateProofRejected,changedFileRejected,heldStatus:held.status,originalIntentCreated,originalCreateReserved,originalDuplicateCreateHeld,originalReservationImmutable,originalReviewRecorded,originalReviewRevoked,staleOriginalReviewHeld,unauthorisedIntentRejected,staleIntentRejected,originalBound,originalRetry,changedOriginalRejected,staleOriginalRejected,originalImmutable,reviewedSubjectHandoffHeld,reviewedSubjectWriteHeld,reviewedSubjectReleased});
  }catch(error){return Response.json({error:error.message},{status:500})}
}};
