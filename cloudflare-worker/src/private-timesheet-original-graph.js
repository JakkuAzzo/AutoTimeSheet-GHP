// Low-level drive operations only: caller must authorise the current actor,
// prove complete permission visibility, and bind a verified result to D1.
// No method creates a sharing link, changes permissions, or retries a write.
const ID=/^[A-Za-z0-9!_-]{1,256}$/;
const NAME=/^[a-f0-9]{64}\.(?:pdf|doc|docx|docm|xls|xlsx|csv|txt|json|png|jpg|jpeg)$/;
const LIMIT=20*1024*1024, CHUNK=10*1024*1024;
const fail=(message='Private source filing is unavailable')=>{throw Object.assign(new Error(message),{status:503});};
const validId=value=>typeof value==='string'&&ID.test(value);
const childName=value=>typeof value==='string'&&value.length>0&&value.length<=180&&!/[\\/\x00-\x1f]/.test(value)&&value!=='.'&&value!=='..';
async function boundedBytes(response,limit=LIMIT){
  const declared=Number(response.headers.get('content-length')||0);
  if(!Number.isFinite(declared)||declared<0||declared>limit||!response.body)fail('Private source readback is invalid');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();fail('Private source readback is too large');}chunks.push(part.value);}}
  catch(_){fail('Private source readback failed');}
  if(!size)fail('Private source readback is empty');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export function createPrivateOriginalGraphIo({siteHost,graphRequest,uploadRequest,readLimit=LIMIT}){
  const host=String(siteHost||'').toLowerCase();
  if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.sharepoint\.com$/.test(host)||typeof graphRequest!=='function'||typeof uploadRequest!=='function'||!Number.isSafeInteger(readLimit)||readLimit<1||readLimit>LIMIT)fail('Private source storage is not configured');
  const graph=async(path,init)=>{try{return await graphRequest(path,init);}catch(_){fail();}};
  const itemPath=id=>{if(!validId(id))fail('Private source reference is invalid');return '/items/'+encodeURIComponent(id);};
  const trustedAddress=value=>{let address;try{address=new URL(value);}catch(_){return null;}return address.protocol==='https:'&&address.hostname===host&&!address.username&&!address.password&&!address.port&&!address.hash?address:null;};
  return {
    async metadata(id){const response=await graph(itemPath(id));if(response.status===404)return null;if(!response.ok)fail();return response.json();},
    async findChild(parent,name){if(!childName(name))fail('Private source name is invalid');const response=await graph(itemPath(parent)+':/'+encodeURIComponent(name));if(response.status===404)return null;if(!response.ok)fail();return response.json();},
    async permissions(id){const response=await graph(itemPath(id)+'/permissions');if(!response.ok)fail();const data=await response.json();if(!Array.isArray(data?.value)||data['@odata.nextLink'])fail('Private source permissions are incomplete');return data.value;},
    async read(id){let response=await graph(itemPath(id)+'/content',{redirect:'manual'});if([301,302,303,307,308].includes(response.status)){const address=trustedAddress(response.headers.get('location'));if(!address)fail('Private source readback address is invalid');try{response=await uploadRequest(address.href,{method:'GET',redirect:'error'});}catch(_){fail('Private source readback failed');}}if(!response.ok)fail('Private source readback failed');return boundedBytes(response,readLimit);},
    async createExclusive(parent,name,bytes){
      if(!validId(parent)||!NAME.test(String(name||''))||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>LIMIT)fail('Private source upload is invalid');
      const session=await graph(itemPath(parent)+':/'+encodeURIComponent(name)+':/createUploadSession',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'fail'}})});
      if(!session.ok)fail('Private source upload session failed');
      let address;try{address=trustedAddress((await session.json()).uploadUrl);}catch(_){fail('Private source upload session is invalid');}
      if(!address)fail('Private source upload session is invalid');
      for(let offset=0;offset<bytes.length;offset+=CHUNK){
        const end=Math.min(offset+CHUNK,bytes.length),part=bytes.slice(offset,end);let response;
        try{response=await uploadRequest(address.href,{method:'PUT',redirect:'error',headers:{'content-type':'application/octet-stream','content-length':String(part.length),'content-range':`bytes ${offset}-${end-1}/${bytes.length}`},body:part});}catch(_){fail('Private source upload outcome needs review');}
        if(end===bytes.length){if(response.status!==201)fail('Private source upload outcome needs review');let item;try{item=await response.json();}catch(_){fail('Private source upload outcome needs review');}if(!validId(item?.id))fail('Private source upload outcome needs review');return item;}
        if(response.status!==202)fail('Private source upload outcome needs review');
        let body;try{body=await response.json();}catch(_){fail('Private source upload outcome needs review');}
        if(!Array.isArray(body?.nextExpectedRanges)||body.nextExpectedRanges.length!==1||body.nextExpectedRanges[0]!==`${end}-`)fail('Private source upload range needs review');
      }
      fail('Private source upload outcome needs review');
    }
  };
}
