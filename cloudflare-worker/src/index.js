import { deduplicateProviderRecords, removeStaleAbsenceRows } from './provider-reconciliation.js';
import { canonicalEstimateInput, createEstimateIndexStore, correlateEstimateRecords } from './estimate-index.js';

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
  const sharedKinds = new Set(['estimates', 'job-cards', 'conversations', 'email-conversations']);
  return Boolean(identity && (sharedKinds.has(canonicalKind(kind)) || identity.isAdmin || (identity.isOperationsAdmin && kind !== 'timesheets' && kind !== 'clock') || (kind === 'job-cards' && identity.isJobCardAdmin)));
}

function canAccessRecord(identity, row) {
  return Boolean(row && (row.owner_oid === identity.oid || identity.isAdmin || (row.kind === 'timesheets' && row.action === 'pay_month_correction' && row.owner_upn?.toLowerCase() === identity.upn?.toLowerCase()) || (identity.isOperationsAdmin && row.kind !== 'timesheets' && row.kind !== 'clock') || (row.kind === 'job-cards' && identity.isJobCardAdmin)));
}

function canViewRecord(identity, row) {
  return Boolean(identity && row && (canAccessRecord(identity, row) || canViewAllRecords(identity, row.kind)));
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
const XERO_DEFAULT_SCOPES = 'openid profile email offline_access accounting.invoices accounting.contacts accounting.settings';

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
  const status = text(invoice?.Status, '', 80).toUpperCase();
  const sent = invoice?.SentToContact === true;
  const paid = status === 'PAID' || (Number.isFinite(amountDue) && amountDue <= 0 && Number(invoice?.AmountPaid) > 0);
  const deleted = status === 'DELETED';
  const displayStatus = deleted ? 'Deleted' : (status === 'DRAFT' ? 'Draft' : (status === 'VOIDED' ? 'Voided' : (paid ? 'Paid' : (sent ? 'Sent' : 'Unpaid'))));
  return {
    invoice_id: text(invoice?.InvoiceID, '', 100),
    invoice_number: text(invoice?.InvoiceNumber, '', 255),
    status,
    display_status: displayStatus,
    delivery_status: deleted ? 'Deleted' : (sent ? 'Sent' : 'Unsent'),
    payment_status: deleted || status === 'VOIDED' ? 'Not applicable' : (paid ? 'Paid' : (Number(invoice?.AmountPaid) > 0 ? 'Part-paid' : 'Unpaid')),
    sent_to_contact: sent,
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

function xeroInvoiceDeliveryStatus(invoice) {
  return String(invoice?.Status || '').toUpperCase() === 'DELETED' ? 'Deleted' : (invoice?.SentToContact === true ? 'Sent' : 'Unsent');
}

function xeroInvoicePaymentStatus(invoice) {
  const status = String(invoice?.Status || '').toUpperCase();
  if (status === 'DELETED' || status === 'VOIDED') return 'Not applicable';
  if (status === 'PAID' || (Number(invoice?.AmountDue) <= 0 && Number(invoice?.AmountPaid) > 0)) return 'Paid';
  if (Number(invoice?.AmountPaid) > 0) return 'Part-paid';
  return 'Unpaid';
}

function xeroInvoiceMutationPolicy(invoice) {
  const status = String(invoice?.Status || '').toUpperCase();
  const amountPaid = Number(invoice?.AmountPaid) || 0;
  const eligible = amountPaid <= 0 && ['DRAFT', 'AUTHORISED'].includes(status);
  return {
    canEdit: status === 'DRAFT' && amountPaid <= 0,
    canSend: ['DRAFT', 'AUTHORISED'].includes(status) && invoice?.SentToContact !== true && amountPaid <= 0,
    canDelete: eligible,
    deleteAction: status === 'AUTHORISED' ? 'void' : 'delete'
  };
}

function xeroInvoicePayload(input, invoiceId = '') {
  const body = input && typeof input === 'object' ? input : {};
  const contactId = text(body.contactId || body.contact_id, '', 100);
  const date = text(body.date, '', 10);
  const dueDate = text(body.dueDate || body.due_date, '', 10);
  const invoiceNumber = text(body.invoiceNumber || body.invoice_number, '', 255);
  const reference = text(body.reference, '', 255);
  const lineAmountTypes = ['Exclusive', 'Inclusive', 'NoTax'].includes(body.lineAmountTypes) ? body.lineAmountTypes : 'Exclusive';
  const supplied = Array.isArray(body.lineItems) ? body.lineItems : (Array.isArray(body.line_items) ? body.line_items : []);
  if (!contactId) throw Object.assign(new Error('Choose a Xero customer before saving the invoice'), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) throw Object.assign(new Error('Invoice and due dates must use YYYY-MM-DD'), { status: 400 });
  if (!supplied.length || supplied.length > 100) throw Object.assign(new Error('An invoice must have between 1 and 100 line items'), { status: 400 });
  const LineItems = supplied.map((item) => {
    const quantity = Number(item?.quantity);
    const unitAmount = Number(item?.unitAmount ?? item?.unit_amount);
    const description = text(item?.description, '', 4000);
    const accountCode = text(item?.accountCode || item?.account_code, '', 40);
    const taxType = text(item?.taxType || item?.tax_type, '', 80);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitAmount) || unitAmount < 0 || !accountCode || !taxType) {
      throw Object.assign(new Error('Each invoice line needs a description, positive quantity, valid unit price, account code, and tax type'), { status: 400 });
    }
    return { Description: description, Quantity: quantity, UnitAmount: unitAmount, AccountCode: accountCode, TaxType: taxType };
  });
  const invoice = { Type: 'ACCREC', Contact: { ContactID: contactId }, Date: date, LineAmountTypes: lineAmountTypes, LineItems };
  if (dueDate) invoice.DueDate = dueDate;
  if (invoiceNumber) invoice.InvoiceNumber = invoiceNumber;
  if (reference) invoice.Reference = reference;
  if (invoiceId) invoice.InvoiceID = text(invoiceId, '', 100);
  else invoice.Status = 'DRAFT';
  return invoice;
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
function payCycleKeyForDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(date)) return '';
  const validated = new Date(date);
  if (validated.getUTCFullYear() !== Number(match[1]) || validated.getUTCMonth() + 1 !== Number(match[2]) || validated.getUTCDate() !== Number(match[3])) return '';
  const anchor = Date.UTC(2026, 7, 24);
  const cycle = Math.floor((date - anchor) / (28 * 86400000));
  const payday = new Date(anchor + (cycle * 28 + 25) * 86400000);
  return `${payday.getUTCFullYear()}-${String(payday.getUTCMonth() + 1).padStart(2, '0')}`;
}

function editablePayCycleKeys(nowDate = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(nowDate);
  const value = (kind) => String(parts.find((part) => part.type === kind)?.value || '');
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  const current = payCycleKeyForDate(today);
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 28);
  return [current, payCycleKeyForDate(previous.toISOString().slice(0, 10))].filter(Boolean);
}

function isCurrentPayMonthRecord(row, timeZone = 'Europe/London', nowDate = new Date()) {
  if (!row) return false;
  const payload = payloadObject(row);
  const declared = text(payload.payMonth || payload.pay_month, '', 7);
  const dates = Array.isArray(payload.rows) ? payload.rows.map((entry) => text(entry?.date, '', 10)).filter(Boolean) : [];
  const dateMonth = payCycleKeyForDate(dates[0] || row.record_date || row.start_date || row.end_date);
  const month = row.action === 'pay_month_correction' && /^\d{4}-\d{2}$/.test(declared) ? declared : (dateMonth || declared);
  return editablePayCycleKeys(nowDate, timeZone).includes(month);
}

function validatePayMonthCorrection(body, nowDate = new Date()) {
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
  const month = text(payload.payMonth, '', 7);
  if (!/^\d{4}-\d{2}$/.test(month) || !editablePayCycleKeys(nowDate).includes(month)) {
    throw Object.assign(new Error('Only the current and previous pay months are editable'), { status: 409 });
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const deletedDays = Array.isArray(payload.deletedDays) ? payload.deletedDays : [];
  if (rows.length > 80 || deletedDays.length > 80) throw Object.assign(new Error('Too many pay-month dates'), { status: 400 });
  const seen = new Set();
  [...rows.map((row) => row?.date), ...deletedDays].forEach((date) => {
    const key = text(date, '', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || payCycleKeyForDate(key) !== month) {
      throw Object.assign(new Error('Every corrected date must belong to the selected pay month'), { status: 400 });
    }
    if (seen.has(key)) throw Object.assign(new Error('Each corrected date must be unique'), { status: 400 });
    seen.add(key);
  });
  validateNoFutureWork('timesheets', 'pay_month_correction', payload, nowDate);
  return month;
}

function validateNoFutureWork(kind, action, payload, nowDate = new Date()) {
  if (kind !== 'timesheets' && kind !== 'clock') return;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(nowDate);
  const value = (type) => String(parts.find((part) => part.type === type)?.value || '');
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  if (kind === 'clock' && action === 'absent') return;
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.dailyRows) ? payload.dailyRows : [];
  for (const row of rows) {
    const date = String(row?.date || '').slice(0, 10);
    const absence = String(row?.absenceStatus || row?.absenceReason || row?.absence || 'NA').trim().toLowerCase();
    if (date > today && !['sick', 'holiday', 'absent'].includes(absence)) {
      throw Object.assign(new Error('Future dates can only be marked absent, sick or holiday; worked time cannot be entered early.'), { status: 400 });
    }
  }
  const eventDate = String(payload.date || '').slice(0, 10);
  if (kind === 'clock' && eventDate > today && action !== 'absent') {
    throw Object.assign(new Error('Future clock and worked-time entries are not permitted.'), { status: 400 });
  }
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
  const keys = ['employeeName', 'employeeEmail', 'employeeUpn', 'testMode', 'notificationEmail', 'weekStart', 'weekEnd', 'recordDate', 'date', 'action', 'actionLabel', 'status', 'absenceReason', 'startTime', 'finishTime', 'lunchStart', 'lunchEnd', 'dayStart', 'dayFinish', 'workedHours', 'basicHours', 'ot15Hours', 'ot20Hours', 'note', 'location', 'number', 'dateOfEstimate', 'attention', 'company', 'email', 'validity', 'preparedBy', 'vatRate', 'reference', 'opening', 'terms', 'items', 'subtotal', 'vat', 'total', 'jobReference', 'client', 'site', 'engineer', 'plannedDate', 'description', 'cardType', 'jobStatus', 'jobRevision', 'previousRecordId', 'invoiceNumber', 'xeroReference', 'xeroInvoiceId', 'xeroInvoiceStatus', 'xeroInvoiceUrl', 'xeroInvoiceTotal', 'xeroInvoiceAmountDue', 'xeroInvoiceCurrency', 'xeroLastSyncedAt', 'jobEmailUrl', 'jobEmailMessageId', 'updateReason', 'accountNotes', 'title', 'assignee', 'due', 'priority', 'owner', 'type', 'notes', 'rows', 'dailyRows', 'daily_rows', 'gmtDailyRows', 'totals', 'weighted', 'absenceRanges', 'calendarSync', 'calendarSyncPayload', 'gmtCalendarSyncPayload', 'enquiryId', 'customerName', 'customerEmail', 'customerPhone', 'requestType', 'message', 'conversationUrl', 'conversationId', 'threadId', 'messages', 'replyTo', 'inboxStatus', 'mailbox', 'payMonth', 'deletedDays', 'editNote', 'editedBy', 'editedAt'];
  for (const key of keys) {
    if (payload[key] !== undefined) safe[key] = safePayloadValue(payload[key]);
  }
  return safe;
}

