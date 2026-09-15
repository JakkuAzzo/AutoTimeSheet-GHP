const ALLOWED_KINDS = new Set(['timesheets', 'clock', 'estimates', 'job-cards', 'calendar', 'tasks', 'audit', 'enquiries']);
const MAX_BODY_BYTES = 1_300_000;
const MAX_RECORD_ID = 180;
const MAX_TEXT = 6000;
const MAX_ATTACHMENT_BYTES = 220_000;
const MAX_ATTACHMENT_TOTAL_BYTES = 700_000;
const MAX_QUEUE_BATCH = 25;
const MAX_PROFILE_NAME = 240;
const MAX_PROFILE_EMAIL = 320;
const ATTACHMENT_FIELDS = new Set(['attachment_record', 'attachment', 'attachment_csv', 'attachment_calendar_sync']);
const JWKS_CACHE = new Map();

function now() {
  return new Date().toISOString();
}

function json(data, status = 200, origin = '', extraHeaders = {}) {
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
  Object.entries(extraHeaders || {}).forEach(([name, value]) => { headers[name] = value; });
  return new Response(JSON.stringify(data), { status, headers });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'Authorization, X-GMT-Upstream-Authorization, Content-Type, Accept',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return base64UrlEncode(new Uint8Array(bytes));
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

function bearerToken(request, headerName = 'Authorization') {
  const value = request.headers.get(headerName) || '';
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
  const operationsAdminUpns = csvSet(env.OPERATIONS_ADMIN_UPNS);
  const groups = Array.isArray(claims.groups) ? claims.groups.map((item) => String(item).toLowerCase()) : [];
  const isAdmin = adminUpns.has(upn) || adminOids.has(oid.toLowerCase()) || groups.some((group) => adminGroups.has(group));
  return {
    oid,
    upn,
    name: String(claims.name || '').trim(),
    aud: audienceValue(claims.aud),
    tid: tokenTenant,
    isAdmin,
    isOperationsAdmin: isAdmin || operationsAdminUpns.has(upn),
    isJobCardAdmin: isAdmin || operationsAdminUpns.has(upn) || jobCardAdminUpns.has(upn)
  };
}

function canViewAllRecords(identity, kind = '') {
  return Boolean(identity?.isAdmin || (identity?.isOperationsAdmin && kind !== 'timesheets' && kind !== 'clock') || (kind === 'job-cards' && identity?.isJobCardAdmin));
}

function canAccessRecord(identity, row) {
  return Boolean(row && (row.owner_oid === identity.oid || identity.isAdmin || (identity.isOperationsAdmin && row.kind !== 'timesheets' && row.kind !== 'clock') || (row.kind === 'job-cards' && identity.isJobCardAdmin)));
}

async function authenticateToken(token, env) {
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

async function authenticate(request, env) {
  return authenticateToken(bearerToken(request), env);
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

function profileDisplayName(value, fallback = '') {
  const candidate = text(value, fallback, MAX_PROFILE_NAME);
  // A missing Entra display name can be returned as the sign-in address. It
  // is useful as an identity fallback, but it must not be saved as a full name.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? '' : candidate;
}

function profileNotificationEmail(value) {
  const candidate = text(value, '', MAX_PROFILE_EMAIL);
  if (!candidate) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
    throw Object.assign(new Error('Enter a valid personal email address.'), { status: 400 });
  }
  return candidate;
}

function profileView(identity, row = null) {
  return {
    name: row ? text(row.display_name, '', MAX_PROFILE_NAME) : profileDisplayName(identity.name),
    username: identity.upn,
    notificationEmail: row ? text(row.notification_email, '', MAX_PROFILE_EMAIL) : '',
    updatedAt: row ? text(row.updated_at, '', 80) : '',
    source: row ? 'portal-d1' : 'identity-default'
  };
}

async function getProfileSettings(env, identity) {
  const row = await env.DB.prepare(`SELECT display_name, notification_email, updated_at
    FROM profile_settings WHERE owner_oid = ?`).bind(identity.oid).first();
  return profileView(identity, row || null);
}

async function saveProfileSettings(env, identity, body) {
  const existing = await env.DB.prepare(`SELECT display_name, notification_email
    FROM profile_settings WHERE owner_oid = ?`).bind(identity.oid).first();
  const hasName = Object.prototype.hasOwnProperty.call(body || {}, 'name') || Object.prototype.hasOwnProperty.call(body || {}, 'displayName');
  const hasNotificationEmail = Object.prototype.hasOwnProperty.call(body || {}, 'notificationEmail') || Object.prototype.hasOwnProperty.call(body || {}, 'notification_email');
  const displayName = hasName
    ? profileDisplayName(body.name ?? body.displayName, '')
    : text(existing?.display_name, '', MAX_PROFILE_NAME);
  const notificationEmail = hasNotificationEmail
    ? profileNotificationEmail(body.notificationEmail ?? body.notification_email)
    : text(existing?.notification_email, '', MAX_PROFILE_EMAIL);
  const updatedAt = now();
  await env.DB.prepare(`INSERT INTO profile_settings
      (owner_oid, owner_upn, display_name, notification_email, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_oid) DO UPDATE SET owner_upn = excluded.owner_upn,
      display_name = excluded.display_name, notification_email = excluded.notification_email,
      updated_at = excluded.updated_at`).bind(
    identity.oid,
    identity.upn,
    displayName,
    notificationEmail,
    updatedAt
  ).run();
  return profileView(identity, {
    display_name: displayName,
    notification_email: notificationEmail,
    updated_at: updatedAt
  });
}

const XERO_DEFAULT_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_DEFAULT_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_DEFAULT_API_URL = 'https://api.xero.com';
const XERO_DEFAULT_RETURN_URL = 'https://gmt-services.co.uk/jobs/?xero=connected';
const XERO_DEFAULT_SCOPES = 'openid profile email offline_access accounting.invoices.read';

function xeroSettings(env) {
  const clientId = text(env.XERO_CLIENT_ID, '', 240);
  const clientSecret = text(env.XERO_CLIENT_SECRET, '', 500);
  const redirectUri = text(env.XERO_REDIRECT_URI, '', 2000);
  const encryptionKey = text(env.XERO_TOKEN_ENCRYPTION_KEY, '', 1000);
  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    authUrl: text(env.XERO_AUTH_URL, XERO_DEFAULT_AUTH_URL, 2000),
    tokenUrl: text(env.XERO_TOKEN_URL, XERO_DEFAULT_TOKEN_URL, 2000),
    apiUrl: text(env.XERO_API_URL, XERO_DEFAULT_API_URL, 2000).replace(/\/+$/, ''),
    scopes: text(env.XERO_SCOPES, XERO_DEFAULT_SCOPES, 1000),
    returnUrl: safeXeroReturnUrl(env.XERO_POST_CONNECT_REDIRECT, env),
    configured: Boolean(clientId && clientSecret && redirectUri && encryptionKey)
  };
}

function safeXeroReturnUrl(value, env) {
  const fallback = XERO_DEFAULT_RETURN_URL;
  const candidate = text(value, fallback, 2000);
  try {
    const parsed = new URL(candidate);
    const allowed = csvSet(env?.ALLOWED_ORIGINS);
    return allowed.has(parsed.origin.toLowerCase()) ? parsed.href : fallback;
  } catch (_) {
    return fallback;
  }
}

function decodeXeroKey(value) {
  const candidate = text(value, '', 1000);
  if (!candidate) return null;
  try {
    if (/^[0-9a-f]{64}$/i.test(candidate)) return Uint8Array.from(candidate.match(/.{2}/g).map((pair) => parseInt(pair, 16)));
    const decoded = base64UrlDecode(candidate);
    return decoded.length === 32 ? decoded : null;
  } catch (_) {
    return null;
  }
}

async function xeroCryptoKey(settings, usages) {
  const bytes = decodeXeroKey(settings.encryptionKey);
  if (!bytes || bytes.length !== 32) throw Object.assign(new Error('Xero token encryption is not configured'), { status: 503 });
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usages);
}

