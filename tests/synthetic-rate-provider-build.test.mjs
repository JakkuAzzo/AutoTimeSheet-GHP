import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,rmSync} from 'node:fs';
import path from 'node:path';

test('provider test package stays disabled and pins its own fictional resources',()=>{
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const result=JSON.parse(execFileSync(process.execPath,['tools/prepare-synthetic-rate-provider.mjs','--build-only','--database-id',id],{encoding:'utf8'}));
  try {
    const c=JSON.parse(readFileSync(path.join(result.directory,'wrangler.json'),'utf8'));
    assert.equal(result.safeToEnable,false); assert.equal(c.vars.SYNTHETIC_TEST_SERVICE_ENABLED,'false');
    assert.equal(c.vars.DISPATCH_ENABLED,'false'); assert.equal(c.vars.PAY_MONTH_RATE_DELIVERY_READY,'false');
    assert.equal(c.d1_databases[0].database_id,id);
    assert.equal(c.vars.PRIVATE_TIMESHEET_PARENT_ID,'01ZURLVFIIINPOKIYCCZEJFTFMCUTRGBUL');
    assert.equal(c.vars.SYNTHETIC_TEST_WORKBOOK_ID,'01ZURLVFKFZ6PPD3U36RHLN74B2KFNIR4F');
    assert.match(readFileSync(path.join(result.directory,'bootstrap.sql'),'utf8'),/gmt-timesheet-rate-provider-20261119/);
    assert.throws(()=>execFileSync(process.execPath,['tools/prepare-synthetic-rate-provider.mjs','--build-only','--database-id','911701fb-bad4-4615-a715-98f92b41144c'],{stdio:'ignore'}));
  } finally { rmSync(result.directory,{recursive:true,force:true}); }
});
