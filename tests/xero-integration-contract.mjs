import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decryptXeroSecret,
  encryptXeroSecret,
  xeroInvoiceProjection,
  xeroInvoicePayload,
  xeroInvoiceDeliveryStatus,
  xeroInvoicePaymentStatus,
  xeroInvoiceMutationPolicy,
  xeroAccountingRequest,
  xeroSettings
} from '../cloudflare-worker/src/index.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const [worker, migration, page, portal, api, readme, invoicesPage, invoicesUi, invoiceMigration, auth] = await Promise.all([
  readFile(resolve(root, 'cloudflare-worker/src/index.js'), 'utf8'),
  readFile(resolve(root, 'cloudflare-worker/migrations/0002_xero.sql'), 'utf8'),
  readFile(resolve(root, 'jobs/index.html'), 'utf8'),
  readFile(resolve(root, 'portal.js'), 'utf8'),
  readFile(resolve(root, 'portal-api.js'), 'utf8'),
  readFile(resolve(root, 'cloudflare-worker/README.md'), 'utf8'),
  readFile(resolve(root, 'tools/invoices.html'), 'utf8'),
  readFile(resolve(root, 'tools/invoices.js'), 'utf8'),
  readFile(resolve(root, 'cloudflare-worker/migrations/0006_xero_invoice_management.sql'), 'utf8'),
  readFile(resolve(root, 'auth.js'), 'utf8')
]);

assert.match(worker, /\/api\/xero\/connect/);
assert.match(worker, /\/api\/xero\/callback/);
assert.match(worker, /\/api\/xero\/invoices\/lookup/);
assert.match(worker, /xeroJobSyncMatch/);
assert.match(worker, /accounting\.invoices/);
assert.match(worker, /xero-tenant-id/);
assert.match(worker, /refresh_token_ciphertext/);
assert.match(worker, /\/api\/xero\/setup-data/);
assert.match(worker, /xeroInvoiceActionMatch/);
assert.match(worker, /xero_invoice_audit/);
assert.match(worker, /xero_invoice_links/);
assert.match(worker, /xeroInvoiceLinksEndpoint/);
assert.match(worker, /recordInvoiceLinksEndpoint/);
assert.match(worker, /canAccessRecord\(identity, record\)/);
assert.match(worker, /const xeroInvoiceLinksMatch/);
assert.match(worker, /const recordInvoiceLinksMatch/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS xero_oauth_states/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS xero_connections/);
assert.match(page, /id="xero-account-panel"/);
assert.match(page, /id="xero-account-panel"[^>]*hidden[^>]*aria-hidden="true"/);
assert.match(portal, /data-job-xero-sync/);
assert.match(portal, /!meta\.is_admin/);
assert.match(portal, /panel\.setAttribute\('aria-hidden', 'true'\)/);
assert.match(api, /function xeroConnect/);
assert.match(api, /function xeroSyncJobCard/);
assert.match(api, /function xeroCreateInvoice/);
assert.match(api, /function xeroUpdateInvoice/);
assert.match(api, /function xeroDeleteInvoice/);
assert.match(api, /function xeroLinkInvoice/);
assert.match(api, /function xeroInvoiceLinks/);
assert.match(api, /function recordInvoiceLinks/);
assert.match(invoicesPage, /id="xero-invoice-editor"/);
assert.match(invoicesPage, /id="xero-create-invoice"/);
assert.match(invoicesPage, /id="xero-invoice-links"/);
assert.match(invoicesPage, /<main id="xero-invoice-main"[^>]*hidden[^>]*data-xero-accounts-gated/);
assert.match(invoicesPage, /id="xero-access-gate"/);
assert.match(auth, /data-xero-accounts-gated/);
assert.match(invoicesUi, /xero-invoice-main/);
assert.match(invoicesUi, /Accounts administrator/);
for (const handler of [
  'startXeroConnection', 'xeroStatus', 'xeroSetupDataEndpoint', 'xeroInvoiceRecords',
  'listXeroInvoicesEndpoint', 'lookupXeroInvoiceEndpoint', 'xeroInvoiceDetailEndpoint',
  'createXeroInvoice', 'updateXeroInvoice', 'sendXeroInvoice', 'deleteXeroInvoice',
  'linkXeroInvoice', 'syncXeroJobCard'
]) {
  const start = worker.indexOf(`function ${handler}(`);
  assert.notEqual(start, -1, `${handler} exists`);
  const next = worker.indexOf('\nasync function ', start + 1);
  const body = worker.slice(start, next < 0 ? undefined : next);
  assert.match(body, /requireXeroAdmin\(identity\)/, `${handler} is restricted to Accounts admins`);
}
assert.match(invoicesUi, /Approve and send/);
assert.match(invoicesUi, /Delete draft/);
assert.match(invoiceMigration, /CREATE TABLE IF NOT EXISTS xero_invoice_links/);
assert.match(invoiceMigration, /CREATE TABLE IF NOT EXISTS xero_invoice_audit/);
assert.doesNotMatch(invoicesPage, /XERO_CLIENT_SECRET|refresh_token/i);

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
  AmountPaid: 750.25,
  AmountDue: 500.25,
  SentToContact: true,
  CurrencyCode: 'GBP',
  Url: 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=invoice-id'
});
assert.equal(projected.invoice_number, 'INV-1001');
assert.equal(projected.status, 'AUTHORISED');
assert.equal(projected.total, 1250.5);
assert.equal(projected.amount_due, 500.25);
assert.equal(projected.currency, 'GBP');
assert.equal(projected.delivery_status, 'Sent');
assert.equal(projected.payment_status, 'Part-paid');
assert.equal(xeroInvoiceDeliveryStatus({ Status: 'DRAFT', SentToContact: false }), 'Unsent');
assert.equal(xeroInvoiceDeliveryStatus({ Status: 'DELETED', SentToContact: true }), 'Deleted');
assert.equal(xeroInvoicePaymentStatus({ Status: 'PAID', AmountDue: 0, AmountPaid: 50 }), 'Paid');
assert.equal(xeroInvoiceMutationPolicy({ Status: 'AUTHORISED', AmountPaid: 10 }).canDelete, false);
assert.equal(xeroInvoiceMutationPolicy({ Status: 'AUTHORISED', AmountPaid: 0 }).canDelete, true);
assert.equal(xeroInvoiceMutationPolicy({ Status: 'DRAFT', AmountPaid: 0 }).canEdit, true);
assert.equal(xeroInvoiceMutationPolicy({ Status: 'PAID', AmountPaid: 50 }).canEdit, false);