async function encryptXeroSecret(value, settings) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await xeroCryptoKey(settings, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(value || '')));
  return { iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(new Uint8Array(ciphertext)) };
}

async function decryptXeroSecret(ciphertext, iv, settings) {
  try {
    const key = await xeroCryptoKey(settings, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(iv) }, key, base64UrlDecode(ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch (_) {
    throw Object.assign(new Error('Stored Xero token cannot be decrypted'), { status: 503 });
  }
}

function xeroCookieState(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)gmt_xero_oauth_state=([^;]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch (_) { return ''; }
}

function xeroStateCookie(value, maxAge = 600) {
  return `gmt_xero_oauth_state=${encodeURIComponent(value || '')}; Max-Age=${maxAge}; Path=/api/xero; HttpOnly; Secure; SameSite=None`;
}

function xeroBasicAuth(settings) {
  return `Basic ${btoa(`${settings.clientId}:${settings.clientSecret}`)}`;
}

function xeroApiHeaders(accessToken, tenantId = '') {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`
  };
  if (tenantId) headers['xero-tenant-id'] = tenantId;
  return headers;
}

function xeroErrorMessage(body, fallback) {
  if (!body) return fallback;
  if (typeof body === 'string') return text(body, fallback, 500);
  const message = body.Message || body.message || body.error_description || body.error;
  return text(message, fallback, 500);
}

function xeroInvoiceProjection(invoice) {
  const contact = invoice && invoice.Contact && typeof invoice.Contact === 'object' ? invoice.Contact : {};
  const total = Number(invoice?.Total);
  const amountDue = Number(invoice?.AmountDue);
  return {
    invoice_id: text(invoice?.InvoiceID, '', 100),
    invoice_number: text(invoice?.InvoiceNumber, '', 255),
    status: text(invoice?.Status, '', 80),
    type: text(invoice?.Type, '', 40),
    contact_name: text(contact?.Name, '', 500),
    date: text(invoice?.DateString || invoice?.Date, '', 80),
    due_date: text(invoice?.DueDateString || invoice?.DueDate, '', 80),
    total: Number.isFinite(total) ? total : null,
    amount_due: Number.isFinite(amountDue) ? amountDue : null,
    currency: text(invoice?.CurrencyCode, '', 20),
    url: httpUrl(invoice?.Url, 2000)
  };
}

function xeroTokenExpiry(expiresIn) {
  const seconds = Math.max(60, Number(expiresIn) || 1800);
  return new Date(Date.now() + seconds * 1000).toISOString();
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

function adminTestRecord(record, payload = null) {
  const body = payload || payloadObject(record || {});
  const candidates = [
    record?.employee_upn,
    record?.employee_email,
    record?.employeeEmail,
    body?.employee_upn,
    body?.employeeEmail,
    body?.employee_email,
    body?.employeeName,
    record?.employee_name,
    record?.title,
    record?.Title,
    body?.title,
    body?.Title
  ].map((value) => text(value, '', 320).toLowerCase());
  return candidates.some((value) => /\bacc\.gmtelect(?:@|$)/i.test(value) || /^(?:amanda|amanda\s+bb)$/i.test(value));
}

function syntheticRecord(record, payload = null) {
  const body = payload || payloadObject(record || {});
  const title = text(record?.title || record?.Title || body?.title || body?.Title, '', 500);
  return adminTestRecord(record, body) || (body && body.testMode === true) || /^TEST(?:[\s_-]|$)/i.test(text(record?.employee_name, '', 240)) || /^TEST(?:[\s_-]|$)/i.test(text(body?.employeeName, '', 240)) || /\b(?:flow\s+test|flow\s+validation|historical\s+backfill|archive\s+(?:backfill|real)|test\s+(?:route|external))\b/i.test(title);
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
  const month = monthKeyInTimeZone(new Date(), timeZone);
  const week = recordWeekStart(row);
  if (week) return completionWeeks(month, timeZone, new Date()).some((entry) => entry.start === week);
  const recordMonth = recordMonthKey(row.start_date || row.record_date || row.end_date, timeZone);
  return Boolean(recordMonth && recordMonth === month);
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
  if (normalized === 'enquiry' || normalized === 'inquiry' || normalized === 'customer-enquiry' || normalized === 'customer-inquiry' || normalized === 'contact') return 'enquiries';
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
  const keys = ['employeeName', 'employeeEmail', 'employeeUpn', 'testMode', 'notificationEmail', 'weekStart', 'weekEnd', 'recordDate', 'date', 'action', 'actionLabel', 'status', 'absenceReason', 'startTime', 'finishTime', 'lunchStart', 'lunchEnd', 'dayStart', 'dayFinish', 'workedHours', 'basicHours', 'ot15Hours', 'ot20Hours', 'note', 'location', 'number', 'dateOfEstimate', 'attention', 'company', 'email', 'validity', 'preparedBy', 'vatRate', 'reference', 'opening', 'terms', 'items', 'subtotal', 'vat', 'total', 'jobReference', 'client', 'site', 'engineer', 'plannedDate', 'description', 'cardType', 'jobStatus', 'jobRevision', 'previousRecordId', 'invoiceNumber', 'xeroReference', 'xeroInvoiceId', 'xeroInvoiceStatus', 'xeroInvoiceUrl', 'xeroInvoiceTotal', 'xeroInvoiceAmountDue', 'xeroInvoiceCurrency', 'xeroLastSyncedAt', 'jobEmailUrl', 'jobEmailMessageId', 'updateReason', 'accountNotes', 'title', 'assignee', 'due', 'priority', 'owner', 'type', 'notes', 'rows', 'totals', 'weighted', 'absenceRanges', 'calendarSync', 'enquiryId', 'customerName', 'customerEmail', 'customerPhone', 'requestType', 'message', 'conversationUrl', 'conversationId', 'threadId', 'messages', 'replyTo', 'inboxStatus', 'mailbox'];
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
  const privilegedEdit = Boolean(existing && (identity.isAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)));
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
    xero_invoice_id: text(payload.xeroInvoiceId, '', 100),
    xero_invoice_status: text(payload.xeroInvoiceStatus, '', 80),
    xero_invoice_url: httpUrl(payload.xeroInvoiceUrl),
    xero_invoice_total: Number.isFinite(Number(payload.xeroInvoiceTotal)) ? Number(payload.xeroInvoiceTotal) : null,
    xero_invoice_amount_due: Number.isFinite(Number(payload.xeroInvoiceAmountDue)) ? Number(payload.xeroInvoiceAmountDue) : null,
    xero_invoice_currency: text(payload.xeroInvoiceCurrency, '', 20),
    xero_last_synced_at: text(payload.xeroLastSyncedAt, '', 80),
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

function enquiryMessages(payload) {
  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  return raw.slice(-100).map((message) => {
    const item = message && typeof message === 'object' ? message : { body: message };
    return {
      id: text(item.id || item.messageId, '', 180),
      direction: text(item.direction, 'inbound', 40).toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
      author: text(item.author || item.from || item.sender, '', 240),
      body: text(item.body || item.message || item.text, '', 3000),
      at: text(item.at || item.sentAt || item.receivedAt || item.timestamp, '', 100),
      subject: text(item.subject, '', 500)
    };
  }).filter((message) => message.body || message.subject);
}

function enquiryProjection(row, payload) {
  return {
    enquiry_id: text(payload.enquiryId || payload.enquiry_id || row.record_id, '', MAX_RECORD_ID),
    customer_name: text(payload.customerName || payload.name, '', 500),
    customer_email: text(payload.customerEmail || payload.email, '', 500),
    customer_phone: text(payload.customerPhone || payload.phone, '', 120),
    request_type: text(payload.requestType || payload.request_type, 'General enquiry', 120),
    message: text(payload.message, '', 3000),
    conversation_url: httpUrl(payload.conversationUrl || payload.emailThreadUrl || payload.jobEmailUrl),
    conversation_id: text(payload.conversationId || payload.threadId || payload.emailMessageId, '', 500),
    thread_id: text(payload.threadId || payload.conversationId, '', 500),
    inbox_status: text(payload.inboxStatus || payload.mailboxStatus, 'Awaiting inbox synchronisation', 120),
    mailbox: text(payload.mailbox, 'GMT enquiries inbox', 240),
    reply_to: text(payload.replyTo || payload.customerEmail || payload.email, '', 500),
    messages: enquiryMessages(payload)
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
    can_edit: row.kind === 'timesheets' && isCurrentPayMonthRecord(row),
    source: 'portal-d1',
    synthetic: syntheticRecord(row, payload)
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
  if (row.kind === 'enquiries') Object.assign(result, enquiryProjection(row, payload));
  return result;
}

function staffDirectory(env) {
  const raw = text(env.STAFF_DIRECTORY_JSON, '', 30000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.map((entry) => {
      if (typeof entry === 'string') return { name: text(entry, '', 240), upn: '' };
      return {
        name: text(entry?.name || entry?.displayName || entry?.employee_name, '', 240),
        upn: text(entry?.upn || entry?.email || entry?.employee_upn, '', 320).toLowerCase()
      };
    }).filter((entry) => {
      const key = entry.upn || entry.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (_) {
    return [];
  }
}

function upstreamValue(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return row[key];
  }
  return '';
}

function datePlusDays(value, days) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0), 12));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function historyTitleDetails(value) {
  let title = text(value, '', 600);
  if (!title) return { name: '', weekStart: '' };
  title = title.replace(/^\s*(?:fw|fwd|re):\s*/i, '');
  title = title.replace(/^.*?\[GMT\]\[TIMESHEET\]\[SUBMISSION\]\s*/i, '');
  const week = title.match(/\bWeek\s+(\d{4}-\d{2}-\d{2})\b/i);
  const name = title
    .split(/\s*\|\s*Week\b/i)[0]
    .split(/\s*\|\s*/)[0]
    .replace(/^\s*[:|-]\s*/, '')
    .trim();
  return { name: text(name, '', 240), weekStart: week ? week[1] : '' };
}

function directoryEntryFor(directory, name, upn) {
  const candidateUpn = text(upn, '', 320).toLowerCase();
  const candidateName = text(name, '', 240).trim().toLowerCase();
  const compactName = candidateName.replace(/[^a-z0-9]+/g, '');
  return directory.find((entry) => {
    if (candidateUpn && entry.upn && candidateUpn === entry.upn) return true;
    if (!candidateName || !entry.name) return false;
    const directoryName = entry.name.trim().toLowerCase();
    const compactDirectoryName = directoryName.replace(/[^a-z0-9]+/g, '');
    return candidateName === directoryName || compactName === compactDirectoryName || compactName.startsWith(compactDirectoryName);
  }) || null;
}

function normaliseUpstreamRecord(row, identity, env) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const title = upstreamValue(row, ['title', 'Title', 'subject', 'Subject']);
  const titleDetails = historyTitleDetails(title);
  const directory = staffDirectory(env);
  const explicitName = upstreamValue(row, ['employee_name', 'employeeName', 'EmployeeName', 'Employee Name', 'employee', 'Employee', 'gmt_employee']);
  const explicitEmail = upstreamValue(row, ['employee_upn', 'employeeUpn', 'employeeEmail', 'employee_email', 'EmployeeEmail', 'Employee Email', 'Employee_x0020_Email', 'email', 'Email', 'gmt_employee_upn']);
  const initialName = text(explicitName || titleDetails.name, '', 240);
  const initialEmail = text(explicitEmail, '', 320).toLowerCase();
  const directoryEntry = directoryEntryFor(directory, initialName, initialEmail);
  const employeeName = text(directoryEntry?.name || initialName || (identity.isAdmin ? '' : identity.name || identity.upn), '', 240);
  const employeeUpn = text(directoryEntry?.upn || initialEmail || (identity.isAdmin ? '' : identity.upn), '', 320).toLowerCase();
  if (!employeeName && !employeeUpn) return null;
  const startDate = text(upstreamValue(row, ['start_date', 'startDate', 'weekStart', 'WeekStart', 'Week Start', 'Week_x0020_Start', 'gmt_week_start']) || titleDetails.weekStart, '', 80);
  const endDate = text(upstreamValue(row, ['end_date', 'endDate', 'weekEnd', 'WeekEnd', 'Week End', 'Week_x0020_End', 'gmt_week_end']) || datePlusDays(startDate, 6), '', 80);
  const recordDate = text(upstreamValue(row, ['record_date', 'recordDate', 'date', 'Date', 'gmt_record_date']) || startDate, '', 80);
  const rawKind = text(upstreamValue(row, ['kind', 'category', 'record_type', 'recordType', 'action', 'gmt_type']) || 'timesheets', 'timesheets', 120).toLowerCase().replace(/[\s_]+/g, '-');
  const kind = rawKind === 'submission' || rawKind === 'weekly-submission' || rawKind === 'timesheet' ? 'timesheets' : canonicalKind(rawKind);
  const submittedAt = text(upstreamValue(row, ['submitted_at', 'submittedAt', 'Submitted At', 'Submitted_x0020_At', 'gmt_submitted_at']) || upstreamValue(row, ['Created', 'created', 'Modified', 'modified']), '', 100);
  const updatedAt = text(upstreamValue(row, ['updated_at', 'updatedAt', 'Modified', 'modified']) || submittedAt, '', 100);
  const action = text(upstreamValue(row, ['action', 'Action', 'category', 'record_type', 'gmt_action']) || (kind === 'timesheets' ? 'submission' : 'Timesheet'), 'Timesheet', 100);
  const status = text(upstreamValue(row, ['status', 'Status', 'Status Value', 'gmt_status']) || 'Submitted', 'Submitted', 100);
  const sourceRecordId = text(upstreamValue(row, ['source_record_id', 'sourceRecordId', 'gmt_record_id', 'Source Record ID', 'Source_x0020_Record_x0020_ID']) || (row.Id || row.ID || row.GUID ? `sharepoint-timesheet-${row.Id || row.ID || row.GUID}` : ''), '', MAX_RECORD_ID);
  const issue = text(upstreamValue(row, ['issue', 'Issue', 'gmt_issue']), '', 1000);
  const mapped = {
    kind,
    employee_name: employeeName,
    employee_upn: employeeUpn,
    start_date: startDate,
    end_date: endDate,
    record_date: recordDate,
    action,
    status,
    submitted_at: submittedAt,
    updated_at: updatedAt,
    issue,
    source_record_id: sourceRecordId,
    title,
    can_edit: false,
    source: 'microsoft-365',
    synthetic: false
  };
  // The protected history list also contains old validation/backfill rows. Once
  // the employee roster is configured, an unmatched identity cannot be a
  // current employee submission, so keep it out of the default Accounts view
  // and completion totals. This also excludes the retiring acc.gmtelect test
  // account without hard-coding it into the UI.
  mapped.synthetic = syntheticRecord(mapped, row)
    || /^TEST(?:[\s_-]|$)/i.test(employeeName)
    || /\b(?:flow\s+test|flow\s+validation|historical\s+backfill|archive\s+(?:backfill|real)|test\s+(?:route|external))\b/i.test(title)
    || (directory.length > 0 && !directoryEntry);
  return mapped;
}

function dateKeyInTimeZone(date = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = String(parts.find((part) => part.type === 'year')?.value || '');
  const month = String(parts.find((part) => part.type === 'month')?.value || '');
  const day = String(parts.find((part) => part.type === 'day')?.value || '');
  return year && month && day ? `${year}-${month}-${day}` : '';
}

function completionWeeks(monthKey, timeZone = 'Europe/London', nowDate = new Date()) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return [];
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 12));
  const monthEnd = new Date(Date.UTC(year, month, 0, 12));
  const [todayYear, todayMonth, todayDay] = dateKeyInTimeZone(nowDate, timeZone).split('-').map(Number);
  const currentKey = todayYear && todayMonth ? `${todayYear}-${String(todayMonth).padStart(2, '0')}` : '';
  const cutoff = currentKey === monthKey
    ? new Date(Date.UTC(todayYear, todayMonth - 1, todayDay, 12))
    : monthEnd;
  if (currentKey && monthKey > currentKey) return [];
  const mondayOffset = (monthStart.getUTCDay() + 6) % 7;
  const firstMonday = new Date(monthStart.getTime() - mondayOffset * 86400000);
  const result = [];
  for (let cursor = firstMonday; cursor <= monthEnd; cursor = new Date(cursor.getTime() + 7 * 86400000)) {
    const weekEnd = new Date(cursor.getTime() + 6 * 86400000);
    if (weekEnd < monthStart || weekEnd > cutoff) continue;
    result.push({
      start: cursor.toISOString().slice(0, 10),
      end: weekEnd.toISOString().slice(0, 10)
    });
  }
  return result;
}

function timesheetRecord(row) {
  const rawKind = text(row?.kind || row?.action, '', 120).toLowerCase().replace(/[_\s]+/g, '-');
  const kind = canonicalKind(row?.kind || row?.action || '');
  return (kind === 'timesheets' || rawKind === 'submission' || rawKind === 'weekly-submission') && !syntheticRecord(row);
}

function recordWeekStart(row) {
  const candidate = text(row?.start_date || row?.record_date || row?.end_date, '', 80).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const date = new Date(`${candidate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * 86400000).toISOString().slice(0, 10);
}

function recordStatusIssue(row) {
  const status = text(row?.status, 'Submitted', 120).toLowerCase();
  const issue = text(row?.issue, '', 1000);
  if (issue) return issue;
  if (/^(draft|pending|delivery failed|failed|rejected|cancelled|test - not sent|needs review)/i.test(status)) return `Status is ${text(row?.status, 'not submitted', 120)}.`;
  return '';
}

function historyRecordKey(record) {
  if (!record || typeof record !== 'object') return '';
  const source = text(record.source_record_id || record.sourceRecordId, '', MAX_RECORD_ID).toLowerCase();
  if (source) return `source:${source}`;
  const kind = canonicalKind(record.kind || record.action || 'timesheets');
  const employee = text(record.employee_upn || record.employee_email || record.employee_name, '', 320).toLowerCase();
  const week = recordWeekStart(record) || text(record.start_date || record.record_date || record.end_date, '', 80).slice(0, 10);
  return `${kind}|${employee}|${week}|${text(record.status, 'Submitted', 120).toLowerCase()}`;
}

function completionSummary(records, env, timeZone = 'Europe/London', nowDate = new Date()) {
  const month = monthKeyInTimeZone(nowDate, timeZone);
  const weeks = completionWeeks(month, timeZone, nowDate);
  const directory = staffDirectory(env);
  const identities = new Map();
  directory.forEach((entry) => {
    identities.set(entry.upn || entry.name.toLowerCase(), { ...entry, configured: true });
  });
  records.filter(timesheetRecord).forEach((record) => {
    const upn = text(record.employee_upn || record.employeeEmail || record.employee_email, '', 320).toLowerCase();
    const name = text(record.employee_name || record.employeeName, '', 240);
    const key = upn || name.toLowerCase();
    // With a configured roster, completion is an employee coverage report;
    // unmatched validation/archive identities must not create extra employees.
    if (directory.length && !directoryEntryFor(directory, name, upn)) return;
    if (!key || identities.has(key)) return;
    identities.set(key, { name, upn, configured: false });
  });
  const employees = [...identities.values()].map((employee) => {
    const employeeRecords = records.filter((record) => {
      if (!timesheetRecord(record)) return false;
      const week = recordWeekStart(record);
      if (!week || !weeks.some((entry) => entry.start === week)) return false;
      const upn = text(record.employee_upn || record.employeeEmail || record.employee_email, '', 320).toLowerCase();
      const name = text(record.employee_name || record.employeeName, '', 240).toLowerCase();
      return employee.upn ? upn === employee.upn : name === employee.name.toLowerCase();
    });
    const byWeek = new Map();
    employeeRecords.forEach((record) => {
      const week = recordWeekStart(record);
      if (week && !byWeek.has(week)) byWeek.set(week, record);
    });
    const completedWeeks = weeks.filter((week) => byWeek.has(week.start)).map((week) => week.start);
    const missingWeeks = weeks.filter((week) => !byWeek.has(week.start)).map((week) => `${week.start} to ${week.end}`);
    const missing = missingWeeks.map((week) => `Timesheet week ${week}`);
    employeeRecords.forEach((record) => {
      const issue = recordStatusIssue(record);
      if (issue && !missing.includes(issue)) missing.push(issue);
    });
    const status = !employeeRecords.length ? 'missing' : (missing.length ? 'incomplete' : 'completed');
    return {
      employee_name: employee.name || employee.upn || 'Unnamed employee',
      employee_upn: employee.upn,
      configured: employee.configured,
      status,
      completed_weeks: completedWeeks,
      missing_weeks: missingWeeks,
      missing,
      submitted_records: employeeRecords.length
    };
  }).sort((left, right) => left.employee_name.localeCompare(right.employee_name));
  return {
    pay_month: month,
    due_weeks: weeks,
    directory_configured: directory.length > 0,
    employees,
    counts: {
      completed: employees.filter((employee) => employee.status === 'completed').length,
      incomplete: employees.filter((employee) => employee.status === 'incomplete').length,
      missing: employees.filter((employee) => employee.status === 'missing').length
    }
  };
}

async function verifiedUpstreamToken(request, env, identity) {
  const flowAudience = audienceValue('https://service.flow.microsoft.com/');
  const supplied = bearerToken(request, 'X-GMT-Upstream-Authorization');
  const primary = identity.aud === flowAudience ? bearerToken(request) : '';
  const token = supplied || primary;
  if (!token) return { token: '', status: 'flow-permission-not-configured' };
  try {
    const upstreamIdentity = await authenticateToken(token, env);
    if (upstreamIdentity.aud !== flowAudience) throw new Error('Flow token audience is not permitted');
    if (upstreamIdentity.tid !== identity.tid || upstreamIdentity.oid !== identity.oid || upstreamIdentity.upn !== identity.upn) throw new Error('Flow token identity does not match the signed-in account');
    return { token, status: 'ready' };
  } catch (_) {
    return { token: '', status: 'upstream-token-invalid' };
  }
}

async function fetchUpstreamHistory(upstreamUrl, token, kind, identity) {
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  const requestInit = { headers, cf: { cacheTtl: 0, cacheEverything: false }, signal: AbortSignal.timeout(15000) };
  let response = await fetch(upstreamUrl, requestInit);
  // Power Automate's HTTP trigger rejects the probe GET with 400 in some
  // tenants (and 405 in others).  Both responses mean that the trigger is
  // reachable and expects its documented POST payload.
  if (response.status === 400 || response.status === 405) {
    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: kind || 'all',
        scope: identity.isAdmin ? 'all' : 'own',
        employeeEmail: identity.upn
      }),
      signal: AbortSignal.timeout(15000),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
  }
  return response;
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

function requireXeroAdmin(identity) {
  if (!identity?.isAdmin) throw Object.assign(new Error('Xero access is restricted to the Accounts administrator'), { status: 403 });
}

function xeroRedirectResponse(returnUrl, result, reason = '', tenantName = '') {
  const target = new URL(returnUrl || XERO_DEFAULT_RETURN_URL);
  target.searchParams.set('xero', result);
  if (reason) target.searchParams.set('xero_reason', reason);
  if (tenantName) target.searchParams.set('xero_tenant', tenantName);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.href,
      'Set-Cookie': xeroStateCookie('', 0),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

async function startXeroConnection(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const settings = xeroSettings(env);
  if (!settings.configured) return json({ error: 'Xero is not configured on the portal service' }, 503, origin || '');
  const state = randomBase64Url(32);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM xero_oauth_states WHERE expires_at <= ? OR consumed_at IS NOT NULL').bind(createdAt).run();
  await env.DB.prepare(`INSERT INTO xero_oauth_states (state_hash, owner_oid, owner_upn, return_url, created_at, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)`).bind(await sha256Base64Url(state), identity.oid, identity.upn, settings.returnUrl, createdAt, expiresAt).run();
  const authorization = new URL(settings.authUrl);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('client_id', settings.clientId);
  authorization.searchParams.set('redirect_uri', settings.redirectUri);
  authorization.searchParams.set('scope', settings.scopes);
  authorization.searchParams.set('state', state);
  return json({ ok: true, authorization_url: authorization.href, expires_at: expiresAt }, 200, origin || '', { 'Set-Cookie': xeroStateCookie(state) });
}

async function completeXeroConnection(request, env) {
  const settings = xeroSettings(env);
  const url = new URL(request.url);
  const state = text(url.searchParams.get('state'), '', 500);
  const cookieState = xeroCookieState(request);
  const configuredReturn = settings.returnUrl;
  if (!settings.configured) return xeroRedirectResponse(configuredReturn, 'error', 'not-configured');
  if (url.searchParams.get('error')) return xeroRedirectResponse(configuredReturn, 'error', 'authorisation-denied');
  if (!state || !cookieState || !constantTimeEqual(state, cookieState)) return xeroRedirectResponse(configuredReturn, 'error', 'invalid-state');
  const stateHash = await sha256Base64Url(state);
  const stateRow = await env.DB.prepare(`SELECT state_hash, owner_oid, owner_upn, return_url
    FROM xero_oauth_states WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`).bind(stateHash, now()).first();
  if (!stateRow) return xeroRedirectResponse(configuredReturn, 'error', 'expired-state');
  await env.DB.prepare('UPDATE xero_oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL').bind(now(), stateHash).run();
  const code = text(url.searchParams.get('code'), '', 4000);
  if (!code) return xeroRedirectResponse(stateRow.return_url || configuredReturn, 'error', 'missing-code');

  const tokenResponse = await fetch(settings.tokenUrl, {
    method: 'POST',
    headers: { Authorization: xeroBasicAuth(settings), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: settings.redirectUri })
  });
  const tokenText = await tokenResponse.text();
  let tokenBody = null;
  try { tokenBody = tokenText ? JSON.parse(tokenText) : null; } catch (_) {}
  if (!tokenResponse.ok || !tokenBody?.access_token || !tokenBody?.refresh_token) return xeroRedirectResponse(stateRow.return_url || configuredReturn, 'error', 'token-exchange');

  const connectionsResponse = await fetch(`${settings.apiUrl}/connections`, { headers: xeroApiHeaders(tokenBody.access_token) });
  const connectionsText = await connectionsResponse.text();
  let connections = null;
  try { connections = connectionsText ? JSON.parse(connectionsText) : null; } catch (_) {}
  if (!connectionsResponse.ok || !Array.isArray(connections) || !connections.length) return xeroRedirectResponse(stateRow.return_url || configuredReturn, 'error', 'no-tenant');

  const timestamp = now();
  let storedConnections = 0;
  for (const connection of connections.slice(0, 25)) {
    const tenantId = text(connection?.tenantId, '', 160);
    const connectionId = text(connection?.id || connection?.connectionId, '', 160);
    if (!tenantId || !connectionId) continue;
    const encrypted = await encryptXeroSecret(tokenBody.refresh_token, settings);
    await env.DB.prepare(`INSERT INTO xero_connections
      (tenant_id, connection_id, tenant_name, tenant_type, scopes, refresh_token_ciphertext, refresh_token_iv,
       connected_by_oid, connected_by_upn, connected_at, updated_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(tenant_id) DO UPDATE SET connection_id = excluded.connection_id,
       tenant_name = excluded.tenant_name, tenant_type = excluded.tenant_type, scopes = excluded.scopes,
       refresh_token_ciphertext = excluded.refresh_token_ciphertext, refresh_token_iv = excluded.refresh_token_iv,
       connected_by_oid = excluded.connected_by_oid, connected_by_upn = excluded.connected_by_upn,
       connected_at = excluded.connected_at, updated_at = excluded.updated_at, last_error = NULL`).bind(
      tenantId,
      connectionId,
      text(connection?.tenantName, 'Xero organisation', 500),
      text(connection?.tenantType, 'ORGANISATION', 80),
      text(tokenBody.scope || settings.scopes, settings.scopes, 1000),
      encrypted.ciphertext,
      encrypted.iv,
      stateRow.owner_oid,
      stateRow.owner_upn,
      timestamp,
      timestamp
    ).run();
    storedConnections += 1;
  }
  if (!storedConnections) return xeroRedirectResponse(stateRow.return_url || configuredReturn, 'error', 'no-tenant');
  const first = connections.find((connection) => text(connection?.tenantId, '', 160));
  return xeroRedirectResponse(stateRow.return_url || configuredReturn, 'connected', '', text(first?.tenantName, '', 500));
}

async function xeroConnectionRows(env) {
  const result = await env.DB.prepare(`SELECT tenant_id, connection_id, tenant_name, tenant_type, scopes,
    connected_by_upn, connected_at, updated_at, last_error FROM xero_connections ORDER BY tenant_name`).all();
  return result.results || [];
}

async function xeroStatus(env, identity, origin) {
  requireXeroAdmin(identity);
  const settings = xeroSettings(env);
  const connections = await xeroConnectionRows(env);
  return json({
    configured: settings.configured,
    scopes: settings.scopes.split(/\s+/).filter(Boolean),
    redirect_uri: settings.redirectUri || '',
    connections: connections.map((connection) => ({
      tenant_id: connection.tenant_id,
      connection_id: connection.connection_id,
      tenant_name: connection.tenant_name,
      tenant_type: connection.tenant_type,
      scopes: String(connection.scopes || '').split(/\s+/).filter(Boolean),
      connected_by_upn: connection.connected_by_upn,
      connected_at: connection.connected_at,
      updated_at: connection.updated_at,
      last_error: connection.last_error || ''
    }))
  }, 200, origin || '');
}

async function refreshXeroAccessToken(env, connection) {
  const settings = xeroSettings(env);
  if (!settings.configured) throw Object.assign(new Error('Xero is not configured on the portal service'), { status: 503 });
  const refreshToken = await decryptXeroSecret(connection.refresh_token_ciphertext, connection.refresh_token_iv, settings);
  const response = await fetch(settings.tokenUrl, {
    method: 'POST',
    headers: { Authorization: xeroBasicAuth(settings), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  });
  const responseText = await response.text();
  let body = null;
  try { body = responseText ? JSON.parse(responseText) : null; } catch (_) {}
  if (!response.ok || !body?.access_token) {
    const message = xeroErrorMessage(body, `Xero token refresh failed (${response.status})`);
    await env.DB.prepare('UPDATE xero_connections SET last_error = ?, updated_at = ? WHERE tenant_id = ?').bind(message, now(), connection.tenant_id).run();
    throw Object.assign(new Error(message), { status: 502 });
  }
  const nextRefreshToken = text(body.refresh_token, refreshToken, 5000);
  const encrypted = await encryptXeroSecret(nextRefreshToken, settings);
  await env.DB.prepare(`UPDATE xero_connections SET refresh_token_ciphertext = ?, refresh_token_iv = ?, scopes = ?,
    updated_at = ?, last_error = NULL WHERE tenant_id = ?`).bind(
    encrypted.ciphertext,
    encrypted.iv,
    text(body.scope || connection.scopes, connection.scopes || settings.scopes, 1000),
    now(),
    connection.tenant_id
  ).run();
  return { accessToken: body.access_token, expiresAt: xeroTokenExpiry(body.expires_in) };
}

async function selectXeroConnection(env, tenantId = '') {
  const requested = text(tenantId, '', 160);
  const result = requested
    ? await env.DB.prepare('SELECT * FROM xero_connections WHERE tenant_id = ?').bind(requested).first()
    : await env.DB.prepare('SELECT * FROM xero_connections ORDER BY updated_at DESC LIMIT 2').all();
  if (requested) {
    if (!result) throw Object.assign(new Error('The requested Xero organisation is not connected'), { status: 404 });
    return result;
  }
  const rows = result.results || [];
  if (!rows.length) throw Object.assign(new Error('No Xero organisation is connected'), { status: 404 });
  if (rows.length > 1) throw Object.assign(new Error('Choose a Xero organisation before looking up an invoice'), { status: 409 });
  return rows[0];
}

async function lookupXeroInvoice(env, tenantId, invoiceNumber) {
  const settings = xeroSettings(env);
  const connection = await selectXeroConnection(env, tenantId);
  const token = await refreshXeroAccessToken(env, connection);
  const escaped = String(invoiceNumber || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const where = `InvoiceNumber="${escaped}"`;
  const endpoint = `${settings.apiUrl}/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;
  const response = await fetch(endpoint, { headers: xeroApiHeaders(token.accessToken, connection.tenant_id) });
  const responseText = await response.text();
  let body = null;
  try { body = responseText ? JSON.parse(responseText) : null; } catch (_) {}
  if (!response.ok) throw Object.assign(new Error(xeroErrorMessage(body, `Xero invoice lookup failed (${response.status})`)), { status: 502 });
  const invoices = Array.isArray(body?.Invoices) ? body.Invoices : [];
  return {
    tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
    invoice: invoices[0] ? xeroInvoiceProjection(invoices[0]) : null,
    invoices: invoices.slice(0, 20).map(xeroInvoiceProjection),
    refreshed_at: now()
  };
}

async function lookupXeroInvoiceEndpoint(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const invoiceNumber = text(body.invoiceNumber || body.invoice_number, '', 255);
  if (!invoiceNumber) return json({ error: 'Invoice number is required' }, 400, origin || '');
  return json(await lookupXeroInvoice(env, body.tenantId || body.tenant_id, invoiceNumber), 200, origin || '');
}

async function syncXeroJobCard(request, env, identity, origin, recordId) {
  requireXeroAdmin(identity);
  const existing = await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
  if (!existing) return json({ error: 'Record not found' }, 404, origin || '');
  if (existing.kind !== 'job-cards') return json({ error: 'Only job cards can be linked to Xero invoices' }, 400, origin || '');
  if (existing.status === 'Deleted') return json({ error: 'Record has been deleted' }, 410, origin || '');
  const body = await readJson(request);
  const payload = payloadObject(existing);
  const invoiceNumber = text(body.invoiceNumber || body.invoice_number || payload.invoiceNumber, '', 255);
  if (!invoiceNumber) return json({ error: 'Invoice number is required before linking a job card to Xero' }, 400, origin || '');
  const result = await lookupXeroInvoice(env, body.tenantId || body.tenant_id, invoiceNumber);
  if (!result.invoice) return json({ error: `No Xero invoice matched ${invoiceNumber}`, tenant: result.tenant }, 404, origin || '');
  const invoice = result.invoice;
  const mergedPayload = {
    ...payload,
    invoiceNumber,
    xeroReference: invoice.invoice_number || invoice.invoice_id || payload.xeroReference || '',
    xeroInvoiceId: invoice.invoice_id,
    xeroInvoiceStatus: invoice.status,
    xeroInvoiceUrl: invoice.url,
    xeroInvoiceTotal: invoice.total,
    xeroInvoiceAmountDue: invoice.amount_due,
    xeroInvoiceCurrency: invoice.currency,
    xeroLastSyncedAt: result.refreshed_at
  };
  const input = normaliseInput({
    recordId,
    kind: 'job-cards',
    action: existing.action,
    status: existing.status,
    employeeName: existing.employee_name,
    employeeEmail: existing.owner_upn,
    recordDate: existing.record_date,
    submittedAt: existing.submitted_at,
    payload: mergedPayload
  }, { ...identity, name: existing.employee_name }, existing);
  await saveRecord(env, input, identity, existing);
  const updated = await env.DB.prepare(`SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
      q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at,
      q.last_error AS dispatch_last_error FROM records r LEFT JOIN dispatch_queue q ON q.record_id = r.record_id
      WHERE r.record_id = ?`).bind(recordId).first();
  return json({ ok: true, record: projectRow(updated), invoice }, 200, origin || '');
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
  const operationsAdminAcrossKinds = !kind && identity.isOperationsAdmin && !identity.isAdmin;
  const jobCardAdminAcrossKinds = !kind && identity.isJobCardAdmin && !identity.isAdmin;
  const sql = identity.isAdmin
    ? (kind ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`)
    : operationsAdminAcrossKinds
      ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind NOT IN ('timesheets', 'clock') OR r.owner_oid = ?) ORDER BY r.updated_at DESC LIMIT ?`
    : viewAll
      ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`
      : jobCardAdminAcrossKinds
        ? `${projection} WHERE r.status <> 'Deleted' AND (r.owner_oid = ? OR r.kind = 'job-cards') ORDER BY r.updated_at DESC LIMIT ?`
        : (kind ? `${projection} WHERE r.owner_oid = ? AND r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE r.owner_oid = ? AND r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`);
  const bindings = identity.isAdmin
    ? (kind ? [kind, limit] : [limit])
    : operationsAdminAcrossKinds
      ? [identity.oid, limit]
    : viewAll
      ? [kind || 'job-cards', limit]
      : jobCardAdminAcrossKinds
        ? [identity.oid, limit]
        : (kind ? [identity.oid, kind, limit] : [identity.oid, limit]);
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  const includeSynthetic = identity.isAdmin && url.searchParams.get('includeSynthetic') === '1';
  const projectedLocalRecords = (result.results || []).map((row) => projectRow(row));
  const syntheticRecordCount = projectedLocalRecords.filter((row) => row.synthetic).length;
  let records = includeSynthetic ? projectedLocalRecords : projectedLocalRecords.filter((row) => !row.synthetic);
  const localRecordCount = records.length;
  let upstream = 'not-configured';
  let upstreamRecordCount = 0;
  let upstreamSourceRowCount = 0;
  let upstreamNormalisedRecordCount = 0;
  let upstreamEmployeeMatchedRecordCount = 0;
  const upstreamUrl = text(env.HISTORY_UPSTREAM_URL, '', 2000);
  const upstreamEnabledForKind = !kind || kind === 'timesheets' || kind === 'clock';
  if (upstreamUrl && upstreamEnabledForKind) {
    const upstreamAuth = await verifiedUpstreamToken(request, env, identity);
    if (!upstreamAuth.token) {
      upstream = upstreamAuth.status;
    } else {
      try {
        const upstreamResponse = await fetchUpstreamHistory(upstreamUrl, upstreamAuth.token, kind, identity);
        if (upstreamResponse.ok) {
          const body = await upstreamResponse.json();
          const sourceRows = Array.isArray(body)
            ? body
            : body && Array.isArray(body.records)
              ? body.records
            : body && Array.isArray(body.value)
              ? body.value
              : body && Array.isArray(body.data)
                ? body.data
                : null;
          if (sourceRows) {
            upstreamSourceRowCount = sourceRows.length;
            const normalisedRows = sourceRows.map((row) => normaliseUpstreamRecord(row, identity, env));
            upstreamNormalisedRecordCount = normalisedRows.filter(Boolean).length;
            const employeeMatchedRows = normalisedRows.filter((row) => row && (identity.isAdmin || row.employee_upn === identity.upn || (identity.name && row.employee_name.toLowerCase() === identity.name.toLowerCase())));
            upstreamEmployeeMatchedRecordCount = employeeMatchedRows.length;
            const upstreamRecords = employeeMatchedRows.filter((row) => !kind || canonicalKind(row.kind || row.action) === kind || (kind === 'timesheets' && canonicalKind(row.action) === 'submission'));
            const localIds = new Set(records.map((row) => row.source_record_id));
            const visibleUpstreamRecords = includeSynthetic ? upstreamRecords : upstreamRecords.filter((row) => !row.synthetic);
            upstreamRecordCount = visibleUpstreamRecords.length;
            const seenHistoryKeys = new Set(records.map(historyRecordKey).filter(Boolean));
            const uniqueUpstreamRecords = visibleUpstreamRecords.filter((row) => {
              if (row.source_record_id && localIds.has(row.source_record_id)) return false;
              const key = historyRecordKey(row);
              if (!key || seenHistoryKeys.has(key)) return false;
              seenHistoryKeys.add(key);
              return true;
            });
            records = [...records, ...uniqueUpstreamRecords];
            upstream = 'ok';
          } else upstream = 'invalid-response';
        } else upstream = `http-${upstreamResponse.status}`;
      } catch (_) {
        upstream = 'unavailable';
      }
    }
  } else if (upstreamUrl && !upstreamEnabledForKind) {
    upstream = 'not-requested-for-category';
  }
  const completion = identity.isAdmin && (!kind || kind === 'timesheets')
    ? completionSummary(records, env)
    : null;
  records.sort((a, b) => String(b.updated_at || b.submitted_at).localeCompare(String(a.updated_at || a.submitted_at)));
  return {
    records,
    meta: {
      upstream,
      local_record_count: localRecordCount,
      upstream_record_count: upstreamRecordCount,
      upstream_source_row_count: upstreamSourceRowCount,
      upstream_normalized_record_count: upstreamNormalisedRecordCount,
      upstream_employee_matched_record_count: upstreamEmployeeMatchedRecordCount,
      synthetic_record_count: syntheticRecordCount,
      synthetic_included: includeSynthetic,
      role: identity.isAdmin ? 'accounts-admin' : (identity.isOperationsAdmin ? 'operations-admin' : (identity.isJobCardAdmin ? 'job-card-admin' : 'employee')),
      is_admin: identity.isAdmin,
      is_operations_admin: identity.isOperationsAdmin,
      is_job_card_admin: identity.isJobCardAdmin,
      visible_scope: identity.isAdmin ? 'all employee submissions' : (identity.isOperationsAdmin ? 'all non-timesheet submissions; this account timesheets and clock records' : (identity.isJobCardAdmin ? 'all job cards; this account submissions for other categories' : 'this account submissions')),
      completion
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
  if (url.pathname === '/api/xero/callback' && request.method === 'GET') {
    if (!env.DB) return xeroRedirectResponse(xeroSettings(env).returnUrl, 'error', 'storage-not-configured');
    return completeXeroConnection(request, env);
  }
  const identity = await authenticate(request, env);
  if (!env.DB) throw Object.assign(new Error('Protected storage is not configured'), { status: 503 });

  if (url.pathname === '/api/xero/connect' && request.method === 'POST') return startXeroConnection(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/status' && request.method === 'GET') return xeroStatus(env, identity, origin || '');
  if (url.pathname === '/api/xero/invoices/lookup' && request.method === 'POST') return lookupXeroInvoiceEndpoint(request, env, identity, origin || '');
  const xeroJobSyncMatch = url.pathname.match(/^\/api\/xero\/job-cards\/([^/]+)\/sync$/);
  if (xeroJobSyncMatch && request.method === 'POST') return syncXeroJobCard(request, env, identity, origin || '', decodeURIComponent(xeroJobSyncMatch[1]));

  if (url.pathname === '/api/profile' && request.method === 'GET') {
    return json({ profile: await getProfileSettings(env, identity) }, 200, origin || '');
  }
  if (url.pathname === '/api/profile' && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    return json({ ok: true, profile: await saveProfileSettings(env, identity, body) }, 200, origin || '');
  }

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
    const input = normaliseInput(body, existing && (identity.isAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing);
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
      const input = normaliseInput({ ...body, recordId }, (identity.isAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing);
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
  completionWeeks,
  completionSummary,
  staffDirectory,
  historyTitleDetails,
  normaliseUpstreamRecord,
  listRecords,
  projectRow,
  canViewAllRecords,
  canAccessRecord,
  tokenIdentity,
  profileView,
  getProfileSettings,
  saveProfileSettings,
  xeroSettings,
  xeroInvoiceProjection,
  encryptXeroSecret,
  decryptXeroSecret
};
