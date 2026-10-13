import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canAccessRecord,
  canReadHistoryRecord,
  canViewAllRecords,
  canViewRecord,
  listRecords,
  normaliseUpstreamRecord,
  projectRow,
  tokenIdentity,
  upstreamHistoryScope
} from '../cloudflare-worker/src/index.js';

const employee = { oid: 'engineer-oid', upn: 'engineer@gmt-services.co.uk', isAdmin: false, isJobCardAdmin: false };
const jobCardAdmin = { oid: 'info-oid', upn: 'info@gmt-services.co.uk', isAdmin: false, isJobCardAdmin: true };
const accountsAdmin = { oid: 'accounts-oid', upn: 'acc.gmtelect@gmt-services.co.uk', isAdmin: true, isTimesheetViewer: true, isJobCardAdmin: true };
const testTimesheetViewers = [
  'accounts-viewer@example.test',
  'accounts-alias@example.test',
  'accounts-admin@example.test',
  'faith-viewer@example.test',
  'amanda-admin@example.test'
];

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

const wranglerConfig = readFileSync(new URL('../cloudflare-worker/wrangler.toml', import.meta.url), 'utf8');
const wranglerVar = (name) => wranglerConfig.match(new RegExp(`^${name} = "([^"]*)"$`, 'm'))?.[1] || '';
assert.deepEqual(
  testTimesheetViewers.slice().sort(),
  ['accounts-viewer@example.test', 'accounts-alias@example.test', 'accounts-admin@example.test', 'faith-viewer@example.test', 'amanda-admin@example.test'].sort(),
  'fixture covers the five approved all-timesheets identities'
);
assert.equal(wranglerVar('TIMESHEET_VIEWER_UPNS'), '', 'private staff UPNs are set through Cloudflare, not checked into this public repository');
const identityFromAmandaToken = tokenIdentity({
  tid: wranglerVar('ENTRA_TENANT_ID'),
  aud: wranglerVar('ENTRA_AUDIENCES').split(',')[0],
  iss: `https://login.microsoftonline.com/${wranglerVar('ENTRA_TENANT_ID')}/v2.0`,
  exp: Math.floor(Date.now() / 1000) + 300,
  oid: 'amanda-oid',
  preferred_username: 'amanda-admin@example.test',
  name: 'Amanda Brown-Bennett'
}, {
  ENTRA_TENANT_ID: wranglerVar('ENTRA_TENANT_ID'),
  ENTRA_AUDIENCES: wranglerVar('ENTRA_AUDIENCES'),
  ADMIN_UPNS: 'amanda-admin@example.test',
  ADMIN_OIDS: wranglerVar('ADMIN_OIDS'),
  ADMIN_GROUP_IDS: wranglerVar('ADMIN_GROUP_IDS'),
  TIMESHEET_VIEWER_UPNS: testTimesheetViewers.join(','),
  OPERATIONS_ADMIN_UPNS: wranglerVar('OPERATIONS_ADMIN_UPNS'),
  JOB_CARD_ADMIN_UPNS: wranglerVar('JOB_CARD_ADMIN_UPNS')
});
const identityFromMichelleToken = tokenIdentity({
  tid: 'tenant', aud: 'portal-client', iss: 'https://login.microsoftonline.com/tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 300, oid: 'michelle-oid',
  preferred_username: 'micheller.admin@gmt-services.co.uk', name: 'Michelle Reid'
}, {
  ENTRA_TENANT_ID: 'tenant', ENTRA_AUDIENCES: 'portal-client', ADMIN_UPNS: '', ADMIN_OIDS: '', ADMIN_GROUP_IDS: '',
  HR_ADMIN_UPNS: 'micheller.admin@gmt-services.co.uk', TIMESHEET_VIEWER_UPNS: testTimesheetViewers.join(',')
});
const identityFromLidiaToken = tokenIdentity({
  tid: 'tenant', aud: 'portal-client', iss: 'https://login.microsoftonline.com/tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 300, oid: 'lidia-oid',
  preferred_username: 'lidiaa.admin@gmt-services.co.uk', name: 'Lidia Alemayoh'
}, {
  ENTRA_TENANT_ID: 'tenant', ENTRA_AUDIENCES: 'portal-client', ADMIN_UPNS: '', ADMIN_OIDS: '', ADMIN_GROUP_IDS: '',
  HR_ADMIN_UPNS: 'lidiaa.admin@gmt-services.co.uk', TIMESHEET_VIEWER_UPNS: testTimesheetViewers.join(',')
});
const identityFromFaithToken = tokenIdentity({
  tid: 'tenant', aud: 'portal-client', iss: 'https://login.microsoftonline.com/tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 300, oid: 'faith-oid',
  preferred_username: 'faith-viewer@example.test', name: 'Faith'
}, {
  ENTRA_TENANT_ID: 'tenant', ENTRA_AUDIENCES: 'portal-client', ADMIN_UPNS: '', ADMIN_OIDS: '', ADMIN_GROUP_IDS: '',
  TIMESHEET_VIEWER_UPNS: testTimesheetViewers.join(',')
});
const identityFromAccountsToken = tokenIdentity({
  tid: 'tenant', aud: 'portal-client', iss: 'https://login.microsoftonline.com/tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 300, oid: 'accounts-oid',
  preferred_username: 'accounts-viewer@example.test', name: 'Accounts'
}, {
  ENTRA_TENANT_ID: 'tenant', ENTRA_AUDIENCES: 'portal-client', ADMIN_UPNS: '', ADMIN_OIDS: '', ADMIN_GROUP_IDS: '',
  TIMESHEET_VIEWER_UPNS: testTimesheetViewers.join(',')
});
const identityFromAccGmtToken = tokenIdentity({
  tid: 'tenant', aud: 'portal-client', iss: 'https://login.microsoftonline.com/tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 300, oid: 'accounts-acc-oid',
  preferred_username: 'accounts-alias@example.test', name: 'Accounts GMT'
}, {
  ENTRA_TENANT_ID: 'tenant', ENTRA_AUDIENCES: 'portal-client', ADMIN_UPNS: '', ADMIN_OIDS: '', ADMIN_GROUP_IDS: '',
  TIMESHEET_VIEWER_UPNS: testTimesheetViewers.join(',')
});
assert.equal(identityFromInfoToken.isAdmin, false);
assert.equal(identityFromInfoToken.isOperationsAdmin, true);
assert.equal(identityFromInfoToken.isJobCardAdmin, true);
assert.equal(identityFromAmandaToken.isAdmin, true, 'Amanda can access all authenticated portal pages and admin records');
assert.equal(identityFromAmandaToken.isTimesheetViewer, true, 'Amanda is explicitly permitted to see all staff timesheets');
assert.equal(identityFromAmandaToken.isOperationsAdmin, true);
assert.equal(identityFromAmandaToken.isJobCardAdmin, true, 'the configured job-card role recognizes Amanda’s tenant identity');
assert.equal(identityFromMichelleToken.isHrAdmin, true, 'Michelle retains HR access');
assert.equal(identityFromMichelleToken.isTimesheetViewer, false, 'HR does not grant access to all staff timesheets');
assert.equal(identityFromLidiaToken.isHrAdmin, true);
assert.equal(identityFromLidiaToken.isTimesheetViewer, false);
assert.equal(identityFromFaithToken.isAdmin, false, 'Faith receives no broad administrator role');
assert.equal(identityFromFaithToken.isTimesheetViewer, true, 'Faith receives only the configured all-timesheets viewer permission');
assert.equal(identityFromAccountsToken.isTimesheetViewer, true, 'the Accounts mailbox can see all employee timesheets');
assert.equal(identityFromAccGmtToken.isTimesheetViewer, true, 'the acc.gmtelect mailbox alias can see all employee timesheets');
assert.equal(upstreamHistoryScope(identityFromFaithToken), 'all', 'an allowed timesheet viewer requests the shared source history');
assert.equal(upstreamHistoryScope(identityFromMichelleToken), 'own', 'HR status alone does not broaden the source timesheet query');

