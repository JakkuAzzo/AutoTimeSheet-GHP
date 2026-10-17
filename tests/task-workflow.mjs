import assert from 'node:assert/strict';

const loadedWorkflow = await import('../cloudflare-worker/src/task-workflow.js').catch(() => null);
assert.ok(loadedWorkflow, 'task workflow policy must be available to the protected Worker');
const { normalizeTaskRequest, applyTaskAction, canReadTask, executeTaskOperation, handleTaskWorkflowRequest, taskWorkflowUrl } = loadedWorkflow;
assert.equal(typeof handleTaskWorkflowRequest, 'function', 'task board API must enforce the lifecycle around Microsoft 365 calls');
assert.equal(typeof taskWorkflowUrl, 'function', 'task workflow must validate its protected Power Automate destination');
assert.throws(() => taskWorkflowUrl({}), { status: 503 });
assert.throws(() => taskWorkflowUrl({ TASK_WORKFLOW_URL: 'http://localhost/task-flow' }), { status: 503 });
assert.equal(taskWorkflowUrl({ TASK_WORKFLOW_URL: 'https://org.environment.api.powerplatform.com/flow' }).host, 'org.environment.api.powerplatform.com');

const engineer = { oid: 'engineer-oid', upn: 'engineer@gmt-services.co.uk', name: 'Engineer', isAdmin: false, isOperationsAdmin: false };
const otherEngineer = { oid: 'other-oid', upn: 'other@gmt-services.co.uk', name: 'Other Engineer', isAdmin: false, isOperationsAdmin: false };
const stranger = { oid: 'stranger-oid', upn: 'stranger@gmt-services.co.uk', name: 'Stranger', isAdmin: false, isOperationsAdmin: false };
const accounts = { oid: 'accounts-oid', upn: 'accounts@gmt-services.co.uk', name: 'Accounts', isAdmin: true, isOperationsAdmin: true };
const directory = [
  { name: 'Engineer', upn: engineer.upn },
  { name: 'Other Engineer', upn: otherEngineer.upn }
];

const task = normalizeTaskRequest({
  taskId: 'task-001', actionId: 'action-request-001', title: 'Inspect pump', jobReference: 'GMT-001',
  requestedAssigneeUpn: otherEngineer.upn, dueDate: '2026-10-20', priority: 'High', status: 'Completed', assigneeUpn: accounts.upn
}, engineer, directory, '2026-10-16T12:00:00.000Z');
assert.equal(task.status, 'Pending approval', 'requester input cannot set approval status');
assert.equal(task.assigneeUpn, '', 'requester cannot assign an approved task');
assert.equal(task.requestedAssigneeUpn, otherEngineer.upn, 'requested assignee is retained as a suggestion');
assert.equal(task.requesterUpn, engineer.upn);
assert.equal(task.dueDate, '2026-10-20');
assert.equal(task.priority, 'High');

const approved = applyTaskAction(task, {
  actionId: 'action-approve-001', action: 'approve', assigneeUpn: otherEngineer.upn, dueDate: '2026-10-22', priority: 'Urgent'
}, accounts, directory, '2026-10-16T12:05:00.000Z');
assert.equal(approved.task.status, 'To-Do');
assert.equal(approved.task.assigneeUpn, otherEngineer.upn);
assert.equal(approved.task.dueDate, '2026-10-22');
assert.equal(approved.task.priority, 'Urgent');
assert.equal(approved.event.action, 'approve');
const approvedUnassigned = applyTaskAction(task, {
  actionId: 'action-approve-unassigned', action: 'approve', assigneeUpn: ''
}, accounts, directory);
assert.equal(approvedUnassigned.task.assigneeUpn, '', 'an explicit Unassigned approval clears the requester suggestion');

assert.throws(() => applyTaskAction(task, { actionId: 'action-bad-approve', action: 'approve' }, engineer, directory), { status: 403 });
assert.throws(() => applyTaskAction(task, { actionId: 'action-bad-assign', action: 'assign', assigneeUpn: otherEngineer.upn }, engineer, directory), { status: 403 });

