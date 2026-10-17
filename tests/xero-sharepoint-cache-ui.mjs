import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [page, ui, api] = await Promise.all([
  readFile(resolve(root, 'tools/invoices.html'), 'utf8'),
  readFile(resolve(root, 'tools/invoices.js'), 'utf8'),
  readFile(resolve(root, 'portal-api.js'), 'utf8')
]);

assert.match(page, /Refresh from Xero/);
assert.match(page, /invoice-register-state\.js/);
assert.match(page, /id="xero-invoice-provenance"/);
assert.match(ui, /registerState\.summarizePages\(pages\)/);
assert.match(ui, /Complete register/);
assert.match(ui, /Partial register/);
assert.match(ui, /pagination\.page_limit/);
assert.match(ui, /pagination\.has_more/);
assert.match(ui, /loadInvoices\(true\)/);
assert.match(ui, /Loading invoice history from the SharePoint archive/);
assert.match(ui, /previous complete snapshot is preserved/);
assert.match(ui, /complete && writeInvoiceCache\(pages, all, true\)/,
  'only a complete page walk can replace the tenant-bound browser snapshot');
assert.match(api, /function xeroInvoices\(tenantId, limit, page, status, refresh\)/);
assert.match(api, /if \(refresh\) params\.set\("refresh", "1"\)/);
const loader = ui.match(/async function loadInvoices\(refreshFromXero\) \{([\s\S]*?)\n  async function refreshTenantData\(/);
assert.ok(loader, 'invoice loader remains a separate function from connection setup');
assert.doesNotMatch(loader[1], /refreshTenantData\(/, 'loading invoice pages does not recurse into connection setup');

console.log('Xero SharePoint cache UI contract: PASS');
