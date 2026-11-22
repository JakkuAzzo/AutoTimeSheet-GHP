import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker, { adminQueueStatus } from '../cloudflare-worker/src/index.js';
import { createRegisterWorkbook, runRegisterOfficeScript } from './helpers/pay-month-register-office-script.mjs';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`CREATE TABLE records (
  record_id TEXT PRIMARY KEY, owner_oid TEXT NOT NULL, owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL,
  start_date TEXT, end_date TEXT, record_date TEXT, submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, issue TEXT, payload_json TEXT NOT NULL
);
CREATE TABLE record_attachments (
  record_id TEXT NOT NULL, field_name TEXT NOT NULL, file_name TEXT NOT NULL,
  content_type TEXT NOT NULL, content_base64 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (record_id, field_name),
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);
CREATE TABLE dispatch_queue (
  record_id TEXT PRIMARY KEY, status TEXT NOT NULL, queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL, last_sent_at TEXT, last_error TEXT,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);`);
db.exec(`CREATE TABLE timesheet_queue_source_guards(record_id TEXT,owner_upn TEXT,owner_revision INTEGER,source_base64 TEXT);
CREATE TABLE timesheet_queue_attachment_guards(record_id TEXT,manifest_json TEXT);
CREATE TABLE timesheet_owner_revisions(owner_upn TEXT,revision INTEGER);
CREATE TABLE timesheet_ownership_reviews(record_id TEXT,subject_oid TEXT);`);
db.exec(await readFile(new URL('../cloudflare-worker/migrations/0017_timesheet_delivery_receipts.sql', import.meta.url), 'utf8'));
db.exec(await readFile(new URL('../cloudflare-worker/migrations/0023_timesheet_delivery_routes.sql', import.meta.url), 'utf8'));

let beforeReceiptInsert = null;
const DB = {
  prepare(sql) {
    const statement = (args = []) => ({
      sql,
      args,
      bind(...values) { return statement(values); },
      first() { return db.prepare(sql).get(...args) || null; },
      all() { return { results: db.prepare(sql).all(...args) }; },
      run() {
        if (beforeReceiptInsert && /INSERT INTO timesheet_delivery_receipts/.test(sql)) {
          const inject = beforeReceiptInsert; beforeReceiptInsert = null; inject();
        }
        return { success: true, meta: db.prepare(sql).run(...args) };
      }
    });
    return statement();
  }
};

const correctionId = 'qa-receipt-correction-20261026';
const rowDate = '2026-10-01';
const rowId = `${correctionId}|${rowDate}`;
const runId = 'qa-run-20261026-001';
const runStartedAt = '2026-10-26T10:00:00.000Z';
const correction = {
  mode: 'replace-pay-month',
  recordId: correctionId,
  employeeName: 'Synthetic QA', payMonth: '2026-10',
  rows: [{ recordId: rowId, date: rowDate, startTime: '08:00', finishTime: '16:30', breakMinutes: 30, note: 'Synthetic receipt integration test' }]
};
const generation = createHash('sha256').update(JSON.stringify(correction)).digest('hex');

db.prepare(`INSERT INTO records
  (record_id, owner_oid, owner_upn, employee_name, kind, action, status, record_date, submitted_at, updated_at, payload_json)
  VALUES (?, 'qa-owner', 'qa@example.test', 'Synthetic QA', 'timesheets', 'pay_month_correction', 'Queued', ?, ?, ?, ?)`)
  .run(correctionId, rowDate, runStartedAt, runStartedAt, JSON.stringify({ rows: correction.rows }));
db.prepare(`INSERT INTO record_attachments
  (record_id, field_name, file_name, content_type, content_base64, size_bytes, created_at)
  VALUES (?, 'attachment_record', 'qa-correction.json', 'application/json', ?, ?, ?)`)
  .run(correctionId, Buffer.from(JSON.stringify(correction)).toString('base64'), Buffer.byteLength(JSON.stringify(correction)), runStartedAt);
db.prepare(`INSERT INTO dispatch_queue
  (record_id, status, queued_at, updated_at, attempts, next_attempt_at, last_sent_at, last_error)
  VALUES (?, 'sent', ?, ?, 1, ?, ?, '')`)
  .run(correctionId, runStartedAt, runStartedAt, runStartedAt, runStartedAt);
