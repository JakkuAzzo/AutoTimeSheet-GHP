import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { saveReviewedPayMonth } from '../cloudflare-worker/src/index.js';

test('D1 trigger writes do not turn a successful guarded correction into a conflict', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE timesheet_owner_revisions(owner_upn TEXT PRIMARY KEY,revision INTEGER);
    CREATE TABLE records(record_id TEXT PRIMARY KEY,owner_oid TEXT,owner_upn TEXT,employee_name TEXT,kind TEXT,action TEXT,status TEXT,start_date TEXT,end_date TEXT,record_date TEXT,submitted_at TEXT,updated_at TEXT,issue TEXT,payload_json TEXT);
    CREATE TABLE record_versions(record_id TEXT,owner_oid TEXT,payload_json TEXT,changed_at TEXT,changed_by_oid TEXT);
    CREATE TABLE timesheet_ownership_reviews(record_id TEXT);
    CREATE TABLE dispatch_queue(record_id TEXT PRIMARY KEY,status TEXT,updated_at TEXT,last_error TEXT);
    CREATE TABLE trigger_audit(id TEXT);
    CREATE TRIGGER records_insert AFTER INSERT ON records BEGIN INSERT INTO trigger_audit VALUES(NEW.record_id); END;
    CREATE TRIGGER records_update AFTER UPDATE ON records BEGIN INSERT INTO trigger_audit VALUES(NEW.record_id); END;`);
  const changes = () => sql.prepare('SELECT total_changes() AS n').get().n;
  const db = { prepare(statement) { return { bind(...args) { return { async run() {
    const before=changes(); sql.prepare(statement).run(...args);
    return {meta:{changes:changes()-before}};
  } }; } }; }, async batch(statements) {
    sql.exec('BEGIN'); try { const out=[]; for(const statement of statements) out.push(await statement.run()); sql.exec('COMMIT'); return out; }
    catch(error) { sql.exec('ROLLBACK'); throw error; }
  } };
  const input={recordId:'fictional',ownerOid:'oid',ownerUpn:'a@example.test',employeeName:'A',kind:'timesheets',action:'pay_month_correction',status:'Submitted',startDate:'',endDate:'',recordDate:'',submittedAt:'one',updatedAt:'one',issue:'',payloadJson:'{}'};
  const guard={employeeUpn:input.ownerUpn,localRevision:0};
  const created=await saveReviewedPayMonth({DB:db},input,{oid:'editor'},null,guard);
  assert.equal(created.created,true);
  const old=sql.prepare('SELECT * FROM records WHERE record_id=?').get(input.recordId);
  const updated=await saveReviewedPayMonth({DB:db},{...input,updatedAt:'two'}, {oid:'editor'},old,guard);
  assert.equal(updated.changed,true);
  assert.equal(sql.prepare('SELECT updated_at FROM records').get().updated_at,'two');
});
