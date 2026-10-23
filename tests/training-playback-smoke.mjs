import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = mkdtempSync(join(tmpdir(), 'gmt-training-playback-'));
const mime = {
  '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/config.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end('window.GMT_APP_CONFIG = { entraSpaAuth: { enabled: false }, portalApiEndpoint: "", portalApiScopes: [], formSubmitEndpoint: "", fallbackFormSubmitEndpoint: "" };');
    return;
  }

  let requestPath;
  try { requestPath = decodeURIComponent(url.pathname); } catch {
    response.writeHead(400); response.end('Bad path'); return;
  }
  if (requestPath.endsWith('/')) requestPath += 'index.html';
  const filePath = resolve(repoRoot, `.${requestPath}`);
  if (!(filePath === repoRoot || filePath.startsWith(`${repoRoot}${sep}`)) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const mediaResponses = [];
  await page.route('**/*', (route) => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Demo Employee', username: 'demo.employee@example.invalid' }));
  });
  page.on('response', (response) => {
    if (response.url().includes('/training/media/gmt-training-')) mediaResponses.push(response);
  });

  await page.goto(`${baseUrl}/training/`, { waitUntil: 'networkidle' });
  await page.locator('main').waitFor({ state: 'visible' });
  const cards = page.locator('.training-video-card');
  assert.equal(await cards.count(), 7, 'all seven training cards must be visible after the local sign-in gate');

  const results = [];
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    const key = await card.getAttribute('data-training-key');
    assert.equal(await card.getAttribute('data-training-audience'), 'all-staff', `${key} audience must match the signed-in staff workflow`);
    const video = card.locator('video');
    const source = new URL(await video.locator('source').getAttribute('src'), `${baseUrl}/training/`);
    const transcriptId = await video.getAttribute('aria-describedby');
    assert.ok(transcriptId, `${key} video must identify its text transcript`);
    assert.equal(await card.locator(`#${transcriptId}.training-transcript li`).count() > 0, true, `${key} transcript must contain steps`);

    await video.scrollIntoViewIfNeeded();
    const playback = await video.evaluate(async (element) => {
      if (element.readyState < 1) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('metadata did not load')), 15000);
          element.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve(); }, { once: true });
          element.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('video metadata failed to load')); }, { once: true });
        });
      }
      element.muted = true;
      await element.play();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('video playback did not advance')), 12000);
        const check = () => {
          if (element.currentTime >= 0.75 && element.videoWidth > 0 && element.videoHeight > 0) {
            clearTimeout(timeout);
            resolve();
          }
        };
        element.addEventListener('timeupdate', check);
        check();
      });
      const result = { duration: element.duration, currentTime: element.currentTime, width: element.videoWidth, height: element.videoHeight };
      element.pause();
      return result;
    });

    const response = [...mediaResponses].reverse().find((item) => item.url() === source.href);
    assert.ok(response, `${key} MP4 must be requested by the browser`);
    assert.ok([200, 206].includes(response.status()), `${key} MP4 response must be successful`);
    assert.match(response.headers()['content-type'] || '', /video\/mp4/, `${key} MP4 must use the correct media type`);
    assert.ok(playback.duration > 1 && playback.currentTime >= 0.75, `${key} playback must advance through decoded frames`);
    await video.screenshot({ path: join(evidenceDir, `${basename(source.pathname, '.mp4')}.png`) });
    results.push({ key, status: response.status(), contentType: response.headers()['content-type'], ...playback });
  }

  await context.close();
  console.log(JSON.stringify({ result: 'passed', evidenceDir, videos: results }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