db.prepare('INSERT INTO timesheet_delivery_routes VALUES (?,?,?,?,?,?,?,?)').run(correctionId,runId,runStartedAt,generation,'employee-folder','month-folder','approved-workbook',runStartedAt);

// Exercise the same Office Script used by Power Automate against an isolated
// in-memory workbook, then feed only its read-back evidence to the Worker.
const workbook = createRegisterWorkbook('Synthetic QA', '2026-10');
const workbookResult = runRegisterOfficeScript(workbook, correction);
assert.deepEqual(workbookResult.verifiedRecordIds, [rowId]);
assert.deepEqual(JSON.parse(workbookResult.verifiedRowsJson), [{ recordId: rowId, date: rowDate, start:'08:00', finish:'16:30', breakMinutes:30, absence:'NA', totalMinutes:480, notes:'Synthetic receipt integration test' }]);
assert.deepEqual(workbookResult.unverifiedRecordIds, []);

const env = { DB, TIMESHEET_DELIVERY_CALLBACK_KEY: 'qa-only-callback-key-that-is-never-used-in-production-20261026' };
const callback = async (payload, key = env.TIMESHEET_DELIVERY_CALLBACK_KEY) => worker.fetch(
  new Request('https://gmt-portal-api.test/api/integrations/timesheet-delivery-receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gmt-delivery-key': key },
    body: JSON.stringify({ generation, ...payload })
  }), env, {}
);
const body = async response => response.json();

db.prepare("UPDATE dispatch_queue SET status = 'queued', attempts = 0 WHERE record_id = ?").run(correctionId);
assert.equal((await callback({ recordId: correctionId, flowRunId: 'qa-unsent-run', runStartedAt, event: 'flow_started' })).status, 409,
  'a correction that has never been dispatched cannot acquire delivery evidence');
db.prepare("UPDATE dispatch_queue SET status = 'sending', attempts = 1 WHERE record_id = ?").run(correctionId);
beforeReceiptInsert = () => db.prepare("UPDATE dispatch_queue SET status = 'queued' WHERE record_id = ?").run(correctionId);
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_started' })).status, 409,
  'a receipt is rejected if its dispatch becomes queued before the evidence is stored');
db.prepare("UPDATE dispatch_queue SET status = 'sent', attempts = 1 WHERE record_id = ?").run(correctionId);

assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_started', generation: undefined })).status, 400,
  'a callback must identify the exact queued attachment generation');
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_started', generation: '0'.repeat(64) })).status, 409,
  'a callback from another generation is rejected even when the dates match');

assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_started' }, 'wrong-key')).status, 401,
  'invalid callback credentials are rejected');
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'workbook_verified', workbookId:'approved-workbook', created: 1, updated: 0, unchanged: 0, verifiedRecordIds: [rowId], verifiedRows: JSON.parse(workbookResult.verifiedRowsJson) })).status, 409,
  'workbook confirmation cannot precede flow start');

const started = await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_started' });
assert.equal(started.status, 200);
assert.deepEqual(await body(started), { accepted: true });

const mismatched = await callback({
  recordId: correctionId, flowRunId: runId, runStartedAt, event: 'workbook_verified',
  workbookId:'approved-workbook',
  created: 1, updated: 0, unchanged: 0,
  verifiedRecordIds: [`${correctionId}|2026-10-02`],
  verifiedRows: [{ ...JSON.parse(workbookResult.verifiedRowsJson)[0], recordId: `${correctionId}|2026-10-02`, date: '2026-10-02' }]
});
assert.equal(mismatched.status, 409, 'Worker rejects workbook proof that differs from the protected source dates');

const verifiedPayload = {
  recordId: correctionId, flowRunId: runId, runStartedAt, event: 'workbook_verified',
  workbookId:'approved-workbook',
  created: workbookResult.created, updated: workbookResult.updated, unchanged: workbookResult.unchanged,
  verifiedRecordIds: workbookResult.verifiedRecordIds, verifiedRows: JSON.parse(workbookResult.verifiedRowsJson)
};
const { verifiedRows, verifiedRecordIds, ...serializedBase } = verifiedPayload;
const serializedPayload = {...serializedBase, verifiedRowsJson:JSON.stringify(verifiedRows), verifiedRecordIdsJson:JSON.stringify(verifiedRecordIds)};
assert.equal((await callback({...verifiedPayload,workbookId:'different-workbook'})).status,409,
  'matching rows cannot verify a different workbook from the approved route');
