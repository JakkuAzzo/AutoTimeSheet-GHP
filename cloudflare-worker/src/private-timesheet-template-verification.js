// The upload contains an application-owned blank template. SharePoint may add
// package metadata while committing it, so byte equality is not reliable.
// Bind the content read-back to the eTag returned by that exact upload, before
// and after the read. The later Office Script verifies the workbook structure
// and contents before reporting a completed correction.
export async function verifyUploadedBlankWorkbook(created,io){
  const id=String(created?.id||''),tag=String(created?.eTag||'');
  if(!id||!tag)return false;
  const valid=meta=>meta?.id===id&&meta?.eTag===tag&&meta?.file&&
    (!meta.file.mimeType||meta.file.mimeType==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')&&
    Number.isSafeInteger(meta.size)&&meta.size>4&&meta.size<=100000&&
    (!created.name||meta.name===created.name)&&(!created.parentReference?.id||meta.parentReference?.id===created.parentReference.id);
  const before=await io.metadata(id);if(!valid(before))return false;
  const bytes=await io.content(id);
  if(!(bytes instanceof Uint8Array)||bytes.length!==before.size||bytes[0]!==0x50||bytes[1]!==0x4b||bytes[2]!==0x03||bytes[3]!==0x04)return false;
  const after=await io.metadata(id);
  return Boolean(valid(after)&&after.size===before.size);
}