const inProgress = applyTaskAction(approved.task, {
  actionId: 'action-progress-001', action: 'transition', status: 'In-Progress'
}, otherEngineer, directory, '2026-10-16T12:10:00.000Z');
assert.equal(inProgress.task.status, 'In-Progress');
assert.throws(() => applyTaskAction(approved.task, {
  actionId: 'action-other-progress', action: 'transition', status: 'In-Progress'
}, engineer, directory), { status: 403 });
assert.throws(() => applyTaskAction(task, {
  actionId: 'action-skip-progress', action: 'transition', status: 'Completed'
}, accounts, directory), { status: 409 });

const requesterCancelled = applyTaskAction(task, { actionId: 'action-cancel-001', action: 'cancel' }, engineer, directory);
assert.equal(requesterCancelled.task.status, 'Cancelled');
assert.equal(canReadTask(task, engineer), true);
assert.equal(canReadTask(approved.task, otherEngineer), true);
assert.equal(canReadTask(approved.task, accounts), true);
assert.equal(canReadTask(approved.task, engineer), true, 'the requester retains read access after approval');
assert.equal(canReadTask(approved.task, { oid: 'stranger', upn: 'stranger@gmt-services.co.uk', isAdmin: false, isOperationsAdmin: false }), false);

class MemoryTaskStore {
  operations = new Map();
  committed = [];
  tasks = new Map();
  events = new Map();
  async get(actionId) { return this.operations.get(actionId) || null; }
  async enqueue(operation) { this.operations.set(operation.actionId, { ...operation, status: 'queued', attempts: 0 }); }
  async fail(actionId, message) {
    const item = this.operations.get(actionId);
    item.status = 'failed'; item.attempts += 1; item.lastError = message;
  }
  async claim(actionId, signature, staleBefore, claimedAt) {
    const item = this.operations.get(actionId);
    if (!item || item.signature !== signature || item.status === 'synced') return false;
    if (item.status === 'queued' && item.updatedAt >= staleBefore) return false;
    item.status = 'queued'; item.updatedAt = claimedAt;
    return true;
  }
  async commit(actionId, result) {
    const item = this.operations.get(actionId);
    item.status = 'synced'; item.response = result; item.attempts += 1;
    this.committed.push(actionId);
    this.tasks.set(result.task.taskId, result.task);
    if (item.payload.event) {
      const history = this.events.get(result.task.taskId) || [];
      history.push({ ...item.payload.event, details: { changes: item.payload.event.changes, reason: item.payload.event.reason }, createdAt: item.payload.event.occurredAt });
      this.events.set(result.task.taskId, history);
    }
  }
  async getTask(taskId) { return this.tasks.get(taskId) || null; }
  async history(taskId) { return this.events.get(taskId) || []; }
  async pending(identity, includeAll = false) {
    const staleBefore = Date.now() - 60_000;
    return [...this.operations.values()].filter((item) => (item.status === 'failed' || (item.status === 'queued' && Date.parse(item.updatedAt || 0) < staleBefore))
      && (includeAll || item.actorOid === identity.oid));
  }
}

const store = new MemoryTaskStore();
const flowCalls = [];
const requestOperation = {
  taskId: 'task-002', actionId: 'action-request-002', action: 'request', actor: engineer,
  task: normalizeTaskRequest({ taskId: 'task-002', actionId: 'action-request-002', title: 'Inspect fan', dueDate: '', priority: 'Normal' }, engineer, directory)
};
const sync = async (operation) => {
  flowCalls.push({ taskId: operation.taskId, actionId: operation.actionId });
  return { success: true, taskId: operation.taskId, sharePointItemId: 'sharepoint-item-2', status: 'Pending approval', outlookEventId: '', calendarSyncStatus: 'not-required' };
};
const firstResult = await executeTaskOperation({ operation: requestOperation, store, sync });
const retryResult = await executeTaskOperation({ operation: requestOperation, store, sync });
assert.equal(firstResult.sync.status, 'synced');
assert.equal(retryResult.sync.status, 'synced');
assert.equal(flowCalls.length, 1, 'repeating a successful action must not call Microsoft 365 again');
assert.deepEqual(store.committed, ['action-request-002'], 'a duplicate action must not append activity twice');

