const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{11,119}$/;
const MAX_SITE_LENGTH = 240;
const MAX_DECISION_NOTE_LENGTH = 1000;
const ENTRY_COLUMNS = `entry_id, owner_oid, owner_upn, employee_name, work_date, site,
  clock_in_at, lunch_start_at, lunch_end_at, clock_out_at, booking_id, status, decision_note, decided_by_oid, decided_by_upn,
  decided_at, created_at, updated_at`;
const BOOKING_COLUMNS = `booking_id, owner_oid, owner_upn, employee_name, work_date, planned_start,
  planned_end, site, note, status, version, decision_note, decided_by_oid, decided_by_upn,
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
    lunchStartAt: row.lunch_start_at || '',
    lunchEndAt: row.lunch_end_at || '',
    clockOutAt: row.clock_out_at || '',
    bookingId: row.booking_id || '',
    status: row.status,
    decisionNote: row.decision_note || '',
    decidedByUpn: row.decided_by_upn || '',
    decidedAt: row.decided_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function bookingView(row) {
  if (!row) return null;
  return {
    bookingId: row.booking_id,
    ownerUpn: row.owner_upn,
    ownerName: row.employee_name,
    workDate: row.work_date,
    start: row.planned_start,
    end: row.planned_end,
    site: row.site,
    note: row.note || '',
    status: row.status,
    version: Number(row.version || 1),
    decisionNote: row.decision_note || '',
    decidedByUpn: row.decided_by_upn || '',
    decidedAt: row.decided_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function bookingAuditView(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) {}
  const flatBooking = row.event_type === 'book' ? {
    workDate: payload.workDate || '', start: payload.start || '', end: payload.end || '',
    site: payload.site || '', note: payload.note || ''
  } : null;
  return {
    eventType: row.event_type,
    previousStatus: row.previous_status || '',
    nextStatus: row.next_status || '',
    version: Number(row.version || 1),
    actorUpn: row.actor_upn || '',
    occurredAt: row.occurred_at,
    previous: payload.previous || null,
    next: payload.next || flatBooking,
    planned: payload.planned || null,
    note: payload.note || ''
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

async function currentBooking(env, bookingId) {
  return env.DB.prepare(`SELECT ${BOOKING_COLUMNS} FROM offsite_bookings WHERE booking_id = ?`).bind(bookingId).first();
}

function londonTime(timestamp) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(timestamp));
}

function afterTimestamp(...values) {
  const latest = values.map((value) => Date.parse(value || '')).filter(Number.isFinite).reduce((max, value) => Math.max(max, value), 0);
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function isCoordinatePair(value) {
  return /^\s*-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?\s*(?:\(.*\))?$/i.test(String(value || ''));
}

function bookingInput(body) {
  const workDate = String(body.workDate || '').trim();
  const start = String(body.start || '').trim();
  const end = String(body.end || '').trim();
  const site = typeof body.site === 'string' ? body.site.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!validDate(workDate)) fail(400, 'Choose a valid off-site date.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) {
    fail(400, 'Enter a valid same-day start and end time; overnight bookings are not supported.');
  }
  if (!site || site.length > MAX_SITE_LENGTH) fail(400, `Enter an off-site location of ${MAX_SITE_LENGTH} characters or fewer.`);
  if (isCoordinatePair(site)) fail(400, 'Enter a road, business or site name instead of coordinates.');
  if (note.length > MAX_DECISION_NOTE_LENGTH) fail(400, `The booking note must be ${MAX_DECISION_NOTE_LENGTH} characters or fewer.`);
  if (workDate < londonWorkDate(new Date())) fail(400, 'Off-site bookings must be for today or a future date.');
  return { workDate, start, end, site, note };
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
  const bookingId = String(body.bookingId || '').trim();
  if (!site || site.length > MAX_SITE_LENGTH) fail(400, `Enter an off-site location of ${MAX_SITE_LENGTH} characters or fewer.`);
  if (isCoordinatePair(site)) fail(400, 'Enter a road, business or site name instead of coordinates.');

  const duplicate = await priorEvent(env, eventId);
  if (duplicate) {
    const result = await idempotentResult(env, duplicate, identity, 'clock_in');
    if (result?.status !== 200) return result;
    if (result.body.entry.site !== site || result.body.entry.bookingId !== bookingId) return duplicateConflict();
    return result;
  }

  if (bookingId) {
    const booking = await currentBooking(env, bookingId);
    if (!booking || booking.owner_oid !== identity.oid || booking.status !== 'approved') fail(409, 'Choose one of your approved off-site bookings, or clock in without a booking.');
    if (booking.work_date !== londonWorkDate(new Date())) fail(409, 'An approved booking can only be linked to an actual shift on its booked date.');
  }

  const timestamp = new Date().toISOString();
  const entryId = crypto.randomUUID();
  const statement = env.DB.prepare(`INSERT INTO offsite_clock_entries
    (entry_id, owner_oid, owner_upn, employee_name, work_date, site, clock_in_at, booking_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'clocked_in', ?, ?)`)
    .bind(entryId, identity.oid, identity.upn, String(identity.name || identity.upn).slice(0, 240), londonWorkDate(new Date(timestamp)), site, timestamp, bookingId || null, timestamp, timestamp);
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
      if (result?.status === 200 && result.body.entry.site === site && result.body.entry.bookingId === bookingId) return result;
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
  const timestamp = afterTimestamp(existing.clock_in_at, existing.lunch_start_at, existing.lunch_end_at);
  if (existing.lunch_start_at && !existing.lunch_end_at) return conflict('Record lunch end before clocking out.');
  const update = env.DB.prepare(`UPDATE offsite_clock_entries SET clock_out_at = ?, status = 'awaiting_approval', updated_at = ?
    WHERE entry_id = ? AND owner_oid = ? AND status = 'clocked_in' AND clock_out_at IS NULL
      AND clock_in_at < ? AND (lunch_start_at IS NULL OR (lunch_end_at IS NOT NULL AND lunch_start_at < lunch_end_at AND lunch_end_at < ?))`)
    .bind(timestamp, timestamp, entryId, identity.oid, timestamp, timestamp);
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

async function lunchEvent(request, env, identity, readJson, eventType) {
  requireIdentity(identity);
  const body = await readJson(request);
  const eventId = requestId(body);
  const entryId = String(body.entryId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) fail(400, 'A valid off-site entry is required.');
  const duplicate = await priorEvent(env, eventId);
  if (duplicate) return (await idempotentResult(env, duplicate, identity, eventType, entryId)) || duplicateConflict();
  const existing = await currentEntry(env, entryId);
  if (!existing || existing.owner_oid !== identity.oid) fail(404, 'Off-site entry not found.');
  if (existing.status !== 'clocked_in') return conflict('Lunch times can only be recorded during an active off-site shift.');
  const isStart = eventType === 'lunch_start';
  const timestamp = afterTimestamp(isStart ? existing.clock_in_at : existing.lunch_start_at);
  if (isStart && (existing.lunch_start_at || existing.lunch_end_at)) return conflict('Lunch start has already been recorded for this shift.');
  if (!isStart && (!existing.lunch_start_at || existing.lunch_end_at)) return conflict('Record lunch start before lunch end.');
  const field = isStart ? 'lunch_start_at' : 'lunch_end_at';
  const order = isStart ? 'clock_in_at < ?' : 'lunch_start_at < ?';
  const update = env.DB.prepare(`UPDATE offsite_clock_entries SET ${field} = ?, updated_at = ?
    WHERE entry_id = ? AND owner_oid = ? AND status = 'clocked_in' AND ${field} IS NULL AND ${order}`)
    .bind(timestamp, timestamp, entryId, identity.oid, timestamp);
  const audit = auditStatement(env, { eventId, entryId, identity, type: eventType, previousStatus: 'clocked_in', nextStatus: 'clocked_in', occurredAt: timestamp });
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await priorEvent(env, eventId);
      if (raced) return (await idempotentResult(env, raced, identity, eventType, entryId)) || duplicateConflict();
      return conflict(isStart ? 'Lunch start has already been recorded.' : 'Record lunch start before lunch end.');
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) return (await idempotentResult(env, raced, identity, eventType, entryId)) || duplicateConflict();
    return conflict(isStart ? 'Lunch start has already been recorded.' : 'Record lunch start before lunch end.');
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
  const workRow = {
    date: existing.work_date,
    start: londonTime(existing.clock_in_at),
    lunchStart: existing.lunch_start_at ? londonTime(existing.lunch_start_at) : '',
    lunchEnd: existing.lunch_end_at ? londonTime(existing.lunch_end_at) : '',
    finish: londonTime(existing.clock_out_at),
    location: existing.site,
    site: existing.site,
    status: 'Recorded'
  };
  const payload = JSON.stringify({
    schemaVersion: 1,
    source: 'approved-offsite-shift',
    date: existing.work_date,
    action: 'full_day',
    actionLabel: 'Approved off-site shift',
    dayStart: workRow.start,
    lunchStart: workRow.lunchStart,
    lunchEnd: workRow.lunchEnd,
    dayFinish: workRow.finish,
    location: existing.site,
    note: existing.booking_id ? `Approved off-site shift linked to booking ${existing.booking_id}.` : 'Approved off-site shift.',
    approval: { decision: 'approved', decidedByUpn: identity.upn, decidedAt: timestamp },
    rows: [workRow]
  });
  const approvedClockRecord = decision === 'approve'
    ? env.DB.prepare(`INSERT OR IGNORE INTO records
        (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date,
         record_date, submitted_at, updated_at, issue, payload_json)
        SELECT ?, owner_oid, owner_upn, employee_name, 'clock', 'full_day', 'Approved', NULL, NULL,
          work_date, ?, ?, NULL, ? FROM offsite_clock_entries WHERE entry_id = ? AND status = 'approved'`)
      .bind(`offsite-${entryId}`, existing.clock_out_at, timestamp, payload, entryId)
    : env.DB.prepare('SELECT 1 WHERE 0');
  try {
    const results = await env.DB.batch([update, approvedClockRecord, audit]);
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
  return {
    status: 200,
    body: {
      ok: true,
      entry: entryView(await currentEntry(env, entryId)),
      ...(decision === 'approve' ? { recordId: `offsite-${entryId}` } : {})
    }
  };
}

async function bookingPriorEvent(env, eventId) {
  return env.DB.prepare('SELECT event_id, booking_id, actor_oid, actor_upn, event_type FROM offsite_booking_audit WHERE event_id = ?')
    .bind(eventId).first();
}

function bookingAuditStatement(env, { eventId, bookingId, identity, type, previousStatus, nextStatus, version, payload, occurredAt }) {
  return env.DB.prepare(`INSERT INTO offsite_booking_audit
    (event_id, booking_id, actor_oid, actor_upn, event_type, previous_status, next_status, version, payload_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(eventId, bookingId, identity.oid, identity.upn, type, previousStatus, nextStatus, version, JSON.stringify(payload || {}), occurredAt);
}

