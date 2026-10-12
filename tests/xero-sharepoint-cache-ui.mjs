import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const [page, ui, api] = await Promise.all([
  readFile(resolve(root, 'tools/invoices.html'), 'utf8'),
  readFile(resolve(root, 'tools/invoices.js'), 'utf8'),
  readFile(resolve(root, 'portal-api.js'), 'utf8')
]);

assert.match(page, /Refresh from Xero/);
assert.match(ui, /archive\.source === "sharepoint"/);
assert.match(ui, /archive\.source === "xero"/);
assert.match(ui, /loadInvoices\(true\)/);
assert.match(ui, /Loading invoice history from the SharePoint archive/);
assert.equal((ui.match(/if \(unarchivedPages\)/g) || []).length, 1,
  'archive write failures are reported only where the loader counters exist');
assert.match(api, /function xeroInvoices\(tenantId, limit, page, status, refresh\)/);
assert.match(api, /if \(refresh\) params\.set\("refresh", "1"\)/);
const loader = ui.match(/async function loadInvoices\(refreshFromXero\) \{([\s\S]*?)\n  async function refreshTenantData\(/);
assert.ok(loader, 'invoice loader remains a separate function from connection setup');
assert.doesNotMatch(loader[1], /refreshTenantData\(/, 'loading invoice pages does not recurse into connection setup');

console.log('Xero SharePoint cache UI contract: PASS');
