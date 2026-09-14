import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decryptXeroSecret,
  encryptXeroSecret,
  xeroInvoiceProjection,
  xeroSettings
} from '../cloudflare-worker/src/index.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const [worker, migration, page, portal, api, readme] = await Promise.all([
  readFile(resolve(root, 'cloudflare-worker/src/index.js'), 'utf8'),
  readFile(resolve(root, 'cloudflare-worker/migrations/0002_xero.sql'), 'utf8'),
  readFile(resolve(root, 'jobs/index.html'), 'utf8'),
  readFile(resolve(root, 'portal.js'), 'utf8'),
  readFile(resolve(root, 'portal-api.js'), 'utf8'),
  readFile(resolve(root, 'cloudflare-worker/README.md'), 'utf8')
]);

assert.match(worker, /\/api\/xero\/connect/);
assert.match(worker, /\/api\/xero\/callback/);
assert.match(worker, /\/api\/xero\/invoices\/lookup/);
assert.match(worker, /xeroJobSyncMatch/);
assert.match(worker, /accounting\.invoices\.read/);
assert.match(worker, /xero-tenant-id/);
assert.match(worker, /refresh_token_ciphertext/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS xero_oauth_states/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS xero_connections/);
assert.match(page, /id="xero-account-panel"/);
assert.match(page, /id="xero-account-panel"[^>]*hidden[^>]*aria-hidden="true"/);
assert.match(portal, /data-job-xero-sync/);
assert.match(portal, /!meta\.is_admin/);
assert.match(portal, /panel\.setAttribute\('aria-hidden', 'true'\)/);
assert.match(api, /function xeroConnect/);
assert.match(api, /function xeroSyncJobCard/);
assert.doesNotMatch(page, /XERO_CLIENT_SECRET|refresh_token/i);

const key = Buffer.alloc(32, 7).toString('base64url');
const settings = xeroSettings({
  XERO_CLIENT_ID: 'client-id',
  XERO_CLIENT_SECRET: 'client-secret',
  XERO_REDIRECT_URI: 'https://gmt-portal-api.example.workers.dev/api/xero/callback',
  XERO_TOKEN_ENCRYPTION_KEY: key,
  XERO_POST_CONNECT_REDIRECT: 'https://gmt-services.co.uk/jobs/?xero=connected',
  ALLOWED_ORIGINS: 'https://gmt-services.co.uk'
});
assert.equal(settings.configured, true);
const encrypted = await encryptXeroSecret('rotating-refresh-token', settings);
assert.notEqual(encrypted.ciphertext, 'rotating-refresh-token');
assert.equal(await decryptXeroSecret(encrypted.ciphertext, encrypted.iv, settings), 'rotating-refresh-token');

const projected = xeroInvoiceProjection({
  InvoiceID: 'invoice-id',
  InvoiceNumber: 'INV-1001',
  Status: 'AUTHORISED',
  Type: 'ACCREC',
  Contact: { Name: 'GMT customer' },
  Total: 1250.5,
  AmountDue: 500.25,
  CurrencyCode: 'GBP',
  Url: 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=invoice-id'
});
assert.equal(projected.invoice_number, 'INV-1001');
assert.equal(projected.status, 'AUTHORISED');
assert.equal(projected.total, 1250.5);
assert.equal(projected.amount_due, 500.25);
assert.equal(projected.currency, 'GBP');

console.log('Xero OAuth, encrypted-token, Accounts UI, and invoice-link contract: PASS');
