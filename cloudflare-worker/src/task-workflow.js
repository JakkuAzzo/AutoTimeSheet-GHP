const TASK_STATUS = Object.freeze({
  PENDING: 'Pending approval',
  TODO: 'To-Do',
  IN_PROGRESS: 'In-Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
});

const TASK_PRIORITIES = new Set(['Low', 'Normal', 'High', 'Urgent']);
const TERMINAL_TASK_STATUSES = new Set([TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED]);
const TASK_BODY_MAX_BYTES = 32 * 1024;
const TASK_OPERATION_LEASE_MS = 60 * 1000;

function taskError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function taskWorkflowUrl(env = {}) {
  const raw = value(env.TASK_WORKFLOW_URL, 3000);
  if (!raw) throw taskError('The approved Microsoft 365 task workflow is not configured', 503);
  let target;
  try { target = new URL(raw); } catch (_) { throw taskError('The approved Microsoft 365 task workflow is not configured', 503); }
  const host = target.hostname.toLowerCase();
  const allowedHost = host.endsWith('.environment.api.powerplatform.com') || host.endsWith('.logic.azure.com');
  if (target.protocol !== 'https:' || !allowedHost || target.username || target.password) {
    throw taskError('The approved Microsoft 365 task workflow has an invalid destination', 503);
  }
  return target;
}

function value(input, max = 500) {
  return String(input == null ? '' : input).trim().slice(0, max);
}

function isoDate(input, label = 'Due date') {
  const candidate = value(input, 10);
  if (!candidate) return '';
  const match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw taskError(`${label} must use YYYY-MM-DD`, 400);
  const date = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== candidate) {
    throw taskError(`${label} must be a real calendar date`, 400);
  }
  return candidate;
}

function identityUpn(identity) {
  return value(identity?.upn, 320).toLowerCase();
}

function taskManager(identity) {
  return Boolean(identity?.isAdmin || identity?.isOperationsAdmin);
}

function directoryPerson(upn, directory) {
  const address = value(upn, 320).toLowerCase();
  if (!address) return null;
  const matches = Array.isArray(directory) ? directory : [];
  return matches.find((person) => value(person?.upn || person?.email, 320).toLowerCase() === address) || null;
}

function checkedPriority(input, fallback = 'Normal') {
  if (input === undefined || input === null || input === '') return fallback;
  const candidate = value(input, 40);
  if (!TASK_PRIORITIES.has(candidate)) throw taskError('Choose a valid task priority', 400);
  return candidate;
}

function checkedAssignee(input, directory, { required = false } = {}) {
  const address = value(input, 320).toLowerCase();
  if (!address && !required) return '';
  if (!address) throw taskError('Choose a staff member to assign this task', 400);
  const person = directoryPerson(address, directory);
  if (!person) throw taskError('The assignee must match the approved GMT staff directory', 400);
  return value(person.upn || person.email, 320).toLowerCase();
}

