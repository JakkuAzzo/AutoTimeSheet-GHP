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

  await page.locator('#job-ref').fill('GMT-ROUTE-000');
  await page.locator('#job-client').fill('No Image Client');
  await page.locator('#job-site').fill('No Image Site');
  await page.locator('#job-engineer').fill('Routing Engineer');
  await page.locator('#job-date').fill('2026-06-29');
  await page.locator('#job-description').fill('Job card routing test without an image.');
  await page.locator('#job-card-form button[type="submit"]').click();
  await page.waitForFunction(() => window.__submittedForms.length === 1, null, { timeout: 5000 });

  await page.locator('#job-ref').fill('GMT-ROUTE-001');
  await page.locator('#job-client').fill('Image Client');
  await page.locator('#job-site').fill('Routing Site');
  await page.locator('#job-engineer').fill('Routing Engineer');
  await page.locator('#job-date').fill('2026-06-29');
  await page.locator('#job-description').fill('Completed job card routing test with image.');
  await page.locator('#job-image').setInputFiles(imagePath);
  await page.locator('#job-card-form button[type="submit"]').click();
  await page.waitForFunction(() => window.__submittedForms.length >= 2, null, { timeout: 5000 });
  await page.locator('[data-job-approve]').first().click();
  await page.waitForFunction(() => window.__submittedForms.some((form) => form.subject === '[GMT][JOBCARD][UPDATE] GMT-ROUTE-001 | Image Client'), null, { timeout: 5000 });

  const result = await page.evaluate(() => window.__submittedForms);
  const config = await page.evaluate(() => ({
    timesheetFormSubmitEndpoint: window.GMT_APP_CONFIG?.timesheetFormSubmitEndpoint || '',
    auditFormSubmitEndpoint: window.GMT_APP_CONFIG?.auditFormSubmitEndpoint || '',
    jobCardFormSubmitEndpoint: window.GMT_APP_CONFIG?.jobCardFormSubmitEndpoint || '',
    fallbackFormSubmitEndpoint: window.GMT_APP_CONFIG?.fallbackFormSubmitEndpoint || '',
    legacyPersonalAccountsEmail: window.GMT_APP_CONFIG?.legacyPersonalAccountsEmail || ''
  }));
  const noImageForm = result.find((form) => form.subject === '[GMT][JOBCARD][NEW] GMT-ROUTE-000 | No Image Client');
  const imageJobForm = result.find((form) => form.subject === '[GMT][JOBCARD][NEW] GMT-ROUTE-001 | Image Client');
  const updateForm = result.find((form) => form.subject === '[GMT][JOBCARD][UPDATE] GMT-ROUTE-001 | Image Client');

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.equal(result.length, 3, 'expected two job card submissions and one update only');
  assert.equal(config.jobCardFormSubmitEndpoint, '');
  assert.equal(config.auditFormSubmitEndpoint, '');
  assert.equal(config.timesheetFormSubmitEndpoint, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(config.fallbackFormSubmitEndpoint, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(config.legacyPersonalAccountsEmail, 'acc.gmtelect@outlook.com');
  assert.ok(noImageForm, 'job card FormSubmit payload without image was created');
  assert.ok(imageJobForm, 'job card FormSubmit payload with image was created');
  assert.ok(updateForm, 'job card update FormSubmit payload was created');
  assert.equal(noImageForm.action, 'https://formsubmit.co/acc.gmtelect+jobcards@outlook.com');
  assert.equal(imageJobForm.action, 'https://formsubmit.co/acc.gmtelect+jobcards@outlook.com');
  assert.equal(updateForm.action, 'https://formsubmit.co/acc.gmtelect+jobcards@outlook.com');
  assert.equal(noImageForm.cc, 'gmtelectricalservices+jobcards@outlook.com');
  assert.equal(imageJobForm.cc, 'gmtelectricalservices+jobcards@outlook.com');
  assert.equal(updateForm.cc, 'gmtelectricalservices+jobcards@outlook.com');
  assert.deepEqual(noImageForm.files, []);
  assert.deepEqual(imageJobForm.files, [{ name: 'attachment', files: ['completion-photo.png'] }]);
  assert.equal(result.some((form) => form.action.includes('jobcard-images') || form.cc.includes('jobcard-images')), false, 'jobcard-images routing must not be used');

  const imageFields = new Map(imageJobForm.fields);
  assert.equal(imageFields.get('gmt_type'), 'jobcard');
  assert.equal(imageFields.get('gmt_action'), 'new');
  assert.equal(imageFields.get('gmt_record_id'), 'GMT-ROUTE-001');
  assert.equal(imageFields.get('gmt_job_ref'), 'GMT-ROUTE-001');
  assert.equal(imageFields.get('gmt_client'), 'Image Client');
  assert.equal(imageFields.get('gmt_site'), 'Routing Site');
  assert.equal(imageFields.get('gmt_engineer'), 'Routing Engineer');
  assert.equal(imageFields.get('gmt_planned_date'), '2026-06-29');
  assert.equal(imageFields.get('gmt_attachment_type'), 'image');
  assert.ok(imageFields.get('gmt_submitted_at'), 'gmt_submitted_at should be populated');

  console.log(JSON.stringify({
    forms: result.map((form) => ({ subject: form.subject, action: form.action, cc: form.cc, files: form.files }))
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmp, { recursive: true, force: true });
}
