const ALLOWED_KINDS = new Set(['timesheets', 'clock', 'estimates', 'job-cards', 'calendar', 'tasks', 'audit']);
const MAX_BODY_BYTES = 1_300_000;
const MAX_RECORD_ID = 180;
const MAX_TEXT = 6000;
const MAX_ATTACHMENT_BYTES = 220_000;
const MAX_ATTACHMENT_TOTAL_BYTES = 700_000;
const MAX_QUEUE_BATCH = 25;
const ATTACHMENT_FIELDS = new Set(['attachment_record', 'attachment', 'attachment_csv', 'attachment_calendar_sync']);
const JWKS_CACHE = new Map();

function now() {
  return new Date().toISOString();
}

function json(data, status = 200, origin = '') {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin'
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'Authorization, Content-Type, Accept',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'cache-control': 'no-store',
    vary: 'Origin'
  };
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function csvSet(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function audienceValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return '';
  const allowed = csvSet(env.ALLOWED_ORIGINS);
  return allowed.has(origin.toLowerCase()) ? origin : null;
}

function bearerToken(request) {
  const value = request.headers.get('Authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function signingKey(tenantId, kid) {
  const cacheKey = `${tenantId}:${kid}`;
  if (JWKS_CACHE.has(cacheKey)) return JWKS_CACHE.get(cacheKey);
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!response.ok) throw new Error('Microsoft signing keys unavailable');
  const body = await response.json();
  const jwk = Array.isArray(body.keys) ? body.keys.find((item) => item.kid === kid) : null;
  if (!jwk) throw new Error('Microsoft signing key not found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  JWKS_CACHE.set(cacheKey, key);
  return key;
}

function tokenIdentity(claims, env) {
  const tenantId = String(env.ENTRA_TENANT_ID || '').trim().toLowerCase();
  const tokenTenant = String(claims.tid || '').trim().toLowerCase();
  if (!tenantId || !tokenTenant || !constantTimeEqual(tokenTenant, tenantId)) throw new Error('Wrong Microsoft tenant');
  const audiences = new Set(String(env.ENTRA_AUDIENCES || '').split(',').map(audienceValue).filter(Boolean));
  if (!audiences.size || !audiences.has(audienceValue(claims.aud))) throw new Error('Token audience is not permitted');
  const expectedIssuers = new Set([
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`
  ]);
  if (!expectedIssuers.has(String(claims.iss || '').toLowerCase())) throw new Error('Token issuer is not permitted');
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < nowSeconds - 60) throw new Error('Token has expired');
  if (claims.nbf && Number(claims.nbf) > nowSeconds + 60) throw new Error('Token is not active');
  const oid = String(claims.oid || '').trim();
  const upn = String(claims.preferred_username || claims.upn || claims.email || '').trim().toLowerCase();
  if (!oid || !upn) throw new Error('Token has no employee identity');
  const adminUpns = csvSet(env.ADMIN_UPNS);
  const adminOids = csvSet(env.ADMIN_OIDS);
  const adminGroups = csvSet(env.ADMIN_GROUP_IDS);
  const jobCardAdminUpns = csvSet(env.JOB_CARD_ADMIN_UPNS);
  const groups = Array.isArray(claims.groups) ? claims.groups.map((item) => String(item).toLowerCase()) : [];
  const isAdmin = adminUpns.has(upn) || adminOids.has(oid.toLowerCase()) || groups.some((group) => adminGroups.has(group));
  return {
    oid,
    upn,
    name: String(claims.name || '').trim(),
    aud: audienceValue(claims.aud),
    tid: tokenTenant,
    isAdmin,
    isJobCardAdmin: isAdmin || jobCardAdminUpns.has(upn)
  };
}

function canViewAllRecords(identity, kind = '') {
  return Boolean(identity?.isAdmin || (kind === 'job-cards' && identity?.isJobCardAdmin));
}

function canAccessRecord(identity, row) {
  return Boolean(row && (row.owner_oid === identity.oid || identity.isAdmin || (row.kind === 'job-cards' && identity.isJobCardAdmin)));
}

async function authenticate(request, env) {
  const token = bearerToken(request);
  if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const pieces = token.split('.');
  if (pieces.length !== 3) throw Object.assign(new Error('Invalid authentication token'), { status: 401 });
  let header;
  let claims;
  try {
    header = decodeJsonPart(pieces[0]);
    claims = decodeJsonPart(pieces[1]);
  } catch (_) {
    throw Object.assign(new Error('Invalid authentication token'), { status: 401 });
  }
  if (header.alg !== 'RS256' || !header.kid) throw Object.assign(new Error('Unsupported authentication token'), { status: 401 });
  const key = await signingKey(env.ENTRA_TENANT_ID, header.kid);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlDecode(pieces[2]), new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`));
  if (!valid) throw Object.assign(new Error('Invalid authentication token'), { status: 401 });
  try {
    return tokenIdentity(claims, env);
  } catch (error) {
    throw Object.assign(new Error(error.message || 'Unauthorised'), { status: 401 });
  }
}

function text(value, fallback = '', max = MAX_TEXT) {
  const result = String(value == null ? fallback : value).trim();
  return result.slice(0, max);
}

function httpUrl(value, max = 2000) {
  const candidate = text(value, '', max);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : '';
  } catch (_) {
    return '';
  }
}

function base64ByteLength(value) {
  const candidate = String(value || '');
  if (!candidate || candidate.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(candidate)) return -1;
  const padding = candidate.endsWith('==') ? 2 : (candidate.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor(candidate.length * 3 / 4) - padding);
}

