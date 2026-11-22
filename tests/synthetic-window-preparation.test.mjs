import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

test('preparation leaves a private build marked unsafe to serve and verifies the window policy', {skip:process.platform!=='darwin',timeout:30000},()=>{
 let result;
 try {
  result=JSON.parse(execFileSync(process.execPath,['tools/prepare-synthetic-window.mjs','--prepare-only'],{encoding:'utf8',timeout:25000}));
  assert.equal(result.safeToRun,false);assert.ok(result.directory);
  assert.ok(fs.existsSync(path.join(result.directory,'DO-NOT-SERVE.txt')));
  assert.ok(fs.existsSync(path.join(result.directory,'site','portal','submissions.html')));
  assert.ok(fs.existsSync(path.join(result.directory,'fictional-test-window')));
  assert.equal(fs.statSync(result.directory).mode & 0o077,0);
  assert.equal(fs.statSync(path.join(result.directory,'fictional-test-window')).mode & 0o077,0);
  assert.match(fs.readFileSync(path.join(result.directory,'site','config.js'),'utf8'),/gmt-timesheet-portal-e2e-20261116/);
 } finally {if(result?.directory)fs.rmSync(result.directory,{recursive:true,force:true});}
});
