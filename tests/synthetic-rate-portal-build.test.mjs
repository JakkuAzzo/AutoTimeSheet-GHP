import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

test('the rate test page is build-only, pins fictional bytes and has no live service or sign-in',{timeout:15000},async()=>{
 const built=JSON.parse(execFileSync(process.execPath,['tools/prepare-synthetic-rate-portal.mjs','--build-only'],{encoding:'utf8'}));
 try{
  assert.equal(built.safeToRun,false);const site=path.join(built.directory,'site'),configContext={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(site,'config.js'),'utf8'),configContext);const config=configContext.window.GMT_APP_CONFIG;
  assert.equal(config.portalApiEndpoint,'https://gmt-timesheet-rate-fixture.invalid');assert.equal(config.portalHistoryEndpoint,config.portalApiEndpoint);assert.equal(config.timesheetSourceRateColumns,true);assert.equal(config.entraSpaAuth.enabled,false);
  for(const key of ['timesheetIntakeEndpoint','timesheetFormSubmitEndpoint','fallbackFormSubmitEndpoint','formSubmitEndpoint','formSubmitTimesheetEndpoint'])assert.equal(config[key],'');
  assert.equal(fs.existsSync(path.join(site,'tools')),false,'build-only helper scripts are not served by the candidate site');
  const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const item=path.join(dir,entry.name);if(entry.isDirectory())visit(item);else if(entry.isFile()&&/\.(?:js|html|json)$/i.test(entry.name))assert.doesNotMatch(fs.readFileSync(item,'utf8'),/gmt-timesheet-portal-e2e-20261116\.raspy-breeze-e230\.workers\.dev/i,`old test service in ${path.relative(site,item)}`)}};visit(site);
  const calls=[],context=vm.createContext({crypto:webcrypto,Uint8Array,File,console,GMT_APP_CONFIG:config,GMT_PORTAL_AUTH:{acquireToken:async()=>'fictional-token'},fetch:async(url,options)=>{calls.push({url,options});return {ok:true}}});context.window=context;
  vm.runInContext(fs.readFileSync(path.join(site,'portal','synthetic-fixture-proof.js'),'utf8'),context);
  const bytes=fs.readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-RATES.csv');await context.GMTSyntheticVerifyUpload(new File([bytes],'GMT-FICTIONAL-PORTAL-RATES.csv'));
  assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/api/synthetic-fixture-invalidate','/api/synthetic-fixture-proof']);assert.deepEqual(Buffer.from(calls[1].options.body),bytes);
  calls.length=0;await assert.rejects(()=>context.GMTSyntheticVerifyUpload(new File(['other'],'GMT-FICTIONAL-PORTAL-RATES.csv')));assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/api/synthetic-fixture-invalidate']);
  calls.length=0;context.GMT_APP_CONFIG.portalApiEndpoint='https://gmt-timesheet-portal-e2e-20261116.raspy-breeze-e230.workers.dev';await assert.rejects(()=>context.GMTSyntheticVerifyUpload(new File([bytes],'GMT-FICTIONAL-PORTAL-RATES.csv')));assert.equal(calls.length,0);
 }finally{fs.rmSync(built.directory,{recursive:true,force:true})}
});
