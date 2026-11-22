import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync,spawnSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
test('the fictional test window refuses ordinary startup and compiles its network policy', {skip:process.platform!=='darwin',timeout:20000},()=>{
 const dir=mkdtempSync(join(tmpdir(),'gmt-test-window-')),binary=join(dir,'window');
 try {
  execFileSync('clang',['-fobjc-arc','-framework','Cocoa','-framework','WebKit',fileURLToPath(new URL('../tools/synthetic-portal-test-window.m',import.meta.url)),fileURLToPath(new URL('../tools/gmt-synthetic-boundary.m',import.meta.url)),'-o',binary],{stdio:'pipe',timeout:15000});
  assert.notEqual(spawnSync(binary,[],{timeout:3000}).status,0,'an accidental launch must not load a page');
  assert.notEqual(spawnSync(binary,['--start-fictional-test'],{timeout:3000}).status,0,'starting without a test-server handshake must fail');
  const result=spawnSync(binary,['--verify-only'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/TEST POLICY COMPILED/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('the test window rejects a wrong handshake and does not follow its redirect', {skip:process.platform!=='darwin',timeout:20000},async t=>{
 const {createServer}=await import('node:http');const {spawn}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'gmt-test-window-')),binary=join(dir,'window');let targetHits=0,mode='wrong';
 const target=createServer((req,res)=>{targetHits++;res.end('unexpected')});
 const server=createServer((req,res)=>{if(mode==='redirect'){res.writeHead(302,{Location:`http://127.0.0.1:${target.address().port}/unexpected`});res.end()}else if(mode==='correct')res.end('GMT-FICTIONAL-TEST:'+String(req.headers['x-gmt-test-handshake']||''));else res.end('wrong handshake')});
 const listen=(s,port)=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',()=>{s.removeListener('error',reject);resolve()})});
 const close=s=>new Promise(resolve=>s.close(()=>resolve()));
 try {
  execFileSync('clang',['-fobjc-arc','-framework','Cocoa','-framework','WebKit',fileURLToPath(new URL('../tools/synthetic-portal-test-window.m',import.meta.url)),fileURLToPath(new URL('../tools/gmt-synthetic-boundary.m',import.meta.url)),'-o',binary],{stdio:'pipe',timeout:15000});
  await listen(target,0);try{await listen(server,4179)}catch(error){if(error.code==='EADDRINUSE'){t.skip('the test origin is in use');return}throw error}
  const run=(command='--start-fictional-test')=>new Promise((resolve,reject)=>{const child=spawn(binary,[command],{env:{...process.env,GMT_SYNTHETIC_LOCAL_HANDSHAKE:'a'.repeat(64)},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',part=>error+=part);child.on('error',reject);child.on('exit',code=>resolve({code,error}));});
  let result=await run();assert.equal(result.code,3,result.error);assert.match(result.error,/handshake failed/i);
  mode='redirect';result=await run();assert.equal(result.code,3,result.error);assert.equal(targetHits,0,'the local handshake cannot redirect outside its origin');
  mode='correct';result=await run('--probe-handshake');assert.equal(result.code,0,result.error);
 } finally {await Promise.all([close(server),close(target)]);rmSync(dir,{recursive:true,force:true});}
});

test('the test window and actual loopback test server complete their handshake', {skip:process.platform!=='darwin',timeout:20000},async t=>{
 const {startSyntheticPortalServer}=await import('../tools/synthetic-portal-server.mjs');
 const {spawn}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'gmt-window-server-')),binary=join(dir,'window'),token='d'.repeat(64);let server;
 try {
  execFileSync('clang',['-fobjc-arc','-framework','Cocoa','-framework','WebKit',fileURLToPath(new URL('../tools/synthetic-portal-test-window.m',import.meta.url)),fileURLToPath(new URL('../tools/gmt-synthetic-boundary.m',import.meta.url)),'-o',binary],{stdio:'pipe',timeout:15000});
  try {server=await startSyntheticPortalServer(dir,4179,{handshake:token})}catch(error){if(error.code==='EADDRINUSE'){t.skip('the test origin is in use');return}throw error}
  const result=await new Promise((resolve,reject)=>{const child=spawn(binary,['--probe-handshake'],{env:{...process.env,GMT_SYNTHETIC_LOCAL_HANDSHAKE:token},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',part=>error+=part);child.on('error',reject);child.on('exit',code=>resolve({code,error}));});
  assert.equal(result.code,0,result.error);
 } finally {if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