function safeAttachmentName(value) {
  const name = text(value, '', 220);
  if (!name || /[\\/\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') return '';
  return name;
}

function attachmentType(fieldName, fileName, contentType) {
  if (!ATTACHMENT_FIELDS.has(fieldName)) return '';
  const extension = String(fileName || '').toLowerCase().split('.').pop();
  const allowed = {
    attachment_record: ['json'],
    attachment: ['xlsx'],
    attachment_csv: ['csv'],
    attachment_calendar_sync: ['json']
  };
  if (!allowed[fieldName]?.includes(extension)) return '';
  const expected = {
    json: 'application/json',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv'
  }[extension];
  const supplied = text(contentType, '', 160).toLowerCase();
  return !supplied || supplied === expected || (extension === 'json' && supplied === 'text/json') ? expected : '';
}

function syntheticRecord(record, payload = null) {
  const body = payload || payloadObject(record || {});
  return body && body.testMode === true || /^TEST(?:[\s_-]|$)/i.test(text(record?.employee_name, '', 240)) || /^TEST(?:[\s_-]|$)/i.test(text(body?.employeeName, '', 240));
}

function hours(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (numeric / 60).toFixed(2) : '0.00';
}

function dispatchSettings(env) {
  const configuredHour = Number(env.DISPATCH_HOUR);
  return {
    enabled: /^(1|true|yes|on)$/i.test(String(env.DISPATCH_ENABLED || '')),
    weekday: text(env.DISPATCH_WEEKDAY, 'Friday', 20).toLowerCase(),
    hour: Number.isFinite(configuredHour) ? Math.max(0, Math.min(23, configuredHour)) : 18,
    timeZone: text(env.DISPATCH_TIMEZONE, 'Europe/London', 80)
  };
}

function localTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return {
    weekday: String(parts.find((part) => part.type === 'weekday')?.value || '').toLowerCase(),
    hour: Number(parts.find((part) => part.type === 'hour')?.value || -1)
  };
}

function monthKeyInTimeZone(date = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const year = String(parts.find((part) => part.type === 'year')?.value || '');
  const month = String(parts.find((part) => part.type === 'month')?.value || '');
  return year && month ? `${year}-${month}` : '';
}

function recordMonthKey(value, timeZone = 'Europe/London') {
  const candidate = text(value, '', 80);
  if (!candidate) return '';
  const prefix = candidate.match(/^(\d{4})-(\d{2})/);
  if (prefix) return `${prefix[1]}-${prefix[2]}`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? '' : monthKeyInTimeZone(parsed, timeZone);
}

// GMT filing uses one employee workbook per YYYY-MM pay month. Keep the
// edit window tied to that workbook month, while history reads remain open
// for every authorised record.
function isCurrentPayMonthRecord(row, timeZone = 'Europe/London') {
  if (!row) return false;
  const recordMonth = recordMonthKey(row.start_date || row.record_date || row.end_date, timeZone);
  return Boolean(recordMonth && recordMonth === monthKeyInTimeZone(new Date(), timeZone));
}

const isCurrentMonthRecord = isCurrentPayMonthRecord;

function shouldDispatchNow(date = new Date(), env = {}) {
  const settings = dispatchSettings(env);
  if (!settings.enabled) return false;
  const local = localTimeParts(date, settings.timeZone);
  return local.weekday === settings.weekday && local.hour === settings.hour;
}

function canonicalKind(value) {
  const normalized = text(value).toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'clock-in' || normalized === 'clock-out' || normalized === 'clock-event' || normalized === 'clock-record' || normalized === 'lunch-start' || normalized === 'lunch-end' || normalized === 'absence' || normalized === 'full-day') return 'clock';
  if (normalized === 'jobcard' || normalized === 'job-card') return 'job-cards';
  if (normalized === 'estimate' || normalized === 'quote') return 'estimates';
  if (normalized === 'calendar-request' || normalized === 'calendar-event') return 'calendar';
  if (normalized === 'task' || normalized === 'task-request') return 'tasks';
  if (normalized === 'audit-submission') return 'audit';
  if (normalized === 'clock') return 'clock';
  if (normalized === 'timesheet' || normalized === 'timesheets' || !normalized) return 'timesheets';
  return normalized;
}

function isoOrBlank(value) {
  const candidate = text(value, '', 80);
  if (!candidate) return '';
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? candidate.slice(0, 80) : candidate;
}

function safePayloadValue(value, depth = 0) {
  if (depth > 4 || value === undefined) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return text(value, '', 3000);
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => safePayloadValue(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 100).forEach((key) => {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(key)) return;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      const safeValue = safePayloadValue(value[key], depth + 1);
      if (safeValue !== undefined) result[key] = safeValue;
    });
    return result;
  }
  return undefined;
}

function parsePayload(body) {
  const payload = body && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : body;
  const safe = {};
  const keys = ['employeeName', 'employeeEmail', 'employeeUpn', 'testMode', 'notificationEmail', 'weekStart', 'weekEnd', 'recordDate', 'date', 'action', 'actionLabel', 'status', 'absenceReason', 'startTime', 'finishTime', 'lunchStart', 'lunchEnd', 'dayStart', 'dayFinish', 'workedHours', 'basicHours', 'ot15Hours', 'ot20Hours', 'note', 'location', 'number', 'dateOfEstimate', 'attention', 'company', 'email', 'validity', 'preparedBy', 'vatRate', 'reference', 'opening', 'terms', 'items', 'subtotal', 'vat', 'total', 'jobReference', 'client', 'site', 'engineer', 'plannedDate', 'description', 'cardType', 'jobStatus', 'jobRevision', 'previousRecordId', 'invoiceNumber', 'xeroReference', 'jobEmailUrl', 'jobEmailMessageId', 'updateReason', 'accountNotes', 'title', 'assignee', 'due', 'priority', 'owner', 'type', 'notes', 'rows', 'totals', 'weighted', 'absenceRanges', 'calendarSync'];
  for (const key of keys) {
    if (payload[key] !== undefined) safe[key] = safePayloadValue(payload[key]);
  }
  return safe;
}

