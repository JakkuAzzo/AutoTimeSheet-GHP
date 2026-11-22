import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {verifyXlsxPrototype,verifyProviderPrototype} from '../tools/prototypes/pay-month-xlsx-readback.mjs';
import * as readback from '../tools/prototypes/pay-month-xlsx-readback.mjs';
import {selectPublicationSource,claimPublicationHandoff,bindPublicationFlow,confirmPublicationHandoff,recordPublicationCandidate,publishCandidate,completePublishedCandidate,readPublishedCandidate} from '../cloudflare-worker/src/timesheet-source-publication-guard.js';

const recordId='fictional-byte-check';
const source={schemaVersion:2,mode:'replace-pay-month',recordId,employeeName:'Fictional',payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-18',deletedDays:[],rows:[{recordId:recordId+'|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,note:'Fictional'}]};
const fileName='GMT Timesheet - Fictional - Pay Month 2026-10.xlsx';
function fixture(change=()=>{}){
 const book=XLSX.utils.book_new();
 const daily=XLSX.utils.aoa_to_sheet([['Date','Start','Finish','Break','Absence','Total hours','Notes'],['2026-10-05','09:00','12:00',0,'NA',0.125,'Fictional'],['Pay month total','','','','',0.125,'']]);
 daily.F2.f='IF(E2<>"NA",0,IF(OR(B2="",C2="",D2=""),0.125,MOD(C2-B2,1)-D2/1440))';daily.F3.f='SUM(F2:F2)';
 const weekly=XLSX.utils.aoa_to_sheet([['Week Start','Week End','Total hours'],['2026-09-21','2026-09-27',0],['2026-09-28','2026-10-04',0],['2026-10-05','2026-10-11',0.125],['2026-10-12','2026-10-18',0],['Month total','',0.125]]);
 for(let n=2;n<=5;n++)weekly['C'+n].f=`SUMIFS('Daily Entries'!$F$2:$F$2,'Daily Entries'!$A$2:$A$2,">="&A${n},'Daily Entries'!$A$2:$A$2,"<="&B${n})`;
 weekly.C6.f='SUM(C2:C5)';
 XLSX.utils.book_append_sheet(book,daily,'Daily Entries');XLSX.utils.book_append_sheet(book,weekly,'Weekly Totals');change(book);
 return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
}
const verify=bytes=>verifyXlsxPrototype(bytes,{fileName,recordJson:JSON.stringify(source)});

test('fictional XLSX bytes preserve source rows and expected formulas',()=>{
 const result=verify(fixture());assert.equal(result.rowCount,1);assert.equal(result.totalMinutes,180);
});
test('fictional XLSX bytes preserve unknown and zero rate values separately',()=>{
 const rateSource={...source,schemaVersion:3,rows:[{...source.rows[0],sourceBasicMinutes:120,sourceOt15Minutes:60,sourceOt20Minutes:null}]};
 const rates=book=>{const s=book.Sheets['Daily Entries'];s.H1={t:'s',v:'Source basic hours'};s.I1={t:'s',v:'Source overtime 1.5× hours'};s.J1={t:'s',v:'Source overtime 2× hours'};s.H2={t:'n',v:120/1440};s.I2={t:'n',v:60/1440};s['!ref']='A1:J3'};
 const check=bytes=>verifyXlsxPrototype(bytes,{fileName,recordJson:JSON.stringify(rateSource)});
 const result=check(fixture(rates)),row=JSON.parse(result.verifiedRowsJson)[0];
 assert.equal(row.sourceBasicMinutes,120);assert.equal(row.sourceOt15Minutes,60);assert.equal(row.sourceOt20Minutes,null);
 assert.throws(()=>check(fixture(book=>{rates(book);book.Sheets['Daily Entries'].J2={t:'n',v:0}})));
});
for(const [name,change] of [
 ['daily formula replaced with its cached value',book=>{delete book.Sheets['Daily Entries'].F2.f}],
 ['weekly formula changed',book=>{book.Sheets['Weekly Totals'].C4.f='1+1'}],
 ['correct-looking value with altered note',book=>{book.Sheets['Daily Entries'].G2.v='Altered'}],
 ['extra column content',book=>{book.Sheets['Daily Entries'].H2={t:'s',v:'Unexpected'};book.Sheets['Daily Entries']['!ref']='A1:H3'}],
 ['extra hidden sheet',book=>{XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['hidden']]),'Extra');book.Workbook={Sheets:[{},{},{Hidden:1}]}}]
])test(`fictional XLSX byte check rejects ${name}`,()=>assert.throws(()=>verify(fixture(change))));

test('fictional XLSX byte check rejects incomplete or invalid bytes',()=>assert.throws(()=>verify(new Uint8Array([0x50,0x4b,0x03,0x04]))));

