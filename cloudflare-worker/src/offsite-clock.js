const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{11,119}$/;
const MAX_SITE_LENGTH = 240;
const MAX_DECISION_NOTE_LENGTH = 1000;
const ENTRY_COLUMNS = `entry_id, owner_oid, owner_upn, employee_name, work_date, site,
  clock_in_at, clock_out_at, status, decision_note, decided_by_oid, decided_by_upn,
  decided_at, created_at, updated_at`;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function entryView(row) {
  if (!row) return null;
  return {
    entryId: row.entry_id,
    ownerUpn: row.owner_upn,
    ownerName: row.employee_name,
    workDate: row.work_date,
    site: row.site,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at || '',
    status: row.status,
    decisionNote: row.decision_note || '',
    decidedByUpn: row.decided_by_upn || '',
    decidedAt: row.decided_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requestId(body) {
  const value = String(body?.requestId || '').trim();
  if (!REQUEST_ID_PATTERN.test(value)) fail(400, 'A valid request ID is required for safe retry.');
  return value;
}

function requireIdentity(identity) {
  if (!identity?.oid || !identity?.upn) fail(401, 'A verified GMT account is required.');
}

function requireDutyManager(identity) {
  if (identity?.canReviewOffsite !== true) fail(403, 'Off-site sign-off is restricted to assigned Duty Managers.');
}

function londonWorkDate(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(timestamp);
  const part = (type) => String(parts.find((item) => item.type === type)?.value || '');
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function auditStatement(env, { eventId, entryId, identity, type, previousStatus, nextStatus, occurredAt }) {
  return env.DB.prepare(`INSERT INTO offsite_clock_audit
    (event_id, entry_id, actor_oid, actor_upn, event_type, previous_status, next_status, occurred_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
    .bind(eventId, entryId, identity.oid, identity.upn, type, previousStatus, nextStatus, occurredAt);
}

async function priorEvent(env, eventId) {
  return env.DB.prepare('SELECT event_id, entry_id, actor_oid, actor_upn, event_type FROM offsite_clock_audit WHERE event_id = ?')
    .bind(eventId).first();
}

async function currentEntry(env, entryId) {
  return env.DB.prepare(`SELECT ${ENTRY_COLUMNS} FROM offsite_clock_entries WHERE entry_id = ?`).bind(entryId).first();
}

function sameActor(event, identity) {
  return event && event.actor_oid === identity.oid && String(event.actor_upn || '').toLowerCase() === String(identity.upn || '').toLowerCase();
}

function duplicateConflict() {
  return { status: 409, body: { error: 'This request ID was already used for a different action.' } };
}

async function idempotentResult(env, event, identity, type, entryId = '') {
  if (!event) return null;
  if (!sameActor(event, identity) || event.event_type !== type || (entryId && event.entry_id !== entryId)) return duplicateConflict();
  const row = await currentEntry(env, event.entry_id);
  if (!row) return { status: 409, body: { error: 'The original off-site entry is no longer available.' } };
  return { status: 200, body: { ok: true, idempotent: true, entry: entryView(row) } };
}

function conflict(message) {
  return { status: 409, body: { error: message } };
}

function isConstraintError(error) {
  const message = String(error && error.message || error || '').toLowerCase();
  return message.includes('constraint failed') || message.includes('constraint violation') || message.includes('sqlite_constraint');
}

async function clockIn(request, env, identity, readJson) {
  requireIdentity(identity);
  const body = await readJson(request);
  const eventId = requestId(body);
  const site = typeof body.site === 'string' ? body.site.trim() : '';
  if (!site || site.length > MAX_SITE_LENGTH) fail(400, `Enter an off-site location of ${MAX_SITE_LENGTH} characters or fewer.`);

  const duplicate = await priorEvent(env, eventId);
  if (duplicate) {
    const result = await idempotentResult(env, duplicate, identity, 'clock_in');
    if (result?.status !== 200) return result;
    if (result.body.entry.site !== site) return duplicateConflict();
    return result;
  }

  const timestamp = new Date().toISOString();
  const entryId = crypto.randomUUID();
  const statement = env.DB.prepare(`INSERT INTO offsite_clock_entries
    (entry_id, owner_oid, owner_upn, employee_name, work_date, site, clock_in_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'clocked_in', ?, ?)`)
    .bind(entryId, identity.oid, identity.upn, String(identity.name || identity.upn).slice(0, 240), londonWorkDate(new Date(timestamp)), site, timestamp, timestamp, timestamp);
  const audit = env.DB.prepare(`INSERT INTO offsite_clock_audit
    (event_id, entry_id, actor_oid, actor_upn, event_type, previous_status, next_status, occurred_at)
    VALUES (?, ?, ?, ?, 'clock_in', '', 'clocked_in', ?)`)
    .bind(eventId, entryId, identity.oid, identity.upn, timestamp);
  try {
    await env.DB.batch([statement, audit]);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) {
      const result = await idempotentResult(env, raced, identity, 'clock_in');
      if (result?.status === 200 && result.body.entry.site === site) return result;
      if (result?.status === 200) return duplicateConflict();
      if (result) return result;
    }
    return conflict('You already have an off-site shift clocked in, or this request conflicts with a recent action.');
  }
  const row = await currentEntry(env, entryId);
  return { status: 201, body: { ok: true, entry: entryView(row) } };
}

async function clockOut(request, env, identity, readJson) {
  requireIdentity(identity);
  const body = await readJson(request);
  const eventId = requestId(body);
  const entryId = String(body.entryId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) fail(400, 'A valid off-site entry is required.');

  const duplicate = await priorEvent(env, eventId);
  if (duplicate) return (await idempotentResult(env, duplicate, identity, 'clock_out', entryId)) || duplicateConflict();

  const existing = await currentEntry(env, entryId);
  if (!existing || existing.owner_oid !== identity.oid) fail(404, 'Off-site entry not found.');
  if (existing.status !== 'clocked_in') return conflict('This off-site entry is not clocked in.');
  const timestamp = new Date().toISOString();
  const update = env.DB.prepare(`UPDATE offsite_clock_entries SET clock_out_at = ?, status = 'awaiting_approval', updated_at = ?
    WHERE entry_id = ? AND owner_oid = ? AND status = 'clocked_in' AND clock_out_at IS NULL`)
    .bind(timestamp, timestamp, entryId, identity.oid);
  const audit = auditStatement(env, { eventId, entryId, identity, type: 'clock_out', previousStatus: 'clocked_in', nextStatus: 'awaiting_approval', occurredAt: timestamp });
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await priorEvent(env, eventId);
      if (raced) return (await idempotentResult(env, raced, identity, 'clock_out', entryId)) || duplicateConflict();
      return conflict('This off-site entry has already been clocked out.');
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) return (await idempotentResult(env, raced, identity, 'clock_out', entryId)) || duplicateConflict();
    return conflict('This off-site entry has already been clocked out.');
  }
  return { status: 200, body: { ok: true, entry: entryView(await currentEntry(env, entryId)) } };
}

async function mine(env, identity) {
  requireIdentity(identity);
  const result = await env.DB.prepare(`SELECT ${ENTRY_COLUMNS} FROM offsite_clock_entries
    WHERE owner_oid = ? ORDER BY clock_in_at DESC LIMIT 100`).bind(identity.oid).all();
  return { status: 200, body: { entries: (result.results || []).map(entryView) } };
}

async function pending(env, identity) {
  requireDutyManager(identity);
  const result = await env.DB.prepare(`SELECT ${ENTRY_COLUMNS} FROM offsite_clock_entries
    WHERE status = 'awaiting_approval' ORDER BY clock_out_at ASC LIMIT 100`).all();
  return { status: 200, body: { entries: (result.results || []).map((row) => ({
    ...entryView(row),
    canDecide: row.owner_oid !== identity.oid && String(row.owner_upn || '').toLowerCase() !== String(identity.upn || '').toLowerCase()
  })) } };
}

async function decide(request, env, identity, readJson, entryId) {
  requireDutyManager(identity);
  const body = await readJson(request);
  const eventId = requestId(body);
  const decision = String(body.decision || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(decision)) fail(400, 'Choose approve or reject.');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_DECISION_NOTE_LENGTH) fail(400, `The decision note must be ${MAX_DECISION_NOTE_LENGTH} characters or fewer.`);
  if (decision === 'reject' && !note) fail(400, 'Add a reason before rejecting this off-site entry.');

  const eventType = decision;
  const duplicate = await priorEvent(env, eventId);
  if (duplicate) {
    const result = await idempotentResult(env, duplicate, identity, eventType, entryId);
    if (result?.status !== 200) return result || duplicateConflict();
    const expectedStatus = decision === 'approve' ? 'approved' : 'rejected';
    if (result.body.entry.status !== expectedStatus || result.body.entry.decisionNote !== note) return duplicateConflict();
    return result;
  }

  const existing = await currentEntry(env, entryId);
  if (!existing) fail(404, 'Off-site entry not found.');
  if (existing.owner_oid === identity.oid || String(existing.owner_upn || '').toLowerCase() === String(identity.upn || '').toLowerCase()) {
    fail(403, 'You cannot sign off your own off-site entry.');
  }
  if (existing.status !== 'awaiting_approval') return conflict('Only entries awaiting sign-off can be decided.');
  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
  const timestamp = new Date().toISOString();
  const update = env.DB.prepare(`UPDATE offsite_clock_entries SET status = ?, decision_note = ?, decided_by_oid = ?,
    decided_by_upn = ?, decided_at = ?, updated_at = ? WHERE entry_id = ? AND status = 'awaiting_approval'`)
    .bind(nextStatus, note, identity.oid, identity.upn, timestamp, timestamp, entryId);
  const audit = auditStatement(env, { eventId, entryId, identity, type: eventType, previousStatus: 'awaiting_approval', nextStatus, occurredAt: timestamp });
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await priorEvent(env, eventId);
      if (raced) {
        const result = await idempotentResult(env, raced, identity, eventType, entryId);
        if (result?.status === 200 && result.body.entry.status === nextStatus && result.body.entry.decisionNote === note) return result;
        if (result) return result;
      }
      return conflict('This entry has already been decided.');
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) {
      const result = await idempotentResult(env, raced, identity, eventType, entryId);
      if (result?.status === 200 && result.body.entry.status === nextStatus && result.body.entry.decisionNote === note) return result;
      if (result) return result;
    }
    return conflict('This entry has already been decided.');
  }
  return { status: 200, body: { ok: true, entry: entryView(await currentEntry(env, entryId)) } };
}

export async function offsiteClockEndpoint(request, env, identity, readJson) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/offsite-clock/mine' && request.method === 'GET') return mine(env, identity);
  if (path === '/api/offsite-clock/pending' && request.method === 'GET') return pending(env, identity);
  if (path === '/api/offsite-clock/clock-in' && request.method === 'POST') return clockIn(request, env, identity, readJson);
  if (path === '/api/offsite-clock/clock-out' && request.method === 'POST') return clockOut(request, env, identity, readJson);
  const decisionMatch = path.match(/^\/api\/offsite-clock\/([0-9a-f-]{36})\/decision$/i);
  if (decisionMatch && request.method === 'POST') return decide(request, env, identity, readJson, decodeURIComponent(decisionMatch[1]));
  if (path === '/api/offsite-clock/mine' || path === '/api/offsite-clock/pending' || path === '/api/offsite-clock/clock-in' || path === '/api/offsite-clock/clock-out' || path.startsWith('/api/offsite-clock/')) {
    return { status: 405, body: { error: 'Method not allowed.' } };
  }
  return null;
}
