import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {queueRecordAttachments as queueRaw} from '../cloudflare-worker/src/index.js';
const fictionalRow={recordId:'fixture|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'',changeNote:''};
const queueRecordAttachments=(env,record,body)=>env.DB.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').bind(record.owner_upn.toLowerCase()).first().then(row=>queueRaw(env,record,body,null,row.revision));

test('a completed generation cannot be queued again, but a later correction can',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 const wrap=(statement,args=[])=>({async first(){return sql.prepare(statement).get(...args)||null},async all(){return {results:sql.prepare(statement).all(...args)}},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
 const DB={prepare(statement){return {...wrap(statement),bind(...args){return wrap(statement,args)}}},async batch(statements){sql.exec('BEGIN');try{let results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}}};
 const make=(editedAt)=>{const record={record_id:'fixture',kind:'timesheets',action:'pay_month_correction',owner_oid:'subject',owner_upn:'person@example.test',employee_name:'Fictional',payload_json:JSON.stringify({payMonth:'2026-10',editedAt,rows:[],deletedDays:[]})};
  const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'fixture',employeeUpn:record.owner_upn,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:editedAt,rows:[fictionalRow],deletedDays:[]});
  const attachment=(fieldName,fileName,content)=>({fieldName,fileName,contentBase64:Buffer.from(content).toString('base64')});
  return {record,body:{attachments:[attachment('attachment','test.xlsx','x'),attachment('attachment_csv','test.csv','x'),attachment('attachment_record','test.json',source)]}};};
 const initial=make('2026-11-03T10:00:00.000Z');
 try {
  sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,'Submitted','t','t',?)`).run(initial.record.record_id,initial.record.owner_oid,initial.record.owner_upn,initial.record.employee_name,initial.record.kind,initial.record.action,initial.record.payload_json);
  await queueRecordAttachments({DB},initial.record,initial.body);
  sql.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='fixture'").run();
  await assert.rejects(()=>queueRecordAttachments({DB},initial.record,initial.body),error=>error.status===409,'a completed generation is not a retryable queue item');
  assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='fixture'").get().status,'completed');
  const reformatted=structuredClone(initial.body);const source=reformatted.attachments.find(x=>x.fieldName==='attachment_record');source.contentBase64=Buffer.from(JSON.stringify(JSON.parse(Buffer.from(source.contentBase64,'base64').toString()),null,2)).toString('base64');
  await assert.rejects(()=>queueRecordAttachments({DB},initial.record,reformatted),error=>error.status===409,'different JSON formatting cannot make the same saved correction into a new delivery');
  const later=make('2026-11-03T10:01:00.000Z');sql.prepare("UPDATE records SET payload_json=?,status='Submitted' WHERE record_id='fixture'").run(later.record.payload_json);
  const priorSource=sql.prepare("SELECT content_base64 FROM record_attachments WHERE record_id='fixture' AND field_name='attachment_record'").get().content_base64;
  await assert.rejects(()=>queueRecordAttachments({DB},later.record,later.body),error=>error.status===409,'completed status without a matching verified receipt is insufficient');
  const generation=createHash('sha256').update(Buffer.from(priorSource,'base64')).digest('hex'),started='2026-11-03T10:00:00.000Z';
  sql.prepare('INSERT INTO timesheet_delivery_routes VALUES(?,?,?,?,?,?,?,?)').run('fixture','run',started,generation,'employee','month','workbook',started);
  const receipt=sql.prepare('INSERT INTO timesheet_delivery_receipts(record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json) VALUES(?,?,?,?,?,?)');
  receipt.run('fixture','run',started,'workbook_verified',started,JSON.stringify({generation,sourceRowVerification:'source-row-v1'}));
  await assert.rejects(()=>queueRecordAttachments({DB},later.record,later.body),error=>error.status===409,'a workbook receipt without completion is insufficient');
  receipt.run('fixture','run',started,'flow_completed',started,JSON.stringify({generation}));
  sql.exec("CREATE TRIGGER fixture_fail_attachment BEFORE INSERT ON record_attachments BEGIN SELECT RAISE(ABORT,'fictional failure'); END");
  await assert.rejects(()=>queueRecordAttachments({DB},later.record,later.body),/fictional failure/);
  assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='fixture'").get().status,'completed','a failed attachment replacement rolls back the queue transition');
  assert.equal(sql.prepare("SELECT content_base64 FROM record_attachments WHERE record_id='fixture' AND field_name='attachment_record'").get().content_base64,priorSource);
  sql.exec('DROP TRIGGER fixture_fail_attachment');
  assert.equal((await queueRecordAttachments({DB},later.record,later.body)).queued,true,'a genuinely changed correction can start a later generation');
 }finally{sql.close()}
});

test('a completed queue with missing source evidence cannot be reset',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 const wrap=(statement,args=[])=>({async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
 const DB={prepare(statement){return {bind(...args){return wrap(statement,args)}}},async batch(statements){sql.exec('BEGIN');try{let r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const editedAt='2026-11-03T10:00:00.000Z',record={record_id:'fixture',owner_oid:'subject',owner_upn:'person@example.test',employee_name:'Fictional',kind:'timesheets',action:'pay_month_correction',payload_json:JSON.stringify({payMonth:'2026-10',editedAt,rows:[],deletedDays:[]})};
 const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'fixture',employeeUpn:record.owner_upn,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:editedAt,rows:[fictionalRow],deletedDays:[]});
 const attachment=(fieldName,fileName,content)=>({fieldName,fileName,contentBase64:Buffer.from(content).toString('base64')});
 const body={attachments:[attachment('attachment','test.xlsx','x'),attachment('attachment_csv','test.csv','x'),attachment('attachment_record','test.json',source)]};
 try{sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,'Submitted','t','t',?)`).run(record.record_id,record.owner_oid,record.owner_upn,record.employee_name,record.kind,record.action,record.payload_json);sql.prepare("INSERT INTO dispatch_queue VALUES('fixture','completed','t','t',1,'t','t',NULL)").run();
  await assert.rejects(()=>queueRecordAttachments({DB},record,body),error=>error.status===409);assert.equal(sql.prepare("SELECT status FROM dispatch_queue").get().status,'completed');
 }finally{sql.close()}
});

