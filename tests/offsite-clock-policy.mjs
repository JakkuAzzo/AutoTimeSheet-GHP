import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tokenIdentity } from '../cloudflare-worker/src/index.js';

const baseClaims = (upn, oid) => ({
  tid: 'synthetic-tenant',
  aud: 'synthetic-portal-client',
  iss: 'https://login.microsoftonline.com/synthetic-tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 300,
  oid,
  preferred_username: upn,
  name: 'TEST Off-site QA'
});

const manager = tokenIdentity(baseClaims('manager@example.test', 'synthetic-manager-oid'), {
  ENTRA_TENANT_ID: 'synthetic-tenant',
  ENTRA_AUDIENCES: 'synthetic-portal-client',
  OFFSITE_DUTY_MANAGER_UPNS: ' other@example.test, MANAGER@example.test '
});
assert.equal(manager.canReviewOffsite, true, 'configured UPN grants only the off-site approval capability');
assert.equal(manager.isAdmin, false, 'off-site approval does not grant full administrator access');
assert.equal(manager.isTimesheetViewer, false, 'off-site approval does not grant shared timesheet visibility');

const administrator = tokenIdentity(baseClaims('admin@example.test', 'synthetic-admin-oid'), {
  ENTRA_TENANT_ID: 'synthetic-tenant',
  ENTRA_AUDIENCES: 'synthetic-portal-client',
  ADMIN_UPNS: 'admin@example.test',
  OFFSITE_DUTY_MANAGER_UPNS: ''
});
assert.equal(administrator.isAdmin, true);
assert.equal(administrator.canReviewOffsite, false, 'administrator status alone does not grant manager approval');

const employee = tokenIdentity(baseClaims('engineer@example.test', 'synthetic-engineer-oid'), {
  ENTRA_TENANT_ID: 'synthetic-tenant',
  ENTRA_AUDIENCES: 'synthetic-portal-client',
  OFFSITE_DUTY_MANAGER_UPNS: ''
});
assert.equal(employee.canReviewOffsite, false, 'unconfigured engineers cannot review off-site entries');

const wrangler = await readFile(new URL('../cloudflare-worker/wrangler.toml', import.meta.url), 'utf8');
assert.match(wrangler, /^OFFSITE_DUTY_MANAGER_UPNS\s*=\s*""\s*$/m, 'the PR ships with no assigned Duty Manager accounts');

console.log('Off-site manager capability is isolated from administrator and timesheet-viewer access.');
