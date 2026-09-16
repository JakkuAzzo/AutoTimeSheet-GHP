import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normaliseUpstreamRecord, projectRow } from '../cloudflare-worker/src/index.js';

const root = new URL('../power-platform/reconciliation/2026-09/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('source-manifest.json', root), 'utf8'));
const reconciled = JSON.parse(fs.readFileSync(new URL('records.json', root), 'utf8')).records;

assert.equal(manifest.sources.length, 32, 'all mailbox bundle copies remain in the source manifest');
assert.equal(manifest.sources.filter((source) => source.employee_name === 'Michelle Reid').length, 9);
assert.equal(manifest.sources.filter((source) => source.parse_status === 'excluded-identity').length, 9);
assert.equal(manifest.dailyRows.length, 114, 'source row evidence is retained for each bundle');
assert.equal(reconciled.length, 14, 'materially different source variants are retained as records');

const find = (employee, start, predicate = () => true) => reconciled.find((record) => (
  record.employee_name === employee && record.start_date === start && predicate(record)
));

const ainsleySeptember = find('Ainsley', '2026-09-07', (record) => record.source_variant_status === 'authoritative');
assert.ok(ainsleySeptember);
assert.deepEqual(ainsleySeptember.payload.rows.map((row) => row.date), [
  '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'
]);
assert.equal(ainsleySeptember.payload.totals.total, 2520, 'clock interval plus break deduction is the canonical total');

const simonAugust = find('Simon', '2026-08-24', (record) => !record.issue.includes('aligned to the declared week'));
assert.ok(simonAugust);
assert.equal(simonAugust.source_variant_status, 'authoritative', 'declared-date Simon version is the single calendar winner');
assert.equal(reconciled.filter((record) => record.employee_name === 'Simon' && record.start_date === '2026-08-24' && record.source_variant_status === 'authoritative').length, 1);
assert.equal(reconciled.filter((record) => record.employee_name === 'Simon' && record.start_date === '2026-08-24' && record.source_variant_status === 'source-variant').length, 1);
assert.equal(simonAugust.payload.rows.length, 7);
assert.deepEqual(simonAugust.payload.rows.map((row) => row.date), [
  '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'
]);

const matthewInvalid = find('Matthew', '2026-09-07', (record) => record.status === 'Needs review');
assert.ok(matthewInvalid);
assert.equal(matthewInvalid.payload.rows.filter((row) => row.validationIssues.some((issue) => /earlier than clock/i.test(issue))).length, 4);
assert.equal(matthewInvalid.payload.rows.filter((row) => row.workedMinutes === null).length, 4);
assert.ok(find('Matthew', '2026-09-07', (record) => record.source_variant_status === 'authoritative'));
assert.ok(reconciled.filter((record) => record.employee_name === 'Matthew' && record.start_date === '2026-09-07').length >= 3);

const directory = { STAFF_DIRECTORY_JSON: JSON.stringify([{ name: 'Matthew', upn: 'matthew@gmt-services.co.uk' }]) };
const calculated = normaliseUpstreamRecord({
  Id: 99,
  Title: 'FW: [GMT][TIMESHEET][SUBMISSION] Matthew | Week 2026-09-07',
  EmployeeName: 'Matthew',
  Issue: JSON.stringify([{ date: '2026-09-07', startTime: '08:00', finishTime: '17:00', lunchMinutes: 60, workedHours: 99 }])
}, { isAdmin: true, name: 'Accounts', upn: 'acc.gmtelect@outlook.com' }, directory);
assert.equal(calculated.payload.rows[0].workedMinutes, 480, 'upstream rows use clock-derived minutes');
assert.equal(calculated.payload.rows[0].reportedWorkedHours, 99, 'the submitted total remains available for audit');
assert.equal(calculated.payload.rows[0].calculationSource, 'clock interval');

const projected = projectRow({
  kind: 'timesheets', employee_name: 'Ainsley', owner_upn: 'ainsley@gmt-services.co.uk',
  start_date: '2026-09-07', end_date: '2026-09-13', record_date: '2026-09-07',
  action: 'submission', status: 'Submitted', submitted_at: '2026-09-08T07:40:23Z', updated_at: '2026-09-08T07:40:23Z',
  record_id: ainsleySeptember.record_id, source_message_key: 'mailbox-bundle-test',
  source_attachment_ids: JSON.stringify(['attachment-one']), reconciliation_key: 'Ainsley|2026-09-07|test',
  source_variant_status: 'authoritative', reconciled_at: '2026-09-16T09:00:00Z', payload_json: JSON.stringify(ainsleySeptember.payload)
}, true, directory);
assert.equal(projected.reconciliation.variant_status, 'authoritative');
assert.deepEqual(projected.reconciliation.source_attachment_ids, ['attachment-one']);
assert.equal(projected.daily_rows_count, 5);

console.log('Historical mailbox reconciliation: source preservation, daily alignment, variant retention and clock-derived totals: PASS');
