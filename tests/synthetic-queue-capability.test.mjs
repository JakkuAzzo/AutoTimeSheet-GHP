import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { queueRecordAttachments } from '../cloudflare-worker/src/index.js';
import { syntheticQueueCapability } from '../cloudflare-worker/src/synthetic-queue-capability.js';

for (const schemaVersion of [2,3]) test(`only an internal test capability can queue a synthetic v${schemaVersion} correction, with normal race protection`, async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE records(record_id TEXT PRIMARY KEY, action TEXT, owner_upn TEXT, payload_json TEXT, status TEXT, issue TEXT, updated_at TEXT,kind TEXT,owner_oid TEXT,employee_name TEXT);
    CREATE TABLE record_attachments(record_id TEXT,field_name TEXT,file_name TEXT,content_type TEXT,content_base64 TEXT,size_bytes INTEGER,created_at TEXT,PRIMARY KEY(record_id,field_name));
    CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT,queued_at TEXT,updated_at TEXT,attempts INTEGER,next_attempt_at TEXT,last_sent_at TEXT,last_error TEXT);
    CREATE TABLE timesheet_ownership_reviews(record_id TEXT);`);
  const payload = JSON.stringify({ testMode: true, payMonth: '2026-10', editedAt: '2026-11-03T10:00:00.000Z' });
  const record = { record_id: 'fictional-correction', kind: 'timesheets', action: 'pay_month_correction',
    owner_upn: 'fictional@example.test', payload_json: payload };
  sql.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)').run(record.record_id, record.action, record.owner_upn, payload, 'Submitted', '', 'now', record.kind,null,null);
  const DB = { prepare(statement) { return { bind(...args) { return { async first() { return sql.prepare(statement).get(...args) || null; }, run() { return { meta: { changes: sql.prepare(statement).run(...args).changes } }; } }; } }; },
    async batch(statements) { sql.exec('BEGIN'); try { const result=[]; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  const b64 = x => Buffer.from(x).toString('base64');
  const source = { schemaVersion, mode: 'replace-pay-month', recordId: record.record_id,
    employeeUpn: record.owner_upn, payMonth: '2026-10', submittedAt: '2026-11-03T10:00:00.000Z', rows: [{recordId:'fictional-correction|2026-10-05',date:'2026-10-05',startTime:'09:00',finishTime:'12:00',breakMinutes:0,absenceReason:'NA',totalMinutes:180,workedHours:3,note:'',changeNote:'',...(schemaVersion===3?{sourceBasicMinutes:null,sourceOt15Minutes:null,sourceOt20Minutes:null}:{})}] };
  const body = { attachments: [
    { fieldName: 'attachment', fileName: 'test.xlsx', contentBase64: b64('x') },
    { fieldName: 'attachment_csv', fileName: 'test.csv', contentBase64: b64('x') },
    { fieldName: 'attachment_record', fileName: 'test.json', contentBase64: b64(JSON.stringify(source)) }
  ] };
  const testEnv = { DB, SYNTHETIC_TEST_QUEUE_ENABLED: 'true', DISPATCH_ENABLED: 'false', PAY_MONTH_REPLAY_READY: 'false',
    PRIVATE_TIMESHEET_PARENT_ID: '01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',PAY_MONTH_RATE_DELIVERY_READY:'true' };
  assert.equal(queueRecordAttachments({ DB }, record, body).skipped, true);
  assert.equal(queueRecordAttachments({ DB }, record, body, true).skipped, true, 'request-supplied truthy values cannot enable the test path');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM dispatch_queue').get().n, 0);
  assert.throws(() => queueRecordAttachments({ DB }, record, body, syntheticQueueCapability), error => error.status === 403,
    'the capability alone cannot enable the queue in an ordinary environment');
  assert.throws(() => queueRecordAttachments({ ...testEnv, DISPATCH_ENABLED: 'true' }, record, body, syntheticQueueCapability), error => error.status === 403);
  assert.equal((await queueRecordAttachments(testEnv, record, body, syntheticQueueCapability)).queued, true);
  sql.prepare("UPDATE dispatch_queue SET status='sending' WHERE record_id=?").run(record.record_id);
  await assert.rejects(() => queueRecordAttachments(testEnv, record, body, syntheticQueueCapability), error => error.status === 409);
  const realRecord = { ...record, payload_json: JSON.stringify({ payMonth: '2026-10', editedAt: '2026-11-03T10:00:00.000Z' }) };
  assert.throws(() => queueRecordAttachments(testEnv, realRecord, body, syntheticQueueCapability), error => error.status === 403);
  const merelyNamedTest = { ...realRecord, employee_name: 'TEST Person' };
  assert.throws(() => queueRecordAttachments(testEnv, merelyNamedTest, body, syntheticQueueCapability), error => error.status === 403,
    'a label alone cannot unlock the test queue');
  sql.close();
});
