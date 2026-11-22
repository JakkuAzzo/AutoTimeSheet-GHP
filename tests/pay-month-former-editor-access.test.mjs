import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { canAccessRecord, listRecords } from '../cloudflare-worker/src/index.js';

const correction = { kind: 'timesheets', action: 'pay_month_correction', owner_oid: 'former-editor-id', owner_upn: 'employee@example.test' };
const formerEditor = { oid: 'former-editor-id', upn: 'editor@example.test', isAdmin: false };
const employee = { oid: 'employee-id', upn: 'employee@example.test', isAdmin: false };
assert.equal(canAccessRecord(formerEditor, correction), false, 'an on-behalf editor without a role cannot access the employee correction');
assert.equal(canAccessRecord(employee, correction), false, 'an address alone cannot grant mutation of a legacy correction whose saved account ID belongs to the former editor');
assert.equal(canAccessRecord(employee, {...correction,owner_oid:'employee-id'}), true, 'a correction bound to the matching subject and address remains accessible');

let query;
const env = { DB: { prepare(sql) { return { bind(...bindings) { if (sql.includes('SELECT r.*')) query = { sql, bindings }; return { async all() { return { results: [] }; } }; } }; } } };
await listRecords(new Request('https://gmt.test/api/history?kind=timesheets'), env, formerEditor);
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE records(record_id TEXT, owner_oid TEXT, owner_upn TEXT, kind TEXT, action TEXT, status TEXT, updated_at TEXT);
 CREATE TABLE dispatch_queue(record_id TEXT, status TEXT, attempts INTEGER, queued_at TEXT, last_sent_at TEXT, last_error TEXT);
 CREATE TABLE profile_settings(owner_oid TEXT,owner_upn TEXT);
 INSERT INTO records VALUES ('correction','former-editor-id','employee@example.test','timesheets','pay_month_correction','Submitted','2026-10-01');`);
sqlite.exec(readFileSync(new URL('../cloudflare-worker/migrations/0028_timesheet_ownership_review.sql',import.meta.url),'utf8'));
assert.equal(sqlite.prepare(query.sql).all(...query.bindings).length, 0, 'an on-behalf editor without a role cannot list the employee correction');

const returnedRow = { ...correction, record_id: 'correction', employee_name: 'Employee', status: 'Submitted', updated_at: '2026-10-01', payload_json: JSON.stringify({ payMonth: '2026-10', rows: [] }) };
const viewEnv = { DB: { prepare(sql) { const result = { async all() { return { results: sql.includes('SELECT r.*') ? [returnedRow] : [] }; } }; return { ...result, bind() { return result; } }; } } };
const payPeriods = { payMonthKeyForDate() { return '2026-10'; } };
const request = new Request('https://gmt.test/api/history?kind=timesheets');
const employeeView = await listRecords(request, viewEnv, employee, payPeriods);
assert.equal(employeeView.records[0].can_edit_record, false, 'an unreviewed legacy correction is not offered for editing based on address alone');
const viewerView = await listRecords(request, viewEnv, { ...formerEditor, isTimesheetViewer: true }, payPeriods);
assert.equal(viewerView.records[0].can_edit_record, false, 'a viewer who formerly edited the correction cannot edit it');
console.log('PASS: former on-behalf editors do not inherit employee access');