assert.equal((await callback({...verifiedPayload,runStartedAt:'2026-10-27T10:00:01.000Z'})).status,409,
  'matching rows and workbook cannot verify a different provider run start');
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM timesheet_delivery_receipts WHERE record_id=? AND event_type='workbook_verified'").get(correctionId).count,0,
  'rejected route evidence leaves no workbook verification receipt');
assert.equal((await callback({...serializedPayload,verifiedRowsJson:'not-json'})).status,400,'malformed serialized verification is rejected');
assert.equal((await callback({...serializedPayload,verifiedRecordIdsJson:undefined})).status,400,'both serialized arrays are required');
assert.equal((await callback({...serializedPayload,verifiedRowsJson:JSON.stringify(['wrong'])})).status,400,'serialized content must contain row objects');
assert.equal((await callback({recordId:correctionId,flowRunId:runId,runStartedAt,event:'flow_started',verifiedRowsJson:'[]',verifiedRecordIdsJson:'[]'})).status,400,'serialized evidence is accepted only for workbook verification');

assert.equal((await callback({...serializedPayload,verifiedRows})).status,400,'mixed verification representations are rejected');
assert.equal((await callback({...serializedPayload,verifiedRowsJson:JSON.stringify([{...JSON.parse(workbookResult.verifiedRowsJson)[0],date:'2026-10-02'}])})).status,409,'serialized rows remain bound to the protected source');
assert.equal((await callback({...verifiedPayload,verifiedRows:verifiedPayload.verifiedRows.map(row=>({...row,sourceBasicMinutes:0,sourceOt15Minutes:0,sourceOt20Minutes:0}))})).status,409,'legacy sources cannot gain unverified rate evidence');
assert.equal((await callback(serializedPayload)).status,200,'serialized verified arrays are accepted after the same checks');
assert.equal((await callback(verifiedPayload)).status, 200);
assert.equal((await callback(verifiedPayload)).status, 200, 'identical callback retries are idempotent');
assert.equal((await callback({ ...verifiedPayload, created: 0, unchanged: 1 })).status, 409,
  'changed evidence cannot replace an accepted receipt');

db.prepare("UPDATE dispatch_queue SET status='uncertain', last_error='Synthetic provider timeout' WHERE record_id=?").run(correctionId);
const heldStatus=await adminQueueStatus({DB},{isAdmin:true});
assert.equal(heldStatus.counts.uncertain,1,'an uncertain handoff is visible to Accounts');
assert.equal(heldStatus.records[0].status,'uncertain');

assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_completed' })).status, 200);
assert.equal(db.prepare('SELECT status FROM dispatch_queue WHERE record_id = ?').get(correctionId).status, 'uncertain',
  'an older delivery without local source proof stays held even after a verified receipt');
assert.equal(db.prepare('SELECT last_error FROM dispatch_queue WHERE record_id=?').get(correctionId).last_error, 'Synthetic provider timeout', 'the original provider outcome remains available for review');
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_failed', stage: 'history_index', safeError: 'later failure' })).status, 409,
  'a completed run cannot subsequently be marked failed');
assert.equal((await callback({ recordId: correctionId, flowRunId: runId, runStartedAt, event: 'flow_completed' })).status, 200,
  'a duplicate terminal receipt remains idempotent');

