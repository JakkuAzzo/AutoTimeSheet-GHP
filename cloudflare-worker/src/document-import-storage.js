const FOLDERS={'job-cards':'Job cards',tasks:'Tasks',calendar:'Calendar requests',enquiries:'Enquiries',estimates:'Estimates',invoices:'Invoices'};
const EXTENSIONS=new Set(['pdf','doc','docx','docm','xls','xlsx','csv','txt','json','png','jpg','jpeg']);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');}
export async function fileImportedDocument(input,io){
  const kind=String(input.kind||''),recordId=String(input.recordId||''),sourceId=String(input.sourceId||'').toLowerCase();
  if(kind==='timesheets'||kind==='clock')fail('Timesheet files require private timesheet storage.');
  if(!FOLDERS[kind]||!/^document-import-[A-Za-z0-9_-]+$/.test(recordId))fail('The imported document is invalid.');
  if(sourceId.includes(':'))fail('A file inside an archive must be selected separately for filing.');
  if(!/^[a-f0-9]{64}$/.test(sourceId))fail('Document source identity is invalid.');
  const raw=String(input.fileName||'').trim(),ext=raw.split('.').pop().toLowerCase();
  if(!raw||!EXTENSIONS.has(ext))fail('This source format cannot be filed.');
  const bytes=input.bytes instanceof Uint8Array?input.bytes:new Uint8Array(input.bytes||[]);
  if(!bytes.length||bytes.length>20*1024*1024)fail('The document must be between 1 byte and 20 MiB.',413);
  if(await digest(bytes)!==sourceId)fail('The file does not match the reviewed document.',409);
  const clean=raw.replace(/[^\p{L}\p{N} ._()-]/gu,'_').replace(/^\.+/,'');
  const suffix='.'+raw.split('.').pop();
  const name=clean.toLowerCase().endsWith(suffix.toLowerCase())
    ? (clean.length<=120 ? clean : clean.slice(0,120-suffix.length).replace(/[\uD800-\uDBFF]$/,'')+suffix)
    : 'document'+suffix;
  const folder='Submitted Documents/'+FOLDERS[kind]+'/'+recordId;
  const path=folder+'/'+sourceId.slice(0,16)+'-'+name;
  await io.ensureFolder(folder);
  let item=await io.lookup(path);
  if(!item)item=await io.upload(path,bytes);
  if(!item?.id||!item.file)fail('SharePoint did not confirm the document.',503);
  const readback=await io.read(item);
  if(await digest(readback)!==sourceId)fail('The stored document does not match the reviewed file.',409);
  const link=await io.share(item),url=String(link?.webUrl||'');let host='';
  try{const parsed=new URL(url);if(parsed.protocol==='https:')host=parsed.hostname.toLowerCase();}catch(_){}
  if(link?.scope!=='organization'||link?.type!=='view'||!host.endsWith('.sharepoint.com'))fail('SharePoint document access could not be verified.',503);
  const result={recordId,kind,itemId:item.id,sourceId,fileName:raw,path,url,sizeBytes:bytes.length};
  await io.save(result);return result;
}
