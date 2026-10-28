import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../portal/404-auth.js', import.meta.url), 'utf8');
async function check({ remembered = 'account', account = { homeAccountId: 'account', tenantId: 'tenant' }, token = 'valid', response = true } = {}) {
  const link = { hidden: true };
  let requests = 0;
  class Client {
    async initialize() {}
    getActiveAccount() { return account; }
    async acquireTokenSilent() { if (!token) throw new Error('interaction required'); return { idToken: token }; }
  }
  const context = {
    window: { GMT_APP_CONFIG: { entraSpaAuth: { enabled: true, tenantId: 'tenant', clientId: 'client', redirectPath: '/portal/', allowedGroupIds: [] }, portalApiEndpoint: 'https://example.invalid', portalApiScopes: ['openid'] }, msal: { PublicClientApplication: Client }, location: { origin: 'https://example.invalid' } },
    document: { getElementById: () => link },
    sessionStorage: { getItem: () => remembered },
    fetch: async () => { requests++; return { ok: response }; }
  };
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { visible: !link.hidden, requests };
}
assert.equal((await check()).visible, true);
assert.equal((await check({ remembered: '' })).visible, false);
assert.equal((await check({ account: { homeAccountId: 'other', tenantId: 'tenant' } })).visible, false);
assert.equal((await check({ account: { homeAccountId: 'account', tenantId: 'other' } })).visible, false);
assert.equal((await check({ token: '' })).visible, false);
assert.equal((await check({ response: false })).visible, false);
console.log('Staff 404 authentication visibility: PASS');
