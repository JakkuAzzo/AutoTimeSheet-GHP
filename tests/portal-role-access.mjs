import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { canReadHistoryRecord, canViewAllRecords, listRecords, tokenIdentity } from '../cloudflare-worker/src/index.js';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const workerConfig = readFileSync(new URL('../cloudflare-worker/wrangler.toml', import.meta.url), 'utf8');
const clientConfig = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../cloudflare-worker/src/index.js', import.meta.url), 'utf8');

function workerVar(name) {
  return workerConfig.match(new RegExp(`^${name} = "([^"]*)"$`, 'm'))?.[1] || '';
}

const directoryJson = workerConfig.match(/^STAFF_DIRECTORY_JSON = '(.*)'$/m)?.[1] || '[]';
const directory = JSON.parse(directoryJson);
const employee = (name) => {
  const match = directory.find((entry) => entry.name.toLowerCase().startsWith(name.toLowerCase()));
  assert.ok(match, `Worker directory contains ${name}`);
  return match;
};

const tenantId = workerVar('ENTRA_TENANT_ID');
const audiences = workerVar('ENTRA_AUDIENCES');
const baseEnv = {
  ENTRA_TENANT_ID: tenantId,
  ENTRA_AUDIENCES: audiences,
  ADMIN_UPNS: '',
  ADMIN_OIDS: '',
  ADMIN_GROUP_IDS: '',
  ADDITIONAL_ADMIN_UPNS: workerVar('ADDITIONAL_ADMIN_UPNS'),
  HR_ADMIN_UPNS: workerVar('HR_ADMIN_UPNS'),
  XERO_ADMIN_UPNS: workerVar('XERO_ADMIN_UPNS')
};

function identityFor(person, env = baseEnv, groups = []) {
  return tokenIdentity({
    tid: tenantId,
    aud: audiences.split(',')[0],
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 300,
    oid: `test-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-oid`,
    preferred_username: person.upn,
    name: person.name,
    groups
  }, env);
}

const faith = identityFor(employee('Faith'));
const amandaGroupId = 'synthetic-existing-admin-group';
const amanda = identityFor(
  { name: 'Amanda', upn: 'amanda-admin@example.test' },
  { ...baseEnv, ADMIN_GROUP_IDS: amandaGroupId },
  [amandaGroupId]
);
const accountsIdentityFixtures = [
  { name: 'Accounts identity one', upn: 'accounts-viewer@example.test' },
  { name: 'Accounts identity two', upn: 'accounts-alias@example.test' }
];
const accountsEnv = { ...baseEnv, ADMIN_UPNS: accountsIdentityFixtures.map((entry) => entry.upn).join(',') };
const accountsIdentities = accountsIdentityFixtures.map((person) => identityFor(person, accountsEnv));
const sourceConfiguredAccounts = baseEnv.ADDITIONAL_ADMIN_UPNS.split(',').filter(Boolean).map((upn) => ({ name: 'Configured Accounts', upn }));
const michelle = identityFor(employee('Michelle'));
const lidia = identityFor(employee('Lidia'));
const ordinaryStaff = identityFor({ name: 'Ordinary staff', upn: 'ordinary.staff@gmt-services.co.uk' });
const operationsAdmin = identityFor(
  { name: 'Operations admin', upn: 'operations.admin@example.test' },
  { ...baseEnv, OPERATIONS_ADMIN_UPNS: 'operations.admin@example.test' }
);

assert.equal(faith.isAdmin, true, 'Faith is a full administrator through verified Worker configuration');
assert.equal(amanda.isAdmin, true, 'Amanda remains a full administrator through the existing Entra group-claim path');
assert.equal(accountsIdentities.length, 2, 'two separate synthetic Accounts claims are covered');
for (const account of accountsIdentities) assert.equal(account.isAdmin, true, `${account.name} claim fixture is a full administrator`);
assert.ok(sourceConfiguredAccounts.length > 0, 'Worker config retains its Accounts admin identity');
for (const account of sourceConfiguredAccounts) assert.equal(identityFor(account).isAdmin, true, 'the source-configured Accounts identity remains a full administrator');

for (const [name, identity] of [['Michelle', michelle], ['Lidia', lidia]]) {
  assert.equal(identity.isHrAdmin, true, `${name} has HR access`);
  assert.equal(identity.isXeroAdmin, true, `${name} has Xero access`);
  assert.equal(identity.isAdmin, false, `${name} does not have full administrator access`);
}

assert.equal(ordinaryStaff.isAdmin, false);
assert.equal(ordinaryStaff.isHrAdmin, false);
assert.equal(ordinaryStaff.isXeroAdmin, false);

