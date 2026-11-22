import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeApplicationIdentity} from '../tools/private-timesheet-app-probe.mjs';

test('application probe authenticates once and reads only the designated test identity and folder permissions',async()=>{
  const calls=[];
  const fetcher=async(url,options={})=>{
    calls.push({url:String(url),...options});
    if(calls.length===1)return new Response(JSON.stringify({access_token:'sensitive-token'}));
    return new Response('{}',{status:calls.length===2?403:200});
  };
  const result=await probeApplicationIdentity({clientSecret:'sensitive-secret',fetcher});
  assert.equal(result.tokenStatus,200);
  assert.equal(result.directoryStatus,403);
  assert.equal(result.folderStatus,200);
  assert.equal(result.permissionStatus,200);
  assert.equal(calls.length,4);
  assert.equal(calls[0].method,'POST');
  assert.ok(calls.slice(1).every(call=>call.method==='GET'&&call.url.startsWith('https://graph.microsoft.com/v1.0/')));
  assert.ok(calls[1].url.includes('/users/nathanbrown-bennett%40gmt-services.co.uk'));
  assert.ok(calls.slice(2).every(call=>call.url.includes('01ZURLVFNDVBIXZYT52ZE3OJN7EJN7UXA7')));
  assert.equal(JSON.stringify(result).includes('sensitive'),false);
});

test('token failure stops before Graph calls and does not expose the response',async()=>{
  let calls=0;
  const result=await probeApplicationIdentity({clientSecret:'secret',fetcher:async()=>{calls++;return new Response('secret diagnostic',{status:401})}});
  assert.deepEqual(result,{tokenStatus:401});
  assert.equal(calls,1);
});
