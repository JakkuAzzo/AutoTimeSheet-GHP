import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('a test worker configuration refuses known databases and requires independent database verification',()=>{
  const run=id=>execFileSync(process.execPath,['tools/prepare-synthetic-worker.mjs','--build-only','--database-id',id],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  for(const id of ['911701fb-bad4-4615-a715-98f92b41144c','d066d775-55e8-4be9-8352-b3956c14ca61','f448d83d-db81-4d8f-b2ff-df1c327679dd','not-a-uuid']) assert.throws(()=>run(id));
  const result=JSON.parse(run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  try {
    assert.equal(result.safeToDeployDisabled,false);assert.equal(result.requiresDatabaseVerification,true);assert.equal(result.safeToEnable,false);
    const cfg=JSON.parse(fs.readFileSync(path.join(result.directory,'wrangler.json'),'utf8'));
    assert.equal(cfg.name,'gmt-timesheet-portal-e2e-20261116');
    assert.equal(cfg.d1_databases[0].database_name,'gmt-timesheet-portal-e2e-20261116');
    assert.equal(cfg.d1_databases[0].database_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(cfg.vars.DISPATCH_ENABLED,'false');assert.equal(cfg.vars.PAY_MONTH_REPLAY_READY,'false');
    assert.equal(cfg.vars.SYNTHETIC_TEST_SERVICE_ENABLED,'false');
    assert.equal(cfg.vars.SYNTHETIC_TEST_READ_ONLY_DESTINATION,'true');assert.equal(cfg.vars.TIMESHEET_WORKBOOK_PROVISIONING_ENABLED,'false');
    assert.equal(cfg.vars.SYNTHETIC_TEST_WORKBOOK_ID,'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH');
    assert.equal(cfg.vars.ALLOWED_ORIGINS,'http://localhost:4179');
    assert.equal(cfg.vars.ADMIN_OIDS,cfg.vars.SYNTHETIC_TEST_ALLOWED_OID,'only the selected test actor receives the isolated admin role');
    assert.equal(cfg.vars.TIMESHEET_VIEWER_UPNS,cfg.vars.SUBMISSIONS_ADMIN_UPNS,'the viewer role is limited to the selected test account');
    assert.equal(cfg.vars.ADMIN_UPNS,undefined);assert.equal(cfg.vars.ADMIN_GROUP_IDS,undefined);
    assert.equal(cfg.vars.HISTORY_UPSTREAM_URL,undefined);assert.equal(cfg.vars.FORM_SUBMIT_TIMESHEET_ENDPOINT,undefined);
    assert.equal(cfg.vars.SHAREPOINT_GRAPH_CLIENT_SECRET,undefined);assert.equal(cfg.vars.TIMESHEET_DELIVERY_CALLBACK_KEY,undefined);
    assert.equal(cfg.triggers,undefined);assert.equal(cfg.routes,undefined);
    const connector=JSON.parse(fs.readFileSync(path.join(result.directory,'connector.openapi.json'),'utf8'));
    assert.equal(connector.host,'gmt-timesheet-portal-e2e-20261116.raspy-breeze-e230.workers.dev');
    assert.equal(connector.securityDefinitions.deliveryKey.name,'X-GMT-Delivery-Key');
    assert.deepEqual(Object.keys(connector.paths).sort(),['/api/integrations/private-timesheet-route','/api/integrations/timesheet-delivery-receipts']);
    const db=new DatabaseSync(':memory:');
    try {
      db.exec(fs.readFileSync(path.join(result.directory,'bootstrap.sql'),'utf8'));
      assert.equal(db.prepare('SELECT count(*) n FROM records').get().n,0);
      assert.equal(db.prepare('SELECT count(*) n FROM dispatch_queue').get().n,0);
      assert.equal(db.prepare('SELECT count(*) n FROM pay_month_start_settings').get().n,0);
      assert.equal(db.prepare('SELECT marker FROM synthetic_test_environment').get().marker,'gmt-timesheet-portal-e2e-20261116');
      assert.equal(db.prepare('SELECT employee_oid FROM private_timesheet_subjects').get().employee_oid,cfg.vars.SYNTHETIC_TEST_SUBJECT_OID);
      assert.equal(db.prepare('SELECT folder_id FROM private_timesheet_folders').get().folder_id,cfg.vars.SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID);
    } finally {db.close();}
  } finally {fs.rmSync(result.directory,{recursive:true,force:true});}
});
