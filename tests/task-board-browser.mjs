import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const portalScript = resolve(repoRoot, 'portal.js');
const portalCss = readFileSync(resolve(repoRoot, 'portal.css'), 'utf8');
const stylesCss = readFileSync(resolve(repoRoot, 'styles.css'), 'utf8');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const user = { oid: 'worker-oid', upn: 'worker@gmt-services.co.uk', name: 'Worker' };
const accounts = { oid: 'accounts-oid', upn: 'accounts@gmt-services.co.uk', name: 'Accounts' };
const engineer = { name: 'Worker', upn: user.upn };
const otherEngineer = { name: 'Other Worker', upn: 'other@gmt-services.co.uk' };

function shell() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${stylesCss}\n${portalCss}</style></head><body>
    <main class="app-main"><section class="card"><h2>Request a task</h2><form id="task-form"><label>Title<input id="task-title" required></label><label>Job ref<input id="task-job-ref"></label><label>Assignee<input id="task-assignee" type="email"></label><label>Due<input id="task-due" type="date"></label><label>Priority<select id="task-priority"><option>Normal</option><option>High</option><option>Urgent</option><option>Low</option></select></label><button type="submit">Submit</button><p id="task-form-status" role="status"></p></form></section>
    <p id="task-board-status" role="status">Loading Microsoft 365 tasks…</p><button type="button" id="task-connect-button" hidden>Connect Microsoft 365 task access</button><div class="kanban-board" id="task-board"></div></main>
    </body></html>`;
}

async function mount(page, fixture) {
  page.on('pageerror', (error) => console.error('Browser page error:', error.message));
  await page.setContent(shell(), { waitUntil: 'load' });
  await page.evaluate((initial) => {
    const state = {
      records: structuredClone(initial.records || []),
      pending: structuredClone(initial.pending || []),
      access: structuredClone(initial.access),
      calls: [],
      failNextRequest: initial.failNextRequest === true,
      failNextAction: initial.failNextAction === true,
      failLoad: initial.failLoad === true,
      failLoadStatus: Number(initial.failLoadStatus) || 401,
      connects: 0
    };
    window.__taskFixture = state;
    window.GMT_APP_CONFIG = { taskWorkflowScopes: ['https://service.flow.microsoft.com//.default'] };
    const storage = {};
    state.storageWrites = [];
    Object.defineProperty(window, 'localStorage', { configurable: true, value: {
      getItem: (key) => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
      setItem: (key, value) => { state.storageWrites.push(String(key)); storage[key] = String(value); },
      removeItem: (key) => { delete storage[key]; }
    } });
    window.GMTPortalApi = {
      enabled: () => true,
      history: async () => ({ records: [] }),
      tasks: async () => {
        if (state.failLoad) throw Object.assign(new Error('Task workflow access is not connected.'), { status: state.failLoadStatus });
        return { records: structuredClone(state.records), pending: structuredClone(state.pending), access: structuredClone(state.access) };
      },
      connectTaskWorkflow: async () => { state.connects += 1; state.failLoad = false; return true; },
      createTask: async (body) => {
        state.calls.push({ method: 'create', body: structuredClone(body) });
        if (state.failNextRequest) {
          state.failNextRequest = false;
          state.pending = [{ taskId: body.taskId, actionId: body.actionId, action: 'request', attempts: 1, error: 'Temporary sync failure', task: { ...body, requesterUpn: state.access.actorUpn, requesterName: 'Worker', assigneeUpn: '', status: 'Pending approval', priority: body.priority || 'Normal' } }];
          throw Object.assign(new Error('Microsoft 365 did not confirm the request.'), { operationId: body.actionId, syncStatus: 'failed' });
        }
        state.pending = [];
        state.records.unshift({ ...body, requesterUpn: state.access.actorUpn, requesterName: 'Worker', assigneeUpn: '', sharePointItemId: `sp-${body.taskId}`, status: 'Pending approval', updatedAt: new Date().toISOString() });
        return { task: state.records[0], sync: { status: 'synced' } };
      },
      actOnTask: async (taskId, body) => {
        state.calls.push({ method: 'action', taskId, body: structuredClone(body) });
        if (state.failNextAction) {
          state.failNextAction = false;
          state.pending = [{ taskId, actionId: body.actionId, action: body.action, attempts: 1, error: 'Temporary sync failure', task: structuredClone(state.records.find((record) => record.taskId === taskId)) }];
          throw Object.assign(new Error('Microsoft 365 did not confirm the update.'), { operationId: body.actionId, syncStatus: 'failed' });
        }
        let task = state.records.find((record) => record.taskId === taskId);
        if (body.action === 'retry') {
          const failed = state.pending.find((entry) => entry.actionId === body.actionId);
          if (failed?.action === 'request') {
            task = { ...failed.task, sharePointItemId: `sp-${taskId}`, status: 'Pending approval', updatedAt: new Date().toISOString() };
            state.records.unshift(task);
          }
          state.pending = [];
        }
        if (body.action === 'approve') {
          task.status = 'To-Do'; task.assigneeUpn = body.assigneeUpn || ''; task.dueDate = body.dueDate || task.dueDate; task.priority = body.priority || task.priority;
        } else if (body.action === 'reject' || body.action === 'cancel') task.status = 'Cancelled';
        else if (body.action === 'assign') task.assigneeUpn = body.assigneeUpn;
        else if (body.action === 'schedule') { task.dueDate = body.dueDate; task.priority = body.priority; }
        else if (body.action === 'transition') task.status = body.status;
        if (task) task.updatedAt = new Date().toISOString();
        state.pending = [];
        return { task, sync: { status: 'synced' } };
      },
      taskHistory: async () => ({ events: [{ action: 'approve', actorName: 'Accounts', actorUpn: 'accounts@gmt-services.co.uk', createdAt: '2026-10-17T12:00:00Z' }] })
    };
  }, fixture);
  await page.addScriptTag({ path: portalScript });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true })));
  await page.waitForFunction(() => !document.querySelector('#task-board-status')?.textContent.startsWith('Loading'), null, { timeout: 5000 }).catch(async (error) => {
    console.error('Task board boot state:', await page.locator('#task-board-status').textContent());
    throw error;
  });
}

const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const pages = [];
try {
  const emptyPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pages.push(emptyPage);
  await mount(emptyPage, { records: [], pending: [], access: { actorUpn: user.upn, canManage: false, staff: [] } });
  assert.equal(await emptyPage.locator('.kanban-column').count(), 5, 'empty board should show every lifecycle column');
  assert.equal(await emptyPage.locator('.kanban-column').first().innerText().then((text) => text.includes('No tasks.')), true);

  const consentPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pages.push(consentPage);
  await mount(consentPage, { records: [], pending: [], failLoad: true, access: { actorUpn: user.upn, canManage: false, staff: [] } });
  assert.equal(await consentPage.locator('#task-connect-button').isVisible(), true, 'missing Flow consent should offer a user-started connection');
  assert.equal(await consentPage.evaluate(() => window.__taskFixture.connects), 0, 'loading the board must not start an interactive consent prompt');
  await consentPage.locator('#task-connect-button').click();
  await consentPage.waitForFunction(() => document.querySelector('#task-board-status')?.textContent.includes('loaded from Microsoft 365'));
  assert.equal(await consentPage.evaluate(() => window.__taskFixture.connects), 1);

  const unavailablePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pages.push(unavailablePage);
  await mount(unavailablePage, { records: [], pending: [], failLoad: true, failLoadStatus: 503, access: { actorUpn: user.upn, canManage: false, staff: [] } });
  assert.equal(await unavailablePage.locator('#task-connect-button').isVisible(), false, 'missing Worker or flow configuration should not trigger consent');

  await emptyPage.locator('#task-title').fill('Inspect workshop pump');
  await emptyPage.locator('#task-job-ref').fill('GMT-TASK-001');
  await emptyPage.locator('#task-due').fill('2026-10-24');
  await emptyPage.evaluate(() => { window.__taskFixture.failNextRequest = true; });
  await emptyPage.locator('#task-form button[type="submit"]').click();
  await emptyPage.waitForFunction(() => window.__taskFixture.calls.filter((call) => call.method === 'create').length === 1);
  const firstRequest = await emptyPage.evaluate(() => window.__taskFixture.calls[0].body);
  assert.match(firstRequest.taskId, /^task-/);
  assert.match(firstRequest.actionId, /^action-/);
  assert.equal(firstRequest.status, undefined, 'the browser cannot set authoritative status');
  assert.equal(await emptyPage.locator('.task-sync-error').count(), 1, 'failed sync should remain visible with a same-action retry');
  await emptyPage.locator('.task-sync-error button[data-task-retry]').click();
  await emptyPage.waitForFunction(() => window.__taskFixture.calls.filter((call) => call.method === 'action').length === 1);
  const retryAction = await emptyPage.evaluate(() => window.__taskFixture.calls.find((call) => call.method === 'action'));
  assert.equal(retryAction.taskId, firstRequest.taskId);
  assert.equal(retryAction.body.actionId, firstRequest.actionId, 'request retry must reuse its task and action IDs');
  assert.equal(retryAction.body.action, 'retry');
  assert.equal(await emptyPage.locator('#task-board .task-card').count(), 1);
  assert.equal(await emptyPage.locator('#task-title').inputValue(), '', 'successful submit clears the form');
  assert.deepEqual(await emptyPage.evaluate(() => window.__taskFixture.storageWrites.filter((key) => key.includes('tasks'))), [], 'task records must not be stored in browser localStorage');

  const managerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pages.push(managerPage);
  await mount(managerPage, {
    access: { actorUpn: accounts.upn, canManage: true, staff: [engineer, otherEngineer] }, pending: [], records: [{
      taskId: 'task-pending', title: 'Replace motor belt', requesterName: 'Worker', requesterUpn: user.upn,
      jobReference: 'GMT-002', status: 'Pending approval', priority: 'Normal', dueDate: '', requestedAssigneeUpn: user.upn, assigneeUpn: '', sharePointItemId: 'sp-pending'
    }]
  });
  assert.equal(await managerPage.locator('[data-task-action="approve"]').count(), 1, 'manager sees approval control');
  await managerPage.locator('[data-task-reason="decision"]').fill('Proceed once site access is confirmed.');
  await managerPage.locator('[data-task-action="approve"]').click();
  await managerPage.waitForFunction(() => window.__taskFixture.records[0].status === 'To-Do');
  const approval = await managerPage.evaluate(() => window.__taskFixture.calls.find((call) => call.body.action === 'approve').body);
  assert.equal(approval.assigneeUpn, user.upn);
  assert.equal(approval.reason, 'Proceed once site access is confirmed.', 'approval decision notes are sent with the action');
  assert.equal(await managerPage.locator('[data-task-action="transition"]').count(), 1, 'manager can move approved work through its lifecycle');

  const engineerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pages.push(engineerPage);
  await mount(engineerPage, {
    access: { actorUpn: user.upn, canManage: false, staff: [] }, pending: [], records: [{
      taskId: 'task-active', title: 'Inspect compressor', requesterName: 'Accounts', requesterUpn: accounts.upn,
      jobReference: 'GMT-003', status: 'To-Do', priority: 'High', dueDate: '2026-10-24', assigneeUpn: user.upn, sharePointItemId: 'sp-active'
    }]
  });
  assert.equal(await engineerPage.locator('[data-task-action="approve"]').count(), 0, 'staff cannot approve requests');
  await engineerPage.locator('[data-task-action="transition"]').click();
  await engineerPage.waitForFunction(() => window.__taskFixture.records[0].status === 'In-Progress');
  assert.equal((await engineerPage.evaluate(() => window.__taskFixture.calls.at(-1).body)).status, 'In-Progress');
  await engineerPage.locator('[data-task-action="transition"]').click();
  await engineerPage.waitForFunction(() => window.__taskFixture.records[0].status === 'Completed');
  assert.equal((await engineerPage.evaluate(() => window.__taskFixture.calls.at(-1).body)).status, 'Completed');
  await engineerPage.locator('[data-task-history]').click();
  assert.match(await engineerPage.locator('[data-task-history-content]').innerText(), /Accounts/);
  const dimensions = await engineerPage.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.body <= dimensions.width && dimensions.document <= dimensions.width, `task board overflows at mobile width: ${JSON.stringify(dimensions)}`);

  const failedActions = [
    { taskId: 'task-failed-approve', status: 'Pending approval', action: 'approve', upn: accounts.upn, manager: true },
    { taskId: 'task-failed-assign', status: 'To-Do', action: 'assign', upn: accounts.upn, manager: true },
    { taskId: 'task-failed-cancel', status: 'In-Progress', action: 'cancel', upn: accounts.upn, manager: true },
    { taskId: 'task-failed-transition', status: 'To-Do', action: 'transition', upn: user.upn, manager: false }
  ];
  for (const fixture of failedActions) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    pages.push(page);
    const task = {
      taskId: fixture.taskId,
      title: `Confirmed ${fixture.action} task`,
      requesterName: 'Worker',
      requesterUpn: user.upn,
      jobReference: 'GMT-FAILURE',
      status: fixture.status,
      priority: 'Normal',
      dueDate: '2026-10-24',
      requestedAssigneeUpn: user.upn,
      assigneeUpn: user.upn,
      sharePointItemId: `sp-${fixture.taskId}`
    };
    await mount(page, {
      access: { actorUpn: fixture.upn, canManage: fixture.manager, staff: [engineer, otherEngineer] },
      pending: [],
      records: [task]
    });
    await page.evaluate(() => { window.__taskFixture.failNextAction = true; });
    if (fixture.action === 'assign') await page.locator('[data-task-assignee]').selectOption(otherEngineer.upn);
    const selector = fixture.action === 'transition' ? '[data-task-action="transition"]' : `[data-task-action="${fixture.action}"]`;
    await page.locator(selector).click();
    await page.waitForFunction(() => window.__taskFixture.pending.length === 1);
    assert.equal(await page.evaluate(() => window.__taskFixture.records[0].status), fixture.status, `${fixture.action} failure leaves the confirmed record status unchanged`);
    const taskCard = page.locator(`[data-task-card="${fixture.taskId}"]`);
    const text = await taskCard.innerText();
    const confirmedStatusLabel = fixture.status === 'Pending approval'
      ? 'Awaiting Accounts or Operations approval.'
      : `SharePoint item sp-${fixture.taskId} · ${fixture.status}`;
    assert.ok(text.includes(confirmedStatusLabel), `${fixture.action} failure keeps the confirmed status on screen`);
    assert.match(text, /Temporary sync failure/, `${fixture.action} failure is exposed on the card`);
  }

  console.log('Task board empty/populated states, protected actions, same-ID retry, history, and 390px layout: PASS');
} finally {
  await Promise.all(pages.map((page) => page.close()));
  await browser.close();
}