const retryStore = new MemoryTaskStore();
const retryCalls = [];
const sameAction = {
  taskId: 'task-003', actionId: 'action-request-003', action: 'request', actor: engineer,
  task: normalizeTaskRequest({ taskId: 'task-003', actionId: 'action-request-003', title: 'Check motor', dueDate: '', priority: 'Normal' }, engineer, directory)
};
await assert.rejects(executeTaskOperation({ operation: sameAction, store: retryStore, sync: async (operation) => {
  retryCalls.push({ taskId: operation.taskId, actionId: operation.actionId });
  throw new Error('timeout');
} }), { status: 502 });
assert.equal(retryStore.operations.get('action-request-003').status, 'failed');
const recovered = await executeTaskOperation({ operation: sameAction, store: retryStore, sync: async (operation) => {
  retryCalls.push({ taskId: operation.taskId, actionId: operation.actionId });
  return { success: true, taskId: operation.taskId, sharePointItemId: 'sharepoint-item-3', status: 'Pending approval', outlookEventId: '', calendarSyncStatus: 'not-required' };
} });
assert.equal(recovered.sync.status, 'synced');
assert.deepEqual(retryCalls, [
  { taskId: 'task-003', actionId: 'action-request-003' },
  { taskId: 'task-003', actionId: 'action-request-003' }
], 'retry must send the same task and operation IDs');
assert.deepEqual(retryStore.committed, ['action-request-003']);

const staleQueueStore = new MemoryTaskStore();
await assert.rejects(executeTaskOperation({ operation: sameAction, store: staleQueueStore, sync: async () => { throw new Error('worker stopped'); } }), { status: 502 });
const staleEntry = staleQueueStore.operations.get('action-request-003');
staleEntry.status = 'queued';
staleEntry.updatedAt = '2026-10-16T10:00:00.000Z';
let staleQueueCalls = 0;
const recoveredStaleQueue = await executeTaskOperation({
  operation: sameAction,
  store: staleQueueStore,
  now: '2026-10-16T10:02:00.000Z',
  sync: async (operation) => {
    staleQueueCalls += 1;
    return { success: true, taskId: operation.taskId, sharePointItemId: 'sharepoint-stale-queue', status: 'Pending approval', calendarSyncStatus: 'not-required' };
  }
});
assert.equal(recoveredStaleQueue.sync.status, 'synced', 'an abandoned queued operation can be reclaimed after its lease expires');
assert.equal(staleQueueCalls, 1);

const boardStore = new MemoryTaskStore();
const boardTasks = new Map();
const boardCalls = [];
const boardTaskEvents = new Map();
let boardCalendarCreates = 0;
const boardWorkflow = async (operation) => {
  boardCalls.push(operation);
  if (operation.action === 'list') return { success: true, tasks: [...boardTasks.values()] };
  if (operation.action === 'get') return { success: true, task: boardTasks.get(operation.taskId) };
  assert.equal(operation.action, 'upsert');
  boardTasks.set(operation.taskId, { ...operation.task, sharePointItemId: `sharepoint-${operation.taskId}`, status: operation.task.status });
  if (operation.task.status === 'To-Do' && operation.task.dueDate && !boardTaskEvents.has(operation.taskId)) {
    boardCalendarCreates += 1;
    boardTaskEvents.set(operation.taskId, `outlook-${operation.taskId}`);
  }
  const outlookEventId = boardTaskEvents.get(operation.taskId) || '';
  return {
    success: true, taskId: operation.taskId, sharePointItemId: `sharepoint-${operation.taskId}`,
    status: operation.task.status, outlookEventId, calendarSyncStatus: outlookEventId ? 'synced' : 'not-required'
  };
};
const request = (path, method, body) => new Request(`https://worker.example${path}`, {
  method,
  headers: { 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {})
});

