import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
test('the isolated test window allows only its explicit origins', {skip:process.platform!=='darwin',timeout:20000},()=>{
 const dir=mkdtempSync(join(tmpdir(),'gmt-webkit-policy-')), binary=join(dir,'policy');
 try {
  execFileSync('clang',['-fobjc-arc','-framework','Foundation',fileURLToPath(new URL('./synthetic-webkit-policy-check.m',import.meta.url)),fileURLToPath(new URL('../tools/gmt-synthetic-boundary.m',import.meta.url)),'-o',binary],{stdio:'pipe',timeout:15000});
  assert.match(execFileSync(binary,[fileURLToPath(new URL('./fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json',import.meta.url))],{encoding:'utf8',timeout:5000}),/PASS policy/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
