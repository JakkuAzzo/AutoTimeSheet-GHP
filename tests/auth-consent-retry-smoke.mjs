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
  response.end('<!doctype html><html><head><script>window.GMT_APP_CONFIG={entraSpaAuth:{enabled:true,tenantId:"tenant-1",clientId:"client-1",redirectPath:"/portal/"},portalApiScopes:[]};</script></head><body><header></header><main hidden>Portal</main><script defer src="/auth.js"></script></body></html>');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const page = await browser.newPage();
  await page.route('https://cdn.jsdelivr.net/npm/@azure/msal-browser@4.25.1/lib/msal-browser.min.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.msal={PublicClientApplication:class{async initialize(){} async handleRedirectPromise(){return {account:{homeAccountId:'acct',username:'accounts@gmt-services.co.uk',name:'Accounts',tenantId:'tenant-1',idTokenClaims:{name:'Accounts'}},idToken:'id-token'}} getActiveAccount(){return null} setActiveAccount(){} async loginRedirect(){} acquireTokenSilent(){const error=new Error('interaction required');error.errorCode='interaction_required';return Promise.reject(error)} async acquireTokenRedirect(request){window.redirectRequest=request;return {accessToken:'access-token',idToken:'id-token'}} getTokenCache(){return {removeAccount:async()=>{}}}}};`
  }));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const auth = await window.GMT_PORTAL_AUTH_READY;
    const token = await auth.acquireToken(['https://example.test/api.read']);
    return { token, prompt: window.redirectRequest && window.redirectRequest.prompt };
  });
  assert.equal(result.token, 'access-token');
  assert.notEqual(result.prompt, 'consent', 'fallback token acquisition must not force repeat consent for every interaction');
  console.log('MSAL interaction retry does not force repeat consent: PASS');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
