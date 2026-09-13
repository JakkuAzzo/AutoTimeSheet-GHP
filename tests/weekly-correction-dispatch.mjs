import assert from 'node:assert/strict';
import { dispatchForm, dispatchQueued, parseQueuedAttachments, shouldDispatchNow } from '../cloudflare-worker/src/index.js';

const enabled = { DISPATCH_ENABLED: 'true', DISPATCH_WEEKDAY: 'Friday', DISPATCH_HOUR: '18', DISPATCH_TIMEZONE: 'Europe/London' };
assert.equal(shouldDispatchNow(new Date('2026-09-11T17:00:00Z'), enabled), true, '18:00 BST is the configured Friday window');
assert.equal(shouldDispatchNow(new Date('2026-01-09T18:00:00Z'), enabled), true, '18:00 GMT is the configured Friday window');
assert.equal(shouldDispatchNow(new Date('2026-09-12T17:00:00Z'), enabled), false, 'Saturday is outside the configured window');
assert.equal(shouldDispatchNow(new Date('2026-09-11T17:00:00Z'), { ...enabled, DISPATCH_ENABLED: 'false' }), false, 'disabled dispatch never runs');

const base64 = (value) => Buffer.from(value).toString('base64');
const attachments = parseQueuedAttachments({
  attachments: [
    { fieldName: 'attachment_record', fileName: 'GMT Timesheet Record - Queue Tester - 2026-09-07.json', contentType: 'application/json', contentBase64: base64('{}') },
    { fieldName: 'attachment', fileName: 'GMT Timesheet - Queue Tester - 2026-09-07.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64: base64('xlsx') },
    { fieldName: 'attachment_csv', fileName: 'GMT Timesheet - Queue Tester - 2026-09-07.csv', contentType: 'text/csv', contentBase64: base64('Date,Hours\n2026-09-07,8') },
    { fieldName: 'attachment_calendar_sync', fileName: 'GMT Calendar Sync - Queue Tester - 2026-09-07.json', contentType: 'application/json', contentBase64: base64('{}') }
  ]
});
assert.equal(attachments.length, 4);

const record = {
  record_id: 'timesheet-queue-tester-2026-09-07',
  employee_name: 'Queue Tester',
  owner_upn: 'queue.tester@gmt-services.co.uk',
  start_date: '2026-09-07',
  end_date: '2026-09-13',
  submitted_at: '2026-09-13T12:00:00.000Z',
  payload_json: JSON.stringify({
    employeeName: 'Queue Tester',
    employeeEmail: 'queue.tester@gmt-services.co.uk',
    employeeUpn: 'queue.tester@gmt-services.co.uk',
    weekStart: '2026-09-07',
    weekEnd: '2026-09-13',
    totals: { workedActual: 480, basic: 480, ot15: 0, ot20: 0 },
    calendarSync: { calendarName: 'GMT Operational Calendar', submittedAt: '2026-09-13T12:00:00.000Z', events: [] }
  })
};
const form = dispatchForm(record, attachments);
assert.equal(form.get('gmt_record_id'), record.record_id);
assert.equal(form.get('gmt_action'), 'correction');
assert.equal(form.get('gmt_workbook_key'), 'timesheet-queue-tester-gmt-services-co-uk-2026-09');
assert.equal(form.get('attachment').name, 'GMT Timesheet - Queue Tester - 2026-09-07.xlsx');
assert.equal(form.get('attachment_csv').name, 'GMT Timesheet - Queue Tester - 2026-09-07.csv');

function mockDb(queueRows, attachmentRows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              calls.push({ method: 'all', sql, args });
              if (/FROM dispatch_queue/i.test(sql)) return { results: queueRows };
              if (/FROM record_attachments/i.test(sql)) return { results: attachmentRows };
              return { results: [] };
            },
            async first() { calls.push({ method: 'first', sql, args }); return null; },
            async run() { calls.push({ method: 'run', sql, args }); return { meta: { changes: 1 } }; }
          };
        }
      };
    },
    async batch(statements) { calls.push({ method: 'batch', count: statements.length }); return statements.map(() => ({ meta: { changes: 1 } })); }
  };
}

const db = mockDb([{ ...record, dispatch_status: 'queued', attempts: 0, next_attempt_at: '2026-09-11T17:00:00.000Z' }], attachments.map((item) => ({
  field_name: item.fieldName,
  file_name: item.fileName,
  content_type: item.contentType,
  content_base64: item.contentBase64,
  size_bytes: item.sizeBytes
})));
let sentForm = null;
const sent = await dispatchQueued({ ...enabled, FORM_SUBMIT_TIMESHEET_ENDPOINT: 'https://formsubmit.co/example', DB: db }, {
  now: '2026-09-11T17:00:00.000Z',
  fetchImpl: async (_url, options) => {
    sentForm = options.body;
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) };
  }
});
assert.equal(sent.sent, 1);
assert.equal(sent.failed, 0);
assert.equal(sentForm.get('gmt_record_id'), record.record_id);
assert.ok(db.calls.some((call) => call.method === 'run' && /status = 'sent'/i.test(call.sql)), 'successful dispatch is marked sent');

const dryRun = await dispatchQueued({ ...enabled, FORM_SUBMIT_TIMESHEET_ENDPOINT: 'https://formsubmit.co/example', DB: mockDb([{ ...record, dispatch_status: 'queued', attempts: 0, next_attempt_at: '2026-09-11T17:00:00.000Z' }], []) }, {
  now: '2026-09-11T17:00:00.000Z',
  dryRun: true
});
assert.equal(dryRun.dryRun, true);
assert.deepEqual(dryRun.records, [{ recordId: record.record_id, status: 'dry-run' }]);

console.log('PASS: correction queue validates attachments, preserves record IDs, dispatches the FormSubmit envelope, and supports a no-send dry run.');