function normaliseInput(body, identity, existing = null) {
  const payload = parsePayload(body);
  const kind = canonicalKind(body.kind || body.type || payload.kind);
  if (!ALLOWED_KINDS.has(kind)) throw Object.assign(new Error('Record category is not supported'), { status: 400 });
  const recordId = text(body.recordId || body.sourceRecordId || body.source_record_id || body.gmt_record_id, '', MAX_RECORD_ID);
  if (!recordId) throw Object.assign(new Error('A stable record ID is required'), { status: 400 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._|:/-]*$/.test(recordId)) throw Object.assign(new Error('Record ID contains unsupported characters'), { status: 400 });
  const submittedAt = isoOrBlank(body.submittedAt || body.submitted_at || payload.submittedAt) || (existing && existing.submitted_at) || now();
  const updatedAt = isoOrBlank(body.updatedAt || body.updated_at || payload.updatedAt) || now();
  const requestedEmployeeName = text(body.employeeName || body.employee_name || payload.employeeName, '', 240);
  const requestedTestMode = body.testMode === true || payload.testMode === true || /^(true|1|yes)$/i.test(String(body.testMode || payload.testMode || '').trim());
  // Synthetic verification runs may use a TEST-prefixed label so their
  // outgoing files and current protected projection never contain a real
  // employee name. Normal submissions remain mapped to the signed-in Entra
  // identity and cannot spoof another employee by editing this field.
  const syntheticTestName = /^TEST(?:[\s_-]|$)/i.test(requestedEmployeeName);
  const employeeName = syntheticTestName
    ? requestedEmployeeName
    : (identity.name || requestedEmployeeName || identity.upn);
  const action = text(body.action || body.gmtAction || payload.action || (kind === 'clock' ? 'clock_event' : 'submission'), 'submission', 100);
  const status = text(body.status || payload.status || (kind === 'calendar' || kind === 'tasks' ? 'Pending approval' : 'Submitted'), 'Submitted', 100);
  const startDate = isoOrBlank(body.startDate || body.start_date || payload.weekStart || body.weekStart);
  const endDate = isoOrBlank(body.endDate || body.end_date || payload.weekEnd || body.weekEnd);
  const recordDate = isoOrBlank(body.recordDate || body.record_date || payload.recordDate || payload.date || body.date);
  const privilegedEdit = Boolean(existing && (identity.isAdmin || (existing.kind === 'job-cards' && identity.isJobCardAdmin)));
  return {
    recordId,
    ownerOid: privilegedEdit ? existing.owner_oid : identity.oid,
    ownerUpn: privilegedEdit ? existing.owner_upn : identity.upn,
    employeeName,
    kind,
    action,
    status,
    startDate,
    endDate,
    recordDate,
    submittedAt,
    updatedAt,
    issue: text(body.issue || payload.issue, '', 1000),
    payloadJson: JSON.stringify(payload)
  };
}

