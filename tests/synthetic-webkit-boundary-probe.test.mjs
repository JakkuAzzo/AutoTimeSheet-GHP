// Fictional loopback-only WebKit probe. This does not sign in or load the portal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const close=server=>new Promise(resolve=>server.close(resolve));
test('WebKit content rules and navigation policy confine a fictional loopback page', {skip:process.platform!=='darwin',timeout:30000}, async()=>{
  const directory=mkdtempSync(join(tmpdir(),'gmt-webkit-probe-')),binary=join(directory,'probe');
  const hits=[];let blockedPort,allowedHits=0;
  const blocked=createServer((req,res)=>{hits.push(req.url);res.end('unexpected request')});
  blocked.on('upgrade',(req,socket)=>{hits.push(req.url);socket.destroy()});
  const allowed=createServer((req,res)=>{
    if(req.url==='/allowed'){allowedHits++;res.end('ok');return}
    if(req.url==='/redirect'){res.writeHead(302,{Location:`http://localhost:${blockedPort}/redirect-target`});return res.end()}
    if(req.url!=='/probe'){res.writeHead(404);return res.end()}
    res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><meta charset="utf-8"><script>
window.events=[];fetch('/allowed').then(r=>r.text()).then(t=>{if(t==='ok')events.push('same-origin allowed')});const u='http://localhost:${blockedPort}/';
fetch(u+'fetch').then(()=>events.push('fetch accepted')).catch(()=>events.push('fetch blocked'));
const x=new XMLHttpRequest();x.open('GET',u+'xhr');x.send();navigator.sendBeacon(u+'beacon','fictional');
const i=new Image();i.src=u+'image';document.documentElement.appendChild(i);
const s=document.createElement('script');s.src=u+'script';document.head.appendChild(s);
const f=document.createElement('iframe');f.name='fixtureframe';f.src=u+'frame';document.documentElement.appendChild(f);
const form=document.createElement('form');form.method='post';form.action=u+'form';form.target='fixtureframe';document.documentElement.appendChild(form);form.submit();
const l=document.createElement('link');l.rel='prefetch';l.href=u+'prefetch';document.head.appendChild(l);
try{const w=new WebSocket('ws://localhost:${blockedPort}/socket');w.onerror=()=>events.push('socket blocked')}catch(e){events.push('socket blocked')}
setTimeout(()=>{window.location=u+'top'},1000);setTimeout(()=>{window.location='/redirect'},2500);
</script>`);
  });
  try {
    execFileSync('clang',['-fobjc-arc','-framework','Cocoa','-framework','WebKit',fileURLToPath(new URL('./synthetic-webkit-boundary-probe.m',import.meta.url)),fileURLToPath(new URL('../tools/gmt-synthetic-boundary.m',import.meta.url)),'-o',binary],{stdio:'pipe',timeout:15000});
    [blockedPort]=await Promise.all([listen(blocked)]);const allowedPort=await listen(allowed);
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(binary,[String(allowedPort)],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
      child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
      child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));
    });
    assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/^RESULT /m);
    const data=JSON.parse(result.stdout.match(/^RESULT (.*)$/m)[1]);
    assert.equal(data.url,`http://localhost:${allowedPort}/probe`);assert.ok(data.events.includes('fetch blocked'));assert.ok(data.events.includes('same-origin allowed'));assert.equal(allowedHits,1);
    assert.match(result.stderr,/NAV_BLOCKED .*\/top/);assert.match(result.stderr,/NAV_BLOCKED .*\/redirect-target/);
    assert.deepEqual(hits,[],'the independent listener must not receive browser requests');
  } finally {await Promise.all([close(allowed),close(blocked)]);rmSync(directory,{recursive:true,force:true});}
});
