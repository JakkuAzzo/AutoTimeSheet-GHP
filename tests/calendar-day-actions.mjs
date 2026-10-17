import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><body><script defer src="/portal/calendar-actions.js"></script></body></html>');
    return;
  }
  const filePath = normalize(join(repoRoot, url.pathname));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.GMT_APP_CONFIG = { calendarFormSubmitEndpoint: 'https://formsubmit.example/gmt-calendar' };
    window.__submittedForms = [];
    localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Calendar Tester', username: 'calendar.tester@gmt-services.co.uk' }));
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__submittedForms.push({
        subject: this.querySelector('[name="_subject"]')?.value || '',
        fields: Object.fromEntries([...this.querySelectorAll('input')].map((input) => [input.name, input.value]))
      });
    };
    window.GMTPortalApi = { saveRecord: async (record) => { window.__requestSaved = record; } };
  });
  const day = await page.evaluate(() => `${window.GMTCalendarActions.currentPayMonth()}-15`);
  await page.evaluate((value) => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.dataset.calendarDay = value;
    trigger.textContent = '15';
    document.body.appendChild(trigger);
  }, day);
  await page.locator('[data-calendar-day]').click();
  assert.equal(await page.locator('dialog.calendar-day-actions-dialog').isVisible(), true);
  assert.equal(await page.locator('#calendar-day-actions-date').textContent(), day);
  const links = await page.locator('dialog.calendar-day-actions-dialog a').evaluateAll((elements) => elements.map((element) => ({
    action: element.dataset.calendarActionTimesheet || element.dataset.calendarActionEvents || element.dataset.calendarActionTask || element.dataset.calendarActionTimeOff || '',
    href: element.href,
    ariaDisabled: element.getAttribute('aria-disabled')
  })));
  const byPath = (path) => links.find((link) => link.href && new URL(link.href).pathname === path);
  assert.equal(new URL(byPath('/timesheets/create.html').href).search, `?day=${day}`);
  assert.equal(new URL(byPath('/timesheets/create.html').href).hash, `#day-${day}`);
  assert.equal(new URL(byPath('/portal/timesheets').href).search, `?day=${day}&month=${day.slice(0, 7)}`);
  assert.equal(new URL(byPath('/tasks/').href).search, `?date=${day}`);
  const timeOff = new URL(await page.locator('[data-calendar-action-time-off]').getAttribute('href'), page.url());
  assert.equal(timeOff.search, `?request=time-off&date=${day}`);
  assert.equal(timeOff.pathname, '/portal/submissions');
  assert.equal(byPath('/timesheets/create.html').ariaDisabled, null);
  await page.locator('[data-calendar-action-time-off]').click();
  await page.locator('dialog.calendar-request-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('dialog.calendar-request-dialog [name=date]').inputValue(), day);
  await page.locator('dialog.calendar-request-dialog [name=notes]').fill('Test request');
  await page.locator('dialog.calendar-request-dialog button[type=submit]').click();
  await page.waitForFunction(() => Boolean(window.__requestSaved));
  const saved = await page.evaluate(() => window.__requestSaved);
  assert.equal(saved.kind, 'calendar');
  assert.equal(saved.recordDate, day);
  assert.equal(saved.employeeName, 'Calendar Tester');
  assert.equal(saved.employeeEmail, 'calendar.tester@gmt-services.co.uk');
  assert.equal(saved.payload.notes, 'Test request');
  await page.waitForFunction(() => window.__submittedForms.length === 1);
  const envelope = await page.evaluate(() => window.__submittedForms[0]);
  assert.equal(envelope.fields.gmt_schema_version, '1');
  assert.equal(envelope.fields.gmt_type, 'calendar');
  assert.equal(envelope.fields.gmt_action, 'create_request');
  assert.equal(envelope.fields.gmt_record_id, saved.recordId);
  assert.equal(envelope.fields.gmt_status, 'Pending approval');
  assert.equal(envelope.fields.gmt_employee, 'Calendar Tester');
  assert.equal(envelope.fields.gmt_requester_upn, 'calendar.tester@gmt-services.co.uk');
  assert.equal(envelope.fields.gmt_year, day.slice(0, 4));
  assert.equal(envelope.fields.gmt_month, day.slice(5, 7));
  assert.equal(envelope.fields.gmt_calendar_name, 'GMT Operational Calendar');
  assert.ok(envelope.fields.gmt_submitted_at);
  assert.equal(envelope.fields.gmt_submitted_at, saved.submittedAt, 'the D1 record and email envelope share one submission timestamp');
  assert.equal(envelope.fields.event_id, saved.recordId);
  assert.match(await page.locator('[data-calendar-request-status]').textContent(), /delivery is not confirmed/i);
  await page.locator('dialog.calendar-request-dialog [data-calendar-request-close]').click();
  await page.evaluate(() => {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.dataset.calendarRecordId = 'weekly-matthew';
    entry.dataset.calendarRecordKind = 'timesheets';
    entry.dataset.calendarCanEdit = 'true';
    entry.dataset.calendarCanDelete = 'true';
    entry.dataset.calendarDate = '2026-09-03';
    entry.textContent = 'Matthew';
    document.body.appendChild(entry);
    window.GMTPortalApi.deleteRecord = async () => { window.__deletedRecord = true; };
  });
  await page.locator('[data-calendar-record-id="weekly-matthew"]').click();
  assert.match(await page.locator('[data-calendar-action-delete]').textContent(), /Remove day/);
  await page.locator('[data-calendar-action-delete]').click();
  await page.waitForURL(/\/portal\/submissions\?/);
  const deletionTarget = new URL(page.url());
  assert.equal(deletionTarget.searchParams.get('record'), 'weekly-matthew');
  assert.equal(deletionTarget.searchParams.get('day'), '2026-09-03');
  assert.equal(await page.evaluate(() => Boolean(window.__deletedRecord)), false);
  console.log(JSON.stringify({ day, links: links.map(({ href, ariaDisabled }) => ({ href, ariaDisabled })) }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