boardTasks.set('task-visible', {
  taskId: 'task-visible', requesterUpn: engineer.upn, title: 'Requester task', status: 'Pending approval',
  priority: 'Normal', dueDate: '', assigneeUpn: ''
});
boardTasks.set('task-assigned', {
  taskId: 'task-assigned', requesterUpn: accounts.upn, title: 'Assigned task', status: 'To-Do',
  priority: 'High', dueDate: '2026-10-20', assigneeUpn: engineer.upn
});
boardTasks.set('task-hidden', {
  taskId: 'task-hidden', requesterUpn: otherEngineer.upn, title: 'Other person task', status: 'Pending approval',
  priority: 'Low', dueDate: '', assigneeUpn: ''
});
const engineerBoard = await handleTaskWorkflowRequest(request('/api/tasks', 'GET'), {
  identity: engineer, directory, store: boardStore, workflow: boardWorkflow
});
assert.deepEqual(engineerBoard.body.records.map((item) => item.taskId).sort(), ['task-assigned', 'task-visible']);
assert.equal(engineerBoard.body.access.canApprove, false);
assert.equal(engineerBoard.body.access.staff.length, 0);

const submitResult = await handleTaskWorkflowRequest(request('/api/tasks', 'POST', {
  taskId: 'task-api-create', actionId: 'action-api-create', title: 'Replace belt',
  requestedAssigneeUpn: otherEngineer.upn, dueDate: '2026-10-25', priority: 'High', status: 'Completed', assigneeUpn: accounts.upn
}), { identity: engineer, directory, store: boardStore, workflow: boardWorkflow, timestamp: '2026-10-16T14:00:00.000Z' });
assert.equal(submitResult.status, 201);
assert.equal(submitResult.body.task.status, 'Pending approval');
assert.equal(submitResult.body.task.assigneeUpn, '');
assert.equal(boardTasks.get('task-api-create').status, 'Pending approval');

await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-api-create/actions', 'POST', {
  actionId: 'action-api-unauthorized', action: 'approve'
}), { identity: engineer, directory, store: boardStore, workflow: boardWorkflow }), { status: 403 });
assert.equal(boardCalls.some((call) => call.action === 'upsert' && call.actionId === 'action-api-unauthorized'), false);