function normaliseInput(body, identity, existing = null, env = null) {
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
  const action = text(body.action || body.gmtAction || payload.action || (kind === 'clock' ? 'clock_event' : 'submission'), 'submission', 100);
  validateNoFutureWork(kind, action, payload);
  const correctionOnBehalf = kind === 'timesheets' && action === 'pay_month_correction' && body.editMode === true && identity.isAdmin && !existing;
  const requestedUpn = text(body.employeeEmail || body.employee_upn, '', 320).toLowerCase();
  const rosterTarget = correctionOnBehalf ? directoryEntryFor(staffDirectory(env || {}), requestedEmployeeName, requestedUpn) : null;
  // Accounts can also correct a real historical sheet whose employee is not
  // on today's scheduled roster (for example the Accounts or Lidia aliases).
  // Keep those targets inside the GMT tenant and require a named employee.
  const historicalTarget = correctionOnBehalf && !rosterTarget && requestedEmployeeName && /@(gmt-services\.co\.uk|gmtelectservsltd\.onmicrosoft\.com)$/i.test(requestedUpn)
    ? { name: requestedEmployeeName, upn: requestedUpn } : null;
  const target = rosterTarget || historicalTarget;
  if (correctionOnBehalf && (!target || !target.upn)) throw Object.assign(new Error('Employee must have a verified GMT address or match the approved staff roster'), { status: 400 });
  const employeeName = existing?.action === 'pay_month_correction' && existing?.employee_name
    ? existing.employee_name
    : syntheticTestName
    ? requestedEmployeeName
    : (target?.name || identity.name || requestedEmployeeName || identity.upn);
  const status = text(body.status || payload.status || (kind === 'calendar' || kind === 'tasks' ? 'Pending approval' : 'Submitted'), 'Submitted', 100);
  const startDate = isoOrBlank(body.startDate || body.start_date || payload.weekStart || body.weekStart);
  const endDate = isoOrBlank(body.endDate || body.end_date || payload.weekEnd || body.weekEnd);
  const recordDate = isoOrBlank(body.recordDate || body.record_date || payload.recordDate || payload.date || body.date);
  const privilegedEdit = Boolean(existing && (identity.isAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)));
  return {
    recordId,
    ownerOid: privilegedEdit || existing?.action === 'pay_month_correction' ? existing.owner_oid : identity.oid,
    ownerUpn: privilegedEdit || existing?.action === 'pay_month_correction' ? existing.owner_upn : (target?.upn || identity.upn),
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

function estimateIndexStore(env) {
  if (!env.DB) throw Object.assign(new Error('Protected storage is not configured'), { status: 503 });
  return createEstimateIndexStore(env.DB);
}

async function upsertEstimateIndex(env, identity, input) {
  requireXeroAdmin(identity);
  return estimateIndexStore(env).upsert(input);
}

async function listEstimateIndex(env, identity, query = {}) {
  if (!identity) throw Object.assign(new Error('Authentication required'), { status: 401 });
  return estimateIndexStore(env).list(query.limit || 500);
}

async function estimateIndexUpsertEndpoint(request, env, identity, origin) {
  const body = await readJson(request);
  const row = await upsertEstimateIndex(env, identity, body);
  return json({ ok: true, estimate: row }, 200, origin || '');
}

async function estimateIndexListEndpoint(request, env, identity, origin) {
  const url = new URL(request.url);
  const estimates = await listEstimateIndex(env, identity, { limit: url.searchParams.get('limit') || 500 });
  return json({ estimates }, 200, origin || '');
}

async function estimateArchiveIngestEndpoint(request, env, origin) {
  const configuredKey = text(env.ESTIMATE_MAIL_INGEST_KEY, '', 1000);
  if (!configuredKey) throw Object.assign(new Error('Estimate archive ingestion is not configured'), { status: 503 });
  const suppliedKey = request.headers.get('X-GMT-Archive-Key') || '';
  if (!constantTimeEqual(suppliedKey, configuredKey)) throw Object.assign(new Error('Estimate archive key is invalid'), { status: 401 });
  const body = await readJson(request);
  const mailbox = text(body.mailbox || body.source_mailbox, '', 320).toLowerCase();
  const allowedMailboxes = new Set(['info@gmt-services.co.uk', 'accounts@gmt-services.co.uk', 'acc.gmtelect@outlook.com']);
  if (!allowedMailboxes.has(mailbox)) throw Object.assign(new Error('Estimate mail archive is restricted to approved GMT mailboxes'), { status: 403 });
  const outlookMessageId = text(body.outlook_message_id || body.outlookMessageId, '', 2000);
  if (!outlookMessageId) throw Object.assign(new Error('outlook_message_id is required'), { status: 400 });
  // Graph's InternetMessageId is shared by copies of the same message in different
  // mailboxes, so prefer it for cross-mailbox duplicate detection. Fall back to the
  // mailbox-local message ID when the connector does not provide it.
  const internetMessageId = text(body.internet_message_id || body.internetMessageId, '', 1000);
  const canonicalId = internetMessageId ? `email:${internetMessageId}` : `email:${mailbox}:${outlookMessageId}`;
  const estimate = await estimateIndexStore(env).upsert({
    ...body,
    canonical_id: canonicalId,
    mailbox,
    internet_message_id: internetMessageId,
    mailbox_message_id: outlookMessageId,
    // Message IDs are mailbox-local. Keep source IDs in estimate_mail_sources,
    // where they are uniquely scoped to their mailbox.
    outlook_message_id: '',
    source: 'email'
  });
  return json({ ok: true, estimate }, 200, origin || '');
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

function projectRow(row, includeDetails = true, env = null) {
  const rawPayload = payloadObject(row);
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {};
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
  const sourceAttachmentIds = (() => {
    try {
      const parsed = JSON.parse(row.source_attachment_ids || '[]');
      return Array.isArray(parsed) ? parsed.slice(0, 200).map((value) => text(value, '', 160)).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  })();
  if (row.reconciliation_key || row.source_message_key || row.source_variant_status || sourceAttachmentIds.length) {
    result.reconciliation = {
      key: text(row.reconciliation_key, '', 500),
      source_message_key: text(row.source_message_key, '', 500),
      source_attachment_ids: sourceAttachmentIds,
      variant_status: text(row.source_variant_status, '', 80),
      reconciled_at: text(row.reconciled_at, '', 100)
    };
  }
  const directory = env ? staffDirectory(env) : [];
  const directoryEntry = directoryEntryFor(directory, row.employee_name, row.owner_upn)
    || directoryEntryFor(historicalEmployeeAliases(env), row.employee_name, row.owner_upn);
  // Current roster members and verified historical aliases can appear in
  // timesheet history. Keep other administrative/legacy rows in the explicit
  // synthetic audit view; other document categories are unaffected.
  if (directory.length && ['timesheets', 'clock'].includes(row.kind) && !directoryEntry) result.synthetic = true;
  const scheduleWeekdays = Array.isArray(payload.scheduleWeekdays)
    ? payload.scheduleWeekdays.map((day) => Number(day)).filter((day) => day >= 1 && day <= 7)
    : (directoryEntry?.workdays || []);
  if (scheduleWeekdays.length) {
    result.schedule_weekdays = scheduleWeekdays;
    result.schedule_label = scheduleWeekdays.map((day) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day % 7]).join(', ');
  }
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
  // Timesheet rows are needed by the calendar and spreadsheet preview. The
  // original D1 projection only exposed the header, which made Accounts
  // completion counts disagree with the day-level view. Keep the bounded
  // payload on the protected projection. Historical imports may have shifted
  // explicit Date values into their declared week; restore the retained
  // source Date for reporting without rewriting the stored audit record.
  if (row.kind === 'timesheets' || row.kind === 'clock') {
    const rawRows = Array.isArray(payload.rows)
      ? payload.rows
      : Array.isArray(payload.dailyRows)
        ? payload.dailyRows
        : Array.isArray(payload.daily_rows)
          ? payload.daily_rows
          : [];
    const aligned = rawRows.length ? preserveOriginalDailyDates(rawRows) : { rows: rawRows, issue: '' };
    // A deletion-only pay-month correction still needs its tombstones in the
    // protected projection; otherwise the source rows reappear after reload.
    if (row.action === 'pay_month_correction' && !rawRows.length) result.payload = payload;
    if (rawRows.length) {
      payload.rows = safePayloadValue(aligned.rows);
      result.payload = payload;
      result.daily_rows_count = aligned.rows.length;
      result.daily_dates = aligned.rows.map((item) => upstreamDateKey(item?.date)).filter(Boolean).filter((date, index, values) => values.indexOf(date) === index);
    }
    if (aligned.issue) {
      result.date_correction_issue = aligned.issue;
      result.issue = [result.issue, aligned.issue].filter(Boolean).join(' · ');
    }
  }
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
      if (typeof entry === 'string') return { name: text(entry, '', 240), upn: '', workdays: [] };
      const rawWorkdays = entry?.workdays || entry?.scheduledWeekdays || entry?.scheduled_weekdays || [];
      const workdays = Array.isArray(rawWorkdays)
        ? rawWorkdays.map((day) => {
          if (typeof day === 'number' || /^\d+$/.test(String(day))) return Number(day);
          const names = { sun: 7, sunday: 7, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
          return names[String(day || '').trim().toLowerCase()] || 0;
        }).filter((day, index, values) => day >= 1 && day <= 7 && values.indexOf(day) === index)
        : [];
      return {
        name: text(entry?.name || entry?.displayName || entry?.employee_name, '', 240),
        upn: text(entry?.upn || entry?.email || entry?.employee_upn, '', 320).toLowerCase(),
        workdays
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

// Historical identities have verified mailboxes but are not part of the
// current attendance roster or its missing-day completion report.
function historicalEmployeeAliases(env) {
  return staffDirectory({ STAFF_DIRECTORY_JSON: env?.HISTORICAL_EMPLOYEE_ALIASES_JSON });
}

function upstreamValue(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return upstreamScalar(row[key]);
  }
  return '';
}

// SharePoint choice/person/date fields can arrive as `{Value: ...}`, while
// the same flow may return a plain scalar on another run. Unwrap the common
// envelopes at the Worker boundary so an employee is still matched to the
// configured roster and a date is still usable by the calendar.
function upstreamScalar(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  for (const key of ['value', 'Value', 'displayValue', 'DisplayValue', 'displayName', 'DisplayName', 'email', 'Email', 'name', 'Name']) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim()) return value[key];
  }
  return value;
}

// The history flow has returned a few different shapes over its lifetime:
// some runs expose a JSON object, some expose the record attachment as a
// string in Issue, and older runs expose the daily object itself. Keep the
// normalisation at this boundary so the portal can render the same useful
// day-level view for every source shape.
function parseUpstreamCsv(value) {
  const lines = String(value || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || !/^status\s*,/i.test(lines[0])) return null;
  function cells(line) {
    const output = []; let current = ''; let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
        else quoted = !quoted;
      } else if (character === ',' && !quoted) { output.push(current.trim()); current = ''; }
      else current += character;
    }
    output.push(current.trim()); return output;
  }
  const headers = cells(lines[0]).map((heading) => heading.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return lines.slice(1, 81).map((line) => {
    const values = cells(line); const fields = {};
    headers.forEach((heading, index) => { fields[heading] = values[index] || ''; });
    return {
      date: fields.date || '', start: fields.start || '', finish: fields.finish || '',
      break: fields.break || '', absenceReason: fields.absencereason || '',
      workedHours: fields.workedhours || '', basicHours: fields.basichours || '',
      ot15Hours: fields.ot15hours || '', ot20Hours: fields.ot20hours || '',
      status: fields.status || '', category: fields.category || '',
      weekStart: fields.weekstart || '', weekEnd: fields.weekend || '',
      payMonth: fields.paymonth || '', note: fields.note || ''
    };
  }).filter((row) => row.date || row.start || row.finish || row.absenceReason);
}

function parseUpstreamJson(value) {
  if (value && typeof value === 'object') return value;
  const raw = text(value, '', 120000).trim();
  if (!raw) return null;
  const csvRows = parseUpstreamCsv(raw);
  if (csvRows) return csvRows;
  if (/^[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      // Fall through to the base64 decoder. A malformed JSON attachment must
      // never be treated as a human-readable issue value.
    }
  }
  // Power Automate can expose file content as base64 when an attachment is
  // passed through a legacy SharePoint action. Decode only plausible base64
  // text and accept it when the decoded value is JSON.
  const compact = raw.replace(/\s+/g, '');
  if (compact.length < 8 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) return null;
  try {
    const decoded = atob(compact.replace(/-/g, '+').replace(/_/g, '/'));
    const trimmed = decoded.trim();
    if (!/^[\[{]/.test(trimmed)) return null;
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

function upstreamObjectValue(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const actualKeys = Object.keys(value);
  for (const wanted of keys.map((key) => String(key).toLowerCase())) {
    const actual = actualKeys.find((key) => key.toLowerCase() === wanted);
    if (actual) return upstreamScalar(value[actual]);
  }
  return undefined;
}

const UPSTREAM_DAILY_ROW_KEYS = [
  'rows', 'daily_rows', 'dailyRows', 'records', 'values', 'data', 'items', 'entries', 'dayRows', 'daily',
  'timesheet', 'timesheets', 'attachments', 'files', 'file', 'attachment',
  'attachment_content', 'attachmentContent', 'attachment_contents', 'attachmentContents',
  'file_content', 'fileContent', 'file_contents', 'fileContents', 'calendarSync', 'calendar_sync',
  'calendarSyncPayload', 'calendar_sync_payload'
];
const UPSTREAM_DAILY_ENVELOPE_KEYS = [
  'payload', 'body', 'result', 'response', 'content', 'value', 'item', 'fields', 'properties',
  'contentBytes', 'contentBase64', 'base64', 'attachmentContent'
];
const UPSTREAM_DAILY_VALUE_KEYS = [
  'date', 'record_date', 'recordDate', 'workDate', 'day', 'startTime', 'start', 'clockIn', 'clock_in',
  'finishTime', 'finish', 'clockOut', 'clock_out', 'absenceReason', 'absenceStatus', 'workedMinutes',
  'worked_minutes', 'workedHours', 'worked_hours', 'hours', 'totalHours', 'basicHours', 'basic_hours',
  'ot15Hours', 'ot15_hours', 'ot20Hours', 'ot20_hours', 'lunchMinutes', 'lunch_minutes', 'breakMinutes',
  'break_minutes', 'break', 'action', 'clockAction', 'clock_action', 'time', 'timestamp'
];

function upstreamLooksLikeDailyRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return UPSTREAM_DAILY_VALUE_KEYS.some((key) => {
    const item = upstreamObjectValue(value, [key]);
    return item !== '' && item !== null && item !== undefined;
  });
}

function collectUpstreamDailyRows(value, depth = 0, seen = new Set()) {
  if (depth > 8) return [];
  const parsed = parseUpstreamJson(value);
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    const rows = [];
    parsed.forEach((item) => {
      const nested = collectUpstreamDailyRows(item, depth + 1, seen);
      if (nested.length) rows.push(...nested);
      else if (upstreamLooksLikeDailyRow(item)) rows.push(item);
    });
    return rows.slice(0, 80);
  }
  if (typeof parsed !== 'object') return [];
  if (seen.has(parsed)) return [];
  seen.add(parsed);
  // Prefer known row containers before treating a wrapper with a summary
  // date as the row itself. This keeps every day from nested flow responses.
  for (const key of UPSTREAM_DAILY_ROW_KEYS) {
    const nestedValue = upstreamObjectValue(parsed, [key]);
    if (nestedValue === '' || nestedValue === null || nestedValue === undefined) continue;
    const rows = collectUpstreamDailyRows(nestedValue, depth + 1, seen);
    if (rows.length) return rows.slice(0, 80);
  }
  if (upstreamLooksLikeDailyRow(parsed)) return [parsed];
  for (const key of UPSTREAM_DAILY_ENVELOPE_KEYS) {
    const nestedValue = upstreamObjectValue(parsed, [key]);
    if (nestedValue === '' || nestedValue === null || nestedValue === undefined) continue;
    const rows = collectUpstreamDailyRows(nestedValue, depth + 1, seen);
    if (rows.length) return rows.slice(0, 80);
  }
  return [];
}

function upstreamDailyRows(value) {
  const rows = collectUpstreamDailyRows(value);
  const seen = new Set();
  return rows.filter((row) => {
    // Weekly submissions commonly carry the same day rows in both the XLSX
    // and CSV attachments. Collapse those byte-for-byte logical duplicates,
    // while retaining separate source records when an ID, note or timestamp
    // distinguishes them.
    const signature = [
      upstreamObjectValue(row, ['recordId', 'record_id', 'sourceRecordId', 'source_record_id']),
      upstreamObjectValue(row, ['submissionId', 'submission_id']),
      upstreamObjectValue(row, ['date', 'record_date', 'recordDate', 'Date', 'workDate']),
      upstreamObjectValue(row, ['start', 'startTime', 'start_time', 'clockIn', 'clock_in']),
      upstreamObjectValue(row, ['finish', 'finishTime', 'finish_time', 'clockOut', 'clock_out']),
      upstreamObjectValue(row, ['lunchMinutes', 'lunch_minutes', 'breakMinutes', 'break_minutes', 'break']),
      upstreamObjectValue(row, ['absenceStatus', 'absence_status', 'absenceReason', 'absence_reason', 'absence']),
      upstreamObjectValue(row, ['workedMinutes', 'worked_minutes', 'workedHours', 'worked_hours', 'hours', 'totalHours']),
      upstreamObjectValue(row, ['note', 'notes', 'description', 'Note']),
      upstreamObjectValue(row, ['submittedAt', 'submitted_at', 'Submitted At'])
    ].map((item) => text(item, '', 500)).join('|');
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function preserveOriginalDailyDates(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  let restored = 0;
  const dated = sourceRows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const date = upstreamDateKey(upstreamObjectValue(row, ['date', 'record_date', 'recordDate', 'Date', 'workDate']));
    const sourceDate = upstreamDateKey(upstreamObjectValue(row, ['sourceDate', 'source_date', 'originalDate', 'original_date']));
    if (!sourceDate || sourceDate === date) return row;
    restored += 1;
    return { ...row, date: sourceDate, legacyAlignedDate: date || undefined };
  });
  return {
    rows: dated,
    issue: restored
      ? `${restored} daily Date value(s) restored from the original source; previous week-aligned dates are retained for audit.`
      : ''
  };
}

function upstreamPayloadAndRows(row) {
  const candidates = [
    'payload', 'payload_json', 'payloadJson', 'record_json', 'recordJson', 'Record JSON',
    'attachment_record', 'attachmentRecord', 'record_attachment', 'recordAttachment',
    'attachment_content', 'attachmentContent', 'attachment_contents', 'attachmentContents',
    'file_content', 'fileContent', 'file_contents', 'fileContents',
    'daily_rows', 'dailyRows', 'rows', 'Rows', 'record', 'Record', 'issue', 'Issue',
    'body_json', 'bodyJson', 'json_content', 'jsonContent', 'gmt_payload', 'gmt_daily_rows',
    'daily_rows_json', 'dailyRowsJson', 'gmt_calendar_sync_payload', 'calendarSyncPayload',
    'calendar_sync_payload', 'calendarSync', 'calendar_sync'
  ];
  for (const key of candidates) {
    const value = upstreamObjectValue(row, [key]);
    if (value === '' || value === null || value === undefined) continue;
    const parsed = parseUpstreamJson(value);
    const rows = upstreamDailyRows(parsed);
    if (rows.length) return { payload: parsed, rows };
  }
  const directRows = upstreamDailyRows(row);
  return directRows.length ? { payload: row, rows: directRows } : { payload: null, rows: [] };
}

function numericUpstreamValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function upstreamWeekday(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 0;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(date.getTime())) return 0;
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function upstreamDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function upstreamDailyWindow(startDate, endDate, rows) {
  const dates = (Array.isArray(rows) ? rows : [])
    .map((row) => upstreamDateKey(row?.date))
    .filter(Boolean)
    .sort();
  if (!dates.length) return null;
  const declaredStart = upstreamDateKey(startDate);
  const declaredEnd = upstreamDateKey(endDate);
  if (!declaredStart || !declaredEnd) return null;
  const insideDeclaredWindow = dates.filter((date) => date >= declaredStart && date <= declaredEnd).length;
  if (insideDeclaredWindow || dates[dates.length - 1] > datePlusDays(dates[0], 6)) return null;
  // A forwarded/legacy SharePoint row can carry the following week's email
  // header while its attached daily rows belong to the preceding week. When
  // every daily date is coherent but outside that header, use the daily window
  // for reporting and retain the header below as an audit issue.
  const first = dates[0];
  const weekday = upstreamWeekday(first);
  const effectiveStart = datePlusDays(first, -(weekday ? weekday - 1 : 0));
  return effectiveStart ? {
    start: effectiveStart,
    end: datePlusDays(effectiveStart, 6),
    first,
    last: dates[dates.length - 1]
  } : null;
}

function upstreamBreakMinutes(value) {
  const number = numericUpstreamValue(value);
  if (number !== null) return number;
  const raw = text(value, '', 80).trim().toLowerCase();
  if (!raw) return null;
  if (/^(?:no\s*break|none|not[- ]?taken|no)$/.test(raw)) return 0;
  const hours = raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minutes = raw.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
  if (!hours && !minutes) return null;
  return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
}

// Timesheet sources use the same compact clock values as the portal form, but
// older SharePoint rows sometimes contain an ISO timestamp.  Keep this parser
// deliberately timezone-neutral: a timesheet's entered clock values are local
// workday times, so the duration must not shift when the record is viewed in a
// different browser timezone.
function upstreamTimeMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim().toLowerCase();
  const iso = raw.match(/(?:t|\s)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?$/i);
  const match = iso || raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (!iso && match[3]) {
    if (hour < 1 || hour > 12) return null;
    if (match[3] === 'pm' && hour < 12) hour += 12;
    if (match[3] === 'am' && hour === 12) hour = 0;
  }
  return hour >= 0 && hour <= 23 ? hour * 60 + minute : null;
}

function breakMinutesFromNote(value) {
  const raw = text(value, '', 3000);
  const match = raw.match(/\bbreak\s*:\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return /hours?|hrs?|h/i.test(match[2]) ? amount * 60 : amount;
}

function booleanUpstreamValue(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return null;
  if (/^(true|yes|y|1|taken|added)$/i.test(String(value).trim())) return true;
  if (/^(false|no|no\s*break|n|0|none|not[- ]?taken|na)$/i.test(String(value).trim())) return false;
  return null;
}

function normaliseUpstreamDailyRow(row, defaults = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const explicitDate = upstreamObjectValue(row, ['date', 'record_date', 'recordDate', 'Date', 'workDate', 'day']);
  const date = text(explicitDate || (defaults.allowRecordDate ? defaults.date : ''), '', 80);
  const sourceDate = text(upstreamObjectValue(row, ['sourceDate', 'source_date', 'originalDate', 'original_date']), '', 80);
  const legacyAlignedDate = text(upstreamObjectValue(row, ['legacyAlignedDate']), '', 80);
  const start = text(upstreamObjectValue(row, ['start', 'startTime', 'start_time', 'clockIn', 'clock_in', 'dayStart', 'day_start', 'Start']), '', 40);
  const finish = text(upstreamObjectValue(row, ['finish', 'finishTime', 'finish_time', 'clockOut', 'clock_out', 'dayFinish', 'day_finish', 'Finish']), '', 40);
  const lunchStart = text(upstreamObjectValue(row, ['lunchStart', 'lunch_start', 'breakStart', 'break_start', 'Lunch start']), '', 40);
  const lunchEnd = text(upstreamObjectValue(row, ['lunchEnd', 'lunch_end', 'breakEnd', 'break_end', 'Lunch end']), '', 40);
  const note = text(upstreamObjectValue(row, ['description', 'note', 'notes', 'Note']), '', 3000);
  const rawLunch = upstreamObjectValue(row, ['lunchMinutes', 'lunch_minutes', 'breakMinutes', 'break_minutes', 'break', 'Break']);
  const lunchMinutes = upstreamBreakMinutes(rawLunch)
    ?? breakMinutesFromNote(note)
    ?? (upstreamTimeMinutes(lunchStart) !== null && upstreamTimeMinutes(lunchEnd) !== null
      ? Math.max(0, upstreamTimeMinutes(lunchEnd) - upstreamTimeMinutes(lunchStart))
      : null);
  const lunchHad = booleanUpstreamValue(upstreamObjectValue(row, ['lunchHad', 'lunch_had', 'breakTaken', 'break_taken', 'hadBreak']));
  const absenceStatus = text(upstreamObjectValue(row, ['absenceStatus', 'absence_status', 'absenceReason', 'absence_reason', 'absence', 'Absence reason']), 'NA', 160);
  const status = text(upstreamObjectValue(row, ['status', 'Status']), defaults.status || 'Recorded', 120);
  const rowSubmittedAt = text(upstreamObjectValue(row, ['submittedAt', 'submitted_at', 'Submitted At']), defaults.submittedAt || '', 100);
  const sourceRecordId = text(upstreamObjectValue(row, ['recordId', 'record_id', 'sourceRecordId', 'source_record_id']), '', MAX_RECORD_ID);
  let breakStatus = text(upstreamObjectValue(row, ['breakStatus', 'break_status', 'Break']), '', 80);
  if (/^(?:no\s*break|none|not[- ]?taken|no|0)$/i.test(breakStatus)) breakStatus = 'not-taken';
  else if (/^(?:yes|taken|added)$/i.test(breakStatus) || /\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/i.test(breakStatus)) breakStatus = 'added';
  breakStatus = breakStatus
    || (lunchHad === false ? 'not-taken' : '')
    || (lunchHad === true ? 'added' : '')
    || (lunchMinutes !== null && lunchMinutes > 0 ? 'added' : '')
    || (/break:\s*(?:no break|none|not taken)/i.test(note) ? 'not-taken' : '');
  const reportedWorkedHours = numericUpstreamValue(upstreamObjectValue(row, ['workedHours', 'worked_hours', 'hours', 'totalHours', 'Worked hours']));
  const basicHours = numericUpstreamValue(upstreamObjectValue(row, ['basicHours', 'basic_hours', 'Basic hours']));
  const ot15Hours = numericUpstreamValue(upstreamObjectValue(row, ['ot15Hours', 'ot15_hours', 'overtime15Hours', 'OT x1.5 hours']));
  const ot20Hours = numericUpstreamValue(upstreamObjectValue(row, ['ot20Hours', 'ot20_hours', 'overtime20Hours', 'OT x2.0 hours']));
  const reportedWorkedMinutes = numericUpstreamValue(upstreamObjectValue(row, ['workedMinutes', 'worked_minutes', 'Worked minutes']))
    ?? (reportedWorkedHours !== null ? reportedWorkedHours * 60 : null);
  const startMinutes = upstreamTimeMinutes(start);
  const finishMinutes = upstreamTimeMinutes(finish);
  let workedMinutes = null;
  let calculationSource = 'unavailable';
  const validationIssues = [];
  if (!date) validationIssues.push('Date missing');
  if (!/^(?:na|n\/a|none|no absence|not applicable)$/i.test(absenceStatus.trim())) {
    workedMinutes = reportedWorkedMinutes === null ? 0 : reportedWorkedMinutes;
    calculationSource = reportedWorkedMinutes === null ? 'absence' : 'reported absence total';
  } else if (startMinutes !== null && finishMinutes !== null) {
    if (finishMinutes > startMinutes) {
      workedMinutes = Math.max(0, finishMinutes - startMinutes - (lunchMinutes || 0));
      calculationSource = 'clock interval';
    } else if (finishMinutes === startMinutes) {
      validationIssues.push('Clock in and clock out are the same time');
      calculationSource = 'invalid clock interval';
    } else {
      validationIssues.push('Finish is earlier than clock in');
      calculationSource = 'invalid clock interval';
    }
  } else {
    if (startMinutes === null) validationIssues.push('Clock in missing');
    if (finishMinutes === null) validationIssues.push('Clock out missing');
  }
  const result = {
    recordId: sourceRecordId || (defaults.sourceRecordId && date ? `${defaults.sourceRecordId}|${date}` : defaults.sourceRecordId || ''),
    submissionId: text(upstreamObjectValue(row, ['submissionId', 'submission_id']), defaults.sourceRecordId || '', MAX_RECORD_ID),
    date,
    sourceDate: sourceDate && sourceDate !== date ? sourceDate : '',
    legacyAlignedDate,
    action: text(upstreamObjectValue(row, ['action', 'Action']), defaults.action || 'submission', 100),
    status,
    absenceStatus,
    start,
    finish,
    lunchStart,
    lunchEnd,
    lunchMinutes,
    lunchHad,
    breakStatus,
    workedMinutes,
    workedHours: workedMinutes !== null ? workedMinutes / 60 : null,
    reportedWorkedHours,
    reportedWorkedMinutes,
    calculationSource,
    basicHours,
    ot15Hours,
    ot20Hours,
    weightedHours: numericUpstreamValue(upstreamObjectValue(row, ['weightedHours', 'weighted_hours'])),
    location: text(upstreamObjectValue(row, ['location', 'site', 'Location / site']), '', 500),
    note,
    submittedAt: rowSubmittedAt,
    source: 'microsoft-365',
    validationIssues
  };
  const scheduledWeekdays = Array.isArray(defaults.scheduleWeekdays)
    ? defaults.scheduleWeekdays.map((day) => Number(day)).filter((day) => day >= 1 && day <= 7)
    : [];
  if (scheduledWeekdays.length && date) {
    const weekday = upstreamWeekday(date);
    result.scheduled = scheduledWeekdays.includes(weekday);
    if (!result.scheduled) result.scheduleIssue = 'Outside configured work schedule';
  }
  return safePayloadValue(result);
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
  if (candidateUpn) {
    const exact = directory.find((entry) => entry.upn && candidateUpn === entry.upn);
    // An explicit address that is not on the roster must not be rescued by a
    // similar display name (for example Michelle Reid vs Michelle).
    if (exact || directory.some((entry) => entry.upn)) return exact || null;
  }
  return directory.find((entry) => {
    if (!candidateName || !entry.name) return false;
    const directoryName = entry.name.trim().toLowerCase();
    const compactDirectoryName = directoryName.replace(/[^a-z0-9]+/g, '');
    return candidateName === directoryName || compactName === compactDirectoryName;
  }) || null;
}

function normaliseUpstreamRecord(row, identity, env) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  // SharePoint Get items sometimes wraps the actual columns in `fields` (and
  // a few older flow versions used `item`/`properties`). Flatten those
  // envelopes before looking for the canonical column names. Keep top-level
  // values authoritative when both shapes are present.
  const nested = ['fields', 'Fields', 'item', 'Item', 'properties', 'Properties']
    .map((key) => row[key])
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    .reduce((merged, value) => Object.assign(merged, value), {});
  row = Object.keys(nested).length ? { ...nested, ...row } : row;
  const title = upstreamValue(row, ['title', 'Title', 'subject', 'Subject']);
  const titleDetails = historyTitleDetails(title);
  const directory = staffDirectory(env);
  const explicitName = upstreamValue(row, ['employee_name', 'employeeName', 'EmployeeName', 'Employee Name', 'employee', 'Employee', 'gmt_employee']);
  const explicitEmail = upstreamValue(row, ['employee_upn', 'employeeUpn', 'employeeEmail', 'employee_email', 'EmployeeEmail', 'Employee Email', 'Employee_x0020_Email', 'email', 'Email', 'gmt_employee_upn']);
  const initialName = text(explicitName || titleDetails.name, '', 240);
  const initialEmail = text(explicitEmail, '', 320).toLowerCase();
  const directoryEntry = directoryEntryFor(directory, initialName, initialEmail)
    || directoryEntryFor(historicalEmployeeAliases(env), initialName, initialEmail);
  const employeeName = text(directoryEntry?.name || initialName || (identity.isAdmin ? '' : identity.name || identity.upn), '', 240);
  const employeeUpn = text(directoryEntry?.upn || initialEmail || (identity.isAdmin ? '' : identity.upn), '', 320).toLowerCase();
  if (!employeeName && !employeeUpn) return null;
  const titleKind = /\[(?:CLOCK|DAY)\]/i.test(String(title || '')) ? 'clock' : '';
  const rawKind = text(upstreamValue(row, ['kind', 'category', 'record_type', 'recordType', 'action', 'gmt_type']) || titleKind || 'timesheets', 'timesheets', 120).toLowerCase().replace(/[\s_]+/g, '-');
  const kind = rawKind === 'submission' || rawKind === 'weekly-submission' || rawKind === 'timesheet' ? 'timesheets' : canonicalKind(rawKind);
  const sourceData = kind === 'timesheets' || kind === 'clock' ? upstreamPayloadAndRows(row) : { payload: null, rows: [] };
  const firstDailyRow = sourceData.rows[0] || null;
  const embeddedSourceRecordId = text(
    upstreamObjectValue(sourceData.payload, ['submissionId', 'submission_id', 'sourceRecordId', 'source_record_id', 'recordId', 'record_id'])
      || upstreamObjectValue(firstDailyRow, ['submissionId', 'submission_id', 'sourceRecordId', 'source_record_id', 'recordId', 'record_id']),
    '',
    MAX_RECORD_ID
  );
  const firstDailyDate = text(upstreamObjectValue(firstDailyRow, ['date', 'record_date', 'recordDate', 'Date', 'workDate', 'day']), '', 80);
  let startDate = text(upstreamValue(row, ['start_date', 'startDate', 'weekStart', 'WeekStart', 'Week Start', 'Week_x0020_Start', 'gmt_week_start']) || titleDetails.weekStart || firstDailyDate, '', 80);
  let endDate = text(upstreamValue(row, ['end_date', 'endDate', 'weekEnd', 'WeekEnd', 'Week End', 'Week_x0020_End', 'gmt_week_end']) || (kind === 'clock' ? startDate : datePlusDays(startDate, 6)), '', 80);
  let recordDate = text(upstreamValue(row, ['record_date', 'recordDate', 'date', 'Date', 'gmt_record_date']) || firstDailyDate || startDate, '', 80);
  const declaredStartDate = startDate;
  const declaredEndDate = endDate;
  const declaredRecordDate = recordDate;
  const embeddedSubmittedAt = upstreamObjectValue(sourceData.payload, ['submittedAt', 'submitted_at', 'Submitted At', 'Submitted_x0020_At', 'gmt_submitted_at'])
    || upstreamObjectValue(firstDailyRow, ['submittedAt', 'submitted_at', 'Submitted At', 'Submitted_x0020_At', 'gmt_submitted_at']);
  const submittedAt = text(upstreamValue(row, ['submitted_at', 'submittedAt', 'Submitted At', 'Submitted_x0020_At', 'gmt_submitted_at']) || embeddedSubmittedAt || upstreamValue(row, ['Created', 'created', 'Modified', 'modified']), '', 100);
  const updatedAt = text(upstreamValue(row, ['updated_at', 'updatedAt', 'Modified', 'modified']) || submittedAt, '', 100);
  const action = text(upstreamValue(row, ['action', 'Action', 'category', 'record_type', 'gmt_action']) || (kind === 'timesheets' ? 'submission' : kind === 'clock' ? 'clock' : 'Timesheet'), 'Timesheet', 100);
  const status = text(upstreamValue(row, ['status', 'Status', 'Status Value', 'gmt_status']) || 'Submitted', 'Submitted', 100);
  // A few of the legacy history rows do not carry the SharePoint item ID or
  // the stable GMT record ID. Keep those rows addressable in the portal by
  // deriving a deterministic fallback from the employee, period and source
  // title. This is a portal identifier only; it does not overwrite the source
  // email/list ID when one is present.
  const sourceRecordValue = upstreamValue(row, ['source_record_id', 'sourceRecordId', 'gmt_record_id', 'Source Record ID', 'Source_x0020_Record_x0020_ID'])
    || embeddedSourceRecordId
    || (row.Id || row.ID || row.GUID ? `sharepoint-timesheet-${row.Id || row.ID || row.GUID}` : '');
  const fallbackRecordSeed = [kind, employeeUpn || employeeName, recordDate || startDate || title, endDate, title, updatedAt].filter(Boolean).join('|');
  const fallbackRecordId = fallbackRecordSeed
    ? `history-${fallbackRecordSeed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_RECORD_ID - 8)}`
    : '';
  const sourceRecordId = text(sourceRecordValue || fallbackRecordId, '', MAX_RECORD_ID);
  const alignedSource = preserveOriginalDailyDates(sourceData.rows);
  if (alignedSource.issue) {
    const alignedFirstDate = upstreamDateKey(alignedSource.rows[0]?.date);
    if (alignedFirstDate) recordDate = alignedFirstDate;
  }
  const rows = alignedSource.rows.map((item) => normaliseUpstreamDailyRow(item, {
    date: recordDate || startDate,
    allowRecordDate: kind === 'clock',
    status: kind === 'clock' ? 'Recorded' : status,
    action,
    submittedAt,
    sourceRecordId,
    scheduleWeekdays: directoryEntry?.workdays || []
  })).filter(Boolean);
  const dailyWindow = kind === 'timesheets' ? upstreamDailyWindow(startDate, endDate, rows) : null;
  const periodIssue = dailyWindow
    ? `Source week ${declaredStartDate || 'not dated'} to ${declaredEndDate || 'not dated'} differs from daily rows ${dailyWindow.first} to ${dailyWindow.last}; reporting uses the daily dates.`
    : '';
  const dailyDetailIssue = kind === 'timesheets' && !rows.length
    ? 'Daily rows were not returned by the Microsoft 365 history source; times, breaks and totals are unavailable.'
    : '';
  if (dailyWindow) {
    startDate = dailyWindow.start;
    endDate = dailyWindow.end;
    recordDate = dailyWindow.first;
  }
  const payloadObject = sourceData.payload && typeof sourceData.payload === 'object' && !Array.isArray(sourceData.payload)
    ? { ...sourceData.payload }
    : {};
  if (rows.length) payloadObject.rows = rows;
  const payload = Object.keys(payloadObject).length ? safePayloadValue(payloadObject) : null;
  const rawIssue = upstreamValue(row, ['issue', 'Issue', 'gmt_issue']);
  const parsedIssue = parseUpstreamJson(rawIssue);
  const issueValue = parsedIssue
    ? (typeof parsedIssue === 'object' && !Array.isArray(parsedIssue) ? upstreamObjectValue(parsedIssue, ['issue', 'Issue', 'message']) : '')
    : rawIssue;
  const issue = [text(issueValue, '', 1000), alignedSource.issue, periodIssue, dailyDetailIssue].filter(Boolean).join(' · ');
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
  if (payload) {
    mapped.payload = payload;
    mapped.daily_rows_count = rows.length;
    mapped.daily_dates = rows.map((item) => item.date).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
  }
  if (periodIssue) {
    mapped.period_issue = periodIssue;
    mapped.declared_start_date = declaredStartDate;
    mapped.declared_end_date = declaredEndDate;
    mapped.declared_record_date = declaredRecordDate;
  }
  if (dailyDetailIssue) mapped.daily_detail_issue = dailyDetailIssue;
  if (alignedSource.issue) mapped.date_correction_issue = alignedSource.issue;
  const sourceMessageKey = text(upstreamValue(row, ['source_message_key', 'sourceMessageKey', 'sourceMessageId', 'source_message_id']), '', 500);
  const sourceVariantStatus = text(upstreamValue(row, ['source_variant_status', 'sourceVariantStatus', 'reconciliationStatus']), '', 80);
  const reconciliationKey = text(upstreamValue(row, ['reconciliation_key', 'reconciliationKey']), '', 500);
  const sourceAttachmentIds = upstreamObjectValue(row, ['source_attachment_ids', 'sourceAttachmentIds']);
  const reconciledAt = text(upstreamValue(row, ['reconciled_at', 'reconciledAt']), '', 100);
  if (sourceMessageKey || sourceVariantStatus || reconciliationKey || sourceAttachmentIds || reconciledAt) {
    const parsedAttachmentIds = parseUpstreamJson(sourceAttachmentIds);
    mapped.reconciliation = {
      key: reconciliationKey,
      source_message_key: sourceMessageKey,
      source_attachment_ids: Array.isArray(parsedAttachmentIds) ? parsedAttachmentIds.slice(0, 200).map((value) => text(value, '', 160)).filter(Boolean) : [],
      variant_status: sourceVariantStatus,
      reconciled_at: reconciledAt
    };
  }
  if (directoryEntry?.workdays?.length) {
    mapped.schedule_weekdays = directoryEntry.workdays;
    mapped.schedule_label = directoryEntry.workdays.map((day) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day % 7]).join(', ');
  }
  // The protected history list also contains old validation/backfill rows. Once
  // the employee roster is configured, an unmatched identity cannot be a
  // current employee submission, so keep it out of the default Accounts view
  // and completion totals. This also excludes the retiring acc.gmtelect test
  // account without hard-coding it into the UI.
  mapped.synthetic = syntheticRecord(mapped, row)
    || /^TEST(?:[\s_-]|$)/i.test(employeeName)
    || /\b(?:flow\s+test|flow\s+validation|historical\s+backfill|archive\s+(?:backfill|real)|test\s+(?:route|external))\b/i.test(title)
    // Historical employee aliases can have real daily rows even when the
    // current roster has no matching mailbox. Keep those rows available for
    // Accounts to reconcile; exclude unmatched header-only backfills.
    || (directory.length > 0 && !directoryEntry && !rows.length);
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
  const kind = canonicalKind(record.kind || record.action || 'timesheets');
  const employee = text(record.employee_upn || record.employee_email || record.employee_name, '', 320).toLowerCase();
  const week = recordWeekStart(record) || text(record.start_date || record.record_date || record.end_date, '', 80).slice(0, 10);
  const status = text(record.status, 'Submitted', 120).toLowerCase();
  // A single weekly timesheet can produce several SharePoint rows when the
  // message is forwarded or re-submitted. Group those rows by employee/week
  // so an older sparse row cannot hide a richer daily payload from the portal.
  if (kind === 'timesheets' && employee && week) return `timesheet|${employee}|${week}|${status}`;
  if (source) return `source:${source}`;
  return `${kind}|${employee}|${week}|${status}`;
}

function historyRecordFingerprint(record) {
  if (!record || typeof record !== 'object') return '';
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
  const rows = Array.isArray(payload.rows)
    ? payload.rows.map((row) => ({
      date: row?.date || row?.record_date || row?.recordDate || '',
      start: row?.start || row?.startTime || row?.clockIn || '',
      finish: row?.finish || row?.finishTime || row?.clockOut || '',
      break: row?.lunchMinutes ?? row?.breakMinutes ?? row?.break ?? '',
      absence: row?.absenceStatus || row?.absenceReason || row?.absence || '',
      worked: row?.workedMinutes ?? row?.workedHours ?? row?.hours ?? '',
      basic: row?.basicHours ?? '',
      ot15: row?.ot15Hours ?? '',
      ot20: row?.ot20Hours ?? '',
      note: row?.note || row?.notes || ''
    }))
    : [];
  const kind = canonicalKind(record.kind || record.action || 'timesheets');
  const employee = text(record.employee_upn || record.employee_email || record.employee_name, '', 320).toLowerCase();
  const week = recordWeekStart(record) || text(record.start_date || record.record_date || record.end_date, '', 80).slice(0, 10);
  // Exclude the outer SharePoint row ID: forwarded copies of the same message
  // often have different list IDs, while materially different submissions keep
  // a different payload or header and therefore remain visible as versions.
  return [kind, employee, week, text(record.status, 'Submitted', 120).toLowerCase(), text(record.record_date, '', 80), text(record.title, '', 600), JSON.stringify(rows.length ? rows : payload)].join('|');
}

function historyRecordRichness(record) {
  if (!record || typeof record !== 'object') return 0;
  const rows = record.payload && typeof record.payload === 'object' && Array.isArray(record.payload.rows) ? record.payload.rows : [];
  const daily = Math.max(0, Number(record.daily_rows_count || rows.length || 0) || 0);
  const invalidRows = rows.filter((row) => Array.isArray(row?.validationIssues) && row.validationIssues.some((issue) => /same time|earlier than clock|clock in missing|clock out missing/i.test(String(issue)))).length;
  const validRows = Math.max(0, daily - invalidRows);
  const correctedRows = rows.filter((row) => row?.sourceDate || row?.source_date).length;
  const payload = record.payload && typeof record.payload === 'object' ? 1 : 0;
  const variant = text(record.source_variant_status || record.reconciliation?.variant_status, '', 80).toLowerCase();
  const authoritative = variant === 'authoritative' ? 1 : 0;
  const metadata = ['employee_upn', 'start_date', 'end_date', 'record_date', 'submitted_at', 'updated_at', 'status']
    .reduce((score, key) => score + (text(record[key], '', 320) ? 1 : 0), 0);
  // Valid, complete day coverage is the canonical view.  Timestamp recency
  // only breaks ties after row quality, so a later sparse retry cannot hide a
  // richer weekly submission; date-corrected rows remain auditable but lose a
  // tie to rows whose source dates already match the declared week.
  return (authoritative ? 500000 : 0)
    + (validRows === daily && daily > 0 ? 1000000 : 0)
    + validRows * 10000
    + daily * 100
    + payload * 10
    + metadata
    - correctedRows;
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
      if (week && (!byWeek.has(week) || historyRecordRichness(record) > historyRecordRichness(byWeek.get(week)))) byWeek.set(week, record);
    });
    const completedWeeks = weeks.filter((week) => byWeek.has(week.start)).map((week) => week.start);
    const missingWeeks = weeks.filter((week) => !byWeek.has(week.start)).map((week) => `${week.start} to ${week.end}`);
    const missing = missingWeeks.map((week) => `Timesheet week ${week}`);
    employeeRecords.forEach((record) => {
      const issue = recordStatusIssue(record);
      if (issue && !missing.includes(issue)) missing.push(issue);
    });
    const scheduleWeekdays = Array.isArray(employee.workdays) ? employee.workdays : [];
    const reviewFlags = employeeRecords.reduce((count, record) => {
      const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      // The roster schedule is authoritative. A row on a non-working day is
      // retained in the source payload for audit, but it must not make an
      // otherwise complete employee look incomplete (Michelle works Tuesday
      // and Wednesday only).
      return count + rows.filter((row) => row && row.scheduled !== false && row.scheduleIssue).length;
    }, 0);
    const status = !employeeRecords.length ? 'missing' : (missing.length || reviewFlags ? 'incomplete' : 'completed');
    const fingerprints = new Set(employeeRecords.map(historyRecordFingerprint).filter(Boolean));
    return {
      employee_name: employee.name || employee.upn || 'Unnamed employee',
      employee_upn: employee.upn,
      configured: employee.configured,
      status,
      completed_weeks: completedWeeks,
      missing_weeks: missingWeeks,
      missing,
      submitted_records: fingerprints.size || employeeRecords.length,
      source_variants: employeeRecords.length,
      review_flags: reviewFlags,
      schedule_weekdays: scheduleWeekdays,
      schedule_label: scheduleWeekdays.map((day) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day % 7]).join(', ')
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
  if (record.action === 'pay_month_correction' && !attachments.some((attachment) => attachment.fieldName === 'attachment_record')) {
    throw Object.assign(new Error('Pay-month corrections require a dated JSON record attachment for workbook filing'), { status: 400 });
  }
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
  // The first daily date may be in August while the pay month ends in
  // September. Never use the form's week-start field as the workbook month.
  const declaredMonth = text(payload.payMonth || payload.pay_month, '', 7);
  const month = /^\d{4}-\d{2}$/.test(declaredMonth)
    ? declaredMonth
    : payCycleKeyForDate(weekStart) || 'unspecified';
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
  set('gmt_pay_month', month);
  set('gmt_filing_mode', 'monthly-upsert');
  set('gmt_employee', employeeName);
  set('gmt_employee_upn', employeeUpn);
  set('gmt_week_start', weekStart);
  set('gmt_week_end', weekEnd);
  set('gmt_year', month.slice(0, 4));
  set('gmt_month', month.slice(5, 7));
  set('gmt_worked_hours', hours(totals.workedActual));
  set('gmt_basic_hours', hours(totals.basic));
  set('gmt_ot15_hours', hours(totals.ot15));
  set('gmt_ot20_hours', hours(totals.ot20));
  set('gmt_absence_count', events.filter((event) => event && event.type === 'absence').length);
  set('gmt_calendar_sync', 'requested');
  set('gmt_calendar_name', text(calendarSync.calendarName, 'GMT Operational Calendar', 240));
  set('gmt_calendar_event_count', events.length);
  // Keep bounded daily rows and calendar payload in form fields for the email
  // receipt. Pay-month corrections also carry a dated JSON attachment for the
  // filing flow's existing attachment filter and Excel script input.
  set('gmt_daily_rows', JSON.stringify(Array.isArray(payload.rows) ? payload.rows : []));
  set('gmt_calendar_sync_payload', JSON.stringify(calendarSync));
  const attachmentManifest = attachments.map((attachment) => attachment.field_name || attachment.fieldName).map((fieldName) => ({
    attachment: 'xlsx',
    attachment_csv: 'csv',
    attachment_record: 'record-json',
    attachment_calendar_sync: 'calendar-sync-json'
  }[fieldName] || fieldName)).filter(Boolean);
  set('gmt_attachment_manifest', attachmentManifest.join(','));
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

function rateLimitRetryAt(timestamp, retryAfter) {
  const start = new Date(timestamp).getTime();
  const value = String(retryAfter || '').trim();
  const seconds = /^\d+$/.test(value) ? Number(value) : NaN;
  const target = Number.isFinite(seconds) ? start + seconds * 1000 : Date.parse(value);
  const delay = Number.isFinite(target) ? target - start : 60 * 60 * 1000;
  return new Date(start + Math.max(5 * 60 * 1000, Math.min(delay, 24 * 60 * 60 * 1000))).toISOString();
}

async function dispatchQueued(env, options = {}) {
  const endpoint = dispatchEndpoint(env);
  if (!endpoint) return { status: 'not-configured', sent: 0, failed: 0, skipped: 0 };
  const timestamp = options.now || now();
  const limit = Math.min(Math.max(Number(options.limit || MAX_QUEUE_BATCH), 1), MAX_QUEUE_BATCH);
  const targetRecordId = text(options.recordId, '', MAX_RECORD_ID);
  const result = await env.DB.prepare(`SELECT q.record_id, q.status AS dispatch_status, q.queued_at, q.updated_at AS dispatch_updated_at,
      q.attempts, q.next_attempt_at, q.last_sent_at, q.last_error, r.*
    FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id
    WHERE q.status IN ('queued', 'failed') AND q.next_attempt_at <= ? AND r.status <> 'Deleted'
      AND (? = '' OR q.record_id = ?)
    ORDER BY q.queued_at ASC LIMIT ?`).bind(timestamp, targetRecordId, targetRecordId, limit).all();
  const summary = { status: 'complete', sent: 0, failed: 0, skipped: 0, dryRun: Boolean(options.dryRun), records: [] };
  const rows = result.results || [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const payload = payloadObject(row);
    // A successful email handoff is not a successful workbook replay. Keep
    // pay-month snapshots queued until the receiving flow, script and target
    // workbook have passed an end-to-end read-back.
    if (row.action === 'pay_month_correction' && env.PAY_MONTH_REPLAY_READY !== 'true') {
      summary.status = 'awaiting-provider';
      summary.deferred = (summary.deferred || 0) + 1;
      summary.records.push({ recordId: row.record_id, status: 'awaiting-provider' });
      continue;
    }
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
      if (row.action === 'pay_month_correction' && !attachments.some((attachment) => attachment.field_name === 'attachment_record')) {
        throw new Error('Queued pay-month correction is missing the dated JSON record attachment');
      }
      const response = await (options.fetchImpl || fetch)(endpoint, {
        method: 'POST',
        body: dispatchForm(row, attachments),
        headers: { Accept: 'application/json' }
      });
      const responseText = await response.text();
      let body = null;
      try { body = responseText ? JSON.parse(responseText) : null; } catch (_) {}
      if (response.status === 429) {
        throw Object.assign(new Error('FormSubmit rate-limited the correction (429)'), {
          rateLimitedUntil: rateLimitRetryAt(timestamp, response.headers?.get?.('Retry-After'))
        });
      }
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
      const nextAttempt = error?.rateLimitedUntil || retryAt(timestamp, attempts);
      await env.DB.prepare(`UPDATE dispatch_queue SET status = 'failed', updated_at = ?, next_attempt_at = ?, last_error = ? WHERE record_id = ?`).bind(timestamp, nextAttempt, message, row.record_id).run();
      await env.DB.prepare("UPDATE records SET status = 'Delivery failed', issue = ?, updated_at = ? WHERE record_id = ?").bind(message, timestamp, row.record_id).run();
      summary.failed += 1;
      summary.records.push({ recordId: row.record_id, status: 'failed', error: message });
      if (error?.rateLimitedUntil) {
        summary.status = 'rate-limited';
        summary.retryAt = nextAttempt;
        summary.deferred = 0;
        for (const remaining of rows.slice(index + 1)) {
          const delayed = await env.DB.prepare("UPDATE dispatch_queue SET updated_at = ?, next_attempt_at = ? WHERE record_id = ? AND status IN ('queued', 'failed')")
            .bind(timestamp, nextAttempt, remaining.record_id).run();
          if (Number(delayed?.meta?.changes || 0) > 0) summary.deferred += 1;
        }
        break;
      }
    }
  }
  return summary;
}