const receipts = db.prepare('SELECT event_type, evidence_json FROM timesheet_delivery_receipts WHERE record_id = ? ORDER BY event_type').all(correctionId);
assert.deepEqual(receipts.map(row => row.event_type), ['flow_completed', 'flow_started', 'workbook_verified']);
const queueBefore = db.prepare('SELECT status, attempts, last_sent_at FROM dispatch_queue WHERE record_id = ?').get(correctionId);
const recordBefore = db.prepare('SELECT status, payload_json FROM records WHERE record_id = ?').get(correctionId);
const queueStatus = await adminQueueStatus({ DB, FORM_SUBMIT_TIMESHEET_ENDPOINT: 'https://example.test/submit', PAY_MONTH_REPLAY_READY: 'false' }, { isAdmin: true });
const readySwitchesStatus=await adminQueueStatus({DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test',PAY_MONTH_REPLAY_READY:'true',PRIVATE_TIMESHEET_DESTINATION_VERIFIED:'true',TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED:'true',TIMESHEET_WORKBOOK_PROVISIONING_ENABLED:'true',TIMESHEET_DELIVERY_CALLBACK_KEY:'fixture-key-with-more-than-32-characters'}, {isAdmin:true});
assert.equal(readySwitchesStatus.providerStatus,'awaiting-source-review','configured switches do not imply complete source review');
assert.equal(queueStatus.records[0].recordId, correctionId);
assert.equal(queueStatus.counts.uncertain, 1, 'the unproven historical delivery stays visible for review');
assert.equal(queueStatus.records[0].deliveryReceipt.flowRunId, runId);
assert.equal(queueStatus.records[0].deliveryReceipt.events.flow_started.receivedAt.length > 0, true);
assert.equal(queueStatus.records[0].deliveryReceipt.events.workbook_verified.verifiedRowCount, 1);
assert.ok(queueStatus.records[0].deliveryReceipt.events.flow_completed);
await assert.rejects(adminQueueStatus({ DB }, { isAdmin: false }), error => error.status === 403);
assert.deepEqual(db.prepare('SELECT status, attempts, last_sent_at FROM dispatch_queue WHERE record_id = ?').get(correctionId), queueBefore,
  'queue status reads do not mutate dispatch or replay state');
assert.deepEqual(db.prepare('SELECT status, payload_json FROM records WHERE record_id = ?').get(correctionId), recordBefore,
  'receipt callbacks do not edit payroll source data');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM timesheet_delivery_receipts').get().count, 3);

db.prepare(`INSERT INTO timesheet_delivery_receipts (record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json)
  VALUES (?,?,?,?,?,?)`).run(correctionId,'legacy-unbound-run','2026-10-27T10:00:00.000Z','workbook_verified','2026-10-27T10:01:00.000Z',JSON.stringify({generation,workbookId:'unapproved',created:1,updated:0,unchanged:0,verifiedRows:[{recordId:rowId,date:rowDate}]}));
const afterLegacy=await adminQueueStatus({DB,FORM_SUBMIT_TIMESHEET_ENDPOINT:'https://example.test/submit'}, {isAdmin:true});
assert.equal(afterLegacy.records[0].deliveryReceipt.flowRunId,runId,'an old unbound receipt cannot supersede an approved workbook run');

const oldStartOnly = runId;
assert.equal((await callback({ recordId: correctionId, flowRunId: oldStartOnly, runStartedAt, event: 'flow_started' })).status, 200);
const nextCorrection = { ...correction, rows: [{ ...correction.rows[0], note: 'Changed source with the same date' }] };
db.prepare("UPDATE record_attachments SET content_base64 = ? WHERE record_id = ? AND field_name = 'attachment_record'")
  .run(Buffer.from(JSON.stringify(nextCorrection)).toString('base64'), correctionId);
const nextGeneration = createHash('sha256').update(JSON.stringify(nextCorrection)).digest('hex');
assert.equal((await callback({ recordId: correctionId, flowRunId: 'late-run', runStartedAt, event: 'flow_started' })).status, 409,
  'late receipts cannot verify another saved generation with the same row dates');
assert.equal((await callback({ ...verifiedPayload, flowRunId: oldStartOnly, generation: nextGeneration })).status, 409,
  'a start event from the old generation cannot authorize verification of a new generation');
const nextQueueStatus = await adminQueueStatus({ DB, FORM_SUBMIT_TIMESHEET_ENDPOINT: 'https://example.test/submit' }, { isAdmin: true });
assert.equal(nextQueueStatus.records[0].deliveryReceipt, null, 'an old generation must not appear as the current workbook receipt');
db.prepare('INSERT INTO timesheet_delivery_routes VALUES (?,?,?,?,?,?,?,?)').run(correctionId,'qa-racing-run',runStartedAt,nextGeneration,'employee-folder','month-folder','approved-workbook',runStartedAt);
beforeReceiptInsert = () => db.prepare(`INSERT INTO timesheet_delivery_receipts
  (record_id, flow_run_id, run_started_at, event_type, received_at, evidence_json) VALUES (?, ?, ?, 'flow_started', ?, ?)`)
  .run(correctionId, 'qa-racing-run', runStartedAt, runStartedAt, JSON.stringify({ generation }));
assert.equal((await callback({ recordId: correctionId, generation: nextGeneration, flowRunId: 'qa-racing-run', runStartedAt, event: 'flow_failed', stage: 'other', safeError: 'Synthetic race' })).status, 409,
  'a concurrent event from another generation cannot be added to the same run');

// A delayed old-generation run can have a later provider timestamp than the
// current run. Ranking must happen after selecting the current generation.
const reorderedId='qa-receipt-generation-ranking';
const olderSource=JSON.stringify({mode:'replace-pay-month',recordId:reorderedId,rows:[{date:rowDate,note:'old'}]});
const currentSource=JSON.stringify({mode:'replace-pay-month',recordId:reorderedId,rows:[{date:rowDate,note:'current'}]});
const oldDigest=createHash('sha256').update(olderSource).digest('hex');
const currentDigest=createHash('sha256').update(currentSource).digest('hex');
const laterStart='2026-10-28T10:00:00.000Z', earlierStart='2026-10-27T10:00:00.000Z';
db.prepare(`INSERT INTO records (record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(reorderedId,'owner','person@example.test','Synthetic','timesheets','pay_month_correction','Queued',runStartedAt,runStartedAt,'{}');
db.prepare(`INSERT INTO dispatch_queue (record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES (?,'sent',?,?,1,?)`)
  .run(reorderedId,runStartedAt,runStartedAt,runStartedAt);
db.prepare(`INSERT INTO record_attachments VALUES (?,'attachment_record','source.json','application/json',?,?,?)`)
  .run(reorderedId,Buffer.from(currentSource).toString('base64'),Buffer.byteLength(currentSource),runStartedAt);
for(const [run,start,digest] of [['old-later-run',laterStart,oldDigest],['current-earlier-run',earlierStart,currentDigest]]){
  db.prepare('INSERT INTO timesheet_delivery_routes VALUES (?,?,?,?,?,?,?,?)').run(reorderedId,run,start,digest,'employee-folder','month-folder',`book-${run}`,start);
  db.prepare(`INSERT INTO timesheet_delivery_receipts (record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json) VALUES (?,?,?,'flow_started',?,?)`)
    .run(reorderedId,run,start,start,JSON.stringify({generation:digest}));
}
const reorderedStatus=await adminQueueStatus({DB},{isAdmin:true});
assert.equal(reorderedStatus.records.find(row=>row.recordId===reorderedId).deliveryReceipt?.flowRunId,'current-earlier-run',
  'a newer timestamp from an old generation cannot hide the current generation receipt');

for (const [event,evidence] of [['workbook_verified',{generation:currentDigest,workbookId:'book-current-earlier-run',created:1,updated:0,unchanged:0,sourceNoteVerification:'source-match-v1',verifiedRows:[{recordId:`${reorderedId}|${rowDate}`,date:rowDate}]}],['flow_completed',{generation:currentDigest}]]) {
  db.prepare('INSERT INTO timesheet_delivery_receipts (record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json) VALUES (?,?,?,?,?,?)')
    .run(reorderedId,'current-earlier-run',earlierStart,event,earlierStart,JSON.stringify(evidence));
}
db.prepare("UPDATE dispatch_queue SET status='completed' WHERE record_id=?").run(reorderedId);
const legacyStatus=await adminQueueStatus({DB},{isAdmin:true});
const legacyRow=legacyStatus.records.find(row=>row.recordId===reorderedId);
const legacyEvents=legacyRow.deliveryReceipt.events;
assert.equal(legacyEvents.workbook_verified,undefined,'a notes-only verification does not claim full-row verification');
assert.equal(legacyEvents.flow_completed,undefined,'legacy completion cannot be displayed as a verified delivery');
assert.equal(legacyRow.status,'uncertain','legacy completed rows are shown to Accounts as needing review');
assert.equal(db.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(reorderedId).status,'completed','the read-only status projection does not rewrite historical records');
db.prepare("UPDATE dispatch_queue SET status='uncertain' WHERE record_id=?").run(reorderedId);
assert.equal((await callback({recordId:reorderedId,flowRunId:'current-earlier-run',runStartedAt:earlierStart,generation:currentDigest,event:'flow_completed'})).status,409,
  'a legacy notes-only receipt cannot release a queued delivery');
assert.equal(db.prepare('SELECT status FROM dispatch_queue WHERE record_id=?').get(reorderedId).status,'uncertain','a historical completion callback cannot release a reconciled hold');

// Schema 3 is not yet queue-enabled; exercise receipt verification against a
// protected fictional source and the real local Office Script read-back.
const rateId='fictional-rate-receipt';
const rateRowId=rateId+'|'+rowDate;
const rateSource={schemaVersion:3,mode:'replace-pay-month',recordId:rateId,employeeName:'Synthetic QA',payMonth:'2026-10',rows:[{recordId:rateRowId,date:rowDate,startTime:'08:00',finishTime:'16:30',breakMinutes:30,note:'Fictional rates',sourceBasicMinutes:420,sourceOt15Minutes:60,sourceOt20Minutes:null}]};
const rateJson=JSON.stringify(rateSource),rateGeneration=createHash('sha256').update(rateJson).digest('hex'),rateRun='fictional-rate-run';
db.prepare(`INSERT INTO records (record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(rateId,'qa-owner','qa@example.test','Synthetic QA','timesheets','pay_month_correction','Queued',runStartedAt,runStartedAt,JSON.stringify({rows:rateSource.rows}));
db.prepare(`INSERT INTO dispatch_queue (record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES (?,'sent',?,?,1,?)`).run(rateId,runStartedAt,runStartedAt,runStartedAt);
db.prepare(`INSERT INTO record_attachments VALUES (?,'attachment_record','source.json','application/json',?,?,?)`).run(rateId,Buffer.from(rateJson).toString('base64'),Buffer.byteLength(rateJson),runStartedAt);
db.prepare('INSERT INTO timesheet_delivery_routes VALUES (?,?,?,?,?,?,?,?)').run(rateId,rateRun,runStartedAt,rateGeneration,'employee-folder','month-folder','rate-workbook',runStartedAt);
const rateResult=runRegisterOfficeScript(createRegisterWorkbook('Synthetic QA','2026-10',{sourceRates:true}),rateSource);
const rateBase={recordId:rateId,flowRunId:rateRun,runStartedAt,generation:rateGeneration};
const rateVerified={...rateBase,event:'workbook_verified',workbookId:'rate-workbook',created:rateResult.created,updated:rateResult.updated,unchanged:rateResult.unchanged,verifiedRecordIds:rateResult.verifiedRecordIds,verifiedRows:JSON.parse(rateResult.verifiedRowsJson)};
assert.equal((await callback({...rateBase,event:'flow_started'})).status,200);
db.exec('SAVEPOINT legacy_rate_proof');
db.prepare('INSERT INTO timesheet_delivery_receipts (record_id,flow_run_id,run_started_at,event_type,received_at,evidence_json) VALUES (?,?,?,\'workbook_verified\',?,?)').run(rateId,rateRun,runStartedAt,runStartedAt,JSON.stringify({generation:rateGeneration,workbookId:'rate-workbook',sourceRowVerification:'source-row-v1',verifiedRows:[{recordId:rateRowId,date:rowDate}]}));
assert.equal((await callback({...rateBase,event:'flow_completed'})).status,409,'older verification cannot prove rate values');
const earlyRateStatus=await adminQueueStatus({DB},{isAdmin:true});
assert.equal(earlyRateStatus.records.find(row=>row.recordId===rateId).deliveryReceipt.events.workbook_verified,undefined,'a legacy proof is not displayed as a rate verification');
db.exec('ROLLBACK TO legacy_rate_proof');db.exec('RELEASE legacy_rate_proof');
for(const changed of [{sourceBasicMinutes:419},{sourceOt15Minutes:0},{sourceOt20Minutes:0},{sourceOt20Minutes:undefined}]){
  assert.notEqual((await callback({...rateVerified,verifiedRows:rateVerified.verifiedRows.map(row=>({...row,...changed}))})).status,200,'altered, invented or omitted rate evidence cannot be accepted');
}
assert.equal((await callback(rateVerified)).status,200,'matching source rates are verified from workbook read-back');
assert.equal(JSON.parse(db.prepare("SELECT evidence_json FROM timesheet_delivery_receipts WHERE record_id=? AND event_type='workbook_verified'").get(rateId).evidence_json).sourceRowVerification,'source-row-v2');
assert.equal((await callback({...rateBase,event:'flow_completed'})).status,200);
const verifiedRateStatus=await adminQueueStatus({DB},{isAdmin:true});
assert.ok(verifiedRateStatus.records.find(row=>row.recordId===rateId).deliveryReceipt.events.workbook_verified,'the verified rate receipt is visible to Accounts');
assert.ok(verifiedRateStatus.records.find(row=>row.recordId===rateId).deliveryReceipt.events.flow_completed);
console.log('PASS: synthetic Office Script read-back → authenticated Worker callbacks → append-only D1 receipts → Accounts queue status; payroll source unchanged.');