const approvalPayload = {
  actionId: 'action-api-approve', action: 'approve', assigneeUpn: otherEngineer.upn, dueDate: '2026-10-26', priority: 'Urgent'
};
const approvalResult = await handleTaskWorkflowRequest(request('/api/tasks/task-api-create/actions', 'POST', approvalPayload), {
  identity: accounts, directory, store: boardStore, workflow: boardWorkflow, timestamp: '2026-10-16T14:10:00.000Z'
});
assert.equal(approvalResult.body.task.status, 'To-Do');
assert.equal(approvalResult.body.task.assigneeUpn, otherEngineer.upn);
assert.equal(approvalResult.body.task.dueDate, '2026-10-26');
assert.equal(approvalResult.body.task.priority, 'Urgent');
const upsertsAfterApproval = boardCalls.filter((call) => call.action === 'upsert').length;
const duplicateApproval = await handleTaskWorkflowRequest(request('/api/tasks/task-api-create/actions', 'POST', approvalPayload), {
  identity: accounts, directory, store: boardStore, workflow: boardWorkflow
});
assert.equal(duplicateApproval.body.task.status, 'To-Do');
assert.equal(boardCalls.filter((call) => call.action === 'upsert').length, upsertsAfterApproval, 'repeating the same action ID and input returns the prior outcome without repeating the Microsoft 365 update');
assert.equal(approvalResult.body.calendar.outlookEventId, 'outlook-task-api-create', 'approving a dated task returns the event ID created by the calendar flow');
const scheduleResult = await handleTaskWorkflowRequest(request('/api/tasks/task-api-create/actions', 'POST', {
  actionId: 'action-api-schedule', action: 'schedule', dueDate: '2026-10-27', priority: 'High'
}), { identity: accounts, directory, store: boardStore, workflow: boardWorkflow });
assert.equal(scheduleResult.body.calendar.outlookEventId, approvalResult.body.calendar.outlookEventId, 'rescheduling reuses the stored Outlook event ID');
assert.equal(boardCalendarCreates, 1, 'rescheduling does not create a second Outlook event');
const cancelResult = await handleTaskWorkflowRequest(request('/api/tasks/task-api-create/actions', 'POST', {
  actionId: 'action-api-cancel', action: 'cancel', reason: 'Work no longer needed'
}), { identity: accounts, directory, store: boardStore, workflow: boardWorkflow });
assert.equal(cancelResult.body.task.status, 'Cancelled');
assert.equal(cancelResult.body.calendar.outlookEventId, approvalResult.body.calendar.outlookEventId, 'cancellation retains the existing calendar event for audit');
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-api-create/actions', 'POST', {
  ...approvalPayload, priority: 'Low'
}), { identity: accounts, directory, store: boardStore, workflow: boardWorkflow }), { status: 409 });
const historyResult = await handleTaskWorkflowRequest(request('/api/tasks/task-api-create/history', 'GET'), {
  identity: engineer, directory, store: boardStore, workflow: boardWorkflow
});
assert.equal(historyResult.body.events.length, 4, 'request, approval, scheduling, and cancellation are retained in history');
assert.equal(historyResult.body.events[1].actorUpn, accounts.upn);
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-api-create/history', 'GET'), {
  identity: stranger, directory, store: boardStore, workflow: boardWorkflow
}), { status: 403 });
boardTasks.set('task-api-create', {
  ...boardTasks.get('task-api-create'), requesterUpn: accounts.upn, assigneeUpn: otherEngineer.upn
});
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-api-create/history', 'GET'), {
  identity: engineer, directory, store: boardStore, workflow: boardWorkflow
}), { status: 403 }, 'a stale local mirror must not preserve history access after M365 reassigns the task');

const retryAccessStore = new MemoryTaskStore();
const previouslyAssigned = { ...approved.task, taskId: 'task-retry-access', requesterUpn: accounts.upn, assigneeUpn: otherEngineer.upn };
const previousAction = applyTaskAction(previouslyAssigned, {
  actionId: 'action-retry-access', action: 'assign', assigneeUpn: engineer.upn
}, accounts, directory);
const previousOperation = {
  taskId: previouslyAssigned.taskId, actionId: previousAction.event.actionId, action: previousAction.event.action,
  actor: accounts, task: previousAction.task, event: previousAction.event
};
await assert.rejects(executeTaskOperation({ operation: previousOperation, store: retryAccessStore, sync: async () => { throw new Error('timeout'); } }), { status: 502 });
boardTasks.set('task-retry-access', { ...previouslyAssigned, assigneeUpn: otherEngineer.upn });
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-retry-access/actions', 'POST', {
  actionId: 'action-retry-access', action: 'retry'
}), { identity: engineer, directory, store: retryAccessStore, workflow: boardWorkflow }), { status: 403 },
'a former assignee must not retry a failed action using stale task ownership');

