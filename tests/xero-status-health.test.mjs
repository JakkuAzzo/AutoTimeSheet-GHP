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

function testDb(rows = [connection]) {
  const connections = rows.map((row) => ({ ...row }));
  const statements = [];
  const locks = new Map();
  function execute(sql, values, priorChanges = 1) {
    if (sql.startsWith('INSERT INTO xero_refresh_locks')) {
      const [tokenHash, leaseId, leaseExpiresAt, timestamp] = values;
      const current = locks.get(tokenHash);
      if (!current || current.lease_expires_at <= timestamp) {
        locks.set(tokenHash, { lease_id: leaseId, lease_expires_at: leaseExpiresAt });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (sql.startsWith('DELETE FROM xero_refresh_locks')) {
      const [tokenHash, leaseId] = values;
      if (locks.get(tokenHash)?.lease_id === leaseId) {
        locks.delete(tokenHash);
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (sql.startsWith('UPDATE xero_refresh_locks')) {
      const [, tokenHash, leaseId] = values;
      if (priorChanges !== 1 || locks.get(tokenHash)?.lease_id !== leaseId) throw new Error('Refresh token rotation batch assertion failed');
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE xero_connections SET refresh_token_ciphertext')) {
      const [ciphertext, iv, scopes, updatedAt, tenantId, previousCiphertext, previousIv] = values;
      const row = connections.find((item) => item.tenant_id === tenantId);
      if (!row || row.refresh_token_ciphertext !== previousCiphertext || row.refresh_token_iv !== previousIv) {
        return { success: true, meta: { changes: 0 } };
      }
      Object.assign(row, { refresh_token_ciphertext: ciphertext, refresh_token_iv: iv, scopes, updated_at: updatedAt, last_error: null });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE xero_connections SET last_error')) return { success: true, meta: { changes: 1 } };
    return { success: true, meta: { changes: 1 } };
  }
  return {
    statements,
    connections,
    prepare(sql) {
      const statement = {
        async all() { return { results: connections.map((row) => ({ ...row })) }; },
        async first() { return null; },
        bind(...values) {
          statements.push({ sql, values });
          return {
            sql,
            values,
            async all() { return { results: connections.map((row) => ({ ...row })) }; },
            async first() {
              if (!sql.startsWith('SELECT * FROM xero_connections WHERE tenant_id')) return null;
              const row = connections.find((item) => item.tenant_id === values[0]);
              return row ? { ...row } : null;
            },
            async run() { return execute(sql, values); }
          };
        }
      };
      return statement;
    },
    async batch(batchStatements) {
      const previousConnections = connections.map((row) => ({ ...row }));
      const previousLocks = new Map(locks);
      const results = [];
      let previousChanges = 1;
      try {
        for (const statement of batchStatements) {
          const result = execute(statement.sql, statement.values, previousChanges);
          previousChanges = Number(result.meta?.changes || 0);
          results.push(result);
        }
        return results;
      } catch (error) {
        connections.splice(0, connections.length, ...previousConnections);
        locks.clear();
        for (const [key, value] of previousLocks) locks.set(key, value);
        throw error;
      }
    }
  };
}

async function runStatus(mode, rows = [connection], requestCount = 1) {
  const DB = testDb(rows);
  const env = { ...settings, DB };
  const calls = [];
  let tokenRefreshCount = 0;
  let activeRefreshes = 0;
  let maxConcurrentRefreshes = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET' });
    if (url.includes('/discovery/v2.0/keys')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === settings.XERO_TOKEN_URL) {
      if (mode === 'invalid-grant') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token was already used' }), { status: 400 });
      tokenRefreshCount += 1;
      if (mode === 'shared-token' && tokenRefreshCount > 1) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token was already used' }), { status: 400 });
      if (mode === 'missing-refresh-token') return new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 1800 }), { status: 200 });
      if (mode === 'concurrent') {
        const refreshToken = new URLSearchParams(init.body).get('refresh_token');
        activeRefreshes += 1;
        maxConcurrentRefreshes = Math.max(maxConcurrentRefreshes, activeRefreshes);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeRefreshes -= 1;
        if (refreshToken !== 'refresh-token-secret' && refreshToken !== 'next-refresh-token') {
          return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token was already used' }), { status: 400 });
        }
        const nextToken = refreshToken === 'refresh-token-secret' ? 'next-refresh-token' : 'last-refresh-token';
        return new Response(JSON.stringify({ access_token: `access-${tokenRefreshCount}`, refresh_token: nextToken, expires_in: 1800 }), { status: 200 });
      }
      return new Response(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'next-refresh-token', expires_in: 1800 }), { status: 200 });
    }
    if (url === `${settings.XERO_API_URL}/connections`) {
      if (mode === 'connections-unavailable') return new Response(JSON.stringify({ Message: 'Temporary Xero outage' }), { status: 503 });
      const liveConnections = mode === 'shared-token'
        ? rows.map((row) => ({ id: row.connection_id, tenantId: row.tenant_id, tenantName: row.tenant_name, tenantType: row.tenant_type }))
        : [{ id: 'xero-connection-1', tenantId: mode === 'tenant-mismatch' ? 'another-xero-tenant' : 'xero-tenant-1', tenantName: 'GMT Electrical Services Ltd', tenantType: 'ORGANISATION' }];
      return new Response(JSON.stringify(liveConnections), { status: 200 });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };
  try {
    const requests = Array.from({ length: requestCount }, () => worker.fetch(new Request('https://gmt-services.co.uk/api/xero/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, Origin: 'https://gmt-services.co.uk' }
    }), env));
    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    return {
      response: responses[0],
      body: bodies[0],
      bodies,
      calls,
      statements: DB.statements,
      storedConnections: DB.connections,
      maxConcurrentRefreshes
    };
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

test('refreshes a shared multi-tenant token once and persists its rotation to every tenant row', async () => {
  const rows = [
    { ...connection },
    { ...connection, tenant_id: 'xero-tenant-2', connection_id: 'xero-connection-2', tenant_name: 'GMT Workshop Ltd' }
  ];
  const { body, calls, storedConnections } = await runStatus('shared-token', rows);
  assert.deepEqual(body.connections.map((item) => item.identity_status), ['verified', 'verified']);
  assert.equal(calls.filter((call) => call.url === settings.XERO_TOKEN_URL).length, 1,
    'the shared one-time refresh token is consumed once for all associated tenants');
  assert.ok(storedConnections.every((row) => row.refresh_token_ciphertext !== encrypted.ciphertext),
    'the rotated refresh token is persisted to every tenant row that shared the previous token');
});

test('serializes concurrent status requests that start with the same rotating token', async () => {
  const { bodies, calls, maxConcurrentRefreshes } = await runStatus('concurrent', [connection], 2);
  assert.equal(maxConcurrentRefreshes, 1, 'the D1 refresh lease prevents overlapping uses of the same token');
  assert.equal(calls.filter((call) => call.url === settings.XERO_TOKEN_URL).length, 2,
    'the waiting request reloads the rotated token and refreshes it after the first request completes');
  assert.ok(bodies.every((body) => body.connections[0].identity_status === 'verified'));
  assert.ok(bodies.every((body) => body.connections[0].refresh_health === 'healthy'));
});

test('reports reconnect required after invalid grant', async () => {
  const { body, calls } = await runStatus('invalid-grant');
  assert.equal(body.connections[0].refresh_health, 'reconnect_required');
  assert.equal(body.connections[0].identity_status, 'unverified');
  assert.equal(calls.some((call) => call.url === `${settings.XERO_API_URL}/connections`), false);
});

test('does not persist a refresh response without its replacement refresh token', async () => {
  const { body, storedConnections } = await runStatus('missing-refresh-token');
  assert.equal(body.connections[0].refresh_health, 'unavailable');
  assert.equal(body.connections[0].identity_status, 'unverified');
  assert.equal(storedConnections[0].refresh_token_ciphertext, encrypted.ciphertext);
  assert.equal(storedConnections[0].refresh_token_iv, encrypted.iv);
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

