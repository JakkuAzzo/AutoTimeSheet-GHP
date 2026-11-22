(function(root){
  'use strict';
  const sessions=new Map();
  async function upload(api,recordId,file){
    const types={pdf:'application/pdf',jpeg:'image/jpeg',jpg:'image/jpeg',png:'image/png'};
    const name=String(file?.name||''),type=types[name.split('.').pop().toLowerCase()];
    if(!name || name!==name.trim() || /["*:<>?\/\\|\u0000-\u001f\u007f]/.test(name))throw new Error('The source filename cannot be stored; rename it and try again.');
    if(!type || (file.type && file.type!=='application/octet-stream' && file.type!==type) || !file.size || file.size>20*1024*1024)throw new Error('The original must be a matching PDF or image up to 20 MiB.');
    if(!api?.startJobCardRecordAttachment || !api?.uploadJobCardRecordAttachment)throw new Error('Protected attachment storage is unavailable.');
    const bytes=new Uint8Array(await file.arrayBuffer()),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const block=new Uint8Array(20);let bitOffset=0;
    for(const value of bytes){const byte=Math.floor(bitOffset/8),shift=bitOffset%8;block[byte]^=(value<<shift)&255;if(shift>0)block[(byte+1)%20]^=value>>>(8-shift);bitOffset=(bitOffset+11)%160;}
    let length=BigInt(bytes.length);for(let i=0;i<8;i++){block[12+i]^=Number(length&255n);length>>=8n;}
    const metadata={fileName:name,contentType:type,sizeBytes:file.size,sha256:Array.from(digest,b=>b.toString(16).padStart(2,'0')).join(''),quickXorHash:btoa(Array.from(block,b=>String.fromCharCode(b)).join(''))};
    const key=String(recordId)+'\0'+metadata.sha256+'\0'+metadata.fileName;
    let session=sessions.get(key);
    if(!session || Date.parse(session.expirationDateTime)<=Date.now()+5000 || !Number.isFinite(Date.parse(session.expirationDateTime))) {
      session=await api.startJobCardRecordAttachment(recordId,metadata);
      if(session?.attachmentId)sessions.set(key,session);
    }
    if(session?.attachment?.attachment_id){sessions.delete(key);return;}
    if(!session?.attachmentId)throw new Error('The attachment reservation was not returned.');
    try {await api.uploadJobCardRecordAttachment(recordId,session.attachmentId,file,type);}
    catch(error){if(error?.status===410)sessions.delete(key);throw error;}
    sessions.delete(key);
  }
  root.GMTJobCardImportAttachment={upload};
})(globalThis);
