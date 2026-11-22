import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRateSyntheticGateway } from '../cloudflare-worker/src/synthetic-portal-gateway.js';

test('provider rate gateway opens only for the exact fictional destination and isolated marker', async () => {
  const DB={prepare:()=>({bind:()=>({first:async()=>({marker:'gmt-timesheet-rate-provider-20261119'})})})};
  const env={DB,ENTRA_TENANT_ID:'8b182d6b-6f34-4ca2-84ad-50ca712b5488',ENTRA_AUDIENCES:'01b5a6c6-f6c1-47cb-aebe-67f07f415e4b',ALLOWED_ORIGINS:'http://localhost:4179',SYNTHETIC_TEST_ALLOWED_OID:'084af2b4-4427-4986-b7e0-ec163c520282',SYNTHETIC_TEST_SUBJECT_OID:'bb420999-c705-4dc2-9b0e-33846b43ae2c',PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFIIINPOKIYCCZEJFTFMCUTRGBUL',DISPATCH_ENABLED:'false',PAY_MONTH_REPLAY_READY:'false',DOCUMENT_IMPORT_SHARED_STORAGE_READY:'false',SYNTHETIC_TEST_SERVICE_ENABLED:'true',SYNTHETIC_TEST_READ_ONLY_DESTINATION:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'false',SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFLBUIMATW7STNBLMXO3VGLMSTCB',SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFOCW3CCKIKQRZFJYU6JYYWSK3UK',SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFKFZ6PPD3U36RHLN74B2KFNIR4F',SYNTHETIC_RATE_TEST_MODE:'provider-fixture-v1',PAY_MONTH_RATE_DELIVERY_READY:'true'};
  const gateway=createProviderRateSyntheticGateway();
  const req=()=>new Request('https://isolated.test/api/synthetic-fixture-proof',{method:'OPTIONS',headers:{origin:'http://localhost:4179','access-control-request-method':'POST'}});
  assert.equal((await gateway.fetch(req(),env,{})).status,204);
  for (const change of [
    {PRIVATE_TIMESHEET_PARENT_ID:'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP'},
    {SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID:'01ZURLVFPFOELOEM7HDJB2SOQSB3IBWSRN'},
    {SYNTHETIC_TEST_MONTH_FOLDER_ID:'01ZURLVFLBI6XSXPOOSRCIKDR2EUSAR3I5'},
    {SYNTHETIC_TEST_WORKBOOK_ID:'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH'},
    {SYNTHETIC_TEST_ALLOWED_OID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    {SYNTHETIC_TEST_SUBJECT_OID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
    {SYNTHETIC_RATE_TEST_MODE:'build-only-v1'}, {DISPATCH_ENABLED:'true'},
  ]) assert.equal((await gateway.fetch(req(),{...env,...change},{})).status,503);
  const oldDB={prepare:()=>({bind:()=>({first:async()=>({marker:'gmt-timesheet-portal-e2e-20261116'})})})};
  assert.equal((await gateway.fetch(req(),{...env,DB:oldDB},{})).status,503);
});
