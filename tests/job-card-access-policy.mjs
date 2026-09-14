import assert from 'node:assert/strict';
import {
  canAccessRecord,
  canViewAllRecords,
  listRecords,
  projectRow,
  tokenIdentity
} from '../cloudflare-worker/src/index.js';

const employee = { oid: 'engineer-oid', upn: 'engineer@gmt-services.co.uk', isAdmin: false, isJobCardAdmin: false };
const jobCardAdmin = { oid: 'info-oid', upn: 'info@gmt-services.co.uk', isAdmin: false, isJobCardAdmin: true };
const accountsAdmin = { oid: 'accounts-oid', upn: 'acc.gmtelect@gmt-services.co.uk', isAdmin: true, isJobCardAdmin: true };

const identityFromInfoToken = tokenIdentity({
  tid: 'tenant',
  aud: 'portal-client',
  iss: 'https://login.microsoftonline.com/tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 300,
  oid: 'info-oid',
  preferred_username: 'info@gmt-services.co.uk',
  name: 'GMT Info'
}, {
  ENTRA_TENANT_ID: 'tenant',
  ENTRA_AUDIENCES: 'portal-client',
  ADMIN_UPNS: 'acc.gmtelect@gmt-services.co.uk',
  ADMIN_OIDS: '',
  ADMIN_GROUP_IDS: '',
  OPERATIONS_ADMIN_UPNS: 'info@gmt-services.co.uk',
  JOB_CARD_ADMIN_UPNS: 'info@gmt-services.co.uk'
});
assert.equal(identityFromInfoToken.isAdmin, false);
assert.equal(identityFromInfoToken.isOperationsAdmin, true);
assert.equal(identityFromInfoToken.isJobCardAdmin, true);

assert.equal(canViewAllRecords(employee, 'job-cards'), false);
assert.equal(canViewAllRecords(jobCardAdmin, 'job-cards'), true);
assert.equal(canViewAllRecords(jobCardAdmin, 'timesheets'), false);
assert.equal(canViewAllRecords(identityFromInfoToken, 'estimates'), true);
assert.equal(canViewAllRecords(identityFromInfoToken, 'tasks'), true);
assert.equal(canViewAllRecords(identityFromInfoToken, 'timesheets'), false);
assert.equal(canViewAllRecords(accountsAdmin, 'timesheets'), true);

const jobCard = {
  owner_oid: 'engineer-oid',
  owner_upn: 'engineer@gmt-services.co.uk',
  kind: 'job-cards',
  employee_name: 'Engineer',
  start_date: '',
  end_date: '',
  record_date: '2026-09-14',
  action: 'create_request',
  status: 'Assigned',
  submitted_at: '2026-09-14T10:00:00.000Z',
  updated_at: '2026-09-14T11:00:00.000Z',
  issue: '',
  record_id: 'job-GMT-2026-001-abc',
  payload_json: JSON.stringify({
    jobReference: 'GMT-2026-001',
    client: 'Client',
    site: 'Site',
    engineer: 'Engineer',
    plannedDate: '2026-09-14',
    cardType: 'MTA',
    description: 'Repair',
    jobStatus: 'Assigned',
    jobRevision: 2,
    previousRecordId: 'job-GMT-2026-001-old',
    invoiceNumber: 'INV-123',
    xeroReference: 'XERO-123',
    jobEmailUrl: 'https://outlook.office.com/mail/id/123',
    jobEmailMessageId: 'message-123'
  })
};

assert.equal(canAccessRecord(employee, jobCard), true);
assert.equal(canAccessRecord(jobCardAdmin, { ...jobCard, owner_oid: 'other-oid' }), true);
assert.equal(canAccessRecord(jobCardAdmin, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), false);
assert.equal(canAccessRecord(identityFromInfoToken, { ...jobCard, kind: 'estimates', owner_oid: 'other-oid' }), true);
assert.equal(canAccessRecord(identityFromInfoToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), false);
assert.equal(canAccessRecord(accountsAdmin, { ...jobCard, owner_oid: 'other-oid' }), true);

const projected = projectRow(jobCard);
assert.equal(projected.job_ref, 'GMT-2026-001');
assert.equal(projected.card_type, 'MTA');
assert.equal(projected.job_status, 'Assigned');
assert.equal(projected.job_revision, 2);
assert.equal(projected.previous_record_id, 'job-GMT-2026-001-old');
assert.equal(projected.invoice_number, 'INV-123');
assert.equal(projected.xero_reference, 'XERO-123');
assert.equal(projected.job_email_url, 'https://outlook.office.com/mail/id/123');
assert.equal(projected.job_email_message_id, 'message-123');

let historySql = '';
let historyBindings = [];
const historyDb = { prepare(sql) { historySql = sql; return { bind(...values) { historyBindings = values; return { all: async () => ({ results: [] }) }; } }; } };
const operationsHistory = await listRecords(new Request('https://gmt.example/api/history?kind=all'), { DB: historyDb, STAFF_DIRECTORY_JSON: '[]' }, identityFromInfoToken);
assert.equal(operationsHistory.records.length, 0);
assert.match(historySql, /kind NOT IN \('timesheets', 'clock'\) OR r\.owner_oid = \?/);
assert.deepEqual(historyBindings, ['info-oid', 200]);
assert.equal(operationsHistory.meta.is_operations_admin, true);

console.log('Job-card access and projection policy: PASS');