const sharedEstimate = { kind: 'estimates', employee_upn: 'another.employee@example.test', employee_name: 'Another employee' };
for (const [name, identity] of [['Faith', faith], ['Amanda', amanda], ...accountsIdentities.map((identity) => [identity.name, identity]), ...sourceConfiguredAccounts.map((person) => [person.name, identityFor(person)])]) {
  assert.equal(canViewAllRecords(identity, 'estimates'), true, `${name} can read shared estimate-history records`);
  assert.equal(canReadHistoryRecord(identity, sharedEstimate), true, `${name} can read another employee's estimate-history record`);
}
assert.equal(canViewAllRecords(operationsAdmin, 'estimates'), true, 'the existing Operations role retains shared estimate-history access');
assert.equal(canReadHistoryRecord(operationsAdmin, sharedEstimate), true);
for (const [name, identity] of [['Michelle', michelle], ['Lidia', lidia], ['ordinary staff', ordinaryStaff]]) {
  assert.equal(canViewAllRecords(identity, 'estimates'), false, `${name} cannot list shared estimate-history records`);
  assert.equal(canReadHistoryRecord(identity, sharedEstimate), false, `${name} cannot read another employee's estimate-history record`);
  assert.equal(canReadHistoryRecord(identity, { ...sharedEstimate, employee_upn: identity.upn }), true, `${name} can still read their own estimate-history record`);
}

let lastHistoryQuery = null;
const historyDb = {
  prepare(sql) {
    return { bind(...bindings) { lastHistoryQuery = { sql, bindings }; return { all: async () => ({ results: [] }) }; } };
  }
};
const historyEnv = { DB: historyDb, STAFF_DIRECTORY_JSON: '[]' };
await listRecords(new Request('https://gmt.example/api/history?kind=estimates'), historyEnv, michelle);
assert.match(lastHistoryQuery.sql, /WHERE \(r\.owner_oid = \?/);
assert.deepEqual(lastHistoryQuery.bindings, [michelle.oid, michelle.upn, 'estimates', 200], 'HR/Xero API reads stay scoped to Michelle’s own estimate records');
await listRecords(new Request('https://gmt.example/api/history?kind=estimates'), historyEnv, faith);
assert.match(lastHistoryQuery.sql, /r\.kind = \?/);
assert.deepEqual(lastHistoryQuery.bindings, ['estimates', 200], 'full administrators can list shared estimate-history records');
await listRecords(new Request('https://gmt.example/api/history?kind=estimates'), historyEnv, operationsAdmin);
assert.match(lastHistoryQuery.sql, /r\.kind = \?/);
assert.deepEqual(lastHistoryQuery.bindings, ['estimates', 200], 'Operations can list shared estimate-history records');

const adminUsersEndpoint = workerSource.match(/async function adminUsersEndpoint\([\s\S]*?\n\}/)?.[0] || '';
assert.match(adminUsersEndpoint, /if \(!identity\?\.isAdmin\)[\s\S]*status: 403/);
assert.match(adminUsersEndpoint, /allowedRoles: \['hr', 'xero', 'operations', 'job-card'\]/, 'the admin API cannot assign full administrator access');
const estimateArchiveGate = workerSource.match(/function requireEstimateArchiveAccess\([\s\S]*?\n\}/)?.[0] || '';
assert.match(estimateArchiveGate, /if \(!identity\?\.isAdmin\)/, 'the separate estimate archive API remains full-admin-only');
assert.match(workerSource, /function requireXeroAdmin\(identity\)[\s\S]*?if \(!identity\?\.isXeroAdmin\)/, 'Xero APIs stay behind the Xero role guard');

const cryptoApi = globalThis.crypto || webcrypto;
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: cryptoApi, configurable: true });
const signingKeyPair = await cryptoApi.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
);
const signingKeyId = 'synthetic-gmt-role-fixture';
const signingJwk = { ...await cryptoApi.subtle.exportKey('jwk', signingKeyPair.publicKey), kid: signingKeyId, use: 'sig', alg: 'RS256' };
const encodeTokenPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function bearerFor(person, groups = []) {
  const header = encodeTokenPart({ alg: 'RS256', typ: 'JWT', kid: signingKeyId });
  const claims = encodeTokenPart({
    tid: tenantId,
    aud: audiences.split(',')[0],
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 300,
    oid: `api-fixture-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    preferred_username: person.upn,
    name: person.name,
    groups
  });
  const unsigned = `${header}.${claims}`;
  const signature = await cryptoApi.subtle.sign('RSASSA-PKCS1-v1_5', signingKeyPair.privateKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
}

const apiDb = {
  prepare() {
    const statement = {
      bind() { return statement; },
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true })
    };
    return statement;
  }
};
const apiEnv = {
  ...baseEnv,
  ADMIN_UPNS: accountsIdentityFixtures.map((entry) => entry.upn).join(','),
  ADMIN_GROUP_IDS: amandaGroupId,
  ALLOWED_ORIGINS: '',
  DB: apiDb
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  if (String(input).includes('/discovery/v2.0/keys')) {
    return new Response(JSON.stringify({ keys: [signingJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('Unexpected network request in the role fixture test');
};
try {
  const callWorker = async (path, person, groups = []) => worker.fetch(new Request(`https://gmt.example${path}`, {
    headers: { authorization: `Bearer ${await bearerFor(person, groups)}` }
  }), apiEnv, {});
  const apiAdmins = [
    { person: employee('Faith') },
    { person: { name: 'Amanda', upn: 'amanda-admin@example.test' }, groups: [amandaGroupId] },
    ...accountsIdentityFixtures.map((person) => ({ person })),
    ...sourceConfiguredAccounts.map((person) => ({ person }))
  ];
  for (const { person, groups = [] } of apiAdmins) {
    const response = await callWorker('/api/admin/users', person, groups);
    assert.equal(response.status, 200, `${person.name} full-admin claim can read the admin-users API`);
    assert.deepEqual((await response.json()).allowedRoles, ['hr', 'xero', 'operations', 'job-card']);
  }
  for (const person of [employee('Michelle'), employee('Lidia'), { name: 'Ordinary staff', upn: 'ordinary.staff@gmt-services.co.uk' }]) {
    const adminResponse = await callWorker('/api/admin/users', person);
    assert.equal(adminResponse.status, 403, `${person.name} cannot read the full-admin-only user API`);
    const archiveResponse = await callWorker('/api/archive/estimates', person);
    assert.equal(archiveResponse.status, 403, `${person.name} cannot read the full-admin-only estimate archive API`);
  }
  for (const person of [employee('Michelle'), employee('Lidia')]) {
    const response = await callWorker('/api/xero/status', person);
    assert.equal(response.status, 200, `${person.name} Xero claim can read the Xero API`);
  }
  assert.equal((await callWorker('/api/xero/status', { name: 'Ordinary staff', upn: 'ordinary.staff@gmt-services.co.uk' })).status, 403);
  assert.equal((await callWorker('/api/archive/estimates', employee('Faith'))).status, 200, 'full administrators can read the estimate archive API');
} finally {
  globalThis.fetch = originalFetch;
}