async function bookingIdempotent(env, event, identity, type, bookingId = '') {
  if (!event) return null;
  if (!sameActor(event, identity) || event.event_type !== type || (bookingId && event.booking_id !== bookingId)) return duplicateConflict();
  const row = await currentBooking(env, event.booking_id);
  if (!row) return { status: 409, body: { error: 'The original off-site booking is no longer available.' } };
  return { status: 200, body: { ok: true, idempotent: true, booking: bookingView(row) } };
}

async function createBooking(request, env, identity, readJson) {
  requireIdentity(identity);
  const body = await readJson(request);
  const eventId = requestId(body);
  const input = bookingInput(body);
  const duplicate = await bookingPriorEvent(env, eventId);
  if (duplicate) {
    const result = await bookingIdempotent(env, duplicate, identity, 'book');
    if (result?.status !== 200) return result;
    const booking = result.body.booking;
    if (booking.workDate !== input.workDate || booking.start !== input.start || booking.end !== input.end || booking.site !== input.site || booking.note !== input.note) return duplicateConflict();
    return result;
  }
  const timestamp = new Date().toISOString();
  const bookingId = crypto.randomUUID();
  const fields = { ...input };
  const insert = env.DB.prepare(`INSERT INTO offsite_bookings
    (booking_id, owner_oid, owner_upn, employee_name, work_date, planned_start, planned_end, site, note,
     status, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_approval', 1, ?, ?)`)
    .bind(bookingId, identity.oid, identity.upn, String(identity.name || identity.upn).slice(0, 240), input.workDate, input.start, input.end, input.site, input.note, timestamp, timestamp);
  const audit = bookingAuditStatement(env, { eventId, bookingId, identity, type: 'book', previousStatus: '', nextStatus: 'awaiting_approval', version: 1, payload: fields, occurredAt: timestamp });
  try {
    await env.DB.batch([insert, audit]);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await bookingPriorEvent(env, eventId);
    if (raced) {
      const result = await bookingIdempotent(env, raced, identity, 'book');
      if (result?.status === 200 && result.body.booking.workDate === input.workDate && result.body.booking.start === input.start && result.body.booking.end === input.end && result.body.booking.site === input.site && result.body.booking.note === input.note) return result;
      if (result) return result.status === 200 ? duplicateConflict() : result;
    }
    return conflict('This booking request conflicts with an existing booking action.');
  }
  return { status: 201, body: { ok: true, booking: bookingView(await currentBooking(env, bookingId)) } };
}