for(const race of ['completion after read','source changed after read'])test(`a completed queue is preserved when ${race}`,async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 const wrap=(statement,args=[])=>({async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
 let injected=false;const DB={prepare(statement){return {bind(...args){return wrap(statement,args)}}},async batch(statements){
   if(!injected){injected=true;if(race==='completion after read')sql.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id='fixture'").run();else sql.prepare("UPDATE record_attachments SET content_base64=? WHERE record_id='fixture' AND field_name='attachment_record'").run(Buffer.from('changed elsewhere').toString('base64'));}
   sql.exec('BEGIN');try{let r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const editedAt='2026-11-03T10:01:00.000Z',record={record_id:'fixture',owner_oid:'subject',owner_upn:'person@example.test',employee_name:'Fictional',kind:'timesheets',action:'pay_month_correction',payload_json:JSON.stringify({payMonth:'2026-10',editedAt,rows:[],deletedDays:[]})};
 const source=at=>JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'fixture',employeeUpn:record.owner_upn,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:at,rows:[fictionalRow],deletedDays:[]});
 const attachment=(fieldName,fileName,content)=>({fieldName,fileName,contentBase64:Buffer.from(content).toString('base64')});const body={attachments:[attachment('attachment','test.xlsx','x'),attachment('attachment_csv','test.csv','x'),attachment('attachment_record','test.json',source(editedAt))]};
 try{
  sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,'Submitted','t','t',?)`).run(record.record_id,record.owner_oid,record.owner_upn,record.employee_name,record.kind,record.action,record.payload_json);
  sql.prepare('INSERT INTO dispatch_queue VALUES(?,?,?,?,0,?,NULL,NULL)').run('fixture',race==='completion after read'?'queued':'completed','t','t','t');
  const old=Buffer.from(source('2026-11-03T10:00:00.000Z')).toString('base64');sql.prepare("INSERT INTO record_attachments VALUES('fixture','attachment_record','old.json','application/json',?,1,'t')").run(old);
  const generation=createHash('sha256').update(Buffer.from(old,'base64')).digest('hex'),started='2026-11-03T10:00:00.000Z';sql.prepare('INSERT INTO timesheet_delivery_routes VALUES(?,?,?,?,?,?,?,?)').run('fixture','run',started,generation,'employee','month','workbook',started);
  const receipt=sql.prepare('INSERT INTO timesheet_delivery_receipts(record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json) VALUES(?,?,?,?,?,?)');receipt.run('fixture','run',started,'workbook_verified',started,JSON.stringify({generation,sourceRowVerification:'source-row-v1'}));receipt.run('fixture','run',started,'flow_completed',started,JSON.stringify({generation}));
  await assert.rejects(()=>queueRecordAttachments({DB},record,body),error=>error.status===409);assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='fixture'").get().status,'completed');
  assert.equal(sql.prepare("SELECT count(*) AS n FROM record_attachments WHERE record_id='fixture'").get().n,1,'the losing request cannot replace any attachments');
 }finally{sql.close()}
});

test('the queue stays held if an attachment differs before the reservation is released',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
 const wrap=(statement,args=[])=>({async first(){return sql.prepare(statement).get(...args)||null},async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}});
 const DB={prepare(statement){return {bind(...args){return wrap(statement,args)}}},async batch(statements){sql.exec('BEGIN');try{const r=[];for(let i=0;i<statements.length;i++){if(i===statements.length-1)sql.prepare("UPDATE record_attachments SET content_base64='eQ==' WHERE record_id='fixture' AND field_name='attachment_csv'").run();r.push(await statements[i].run())}sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const editedAt='2026-11-03T10:00:00.000Z',record={record_id:'fixture',owner_oid:'subject',owner_upn:'person@example.test',employee_name:'Fictional',kind:'timesheets',action:'pay_month_correction',payload_json:JSON.stringify({payMonth:'2026-10',editedAt,rows:[],deletedDays:[]})};
 const source=JSON.stringify({schemaVersion:2,mode:'replace-pay-month',recordId:'fixture',employeeUpn:record.owner_upn,payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',submittedAt:editedAt,rows:[fictionalRow],deletedDays:[]});const a=(fieldName,fileName,content)=>({fieldName,fileName,contentBase64:Buffer.from(content).toString('base64')});
 try{sql.prepare(`INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,'Submitted','t','t',?)`).run(record.record_id,record.owner_oid,record.owner_upn,record.employee_name,record.kind,record.action,record.payload_json);
  await assert.rejects(()=>queueRecordAttachments({DB},record,{attachments:[a('attachment','test.xlsx','x'),a('attachment_csv','test.csv','x'),a('attachment_record','test.json',source)]}),error=>error.status===409);
  assert.equal(sql.prepare("SELECT status FROM dispatch_queue WHERE record_id='fixture'").get().status,'skipped','a partial or changed preparation is not dispatched');
 }finally{sql.close()}
});