const revokedRoleStore = new MemoryTaskStore();
const revokedRoleTask = {
  taskId: 'task-revoked-role', requesterUpn: accounts.upn, requesterName: accounts.name,
  title: 'Role-revoked approval', status: 'Pending approval', priority: 'Normal', dueDate: '', assigneeUpn: ''
};
let retryActor;
const revokedRoleWorkflow = async (operation) => {
  if (operation.action === 'get') return { success: true, task: revokedRoleTask };
  if (operation.action === 'upsert') {
    if (operation.actor.oid === accounts.oid) throw new Error('temporary flow failure');
    retryActor = operation.actor;
    return { success: true, taskId: operation.taskId, sharePointItemId: 'sp-revoked-role', status: operation.task.status, calendarSyncStatus: 'not-required' };
  }
  return { success: true, tasks: [revokedRoleTask] };
};
const revokedApproval = { actionId: 'action-revoked-role', action: 'approve', assigneeUpn: '' };
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-revoked-role/actions', 'POST', revokedApproval), {
  identity: accounts, directory, store: revokedRoleStore, workflow: revokedRoleWorkflow
}), { status: 502 });
const demotedAccounts = { ...accounts, isAdmin: false, isOperationsAdmin: false };
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-revoked-role/actions', 'POST', {
  actionId: revokedApproval.actionId, action: 'retry'
}), { identity: demotedAccounts, directory, store: revokedRoleStore, workflow: revokedRoleWorkflow }), { status: 403 },
'a former manager who remains the requester must not retry a failed manager-only approval');
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-revoked-role/actions', 'POST', revokedApproval), {
  identity: demotedAccounts, directory, store: revokedRoleStore, workflow: revokedRoleWorkflow
}), { status: 403 }, 'the duplicate-action replay path must also recheck current manager access');
const currentManager = { oid: 'current-manager-oid', upn: 'ops@gmt-services.co.uk', name: 'Current Manager', isAdmin: false, isOperationsAdmin: true };
const authorizedRetry = await handleTaskWorkflowRequest(request('/api/tasks/task-revoked-role/actions', 'POST', {
  actionId: revokedApproval.actionId, action: 'retry'
}), { identity: currentManager, directory, store: revokedRoleStore, workflow: revokedRoleWorkflow });
assert.equal(authorizedRetry.body.sync.status, 'synced');
assert.equal(retryActor.oid, currentManager.oid, 'a manager retry uses the current delegated identity for the Flow call');
assert.equal(authorizedRetry.body.task.status, 'To-Do');

const duplicateOwnershipStore = new MemoryTaskStore();
const ownershipTasks = new Map([['task-duplicate-ownership', {
  taskId: 'task-duplicate-ownership', requesterUpn: accounts.upn, title: 'Restricted task', status: 'To-Do',
  priority: 'Normal', dueDate: '', assigneeUpn: engineer.upn, sharePointItemId: 'sp-restricted'
}]]);
const ownershipWorkflow = async (operation) => {
  if (operation.action === 'get') return { success: true, task: ownershipTasks.get(operation.taskId) };
  if (operation.action === 'upsert') {
    ownershipTasks.set(operation.taskId, { ...operation.task, sharePointItemId: 'sp-restricted' });
    return { success: true, taskId: operation.taskId, sharePointItemId: 'sp-restricted', status: operation.task.status, calendarSyncStatus: 'not-required' };
  }
  return { success: true, tasks: [...ownershipTasks.values()] };
};
const progressPayload = { actionId: 'action-former-assignee', action: 'transition', status: 'In-Progress' };
await handleTaskWorkflowRequest(request('/api/tasks/task-duplicate-ownership/actions', 'POST', progressPayload), {
  identity: engineer, directory, store: duplicateOwnershipStore, workflow: ownershipWorkflow
});
ownershipTasks.set('task-duplicate-ownership', { ...ownershipTasks.get('task-duplicate-ownership'), assigneeUpn: otherEngineer.upn });
await assert.rejects(handleTaskWorkflowRequest(request('/api/tasks/task-duplicate-ownership/actions', 'POST', progressPayload), {
  identity: engineer, directory, store: duplicateOwnershipStore, workflow: ownershipWorkflow
}), { status: 403 }, 'a successful idempotent replay must still check current Microsoft 365 task ownership');

console.log('Task API ownership, workflow routing, and protected history: PASS');

console.log('Task workflow policy, role access, history, and idempotent sync: PASS');