async function adminDispatchQueued(env, identity, options = {}) {
  if (!identity?.isAdmin) throw Object.assign(new Error('Correction replay is restricted to Accounts'), { status: 403 });
  return dispatchQueued(env, {
    dryRun: options.dryRun === true,
    now: options.now,
    fetchImpl: options.fetchImpl
  });
}

async function adminQueueStatus(env, identity) {
  if (!identity?.isAdmin) throw Object.assign(new Error('Correction queue status is restricted to Accounts'), { status: 403 });
  const result = await env.DB.prepare('SELECT q.record_id, q.status, q.attempts, q.queued_at, q.last_sent_at AS sent_at, q.updated_at, q.last_error AS error, r.employee_name, r.owner_upn, r.record_date, r.payload_json FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id WHERE r.status <> \'Deleted\' ORDER BY q.updated_at DESC LIMIT 200').all();
  const rows = result.results || [];
  const counts = { queued: 0, sending: 0, failed: 0, sent: 0, skipped: 0 };
  const records = rows.map((row) => {
    const state = text(row.status, 'unknown', 40).toLowerCase();
    if (Object.hasOwn(counts, state)) counts[state] += 1;
    const payload = payloadObject(row);
    const dates = Array.isArray(payload.rows) ? payload.rows.map((entry) => text(entry?.date, '', 10)).filter(Boolean) : [];
    if (!dates.length && Array.isArray(payload.deletedDays)) dates.push(...payload.deletedDays.map((date) => text(date, '', 10)).filter(Boolean));
    if (!dates.length && row.record_date) dates.push(text(row.record_date, '', 10));
    return {
      recordId: text(row.record_id, '', MAX_RECORD_ID),
      employeeName: text(row.employee_name || row.owner_upn, 'Timesheet correction', 240),
      date: dates.join(', '),
      status: state,
      attempts: Number(row.attempts || 0),
      queuedAt: text(row.queued_at, '', 80),
      sentAt: text(row.sent_at, '', 80),
      updatedAt: text(row.updated_at, '', 80),
      error: text(row.error, '', 1000)
    };
  });
  const endpointConfigured = Boolean(dispatchEndpoint(env));
  return {
    providerStatus: !endpointConfigured ? 'not-configured' : (env.PAY_MONTH_REPLAY_READY === 'true' ? 'ready' : 'awaiting-workbook-route'),
    counts,
    records,
    truncated: rows.length === 200
  };
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

async function refreshXeroAccessToken(env, connection, fetchImpl = fetch) {
  const settings = xeroSettings(env);
  if (!settings.configured) throw Object.assign(new Error('Xero is not configured on the portal service'), { status: 503 });
  const refreshToken = await decryptXeroSecret(connection.refresh_token_ciphertext, connection.refresh_token_iv, settings);
  const response = await fetchImpl(settings.tokenUrl, {
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

async function listXeroInvoices(env, tenantId = '', options = {}) {
  const settings = xeroSettings(env);
  const connection = await selectXeroConnection(env, tenantId);
  const token = await refreshXeroAccessToken(env, connection);
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 100);
  const page = Math.min(Math.max(Number(options.page || 1), 1), 1000);
  const status = text(options.status, '', 40);
  const params = new URLSearchParams({ page: String(page), pageSize: String(limit) });
  if (status) params.set('where', `Status=="${status.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const endpoint = `${settings.apiUrl}/api.xro/2.0/Invoices?${params.toString()}`;
  const response = await fetch(endpoint, { headers: xeroApiHeaders(token.accessToken, connection.tenant_id) });
  const responseText = await response.text();
  let body = null;
  try { body = responseText ? JSON.parse(responseText) : null; } catch (_) {}
  if (!response.ok) throw Object.assign(new Error(xeroErrorMessage(body, `Xero invoice list failed (${response.status})`)), { status: 502 });
  const invoices = Array.isArray(body?.Invoices) ? body.Invoices : [];
  return {
    tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
    invoices: invoices.slice(0, limit).map(xeroInvoiceProjection),
    page,
    page_size: limit,
    refreshed_at: now()
  };
}

async function listXeroInvoicesEndpoint(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  return json(await listXeroInvoices(env, url.searchParams.get('tenantId') || url.searchParams.get('tenant_id') || '', {
    limit: url.searchParams.get('limit') || 50,
    page: url.searchParams.get('page') || 1,
    status: url.searchParams.get('status') || ''
  }), 200, origin || '');
}

function xeroInvoiceApiBase(settings) {
  return `${settings.apiUrl}/api.xro/2.0`;
}

async function xeroAccountingRequest(env, connection, path, options = {}) {
  const settings = xeroSettings(env);
  const token = await refreshXeroAccessToken(env, connection, options.fetchImpl || fetch);
  const response = await (options.fetchImpl || fetch)(`${xeroInvoiceApiBase(settings)}${path}`, {
    method: options.method || 'GET',
    headers: { ...xeroApiHeaders(token.accessToken, connection.tenant_id), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch (_) {}
  const invoice = body?.Invoices?.[0];
  const validation = Array.isArray(invoice?.ValidationErrors) ? invoice.ValidationErrors.map((item) => text(item?.Message, '', 250)).filter(Boolean).join('; ') : '';
  if (!response.ok || validation || body?.Status === 'ERROR') {
    throw Object.assign(new Error(xeroErrorMessage(body, validation || `Xero request failed (${response.status})`)), { status: response.status === 401 ? 502 : 422 });
  }
  return body;
}

async function getXeroInvoice(env, tenantId, invoiceId, options = {}) {
  const connection = await selectXeroConnection(env, tenantId);
  const body = await xeroAccountingRequest(env, connection, `/Invoices/${encodeURIComponent(invoiceId)}`, options);
  const invoice = body?.Invoices?.[0];
  if (!invoice?.InvoiceID) throw Object.assign(new Error('Invoice not found in the selected Xero organisation'), { status: 404 });
  return { connection, invoice };
}

async function xeroInvoiceRecords(env, identity, origin) {
  requireXeroAdmin(identity);
  const result = await env.DB.prepare(`SELECT record_id, kind, status, employee_name, record_date, payload_json
    FROM records WHERE kind IN ('estimates', 'job-cards') AND status <> 'Deleted'
    ORDER BY updated_at DESC LIMIT 500`).all();
  return json({ records: (result.results || []).map((row) => {
    const payload = payloadObject(row);
    return {
      record_id: text(row.record_id, '', MAX_RECORD_ID),
      kind: row.kind,
      title: text(payload.estimateNumber || payload.number || payload.jobReference || payload.reference || row.record_id, '', 160),
      customer: text(payload.company || payload.client || payload.customerName, '', 240),
      date: text(row.record_date, '', 10),
      total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : null
    };
  }) }, 200, origin || '');
}

async function xeroInvoiceDetailEndpoint(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const result = await getXeroInvoice(env, url.searchParams.get('tenantId') || '', invoiceId);
  // Keep the link lookup independent from the records projection. Older
  // installations can have the link table populated before every records
  // column is present, and a failed join would make the whole invoice detail
  // panel unavailable. The small follow-up lookup is bounded by the number of
  // links on this invoice and preserves the same enriched response shape.
  const links = await env.DB.prepare(`SELECT record_id, record_kind, linked_by_upn, linked_at
    FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ? ORDER BY linked_at DESC`).bind(result.connection.tenant_id, invoiceId).all();
  const linkedRecords = new Map();
  for (const link of links.results || []) {
    const record = await env.DB.prepare(`SELECT status AS record_status, record_date, payload_json
      FROM records WHERE record_id = ?`).bind(link.record_id).first();
    linkedRecords.set(link.record_id, record || {});
  }
  const audit = await env.DB.prepare(`SELECT action, before_status, after_status, actor_upn, occurred_at FROM xero_invoice_audit
    WHERE tenant_id = ? AND invoice_id = ? ORDER BY occurred_at DESC LIMIT 20`).bind(result.connection.tenant_id, invoiceId).all();
  const invoice = result.invoice;
  // Correlate the invoice against the canonical estimate index as well as
  // explicit links. The index is deliberately best-effort here so an older
  // deployment without migration 0007 can still open invoice details.
  let estimateCorrelation = { matches: [], candidates: [], explanation: 'Estimate index unavailable' };
  let estimateRows = [];
  try {
    estimateRows = await listEstimateIndex(env, identity, { limit: 500 });
    estimateCorrelation = correlateEstimateRecords(estimateRows, xeroInvoiceProjection(invoice), []);
  } catch (_) {}
  const indexedById = new Map(estimateRows.map((row) => [row.canonical_id, row]));
  const relatedEstimates = estimateCorrelation.matches.map((match) => {
    const row = indexedById.get(match.canonical_id) || {};
    return {
      canonical_id: text(row.canonical_id, '', 200),
      estimate_number: text(row.estimate_number, '', 160),
      client: text(row.client, '', 500),
      estimate_date: text(row.estimate_date, '', 80),
      reference: text(row.reference, '', 500),
      source: text(row.source, '', 40),
      correlation_rule: text(match.rule, '', 80),
      outlook_url: httpUrl(row.outlook_url, 2000),
      sharepoint_url: httpUrl(row.sharepoint_url, 2000),
      attachment_url: httpUrl(row.attachment_url, 2000),
      history_url: row.canonical_id ? `../tools/estimates.html?record=${encodeURIComponent(row.canonical_id)}` : ''
    };
  });
  const emailThreads = estimateRows
    .filter((row) => estimateCorrelation.matches.some((match) => match.canonical_id === row.canonical_id) || estimateCorrelation.candidates.some((candidate) => candidate.canonical_id === row.canonical_id))
    .map((row) => ({
      canonical_id: text(row.canonical_id, '', 200),
      subject: text(row.estimate_number || row.reference || 'Estimate email', '', 255),
      message_id: text(row.outlook_message_id, '', 255),
      outlook_url: httpUrl(row.outlook_url, 2000),
      attachment_url: httpUrl(row.attachment_url, 2000),
      match_status: estimateCorrelation.matches.some((match) => match.canonical_id === row.canonical_id) ? 'matched' : 'candidate'
    }));
  const relatedJobCards = (links.results || []).filter((link) => link.record_kind === 'job-cards').map((link) => ({
    record_id: text(link.record_id, '', MAX_RECORD_ID),
    linked_by_upn: text(link.linked_by_upn, '', 320),
    linked_at: text(link.linked_at, '', 80),
    history_url: `../jobs/?record=${encodeURIComponent(link.record_id)}`
  }));
  return json({
    invoice: xeroInvoiceProjection(invoice),
    line_items: (invoice.LineItems || []).map((line) => ({ description: text(line.Description, '', 4000), quantity: Number(line.Quantity) || 0, unit_amount: Number(line.UnitAmount) || 0, account_code: text(line.AccountCode, '', 40), tax_type: text(line.TaxType, '', 80) })),
    contact_id: text(invoice.Contact?.ContactID, '', 100),
    reference: text(invoice.Reference, '', 255),
    line_amount_types: text(invoice.LineAmountTypes, 'Exclusive', 20),
    links: (links.results || []).map((link) => {
      const record = linkedRecords.get(link.record_id) || {};
      const payload = payloadObject(record);
      const kind = link.record_kind === 'estimates' ? 'estimate' : 'job-card';
      return {
        record_id: text(link.record_id, '', MAX_RECORD_ID),
        record_kind: link.record_kind,
        record_title: text(payload.estimateNumber || payload.number || payload.jobReference || payload.reference || link.record_id, link.record_id, 255),
        customer: text(payload.company || payload.client || payload.customerName || payload.client_company || payload.clientCompany, '', 240),
        record_date: text(record.record_date || payload.date || payload.estimateDate || payload.estimate_date || payload.plannedDate || payload.planned_date, '', 40),
        record_status: text(record.record_status, '', 80),
        email_url: text(payload.jobEmailUrl || payload.job_email_url || payload.emailUrl || payload.email_url, '', 2000),
        email_message_id: text(payload.jobEmailMessageId || payload.job_email_message_id || payload.emailMessageId || payload.email_message_id, '', 255),
        history_url: kind === 'estimate' ? `../tools/estimates.html?record=${encodeURIComponent(link.record_id)}` : `../jobs/?record=${encodeURIComponent(link.record_id)}`,
        linked_by_upn: text(link.linked_by_upn, '', 320),
        linked_at: text(link.linked_at, '', 80)
      };
    }),
    related_estimates: relatedEstimates,
    related_job_cards: relatedJobCards,
    email_threads: emailThreads,
    correlation: estimateCorrelation,
    audit: audit.results || [],
    policy: xeroInvoiceMutationPolicy(invoice)
  }, 200, origin || '');
}

async function xeroInvoiceLinksEndpoint(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const current = await getXeroInvoice(env, url.searchParams.get('tenantId') || '', invoiceId);
  const links = await env.DB.prepare(`SELECT record_id, record_kind, linked_by_upn, linked_at
    FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ? ORDER BY linked_at DESC`)
    .bind(current.connection.tenant_id, invoiceId).all();
  const audit = await env.DB.prepare(`SELECT action, before_status, after_status, actor_upn, occurred_at
    FROM xero_invoice_audit WHERE tenant_id = ? AND invoice_id = ? ORDER BY occurred_at DESC LIMIT 20`)
    .bind(current.connection.tenant_id, invoiceId).all();
  return json({
    invoice: xeroInvoiceProjection(current.invoice),
    links: links.results || [],
    audit: audit.results || []
  }, 200, origin || '');
}

async function recordInvoiceLinksEndpoint(request, env, identity, origin, kind, recordId) {
  if (!['estimates', 'job-cards'].includes(kind)) return json({ error: 'Invoice links are available for estimates and job cards only' }, 400, origin || '');
  const record = await env.DB.prepare('SELECT record_id, kind, status FROM records WHERE record_id = ?').bind(recordId).first();
  if (!record) return json({ error: 'Record not found' }, 404, origin || '');
  if (record.kind !== kind) return json({ error: 'Record type does not match the requested link type' }, 400, origin || '');
  if (!canAccessRecord(identity, record)) throw Object.assign(new Error('You are not allowed to view this record'), { status: 403 });
  const linked = await env.DB.prepare(`SELECT tenant_id, invoice_id, record_kind, linked_by_upn, linked_at
    FROM xero_invoice_links WHERE record_id = ? AND record_kind = ? ORDER BY linked_at DESC`)
    .bind(recordId, kind).all();
  const invoices = [];
  for (const link of linked.results || []) {
    try {
      const current = await getXeroInvoice(env, link.tenant_id, link.invoice_id);
      invoices.push({ ...xeroInvoiceProjection(current.invoice), linked_by_upn: link.linked_by_upn, linked_at: link.linked_at });
    } catch (_) {
      invoices.push({ invoice_id: link.invoice_id, status: 'UNAVAILABLE', display_status: 'Unavailable', linked_by_upn: link.linked_by_upn, linked_at: link.linked_at });
    }
  }
  return json({ invoices, links: linked.results || [] }, 200, origin || '');
}

async function xeroSetupDataEndpoint(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const connection = await selectXeroConnection(env, url.searchParams.get('tenantId') || '');
  const settings = xeroSettings(env);
  const contacts = await xeroAccountingRequest(env, connection, '/Contacts?page=1', {});
  const accountsConnection = await selectXeroConnection(env, connection.tenant_id);
  const accounts = await xeroAccountingRequest(env, accountsConnection, '/Accounts', {});
  const taxConnection = await selectXeroConnection(env, connection.tenant_id);
  const taxRates = await xeroAccountingRequest(env, taxConnection, '/TaxRates', {});
  return json({
    contacts: (contacts?.Contacts || []).filter((item) => item.ContactID && item.IsCustomer !== false).map((item) => ({ id: text(item.ContactID, '', 100), name: text(item.Name, '', 500), email: text(item.EmailAddress, '', 320) })),
    accounts: (accounts?.Accounts || []).filter((item) => item.Code && item.Status !== 'ARCHIVED').map((item) => ({ code: text(item.Code, '', 40), name: text(item.Name, '', 500), type: text(item.Type, '', 80), status: text(item.Status, '', 40) })),
    tax_rates: (taxRates?.TaxRates || []).filter((item) => item.TaxType && item.Status !== 'ARCHIVED').map((item) => ({ type: text(item.TaxType, '', 80), name: text(item.Name, '', 160), rate: Number(item.EffectiveRate) || 0 })),
    tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
    api_base: `${settings.apiUrl}/api.xro/2.0`
  }, 200, origin || '');
}

async function validateXeroRecordLinks(env, recordIds) {
  const ids = [...new Set((Array.isArray(recordIds) ? recordIds : []).map((id) => text(id, '', MAX_RECORD_ID)).filter(Boolean))];
  if (ids.length > 20) throw Object.assign(new Error('An invoice can link to at most 20 GMT records'), { status: 400 });
  const records = [];
  for (const id of ids) {
    const row = await env.DB.prepare('SELECT record_id, kind, status FROM records WHERE record_id = ?').bind(id).first();
    if (!row || row.status === 'Deleted' || !['estimates', 'job-cards'].includes(row.kind)) throw Object.assign(new Error('Choose an active estimate or job card to link'), { status: 400 });
    records.push(row);
  }
  return records;
}

async function writeXeroInvoiceAudit(env, connection, invoiceId, action, beforeStatus, afterStatus, identity) {
  await env.DB.prepare(`INSERT INTO xero_invoice_audit (audit_id, tenant_id, invoice_id, action, before_status, after_status, actor_upn, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(randomBase64Url(18), connection.tenant_id, invoiceId, action, beforeStatus || '', afterStatus || '', identity.upn, now()).run();
}

async function storeXeroInvoiceLinks(env, connection, invoiceId, records, identity) {
  for (const record of records) {
    await env.DB.prepare(`INSERT OR IGNORE INTO xero_invoice_links (tenant_id, invoice_id, record_id, record_kind, linked_by_upn, linked_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(connection.tenant_id, invoiceId, record.record_id, record.kind, identity.upn, now()).run();
  }
}

async function createXeroInvoice(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const records = await validateXeroRecordLinks(env, body.recordIds || body.record_ids || []);
  const invoiceInput = xeroInvoicePayload(body.invoice || body);
  const connection = await selectXeroConnection(env, body.tenantId || body.tenant_id || '');
  const result = await xeroAccountingRequest(env, connection, '/Invoices', { method: 'POST', body: { Invoices: [invoiceInput] } });
  const invoice = result?.Invoices?.[0];
  if (!invoice?.InvoiceID) throw Object.assign(new Error('Xero did not return the created invoice'), { status: 502 });
  await storeXeroInvoiceLinks(env, connection, invoice.InvoiceID, records, identity);
  await writeXeroInvoiceAudit(env, connection, invoice.InvoiceID, 'created', '', invoice.Status || 'DRAFT', identity);
  return json({ ok: true, invoice: xeroInvoiceProjection(invoice) }, 201, origin || '');
}

async function updateXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const tenantId = body.tenantId || body.tenant_id || new URL(request.url).searchParams.get('tenantId') || '';
  const current = await getXeroInvoice(env, tenantId, invoiceId);
  const policy = xeroInvoiceMutationPolicy(current.invoice);
  if (!policy.canEdit) return json({ error: 'Only unpaid draft invoices can be edited here. Change authorised invoices in Xero.' }, 409, origin || '');
  const invoiceInput = xeroInvoicePayload(body.invoice || body, invoiceId);
  const records = await validateXeroRecordLinks(env, body.recordIds || body.record_ids || []);
  const result = await xeroAccountingRequest(env, current.connection, '/Invoices', { method: 'POST', body: { Invoices: [invoiceInput] } });
  const invoice = result?.Invoices?.[0];
  if (!invoice?.InvoiceID) throw Object.assign(new Error('Xero did not return the updated invoice'), { status: 502 });
  await env.DB.prepare('DELETE FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ?').bind(current.connection.tenant_id, invoiceId).run();
  await storeXeroInvoiceLinks(env, current.connection, invoiceId, records, identity);
  await writeXeroInvoiceAudit(env, current.connection, invoiceId, 'edited', current.invoice.Status || '', invoice.Status || '', identity);
  return json({ ok: true, invoice: xeroInvoiceProjection(invoice) }, 200, origin || '');
}

async function sendXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const current = await getXeroInvoice(env, body.tenantId || body.tenant_id || '', invoiceId);
  if (!xeroInvoiceMutationPolicy(current.invoice).canSend) return json({ error: 'Only unpaid draft or authorised invoices that have not already been sent can be emailed from here' }, 409, origin || '');
  let beforeStatus = current.invoice.Status || '';
  if (beforeStatus !== 'AUTHORISED') {
    const approved = await xeroAccountingRequest(env, current.connection, '/Invoices', { method: 'POST', body: { Invoices: [{ InvoiceID: invoiceId, Status: 'AUTHORISED' }] } });
    const approvedInvoice = approved?.Invoices?.[0];
    if (!approvedInvoice || approvedInvoice.Status !== 'AUTHORISED') throw Object.assign(new Error('Xero did not authorise this invoice; check its validation errors in Xero'), { status: 422 });
    await writeXeroInvoiceAudit(env, current.connection, invoiceId, 'approved-for-send', beforeStatus, approvedInvoice.Status, identity);
    beforeStatus = approvedInvoice.Status;
  }
  const sendConnection = await selectXeroConnection(env, current.connection.tenant_id);
  const result = await xeroAccountingRequest(env, sendConnection, `/Invoices/${encodeURIComponent(invoiceId)}/Email`, { method: 'POST', body: {} });
  const refreshed = await getXeroInvoice(env, sendConnection.tenant_id, invoiceId);
  await writeXeroInvoiceAudit(env, sendConnection, invoiceId, 'sent', beforeStatus, refreshed.invoice.Status || '', identity);
  return json({ ok: true, result, invoice: xeroInvoiceProjection(refreshed.invoice) }, 200, origin || '');
}

async function deleteXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const current = await getXeroInvoice(env, body.tenantId || body.tenant_id || '', invoiceId);
  const policy = xeroInvoiceMutationPolicy(current.invoice);
  if (!policy.canDelete) return json({ error: 'Paid, part-paid, voided, or deleted invoices cannot be removed here. Correct those in Xero.' }, 409, origin || '');
  const status = policy.deleteAction === 'void' ? 'VOIDED' : 'DELETED';
  const result = await xeroAccountingRequest(env, current.connection, `/Invoices/${encodeURIComponent(invoiceId)}`, { method: 'POST', body: { InvoiceID: invoiceId, Status: status } });
  const invoice = result?.Invoices?.[0] || { ...current.invoice, Status: status };
  await writeXeroInvoiceAudit(env, current.connection, invoiceId, status === 'VOIDED' ? 'voided' : 'deleted', current.invoice.Status || '', status, identity);
  return json({ ok: true, invoice: xeroInvoiceProjection(invoice) }, 200, origin || '');
}

async function linkXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const current = await getXeroInvoice(env, body.tenantId || body.tenant_id || '', invoiceId);
  const records = await validateXeroRecordLinks(env, body.recordIds || body.record_ids || (body.recordId ? [body.recordId] : []));
  await env.DB.prepare('DELETE FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ?').bind(current.connection.tenant_id, invoiceId).run();
  await storeXeroInvoiceLinks(env, current.connection, invoiceId, records, identity);
  await writeXeroInvoiceAudit(env, current.connection, invoiceId, 'links-updated', current.invoice.Status || '', current.invoice.Status || '', identity);
  return json({ ok: true, linked_count: records.length }, 200, origin || '');
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
  return json({ ok: true, record: projectRow(updated, true, env), invoice }, 200, origin || '');
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
  const ownRecords = "(r.owner_oid = ? OR (r.kind = 'timesheets' AND r.action = 'pay_month_correction' AND lower(r.owner_upn) = ?))";
  const sharedRecordKinds = "r.kind IN ('estimates', 'job-cards', 'conversations', 'email-conversations')";
  const sql = identity.isAdmin
    ? (kind ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`)
    : operationsAdminAcrossKinds
      ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind NOT IN ('timesheets', 'clock') OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`
    : viewAll
      ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`
    : jobCardAdminAcrossKinds
        ? `${projection} WHERE r.status <> 'Deleted' AND (${ownRecords} OR ${sharedRecordKinds}) ORDER BY r.updated_at DESC LIMIT ?`
        : (kind
          ? (viewAll ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE ${ownRecords} AND r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`)
          : `${projection} WHERE (${ownRecords} OR ${sharedRecordKinds}) AND r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`);
  const bindings = identity.isAdmin
    ? (kind ? [kind, limit] : [limit])
    : operationsAdminAcrossKinds
      ? [identity.oid, identity.upn, limit]
    : viewAll
      ? [kind || 'job-cards', limit]
      : jobCardAdminAcrossKinds
        ? [identity.oid, identity.upn, limit]
        : (kind ? (viewAll ? [kind, limit] : [identity.oid, identity.upn, kind, limit]) : [identity.oid, identity.upn, limit]);
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  const includeSynthetic = identity.isAdmin && url.searchParams.get('includeSynthetic') === '1';
  const projectedLocalRecords = (result.results || []).map((row) => projectRow(row, true, env));
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
            const visibleUpstreamRecords = includeSynthetic ? upstreamRecords : upstreamRecords.filter((row) => !row.synthetic);
            upstreamRecordCount = visibleUpstreamRecords.length;
            // Merge corrected copies that share a source ID. A later partial
            // correction must not erase valid days from an earlier copy.
            const merged = deduplicateProviderRecords([...records, ...visibleUpstreamRecords])
              .sort((left, right) => String(right.updated_at || right.submitted_at || '').localeCompare(String(left.updated_at || left.submitted_at || '')));
            const fingerprints = new Set();
            records = removeStaleAbsenceRows(merged.filter((row) => {
              const fingerprint = historyRecordFingerprint(row);
              if (!fingerprint || fingerprints.has(fingerprint)) return false;
              fingerprints.add(fingerprint);
              return true;
            }));
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
      editable_pay_months: editablePayCycleKeys(),
      visible_scope: identity.isAdmin ? 'all employee submissions' : (identity.isOperationsAdmin ? 'all non-timesheet submissions; this account timesheets and clock records' : (identity.isJobCardAdmin ? 'all job cards; this account submissions for other categories' : 'this account submissions')),
      completion
    }
  };
}

async function handle(request, env, ctx) {
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
  if (url.pathname === '/api/archive/sync/estimates' && request.method === 'POST') {
    return estimateArchiveIngestEndpoint(request, env, origin || '');
  }
  const identity = await authenticate(request, env);
  if (!env.DB) throw Object.assign(new Error('Protected storage is not configured'), { status: 503 });

  if (url.pathname === '/api/xero/connect' && request.method === 'POST') return startXeroConnection(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/status' && request.method === 'GET') return xeroStatus(env, identity, origin || '');
  if (url.pathname === '/api/estimates/index' && request.method === 'GET') return estimateIndexListEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/estimates/index' && request.method === 'POST') return estimateIndexUpsertEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/setup-data' && request.method === 'GET') return xeroSetupDataEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/records' && request.method === 'GET') return xeroInvoiceRecords(env, identity, origin || '');
  if (url.pathname === '/api/xero/invoices' && request.method === 'GET') return listXeroInvoicesEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/invoices' && request.method === 'POST') return createXeroInvoice(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/invoices/lookup' && request.method === 'POST') return lookupXeroInvoiceEndpoint(request, env, identity, origin || '');
  const xeroInvoiceLinksMatch = url.pathname.match(/^\/api\/xero\/invoices\/([^/]+)\/links$/);
  if (xeroInvoiceLinksMatch && request.method === 'GET') return xeroInvoiceLinksEndpoint(request, env, identity, origin || '', decodeURIComponent(xeroInvoiceLinksMatch[1]));
  const xeroInvoiceActionMatch = url.pathname.match(/^\/api\/xero\/invoices\/([^/]+)\/(send|delete|links)$/);
  if (xeroInvoiceActionMatch && request.method === 'POST') {
    const invoiceId = decodeURIComponent(xeroInvoiceActionMatch[1]);
    if (xeroInvoiceActionMatch[2] === 'send') return sendXeroInvoice(request, env, identity, origin || '', invoiceId);
    if (xeroInvoiceActionMatch[2] === 'delete') return deleteXeroInvoice(request, env, identity, origin || '', invoiceId);
    return linkXeroInvoice(request, env, identity, origin || '', invoiceId);
  }
  const xeroInvoiceMatch = url.pathname.match(/^\/api\/xero\/invoices\/([^/]+)$/);
  if (xeroInvoiceMatch && request.method === 'GET') return xeroInvoiceDetailEndpoint(request, env, identity, origin || '', decodeURIComponent(xeroInvoiceMatch[1]));
  if (xeroInvoiceMatch && request.method === 'PATCH') return updateXeroInvoice(request, env, identity, origin || '', decodeURIComponent(xeroInvoiceMatch[1]));
  const recordInvoiceLinksMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/([^/]+)\/invoices$/);
  if (recordInvoiceLinksMatch && request.method === 'GET') return recordInvoiceLinksEndpoint(request, env, identity, origin || '', decodeURIComponent(recordInvoiceLinksMatch[1]), decodeURIComponent(recordInvoiceLinksMatch[2]));
  const xeroJobSyncMatch = url.pathname.match(/^\/api\/xero\/job-cards\/([^/]+)\/sync$/);
  if (xeroJobSyncMatch && request.method === 'POST') return syncXeroJobCard(request, env, identity, origin || '', decodeURIComponent(xeroJobSyncMatch[1]));

  if (url.pathname === '/api/profile' && request.method === 'GET') {
    return json({ profile: await getProfileSettings(env, identity) }, 200, origin || '');
  }
  if (url.pathname === '/api/profile' && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    return json({ ok: true, profile: await saveProfileSettings(env, identity, body) }, 200, origin || '');
  }

  if (url.pathname === '/api/admin/dispatch-queue' && request.method === 'POST') {
    if (!identity.isAdmin) throw Object.assign(new Error('Correction replay is restricted to Accounts'), { status: 403 });
    const body = await readJson(request);
    return json(await adminDispatchQueued(env, identity, { dryRun: body.dryRun === true }), 200, origin || '');
  }
  if (url.pathname === '/api/admin/dispatch-queue' && request.method === 'GET') {
    return json(await adminQueueStatus(env, identity), 200, origin || '');
  }

  if (url.pathname === '/api/history' && request.method === 'GET') {
    return json(await listRecords(request, env, identity), 200, origin || '');
  }

  if (url.pathname === '/api/records' && request.method === 'POST') {
    const body = await readJson(request);
    if (body.action === 'pay_month_correction') validatePayMonthCorrection(body);
    const recordId = text(body.recordId || body.sourceRecordId || body.source_record_id || body.gmt_record_id, '', MAX_RECORD_ID);
    const existing = recordId ? await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first() : null;
    if (existing && existing.status === 'Deleted') throw Object.assign(new Error('This record has been deleted'), { status: 409 });
    if (existing && !canAccessRecord(identity, existing)) throw Object.assign(new Error('This record belongs to another GMT account'), { status: 403 });
    if (existing && existing.action === 'pay_month_correction' && body.action !== 'pay_month_correction') throw Object.assign(new Error('A pay-month correction cannot change record type'), { status: 400 });
    if (existing && existing.kind === 'timesheets' && !isCurrentPayMonthRecord(existing)) throw Object.assign(new Error('Only the current and previous pay months may be edited.'), { status: 409 });
    const input = normaliseInput(body, existing && (identity.isAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing, env);
    const result = await saveRecord(env, input, identity, existing);
    return json({ ok: true, record_id: input.recordId, ...result }, result.created ? 201 : 200, origin || '');
  }

  const attachmentMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments$/);
  if (attachmentMatch && request.method === 'POST') {
    const recordId = decodeURIComponent(attachmentMatch[1]);
    const existing = await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
    if (!existing) return json({ error: 'Record not found' }, 404, origin || '');
    if (request.method === 'GET' ? !canViewRecord(identity, existing) : !canAccessRecord(identity, existing)) return json({ error: 'Record access is not permitted' }, 403, origin || '');
    if (existing.status === 'Deleted') return json({ error: 'Record has been deleted' }, 410, origin || '');
    if (existing.kind !== 'timesheets') return json({ error: 'Only timesheet corrections can be queued' }, 400, origin || '');
    const body = await readJson(request);
    const result = await queueRecordAttachments(env, existing, body);
    if (result.skipped) {
      const timestamp = now();
      await env.DB.prepare("UPDATE records SET status = 'Test - not sent', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, recordId).run();
      return json({ ok: true, record_id: recordId, ...result }, 200, origin || '');
    }
    // Saving a correction should start delivery automatically. Keep this
    // scoped to the just-saved record; provider-gated pay-month corrections
    // remain queued until the Microsoft 365 route is certified.
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(dispatchQueued(env, { limit: 1, recordId }).catch(() => null));
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
    if (request.method === 'GET') return json({ record: projectRow(existing, true, env), payload: payloadObject(existing) }, 200, origin || '');
    if (request.method === 'PATCH') {
      if (existing.kind === 'timesheets' && !isCurrentPayMonthRecord(existing)) return json({ error: 'Only the current and previous pay months may be edited.' }, 409, origin || '');
      const body = await readJson(request);
      if (existing.action === 'pay_month_correction' && body.action !== 'pay_month_correction') return json({ error: 'A pay-month correction cannot change record type' }, 400, origin || '');
      if (existing.action === 'pay_month_correction') validatePayMonthCorrection(body);
      const input = normaliseInput({ ...body, recordId }, (identity.isAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing, env);
      const result = await saveRecord(env, input, identity, existing);
      return json({ ok: true, record_id: input.recordId, ...result }, 200, origin || '');
    }
    if (request.method === 'DELETE') {
      // The calendar passes ?day for a single-day action. The record-level
      // soft delete below must never turn that request into a weekly delete.
      if (url.searchParams.has('day') && (existing.kind === 'timesheets' || existing.kind === 'clock')) {
        return json({ error: 'Single-day deletion is not available from the calendar yet. Remove the day in the pay-month sheet editor.' }, 409, origin || '');
      }
      const result = await deleteRecord(env, existing, identity);
      return json({ ok: true, record_id: recordId, ...result }, 200, origin || '');
    }
  }
  return json({ error: 'Route not found' }, 404, origin || '');
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
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
  adminDispatchQueued,
  adminQueueStatus,
  normaliseInput,
  validateNoFutureWork,
  validatePayMonthCorrection,
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
  historyRecordFingerprint,
  listRecords,
  projectRow,
  canViewAllRecords,
  canViewRecord,
  canAccessRecord,
  tokenIdentity,
  profileView,
  getProfileSettings,
  saveProfileSettings,
  xeroSettings,
  xeroInvoiceProjection,
  xeroInvoicePayload,
  xeroInvoiceDeliveryStatus,
  xeroInvoicePaymentStatus,
  xeroInvoiceMutationPolicy,
  xeroAccountingRequest,
  listXeroInvoices,
  canonicalEstimateInput,
  correlateEstimateRecords,
  upsertEstimateIndex,
  listEstimateIndex,
  encryptXeroSecret,
  decryptXeroSecret
};