export function normalizeTaskRequest(body, identity, directory = [], timestamp = new Date().toISOString()) {
  const taskId = value(body?.taskId || body?.task_id, 180);
  const actionId = value(body?.actionId || body?.action_id, 180);
  const requesterUpn = identityUpn(identity);
  if (!/^task-[A-Za-z0-9][A-Za-z0-9._:-]{0,170}$/.test(taskId)) throw taskError('A stable task ID is required', 400);
  if (!/^action-[A-Za-z0-9][A-Za-z0-9._:-]{0,170}$/.test(actionId)) throw taskError('A stable task action ID is required', 400);
  if (!identity?.oid || !requesterUpn) throw taskError('A signed-in GMT identity is required', 401);
  const title = value(body?.title || body?.taskTitle, 500);
  if (!title) throw taskError('Enter a task title', 400);
  const requestedAssigneeUpn = checkedAssignee(body?.requestedAssigneeUpn || body?.requested_assignee_upn, directory);
  const dueDate = isoDate(body?.dueDate || body?.due_date || '');
  const priority = checkedPriority(body?.priority, 'Normal');
  return {
    taskId,
    actionId,
    action: 'request',
    title,
    jobReference: value(body?.jobReference || body?.job_reference, 180),
    requesterOid: value(identity.oid, 180),
    requesterUpn,
    requesterName: value(identity.name, 240) || requesterUpn,
    requestedAssigneeUpn,
    assigneeUpn: '',
    dueDate,
    priority,
    status: TASK_STATUS.PENDING,
    sharePointItemId: '',
    outlookEventId: '',
    calendarSyncStatus: 'not-required',
    calendarSyncError: '',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function canReadTask(task, identity) {
  if (!task || !identity) return false;
  if (taskManager(identity)) return true;
  const upn = identityUpn(identity);
  return Boolean(upn && (upn === value(task.requesterUpn, 320).toLowerCase()
    || upn === value(task.assigneeUpn, 320).toLowerCase()));
}

export function normalizeTaskRecord(source = {}) {
  const task = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const status = value(task.status || task['Status'], 40) || TASK_STATUS.PENDING;
  if (!Object.values(TASK_STATUS).includes(status)) throw taskError('Microsoft 365 returned an unsupported task status', 502);
  return {
    taskId: value(task.taskId || task.task_id || task.recordId || task.source_record_id || task['Task ID'], 180),
    requesterOid: value(task.requesterOid || task.requester_oid, 180),
    requesterUpn: value(task.requesterUpn || task.requester_upn || task.employee_upn || task['Requested By UPN'], 320).toLowerCase(),
    requesterName: value(task.requesterName || task.requester_name || task.employee_name || task['Requested By'], 240),
    title: value(task.title || task.task_title || task['Task Title'] || task.Title, 500),
    jobReference: value(task.jobReference || task.job_reference || task['Company / Job Ref'], 180),
    requestedAssigneeUpn: value(task.requestedAssigneeUpn || task.requested_assignee_upn, 320).toLowerCase(),
    assigneeUpn: value(task.assigneeUpn || task.assignee_upn || task['Assigned To UPN'], 320).toLowerCase(),
    assignee: value(task.assignee || task.assignee_name || task['Assigned To'], 240),
    dueDate: isoDate(task.dueDate || task.due_date || task['Due Date'] || ''),
    priority: checkedPriority(task.priority || task['Priority'], 'Normal'),
    status,
    sharePointItemId: value(task.sharePointItemId || task.sharepoint_item_id || task.id, 200),
    outlookEventId: value(task.outlookEventId || task.outlook_event_id || task['Outlook Event ID'], 500),
    calendarSyncStatus: value(task.calendarSyncStatus || task.calendar_sync_status || task['Calendar Sync Status'], 'pending'),
    calendarSyncError: value(task.calendarSyncError || task.calendar_sync_error || task['Calendar Sync Error'], 1000),
    createdAt: value(task.createdAt || task.created_at || task['Created At'], 80),
    updatedAt: value(task.updatedAt || task.updated_at || task['Updated At'], 80)
  };
}

export function taskRequestMatches(operation, body, identity, directory = []) {
  if (!operation?.task || !body) return false;
  try {
    const candidate = normalizeTaskRequest({ ...body, taskId: operation.taskId, actionId: operation.actionId }, identity, directory, operation.task.createdAt);
    return ['title', 'jobReference', 'requestedAssigneeUpn', 'dueDate', 'priority', 'requesterOid', 'requesterUpn']
      .every((key) => (candidate[key] || '') === (operation.task[key] || ''));
  } catch (_) {
    return false;
  }
}

function appendChanges(before, after) {
  const keys = ['status', 'assigneeUpn', 'dueDate', 'priority'];
  return Object.fromEntries(keys
    .filter((key) => (before[key] || '') !== (after[key] || ''))
    .map((key) => [key, { from: before[key] || '', to: after[key] || '' }]));
}

export function applyTaskAction(task, input, identity, directory = [], timestamp = new Date().toISOString()) {
  if (!task || !canReadTask(task, identity)) throw taskError('Task access is not permitted', 403);
  const actionId = value(input?.actionId || input?.action_id, 180);
  if (!/^action-[A-Za-z0-9][A-Za-z0-9._:-]{0,170}$/.test(actionId)) throw taskError('A stable task action ID is required', 400);
  const action = value(input?.action, 40).toLowerCase();
  const manager = taskManager(identity);
  const requester = identityUpn(identity) === value(task.requesterUpn, 320).toLowerCase();
  const assignee = identityUpn(identity) === value(task.assigneeUpn, 320).toLowerCase();
  const next = { ...task, updatedAt: timestamp };

  if (action === 'approve') {
    if (!manager) throw taskError('Task approval is restricted to Accounts and Operations', 403);
    if (task.status !== TASK_STATUS.PENDING) throw taskError('Only pending task requests can be approved', 409);
    next.status = TASK_STATUS.TODO;
    next.assigneeUpn = checkedAssignee(input.assigneeUpn === undefined ? task.requestedAssigneeUpn : input.assigneeUpn, directory);
    next.dueDate = isoDate(input.dueDate === undefined ? task.dueDate : input.dueDate);
    next.priority = checkedPriority(input.priority, task.priority);
  } else if (action === 'reject') {
    if (!manager) throw taskError('Task approval is restricted to Accounts and Operations', 403);
    if (task.status !== TASK_STATUS.PENDING) throw taskError('Only pending task requests can be rejected', 409);
    next.status = TASK_STATUS.CANCELLED;
    next.rejectionReason = value(input.reason, 1000);
  } else if (action === 'assign') {
    if (!manager) throw taskError('Task assignment is restricted to Accounts and Operations', 403);
    if (TERMINAL_TASK_STATUSES.has(task.status) || task.status === TASK_STATUS.PENDING) throw taskError('Only approved active tasks can be assigned', 409);
    next.assigneeUpn = checkedAssignee(input.assigneeUpn, directory, { required: true });
    next.dueDate = isoDate(input.dueDate === undefined ? task.dueDate : input.dueDate);
    next.priority = checkedPriority(input.priority, task.priority);
  } else if (action === 'schedule') {
    if (!manager) throw taskError('Task scheduling is restricted to Accounts and Operations', 403);
    if (TERMINAL_TASK_STATUSES.has(task.status)) throw taskError('Completed or cancelled tasks cannot be rescheduled', 409);
    next.dueDate = isoDate(input.dueDate === undefined ? task.dueDate : input.dueDate);
    next.priority = checkedPriority(input.priority, task.priority);
  } else if (action === 'transition') {
    if (!manager && !assignee) throw taskError('Only the assigned staff member or Accounts can update task progress', 403);
    const requestedStatus = value(input.status, 40);
    const allowed = (task.status === TASK_STATUS.TODO && requestedStatus === TASK_STATUS.IN_PROGRESS)
      || (task.status === TASK_STATUS.IN_PROGRESS && requestedStatus === TASK_STATUS.COMPLETED);
    if (!allowed) throw taskError('Task progress must move from To-Do to In-Progress to Completed', 409);
    next.status = requestedStatus;
  } else if (action === 'cancel') {
    const requesterMayCancel = requester && task.status === TASK_STATUS.PENDING;
    const managerMayCancel = manager && !TERMINAL_TASK_STATUSES.has(task.status);
    if (!requesterMayCancel && !managerMayCancel) throw taskError('Only the requester may cancel a pending task; Accounts may cancel active tasks', 403);
    next.status = TASK_STATUS.CANCELLED;
    next.cancellationReason = value(input.reason, 1000);
  } else {
    throw taskError('Task action is not supported', 400);
  }

  const changes = appendChanges(task, next);
  if (!Object.keys(changes).length && !['approve', 'reject', 'cancel'].includes(action)) {
    throw taskError('This task already has the requested values', 409);
  }
  return {
    task: next,
    event: {
      actionId,
      action,
      actorOid: value(identity.oid, 180),
      actorUpn: identityUpn(identity),
      actorName: value(identity.name, 240) || identityUpn(identity),
      occurredAt: timestamp,
      changes,
      reason: value(input.reason, 1000)
    }
  };
}

function operationSignature(operation) {
  return JSON.stringify({
    taskId: operation.taskId,
    actionId: operation.actionId,
    action: operation.action,
    task: operation.task,
    event: operation.event || null,
    input: operation.input || null,
    actorOid: value(operation.actor?.oid, 180)
  });
}

function validateFlowResult(result, operation) {
  if (!result || result.success !== true || value(result.taskId, 180) !== operation.taskId
      || !value(result.sharePointItemId, 200)
      || value(result.status, 40) !== value(operation.task?.status, 40)) {
    throw taskError('Microsoft 365 did not confirm the task update. Retry the same action.', 502);
  }
  const allowedCalendarStatuses = new Set(['not-required', 'synced', 'pending', 'failed']);
  const calendarSyncStatus = value(result.calendarSyncStatus, 40) || 'pending';
  if (!allowedCalendarStatuses.has(calendarSyncStatus)) throw taskError('Microsoft 365 returned an invalid calendar sync state', 502);
  return {
    success: true,
    taskId: operation.taskId,
    sharePointItemId: value(result.sharePointItemId, 200),
    status: value(result.status, 40),
    outlookEventId: value(result.outlookEventId, 500),
    calendarSyncStatus,
    calendarSyncError: value(result.calendarSyncError, 1000)
  };
}

export async function executeTaskOperation({ operation, store, sync, now = new Date().toISOString(), leaseMs = TASK_OPERATION_LEASE_MS }) {
  if (!operation?.taskId || !operation?.actionId || typeof store?.get !== 'function'
      || typeof store?.enqueue !== 'function' || typeof store?.commit !== 'function'
      || typeof store?.fail !== 'function' || typeof store?.claim !== 'function' || typeof sync !== 'function') {
    throw taskError('Task workflow operation is incomplete', 400);
  }
  const signature = operationSignature(operation);
  let existing = await store.get(operation.actionId);
  if (existing) {
    if (existing.taskId !== operation.taskId || existing.signature !== signature) {
      throw taskError('This task action ID was already used for a different update', 409);
    }
    if (existing.status === 'synced') return existing.response;
  } else {
    existing = await store.enqueue({
      taskId: operation.taskId,
      actionId: operation.actionId,
      action: operation.action,
      actorOid: value(operation.actor?.oid, 180),
      actorUpn: identityUpn(operation.actor),
      timestamp: value(operation.task?.updatedAt || operation.task?.createdAt || operation.event?.occurredAt, 80) || new Date().toISOString(),
      signature,
      payload: operation
    });
  }

  const claimedAt = new Date(now).toISOString();
  const staleBefore = new Date(new Date(claimedAt).valueOf() - Math.max(1000, Number(leaseMs) || TASK_OPERATION_LEASE_MS)).toISOString();
  if (!await store.claim(operation.actionId, signature, staleBefore, claimedAt)) {
    throw taskError('This task action is already being synchronized', 409);
  }

  try {
    const response = validateFlowResult(await sync(operation), operation);
    const result = {
      task: { ...operation.task, ...response },
      sync: { status: 'synced', sharePointItemId: response.sharePointItemId },
      calendar: {
        status: response.calendarSyncStatus,
        outlookEventId: response.outlookEventId,
        error: response.calendarSyncError
      }
    };
    await store.commit(operation.actionId, result);
    return result;
  } catch (error) {
    const message = value(error?.message, 500) || 'Microsoft 365 task synchronization failed';
    await store.fail(operation.actionId, message);
    throw Object.assign(new Error('Microsoft 365 task synchronization is not confirmed. Retry the same action.'), {
      status: 502,
      operationId: operation.actionId,
      syncStatus: 'failed'
    });
  }
}

function taskActor(identity) {
  return {
    oid: value(identity?.oid, 180),
    upn: identityUpn(identity),
    name: value(identity?.name, 240) || identityUpn(identity),
    isTaskManager: taskManager(identity)
  };
}

async function workflowTask(workflow, taskId, identity) {
  const result = await workflow({ action: 'get', taskId, actor: taskActor(identity) });
  if (!result || result.success !== true || !result.task) throw taskError('Microsoft 365 task could not be read', 502);
  const task = normalizeTaskRecord(result.task);
  if (task.taskId !== taskId) throw taskError('Microsoft 365 returned a different task', 502);
  return task;
}

function taskOperation(task, event, identity) {
  return {
    taskId: task.taskId,
    actionId: event.actionId,
    action: event.action,
    actor: identity,
    task,
    event
  };
}

function normalizeTaskActionInput(input = {}) {
  const normalized = {
    action: value(input.action, 40).toLowerCase(),
    reason: value(input.reason, 1000)
  };
  if (input.status !== undefined) normalized.status = value(input.status, 40);
  if (input.assigneeUpn !== undefined) normalized.assigneeUpn = value(input.assigneeUpn, 320).toLowerCase();
  if (input.dueDate !== undefined) normalized.dueDate = isoDate(input.dueDate);
  if (input.priority !== undefined) normalized.priority = checkedPriority(input.priority);
  return normalized;
}

function taskActionMatches(operation, body, identity) {
  if (!operation?.input || !body || operation.actor?.oid !== identity?.oid) return false;
  try {
    return JSON.stringify(operation.input) === JSON.stringify(normalizeTaskActionInput(body));
  } catch (_) {
    return false;
  }
}

function canRetryTaskOperation(operation, currentTask, identity, originalActorOid) {
  if (taskManager(identity)) return true;
  if (value(originalActorOid, 180) !== value(identity?.oid, 180)) return false;
  if (operation?.action === 'request') return true;
  if (!currentTask || !canReadTask(currentTask, identity)) return false;

  const upn = identityUpn(identity);
  if (operation.action === 'transition') return upn === value(currentTask.assigneeUpn, 320).toLowerCase();
  if (operation.action === 'cancel') {
    return upn === value(currentTask.requesterUpn, 320).toLowerCase()
      && currentTask.status === TASK_STATUS.PENDING;
  }
  return false;
}

async function taskRequestBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > TASK_BODY_MAX_BYTES) throw taskError('Request is too large', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > TASK_BODY_MAX_BYTES) throw taskError('Request is too large', 413);
  try {
    const body = JSON.parse(text || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object expected');
    return body;
  } catch (_) {
    throw taskError('Request body must be valid JSON', 400);
  }
}

function historyView(events) {
  return (Array.isArray(events) ? events : []).map((event) => ({
    actionId: event.actionId,
    actorUpn: event.actorUpn,
    actorName: event.actorName,
    action: event.action,
    oldStatus: event.oldStatus,
    newStatus: event.newStatus,
    changes: event.details?.changes || event.changes || {},
    reason: event.details?.reason || event.reason || '',
    createdAt: event.createdAt || event.occurredAt
  }));
}

export async function handleTaskWorkflowRequest(request, { identity, directory = [], store, workflow, timestamp = new Date().toISOString() } = {}) {
  if (!identity?.oid || !identityUpn(identity)) throw taskError('A signed-in GMT identity is required', 401);
  if (!store || typeof store.get !== 'function' || typeof workflow !== 'function') throw taskError('Protected task workflow is not configured', 503);
  const url = new URL(request.url);
  const actor = taskActor(identity);
  const manager = taskManager(identity);

  if (url.pathname === '/api/tasks' && request.method === 'GET') {
    const result = await workflow({ action: 'list', actor });
    if (!result || result.success !== true || !Array.isArray(result.tasks)) throw taskError('Microsoft 365 task history is unavailable', 502);
    const records = result.tasks.map(normalizeTaskRecord).filter((task) => task.taskId && canReadTask(task, identity));
    const pending = typeof store.pending === 'function' ? await store.pending(identity, manager) : [];
    const visibleTaskIds = new Set(records.map((task) => task.taskId));
    const visiblePending = pending.filter((item) => {
      if (manager) return true;
      if (item.actorOid !== identity.oid) return false;
      if (item.action === 'request') return canReadTask(item.payload?.task, identity);
      return visibleTaskIds.has(item.taskId);
    });
    return {
      status: 200,
      body: {
        ok: true,
        records,
        access: {
          canManage: manager,
          canApprove: manager,
          canAssign: manager,
          actorUpn: identityUpn(identity),
          staff: manager ? directory.map((person) => ({ name: value(person.name, 240), upn: value(person.upn, 320).toLowerCase() })).filter((person) => person.upn) : []
        },
        pending: visiblePending.map((item) => ({
          taskId: item.taskId,
          actionId: item.actionId,
          action: item.action,
          attempts: item.attempts,
          error: item.error,
          updatedAt: item.updatedAt,
          task: item.payload?.task ? normalizeTaskRecord(item.payload.task) : null
        }))
      }
    };
  }

  if (url.pathname === '/api/tasks' && request.method === 'POST') {
    const body = await taskRequestBody(request);
    const actionId = value(body.actionId || body.action_id, 180);
    const previous = await store.get(actionId);
    let operation;
    if (previous) {
      if (previous.actorOid !== identity.oid || !taskRequestMatches(previous.payload, body, identity, directory)) {
        throw taskError('This task action ID was already used for a different request', 409);
      }
      operation = previous.payload;
    } else {
      const task = normalizeTaskRequest(body, identity, directory, timestamp);
      const event = {
        actionId: task.actionId,
        action: 'request',
        actorOid: identity.oid,
        actorUpn: identityUpn(identity),
        actorName: actor.name,
        occurredAt: timestamp,
        changes: { status: { from: '', to: TASK_STATUS.PENDING } },
        reason: ''
      };
      operation = taskOperation(task, event, identity);
    }
    const result = await executeTaskOperation({
      operation,
      store,
      sync: (value) => workflow({ action: 'upsert', taskId: value.taskId, actionId: value.actionId, task: value.task, event: value.event, actor: taskActor(value.actor) })
    });
    return { status: previous ? 200 : 201, body: { ok: true, ...result } };
  }

  const historyMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/history$/);
  if (historyMatch && request.method === 'GET') {
    const taskId = decodeURIComponent(historyMatch[1]);
    const task = await workflowTask(workflow, taskId, identity);
    if (!canReadTask(task, identity)) throw taskError('Task access is not permitted', 403);
    const events = typeof store.history === 'function' ? await store.history(taskId) : [];
    return { status: 200, body: { ok: true, task, events: historyView(events) } };
  }

  const actionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/actions$/);
  if (actionMatch && request.method === 'POST') {
    const taskId = decodeURIComponent(actionMatch[1]);
    const body = await taskRequestBody(request);
    const actionId = value(body.actionId || body.action_id, 180);
    if (value(body.action).toLowerCase() === 'retry') {
      const previous = await store.get(actionId);
      if (!previous || previous.taskId !== taskId) throw taskError('Task retry was not found', 404);
      if (!taskManager(identity) && previous.actorOid !== identity.oid) throw taskError('Task retry is not permitted', 403);
      let currentTask = null;
      if (previous.action !== 'request') {
        currentTask = await workflowTask(workflow, taskId, identity);
        if (!canReadTask(currentTask, identity)) throw taskError('Task access is not permitted', 403);
      }
      if (previous.status !== 'synced' && !canRetryTaskOperation(previous.payload, currentTask, identity, previous.actorOid)) {
        throw taskError('Task retry is not permitted', 403);
      }
      const result = await executeTaskOperation({
        operation: previous.payload,
        store,
        sync: (value) => workflow({ action: 'upsert', taskId: value.taskId, actionId: value.actionId, task: value.task, event: value.event, actor: taskActor(identity) })
      });
      return { status: 200, body: { ok: true, ...result } };
    }
    const previous = await store.get(actionId);
    if (previous) {
      if (previous.taskId !== taskId || !taskActionMatches(previous.payload, body, identity)) {
        throw taskError('This task action ID was already used for a different update', 409);
      }
      const currentTask = await workflowTask(workflow, taskId, identity);
      if (!canReadTask(currentTask, identity)) throw taskError('Task access is not permitted', 403);
      if (previous.status !== 'synced' && !canRetryTaskOperation(previous.payload, currentTask, identity, previous.actorOid)) {
        throw taskError('Task retry is not permitted', 403);
      }
      const result = await executeTaskOperation({
        operation: previous.payload,
        store,
        sync: (value) => workflow({ action: 'upsert', taskId: value.taskId, actionId: value.actionId, task: value.task, event: value.event, actor: taskActor(identity) })
      });
      return { status: 200, body: { ok: true, ...result } };
    }
    const task = await workflowTask(workflow, taskId, identity);
    if (!canReadTask(task, identity)) throw taskError('Task access is not permitted', 403);
    const transition = applyTaskAction(task, body, identity, directory, timestamp);
    const operation = { ...taskOperation(transition.task, transition.event, identity), input: normalizeTaskActionInput(body) };
    const result = await executeTaskOperation({
      operation,
      store,
      sync: (value) => workflow({ action: 'upsert', taskId: value.taskId, actionId: value.actionId, task: value.task, event: value.event, actor: taskActor(value.actor) })
    });
    return { status: 200, body: { ok: true, ...result } };
  }

  throw taskError('Task workflow route not found', 404);
}