const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const apiStub = `window.GMTPortalApi = {
  access: async () => { window.__accessChecked = true; return window.__roleFixture || {}; },
  adminUsers: async () => ({ users: [], configured: [] }),
  updateUserAccess: async () => ({ ok: true })
};`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (pathname.endsWith('/portal-api.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(apiStub);
    return;
  }
  if (pathname.endsWith('/config.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end('window.GMT_APP_CONFIG = {};');
    return;
  }
  if (pathname.endsWith('/auth.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end('window.GMT_APP_CONFIG = window.GMT_APP_CONFIG || {}; if (document.querySelector("main")) document.querySelector("main").hidden = false;');
    return;
  }
  if (pathname.endsWith('/analytics.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end('');
    return;
  }
  if (pathname.endsWith('/invoices.js')) {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end('');
    return;
  }
  const filePath = normalize(join(repoRoot, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  response.end(readFileSync(filePath));
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const verifyUiRole = async (access, expected) => {
    const page = await browser.newPage();
    await page.addInitScript((fixture) => { window.__roleFixture = fixture; }, access);
    try {
      await page.goto(`${baseUrl}/tools/`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').evaluate((main) => { main.hidden = false; });
      await page.waitForFunction((state) => window.__accessChecked
        && document.getElementById('xero-invoices-card').hidden === !state.invoiceVisible
        && document.querySelector('[data-hide-for-hr]').hidden === state.hrRestrictedHidden, expected, { timeout: 5000 });
      assert.equal(await page.locator('[data-hide-for-hr]').first().evaluate((element) => element.hidden), expected.hrRestrictedHidden);
      await page.goto(`${baseUrl}/portal/users.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((hidden) => document.querySelector('main').hidden === hidden, expected.userManagementHidden, { timeout: 5000 });
    } finally {
      await page.close();
    }
  };

  await verifyUiRole({ isAdmin: true, isHrAdmin: true, isXeroAdmin: true }, { invoiceVisible: true, hrRestrictedHidden: false, userManagementHidden: false });
  await verifyUiRole({ isAdmin: false, isHrAdmin: true, isXeroAdmin: true }, { invoiceVisible: true, hrRestrictedHidden: true, userManagementHidden: true });
  await verifyUiRole({ isAdmin: false, isHrAdmin: false, isXeroAdmin: false }, { invoiceVisible: false, hrRestrictedHidden: false, userManagementHidden: true });
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

for (const [path, value] of [
  ['config.js', clientConfig],
  ['portal/index.html', readFileSync(new URL('../portal/index.html', import.meta.url), 'utf8')],
  ['portal/users.html', readFileSync(new URL('../portal/users.html', import.meta.url), 'utf8')],
  ['portal/users.js', readFileSync(new URL('../portal/users.js', import.meta.url), 'utf8')],
  ['tools/access-ui.js', readFileSync(new URL('../tools/access-ui.js', import.meta.url), 'utf8')]
]) {
  assert.doesNotMatch(value, /\b(?:ADMIN_UPNS|ADMIN_OIDS|ADMIN_GROUP_IDS|HR_ADMIN_UPNS|XERO_ADMIN_UPNS)\b/, `${path} does not publish Worker role allowlist variable names`);
  for (const person of [employee('Faith'), employee('Michelle'), employee('Lidia'), ...accountsIdentities, ...sourceConfiguredAccounts]) {
    assert.equal(value.toLowerCase().includes(person.upn.toLowerCase()), false, `${path} does not publish staff UPNs`);
  }
}

console.log('GMT portal configured role matrix: PASS');