test('provider readback binds the source and exact drive, item, parent and version',async()=>{
 const bytes=fixture(),recordJson=JSON.stringify(source),generation=createHash('sha256').update(recordJson).digest('hex');
 const expected={driveId:'fictional-drive',itemId:'fictional-item',parentId:'fictional-parent',eTag:'fictional-v1',fileName,recordJson,generation};
 const metadata={id:expected.itemId,name:fileName,e_tag:expected.eTag,size:bytes.length,parent_reference:{drive_id:expected.driveId,id:expected.parentId},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}};
 const io={metadata:async()=>structuredClone(metadata),content:async()=>bytes};
 const result=await verifyProviderPrototype(expected,io);
 assert.equal(result.driveId,expected.driveId);assert.equal(result.itemId,expected.itemId);assert.equal(result.eTag,expected.eTag);assert.equal(result.generation,generation);assert.equal(result.rowCount,1);assert.equal(result.totalMinutes,180);
 const evidence=['gmt-timesheet-provider-readback-v1',expected.driveId,expected.itemId,expected.parentId,expected.eTag,fileName,bytes.length,generation,createHash('sha256').update(bytes).digest('hex')];
 assert.equal(result.verificationDigest,createHash('sha256').update(JSON.stringify(evidence)).digest('hex'));
});

test('fictional readback evidence can complete the same bound publication',async()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec(readFileSync(new URL('../cloudflare-worker/schema.sql',import.meta.url),'utf8'));
  const oid='11111111-1111-4111-8111-111111111111',upn='fictional@example.test',payloadJson=JSON.stringify({payMonth:'2026-10'});
  const recordJson=JSON.stringify({...source,employeeUpn:upn}),encoded=Buffer.from(recordJson).toString('base64'),generation=createHash('sha256').update(recordJson).digest('hex'),bytes=fixture();
  sql.prepare("INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,'Fictional','timesheets','pay_month_correction','Queued for Accounts','t','t',?)").run(recordId,oid,upn,payloadJson);
  sql.prepare("INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES (?,'queued','t','t',0,'2026-11-20T11:00:00.000Z')").run(recordId);
  sql.prepare("INSERT INTO private_timesheet_subjects(employee_upn,employee_oid,created_at) VALUES (?,?,'t')").run(upn,oid);
  sql.prepare("INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES (?,'attachment_record','fictional.json','application/json',?,1,'t')").run(recordId,encoded);
  for(const [field,name,type] of [['attachment','fictional.xlsx','application/xlsx'],['attachment_csv','fictional.csv','text/csv']])sql.prepare("INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES (?,?,?,?, 'eA==',1,'t')").run(recordId,field,name,type);
  const attachments=sql.prepare('SELECT field_name,file_name,content_type,content_base64,size_bytes FROM record_attachments WHERE record_id=?').all(recordId);
  sql.prepare('INSERT INTO timesheet_queue_attachment_guards VALUES (?,?)').run(recordId,JSON.stringify(attachments.map(a=>({fieldName:a.field_name,fileName:a.file_name,contentType:a.content_type,contentBase64:a.content_base64,sizeBytes:a.size_bytes}))));
  const revision=sql.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').get(upn).revision;
  sql.prepare('INSERT INTO timesheet_queue_source_guards VALUES (?,?,?,?)').run(recordId,upn,revision,encoded);
  const wrap=(query,args=[])=>({async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}}}});
  const env={DB:{prepare(query){return {...wrap(query),bind(...args){return wrap(query,args)}}}}};
  const expected={driveId:'fictional-drive',itemId:'fictional-item',parentId:'fictional-parent',eTag:'fictional-v1',fileName,recordJson,generation};
  const metadata={id:expected.itemId,name:fileName,e_tag:expected.eTag,size:bytes.length,parent_reference:{drive_id:expected.driveId,id:expected.parentId},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}};
  const verified=await verifyProviderPrototype(expected,{metadata:async()=>structuredClone(metadata),content:async()=>bytes});
  const selection={recordId,subjectOid:oid,subjectUpn:upn,payMonth:'2026-10',sourceBase64:encoded,generation,ownerRevision:revision,payloadJson,expectedRevision:0};
  assert.equal(await selectPublicationSource(env,selection),1);
  const candidate={...selection,publicationRevision:1,driveId:verified.driveId,itemId:verified.itemId,etag:verified.eTag};
  await recordPublicationCandidate(env,candidate);assert.equal(await publishCandidate(env,candidate),true);
  const handoff={...candidate,claimedAt:'2026-11-20T12:00:00.000Z',flowRunId:'fictional-run'};
  const claim=await claimPublicationHandoff(env,handoff);await bindPublicationFlow(env,{...handoff,...claim});assert.equal(await confirmPublicationHandoff(env,{...handoff,...claim}),true);
  await completePublishedCandidate(env,{...handoff,...claim,verificationDigest:verified.verificationDigest,completedAt:'2026-11-20T12:00:00.000Z'});
  assert.equal(sql.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(recordId).status,'completed');
  assert.equal(sql.prepare('SELECT verification_digest FROM timesheet_publication_completions').get().verification_digest,verified.verificationDigest);
  assert.equal((await readPublishedCandidate(env,{subjectOid:oid,payMonth:'2026-10'})).itemId,verified.itemId);
 }finally{sql.close();}
});

