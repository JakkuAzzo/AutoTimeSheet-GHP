import assert from 'node:assert/strict';
import { encryptXeroSecret, listXeroInvoices } from '../cloudflare-worker/src/index.js';

const settings = {
  XERO_CLIENT_ID: 'test-xero-client', XERO_CLIENT_SECRET: 'test-xero-secret',
  XERO_REDIRECT_URI: 'https://portal.example.test/callback',
  XERO_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
  encryptionKey: Buffer.alloc(32, 7).toString('base64url'),
  XERO_API_URL: 'https://api.xero.test', XERO_TOKEN_URL: 'https://identity.xero.test/token',
  ENTRA_TENANT_ID: 'tenant', SHAREPOINT_GRAPH_CLIENT_ID: 'graph-client',
  SHAREPOINT_GRAPH_CLIENT_SECRET: 'graph-secret', SHAREPOINT_SITE_ID: 'site-id',
  SHAREPOINT_DRIVE_ID: 'drive-id'
};
const encrypted = await encryptXeroSecret('refresh-token-1', settings);
const connection = {
  tenant_id: 'xero-tenant-1', tenant_name: 'GMT Electrical Services Ltd',
  refresh_token_ciphertext: encrypted.ciphertext, refresh_token_iv: encrypted.iv,
  scopes: 'accounting.invoices'
};
const db = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() { return { ...connection, tenant_id: values[0] || connection.tenant_id }; },
          async all() { return { results: [{ ...connection, tenant_id: values[0] || connection.tenant_id }] }; },
          async run() { return { success: true }; }
        };
      }
    };
  }
};
const env = { ...settings, DB: db };
const originalFetch = globalThis.fetch;
const cachedPages = new Map();
let xeroReads = 0;
let uploadCount = 0;
let graphTokenCount = 0;
let failArchiveRead = false;
let failArchiveWrite = false;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === settings.XERO_TOKEN_URL) {
    return new Response(JSON.stringify({ access_token: 'xero-access', refresh_token: 'refresh-token-2', expires_in: 1800 }), { status: 200 });
  }
  if (url === 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token') {
    graphTokenCount += 1;
    return new Response(JSON.stringify({ access_token: 'graph-access', expires_in: 3600 }), { status: 200 });
  }
  if (url.includes('/api.xro/2.0/Invoices?')) {
    xeroReads += 1;
    const page = Number(new URL(url).searchParams.get('page'));
    const invoices = page === 1 ? [{ InvoiceID: 'invoice-1', InvoiceNumber: 'INV-1', Status: 'AUTHORISED', Type: 'ACCREC', Contact: { Name: 'Acme' }, Total: 42 }] : [];
    return new Response(JSON.stringify({ Invoices: invoices }), { status: 200 });
  }
  if (url.includes('graph.microsoft.com')) {
    const match = url.match(/\/root:\/(?:[^:]+):(?:\/content)?(?:\?.*)?$/);
    const cacheKey = url.includes('/content') ? url.slice(url.indexOf('/root:/') + 7).replace(/:\/content.*$/, '') : '';
    if (init.method === 'PUT' && url.includes('/content')) {
      uploadCount += 1;
      if (failArchiveWrite) return new Response('write unavailable', { status: 503 });
      cachedPages.set(cacheKey, JSON.parse(init.body));
      return new Response(JSON.stringify({ id: `file-${uploadCount}` }), { status: 201 });
    }
    if (url.includes('/content')) {
      if (failArchiveRead) return new Response('unavailable', { status: 503 });
      const found = cachedPages.get(cacheKey);
      return found ? new Response(JSON.stringify(found), { status: 200 }) : new Response('', { status: 404 });
    }
    if (url.includes('/root:/Invoices')) {
      const path = url.slice(url.indexOf('/root:/') + 7).replace(/\?.*$/, '');
      const depth = path.split(':')[0].split('/').length;
      if (path === 'Invoices') return new Response(JSON.stringify({ id: 'invoices', folder: {} }), { status: 200 });
      if (init.method === 'POST') return new Response(JSON.stringify({ id: `folder-${depth}`, folder: {} }), { status: 201 });
      return new Response('', { status: 404 });
    }
    if (url.includes('/root/children')) return new Response(JSON.stringify({ id: 'folder-root', folder: {} }), { status: 201 });
    return new Response('', { status: 404 });
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

try {
  const first = await listXeroInvoices(env, connection.tenant_id, { limit: 100, page: 1 });
  assert.equal(first.invoices.length, 1);
  assert.deepEqual(first.archive, { source: 'xero', stored: true, cached_at: first.archive.cached_at });
  assert.equal(xeroReads, 1, 'cache miss reads Xero once');
  assert.equal(uploadCount, 1, 'cache miss stores a SharePoint page');

  const cached = await listXeroInvoices(env, connection.tenant_id, { limit: 100, page: 1 });
  assert.equal(cached.archive.source, 'sharepoint');
  assert.equal(cached.archive.stored, true);
  assert.deepEqual(cached.invoices, first.invoices);
  assert.equal(xeroReads, 1, 'archived historical page does not call Xero again');

  const emptyFirstRead = await listXeroInvoices(env, connection.tenant_id, { limit: 100, page: 2 });
  assert.deepEqual(emptyFirstRead.invoices, []);
  assert.equal(emptyFirstRead.archive.source, 'xero');
  const readsAfterEmptyMiss = xeroReads;
  const emptyCachedRead = await listXeroInvoices(env, connection.tenant_id, { limit: 100, page: 2 });
  assert.deepEqual(emptyCachedRead.invoices, []);
  assert.equal(emptyCachedRead.archive.source, 'sharepoint');
  assert.equal(xeroReads, readsAfterEmptyMiss, 'empty pages are archived to prevent repeated Xero calls');

  const otherTenant = await listXeroInvoices(env, 'xero-tenant-2', { limit: 100, page: 1 });
  assert.equal(otherTenant.archive.source, 'xero', 'a different Xero tenant uses a different SharePoint path');
  assert.equal(otherTenant.tenant.tenant_id, 'xero-tenant-2');

  const refreshed = await listXeroInvoices(env, connection.tenant_id, { limit: 100, page: 1, refresh: true });
  assert.equal(refreshed.archive.source, 'xero');
  assert.equal(uploadCount, 4, 'explicit refresh replaces the archived page');
  assert.equal(xeroReads, 4);

  failArchiveWrite = true;
  const liveButUnarchived = await listXeroInvoices(env, connection.tenant_id, { limit: 100, page: 3, refresh: true });
  assert.equal(liveButUnarchived.archive.source, 'xero');
  assert.equal(liveButUnarchived.archive.stored, false, 'failed SharePoint writes are visible in archive metadata');
  assert.deepEqual(liveButUnarchived.invoices, [], 'a failed archive write does not discard live Xero results');
  failArchiveWrite = false;

  failArchiveRead = true;
  await assert.rejects(() => listXeroInvoices(env, connection.tenant_id, { limit: 100, page: 1 }), (error) => error.status === 503,
    'SharePoint errors do not appear as cache misses or silently call Xero');
  assert.equal(xeroReads, 5);
} finally {
  globalThis.fetch = originalFetch;
}
