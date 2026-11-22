import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const wrangler=process.env.GMT_LOCAL_WRANGLER;
test('the queue transaction works in a local Cloudflare Worker and D1 database',{skip:!wrangler,timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gmt-d1-fixture-'));fs.chmodSync(dir,0o700);
 const key=randomBytes(24).toString('hex'),server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const config={name:'gmt-local-fictional-queue-check',main:path.resolve('cloudflare-worker/test-only/queue-runtime-fixture.js'),compatibility_date:'2026-09-10',vars:{TEST_KEY:key},d1_databases:[{binding:'DB',database_name:'fictional-local-only',database_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]};
 const configPath=path.join(dir,'wrangler.json');fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const child=spawn(process.execPath,[wrangler,'dev','--local','--ip','127.0.0.1','--port',String(port),'--config',configPath,'--persist-to',path.join(dir,'state'),'--show-interactive-dev-session=false','--log-level','info'],{stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(new Error('Local Worker did not become ready'))},15000);const poll=setInterval(()=>{if(output.includes('Ready on http://127.0.0.1:')){clearInterval(poll);clearTimeout(timer);resolve()}else if(child.exitCode!==null){clearInterval(poll);clearTimeout(timer);reject(new Error('Local Worker exited before becoming ready'))}},50);child.once('error',error=>{clearInterval(poll);clearTimeout(timer);reject(error)});});
  const triggers=['0034_timesheet_handoff_lock.sql','0035_timesheet_workbook_write_lock.sql'].flatMap(file=>fs.readFileSync(path.resolve('cloudflare-worker/migrations',file),'utf8').split(/(?<=END;)\s*/).filter(statement=>statement.trim()));
  const originalStatements=fs.readFileSync(path.resolve('cloudflare-worker/migrations/0036_timesheet_original_filing.sql'),'utf8').split(/(?<=;)\s*(?=CREATE)/).filter(statement=>statement.trim());
  const reservationStatements=fs.readFileSync(path.resolve('cloudflare-worker/migrations/0039_timesheet_original_create_reservations.sql'),'utf8').split(/(?<=;)\s*(?=CREATE)/).filter(statement=>statement.trim());
  const reviewStatements=fs.readFileSync(path.resolve('cloudflare-worker/migrations/0040_timesheet_private_original_reviews.sql'),'utf8').split(/(?<=;)\s*(?=CREATE)/).filter(statement=>statement.trim());
  const subjectLockStatements=fs.readFileSync(path.resolve('cloudflare-worker/migrations/0042_reviewed_subject_write_lock.sql'),'utf8').split(/(?<=;)\s*(?=CREATE)/).filter(statement=>statement.trim());
  const daySql=fs.readFileSync(path.resolve('cloudflare-worker/migrations/0038_timesheet_import_source_days.sql'),'utf8');
  const dayParts=daySql.split(/(?=CREATE TRIGGER IF NOT EXISTS)/);const sourceDayStatements=[...dayParts.shift().split(/(?<=;)\s*(?=WITH|INSERT)/),...dayParts].filter(statement=>statement.trim());
  const response=await fetch(`http://127.0.0.1:${port}/run`,{method:'POST',headers:{'x-test-key':key,'content-type':'application/json'},body:JSON.stringify({triggers,originalStatements,sourceDayStatements,reservationStatements,reviewStatements,subjectLockStatements}),signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{sourceDayBackfilled:true,sourceDayRetained:true,sourceDayImmutable:true,knownSourceMatched:true,changedKnownRejected:true,missingKnownRejected:true,additionalDayAllowed:true,rateKnownMatched:true,rateChangedRejected:true,rateDisabledRejected:true,rateEnabledRejected:true,importedHeld:true,importedDayHeld:true,syntheticProofRetained:true,legacyDispatchHeld:true,duplicateRejected:true,laterQueued:true,status:'queued',markerCleared:true,handoffBlocked:true,writeBlocked:true,periodBlocked:true,oldRateProofRejected:true,changedFileRejected:true,heldStatus:'skipped',originalIntentCreated:true,originalCreateReserved:true,originalDuplicateCreateHeld:true,originalReservationImmutable:true,originalReviewRecorded:true,originalReviewRevoked:true,staleOriginalReviewHeld:true,unauthorisedIntentRejected:true,staleIntentRejected:true,originalBound:true,originalRetry:true,changedOriginalRejected:true,staleOriginalRejected:true,originalImmutable:true,reviewedSubjectHandoffHeld:true,reviewedSubjectWriteHeld:true,reviewedSubjectReleased:true});
 }finally{
  if(child.pid && child.exitCode===null && child.signalCode===null){
    const exited=new Promise(resolve=>child.once('exit',resolve));let timer;
    child.kill('SIGTERM');await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,2000)})]);clearTimeout(timer);
    if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await exited}
  }
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
