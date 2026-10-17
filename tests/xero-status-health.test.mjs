import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import worker, { encryptXeroSecret, xeroSettings } from '../cloudflare-worker/src/index.js';

globalThis.crypto ??= webcrypto;

const testTenant = 'entra-test-tenant';
const audience = 'gmt-portal-test-audience';
const keyPair = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256'
}, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'xero-health-test';
publicJwk.use = 'sig';

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

const header = encode({ alg: 'RS256', typ: 'JWT', kid: publicJwk.kid });
const payload = encode({
  aud: audience,
  tid: testTenant,
  iss: `https://login.microsoftonline.com/${testTenant}/v2.0`,
  exp: Math.floor(Date.now() / 1000) + 3600,
  oid: 'accounts-test-oid',
  preferred_username: 'accounts@gmt-services.co.uk',
  name: 'GMT Accounts Test'
});
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
const bearer = `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;

const key = Buffer.alloc(32, 19).toString('base64url');
const settings = {
  ENTRA_TENANT_ID: testTenant,
  ENTRA_AUDIENCES: audience,
  XERO_ADMIN_UPNS: 'accounts@gmt-services.co.uk',
  XERO_CLIENT_ID: 'test-xero-client',
  XERO_CLIENT_SECRET: 'test-xero-secret',
  XERO_REDIRECT_URI: 'https://portal.example.test/api/xero/callback',
  XERO_TOKEN_ENCRYPTION_KEY: key,
  XERO_API_URL: 'https://api.xero.test',
  XERO_TOKEN_URL: 'https://identity.xero.test/token',
  ALLOWED_ORIGINS: 'https://gmt-services.co.uk'
};
const encrypted = await encryptXeroSecret('refresh-token-secret', xeroSettings(settings));

function testDb() {
  const connection = {
    tenant_id: 'xero-tenant-1',
    connection_id: 'xero-connection-1',
    tenant_name: 'Saved GMT Name',
    tenant_type: 'ORGANISATION',
    scopes: 'openid profile email offline_access accounting.invoices accounting.contacts accounting.settings',
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_iv: encrypted.iv,
    connected_by_upn: 'accounts@gmt-services.co.uk',
    connected_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-10T10:00:00.000Z',
    last_error: null
  };
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const statement = {
        async all() { return { results: [{ ...connection }] }; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        bind(...values) {
          statements.push({ sql, values });
          return { all: statement.all, run: statement.run };
        }
      };
      return statement;
    }
  };
}

async function runStatus(mode) {
  const DB = testDb();
  const env = { ...settings, DB };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET' });
    if (url.includes('/discovery/v2.0/keys')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === settings.XERO_TOKEN_URL) {
      if (mode === 'invalid-grant') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token was already used' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'next-refresh-token', expires_in: 1800 }), { status: 200 });
    }
    if (url === `${settings.XERO_API_URL}/connections`) {
      if (mode === 'connections-unavailable') return new Response(JSON.stringify({ Message: 'Temporary Xero outage' }), { status: 503 });
      const tenantId = mode === 'tenant-mismatch' ? 'another-xero-tenant' : 'xero-tenant-1';
      return new Response(JSON.stringify([{ id: 'xero-connection-1', tenantId, tenantName: 'GMT Electrical Services Ltd', tenantType: 'ORGANISATION' }]), { status: 200 });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://gmt-services.co.uk/api/xero/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, Origin: 'https://gmt-services.co.uk' }
    }), env);
    return { response, body: await response.json(), calls, statements: DB.statements };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('reports healthy status only for a live matching tenant', async () => {
  const { response, body, calls } = await runStatus('healthy');
  assert.equal(response.status, 200);
  assert.equal(body.connections[0].refresh_health, 'healthy');
  assert.equal(body.connections[0].identity_status, 'verified');
  assert.equal(body.connections[0].tenant_id, 'xero-tenant-1');
  assert.equal(body.connections[0].tenant_name, 'GMT Electrical Services Ltd');
  assert.ok(body.connections[0].checked_at);
  assert.ok(calls.some((call) => call.url === settings.XERO_TOKEN_URL && call.method === 'POST'));
  assert.ok(calls.some((call) => call.url === `${settings.XERO_API_URL}/connections` && call.method === 'GET'));
  assert.equal(calls.some((call) => /\/Invoices(?:\?|\/|$)/.test(call.url)), false, 'health checks never call invoice mutation or list routes');
  assert.deepEqual(body.scopes, settings.XERO_SCOPES ? settings.XERO_SCOPES.split(/\s+/) : [
    'openid', 'profile', 'email', 'offline_access', 'accounting.invoices', 'accounting.contacts', 'accounting.settings'
  ]);
});

test('reports reconnect required after invalid grant', async () => {
  const { body, calls } = await runStatus('invalid-grant');
  assert.equal(body.connections[0].refresh_health, 'reconnect_required');
  assert.equal(body.connections[0].identity_status, 'unverified');
  assert.equal(calls.some((call) => call.url === `${settings.XERO_API_URL}/connections`), false);
});

test('keeps a transient Connections failure distinct from reconnect', async () => {
  const { body } = await runStatus('connections-unavailable');
  assert.equal(body.connections[0].refresh_health, 'unavailable');
  assert.equal(body.connections[0].identity_status, 'unverified');
  assert.match(body.connections[0].health_error, /temporarily|unavailable/i);
});

test('reports a tenant mismatch instead of trusting the saved tenant name', async () => {
  const { body } = await runStatus('tenant-mismatch');
  assert.equal(body.connections[0].refresh_health, 'healthy');
  assert.equal(body.connections[0].identity_status, 'mismatch');
});

test('never returns token material in the status response', async () => {
  const { body } = await runStatus('healthy');
  const serialized = JSON.stringify(body);
  for (const secret of ['refresh-token-secret', 'next-refresh-token', 'test-access-token', encrypted.ciphertext]) {
    assert.equal(serialized.includes(secret), false);
  }
});