function payloadObject(row) {
  try {
    const parsed = JSON.parse(row.payload_json || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function estimateProjection(row, payload) {
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 80).map((item) => ({
    description: text(item && item.description, '', 500),
    quantity: Number(item && item.quantity) || 0,
    unit: Number(item && (item.unit ?? item.unitPrice)) || 0
  })).filter((item) => item.description) : [];
  return {
    estimate_number: text(payload.number || payload.estimateNumber || row.record_id, '', 160),
    estimate_date: text(payload.date || payload.dateOfEstimate || row.record_date, '', 80),
    client_company: text(payload.company || payload.clientCompany, '', 500),
    client_contact: text(payload.attention || payload.clientContact, '', 500),
    client_email: text(payload.email || payload.clientEmail, '', 500),
    validity: text(payload.validity, '30', 80),
    prepared_by: text(payload.preparedBy, '', 240),
    vat_rate: Number(payload.vatRate) || 0,
    reference: text(payload.reference, '', 500),
    opening: text(payload.opening, '', 3000),
    terms: text(payload.terms, '', 3000),
    items,
    subtotal: Number(payload.subtotal) || 0,
    vat: Number(payload.vat) || 0,
    total: Number(payload.total) || 0
  };
}

function jobProjection(row, payload) {
  return {
    job_ref: text(payload.jobReference || payload.ref || row.record_id, '', 180),
    client: text(payload.client || payload.company, '', 500),
    site: text(payload.site || payload.siteAddress, '', 1000),
    engineer: text(payload.engineer || payload.assignedEngineer, '', 240),
    planned_date: text(payload.plannedDate || payload.date || row.record_date, '', 80),
    description: text(payload.description, '', 3000),
    card_type: text(payload.cardType, 'EC', 20).toUpperCase() === 'MTA' ? 'MTA' : 'EC',
    job_status: text(payload.jobStatus || payload.status, row.status || 'Received', 100),
    job_revision: Math.max(1, Number(payload.jobRevision || payload.revision || 1) || 1),
    previous_record_id: text(payload.previousRecordId, '', MAX_RECORD_ID),
    invoice_number: text(payload.invoiceNumber, '', 180),
    xero_reference: text(payload.xeroReference, '', 240),
    job_email_url: httpUrl(payload.jobEmailUrl),
    job_email_message_id: text(payload.jobEmailMessageId, '', 500),
    update_reason: text(payload.updateReason, '', 1000),
    account_notes: text(payload.accountNotes, '', 2000)
  };
}

function taskProjection(row, payload) {
  return {
    task_title: text(payload.title, '', 500),
    job_reference: text(payload.jobReference, '', 180),
    assignee: text(payload.assignee, '', 240),
    due_date: text(payload.due, '', 80),
    priority: text(payload.priority, 'Normal', 40)
  };
}

function calendarProjection(row, payload) {
  return {
    event_title: text(payload.title, '', 500),
    event_date: text(payload.date || row.record_date, '', 80),
    event_type: text(payload.type, 'General', 80),
    owner: text(payload.owner, '', 240),
    notes: text(payload.notes, '', 3000)
  };
}

function projectRow(row, includeDetails = true) {
  const payload = payloadObject(row);
  const result = {
    kind: row.kind,
    employee_name: row.employee_name,
    employee_upn: row.owner_upn,
    start_date: row.start_date || '',
    end_date: row.end_date || '',
    record_date: row.record_date || '',
    action: row.action,
    status: row.status,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    issue: row.issue || '',
    source_record_id: row.record_id,
    can_edit: row.kind === 'timesheets' && isCurrentPayMonthRecord(row)
  };
  if (row.dispatch_status) {
    result.dispatch = {
      status: row.dispatch_status,
      attempts: Number(row.dispatch_attempts || 0),
      queued_at: row.dispatch_queued_at || '',
      sent_at: row.dispatch_last_sent_at || '',
      error: row.dispatch_last_error || ''
    };
  }
  if (!includeDetails) return result;
  if (row.kind === 'estimates') Object.assign(result, estimateProjection(row, payload));
  if (row.kind === 'job-cards') Object.assign(result, jobProjection(row, payload));
  if (row.kind === 'tasks') Object.assign(result, taskProjection(row, payload));
  if (row.kind === 'calendar') Object.assign(result, calendarProjection(row, payload));
  return result;
}

function sameRecord(a, b) {
  return a.owner_oid === b.ownerOid && a.owner_upn === b.ownerUpn && a.employee_name === b.employeeName && a.kind === b.kind && a.action === b.action && a.status === b.status && (a.start_date || '') === b.startDate && (a.end_date || '') === b.endDate && (a.record_date || '') === b.recordDate && a.issue === b.issue && a.payload_json === b.payloadJson;
}

async function saveRecord(env, input, identity, existing = null) {
  const changed = existing && !sameRecord(existing, input);
  if (changed) {
    await env.DB.prepare('INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid) VALUES (?, ?, ?, ?, ?)')
      .bind(existing.record_id, existing.owner_oid, JSON.stringify({
        employee_name: existing.employee_name,
        kind: existing.kind,
        action: existing.action,
        status: existing.status,
        start_date: existing.start_date,
        end_date: existing.end_date,
        record_date: existing.record_date,
        submitted_at: existing.submitted_at,
        updated_at: existing.updated_at,
        issue: existing.issue,
        payload: payloadObject(existing)
      }), now(), identity.oid).run();
  }
  if (!existing) {
    await env.DB.prepare(`INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date, record_date, submitted_at, updated_at, issue, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.recordId, input.ownerOid, input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson).run();
    return { created: true, changed: false };
  }
  await env.DB.prepare(`UPDATE records SET owner_upn = ?, employee_name = ?, kind = ?, action = ?, status = ?, start_date = ?, end_date = ?, record_date = ?, submitted_at = ?, updated_at = ?, issue = ?, payload_json = ? WHERE record_id = ?`)
    .bind(input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson, input.recordId).run();
  return { created: false, changed };
}

async function deleteRecord(env, existing, identity) {
  const deletableStatuses = new Set(['draft', 'pending delivery', 'delivery failed']);
  if (!identity.isAdmin && !deletableStatuses.has(String(existing.status || '').toLowerCase())) {
    throw Object.assign(new Error('Submitted records cannot be deleted'), { status: 409 });
  }
  await env.DB.prepare('INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid) VALUES (?, ?, ?, ?, ?)')
    .bind(existing.record_id, existing.owner_oid, JSON.stringify({
      employee_name: existing.employee_name,
      kind: existing.kind,
      action: existing.action,
      status: existing.status,
      start_date: existing.start_date,
      end_date: existing.end_date,
      record_date: existing.record_date,
      submitted_at: existing.submitted_at,
      updated_at: existing.updated_at,
      issue: existing.issue,
      payload: payloadObject(existing)
    }), now(), identity.oid).run();
  await env.DB.prepare("UPDATE records SET status = 'Deleted', issue = ?, payload_json = ?, updated_at = ? WHERE record_id = ?")
    .bind('Deleted by ' + identity.upn, '{}', now(), existing.record_id).run();
  return { deleted: true, soft_deleted: true };
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw Object.assign(new Error('Request is too large'), { status: 413 });
  const textBody = await request.text();
  if (textBody.length > MAX_BODY_BYTES) throw Object.assign(new Error('Request is too large'), { status: 413 });
  try {
    const body = JSON.parse(textBody || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object expected');
    return body;
  } catch (_) {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 });
  }
}

function parseQueuedAttachments(body) {
  const raw = body && Array.isArray(body.attachments) ? body.attachments : [];
  if (raw.length < 2 || raw.length > ATTACHMENT_FIELDS.size) {
    throw Object.assign(new Error('The correction must include its XLSX and CSV attachments'), { status: 400 });
  }
  const seen = new Set();
  let totalBytes = 0;
  const attachments = raw.map((item) => {
    if (!item || typeof item !== 'object') throw Object.assign(new Error('Invalid attachment'), { status: 400 });
    const fieldName = text(item.fieldName || item.field_name, '', 80);
    if (!ATTACHMENT_FIELDS.has(fieldName) || seen.has(fieldName)) throw Object.assign(new Error('Unsupported or duplicate attachment field'), { status: 400 });
    seen.add(fieldName);
    const fileName = safeAttachmentName(item.fileName || item.file_name);
    const contentType = attachmentType(fieldName, fileName, item.contentType || item.content_type);
    const contentBase64 = String(item.contentBase64 || item.content_base64 || '');
    const sizeBytes = base64ByteLength(contentBase64);
    if (!fileName || !contentType || sizeBytes < 1 || sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(new Error('Invalid or oversized attachment'), { status: 400 });
    }
    totalBytes += sizeBytes;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw Object.assign(new Error('Correction attachments are too large'), { status: 413 });
    return { fieldName, fileName, contentType, contentBase64, sizeBytes };
  });
  if (!seen.has('attachment') || !seen.has('attachment_csv')) {
    throw Object.assign(new Error('Both XLSX and CSV attachments are required'), { status: 400 });
  }
  return attachments;
}

function queueRecordAttachments(env, record, body) {
  const payload = payloadObject(record);
  if (syntheticRecord(record, payload)) {
    return { queued: false, skipped: true, reason: 'synthetic-test-record' };
  }
  const attachments = parseQueuedAttachments(body);
  const timestamp = now();
  const statements = [
    env.DB.prepare('DELETE FROM record_attachments WHERE record_id = ?').bind(record.record_id),
    ...attachments.map((attachment) => env.DB.prepare(`INSERT INTO record_attachments (record_id, field_name, file_name, content_type, content_base64, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(record.record_id, attachment.fieldName, attachment.fileName, attachment.contentType, attachment.contentBase64, attachment.sizeBytes, timestamp)),
    env.DB.prepare(`INSERT INTO dispatch_queue (record_id, status, queued_at, updated_at, attempts, next_attempt_at, last_sent_at, last_error)
      VALUES (?, 'queued', ?, ?, 0, ?, NULL, NULL)
      ON CONFLICT(record_id) DO UPDATE SET status = 'queued', queued_at = excluded.queued_at,
        updated_at = excluded.updated_at, attempts = 0, next_attempt_at = excluded.next_attempt_at,
        last_sent_at = NULL, last_error = NULL`).bind(record.record_id, timestamp, timestamp, timestamp),
    env.DB.prepare("UPDATE records SET status = 'Queued for Accounts', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, record.record_id)
  ];
  return env.DB.batch(statements).then(() => ({ queued: true, recordId: record.record_id, attachments: attachments.length, queuedAt: timestamp }));
}

function dispatchEndpoint(env) {
  const endpoint = text(env.FORM_SUBMIT_TIMESHEET_ENDPOINT, '', 2000);
  if (!endpoint) return '';
  if (/^https:\/\/formsubmit\.co\/ajax\//i.test(endpoint)) return endpoint;
  if (/^https:\/\/formsubmit\.co\//i.test(endpoint)) return endpoint.replace('https://formsubmit.co/', 'https://formsubmit.co/ajax/');
  return endpoint;
}

function submissionKeyPart(value) {
  return text(value, 'unknown', 240).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function decodeBase64(value) {
  const candidate = String(value || '');
  const binary = atob(candidate);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function dispatchForm(record, attachments) {
  const payload = payloadObject(record);
  const calendarSync = payload.calendarSync && typeof payload.calendarSync === 'object' ? payload.calendarSync : {};
  const totals = payload.totals && typeof payload.totals === 'object' ? payload.totals : {};
  const events = Array.isArray(calendarSync.events) ? calendarSync.events : [];
  const isSynthetic = syntheticRecord(record, payload);
  const employeeName = text(record.employee_name || payload.employeeName || record.owner_upn, record.owner_upn, 240);
  // For real records, the verified D1 owner is authoritative. Browser payload
  // fields are retained for the synthetic test path only, so a user cannot
  // redirect a correction to another employee's workbook or reply address.
  const employeeEmail = text(isSynthetic ? (payload.employeeEmail || record.owner_upn) : record.owner_upn, record.owner_upn, 320);
  const employeeUpn = text(isSynthetic ? (payload.employeeUpn || record.owner_upn) : record.owner_upn, record.owner_upn, 320);
  const weekStart = text(payload.weekStart || record.start_date, '', 80);
  const weekEnd = text(payload.weekEnd || record.end_date || weekStart, weekStart, 80);
  const month = weekStart.slice(0, 7) || 'unspecified';
  const workbookKey = `timesheet-${submissionKeyPart(employeeUpn || employeeEmail || employeeName)}-${month}`;
  const form = new FormData();
  const set = (name, value) => form.set(name, String(value == null ? '' : value));
  set('_subject', `[GMT][TIMESHEET][CORRECTION] ${employeeName} | Week ${weekStart || 'unspecified'}`);
  set('_template', 'box');
  set('_captcha', 'false');
  set('_url', 'https://gmt-services.co.uk/portal/timesheets');
  set('_replyto', employeeEmail);
  set('email', employeeEmail);
  set('employee_name', employeeName);
  set('gmt_type', 'timesheet');
  set('gmt_action', 'correction');
  set('gmt_schema_version', '1');
  set('gmt_record_id', record.record_id);
  set('gmt_submission_id', record.record_id);
  set('gmt_workbook_key', workbookKey);
  set('gmt_filing_mode', 'monthly-upsert');
  set('gmt_employee', employeeName);
  set('gmt_employee_upn', employeeUpn);
  set('gmt_week_start', weekStart);
  set('gmt_week_end', weekEnd);
  set('gmt_year', weekStart.slice(0, 4));
  set('gmt_month', weekStart.slice(5, 7));
  set('gmt_worked_hours', hours(totals.workedActual));
  set('gmt_basic_hours', hours(totals.basic));
  set('gmt_ot15_hours', hours(totals.ot15));
  set('gmt_ot20_hours', hours(totals.ot20));
  set('gmt_absence_count', events.filter((event) => event && event.type === 'absence').length);
  set('gmt_calendar_sync', 'requested');
  set('gmt_calendar_name', text(calendarSync.calendarName, 'GMT Operational Calendar', 240));
  set('gmt_calendar_event_count', events.length);
  set('gmt_attachment_manifest', 'record-json,xlsx,csv,calendar-sync-json');
  set('gmt_submitted_at', text(calendarSync.submittedAt || record.submitted_at, record.submitted_at, 100));
  set('summary', `Worked ${(Number(totals.workedActual) / 60 || 0).toFixed(2)}h | Basic ${(Number(totals.basic) / 60 || 0).toFixed(2)}h | OT x1.5 ${(Number(totals.ot15) / 60 || 0).toFixed(2)}h | OT x2.0 ${(Number(totals.ot20) / 60 || 0).toFixed(2)}h`);
  set('message', `Corrected timesheet attachments for ${employeeName}, week ${weekStart || 'unspecified'}. The existing Record ID is retained for idempotent filing.`);
  attachments.forEach((attachment) => {
    const fieldName = attachment.field_name || attachment.fieldName;
    const contentType = attachment.content_type || attachment.contentType;
    const fileName = attachment.file_name || attachment.fileName;
    const bytes = decodeBase64(attachment.content_base64 || attachment.contentBase64);
    form.append(fieldName, new Blob([bytes], { type: contentType }), fileName);
  });
  return form;
}

function retryAt(timestamp, attempts) {
  const delay = Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.min(Math.max(attempts - 1, 0), 7)));
  return new Date(new Date(timestamp).getTime() + delay).toISOString();
}

async function dispatchQueued(env, options = {}) {
  const endpoint = dispatchEndpoint(env);
  if (!endpoint) return { status: 'not-configured', sent: 0, failed: 0, skipped: 0 };
  const timestamp = options.now || now();
  const limit = Math.min(Math.max(Number(options.limit || MAX_QUEUE_BATCH), 1), MAX_QUEUE_BATCH);
  const result = await env.DB.prepare(`SELECT q.record_id, q.status AS dispatch_status, q.queued_at, q.updated_at AS dispatch_updated_at,
      q.attempts, q.next_attempt_at, q.last_sent_at, q.last_error, r.*
    FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id
    WHERE q.status IN ('queued', 'failed') AND q.next_attempt_at <= ? AND r.status <> 'Deleted'
    ORDER BY q.queued_at ASC LIMIT ?`).bind(timestamp, limit).all();
  const summary = { status: 'complete', sent: 0, failed: 0, skipped: 0, dryRun: Boolean(options.dryRun), records: [] };
  for (const row of result.results || []) {
    const payload = payloadObject(row);
    if (options.dryRun) {
      summary.records.push({ recordId: row.record_id, status: syntheticRecord(row, payload) ? 'skipped-dry-run' : 'dry-run' });
      continue;
    }
    if (syntheticRecord(row, payload)) {
      await env.DB.prepare("UPDATE dispatch_queue SET status = 'skipped', updated_at = ?, last_error = ? WHERE record_id = ?").bind(timestamp, timestamp, 'Synthetic test record was not dispatched').run();
      await env.DB.prepare("UPDATE records SET status = 'Test - not sent', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, row.record_id).run();
      summary.skipped += 1;
      summary.records.push({ recordId: row.record_id, status: 'skipped' });
      continue;
    }
    const claim = await env.DB.prepare(`UPDATE dispatch_queue SET status = 'sending', attempts = attempts + 1, updated_at = ?
      WHERE record_id = ? AND status IN ('queued', 'failed') AND next_attempt_at <= ?`).bind(timestamp, row.record_id, timestamp).run();
    if (Number(claim?.meta?.changes ?? 1) < 1) continue;
    try {
      const attachmentsResult = await env.DB.prepare(`SELECT field_name, file_name, content_type, content_base64, size_bytes
        FROM record_attachments WHERE record_id = ? ORDER BY field_name`).bind(row.record_id).all();
      const attachments = attachmentsResult.results || [];
      if (!attachments.some((attachment) => attachment.field_name === 'attachment') || !attachments.some((attachment) => attachment.field_name === 'attachment_csv')) {
        throw new Error('Queued correction attachments are incomplete');
      }
      const response = await (options.fetchImpl || fetch)(endpoint, {
        method: 'POST',
        body: dispatchForm(row, attachments),
        headers: { Accept: 'application/json' }
      });
      const responseText = await response.text();
      let body = null;
      try { body = responseText ? JSON.parse(responseText) : null; } catch (_) {}
      if (!response.ok || (body && (body.success === false || body.success === 'false'))) {
        throw new Error(`FormSubmit rejected the correction (${response.status})`);
      }
      await env.DB.prepare(`UPDATE dispatch_queue SET status = 'sent', updated_at = ?, last_sent_at = ?, last_error = NULL WHERE record_id = ?`).bind(timestamp, timestamp, row.record_id).run();
      await env.DB.prepare("UPDATE records SET status = 'Sent to Accounts', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, row.record_id).run();
      summary.sent += 1;
      summary.records.push({ recordId: row.record_id, status: 'sent' });
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const message = text(error?.message, 'Correction dispatch failed', 1000);
      await env.DB.prepare(`UPDATE dispatch_queue SET status = 'failed', updated_at = ?, next_attempt_at = ?, last_error = ? WHERE record_id = ?`).bind(timestamp, retryAt(timestamp, attempts), message, row.record_id).run();
      await env.DB.prepare("UPDATE records SET status = 'Delivery failed', issue = ?, updated_at = ? WHERE record_id = ?").bind(message, timestamp, row.record_id).run();
      summary.failed += 1;
      summary.records.push({ recordId: row.record_id, status: 'failed', error: message });
    }
  }
  return summary;
}

async function listRecords(request, env, identity) {
  const url = new URL(request.url);
  const requestedKind = url.searchParams.get('kind') || 'all';
  const kind = requestedKind === 'all' ? '' : canonicalKind(requestedKind);
  if (kind && !ALLOWED_KINDS.has(kind)) throw Object.assign(new Error('Record category is not supported'), { status: 400 });
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 500);
  const projection = `SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
      q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at,
      q.last_error AS dispatch_last_error
    FROM records r LEFT JOIN dispatch_queue q ON q.record_id = r.record_id`;
  const viewAll = canViewAllRecords(identity, kind);
  const jobCardAdminAcrossKinds = !kind && identity.isJobCardAdmin && !identity.isAdmin;
  const sql = identity.isAdmin
    ? (kind ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`)
    : viewAll
      ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`
      : jobCardAdminAcrossKinds
        ? `${projection} WHERE r.status <> 'Deleted' AND (r.owner_oid = ? OR r.kind = 'job-cards') ORDER BY r.updated_at DESC LIMIT ?`
        : (kind ? `${projection} WHERE r.owner_oid = ? AND r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE r.owner_oid = ? AND r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`);
  const bindings = identity.isAdmin
    ? (kind ? [kind, limit] : [limit])
    : viewAll
      ? ['job-cards', limit]
      : jobCardAdminAcrossKinds
        ? [identity.oid, limit]
        : (kind ? [identity.oid, kind, limit] : [identity.oid, limit]);
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  let records = (result.results || []).map((row) => projectRow(row));
  let upstream = 'not-configured';
  const upstreamUrl = text(env.HISTORY_UPSTREAM_URL, '', 2000);
  const token = bearerToken(request);
  const flowAudience = audienceValue('https://service.flow.microsoft.com/');
  if (upstreamUrl && token && identity.aud === flowAudience && (!kind || kind === 'timesheets' || kind === 'clock')) {
    try {
      const upstreamResponse = await fetch(upstreamUrl, { headers: { accept: 'application/json', authorization: `Bearer ${token}` }, cf: { cacheTtl: 0, cacheEverything: false } });
      if (upstreamResponse.ok) {
        const body = await upstreamResponse.json();
        if (body && Array.isArray(body.records)) {
          const upstreamRecords = body.records.filter((row) => row && typeof row === 'object' && (identity.isAdmin || String(row.employee_upn || row.employeeEmail || row.employee_email || '').toLowerCase() === identity.upn)).map((row) => ({
            employee_name: text(row.employee_name || row.employeeName, identity.name || identity.upn, 240),
            employee_upn: identity.upn,
            start_date: text(row.start_date || row.weekStart, '', 80),
            end_date: text(row.end_date || row.weekEnd, '', 80),
            record_date: text(row.record_date || row.recordDate || row.date, '', 80),
            action: text(row.action || row.category || row.record_type || row.kind || 'Timesheet', 'Timesheet', 100),
            status: text(row.status, 'Submitted', 100),
            submitted_at: text(row.submitted_at || row.submittedAt, '', 100),
            updated_at: text(row.updated_at || row.updatedAt || row.submitted_at || row.submittedAt, '', 100),
            issue: text(row.issue, '', 1000),
            source_record_id: text(row.source_record_id || row.sourceRecordId || row.gmt_record_id, '', MAX_RECORD_ID),
            can_edit: false
          })).filter((row) => !kind || canonicalKind(row.action) === kind || (kind === 'timesheets' && canonicalKind(row.action) === 'submission'));
          const localIds = new Set(records.map((row) => row.source_record_id));
          records = [...records, ...upstreamRecords.filter((row) => !localIds.has(row.source_record_id))];
          upstream = 'ok';
        } else upstream = 'invalid-response';
      } else upstream = `http-${upstreamResponse.status}`;
    } catch (_) {
      upstream = 'unavailable';
    }
  } else if (upstreamUrl && token && (!kind || kind === 'timesheets' || kind === 'clock')) {
    upstream = 'flow-permission-not-configured';
  }
  records.sort((a, b) => String(b.updated_at || b.submitted_at).localeCompare(String(a.updated_at || a.submitted_at)));
  return {
    records,
    meta: {
      upstream,
      role: identity.isAdmin ? 'accounts-admin' : (identity.isJobCardAdmin ? 'job-card-admin' : 'employee'),
      is_admin: identity.isAdmin,
      is_job_card_admin: identity.isJobCardAdmin,
      visible_scope: identity.isAdmin ? 'all employee submissions' : (identity.isJobCardAdmin ? 'all job cards; this account submissions for other categories' : 'this account submissions')
    }
  };
}

async function handle(request, env) {
  const origin = allowedOrigin(request, env);
  if (origin === null) return json({ error: 'Origin is not allowed' }, 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin || '') });
  }
  const url = new URL(request.url);
  if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'gmt-portal-api', version: 1 }, 200, origin || '');
  const identity = await authenticate(request, env);
  if (!env.DB) throw Object.assign(new Error('Protected storage is not configured'), { status: 503 });

  if (url.pathname === '/api/history' && request.method === 'GET') {
    return json(await listRecords(request, env, identity), 200, origin || '');
  }

  if (url.pathname === '/api/records' && request.method === 'POST') {
    const body = await readJson(request);
    const recordId = text(body.recordId || body.sourceRecordId || body.source_record_id || body.gmt_record_id, '', MAX_RECORD_ID);
    const existing = recordId ? await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first() : null;
    if (existing && existing.status === 'Deleted') throw Object.assign(new Error('This record has been deleted'), { status: 409 });
    if (existing && !canAccessRecord(identity, existing)) throw Object.assign(new Error('This record belongs to another GMT account'), { status: 403 });
    if (existing && existing.kind === 'timesheets' && !isCurrentPayMonthRecord(existing)) throw Object.assign(new Error('Only timesheets made within the current pay month may be edited.'), { status: 409 });
    const input = normaliseInput(body, existing && (identity.isAdmin || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing);
    const result = await saveRecord(env, input, identity, existing);
    return json({ ok: true, record_id: input.recordId, ...result }, result.created ? 201 : 200, origin || '');
  }

  const attachmentMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments$/);
  if (attachmentMatch && request.method === 'POST') {
    const recordId = decodeURIComponent(attachmentMatch[1]);
    const existing = await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
    if (!existing) return json({ error: 'Record not found' }, 404, origin || '');
    if (!canAccessRecord(identity, existing)) return json({ error: 'Record access is not permitted' }, 403, origin || '');
    if (existing.status === 'Deleted') return json({ error: 'Record has been deleted' }, 410, origin || '');
    if (existing.kind !== 'timesheets') return json({ error: 'Only timesheet corrections can be queued' }, 400, origin || '');
    const body = await readJson(request);
    const result = await queueRecordAttachments(env, existing, body);
    if (result.skipped) {
      const timestamp = now();
      await env.DB.prepare("UPDATE records SET status = 'Test - not sent', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, recordId).run();
      return json({ ok: true, record_id: recordId, ...result }, 200, origin || '');
    }
    return json({ ok: true, record_id: recordId, ...result }, 202, origin || '');
  }

  const detailMatch = url.pathname.match(/^\/api\/records\/([^/]+)$/);
  if (detailMatch) {
    const recordId = decodeURIComponent(detailMatch[1]);
    const existing = await env.DB.prepare(`SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
        q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at,
        q.last_error AS dispatch_last_error
      FROM records r LEFT JOIN dispatch_queue q ON q.record_id = r.record_id WHERE r.record_id = ?`).bind(recordId).first();
    if (!existing) return json({ error: 'Record not found' }, 404, origin || '');
    if (!canAccessRecord(identity, existing)) return json({ error: 'Record access is not permitted' }, 403, origin || '');
    if (existing.status === 'Deleted') return json({ error: 'Record has been deleted' }, 410, origin || '');
    if (request.method === 'GET') return json({ record: projectRow(existing, true), payload: payloadObject(existing) }, 200, origin || '');
    if (request.method === 'PATCH') {
      if (existing.kind === 'timesheets' && !isCurrentPayMonthRecord(existing)) return json({ error: 'Only timesheets made within the current pay month may be edited.' }, 409, origin || '');
      const body = await readJson(request);
      const input = normaliseInput({ ...body, recordId }, (identity.isAdmin || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing);
      const result = await saveRecord(env, input, identity, existing);
      return json({ ok: true, record_id: input.recordId, ...result }, 200, origin || '');
    }
    if (request.method === 'DELETE') {
      const result = await deleteRecord(env, existing, identity);
      return json({ ok: true, record_id: recordId, ...result }, 200, origin || '');
    }
  }
  return json({ error: 'Route not found' }, 404, origin || '');
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      const status = Number(error && error.status) || 500;
      const message = status >= 500 ? 'GMT portal service is temporarily unavailable' : (error.message || 'Request failed');
      const origin = allowedOrigin(request, env);
      return json({ error: message }, status, origin || '');
    }
  },

  async scheduled(event, env, ctx) {
    const scheduledAt = new Date(Number(event?.scheduledTime || Date.now()));
    if (!shouldDispatchNow(scheduledAt, env)) return;
    ctx.waitUntil(dispatchQueued(env));
  }
};

export {
  dispatchEndpoint,
  dispatchForm,
  dispatchQueued,
  parseQueuedAttachments,
  shouldDispatchNow,
  monthKeyInTimeZone,
  recordMonthKey,
  isCurrentPayMonthRecord,
  isCurrentMonthRecord,
  projectRow,
  canViewAllRecords,
  canAccessRecord,
  tokenIdentity
};
