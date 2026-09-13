const ALLOWED_KINDS = new Set(['timesheets', 'clock', 'estimates', 'job-cards', 'calendar', 'tasks', 'audit']);
const MAX_BODY_BYTES = 900_000;
const MAX_RECORD_ID = 180;
const MAX_TEXT = 6000;
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
  const groups = Array.isArray(claims.groups) ? claims.groups.map((item) => String(item).toLowerCase()) : [];
  return {
    oid,
    upn,
    name: String(claims.name || '').trim(),
    aud: audienceValue(claims.aud),
    tid: tokenTenant,
    isAdmin: adminUpns.has(upn) || adminOids.has(oid.toLowerCase()) || groups.some((group) => adminGroups.has(group))
  };
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
  const keys = ['employeeName', 'employeeEmail', 'employeeUpn', 'testMode', 'notificationEmail', 'weekStart', 'weekEnd', 'recordDate', 'date', 'action', 'actionLabel', 'status', 'absenceReason', 'startTime', 'finishTime', 'lunchStart', 'lunchEnd', 'dayStart', 'dayFinish', 'workedHours', 'basicHours', 'ot15Hours', 'ot20Hours', 'note', 'location', 'number', 'dateOfEstimate', 'attention', 'company', 'email', 'validity', 'preparedBy', 'vatRate', 'reference', 'opening', 'terms', 'items', 'subtotal', 'vat', 'total', 'jobReference', 'client', 'site', 'engineer', 'plannedDate', 'description', 'rows', 'totals', 'weighted', 'absenceRanges', 'calendarSync'];
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
  const syntheticTestName = requestedTestMode && /^TEST(?:[\s_-]|$)/i.test(requestedEmployeeName);
  const employeeName = syntheticTestName
    ? requestedEmployeeName
    : (identity.name || requestedEmployeeName || identity.upn);
  const action = text(body.action || body.gmtAction || payload.action || (kind === 'clock' ? 'clock_event' : 'submission'), 'submission', 100);
  const status = text(body.status || payload.status || (kind === 'calendar' || kind === 'tasks' ? 'Pending approval' : 'Submitted'), 'Submitted', 100);
  const startDate = isoOrBlank(body.startDate || body.start_date || payload.weekStart || body.weekStart);
  const endDate = isoOrBlank(body.endDate || body.end_date || payload.weekEnd || body.weekEnd);
  const recordDate = isoOrBlank(body.recordDate || body.record_date || payload.recordDate || payload.date || body.date);
  return {
    recordId,
    ownerOid: identity.oid,
    ownerUpn: identity.upn,
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
    description: text(payload.description, '', 3000)
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
    source_record_id: row.record_id
  };
  if (!includeDetails) return result;
  if (row.kind === 'estimates') Object.assign(result, estimateProjection(row, payload));
  if (row.kind === 'job-cards') Object.assign(result, jobProjection(row, payload));
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

async function listRecords(request, env, identity) {
  const url = new URL(request.url);
  const requestedKind = url.searchParams.get('kind') || 'all';
  const kind = requestedKind === 'all' ? '' : canonicalKind(requestedKind);
  if (kind && !ALLOWED_KINDS.has(kind)) throw Object.assign(new Error('Record category is not supported'), { status: 400 });
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 500);
  const sql = identity.isAdmin
    ? (kind ? "SELECT * FROM records WHERE status <> 'Deleted' AND kind = ? ORDER BY updated_at DESC LIMIT ?" : "SELECT * FROM records WHERE status <> 'Deleted' ORDER BY updated_at DESC LIMIT ?")
    : (kind ? "SELECT * FROM records WHERE owner_oid = ? AND status <> 'Deleted' AND kind = ? ORDER BY updated_at DESC LIMIT ?" : "SELECT * FROM records WHERE owner_oid = ? AND status <> 'Deleted' ORDER BY updated_at DESC LIMIT ?");
  const bindings = identity.isAdmin ? (kind ? [kind, limit] : [limit]) : (kind ? [identity.oid, kind, limit] : [identity.oid, limit]);
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
            source_record_id: text(row.source_record_id || row.sourceRecordId || row.gmt_record_id, '', MAX_RECORD_ID)
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
  return { records, meta: { upstream } };
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
    if (existing && existing.owner_oid !== identity.oid && !identity.isAdmin) throw Object.assign(new Error('This record belongs to another GMT account'), { status: 403 });
    const input = normaliseInput(body, existing && identity.isAdmin ? { ...identity, name: existing.employee_name } : identity, existing);
    const result = await saveRecord(env, input, identity, existing);
    return json({ ok: true, record_id: input.recordId, ...result }, result.created ? 201 : 200, origin || '');
  }

  const detailMatch = url.pathname.match(/^\/api\/records\/([^/]+)$/);
  if (detailMatch) {
    const recordId = decodeURIComponent(detailMatch[1]);
    const existing = await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
    if (!existing) return json({ error: 'Record not found' }, 404, origin || '');
    if (existing.owner_oid !== identity.oid && !identity.isAdmin) return json({ error: 'Record access is not permitted' }, 403, origin || '');
    if (existing.status === 'Deleted') return json({ error: 'Record has been deleted' }, 410, origin || '');
    if (request.method === 'GET') return json({ record: projectRow(existing, true), payload: payloadObject(existing) }, 200, origin || '');
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const input = normaliseInput({ ...body, recordId }, identity.isAdmin ? { ...identity, name: existing.employee_name } : identity, existing);
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
  }
};