const prepared = xeroInvoicePayload({
  contactId: 'contact-1', invoiceNumber: 'GMT-101', date: '2026-09-29', dueDate: '2026-10-29',
  reference: 'Job 25', lineAmountTypes: 'Exclusive', lineItems: [
    { description: 'Motor repair', quantity: 2, unitAmount: 100, accountCode: '200', taxType: 'OUTPUT2' }
  ]
});
assert.equal(prepared.Type, 'ACCREC');
assert.equal(prepared.Status, 'DRAFT');
assert.equal(prepared.Contact.ContactID, 'contact-1');
assert.equal(prepared.LineItems[0].Quantity, 2);
assert.equal(prepared.LineItems[0].UnitAmount, 100);
assert.equal(prepared.LineItems[0].AccountCode, '200');

const xeroFetchLog = [];
const encryptedForApi = await encryptXeroSecret('refresh-token-for-test', settings);
const apiEnv = {
  ...settings,
  XERO_CLIENT_ID: 'client-id',
  XERO_CLIENT_SECRET: 'client-secret',
  XERO_REDIRECT_URI: 'https://gmt-portal-api.example.workers.dev/api/xero/callback',
  XERO_TOKEN_ENCRYPTION_KEY: key,
  DB: { prepare(sql) { return { bind() { return { run: async () => ({ success: true }) }; } }; } }
};
const apiResult = await xeroAccountingRequest(apiEnv, {
  tenant_id: 'tenant-test', refresh_token_ciphertext: encryptedForApi.ciphertext, refresh_token_iv: encryptedForApi.iv,
  scopes: 'accounting.invoices', connection_id: 'connection-test'
}, '/Invoices', {
  method: 'POST', body: { Invoices: [prepared] },
  fetchImpl: async (url, options) => {
    xeroFetchLog.push({ url: String(url), options });
    if (String(url).includes('/connect/token')) return new Response(JSON.stringify({ access_token: 'access-token', refresh_token: 'next-refresh-token', expires_in: 1800 }), { status: 200 });
    return new Response(JSON.stringify({ Invoices: [{ InvoiceID: 'created-id', Status: 'DRAFT' }] }), { status: 200 });
  }
});
assert.equal(apiResult.Invoices[0].InvoiceID, 'created-id');
assert.equal(xeroFetchLog.length, 2);
assert.equal(xeroFetchLog[1].options.method, 'POST');
assert.equal(xeroFetchLog[1].options.headers['xero-tenant-id'], 'tenant-test');
assert.equal(JSON.parse(xeroFetchLog[1].options.body).Invoices[0].Contact.ContactID, 'contact-1');
assert.equal(JSON.stringify(xeroFetchLog).includes('refresh-token-for-test'), false);

console.log('Xero OAuth, encrypted-token, Accounts UI, and invoice-link contract: PASS');
