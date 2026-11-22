// Internal readback foundation; not an endpoint, permission check or writer
// fence. A trusted caller must pin the provider item and ensure it cannot be
// changed after validation. No employee data is written by this module.
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {verifyPayMonthWorkbook} from './pay-month-readonly-verifier.generated.js';

const invalid=()=>new Error('Workbook bytes cannot be verified');
const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const safe=value=>typeof value==='string'&&value.length>0&&value.length<=500&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
async function sha(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}

function rejectAmbiguousDirectory(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),minimum=Math.max(0,bytes.length-65557);let end=-1;
 for(let i=bytes.length-22;i>=minimum;i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){if(end!==-1)throw invalid();end=i;}}
 if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw invalid();
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
 if(!count||count>500||view.getUint16(end+8,true)!==count||count===65535||size===0xffffffff||start===0xffffffff||start+size!==end)throw invalid();
 const seen=new Set();let cursor=start;
 for(let i=0;i<count;i++){
  if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)throw invalid();
  const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),n=view.getUint16(cursor+28,true),e=view.getUint16(cursor+30,true),c=view.getUint16(cursor+32,true),next=cursor+46+n+e+c;
  if(!n||next>end||(flags&1)||![0,8].includes(method)||view.getUint16(cursor+34,true)!==0)throw invalid();
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+n));}catch(_){throw invalid();}
  if(!name||/[\x00-\x1f\x7f\\]/.test(name)||name.startsWith('/')||name.split('/').some(part=>part==='.'||part==='..'))throw invalid();
  const key=name.toLowerCase();if(seen.has(key))throw invalid();seen.add(key);cursor=next;
 }
 if(cursor!==end)throw invalid();
}

// Counts actual decompressed chunks, not only ZIP directory sizes. JSZip can
// finish work already queued after pause, so this is not a hard CPU or
// instantaneous-memory limit and does not constitute a complete ZIP audit.
export async function preflightWorkbookBytes(bytes){
 rejectAmbiguousDirectory(bytes);let zip;try{zip=await JSZip.loadAsync(bytes);}catch(_){throw invalid();}
 let remaining=20*1024*1024,entries=500;
 for(const entry of Object.values(zip.files)){
  if(entry.dir)continue;const size=entry._data?.uncompressedSize;
  if(!Number.isSafeInteger(size)||size<0||size>remaining||--entries<0)throw invalid();
  let actual;try{actual=await new Promise((resolve,reject)=>{
   let count=0,done=false;const stream=entry.internalStream('uint8array');
   stream.on('data',function(chunk){if(done)return;count+=chunk.length;if(count>remaining){done=true;this.pause();reject(invalid());}})
    .on('error',()=>{if(!done){done=true;reject(invalid());}}).on('end',()=>{if(!done){done=true;resolve(count);}}).resume();
  });}catch(_){throw invalid();}
  if(actual!==size)throw invalid();remaining-=actual;
 }
}

function sheetAdapter(name,sheet){
 if(!sheet||typeof sheet['!ref']!=='string')throw invalid();const used=XLSX.utils.decode_range(sheet['!ref']);
 if(used.s.r!==0||used.s.c!==0||used.e.r>9999||used.e.c>127)throw invalid();
 return {getName:()=>name,getUsedRange:()=>({getRowIndex:()=>used.s.r,getRowCount:()=>used.e.r-used.s.r+1,getColumnIndex:()=>used.s.c,getColumnCount:()=>used.e.c-used.s.c+1}),getRange(ref){
  const r=XLSX.utils.decode_range(ref);if(r.s.r<0||r.s.c<0||r.e.r>9999||r.e.c>127||r.e.r<r.s.r||r.e.c<r.s.c)throw invalid();
  const cells=mode=>Array.from({length:r.e.r-r.s.r+1},(_,y)=>Array.from({length:r.e.c-r.s.c+1},(_,x)=>{
   const cell=sheet[XLSX.utils.encode_cell({r:r.s.r+y,c:r.s.c+x})];if(cell?.t==='e')throw invalid();
   return mode==='formula'&&typeof cell?.f==='string'?'='+cell.f:(cell?.v??'');
  }));return {getValues:()=>cells('value'),getFormulas:()=>cells('formula')};
 }};
}

export async function verifyWorkerWorkbookReadback(expected,io){
 const {driveId,itemId,parentId,eTag,fileName,recordJson,generation}=expected||{};
 if(![driveId,itemId,parentId,eTag,fileName].every(safe)||typeof recordJson!=='string'||recordJson.length>300000||
    !/^[0-9a-f]{64}$/.test(generation||'')||await sha(new TextEncoder().encode(recordJson))!==generation||
    typeof io?.metadata!=='function'||typeof io?.content!=='function')throw invalid();
 const valid=meta=>meta?.id===itemId&&meta?.name===fileName&&meta?.eTag===eTag&&meta?.parentReference?.driveId===driveId&&meta?.parentReference?.id===parentId&&
  meta?.file?.mimeType===XLSX_MIME&&!meta?.folder&&!meta?.remoteItem&&Number.isSafeInteger(meta?.size)&&meta.size>4&&meta.size<=1024*1024;
 const before=await io.metadata(driveId,itemId);if(!valid(before))throw invalid();
 const bytes=await io.content(driveId,itemId);if(!(bytes instanceof Uint8Array)||bytes.length!==before.size||bytes[0]!==0x50||bytes[1]!==0x4b||bytes[2]!==0x03||bytes[3]!==0x04)throw invalid();
 await preflightWorkbookBytes(bytes);
 let book;try{book=XLSX.read(bytes,{type:'array',cellFormula:true,cellDates:false,cellStyles:true,bookVBA:true,nodim:true});}catch(_){throw invalid();}
 if(book.vbaraw||book.Workbook?.WBProps?.date1904||book.SheetNames.length!==2||book.Workbook?.Sheets?.some(sheet=>sheet.Hidden))throw invalid();
 const workbook={getName:()=>fileName,getWorksheets:()=>book.SheetNames.map(name=>sheetAdapter(name,book.Sheets[name]))};
 const verified=verifyPayMonthWorkbook(workbook,recordJson);
 const after=await io.metadata(driveId,itemId);if(!valid(after)||after.size!==before.size)throw invalid();
 const contentSha256=await sha(bytes),tuple=['gmt-timesheet-provider-readback-v1',driveId,itemId,parentId,eTag,fileName,bytes.length,generation,contentSha256];
 const verificationDigest=await sha(new TextEncoder().encode(JSON.stringify(tuple)));
 return {...verified,driveId,itemId,parentId,eTag,generation,contentBytes:bytes.length,contentSha256,verificationDigest};
}
