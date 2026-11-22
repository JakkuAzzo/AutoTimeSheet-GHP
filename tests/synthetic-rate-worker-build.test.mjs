import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,rmSync} from 'node:fs';
import path from 'node:path';

test('the rate worker package is build-only, disabled and bound to an unprovisioned destination',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['tools/prepare-synthetic-rate-worker.mjs','--build-only'],{encoding:'utf8'}));
 try{const config=JSON.parse(readFileSync(path.join(result.directory,'wrangler.json'),'utf8'));
  assert.equal(result.safeToDeploy,false);assert.equal(config.workers_dev,false);assert.equal(config.account_id,undefined);assert.equal(config.vars.SYNTHETIC_TEST_SERVICE_ENABLED,'false');assert.equal(config.vars.DISPATCH_ENABLED,'false');assert.equal(config.vars.PAY_MONTH_REPLAY_READY,'false');assert.equal(config.vars.PAY_MONTH_RATE_DELIVERY_READY,'false');assert.equal(config.vars.SYNTHETIC_TEST_WORKBOOK_ID,'RATE-DESTINATION-NOT-PROVISIONED');assert.equal(config.d1_databases[0].database_id,'00000000-0000-4000-8000-000000000000');assert.match(readFileSync(path.join(result.directory,'bootstrap.sql'),'utf8'),/gmt-timesheet-rate-build-only/);
 }finally{rmSync(result.directory,{recursive:true,force:true})}
});