assert.equal(canViewAllRecords(employee, 'job-cards'), true, 'all authenticated portal users can read shared job cards');
assert.equal(canViewAllRecords(jobCardAdmin, 'job-cards'), true);
assert.equal(canViewAllRecords(jobCardAdmin, 'timesheets'), false);
assert.equal(canViewAllRecords(identityFromAmandaToken, 'job-cards'), true);
assert.equal(canViewAllRecords(identityFromAmandaToken, 'timesheets'), true, 'Amanda has the all-pages administrator role');
assert.equal(canViewAllRecords(identityFromMichelleToken, 'timesheets'), false);
assert.equal(canViewAllRecords(identityFromLidiaToken, 'timesheets'), false);
assert.equal(canViewAllRecords(identityFromMichelleToken, 'clock'), false);
assert.equal(canViewAllRecords(identityFromMichelleToken, 'calendar'), true, 'HR can still see shared calendar requests');
assert.equal(canViewAllRecords(identityFromFaithToken, 'timesheets'), true);
assert.equal(canViewAllRecords(identityFromFaithToken, 'calendar'), false);
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
assert.equal(canAccessRecord(identityFromAmandaToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), true);
assert.equal(canAccessRecord(identityFromMichelleToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), false);
assert.equal(canAccessRecord(identityFromMichelleToken, { ...jobCard, kind: 'timesheets', owner_oid: 'michelle-oid' }), true);
assert.equal(canAccessRecord(identityFromLidiaToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), false);
assert.equal(canAccessRecord(identityFromFaithToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), false, 'Faith can read all timesheets but cannot edit another employee’s record');
assert.equal(canViewRecord(identityFromFaithToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), true);
assert.equal(canAccessRecord(identityFromAmandaToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), true, 'the authorised Accounts administrator retains correction access');
assert.equal(canAccessRecord(identityFromAccGmtToken, { ...jobCard, kind: 'timesheets', owner_oid: 'other-oid' }), false, 'the alternate Accounts viewer stays read-only');
assert.equal(canAccessRecord(accountsAdmin, { ...jobCard, owner_oid: 'other-oid' }), true);
assert.equal(canReadHistoryRecord(identityFromFaithToken, { kind: 'timesheets', employee_upn: 'matthew@gmt-services.co.uk' }), true);
assert.equal(canReadHistoryRecord(identityFromFaithToken, { kind: 'tasks', employee_upn: 'matthew@gmt-services.co.uk' }), false, 'timesheet-viewer scope does not widen upstream task access');
assert.equal(canReadHistoryRecord(identityFromMichelleToken, { kind: 'timesheets', employee_upn: 'matthew@gmt-services.co.uk' }), false);
assert.equal(canReadHistoryRecord(identityFromMichelleToken, { kind: 'calendar', employee_upn: 'matthew@gmt-services.co.uk' }), true, 'HR retains shared calendar-request access');
assert.equal(canReadHistoryRecord(identityFromFaithToken, { kind: 'job-cards', employee_upn: 'matthew@gmt-services.co.uk' }), true, 'job cards remain shared across staff');
const unidentifiedUpstreamRow = normaliseUpstreamRecord({ Title: 'Weekly submission Week 2026-10-05', kind: 'timesheets' }, identityFromFaithToken, { STAFF_DIRECTORY_JSON: '[]' });
assert.equal(unidentifiedUpstreamRow.employee_upn, '', 'unidentified upstream rows are not implicitly assigned to a timesheet viewer');
assert.equal(canReadHistoryRecord(identityFromMichelleToken, unidentifiedUpstreamRow), false, 'an unidentified row does not become Michelle’s own timesheet');

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
assert.match(historySql, /kind NOT IN \('timesheets', 'clock'\).*owner_oid = \?/);
assert.deepEqual(historyBindings, ['info-oid', 'info@gmt-services.co.uk', 200]);
assert.equal(operationsHistory.meta.is_operations_admin, true);

