import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('test-window launcher defaults to no action and can verify preparation without opening a page', {skip:process.platform!=='darwin',timeout:30000},()=>{
 const args=['tools/run-synthetic-window.mjs'];
 assert.notEqual(spawnSync(process.execPath,args,{timeout:5000}).status,0);
 const result=spawnSync(process.execPath,[...args,'--verify-only'],{encoding:'utf8',timeout:25000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/TEST WINDOW PREPARATION VERIFIED/);
});