function parseObjectJson(input) {
  try {
    const parsed = JSON.parse(input || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function taskFromRow(row) {
  if (!row) return null;
  return {
    taskId: row.task_id,
    requesterOid: row.requester_oid,
    requesterUpn: row.requester_upn,
    requesterName: row.requester_name,
    title: row.title,
    jobReference: row.job_reference || '',
    requestedAssigneeUpn: row.requested_assignee_upn || '',
    assigneeUpn: row.assignee_upn || '',
    dueDate: row.due_date || '',
    priority: row.priority || 'Normal',
    status: row.status,
    sharePointItemId: row.sharepoint_item_id || '',
    outlookEventId: row.outlook_event_id || '',
    calendarSyncStatus: row.calendar_sync_status || 'pending',
    calendarSyncError: row.calendar_sync_error || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

export function createTaskWorkflowStore(DB) {
  if (!DB || typeof DB.prepare !== 'function') throw taskError('Protected task storage is not configured', 503);
  const get = async (actionId) => {
    const row = await DB.prepare('SELECT * FROM task_workflow_outbox WHERE action_id = ?').bind(actionId).first();
    if (!row) return null;
    return {
      taskId: row.task_id,
      actionId: row.action_id,
      action: row.action,
      actorOid: row.actor_oid,
      actorUpn: row.actor_upn,
      signature: row.signature,
      status: row.status,
      attempts: Number(row.attempts || 0),
      lastError: row.last_error || '',
      response: row.response_json ? parseObjectJson(row.response_json) : null,
      payload: parseObjectJson(row.payload_json)
    };
  };
  return {
    get,
    async enqueue(operation) {
      await DB.prepare(`INSERT OR IGNORE INTO task_workflow_outbox
        (action_id, task_id, action, actor_oid, actor_upn, signature, status, attempts, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'failed', 0, ?, ?, ?)`)
        .bind(operation.actionId, operation.taskId, operation.action, operation.actorOid, operation.actorUpn,
          operation.signature, JSON.stringify(operation.payload), operation.timestamp, operation.timestamp).run();
      return get(operation.actionId);
    },
    async claim(actionId, signature, staleBefore, claimedAt) {
      const result = await DB.prepare(`UPDATE task_workflow_outbox SET status='queued', updated_at=?
        WHERE action_id=? AND signature=? AND (status='failed' OR (status='queued' AND updated_at < ?))`)
        .bind(claimedAt, actionId, signature, staleBefore).run();
      return Number(result?.meta?.changes || 0) === 1;
    },
    async fail(actionId, message) {
      await DB.prepare(`UPDATE task_workflow_outbox SET status = 'failed', attempts = attempts + 1,
        last_error = ?, updated_at = ? WHERE action_id = ? AND status <> 'synced'`)
        .bind(value(message, 500), new Date().toISOString(), actionId).run();
    },
    async commit(actionId, result) {
      const outbox = await get(actionId);
      if (!outbox) throw taskError('Task workflow operation was not found', 409);
      const operation = outbox.payload;
      const task = result.task;
      const event = operation.event;
      const timestamp = value(task.updatedAt, 80) || new Date().toISOString();
      const statements = [DB.prepare(`INSERT INTO tasks
        (task_id, requester_oid, requester_upn, requester_name, title, job_reference, requested_assignee_upn, assignee_upn,
         due_date, priority, status, sharepoint_item_id, outlook_event_id, calendar_sync_status, calendar_sync_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET requester_oid=excluded.requester_oid, requester_upn=excluded.requester_upn,
          requester_name=excluded.requester_name, title=excluded.title, job_reference=excluded.job_reference,
          requested_assignee_upn=excluded.requested_assignee_upn, assignee_upn=excluded.assignee_upn,
          due_date=excluded.due_date, priority=excluded.priority, status=excluded.status,
          sharepoint_item_id=excluded.sharepoint_item_id, outlook_event_id=excluded.outlook_event_id,
          calendar_sync_status=excluded.calendar_sync_status, calendar_sync_error=excluded.calendar_sync_error,
          updated_at=excluded.updated_at`)
        .bind(task.taskId, task.requesterOid, task.requesterUpn, task.requesterName, task.title,
          task.jobReference || '', task.requestedAssigneeUpn || '', task.assigneeUpn || '', task.dueDate || '',
          task.priority || 'Normal', task.status, task.sharePointItemId || '', task.outlookEventId || '',
          task.calendarSyncStatus || 'pending', task.calendarSyncError || '', task.createdAt || timestamp, timestamp)];
      if (event) {
        statements.push(DB.prepare(`INSERT OR IGNORE INTO task_activity
          (action_id, task_id, actor_oid, actor_upn, actor_name, action, old_status, new_status, details_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(event.actionId, task.taskId, event.actorOid, event.actorUpn, event.actorName, event.action,
            event.changes?.status?.from || '', event.changes?.status?.to || task.status,
            JSON.stringify({ changes: event.changes || {}, reason: event.reason || '' }), event.occurredAt || timestamp));
      }
      statements.push(DB.prepare(`UPDATE task_workflow_outbox SET status='synced', attempts=attempts+1,
        last_error='', response_json=?, updated_at=? WHERE action_id=?`)
        .bind(JSON.stringify(result), timestamp, actionId));
      await DB.batch(statements);
      return get(actionId);
    },
    async getTask(taskId) {
      return taskFromRow(await DB.prepare('SELECT * FROM tasks WHERE task_id = ?').bind(taskId).first());
    },
    async history(taskId) {
      const result = await DB.prepare(`SELECT action_id, actor_oid, actor_upn, actor_name, action, old_status, new_status, details_json, created_at
        FROM task_activity WHERE task_id = ? ORDER BY created_at DESC, action_id DESC LIMIT 200`).bind(taskId).all();
      return (result.results || []).map((row) => ({
        actionId: row.action_id,
        actorOid: row.actor_oid,
        actorUpn: row.actor_upn,
        actorName: row.actor_name,
        action: row.action,
        oldStatus: row.old_status || '',
        newStatus: row.new_status || '',
        details: parseObjectJson(row.details_json),
        createdAt: row.created_at
      }));
    },
    async pending(actor, includeAll = false) {
      const staleBefore = new Date(Date.now() - TASK_OPERATION_LEASE_MS).toISOString();
      const query = includeAll
        ? `SELECT action_id, task_id, action, status, attempts, last_error, payload_json, updated_at FROM task_workflow_outbox WHERE status='failed' OR (status='queued' AND updated_at < ?) ORDER BY updated_at DESC LIMIT 100`
        : `SELECT action_id, task_id, action, status, attempts, last_error, payload_json, updated_at FROM task_workflow_outbox WHERE actor_oid=? AND (status='failed' OR (status='queued' AND updated_at < ?)) ORDER BY updated_at DESC LIMIT 100`;
      const rows = includeAll ? await DB.prepare(query).bind(staleBefore).all() : await DB.prepare(query).bind(actor.oid, staleBefore).all();
      return (rows.results || []).map((row) => ({
        actionId: row.action_id,
        taskId: row.task_id,
        action: row.action,
        status: row.status,
        attempts: Number(row.attempts || 0),
        error: row.last_error || (row.status === 'queued' ? 'Synchronization was interrupted and can be retried.' : ''),
        payload: parseObjectJson(row.payload_json),
        updatedAt: row.updated_at
      }));
    }
  };
}

export { TASK_STATUS, TASK_PRIORITIES, taskManager };