async function listBookings(env, identity, forManagers = false) {
  if (forManagers) requireDutyManager(identity);
  else requireIdentity(identity);
  const where = forManagers ? "WHERE status = 'awaiting_approval'" : 'WHERE owner_oid = ?';
  const statement = env.DB.prepare(`SELECT ${BOOKING_COLUMNS} FROM offsite_bookings ${where}
    ORDER BY work_date ${forManagers ? 'ASC' : 'DESC'}, planned_start ASC LIMIT 100`);
  const result = forManagers ? await statement.all() : await statement.bind(identity.oid).all();
  const rows = result.results || [];
  const historyByBooking = new Map();
  if (!forManagers && rows.length) {
    const bookingIds = rows.map((row) => row.booking_id);
    const placeholders = bookingIds.map(() => '?').join(', ');
    const auditResult = await env.DB.prepare(`SELECT booking_id, event_type, previous_status, next_status, version,
        actor_upn, payload_json, occurred_at
      FROM offsite_booking_audit WHERE booking_id IN (${placeholders}) ORDER BY booking_id, rowid ASC`)
      .bind(...bookingIds).all();
    for (const event of auditResult.results || []) {
      if (!historyByBooking.has(event.booking_id)) historyByBooking.set(event.booking_id, []);
      historyByBooking.get(event.booking_id).push(bookingAuditView(event));
    }
  }
  return {
    status: 200,
    body: {
      bookings: rows.map((row) => ({
        ...bookingView(row),
        ...(forManagers
          ? { canDecide: row.owner_oid !== identity.oid && String(row.owner_upn || '').toLowerCase() !== String(identity.upn || '').toLowerCase() }
          : { history: historyByBooking.get(row.booking_id) || [] })
      }))
    }
  };
}