const michelleHistory = await listRecords(new Request('https://gmt.example/api/history?kind=all'), { DB: historyDb, STAFF_DIRECTORY_JSON: '[]' }, identityFromMichelleToken);
assert.match(historySql, /r\.kind = 'calendar' OR \(r\.owner_oid = \?/);
assert.doesNotMatch(historySql, /r\.kind IN \('timesheets', 'clock', 'calendar'\)/);
assert.deepEqual(historyBindings, ['michelle-oid', 'micheller.admin@gmt-services.co.uk', 200]);
assert.equal(michelleHistory.meta.completion, null, 'HR does not receive an all-staff timesheet completeness roster');
assert.equal(michelleHistory.meta.can_view_all_timesheets, false);

const adminWithoutTimesheetScope = { ...identityFromAmandaToken, isTimesheetViewer: false };
const restrictedAdminHistory = await listRecords(new Request('https://gmt.example/api/history?kind=all'), { DB: historyDb, STAFF_DIRECTORY_JSON: '[]' }, adminWithoutTimesheetScope);
assert.match(historySql, /r\.kind NOT IN \('timesheets', 'clock'\) OR \(r\.owner_oid = \?/);
assert.deepEqual(historyBindings, ['amanda-oid', 'amanda-admin@example.test', 200]);
assert.equal(restrictedAdminHistory.meta.can_view_all_timesheets, false);

const faithHistory = await listRecords(new Request('https://gmt.example/api/history?kind=all'), { DB: historyDb, STAFF_DIRECTORY_JSON: '[]' }, identityFromFaithToken);
assert.match(historySql, /r\.kind IN \('timesheets', 'clock'\) OR \(r\.owner_oid = \?/);
assert.match(historySql, /r\.kind IN \('job-cards'\)/);
assert.deepEqual(historyBindings, ['faith-oid', 'faith-viewer@example.test', 200]);
assert.equal(faithHistory.meta.can_view_all_timesheets, true);

console.log('Job-card access and projection policy: PASS');
