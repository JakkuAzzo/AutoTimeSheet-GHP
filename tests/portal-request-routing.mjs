import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, rawPath));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  if (rawPath === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    const config = readFileSync(filePath, 'utf8')
      .replace(/(entraSpaAuth:\s*\{\s*enabled:\s*)true/, '$1false')
      .replace(/(portalApiEndpoint:\s*)["'][^"']*["']/, '$1""')
      .replace(/(portalHistoryEndpoint:\s*)["'][^"']*["']/, '$1""');
    res.end(config);
    return;
  }
  res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;

async function submittedForm(page, selector) {
  await page.locator(selector).click();
  await page.waitForFunction((count) => window.__submittedForms.length >= count, await page.evaluate(() => window.__submittedForms.length), { timeout: 5000 });
  return page.evaluate(() => window.__submittedForms.at(-1));
}

try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({ name: 'Unlicensed Engineer', username: 'unlicensed.engineer@gmt-services.co.uk' })));
  await page.addInitScript(() => localStorage.setItem('gmt_portal_tasks_v1', JSON.stringify([{ id: 'other-user-task', title: 'Other account private task', status: 'Approved' }])));
  await page.addInitScript(() => {
    window.__submittedForms = [];
    window.__savedRecords = [];
    window.__updatedRecords = [];
    window.GMTPortalApi = {
      enabled: () => true,
      saveRecord: async (record) => { window.__savedRecords.push(record); },
      updateRecord: async (recordId, record) => { window.__updatedRecords.push({ recordId, ...record }); }
    };
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__submittedForms.push({
        action: this.action,
        subject: this.querySelector('[name="_subject"]')?.value || '',
        fields: Object.fromEntries([...this.querySelectorAll('input[type="hidden"]')].map((input) => [input.name, input.value]))
      });
    };
  });

  await page.goto(`http://127.0.0.1:${port}/tasks/`, { waitUntil: 'load' });
  assert.equal(await page.locator('#task-board').innerText().then((text) => text.includes('Other account private task')), false, 'browser-local task requests are not merged into the signed-in account view');
  assert.match(await page.locator('#task-board').innerText(), /Protected task history is unavailable/i, 'the task board distinguishes unavailable protected history from an empty list');
  await page.evaluate(() => {
    window.GMTPortalApi = {
      enabled: () => true,
      saveRecord: async (record) => { window.__savedRecords.push(record); },
      updateRecord: async (recordId, record) => { window.__updatedRecords.push({ recordId, ...record }); }
    };
  });
  assert.equal(await page.locator('#task-assignee').inputValue(), 'Unlicensed Engineer');
  await page.locator('#task-title').fill('Inspect workshop pump');
  await page.locator('#task-job-ref').fill('GMT-TASK-001');
  await page.locator('#task-due').fill('2026-07-20');
  const task = await submittedForm(page, '#task-form button[type="submit"]');
  assert.equal(task.action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(task.subject, '[GMT][TASK][REQUEST] Inspect workshop pump');
  assert.equal(task.fields.gmt_type, 'task');
  assert.equal(task.fields.gmt_action, 'create_request');
  assert.equal(task.fields.gmt_status, 'Pending approval');
  assert.equal(task.fields.gmt_employee, 'Unlicensed Engineer');
  assert.equal(task.fields.gmt_requester_upn, 'unlicensed.engineer@gmt-services.co.uk');
  assert.equal(task.fields.gmt_schema_version, '1');
  assert.equal(task.fields.gmt_year, '2026');
  assert.equal(task.fields.gmt_month, '07');
  assert.ok(task.fields.gmt_record_id);
  assert.equal(task.fields.gmt_submitted_at, task.fields.submitted_at);
  assert.equal(task.fields.task_id, task.fields.gmt_record_id, 'D1 and FormSubmit task requests use the same stable record ID');
  assert.equal(await page.evaluate(() => window.__savedRecords[0].recordId), task.fields.gmt_record_id);
  assert.equal(await page.evaluate(() => window.__savedRecords[0].submittedAt), task.fields.gmt_submitted_at);
  assert.equal(await page.evaluate(() => window.__updatedRecords.length), 0, 'request submission does not rewrite D1 status based on a hidden form submit');
  assert.equal(await page.locator('[data-task-move], [data-task-delete]').count(), 0, 'the static portal must not expose local task status controls');
  assert.equal(await page.locator('[data-task-status]').count(), 0, 'the task board must not offer browser-side status transitions');

  await page.goto(`http://127.0.0.1:${port}/calendar/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__calendarHistoryRecord = {
      source_record_id: 'calendar-legacy-001', event_title: 'Legacy calendar request', event_date: '2026-09-03',
      event_type: 'General', owner: 'Unlicensed Engineer', notes: '', status: 'Saved',
      employee_name: 'Unlicensed Engineer', submitted_at: '2026-09-01T08:00:00.000Z'
    };
    window.GMTPortalApi = {
      enabled: () => true,
      saveRecord: async (record) => { window.__savedRecords.push(record); },
      updateRecord: async (recordId, record) => {
        window.__updatedRecords.push({ recordId, ...record });
        if (recordId === window.__calendarHistoryRecord.source_record_id) {
          window.__calendarHistoryRecord.status = record.status;
          window.__calendarHistoryRecord.updated_at = record.updatedAt;
        }
      },
      history: async (kind) => kind === 'calendar' ? ({ records: [window.__calendarHistoryRecord] }) : ({ records: [] })
    };
    document.dispatchEvent(new Event('gmtportalidentity'));
  });
  await page.waitForFunction(() => document.querySelectorAll('#calendar-list .calendar-date-group').length === 1
    && document.querySelector('[data-calendar-delete="calendar-legacy-001"]'));
  assert.equal(await page.locator('#calendar-list .calendar-date-group').count(), 1, 'protected calendar request history loads from the Worker');
  assert.equal(await page.locator('#calendar-list').innerText().then((text) => text.includes('Awaiting licensed accounts approval.')), true, 'legacy Saved requests are shown as pending approval');
  await page.locator('[data-calendar-edit="calendar-legacy-001"]').click();
  await page.locator('#calendar-title').fill('Legacy calendar request revised');
  const legacyEdit = await submittedForm(page, '#calendar-form button[type="submit"]');
  assert.equal(legacyEdit.fields.gmt_action, 'update_request');
  assert.equal(legacyEdit.fields.gmt_record_id, 'calendar-legacy-001');
  assert.equal(legacyEdit.fields.gmt_submitted_at, '2026-09-01T08:00:00.000Z', 'calendar edits preserve the original request submission timestamp');
  assert.match(legacyEdit.fields.gmt_updated_at || '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'calendar edit carries a concrete update timestamp');
  assert.equal(legacyEdit.fields.gmt_updated_at, legacyEdit.fields.updated_at, 'calendar edit envelope includes its protected record update timestamp');
  assert.equal(await page.evaluate(() => window.__savedRecords.at(-1).updatedAt), legacyEdit.fields.gmt_updated_at, 'protected history and FormSubmit use the same calendar edit timestamp');
  await page.locator('[data-calendar-delete="calendar-legacy-001"]').click();
  await page.waitForFunction(() => window.__submittedForms.some((form) => form.fields.gmt_record_id === 'calendar-legacy-001' && form.fields.gmt_status === 'Cancelled'));
  const legacyCancellation = await page.evaluate(() => window.__submittedForms.find((form) => form.fields.gmt_record_id === 'calendar-legacy-001' && form.fields.gmt_status === 'Cancelled'));
  assert.equal(legacyCancellation.fields.gmt_submitted_at, '2026-09-01T08:00:00.000Z', 'protected history supplies the original submission timestamp for a legacy request');
  assert.equal(legacyCancellation.fields.gmt_updated_at, legacyCancellation.fields.updated_at);
  assert.equal(await page.evaluate(() => window.__updatedRecords.at(-1).updatedAt), legacyCancellation.fields.gmt_updated_at);
  const updatesBeforeNewCalendarRequest = await page.evaluate(() => window.__updatedRecords.length);
  assert.equal(await page.locator('#calendar-owner').inputValue(), 'Unlicensed Engineer');
  await page.locator('#calendar-title').fill('Site survey');
  await page.locator('#calendar-date').fill('2026-07-21');
  const calendar = await submittedForm(page, '#calendar-form button[type="submit"]');
  assert.equal(calendar.action, 'https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe');
  assert.equal(calendar.subject, '[GMT][CALENDAR][REQUEST] 2026-07-21 | Site survey');
  assert.equal(calendar.fields.gmt_type, 'calendar');
  assert.equal(calendar.fields.gmt_action, 'create_request');
  assert.equal(calendar.fields.gmt_status, 'Pending approval');
  assert.equal(calendar.fields.gmt_employee, 'Unlicensed Engineer');
  assert.equal(calendar.fields.gmt_requester_upn, 'unlicensed.engineer@gmt-services.co.uk');
  assert.equal(calendar.fields.gmt_schema_version, '1');
  assert.equal(calendar.fields.gmt_year, '2026');
  assert.equal(calendar.fields.gmt_month, '07');
  assert.equal(calendar.fields.gmt_calendar_name, 'GMT Operational Calendar');
  assert.ok(calendar.fields.gmt_record_id);
  assert.equal(calendar.fields.gmt_submitted_at, calendar.fields.submitted_at);
  assert.equal(await page.evaluate(() => window.__savedRecords.at(-1).submittedAt), calendar.fields.gmt_submitted_at);
  assert.equal(calendar.fields.gmt_record_id, await page.evaluate(() => window.__savedRecords.at(-1).recordId));
  assert.equal(await page.evaluate(() => window.__updatedRecords.length), updatesBeforeNewCalendarRequest, 'calendar form submission does not claim a delivery status');
  assert.equal(await page.locator('#calendar-list').innerText().then((text) => text.includes('Awaiting licensed accounts approval.')), true);

  const newCalendarEntryId = calendar.fields.gmt_record_id.replace(/^calendar-/, '');
  await page.locator(`[data-calendar-delete="${newCalendarEntryId}"]`).click();
  await page.waitForFunction(() => window.__submittedForms.some((form) => form.subject === '[GMT][CALENDAR][UPDATE] 2026-07-21 | Site survey'), null, { timeout: 5000 });
  const cancellation = await page.evaluate(() => window.__submittedForms.at(-1));
  assert.equal(cancellation.fields.gmt_action, 'update_request');
  assert.equal(cancellation.fields.gmt_status, 'Cancelled');
  assert.equal(cancellation.fields.gmt_requester_upn, 'unlicensed.engineer@gmt-services.co.uk');
  assert.equal(cancellation.fields.gmt_record_id, calendar.fields.gmt_record_id, 'calendar cancellation retains the same stable request ID');
  assert.equal(cancellation.fields.gmt_submitted_at, calendar.fields.gmt_submitted_at, 'calendar cancellation preserves the original request submission timestamp');
  assert.equal(cancellation.fields.gmt_updated_at, cancellation.fields.updated_at, 'the cancellation envelope includes its update timestamp');
  assert.equal(await page.evaluate(() => window.__updatedRecords.at(-1).recordId), calendar.fields.gmt_record_id);
  assert.equal(await page.evaluate(() => window.__updatedRecords.at(-1).status), 'Cancelled');
  assert.equal(await page.evaluate(() => window.__updatedRecords.at(-1).updatedAt), cancellation.fields.gmt_updated_at, 'protected history and FormSubmit use the same cancellation timestamp');
  await page.waitForFunction(() => document.querySelectorAll('[data-calendar-delete]').length === 0, null, { timeout: 5000 });
  assert.equal(await page.locator('[data-calendar-delete]').count(), 0, 'a saved cancellation is reflected without deleting the request record');
  assert.equal(await page.locator('#calendar-list').innerText().then((text) => text.includes('Cancelled')), true);
  assert.equal(await page.locator('#calendar-list').innerText().then((text) => text.includes('Microsoft 365 processing is not confirmed')), true);
  console.log(JSON.stringify({ task: { action: task.action, subject: task.subject }, calendar: { action: calendar.action, subject: calendar.subject } }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