async function amendBooking(request, env, identity, readJson, bookingId) {
  requireIdentity(identity);
  const body = await readJson(request);
  const eventId = requestId(body);
  const input = bookingInput(body);
  const duplicate = await bookingPriorEvent(env, eventId);
  if (duplicate) {
    const result = await bookingIdempotent(env, duplicate, identity, 'amend', bookingId);
    if (result?.status !== 200) return result;
    const booking = result.body.booking;
    if (booking.workDate !== input.workDate || booking.start !== input.start || booking.end !== input.end || booking.site !== input.site || booking.note !== input.note) return duplicateConflict();
    return result;
  }
  const existing = await currentBooking(env, bookingId);
  if (!existing || existing.owner_oid !== identity.oid) fail(404, 'Off-site booking not found.');
  const timestamp = new Date().toISOString();
  const version = Number(existing.version || 1) + 1;
  const update = env.DB.prepare(`UPDATE offsite_bookings SET work_date = ?, planned_start = ?, planned_end = ?, site = ?, note = ?,
    status = 'awaiting_approval', version = ?, decision_note = '', decided_by_oid = NULL, decided_by_upn = NULL,
    decided_at = NULL, updated_at = ? WHERE booking_id = ? AND owner_oid = ? AND version = ?`)
    .bind(input.workDate, input.start, input.end, input.site, input.note, version, timestamp, bookingId, identity.oid, existing.version);
  const audit = env.DB.prepare(`INSERT INTO offsite_booking_audit
    (event_id, booking_id, actor_oid, actor_upn, event_type, previous_status, next_status, version, payload_json, occurred_at)
    SELECT ?, ?, ?, ?, 'amend', ?, 'awaiting_approval', ?, ?, ? WHERE changes() > 0`)
    .bind(eventId, bookingId, identity.oid, identity.upn, existing.status, version, JSON.stringify({ previous: bookingView(existing), next: input }), timestamp);
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await bookingPriorEvent(env, eventId);
      if (raced) return (await bookingIdempotent(env, raced, identity, 'amend', bookingId)) || duplicateConflict();
      return conflict('This booking has changed. Refresh and try again.');
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await bookingPriorEvent(env, eventId);
    if (raced) return (await bookingIdempotent(env, raced, identity, 'amend', bookingId)) || duplicateConflict();
    return conflict('This booking has changed. Refresh and try again.');
  }
  return { status: 200, body: { ok: true, booking: bookingView(await currentBooking(env, bookingId)) } };
}

