import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const authSource = readFileSync(new URL('../portal/auth.js', import.meta.url), 'utf8');
const server = createServer((request, response) => {
  if (request.url === '/auth.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(authSource);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><html><head><script>window.GMT_APP_CONFIG={entraSpaAuth:{enabled:true,tenantId:"tenant-1",clientId:"client-1",redirectPath:"/portal/"},timesheetHistoryScopes:[]};</script></head><body><header><nav class="header-actions"><a href="/portal/">Dashboard</a></nav></header><main hidden>Protected page</main><script defer src="/auth.js"></script></body></html>');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const page = await browser.newPage();
  await page.route('https://cdn.jsdelivr.net/npm/@azure/msal-browser@4.25.1/lib/msal-browser.min.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.msal={PublicClientApplication:class{async initialize(){} async handleRedirectPromise(){if(sessionStorage.getItem('stub-authenticated'))return null;sessionStorage.setItem('stub-authenticated','true');return {account:{homeAccountId:'acct',username:'person@gmt-services.co.uk',name:'Person',tenantId:'tenant-1',idTokenClaims:{name:'Person'}},idToken:'id-token'}} getActiveAccount(){return null} setActiveAccount(){} async loginRedirect(){} acquireTokenSilent(){return Promise.resolve({accessToken:'token',idToken:'id-token'})} acquireTokenRedirect(){} getTokenCache(){return {removeAccount:async()=>{sessionStorage.setItem('stub-account-removed','true')}}}}};`
  }));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#portal-sign-out');
  assert.equal(await page.locator('#portal-sign-out').isVisible(), true);
  assert.equal(await page.locator('main').isVisible(), true);
  await page.locator('#portal-sign-out').click();
  await page.waitForFunction(() => sessionStorage.getItem('stub-account-removed') === 'true');
  const state = await page.evaluate(() => ({ authKey: sessionStorage.getItem('gmt.portal.authenticated.v1'), profile: localStorage.getItem('gmt.portal.profile.v1') }));
  assert.equal(state.authKey, null);
  assert.equal(state.profile, null);
  console.log('Shared sign-out handler: PASS');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