for(const [name,change] of [
 ['drive',m=>{m.parent_reference.drive_id='other-drive'}],['item',m=>{m.id='other-item'}],
 ['parent',m=>{m.parent_reference.id='other-parent'}],['version',m=>{m.e_tag='other-version'}],
 ['name',m=>{m.name='other.xlsx'}],['size',m=>{m.size++}],['file type',m=>{m.file.mimeType='text/plain'}],
 ['remote shortcut',m=>{m.remote_item={id:'remote'}}]
])test(`provider readback holds when the ${name} changes during the read`,async()=>{
 const bytes=fixture(),recordJson=JSON.stringify(source),generation=createHash('sha256').update(recordJson).digest('hex');
 const expected={driveId:'fictional-drive',itemId:'fictional-item',parentId:'fictional-parent',eTag:'fictional-v1',fileName,recordJson,generation};
 const metadata={id:expected.itemId,name:fileName,e_tag:expected.eTag,size:bytes.length,parent_reference:{drive_id:expected.driveId,id:expected.parentId},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}};
 let reads=0;const io={metadata:async()=>{const m=structuredClone(metadata);if(++reads===2)change(m);return m},content:async()=>bytes};
 await assert.rejects(()=>verifyProviderPrototype(expected,io));assert.equal(reads,2);
});

test('provider readback rejects a source fingerprint mismatch before reading',async()=>{
 let reads=0;const expected={driveId:'d',itemId:'i',parentId:'p',eTag:'v',fileName,recordJson:JSON.stringify(source),generation:'a'.repeat(64)};
 await assert.rejects(()=>verifyProviderPrototype(expected,{metadata:async()=>{reads++},content:async()=>{reads++}}));assert.equal(reads,0);
});

test('provider readback rejects an archive with duplicate worksheet entries',async()=>{
 const py="import io,sys,zipfile,warnings; warnings.filterwarnings('ignore',category=UserWarning); src=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); out=io.BytesIO(); dst=zipfile.ZipFile(out,'w'); [(dst.writestr(i.filename,src.read(i))) for i in src.infolist()]; dst.writestr('xl/worksheets/sheet1.xml',src.read('xl/worksheets/sheet1.xml')); dst.close(); sys.stdout.buffer.write(out.getvalue())";
 const bytes=execFileSync('python3',['-c',py],{input:fixture()}),recordJson=JSON.stringify(source);
 const expected={driveId:'fictional-drive',itemId:'fictional-item',parentId:'fictional-parent',eTag:'fictional-v1',fileName,recordJson,generation:createHash('sha256').update(recordJson).digest('hex')};
 const metadata={id:expected.itemId,name:fileName,e_tag:expected.eTag,size:bytes.length,parent_reference:{drive_id:expected.driveId,id:expected.parentId},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}};
 await assert.rejects(()=>readback.verifyBoundedSpreadsheetArchive(bytes));
 await assert.rejects(()=>verifyProviderPrototype(expected,{metadata:async()=>structuredClone(metadata),content:async()=>bytes}));
});

test('provider readback rejects a worksheet whose real expansion exceeds its claimed size',async()=>{
 const py=`import io,sys,zipfile,struct
src=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as dst:
 for entry in src.infolist():
  content=src.read(entry)
  if entry.filename=='xl/worksheets/sheet1.xml': content+=b' '*(21*1024*1024)
  dst.writestr(entry.filename,content)
data=bytearray(out.getvalue()); cursor=0; found=False
while True:
 cursor=data.find(b'PK\\x01\\x02',cursor)
 if cursor<0: break
 name_len,extra_len,comment_len=struct.unpack_from('<HHH',data,cursor+28)
 name=bytes(data[cursor+46:cursor+46+name_len])
 if name==b'xl/worksheets/sheet1.xml': struct.pack_into('<I',data,cursor+24,128); found=True
 cursor+=46+name_len+extra_len+comment_len
assert found
sys.stdout.buffer.write(data)`;
 const bytes=execFileSync('python3',['-c',py],{input:fixture(),maxBuffer:5*1024*1024}),recordJson=JSON.stringify(source);
 const expected={driveId:'fictional-drive',itemId:'fictional-item',parentId:'fictional-parent',eTag:'fictional-v1',fileName,recordJson,generation:createHash('sha256').update(recordJson).digest('hex')};
 const metadata={id:expected.itemId,name:fileName,e_tag:expected.eTag,size:bytes.length,parent_reference:{drive_id:expected.driveId,id:expected.parentId},file:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}};
 await assert.rejects(()=>readback.verifyBoundedSpreadsheetArchive(bytes));
 await assert.rejects(()=>verifyProviderPrototype(expected,{metadata:async()=>structuredClone(metadata),content:async()=>bytes}));
});
