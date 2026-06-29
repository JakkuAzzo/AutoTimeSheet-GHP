import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, statSync, createReadStream, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, rawPath));

  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = mkdtempSync(join(tmpdir(), 'gmt-job-card-routing-'));
const imagePath = join(tmp, 'completion-photo.png');
writeFileSync(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'));

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromePath) ? { executablePath: chromePath } : {})
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()) && !/Failed to load resource: the server responded with a status of 404/.test(msg.text())) {
      logs.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  await page.goto(`http://127.0.0.1:${port}/jobs/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__submittedForms = [];
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__submittedForms.push({
        action: this.action,
        subject: this.querySelector('[name="_subject"]')?.value || '',
        cc: this.querySelector('[name="_cc"]')?.value || '',
        fields: [...this.querySelectorAll('input[type="hidden"]')].map((input) => [input.name, input.value]),
        files: [...this.querySelectorAll('input[type="file"]')].map((input) => ({
          name: input.name,
          files: [...input.files].map((file) => file.name)
        }))
      });
    };
  });

  await page.locator('#job-ref').fill('GMT-ROUTE-001');
  await page.locator('#job-client').fill('Routing Client');
  await page.locator('#job-site').fill('Routing Site');
  await page.locator('#job-engineer').fill('Routing Engineer');
  await page.locator('#job-date').fill('2026-06-29');
  await page.locator('#job-description').fill('Completed job card routing test.');
  await page.locator('#job-image').setInputFiles(imagePath);
  await page.locator('#job-card-form button[type="submit"]').click();
  await page.waitForFunction(() => window.__submittedForms.length >= 2, null, { timeout: 5000 });
  await page.locator('[data-job-approve]').first().click();
  await page.waitForFunction(() => window.__submittedForms.some((form) => form.subject === 'GMT Job Card Update Submission'), null, { timeout: 5000 });

  const result = await page.evaluate(() => window.__submittedForms);
  const jobForm = result.find((form) => form.subject === 'GMT Job Card Submission');
  const imageForm = result.find((form) => form.subject === 'GMT Job Card Image Attachment');
  const updateForm = result.find((form) => form.subject === 'GMT Job Card Update Submission');

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.ok(jobForm, 'main job card FormSubmit payload was created');
  assert.ok(imageForm, 'job card image FormSubmit payload was created');
  assert.ok(updateForm, 'job card update FormSubmit payload was created');
  assert.equal(jobForm.action, 'https://formsubmit.co/acc.gmtelect@outlook.com');
  assert.equal(imageForm.action, 'https://formsubmit.co/acc.gmtelect@outlook.com');
  assert.equal(updateForm.action, 'https://formsubmit.co/acc.gmtelect@outlook.com');
  assert.equal(jobForm.cc, 'gmtelectricalservices@outlook.com');
  assert.equal(imageForm.cc, 'gmtelectricalservices@outlook.com');
  assert.equal(updateForm.cc, 'gmtelectricalservices@outlook.com');
  assert.deepEqual(imageForm.files, [{ name: 'attachment', files: ['completion-photo.png'] }]);

  console.log(JSON.stringify({
    forms: result.map((form) => ({ subject: form.subject, action: form.action, cc: form.cc, files: form.files }))
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmp, { recursive: true, force: true });
}