async function decideBooking(request, env, identity, readJson, bookingId) {
  requireDutyManager(identity);
  const body = await readJson(request);
  const eventId = requestId(body);
  const decision = String(body.decision || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(decision)) fail(400, 'Choose approve or reject.');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_DECISION_NOTE_LENGTH) fail(400, `The decision note must be ${MAX_DECISION_NOTE_LENGTH} characters or fewer.`);
  if (decision === 'reject' && !note) fail(400, 'Add a reason before rejecting this off-site booking.');
  const eventType = decision;
  const duplicate = await bookingPriorEvent(env, eventId);
  if (duplicate) {
    const result = await bookingIdempotent(env, duplicate, identity, eventType, bookingId);
    if (result?.status !== 200) return result || duplicateConflict();
    const expected = decision === 'approve' ? 'approved' : 'rejected';
    if (result.body.booking.status !== expected || result.body.booking.decisionNote !== note) return duplicateConflict();
    return result;
  }
  const existing = await currentBooking(env, bookingId);
  if (!existing) fail(404, 'Off-site booking not found.');
  if (existing.owner_oid === identity.oid || String(existing.owner_upn || '').toLowerCase() === String(identity.upn || '').toLowerCase()) fail(403, 'You cannot sign off your own off-site booking.');
  if (existing.status !== 'awaiting_approval') return conflict('Only bookings awaiting sign-off can be decided.');
  const version = Number(existing.version || 1);
  if (Number(body.version) !== version) return conflict('This booking version has changed. Refresh the queue before deciding.');
  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
  const timestamp = new Date().toISOString();
  const update = env.DB.prepare(`UPDATE offsite_bookings SET status = ?, decision_note = ?, decided_by_oid = ?, decided_by_upn = ?,
    decided_at = ?, updated_at = ? WHERE booking_id = ? AND status = 'awaiting_approval' AND version = ?`)
    .bind(nextStatus, note, identity.oid, identity.upn, timestamp, timestamp, bookingId, version);
  const audit = env.DB.prepare(`INSERT INTO offsite_booking_audit
    (event_id, booking_id, actor_oid, actor_upn, event_type, previous_status, next_status, version, payload_json, occurred_at)
    SELECT ?, ?, ?, ?, ?, 'awaiting_approval', ?, ?, ?, ? WHERE changes() > 0`)
    .bind(eventId, bookingId, identity.oid, identity.upn, eventType, nextStatus, version, JSON.stringify({ note, planned: bookingView(existing) }), timestamp);
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await bookingPriorEvent(env, eventId);
      if (raced) return (await bookingIdempotent(env, raced, identity, eventType, bookingId)) || duplicateConflict();
      return conflict('This booking has already been decided.');
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await bookingPriorEvent(env, eventId);
    if (raced) return (await bookingIdempotent(env, raced, identity, eventType, bookingId)) || duplicateConflict();
    return conflict('This booking has already been decided.');
  }
  return { status: 200, body: { ok: true, booking: bookingView(await currentBooking(env, bookingId)) } };
}

export async function offsiteClockEndpoint(request, env, identity, readJson) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/offsite-clock/mine' && request.method === 'GET') return mine(env, identity);
  if (path === '/api/offsite-clock/pending' && request.method === 'GET') return pending(env, identity);
  if (path === '/api/offsite-clock/clock-in' && request.method === 'POST') return clockIn(request, env, identity, readJson);
  if (path === '/api/offsite-clock/lunch-start' && request.method === 'POST') return lunchEvent(request, env, identity, readJson, 'lunch_start');
  if (path === '/api/offsite-clock/lunch-end' && request.method === 'POST') return lunchEvent(request, env, identity, readJson, 'lunch_end');
  if (path === '/api/offsite-clock/clock-out' && request.method === 'POST') return clockOut(request, env, identity, readJson);
  if (path === '/api/offsite-bookings/mine' && request.method === 'GET') return listBookings(env, identity, false);
  if (path === '/api/offsite-bookings/pending' && request.method === 'GET') return listBookings(env, identity, true);
  if (path === '/api/offsite-bookings' && request.method === 'POST') return createBooking(request, env, identity, readJson);
  const bookingDecisionMatch = path.match(/^\/api\/offsite-bookings\/([0-9a-f-]{36})\/decision$/i);
  if (bookingDecisionMatch && request.method === 'POST') return decideBooking(request, env, identity, readJson, decodeURIComponent(bookingDecisionMatch[1]));
  const bookingMatch = path.match(/^\/api\/offsite-bookings\/([0-9a-f-]{36})$/i);
  if (bookingMatch && request.method === 'PATCH') return amendBooking(request, env, identity, readJson, decodeURIComponent(bookingMatch[1]));
  const decisionMatch = path.match(/^\/api\/offsite-clock\/([0-9a-f-]{36})\/decision$/i);
  if (decisionMatch && request.method === 'POST') return decide(request, env, identity, readJson, decodeURIComponent(decisionMatch[1]));
  if (path.startsWith('/api/offsite-clock/') || path.startsWith('/api/offsite-bookings')) {
    return { status: 405, body: { error: 'Method not allowed.' } };
  }
  return null;
}
