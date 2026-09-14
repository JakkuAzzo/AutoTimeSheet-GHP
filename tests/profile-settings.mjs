import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProfileSettings, profileView, saveProfileSettings } from '../cloudflare-worker/src/index.js';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const profileSource = await (await import('node:fs/promises')).readFile(resolve(repoRoot, 'portal/profile.js'), 'utf8');

const identity = { oid: 'oid-profile-test', upn: 'profile.tester@gmt-services.co.uk', name: 'Microsoft Name' };
const sqlLog = [];
let storedRow = null;
const env = {
  DB: {
    prepare(sql) {
      sqlLog.push(sql);
      return {
        bind(...bindings) {
          return {
            first: async () => storedRow,
            run: async () => {
              if (sql.includes('INSERT INTO profile_settings')) {
                storedRow = {
                  display_name: bindings[2],
                  notification_email: bindings[3],
                  updated_at: bindings[4]
                };
              }
              return { success: true };
            }
          };
        }
      };
    }
  }
};

assert.deepEqual(profileView(identity), {
  name: 'Microsoft Name',
  username: identity.upn,
  notificationEmail: '',
  updatedAt: '',
  source: 'identity-default'
});
await saveProfileSettings(env, identity, { name: 'Saved GMT Name', notificationEmail: 'copy@example.com' });
const saved = await getProfileSettings(env, identity);
assert.equal(saved.name, 'Saved GMT Name');
assert.equal(saved.notificationEmail, 'copy@example.com');
assert.equal(saved.source, 'portal-d1');
assert.ok(sqlLog.some((sql) => sql.includes('INSERT INTO profile_settings')));
await assert.rejects(() => saveProfileSettings(env, identity, { notificationEmail: 'not-an-email' }), /valid personal email/);

const server = createServer((request, response) => {
  if (request.url === '/profile.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(profileSource);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><html><body><form id="portal-profile-form"><input id="portal-profile-name"><input id="portal-profile-login-email"><input id="portal-profile-email" type="email"><p id="portal-profile-status"></p><button type="submit">Save</button></form><script src="/profile.js"></script></body></html>');
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Cached name', username: 'profile.tester@gmt-services.co.uk', subject: 'oid-profile-test' }));
    window.GMT_PORTAL_PROFILE_READY = Promise.resolve({ name: 'Saved GMT Name', username: 'profile.tester@gmt-services.co.uk', notificationEmail: 'copy@example.com' });
    window.GMTPortalApi = {
      enabled: () => true,
      saveProfile: async (profile) => {
        window.__savedProfile = profile;
        return { profile: { ...profile, username: 'profile.tester@gmt-services.co.uk' } };
      }
    };
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#portal-profile-name').value === 'Saved GMT Name');
  assert.equal(await page.locator('#portal-profile-email').inputValue(), 'copy@example.com');
  await page.locator('#portal-profile-name').fill('Updated GMT Name');
  await page.locator('#portal-profile-form button').click();
  await page.waitForFunction(() => window.__savedProfile && window.__savedProfile.name === 'Updated GMT Name');
  assert.match(await page.locator('#portal-profile-status').innerText(), /GMT app profile/);
  assert.doesNotMatch(await page.locator('body').innerText(), /saved on this device/i);
  console.log('GMT app profile persistence and cross-device hydration: PASS');
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
