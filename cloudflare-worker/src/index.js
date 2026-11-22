import payPeriods from '../../pay-periods.js';
import payMonthWorkbook from '../../portal/pay-month-workbook.js';
import { assertNoHistoricalOwnerConflict, resolveImportOwnerFromDatabase, resolveRosterUpn, normalizeImportCandidate, timesheetRecordMayBelongTo } from './submission-import-policy.js';
import { syntheticQueueCapability } from './synthetic-queue-capability.js';
import { syntheticFixture } from './synthetic-portal-fixture.js';
import { fileImportedDocument } from './document-import-storage.js';
import { bindPrivateOriginalProof, createPrivateOriginalIntent, readPrivateOriginalIntent, reservePrivateOriginalCreate } from './private-timesheet-original-store.js';
import { filePrivateTimesheetOriginal, verifyPrivateTimesheetOriginal } from './private-timesheet-originals.js';
import { createPrivateOriginalGraphIo } from './private-timesheet-original-graph.js';
import { getPrivateOriginalReviewSnapshot, recordPrivateOriginalReview, revokePrivateOriginalReview } from './private-timesheet-original-review-store.js';
import { ensurePrivateTimesheetFolder, ensurePrivateTimesheetWorkbook, verifyPrivateTimesheetParent, verifyPinnedInheritedParent, verifyPrivateTimesheetWorkbook } from './private-timesheet-access.js';
import { privateTimesheetWorkbookStore } from './private-timesheet-workbook-store.js';
import { blankPayMonthWorkbookBase64 } from './pay-month-template.js';
import { verifyUploadedBlankWorkbook } from './private-timesheet-template-verification.js';
import { verifyPreparedAttachments } from './timesheet-prepared-attachments.js';
import { saveImportedInvoice, listImportedInvoices } from './submission-import-invoices.js';
import { deduplicateProviderRecords, removeStaleAbsenceRows } from './provider-reconciliation.js';
import { canonicalEstimateInput, createEstimateIndexStore, correlateEstimateRecords } from './estimate-index.js';
import { normalizeEstimateArchiveRecord, queryEstimateArchive, upsertEstimateArchive, upsertEstimateAssociation } from './estimate-archive.js';
import { getJobCardArchiveRecord, getJobCardBatch, jobCardBatchStatus, normalizeJobCardEntry, queryJobCardArchive, reviewJobCardArchive, startJobCardBatch, upsertJobCardArchive, upsertJobCardSourceFile } from './job-card-archive.js';
import { offsiteClockEndpoint } from './offsite-clock.js';
import { completeJobCardAttachmentUpload, expireJobCardAttachmentUploadSession, findCompletedJobCardAttachment, getJobCardAttachment, getJobCardAttachmentUploadSession, listJobCardAttachments, normalizeJobCardAttachmentMetadata, readJobCardAttachmentBytes, reserveJobCardAttachmentUploadSession } from './job-card-attachments.js';

const ALLOWED_KINDS = new Set(['timesheets', 'clock', 'estimates', 'job-cards', 'calendar', 'tasks', 'audit', 'enquiries']);
const MAX_BODY_BYTES = 1_300_000;
// Verified row notes are compared with the protected source in memory and are
// not retained in the receipt. Allow the bounded pay-month source to fit even
// when notes require JSON escaping, while keeping the callback size bounded.
const MAX_TIMESHEET_RECEIPT_BYTES = 1_300_000;
const MAX_RECORD_ID = 180;
const MAX_TEXT = 6000;
const MAX_ATTACHMENT_BYTES = 220_000;
const MAX_ATTACHMENT_TOTAL_BYTES = 700_000;
const MAX_QUEUE_BATCH = 25;
const MAX_PROFILE_NAME = 240;
const MAX_PROFILE_EMAIL = 320;
const ATTACHMENT_FIELDS = new Set(['attachment_record', 'attachment', 'attachment_csv', 'attachment_calendar_sync']);
const SAFE_PAYROLL_ROW_KEYS = new Set(['Absence reason', 'Total hours', 'Total minutes', 'Worked hours', 'Worked minutes', 'Basic hours', 'Basic minutes', 'OT x1.5 hours', 'OT x1.5 minutes', 'OT x2.0 hours', 'OT x2.0 minutes', 'Weighted hours']);
const JWKS_CACHE = new Map();
const SHAREPOINT_TOKEN_CACHE = new Map();
const SHAREPOINT_FOLDER_CACHE = new Set();

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
    'access-control-allow-headers': 'Authorization, X-GMT-Upstream-Authorization, X-GMT-Original-Extension, Content-Type, Accept',
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

export function constantTimeEqual(left, right) {
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
  const adminUpns = new Set([...csvSet(env.ADMIN_UPNS), ...csvSet(env.ADDITIONAL_ADMIN_UPNS)]);
  const adminOids = csvSet(env.ADMIN_OIDS);
  const adminGroups = csvSet(env.ADMIN_GROUP_IDS);
  const timesheetViewerUpns = csvSet(env.TIMESHEET_VIEWER_UPNS);
  const submissionsAdminUpns = csvSet(env.SUBMISSIONS_ADMIN_UPNS);
  const payMonthStartAdminUpns = csvSet(env.PAY_MONTH_START_ADMIN_UPNS);
  const jobCardAdminUpns = csvSet(env.JOB_CARD_ADMIN_UPNS);
  const operationsAdminUpns = csvSet(env.OPERATIONS_ADMIN_UPNS);
  const hrAdminUpns = csvSet(env.HR_ADMIN_UPNS);
  const xeroAdminUpns = csvSet(env.XERO_ADMIN_UPNS);
  const offsiteDutyManagerUpns = csvSet(env.OFFSITE_DUTY_MANAGER_UPNS);
  const groups = Array.isArray(claims.groups) ? claims.groups.map((item) => String(item).toLowerCase()) : [];
  const isAdmin = adminUpns.has(upn) || adminOids.has(oid.toLowerCase()) || groups.some((group) => adminGroups.has(group));
  const isHrAdmin = isAdmin || hrAdminUpns.has(upn);
  const isSubmissionAdmin = submissionsAdminUpns.has(upn);
  return {
    oid,
    upn,
    name: String(claims.name || '').trim(),
    aud: audienceValue(claims.aud),
    tid: tokenTenant,
    isAdmin,
    isHrAdmin,
    isTimesheetViewer: timesheetViewerUpns.has(upn),
    isSubmissionAdmin,
    canReviewOffsite: offsiteDutyManagerUpns.has(upn),
    canManagePayMonthStarts: payMonthStartAdminUpns.has(upn),
    isXeroAdmin: isAdmin || xeroAdminUpns.has(upn),
    isOperationsAdmin: isAdmin || operationsAdminUpns.has(upn),
    isJobCardAdmin: isAdmin || operationsAdminUpns.has(upn) || jobCardAdminUpns.has(upn)
  };
}

function canViewAllRecords(identity, kind = '') {
  const category = canonicalKind(kind);
  if (!identity) return false;
  if (identity.isSubmissionAdmin === true) return true;
  if (category === 'timesheets' || category === 'clock') return identity.isTimesheetViewer === true;
  return Boolean(identity.isAdmin || (category === 'job-cards' && !identity.isHrAdmin) || (identity.isHrAdmin && category === 'calendar') || (identity.isOperationsAdmin && category !== 'timesheets' && category !== 'clock') || (category === 'job-cards' && identity.isJobCardAdmin));
}

function isCorrectionOwner(identity,row) {
  const oid=String(identity?.oid||'').trim().toLowerCase(),upn=String(identity?.upn||'').trim().toLowerCase();
  return Boolean(oid && upn && oid===String(row?.owner_oid||'').trim().toLowerCase() &&
    upn===String(row?.owner_upn||'').trim().toLowerCase());
}

function canAccessRecord(identity, row) {
  if (!identity || !row) return false;
  if (identity.isSubmissionAdmin === true) return true;
  const category = canonicalKind(row.kind);
  const ownRecord = category === 'timesheets' && row.action === 'pay_month_correction'
    ? isCorrectionOwner(identity,row)
    : row.owner_oid === identity.oid;
  if (category === 'timesheets' || category === 'clock') return Boolean(ownRecord || (identity.isAdmin && identity.isTimesheetViewer === true));
  return Boolean(ownRecord || identity.isAdmin || (identity.isOperationsAdmin && category !== 'timesheets' && category !== 'clock') || (category === 'job-cards' && identity.isJobCardAdmin));
}

function recordPayMonthKey(row, payPeriods = defaultPayPeriods()) {
  if (!row) return '';
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : payloadObject(row);
  const declared = text(payload.payMonth || payload.pay_month, '', 7);
  if (row.action === 'pay_month_correction' && /^\d{4}-\d{2}$/.test(declared)) return declared;
  const dates = Array.isArray(payload.rows) ? payload.rows.map((entry) => text(entry?.date, '', 10)).filter(Boolean) : [];
  return payCycleKeyForDate(dates[0] || payload.date || row.record_date || row.start_date || row.end_date, payPeriods) || declared;
}

function isOwnerRecord(identity, row) {
  if (!identity || !row) return false;
  const category = canonicalKind(row.kind);
  // Legacy on-behalf corrections may retain the editor's OID. Hold them for
  // ownership review instead of allowing mutations based on an address alone.
  if (category === 'timesheets' && row.action === 'pay_month_correction') {
    return isCorrectionOwner(identity,row);
  }
  return row.owner_oid === identity.oid
    || text(row.employee_upn || row.employee_email || '', '', 320).toLowerCase() === identity.upn?.toLowerCase();
}

function canEditRecord(identity, row, nowDate = new Date(), payPeriods = defaultPayPeriods()) {
  if (!identity || !row) return false;
  if (identity.isSubmissionAdmin === true) return true;
  const category = canonicalKind(row.kind);
  if (category === 'timesheets' || category === 'clock') {
    const owner = isOwnerRecord(identity, row);
    const currentPayMonth = recordPayMonthKey(row, payPeriods) === payCycleKeyForDate(londonDateKey(nowDate, 'Europe/London'), payPeriods);
    if (owner) return currentPayMonth;
    // Preserve the existing limited Accounts viewer path for other full admins.
    return identity.isAdmin === true && identity.isTimesheetViewer === true
      && isCurrentPayMonthRecord(row, 'Europe/London', nowDate, payPeriods);
  }
  return Boolean(isOwnerRecord(identity, row) || identity.isAdmin
    || (identity.isOperationsAdmin && category !== 'timesheets' && category !== 'clock')
    || (category === 'job-cards' && identity.isJobCardAdmin));
}

function canReadHistoryRecord(identity, row) {
  if (!identity || !row) return false;
  if (identity.isSubmissionAdmin === true) return true;
  const category = canonicalKind(row.kind || row.action);
  const employeeUpn = text(row.employee_upn || row.employee_email || row.employeeEmail || row.owner_upn, '', 320).toLowerCase();
  const employeeName = text(row.employee_name || row.employeeName, '', 240).toLowerCase();
  const ownRecord = employeeUpn
    ? employeeUpn === identity.upn
    : Boolean(identity.name && employeeName && employeeName === identity.name.toLowerCase());
  if (category === 'timesheets' || category === 'clock') return identity.isTimesheetViewer === true || Boolean(employeeUpn && ownRecord);
  if (identity.isAdmin || identity.isOperationsAdmin) return true;
  if (category === 'job-cards' || (identity.isHrAdmin && category === 'calendar')) return true;
  return ownRecord;
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
  const identity = await authenticateToken(bearerToken(request), env);
  if (!env.DB) return identity;
  try {
    const result = await env.DB.prepare('SELECT role FROM portal_access_assignments WHERE owner_oid = ? AND owner_upn = ?').bind(identity.oid, identity.upn).all();
    const roles = new Set((result.results || []).map((row) => String(row.role || '')));
    identity.assignedRoles = Array.from(roles);
    identity.isHrAdmin = identity.isHrAdmin || roles.has('hr');
    identity.isXeroAdmin = identity.isXeroAdmin || roles.has('xero');
    identity.isOperationsAdmin = identity.isOperationsAdmin || roles.has('operations');
    identity.isJobCardAdmin = identity.isJobCardAdmin || roles.has('job-card');
  } catch (_) {
    // Missing migration or temporary D1 failure grants no additional roles.
    identity.assignedRoles = [];
  }
  return identity;
}

async function authenticateFlowToken(request, env, portalIdentity) {
  const token = bearerToken(request, 'X-GMT-Upstream-Authorization');
  if (!token) throw Object.assign(new Error('A signed-in employee Flow Service token is required'), { status: 401 });
  const pieces = token.split('.');
  if (pieces.length !== 3) throw Object.assign(new Error('Invalid Flow Service token'), { status: 401 });
  let header;
  let claims;
  try {
    header = decodeJsonPart(pieces[0]);
    claims = decodeJsonPart(pieces[1]);
  } catch (_) {
    throw Object.assign(new Error('Invalid Flow Service token'), { status: 401 });
  }
  if (header.alg !== 'RS256' || !header.kid) throw Object.assign(new Error('Unsupported Flow Service token'), { status: 401 });
  let validSignature = false;
  try {
    const key = await signingKey(env.ENTRA_TENANT_ID, header.kid);
    validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlDecode(pieces[2]), new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`));
  } catch (_) {
    validSignature = false;
  }
  if (!validSignature) throw Object.assign(new Error('Invalid Flow Service token'), { status: 401 });
  const tenantId = String(env.ENTRA_TENANT_ID || '').trim().toLowerCase();
  const tokenTenant = String(claims.tid || '').trim().toLowerCase();
  if (!tenantId || tokenTenant !== tenantId) throw Object.assign(new Error('Flow Service token is from the wrong tenant'), { status: 403 });
  if (String(claims.aud || '') !== 'https://service.flow.microsoft.com/') throw Object.assign(new Error('Flow Service token has the wrong audience'), { status: 403 });
  const expectedIssuers = new Set([
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`
  ]);
  if (!expectedIssuers.has(String(claims.iss || '').toLowerCase())) throw Object.assign(new Error('Flow Service token issuer is not permitted'), { status: 403 });
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < nowSeconds - 60 || (claims.nbf && Number(claims.nbf) > nowSeconds + 60)) {
    throw Object.assign(new Error('Flow Service token is not currently valid'), { status: 401 });
  }
  if (!claims.oid || String(claims.oid).toLowerCase() !== String(portalIdentity?.oid || '').toLowerCase()) {
    throw Object.assign(new Error('Flow Service token must belong to the signed-in portal user'), { status: 403 });
  }
  return token;
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
const XERO_DEFAULT_RETURN_URL = 'https://gmt-services.co.uk/tools/invoices?xero=connected';
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

function xeroOAuthStateMatches(state, cookieState) {
  return Boolean(state) && (!cookieState || constantTimeEqual(state, cookieState));
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
function defaultPayPeriods() {
  return payPeriods;
}

async function loadPayPeriods(env) {
  const result = await env.DB.prepare('SELECT month_key AS monthKey, start_date AS startDate FROM pay_month_start_settings ORDER BY month_key').all();
  return defaultPayPeriods().createPayPeriods(result.results || []);
}

function londonDateKey(nowDate = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(nowDate);
  const value = (kind) => String(parts.find((part) => part.type === kind)?.value || '');
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function payCycleKeyForDate(value, payPeriods = defaultPayPeriods()) {
  return payPeriods && typeof payPeriods.payMonthKeyForDate === 'function' ? payPeriods.payMonthKeyForDate(value) : '';
}

function payMonthForPayload(payload, fallbackDate, payPeriods = defaultPayPeriods()) {
  const dailyRows = [payload?.rows, payload?.dailyRows, payload?.daily_rows, payload?.gmtDailyRows].find(Array.isArray) || [];
  const firstDailyDate = dailyRows.map((row) => text(row?.date, '', 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()[0];
  return payCycleKeyForDate(firstDailyDate || fallbackDate, payPeriods);
}

function editablePayCycleKeys(nowDate = new Date(), timeZone = 'Europe/London', payPeriods = defaultPayPeriods()) {
  const today = londonDateKey(nowDate, timeZone);
  const current = payCycleKeyForDate(today, payPeriods);
  const previous = payPeriods && typeof payPeriods.previousPayMonthKey === 'function' ? payPeriods.previousPayMonthKey(current) : '';
  return [current, previous].filter(Boolean);
}

function currentPayCycleKeys(nowDate = new Date(), timeZone = 'Europe/London', payPeriods = defaultPayPeriods()) {
  const current = payCycleKeyForDate(londonDateKey(nowDate, timeZone), payPeriods);
  return current ? [current] : [];
}

function isCurrentPayMonthRecord(row, timeZone = 'Europe/London', nowDate = new Date(), payPeriods = defaultPayPeriods()) {
  if (!row) return false;
  const payload = payloadObject(row);
  const declared = text(payload.payMonth || payload.pay_month, '', 7);
  const dates = Array.isArray(payload.rows) ? payload.rows.map((entry) => text(entry?.date, '', 10)).filter(Boolean) : [];
  const dateMonth = payCycleKeyForDate(dates[0] || row.record_date || row.start_date || row.end_date, payPeriods);
  const month = row.action === 'pay_month_correction' && /^\d{4}-\d{2}$/.test(declared) ? declared : (dateMonth || declared);
  return editablePayCycleKeys(nowDate, timeZone, payPeriods).includes(month);
}

function validatePayMonthCorrection(body, nowDate = new Date(), payPeriods = defaultPayPeriods(), identity = null) {
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
  const month = text(payload.payMonth, '', 7);
  const editableMonths = identity?.isSubmissionAdmin === true
    ? [month]
    : (identity?.isAdmin === true && identity?.isTimesheetViewer === true
      ? editablePayCycleKeys(nowDate, 'Europe/London', payPeriods)
      : currentPayCycleKeys(nowDate, 'Europe/London', payPeriods));
  if (!/^\d{4}-\d{2}$/.test(month) || !editableMonths.includes(month)) {
    throw Object.assign(new Error(identity?.isSubmissionAdmin === true ? 'Choose a valid pay month for the record being corrected.' : 'Only the current pay month can be edited.'), { status: 409 });
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const deletedDays = Array.isArray(payload.deletedDays) ? payload.deletedDays : [];
  if (rows.length > 80 || deletedDays.length > 80) throw Object.assign(new Error('Too many pay-month dates'), { status: 400 });
  const seen = new Set();
  [...rows.map((row) => row?.date), ...deletedDays].forEach((date) => {
    const key = text(date, '', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || payCycleKeyForDate(key, payPeriods) !== month) {
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
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(nowDate);
  const value = (type) => String(parts.find((part) => part.type === type)?.value || '');
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  const nowMinutes = Number(value('hour')) * 60 + Number(value('minute'));
  if (kind === 'clock') {
    const actionKey = String(action || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const dailyActions = new Set(['clock_in', 'lunch_start', 'lunch_end', 'clock_out', 'absent', 'full_day']);
    for (const [field, maxLength] of [['location', 240], ['note', 1000]]) {
      const fieldValue = payload[field];
      if (fieldValue !== undefined && fieldValue !== null && typeof fieldValue !== 'string') {
        throw Object.assign(new Error(`Clock ${field} must be text.`), { status: 400 });
      }
      if (String(fieldValue || '').length > maxLength) {
        throw Object.assign(new Error(`Clock ${field} must be ${maxLength} characters or fewer.`), { status: 400 });
      }
    }
    const eventDate = String(payload.date || payload.recordDate || '').slice(0, 10);
    if (dailyActions.has(actionKey)) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
      const date = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (!date || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
        throw Object.assign(new Error('A valid clock date is required.'), { status: 400 });
      }
    }
    if (eventDate > today && actionKey !== 'absent') {
      throw Object.assign(new Error('Future clock and worked-time entries are not permitted.'), { status: 400 });
    }
    if (actionKey === 'absent' || !dailyActions.has(actionKey)) return;

    const minutesFor = (input) => {
      const match = /^(\d{2}):(\d{2})$/.exec(String(input || ''));
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
    };
    const futureTime = (minutes) => eventDate === today && minutes > nowMinutes;
    if (actionKey === 'full_day') {
      const start = minutesFor(payload.dayStart);
      const finishValue = minutesFor(payload.dayFinish);
      const lunchStartValue = minutesFor(payload.lunchStart);
      const lunchEndValue = minutesFor(payload.lunchEnd);
      if (start === null || finishValue === null) {
        throw Object.assign(new Error('Enter valid start and finish times for the full day.'), { status: 400 });
      }
      if ((lunchStartValue === null) !== (lunchEndValue === null)) {
        throw Object.assign(new Error('Enter both valid lunch times, or leave both blank.'), { status: 400 });
      }
      const finish = finishValue <= start ? finishValue + 1440 : finishValue;
      if (lunchStartValue !== null && (lunchEndValue <= lunchStartValue || lunchStartValue < start || lunchEndValue > finish)) {
        throw Object.assign(new Error('Lunch must fall within the recorded working day.'), { status: 400 });
      }
      if (futureTime(finish)) {
        throw Object.assign(new Error('Future clock times are not permitted.'), { status: 400 });
      }
      return;
    }

    const eventMinutes = minutesFor(payload.time);
    if (eventMinutes === null) {
      throw Object.assign(new Error('Enter a valid clock time in 24-hour format.'), { status: 400 });
    }
    if (futureTime(eventMinutes)) {
      throw Object.assign(new Error('Future clock times are not permitted.'), { status: 400 });
    }
    return;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.dailyRows) ? payload.dailyRows : [];
  for (const row of rows) {
    const date = String(row?.date || '').slice(0, 10);
    const absence = String(row?.absenceStatus || row?.absenceReason || row?.absence || 'NA').trim().toLowerCase();
    if (date > today && !['sick', 'holiday', 'absent', 'un-paid'].includes(absence)) {
      throw Object.assign(new Error('Future dates can only be marked absent, sick, holiday or Un-Paid; worked time cannot be entered early.'), { status: 400 });
    }
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
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(key) && !SAFE_PAYROLL_ROW_KEYS.has(key)) return;
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
  const keys = ['schemaVersion', 'employeeName', 'employeeEmail', 'employeeUpn', 'testMode', 'notificationEmail', 'weekStart', 'weekEnd', 'cycleStart', 'cycleEnd', 'payrollFriday', 'recordDate', 'date', 'time', 'action', 'actionLabel', 'status', 'absenceReason', 'startTime', 'finishTime', 'lunchStart', 'lunchEnd', 'dayStart', 'dayFinish', 'workedHours', 'basicHours', 'ot15Hours', 'ot20Hours', 'weightedHours', 'note', 'location', 'row', 'hours', 'number', 'dateOfEstimate', 'attention', 'company', 'email', 'validity', 'preparedBy', 'vatRate', 'reference', 'opening', 'terms', 'items', 'subtotal', 'vat', 'total', 'jobReference', 'client', 'site', 'engineer', 'plannedDate', 'description', 'cardType', 'jobStatus', 'jobRevision', 'previousRecordId', 'invoiceNumber', 'xeroReference', 'xeroInvoiceId', 'xeroInvoiceStatus', 'xeroInvoiceUrl', 'xeroInvoiceTotal', 'xeroInvoiceAmountDue', 'xeroInvoiceCurrency', 'xeroLastSyncedAt', 'jobEmailUrl', 'jobEmailMessageId', 'updateReason', 'accountNotes', 'title', 'assignee', 'due', 'priority', 'owner', 'type', 'notes', 'rows', 'dailyRows', 'daily_rows', 'gmtDailyRows', 'totals', 'weighted', 'absenceRanges', 'calendarSync', 'calendarSyncPayload', 'gmtCalendarSyncPayload', 'enquiryId', 'customerName', 'customerEmail', 'customerPhone', 'requestType', 'message', 'conversationUrl', 'conversationId', 'threadId', 'messages', 'replyTo', 'inboxStatus', 'mailbox', 'payMonth', 'deletedDays', 'editNote', 'editedBy', 'editedAt'];
  for (const key of keys) {
    if (payload[key] !== undefined) safe[key] = safePayloadValue(payload[key]);
  }
  return safe;
}

function validatePortalRequestMutation(body, existing = null, identity = null) {
  const request = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const payload = request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload) ? request.payload : {};
  const kind = canonicalKind(request.kind || request.type || existing?.kind || '');
  const existingKind = existing ? canonicalKind(existing.kind) : '';
  const requestKind = ['calendar', 'tasks'].includes(kind) || ['calendar', 'tasks'].includes(existingKind);
  if (!requestKind) return;
  if (existing && existingKind !== kind) {
    throw Object.assign(new Error('A request cannot change category'), { status: 409 });
  }

  const action = text(request.action || request.gmtAction || '', '', 100).toLowerCase();
  const expectedAction = existing ? 'update_request' : 'create_request';
  if (action !== expectedAction) {
    throw Object.assign(new Error('Portal request action is not permitted'), { status: 400 });
  }

  const hasRequestedStatus = Object.hasOwn(request, 'status') || Object.hasOwn(payload, 'status');
  const requestedStatus = text(request.status ?? payload.status ?? '', '', 100).toLowerCase();
  if (hasRequestedStatus) {
    const cancellationAllowed = Boolean(existing)
      && kind === 'calendar'
      && requestedStatus === 'cancelled'
      && ['pending approval', 'submitted', 'saved'].includes(text(existing.status, '', 100).toLowerCase())
      && Boolean(identity?.oid)
      && identity.oid === existing.owner_oid;
    const allowed = requestedStatus === 'pending approval' || cancellationAllowed;
    if (!allowed) throw Object.assign(new Error('Request status is controlled by Microsoft 365'), { status: 403 });
  }

  if (existing) {
    const currentStatus = text(existing.status, '', 100).toLowerCase();
    if (!['pending approval', 'submitted', 'saved'].includes(currentStatus)) {
      throw Object.assign(new Error('Only pending requests can be edited or cancelled'), { status: 409 });
    }
  }
}

function validatePortalRequestDeletion(existing) {
  if (['calendar', 'tasks'].includes(canonicalKind(existing?.kind))) {
    throw Object.assign(new Error('Calendar and task requests cannot be deleted through the portal'), { status: 409 });
  }
}

function normaliseUnpaidTimesheetPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const rowKeys = ['rows', 'dailyRows', 'daily_rows', 'gmtDailyRows'];
  const summaryRowsKey = rowKeys.find((key) => Array.isArray(payload[key]));
  const reported = { worked: 0, basic: 0, ot15: 0, ot20: 0, weighted: 0, count: 0 };
  const numeric = (row, keys) => {
    for (const key of keys) {
      const value = Number(row?.[key]);
      if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '' && Number.isFinite(value)) return value;
    }
    return null;
  };
  const zeroRow = (source, collectSummary) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
    const absence = String(source.absenceStatus || source.absence_status || source.absenceReason || source.absence_reason || source.absence || source['Absence reason'] || '').trim();
    if (!/^un-paid$/i.test(absence)) return source;
    const row = { ...source };
    const workedMinutes = numeric(source, ['workedActual', 'workedMinutes', 'worked_minutes', 'totalMinutes', 'total_minutes', 'Total minutes', 'Worked minutes']);
    const workedHours = numeric(source, ['workedHours', 'worked_hours', 'hours', 'totalHours', 'total_hours', 'Total hours', 'Worked hours']);
    if (row.reportedWorkedMinutes === undefined && (workedMinutes !== null || workedHours !== null)) row.reportedWorkedMinutes = workedMinutes !== null ? workedMinutes : workedHours * 60;
    if (row.reportedWorkedHours === undefined && (workedHours !== null || workedMinutes !== null)) row.reportedWorkedHours = workedHours !== null ? workedHours : workedMinutes / 60;
    const basicMinutes = numeric(source, ['appliedBasic', 'applied_basic', 'basic', 'basicMinutes', 'basic_minutes', 'Basic minutes']);
    const basicHours = numeric(source, ['basicHours', 'basic_hours', 'Basic hours']);
    const ot15Minutes = numeric(source, ['appliedOt15', 'applied_ot15', 'ot15', 'ot15Minutes', 'ot15_minutes', 'OT x1.5 minutes']);
    const ot15Hours = numeric(source, ['ot15Hours', 'ot15_hours', 'overtime15Hours']);
    const ot20Minutes = numeric(source, ['appliedOt20', 'applied_ot20', 'ot20', 'ot20Minutes', 'ot20_minutes', 'OT x2.0 minutes']);
    const ot20Hours = numeric(source, ['ot20Hours', 'ot20_hours', 'overtime20Hours']);
    const rowWeighted = numeric(source, ['weightedHours', 'weighted_hours', 'Weighted hours']);
    if (collectSummary) {
      reported.worked += workedMinutes !== null ? workedMinutes : workedHours !== null ? workedHours * 60 : 0;
      reported.basic += basicMinutes !== null ? basicMinutes : (basicHours || 0) * 60;
      reported.ot15 += ot15Minutes !== null ? ot15Minutes : (ot15Hours || 0) * 60;
      reported.ot20 += ot20Minutes !== null ? ot20Minutes : (ot20Hours || 0) * 60;
      reported.weighted += rowWeighted !== null ? rowWeighted : (basicHours !== null ? basicHours : (basicMinutes || 0) / 60) + 1.5 * (ot15Hours !== null ? ot15Hours : (ot15Minutes || 0) / 60) + 2 * (ot20Hours !== null ? ot20Hours : (ot20Minutes || 0) / 60);
      reported.count += 1;
    }
    if (row.reportedWorkedMinutes === undefined) row.reportedWorkedMinutes = row.reportedWorkedMinutes ?? (workedMinutes !== null ? workedMinutes : workedHours !== null ? workedHours * 60 : null);
    if (row.reportedWorkedHours === undefined) row.reportedWorkedHours = row.reportedWorkedHours ?? (workedHours !== null ? workedHours : workedMinutes !== null ? workedMinutes / 60 : null);
    Object.assign(row, {
      workedMinutes: 0, worked_minutes: 0, workedHours: 0, worked_hours: 0, workedActual: 0,
      total: 0, totalMinutes: 0, total_minutes: 0, totalHours: 0, total_hours: 0,
      basic: 0, basicMinutes: 0, basic_minutes: 0, basicHours: 0, basic_hours: 0, appliedBasic: 0, applied_basic: 0,
      ot15: 0, ot15Minutes: 0, ot15_minutes: 0, ot15Hours: 0, ot15_hours: 0, appliedOt15: 0, applied_ot15: 0,
      ot20: 0, ot20Minutes: 0, ot20_minutes: 0, ot20Hours: 0, ot20_hours: 0, appliedOt20: 0, applied_ot20: 0,
      appliedTotal: 0, weighted_hours: 0,
      weightedHours: 0, calculationSource: 'unpaid absence'
    });
    ['worked_minutes', 'worked_hours', 'total_minutes', 'total_hours', 'basic_minutes', 'basic_hours', 'ot15_minutes', 'ot15_hours', 'ot20_minutes', 'ot20_hours', 'weighted_hours', 'applied_basic', 'applied_ot15', 'applied_ot20', 'totalMinutes', 'Worked minutes', 'Worked hours', 'Total minutes', 'Total hours', 'Basic minutes', 'Basic hours', 'OT x1.5 minutes', 'OT x1.5 hours', 'OT x2.0 minutes', 'OT x2.0 hours', 'Weighted hours'].forEach((key) => {
      if (Object.hasOwn(source, key)) row[key] = 0;
    });
    return row;
  };
  rowKeys.forEach((key) => { if (Array.isArray(payload[key])) payload[key] = payload[key].map((row) => zeroRow(row, key === summaryRowsKey)); });
  if (!reported.count) return payload;
  const subtract = (object, key, amount) => {
    if (Object.hasOwn(object, key) && Number.isFinite(Number(object[key]))) object[key] = Math.max(0, Number(object[key]) - amount);
  };
  const subtractGroup = (object, keys, amount) => keys.forEach((key) => subtract(object, key, amount));
  if (payload.totals && typeof payload.totals === 'object') {
    subtractGroup(payload.totals, ['workedActual', 'total', 'workedMinutes', 'worked_minutes', 'totalMinutes', 'total_minutes'], reported.worked);
    subtractGroup(payload.totals, ['basic', 'basicMinutes', 'basic_minutes', 'appliedBasic', 'applied_basic'], reported.basic);
    subtractGroup(payload.totals, ['ot15', 'ot15Minutes', 'ot15_minutes', 'appliedOt15', 'applied_ot15'], reported.ot15);
    subtractGroup(payload.totals, ['ot20', 'ot20Minutes', 'ot20_minutes', 'appliedOt20', 'applied_ot20'], reported.ot20);
    subtractGroup(payload.totals, ['workedHours', 'worked_hours', 'totalHours', 'total_hours', 'Worked hours', 'Total hours'], reported.worked / 60);
    subtractGroup(payload.totals, ['basicHours', 'basic_hours', 'Basic hours'], reported.basic / 60);
    subtractGroup(payload.totals, ['ot15Hours', 'ot15_hours', 'OT x1.5 hours'], reported.ot15 / 60);
    subtractGroup(payload.totals, ['ot20Hours', 'ot20_hours', 'OT x2.0 hours'], reported.ot20 / 60);
    subtract(payload.totals, 'weightedHours', reported.weighted);
    subtract(payload.totals, 'weighted_hours', reported.weighted);
    payload.totals.absent = Math.max(Number(payload.totals.absent) || 0, reported.count);
    payload.totals.unpaid = Math.max(Number(payload.totals.unpaid) || 0, reported.count);
  }
  if (Object.hasOwn(payload, 'weightedHours') && Number.isFinite(Number(payload.weightedHours))) payload.weightedHours = Math.max(0, Number(payload.weightedHours) - reported.weighted);
  [['workedHours', 'worked_hours'], ['basicHours', 'basic_hours'], ['ot15Hours', 'ot15_hours'], ['ot20Hours', 'ot20_hours']]
    .forEach((keys, index) => keys.forEach((key) => subtract(payload, key, [reported.worked, reported.basic, reported.ot15, reported.ot20][index] / 60)));
  const events = payload.calendarSync && Array.isArray(payload.calendarSync.events) ? payload.calendarSync.events : [];
  events.forEach((event) => {
    if (!event || typeof event !== 'object' || !/timesheet/i.test(String(event.type || event.title || ''))) return;
    subtract(event, 'workedHours', reported.worked / 60);
    subtract(event, 'basicHours', reported.basic / 60);
    subtract(event, 'ot15Hours', reported.ot15 / 60);
    subtract(event, 'ot20Hours', reported.ot20 / 60);
  });
  return payload;
}

function normaliseInput(body, identity, existing = null, env = null, payPeriods = defaultPayPeriods()) {
  const payload = parsePayload(body);
  if (existing && /^document-import-/i.test(String(existing.record_id || ''))) {
    const original=payloadObject(existing);
    ['importSourceId','importSourceIndex','importSourceName','importedBy'].forEach(key => { if (Object.hasOwn(original,key)) payload[key]=original[key]; });
  }
  const kind = canonicalKind(body.kind || body.type || payload.kind || existing?.kind);
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
  if (kind === 'timesheets') normaliseUnpaidTimesheetPayload(payload);
  if (kind === 'timesheets' && action !== 'pay_month_correction') {
    const computedPayMonth = payMonthForPayload(payload, payload.weekStart || body.weekStart || body.startDate || body.start_date, payPeriods);
    if (computedPayMonth) payload.payMonth = computedPayMonth;
  }
  const correctionOnBehalf = kind === 'timesheets' && action === 'pay_month_correction' && body.editMode === true && (identity.isAdmin || identity.isSubmissionAdmin) && !existing;
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
  const status = text(body.status || payload.status || existing?.status || (kind === 'calendar' || kind === 'tasks' ? 'Pending approval' : 'Submitted'), 'Submitted', 100);
  const startDate = isoOrBlank(body.startDate || body.start_date || payload.weekStart || body.weekStart);
  const endDate = isoOrBlank(body.endDate || body.end_date || payload.weekEnd || body.weekEnd);
  const recordDate = isoOrBlank(body.recordDate || body.record_date || payload.recordDate || payload.date || body.date);
  const privilegedEdit = Boolean(existing && (identity.isAdmin || identity.isSubmissionAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)));
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
  const projected = await Promise.all(estimates.map(async (estimate) => {
    const sourceRecordId = estimate.source === 'email'
      ? await emailEstimatePortalRecordId(estimate.canonical_id)
      : estimate.canonical_id;
    const { sharepoint_url: _sharepointUrl, attachment_url: _attachmentUrl, ...safe } = estimate;
    return { ...safe, source_record_id: sourceRecordId };
  }));
  return json({ estimates: projected }, 200, origin || '');
}

export async function emailEstimatePortalRecordId(canonicalId) {
  const key = text(canonicalId, '', 2000);
  if (!key) throw new Error('Archived estimate identity is missing');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const suffix = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `email-estimate:${suffix}`;
}

async function upsertEmailEstimatePortalRecord(env, archive, input) {
  if (!archive?.canonical_id) throw Object.assign(new Error('Archived estimate identity is missing'), { status: 500 });
  const recordId = await emailEstimatePortalRecordId(archive.canonical_id);
  const sentAt = text(input.sent_at || input.sentAt || input.received_at || input.receivedAt, '', 80);
  const date = sentAt.slice(0, 10);
  const number = text(input.estimate_number || input.estimateNumber, '', 160);
  const company = text(input.client || input.customer || input.company, '', 500);
  const customerEmail = text(input.client_email || input.customer_email || input.customerEmail, '', 320).toLowerCase();
  const payload = {
    number, estimateNumber: number, date, company, clientCompany: company,
    email: customerEmail, clientEmail: customerEmail,
    attention: text(input.attention, '', 240), reference: text(input.reference, '', 300),
    subject: text(input.subject, '', 500), archiveMessageId: archive.id,
    archiveSource: 'email'
  };
  const timestamp = now();
  const existing = await env.DB.prepare('SELECT record_id FROM records WHERE record_id = ?').bind(recordId).first();
  const result = await env.DB.prepare(`INSERT INTO records
    (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date,
     record_date, submitted_at, updated_at, issue, payload_json, source_message_key)
    VALUES (?, 'shared-estimate-archive', ?, 'GMT Estimate Archive', 'estimates', 'email_archive', 'Submitted', ?, ?, ?, ?, ?, '', ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET owner_upn=excluded.owner_upn, employee_name=excluded.employee_name,
      status=excluded.status, record_date=excluded.record_date, submitted_at=excluded.submitted_at,
      updated_at=excluded.updated_at, payload_json=excluded.payload_json, source_message_key=excluded.source_message_key`)
    .bind(recordId, text(input.mailbox, '', 320).toLowerCase(), date || null, date || null, date || null,
      sentAt || timestamp, timestamp, JSON.stringify(payload), archive.canonical_id).run();
  await upsertEstimateAssociation(env, archive.id, {
    target_kind: 'estimate', target_id: recordId, target_reference: number,
    relationship: 'represents-estimate', confidence: 1, state: 'confirmed',
    provenance_kind: 'app-link', evidence: { field: 'portal_record.archiveMessageId', record_id: recordId }
  });
  return { record_id: recordId, created: !existing, updated: Boolean(existing && result?.success !== false) };
}

async function estimateArchiveIngestEndpoint(request, env, origin) {
  const configuredKey = text(env.ESTIMATE_MAIL_INGEST_KEY, '', 1000);
  if (!configuredKey) throw Object.assign(new Error('Estimate archive ingestion is not configured'), { status: 503 });
  const suppliedKey = request.headers.get('X-GMT-Archive-Key') || '';
  if (!constantTimeEqual(suppliedKey, configuredKey)) throw Object.assign(new Error('Estimate archive key is invalid'), { status: 401 });
  const body = await readJson(request);
  const mailbox = text(body.mailbox || body.source_mailbox, '', 320).toLowerCase();
  const allowedMailboxes = new Set(['info@gmt-services.co.uk', 'accounts@gmt-services.co.uk']);
  if (!allowedMailboxes.has(mailbox)) throw Object.assign(new Error('Estimate mail archive is restricted to approved GMT mailboxes'), { status: 403 });
  const outlookMessageId = text(body.outlook_message_id || body.outlookMessageId, '', 2000);
  if (!outlookMessageId) throw Object.assign(new Error('outlook_message_id is required'), { status: 400 });
  // Graph's InternetMessageId is shared by copies of the same message in different
  // mailboxes, so prefer it for cross-mailbox duplicate detection. Fall back to the
  // mailbox-local message ID when the connector does not provide it.
  const internetMessageId = text(body.internet_message_id || body.internetMessageId, '', 1000);
  const canonicalId = internetMessageId ? `email:${internetMessageId}` : `email:${mailbox}:${outlookMessageId}`;
  const emlItemId = text(body.sharepoint_eml_item_id || body.sharepointEmlItemId, '', 500);
  if (!emlItemId) throw Object.assign(new Error('sharepoint_eml_item_id is required before an email can be indexed'), { status: 400 });
  const attachmentRows = Array.isArray(body.attachments) ? body.attachments : [];
  if (attachmentRows.length > 50) throw Object.assign(new Error('Estimate archive contains too many attachments'), { status: 413 });
  let totalAttachmentBytes = 0;
  const attachments = attachmentRows.map((attachment) => {
    const sourceAttachmentId = text(attachment?.source_attachment_id || attachment?.sourceAttachmentId || attachment?.id, '', 1000);
    const itemId = text(attachment?.sharepoint_item_id || attachment?.sharepointItemId, '', 500);
    const fileName = archiveFilename(attachment?.file_name || attachment?.fileName);
    const sizeBytes = Math.max(0, Number.parseInt(attachment?.size_bytes || attachment?.sizeBytes, 10) || 0);
    if (!sourceAttachmentId || !itemId) throw Object.assign(new Error('Each archived attachment requires source and SharePoint identifiers'), { status: 400 });
    totalAttachmentBytes += sizeBytes;
    if (sizeBytes > 20 * 1024 * 1024 || totalAttachmentBytes > 100 * 1024 * 1024) throw Object.assign(new Error('Estimate archive attachments exceed the supported size'), { status: 413 });
    return { sourceAttachmentId, itemId, fileName, sizeBytes, mimeType: text(attachment?.mime_type || attachment?.mimeType, 'application/octet-stream', 120), sha256: text(attachment?.sha256, '', 128) };
  });
  const associationRows = Array.isArray(body.associations) ? body.associations : [];
  if (associationRows.length > 100) throw Object.assign(new Error('Estimate archive contains too many associations'), { status: 413 });
  // Validate every relationship before writing the estimate index or archive row.
  for (const association of associationRows) {
    if (!association || typeof association !== 'object' || Array.isArray(association)) throw Object.assign(new Error('association is invalid'), { status: 400 });
    const targetKind = text(association.target_kind || association.targetKind, '', 32);
    const targetId = text(association.target_id || association.targetId, '', 300);
    const confidence = Number(association.confidence);
    const provenanceKind = text(association.provenance_kind || association.provenanceKind, '', 40);
    const state = text(association.state, 'candidate', 24);
    if (!['estimate', 'job-card', 'invoice'].includes(targetKind) || !targetId || !['candidate', 'confirmed', 'needs-review', 'rejected'].includes(state) || !['exact-reference', 'conversation-id', 'shared-customer-date', 'manual-review', 'app-link'].includes(provenanceKind) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw Object.assign(new Error('association is invalid'), { status: 400 });
    }
  }
  const archiveInput = normalizeEstimateArchiveRecord({
    ...body, id: undefined, canonical_id: canonicalId,
    source_kind: 'email', source_message_id: outlookMessageId, internet_message_id: internetMessageId,
    mailbox, classification_state: body.classification_state || body.classificationState || 'candidate',
    sender_email: body.sender_email || body.senderEmail || mailbox,
    recipient_emails: body.recipient_emails || body.recipientEmails || [],
    customer: body.client || body.customer || '', estimate_number: body.estimate_number || body.estimateNumber || '',
    sharepoint_eml_item_id: emlItemId,
    sharepoint_manifest_item_id: body.sharepoint_manifest_item_id || body.sharepointManifestItemId || '',
    provenance: body.provenance || { source: 'power-automate-estimate-index', mailbox, source_message_id: outlookMessageId }
  });
  const estimate = await estimateIndexStore(env).upsert({
    ...body,
    canonical_id: canonicalId,
    mailbox,
    internet_message_id: internetMessageId,
    mailbox_message_id: outlookMessageId,
    // Message IDs are mailbox-local. Keep source IDs in estimate_mail_sources,
    // where they are uniquely scoped to their mailbox.
    outlook_message_id: '',
    sharepoint_url: '',
    attachment_url: '',
    source: 'email'
  });
  const archive = await upsertEstimateArchive(env, { ...archiveInput, provenance: JSON.parse(archiveInput.provenance_json) });
  const savedAssociations = await deriveArchiveAssociations(env, archive.id, {
    estimateNumber: archiveInput.estimate_number, reference: archiveInput.reference,
    invoiceNumber: text(body.invoice_number || body.invoiceNumber, '', 500)
  });
  for (const association of associationRows) savedAssociations.push(await upsertEstimateAssociation(env, archive.id, association));
  for (const attachment of attachments) {
    await env.DB.prepare(`INSERT INTO archive_attachments
      (id, message_id, source_attachment_id, file_name, mime_type, size_bytes, sha256, sharepoint_item_id, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id, source_attachment_id) DO UPDATE SET
        file_name=excluded.file_name, mime_type=excluded.mime_type, size_bytes=excluded.size_bytes,
        sha256=excluded.sha256, sharepoint_item_id=excluded.sharepoint_item_id, provenance_json=excluded.provenance_json`)
      .bind(crypto.randomUUID(), archive.id, attachment.sourceAttachmentId,
        attachment.fileName, attachment.mimeType,
        attachment.sizeBytes, attachment.sha256, attachment.itemId,
        JSON.stringify({ source: 'power-automate-estimate-index', mailbox })).run();
  }
  const portalRecord = body.portal_record === true && archiveInput.classification_state === 'confirmed'
    ? await upsertEmailEstimatePortalRecord(env, { ...archive, canonical_id: canonicalId }, { ...body, mailbox })
    : null;
  return json({ ok: true, estimate, archive, portal_record: portalRecord, associations: publicArchiveAssociations(savedAssociations) }, 200, origin || '');
}

async function sendClientEstimateEndpoint(request, env, identity, origin) {
  if (!identity?.isAdmin) throw Object.assign(new Error('Client estimate delivery is restricted to portal administrators'), { status: 403 });
  const flowToken = await authenticateFlowToken(request, env, identity);
  const flowUrl = text(env.ESTIMATE_SEND_FLOW_URL, '', 3000);
  if (!flowUrl) throw Object.assign(new Error('The approved Accounts estimate-send flow is not configured'), { status: 503 });
  let parsedUrl;
  try { parsedUrl = new URL(flowUrl); } catch (_) { throw Object.assign(new Error('The approved Accounts estimate-send flow is not configured'), { status: 503 }); }
  if (parsedUrl.protocol !== 'https:' || !/(?:\.environment\.api\.powerplatform\.com|\.logic\.azure\.com)$/i.test(parsedUrl.hostname)) {
    throw Object.assign(new Error('The approved Accounts estimate-send flow has an invalid destination'), { status: 503 });
  }
  const body = await readJson(request);
  const recordId = text(body.recordId || body.record_id, '', MAX_RECORD_ID);
  const recipient = text(body.to || body.recipient, '', 320).toLowerCase();
  if (!recordId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw Object.assign(new Error('Estimate record and client email are required'), { status: 400 });
  const existing = await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
  if (!existing || existing.kind !== 'estimates' || existing.owner_oid !== identity.oid) throw Object.assign(new Error('Estimate record not found'), { status: 404 });
  const currentStatus = String(existing.status || '').toLowerCase();
  if (['sent to client', 'sending to client', 'delivery status needs review'].includes(currentStatus)) throw Object.assign(new Error('This estimate is already sending, sent, or awaiting Accounts review'), { status: 409 });
  const archive = await env.DB.prepare(`SELECT id FROM archive_messages WHERE source_kind='app'
    AND json_extract(provenance_json, '$.source_record_id') = ? LIMIT 1`).bind(recordId).first();
  if (!archive) throw Object.assign(new Error('Archive the estimate in the shared folder before sending'), { status: 409 });
  const estimate = body.estimate && typeof body.estimate === 'object' && !Array.isArray(body.estimate) ? body.estimate : {};
  const contentBase64 = String(body.contentBase64 || body.content_base64 || '');
  if (!contentBase64 || contentBase64.length > 1_450_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw Object.assign(new Error('Estimate attachment is missing or too large'), { status: 400 });
  const fileName = archiveFilename(body.fileName || body.file_name || `${estimate.number || 'GMT-estimate'}.doc`);
  const contentType = text(body.contentType || body.content_type, 'application/msword', 120).replace(/[\r\n;]/g, '');
  const submittedAt = now();
  const sendPayload = {
    idempotencyKey: recordId,
    recordId,
    to: recipient,
    bcc: 'accounts@gmt-services.co.uk',
    subject: `[GMT] Estimate ${text(estimate.number, '', 160)} | ${text(estimate.company, '', 500)}`,
    message: `Please find attached estimate ${text(estimate.number, '', 160)}.`,
    number: text(estimate.number, '', 160), date: text(estimate.date, '', 80),
    company: text(estimate.company, '', 500), attention: text(estimate.attention, '', 500),
    reference: text(estimate.reference, '', 500), total: Number(estimate.total) || 0,
    fileName, contentType, contentBase64,
    requestedAt: submittedAt
  };
  await env.DB.prepare(`INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(existing.record_id, existing.owner_oid, JSON.stringify({
      employee_name: existing.employee_name, kind: existing.kind, action: existing.action,
      status: existing.status, start_date: existing.start_date, end_date: existing.end_date,
      record_date: existing.record_date, submitted_at: existing.submitted_at,
      updated_at: existing.updated_at, issue: existing.issue, payload: payloadObject(existing)
    }), submittedAt, identity.oid).run();
  const claim = await env.DB.prepare(`UPDATE records SET status='Sending to client', issue='', updated_at=?
    WHERE record_id=? AND owner_oid=? AND lower(status) NOT IN ('sent to client','sending to client','delivery status needs review')`)
    .bind(submittedAt, recordId, identity.oid).run();
  if (!(claim.meta?.changes > 0)) throw Object.assign(new Error('This estimate is already sending, sent, or awaiting Accounts review'), { status: 409 });
  let response;
  try {
    response = await fetch(flowUrl, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(90000),
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${flowToken}` },
      body: JSON.stringify(sendPayload)
    });
  } catch (_) {
    await env.DB.prepare(`UPDATE records SET status='Delivery status needs review', issue=?, updated_at=? WHERE record_id=? AND owner_oid=?`)
      .bind('The Accounts send flow did not return a delivery result; check its run history before retrying.', now(), recordId, identity.oid).run();
    throw Object.assign(new Error('The Accounts send flow did not return a delivery result. Check its run history before retrying.'), { status: 502 });
  }
  if (response.status >= 300 && response.status < 400) {
    await env.DB.prepare(`UPDATE records SET status='Delivery status needs review', issue=?, updated_at=? WHERE record_id=? AND owner_oid=?`)
      .bind('The Accounts send flow returned an unexpected redirect; verify delivery in run history.', now(), recordId, identity.oid).run();
    throw Object.assign(new Error('The Accounts send flow returned an unexpected redirect. Check its run history before retrying.'), { status: 502 });
  }
  const responseText = await response.text();
  let result = null;
  try { result = responseText ? JSON.parse(responseText) : null; } catch (_) {}
  if (!response.ok || result?.success !== true) {
    const message = text(result?.message, 'The Accounts send flow did not confirm delivery. Check its run history before retrying.', 500);
    await env.DB.prepare(`UPDATE records SET status='Delivery status needs review', issue=?, updated_at=? WHERE record_id=? AND owner_oid=?`)
      .bind(message, now(), recordId, identity.oid).run();
    throw Object.assign(new Error(message), { status: 502 });
  }
  const sentAt = text(result.sentAt || result.sent_at, now(), 80);
  const claimedRecord = await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
  const next = normaliseInput({
    recordId, kind: 'estimates', action: claimedRecord.action || 'client_send',
    status: 'Sent to client', issue: '', submittedAt: existing.submitted_at,
    updatedAt: sentAt, recordDate: existing.record_date, payload: payloadObject(claimedRecord)
  }, identity, claimedRecord, env);
  await saveRecord(env, next, identity, claimedRecord);
  try {
    await estimateIndexStore(env).upsert({
      canonical_id: recordId, estimate_number: text(estimate.number, '', 500),
      client: text(estimate.company, '', 1000), client_email: recipient,
      reference: text(estimate.reference, '', 500), estimate_date: text(estimate.date, '', 80),
      source: 'app', correlation_status: 'ready'
    });
  } catch (_) { /* the protected record and shared archive remain authoritative */ }
  return json({ ok: true, status: 'Sent to client', sent_at: sentAt, archive_id: archive.id }, 200, origin || '');
}

function correlationToken(value) {
  return text(value, '', 500).trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function publicArchiveAssociations(associations) {
  return associations.map((association) => association.target_kind === 'invoice'
    ? (({ target_id: _privateTargetId, ...safe }) => safe)(association)
    : association);
}

async function deriveArchiveAssociations(env, archiveId, { estimateNumber = '', reference = '', invoiceNumber = '', sourceRecordId = '' } = {}) {
  const parsedById = new Map();
  const loadExact = async (kind, value, fields) => {
    const token = correlationToken(value);
    if (!token) return [];
    const jsonMatches = fields.map((field) => `lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.${field}'), '') ELSE '' END)) = ?`);
    const sql = `SELECT record_id, kind, record_date, payload_json FROM records
      WHERE kind = ? AND status <> 'Deleted' AND (lower(trim(record_id)) = ? OR ${jsonMatches.join(' OR ')})`;
    const result = await env.DB.prepare(sql).bind(kind, token, ...fields.map(() => token)).all();
    return result.results || [];
  };
  try {
    if (sourceRecordId) {
      const source = await env.DB.prepare(`SELECT record_id, kind, record_date, payload_json FROM records
        WHERE record_id = ? AND kind = 'estimates' AND status <> 'Deleted'`).bind(sourceRecordId).first();
      if (source) parsedById.set(source.record_id, source);
    }
    for (const row of await loadExact('job-cards', reference, ['jobReference', 'job_reference', 'reference'])) parsedById.set(row.record_id, row);
    for (const row of await loadExact('estimates', estimateNumber, ['estimateNumber', 'number'])) parsedById.set(row.record_id, row);
    for (const row of await loadExact('job-cards', invoiceNumber, ['invoiceNumber', 'xeroInvoiceNumber', 'xeroReference'])) parsedById.set(row.record_id, row);
  } catch (_) { return []; }
  const parsed = [...parsedById.values()].map((row) => {
    let payload = {};
    try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) {}
    return { ...row, payload };
  });
  const saved = [];
  if (sourceRecordId) {
    const source = parsed.find((row) => row.record_id === sourceRecordId && row.kind === 'estimates');
    if (source) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: 'estimate', target_id: source.record_id,
      target_reference: text(source.payload.estimateNumber || source.payload.number || estimateNumber, '', 500),
      relationship: 'created-from', confidence: 1, state: 'confirmed', provenance_kind: 'app-link',
      evidence: { field: 'source_record_id', record_id: source.record_id }
    }));
  }
  const exactReference = correlationToken(reference);
  if (exactReference) {
    const matches = parsed.filter((row) => row.kind === 'job-cards' && [row.record_id, row.payload.jobReference, row.payload.job_reference, row.payload.reference]
      .some((value) => correlationToken(value) === exactReference));
    for (const row of matches) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: 'job-card', target_id: row.record_id,
      target_reference: text(row.payload.jobReference || row.payload.reference || row.record_id, '', 500),
      relationship: 'supports', confidence: matches.length === 1 ? 1 : 0.5,
      state: matches.length === 1 ? 'confirmed' : 'needs-review',
      provenance_kind: 'exact-reference', evidence: { field: 'reference', value: text(reference, '', 500) }
    }));
  }
  const estimateToken = correlationToken(estimateNumber);
  if (estimateToken) {
    const matches = parsed.filter((row) => row.kind === 'estimates' && [row.record_id, row.payload.estimateNumber, row.payload.number]
      .some((value) => correlationToken(value) === estimateToken));
    for (const row of matches) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: 'estimate', target_id: row.record_id,
      target_reference: text(row.payload.estimateNumber || row.payload.number || row.record_id, '', 500),
      relationship: 'same-estimate', confidence: matches.length === 1 ? 1 : 0.5,
      state: matches.length === 1 ? 'confirmed' : 'needs-review',
      provenance_kind: 'exact-reference', evidence: { field: 'estimate_number', value: text(estimateNumber, '', 500) }
    }));
  }
  const invoiceToken = correlationToken(invoiceNumber);
  if (invoiceToken) {
    const matches = parsed.filter((row) => row.kind === 'job-cards' && row.payload.xeroInvoiceId &&
      [row.payload.invoiceNumber, row.payload.xeroInvoiceNumber, row.payload.xeroReference]
        .some((value) => correlationToken(value) === invoiceToken));
    for (const row of matches) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: 'invoice', target_id: text(row.payload.xeroInvoiceId, '', 300),
      target_reference: text(row.payload.invoiceNumber || row.payload.xeroInvoiceNumber || row.payload.xeroReference, '', 500),
      relationship: 'billed-as', confidence: matches.length === 1 ? 1 : 0.5,
      state: matches.length === 1 ? 'confirmed' : 'needs-review',
      provenance_kind: 'exact-reference', evidence: { field: 'invoice_number', value: text(invoiceNumber, '', 500) }
    }));
  }
  return saved;
}

function archiveFilename(value) {
  return text(value, 'estimate-file', 180).replace(/[\\/\r\n"<>:|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, 'file') || 'estimate-file';
}

async function sharePointGraphToken(env) {
  const tenant = text(env.ENTRA_TENANT_ID, '', 120);
  const clientId = text(env.SHAREPOINT_GRAPH_CLIENT_ID, '', 120);
  const clientSecret = text(env.SHAREPOINT_GRAPH_CLIENT_SECRET, '', 4000);
  if (!tenant || !clientId || !clientSecret || !text(env.SHAREPOINT_SITE_ID) || !text(env.SHAREPOINT_DRIVE_ID)) {
    throw Object.assign(new Error('Shared archive content access is not configured'), { status: 503 });
  }
  const cacheKey = `${tenant}:${clientId}`;
  const cached = SHAREPOINT_TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' })
  });
  if (!response.ok) throw Object.assign(new Error('Shared archive content authentication failed'), { status: 503 });
  const token = await response.json();
  if (!token.access_token) throw Object.assign(new Error('Shared archive content authentication failed'), { status: 503 });
  const lifetime = Math.max(120, Number(token.expires_in) || 3600);
  SHAREPOINT_TOKEN_CACHE.set(cacheKey, { token: token.access_token, expiresAt: Date.now() + lifetime * 1000 });
  return token.access_token;
}

export async function graphSharePointRequest(env, path, init = {}) {
  const token = await sharePointGraphToken(env);
  const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(text(env.SHAREPOINT_SITE_ID, '', 500))}/drives/${encodeURIComponent(text(env.SHAREPOINT_DRIVE_ID, '', 500))}${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) }
  });
  return response;
}

async function readDocumentBytes(request, limit=20*1024*1024) {
  const declared=Number(request.headers.get('content-length')||0);
  if(declared>limit)throw Object.assign(new Error('Document exceeds 20 MiB.'),{status:413});
  const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('Document content is required.'),{status:400});
  const chunks=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){try{await reader.cancel();}catch(_){}throw Object.assign(new Error('Document exceeds 20 MiB.'),{status:413});}chunks.push(part.value);}
  const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}

function documentImportSharePointIo(env) {
  return {
    ensureFolder:path=>ensureSharePointFolder(env,path),
    async lookup(path){const response=await graphSharePointRequest(env,`/root:/${encodeDrivePath(path)}`);if(response.status===404)return null;if(!response.ok)throw Object.assign(new Error('SharePoint could not check the document destination.'),{status:503});return response.json();},
    async upload(path,bytes){
      const response=await graphSharePointRequest(env,`/root:/${encodeDrivePath(path)}:/createUploadSession`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'fail'}})});
      if(!response.ok)throw Object.assign(new Error('SharePoint could not start filing.'),{status:503});
      const session=await response.json();if(!/^https:\/\//i.test(String(session?.uploadUrl||'')))throw Object.assign(new Error('SharePoint returned an invalid upload session.'),{status:503});
      let item=null;for(let offset=0;offset<bytes.length;offset+=10*1024*1024){const end=Math.min(offset+10*1024*1024,bytes.length),chunk=bytes.slice(offset,end);const put=await fetch(session.uploadUrl,{method:'PUT',headers:{'content-type':'application/octet-stream','content-length':String(chunk.length),'content-range':`bytes ${offset}-${end-1}/${bytes.length}`},body:chunk});if(!put.ok)throw Object.assign(new Error('SharePoint could not file the document.'),{status:503});if(end===bytes.length)item=await put.json();}return item;
    },
    async read(item){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(item.id)}/content`);if(!response.ok)throw Object.assign(new Error('SharePoint read-back failed.'),{status:503});return readDocumentBytes(response);},
    async share(item){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(item.id)}/createLink`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'view',scope:'organization',retainInheritedPermissions:true})});if(!response.ok)throw Object.assign(new Error('SharePoint access could not be configured.'),{status:503});return (await response.json()).link;},
    async save(value){await env.DB.prepare(`INSERT INTO document_import_files (record_id,kind,source_id,file_name,size_bytes,sharepoint_item_id,sharepoint_path,sharing_url,filed_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET kind=excluded.kind,source_id=excluded.source_id,file_name=excluded.file_name,size_bytes=excluded.size_bytes,sharepoint_item_id=excluded.sharepoint_item_id,sharepoint_path=excluded.sharepoint_path,sharing_url=excluded.sharing_url,filed_at=excluded.filed_at`).bind(value.recordId,value.kind,value.sourceId,value.fileName,value.sizeBytes,value.itemId,value.path,value.url,now()).run();}
  };
}

async function verifyPrivateParentDestination(env,parentId) {
  const context={adminGroupId:env.PRIVATE_TIMESHEET_ADMIN_GROUP_ID,siteOwnerGroupId:env.PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID};
  const io={
    async metadata(id){const r=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}`);if(!r.ok)throw Object.assign(new Error('Private timesheet parent is unavailable'),{status:503});return r.json();},
    async permissions(id){const r=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}/permissions`);if(!r.ok)throw Object.assign(new Error('Private timesheet parent permissions could not be read'),{status:503});const b=await r.json();if(b['@odata.nextLink'])throw Object.assign(new Error('Private timesheet parent permissions were incomplete'),{status:503});return b.value;}
  };
  // The only accepted empty inheritance markers are on this pinned fictional
  // test parent, after checking its exact direct, independently private anchor.
  if(env.SYNTHETIC_TEST_SERVICE_ENABLED==='true' && env.SYNTHETIC_RATE_TEST_MODE==='provider-fixture-v1' &&
      env.SYNTHETIC_TEST_READ_ONLY_DESTINATION==='true' && parentId==='01ZURLVFIIINPOKIYCCZEJFTFMCUTRGBUL' &&
      env.PRIVATE_TIMESHEET_PARENT_ID===parentId) {
    return verifyPinnedInheritedParent(context,parentId,'01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP',io);
  }
  verifyPrivateTimesheetParent(context,await io.permissions(parentId));
}

async function verifyPrivateTimesheetDestination(env,record) {
  const upn=String(record.owner_upn||'').trim().toLowerCase(),token=await sharePointGraphToken(env);
  if(!upn)throw new Error('Timesheet employee is unavailable');
  const directory=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName`,{headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!directory.ok)throw new Error('Timesheet employee could not be verified');
  const user=await directory.json(),employeeOid=String(user?.id||'').toLowerCase();
  if(String(user?.userPrincipalName||'').toLowerCase()!==upn||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(employeeOid))throw new Error('Timesheet employee could not be verified');
  // A pay-month correction can be created by Accounts on an employee's
  // behalf, so its owner_oid can identify the editor rather than the employee.
  // Bind the resolved directory subject separately and fail closed if the
  // address is later reused or renamed. Concurrent first resolutions race on
  // the unique keys; only the persisted pair is allowed to proceed.
  await env.DB.prepare('INSERT INTO private_timesheet_subjects (employee_upn,employee_oid,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(upn,employeeOid,now()).run();
  const subject=await env.DB.prepare('SELECT employee_oid FROM private_timesheet_subjects WHERE employee_upn=?').bind(upn).first();
  if(subject?.employee_oid!==employeeOid)throw Object.assign(new Error('Timesheet employee identity needs reconciliation'),{status:503});
  const root='Submitted Documents/Timesheets';
  const configuredParent=String(env.PRIVATE_TIMESHEET_PARENT_ID||'').trim();
  if(configuredParent&&!/^[A-Za-z0-9!_-]{1,256}$/.test(configuredParent))throw Object.assign(new Error('Private timesheet parent is invalid'),{status:503});
  const parentResponse=await graphSharePointRequest(env,configuredParent?`/items/${encodeURIComponent(configuredParent)}`:`/root:/${encodeDrivePath(root)}`);
  if(!parentResponse.ok)throw Object.assign(new Error('Private timesheet parent is unavailable'),{status:503});
  const parent=await parentResponse.json();if(!parent?.id||(configuredParent&&parent.id!==configuredParent)||!parent.folder||parent.file||parent.remoteItem)throw Object.assign(new Error('Private timesheet parent is invalid'),{status:503});
  const checkParent=async(expected=parent.id)=>{
    if(expected!==parent.id)throw Object.assign(new Error('Private timesheet parent changed'),{status:503});
    await verifyPrivateParentDestination(env,parent.id);
  };
  await checkParent();
  const io={
    verifyParent:checkParent,
    async find(){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(parent.id)}:/${encodeURIComponent(user.id)}`);if(response.status===404)return null;if(!response.ok)throw new Error('Private folder lookup failed');return response.json();},
    async refresh(id){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}`);if(!response.ok)throw new Error('Private folder refresh failed');return response.json();},
    async createEmpty(path){if(env.SYNTHETIC_TEST_READ_ONLY_DESTINATION==='true')throw Object.assign(new Error('Test destination is unavailable'),{status:503});await checkParent();const name=path.split('/').pop();const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(parent.id)}/children`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});if(!response.ok)throw new Error('Private folder creation failed');return response.json();},
    async markCreated(id,employee,admin){await env.DB.prepare('INSERT INTO private_timesheet_folders (employee_oid,folder_id,admin_group_oid,created_at) VALUES (?,?,?,?) ON CONFLICT(employee_oid) DO NOTHING').bind(employee,id,admin,now()).run();if(!await this.wasCreatedByApp(id,employee,admin))throw new Error('Private folder identity could not be verified');},
    async wasCreatedByApp(id,employee,admin){const row=await env.DB.prepare('SELECT folder_id,admin_group_oid FROM private_timesheet_folders WHERE employee_oid=?').bind(employee).first();return row?.folder_id===id&&row?.admin_group_oid===admin;},
    async grantPrivate(id,recipients,options){if(env.SYNTHETIC_TEST_READ_ONLY_DESTINATION==='true')throw Object.assign(new Error('Test destination permissions cannot be changed'),{status:503});if(options?.retainInheritedPermissions!==true||recipients.length!==1)throw new Error('Private folder grant is invalid');const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}/invite`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recipients:recipients.map(objectId=>({objectId})),roles:['write'],requireSignIn:true,sendInvitation:false,retainInheritedPermissions:true})});if(!response.ok||response.status===207)throw new Error('Private folder permissions could not be applied');},
    async permissions(id){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}/permissions`);if(!response.ok)throw new Error('Private folder permissions could not be read');const body=await response.json();if(body['@odata.nextLink'])throw new Error('Private folder permissions were incomplete');return body.value;}
  };
  const folder=await ensurePrivateTimesheetFolder({adminGroupId:env.PRIVATE_TIMESHEET_ADMIN_GROUP_ID,employeeId:user?.id,employeeUpn:upn,siteOwnerGroupId:env.PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID,parentId:parent.id},io);
  await checkParent();
  return {...folder,employeeId:user.id,employeeUpn:upn,parentId:parent.id};
}

async function verifyPrivateWorkbookDestination(env,folder,record,month){
  const io={
    ...privateTimesheetWorkbookStore(env.DB,now),
    async verifyParent(id){await verifyPrivateParentDestination(env,id);},
    async metadata(id){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}`);if(!response.ok)throw new Error('Private workbook metadata could not be read');return response.json();},
    async findChild(parentId,name){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}`);if(response.status===404)return null;if(!response.ok)throw new Error('Private workbook lookup failed');return response.json();},
    async permissions(id){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}/permissions`);if(!response.ok)throw new Error('Private workbook permissions could not be read');const body=await response.json();if(body['@odata.nextLink'])throw new Error('Private workbook permissions were incomplete');return body.value;},
    async createFolder(parentId,name){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(parentId)}/children`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});if(!response.ok)throw new Error('Private month folder could not be created');return response.json();},
    async createBlankWorkbook(parentId,name){
      const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}:/createUploadSession`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'fail'}})});
      if(!response.ok)throw new Error('Private workbook upload could not be started');
      const session=await response.json();let url;try{url=new URL(String(session?.uploadUrl||''));}catch(_){throw new Error('Private workbook upload endpoint is invalid');}
      if(url.protocol!=='https:'||url.username||url.password)throw new Error('Private workbook upload endpoint is invalid');
      const bytes=decodeBase64(blankPayMonthWorkbookBase64);
      const put=await fetch(url.toString(),{method:'PUT',headers:{'content-length':String(bytes.length),'content-range':`bytes 0-${bytes.length-1}/${bytes.length}`,'content-type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(30000)});
      if(!put.ok||![200,201].includes(put.status))throw new Error('Private workbook upload failed');return put.json();
    },
    async verifyBlank(id,created){return verifyUploadedBlankWorkbook(created,{
      async metadata(){return io.metadata(id);},
      async content(){const response=await graphSharePointRequest(env,`/items/${encodeURIComponent(id)}/content`);if(!response.ok)throw new Error('Private workbook read-back failed');return readDocumentBytes(response,100000);}
    });}
  };
  const context={rootId:folder.id,parentId:folder.parentId,employeeId:folder.employeeId,employeeUpn:folder.employeeUpn,adminGroupId:env.PRIVATE_TIMESHEET_ADMIN_GROUP_ID,siteOwnerGroupId:env.PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID,employeeName:record.employee_name,payMonth:month};
  return env.TIMESHEET_WORKBOOK_PROVISIONING_ENABLED==='true'?ensurePrivateTimesheetWorkbook(context,io):verifyPrivateTimesheetWorkbook(context,io);
}

function requireJobCardArchiveAdmin(identity) {
  if (!identity?.isAdmin && !identity?.isJobCardAdmin) throw Object.assign(new Error('Scanned job-card archive changes are restricted to Accounts'), { status: 403 });
}

function encodeDrivePath(path) {
  return String(path).split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function ensureSharePointFolder(env, folderPath) {
  const siteId = text(env.SHAREPOINT_SITE_ID, '', 500);
  const driveId = text(env.SHAREPOINT_DRIVE_ID, '', 500);
  let current = '';
  for (const segment of String(folderPath).split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    const cacheKey = `${siteId}:${driveId}:${current}`;
    if (SHAREPOINT_FOLDER_CACHE.has(cacheKey)) continue;
    const path = `/root:/${encodeDrivePath(current)}`;
    let response = await graphSharePointRequest(env, path);
    if (response.status === 404) {
      const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
      const childrenPath = parent ? `/root:/${encodeDrivePath(parent)}:/children` : '/root/children';
      response = await graphSharePointRequest(env, childrenPath, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: segment, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
      });
      if (response.status === 409) response = await graphSharePointRequest(env, path);
    }
    if (!response.ok) throw Object.assign(new Error('SharePoint job-card archive folders could not be prepared'), { status: 503 });
    let item;
    try { item = await response.json(); } catch (_) { item = null; }
    if (!item?.id || !item.folder) throw Object.assign(new Error('SharePoint job-card archive folder could not be verified'), { status: 503 });
    SHAREPOINT_FOLDER_CACHE.add(cacheKey);
  }
}

function jobCardSessionId(value) {
  const id = text(value, '', 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error('Job-card upload session was not found'), { status: 404 });
  return id;
}

async function jobCardBatchStartEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const result = await startJobCardBatch(env, body, identity);
  await ensureSharePointFolder(env, `JobCards/Source Batches/${result.batchId}`);
  await ensureSharePointFolder(env, 'JobCards/Records');
  return json({ ok: true, ...result }, result.duplicate ? 200 : 201, origin || '');
}

async function jobCardBatchStatusEndpoint(env, identity, batchId, origin) {
  requireJobCardArchiveAdmin(identity);
  return json(await jobCardBatchStatus(env, batchId), 200, origin || '');
}

async function jobCardUploadSessionEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const purpose = text(body.purpose, '', 32);
  if (!['source-batch', 'job-card-page'].includes(purpose)) throw Object.assign(new Error('Upload purpose is invalid'), { status: 400 });
  const batch = await getJobCardBatch(env, body.batchId);
  let sourceFile = '';
  let recordId = null;
  let pageCount = 0;
  let sizeBytes = 0;
  let sha256 = '';
  let quickXorHash = '';
  let expectedPath = '';
  let manifestEntry = null;

  if (purpose === 'source-batch') {
    sourceFile = text(body.fileName, '', 180);
    const expected = batch.sources.find((source) => source.fileName === sourceFile);
    const candidate = {
      fileName: sourceFile, pageCount: Number(body.pageCount), sizeBytes: Number(body.sizeBytes),
      sha256: text(body.sha256, '', 64).toLowerCase(), quickXorHash: text(body.quickXorHash, '', 80)
    };
    if (!expected || JSON.stringify(candidate) !== JSON.stringify(expected)) throw Object.assign(new Error('Source PDF does not match the registered batch inventory'), { status: 409 });
    const existing = await env.DB.prepare('SELECT sharepoint_item_id FROM job_card_source_files WHERE batch_id=? AND source_file=?').bind(batch.batch_id, sourceFile).first();
    if (batch.status !== 'uploading' && !existing) throw Object.assign(new Error('The source batch is already complete'), { status: 409 });
    sizeBytes = candidate.sizeBytes;
    sha256 = candidate.sha256;
    quickXorHash = candidate.quickXorHash;
    pageCount = candidate.pageCount;
    expectedPath = `JobCards/Source Batches/${batch.batch_id}/${sourceFile}`;
  } else {
    if (!['source-complete', 'pages-complete'].includes(batch.status)) throw Object.assign(new Error('Upload all original source PDFs before adding page records'), { status: 409 });
    manifestEntry = await normalizeJobCardEntry({ ...body.manifestEntry, batchId: batch.batch_id });
    const source = batch.sources.find((item) => item.fileName === manifestEntry.sourceFile);
    const uploadedSource = await env.DB.prepare('SELECT sha256, quick_xor_hash FROM job_card_source_files WHERE batch_id=? AND source_file=?').bind(batch.batch_id, manifestEntry.sourceFile).first();
    if (!source || !uploadedSource || source.sha256 !== manifestEntry.sourceSha256 || source.quickXorHash !== manifestEntry.sourceQuickXorHash || manifestEntry.sourcePage > source.pageCount) {
      throw Object.assign(new Error('Job-card page does not match a completed source PDF'), { status: 409 });
    }
    recordId = manifestEntry.recordId;
    sourceFile = manifestEntry.sourceFile;
    sizeBytes = manifestEntry.sizeBytes;
    sha256 = manifestEntry.sha256;
    quickXorHash = manifestEntry.quickXorHash;
    pageCount = manifestEntry.sourcePage;
    expectedPath = `JobCards/Records/${recordId}.pdf`;
  }

  const graphPath = `/root:/${encodeDrivePath(expectedPath)}:/createUploadSession`;
  const graphResponse = await graphSharePointRequest(env, graphPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
  });
  if (!graphResponse.ok) throw Object.assign(new Error('SharePoint could not create the job-card upload session'), { status: 503 });
  const graphSession = await graphResponse.json();
  const uploadUrl = text(graphSession.uploadUrl, '', 5000);
  const expirationDateTime = text(graphSession.expirationDateTime, '', 80);
  if (!uploadUrl || !/^https:\/\//i.test(uploadUrl) || !Number.isFinite(Date.parse(expirationDateTime))) {
    throw Object.assign(new Error('SharePoint returned an invalid upload session'), { status: 503 });
  }
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO job_card_upload_sessions
    (session_id, purpose, batch_id, record_id, source_file, size_bytes, expected_sha256,
     expected_quick_xor_hash, expected_path, page_count, manifest_entry_json, actor_oid, actor_upn, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(sessionId, purpose, batch.batch_id, recordId, sourceFile, sizeBytes, sha256, quickXorHash, expectedPath,
      pageCount, manifestEntry ? JSON.stringify(manifestEntry) : null, identity.oid, identity.upn, expirationDateTime).run();
  // Graph's preauthenticated URL is returned to this Accounts request only.
  // It is never persisted, logged, or included in subsequent responses.
  return json({ sessionId, uploadUrl, expirationDateTime }, 201, origin || '');
}

async function jobCardSessionForCompletion(env, sessionId) {
  const row = await env.DB.prepare('SELECT * FROM job_card_upload_sessions WHERE session_id=?').bind(sessionId).first();
  if (!row) throw Object.assign(new Error('Job-card upload session was not found'), { status: 404 });
  if (row.status === 'complete') return row;
  if (row.status === 'expired' || Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare(`UPDATE job_card_upload_sessions SET status='expired', expected_path=NULL,
      manifest_entry_json=NULL, completed_at=? WHERE session_id=?`)
      .bind(new Date().toISOString(), sessionId).run();
    throw Object.assign(new Error('Job-card upload session expired; create a new session to retry'), { status: 410 });
  }
  if (!row.expected_path || !row.expected_sha256 || !row.expected_quick_xor_hash) throw Object.assign(new Error('Job-card upload session is incomplete'), { status: 409 });
  return row;
}

async function graphCompletedJobCardFile(env, session) {
  const response = await graphSharePointRequest(env, `/root:/${encodeDrivePath(session.expected_path)}`);
  if (!response.ok) throw Object.assign(new Error(response.status === 404 ? 'SharePoint upload has not completed' : 'SharePoint upload could not be verified'), { status: response.status === 404 ? 409 : 503 });
  const item = await response.json();
  if (!item.id || Number(item.size) !== Number(session.size_bytes) || item.file?.hashes?.quickXorHash !== session.expected_quick_xor_hash) {
    throw Object.assign(new Error('SharePoint file size or QuickXorHash does not match the local manifest'), { status: 409 });
  }
  return item;
}

async function clearJobCardUploadSession(env, sessionId) {
  await env.DB.prepare(`UPDATE job_card_upload_sessions SET status='complete', expected_path=NULL,
    manifest_entry_json=NULL, completed_at=? WHERE session_id=?`)
    .bind(new Date().toISOString(), sessionId).run();
}

async function jobCardBatchCompleteEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const sessionId = jobCardSessionId(body.sessionId);
  const session = await jobCardSessionForCompletion(env, sessionId);
  if (session.purpose !== 'source-batch') throw Object.assign(new Error('Upload session is not an original source PDF'), { status: 400 });
  const batch = await getJobCardBatch(env, session.batch_id);
  if (session.status !== 'complete') {
    const item = await graphCompletedJobCardFile(env, session);
    if (item.name && item.name !== session.source_file) throw Object.assign(new Error('SharePoint file name does not match the source inventory'), { status: 409 });
    const source = batch.sources.find((entry) => entry.fileName === session.source_file);
    if (!source) throw Object.assign(new Error('Original source is not part of the registered batch'), { status: 409 });
    await upsertJobCardSourceFile(env, batch.batch_id, source, item, identity);
    await clearJobCardUploadSession(env, sessionId);
  }
  const latest = await getJobCardBatch(env, session.batch_id);
  const sourceCount = Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM job_card_source_files WHERE batch_id=?').bind(batch.batch_id).first())?.count) || 0;
  return json({ ok: true, batchId: latest.batch_id, status: latest.status, uploadedSourceCount: sourceCount }, 200, origin || '');
}

async function jobCardImportEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const sessionId = jobCardSessionId(body.sessionId);
  const session = await jobCardSessionForCompletion(env, sessionId);
  if (session.purpose !== 'job-card-page') throw Object.assign(new Error('Upload session is not a job-card page'), { status: 400 });
  if (session.status === 'complete') {
    const existing = await getJobCardArchiveRecord(env, session.record_id);
    return json({ ok: true, recordId: existing.record_id, reviewState: existing.review_state, duplicate: true }, 200, origin || '');
  }
  const item = await graphCompletedJobCardFile(env, session);
  if (item.name && item.name !== `${session.record_id}.pdf`) throw Object.assign(new Error('SharePoint filename does not match the job-card record ID'), { status: 409 });
  let manifestEntry;
  try { manifestEntry = JSON.parse(session.manifest_entry_json || '{}'); } catch (_) { throw Object.assign(new Error('Job-card upload session manifest is invalid'), { status: 500 }); }
  const before = await env.DB.prepare('SELECT record_id FROM job_card_archive WHERE record_id=?').bind(session.record_id).first();
  const saved = await upsertJobCardArchive(env, {
    manifestEntry,
    sharepointItemId: item.id,
    sharepointPath: session.expected_path
  }, identity);
  const batch = await getJobCardBatch(env, session.batch_id);
  const importedCount = Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM job_card_archive WHERE batch_id=?').bind(session.batch_id).first())?.count) || 0;
  if (importedCount >= batch.page_count) {
    await env.DB.prepare("UPDATE job_card_import_batches SET status='pages-complete', updated_at=CURRENT_TIMESTAMP WHERE batch_id=?").bind(session.batch_id).run();
  }
  await clearJobCardUploadSession(env, sessionId);
  return json({ ok: true, recordId: saved.recordId, reviewState: saved.reviewState, duplicate: Boolean(before) }, before ? 200 : 201, origin || '');
}

function projectJobCardArchive(row) {
  let candidates = {};
  let confirmedFields = {};
  try { candidates = JSON.parse(row.candidates_json || '{}'); } catch (_) {}
  try { confirmedFields = JSON.parse(row.confirmed_json || '{}'); } catch (_) {}
  return {
    record_id: row.record_id, batch_id: row.batch_id, source_file: row.source_file,
    source_page: row.source_page, card_type: row.card_type, ocr_text: row.ocr_text,
    mean_ocr_confidence: row.mean_ocr_confidence, candidates, confirmed_fields: confirmedFields,
    review_state: row.review_state, review_note: row.review_note || '', reviewed_at: row.reviewed_at || null
  };
}

async function listJobCardArchiveEndpoint(request, env, identity, origin) {
  if (!canViewAllRecords(identity, 'job-cards')) throw Object.assign(new Error('Job-card archive access is not permitted'), { status: 403 });
  const url = new URL(request.url);
  const result = await queryJobCardArchive(env, {
    q: url.searchParams.get('q'), cardType: url.searchParams.get('cardType'),
    from: url.searchParams.get('from'), to: url.searchParams.get('to'),
    cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit')
  });
  return json(result, 200, origin || '');
}

async function jobCardArchiveDetailEndpoint(env, identity, recordId, origin) {
  if (!canViewAllRecords(identity, 'job-cards')) throw Object.assign(new Error('Job-card archive access is not permitted'), { status: 403 });
  const row = await getJobCardArchiveRecord(env, recordId);
  return json({ record: projectJobCardArchive(row) }, 200, origin || '');
}

async function jobCardArchiveReviewEndpoint(request, env, identity, recordId, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const result = await reviewJobCardArchive(env, recordId, body, identity);
  return json({ ok: true, ...result }, 200, origin || '');
}

async function jobCardArchiveContentEndpoint(env, identity, recordId, origin) {
  if (!canViewAllRecords(identity, 'job-cards')) throw Object.assign(new Error('Job-card archive access is not permitted'), { status: 403 });
  const row = await getJobCardArchiveRecord(env, recordId);
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(row.sharepoint_item_id)}/content`);
  if (!response.ok) throw Object.assign(new Error('Archived job-card content could not be retrieved'), { status: response.status === 404 ? 404 : 503 });
  return new Response(response.body, { status: 200, headers: {
    'content-type': 'application/pdf', 'content-length': String(row.size_bytes),
    'content-disposition': `inline; filename="${row.record_id}.pdf"`, 'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    'x-frame-options': 'SAMEORIGIN', ...(origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {})
  } });
}

async function jobCardRecordForAttachment(env, identity, recordId, { write = false } = {}) {
  const row = await env.DB.prepare('SELECT * FROM records WHERE record_id=?').bind(recordId).first();
  if (!row) throw Object.assign(new Error('Record not found'), { status: 404 });
  if (row.kind !== 'job-cards') throw Object.assign(new Error('Attachments are only available for job cards'), { status: 400 });
  if (row.status === 'Deleted') throw Object.assign(new Error('Record has been deleted'), { status: 410 });
  if (write && row.action === 'archive_import') throw Object.assign(new Error('Scanned job-card records are managed through Accounts review'), { status: 409 });
  const permitted = write ? canAccessRecord(identity, row) : canReadHistoryRecord(identity, row);
  if (!permitted) throw Object.assign(new Error('Record access is not permitted'), { status: 403 });
  return row;
}

async function jobCardAttachmentStartEndpoint(request, env, identity, recordId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId, { write: true });
  const metadata = normalizeJobCardAttachmentMetadata(await readJson(request));
  const existing = await findCompletedJobCardAttachment(env, record.record_id, metadata);
  if (existing) {
    await cleanupDuplicateJobCardAttachmentObjectsForTarget(env, existing.attachment_id);
    return json({ attachment: (await listJobCardAttachments(env, record.record_id)).find((item) => item.attachment_id === existing.attachment_id), duplicate: true }, 200, origin || '');
  }
  const attachmentId = crypto.randomUUID();
  const safeRecordFolder = /^[A-Za-z0-9_-]{1,180}$/.test(record.record_id) ? record.record_id : `record-${await sha256Base64Url(record.record_id)}`;
  const expectedPath = `JobCards/Attachments/${safeRecordFolder}/${attachmentId}-${metadata.fileName}`;
  const expirationDateTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const reserved = await reserveJobCardAttachmentUploadSession(env, {
    attachmentId, recordId: record.record_id, metadata, expectedPath,
    expiresAt: expirationDateTime, actor: identity
  });
  if (!reserved) throw Object.assign(new Error('A job-card revision can have at most 10 attachments and 100 MiB total'), { status: 413 });
  return json({ attachmentId, expirationDateTime }, 201, origin || '');
}

async function uploadJobCardAttachmentToSharePoint(env, session, bytes) {
  const expectedName = `${session.attachment_id}-${session.file_name}`;
  const path = `/root:/${encodeDrivePath(session.expected_path)}`;
  const existingResponse = await graphSharePointRequest(env, path);
  if (existingResponse.ok) {
    let existing;
    try { existing = await existingResponse.json(); } catch (_) { existing = null; }
    if (!existing?.id || !existing.file || existing.name !== expectedName) {
      throw Object.assign(new Error('SharePoint attachment path is occupied by an unexpected item'), { status: 409 });
    }
    // Never adopt a prior object based on provider metadata alone. Replace it
    // with the request bytes already checked against the reserved SHA-256.
    const cleanup = await graphSharePointRequest(env, `/items/${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
    if (!cleanup.ok && cleanup.status !== 404) throw Object.assign(new Error('SharePoint could not clear a prior incomplete attachment'), { status: 503 });
  } else if (existingResponse.status !== 404) {
    throw Object.assign(new Error('SharePoint could not verify the attachment destination'), { status: 503 });
  }

  const createResponse = await graphSharePointRequest(env, `${path}:/createUploadSession`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ item: { name: expectedName, '@microsoft.graph.conflictBehavior': 'fail' } })
  });
  if (!createResponse.ok) throw Object.assign(new Error('SharePoint could not create the job-card attachment upload session'), { status: 503 });
  let graphSession;
  try { graphSession = await createResponse.json(); } catch (_) { graphSession = null; }
  const uploadUrl = text(graphSession?.uploadUrl, '', 5000);
  const expiresAt = text(graphSession?.expirationDateTime, '', 80);
  if (!uploadUrl || !/^https:\/\//i.test(uploadUrl) || !Number.isFinite(Date.parse(expiresAt))) {
    throw Object.assign(new Error('SharePoint returned an invalid attachment upload session'), { status: 503 });
  }

  try {
    const chunkBytes = 10 * 1024 * 1024;
    let item = null;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
      const end = Math.min(offset + chunkBytes, bytes.byteLength);
      const chunk = bytes.slice(offset, end);
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.byteLength),
          'Content-Range': `bytes ${offset}-${end - 1}/${bytes.byteLength}`,
          'Content-Type': 'application/octet-stream'
        },
        body: chunk
      });
      if (!response.ok) throw Object.assign(new Error('SharePoint could not store the job-card attachment'), { status: 503 });
      if (end === bytes.byteLength) {
        try { item = await response.json(); } catch (_) { item = null; }
      }
    }
    if (!item?.id) throw Object.assign(new Error('SharePoint did not confirm the uploaded attachment'), { status: 503 });
    return item;
  } catch (error) {
    try { await fetch(uploadUrl, { method: 'DELETE' }); } catch (_) {}
    throw error;
  }
}

async function deleteGraphSharePointItem(env, itemId) {
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  return response.ok || response.status === 404;
}

async function cleanupDuplicateJobCardAttachmentObject(env, session) {
  const itemId = text(session?.orphan_item_id, '', 500);
  if (!itemId) return;
  if (!await deleteGraphSharePointItem(env, itemId)) {
    throw Object.assign(new Error('SharePoint could not remove the duplicate attachment object'), { status: 503 });
  }
  await env.DB.prepare(`UPDATE job_card_attachment_upload_sessions SET orphan_item_id=NULL
    WHERE attachment_id=? AND status='duplicate' AND orphan_item_id=?`).bind(session.attachment_id, itemId).run();
}

async function cleanupDuplicateJobCardAttachmentObjectsForTarget(env, targetAttachmentId) {
  const result = await env.DB.prepare(`SELECT attachment_id, orphan_item_id FROM job_card_attachment_upload_sessions
    WHERE duplicate_of=? AND status='duplicate' AND orphan_item_id IS NOT NULL`).bind(targetAttachmentId).all();
  for (const session of result.results || []) await cleanupDuplicateJobCardAttachmentObject(env, session);
}

async function jobCardAttachmentUploadEndpoint(request, env, identity, recordId, attachmentId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId, { write: true });
  const session = await getJobCardAttachmentUploadSession(env, record.record_id, attachmentId);
  if (session.status === 'complete' || session.status === 'duplicate') {
    if (session.status === 'duplicate') await cleanupDuplicateJobCardAttachmentObject(env, session);
    const completed = await completeJobCardAttachmentUpload(env, session, null);
    const attachment = (await listJobCardAttachments(env, record.record_id)).find((item) => item.attachment_id === completed.attachment.attachment_id);
    return json({ ok: true, attachment, duplicate: completed.duplicate }, 200, origin || '');
  }
  if (session.status !== 'uploading') throw Object.assign(new Error('Attachment upload session is no longer active'), { status: 410 });
  if (Date.parse(session.expires_at) <= Date.now()) {
    await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    throw Object.assign(new Error('Attachment upload session expired; select the file again to retry'), { status: 410 });
  }
  if (!session.expected_path) throw Object.assign(new Error('Attachment upload session is incomplete'), { status: 409 });

  const bytes = await readJobCardAttachmentBytes(request, session);
  const folderPath = session.expected_path.split('/').slice(0, -1).join('/');
  await ensureSharePointFolder(env, folderPath);
  const item = await uploadJobCardAttachmentToSharePoint(env, session, bytes);

  let result;
  try {
    result = await completeJobCardAttachmentUpload(env, session, item);
  } catch (error) {
    if (Number(error?.status) === 409 && item?.id) {
      if (await deleteGraphSharePointItem(env, item.id)) await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    }
    throw error;
  }
  if (result.duplicate) {
    const duplicateSession = await getJobCardAttachmentUploadSession(env, record.record_id, session.attachment_id);
    await cleanupDuplicateJobCardAttachmentObject(env, duplicateSession);
  }
  const attachment = (await listJobCardAttachments(env, record.record_id)).find((entry) => entry.attachment_id === result.attachment.attachment_id);
  return json({ ok: true, attachment, duplicate: result.duplicate }, 200, origin || '');
}

async function jobCardAttachmentCompleteEndpoint(env, identity, recordId, attachmentId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId, { write: true });
  const session = await getJobCardAttachmentUploadSession(env, record.record_id, attachmentId);
  if (session.status === 'complete' || session.status === 'duplicate') {
    if (session.status === 'duplicate') await cleanupDuplicateJobCardAttachmentObject(env, session);
    const completed = await completeJobCardAttachmentUpload(env, session, null);
    return json({ ok: true, attachment: (await listJobCardAttachments(env, record.record_id)).find((item) => item.attachment_id === completed.attachment.attachment_id), duplicate: completed.duplicate }, 200, origin || '');
  }
  if (session.status === 'uploading' && Date.parse(session.expires_at) <= Date.now()) {
    await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    throw Object.assign(new Error('Attachment upload session expired; select the file again to retry'), { status: 410 });
  }
  if (session.status === 'uploading') {
    throw Object.assign(new Error('Upload the file through the authenticated content route before completing the attachment'), { status: 409 });
  }
  throw Object.assign(new Error('Attachment upload session is no longer active'), { status: 410 });
}

async function jobCardAttachmentContentEndpoint(env, identity, recordId, attachmentId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId);
  const attachment = await getJobCardAttachment(env, record.record_id, attachmentId);
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(attachment.sharepoint_item_id)}/content`);
  if (!response.ok) throw Object.assign(new Error('Job-card attachment could not be retrieved'), { status: response.status === 404 ? 404 : 503 });
  const filename = encodeURIComponent(attachment.file_name).replace(/[!'()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return new Response(response.body, { status: 200, headers: {
    'content-type': attachment.content_type,
    'content-length': String(attachment.size_bytes),
    'content-disposition': `inline; filename*=UTF-8''${filename}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-frame-options': 'SAMEORIGIN',
    ...(origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {})
  } });
}

async function graphFileBytes(response, limit = 20 * 1024 * 1024) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw Object.assign(new Error('Archived file is too large to retrieve'), { status: 413 });
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw Object.assign(new Error('Archived file is too large to retrieve'), { status: 413 }); }
    chunks.push(part.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function listEstimateArchiveEndpoint(request, env, origin) {
  const url = new URL(request.url);
  const result = await queryEstimateArchive(env, {
    q: url.searchParams.get('q'), estimateNumber: url.searchParams.get('estimateNumber'),
    customer: url.searchParams.get('customer'), email: url.searchParams.get('email'),
    reference: url.searchParams.get('reference'), from: url.searchParams.get('from'),
    to: url.searchParams.get('to'), state: url.searchParams.get('state'),
    relatedJobId: url.searchParams.get('relatedJobId'), relatedInvoice: url.searchParams.get('relatedInvoice'),
    cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit')
  });
  return json(result, 200, origin || '');
}

async function estimateArchiveDetailEndpoint(env, origin, archiveId) {
  const row = await env.DB.prepare(`SELECT id, canonical_id, source_kind, classification_state, message_direction,
    mailbox, sender_email, recipient_emails,
    subject, customer_display AS customer, customer_email, estimate_number, reference, sent_at,
    received_at
    FROM archive_messages WHERE id = ?`).bind(archiveId).first();
  if (!row) throw Object.assign(new Error('Archive message not found'), { status: 404 });
  const conversationId = await env.DB.prepare('SELECT conversation_id FROM archive_messages WHERE id = ?').bind(archiveId).first();
  const attachments = await env.DB.prepare(`SELECT id, source_attachment_id, file_name, mime_type,
    size_bytes, sha256 FROM archive_attachments WHERE message_id = ? ORDER BY created_at, id`).bind(archiveId).all();
  const associations = await env.DB.prepare(`SELECT id, target_kind, target_id, target_reference,
    relationship, confidence, state, provenance_kind, evidence_json, created_by, created_at, updated_at
    FROM archive_associations WHERE message_id = ? ORDER BY created_at, id`).bind(archiveId).all();
  let recipients = [];
  try { recipients = JSON.parse(row.recipient_emails || '[]'); } catch (_) {}
  let sourceCopies = [];
  try {
    const sources = await env.DB.prepare(`SELECT DISTINCT mailbox FROM estimate_mail_sources WHERE canonical_id = ? ORDER BY mailbox`).bind(row.canonical_id).all();
    sourceCopies = (sources.results || []).map((source) => ({ mailbox: source.mailbox }));
  } catch (_) { sourceCopies = []; }
  let conversation = [];
  if (conversationId?.conversation_id) {
    const result = await env.DB.prepare(`SELECT id, source_kind, classification_state, message_direction,
      mailbox, subject, sender_email, sent_at, received_at FROM archive_messages WHERE conversation_id = ?
      ORDER BY COALESCE(NULLIF(sent_at, ''), received_at), id LIMIT 500`).bind(conversationId.conversation_id).all();
    conversation = result.results || [];
  }
  // Exact, confirmed job/estimate associations make distinct mail threads for
  // the same work discoverable from one archive detail view.
  const relatedThreads = await env.DB.prepare(`SELECT DISTINCT m.id, m.source_kind, m.classification_state, m.message_direction,
      m.mailbox, m.subject, m.sender_email, m.sent_at, m.received_at
    FROM archive_associations base
    JOIN archive_associations related ON related.target_kind=base.target_kind AND related.target_id=base.target_id
    JOIN archive_messages m ON m.id=related.message_id
    WHERE base.message_id=? AND base.state='confirmed' AND base.target_kind IN ('job-card','estimate')
      AND related.state='confirmed' AND m.id<>?
    ORDER BY COALESCE(NULLIF(m.sent_at,''),m.received_at),m.id LIMIT 500`).bind(archiveId, archiveId).all();
  if (relatedThreads.results?.length) {
    const seen = new Set(conversation.map((item) => item.id));
    for (const item of relatedThreads.results) if (!seen.has(item.id)) { conversation.push(item); seen.add(item.id); }
    conversation.sort((a, b) => String(a.sent_at || a.received_at).localeCompare(String(b.sent_at || b.received_at)) || a.id.localeCompare(b.id));
  }
  if (conversation.length) {
    const placeholders = conversation.map(() => '?').join(',');
    const threadFiles = await env.DB.prepare(`SELECT id, message_id, file_name, mime_type, size_bytes FROM archive_attachments WHERE message_id IN (${placeholders}) ORDER BY created_at, id`).bind(...conversation.map((item) => item.id)).all();
    const filesByMessage = new Map();
    for (const item of threadFiles.results || []) {
      const values = filesByMessage.get(item.message_id) || [];
      values.push({ id: item.id, file_name: item.file_name, mime_type: item.mime_type, size_bytes: item.size_bytes });
      filesByMessage.set(item.message_id, values);
    }
    conversation = conversation.map((item) => ({ ...item, attachments: filesByMessage.get(item.id) || [] }));
  }
  const safeAttachments = (attachments.results || []).map(({ id, file_name, mime_type, size_bytes }) => ({ id, file_name, mime_type, size_bytes }));
  const safeAssociations = (associations.results || []).map(({ target_kind, target_id, target_reference, relationship, confidence, state }) => ({
    target_kind, target_reference, relationship, confidence, state,
    ...(target_kind === 'job-card' || target_kind === 'estimate' ? { target_id } : {})
  }));
  const { canonical_id: _canonicalId, ...safeMessage } = row;
  return json({ message: { ...safeMessage, recipient_emails: Array.isArray(recipients) ? recipients : [] }, sourceCopies, attachments: safeAttachments, associations: safeAssociations, conversation }, 200, origin || '');
}

async function estimateArchiveContentEndpoint(env, archiveId, contentId, origin = '') {
  let file;
  if (contentId === 'eml') {
    const row = await env.DB.prepare(`SELECT sharepoint_eml_item_id AS item_id, 'message.eml' AS file_name,
      'message/rfc822' AS mime_type FROM archive_messages WHERE id = ?`).bind(archiveId).first();
    if (!row || !row.item_id) throw Object.assign(new Error('Archived message content is not available'), { status: 404 });
    file = row;
  } else {
    file = await env.DB.prepare(`SELECT a.sharepoint_item_id AS item_id, a.file_name, a.mime_type
      FROM archive_attachments a WHERE a.id = ? AND a.message_id = ?`).bind(contentId, archiveId).first();
    if (!file || !file.item_id) throw Object.assign(new Error('Archived attachment is not available'), { status: 404 });
  }
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(file.item_id)}/content`);
  if (!response.ok) throw Object.assign(new Error('Archived content could not be retrieved'), { status: response.status === 404 ? 404 : 503 });
  const bytes = await graphFileBytes(response);
  const name = archiveFilename(file.file_name);
  // EML is always downloaded as an attachment; HTML and other active content
  // are never rendered inline inside the portal origin.
  const mime = contentId === 'eml' || /(?:text\/html|application\/xhtml)/i.test(file.mime_type || '')
    ? (contentId === 'eml' ? 'message/rfc822' : 'application/octet-stream')
    : text(file.mime_type, 'application/octet-stream', 120).replace(/[\r\n;]/g, '');
  return new Response(bytes, { status: 200, headers: {
    'content-type': mime, 'content-length': String(bytes.byteLength),
    'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    'x-frame-options': 'DENY', ...(origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {})
  } });
}

async function createAppEstimateEndpoint(request, env, identity, origin) {
  const body = await readJson(request);
  const fileName = archiveFilename(body.fileName || body.file_name);
  const contentType = text(body.contentType || body.content_type, 'application/pdf', 120).replace(/[\r\n;]/g, '');
  const base64 = String(body.contentBase64 || body.content_base64 || '');
  if (!base64 || base64.length > 1_450_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw Object.assign(new Error('Estimate document is missing or too large'), { status: 400 });
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  if (!bytes.byteLength || bytes.byteLength > 1_000_000) throw Object.assign(new Error('Estimate document is missing or too large'), { status: 400 });
  const sourceRecordId = text(body.source_record_id || body.sourceRecordId, '', 240);
  if (!sourceRecordId) throw Object.assign(new Error('source_record_id is required for idempotent estimate filing'), { status: 400 });
  const sourceRecord = await env.DB.prepare('SELECT record_id, owner_oid, kind FROM records WHERE record_id = ?').bind(sourceRecordId).first();
  if (!sourceRecord || sourceRecord.kind !== 'estimates' || sourceRecord.owner_oid !== identity.oid) {
    throw Object.assign(new Error('Estimate record not found'), { status: 404 });
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const contentHash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const identityBytes = new TextEncoder().encode(`${sourceRecordId}\0${contentHash}`);
  const recipients = body.recipient_emails || body.recipientEmails || body.to || [];
  const metadataFingerprint = JSON.stringify({
    estimate_number: text(body.estimate_number || body.estimateNumber, '', 500),
    customer: text(body.customer || body.client || body.client_company, '', 1000),
    customer_email: text(body.customer_email || body.customerEmail || body.client_email, '', 320).toLowerCase(),
    reference: text(body.reference || body.job_reference, '', 500),
    subject: text(body.subject, '', 1000),
    mailbox: text(body.mailbox || body.source_mailbox, '', 320).toLowerCase(),
    recipient_emails: (Array.isArray(recipients) ? recipients : String(recipients).split(/[;,\s]+/))
      .map((value) => text(value, '', 320).toLowerCase()).filter(Boolean).sort(),
    message_direction: text(body.message_direction || body.direction, '', 16),
    conversation_id: text(body.conversation_id || body.conversationId, '', 1000),
    sent_at: text(body.sent_at || body.sentAt, '', 80),
    received_at: text(body.received_at || body.receivedAt, '', 80)
  });
  const identityDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${new TextDecoder().decode(identityBytes)}\0${metadataFingerprint}`)));
  const documentId = [...identityDigest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const canonicalId = `app:${documentId}`;
  const existing = await env.DB.prepare(`SELECT m.id, a.id AS attachment_id FROM archive_messages m
    LEFT JOIN archive_attachments a ON a.message_id=m.id AND a.source_attachment_id=?
    WHERE m.canonical_id=? LIMIT 1`).bind(documentId, canonicalId).first();
  if (existing?.id && existing?.attachment_id) return json({ ok: true, id: existing.id, attachment_id: existing.attachment_id, duplicate: true }, 200, origin || '');
  const archiveInput = normalizeEstimateArchiveRecord({
    ...body, id: documentId, canonical_id: canonicalId, source_kind: 'app',
    source_message_id: documentId, classification_state: 'confirmed', sender_email: identity.upn,
    sent_at: text(body.sent_at || body.sentAt, now(), 80), received_at: text(body.received_at || body.receivedAt, now(), 80),
    content_sha256: contentHash,
    provenance: { source: 'portal-app', source_record_id: sourceRecordId, created_by_oid: identity.oid, created_by_upn: identity.upn }
  });
  const extension = fileName.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] || '';
  // Portal-generated client estimates have their own SharePoint folder. The
  // authenticated email-ingestion flow continues to use Estimates/Incoming.
  const path = `/root:/Estimates/Sent%20from%20Portal/${contentHash}${encodeURIComponent(extension)}:/content`;
  const uploaded = await graphSharePointRequest(env, path, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes });
  if (!uploaded.ok) throw Object.assign(new Error('Estimate document could not be archived'), { status: 503 });
  const item = await uploaded.json();
  const saved = await upsertEstimateArchive(env, { ...archiveInput, sharepoint_manifest_item_id: text(item.id, '', 500), provenance: JSON.parse(archiveInput.provenance_json) });
  const savedAssociations = await deriveArchiveAssociations(env, saved.id, {
    sourceRecordId, estimateNumber: archiveInput.estimate_number, reference: archiveInput.reference,
    invoiceNumber: text(body.invoice_number || body.invoiceNumber, '', 500)
  });
  const attachmentId = existing?.attachment_id || crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO archive_attachments
    (id, message_id, source_attachment_id, file_name, mime_type, size_bytes, sha256, sharepoint_item_id, provenance_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id, source_attachment_id) DO UPDATE SET
      file_name=excluded.file_name, mime_type=excluded.mime_type, size_bytes=excluded.size_bytes,
      sha256=excluded.sha256, sharepoint_item_id=excluded.sharepoint_item_id, provenance_json=excluded.provenance_json`)
    .bind(attachmentId, saved.id, documentId, fileName, contentType, bytes.byteLength, contentHash, text(item.id, '', 500), JSON.stringify({ source: 'portal-app', source_record_id: sourceRecordId, created_by_oid: identity.oid })).run();
  return json({ ok: true, id: saved.id, attachment_id: attachmentId, associations: publicArchiveAssociations(savedAssociations) }, 201, origin || '');
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

function projectRow(row, includeDetails = true, env = null, payPeriods = defaultPayPeriods()) {
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
    can_edit: row.kind === 'timesheets' && isCurrentPayMonthRecord(row, 'Europe/London', new Date(), payPeriods),
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

function documentImportRoster(env) {
  return staffDirectory({STAFF_DIRECTORY_JSON:JSON.stringify([...staffDirectory(env),...staffDirectory({STAFF_DIRECTORY_JSON:env.DOCUMENT_IMPORT_DIRECTORY_JSON})])});
}
async function documentImportOwner(identity,data,roster,env) {
  const upn=resolveRosterUpn(data,roster);
  return resolveImportOwnerFromDatabase(identity,upn,roster,env.DB,async requested=>{
    const graphToken=await sharePointGraphToken(env);
    const response=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(requested)}?$select=id,userPrincipalName`,{headers:{authorization:`Bearer ${graphToken}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Directory lookup unavailable');
    const user=await response.json();return {oid:user?.id,upn:user?.userPrincipalName};
  });
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
  const unpaidAbsence = /^un-paid$/i.test(absenceStatus.trim());
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
  if (unpaidAbsence) {
    workedMinutes = 0;
    calculationSource = 'unpaid absence';
  } else if (!/^(?:na|n\/a|none|no absence|not applicable)$/i.test(absenceStatus.trim())) {
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
    basicHours: unpaidAbsence ? 0 : basicHours,
    ot15Hours: unpaidAbsence ? 0 : ot15Hours,
    ot20Hours: unpaidAbsence ? 0 : ot20Hours,
    weightedHours: unpaidAbsence ? 0 : numericUpstreamValue(upstreamObjectValue(row, ['weightedHours', 'weighted_hours'])),
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

// Read the list with the portal's own service identity. Never forward a
// browser's Flow token or trust a continuation URL outside this exact list.
async function readSharePointHistory(env, identity) {
  const site = text(env.SHAREPOINT_SITE_ID, '', 500);
  const list = text(env.SHAREPOINT_TIMESHEET_LIST_ID, '', 120);
  if (!site || !/^[a-z0-9-]+$/i.test(list)) throw new Error('SharePoint history is not configured');
  const expectedPath = `/v1.0/sites/${encodeURIComponent(site)}/lists/${encodeURIComponent(list)}/items`;
  let historyStage = 'authentication';
  try {
    const token = await sharePointGraphToken(env);
    let url = `https://graph.microsoft.com${expectedPath}?$expand=fields&$top=100`;
    const visited = new Set();
    const records = [];
    const mayViewAll = identity?.isSubmissionAdmin === true || identity?.isTimesheetViewer === true;
    for (let page = 0; url; page += 1) {
      historyStage = 'continuation';
      if (page >= 100 || visited.has(url)) throw new Error('SharePoint history pagination is incomplete');
      let parsed;
      try { parsed = new URL(url); } catch (_) { throw new Error('Invalid SharePoint history continuation'); }
      if (parsed.protocol !== 'https:' || parsed.host !== 'graph.microsoft.com' || parsed.username || parsed.password || parsed.hash || decodeURIComponent(parsed.pathname) !== decodeURIComponent(expectedPath)) {
        throw new Error('Invalid SharePoint history continuation');
      }
      visited.add(url);
      historyStage = 'request';
      const response = await fetch(url, { redirect: 'manual', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      if (!response.ok) throw Object.assign(new Error(`SharePoint history is unavailable (HTTP ${response.status})`), { status: 503, publicMessage: `SharePoint history is unavailable (HTTP ${response.status})` });
      historyStage = 'response';
      const body = await response.json();
      if (!body || !Array.isArray(body.value)) throw new Error('Invalid SharePoint history response');
      historyStage = 'mapping';
      for (const item of body.value) {
        const fields = item?.fields;
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
        let owner = text(fields.Employee_x0020_Email || fields.EmployeeEmail || fields.employee_email, '', 320).toLowerCase();
        if (!mayViewAll) {
          const name = text(fields.EmployeeName || fields.employee_name, '', 240).toLowerCase();
          if (!owner && name) {
            // A unique name is only a routing candidate. Before release the
            // source must also carry an explicit, matching employee address.
            const matches = [...staffDirectory(env), ...historicalEmployeeAliases(env)]
              .filter((entry) => entry.name.toLowerCase() === name && entry.upn)
              .map((entry) => entry.upn);
            const unique = [...new Set(matches)];
            if (unique.length === 1) owner = unique[0];
          }
          if (!owner || owner !== text(identity?.upn, '', 320).toLowerCase()) continue;
          const source = upstreamPayloadAndRows(fields);
          const embedded = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload) ? source.payload : {};
          const ownerValues = [embedded.employeeEmail, embedded.employee_email, ...(source.rows || []).flatMap((row) => [row?.employeeEmail, row?.employee_email])].filter(Boolean);
          if (ownerValues.some((value) => text(value, '', 320).toLowerCase() !== owner)) continue;
          const nameValues = [embedded.employeeName, embedded.employee_name, ...(source.rows || []).flatMap((row) => [row?.employeeName, row?.employee_name])].filter(Boolean);
          if (name && nameValues.some((value) => text(value, '', 240).toLowerCase() !== name)) continue;
        }
        const mapped = normaliseUpstreamRecord(fields, identity, env);
        if (!mapped || mapped.synthetic || !canReadHistoryRecord(identity, mapped)) continue;
        if (!mayViewAll && !upstreamEmployeeClaimsAgree(fields, mapped)) continue;
        if (!mayViewAll && mapped.payload) mapped.payload = { rows: mapped.payload.rows || [] };
        records.push(mapped);
      }
      const next = body['@odata.nextLink'];
      if (next !== undefined && next !== null && typeof next !== 'string') throw new Error('Invalid SharePoint history continuation');
      url = next || '';
    }
    return { records, pages: visited.size };
  } catch (error) {
    if (error && typeof error === 'object') error.historyStage = historyStage;
    throw error;
  }
}

function flattenUpstreamRecord(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  // SharePoint Get items sometimes wraps the actual columns in `fields` (and
  // a few older flow versions used `item`/`properties`). Flatten those
  // envelopes before looking for the canonical column names. Keep top-level
  // values authoritative when both shapes are present.
  const nested = ['fields', 'Fields', 'item', 'Item', 'properties', 'Properties']
    .map((key) => row[key])
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    .reduce((merged, value) => Object.assign(merged, value), {});
  return Object.keys(nested).length ? { ...nested, ...row } : row;
}

// Do not release a multi-person attachment just because its outer header
// names the requesting employee. All explicit employee claims must agree.
function upstreamEmployeeClaimsAgree(sourceRow, mapped) {
  const row = flattenUpstreamRecord(sourceRow);
  if (!row || !mapped?.employee_upn) return false;
  const { payload } = upstreamPayloadAndRows(row);
  const headerName = text(upstreamValue(row, ['employee_name', 'employeeName', 'EmployeeName', 'Employee Name', 'employee', 'Employee', 'gmt_employee']) || mapped.employee_name, '', 240).toLowerCase();
  const objects = [row, payload, ...collectUpstreamDailyRows(payload)].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const emailKeys = new Set(['employeeupn', 'employeeemail', 'gmtemployeeupn']);
  const nameKeys = new Set(['employeename', 'gmtemployee']);
  let hasExplicitOwner=false;
  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) {
      const normalizedKey = key.toLowerCase().replace(/_x0020_/g, '').replace(/[_\s]/g, '');
      if ((emailKeys.has(normalizedKey) || (object===row && normalizedKey==='email')) && text(value, '', 320)) {
        if (text(value, '', 320).toLowerCase() !== mapped.employee_upn.toLowerCase()) return false;
        hasExplicitOwner=true;
      }
      if (object !== row && nameKeys.has(normalizedKey) && text(value, '', 240) && headerName && text(value, '', 240).toLowerCase() !== headerName) return false;
    }
  }
  return hasExplicitOwner;
}

function normaliseUpstreamRecord(row, identity, env) {
  row = flattenUpstreamRecord(row);
  if (!row) return null;
  const title = upstreamValue(row, ['title', 'Title', 'subject', 'Subject']);
  const titleDetails = historyTitleDetails(title);
  const directory = staffDirectory(env);
  const explicitName = upstreamValue(row, ['employee_name', 'employeeName', 'EmployeeName', 'Employee Name', 'employee', 'Employee', 'gmt_employee']);
  const explicitEmail = upstreamValue(row, ['employee_upn', 'employeeUpn', 'employeeEmail', 'employee_email', 'EmployeeEmail', 'Employee Email', 'Employee_x0020_Email', 'email', 'Email', 'gmt_employee_upn']);
  const initialName = text(explicitName || titleDetails.name, '', 240);
  const initialEmail = text(explicitEmail, '', 320).toLowerCase();
  const directoryEntry = directoryEntryFor(directory, initialName, initialEmail)
    || directoryEntryFor(historicalEmployeeAliases(env), initialName, initialEmail);
  // A history source may return rows belonging to several staff members.
  // Missing source identity must never be filled from the requesting viewer.
  const employeeName = text(directoryEntry?.name || initialName, '', 240);
  const employeeUpn = text(directoryEntry?.upn || initialEmail, '', 320).toLowerCase();
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
  const excludedRosterUpns = csvSet(env.TIMESHEET_ROSTER_EXCLUDED_UPNS);
  const isExcludedFromExpectedRoster = (record) => {
    const upn = text(record.employee_upn || record.employeeEmail || record.employee_email, '', 320).toLowerCase();
    if (upn && excludedRosterUpns.has(upn)) return true;
    const name = text(record.employee_name || record.employeeName, '', 240);
    const directoryEntry = directoryEntryFor(directory, name, upn);
    return Boolean(directoryEntry?.upn && excludedRosterUpns.has(directoryEntry.upn));
  };
  const identities = new Map();
  directory.filter((entry) => !excludedRosterUpns.has(entry.upn)).forEach((entry) => {
    identities.set(entry.upn || entry.name.toLowerCase(), { ...entry, configured: true });
  });
  records.filter(timesheetRecord).forEach((record) => {
    if (isExcludedFromExpectedRoster(record)) return;
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
        scope: upstreamHistoryScope(identity),
        employeeEmail: identity.upn
      }),
      signal: AbortSignal.timeout(15000),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
  }
  return response;
}

function upstreamHistoryScope(identity) {
  return identity && (identity.isAdmin || identity.isTimesheetViewer || identity.isSubmissionAdmin) ? 'all' : 'own';
}

function sameRecord(a, b) {
  return a.owner_oid === b.ownerOid && a.owner_upn === b.ownerUpn && a.employee_name === b.employeeName && a.kind === b.kind && a.action === b.action && a.status === b.status && (a.start_date || '') === b.startDate && (a.end_date || '') === b.endDate && (a.record_date || '') === b.recordDate && a.issue === b.issue && a.payload_json === b.payloadJson;
}

export async function saveReviewedPayMonth(env,input,identity,existing,guard) {
  const key=guard.employeeUpn.toLowerCase(),revision=guard.localRevision;
  if(input.kind!=='timesheets'||input.action!=='pay_month_correction'||!input.ownerOid||String(input.ownerUpn||'').toLowerCase()!==key||!Number.isSafeInteger(revision)||revision<0)throw Object.assign(new Error('The reviewed timesheet target is invalid.'),{status:400});
  let revisionCheck="COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0)=? AND NOT EXISTS (SELECT 1 FROM dispatch_queue WHERE record_id=? AND status IN ('sending','sent','failed','uncertain')) AND NOT EXISTS (SELECT 1 FROM dispatch_queue q JOIN records r ON r.record_id=q.record_id WHERE lower(r.owner_upn)=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.record_id<>? AND q.status IN ('queued','sending','sent','failed','uncertain')) AND (?=1 OR NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=?))";
  revisionCheck+=` AND NOT EXISTS (SELECT 1 FROM records identity_source WHERE identity_source.kind IN ('timesheets','clock') AND identity_source.status<>'Deleted'
    AND ((lower(identity_source.owner_oid)=? AND lower(identity_source.owner_upn)<>?) OR (lower(identity_source.owner_upn)=? AND lower(identity_source.owner_oid)<>?)))`;
  const oid=String(input.ownerOid).toLowerCase();
  const reviewArgs=[identity.isSubmissionAdmin === true || (identity.isAdmin === true && identity.isTimesheetViewer === true) ? 1 : 0,input.recordId,oid,key,key,oid];
  if (guard.reviewEventWatermark !== undefined) {
    if (!Number.isSafeInteger(guard.reviewEventWatermark) || guard.reviewEventWatermark < 0 || !guard.ownerOid) throw Object.assign(new Error('The reviewed timesheet target is invalid.'),{status:400});
    revisionCheck+=" AND COALESCE((SELECT MAX(e.event_id) FROM timesheet_ownership_review_events e JOIN timesheet_ownership_reviews review ON review.review_id=e.review_id WHERE lower(review.subject_oid)=?),0)=?";
    reviewArgs.push(String(guard.ownerOid).toLowerCase(),guard.reviewEventWatermark);
    revisionCheck+=" AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records source ON source.record_id=review.record_id WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?)";
    reviewArgs.push(String(guard.ownerOid).toLowerCase(),key);
  }
  if(!existing){
    try {
      const result=await env.DB.prepare(`INSERT INTO records (record_id,owner_oid,owner_upn,employee_name,kind,action,status,start_date,end_date,record_date,submitted_at,updated_at,issue,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${revisionCheck}`)
        .bind(input.recordId,input.ownerOid,input.ownerUpn,input.employeeName,input.kind,input.action,input.status,input.startDate,input.endDate,input.recordDate,input.submittedAt,input.updatedAt,input.issue,input.payloadJson,key,revision,input.recordId,key,input.recordId,...reviewArgs).run();
      // D1 counts trigger writes in meta.changes. The primary-key insert can
      // affect at most one record, so any positive count means it succeeded.
      if(Number(result?.meta?.changes||0)<1)throw Object.assign(new Error('The timesheet changed or an earlier workbook is awaiting delivery. Refresh and check its status before trying again.'),{status:409});
      return {created:true,changed:false};
    } catch(error){if(error?.status)throw error;if(/unique|constraint/i.test(String(error?.message||'')))throw Object.assign(new Error('The timesheet changed during review. Refresh and try again.'),{status:409});throw error;}
  }
  if(String(existing.owner_upn||'').toLowerCase()!==key||existing.action!=='pay_month_correction')throw Object.assign(new Error('The reviewed correction target is invalid.'),{status:409});
  const oldPayload=JSON.stringify({employee_name:existing.employee_name,kind:existing.kind,action:existing.action,status:existing.status,start_date:existing.start_date,end_date:existing.end_date,record_date:existing.record_date,submitted_at:existing.submitted_at,updated_at:existing.updated_at,issue:existing.issue,payload:payloadObject(existing)});
  const version=env.DB.prepare(`INSERT INTO record_versions (record_id,owner_oid,payload_json,changed_at,changed_by_oid) SELECT ?,?,?,?,? WHERE ${revisionCheck}`).bind(existing.record_id,existing.owner_oid,oldPayload,now(),identity.oid,key,revision,input.recordId,key,input.recordId,...reviewArgs);
  const update=env.DB.prepare(`UPDATE records SET owner_upn=?,employee_name=?,kind=?,action=?,status=?,start_date=?,end_date=?,record_date=?,submitted_at=?,updated_at=?,issue=?,payload_json=? WHERE record_id=? AND owner_oid=? AND ${revisionCheck}`).bind(input.ownerUpn,input.employeeName,input.kind,input.action,input.status,input.startDate,input.endDate,input.recordDate,input.submittedAt,input.updatedAt,input.issue,input.payloadJson,input.recordId,existing.owner_oid,key,revision,input.recordId,key,input.recordId,...reviewArgs);
  const retire=env.DB.prepare("UPDATE dispatch_queue SET status='skipped',updated_at=?,last_error='Superseded by a newer correction; awaiting its workbook.' WHERE record_id=? AND status='queued' AND changes()=1").bind(now(),input.recordId);
  const result=await env.DB.batch([version,update,retire]);
  if(Number(result?.[1]?.meta?.changes||0)<1)throw Object.assign(new Error('The timesheet changed or an earlier workbook is awaiting delivery. Refresh and check its status before trying again.'),{status:409});
  return {created:false,changed:true};
}

async function saveRecord(env, input, identity, existing = null) {
  const changed = existing && !sameRecord(existing, input);
  const writeVersion = async () => env.DB.prepare('INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid) VALUES (?, ?, ?, ?, ?)')
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
  if (!existing) {
    await env.DB.prepare(`INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date, record_date, submitted_at, updated_at, issue, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.recordId, input.ownerOid, input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson).run();
    return { created: true, changed: false };
  }
  if (['calendar', 'tasks'].includes(canonicalKind(existing.kind))) {
    const result = await env.DB.prepare(`UPDATE records SET owner_upn = ?, employee_name = ?, kind = ?, action = ?, status = ?, start_date = ?, end_date = ?, record_date = ?, submitted_at = ?, updated_at = ?, issue = ?, payload_json = ? WHERE record_id = ? AND owner_oid = ? AND status = ?`)
      .bind(input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson, input.recordId, existing.owner_oid, existing.status).run();
    if (Number(result?.meta?.changes ?? 0) < 1) {
      throw Object.assign(new Error('The request changed while it was being saved. Refresh the calendar and try again.'), { status: 409 });
    }
    if (changed) await writeVersion();
    return { created: false, changed };
  }
  if (existing.kind === 'timesheets') {
    const update=env.DB.prepare(`UPDATE records SET owner_upn=?,employee_name=?,kind=?,action=?,status=?,start_date=?,end_date=?,record_date=?,submitted_at=?,updated_at=?,issue=?,payload_json=?
      WHERE record_id=? AND owner_oid IS ? AND owner_upn IS ? AND employee_name IS ? AND kind IS ? AND action IS ? AND status IS ?
        AND start_date IS ? AND end_date IS ? AND record_date IS ? AND submitted_at IS ? AND updated_at IS ? AND issue IS ? AND payload_json IS ?
        AND (?=1 OR NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=records.record_id))`)
      .bind(input.ownerUpn,input.employeeName,input.kind,input.action,input.status,input.startDate,input.endDate,input.recordDate,input.submittedAt,input.updatedAt,input.issue,input.payloadJson,
        input.recordId,existing.owner_oid,existing.owner_upn,existing.employee_name,existing.kind,existing.action,existing.status,existing.start_date??null,existing.end_date??null,
        existing.record_date??null,existing.submitted_at,existing.updated_at,existing.issue??null,existing.payload_json,
        identity.isSubmissionAdmin === true || (identity.isAdmin === true && identity.isTimesheetViewer === true) ? 1 : 0);
    const statements=[update];
    if (changed) {
      const prior=JSON.stringify({employee_name:existing.employee_name,kind:existing.kind,action:existing.action,status:existing.status,
        start_date:existing.start_date,end_date:existing.end_date,record_date:existing.record_date,submitted_at:existing.submitted_at,
        updated_at:existing.updated_at,issue:existing.issue,payload:payloadObject(existing)});
      statements.push(env.DB.prepare('INSERT INTO record_versions (record_id,owner_oid,payload_json,changed_at,changed_by_oid) SELECT ?,?,?,?,? WHERE changes()=1')
        .bind(existing.record_id,existing.owner_oid,prior,now(),identity.oid));
    }
    const result=await env.DB.batch(statements);
    if (Number(result?.[0]?.meta?.changes || 0)<1) throw Object.assign(new Error('The timesheet changed or needs ownership review. Refresh before editing.'),{status:409});
    return {created:false,changed};
  }
  if (changed) await writeVersion();
  await env.DB.prepare(`UPDATE records SET owner_upn = ?, employee_name = ?, kind = ?, action = ?, status = ?, start_date = ?, end_date = ?, record_date = ?, submitted_at = ?, updated_at = ?, issue = ?, payload_json = ? WHERE record_id = ?`)
    .bind(input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson, input.recordId).run();
  return { created: false, changed };
}

async function deleteRecord(env, existing, identity) {
  validatePortalRequestDeletion(existing);
  const deletableStatuses = new Set(['draft', 'pending delivery', 'delivery failed']);
  if (!identity.isAdmin && !deletableStatuses.has(String(existing.status || '').toLowerCase())) {
    throw Object.assign(new Error('Submitted records cannot be deleted'), { status: 409 });
  }
  const previousVersion = JSON.stringify({
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
    });
  if (existing.kind === 'timesheets') {
    // A delivery may be claimed after the route read this record. Keep the
    // source, its prior version and the queue transition in one transaction.
    const timestamp = now();
    const update = env.DB.prepare(`UPDATE records SET status='Deleted',issue=?,payload_json='{}',updated_at=?
      WHERE record_id=? AND owner_oid IS ? AND owner_upn IS ? AND employee_name IS ? AND kind IS ? AND action IS ?
        AND status IS ? AND start_date IS ? AND end_date IS ? AND record_date IS ? AND submitted_at IS ?
        AND updated_at IS ? AND issue IS ? AND payload_json IS ?
        AND (?=1 OR NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=records.record_id))
        AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=records.record_id AND q.status NOT IN ('queued','skipped'))`)
      .bind('Deleted by ' + identity.upn,timestamp,existing.record_id,existing.owner_oid,existing.owner_upn,existing.employee_name,existing.kind,existing.action,existing.status,existing.start_date??null,existing.end_date??null,existing.record_date??null,existing.submitted_at,existing.updated_at,existing.issue??null,existing.payload_json,identity.isSubmissionAdmin === true || (identity.isAdmin === true && identity.isTimesheetViewer === true) ? 1 : 0);
    const version = env.DB.prepare('INSERT INTO record_versions (record_id,owner_oid,payload_json,changed_at,changed_by_oid) SELECT ?,?,?,?,? WHERE changes()=1')
      .bind(existing.record_id,existing.owner_oid,previousVersion,timestamp,identity.oid);
    const retire = env.DB.prepare("UPDATE dispatch_queue SET status='skipped',updated_at=?,last_error='Correction deleted before delivery.' WHERE record_id=? AND status='queued' AND changes()=1")
      .bind(timestamp,existing.record_id);
    const result = await env.DB.batch([update,version,retire]);
    if (Number(result?.[0]?.meta?.changes || 0) < 1) throw Object.assign(new Error('The timesheet changed or its workbook delivery needs review. Refresh and check its status before deleting.'), { status: 409 });
    return { deleted: true, soft_deleted: true };
  }
  await env.DB.prepare('INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid) VALUES (?, ?, ?, ?, ?)')
    .bind(existing.record_id, existing.owner_oid, previousVersion, now(), identity.oid).run();
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

// This review trail alone does not grant access to a record, its older versions
// or attachments. All release routes must adopt the same snapshot-bound policy
// before these decisions can be used for employee access.
function requireTimesheetOwnershipReviewer(identity) {
  if (identity?.isAdmin !== true || identity?.isTimesheetViewer !== true || !identity.oid) {
    throw Object.assign(new Error('Timesheet ownership review is restricted to authorised reviewers'), { status: 403 });
  }
}

async function timesheetReviewSnapshot(env, recordId) {
  const row = await env.DB.prepare(`SELECT r.record_id,r.owner_oid,r.owner_upn,r.employee_name,r.kind,r.action,r.status,
    r.start_date,r.end_date,r.record_date,r.submitted_at,r.updated_at,r.payload_json,v.revision,q.status AS delivery_status,
    active.review_id AS active_review_id,active.subject_oid AS active_subject_oid,active.payload_sha256 AS active_payload_sha256,
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_ownership_review_events e
      JOIN timesheet_ownership_reviews review ON review.review_id=e.review_id WHERE review.record_id=r.record_id),0) AS review_event_id
    FROM records r JOIN timesheet_review_record_revisions v ON v.record_id=r.record_id
    LEFT JOIN dispatch_queue q ON q.record_id=r.record_id
    LEFT JOIN timesheet_ownership_reviews active ON active.record_id=r.record_id AND active.record_revision=v.revision
      AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=active.review_id AND e.event_type IN ('revoked','invalidated'))
    WHERE r.record_id=? AND r.kind='timesheets' AND r.status<>'Deleted'`).bind(recordId).first();
  if (!row) throw Object.assign(new Error('Timesheet is unavailable for review'), { status: 404 });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.payload_json));
  return { row, payloadSha256: Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,'0')).join('') };
}

async function timesheetOwnershipReviewEndpoint(request, env, identity, recordId, origin, revoke = false) {
  requireTimesheetOwnershipReviewer(identity);
  if (revoke) {
    const body = await readJson(request);
    const reviewId = Number(body.reviewId);
    if (!Number.isSafeInteger(reviewId) || reviewId < 1) throw Object.assign(new Error('A valid review is required'), { status: 400 });
    const event = await env.DB.prepare(`INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at)
      SELECT review.review_id,'revoked',?,? FROM timesheet_ownership_reviews review
      JOIN timesheet_review_record_revisions v ON v.record_id=review.record_id AND v.revision=review.record_revision
      JOIN records r ON r.record_id=review.record_id AND r.kind='timesheets' AND r.status<>'Deleted'
      WHERE review.review_id=? AND review.record_id=? AND NOT EXISTS (
        SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated'))
      RETURNING event_id`).bind(identity.oid,now(),reviewId,recordId).first();
    if (!event) throw Object.assign(new Error('The review is no longer active'), { status: 409 });
    return json({ revoked:true,reviewId },200,origin);
  }
  if (request.method === 'GET') {
    const { row, payloadSha256 } = await timesheetReviewSnapshot(env,recordId);
    const { revision, review_event_id:reviewEventId,delivery_status:deliveryStatus,
      active_review_id:reviewId,active_subject_oid:subjectOid,active_payload_sha256:reviewDigest,...record } = row;
    const activeReview=reviewId?{reviewId,subjectOid,payloadSha256:reviewDigest}:null;
    return json({ record,revision,reviewEventId,payloadSha256,deliveryStatus:deliveryStatus||null,activeReview },200,origin);
  }
  const body = await readJson(request);
  const revision = body.expectedRevision, reviewEventId = body.expectedReviewEventId, digest = String(body.payloadSha256 || '');
  const subjectOid = String(body.subjectOid || '').trim().toLowerCase();
  const subjectUpn = String(body.subjectUpn || '').trim().toLowerCase();
  const evidence = String(body.evidenceReference || '').trim();
  if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(reviewEventId) || reviewEventId < 0 || !/^[a-f0-9]{64}$/.test(digest) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(subjectOid) ||
      !/^[^\s@]+@[^\s@]+$/.test(subjectUpn) || subjectUpn.length > 320 || !/^[a-zA-Z0-9._:/-]{1,180}$/.test(evidence)) {
    throw Object.assign(new Error('Review identity, revision and evidence are required'), { status: 400 });
  }
  const { row, payloadSha256 } = await timesheetReviewSnapshot(env,recordId);
  if (revision !== Number(row.revision) || reviewEventId !== Number(row.review_event_id) || digest !== payloadSha256) throw Object.assign(new Error('The reviewed timesheet or review history has changed'), { status: 409 });
  let user;
  try {
    const token = await sharePointGraphToken(env);
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(subjectOid)}?$select=id,userPrincipalName,accountEnabled`, {
      headers: { authorization:`Bearer ${token}`,accept:'application/json' }, signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Directory unavailable');
    user = await response.json();
  } catch (_) { throw Object.assign(new Error('Employee directory verification is unavailable'), { status: 503 }); }
  if (String(user?.id || '').toLowerCase() !== subjectOid || String(user?.userPrincipalName || '').toLowerCase() !== subjectUpn || user?.accountEnabled !== true) {
    throw Object.assign(new Error('Employee directory identity does not match the review'), { status: 409 });
  }
  // The external directory check cannot share a transaction with D1. Bind
  // the write to the exact record revision and bytes observed before it.
  const review = await env.DB.prepare(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
    SELECT r.record_id,v.revision,?,?,?,?,? FROM records r
    JOIN timesheet_review_record_revisions v ON v.record_id=r.record_id
    WHERE r.record_id=? AND r.kind='timesheets' AND r.status<>'Deleted' AND v.revision=? AND r.payload_json=?
      AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=r.record_id AND q.status IN ('sending','sent','failed','uncertain'))
      AND COALESCE((SELECT MAX(e.event_id) FROM timesheet_ownership_review_events e JOIN timesheet_ownership_reviews prior ON prior.review_id=e.review_id WHERE prior.record_id=r.record_id),0)=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews x WHERE x.record_id=r.record_id AND NOT EXISTS (
        SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=x.review_id AND e.event_type IN ('revoked','invalidated')))
    RETURNING review_id`).bind(digest,subjectOid,identity.oid,evidence,now(),recordId,revision,row.payload_json,reviewEventId).first();
  if (!review) throw Object.assign(new Error('The timesheet changed or already has an active review'), { status: 409 });
  return json({ reviewId:review.review_id,subjectOid,revision,payloadSha256 },201,origin);
}

function canonicalSourceFields(fields) {
  let count=0;
  const normalize=(value,depth)=>{
    if (++count>50000 || depth>32) throw new Error('Source fields are too complex');
    if (value===null || typeof value==='string' || typeof value==='boolean') return value;
    if (typeof value==='number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(item=>normalize(item,depth+1));
    if (!value || typeof value!=='object') throw new Error('Source fields are invalid');
    const result=Object.create(null);
    for(const key of Object.keys(value).sort()) result[key]=normalize(value[key],depth+1);
    return result;
  };
  return JSON.stringify(normalize(fields,0));
}

async function describeSourceItem(item) {
  if (!item || typeof item.id!=='string' || !/^[1-9][0-9]{0,18}$/.test(item.id) || item.deleted ||
      typeof item.eTag!=='string' || !item.eTag.trim() || item.eTag.length>500 || /[\x00-\x1f\x7f]/.test(item.eTag) ||
      !item.fields || typeof item.fields!=='object' || Array.isArray(item.fields)) throw new Error('Unversioned source');
  const bytes=new TextEncoder().encode(canonicalSourceFields(item.fields));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {itemId:item.id,etag:item.eTag,fields:item.fields,fieldsSha256:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join(''),fieldBytes:bytes.length};
}

// Internal inventory only. Two matching complete scans narrow provider races;
// they cannot prevent a SharePoint change after the final response.
export async function readCompleteTimesheetSourceSnapshot(env) {
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  if (!site || !/^[a-z0-9-]+$/i.test(list)) throw Object.assign(new Error('Timesheet source history is unavailable'),{status:503});
  const path=`/v1.0/sites/${encodeURIComponent(site)}/lists/${encodeURIComponent(list)}/items`;
  const scan=async()=>{
    const token=await sharePointGraphToken(env),seenUrls=new Set(),seenIds=new Set(),items=[];
    let url=`https://graph.microsoft.com${path}?$expand=fields&$top=100`,bytes=0;
    for(let page=0;url;page++) {
      if(page>=100 || seenUrls.has(url))throw new Error('Incomplete source pagination');
      const parsed=new URL(url);
      if(parsed.protocol!=='https:' || parsed.host!=='graph.microsoft.com' || parsed.username || parsed.password || parsed.hash ||
          decodeURIComponent(parsed.pathname)!==decodeURIComponent(path))throw new Error('Invalid source continuation');
      seenUrls.add(url);
      const response=await fetch(url,{redirect:'manual',headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('Source history unavailable');
      const body=await readBoundedJson(response,MAX_BODY_BYTES);
      if(!body || !Array.isArray(body.value))throw new Error('Invalid source response');
      for(const item of body.value) {
        const entry=await describeSourceItem(item);bytes+=entry.fieldBytes;
        if(seenIds.has(entry.itemId) || items.length>=10000 || bytes>16_000_000)throw new Error('Invalid or oversized source history');
        seenIds.add(entry.itemId);delete entry.fieldBytes;items.push(entry);
      }
      const next=body['@odata.nextLink'];
      if(next!==undefined && (typeof next!=='string' || !next))throw new Error('Invalid source continuation');
      url=next||'';
    }
    items.sort((a,b)=>a.itemId.localeCompare(b.itemId));return items;
  };
  let first,second;
  try {first=await scan();second=await scan();}
  catch (_) {throw Object.assign(new Error('Timesheet source history is unavailable'),{status:503});}
  const manifest=items=>items.map(({itemId,etag,fieldsSha256})=>({itemId,etag,fieldsSha256}));
  const firstManifest=JSON.stringify(manifest(first)),secondManifest=JSON.stringify(manifest(second));
  if(firstManifest!==secondManifest)throw Object.assign(new Error('Timesheet source history changed while loading'),{status:409});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secondManifest));
  return {items:second,fingerprint:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};
}

async function sourceReviewSnapshot(env,itemId) {
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  if (!site || !/^[a-z0-9-]+$/i.test(list)) throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
  let item,fieldsSha256;
  try {
    const token=await sharePointGraphToken(env);
    const url=`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(site)}/lists/${encodeURIComponent(list)}/items/${encodeURIComponent(itemId)}?$expand=fields`;
    const response=await fetch(url,{redirect:'manual',headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Provider unavailable');
    item=await readBoundedJson(response,MAX_BODY_BYTES);
    const description=await describeSourceItem(item);
    if(description.itemId!==itemId)throw new Error('Wrong source');
    fieldsSha256=description.fieldsSha256;
  } catch (_) {throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});}
  let sourceUrl='';
  try {
    const parsed=new URL(String(item.webUrl||'')),host=site.split(',')[0].toLowerCase();
    if(parsed.protocol==='https:' && parsed.hostname.toLowerCase()===host && !parsed.port && !parsed.username && !parsed.password)sourceUrl=parsed.href;
  }catch(_){}
  return {site,list,itemId,etag:item.eTag,fields:item.fields,fieldsSha256,sourceUrl};
}

// A stable read does not prove that deleted or externally stored history exists.
async function readStableTimesheetSourceVersions(env,itemId) {
  if(!/^[1-9][0-9]{0,18}$/.test(itemId))throw Object.assign(new Error('A valid source item is required'),{status:400});
  const current=await sourceReviewSnapshot(env,itemId);
  const path=`/v1.0/sites/${encodeURIComponent(current.site)}/lists/${encodeURIComponent(current.list)}/items/${encodeURIComponent(itemId)}/versions`;
  const scan=async()=>{
    const token=await sharePointGraphToken(env),ids=[],seen=new Set(),urls=new Set();let url=`https://graph.microsoft.com${path}`;
    for(let page=0;url;page++){
      if(page>=20||urls.has(url))throw new Error('Incomplete versions');
      const parsed=new URL(url);
      if(parsed.protocol!=='https:'||parsed.host!=='graph.microsoft.com'||parsed.username||parsed.password||parsed.hash||decodeURIComponent(parsed.pathname)!==decodeURIComponent(path))throw new Error('Invalid continuation');
      urls.add(url);
      const response=await fetch(url,{redirect:'manual',headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('Versions unavailable');
      const body=await readBoundedJson(response,MAX_BODY_BYTES);
      if(!body||!Array.isArray(body.value))throw new Error('Invalid versions');
      for(const entry of body.value){const id=entry?.id;if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)||seen.has(id)||ids.length>=100)throw new Error('Invalid versions');seen.add(id);ids.push(id)}
      const next=body['@odata.nextLink'];if(next!==undefined&&(typeof next!=='string'||!next))throw new Error('Invalid continuation');url=next||'';
    }
    ids.sort();const result=[];let bytes=0;
    for(let start=0;start<ids.length;start+=20){
      const group=ids.slice(start,start+20),requests=group.map((id,index)=>({id:String(index+1),method:'GET',url:`${path.slice('/v1.0'.length)}/${encodeURIComponent(id)}?$expand=fields`}));
      const response=await fetch('https://graph.microsoft.com/v1.0/$batch',{method:'POST',redirect:'manual',headers:{authorization:`Bearer ${token}`,accept:'application/json','content-type':'application/json'},body:JSON.stringify({requests}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('Versions unavailable');
      const body=await readBoundedJson(response,9_000_000);
      if(!Array.isArray(body?.responses)||body.responses.length!==group.length)throw new Error('Incomplete versions');
      const byId=new Map();for(const entry of body.responses){if(!entry||typeof entry.id!=='string'||byId.has(entry.id)||entry.status!==200)throw new Error('Invalid version response');byId.set(entry.id,entry.body)}
      for(let index=0;index<group.length;index++){
        const id=group[index],version=byId.get(String(index+1));
        if(version?.id!==id||!version.fields||typeof version.fields!=='object'||Array.isArray(version.fields)||new TextEncoder().encode(JSON.stringify(version)).length>MAX_BODY_BYTES)throw new Error('Invalid version');
        const canonical=canonicalSourceFields(version.fields);bytes+=new TextEncoder().encode(canonical).length;if(bytes>8_000_000)throw new Error('Oversized versions');
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
        result.push({versionId:id,modifiedAt:typeof version.lastModifiedDateTime==='string'?version.lastModifiedDateTime:'',fields:version.fields,fieldsSha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')});
      }
    }
    return result;
  };
  let first,second;
  try{first=await scan();second=await scan()}catch(_){throw Object.assign(new Error('Previous source versions are unavailable'),{status:503})}
  const manifest=entries=>JSON.stringify(entries.map(({versionId,modifiedAt,fieldsSha256})=>({versionId,modifiedAt,fieldsSha256})));
  if(manifest(first)!==manifest(second))throw Object.assign(new Error('Source versions changed while loading'),{status:409});
  const latest=await sourceReviewSnapshot(env,itemId);
  if(latest.etag!==current.etag||latest.fieldsSha256!==current.fieldsSha256)throw Object.assign(new Error('The source changed while loading versions'),{status:409});
  return {site:latest.site,list:latest.list,itemId,currentEtag:latest.etag,currentFieldsSha256:latest.fieldsSha256,versions:second};
}

// Reviewer-only display; no decision here grants access or delivery authority.
async function timesheetSourceVersions(request,env,identity,itemId,origin) {
  requireTimesheetOwnershipReviewer(identity);
  if(!/^[1-9][0-9]{0,18}$/.test(itemId))throw Object.assign(new Error('A valid source item is required'),{status:400});
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  const watermark=async()=>env.DB.prepare(`SELECT COALESCE(MAX(e.event_id),0) AS event_id FROM timesheet_source_version_review_events e
    JOIN timesheet_source_version_reviews r ON r.review_id=e.review_id WHERE r.site_id=? AND r.list_id=? AND r.item_id=?`).bind(site,list,itemId).first();
  const before=await watermark();if(!Number.isSafeInteger(before?.event_id))throw Object.assign(new Error('Source version reviews are unavailable'),{status:503});
  const snapshot=await readStableTimesheetSourceVersions(env,itemId);
  const active=await env.DB.prepare(`SELECT r.review_id,r.version_id,r.fields_sha256,r.classification,r.subject_oid,r.subject_upn FROM timesheet_source_version_reviews r
    WHERE r.site_id=? AND r.list_id=? AND r.item_id=? AND NOT EXISTS (SELECT 1 FROM timesheet_source_version_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked') LIMIT 101`).bind(site,list,itemId).all();
  const events=await env.DB.prepare(`SELECT r.version_id,MAX(e.event_id) AS event_id FROM timesheet_source_version_reviews r JOIN timesheet_source_version_review_events e ON e.review_id=r.review_id
    WHERE r.site_id=? AND r.list_id=? AND r.item_id=? GROUP BY r.version_id LIMIT 10001`).bind(site,list,itemId).all();
  const after=await watermark();if(!Array.isArray(active?.results)||active.results.length>100||!Array.isArray(events?.results)||events.results.length>10000||!Number.isSafeInteger(after?.event_id))throw Object.assign(new Error('Source version reviews are unavailable'),{status:503});
  if(before.event_id!==after.event_id)throw Object.assign(new Error('Source version reviews changed while loading'),{status:409});
  const decisions=new Map(),eventIds=new Map();for(const item of active.results){if(decisions.has(item.version_id))throw Object.assign(new Error('Source version reviews are unavailable'),{status:503});decisions.set(item.version_id,item)}
  for(const event of events.results){if(!Number.isSafeInteger(event.event_id)||eventIds.has(event.version_id))throw Object.assign(new Error('Source version reviews are unavailable'),{status:503});eventIds.set(event.version_id,event.event_id)}
  const versions=snapshot.versions.map(version=>{const decision=decisions.get(version.versionId);decisions.delete(version.versionId);return {...version,reviewEventId:eventIds.get(version.versionId)||0,reviewStatus:!decision?'unreviewed':decision.fields_sha256===version.fieldsSha256?'reviewed':'changed',...(decision?{reviewId:decision.review_id,classification:decision.classification,subjectOid:decision.subject_oid,subjectUpn:decision.subject_upn}:{})}});
  for(const decision of decisions.values())versions.push({versionId:decision.version_id,reviewStatus:'missing',reviewId:decision.review_id,classification:decision.classification,subjectOid:decision.subject_oid,subjectUpn:decision.subject_upn,reviewEventId:eventIds.get(decision.version_id)||0});
  return json({itemId,currentEtag:snapshot.currentEtag,currentFieldsSha256:snapshot.currentFieldsSha256,versions},200,origin);
}

async function assertCurrentSourceReviewSubject(env,subjectOid,subjectUpn) {
  let user;
  try {
    const token=await sharePointGraphToken(env),response=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(subjectOid)}?$select=id,userPrincipalName`,{
      redirect:'manual',headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Directory unavailable');user=await response.json();
  } catch (_) {throw Object.assign(new Error('Employee directory verification is unavailable'),{status:503});}
  if(String(user?.id||'').toLowerCase()!==subjectOid || String(user?.userPrincipalName||'').toLowerCase()!==subjectUpn)
    throw Object.assign(new Error('Employee directory identity does not match the review'),{status:409});
}

// Internal, one item only. This does not prove that other items, deleted
// versions, attachments or external archives have been reviewed, and grants
// no authority to deliver. A caller must independently authorise access.
export async function readClassifiedTimesheetSourceVersions(env,itemId,expected,subject) {
  const conflict=()=>Object.assign(new Error('Previous source versions need review before workbook filing.'),{status:409});
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  const oid=String(subject?.oid||'').trim().toLowerCase(),upn=String(subject?.upn||'').trim().toLowerCase();
  const validOid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const validUpn=value=>value.length<=320 && /^[^\s@]+@[^\s@]+$/.test(value);
  if(!site||!/^[a-z0-9-]+$/i.test(list)||!/^[1-9][0-9]{0,18}$/.test(String(itemId||''))||
      !validOid(oid)||!validUpn(upn)||typeof expected?.etag!=='string'||!expected.etag||!/^[a-f0-9]{64}$/.test(expected?.fieldsSha256||''))throw conflict();
  const watermark=async()=>env.DB.prepare(`SELECT COALESCE(MAX(e.event_id),0) AS event_id FROM timesheet_source_version_review_events e
    JOIN timesheet_source_version_reviews r ON r.review_id=e.review_id WHERE r.site_id=? AND r.list_id=? AND r.item_id=?`).bind(site,list,itemId).first();
  const before=await watermark();if(!Number.isSafeInteger(before?.event_id))throw conflict();
  const first=await readStableTimesheetSourceVersions(env,itemId);
  if(first.currentEtag!==expected.etag||first.currentFieldsSha256!==expected.fieldsSha256)throw conflict();
  const result=await env.DB.prepare(`SELECT r.review_id,r.version_id,r.fields_sha256,r.classification,r.subject_oid,r.subject_upn
    FROM timesheet_source_version_reviews r WHERE r.site_id=? AND r.list_id=? AND r.item_id=? AND NOT EXISTS
      (SELECT 1 FROM timesheet_source_version_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked') LIMIT 101`).bind(site,list,itemId).all();
  if(!Array.isArray(result?.results)||result.results.length>100||result.results.length!==first.versions.length)throw conflict();
  const decisions=new Map();
  for(const review of result.results){
    const ownerOid=String(review.subject_oid||'').trim().toLowerCase(),ownerUpn=String(review.subject_upn||'').trim().toLowerCase();
    if(decisions.has(review.version_id)||!Number.isSafeInteger(review.review_id)||
       (review.classification==='employee'&&(!validOid(ownerOid)||!validUpn(ownerUpn)||(ownerOid===oid)!==(ownerUpn===upn)))||
       (review.classification==='not_timesheet'&&(review.subject_oid!==null||review.subject_upn!==null))||
       !['employee','not_timesheet'].includes(review.classification))throw conflict();
    decisions.set(review.version_id,{...review,ownerOid});
  }
  for(const version of first.versions){const decision=decisions.get(version.versionId);if(!decision||decision.fields_sha256!==version.fieldsSha256)throw conflict();}
  await assertCurrentSourceReviewSubject(env,oid,upn);
  const latest=await readStableTimesheetSourceVersions(env,itemId),after=await watermark();
  const manifest=snapshot=>JSON.stringify(snapshot.versions.map(({versionId,modifiedAt,fieldsSha256})=>({versionId,modifiedAt,fieldsSha256})));
  if(!Number.isSafeInteger(after?.event_id)||after.event_id!==before.event_id||latest.currentEtag!==expected.etag||
      latest.currentFieldsSha256!==expected.fieldsSha256||manifest(first)!==manifest(latest))throw conflict();
  return {itemId,currentEtag:latest.currentEtag,currentFieldsSha256:latest.currentFieldsSha256,reviewEventId:after.event_id,
    versions:latest.versions.filter(version=>decisions.get(version.versionId).ownerOid===oid).map(version=>({...version,reviewId:decisions.get(version.versionId).review_id}))};
}

async function timesheetReviewSubjectLookup(request,env,identity,origin) {
  requireTimesheetOwnershipReviewer(identity);
  const upn=String(new URL(request.url).searchParams.get('upn')||'').trim().toLowerCase();
  if(upn.length>320 || !/^[^\s@]+@[^\s@]+$/.test(upn))throw Object.assign(new Error('Enter the employee’s exact work sign-in'),{status:400});
  let user;
  try {
    const token=await sharePointGraphToken(env);
    const response=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName,displayName,accountEnabled`,{
      redirect:'manual',headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Directory unavailable');
    user=await readBoundedJson(response,MAX_BODY_BYTES);
  }catch(_){throw Object.assign(new Error('Employee directory verification is unavailable'),{status:503});}
  const oid=String(user?.id||'').toLowerCase();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid) ||
      String(user?.userPrincipalName||'').toLowerCase()!==upn || typeof user?.accountEnabled!=='boolean')
    throw Object.assign(new Error('The employee sign-in could not be verified'),{status:409});
  return json({oid,upn,name:text(user.displayName,'',200),accountEnabled:user.accountEnabled},200,origin);
}

// Internal only. The caller must independently authorise the requester and
// the requested employee; this helper checks one current provider item, not
// earlier versions, attachments, or completeness of the overall list.
export async function readReviewedTimesheetSource(env,itemId,subject) {
  const conflict=()=>Object.assign(new Error('The reviewed source is unavailable or changed'),{status:409});
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  const oid=String(subject?.oid||'').trim().toLowerCase(),upn=String(subject?.upn||'').trim().toLowerCase();
  if(!site || !/^[a-z0-9-]+$/i.test(list) || !/^[1-9][0-9]{0,18}$/.test(String(itemId||'')) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid) || !/^[^\s@]+@[^\s@]+$/.test(upn)) throw conflict();
  const active=()=>env.DB.prepare(`SELECT review.review_id,review.source_etag,review.fields_sha256 FROM timesheet_source_reviews review
    WHERE review.site_id=? AND review.list_id=? AND review.item_id=? AND lower(review.subject_oid)=? AND lower(review.subject_upn)=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=review.review_id AND e.event_type='revoked')`)
    .bind(site,list,itemId,oid,upn).first();
  const decision=await active();if(!decision)throw conflict();
  const first=await sourceReviewSnapshot(env,itemId);
  if(first.etag!==decision.source_etag || first.fieldsSha256!==decision.fields_sha256)throw conflict();
  await assertCurrentSourceReviewSubject(env,oid,upn);
  const latest=await sourceReviewSnapshot(env,itemId),stillActive=await active();
  if(latest.etag!==decision.source_etag || latest.fieldsSha256!==decision.fields_sha256 ||
      !stillActive || stillActive.review_id!==decision.review_id || stillActive.source_etag!==decision.source_etag || stillActive.fields_sha256!==decision.fields_sha256)throw conflict();
  return {itemId,etag:latest.etag,fieldsSha256:latest.fieldsSha256,fields:latest.fields,reviewId:decision.review_id};
}

// Current-list classification only, not an authorisation to deliver. Earlier
// versions, attachments, external sources and the post-read provider race
// still require independent controls before this result can release data.
export async function readClassifiedCurrentTimesheetSources(env,subject) {
  const conflict=()=>Object.assign(new Error('Current timesheet sources need review before workbook filing.'),{status:409});
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  const oid=String(subject?.oid||'').trim().toLowerCase(),upn=String(subject?.upn||'').trim().toLowerCase();
  const validOid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const validUpn=value=>value.length<=320 && /^[^\s@]+@[^\s@]+$/.test(value);
  if(!site||!/^[a-z0-9-]+$/i.test(list)||!validOid(oid)||!validUpn(upn))throw conflict();
  const watermark=async()=>env.DB.prepare(`SELECT
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_review_events e JOIN timesheet_source_reviews r ON r.review_id=e.review_id WHERE r.site_id=? AND r.list_id=?),0) AS event_id,
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_exclusion_events e JOIN timesheet_source_exclusions x ON x.exclusion_id=e.exclusion_id WHERE x.site_id=? AND x.list_id=?),0) AS exclusion_event_id`).bind(site,list,site,list).first();
  const before=await watermark();if(!Number.isSafeInteger(before?.event_id)||!Number.isSafeInteger(before?.exclusion_event_id))throw conflict();
  const first=await readCompleteTimesheetSourceSnapshot(env);
  const result=await env.DB.prepare(`SELECT r.review_id,r.item_id,r.source_etag,r.fields_sha256,r.subject_oid,r.subject_upn
    FROM timesheet_source_reviews r WHERE r.site_id=? AND r.list_id=? AND NOT EXISTS (
      SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked') LIMIT 10001`).bind(site,list).all();
  if(!Array.isArray(result?.results)||result.results.length>10000)throw conflict();
  const decisions=new Map();
  for(const review of result.results){
    const ownerOid=String(review.subject_oid||'').trim().toLowerCase(),ownerUpn=String(review.subject_upn||'').trim().toLowerCase();
    if(decisions.has(review.item_id)||!validOid(ownerOid)||!validUpn(ownerUpn)||(ownerOid===oid)!==(ownerUpn===upn))throw conflict();
    decisions.set(review.item_id,{...review,ownerOid,ownerUpn});
  }
  const exclusions=await env.DB.prepare(`SELECT x.exclusion_id,x.item_id,x.source_etag,x.fields_sha256 FROM timesheet_source_exclusions x
    WHERE x.site_id=? AND x.list_id=? AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e
      WHERE e.exclusion_id=x.exclusion_id AND e.event_type='revoked') LIMIT 10001`).bind(site,list).all();
  if(!Array.isArray(exclusions?.results)||exclusions.results.length>10000)throw conflict();
  for(const exclusion of exclusions.results){if(decisions.has(exclusion.item_id))throw conflict();decisions.set(exclusion.item_id,{...exclusion,excluded:true});}
  if(first.items.length!==decisions.size)throw conflict();
  for(const item of first.items){const decision=decisions.get(item.itemId);if(!decision||decision.source_etag!==item.etag||decision.fields_sha256!==item.fieldsSha256)throw conflict();}
  await assertCurrentSourceReviewSubject(env,oid,upn);
  const latest=await readCompleteTimesheetSourceSnapshot(env),after=await watermark();
  if(!Number.isSafeInteger(after?.event_id)||!Number.isSafeInteger(after?.exclusion_event_id)||after.event_id!==before.event_id||after.exclusion_event_id!==before.exclusion_event_id||latest.fingerprint!==first.fingerprint)throw conflict();
  const items=latest.items.filter(item=>decisions.get(item.itemId)?.ownerOid===oid).map(item=>({...item,reviewId:decisions.get(item.itemId).review_id}));
  return {items,sourceFingerprint:latest.fingerprint,reviewEventId:after.event_id,exclusionEventId:after.exclusion_event_id};
}

// Reviewer overview only: this is not an authorisation to release any source.
// Decisions and provider data can change after this response is produced.
async function timesheetSourceReviewInventory(env,identity,origin) {
  requireTimesheetOwnershipReviewer(identity);
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  const watermark=async()=>env.DB.prepare(`SELECT
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_review_events e JOIN timesheet_source_reviews r ON r.review_id=e.review_id WHERE r.site_id=? AND r.list_id=?),0) AS event_id,
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_exclusion_events e JOIN timesheet_source_exclusions x ON x.exclusion_id=e.exclusion_id WHERE x.site_id=? AND x.list_id=?),0) AS exclusion_event_id`).bind(site,list,site,list).first();
  const before=await watermark();
  if(!Number.isSafeInteger(before?.event_id)||!Number.isSafeInteger(before?.exclusion_event_id))throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
  const snapshot=await readCompleteTimesheetSourceSnapshot(env);
  const rows=await env.DB.prepare(`SELECT r.review_id,r.item_id,r.source_etag,r.fields_sha256,r.subject_oid,r.subject_upn
    FROM timesheet_source_reviews r WHERE r.site_id=? AND r.list_id=? AND NOT EXISTS (
      SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked') LIMIT 10001`).bind(site,list).all();
  const excluded=await env.DB.prepare(`SELECT x.exclusion_id,x.item_id,x.source_etag,x.fields_sha256 FROM timesheet_source_exclusions x
    WHERE x.site_id=? AND x.list_id=? AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e WHERE e.exclusion_id=x.exclusion_id AND e.event_type='revoked') LIMIT 10001`).bind(site,list).all();
  const after=await watermark();
  if(!Array.isArray(rows?.results)||rows.results.length>10000||!Array.isArray(excluded?.results)||excluded.results.length>10000||!Number.isSafeInteger(after?.event_id)||!Number.isSafeInteger(after?.exclusion_event_id))
    throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
  if(before.event_id!==after.event_id||before.exclusion_event_id!==after.exclusion_event_id)throw Object.assign(new Error('Timesheet source reviews changed while loading'),{status:409});
  const decisions=new Map();
  for(const review of rows.results) {
    if(decisions.has(review.item_id))throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
    decisions.set(review.item_id,review);
  }
  for(const exclusion of excluded.results){if(decisions.has(exclusion.item_id))throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});decisions.set(exclusion.item_id,{...exclusion,excluded:true});}
  const items=snapshot.items.map(item=>{
    const review=decisions.get(item.itemId);
    const sourceFields=item.fields||{};
    const claimedName=typeof sourceFields.EmployeeName==='string'?sourceFields.EmployeeName.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160):'';
    const sourceDate=value=>{const date=typeof value==='string'?value.slice(0,10):'';return validReceiptDate(date)?date:''};
    // These labels help a reviewer locate a source; they are not identity
    // evidence and are never used to grant access or select a workbook.
    const labels={claimedName,weekStart:sourceDate(sourceFields.Week_x0020_Start),weekEnd:sourceDate(sourceFields.Week_x0020_End)};
    if(!review)return {itemId:item.itemId,status:'unreviewed',...labels};
    decisions.delete(item.itemId);
    const status=review.source_etag===item.etag && review.fields_sha256===item.fieldsSha256?(review.excluded?'excluded':'reviewed'):'changed';
    return {itemId:item.itemId,status,...(review.excluded?{exclusionId:review.exclusion_id}:{reviewId:review.review_id,subjectOid:review.subject_oid,subjectUpn:review.subject_upn}),...labels};
  });
  for(const review of decisions.values())items.push({itemId:review.item_id,status:'missing',...(review.excluded?{exclusionId:review.exclusion_id}:{reviewId:review.review_id,subjectOid:review.subject_oid,subjectUpn:review.subject_upn})});
  items.sort((a,b)=>a.itemId.localeCompare(b.itemId));
  return json({items,sourceFingerprint:snapshot.fingerprint,reviewEventId:after.event_id,exclusionEventId:after.exclusion_event_id},200,origin);
}

async function timesheetSourceReviewEndpoint(request,env,identity,itemId,origin,revoke=false) {
  requireTimesheetOwnershipReviewer(identity);
  if (!/^[1-9][0-9]{0,18}$/.test(itemId)) throw Object.assign(new Error('A valid source item is required'),{status:400});
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  if (!site || !/^[a-z0-9-]+$/i.test(list)) throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
  if (revoke) {
    const body=await readJson(request),reviewId=Number(body.reviewId);
    if(!Number.isSafeInteger(reviewId)||reviewId<1)throw Object.assign(new Error('A valid review is required'),{status:400});
    const event=await env.DB.prepare(`INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at)
      SELECT review.review_id,'revoked',?,? FROM timesheet_source_reviews review
      WHERE review.review_id=? AND review.site_id=? AND review.list_id=? AND review.item_id=?
        AND NOT EXISTS (SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=review.review_id AND e.event_type='revoked') RETURNING event_id`)
      .bind(identity.oid,now(),reviewId,site,list,itemId).first();
    if(!event)throw Object.assign(new Error('The source review is no longer active'),{status:409});
    return json({revoked:true,reviewId},200,origin);
  }
  const watermark=async()=>env.DB.prepare(`SELECT
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_review_events e JOIN timesheet_source_reviews r ON r.review_id=e.review_id WHERE r.site_id=? AND r.list_id=? AND r.item_id=?),0) AS event_id,
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_exclusion_events e JOIN timesheet_source_exclusions x ON x.exclusion_id=e.exclusion_id WHERE x.site_id=? AND x.list_id=? AND x.item_id=?),0) AS exclusion_event_id`)
    .bind(site,list,itemId,site,list,itemId).first();
  if(request.method==='GET') {
    const snapshot=await sourceReviewSnapshot(env,itemId),event=await watermark();
    if(!event || !Number.isSafeInteger(event.event_id)||!Number.isSafeInteger(event.exclusion_event_id))throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
    return json({itemId,etag:snapshot.etag,fields:snapshot.fields,fieldsSha256:snapshot.fieldsSha256,sourceUrl:snapshot.sourceUrl,reviewEventId:event.event_id,exclusionEventId:event.exclusion_event_id},200,origin);
  }
  const body=await readJson(request),etag=body.expectedEtag,digest=String(body.fieldsSha256||''),eventId=body.expectedReviewEventId,exclusionEventId=body.expectedExclusionEventId;
  const subjectOid=String(body.subjectOid||'').trim().toLowerCase(),subjectUpn=String(body.subjectUpn||'').trim().toLowerCase(),evidence=String(body.evidenceReference||'').trim();
  if(typeof etag!=='string'||!etag.trim()||etag.length>500||/[\x00-\x1f\x7f]/.test(etag)||!/^[a-f0-9]{64}$/.test(digest)||
      !Number.isSafeInteger(eventId)||eventId<0||!Number.isSafeInteger(exclusionEventId)||exclusionEventId<0||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(subjectOid)||
      !/^[^\s@]+@[^\s@]+$/.test(subjectUpn)||subjectUpn.length>320||!/^[a-zA-Z0-9._:/-]{1,180}$/.test(evidence))
    throw Object.assign(new Error('Source version, employee identity and evidence are required'),{status:400});
  const snapshot=await sourceReviewSnapshot(env,itemId),event=await watermark();
  if(!event || event.event_id!==eventId || event.exclusion_event_id!==exclusionEventId || snapshot.etag!==etag || snapshot.fieldsSha256!==digest)throw Object.assign(new Error('The source or its review history has changed'),{status:409});
  await assertCurrentSourceReviewSubject(env,subjectOid,subjectUpn);
  const latest=await sourceReviewSnapshot(env,itemId);
  if(latest.etag!==etag || latest.fieldsSha256!==digest)throw Object.assign(new Error('The source changed during review'),{status:409});
  const review=await env.DB.prepare(`INSERT INTO timesheet_source_reviews(site_id,list_id,item_id,source_etag,fields_sha256,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_review_events e JOIN timesheet_source_reviews prior ON prior.review_id=e.review_id
      WHERE prior.site_id=? AND prior.list_id=? AND prior.item_id=?),0)=?
    AND COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_exclusion_events e JOIN timesheet_source_exclusions prior ON prior.exclusion_id=e.exclusion_id
      WHERE prior.site_id=? AND prior.list_id=? AND prior.item_id=?),0)=?
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_reviews prior WHERE prior.site_id=? AND prior.list_id=? AND prior.item_id=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=prior.review_id AND e.event_type='revoked'))
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusions prior WHERE prior.site_id=? AND prior.list_id=? AND prior.item_id=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e WHERE e.exclusion_id=prior.exclusion_id AND e.event_type='revoked')) RETURNING review_id`)
    .bind(site,list,itemId,etag,digest,subjectOid,subjectUpn,identity.oid,evidence,now(),site,list,itemId,eventId,site,list,itemId,exclusionEventId,site,list,itemId,site,list,itemId).first();
  if(!review)throw Object.assign(new Error('The source or its review history has changed'),{status:409});
  return json({reviewId:review.review_id,itemId,subjectOid,etag,fieldsSha256:digest},201,origin);
}

async function timesheetSourceExclusionEndpoint(request,env,identity,itemId,origin,revoke=false) {
  requireTimesheetOwnershipReviewer(identity);
  if(!/^[1-9][0-9]{0,18}$/.test(itemId))throw Object.assign(new Error('A valid source item is required'),{status:400});
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  if(!site||!/^[a-z0-9-]+$/i.test(list))throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
  const body=await readJson(request);
  if(revoke){const id=Number(body.exclusionId);if(!Number.isSafeInteger(id)||id<1)throw Object.assign(new Error('A valid classification is required'),{status:400});
    const event=await env.DB.prepare(`INSERT INTO timesheet_source_exclusion_events(exclusion_id,event_type,actor_oid,occurred_at)
      SELECT x.exclusion_id,'revoked',?,? FROM timesheet_source_exclusions x WHERE x.exclusion_id=? AND x.site_id=? AND x.list_id=? AND x.item_id=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e WHERE e.exclusion_id=x.exclusion_id AND e.event_type='revoked') RETURNING event_id`)
      .bind(identity.oid,now(),id,site,list,itemId).first();
    if(!event)throw Object.assign(new Error('The source classification is no longer active'),{status:409});return json({revoked:true,exclusionId:id},200,origin);
  }
  const etag=body.expectedEtag,digest=String(body.fieldsSha256||''),reviewEventId=body.expectedReviewEventId,exclusionEventId=body.expectedExclusionEventId,evidence=String(body.evidenceReference||'').trim();
  if(typeof etag!=='string'||!etag.trim()||etag.length>500||/[\x00-\x1f\x7f]/.test(etag)||!/^[a-f0-9]{64}$/.test(digest)||
      !Number.isSafeInteger(reviewEventId)||reviewEventId<0||!Number.isSafeInteger(exclusionEventId)||exclusionEventId<0||!/^[a-zA-Z0-9._:/-]{1,180}$/.test(evidence))
    throw Object.assign(new Error('Source version and evidence are required'),{status:400});
  const first=await sourceReviewSnapshot(env,itemId),latest=await sourceReviewSnapshot(env,itemId);
  if(first.etag!==etag||first.fieldsSha256!==digest||latest.etag!==etag||latest.fieldsSha256!==digest)throw Object.assign(new Error('The source changed during review'),{status:409});
  const entry=await env.DB.prepare(`INSERT INTO timesheet_source_exclusions(site_id,list_id,item_id,source_etag,fields_sha256,reviewer_oid,evidence_reference,reviewed_at)
    SELECT ?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_review_events e JOIN timesheet_source_reviews r ON r.review_id=e.review_id WHERE r.site_id=? AND r.list_id=? AND r.item_id=?),0)=?
    AND COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_exclusion_events e JOIN timesheet_source_exclusions x ON x.exclusion_id=e.exclusion_id WHERE x.site_id=? AND x.list_id=? AND x.item_id=?),0)=?
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_reviews r WHERE r.site_id=? AND r.list_id=? AND r.item_id=? AND NOT EXISTS (SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked'))
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusions x WHERE x.site_id=? AND x.list_id=? AND x.item_id=? AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e WHERE e.exclusion_id=x.exclusion_id AND e.event_type='revoked')) RETURNING exclusion_id`)
    .bind(site,list,itemId,etag,digest,identity.oid,evidence,now(),site,list,itemId,reviewEventId,site,list,itemId,exclusionEventId,site,list,itemId,site,list,itemId).first();
  if(!entry)throw Object.assign(new Error('The source or its review history has changed'),{status:409});
  return json({exclusionId:entry.exclusion_id,itemId,etag,fieldsSha256:digest},201,origin);
}

async function timesheetSourceVersionReviewEndpoint(request,env,identity,itemId,versionId,origin,revoke=false) {
  requireTimesheetOwnershipReviewer(identity);
  if(!/^[1-9][0-9]{0,18}$/.test(itemId)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(versionId))throw Object.assign(new Error('A valid source version is required'),{status:400});
  const site=text(env.SHAREPOINT_SITE_ID,'',500),list=text(env.SHAREPOINT_TIMESHEET_LIST_ID,'',120);
  if(!site||!/^[a-z0-9-]+$/i.test(list))throw Object.assign(new Error('Source version review is unavailable'),{status:503});
  const body=await readJson(request);
  if(revoke){const reviewId=Number(body.reviewId);if(!Number.isSafeInteger(reviewId)||reviewId<1)throw Object.assign(new Error('A valid version review is required'),{status:400});
    const event=await env.DB.prepare(`INSERT INTO timesheet_source_version_review_events(review_id,event_type,actor_oid,occurred_at)
      SELECT r.review_id,'revoked',?,? FROM timesheet_source_version_reviews r WHERE r.review_id=? AND r.site_id=? AND r.list_id=? AND r.item_id=? AND r.version_id=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_version_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked') RETURNING event_id`).bind(identity.oid,now(),reviewId,site,list,itemId,versionId).first();
    if(!event)throw Object.assign(new Error('The source version review is no longer active'),{status:409});return json({revoked:true,reviewId},200,origin);
  }
  const classification=body.classification,etag=body.expectedCurrentEtag,currentDigest=String(body.expectedCurrentFieldsSha256||''),digest=String(body.fieldsSha256||''),eventId=body.expectedReviewEventId,evidence=String(body.evidenceReference||'').trim();
  const oid=String(body.subjectOid||'').trim().toLowerCase(),upn=String(body.subjectUpn||'').trim().toLowerCase();
  if(!['employee','not_timesheet'].includes(classification)||typeof etag!=='string'||!etag.trim()||etag.length>500||/[\x00-\x1f\x7f]/.test(etag)||
      !/^[a-f0-9]{64}$/.test(currentDigest)||!/^[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(eventId)||eventId<0||!/^[a-zA-Z0-9._:/-]{1,180}$/.test(evidence)||
      (classification==='employee'&&(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid)||upn.length>320||!/^[^\s@]+@[^\s@]+$/.test(upn)))||
      (classification==='not_timesheet'&&(oid||upn)))throw Object.assign(new Error('Source version, classification and evidence are required'),{status:400});
  const matches=snapshot=>snapshot.currentEtag===etag&&snapshot.currentFieldsSha256===currentDigest&&snapshot.versions.some(version=>version.versionId===versionId&&version.fieldsSha256===digest);
  const first=await readStableTimesheetSourceVersions(env,itemId);if(!matches(first))throw Object.assign(new Error('The source version changed during review'),{status:409});
  if(classification==='employee')await assertCurrentSourceReviewSubject(env,oid,upn);
  const latest=await readStableTimesheetSourceVersions(env,itemId);if(!matches(latest))throw Object.assign(new Error('The source version changed during review'),{status:409});
  const review=await env.DB.prepare(`INSERT INTO timesheet_source_version_reviews(site_id,list_id,item_id,version_id,fields_sha256,classification,subject_oid,subject_upn,reviewer_oid,evidence_reference,reviewed_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(e.event_id) FROM timesheet_source_version_review_events e JOIN timesheet_source_version_reviews r ON r.review_id=e.review_id
      WHERE r.site_id=? AND r.list_id=? AND r.item_id=? AND r.version_id=?),0)=?
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_version_reviews r WHERE r.site_id=? AND r.list_id=? AND r.item_id=? AND r.version_id=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_version_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked')) RETURNING review_id`)
    .bind(site,list,itemId,versionId,digest,classification,classification==='employee'?oid:null,classification==='employee'?upn:null,identity.oid,evidence,now(),site,list,itemId,versionId,eventId,site,list,itemId,versionId).first();
  if(!review)throw Object.assign(new Error('The source version review history changed'),{status:409});
  return json({reviewId:review.review_id,itemId,versionId,classification,fieldsSha256:digest},201,origin);
}

async function readBoundedJson(request, maximumBytes) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maximumBytes) throw Object.assign(new Error('Request is too large'), { status: 413 });
  const reader = request.body?.getReader();
  const chunks = [];
  let byteLength = 0;
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byteLength += part.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw Object.assign(new Error('Request is too large'), { status: 413 });
      }
      chunks.push(part.value);
    }
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object expected');
    return value;
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

const SOURCE_RATE_FIELDS = ['sourceBasicMinutes', 'sourceOt15Minutes', 'sourceOt20Minutes'];
const SOURCE_RATE_COLUMNS = ['Source basic hours', 'Source overtime 1.5× hours', 'Source overtime 2× hours'];
function renderPayMonthRows(rows, period, rateMode, invalid) {
  try { return payMonthWorkbook.toWorkbookData({rows:rows.map(row=>({row}))},period,{includeSourceRates:rateMode}).dailyEntries; }
  catch (_) { throw invalid(); }
}
function sourceRatesMatch(actual, rendered, rateMode) {
  return SOURCE_RATE_FIELDS.every((key,index)=>{
    if (!rateMode) return !Object.hasOwn(actual,key);
    const value=rendered[SOURCE_RATE_COLUMNS[index]];
    return Object.hasOwn(actual,key) && actual[key] === (value === '' ? null : value);
  });
}
export function validatePayMonthAttachmentVersion(record, attachments) {
  const invalid=()=>Object.assign(new Error('The workbook does not match the saved timesheet. Refresh and try again.'),{status:409});
  const payload=payloadObject(record), attachment=attachments.find(item=>item.fieldName==='attachment_record');
  let source;
  try {source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64(attachment?.contentBase64)));}catch(_){throw invalid();}
  if(!source || typeof source!=='object' || Array.isArray(source) || ![2,3].includes(source.schemaVersion) || source.mode!=='replace-pay-month' ||
     source.recordId!==record.record_id || String(source.employeeUpn||'').toLowerCase()!==String(record.owner_upn||'').toLowerCase() ||
     !payload.editedAt || source.submittedAt!==payload.editedAt || !payload.payMonth || source.payMonth!==payload.payMonth || !Array.isArray(source.rows) || source.rows.length===0)throw invalid();
  const savedDeletions=payload.deletedDays === undefined ? [] : payload.deletedDays;
  const sourceDeletions=source.deletedDays === undefined ? [] : source.deletedDays;
  if (![savedDeletions,sourceDeletions].every(days=>Array.isArray(days) && days.length<=62 &&
      days.every(validReceiptDate) && new Set(days).size===days.length) ||
      JSON.stringify([...savedDeletions].sort())!==JSON.stringify([...sourceDeletions].sort())) throw invalid();
  const savedRows=payload.rows === undefined ? [] : payload.rows;
  if (!Array.isArray(savedRows) || savedRows.length>62 || source.rows.length>62 ||
      savedRows.some(row=>!row || typeof row!=='object' || Array.isArray(row)) ||
      source.rows.some(row=>!row || typeof row!=='object' || Array.isArray(row) || !validReceiptDate(row.date)) ||
      new Set(source.rows.map(row=>row.date)).size!==source.rows.length ||
      source.rows.some(row=>savedDeletions.includes(row.date))) throw invalid();
  const rateMode=source.schemaVersion===3;
  const expected=renderPayMonthRows(savedRows,{},rateMode,invalid);
  if (expected.some(row=>!validReceiptDate(row.Date)) || new Set(expected.map(row=>row.Date)).size!==expected.length) throw invalid();
  const allowed=new Set(['recordId','date','startTime','finishTime','breakMinutes','absenceReason','totalMinutes','workedHours','note','changeNote',...(rateMode?SOURCE_RATE_FIELDS:[])]);
  for (const row of source.rows) {
    if (Object.keys(row).some(key=>!allowed.has(key))) throw invalid();
    if (rateMode) sourceRateValues(row,409);
  }
  for (const row of expected) {
    const actual=source.rows.find(item=>item.date===row.Date);
    const minutes=row['Total hours'];
    const changeNote=`Edited by ${payload.editedBy || 'Accounts'} at ${payload.editedAt || 'unknown time'}`;
    if (!actual || Object.keys(actual).some(key=>!allowed.has(key)) || actual.recordId!==`${record.record_id}|${row.Date}` ||
        actual.startTime!==row.Start || actual.finishTime!==row.Finish || actual.breakMinutes!==row.Break ||
        actual.absenceReason!==row.Absence || actual.totalMinutes!==minutes ||
        actual.workedHours!==(minutes===''?'':Number((minutes/60).toFixed(4))) || actual.note!==row.Notes || actual.changeNote!==changeNote || !sourceRatesMatch(actual,row,rateMode)) throw invalid();
  }
  return source;
}

// `historyRows` must be selected and authorised by the server, never from
// the request body. This comparison alone does not establish their provenance.
function validatePayMonthSourceAgainstHistory(record, historyRows, attachments, period, allowAdditionalRows) {
  const invalid=()=>Object.assign(new Error('The workbook does not match the saved timesheet history.'),{status:409});
  validatePayMonthAttachmentVersion(record,attachments);
  const payload=payloadObject(record);
  let source;
  try { source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64(attachments.find(item=>item.fieldName==='attachment_record')?.contentBase64))); }
  catch (_) { throw invalid(); }
  if (!period || !validReceiptDate(period.start) || !validReceiptDate(period.cycleEnd) || period.start>period.cycleEnd ||
      source.cycleStart!==period.start || source.cycleEnd!==period.cycleEnd || !Array.isArray(historyRows) || historyRows.length>62 ||
      historyRows.some(row=>!row || typeof row!=='object' || Array.isArray(row))) throw invalid();
  const inCycle=date=>validReceiptDate(date) && date>=period.start && date<=period.cycleEnd;
  const rateMode=source.schemaVersion===3;
  const historyEntries=renderPayMonthRows(historyRows,period,rateMode,invalid);
  if (historyEntries.some(row=>!inCycle(row.Date)) || new Set(historyEntries.map(row=>row.Date)).size!==historyEntries.length ||
      (payload.deletedDays||[]).some(date=>!inCycle(date))) throw invalid();
  const corrected=renderPayMonthRows(payload.rows||[],period,rateMode,invalid);
  if (corrected.some(row=>!inCycle(row.Date))) throw invalid();
  const rows=new Map(historyEntries.map(row=>[row.Date,row]));
  for (const row of corrected) rows.set(row.Date,row);
  for (const date of payload.deletedDays||[]) rows.delete(date);
  if ((!allowAdditionalRows && (!rows.size || rows.size!==source.rows.length)) || source.rows.some(row=>!inCycle(row.date))) throw invalid();
  const correctedDates=new Set(corrected.map(row=>row.Date));
  const allowed=new Set(['recordId','date','startTime','finishTime','breakMinutes','absenceReason','totalMinutes','workedHours','note','changeNote',...(rateMode?SOURCE_RATE_FIELDS:[])]);
  let matched=0;
  for (const actual of source.rows) {
    const row=rows.get(actual.date), minutes=row?.['Total hours'];
    if (!row && allowAdditionalRows) continue;
    const changeNote=correctedDates.has(actual.date)?`Edited by ${payload.editedBy || 'Accounts'} at ${payload.editedAt || 'unknown time'}`:'';
    if (!row || Object.keys(actual).some(key=>!allowed.has(key)) || actual.recordId!==`${record.record_id}|${row.Date}` ||
        actual.startTime!==row.Start || actual.finishTime!==row.Finish || actual.breakMinutes!==row.Break ||
        actual.absenceReason!==row.Absence || actual.totalMinutes!==minutes ||
        actual.workedHours!==(minutes===''?'':Number((minutes/60).toFixed(4))) || actual.note!==row.Notes || actual.changeNote!==changeNote || !sourceRatesMatch(actual,row,rateMode)) throw invalid();
    matched++;
  }
  if (matched!==rows.size) throw invalid();
  return source;
}

export function validateCompletePayMonthSource(record, historyRows, attachments, period) {
  return validatePayMonthSourceAgainstHistory(record,historyRows,attachments,period,false);
}

// A necessary partial check only: additional upstream days are not approved
// by this function and still require independently verified complete history.
export function validateKnownPayMonthSource(record, historyRows, attachments, period) {
  return validatePayMonthSourceAgainstHistory(record,historyRows,attachments,period,true);
}

// This selector accepts only D1 rows already obtained by a server-side query.
// Directory verification, source completeness and the queue's atomic revision
// check remain the caller's responsibility; no browser-supplied list is trusted.
export function selectTrustedPayMonthHistory(records,subject,period) {
  const invalid=()=>Object.assign(new Error('Timesheet history needs review before workbook filing.'),{status:409});
  const oid=String(subject?.oid||'').trim().toLowerCase(),upn=String(subject?.upn||'').trim().toLowerCase();
  if (!oid || !upn || !period || !validReceiptDate(period.start) || !validReceiptDate(period.cycleEnd) || period.start>period.cycleEnd ||
      !Array.isArray(records) || records.length>1000) throw invalid();
  const selected=new Map(),ids=new Set(),originalRates=new Map();
  const choose=(date,candidate)=>{
    const previous=selected.get(date);
    if(previous && candidate.priority===previous.priority && candidate.priority<3){
      const differs=candidate.deleted!==previous.deleted || (!candidate.deleted && JSON.stringify(candidate.rendered)!==JSON.stringify(previous.rendered));
      const conflict=Boolean(previous.conflict||differs);
      if(candidate.updated>previous.updated)selected.set(date,{...candidate,conflict});
      else previous.conflict=conflict;
      return;
    }
    if(previous && candidate.priority===previous.priority && candidate.updated===previous.updated &&
       (candidate.deleted!==previous.deleted || (!candidate.deleted && JSON.stringify(candidate.rendered)!==JSON.stringify(previous.rendered))))previous.conflict=true;
    if(!previous || candidate.priority>previous.priority || (candidate.priority===previous.priority && candidate.updated>previous.updated))selected.set(date,candidate);
  };
  for (const record of records) {
    const id=String(record?.record_id||'');
    if (!id || ids.has(id) || String(record.owner_oid||'').toLowerCase()!==oid || String(record.owner_upn||'').toLowerCase()!==upn ||
        !['timesheets','clock'].includes(record.kind) || record.status==='Deleted') throw invalid();
    ids.add(id);
    let payload;
    try {payload=JSON.parse(record.payload_json);} catch (_) {throw invalid();}
    if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw invalid();
    const entries=payload.rows ?? payload.dailyRows ?? payload.daily_rows;
    if (!Array.isArray(entries) || entries.length>80 || entries.some(row=>!row || typeof row!=='object' || Array.isArray(row))) throw invalid();
    const days=payload.deletedDays===undefined?[]:payload.deletedDays;
    if (!Array.isArray(days) || days.length>62 || days.some(day=>!validReceiptDate(day)) || new Set(days).size!==days.length) throw invalid();
    if (!entries.length && (record.action!=='pay_month_correction' || !days.length)) throw invalid();
    // A label inside a source payload is not independent evidence that a
    // conflicting day was reviewed. Ordinary sources have equal priority.
    const priority=record.action==='pay_month_correction'?3:1;
    const parsed=Date.parse(String(record.updated_at||record.submitted_at||'')),updated=Number.isFinite(parsed)?parsed:0;
    const rendered=payMonthWorkbook.toWorkbookData({rows:entries.map(row=>({row}))},period).dailyEntries;
    if (rendered.some(row=>!validReceiptDate(row.Date)) || new Set(rendered.map(row=>row.Date)).size!==rendered.length) throw invalid();
    if(record.action==='pay_month_correction')for(const day of days){
      if(rendered.some(row=>row.Date===day))throw invalid();
      if(day>=period.start && day<=period.cycleEnd)choose(day,{deleted:true,priority,updated});
    }
    for(let i=0;i<rendered.length;i++) {
      const renderedRow=rendered[i], date=renderedRow.Date;
      if(date<period.start || date>period.cycleEnd) continue;
      const evidence=entries[i].sourceEvidence && typeof entries[i].sourceEvidence==='object' ? entries[i].sourceEvidence : {};
      // Rate claims are independent of total hours; disagreement must not be
      // hidden by identical clock totals. This is conflict detection, not
      // authentication or approval of either claim.
      const rateEvidence=[evidence.rateEvidenceVersion??null,evidence.claimedBasic??null,evidence.claimedOt15??null,evidence.claimedOt20??null];
      if(priority<3 && rateEvidence[0]===1 && rateEvidence.slice(1).some(value=>value!==null)) {
        if(!originalRates.has(date)) originalRates.set(date,[]);
        originalRates.get(date).push(rateEvidence);
      }
      choose(date,{row:entries[i],priority,updated,rendered:{...renderedRow,rateEvidence},deleted:false});
    }
  }
  if([...selected.values()].some(entry=>entry.conflict))throw invalid();
  for(const [date,entry] of selected) {
    if(entry.deleted || entry.priority!==3) continue;
    if((originalRates.get(date)||[]).some(rates=>JSON.stringify(rates)!==JSON.stringify(entry.rendered.rateEvidence))) throw invalid();
  }
  return [...selected.entries()].filter(([,entry])=>!entry.deleted).sort(([a],[b])=>a.localeCompare(b)).map(([,entry])=>entry.row);
}

// A local candidate only: this does not establish completeness of SharePoint
// or other external sources. The queue must also bind the returned revision
// in its transaction after the server has verified those sources.
export async function readLocalPayMonthSnapshot(env,subject,period,excludeRecordId) {
  const conflict=()=>Object.assign(new Error('Timesheet history needs review before workbook filing.'),{status:409});
  const oid=String(subject?.oid||'').trim().toLowerCase(),upn=String(subject?.upn||'').trim().toLowerCase();
  if (!oid || !upn || typeof excludeRecordId!=='string' || !excludeRecordId || !validReceiptDate(period?.start) || !validReceiptDate(period?.cycleEnd) || period.start>period.cycleEnd) throw conflict();
  const version=async()=>env.DB.prepare(`SELECT COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0) AS revision,
    (SELECT count(*) FROM records identity_source WHERE identity_source.kind IN ('timesheets','clock') AND identity_source.status<>'Deleted'
      AND ((lower(identity_source.owner_oid)=? AND lower(identity_source.owner_upn)<>?) OR
           (lower(identity_source.owner_upn)=? AND lower(identity_source.owner_oid)<>?))) AS identity_conflicts,
    (SELECT count(*) FROM timesheet_ownership_reviews review LEFT JOIN records source ON source.record_id=review.record_id
      WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?) AS review_count,
    COALESCE((SELECT MAX(e.event_id) FROM timesheet_ownership_review_events e JOIN timesheet_ownership_reviews review ON review.review_id=e.review_id
      LEFT JOIN records source ON source.record_id=review.record_id WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?),0) AS review_event,
    (SELECT count(*) FROM timesheet_import_source_days h WHERE ((h.owner_oid<>'' AND lower(h.owner_oid)=?) OR (h.owner_upn<>'' AND lower(h.owner_upn)=?) OR (h.owner_oid='' AND h.owner_upn='')) AND (h.source_day='*' OR h.source_day BETWEEN ? AND ?)) AS imported_source_count`)
    .bind(upn,oid,upn,upn,oid,oid,upn,oid,upn,oid,upn,period.start,period.cycleEnd).first();
  const before=await version();
  if(before && Number.isSafeInteger(before.imported_source_count) && before.imported_source_count>0)throw Object.assign(new Error('This imported timesheet is held for independent source review.'),{status:409});
  if (!before || !Number.isSafeInteger(before.revision) || !Number.isSafeInteger(before.review_count) || !Number.isSafeInteger(before.review_event) || !Number.isSafeInteger(before.imported_source_count) || before.imported_source_count!==0 || before.review_count!==0 || before.identity_conflicts!==0) throw conflict();
  const result=await env.DB.prepare(`SELECT r.* FROM records r WHERE (lower(r.owner_upn)=? OR lower(r.owner_oid)=?) AND r.kind IN ('timesheets','clock')
    AND r.status<>'Deleted' AND r.record_id<>? ORDER BY r.record_id LIMIT 1001`).bind(upn,oid,excludeRecordId).all();
  if (!Array.isArray(result?.results) || result.results.length>1000) throw conflict();
  const rows=selectTrustedPayMonthHistory(result.results,{oid,upn},period);
  const after=await version();
  if(after && Number.isSafeInteger(after.imported_source_count) && after.imported_source_count>0)throw Object.assign(new Error('This imported timesheet is held for independent source review.'),{status:409});
  if (!after || after.revision!==before.revision || after.review_count!==before.review_count || after.review_event!==before.review_event || after.imported_source_count!==0 || after.identity_conflicts!==0) throw conflict();
  return {rows,revision:before.revision,reviewEvent:before.review_event};
}

function hasSourceRateClaims(row) {
  const evidence=row?.sourceEvidence;
  return !!evidence && typeof evidence==='object' && !Array.isArray(evidence) &&
    ['claimedBasic','claimedOt15','claimedOt20'].some(key=>evidence[key]!==null && evidence[key]!==undefined && evidence[key]!=='');
}
function hasUninterpretedSourceRates(row) {
  return hasSourceRateClaims(row) && row.sourceEvidence.rateEvidenceVersion!==1;
}

// For a reviewer, preserve every distinct value or deletion for a date. A
// later correction is not by itself evidence that a disagreement is resolved.
// This is a diagnostic projection and must never select a delivery source.
function reviewPayMonthAlternatives(records,subject,period) {
  const invalid=()=>Object.assign(new Error('Timesheet history needs review before workbook filing.'),{status:409});
  const byDate=new Map();let total=0;
  const add=(date,candidate)=>{
    if(date<period.start||date>period.cycleEnd)return;
    if(++total>1000)throw invalid();
    const list=byDate.get(date)||[];list.push(candidate);byDate.set(date,list);
  };
  for(const record of records){
    selectTrustedPayMonthHistory([record],subject,period);
    let payload;try{payload=JSON.parse(record.payload_json)}catch(_){throw invalid()}
    const entries=payload.rows??payload.dailyRows??payload.daily_rows,rendered=renderPayMonthRows(entries,period,true,invalid);
    for(let i=0;i<entries.length;i++)add(rendered[i].Date,{recordId:record.record_id,deleted:false,row:rendered[i],raw:entries[i]});
    for(const day of payload.deletedDays||[])add(day,{recordId:record.record_id,deleted:true,row:null,raw:null});
  }
  if(byDate.size>62)throw invalid();
  const rows=[],conflicts=[];
  for(const [date,candidates] of [...byDate.entries()].sort(([a],[b])=>a.localeCompare(b))){
    const variants=new Set(candidates.map(item=>JSON.stringify({deleted:item.deleted,row:item.row})));
    const unknownRates=candidates.some(item=>!item.deleted&&hasUninterpretedSourceRates(item.raw));
    if(variants.size>1||unknownRates)conflicts.push({date,...(unknownRates?{reason:'uninterpreted-source-rates'}:{}),candidates:candidates.map(({recordId,deleted,row,raw})=>({recordId,deleted,row,...(!deleted&&hasUninterpretedSourceRates(raw)?{rateReviewNeeded:true}:{})}))});
    else if(!candidates[0].deleted)rows.push(candidates[0].raw);
  }
  return {rows,conflicts};
}

// Internal review-only preview. It does not authorise a caller, prove external
// or historical source completeness, or grant permission to save or deliver.
// A production consumer must bind the complete state to its own atomic write;
// this double read cannot prevent a change after the final observation.
export async function readOwnershipReviewedPayMonthPreview(env,subject,period,excludeRecordId) {
  const conflict=()=>Object.assign(new Error('Timesheet history needs review before workbook filing.'),{status:409});
  const oid=String(subject?.oid||'').trim().toLowerCase(),upn=String(subject?.upn||'').trim().toLowerCase();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid)||upn.length>320||!/^[^\s@]+@[^\s@]+$/.test(upn)||
     typeof excludeRecordId!=='string'||!excludeRecordId||!validReceiptDate(period?.start)||!validReceiptDate(period?.cycleEnd)||period.start>period.cycleEnd)throw conflict();
  const state=()=>env.DB.prepare(`SELECT COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0) AS revision,
    COALESCE((SELECT MAX(event_id) FROM timesheet_ownership_review_events),0) AS review_event,
    (SELECT count(*) FROM timesheet_import_source_days h WHERE ((h.owner_oid<>'' AND lower(h.owner_oid)=?) OR
      (h.owner_upn<>'' AND lower(h.owner_upn)=?) OR (h.owner_oid='' AND h.owner_upn='')) AND (h.source_day='*' OR h.source_day BETWEEN ? AND ?)) AS source_holds`)
    .bind(upn,oid,upn,period.start,period.cycleEnd).first();
  const scan=async()=>{
    const result=await env.DB.prepare(`SELECT r.*,v.revision AS ownership_revision,
      EXISTS(SELECT 1 FROM timesheet_ownership_reviews history WHERE history.record_id=r.record_id) AS has_review,
      review.review_id,review.record_revision,review.payload_sha256,review.subject_oid AS reviewed_subject_oid
      FROM records r LEFT JOIN timesheet_review_record_revisions v ON v.record_id=r.record_id
      LEFT JOIN timesheet_ownership_reviews review ON review.record_id=r.record_id AND review.record_revision=v.revision AND NOT EXISTS
        (SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated'))
      WHERE r.kind IN ('timesheets','clock') AND r.status<>'Deleted' AND r.record_id<>? AND
        (lower(r.owner_oid)=? OR lower(r.owner_upn)=? OR EXISTS
          (SELECT 1 FROM timesheet_ownership_reviews history WHERE history.record_id=r.record_id AND lower(history.subject_oid)=?))
      ORDER BY r.record_id LIMIT 1001`).bind(excludeRecordId,oid,upn,oid).all();
    if(!Array.isArray(result?.results)||result.results.length>1000)throw conflict();
    const ids=new Set();let bytes=0;
    for(const row of result.results){
      if(!row.record_id||ids.has(row.record_id)||typeof row.payload_json!=='string')throw conflict();
      ids.add(row.record_id);bytes+=new TextEncoder().encode(row.payload_json).length;if(bytes>16_000_000)throw conflict();
    }
    return result.results;
  };
  const before=await state();
  if(!Number.isSafeInteger(before?.revision)||!Number.isSafeInteger(before?.review_event)||before?.source_holds!==0)throw conflict();
  const first=await scan();
  await assertCurrentSourceReviewSubject(env,oid,upn);
  const latest=await scan(),after=await state();
  if(!Number.isSafeInteger(after?.revision)||!Number.isSafeInteger(after?.review_event)||after?.source_holds!==0||
     before.revision!==after.revision||before.review_event!==after.review_event||JSON.stringify(first)!==JSON.stringify(latest))throw conflict();
  const accepted=[];
  for(const row of latest){
    if(row.has_review){
      if(row.kind!=='timesheets'||!Number.isSafeInteger(row.review_id)||!Number.isSafeInteger(row.ownership_revision)||
         row.record_revision!==row.ownership_revision||!/^[a-f0-9]{64}$/.test(String(row.payload_sha256||''))||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(row.reviewed_subject_oid||'')))throw conflict();
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.payload_json));
      if(Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')!==row.payload_sha256)throw conflict();
      if(row.reviewed_subject_oid.toLowerCase()!==oid)continue;
      // The copy is solely for the selector; persisted owner metadata is untouched.
      accepted.push({...row,owner_oid:oid,owner_upn:upn});
    }else{
      if(String(row.owner_oid||'').toLowerCase()!==oid||String(row.owner_upn||'').toLowerCase()!==upn)throw conflict();
      accepted.push(row);
    }
  }
  const alternatives=reviewPayMonthAlternatives(accepted,{oid,upn},period);
  return {scope:'review-only',...alternatives,revision:after.revision,reviewEvent:after.review_event};
}

// Reviewer-only view of other current local records. This omits the selected
// correction and says nothing about old versions, attachments or upstream
// sources. It never queues, saves or authorises delivery.
async function ownershipLocalHistoryPreview(request,env,identity,recordId,origin) {
  requireTimesheetOwnershipReviewer(identity);
  const conflict=()=>Object.assign(new Error('The ownership decision or local history needs review.'),{status:409});
  const upn=String(new URL(request.url).searchParams.get('upn')||'').trim().toLowerCase();
  if(upn.length>320||!/^[^\s@]+@[^\s@]+$/.test(upn))throw conflict();
  const first=await timesheetReviewSnapshot(env,recordId),row=first.row;
  const oid=String(row.active_subject_oid||'').toLowerCase(),payload=payloadObject(row),month=String(payload.payMonth||'');
  if(row.action!=='pay_month_correction'||!row.active_review_id||row.active_payload_sha256!==first.payloadSha256||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw conflict();
  const period=(await loadPayPeriods(env)).periodForMonth(month);if(!period)throw conflict();
  const attachment=()=>env.DB.prepare("SELECT content_base64 FROM record_attachments WHERE record_id=? AND field_name='attachment_record'").bind(recordId).first();
  const sourceBefore=await attachment();
  const preview=await readOwnershipReviewedPayMonthPreview(env,{oid,upn},period,recordId);
  const finalPeriod=(await loadPayPeriods(env)).periodForMonth(month),last=await timesheetReviewSnapshot(env,recordId),sourceAfter=await attachment();
  if(!finalPeriod||JSON.stringify(period)!==JSON.stringify(finalPeriod)||last.payloadSha256!==first.payloadSha256||
     last.row.revision!==row.revision||last.row.review_event_id!==row.review_event_id||last.row.active_review_id!==row.active_review_id||
     String(last.row.active_subject_oid||'').toLowerCase()!==oid||last.row.active_payload_sha256!==first.payloadSha256||
     (sourceBefore?.content_base64??null)!==(sourceAfter?.content_base64??null))throw conflict();
  const rows=payMonthWorkbook.toWorkbookData({rows:preview.rows.map(item=>({row:item}))},period).dailyEntries;
  let queuedComparison={status:'missing'};
  if(sourceAfter){
    queuedComparison={status:'invalid'};
    try{
      const encoded=String(sourceAfter.content_base64||'');if(!encoded||encoded.length>300_000)throw conflict();
      const source=validatePayMonthAttachmentVersion({...row,owner_upn:upn},[{fieldName:'attachment_record',contentBase64:encoded}]);
      const inCycle=date=>validReceiptDate(date)&&date>=period.start&&date<=period.cycleEnd;
      const minuteValue=value=>value===''||(Number.isSafeInteger(value)&&value>=0&&value<=1440);
      if(source.rows.some(item=>!inCycle(item.date)||item.recordId!==`${recordId}|${item.date}`||
        typeof item.startTime!=='string'||typeof item.finishTime!=='string'||!minuteValue(item.breakMinutes)||!minuteValue(item.totalMinutes)||
        typeof item.absenceReason!=='string'||typeof item.note!=='string'||typeof item.changeNote!=='string'||
        item.workedHours!==(item.totalMinutes===''?'':Number((item.totalMinutes/60).toFixed(4)))))throw conflict();
      const rateMode=source.schemaVersion===3,fail=()=>conflict();
      const local=renderPayMonthRows(preview.rows,period,rateMode,fail),corrected=renderPayMonthRows(payload.rows||[],period,rateMode,fail);
      if(local.some(item=>!inCycle(item.Date))||corrected.some(item=>!inCycle(item.Date)))throw conflict();
      const localByDate=new Map(local.map(item=>[item.Date,item]));
      for(const item of corrected)localByDate.set(item.Date,item);
      for(const day of payload.deletedDays||[])localByDate.delete(day);
      const fields=['Start','Finish','Break','Absence','Total hours','Notes',...(rateMode?SOURCE_RATE_COLUMNS:[])];
      const queuedByDate=new Map(source.rows.map(item=>[item.date,{Start:item.startTime,Finish:item.finishTime,Break:item.breakMinutes,Absence:item.absenceReason,
        'Total hours':item.totalMinutes,Notes:item.note,...(rateMode?Object.fromEntries(SOURCE_RATE_COLUMNS.map((key,index)=>[key,item[SOURCE_RATE_FIELDS[index]]===null?'':item[SOURCE_RATE_FIELDS[index]]])):{})}]));
      const unresolved=new Set(preview.conflicts.map(item=>item.date));
      const unresolvedRates=new Set([...preview.rows,...(payload.rows||[])].filter(item=>hasUninterpretedSourceRates(item)||(!rateMode&&hasSourceRateClaims(item))).map(item=>payMonthWorkbook.toWorkbookData({rows:[{row:item}]},period).dailyEntries[0].Date).filter(inCycle));
      const dates=[...new Set([...localByDate.keys(),...queuedByDate.keys(),...unresolved])].sort().map(date=>{
        const a=localByDate.get(date),b=queuedByDate.get(date),localValue=a?Object.fromEntries(fields.map(key=>[key,a[key]])):null,queuedValue=b?Object.fromEntries(fields.map(key=>[key,b[key]])):null;
        if(unresolved.has(date))return {date,status:'needs-review',fields:[],local:null,queued:queuedValue};
        if(unresolvedRates.has(date))return {date,status:'needs-review',reason:'source-rates',fields:[],local:null,queued:queuedValue};
        const differing=a&&b?fields.filter(key=>localValue[key]!==queuedValue[key]):[];
        return {date,status:!a?'only-queued':!b?'only-local':differing.length?'different':'match',fields:differing,local:localValue,queued:queuedValue};
      });
      queuedComparison={status:'compared',dates};
    }catch(_){/* Invalid or uncomparable retained data is not a successful check. */}
  }
  return json({scope:'other-local-records-only',payMonth:month,rows,conflicts:preview.conflicts,queuedComparison},200,origin);
}

// Hold inconsistent stored identities for review; an object ID or address
// alone cannot establish which historical rows belong in a workbook.
function unambiguousLocalTimesheetSubject(subject) {
  return `NOT EXISTS (SELECT 1 FROM records identity_source
    WHERE identity_source.kind IN ('timesheets','clock') AND identity_source.status<>'Deleted'
      AND ((lower(identity_source.owner_oid)=lower(${subject}.owner_oid) AND lower(identity_source.owner_upn)<>lower(${subject}.owner_upn))
        OR (lower(identity_source.owner_upn)=lower(${subject}.owner_upn) AND lower(identity_source.owner_oid)<>lower(${subject}.owner_oid))))`;
}

export function queueRecordAttachments(env, record, body, capability = null, localSnapshotRevision = undefined) {
  const payload = payloadObject(record);
  const synthetic = syntheticRecord(record, payload);
  const rateProviderDestination = env.SYNTHETIC_RATE_TEST_MODE === 'provider-fixture-v1' &&
    env.PRIVATE_TIMESHEET_PARENT_ID === '01ZURLVFIIINPOKIYCCZEJFTFMCUTRGBUL' &&
    env.SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID === '01ZURLVFLBUIMATW7STNBLMXO3VGLMSTCB' &&
    env.SYNTHETIC_TEST_MONTH_FOLDER_ID === '01ZURLVFOCW3CCKIKQRZFJYU6JYYWSK3UK' &&
    env.SYNTHETIC_TEST_WORKBOOK_ID === '01ZURLVFKFZ6PPD3U36RHLN74B2KFNIR4F';
  if (capability === syntheticQueueCapability && (env.SYNTHETIC_TEST_QUEUE_ENABLED !== 'true' ||
      env.DISPATCH_ENABLED !== 'false' || env.PAY_MONTH_REPLAY_READY !== 'false' ||
      (env.PRIVATE_TIMESHEET_PARENT_ID !== '01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP' && !rateProviderDestination) ||
      payload.testMode !== true || !synthetic || record.kind !== 'timesheets' || record.action !== 'pay_month_correction')) {
    throw Object.assign(new Error('The isolated queue accepts fictional timesheet corrections only'), { status: 403 });
  }
  if (synthetic && capability !== syntheticQueueCapability) {
    return { queued: false, skipped: true, reason: 'synthetic-test-record' };
  }
  const attachments = parseQueuedAttachments(body);
  if (record.action === 'pay_month_correction' && !attachments.some((attachment) => attachment.fieldName === 'attachment_record')) {
    throw Object.assign(new Error('Pay-month corrections require a dated JSON record attachment for workbook filing'), { status: 400 });
  }
  let correctionSource;
  if(record.action==='pay_month_correction'){
    const source=correctionSource=validatePayMonthAttachmentVersion(record,attachments);
    if(source.schemaVersion===3 && env.PAY_MONTH_RATE_DELIVERY_READY!=='true') throw Object.assign(new Error('Source rate delivery is not ready'),{status:409});
    if(source.schemaVersion===3 && capability!==syntheticQueueCapability) throw Object.assign(new Error('Source rate delivery awaits independent original review'),{status:409});
  }
  const bindLocalSource=record.action==='pay_month_correction' && !synthetic;
  // Only the isolated gateway supplies the unforgeable capability after it
  // validates the exact fictional fixture and the complete local snapshot.
  // Its proof records those local facts; it does not release source holds.
  const proveLocalSource=bindLocalSource || (synthetic && capability===syntheticQueueCapability && Number.isSafeInteger(localSnapshotRevision) && localSnapshotRevision>=0);
  if (bindLocalSource && (!Number.isSafeInteger(localSnapshotRevision) || localSnapshotRevision<0))
    throw Object.assign(new Error('The verified timesheet history is unavailable.'),{status:409});
  if(bindLocalSource && (!validReceiptDate(correctionSource?.cycleStart)||!validReceiptDate(correctionSource?.cycleEnd)||correctionSource.cycleStart>correctionSource.cycleEnd))throw Object.assign(new Error('The verified pay-month period is unavailable.'),{status:409});
  const timestamp = now();
  if(record.kind==='timesheets') {
    const queueWithPrior=(prior)=>{
    // Each statement runs inside the same D1 batch transaction. A stale
    // browser must neither erase newer attachments nor reset an in-flight
    // delivery. Unknown/failed delivery outcomes require reconciliation.
    let guard=`EXISTS (SELECT 1 FROM records r WHERE r.record_id=? AND r.payload_json=? AND r.owner_oid IS ? AND r.owner_upn IS ? AND r.employee_name IS ? AND r.kind IS ? AND r.action IS ? AND r.status<>'Deleted') AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=? AND q.status IN ('sending','sent','failed','uncertain')) AND NOT EXISTS (SELECT 1 FROM dispatch_queue q JOIN records r ON r.record_id=q.record_id WHERE lower(r.owner_upn)=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.record_id<>? AND q.status IN ('queued','sending','sent','failed','uncertain')) AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=?)`;
    const guardArgs=[record.record_id,record.payload_json,record.owner_oid??null,record.owner_upn??null,record.employee_name??null,record.kind??null,record.action??null,record.record_id,String(record.owner_upn||'').toLowerCase(),record.record_id,record.record_id];
    if(bindLocalSource){guard+=' AND NOT EXISTS (SELECT 1 FROM timesheet_import_source_holds source_hold WHERE source_hold.record_id=?) AND NOT EXISTS (SELECT 1 FROM timesheet_import_source_days h WHERE ((h.owner_oid<>\'\' AND lower(h.owner_oid)=?) OR (h.owner_upn<>\'\' AND lower(h.owner_upn)=?) OR (h.owner_oid=\'\' AND h.owner_upn=\'\')) AND (h.source_day=\'*\' OR h.source_day BETWEEN ? AND ?))';guardArgs.push(record.record_id,String(record.owner_oid||'').toLowerCase(),String(record.owner_upn||'').toLowerCase(),correctionSource.cycleStart,correctionSource.cycleEnd);}
    const finalBaseGuard=guard,finalBaseArgs=[...guardArgs];
    if (localSnapshotRevision!==undefined) {
      if (!Number.isSafeInteger(localSnapshotRevision) || localSnapshotRevision<0 || !record.owner_oid || !record.owner_upn) throw Object.assign(new Error('The verified timesheet history is unavailable.'),{status:409});
      guard+=` AND COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0)=?
        AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records source ON source.record_id=review.record_id
          WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?)
        AND EXISTS (SELECT 1 FROM records identity_subject WHERE identity_subject.record_id=? AND ${unambiguousLocalTimesheetSubject('identity_subject')})`;
      guardArgs.push(String(record.owner_upn).toLowerCase(),localSnapshotRevision,String(record.owner_oid).toLowerCase(),String(record.owner_upn).toLowerCase(),record.record_id);
    }
    let initialGuard=guard,initialArgs=[...guardArgs];
    // A skipped item is an explicit hold, and a queued item with a prior
    // attempt has an ambiguous delivery outcome. Neither may be reset by
    // an attachment submission. The reservation below uses its own skipped
    // marker only after this initial comparison succeeds.
    initialGuard+=` AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=? AND
      (q.status='skipped' OR (q.status='queued' AND (q.attempts<>0 OR q.last_sent_at IS NOT NULL))))`;
    initialArgs.push(record.record_id);
    if(record.action==='pay_month_correction') {
      if(prior?.status==='completed') {
        let source;
        try {source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64(prior.source_base64)));}catch(_){throw Object.assign(new Error('The previous workbook source needs reconciliation.'),{status:409});}
        const previousAt=Date.parse(String(source?.submittedAt||'')),currentAt=Date.parse(String(payload.editedAt||''));
        if(![2,3].includes(source?.schemaVersion) || source.mode!=='replace-pay-month' || source.recordId!==record.record_id ||
          String(source.employeeUpn||'').toLowerCase()!==String(record.owner_upn||'').toLowerCase() || source.payMonth!==payload.payMonth ||
          !Number.isFinite(previousAt) || !Number.isFinite(currentAt) || currentAt<=previousAt)
          throw Object.assign(new Error('The saved correction has already completed or needs reconciliation.'),{status:409});
        initialGuard+=` AND EXISTS (SELECT 1 FROM dispatch_queue q JOIN record_attachments a ON a.record_id=q.record_id AND a.field_name='attachment_record'
          WHERE q.record_id=? AND q.status='completed' AND a.content_base64=?)`;
        initialArgs.push(record.record_id,prior.source_base64);
        // A completed flag alone cannot prove which bytes reached a workbook.
        // Bind the retained source to a route and both generation receipts.
        initialGuard+=` AND EXISTS (SELECT 1 FROM timesheet_delivery_routes route
          JOIN timesheet_delivery_receipts receipt ON receipt.record_id=route.record_id AND receipt.flow_run_id=route.flow_run_id AND receipt.run_started_at=route.run_started_at
          WHERE route.record_id=? AND route.generation=? AND receipt.event_type='flow_completed'
            AND json_extract(receipt.evidence_json,'$.generation')=route.generation
            AND EXISTS (SELECT 1 FROM timesheet_delivery_receipts verified WHERE verified.record_id=route.record_id
              AND verified.flow_run_id=route.flow_run_id AND verified.run_started_at=route.run_started_at AND verified.event_type='workbook_verified'
              AND json_extract(verified.evidence_json,'$.generation')=route.generation
              AND json_extract(verified.evidence_json,'$.sourceRowVerification')=?))`;
        initialArgs.push(record.record_id,prior.generation,source.schemaVersion===3?'source-row-v2':'source-row-v1');
      }else {
        initialGuard+=` AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=? AND q.status='completed')`;
        initialArgs.push(record.record_id);
      }
    }
    // The reservation is invisible outside the D1 batch. A unique marker
    // prevents later statements from mutating an existing queue when the
    // initial comparison lost a race. It becomes queued only at the end.
    const marker='queue-preparation:'+randomBase64Url(18);
    const reserved=`${guard} AND EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=? AND q.status='skipped' AND q.last_error=?)`;
    const reservedArgs=[...guardArgs,record.record_id,marker];
    // Updating the record advances the owner revision inside this same batch.
    // Check the original revision before that update, then verify the final
    // record, review state and exact attachments without expecting it to stay
    // unchanged after our own write.
    let ready=`${finalBaseGuard} AND EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=? AND q.status='skipped' AND q.last_error=?)
      AND EXISTS (SELECT 1 FROM records r WHERE r.record_id=? AND r.status='Queued for Accounts')
      AND (SELECT count(*) FROM record_attachments a WHERE a.record_id=?)=?`;
    const readyArgs=[...finalBaseArgs,record.record_id,marker,record.record_id,record.record_id,attachments.length];
    if(localSnapshotRevision!==undefined) {
      ready+=` AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records source ON source.record_id=review.record_id
        WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?)`;
      readyArgs.push(String(record.owner_oid).toLowerCase(),String(record.owner_upn).toLowerCase());
    }
    for(const attachment of attachments) {
      ready+=` AND EXISTS (SELECT 1 FROM record_attachments a WHERE a.record_id=? AND a.field_name=? AND a.file_name=?
        AND a.content_type=? AND a.content_base64=? AND a.size_bytes=?)`;
      readyArgs.push(record.record_id,attachment.fieldName,attachment.fileName,attachment.contentType,attachment.contentBase64,attachment.sizeBytes);
    }
    const sourceAttachment=attachments.find(item=>item.fieldName==='attachment_record');
    const proofStatement=proveLocalSource ? env.DB.prepare(`INSERT INTO timesheet_queue_source_guards(record_id,owner_upn,owner_revision,source_base64)
      SELECT ?,?,?,? WHERE ${ready} AND COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0)=?
      ON CONFLICT(record_id) DO UPDATE SET owner_upn=excluded.owner_upn,owner_revision=excluded.owner_revision,source_base64=excluded.source_base64`)
      .bind(record.record_id,String(record.owner_upn).toLowerCase(),localSnapshotRevision+1,sourceAttachment.contentBase64,...readyArgs,String(record.owner_upn).toLowerCase(),localSnapshotRevision+1) : null;
    const attachmentManifest=proveLocalSource ? JSON.stringify(attachments.map(({fieldName,fileName,contentType,contentBase64,sizeBytes})=>({fieldName,fileName,contentType,contentBase64,sizeBytes}))) : null;
    const attachmentProofStatement=proveLocalSource ? env.DB.prepare(`INSERT INTO timesheet_queue_attachment_guards(record_id,manifest_json)
      SELECT ?,? WHERE ${ready} AND COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0)=?
      ON CONFLICT(record_id) DO UPDATE SET manifest_json=excluded.manifest_json`)
      .bind(record.record_id,attachmentManifest,...readyArgs,String(record.owner_upn).toLowerCase(),localSnapshotRevision+1) : null;
    let finalReady=ready;
    const finalReadyArgs=[...readyArgs];
    if (proveLocalSource) {
      finalReady+=` AND EXISTS (SELECT 1 FROM timesheet_queue_source_guards proof WHERE proof.record_id=? AND proof.owner_upn=? AND proof.owner_revision=? AND proof.source_base64=?)`;
      finalReadyArgs.push(record.record_id,String(record.owner_upn).toLowerCase(),localSnapshotRevision+1,sourceAttachment.contentBase64);
      finalReady+=` AND EXISTS (SELECT 1 FROM timesheet_queue_attachment_guards proof WHERE proof.record_id=? AND proof.manifest_json=?)`;
      finalReadyArgs.push(record.record_id,attachmentManifest);
    }
    const statements=[
      env.DB.prepare(`INSERT INTO dispatch_queue (record_id,status,queued_at,updated_at,attempts,next_attempt_at,last_sent_at,last_error) SELECT ?,'skipped',?,?,0,?,NULL,? WHERE ${initialGuard} ON CONFLICT(record_id) DO UPDATE SET status='skipped',queued_at=excluded.queued_at,updated_at=excluded.updated_at,attempts=0,next_attempt_at=excluded.next_attempt_at,last_sent_at=NULL,last_error=excluded.last_error`).bind(record.record_id,timestamp,timestamp,timestamp,marker,...initialArgs),
      env.DB.prepare(`DELETE FROM record_attachments WHERE record_id=? AND ${reserved}`).bind(record.record_id,...reservedArgs),
      ...attachments.map(attachment=>env.DB.prepare(`INSERT INTO record_attachments (record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) SELECT ?,?,?,?,?,?,? WHERE ${reserved}`).bind(record.record_id,attachment.fieldName,attachment.fileName,attachment.contentType,attachment.contentBase64,attachment.sizeBytes,timestamp,...reservedArgs)),
      env.DB.prepare(`UPDATE records SET status='Queued for Accounts',issue='',updated_at=? WHERE record_id=? AND ${reserved}`).bind(timestamp,record.record_id,...reservedArgs),
      ...(proofStatement ? [proofStatement] : []),
      ...(attachmentProofStatement ? [attachmentProofStatement] : []),
      env.DB.prepare(`UPDATE dispatch_queue SET status='queued',last_error=NULL WHERE record_id=? AND status='skipped' AND last_error=? AND ${finalReady}`).bind(record.record_id,marker,...finalReadyArgs)
    ];
    return env.DB.batch(statements).then(async results=>{
      if(Number(results?.at(-1)?.meta?.changes||0)<1){
        if(bindLocalSource && await env.DB.prepare('SELECT 1 AS held FROM timesheet_import_source_holds WHERE record_id=?').bind(record.record_id).first())throw Object.assign(new Error('This imported timesheet is held for independent source review.'),{status:409});
        if(bindLocalSource && await env.DB.prepare("SELECT 1 AS held FROM timesheet_import_source_days h WHERE ((h.owner_oid<>'' AND lower(h.owner_oid)=?) OR (h.owner_upn<>'' AND lower(h.owner_upn)=?) OR (h.owner_oid='' AND h.owner_upn='')) AND (h.source_day='*' OR h.source_day BETWEEN ? AND ?) LIMIT 1").bind(String(record.owner_oid||'').toLowerCase(),String(record.owner_upn||'').toLowerCase(),correctionSource.cycleStart,correctionSource.cycleEnd).first())throw Object.assign(new Error('This imported timesheet is held for independent source review.'),{status:409});
        throw Object.assign(new Error('The timesheet changed or its previous workbook is still being delivered. Refresh and review before queueing.'),{status:409});
      }
      return {queued:true,recordId:record.record_id,attachments:attachments.length,queuedAt:timestamp,providerStatus:record.action==='pay_month_correction'?(capability===syntheticQueueCapability?(timesheetDeliveryReady(env)?'queued':'awaiting-provider'):'awaiting-source-review'):'queued'};
    });
    };
    if(record.action!=='pay_month_correction')return queueWithPrior(null);
    return env.DB.prepare(`SELECT q.status,a.content_base64 AS source_base64 FROM dispatch_queue q
      LEFT JOIN record_attachments a ON a.record_id=q.record_id AND a.field_name='attachment_record' WHERE q.record_id=?`)
      .bind(record.record_id).first().then(async prior=>{
        if(prior?.status==='completed') {
          try {prior.generation=await correctionGeneration(prior.source_base64);}catch(_){throw Object.assign(new Error('The previous workbook source needs reconciliation.'),{status:409});}
        }
        return queueWithPrior(prior);
      });
  }
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
  return env.DB.batch(statements).then(() => ({ queued: true, recordId: record.record_id, attachments: attachments.length, queuedAt: timestamp, providerStatus:record.action==='pay_month_correction'?'awaiting-source-review':'queued' }));
}

function timesheetDeliveryReady(env){
  const key=String(env.TIMESHEET_DELIVERY_CALLBACK_KEY||'');
  return env.PAY_MONTH_REPLAY_READY==='true' && env.PRIVATE_TIMESHEET_DESTINATION_VERIFIED==='true' &&
    env.TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED==='true' && env.TIMESHEET_WORKBOOK_PROVISIONING_ENABLED==='true' &&
    key.length>=32 && key.length<=500;
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

export async function correctionGeneration(encoded) {
  const source = String(encoded || '');
  if (!source || source.length > 300_000) throw Object.assign(new Error('Correction source attachment is unavailable'), { status: 409 });
  let bytes;
  try { bytes = decodeBase64(source); } catch (_) { throw Object.assign(new Error('Correction source attachment is invalid'), { status: 409 }); }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
}

function dispatchForm(record, attachments, payPeriods = defaultPayPeriods()) {
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
  const calculatedMonth = payMonthForPayload(payload, weekStart, payPeriods);
  const month = record.action === 'pay_month_correction' && /^\d{4}-\d{2}$/.test(declaredMonth)
    ? declaredMonth
    : calculatedMonth || declaredMonth || 'unspecified';
  const period = /^\d{4}-\d{2}$/.test(month) && payPeriods && typeof payPeriods.periodForMonth === 'function'
    ? payPeriods.periodForMonth(month)
    : null;
  const cycleStart = text(payload.cycleStart || period?.start, '', 10);
  const cycleEnd = text(payload.cycleEnd || period?.cycleEnd, '', 10);
  const payrollFriday = text(payload.payrollFriday || period?.payrollFriday || period?.payrollEnd || period?.end, '', 10);
  const workbookKey = `timesheet-${submissionKeyPart(employeeUpn || employeeEmail || employeeName)}-${month}`;
  const form = new FormData();
  const set = (name, value) => form.set(name, String(value == null ? '' : value));
  set('_subject', `[GMT][TIMESHEET][CORRECTION] ${employeeName} | Week ${weekStart || 'unspecified'}`);
  set('_template', 'box');
  set('_captcha', 'false');
  set('_url', 'https://gmt-services.co.uk/portal/submissions');
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
  set('gmt_cycle_start', cycleStart);
  set('gmt_cycle_end', cycleEnd);
  set('gmt_payroll_friday', payrollFriday);
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

function queuedAttachmentGuard(recordReference) {
  return `EXISTS (SELECT 1 FROM timesheet_queue_attachment_guards guard WHERE guard.record_id=${recordReference}
    AND json_valid(guard.manifest_json) AND json_type(guard.manifest_json)='array'
    AND json_array_length(guard.manifest_json)>=3
    AND json_array_length(guard.manifest_json)=(SELECT count(*) FROM record_attachments a WHERE a.record_id=guard.record_id)
    AND json_array_length(guard.manifest_json)=(SELECT count(DISTINCT json_extract(item.value,'$.fieldName')) FROM json_each(guard.manifest_json) item)
    AND NOT EXISTS (SELECT 1 FROM json_each(guard.manifest_json) item WHERE NOT EXISTS
      (SELECT 1 FROM record_attachments a WHERE a.record_id=guard.record_id
       AND a.field_name=json_extract(item.value,'$.fieldName') AND a.file_name=json_extract(item.value,'$.fileName')
       AND a.content_type=json_extract(item.value,'$.contentType') AND a.content_base64=json_extract(item.value,'$.contentBase64')
       AND a.size_bytes=json_extract(item.value,'$.sizeBytes'))))`;
}

async function dispatchQueued(env, options = {}) {
  const endpoint = dispatchEndpoint(env);
  if (!endpoint) return { status: 'not-configured', sent: 0, failed: 0, skipped: 0 };
  // An object-identity capability keeps the existing local race harness usable.
  // It is not supplied by any production HTTP or scheduled entry point and is
  // confined to an unresolvable fixture endpoint with injected test functions.
  const fixtureOnly = options.fixtureDispatchCapability === syntheticQueueCapability &&
    endpoint === 'https://example.test' && typeof options.fetchImpl === 'function' &&
    typeof options.privateDestinationCheck === 'function';
  const payPeriods = await loadPayPeriods(env);
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
    if (row.action === 'pay_month_correction' && !timesheetDeliveryReady(env)) {
      summary.status = 'awaiting-provider';
      summary.deferred = (summary.deferred || 0) + 1;
      summary.records.push({ recordId: row.record_id, status: 'awaiting-provider' });
      continue;
    }
    if (options.dryRun) {
      if (row.action === 'pay_month_correction' && !fixtureOnly && !syntheticRecord(row,payload)) {
        summary.status='awaiting-source-review';summary.deferred=(summary.deferred||0)+1;
        summary.records.push({recordId:row.record_id,status:'awaiting-source-review'});
      } else summary.records.push({ recordId: row.record_id, status: syntheticRecord(row, payload) ? 'skipped-dry-run' : 'dry-run' });
      continue;
    }
    if (syntheticRecord(row, payload)) {
      const results=await env.DB.batch([
        env.DB.prepare(`UPDATE dispatch_queue SET status='skipped',updated_at=?,last_error=?
          WHERE record_id=? AND status IN ('queued','failed') AND next_attempt_at<=?
            AND EXISTS (SELECT 1 FROM records r WHERE r.record_id=dispatch_queue.record_id AND r.status IS ? AND r.payload_json IS ?
              AND r.owner_oid IS ? AND r.owner_upn IS ? AND r.employee_name IS ? AND r.kind IS ? AND r.action IS ? AND r.updated_at IS ?)
            AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=dispatch_queue.record_id)`)
          .bind(timestamp,'Synthetic test record was not dispatched',row.record_id,timestamp,row.status,row.payload_json,row.owner_oid,row.owner_upn,row.employee_name,row.kind,row.action,row.updated_at),
        env.DB.prepare("UPDATE records SET status='Test - not sent',issue='',updated_at=? WHERE record_id=? AND changes()=1").bind(timestamp,row.record_id)
      ]);
      const skippedChanges=results?.[0]?.meta?.changes;
      if (typeof skippedChanges!=='number' || !Number.isSafeInteger(skippedChanges) || skippedChanges<0) {
        summary.status='skip-unverified';summary.deferred=(summary.deferred||0)+1;summary.records.push({recordId:row.record_id,status:'skip-unverified'});continue;
      }
      if (skippedChanges<1) continue;
      summary.skipped += 1;
      summary.records.push({ recordId: row.record_id, status: 'skipped' });
      continue;
    }
    // A local-history match is not evidence that external and historical
    // sources are complete. Until an authenticated, generation-bound source
    // review is implemented at the send boundary, never send a real pay-month
    // correction merely because readiness switches are enabled. This applies
    // to older schema versions as well as newer imported-source records.
    if (row.action === 'pay_month_correction' && !fixtureOnly) {
      if(summary.status==='complete')summary.status='awaiting-source-review';
      summary.deferred=(summary.deferred||0)+1;
      summary.records.push({recordId:row.record_id,status:'awaiting-source-review'});
      continue;
    }
    let localDispatchRevision, localDispatchSource, localDispatchPeriod;
    if(row.action==='pay_month_correction'){
      try {const held=await env.DB.prepare('SELECT 1 AS held FROM timesheet_import_source_holds WHERE record_id=?').bind(row.record_id).first();if(held)throw new Error('Imported source awaits independent review');}
      catch(_){if(summary.status==='complete')summary.status='awaiting-source-review';summary.deferred=(summary.deferred||0)+1;summary.records.push({recordId:row.record_id,status:'awaiting-source-review'});continue;}
      try {await (options.privateDestinationCheck || verifyPrivateTimesheetDestination)(env,row);}
      catch(_){summary.status='awaiting-provider';summary.deferred=(summary.deferred||0)+1;summary.records.push({recordId:row.record_id,status:'awaiting-private-destination'});continue;}
      try {
        const month=String(payload.payMonth||'');
        const period=/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && payPeriods.periodForMonth(month);
        if (!period) throw new Error('Invalid pay month');
        localDispatchPeriod=period;
        const snapshot=await readLocalPayMonthSnapshot(env,{oid:row.owner_oid,upn:row.owner_upn},period,row.record_id);
        const source=await env.DB.prepare("SELECT content_base64 FROM record_attachments WHERE record_id=? AND field_name='attachment_record'").bind(row.record_id).first();
        localDispatchSource=source?.content_base64;
        const checkedSource=validateCompletePayMonthSource(row,snapshot.rows,[{fieldName:'attachment_record',contentBase64:localDispatchSource}],period);
        // A receiver-readiness switch is not evidence that the original file
        // or the interpretation of its rate columns was independently
        // reviewed. Keep real deliveries held until the source-review and
        // current private-file verification path is implemented end to end.
        if(checkedSource.schemaVersion===3) throw new Error('Source rate delivery awaits independent original review');
        localDispatchRevision=snapshot.revision;
      } catch (_) {
        if (summary.status==='complete') summary.status='awaiting-source-review';summary.deferred=(summary.deferred||0)+1;
        summary.records.push({recordId:row.record_id,status:'awaiting-source-review'});continue;
      }
    }
    // A failed row with any recorded workbook route is already protected by
    // the routed-write hold. Its outcome needs reconciliation, not a resend.
    // This deliberately also holds a later failed generation sharing a record
    // with an older route until generation-aware recovery is available.
    const claim = row.action==='pay_month_correction'
      ? await env.DB.prepare(`UPDATE dispatch_queue SET status='sending',attempts=attempts+1,updated_at=? WHERE record_id=? AND status IN ('queued','failed') AND next_attempt_at<=? AND (status<>'failed' OR NOT EXISTS (SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=dispatch_queue.record_id)) AND NOT EXISTS (SELECT 1 FROM timesheet_import_source_holds source_hold WHERE source_hold.record_id=dispatch_queue.record_id) AND EXISTS (SELECT 1 FROM records r WHERE r.record_id=? AND r.payload_json IS ? AND r.owner_oid IS ? AND r.owner_upn IS ? AND r.employee_name IS ? AND r.kind IS ? AND r.action IS ? AND r.status IS ? AND r.status<>'Deleted' AND ${unambiguousLocalTimesheetSubject('r')} AND r.start_date IS ? AND r.end_date IS ? AND r.record_date IS ? AND r.submitted_at IS ? AND r.updated_at IS ? AND r.issue IS ?) AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=dispatch_queue.record_id) AND NOT EXISTS (SELECT 1 FROM dispatch_queue other JOIN records r ON r.record_id=other.record_id WHERE lower(r.owner_upn)=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.record_id<>? AND other.status IN ('sending','sent','failed','uncertain')) AND COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0)=? AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records source ON source.record_id=review.record_id WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?) AND NOT EXISTS (SELECT 1 FROM timesheet_import_source_days h WHERE ((h.owner_oid<>'' AND lower(h.owner_oid)=?) OR (h.owner_upn<>'' AND lower(h.owner_upn)=?) OR (h.owner_oid='' AND h.owner_upn='')) AND (h.source_day='*' OR h.source_day BETWEEN ? AND ?)) AND EXISTS (SELECT 1 FROM timesheet_queue_source_guards proof JOIN record_attachments a ON a.record_id=proof.record_id AND a.field_name='attachment_record' AND a.content_base64=proof.source_base64 WHERE proof.record_id=dispatch_queue.record_id AND proof.owner_upn=? AND proof.owner_revision=? AND a.content_base64=?) AND ${queuedAttachmentGuard('dispatch_queue.record_id')}`).bind(timestamp,row.record_id,timestamp,row.record_id,row.payload_json,row.owner_oid,row.owner_upn,row.employee_name,row.kind,row.action,row.status,row.start_date??null,row.end_date??null,row.record_date??null,row.submitted_at,row.updated_at,row.issue??null,String(row.owner_upn||'').toLowerCase(),row.record_id,String(row.owner_upn||'').toLowerCase(),localDispatchRevision,String(row.owner_oid||'').toLowerCase(),String(row.owner_upn||'').toLowerCase(),String(row.owner_oid||'').toLowerCase(),String(row.owner_upn||'').toLowerCase(),localDispatchPeriod.start,localDispatchPeriod.cycleEnd,String(row.owner_upn||'').toLowerCase(),localDispatchRevision,localDispatchSource).run()
      : await env.DB.prepare(`UPDATE dispatch_queue SET status = 'sending', attempts = attempts + 1, updated_at = ?
      WHERE record_id = ? AND status IN ('queued', 'failed') AND next_attempt_at <= ?
        AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=dispatch_queue.record_id)`).bind(timestamp, row.record_id, timestamp).run();
    const claimChanges=claim?.meta?.changes;
    if (typeof claimChanges!=='number' || !Number.isSafeInteger(claimChanges) || claimChanges<0) {
      // The claim may have landed even if its result is malformed. Never send
      // or reset it for retry without an independent reconciliation.
      summary.status='claim-unverified';
      summary.deferred=(summary.deferred||0)+1;
      summary.records.push({recordId:row.record_id,status:'claim-unverified'});
      continue;
    }
    if (claimChanges < 1) {
      if (row.action==='pay_month_correction') {if (summary.status==='complete') summary.status='awaiting-source-review';summary.deferred=(summary.deferred||0)+1;summary.records.push({recordId:row.record_id,status:'queue-changed-or-unverified'});}
      continue;
    }
    let deliveredSource = '', deliveredGeneration = '', requestStarted = false;
    try {
      const attachmentQuery = row.action==='pay_month_correction'
        ? env.DB.prepare(`SELECT field_name, file_name, content_type, content_base64, size_bytes FROM record_attachments
          WHERE record_id=? AND ${queuedAttachmentGuard('record_attachments.record_id')}
          AND COALESCE((SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?),0)=?
          AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records source ON source.record_id=review.record_id
            WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?) ORDER BY field_name`)
          .bind(row.record_id,String(row.owner_upn||'').toLowerCase(),localDispatchRevision,String(row.owner_oid||'').toLowerCase(),String(row.owner_upn||'').toLowerCase())
        : env.DB.prepare(`SELECT field_name, file_name, content_type, content_base64, size_bytes FROM record_attachments WHERE record_id=? ORDER BY field_name`).bind(row.record_id);
      const attachmentsResult = await attachmentQuery.all();
      const attachments = attachmentsResult.results || [];
      if (row.action==='pay_month_correction' && !attachments.length) {
        throw new Error('The queued source or attachments changed and need review.');
      }
      if (!attachments.some((attachment) => attachment.field_name === 'attachment') || !attachments.some((attachment) => attachment.field_name === 'attachment_csv')) {
        throw new Error('Queued correction attachments are incomplete');
      }
      if (row.action === 'pay_month_correction' && !attachments.some((attachment) => attachment.field_name === 'attachment_record')) {
        throw new Error('Queued pay-month correction is missing the dated JSON record attachment');
      }
      const form = dispatchForm(row, attachments, payPeriods);
      if (row.action === 'pay_month_correction') {
        deliveredSource = attachments.find(item => item.field_name === 'attachment_record')?.content_base64 || '';
        deliveredGeneration = await correctionGeneration(deliveredSource);
        form.set('gmt_delivery_generation', deliveredGeneration);
        // The receiving flow can obtain the exact generation without parsing
        // a provider-formatted email body. The stored attachment is untouched.
        form.set('attachment_record', new Blob([decodeBase64(deliveredSource)], {type:'application/json'}),
          `GMT Timesheet Record - generation-${deliveredGeneration}.json`);
      }
      requestStarted = true;
      const response = await (options.fetchImpl || fetch)(endpoint, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        ...(row.action==='pay_month_correction' ? {signal:AbortSignal.timeout(60_000)} : {})
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
      await env.DB.prepare(`UPDATE dispatch_queue SET status = 'sent', updated_at = ?, last_sent_at = ?, last_error = NULL WHERE record_id = ? AND status = 'sending'`).bind(timestamp, timestamp, row.record_id).run();
      await env.DB.prepare("UPDATE records SET status = 'Sent to Accounts', issue = '', updated_at = ? WHERE record_id = ? AND payload_json = ? AND EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=records.record_id AND q.status IN ('sent','completed'))").bind(timestamp, row.record_id, row.payload_json).run();
      let releasePending = false;
      if (deliveredGeneration) {
        try { await releaseCompletedTimesheetDelivery(env,row.record_id,deliveredSource,deliveredGeneration); }
        catch (_) {
          // The provider has accepted the message. Keep the queue locked and
          // report reconciliation separately instead of implying a resend is safe.
          releasePending = true;
          summary.status = 'awaiting-reconciliation';
          summary.reconciliationPending = (summary.reconciliationPending || 0) + 1;
        }
      }
      summary.sent += 1;
      summary.records.push({ recordId: row.record_id, status: releasePending ? 'sent-awaiting-reconciliation' : 'sent' });
    } catch (error) {
      if (row.action === 'pay_month_correction' && requestStarted) {
        // Once a request starts, an error or lost response cannot prove that
        // the provider did not hand it off. Hold this generation until a
        // matching receipt or an operator reconciles it; do not resend it.
        const message = 'Email handoff outcome is uncertain; reconcile before retrying.';
        await env.DB.prepare(`UPDATE dispatch_queue SET status='uncertain',updated_at=?,last_error=? WHERE record_id=? AND status IN ('sending','sent')`).bind(timestamp,message,row.record_id).run();
        await env.DB.prepare("UPDATE records SET status='Delivery needs review', issue=?, updated_at=? WHERE record_id=? AND payload_json=? AND EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=records.record_id AND q.status='uncertain')").bind(message,timestamp,row.record_id,row.payload_json).run();
        if (deliveredGeneration) {
          try { await releaseCompletedTimesheetDelivery(env,row.record_id,deliveredSource,deliveredGeneration); } catch (_) { /* Leave the generation held. */ }
        }
        summary.status = 'awaiting-reconciliation';
        summary.reconciliationPending = (summary.reconciliationPending || 0) + 1;
        summary.records.push({recordId:row.record_id,status:'uncertain'});
        if (error?.rateLimitedUntil) {
          summary.retryAt = error.rateLimitedUntil;
          summary.deferred = 0;
          for (const remaining of rows.slice(index + 1)) {
            const delayed = await env.DB.prepare("UPDATE dispatch_queue SET updated_at = ?, next_attempt_at = ? WHERE record_id = ? AND status IN ('queued', 'failed')")
              .bind(timestamp, error.rateLimitedUntil, remaining.record_id).run();
            if (Number(delayed?.meta?.changes || 0) > 0) summary.deferred += 1;
          }
          break;
        }
        continue;
      }
      const attempts = Number(row.attempts || 0) + 1;
      const message = text(error?.message, 'Correction dispatch failed', 1000);
      const nextAttempt = error?.rateLimitedUntil || retryAt(timestamp, attempts);
      await env.DB.prepare(`UPDATE dispatch_queue SET status = 'failed', updated_at = ?, next_attempt_at = ?, last_error = ? WHERE record_id = ? AND status = 'sending'`).bind(timestamp, nextAttempt, message, row.record_id).run();
      await env.DB.prepare("UPDATE records SET status = 'Delivery failed', issue = ?, updated_at = ? WHERE record_id = ? AND payload_json = ? AND EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=records.record_id AND q.status='failed')").bind(message, timestamp, row.record_id, row.payload_json).run();
      if (deliveredGeneration) {
        try { await releaseCompletedTimesheetDelivery(env,row.record_id,deliveredSource,deliveredGeneration); }
        catch (_) {
          summary.status = 'awaiting-reconciliation';
          summary.reconciliationPending = (summary.reconciliationPending || 0) + 1;
        }
      }
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

const TIMESHEET_RECEIPT_EVENTS = new Set(['flow_started', 'workbook_verified', 'flow_completed', 'flow_failed']);
const TIMESHEET_RECEIPT_FAILURE_STAGES = new Set([
  'source_validation', 'workbook_routing', 'workbook_upsert', 'workbook_readback',
  'history_index', 'calendar_sync', 'other'
]);

function receiptString(value, label, maximum, pattern) {
  if (typeof value !== 'string') throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  const result = value.trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result) || (pattern && !pattern.test(result))) {
    throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  }
  return result;
}

function receiptTimestamp(value) {
  const source = receiptString(value, 'run start time', 48,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) throw Object.assign(new Error('Invalid run start time'), { status: 400 });
  if (milliseconds > Date.now() + 5 * 60 * 1000) throw Object.assign(new Error('Run start time is in the future'), { status: 400 });
  return new Date(milliseconds).toISOString();
}

function safeReceiptError(value) {
  const source = receiptString(value, 'safe error', 1000);
  return source
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(access[_ -]?token|client[_ -]?secret|password)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\s+/g, ' ')
    .slice(0, 600);
}

function sourceRateValues(row, errorStatus) {
  const values = {};
  for (const key of SOURCE_RATE_FIELDS) {
    const value = row[key];
    if (!Object.hasOwn(row, key) || !(value === null || (Number.isInteger(value) && value >= 0 && value <= 1440))) {
      throw Object.assign(new Error('Invalid or missing source rate evidence'), {status:errorStatus});
    }
    values[key] = value;
  }
  return values;
}
function parseTimesheetReceipt(body) {
  // Some connector designers do not preserve typed array tokens. Accept a
  // serialized pair as an alternative transport, then apply the identical
  // row, count, generation and protected-source validation below.
  const serialized = Object.hasOwn(body, 'verifiedRowsJson') || Object.hasOwn(body, 'verifiedRecordIdsJson');
  if (serialized) {
    if (body.event !== 'workbook_verified' || Object.hasOwn(body, 'verifiedRows') || Object.hasOwn(body, 'verifiedRecordIds') ||
        typeof body.verifiedRowsJson !== 'string' || typeof body.verifiedRecordIdsJson !== 'string') {
      throw Object.assign(new Error('Invalid serialized workbook evidence'), {status:400});
    }
    let verifiedRows, verifiedRecordIds;
    try {
      verifiedRows = JSON.parse(body.verifiedRowsJson);
      verifiedRecordIds = JSON.parse(body.verifiedRecordIdsJson);
    } catch (_) { throw Object.assign(new Error('Invalid serialized workbook evidence'), {status:400}); }
    body = {...body, verifiedRows, verifiedRecordIds};
    delete body.verifiedRowsJson;
    delete body.verifiedRecordIdsJson;
  }
  const allowed = new Set([
    'recordId', 'flowRunId', 'runStartedAt', 'event', 'generation', 'stage', 'safeError',
    'created', 'updated', 'unchanged', 'verifiedRows', 'verifiedRecordIds', 'workbookId'
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw Object.assign(new Error('Unsupported receipt fields'), { status: 400 });
  }
  const recordId = receiptString(body.recordId, 'record ID', MAX_RECORD_ID, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  const generation = receiptString(body.generation, 'delivery generation', 64, /^[0-9a-f]{64}$/);
  const flowRunId = receiptString(body.flowRunId, 'Power Automate run ID', 240, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  const runStartedAt = receiptTimestamp(body.runStartedAt);
  const event = receiptString(body.event, 'receipt event', 40);
  if (!TIMESHEET_RECEIPT_EVENTS.has(event)) throw Object.assign(new Error('Unsupported receipt event'), { status: 400 });
  if(event!=='workbook_verified'&&Object.hasOwn(body,'workbookId'))throw Object.assign(new Error('Unsupported workbook identity'),{status:400});

  let evidence = {};
  if (event === 'flow_failed') {
    if (Object.hasOwn(body, 'created') || Object.hasOwn(body, 'updated') || Object.hasOwn(body, 'unchanged') || Object.hasOwn(body, 'verifiedRows') || Object.hasOwn(body, 'verifiedRecordIds')) {
      throw Object.assign(new Error('Unsupported failure evidence'), { status: 400 });
    }
    const stage = receiptString(body.stage, 'failure stage', 40);
    if (!TIMESHEET_RECEIPT_FAILURE_STAGES.has(stage)) throw Object.assign(new Error('Unsupported failure stage'), { status: 400 });
    evidence = { stage, safeError: safeReceiptError(body.safeError) };
  } else if (event === 'workbook_verified') {
    if (Object.hasOwn(body, 'stage') || Object.hasOwn(body, 'safeError')) throw Object.assign(new Error('Unsupported workbook evidence'), { status: 400 });
    const workbookId=receiptString(body.workbookId,'workbook ID',256,/^[A-Za-z0-9!_-]+$/);
    const counts = {};
    ['created', 'updated', 'unchanged'].forEach((key) => {
      if (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] > 62) {
        throw Object.assign(new Error(`Invalid ${key} row count`), { status: 400 });
      }
      counts[key] = body[key];
    });
    if (!Array.isArray(body.verifiedRows) || body.verifiedRows.length < 1 || body.verifiedRows.length > 62 ||
        !Array.isArray(body.verifiedRecordIds) || body.verifiedRecordIds.length !== body.verifiedRows.length) {
      throw Object.assign(new Error('Invalid verified workbook rows'), { status: 400 });
    }
    const verifiedRows = body.verifiedRows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !['recordId', 'date', 'start', 'finish', 'breakMinutes', 'absence', 'totalMinutes', 'notes', ...SOURCE_RATE_FIELDS].includes(key)) ||
          typeof row.notes !== 'string' || row.notes.length > 5000 || typeof row.absence !== 'string' || row.absence.length > 100 ||
          ![row.start,row.finish].every(clock => typeof clock === 'string' && (clock === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock))) ||
          ![row.breakMinutes,row.totalMinutes].every(minutes => minutes === null || (Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440))) {
        throw Object.assign(new Error('Invalid verified workbook row'), { status: 400 });
      }
      const verifiedRecordId = receiptString(row.recordId, 'verified source row ID', 240, /^[A-Za-z0-9][A-Za-z0-9._:|-]*$/);
      const date = receiptString(row.date, 'verified row date', 10, /^\d{4}-\d{2}-\d{2}$/);
      const dateMilliseconds = Date.parse(`${date}T00:00:00Z`);
      if (!Number.isFinite(dateMilliseconds) || new Date(dateMilliseconds).toISOString().slice(0, 10) !== date) {
        throw Object.assign(new Error('Invalid verified row date'), { status: 400 });
      }
      const rateEvidence=SOURCE_RATE_FIELDS.some(key=>Object.hasOwn(row,key)) ? sourceRateValues(row,400) : {};
      return { recordId: verifiedRecordId, date, start:row.start, finish:row.finish, breakMinutes:row.breakMinutes, absence:row.absence, totalMinutes:row.totalMinutes, notes:row.notes, ...rateEvidence };
    });
    const ids = body.verifiedRecordIds.map((value) => receiptString(value, 'verified source row ID', 240, /^[A-Za-z0-9][A-Za-z0-9._:|-]*$/));
    const rowKeys = verifiedRows.map((row) => `${row.recordId}\0${row.date}`);
    const uniqueKeys = new Set(rowKeys);
    const uniqueIds = new Set(ids);
    if (uniqueKeys.size !== verifiedRows.length || uniqueIds.size !== ids.length ||
        ids.some((id) => !verifiedRows.some((row) => row.recordId === id)) ||
        verifiedRows.some((row) => !ids.includes(row.recordId)) ||
        counts.created + counts.updated + counts.unchanged !== verifiedRows.length) {
      throw Object.assign(new Error('Workbook verification evidence is inconsistent'), { status: 400 });
    }
    evidence = { ...counts, verifiedRows, workbookId };
  } else if (Object.keys(body).some((key) => ['stage', 'safeError', 'created', 'updated', 'unchanged', 'verifiedRows', 'verifiedRecordIds'].includes(key))) {
    throw Object.assign(new Error('Unsupported receipt evidence'), { status: 400 });
  }
  return { recordId, generation, flowRunId, runStartedAt, event, evidence: { ...evidence, generation } };
}

function validReceiptDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(Date.parse(`${value}T00:00:00Z`)).toISOString().slice(0, 10) === value;
}

// Independently derive the values expected from the protected source. Unsupported
// values fail closed; the receipt must describe what was read from the workbook.
function expectedReceiptValues(entry, notes) {
  const first = keys => { for (const key of keys) if (entry[key] !== undefined && entry[key] !== null) return entry[key]; return ''; };
  const clock = input => {
    const raw = String(input).trim();
    if (!raw) return '';
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw Object.assign(new Error('Invalid correction source time'), {status:409});
    return `${match[1].padStart(2,'0')}:${match[2]}`;
  };
  const start=clock(first(['startTime','start','Start'])), finish=clock(first(['finishTime','finish','Finish']));
  const rawBreak=first(['breakMinutes','Break','lunchMinutes']);
  let pause=rawBreak === '' ? null : Number(rawBreak);
  if (pause === null) {
    if (/\bBreak:\s*(?:No break|0\s*(?:minute|min))/i.test(notes)) pause=0;
    else { const match=/\bBreak:\s*(\d+)\s*(?:minute|min)/i.exec(notes); if (match) pause=Number(match[1]); }
  }
  const rawTotal=entry.totalMinutes;
  const supplied=rawTotal === undefined || rawTotal === null || rawTotal === '' ? null : Number(rawTotal);
  if (![pause,supplied].every(n => n === null || (Number.isInteger(n) && n>=0 && n<=1440))) throw Object.assign(new Error('Invalid correction source minutes'),{status:409});
  const absence=String(first(['absenceReason','absenceStatus','absence','Absence'])).trim() || 'NA';
  const minutes = time => { const [hour,minute]=time.split(':').map(Number); return hour*60+minute; };
  let total=null;
  if (absence !== 'NA') total=supplied === null ? 0 : supplied;
  else if (start && finish && pause !== null) {
    const from=minutes(start), to=minutes(finish), elapsed=to>=from ? to-from : to+1440-from;
    if (elapsed<=0 || pause>elapsed) throw Object.assign(new Error('Invalid correction source hours'),{status:409});
    total=elapsed-pause;
  } else if (supplied !== null) total=supplied;
  if (supplied !== null && total !== null && supplied !== total) throw Object.assign(new Error('Correction source total differs from hours'),{status:409});
  return {start,finish,breakMinutes:pause,absence,totalMinutes:total};
}

async function expectedCorrectionRows(env, recordId) {
  const row = await env.DB.prepare(`SELECT r.record_id, r.kind, r.action, r.status, a.content_base64
    FROM records r JOIN dispatch_queue q ON q.record_id = r.record_id
    JOIN record_attachments a ON a.record_id = r.record_id AND a.field_name = 'attachment_record'
    WHERE r.record_id = ? AND r.kind = 'timesheets' AND r.action = 'pay_month_correction'
      AND r.status <> 'Deleted'`).bind(recordId).first();
  if (!row || row.status === 'Deleted') throw Object.assign(new Error('Timesheet correction not found'), { status: 404 });
  const encoded = String(row.content_base64 || '');
  if (!encoded || encoded.length > 300_000) throw Object.assign(new Error('Correction source attachment is unavailable'), { status: 409 });
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(encoded)));
  } catch (_) {
    throw Object.assign(new Error('Correction source attachment is invalid'), { status: 409 });
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      envelope.mode !== 'replace-pay-month' || String(envelope.recordId || '') !== recordId ||
      !Array.isArray(envelope.rows) || envelope.rows.length > 62) {
    throw Object.assign(new Error('Correction source rows are invalid'), { status: 409 });
  }
  const expectedValues = new Map();
  const expectedRows = envelope.rows.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !validReceiptDate(entry.date)) {
      throw Object.assign(new Error('Correction source rows are invalid'), { status: 409 });
    }
    const date = entry.date;
    const expectedRecordId = `${recordId}|${date}`;
    const entryRecordId = String(entry.recordId || entry.record_id || expectedRecordId);
    if (entryRecordId !== expectedRecordId) throw Object.assign(new Error('Correction source row identity is invalid'), { status: 409 });
    const noteValues = ['note', 'notes', 'Notes', 'description'].map(key => String(entry[key] ?? '').trim()).filter(Boolean);
    if (new Set(noteValues).size > 1) throw Object.assign(new Error('Correction source notes conflict'), {status:409});
    const notes = [noteValues[0] || '', String(entry.changeNote ?? '').trim()].filter(Boolean).join(' | ');
    if (notes.length > 5000) throw Object.assign(new Error('Correction source notes are too long'), {status:409});
    const rateEvidence=envelope.schemaVersion===3 ? sourceRateValues(entry,409) : {};
    if(envelope.schemaVersion!==3 && SOURCE_RATE_FIELDS.some(key=>Object.hasOwn(entry,key))) throw Object.assign(new Error('Unexpected source rate evidence'),{status:409});
    expectedValues.set(expectedRecordId, {...expectedReceiptValues(entry, noteValues[0] || ''), notes, ...rateEvidence});
    return { recordId: expectedRecordId, date };
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (new Set(expectedRows.map((entry) => entry.date)).size !== expectedRows.length) {
    throw Object.assign(new Error('Correction source dates are not unique'), { status: 409 });
  }
  return { rows: expectedRows, expectedValues, encoded, envelope };
}

function isolatedSyntheticDelivery(env,recordId) {
  return env.SYNTHETIC_TEST_SERVICE_ENABLED==='true' && env.SYNTHETIC_TEST_READ_ONLY_DESTINATION==='true' &&
    env.DISPATCH_ENABLED==='false' && env.PAY_MONTH_REPLAY_READY==='false' && recordId===syntheticFixture.recordId;
}

// r, q and a are the protected record, queue entry and dated JSON attachment.
function dispatchedSourceGuard(isolatedSynthetic) {
  if (isolatedSynthetic) return "json_extract(r.payload_json,'$.testMode')=1";
  return `EXISTS (SELECT 1 FROM timesheet_queue_source_guards proof JOIN timesheet_owner_revisions version ON version.owner_upn=proof.owner_upn
      WHERE proof.record_id=r.record_id AND proof.owner_upn=lower(r.owner_upn) AND proof.source_base64=a.content_base64 AND (
        (q.status='sending' AND r.status='Queued for Accounts' AND version.revision=proof.owner_revision) OR
        (version.revision=proof.owner_revision+1 AND r.updated_at=q.updated_at AND (
          (q.status='sent' AND r.status='Sent to Accounts') OR (q.status='failed' AND r.status='Delivery failed') OR
          (q.status='uncertain' AND r.status='Delivery needs review')))))
    AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records original ON original.record_id=review.record_id
      WHERE lower(review.subject_oid)=lower(r.owner_oid) OR lower(original.owner_upn)=lower(r.owner_upn))
    AND ${unambiguousLocalTimesheetSubject('r')}
    AND ${queuedAttachmentGuard('r.record_id')}`;
}

// Resolve only from the protected queued source and the app-verified folder.
// This is a building block; no receiving flow currently consumes its result.
export async function resolvePrivateTimesheetRoute(env, request, options = {}) {
  const conflict = () => Object.assign(new Error('The current dispatched correction could not be verified'), {status:409});
  const recordId=receiptString(request?.recordId,'record ID',MAX_RECORD_ID,/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  const generation=receiptString(request?.generation,'delivery generation',64,/^[0-9a-f]{64}$/);
  const flowRunId=receiptString(request?.flowRunId,'Power Automate run ID',240,/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  const runStartedAt=receiptTimestamp(request?.runStartedAt);
  const sourceGuard=dispatchedSourceGuard(isolatedSyntheticDelivery(env,recordId));
  const lookup = () => env.DB.prepare(`SELECT r.*, q.status AS dispatch_status, q.attempts, a.content_base64 AS source_attachment,
      CASE WHEN ${sourceGuard} THEN 1 ELSE 0 END AS source_guard_verified
    FROM records r JOIN dispatch_queue q ON q.record_id = r.record_id
    JOIN record_attachments a ON a.record_id = r.record_id AND a.field_name = 'attachment_record'
    WHERE r.record_id = ? AND r.kind = 'timesheets' AND r.action = 'pay_month_correction' AND r.status <> 'Deleted'`).bind(recordId).first();
  const active = row => row && row.source_guard_verified===1 && ['sending','sent','failed','uncertain'].includes(row.dispatch_status) && Number(row.attempts) >= 1;
  const row = await lookup();
  if (!active(row) || await correctionGeneration(row.source_attachment) !== generation) throw conflict();
  const existing=await env.DB.prepare(`SELECT flow_run_id,run_started_at,generation FROM timesheet_delivery_routes
    WHERE record_id=? AND (flow_run_id=? OR generation=?)`).bind(recordId,flowRunId,generation).all();
  if((existing.results||[]).some(item=>item.flow_run_id!==flowRunId||item.run_started_at!==runStartedAt||item.generation!==generation))throw conflict();
  const writtenOrTerminal=async()=>env.DB.prepare(`SELECT receipt_id FROM timesheet_delivery_receipts WHERE record_id=? AND flow_run_id=?
    AND event_type IN ('workbook_verified','flow_completed','flow_failed') LIMIT 1`).bind(recordId,flowRunId).first();
  if(await writtenOrTerminal())throw conflict();
  validatePayMonthAttachmentVersion(row, [{fieldName:'attachment_record',contentBase64:row.source_attachment}]);
  const source = await expectedCorrectionRows(env,recordId), payload = payloadObject(row);
  const month = payload.payMonth;
  const periods = await loadPayPeriods(env);
  const period = periods.periodForMonth(month);
  if (source.encoded !== row.source_attachment || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || '')) ||
      !period || source.envelope.cycleStart !== period.start || source.envelope.cycleEnd !== period.cycleEnd ||
      String(source.envelope.employeeName||'').trim().toLowerCase() !== String(row.employee_name||'').trim().toLowerCase() ||
      !source.rows.length || source.rows.some(day => payCycleKeyForDate(day.date,periods) !== month)) throw conflict();
  const folder = await (options.privateDestinationCheck || verifyPrivateTimesheetDestination)(env,row);
  if (!folder || typeof folder.id !== 'string' || !/^[A-Za-z0-9!_-]{1,256}$/.test(folder.id)) throw conflict();
  const workbook=await (options.workbookCheck || verifyPrivateWorkbookDestination)(env,folder,row,month);
  if(!workbook||typeof workbook.folderId!=='string'||typeof workbook.workbookId!=='string'||
     !/^[A-Za-z0-9!_-]{1,256}$/.test(workbook.folderId)||!/^[A-Za-z0-9!_-]{1,256}$/.test(workbook.workbookId))throw conflict();
  if (env.SYNTHETIC_TEST_READ_ONLY_DESTINATION==='true' &&
      (folder.id!==env.SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID || workbook.folderId!==env.SYNTHETIC_TEST_MONTH_FOLDER_ID ||
       workbook.workbookId!==env.SYNTHETIC_TEST_WORKBOOK_ID)) throw conflict();
  const current = await lookup();
  const currentPeriods = await loadPayPeriods(env);
  const currentPeriod = currentPeriods.periodForMonth(month);
  if (!active(current) || current.source_attachment !== row.source_attachment || current.payload_json !== row.payload_json ||
      current.owner_upn !== row.owner_upn || current.employee_name !== row.employee_name ||
      !currentPeriod || currentPeriod.start !== period.start || currentPeriod.cycleEnd !== period.cycleEnd ||
      source.rows.some(day => payCycleKeyForDate(day.date,currentPeriods) !== month)) throw conflict();
  try { await env.DB.prepare(`INSERT INTO timesheet_delivery_routes
    (record_id,flow_run_id,run_started_at,generation,employee_folder_id,month_folder_id,workbook_id,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM records r JOIN dispatch_queue q ON q.record_id=r.record_id
      JOIN record_attachments a ON a.record_id=r.record_id AND a.field_name='attachment_record'
      WHERE r.record_id=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted'
        AND r.owner_upn=? AND r.employee_name=? AND r.payload_json=? AND a.content_base64=?
        AND q.status IN ('sending','sent','failed','uncertain') AND q.attempts>=1 AND ${sourceGuard}
    ) AND NOT EXISTS (SELECT 1 FROM timesheet_delivery_receipts WHERE record_id=? AND flow_run_id=?
      AND event_type IN ('workbook_verified','flow_completed','flow_failed'))
    ON CONFLICT DO NOTHING`).bind(recordId,flowRunId,runStartedAt,generation,folder.id,workbook.folderId,workbook.workbookId,now(),recordId,row.owner_upn,row.employee_name,row.payload_json,row.source_attachment,recordId,flowRunId).run();
  } catch(error) {
    if (/old writer cannot route publication candidate/i.test(String(error?.message||''))) throw conflict();
    throw error;
  }
  const saved=await env.DB.prepare(`SELECT run_started_at,generation,employee_folder_id,month_folder_id,workbook_id
    FROM timesheet_delivery_routes WHERE record_id=? AND flow_run_id=?`).bind(recordId,flowRunId).first();
  const final=await lookup();
  const finalPeriods=await loadPayPeriods(env),finalPeriod=finalPeriods.periodForMonth(month);
  if(!saved||saved.run_started_at!==runStartedAt||saved.generation!==generation||saved.employee_folder_id!==folder.id||
     saved.month_folder_id!==workbook.folderId||saved.workbook_id!==workbook.workbookId||!active(final)||
     final.source_attachment!==row.source_attachment||final.payload_json!==row.payload_json||final.owner_oid!==row.owner_oid||
     final.owner_upn!==row.owner_upn||final.employee_name!==row.employee_name||!finalPeriod||finalPeriod.start!==period.start||
     finalPeriod.cycleEnd!==period.cycleEnd||source.rows.some(day=>payCycleKeyForDate(day.date,finalPeriods)!==month)||await writtenOrTerminal())throw conflict();
  // The receiver must write the protected source checked above, not an email
  // attachment that merely claims the same generation and dated row IDs.
  return {employeeFolderId:folder.id,folderId:workbook.folderId,workbookId:workbook.workbookId,payMonth:month,generation,sourceBase64:source.encoded};
}

async function privateTimesheetRouteEndpoint(request, env, origin = '') {
  if (env.TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED !== 'true' || !env.DB) {
    throw Object.assign(new Error('Private route is unavailable'), {status:503});
  }
  const configuredKey = String(env.TIMESHEET_DELIVERY_CALLBACK_KEY || '');
  if (configuredKey.length < 32 || configuredKey.length > 500) throw Object.assign(new Error('Private route is unavailable'), {status:503});
  const suppliedKey = request.headers.get('X-GMT-Delivery-Key') || '';
  if (suppliedKey.length > 500 || !constantTimeEqual(suppliedKey,configuredKey)) throw Object.assign(new Error('Not authorised'), {status:401});
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error('JSON content type required'), {status:415});
  const body = await readBoundedJson(request,4096);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key=>!['recordId','generation','flowRunId','runStartedAt'].includes(key))) {
    throw Object.assign(new Error('Invalid private route request'), {status:400});
  }
  // Real source reconciliation and stale-writer fencing are not yet proven.
  // A previously started or replayed flow must not bypass the dispatch hold
  // by asking the public resolver directly for an employee workbook. The only
  // exception is the fixed fictional fixture with provisioning switched off.
  if (!isolatedSyntheticDelivery(env,body.recordId) || env.TIMESHEET_WORKBOOK_PROVISIONING_ENABLED!=='false') {
    throw Object.assign(new Error('Private workbook routing is held for review'), {status:503});
  }
  return json(await resolvePrivateTimesheetRoute(env,body),200,origin);
}

async function timesheetDeliveryReceiptEndpoint(request, env, origin = '') {
  if (!env.DB) throw Object.assign(new Error('Receipt service is unavailable'), { status: 503, publicMessage: 'Receipt service is unavailable' });
  const configuredKey = String(env.TIMESHEET_DELIVERY_CALLBACK_KEY || '');
  if (configuredKey.length < 32 || configuredKey.length > 500) {
    throw Object.assign(new Error('Receipt service is unavailable'), { status: 503, publicMessage: 'Receipt service is unavailable' });
  }
  const suppliedKey = request.headers.get('X-GMT-Delivery-Key') || '';
  if (suppliedKey.length > 500 || !constantTimeEqual(suppliedKey, configuredKey)) {
    throw Object.assign(new Error('Not authorised'), { status: 401, publicMessage: 'Not authorised' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw Object.assign(new Error('JSON content type required'), { status: 415 });
  }
  const body = parseTimesheetReceipt(await readBoundedJson(request, MAX_TIMESHEET_RECEIPT_BYTES));
  const target = await env.DB.prepare(`SELECT r.record_id, q.status AS dispatch_status, q.attempts FROM records r
    JOIN dispatch_queue q ON q.record_id = r.record_id
    WHERE r.record_id = ? AND r.kind = 'timesheets' AND r.action = 'pay_month_correction'
      AND r.status <> 'Deleted'`).bind(body.recordId).first();
  if (!target) throw Object.assign(new Error('Timesheet correction not found'), { status: 404 });
  // A provider callback is evidence of an attempted delivery, not evidence
  // that a correction still waiting in the queue has been sent. A failed
  // attempt can nevertheless have reached the provider before timing out.
  if (!['sending', 'sent', 'failed', 'completed', 'uncertain'].includes(target.dispatch_status) || Number(target.attempts) < 1) {
    throw Object.assign(new Error('Timesheet correction has not been dispatched'), { status: 409 });
  }

  const source = await expectedCorrectionRows(env, body.recordId);
  if (await correctionGeneration(source.encoded) !== body.generation) {
    throw Object.assign(new Error('Receipt does not match the current correction generation'), { status: 409 });
  }
  const route=await env.DB.prepare(`SELECT flow_run_id,run_started_at,generation,workbook_id FROM timesheet_delivery_routes
    WHERE record_id=? AND (flow_run_id=? OR generation=?)`).bind(body.recordId,body.flowRunId,body.generation).all();
  const routes=route.results||[], matched=routes.find(item=>item.flow_run_id===body.flowRunId);
  if(routes.some(item=>item.flow_run_id!==body.flowRunId||item.run_started_at!==body.runStartedAt||item.generation!==body.generation)) {
    throw Object.assign(new Error('Receipt does not match the approved workbook route'),{status:409});
  }
  if(!matched && (body.event!=='flow_failed'||!['source_validation','workbook_routing'].includes(body.evidence.stage))) {
    throw Object.assign(new Error('Receipt requires an approved workbook route'),{status:409});
  }
  if(body.event==='workbook_verified'&&body.evidence.workbookId!==matched?.workbook_id) {
    throw Object.assign(new Error('Workbook verification names a different destination'),{status:409});
  }

  const priorEvents = await env.DB.prepare(`SELECT event_type, evidence_json FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ?`).bind(body.recordId, body.flowRunId).all();
  for (const prior of priorEvents.results || []) {
    let evidence;
    try { evidence = JSON.parse(String(prior.evidence_json || '{}')); } catch (_) { evidence = {}; }
    if (evidence.generation !== body.generation) throw Object.assign(new Error('Receipt run generation conflict'), { status: 409 });
  }
  if (body.event === 'workbook_verified' || body.event === 'flow_completed') {
    const eventTypes = new Set((priorEvents.results || []).map((row) => row.event_type));
    if (!eventTypes.has('flow_started') || (body.event === 'flow_completed' && !eventTypes.has('workbook_verified'))) {
      throw Object.assign(new Error('Receipt events are out of order'), { status: 409 });
    }
    if (body.event === 'flow_completed' && !(priorEvents.results || []).some((row) => {
      if (row.event_type !== 'workbook_verified') return false;
      try { return JSON.parse(String(row.evidence_json || '{}')).sourceRowVerification === (source.envelope.schemaVersion===3?'source-row-v2':'source-row-v1'); }
      catch (_) { return false; }
    })) throw Object.assign(new Error('Workbook receipt requires source-row verification'), {status:409});
  }

  if (body.event === 'workbook_verified') {
    const expectedRows = source.rows;
    const actualRows = body.evidence.verifiedRows;
    const expectedKeys = expectedRows.map((entry) => `${entry.recordId}\0${entry.date}`).sort();
    const actualKeys = actualRows.map((entry) => `${entry.recordId}\0${entry.date}`).sort();
    if (!expectedRows.length || expectedKeys.length !== actualKeys.length ||
        expectedKeys.some((key, index) => key !== actualKeys[index]) ||
        actualRows.some((row) => {
          const expected=source.expectedValues.get(row.recordId);
          return !expected || ['start','finish','breakMinutes','absence','totalMinutes','notes',...SOURCE_RATE_FIELDS].some(key => Object.hasOwn(row,key)!==Object.hasOwn(expected,key) || row[key] !== expected[key]);
        }) ||
        body.evidence.created + body.evidence.updated + body.evidence.unchanged !== expectedRows.length) {
      throw Object.assign(new Error('Workbook verification does not match the correction source'), { status: 409 });
    }
    body.evidence.verifiedRows = expectedRows;
    body.evidence.sourceRowVerification = source.envelope.schemaVersion===3?'source-row-v2':'source-row-v1';
  }

  const evidenceJson = JSON.stringify(body.evidence);
  if (evidenceJson.length > 32_768) throw Object.assign(new Error('Receipt evidence is too large'), { status: 413 });
  const priorRun = await env.DB.prepare(`SELECT run_started_at FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? LIMIT 1`).bind(body.recordId, body.flowRunId).first();
  if (priorRun && priorRun.run_started_at !== body.runStartedAt) {
    throw Object.assign(new Error('Receipt run start time conflict'), { status: 409 });
  }
  if (body.event === 'flow_failed' || body.event === 'flow_completed') {
    const opposite = body.event === 'flow_failed' ? 'flow_completed' : 'flow_failed';
    const terminal = await env.DB.prepare(`SELECT receipt_id FROM timesheet_delivery_receipts
      WHERE record_id = ? AND flow_run_id = ? AND event_type = ? LIMIT 1`)
      .bind(body.recordId, body.flowRunId, opposite).first();
    if (terminal) throw Object.assign(new Error('Receipt terminal event conflict'), { status: 409 });
  }

  const existing = await env.DB.prepare(`SELECT run_started_at, evidence_json FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? AND event_type = ? LIMIT 1`)
    .bind(body.recordId, body.flowRunId, body.event).first();
  if (existing) {
    if (existing.run_started_at !== body.runStartedAt || existing.evidence_json !== evidenceJson) {
      throw Object.assign(new Error('Conflicting duplicate receipt'), { status: 409 });
    }
    if (body.event === 'flow_completed') await releaseCompletedTimesheetDelivery(env, body.recordId, source.encoded, body.generation);
    return json({ accepted: true }, 200, origin);
  }

  const terminalEvent = await env.DB.prepare(`SELECT event_type FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? AND event_type IN ('flow_completed', 'flow_failed') LIMIT 1`)
    .bind(body.recordId, body.flowRunId).first();
  if (terminalEvent) throw Object.assign(new Error('Receipt run is already terminal'), { status: 409 });

  const receivedAt = now();
  try {
    await env.DB.prepare(`INSERT INTO timesheet_delivery_receipts
      (record_id, flow_run_id, run_started_at, event_type, received_at, evidence_json)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM records r JOIN dispatch_queue q ON q.record_id = r.record_id
        JOIN record_attachments a ON a.record_id = r.record_id AND a.field_name = 'attachment_record'
        WHERE r.record_id = ? AND r.kind = 'timesheets' AND r.action = 'pay_month_correction' AND r.status <> 'Deleted' AND a.content_base64 = ?
          AND q.status IN ('sending', 'sent', 'failed', 'uncertain') AND q.attempts >= 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM timesheet_delivery_receipts prior
        WHERE prior.record_id = ? AND prior.flow_run_id = ?
          AND COALESCE(json_extract(prior.evidence_json, '$.generation'), '') <> ?
      )
      ON CONFLICT(record_id, flow_run_id, event_type) DO NOTHING`)
      .bind(body.recordId, body.flowRunId, body.runStartedAt, body.event, receivedAt, evidenceJson, body.recordId, source.encoded, body.recordId, body.flowRunId, body.generation).run();
  } catch (error) {
    if (/timesheet receipt (?:run start time|terminal event) conflict/i.test(String(error && error.message || ''))) {
      throw Object.assign(new Error('Conflicting receipt event'), { status: 409 });
    }
    throw error;
  }
  const stored = await env.DB.prepare(`SELECT run_started_at, evidence_json FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? AND event_type = ? LIMIT 1`)
    .bind(body.recordId, body.flowRunId, body.event).first();
  if (!stored) throw Object.assign(new Error('Correction source or receipt generation changed'), { status: 409 });
  if (stored.run_started_at !== body.runStartedAt || stored.evidence_json !== evidenceJson) {
    throw Object.assign(new Error('Conflicting duplicate receipt'), { status: 409 });
  }
  if (body.event === 'flow_completed') await releaseCompletedTimesheetDelivery(env, body.recordId, source.encoded, body.generation);
  return json({ accepted: true }, 200, origin);
}

// A callback can arrive before FormSubmit has returned. Keep the slot locked
// while the sender is still running; that sender also calls this after its
// final queue update. The source and approved route bind release to the exact
// generation, and duplicate calls are harmless.
export async function releaseCompletedTimesheetDelivery(env, recordId, source, generation) {
  let sourceVersion;
  try { sourceVersion=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64(source))).schemaVersion; }
  catch (_) { throw Object.assign(new Error('Correction source attachment is invalid'),{status:409}); }
  const requiredVerification=sourceVersion===3?'source-row-v2':'source-row-v1';
  const isolatedSynthetic=isolatedSyntheticDelivery(env,recordId);
  const localGuard=isolatedSynthetic ? "json_extract(r.payload_json,'$.testMode')=1" : `
        EXISTS (SELECT 1 FROM timesheet_queue_source_guards proof JOIN timesheet_owner_revisions version ON version.owner_upn=proof.owner_upn
          WHERE proof.record_id=r.record_id AND proof.owner_upn=lower(r.owner_upn) AND proof.source_base64=?
            AND version.revision=proof.owner_revision+1)
        AND r.updated_at=dispatch_queue.updated_at
        AND ((dispatch_queue.status='sent' AND r.status='Sent to Accounts') OR
          (dispatch_queue.status='failed' AND r.status='Delivery failed') OR
          (dispatch_queue.status='uncertain' AND r.status='Delivery needs review'))
        AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records original ON original.record_id=review.record_id
          WHERE lower(review.subject_oid)=lower(r.owner_oid) OR lower(original.owner_upn)=lower(r.owner_upn))
        AND ${queuedAttachmentGuard('r.record_id')}`;
  await env.DB.prepare(`UPDATE dispatch_queue SET status='completed', updated_at=?
    WHERE record_id=? AND status IN ('sent','failed','uncertain') AND EXISTS (
      SELECT 1 FROM record_attachments a JOIN timesheet_delivery_routes route ON route.record_id=a.record_id
      JOIN timesheet_delivery_receipts receipt ON receipt.record_id=route.record_id
        AND receipt.flow_run_id=route.flow_run_id AND receipt.run_started_at=route.run_started_at
      WHERE a.record_id=? AND a.field_name='attachment_record' AND a.content_base64=?
        AND route.generation=? AND receipt.event_type='flow_completed'
        AND json_extract(receipt.evidence_json,'$.generation')=route.generation
        AND EXISTS (SELECT 1 FROM timesheet_delivery_receipts verified
          WHERE verified.record_id=receipt.record_id AND verified.flow_run_id=receipt.flow_run_id
            AND verified.run_started_at=receipt.run_started_at AND verified.event_type='workbook_verified'
            AND json_extract(verified.evidence_json,'$.generation')=route.generation
            AND json_extract(verified.evidence_json,'$.sourceRowVerification')=?)
    ) AND EXISTS (SELECT 1 FROM records r WHERE r.record_id=dispatch_queue.record_id AND ${localGuard})`)
    .bind(now(),recordId,recordId,source,generation,requiredVerification,...(isolatedSynthetic?[]:[source])).run();
}

async function adminQueueStatus(env, identity) {
  if (!identity?.isAdmin) throw Object.assign(new Error('Correction queue status is restricted to Accounts'), { status: 403 });
  const result = await env.DB.prepare("SELECT q.record_id, q.status, q.attempts, q.queued_at, q.last_sent_at AS sent_at, q.updated_at, q.last_error AS error, r.kind, r.action, r.employee_name, r.owner_upn, r.record_date, r.payload_json, a.content_base64 AS current_generation_source, CASE WHEN r.kind='timesheets' AND r.action='pay_month_correction' AND q.status IN ('sending','sent','failed','uncertain') AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id) THEN 1 ELSE 0 END AS workbook_write_hold FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id LEFT JOIN record_attachments a ON a.record_id = r.record_id AND a.field_name = 'attachment_record' WHERE r.status <> 'Deleted' ORDER BY q.updated_at DESC, q.record_id ASC LIMIT 200").all();
  const rows = result.results || [];
  const currentGenerations = new Map();
  const currentVerifications = new Map();
  await Promise.all(rows.map(async (row) => {
    try {
      const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64(row.current_generation_source)));
      currentGenerations.set(row.record_id, await correctionGeneration(row.current_generation_source));
      currentVerifications.set(row.record_id, source.schemaVersion===3?'source-row-v2':'source-row-v1');
    }
    catch (_) { /* Missing source cannot establish a current receipt. */ }
  }));
  const generationSnapshot = JSON.stringify([...currentGenerations].map(([recordId, generation]) => ({recordId, generation, verification:currentVerifications.get(recordId)})));
  // A route can exist before the flow has delivered even its first receipt.
  // Keep its exact run and workbook visible to Accounts for investigation.
  const routeResult=await env.DB.prepare(`SELECT route.record_id,route.flow_run_id,route.run_started_at,route.generation,route.workbook_id
    FROM timesheet_delivery_routes route JOIN json_each(?) current
      ON route.record_id=json_extract(current.value,'$.recordId') AND route.generation=json_extract(current.value,'$.generation')`).bind(generationSnapshot).all();
  const receiptResult = await env.DB.prepare(`WITH queued_records AS (
      SELECT q.record_id FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id
      WHERE r.status <> 'Deleted' ORDER BY q.updated_at DESC, q.record_id ASC LIMIT 200
    ), current_generations AS (
      SELECT json_extract(value,'$.recordId') AS record_id, json_extract(value,'$.generation') AS generation, json_extract(value,'$.verification') AS verification
      FROM json_each(?)
    ), eligible_receipts AS (
      SELECT receipt.* FROM timesheet_delivery_receipts receipt
      JOIN current_generations current ON current.record_id=receipt.record_id
        AND current.generation=json_extract(receipt.evidence_json,'$.generation')
      LEFT JOIN timesheet_delivery_routes approved ON approved.record_id=receipt.record_id
        AND approved.flow_run_id=receipt.flow_run_id AND approved.run_started_at=receipt.run_started_at
        AND approved.generation=json_extract(receipt.evidence_json,'$.generation')
      WHERE (approved.workbook_id IS NOT NULL AND (receipt.event_type<>'workbook_verified'
          OR (json_extract(receipt.evidence_json,'$.workbookId')=approved.workbook_id
              AND json_extract(receipt.evidence_json,'$.sourceRowVerification')=current.verification))
          AND (receipt.event_type<>'flow_completed' OR EXISTS (
            SELECT 1 FROM timesheet_delivery_receipts verified
            WHERE verified.record_id=receipt.record_id AND verified.flow_run_id=receipt.flow_run_id
              AND verified.run_started_at=receipt.run_started_at AND verified.event_type='workbook_verified'
              AND json_extract(verified.evidence_json,'$.generation')=approved.generation
              AND json_extract(verified.evidence_json,'$.sourceRowVerification')=current.verification)))
        OR (receipt.event_type='flow_failed' AND approved.workbook_id IS NULL
          AND json_extract(receipt.evidence_json,'$.stage') IN ('source_validation','workbook_routing')
          AND NOT EXISTS (SELECT 1 FROM timesheet_delivery_routes other
            WHERE other.record_id=receipt.record_id AND other.generation=json_extract(receipt.evidence_json,'$.generation')))
    ), run_candidates AS (
      SELECT receipt.record_id, receipt.flow_run_id, receipt.run_started_at,
        MAX(receipt.received_at) AS last_received_at
      FROM eligible_receipts receipt
      JOIN queued_records queued ON queued.record_id = receipt.record_id
      GROUP BY receipt.record_id, receipt.flow_run_id, receipt.run_started_at
    ), ranked_runs AS (
      SELECT record_id, flow_run_id, run_started_at,
        ROW_NUMBER() OVER (PARTITION BY record_id
          ORDER BY run_started_at DESC, last_received_at DESC, flow_run_id DESC) AS run_rank
      FROM run_candidates
    )
    SELECT receipt.record_id, receipt.flow_run_id, receipt.run_started_at,
      receipt.event_type, receipt.received_at, receipt.evidence_json
    FROM eligible_receipts receipt
    JOIN ranked_runs latest ON latest.record_id = receipt.record_id
      AND latest.flow_run_id = receipt.flow_run_id
      AND latest.run_started_at = receipt.run_started_at
    WHERE latest.run_rank = 1
    ORDER BY receipt.record_id, receipt.received_at, receipt.receipt_id`).bind(generationSnapshot).all();
  const latestRuns = new Map();
  (receiptResult.results || []).forEach((receipt) => {
    let evidence = {};
    try { evidence = JSON.parse(String(receipt.evidence_json || '{}')); } catch (_) { return; }
    if (!currentGenerations.has(receipt.record_id) || evidence.generation !== currentGenerations.get(receipt.record_id)) return;
    let run = latestRuns.get(receipt.record_id);
    if (!run) {
      run = { flowRunId: text(receipt.flow_run_id, '', 240), runStartedAt: text(receipt.run_started_at, '', 40), events: {} };
      latestRuns.set(receipt.record_id, run);
    }
    const event = text(receipt.event_type, '', 40);
    const receivedAt = text(receipt.received_at, '', 80);
    if (event === 'flow_started' || event === 'flow_completed') {
      run.events[event] = { receivedAt };
    } else if (event === 'flow_failed') {
      run.events[event] = {
        receivedAt,
        stage: text(evidence.stage, '', 40),
        safeError: text(evidence.safeError, '', 600)
      };
    } else if (event === 'workbook_verified') {
      run.events[event] = {
        receivedAt,
        created: Number(evidence.created || 0),
        updated: Number(evidence.updated || 0),
        unchanged: Number(evidence.unchanged || 0),
        verifiedRowCount: Array.isArray(evidence.verifiedRows) ? evidence.verifiedRows.length : 0
      };
    }
  });
  (routeResult.results || []).forEach(route=>{
    let run=latestRuns.get(route.record_id);
    if(run && (run.flowRunId!==route.flow_run_id || run.runStartedAt!==route.run_started_at))return;
    if(!run){run={flowRunId:text(route.flow_run_id,'',240),runStartedAt:text(route.run_started_at,'',40),events:{}};latestRuns.set(route.record_id,run);}
    run.workbookId=text(route.workbook_id,'',256);
    run.generation=text(route.generation,'',64);
  });
  const counts = { queued: 0, sending: 0, failed: 0, sent: 0, skipped: 0, completed: 0, uncertain: 0 };
  const records = rows.map((row) => {
    const recordedState = text(row.status, 'unknown', 40).toLowerCase();
    const receipt = latestRuns.get(row.record_id) || null;
    const legacyCompletion = row.kind === 'timesheets' && row.action === 'pay_month_correction' && recordedState === 'completed' &&
      !(receipt?.events?.workbook_verified && receipt?.events?.flow_completed);
    const pendingReconciliation = row.kind === 'timesheets' && row.action === 'pay_month_correction' &&
      recordedState !== 'completed' && recordedState !== 'sending' && Boolean(receipt?.events?.flow_completed);
    const state = legacyCompletion || pendingReconciliation ? 'uncertain' : recordedState;
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
      workbookWriteHold: row.workbook_write_hold===1,
      error: legacyCompletion ? 'A prior delivery receipt needs source-row reconciliation.' :
        pendingReconciliation ? 'The workbook receipt was received, but delivery still needs reconciliation.' : text(row.error, '', 1000),
      deliveryReceipt: receipt
    };
  });
  const endpointConfigured = Boolean(dispatchEndpoint(env));
  return {
    providerStatus: !endpointConfigured ? 'not-configured' : (timesheetDeliveryReady(env) ? 'awaiting-source-review' : 'awaiting-workbook-route'),
    counts,
    records,
    truncated: rows.length === 200
  };
}

function requireXeroAdmin(identity) {
  if (!identity?.isXeroAdmin) throw Object.assign(new Error('Xero access is restricted to approved Accounts users'), { status: 403 });
}

function requireEstimateArchiveAccess(identity) {
  if (!identity?.isAdmin) throw Object.assign(new Error('Estimate archive access is restricted to portal administrators'), { status: 403 });
}

async function adminUsersEndpoint(request, env, identity, origin) {
  if (!identity?.isAdmin) throw Object.assign(new Error('User management is restricted to portal administrators'), { status: 403 });
  if (request.method === 'GET') {
    const result = await env.DB.prepare(`SELECT owner_oid, owner_upn, display_name, role, created_at, updated_at
      FROM portal_access_assignments ORDER BY owner_upn, role`).all();
    const names = new Map(staffDirectory(env).map((entry) => [entry.upn, entry.name]));
    const configured = [];
    for (const [role, variable] of [['admin', 'ADMIN_UPNS'], ['admin', 'ADDITIONAL_ADMIN_UPNS'], ['submissions', 'SUBMISSIONS_ADMIN_UPNS'], ['hr', 'HR_ADMIN_UPNS'], ['timesheets', 'TIMESHEET_VIEWER_UPNS'], ['xero', 'XERO_ADMIN_UPNS'], ['operations', 'OPERATIONS_ADMIN_UPNS'], ['job-card', 'JOB_CARD_ADMIN_UPNS'], ['offsite-duty-manager', 'OFFSITE_DUTY_MANAGER_UPNS']]) {
      for (const upn of csvSet(env[variable])) configured.push({ owner_upn: upn, display_name: names.get(upn) || upn, role, updated_at: 'Worker configuration', managed: false });
    }
    if (csvSet(env.ADMIN_GROUP_IDS).size) configured.push({ owner_upn: 'Configured Entra group', display_name: 'GMT portal administrator group', role: 'admin', updated_at: 'Entra group configuration', managed: false });
    return json({ users: result.results || [], configured, allowedRoles: ['hr', 'xero', 'operations', 'job-card'] }, 200, origin || '');
  }
  const body = await readJson(request);
  const upn = text(body.upn, '', 254).toLowerCase();
  const oid = text(body.oid, '', 80).toLowerCase();
  const name = text(body.name, '', 160);
  const role = text(body.role, '', 40);
  const action = text(body.action, 'grant', 20);
  if (!/^[^\s@]+@gmt-services\.co\.uk$/.test(upn) || !/^[0-9a-f-]{16,80}$/.test(oid)) {
    throw Object.assign(new Error('Enter the exact GMT sign-in address and Microsoft Entra object ID'), { status: 400 });
  }
  if (!['hr', 'xero', 'operations', 'job-card'].includes(role)) throw Object.assign(new Error('This role cannot be assigned here'), { status: 400 });
  if (!['grant', 'revoke'].includes(action)) throw Object.assign(new Error('Choose grant or revoke'), { status: 400 });
  const timestamp = now();
  const auditId = randomBase64Url(18);
  const statement = action === 'grant'
    ? env.DB.prepare(`INSERT INTO portal_access_assignments (owner_oid, owner_upn, display_name, role, created_by_oid, created_by_upn, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_oid, role) DO UPDATE SET owner_upn=excluded.owner_upn,
      display_name=excluded.display_name, updated_at=excluded.updated_at`).bind(oid, upn, name, role, identity.oid, identity.upn, timestamp, timestamp)
    : env.DB.prepare('DELETE FROM portal_access_assignments WHERE owner_oid = ? AND owner_upn = ? AND role = ?').bind(oid, upn, role);
  await env.DB.batch([statement, env.DB.prepare(`INSERT INTO portal_access_audit
    (audit_id, actor_oid, actor_upn, target_oid, target_upn, role, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(auditId, identity.oid, identity.upn, oid, upn, role, action, timestamp)]);
  const current = await env.DB.prepare(`SELECT owner_oid, owner_upn, display_name, role, created_at, updated_at
    FROM portal_access_assignments WHERE owner_oid = ? AND owner_upn = ? ORDER BY role`).bind(oid, upn).all();
  return json({ ok: true, user: current.results || [] }, 200, origin || '');
}

async function payMonthStartsEndpoint(request, env, identity, origin) {
  const payPeriods = await loadPayPeriods(env);
  const today = londonDateKey();
  const currentMonthKey = payPeriods.payMonthKeyForDate(today);
  const currentPeriod = payPeriods.periodForMonth(currentMonthKey);
  const nextMonthKey = currentPeriod ? payPeriods.payMonthKeyForDate(currentPeriod.nextStart) : '';
  const nextPeriod = payPeriods.periodForMonth(nextMonthKey);
  const settings = () => ({
    startDates: payPeriods.getStartDates(),
    canManage: identity.canManagePayMonthStarts === true,
    currentMonthKey,
    currentStart: currentPeriod && currentPeriod.start || '',
    nextMonthKey,
    nextStart: nextPeriod && nextPeriod.start || ''
  });

  if (request.method === 'GET') return json(settings(), 200, origin || '');
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin || '');
  if (!identity.canManagePayMonthStarts) throw Object.assign(new Error('Pay-month start changes are restricted to approved Accounts users'), { status: 403 });

  const body = await readJson(request);
  const monthKey = text(body.monthKey, '', 7);
  const startDate = text(body.startDate, '', 10);
  const expectedOldStart = text(body.expectedOldStart, '', 10);
  if (![currentMonthKey, nextMonthKey].includes(monthKey)) throw Object.assign(new Error('Choose the current or next pay month'), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !payPeriods.periodForDate(startDate)) throw Object.assign(new Error('Choose a valid calendar date'), { status: 400 });
  const oldPeriod = payPeriods.periodForMonth(monthKey);
  if (!oldPeriod || oldPeriod.start !== expectedOldStart) throw Object.assign(new Error('This pay-month boundary changed since you opened the calendar. Reload and review it again.'), { status: 409 });
  const previousMonthKey = payPeriods.previousPayMonthKey(monthKey);
  const previousPeriod = payPeriods.periodForMonth(previousMonthKey);
  const lowerBound = previousPeriod && previousPeriod.start || '';
  const upperBound = monthKey === currentMonthKey
    ? (nextPeriod && nextPeriod.start || oldPeriod.nextStart)
    : (nextPeriod && nextPeriod.nextStart || oldPeriod.nextStart);
  if ((lowerBound && startDate <= lowerBound) || (upperBound && startDate >= upperBound)) {
    throw Object.assign(new Error(`Choose a date after ${lowerBound || 'the previous pay-month start'} and before ${upperBound || 'the following pay-month start'}`), { status: 400 });
  }
  if (monthKey === currentMonthKey && startDate > today) throw Object.assign(new Error('The current pay-month start cannot be in the future'), { status: 400 });
  if (monthKey === nextMonthKey && startDate <= today) throw Object.assign(new Error('The next pay-month start must be in the future'), { status: 400 });
  const proposedStarts = { ...payPeriods.getStartDates(), [monthKey]: startDate };
  const proposedPeriods = defaultPayPeriods().createPayPeriods(proposedStarts);
  if (proposedPeriods.payMonthKeyForDate(today) !== currentMonthKey
      || proposedPeriods.payMonthKeyForDate(startDate) !== monthKey
      || proposedPeriods.periodForDate(startDate)?.start !== startDate) {
    throw Object.assign(new Error('That date would move the active pay-month window. Choose another date within the current or next pay-month range.'), { status: 400 });
  }
  if (startDate === oldPeriod.start) return json({ ok: true, changed: false, ...settings() }, 200, origin || '');

  const timestamp = now();
  const auditId = randomBase64Url(18);
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO pay_month_start_settings (month_key, start_date, actor_oid, actor_upn, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(month_key) DO UPDATE SET start_date=excluded.start_date, actor_oid=excluded.actor_oid,
        actor_upn=excluded.actor_upn, updated_at=excluded.updated_at
      WHERE pay_month_start_settings.start_date = ?`)
      .bind(monthKey, startDate, identity.oid, identity.upn, timestamp, expectedOldStart),
    env.DB.prepare(`INSERT INTO pay_month_start_audit (audit_id, actor_oid, actor_upn, month_key, old_start_date, new_start_date, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? FROM pay_month_start_settings
      WHERE month_key = ? AND start_date = ? AND updated_at = ? AND actor_oid = ? AND actor_upn = ?`)
      .bind(auditId, identity.oid, identity.upn, monthKey, oldPeriod.start, startDate, timestamp,
        monthKey, startDate, timestamp, identity.oid, identity.upn)
  ]);
  if (!(results[0] && results[0].meta && results[0].meta.changes > 0)) {
    throw Object.assign(new Error('This pay-month boundary changed while you were saving. Reload and review it again.'), { status: 409 });
  }
  const updatedPeriods = await loadPayPeriods(env);
  const updatedCurrentMonthKey = updatedPeriods.payMonthKeyForDate(today);
  const updatedCurrentPeriod = updatedPeriods.periodForMonth(updatedCurrentMonthKey);
  const updatedNextMonthKey = updatedCurrentPeriod ? updatedPeriods.payMonthKeyForDate(updatedCurrentPeriod.nextStart) : '';
  const updatedNextPeriod = updatedPeriods.periodForMonth(updatedNextMonthKey);
  return json({
    ok: true,
    changed: true,
    startDates: updatedPeriods.getStartDates(),
    canManage: true,
    currentMonthKey: updatedCurrentMonthKey,
    currentStart: updatedCurrentPeriod && updatedCurrentPeriod.start || '',
    nextMonthKey: updatedNextMonthKey,
    nextStart: updatedNextPeriod && updatedNextPeriod.start || ''
  }, 200, origin || '');
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
  // Safari may omit the cross-site cookie on the return from Xero. The random
  // state is also stored hashed, expires, and is consumed once below, so the
  // cookie is an additional mismatch check rather than a required credential.
  if (!xeroOAuthStateMatches(state, cookieState)) return xeroRedirectResponse(configuredReturn, 'error', 'invalid-state');
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
  const result = await env.DB.prepare('SELECT * FROM xero_connections ORDER BY tenant_name').all();
  return result.results || [];
}

async function xeroStatus(env, identity, origin, fetchImpl = fetch) {
  requireXeroAdmin(identity);
  const settings = xeroSettings(env);
  const connections = await xeroConnectionRows(env);
  const checkedAt = now();
  const healthConnections = [];
  const refreshResults = new Map();
  for (const connection of connections) {
    let refreshHealth = 'not_configured';
    let identityStatus = 'unverified';
    let tenantName = text(connection.tenant_name, 'Xero organisation', 500);
    let healthError = '';
    let lastError = text(connection.last_error, '', 1000);

    if (settings.configured) {
      try {
        const savedRefreshToken = await decryptXeroSecret(connection.refresh_token_ciphertext, connection.refresh_token_iv, settings);
        let refreshResult = refreshResults.get(savedRefreshToken);
        if (!refreshResult) {
          try {
            refreshResult = { token: await refreshXeroAccessToken(env, connection, fetchImpl) };
          } catch (error) {
            refreshResult = { error };
          }
          refreshResults.set(savedRefreshToken, refreshResult);
        }
        if (refreshResult.error) throw refreshResult.error;
        const token = refreshResult.token;
        lastError = '';
        const response = await fetchImpl(`${settings.apiUrl}/connections`, { headers: xeroApiHeaders(token.accessToken) });
        if (!response.ok) {
          refreshHealth = 'unavailable';
          healthError = response.status >= 500
            ? 'Xero tenant verification is temporarily unavailable.'
            : 'Xero could not verify the saved organisation. Retry the check or reconnect if the problem continues.';
        } else {
          let liveConnections = null;
          try { liveConnections = await response.json(); } catch (_) {}
          if (!Array.isArray(liveConnections)) {
            refreshHealth = 'unavailable';
            healthError = 'Xero returned an invalid tenant verification response.';
          } else {
            refreshHealth = 'healthy';
            const matched = liveConnections.find((item) =>
              text(item?.tenantId, '', 160) === connection.tenant_id &&
              text(item?.id || item?.connectionId, '', 160) === connection.connection_id
            );
            if (matched) {
              identityStatus = 'verified';
              tenantName = text(matched.tenantName, tenantName, 500);
            } else {
              identityStatus = 'mismatch';
              healthError = 'The active Xero connection does not match the saved tenant identity. Reconnect Xero to restore the Accounts mapping.';
            }
          }
        }
      } catch (error) {
        const reconnectRequired = error?.code === 'XERO_REAUTH_REQUIRED';
        refreshHealth = reconnectRequired ? 'reconnect_required' : 'unavailable';
        healthError = text(error?.publicMessage, reconnectRequired
          ? 'Xero authorisation expired. Reconnect Xero to restore invoice access.'
          : 'Xero could not verify its authorisation right now.', 500);
        if (reconnectRequired) lastError = healthError;
      }
    } else {
      healthError = 'Xero is not fully configured on the portal service.';
    }

    healthConnections.push({
      tenant_id: connection.tenant_id,
      connection_id: connection.connection_id,
      tenant_name: tenantName,
      tenant_type: connection.tenant_type,
      scopes: String(connection.scopes || '').split(/\s+/).filter(Boolean),
      connected_by_upn: connection.connected_by_upn,
      connected_at: connection.connected_at,
      updated_at: connection.updated_at,
      last_error: lastError,
      refresh_health: refreshHealth,
      identity_status: identityStatus,
      checked_at: checkedAt,
      health_error: healthError
    });
  }
  return json({
    configured: settings.configured,
    scopes: settings.scopes.split(/\s+/).filter(Boolean),
    redirect_uri: settings.redirectUri || '',
    checked_at: checkedAt,
    connections: healthConnections
  }, 200, origin || '');
}

async function refreshXeroAccessToken(env, connection, fetchImpl = fetch) {
  const settings = xeroSettings(env);
  if (!settings.configured) throw Object.assign(new Error('Xero is not configured on the portal service'), { status: 503 });
  let currentConnection = connection;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const refreshToken = await decryptXeroSecret(currentConnection.refresh_token_ciphertext, currentConnection.refresh_token_iv, settings);
    const tokenHash = await sha256Base64Url(refreshToken);
    const leaseId = crypto.randomUUID();
    await acquireXeroRefreshLock(env, tokenHash, leaseId);
    try {
      const latestConnection = await env.DB.prepare('SELECT * FROM xero_connections WHERE tenant_id = ?').bind(currentConnection.tenant_id).first();
      if (!latestConnection) throw Object.assign(new Error('The requested Xero organisation is not connected'), { status: 404 });
      const latestRefreshToken = await decryptXeroSecret(latestConnection.refresh_token_ciphertext, latestConnection.refresh_token_iv, settings);
      if (latestRefreshToken !== refreshToken) {
        currentConnection = latestConnection;
        continue;
      }
      return await refreshXeroAccessTokenLocked(env, latestConnection, settings, refreshToken, tokenHash, leaseId, fetchImpl);
    } finally {
      try {
        await env.DB.prepare('DELETE FROM xero_refresh_locks WHERE token_hash = ? AND lease_id = ?').bind(tokenHash, leaseId).run();
      } catch (_) {
        // An expired lease can be reclaimed by the next request.
      }
    }
  }
  throw Object.assign(new Error('Xero authorisation is being refreshed. Retry shortly.'), {
    status: 503,
    code: 'XERO_REFRESH_BUSY',
    publicMessage: 'Xero authorisation is being refreshed. Retry shortly.'
  });
}

async function acquireXeroRefreshLock(env, tokenHash, leaseId) {
  const startedAt = Date.now();
  const leaseDurationMs = 120_000;
  while (Date.now() - startedAt < 10_000) {
    const timestamp = Date.now();
    const result = await env.DB.prepare(`INSERT INTO xero_refresh_locks (token_hash, lease_id, lease_expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET lease_id = excluded.lease_id, lease_expires_at = excluded.lease_expires_at
      WHERE xero_refresh_locks.lease_expires_at <= ?`).bind(tokenHash, leaseId, timestamp + leaseDurationMs, timestamp).run();
    if (Number(result?.meta?.changes || 0) === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Object.assign(new Error('Xero authorisation is being refreshed. Retry shortly.'), {
    status: 503,
    code: 'XERO_REFRESH_BUSY',
    publicMessage: 'Xero authorisation is being refreshed. Retry shortly.'
  });
}

async function refreshXeroAccessTokenLocked(env, connection, settings, refreshToken, tokenHash, leaseId, fetchImpl) {
  const savedConnections = await xeroConnectionRows(env);
  const sharedConnections = [];
  for (const savedConnection of savedConnections) {
    try {
      const savedToken = await decryptXeroSecret(savedConnection.refresh_token_ciphertext, savedConnection.refresh_token_iv, settings);
      if (savedToken === refreshToken) sharedConnections.push(savedConnection);
    } catch (_) {
      // A separately damaged tenant token must not block a valid tenant refresh.
    }
  }
  if (!sharedConnections.some((item) => item.tenant_id === connection.tenant_id)) sharedConnections.push(connection);
  const response = await fetchImpl(settings.tokenUrl, {
    method: 'POST',
    headers: { Authorization: xeroBasicAuth(settings), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    signal: AbortSignal.timeout(30_000)
  });
  const responseText = await response.text();
  let body = null;
  try { body = responseText ? JSON.parse(responseText) : null; } catch (_) {}
  if (!response.ok || !body?.access_token || !text(body?.refresh_token, '', 5000)) {
    const message = xeroErrorMessage(body, `Xero token refresh failed (${response.status})`);
    await env.DB.prepare('UPDATE xero_connections SET last_error = ?, updated_at = ? WHERE tenant_id = ?').bind(message, now(), connection.tenant_id).run();
    const invalidGrant = String(body?.error || '').toLowerCase() === 'invalid_grant' || /consum|invalid.grant|refresh token/i.test(String(body?.error_description || body?.message || ''));
    throw Object.assign(new Error(message), {
      status: 503,
      code: invalidGrant ? 'XERO_REAUTH_REQUIRED' : 'XERO_REFRESH_FAILED',
      publicMessage: invalidGrant
        ? 'Xero authorisation expired or its refresh token was already used. Reconnect Xero to restore invoice access.'
        : 'Xero could not refresh its authorisation. Retry shortly or reconnect Xero to restore invoice access.'
    });
  }
  const nextRefreshToken = text(body.refresh_token, '', 5000);
  const encrypted = await encryptXeroSecret(nextRefreshToken, settings);
  const updatedAt = now();
  const scopes = text(body.scope || connection.scopes, connection.scopes || settings.scopes, 1000);
  const statements = [];
  for (const sharedConnection of sharedConnections) {
    statements.push(env.DB.prepare(`UPDATE xero_connections SET refresh_token_ciphertext = ?, refresh_token_iv = ?, scopes = ?,
      updated_at = ?, last_error = NULL WHERE tenant_id = ? AND refresh_token_ciphertext = ? AND refresh_token_iv = ?`).bind(
      encrypted.ciphertext,
      encrypted.iv,
      scopes,
      updatedAt,
      sharedConnection.tenant_id,
      sharedConnection.refresh_token_ciphertext,
      sharedConnection.refresh_token_iv
    ));
    // D1 batch rolls the token-row updates back together if any compare-and-swap
    // misses. The NOT NULL constraint makes a missed update abort the batch.
    statements.push(env.DB.prepare(`UPDATE xero_refresh_locks
      SET lease_expires_at = CASE WHEN changes() = 1 AND lease_id = ? THEN lease_expires_at ELSE NULL END
      WHERE token_hash = ? AND lease_id = ?`).bind(leaseId, tokenHash, leaseId));
    if (sharedConnection.tenant_id === connection.tenant_id) {
      connection.refresh_token_ciphertext = encrypted.ciphertext;
      connection.refresh_token_iv = encrypted.iv;
    }
  }
  await env.DB.batch(statements);
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
  if (!Array.isArray(body?.Invoices)) throw Object.assign(new Error('Xero invoice lookup returned an invalid response'), { status: 502 });
  const invoices = body.Invoices;
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
  const connection = await selectXeroConnection(env, tenantId);
  const requestedLimit = Number(options.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 50;
  const page = Number(options.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    throw Object.assign(new Error('Invoice page must be an integer between 1 and 1000'), { status: 400 });
  }
  const status = text(options.status, '', 40);
  const cachePath = xeroInvoiceArchivePagePath(connection.tenant_id, page, limit, status);
  if (options.refresh !== true) {
    const cached = await readXeroInvoiceArchivePage(env, connection, page, limit, status);
    if (cached) {
      return {
        tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
        invoices: cached.invoices,
        page,
        page_size: limit,
        pagination: { page_limit: 1000, has_more: cached.invoices.length === limit },
        refreshed_at: cached.cached_at,
        archive: { source: 'sharepoint', stored: true, cached_at: cached.cached_at }
      };
    }
  }

  const settings = xeroSettings(env);
  const token = await refreshXeroAccessToken(env, connection);
  const params = new URLSearchParams({ page: String(page), pageSize: String(limit) });
  if (status) params.set('where', `Status=="${status.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const endpoint = `${settings.apiUrl}/api.xro/2.0/Invoices?${params.toString()}`;
  const response = await fetch(endpoint, { headers: xeroApiHeaders(token.accessToken, connection.tenant_id) });
  const responseText = await response.text();
  let body = null;
  try { body = responseText ? JSON.parse(responseText) : null; } catch (_) {}
  if (!response.ok) throw Object.assign(new Error(xeroErrorMessage(body, `Xero invoice list failed (${response.status})`)), { status: 502 });
  if (!Array.isArray(body?.Invoices)) {
    throw Object.assign(new Error('Xero invoice list returned an invalid response'), { status: 502 });
  }
  const invoices = body.Invoices;
  const cachedAt = now();
  let stored = false;
  try {
    await writeXeroInvoiceArchivePage(env, cachePath, {
      schema_version: 1,
      tenant_id: connection.tenant_id,
      page,
      page_size: limit,
      status,
      cached_at: cachedAt,
      invoices: invoices.slice(0, limit).map(xeroInvoiceProjection)
    });
    stored = true;
  } catch (_) {
    // Keep the Accounts register usable when SharePoint is temporarily
    // unavailable, while making it clear that this page is not archived yet.
  }
  return {
    tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
    invoices: invoices.slice(0, limit).map(xeroInvoiceProjection),
    page,
    page_size: limit,
    pagination: { page_limit: 1000, has_more: invoices.length >= limit },
    refreshed_at: cachedAt,
    archive: { source: 'xero', stored, cached_at: stored ? cachedAt : '' }
  };
}

function xeroInvoiceArchivePagePath(tenantId, page, pageSize, status = '') {
  const tenant = archiveFilename(text(tenantId, '', 160));
  const filter = archiveFilename(text(status, 'all', 40).toLowerCase());
  return `Invoices/Xero/${tenant}/page-${page}-${pageSize}-${filter}.json`;
}

async function readXeroInvoiceArchivePage(env, connection, page, pageSize, status = '') {
  const path = `/root:/${encodeDrivePath(xeroInvoiceArchivePagePath(connection.tenant_id, page, pageSize, status))}:/content`;
  const response = await graphSharePointRequest(env, path, { headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error('SharePoint invoice archive could not be read'), { status: 503 });
  let archived;
  try { archived = await response.json(); } catch (_) {
    throw Object.assign(new Error('SharePoint invoice archive page is invalid'), { status: 503 });
  }
  if (archived?.schema_version !== 1 || archived.tenant_id !== connection.tenant_id ||
      Number(archived.page) !== page || Number(archived.page_size) !== pageSize ||
      String(archived.status || '') !== status || !Array.isArray(archived.invoices) || !archived.cached_at) return null;
  return archived;
}

async function writeXeroInvoiceArchivePage(env, path, archived) {
  const folder = path.slice(0, path.lastIndexOf('/'));
  await ensureSharePointFolder(env, folder);
  const response = await graphSharePointRequest(env, `/root:/${encodeDrivePath(path)}:/content`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(archived)
  });
  if (!response.ok) throw Object.assign(new Error('SharePoint invoice archive could not be written'), { status: 503 });
}

async function listXeroInvoicesEndpoint(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  return json(await listXeroInvoices(env, url.searchParams.get('tenantId') || url.searchParams.get('tenant_id') || '', {
    limit: url.searchParams.get('limit') || 50,
    page: url.searchParams.get('page') || 1,
    status: url.searchParams.get('status') || '',
    refresh: url.searchParams.get('refresh') === '1'
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

function xeroLinkedRecordDisplay(row, payload) {
  let candidates = {};
  let confirmed = {};
  try { candidates = JSON.parse(row.candidates_json || '{}'); } catch (_) {}
  try { confirmed = JSON.parse(row.confirmed_json || '{}'); } catch (_) {}
  const candidateFields = payload.candidateFields && typeof payload.candidateFields === 'object' ? payload.candidateFields : {};
  const confirmedFields = payload.confirmedFields && typeof payload.confirmedFields === 'object' ? payload.confirmedFields : {};
  const title = payload.estimateNumber || payload.number || payload.jobReference || payload.reference ||
    confirmed.cardNumber || confirmedFields.cardNumber || candidates.cardNumber || candidateFields.cardNumber ||
    (row.source_file ? `${row.source_file} · page ${row.source_page || ''}` : row.record_id);
  const customer = payload.company || payload.client || payload.customerName || confirmed.customer ||
    confirmedFields.customer || candidates.customer || candidateFields.customer || '';
  return {
    title: text(title, '', 255), customer: text(customer, '', 240),
    is_candidate: row.kind === 'job-cards' && row.archive_review_state !== 'confirmed' &&
      Boolean(candidates.cardNumber || candidateFields.cardNumber)
  };
}

async function xeroInvoiceRecords(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const query = text(url.searchParams.get('q'), '', 200).toLowerCase();
  const requestedLimit = Number(url.searchParams.get('limit') || 100);
  const requestedOffset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > 1000000) {
    throw Object.assign(new Error('Record lookup pagination is invalid'), { status: 400 });
  }
  const limit = Math.min(requestedLimit, 100);
  const offset = requestedOffset;
  const search = query ? ` AND (
      instr(lower(r.record_id), ?) > 0 OR
      instr(lower(COALESCE(r.payload_json, '')), ?) > 0 OR
      instr(lower(COALESCE(a.candidates_json, '')), ?) > 0 OR
      instr(lower(COALESCE(a.confirmed_json, '')), ?) > 0 OR
      instr(lower(COALESCE(a.ocr_text, '')), ?) > 0 OR
      instr(lower(COALESCE(a.source_file, '')), ?) > 0
    )` : '';
  const values = query ? [query, query, query, query, query, query, limit + 1, offset] : [limit + 1, offset];
  const result = await env.DB.prepare(`SELECT r.record_id, r.kind, r.status, r.employee_name, r.record_date, r.payload_json,
      a.candidates_json, a.confirmed_json, a.review_state AS archive_review_state,
      a.source_file, a.source_page, a.ocr_text
    FROM records r LEFT JOIN job_card_archive a ON a.record_id=r.record_id
    WHERE r.kind IN ('estimates', 'job-cards') AND r.status <> 'Deleted'${search}
    ORDER BY r.updated_at DESC, r.record_id ASC LIMIT ? OFFSET ?`).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  return json({ records: rows.slice(0, limit).map((row) => {
    const payload = payloadObject(row);
    const display = xeroLinkedRecordDisplay(row, payload);
    return {
      record_id: text(row.record_id, '', MAX_RECORD_ID),
      kind: row.kind,
      title: display.title,
      customer: display.customer,
      is_candidate: display.is_candidate,
      date: text(row.record_date, '', 10),
      total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : null
    };
  }), pagination: { has_more: hasMore, next_offset: hasMore ? offset + limit : null } }, 200, origin || '');
}

async function persistExactInvoiceJobCardLinks(env, connection, invoice, identity) {
  const reference = correlationToken(invoice?.Reference);
  const invoiceId = text(invoice?.InvoiceID, '', 180);
  if (!reference || !invoiceId) return;
  // Only reviewed jobReference/reference fields qualify. OCR candidates such
  // as cardNumber are deliberately excluded until Accounts confirms them.
  const result = await env.DB.prepare(`SELECT record_id, kind, payload_json FROM records
    WHERE kind = 'job-cards' AND status <> 'Deleted' AND (
      lower(trim(record_id)) = ? OR
      lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.jobReference'), '') ELSE '' END)) = ? OR
      lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.job_reference'), '') ELSE '' END)) = ? OR
      lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.reference'), '') ELSE '' END)) = ?
    )`).bind(reference, reference, reference, reference).all();
  const rows = result.results || [];
  if (rows.length !== 1) return;
  const record = rows[0];
  await storeXeroInvoiceLinks(env, connection, invoiceId, [{ record_id: record.record_id, kind: 'job-cards' }], identity);

  const messageIds = new Set();
  const matchingEmails = await env.DB.prepare(`SELECT id FROM archive_messages
    WHERE source_kind = 'email' AND lower(trim(reference)) = ?`).bind(reference).all();
  for (const message of matchingEmails.results || []) messageIds.add(message.id);
  const linkedEmails = await env.DB.prepare(`SELECT message_id FROM archive_associations
    WHERE target_kind = 'job-card' AND target_id = ? AND state = 'confirmed'`).bind(record.record_id).all();
  for (const message of linkedEmails.results || []) messageIds.add(message.message_id);
  for (const messageId of messageIds) {
    await upsertEstimateAssociation(env, messageId, {
      target_kind: 'invoice', target_id: invoiceId,
      target_reference: text(invoice.InvoiceNumber || invoiceId, '', 500),
      relationship: 'billed-as', confidence: 1, state: 'confirmed',
      provenance_kind: 'exact-reference',
      evidence: { field: 'xero_reference', value: text(invoice.Reference, '', 500), job_card_id: record.record_id, rule: 'job-card-reference' }
    }, identity.upn);
  }
}

async function xeroInvoiceDetailEndpoint(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const result = await getXeroInvoice(env, url.searchParams.get('tenantId') || '', invoiceId);
  await persistExactInvoiceJobCardLinks(env, result.connection, result.invoice, identity);
  // Keep the link lookup independent from the records projection. Older
  // installations can have the link table populated before every records
  // column is present, and a failed join would make the whole invoice detail
  // panel unavailable. The small follow-up lookup is bounded by the number of
  // links on this invoice and preserves the same enriched response shape.
  const links = await env.DB.prepare(`SELECT record_id, record_kind, linked_by_upn, linked_at
    FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ? ORDER BY linked_at DESC`).bind(result.connection.tenant_id, invoiceId).all();
  const linkedRecords = new Map();
  for (const link of links.results || []) {
    const record = await env.DB.prepare(`SELECT r.status AS record_status, r.record_date, r.payload_json,
        a.candidates_json, a.confirmed_json, a.review_state AS archive_review_state,
        a.source_file, a.source_page
      FROM records r LEFT JOIN job_card_archive a ON a.record_id=r.record_id
      WHERE r.record_id = ?`).bind(link.record_id).first();
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
  // Persist only exact, unique references. Customer-name-only correlations are
  // returned as review candidates and never become confirmed links.
  for (const match of estimateCorrelation.matches) {
    if (!['estimate-number', 'estimate-number-alias', 'reference'].includes(match.rule)) continue;
    const estimate = indexedById.get(match.canonical_id);
    if (!estimate) continue;
    const sourceMessages = new Map();
    if (estimate.internet_message_id) {
      const source = await env.DB.prepare(`SELECT id, conversation_id FROM archive_messages
        WHERE internet_message_id = ? LIMIT 1`).bind(String(estimate.internet_message_id).toLowerCase()).first();
      if (source) sourceMessages.set(source.id, { ...source, provenance: 'exact-reference' });
    }
    for (const source of estimate.mail_sources || []) {
      if (!source.mailbox || !source.outlook_message_id) continue;
      const archived = await env.DB.prepare(`SELECT id, conversation_id FROM archive_messages
        WHERE mailbox = ? AND source_message_id = ? LIMIT 1`).bind(source.mailbox, source.outlook_message_id).first();
      if (archived) sourceMessages.set(archived.id, { ...archived, provenance: 'exact-reference' });
    }
    for (const archived of sourceMessages.values()) {
      await upsertEstimateAssociation(env, archived.id, {
        target_kind: 'invoice', target_id: invoiceId,
        target_reference: text(invoice.InvoiceNumber || invoiceId, '', 500),
        relationship: 'billed-as', confidence: 1, state: 'confirmed',
        provenance_kind: 'exact-reference',
        evidence: { estimate_canonical_id: estimate.canonical_id, rule: match.rule, invoice_reference: text(invoice.Reference, '', 500) }
      }, identity.upn);
      if (archived.conversation_id) {
        const conversation = await env.DB.prepare(`SELECT id FROM archive_messages
          WHERE conversation_id = ? AND source_kind = 'email'`).bind(archived.conversation_id).all();
        for (const message of conversation.results || []) {
          await upsertEstimateAssociation(env, message.id, {
            target_kind: 'invoice', target_id: invoiceId,
            target_reference: text(invoice.InvoiceNumber || invoiceId, '', 500),
            relationship: 'same-conversation', confidence: 1, state: 'confirmed',
            provenance_kind: 'conversation-id',
            evidence: { estimate_canonical_id: estimate.canonical_id, source_message_id: archived.id, conversation_id: archived.conversation_id }
          }, identity.upn);
        }
      }
    }
  }
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
  const relatedJobCards = (links.results || []).filter((link) => link.record_kind === 'job-cards').map((link) => {
    const record = linkedRecords.get(link.record_id) || {};
    const display = xeroLinkedRecordDisplay({ ...record, kind: 'job-cards', record_id: link.record_id }, payloadObject(record));
    return {
      record_id: text(link.record_id, '', MAX_RECORD_ID), record_title: display.title,
      customer: display.customer, is_candidate: display.is_candidate,
      linked_by_upn: text(link.linked_by_upn, '', 320),
      linked_at: text(link.linked_at, '', 80),
      history_url: `../jobs/?record=${encodeURIComponent(link.record_id)}`
    };
  });
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
      const display = xeroLinkedRecordDisplay({ ...record, kind: link.record_kind, record_id: link.record_id }, payload);
      return {
        record_id: text(link.record_id, '', MAX_RECORD_ID),
        record_kind: link.record_kind,
        record_title: display.title,
        customer: display.customer || text(payload.client_company || payload.clientCompany, '', 240),
        is_candidate: display.is_candidate,
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
  if (!canViewRecord(identity, record)) throw Object.assign(new Error('You are not allowed to view this record'), { status: 403 });
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

async function visibleTimesheetRevisions(env,identity) {
  try {
    const all=identity.isTimesheetViewer===true||identity.isSubmissionAdmin===true;
    const query=all?env.DB.prepare('SELECT owner_upn,revision FROM timesheet_owner_revisions ORDER BY owner_upn'):env.DB.prepare('SELECT owner_upn,revision FROM timesheet_owner_revisions WHERE owner_upn=? ORDER BY owner_upn').bind(String(identity.upn||'').toLowerCase());
    const result=await query.all(),map={};for(const row of result?.results||[])map[String(row.owner_upn).toLowerCase()]=Number(row.revision);return map;
  }catch(_){return null;}
}
async function holdOverlappingUpstreamTimesheets(env,identity,rows) {
  if (canViewAllRecords(identity,'timesheets')) return {rows,identityHold:false};
  const ids=[...new Set(rows.map(row=>String(row.source_record_id||'').trim().toLowerCase()).filter(Boolean))];
  // A review establishes a separate boundary for all of that person's
  // upstream timesheets, including copies without a matching source ID.
  // A local record also holds a copy with the same ID for other identities.
  const result=await env.DB.prepare(`SELECT NULL AS record_id, 1 AS identity_hold WHERE EXISTS (
      SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records r ON r.record_id=review.record_id
      WHERE lower(review.subject_oid)=lower(?) OR lower(r.owner_upn)=lower(?)
    )
    UNION SELECT lower(record_id) AS record_id, 0 AS identity_hold FROM records
      WHERE kind='timesheets' AND lower(record_id) IN (SELECT value FROM json_each(?))
    UNION SELECT lower(record_id) AS record_id, 0 AS identity_hold FROM timesheet_ownership_reviews
      WHERE lower(record_id) IN (SELECT value FROM json_each(?))`).bind(String(identity.oid||''),String(identity.upn||''),JSON.stringify(ids),JSON.stringify(ids)).all();
  if (!Array.isArray(result?.results)) throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
  const identityHold=result.results.some(row=>Number(row.identity_hold)===1);
  const held=new Set(result.results.map(row=>String(row.record_id||'').toLowerCase()));
  return {rows:rows.filter(row=>!(identityHold && canonicalKind(row.kind||row.action)==='timesheets') && !held.has(String(row.source_record_id||'').trim().toLowerCase())),identityHold};
}
async function listRecords(request, env, identity, payPeriods = defaultPayPeriods()) {
  const revisionsBefore=await visibleTimesheetRevisions(env,identity);
  const url = new URL(request.url);
  const sourceProbe = url.searchParams.get('source') === 'sharepoint-check';
  if (sourceProbe && identity.isSubmissionAdmin !== true) throw Object.assign(new Error('History source diagnostics require submission admin access'), { status: 403 });
  const requestedKind = url.searchParams.get('kind') || 'all';
  const kind = requestedKind === 'all' ? '' : canonicalKind(requestedKind);
  if (kind && !ALLOWED_KINDS.has(kind)) throw Object.assign(new Error('Record category is not supported'), { status: 400 });
  let timesheetIdentityReviewRequired=false;
  if ((!kind || kind === 'timesheets' || kind === 'clock') && !canViewAllRecords(identity,'timesheets')) {
    try { await assertNoHistoricalOwnerConflict(identity,env.DB); }
    catch (error) {
      if (error?.status!==409 || kind==='clock') throw error;
      timesheetIdentityReviewRequired=true;
    }
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 1000);
  const offset = Math.min(Math.max(Number(url.searchParams.get('offset') || 0), 0), 1000000);
  const payMonth = String(url.searchParams.get('payMonth') || '').trim();
  if (payMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(payMonth)) throw Object.assign(new Error('Pay month must use YYYY-MM format'), { status: 400 });
  const monthPeriod = payMonth && payPeriods && typeof payPeriods.periodForMonth === 'function'
    ? payPeriods.periodForMonth(payMonth)
    : null;
  if (payMonth && !monthPeriod) throw Object.assign(new Error('Pay month is not available'), { status: 400 });
  const projection = `SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
      q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at,
      q.last_error AS dispatch_last_error,
      EXISTS (SELECT 1 FROM timesheet_ownership_reviews reviewed WHERE reviewed.record_id=r.record_id) AS has_ownership_review
    FROM records r LEFT JOIN dispatch_queue q ON q.record_id = r.record_id`;
  const viewAll = Boolean(kind) && canViewAllRecords(identity, kind);
  const isTimesheetViewer = identity.isTimesheetViewer === true;
  const isSubmissionAdmin = identity.isSubmissionAdmin === true;
  const timesheetViewerAcrossKinds = !kind && isTimesheetViewer && !identity.isAdmin;
  const operationsAdminAcrossKinds = !kind && identity.isOperationsAdmin && !identity.isAdmin;
  const hrAdminAcrossKinds = !kind && identity.isHrAdmin && !identity.isAdmin && !identity.isOperationsAdmin;
  const jobCardAdminAcrossKinds = !kind && identity.isJobCardAdmin && !identity.isAdmin;
  // ?1 and ?2 are the signed-in OID and UPN wherever the own-record
  // predicate is used. Reuse them throughout the same SQL snapshot.
  const ownRecords = `((r.kind<>'timesheets' AND r.owner_oid=?1) OR (r.kind='timesheets' AND (
    EXISTS (SELECT 1 FROM timesheet_ownership_reviews review JOIN timesheet_review_record_revisions v
      ON v.record_id=review.record_id AND v.revision=review.record_revision
      WHERE review.record_id=r.record_id AND lower(review.subject_oid)=lower(?1) AND NOT EXISTS (
        SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated')))
    OR (NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id)
      AND lower(r.owner_oid)=lower(?1) AND (r.action<>'pay_month_correction' OR lower(r.owner_upn)=?2)
      AND NOT EXISTS (SELECT 1 FROM profile_settings p WHERE lower(p.owner_upn)=?2 AND p.owner_oid<>'' AND lower(p.owner_oid)<>lower(?1))
      AND NOT EXISTS (SELECT 1 FROM records old WHERE lower(old.owner_upn)=?2 AND old.action<>'pay_month_correction'
        AND NOT (old.action='email_archive' AND old.owner_oid='shared-estimate-archive') AND old.owner_oid<>'' AND lower(old.owner_oid)<>lower(?1))))))`;
  const sharedRecordKinds = "r.kind IN ('job-cards')";
  const sql = !kind && isSubmissionAdmin
    ? `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`
    : !kind && identity.isAdmin
    ? (isTimesheetViewer
      ? `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`
      : `${projection} WHERE r.status <> 'Deleted' AND (r.kind NOT IN ('timesheets', 'clock') OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`)
    : timesheetViewerAcrossKinds
      ? (identity.isOperationsAdmin
        ? `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`
        : identity.isHrAdmin
          ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind IN ('timesheets', 'clock', 'calendar') OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`
          : `${projection} WHERE r.status <> 'Deleted' AND (r.kind IN ('timesheets', 'clock') OR ${ownRecords} OR ${sharedRecordKinds}) ORDER BY r.updated_at DESC LIMIT ?`)
    : operationsAdminAcrossKinds
      ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind NOT IN ('timesheets', 'clock') OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`
    : hrAdminAcrossKinds
      ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind = 'calendar' OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`
    : viewAll
      ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`
    : jobCardAdminAcrossKinds
        ? `${projection} WHERE r.status <> 'Deleted' AND (${ownRecords} OR ${sharedRecordKinds}) ORDER BY r.updated_at DESC LIMIT ?`
        : (kind
          ? (viewAll ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE ${ownRecords} AND r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`)
          : `${projection} WHERE (${ownRecords} OR ${sharedRecordKinds}) AND r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`);
  const bindings = !kind && isSubmissionAdmin
    ? [limit]
    : !kind && identity.isAdmin
    ? (isTimesheetViewer ? [limit] : [identity.oid, identity.upn, limit])
    : timesheetViewerAcrossKinds
      ? (identity.isOperationsAdmin ? [limit] : [identity.oid, identity.upn, limit])
    : operationsAdminAcrossKinds
      ? [identity.oid, identity.upn, limit]
    : hrAdminAcrossKinds
      ? [identity.oid, identity.upn, limit]
    : viewAll
      ? [kind || 'job-cards', limit]
      : jobCardAdminAcrossKinds
        ? [identity.oid, identity.upn, limit]
        : (kind ? (viewAll ? [kind, limit] : [identity.oid, identity.upn, kind, limit]) : [identity.oid, identity.upn, limit]);
  let pagedSql = sql.replace(/ORDER BY r\.updated_at DESC LIMIT \?/g, 'ORDER BY r.updated_at DESC, r.record_id ASC LIMIT ? OFFSET ?');
  const queryBindings = bindings.slice(0, -1);
  if (timesheetIdentityReviewRequired) {
    const orderIndex=pagedSql.indexOf(' ORDER BY');
    if(orderIndex<0)throw new Error('History ordering is unavailable');
    pagedSql=pagedSql.slice(0,orderIndex)+" AND r.kind <> 'clock'"+pagedSql.slice(orderIndex);
  }
  if (monthPeriod) {
    const cycleStart = String(monthPeriod.start || '');
    const cycleEnd = String(monthPeriod.cycleEnd || monthPeriod.end || '');
    const orderIndex = pagedSql.indexOf(' ORDER BY');
    if (orderIndex < 0 || !cycleStart || !cycleEnd) throw Object.assign(new Error('Pay-month history range is unavailable'), { status: 400 });
    pagedSql = pagedSql.slice(0, orderIndex) + ' AND ((r.record_date >= ? AND r.record_date <= ?) OR (r.start_date <= ? AND r.end_date >= ?))' + pagedSql.slice(orderIndex);
    queryBindings.push(cycleStart, cycleEnd, cycleEnd, cycleStart);
  }
  queryBindings.push(limit + 1, offset);
  const result = await env.DB.prepare(pagedSql).bind(...queryBindings).all();
  const includeSynthetic = identity.isAdmin && url.searchParams.get('includeSynthetic') === '1';
  const pageRows = result.results || [];
  const reviewedIds = canViewAllRecords(identity,'timesheets') ? new Set() : new Set(pageRows.filter(row=>row.has_ownership_review).map(row=>row.record_id));
  const hasMoreLocalRecords = pageRows.length > limit;
  const projectedLocalRecords = pageRows.slice(0, limit).map((row) => projectRow(row, true, env, payPeriods));
  const syntheticRecordCount = projectedLocalRecords.filter((row) => row.synthetic).length;
  let records = includeSynthetic ? projectedLocalRecords : projectedLocalRecords.filter((row) => !row.synthetic);
  const localRecordCount = records.length;
  let upstream = 'not-configured';
  let upstreamRecordCount = 0;
  let upstreamSourceRowCount = 0;
  let upstreamNormalisedRecordCount = 0;
  let upstreamEmployeeMatchedRecordCount = 0;
  let releasedUpstreamRecords = [];
  let timesheetHistoryHeld = false;
  const upstreamUrl = text(env.HISTORY_UPSTREAM_URL, '', 2000);
  const upstreamEnabledForKind = !timesheetIdentityReviewRequired && (!kind || kind === 'timesheets' || kind === 'clock');
  const useSecureHistory = text(env.HISTORY_SOURCE, '', 40).toLowerCase() === 'sharepoint';
  if ((sourceProbe || useSecureHistory) && upstreamEnabledForKind) {
    let result;
    try {
      result = await readSharePointHistory(env, identity);
    } catch (error) {
      if (!sourceProbe) {
        upstream = 'sharepoint-unavailable';
      } else {
        const known = ['Shared archive content access is not configured', 'Shared archive content authentication failed', 'SharePoint history is not configured', 'SharePoint history pagination is incomplete', 'Invalid SharePoint history continuation', 'Invalid SharePoint history response'];
        const safeStage = ['authentication', 'continuation', 'request', 'response', 'mapping'].includes(error?.historyStage) ? error.historyStage : 'unknown';
        const safeName = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'URIError'].includes(error?.name) ? error.name : 'Error';
        const errorText = String(error?.message || '');
        const safeReason = /redirect/i.test(errorText) ? ', redirect' : (/fetch|network|dns|connect|socket/i.test(errorText) ? ', network' : '');
        const detail = error?.publicMessage || (known.includes(error?.message) ? error.message : `History source processing failed at ${safeStage} (${safeName}${safeReason})`);
        throw Object.assign(new Error(detail), { status: 503, publicMessage: detail });
      }
    }
    if (result) {
      upstreamSourceRowCount = result.records.length;
      upstreamNormalisedRecordCount = result.records.length;
      upstreamEmployeeMatchedRecordCount = result.records.length;
      const upstreamCandidates=result.records.filter((row) => !kind || canonicalKind(row.kind || row.action) === kind || (kind === 'timesheets' && canonicalKind(row.action) === 'submission'));
      const upstreamHold = await holdOverlappingUpstreamTimesheets(env,identity,upstreamCandidates);
      const upstreamRecords=upstreamHold.rows;
      timesheetHistoryHeld=upstreamHold.identityHold||upstreamRecords.length!==upstreamCandidates.length;
      releasedUpstreamRecords = upstreamRecords;
      upstreamRecordCount = upstreamRecords.length;
      const merged = deduplicateProviderRecords([...records, ...upstreamRecords]);
      const fingerprints = new Set();
      records = removeStaleAbsenceRows(merged.filter((row) => {
        const fingerprint = historyRecordFingerprint(row);
        if (!fingerprint || fingerprints.has(fingerprint)) return false;
        fingerprints.add(fingerprint);
        return true;
      }));
      upstream = 'ok';
    }
  } else if (upstreamUrl && upstreamEnabledForKind) {
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
            const normalisedRows = sourceRows.map((source) => ({ source, row: normaliseUpstreamRecord(source, identity, env) }));
            upstreamNormalisedRecordCount = normalisedRows.filter(({ row }) => Boolean(row)).length;
            const mayViewAll = identity.isSubmissionAdmin === true || identity.isTimesheetViewer === true;
            const employeeMatchedRows = normalisedRows.filter(({ source, row }) => canReadHistoryRecord(identity, row)
              && (mayViewAll || upstreamEmployeeClaimsAgree(source, row)))
              .map(({ row }) => {
                if (!mayViewAll && row.payload) row.payload = { rows: row.payload.rows || [] };
                return row;
              });
            upstreamEmployeeMatchedRecordCount = employeeMatchedRows.length;
            const upstreamRecords = employeeMatchedRows.filter((row) => !kind || canonicalKind(row.kind || row.action) === kind || (kind === 'timesheets' && canonicalKind(row.action) === 'submission'));
            const upstreamCandidates=includeSynthetic ? upstreamRecords : upstreamRecords.filter((row) => !row.synthetic);
            const upstreamHold = await holdOverlappingUpstreamTimesheets(env,identity,upstreamCandidates);
            const visibleUpstreamRecords=upstreamHold.rows;
            timesheetHistoryHeld=upstreamHold.identityHold||visibleUpstreamRecords.length!==upstreamCandidates.length;
            releasedUpstreamRecords = visibleUpstreamRecords;
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
  if (upstream!=='ok' && !timesheetIdentityReviewRequired && !canViewAllRecords(identity,'timesheets') && (!kind || kind==='timesheets' || kind==='clock')) {
    const reviewHold=await holdOverlappingUpstreamTimesheets(env,identity,[]);
    timesheetHistoryHeld=timesheetHistoryHeld||reviewHold.identityHold;
  }
  if (monthPeriod) {
    const start = String(monthPeriod.start || '');
    const end = String(monthPeriod.cycleEnd || monthPeriod.end || '');
    const intersectsMonth = (record) => {
      const payload = record && record.payload && typeof record.payload === 'object' ? record.payload : {};
      const rows = payload.rows || payload.dailyRows || payload.daily_rows || record.rows || record.daily_rows || record.dailyRows;
      if (Array.isArray(rows) && rows.some((row) => {
        const date = String(row && (row.date || row.record_date || row.recordDate || row.workDate || row.Date) || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= end;
      })) return true;
      const recordDate = String(record && (record.record_date || record.recordDate || record.event_date || record.completed_at || record.completedAt || record.created_at || record.submitted_at || record.updated_at) || payload.recordDate || payload.record_date || payload.date || payload.completedAt || payload.completed_at || payload.createdAt || payload.submittedAt || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(recordDate) && recordDate >= start && recordDate <= end) return true;
      const rangeStart = String(record && (record.start_date || record.startDate) || payload.startDate || payload.start_date || '').slice(0, 10);
      const rangeEnd = String(record && (record.end_date || record.endDate) || payload.endDate || payload.end_date || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) && /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) && rangeStart <= end && rangeEnd >= start;
    };
    records = records.filter(intersectsMonth);
  }
  const canViewAllTimesheets = identity.isTimesheetViewer === true || identity.isSubmissionAdmin === true;
  records = records.map((record) => ({
    ...record,
    can_edit_record: reviewedIds.has(record.source_record_id) ? false : canEditRecord(identity, record, new Date(), payPeriods),
    can_edit: ['timesheets', 'clock'].includes(canonicalKind(record.kind || record.action))
      ? (reviewedIds.has(record.source_record_id) ? false : canEditRecord(identity, record, new Date(), payPeriods))
      : record.can_edit === true
  }));
  const completion = canViewAllTimesheets && (!kind || kind === 'timesheets')
    ? completionSummary(records, env)
    : null;
  records.sort((a, b) => String(b.updated_at || b.submitted_at).localeCompare(String(a.updated_at || a.submitted_at)));
  const revisionsAfter=await visibleTimesheetRevisions(env,identity);
  const revisionsConsistent=!timesheetIdentityReviewRequired&&!!revisionsBefore&&!!revisionsAfter&&JSON.stringify(revisionsBefore)===JSON.stringify(revisionsAfter);
  // The external history fetch cannot share the local ownership transaction.
  // If a conflicting identity appeared during that fetch, do not return its
  // rows; a fresh request will instead use the normal review-required path.
  if (upstream==='ok' && !timesheetIdentityReviewRequired && !canViewAllRecords(identity,'timesheets') && (!kind || kind==='timesheets' || kind==='clock')) {
    await assertNoHistoricalOwnerConflict(identity,env.DB);
    const stillVisible=await holdOverlappingUpstreamTimesheets(env,identity,releasedUpstreamRecords);
    if (stillVisible.rows.length!==releasedUpstreamRecords.length) throw Object.assign(new Error('Timesheet history changed during review. Refresh and try again.'),{status:409});
    timesheetHistoryHeld=timesheetHistoryHeld||stillVisible.identityHold;
  }
  return {
    records,
    meta: {
      upstream,
      timesheet_history_held:timesheetHistoryHeld,
      timesheet_identity_review_required:timesheetIdentityReviewRequired,
      timesheet_owner_revisions:revisionsConsistent?revisionsAfter:null,
      timesheet_revision_consistent:revisionsConsistent,
      local_record_count: localRecordCount,
      upstream_record_count: upstreamRecordCount,
      upstream_source_row_count: upstreamSourceRowCount,
      upstream_normalized_record_count: upstreamNormalisedRecordCount,
      upstream_employee_matched_record_count: upstreamEmployeeMatchedRecordCount,
      synthetic_record_count: syntheticRecordCount,
      synthetic_included: includeSynthetic,
      history_pagination: {
        limit,
        offset,
        has_more: hasMoreLocalRecords,
        next_offset: hasMoreLocalRecords ? offset + limit : null,
        pay_month: payMonth || null
      },
      role: identity.isAdmin ? 'accounts-admin' : (identity.isSubmissionAdmin ? 'submissions-manager' : (identity.isHrAdmin ? 'accounts-hr' : (identity.isOperationsAdmin ? 'operations-admin' : (identity.isJobCardAdmin ? 'job-card-admin' : 'employee')))),
      is_admin: identity.isAdmin,
      is_hr_admin: identity.isHrAdmin,
      is_submission_admin: isSubmissionAdmin,
      can_view_all_timesheets: canViewAllTimesheets,
      is_xero_admin: identity.isXeroAdmin,
      is_operations_admin: identity.isOperationsAdmin,
      is_job_card_admin: identity.isJobCardAdmin,
      editable_pay_months: identity.isAdmin ? editablePayCycleKeys(new Date(), 'Europe/London', payPeriods) : currentPayCycleKeys(new Date(), 'Europe/London', payPeriods),
      self_editable_pay_months: currentPayCycleKeys(new Date(), 'Europe/London', payPeriods),
      visible_scope: timesheetIdentityReviewRequired
        ? 'other authorised submissions; timesheets held for an Accounts identity check'
        : isSubmissionAdmin
        ? 'all submissions and all employee timesheets and clock records; My Submissions edit access'
        : identity.isTimesheetViewer
        ? 'all employee timesheets and clock records'
        : identity.isAdmin
          ? 'all non-timesheet submissions; this account timesheets and clock records'
          : identity.isHrAdmin
            ? 'shared calendar requests and this account submissions'
            : identity.isOperationsAdmin
              ? 'all non-timesheet submissions; this account timesheets and clock records'
              : identity.isJobCardAdmin
                ? 'all job cards; this account submissions for other categories'
                : 'this account submissions',
      completion
    }
  };
}

async function assertNoUnresolvedImportHistory(env,owner) {
  const result=await env.DB.prepare(`SELECT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
    LEFT JOIN records source ON source.record_id=review.record_id
    WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?) AS held`)
    .bind(String(owner.oid||'').toLowerCase(),String(owner.upn||'').toLowerCase()).first();
  if (!result || ![0,1].includes(result.held) || result.held===1) {
    throw Object.assign(new Error('Complete timesheet history is unavailable; check existing days before importing.'),{status:503,publicMessage:'Complete timesheet history is unavailable; check existing days before importing.'});
  }
}

async function documentTimesheetTarget(request,env,identity,body) {
    const dates=body.dates;
    if(!Array.isArray(dates)||!dates.length||dates.length>80||dates.some(date=>typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)) throw Object.assign(new Error('Choose valid timesheet dates'),{status:400});
    const payPeriods=await loadPayPeriods(env),month=payCycleKeyForDate(dates[0],payPeriods);
    if(!month||dates.some(date=>payCycleKeyForDate(date,payPeriods)!==month))throw Object.assign(new Error('Select one pay month at a time'),{status:400});
    const roster=documentImportRoster(env),owner=await documentImportOwner(identity,body,roster,env);
    await assertNoUnresolvedImportHistory(env,owner);
    const readRevision=async()=>Number((await env.DB.prepare('SELECT revision FROM timesheet_owner_revisions WHERE owner_upn=?').bind(owner.upn.toLowerCase()).first())?.revision||0);
    const readReviewWatermark=async()=>Number((await env.DB.prepare(`SELECT COALESCE(MAX(e.event_id),0) AS watermark FROM timesheet_ownership_review_events e JOIN timesheet_ownership_reviews review ON review.review_id=e.review_id WHERE lower(review.subject_oid)=?`).bind(String(owner.oid).toLowerCase()).first())?.watermark||0);
    const revisionBefore=await readRevision();
    const reviewBefore=await readReviewWatermark();
    const projected={kind:'timesheets',owner_oid:owner.oid,owner_upn:owner.upn,payload:{rows:dates.map(date=>({date}))}};
    if(!canEditRecord(identity,projected,new Date(),payPeriods))throw Object.assign(new Error('This employee or pay month is not editable for your account'),{status:403});
    const historyUrl=new URL('/api/history?kind=all&limit=1000',request.url),history=await listRecords(new Request(historyUrl,{headers:request.headers}),env,identity,payPeriods);
    if(history.meta?.timesheet_revision_consistent!==true||history.meta?.timesheet_history_held===true||history.meta?.history_pagination?.has_more||((env.HISTORY_UPSTREAM_URL||String(env.HISTORY_SOURCE||'').toLowerCase()==='sharepoint')&&history.meta?.upstream!=='ok'))throw Object.assign(new Error('Complete timesheet history is unavailable; check existing days before importing.'),{status:503,publicMessage:'Complete timesheet history is unavailable; check existing days before importing.'});
    const conflicts=dates.filter(day=>(history.records||[]).some(record=>{
      if(!['timesheets','clock'].includes(canonicalKind(record.kind||record.action))||!timesheetRecordMayBelongTo(record,{...owner,name:owner.name||(owner.oid===identity.oid?identity.name:'')},roster))return false;
      const data=record.payload&&typeof record.payload==='object'?record.payload:{};
      return [data.rows,data.dailyRows,data.daily_rows,data.gmtDailyRows].some(rows=>Array.isArray(rows)&&rows.some(row=>String(row?.date||row?.recordDate||row?.record_date||'').slice(0,10)===day))||(canonicalKind(record.kind||record.action)==='clock'&&String(record.record_date||'').slice(0,10)===day);
    }));
    const snapshot=(history.records||[]).filter(record=>['timesheets','clock'].includes(canonicalKind(record.kind||record.action))&&timesheetRecordMayBelongTo(record,{...owner,name:owner.name||(owner.oid===identity.oid?identity.name:'')},roster)).map(record=>{
      const data=record.payload&&typeof record.payload==='object'?record.payload:{};
      const rows=[data.rows,data.dailyRows,data.daily_rows,data.gmtDailyRows].filter(Array.isArray).flat().filter(row=>payCycleKeyForDate(String(row?.date||row?.recordDate||row?.record_date||'').slice(0,10),payPeriods)===month);
      const deleted=(Array.isArray(data.deletedDays)?data.deletedDays:[]).filter(date=>payCycleKeyForDate(date,payPeriods)===month);
      const clock=canonicalKind(record.kind||record.action)==='clock'&&payCycleKeyForDate(record.record_date,payPeriods)===month;
      return rows.length||deleted.length||clock ? {id:record.source_record_id||record.record_id||'',kind:record.kind,action:record.action,date:record.record_date||'',rows,deleted} : null;
    }).filter(Boolean).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const reviewEventWatermark=await readReviewWatermark();
    const historyFingerprint=await sha256Base64Url(JSON.stringify({snapshot,reviewEventWatermark}));
    const localRevision=await readRevision();
    if(localRevision!==revisionBefore || reviewEventWatermark!==reviewBefore)throw Object.assign(new Error('Timesheet history changed while loading; try again.'),{status:409});
    return {employeeUpn:owner.upn,employeeName:owner.name||(owner.oid===identity.oid?identity.name:owner.upn),ownerOid:owner.oid,payMonth:month,canEdit:true,conflicts,historyFingerprint,localRevision,reviewEventWatermark};
}

// A filing intent is a short-lived, snapshot-bound permission to submit one
// original for private storage. It neither uploads a file nor approves its
// contents for payroll or delivery. Disabled until the full filing path and
// its private provider location have been separately verified.
async function privateTimesheetOriginalIntentEndpoint(request,env,identity,origin) {
  if (env.PRIVATE_TIMESHEET_ORIGINALS_ENABLED !== 'true') return json({error:'Private original filing is not available'},503,origin);
  const body=await readJson(request);
  const recordId=typeof body.recordId==='string' ? body.recordId : '';
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(recordId)) return json({error:'Invalid correction reference'},400,origin);
  const record=await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
  const periods=await loadPayPeriods(env);
  if(!record || record.status==='Deleted' || record.kind!=='timesheets' || record.action!=='pay_month_correction' || !canEditRecord(identity,record,new Date(),periods)) return json({error:'Correction access is not permitted'},403,origin);
  // The employee and caller are resolved on the server, never taken from the
  // browser's claimed owner or actor. The store repeats all revision guards.
  const owner=await documentImportOwner(identity,{employeeEmail:record.owner_upn},documentImportRoster(env),env);
  if(String(owner.oid||'').toLowerCase()!==String(record.owner_oid||'').toLowerCase() || String(owner.upn||'').toLowerCase()!==String(record.owner_upn||'').toLowerCase()) return json({error:'Employee identity needs reconciliation'},409,origin);
  const actor=String(identity.oid||'').toLowerCase(), employee=String(owner.oid||'').toLowerCase(), upn=String(owner.upn||'').toLowerCase();
  const result=await createPrivateOriginalIntent(env.DB,{recordId,employeeOid:employee,ownerUpn:upn,actorOid:actor,sourceSha256:body.sourceSha256,dates:body.dates,ownerRevision:body.ownerRevision,recordPayload:record.payload_json},
    async details=>String(details.actorOid||'').toLowerCase()===actor && String(details.employeeOid||'').toLowerCase()===employee && String(details.ownerUpn||'').toLowerCase()===upn && details.recordId===recordId && canEditRecord(identity,record,new Date(),periods));
  if(!result)return json({error:'The correction or its source changed; review it again before filing'},409,origin);
  return json({intentId:result.reviewId,reviewState:'pending'},201,origin);
}

async function privateTimesheetOriginalUploadEndpoint(request,env,identity,intentId,origin) {
  // This administrative assertion must only be set after owner-level proof
  // of full permission visibility for the actual service identity and vault.
  if(env.PRIVATE_TIMESHEET_ORIGINALS_ENABLED!=='true' || env.PRIVATE_TIMESHEET_ORIGINAL_PERMISSION_VISIBILITY_VERIFIED!=='true') return json({error:'Private original filing is not available'},503,origin);
  const extension=String(request.headers.get('x-gmt-original-extension')||'').toLowerCase();
  if(!/^(?:pdf|doc|docx|docm|xls|xlsx|csv|txt|json|png|jpg|jpeg)$/.test(extension))return json({error:'The original file type is invalid'},400,origin);
  const periods=await loadPayPeriods(env);
  const authorise=async details=>{
    const row=await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(details.recordId).first();
    if(!row||row.status==='Deleted'||!canEditRecord(identity,row,new Date(),periods)||String(row.owner_oid||'').toLowerCase()!==String(details.employeeOid||'').toLowerCase()||String(row.owner_upn||'').toLowerCase()!==String(details.ownerUpn||'').toLowerCase())return false;
    const owner=await documentImportOwner(identity,{employeeEmail:row.owner_upn},documentImportRoster(env),env);
    return String(owner.oid||'').toLowerCase()===String(details.employeeOid||'').toLowerCase()&&String(owner.upn||'').toLowerCase()===String(details.ownerUpn||'').toLowerCase();
  };
  const current=await readPrivateOriginalIntent(env.DB,intentId,authorise);
  if(!current)return json({error:'This filing request is no longer authorised or current'},409,origin);
  const bytes=await readDocumentBytes(request);
  const siteHost=String(env.SHAREPOINT_SITE_ID||'').split(',')[0];
  const graph=createPrivateOriginalGraphIo({siteHost,graphRequest:(path,init)=>graphSharePointRequest(env,path,init),uploadRequest:(url,init)=>fetch(url,init)});
  let authorisedPayload='',authorisedIntent=null;
  const io={...graph,authorize:async details=>{
    const fresh=await readPrivateOriginalIntent(env.DB,intentId,authorise);
    if(!fresh||fresh.recordId!==details.recordId||fresh.employeeOid.toLowerCase()!==details.employeeOid||fresh.sourceSha256!==details.sourceSha256)return null;
    authorisedPayload=fresh.recordPayload;authorisedIntent=fresh;return fresh;
  },createExclusive:async(parent,name,content)=>{
    if(!authorisedIntent || parent!==String(env.PRIVATE_TIMESHEET_SOURCE_VAULT_ID||'') || !await reservePrivateOriginalCreate(env.DB,authorisedIntent,parent,name))throw Object.assign(new Error('This original has an earlier filing attempt that needs reconciliation.'),{status:409});
    return graph.createExclusive(parent,name,content);
  },bind:proof=>bindPrivateOriginalProof(env.DB,proof,authorisedPayload)};
  await filePrivateTimesheetOriginal({parentId:env.PRIVATE_TIMESHEET_SOURCE_PARENT_ID,vaultId:env.PRIVATE_TIMESHEET_SOURCE_VAULT_ID,adminGroupId:env.PRIVATE_TIMESHEET_ADMIN_GROUP_ID,siteOwnerGroupId:env.PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID},
    {recordId:current.recordId,employeeOid:current.employeeOid,sourceSha256:current.sourceSha256,fileName:'original.'+extension,bytes},io);
  return json({reviewState:'pending'},201,origin);
}

function privateOriginalReviewProvider(env){
  if(env.PRIVATE_TIMESHEET_ORIGINALS_ENABLED!=='true'||env.PRIVATE_TIMESHEET_ORIGINAL_REVIEW_ENABLED!=='true'||env.PRIVATE_TIMESHEET_ORIGINAL_PERMISSION_VISIBILITY_VERIFIED!=='true')throw Object.assign(new Error('Private original review is not available'),{status:503});
  const context={parentId:env.PRIVATE_TIMESHEET_SOURCE_PARENT_ID,vaultId:env.PRIVATE_TIMESHEET_SOURCE_VAULT_ID,adminGroupId:env.PRIVATE_TIMESHEET_ADMIN_GROUP_ID,siteOwnerGroupId:env.PRIVATE_TIMESHEET_SITE_OWNER_GROUP_ID};
  const io=createPrivateOriginalGraphIo({siteHost:String(env.SHAREPOINT_SITE_ID||'').split(',')[0],graphRequest:(path,init)=>graphSharePointRequest(env,path,init),uploadRequest:(url,init)=>fetch(url,init)});
  return {context,io};
}
function sameOriginalReviewSnapshot(a,b){
  return Boolean(a&&b&&a.intentId===b.intentId&&a.recordId===b.recordId&&a.employeeOid===b.employeeOid&&a.ownerUpn===b.ownerUpn&&a.ownerRevision===b.ownerRevision&&a.payloadSha256===b.payloadSha256&&a.recordPayload===b.recordPayload&&a.eventId===b.eventId&&a.original.itemId===b.original.itemId&&a.original.eTag===b.original.eTag&&a.original.vaultId===b.original.vaultId&&a.sourceSha256===b.sourceSha256&&JSON.stringify(a.dates)===JSON.stringify(b.dates));
}
async function privateOriginalReviewInventory(request,env,identity,origin){
  requireTimesheetOwnershipReviewer(identity);privateOriginalReviewProvider(env);
  const offset=Number(new URL(request.url).searchParams.get('offset')||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>5000)throw Object.assign(new Error('Review list position is invalid'),{status:400});
  const result=await env.DB.prepare(`SELECT i.intent_id,i.record_id,i.owner_upn,r.employee_name,p.filed_at,
    (SELECT review.review_id FROM timesheet_private_original_reviews review WHERE review.intent_id=i.intent_id AND NOT EXISTS(SELECT 1 FROM timesheet_private_original_review_events e WHERE e.review_id=review.review_id AND e.event_type='revoked') ORDER BY review.reviewed_at DESC LIMIT 1) AS active_review_id
    FROM timesheet_original_filing_intents i JOIN timesheet_private_originals p ON p.intent_id=i.intent_id JOIN records r ON r.record_id=i.record_id
    ORDER BY p.filed_at DESC,i.intent_id LIMIT 51 OFFSET ?`).bind(offset).all();
  if(!Array.isArray(result?.results))throw Object.assign(new Error('Private source reviews are unavailable'),{status:503});
  const rows=result.results.slice(0,50),snapshots=await Promise.all(rows.map(row=>getPrivateOriginalReviewSnapshot(env.DB,row.intent_id)));
  return json({items:rows.map((row,index)=>({intentId:row.intent_id,recordId:row.record_id,employeeName:text(row.employee_name,'',240),employeeUpn:text(row.owner_upn,'',320),filedAt:row.filed_at,
    dates:snapshots[index]?.dates||[],status:snapshots[index]?(row.active_review_id?'recorded':'awaiting-review'):'needs-attention',...(snapshots[index]&&row.active_review_id?{reviewId:row.active_review_id}:{})})),hasMore:result.results.length>50,nextOffset:offset+rows.length},200,origin);
}
// An informational check of this correction only. It neither covers upstream
// records nor authorises the queue, and never changes an imported-source hold.
async function privateOriginalCorrectionCoverage(request,env,identity,origin,internal=false){
  requireTimesheetOwnershipReviewer(identity);
  const {context,io}=privateOriginalReviewProvider(env);
  const recordId=String(new URL(request.url).searchParams.get('recordId')||'');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(recordId))throw Object.assign(new Error('The correction identifier is invalid'),{status:400});
  const readState=async()=>{
    const record=await env.DB.prepare(`SELECT r.record_id,r.owner_oid,r.owner_upn,r.payload_json,v.revision
      FROM records r LEFT JOIN timesheet_owner_revisions v ON lower(v.owner_upn)=lower(r.owner_upn)
      WHERE r.record_id=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted'`).bind(recordId).first();
    if(!record || typeof record.payload_json!=='string' || record.payload_json.length>1000000 || !Number.isSafeInteger(record.revision))throw Object.assign(new Error('The correction is unavailable for source review'),{status:409});
    const versions=await env.DB.prepare('SELECT version_id,payload_json FROM record_versions WHERE record_id=? ORDER BY version_id LIMIT 1001').bind(recordId).all();
    const reviews=await env.DB.prepare(`SELECT review.review_id,review.intent_id,review.employee_oid,review.owner_upn,review.owner_revision,review.payload_sha256,review.source_sha256,review.dates_json,review.vault_id,review.item_id,review.item_etag,review.file_name
      FROM timesheet_private_original_reviews review WHERE review.record_id=? AND NOT EXISTS
      (SELECT 1 FROM timesheet_private_original_review_events e WHERE e.review_id=review.review_id AND e.event_type='revoked')
      ORDER BY review.review_id LIMIT 201`).bind(recordId).all();
    const settings=await env.DB.prepare('SELECT json_group_array(json_array(month_key,start_date)) AS value FROM (SELECT month_key,start_date FROM pay_month_start_settings ORDER BY month_key)').first();
    if(!Array.isArray(versions?.results)||versions.results.length>1000||!Array.isArray(reviews?.results)||reviews.results.length>200||typeof settings?.value!=='string')throw Object.assign(new Error('The source review is too large to check'),{status:409});
    return {record,versions:versions.results,reviews:reviews.results,settings:settings.value};
  };
  const before=await readState(),oid=String(before.record.owner_oid||'').toLowerCase(),upn=String(before.record.owner_upn||'').toLowerCase();
  await assertCurrentSourceReviewSubject(env,oid,upn);
  function pairs(payload){
    if(!payload||!Array.isArray(payload.rows)||payload.rows.length>62)throw Object.assign(new Error('The saved source needs review'),{status:409});
    const result=new Set(),dates=new Set();let unreferencedDays=0;
    for(const row of payload.rows){
      if(!row||typeof row!=='object'||!validReceiptDate(row.date)||dates.has(row.date))throw Object.assign(new Error('The saved source needs review'),{status:409});
      dates.add(row.date);
      const source=row.sourceEvidence?.sourceId;
      if(source===undefined||source===null||source===''){unreferencedDays++;continue;}
      if(typeof source!=='string'||!/^[a-f0-9]{64}$/.test(source))throw Object.assign(new Error('The saved source needs review'),{status:409});
      result.add(row.date+'|'+source);
    }
    const deleted=payload.deletedDays===undefined?[]:payload.deletedDays;
    if(!Array.isArray(deleted)||deleted.length>62||deleted.some(date=>!validReceiptDate(date)||dates.has(date))||new Set(deleted).size!==deleted.length)throw Object.assign(new Error('The saved source needs review'),{status:409});
    return {pairs:result,unreferencedDays,deletedDays:deleted.length,dates:[...dates,...deleted]};
  }
  let current,payMonth;
  try {const payload=JSON.parse(before.record.payload_json);current=pairs(payload);payMonth=payload.payMonth;if(typeof payMonth!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(payMonth))throw new Error('Invalid month');} catch(error) {throw Object.assign(new Error('The saved source needs review'),{status:409});}
  const period=(await loadPayPeriods(env)).periodForMonth(payMonth);
  if(!period||!validReceiptDate(period.start)||!validReceiptDate(period.cycleEnd)||period.start>period.cycleEnd||current.dates.some(date=>date<period.start||date>period.cycleEnd))throw Object.assign(new Error('The saved pay period needs review'),{status:409});
  let earlierUncovered=false;
  for(const version of before.versions){
    let historic;try{historic=pairs(JSON.parse(version.payload_json).payload);}catch(_){throw Object.assign(new Error('Earlier correction history needs review'),{status:409});}
    if(historic.unreferencedDays||historic.deletedDays||historic.dates.some(date=>date<period.start||date>period.cycleEnd)||[...historic.pairs].some(pair=>!current.pairs.has(pair)))earlierUncovered=true;
  }
  const matched=new Set(),snapshots=[];
  for(const review of before.reviews){
    const snapshot=await getPrivateOriginalReviewSnapshot(env.DB,review.intent_id);
    if(!snapshot || snapshot.recordId!==recordId || snapshot.employeeOid!==oid || snapshot.ownerUpn!==upn ||
      review.employee_oid!==snapshot.employeeOid || review.owner_upn!==snapshot.ownerUpn || review.owner_revision!==snapshot.ownerRevision ||
      review.payload_sha256!==snapshot.payloadSha256 || review.source_sha256!==snapshot.sourceSha256 || review.dates_json!==JSON.stringify(snapshot.dates) ||
      review.vault_id!==snapshot.original.vaultId || review.item_id!==snapshot.original.itemId || review.item_etag!==snapshot.original.eTag || review.file_name!==snapshot.original.fileName)continue;
    await verifyPrivateTimesheetOriginal(context,snapshot.original,io);
    for(const date of snapshot.dates){const key=date+'|'+snapshot.sourceSha256;if(current.pairs.has(key))matched.add(key);}
    snapshots.push(snapshot);
  }
  const after=await readState();
  if(JSON.stringify(before)!==JSON.stringify(after))throw Object.assign(new Error('The source review changed while it was checked'),{status:409});
  for(const snapshot of snapshots)if(!sameOriginalReviewSnapshot(snapshot,await getPrivateOriginalReviewSnapshot(env.DB,snapshot.intentId)))throw Object.assign(new Error('The source review changed while it was checked'),{status:409});
  await assertCurrentSourceReviewSubject(env,oid,upn);
  const finalPeriod=(await loadPayPeriods(env)).periodForMonth(payMonth);
  if(!finalPeriod||finalPeriod.start!==period.start||finalPeriod.cycleEnd!==period.cycleEnd)throw Object.assign(new Error('The pay period changed while it was checked'),{status:409});
  const coverage={recordId,payMonth,cycleStart:period.start,cycleEnd:period.cycleEnd,employeeUpn:upn,status:current.pairs.size>0&&!earlierUncovered&&!current.unreferencedDays&&!current.deletedDays&&matched.size===current.pairs.size?'covered':'incomplete',importedDays:current.pairs.size,reviewedDays:matched.size,unreferencedDays:current.unreferencedDays,deletedDays:current.deletedDays,earlierSourceNeedsReview:earlierUncovered,scope:'current-correction-only',deliveryReleased:false};
  return internal?{coverage,state:before}:json(coverage,200,origin);
}

// Stage only: no source proof or dispatch authority is created here. The
// immutable imported-source hold continues to block the production sender.
async function prepareReviewedOriginalQueue(request,env,identity,origin){
  requireTimesheetOwnershipReviewer(identity);
  const body=await readBoundedJson(request,MAX_BODY_BYTES);
  if(!body||Object.keys(body).some(key=>!['recordId','attachments'].includes(key))||typeof body.recordId!=='string'||!Array.isArray(body.attachments))throw Object.assign(new Error('Invalid preparation request'),{status:400});
  const recordId=body.recordId;
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(recordId))throw Object.assign(new Error('Invalid correction identifier'),{status:400});
  const coverageRequest=new Request('https://internal.invalid/?recordId='+encodeURIComponent(recordId));
  const {coverage,state}=await privateOriginalCorrectionCoverage(coverageRequest,env,identity,'',true);
  if(coverage.status!=='covered')throw Object.assign(new Error('The correction source review is incomplete'),{status:409});
  const attachments=parseQueuedAttachments(body),record=state.record;
  if(!attachments.some(a=>a.fieldName==='attachment_record'))throw Object.assign(new Error('The dated correction attachment is required'),{status:400});
  const source=validatePayMonthAttachmentVersion(record,attachments);
  if(source.schemaVersion!==3||source.cycleStart!==coverage.cycleStart||source.cycleEnd!==coverage.cycleEnd||source.rows.some(row=>row.date<coverage.cycleStart||row.date>coverage.cycleEnd))throw Object.assign(new Error('The saved correction or pay period changed'),{status:409});
  try {
    await verifyPreparedAttachments(source,{
      xlsx:decodeBase64(attachments.find(a=>a.fieldName==='attachment').contentBase64),
      csv:decodeBase64(attachments.find(a=>a.fieldName==='attachment_csv').contentBase64)
    });
  } catch (_) { throw Object.assign(new Error('The prepared workbook or CSV does not match the reviewed source'),{status:409}); }
  await stageReviewedOriginalQueue(env,recordId,state,attachments);
  return json({recordId,status:'held',deliveryReleased:false},202,origin);
}

// Trusted internal transaction; callers must first verify review coverage and
// attachment semantics. Exported for a disposable local D1 runtime fixture.
export async function stageReviewedOriginalQueue(env,recordId,state,attachments){
  const record=state.record;
  let guard=`EXISTS (SELECT 1 FROM records r JOIN timesheet_owner_revisions v ON lower(v.owner_upn)=lower(r.owner_upn)
    WHERE r.record_id=? AND r.kind='timesheets' AND r.action='pay_month_correction' AND r.status<>'Deleted' AND r.owner_oid IS ? AND r.owner_upn IS ? AND r.payload_json IS ? AND v.revision=?)
    AND (SELECT json_group_array(json_array(month_key,start_date)) FROM (SELECT month_key,start_date FROM pay_month_start_settings ORDER BY month_key))=?
    AND (SELECT count(*) FROM record_versions WHERE record_id=?)=json_array_length(?)
    AND NOT EXISTS (SELECT 1 FROM json_each(?) entry WHERE NOT EXISTS
      (SELECT 1 FROM record_versions version WHERE version.record_id=? AND version.version_id=json_extract(entry.value,'$.version_id') AND version.payload_json IS json_extract(entry.value,'$.payload_json')))
    AND (SELECT count(*) FROM timesheet_private_original_reviews review WHERE review.record_id=? AND NOT EXISTS
      (SELECT 1 FROM timesheet_private_original_review_events event WHERE event.review_id=review.review_id AND event.event_type='revoked'))=json_array_length(?)
    AND NOT EXISTS (SELECT 1 FROM json_each(?) entry WHERE NOT EXISTS (SELECT 1 FROM timesheet_private_original_reviews review WHERE review.review_id=json_extract(entry.value,'$.review_id') AND review.intent_id=json_extract(entry.value,'$.intent_id') AND review.record_id=?
      AND NOT EXISTS (SELECT 1 FROM timesheet_private_original_review_events event WHERE event.review_id=review.review_id AND event.event_type='revoked')
      AND NOT EXISTS (SELECT 1 FROM timesheet_original_filing_revocations revoked WHERE revoked.intent_id=review.intent_id)))`;
  const versionsJson=JSON.stringify(state.versions),reviewsJson=JSON.stringify(state.reviews.map(({review_id,intent_id})=>({review_id,intent_id})));
  if(versionsJson.length>2000000)throw Object.assign(new Error('The source history is too large to prepare'),{status:409});
  const args=[recordId,record.owner_oid,record.owner_upn,record.payload_json,record.revision,state.settings,recordId,versionsJson,versionsJson,recordId,recordId,reviewsJson,reviewsJson,recordId];
  const at=now(),marker='reviewed-preparation:'+randomBase64Url(18),heldPrefix='Awaiting complete source and provider verification. reviewed-preparation:',held=heldPrefix+marker.slice('reviewed-preparation:'.length);
  const reserved=`EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=? AND q.status='skipped' AND q.last_error=?)`,reserveArgs=[recordId,marker];
  const statements=[env.DB.prepare(`INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at,last_sent_at,last_error)
    SELECT ?,'skipped',?,?,0,?,NULL,? WHERE ${guard} AND (
      (NOT EXISTS (SELECT 1 FROM dispatch_queue WHERE record_id=?) AND NOT EXISTS (SELECT 1 FROM record_attachments WHERE record_id=?)) OR
      EXISTS (SELECT 1 FROM dispatch_queue prior WHERE prior.record_id=? AND prior.status='skipped' AND substr(prior.last_error,1,length(?))=?))
    ON CONFLICT(record_id) DO UPDATE SET updated_at=excluded.updated_at,last_error=excluded.last_error
      WHERE dispatch_queue.status='skipped' AND substr(dispatch_queue.last_error,1,length(?))=?`)
    .bind(recordId,at,at,at,marker,...args,recordId,recordId,recordId,heldPrefix,heldPrefix,heldPrefix,heldPrefix),
   env.DB.prepare(`DELETE FROM record_attachments WHERE record_id=? AND ${reserved}`).bind(recordId,...reserveArgs),
   ...attachments.map(a=>env.DB.prepare(`INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${reserved}`).bind(recordId,a.fieldName,a.fileName,a.contentType,a.contentBase64,a.sizeBytes,at,...reserveArgs))];
  let final=`${guard} AND ${reserved} AND (SELECT count(*) FROM record_attachments WHERE record_id=?)=?`;
  const finalArgs=[...args,...reserveArgs,recordId,attachments.length];
  for(const a of attachments){final+=' AND EXISTS (SELECT 1 FROM record_attachments WHERE record_id=? AND field_name=? AND file_name=? AND content_type=? AND content_base64=? AND size_bytes=?)';finalArgs.push(recordId,a.fieldName,a.fileName,a.contentType,a.contentBase64,a.sizeBytes);}
  statements.push(env.DB.prepare(`UPDATE dispatch_queue SET last_error=? WHERE ${reserved} AND ${final}`).bind(held,...reserveArgs,...finalArgs));
  // Force the transactional batch to roll back if any precondition or final
  // attachment check failed; a partial staged entry must not be left behind.
  statements.push(env.DB.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM dispatch_queue WHERE record_id=? AND status='skipped' AND last_error=?) THEN 1 ELSE json_extract('invalid-json','$') END AS verified`).bind(recordId,held));
  try{await env.DB.batch(statements);}catch(_){throw Object.assign(new Error('The correction or review changed before preparation'),{status:409});}
}
async function privateOriginalReviewEndpoint(request,env,identity,intentId,origin,mode='review'){
  requireTimesheetOwnershipReviewer(identity);
  if(mode==='revoke'){
    const body=await readJson(request);
    if(!await revokePrivateOriginalReview(env.DB,{intentId,reviewId:body.reviewId,actorOid:identity.oid}))return json({error:'The review is no longer active'},409,origin);
    return json({revoked:true},200,origin);
  }
  const {context,io}=privateOriginalReviewProvider(env);
  const snapshot=await getPrivateOriginalReviewSnapshot(env.DB,intentId);
  if(!snapshot)return json({error:'This source is no longer available for review'},409,origin);
  await assertCurrentSourceReviewSubject(env,snapshot.employeeOid,snapshot.ownerUpn);
  if(request.method==='POST'){
    const body=await readJson(request);
    const result=await recordPrivateOriginalReview(env.DB,{intentId,reviewerOid:identity.oid,expectedPayloadSha256:body.expectedPayloadSha256,expectedFileEtag:body.expectedFileEtag,expectedEventId:body.expectedEventId,confirmed:body.confirmed},async proof=>{await verifyPrivateTimesheetOriginal(context,proof,io);return true;});
    if(!result)return json({error:'The source or review changed. Open it again before confirming.'},409,origin);
    return json({reviewId:result.reviewId,reviewState:'recorded',deliveryReleased:false},201,origin);
  }
  await verifyPrivateTimesheetOriginal(context,snapshot.original,io);
  if(mode==='content'){
    const bytes=await io.read(snapshot.original.itemId);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
    if(hash!==snapshot.sourceSha256)throw Object.assign(new Error('The original changed during review'),{status:409});
    await verifyPrivateTimesheetOriginal(context,snapshot.original,io);
    if(!sameOriginalReviewSnapshot(snapshot,await getPrivateOriginalReviewSnapshot(env.DB,intentId)))throw Object.assign(new Error('The source changed during review'),{status:409});
    const extension=snapshot.original.fileName.split('.').pop();
    const headers={'content-type':'application/octet-stream','content-disposition':`attachment; filename="timesheet-original.${extension}"`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'",vary:'Origin'};
    if(origin){headers['access-control-allow-origin']=origin;headers['access-control-allow-credentials']='true';}
    return new Response(bytes,{status:200,headers});
  }
  if(!sameOriginalReviewSnapshot(snapshot,await getPrivateOriginalReviewSnapshot(env.DB,intentId)))throw Object.assign(new Error('The source changed during review'),{status:409});
  const rows=JSON.parse(snapshot.recordPayload).rows.filter(row=>snapshot.dates.includes(row.date));
  return json({employeeOid:snapshot.employeeOid,employeeUpn:snapshot.ownerUpn,recordId:snapshot.recordId,dates:snapshot.dates,rows,payloadSha256:snapshot.payloadSha256,sourceSha256:snapshot.sourceSha256,fileEtag:snapshot.original.eTag,fileExtension:snapshot.original.fileName.split('.').pop(),eventId:snapshot.eventId,deliveryReleased:false},200,origin);
}

// These links were explicitly filed for organisation-wide viewing. The index
// exposes only the original's filename, category, date and tenant link; it
// never exposes a timesheet, a deleted record, or protected record payloads.
export async function listSharedImportedOriginals(env,identity,options={}) {
  if(!identity?.oid||!identity?.upn)throw Object.assign(new Error('Sign-in is required'),{status:401});
  const host=String(env.SHAREPOINT_SITE_ID||'').split(',')[0].toLowerCase();
  if(!/^[a-z0-9-]+\.sharepoint\.com$/.test(host))throw Object.assign(new Error('Shared document storage is unavailable'),{status:503});
  const limit=Math.min(100,Math.max(1,Number.parseInt(options.limit,10)||50));
  const offset=Math.min(10000,Math.max(0,Number.parseInt(options.offset,10)||0));
  const result=await env.DB.prepare(`SELECT f.kind,f.file_name,f.sharing_url,f.filed_at
    FROM document_import_files f
    LEFT JOIN records r ON r.record_id=f.record_id AND r.kind=f.kind AND r.status<>'Deleted'
    LEFT JOIN imported_invoice_records i ON i.record_id=f.record_id AND f.kind='invoices'
    WHERE f.kind IN ('job-cards','tasks','calendar','enquiries','estimates','invoices')
      AND (r.record_id IS NOT NULL OR i.record_id IS NOT NULL)
    ORDER BY f.filed_at DESC,f.record_id ASC LIMIT ? OFFSET ?`).bind(limit+1,offset).all();
  const rows=result.results||[],documents=[];
  for(const row of rows.slice(0,limit)){
    let url;try{url=new URL(String(row.sharing_url||''));}catch(_){continue;}
    if(url.protocol!=='https:'||url.hostname.toLowerCase()!==host||url.username||url.password)continue;
    documents.push({kind:row.kind,fileName:text(row.file_name,'Document',240),url:url.href,filedAt:text(row.filed_at,'',80)});
  }
  return {documents,hasMore:rows.length>limit,nextOffset:offset+Math.min(rows.length,limit)};
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  // Power Automate's connector test forwards its own Origin header. Permit
  // that explicitly configured origin only on the two key-protected machine
  // endpoints, without granting it browser CORS access to the portal.
  const connectorOrigin = String(env.TIMESHEET_CONNECTOR_ORIGIN || '').trim();
  const isConnectorPost = request.method === 'POST' && connectorOrigin === 'https://make.powerautomate.com'
    && request.headers.get('Origin') === connectorOrigin;
  if (isConnectorPost && url.pathname === '/api/integrations/timesheet-delivery-receipts') {
    return timesheetDeliveryReceiptEndpoint(request, env, '');
  }
  if (isConnectorPost && url.pathname === '/api/integrations/private-timesheet-route') {
    return privateTimesheetRouteEndpoint(request, env, '');
  }
  const origin = allowedOrigin(request, env);
  if (origin === null) return json({ error: 'Origin is not allowed' }, 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin || '') });
  }
  if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'gmt-portal-api', version: 1 }, 200, origin || '');
  if (url.pathname === '/api/integrations/timesheet-delivery-receipts' && request.method === 'POST') {
    return timesheetDeliveryReceiptEndpoint(request, env, origin || '');
  }
  if (url.pathname === '/api/integrations/private-timesheet-route' && request.method === 'POST') {
    return privateTimesheetRouteEndpoint(request, env, origin || '');
  }
  if (url.pathname === '/api/xero/callback' && request.method === 'GET') {
    if (!env.DB) return xeroRedirectResponse(xeroSettings(env).returnUrl, 'error', 'storage-not-configured');
    return completeXeroConnection(request, env);
  }
  if (url.pathname === '/api/archive/sync/estimates' && request.method === 'POST') {
    return estimateArchiveIngestEndpoint(request, env, origin || '');
  }
  const identity = await authenticate(request, env);
  if (!env.DB) throw Object.assign(new Error('Protected storage is not configured'), { status: 503 });

  if(url.pathname==='/api/timesheet-original-intents' && request.method==='POST') return privateTimesheetOriginalIntentEndpoint(request,env,identity,origin || '');
  const privateOriginalContent=url.pathname.match(/^\/api\/timesheet-original-intents\/([0-9a-f-]{36})\/content$/i);
  if(privateOriginalContent && request.method==='PUT')return privateTimesheetOriginalUploadEndpoint(request,env,identity,privateOriginalContent[1],origin || '');
  if(url.pathname==='/api/admin/private-timesheet-original-review' && request.method==='GET')return privateOriginalReviewInventory(request,env,identity,origin || '');
  if(url.pathname==='/api/admin/private-timesheet-original-review/coverage' && request.method==='GET')return privateOriginalCorrectionCoverage(request,env,identity,origin || '');
  if(url.pathname==='/api/admin/private-timesheet-original-review/prepare-queue' && request.method==='POST')return prepareReviewedOriginalQueue(request,env,identity,origin || '');
  const privateOriginalReview=url.pathname.match(/^\/api\/admin\/private-timesheet-original-review\/([0-9a-f-]{36})(?:\/(content|revoke))?$/i);
  if(privateOriginalReview && ((!privateOriginalReview[2]&&['GET','POST'].includes(request.method))||(privateOriginalReview[2]==='content'&&request.method==='GET')||(privateOriginalReview[2]==='revoke'&&request.method==='POST')))return privateOriginalReviewEndpoint(request,env,identity,privateOriginalReview[1],origin || '',privateOriginalReview[2]||'review');

  const ownershipLocalPreviewMatch=url.pathname.match(/^\/api\/admin\/timesheet-ownership-review\/([^/]+)\/local-history$/);
  if(ownershipLocalPreviewMatch && request.method==='GET')return ownershipLocalHistoryPreview(request,env,identity,decodeURIComponent(ownershipLocalPreviewMatch[1]),origin || '');
  const ownershipReviewMatch = url.pathname.match(/^\/api\/admin\/timesheet-ownership-review\/([^/]+)(\/revoke)?$/);
  if (ownershipReviewMatch && ((!ownershipReviewMatch[2] && ['GET','POST'].includes(request.method)) || (ownershipReviewMatch[2] && request.method === 'POST'))) {
    return timesheetOwnershipReviewEndpoint(request,env,identity,decodeURIComponent(ownershipReviewMatch[1]),origin || '',Boolean(ownershipReviewMatch[2]));
  }
  if(url.pathname==='/api/admin/timesheet-source-review' && request.method==='GET') {
    return timesheetSourceReviewInventory(env,identity,origin || '');
  }
  if(url.pathname==='/api/admin/timesheet-review-subject' && request.method==='GET') {
    return timesheetReviewSubjectLookup(request,env,identity,origin || '');
  }
  const sourceVersionsMatch=url.pathname.match(/^\/api\/admin\/timesheet-source-review\/([^/]+)\/versions$/);
  if(sourceVersionsMatch && request.method==='GET')return timesheetSourceVersions(request,env,identity,decodeURIComponent(sourceVersionsMatch[1]),origin || '');
  const sourceVersionReviewMatch=url.pathname.match(/^\/api\/admin\/timesheet-source-review\/([^/]+)\/versions\/([^/]+)\/review(\/revoke)?$/);
  if(sourceVersionReviewMatch && request.method==='POST')return timesheetSourceVersionReviewEndpoint(request,env,identity,decodeURIComponent(sourceVersionReviewMatch[1]),decodeURIComponent(sourceVersionReviewMatch[2]),origin || '',Boolean(sourceVersionReviewMatch[3]));
  const sourceExclusionMatch=url.pathname.match(/^\/api\/admin\/timesheet-source-review\/([^/]+)\/not-timesheet(\/revoke)?$/);
  if(sourceExclusionMatch && request.method==='POST')return timesheetSourceExclusionEndpoint(request,env,identity,decodeURIComponent(sourceExclusionMatch[1]),origin || '',Boolean(sourceExclusionMatch[2]));
  const sourceReviewMatch=url.pathname.match(/^\/api\/admin\/timesheet-source-review\/([^/]+)(\/revoke)?$/);
  if (sourceReviewMatch && ((!sourceReviewMatch[2] && ['GET','POST'].includes(request.method)) || (sourceReviewMatch[2] && request.method==='POST'))) {
    return timesheetSourceReviewEndpoint(request,env,identity,decodeURIComponent(sourceReviewMatch[1]),origin || '',Boolean(sourceReviewMatch[2]));
  }

  if (url.pathname === '/api/access' && request.method === 'GET') {
    return json({ isAdmin: identity.isAdmin, isHrAdmin: identity.isHrAdmin, isXeroAdmin: identity.isXeroAdmin,
      canReviewTimesheetOwnership: identity.isAdmin===true && identity.isTimesheetViewer===true && Boolean(identity.oid),
      canReviewPrivateTimesheetOriginals: identity.isAdmin===true && identity.isTimesheetViewer===true && Boolean(identity.oid) && env.PRIVATE_TIMESHEET_ORIGINALS_ENABLED==='true' && env.PRIVATE_TIMESHEET_ORIGINAL_REVIEW_ENABLED==='true' && env.PRIVATE_TIMESHEET_ORIGINAL_PERMISSION_VISIBILITY_VERIFIED==='true',
      isOperationsAdmin: identity.isOperationsAdmin, isJobCardAdmin: identity.isJobCardAdmin,
      canManageSubmissions: identity.isSubmissionAdmin === true,
      canReviewOffsite: identity.canReviewOffsite === true,
      canManagePayMonthStarts: identity.canManagePayMonthStarts,
      roles: identity.assignedRoles || [] }, 200, origin || '');
  }
  const offsiteClockResponse = await offsiteClockEndpoint(request, env, identity, readJson);
  if (offsiteClockResponse) return json(offsiteClockResponse.body, offsiteClockResponse.status, origin || '');
  if (url.pathname === '/api/pay-month-starts' && ['GET', 'POST'].includes(request.method)) {
    return payMonthStartsEndpoint(request, env, identity, origin || '');
  }
  if (url.pathname === '/api/admin/users' && ['GET', 'POST'].includes(request.method)) return adminUsersEndpoint(request, env, identity, origin || '');

  if (url.pathname === '/api/admin/job-card-batches/start' && request.method === 'POST') return jobCardBatchStartEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/job-cards/archive/access' && request.method === 'GET') {
    return json({ canImport: Boolean(identity.isAdmin || identity.isJobCardAdmin) }, 200, origin || '');
  }
  const jobCardBatchStatusMatch = url.pathname.match(/^\/api\/admin\/job-card-batches\/([^/]+)\/status$/);
  if (jobCardBatchStatusMatch && request.method === 'GET') {
    return jobCardBatchStatusEndpoint(env, identity, decodeURIComponent(jobCardBatchStatusMatch[1]), origin || '');
  }
  if (url.pathname === '/api/admin/job-card-upload-sessions' && request.method === 'POST') return jobCardUploadSessionEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/admin/job-card-batches/complete' && request.method === 'POST') return jobCardBatchCompleteEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/admin/job-cards/import' && request.method === 'POST') return jobCardImportEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/job-cards/archive/search' && request.method === 'GET') return listJobCardArchiveEndpoint(request, env, identity, origin || '');
  const jobCardArchiveContentMatch = url.pathname.match(/^\/api\/job-cards\/archive\/([^/]+)\/content$/);
  if (jobCardArchiveContentMatch && request.method === 'GET') {
    return jobCardArchiveContentEndpoint(env, identity, decodeURIComponent(jobCardArchiveContentMatch[1]), origin || '');
  }
  const jobCardArchiveReviewMatch = url.pathname.match(/^\/api\/job-cards\/archive\/([^/]+)\/review$/);
  if (jobCardArchiveReviewMatch && request.method === 'PATCH') {
    return jobCardArchiveReviewEndpoint(request, env, identity, decodeURIComponent(jobCardArchiveReviewMatch[1]), origin || '');
  }
  const jobCardArchiveDetailMatch = url.pathname.match(/^\/api\/job-cards\/archive\/([^/]+)$/);
  if (jobCardArchiveDetailMatch && request.method === 'GET') {
    return jobCardArchiveDetailEndpoint(env, identity, decodeURIComponent(jobCardArchiveDetailMatch[1]), origin || '');
  }

  if (url.pathname === '/api/archive/estimates' && request.method === 'GET') { requireEstimateArchiveAccess(identity); return listEstimateArchiveEndpoint(request, env, origin || ''); }
  if (url.pathname === '/api/archive/estimates/app' && request.method === 'POST') { requireEstimateArchiveAccess(identity); return createAppEstimateEndpoint(request, env, identity, origin || ''); }
  if (url.pathname === '/api/estimates/send' && request.method === 'POST') return sendClientEstimateEndpoint(request, env, identity, origin || '');
  const archiveContentMatch = url.pathname.match(/^\/api\/archive\/estimates\/([^/]+)\/content\/([^/]+)$/);
  if (archiveContentMatch && request.method === 'GET') {
    requireEstimateArchiveAccess(identity);
    return estimateArchiveContentEndpoint(env, decodeURIComponent(archiveContentMatch[1]), decodeURIComponent(archiveContentMatch[2]), origin || '');
  }
  const archiveDetailMatch = url.pathname.match(/^\/api\/archive\/estimates\/([^/]+)$/);
  if (archiveDetailMatch && request.method === 'GET') { requireEstimateArchiveAccess(identity); return estimateArchiveDetailEndpoint(env, origin || '', decodeURIComponent(archiveDetailMatch[1])); }

  if (url.pathname === '/api/xero/connect' && request.method === 'POST') return startXeroConnection(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/status' && request.method === 'GET') return xeroStatus(env, identity, origin || '');
  if (url.pathname === '/api/estimates/index' && ['GET', 'POST'].includes(request.method)) { requireEstimateArchiveAccess(identity); return request.method === 'GET' ? estimateIndexListEndpoint(request, env, identity, origin || '') : estimateIndexUpsertEndpoint(request, env, identity, origin || ''); }
  if (url.pathname === '/api/xero/setup-data' && request.method === 'GET') return xeroSetupDataEndpoint(request, env, identity, origin || '');
  if (url.pathname === '/api/xero/records' && request.method === 'GET') return xeroInvoiceRecords(request, env, identity, origin || '');
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
    const payPeriods = await loadPayPeriods(env);
    return json(await listRecords(request, env, identity, payPeriods), 200, origin || '');
  }

  if (url.pathname === '/api/document-import/invoices' && request.method === 'GET') {
    return json(await listImportedInvoices(env.DB,identity,{limit:url.searchParams.get('limit'),offset:url.searchParams.get('offset')}),200,origin||'');
  }

  if (url.pathname === '/api/document-import/shared-originals' && request.method === 'GET') {
    return json(await listSharedImportedOriginals(env,identity,{limit:url.searchParams.get('limit'),offset:url.searchParams.get('offset')}),200,origin||'');
  }

  const importedFileMatch=url.pathname.match(/^\/api\/document-import\/([^/]+)\/original$/);
  if(importedFileMatch && ['GET','PUT'].includes(request.method)) {
    const recordId=decodeURIComponent(importedFileMatch[1]);
    if(!/^document-import-[A-Za-z0-9_-]+$/.test(recordId))throw Object.assign(new Error('Imported record not found'),{status:404});
    let record=await env.DB.prepare('SELECT * FROM records WHERE record_id=?').bind(recordId).first();
    let sourceId='',fileName='',kind='';
    if(record){
      if(record.status==='Deleted'||!canReadHistoryRecord(identity,record)||(request.method==='PUT'&&!canEditRecord(identity,record)))throw Object.assign(new Error('Document access is not permitted'),{status:403});
      if (['timesheets','clock'].includes(canonicalKind(record.kind)) && !canViewAllRecords(identity,'timesheets')) await assertNoHistoricalOwnerConflict(identity,env.DB);
      const payload=payloadObject(record);sourceId=String(payload.importSourceId||'');fileName=String(payload.importSourceName||'');kind=canonicalKind(record.kind);
    }else{
      if(!identity.isXeroAdmin)throw Object.assign(new Error('Document access is not permitted'),{status:403});
      record=await env.DB.prepare('SELECT * FROM imported_invoice_records WHERE record_id=?').bind(recordId).first();
      if(!record)throw Object.assign(new Error('Imported record not found'),{status:404});
      sourceId=String(record.source_id||'');fileName=String(record.source_name||'');kind='invoices';
    }
    if(request.method==='GET'){
      let stored;
      if (record && ['timesheets','clock'].includes(kind) && !canViewAllRecords(identity,'timesheets')) {
        // A decision about a record does not grant access to its separately
        // filed original. Bind the old-owner check and review hold to the same
        // query that obtains the sharing link, including changes in between.
        stored=await env.DB.prepare(`SELECT f.file_name,f.sharing_url,f.filed_at FROM records r
          LEFT JOIN document_import_files f ON f.record_id=r.record_id
          WHERE r.record_id=? AND r.status<>'Deleted' AND r.kind IS ? AND r.payload_json IS ?
            AND lower(r.owner_oid)=? AND lower(r.owner_upn)=?
            AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id)
            AND NOT EXISTS (SELECT 1 FROM profile_settings p WHERE lower(p.owner_upn)=? AND p.owner_oid<>'' AND lower(p.owner_oid)<>?)
            AND NOT EXISTS (SELECT 1 FROM records old WHERE lower(old.owner_upn)=? AND old.action<>'pay_month_correction'
              AND NOT (old.action='email_archive' AND old.owner_oid='shared-estimate-archive') AND old.owner_oid<>'' AND lower(old.owner_oid)<>?)`)
          .bind(recordId,record.kind,record.payload_json,identity.oid.toLowerCase(),identity.upn.toLowerCase(),identity.upn.toLowerCase(),identity.oid.toLowerCase(),identity.upn.toLowerCase(),identity.oid.toLowerCase()).first();
        if (!stored) throw Object.assign(new Error('Document access is not permitted'),{status:403});
        if (!stored.file_name) stored=null;
      } else {
        stored=await env.DB.prepare('SELECT file_name,sharing_url,filed_at FROM document_import_files WHERE record_id=?').bind(recordId).first();
      }
      if(!stored)return json({filed:false},200,origin||'');
      return json({filed:true,fileName:stored.file_name,url:stored.sharing_url,filedAt:stored.filed_at},200,origin||'');
    }
    // Filing calls SharePoint outside the database transaction. Hold ordinary
    // employee filing until a separately reviewed original and handoff lock
    // can protect that operation from a concurrent ownership decision.
    if(record && ['timesheets','clock'].includes(kind) && !canViewAllRecords(identity,'timesheets')) {
      throw Object.assign(new Error('Timesheet original requires review'),{status:403});
    }
    if(env.DOCUMENT_IMPORT_SHARED_STORAGE_READY!=='true')throw Object.assign(new Error('Shared document filing is not configured yet.'),{status:503,publicMessage:'Shared document filing is not configured yet.'});
    const result=await fileImportedDocument({recordId,kind,sourceId,fileName,bytes:await readDocumentBytes(request)},documentImportSharePointIo(env));
    return json({filed:true,fileName:result.fileName,url:result.url},201,origin||'');
  }

  if (url.pathname === '/api/document-import/timesheet-target' && request.method === 'POST') {
    const result=await documentTimesheetTarget(request,env,identity,await readJson(request));
    const {ownerOid,...publicResult}=result;return json(publicResult,200,origin||'');
  }

  if (url.pathname === '/api/document-import' && request.method === 'POST') {
    const body=await readJson(request);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length>100) throw Object.assign(new Error('Select between 1 and 100 reviewed entries'),{status:400});
    const payPeriods=await loadPayPeriods(env);
    // Import-only identities do not add contractors to attendance expectations.
    // Each target must still resolve to a trusted OID in the database or Entra.
    const roster=documentImportRoster(env);
    const results=[];
    let timesheetHistory;
    for (const candidate of body.items) {
      try {
        if (!candidate || typeof candidate!=='object' || !/^[a-f0-9]{64}(?::[^\x00-\x1f]{1,512})?$/i.test(String(candidate.sourceId||'')) || !Number.isInteger(candidate.sourceIndex) || candidate.sourceIndex<0 || candidate.sourceIndex>10000) throw Object.assign(new Error('Document source identity is invalid'),{status:400});
        if (!['tasks','calendar','timesheets','enquiries','job-cards','estimates','invoices'].includes(candidate.kind)) throw Object.assign(new Error('This document type is not connected to protected import yet'),{status:400});
        const owner=await documentImportOwner(identity,candidate.data,roster,env);
        const normalized=normalizeImportCandidate(candidate);
        // A reviewer can import a few days now and return to the same photo later.
        // Index positions then depend on review order, whereas the date is stable.
        const sourceEntryKey=normalized.kind==='timesheets' ? `day:${normalized.recordDate}` : `index:${candidate.sourceIndex}`;
        const id='document-import-'+await sha256Base64Url(`${owner.upn}\0${candidate.kind}\0${candidate.sourceId}\0${sourceEntryKey}`);
        if (normalized.kind==='invoices') {
          const imported=await saveImportedInvoice({db:env.DB,actor:identity,owner:{...owner,name:owner.name || identity.name},candidate,input:{recordId:id,...normalized},lookup:number=>lookupXeroInvoice(env,'',number)});
          results.push(imported);continue;
        }
        const existing=await env.DB.prepare('SELECT record_id FROM records WHERE record_id=?').bind(id).first();
        if (existing) { results.push({status:'duplicate',record_id:id,message:'This document entry was already imported.'}); continue; }
        if (normalized.kind==='timesheets') {
          const projected={kind:'timesheets',owner_oid:owner.oid,owner_upn:owner.upn,payload:normalized.payload};
          if (!canEditRecord(identity,projected,new Date(),payPeriods)) throw Object.assign(new Error('This employee or pay month is not editable for your account'),{status:403});
          await assertNoUnresolvedImportHistory(env,owner);
          const historyUrl=new URL('/api/history?kind=all&limit=1000',request.url);
          if (!timesheetHistory) timesheetHistory=listRecords(new Request(historyUrl,{headers:request.headers}),env,identity,payPeriods);
          const history=await timesheetHistory;
          if (history.meta?.timesheet_revision_consistent!==true || history.meta?.timesheet_history_held===true || history.meta?.history_pagination?.has_more || ((env.HISTORY_UPSTREAM_URL || String(env.HISTORY_SOURCE||'').toLowerCase()==='sharepoint') && history.meta?.upstream!=='ok')) throw Object.assign(new Error('Complete timesheet history is unavailable; check existing days before importing.'),{status:503,publicMessage:'Complete timesheet history is unavailable; check existing days before importing.'});
          const day=normalized.recordDate;
          const duplicate=(history.records||[]).some(record => {
            if (!['timesheets','clock'].includes(canonicalKind(record.kind||record.action))) return false;
            if (!timesheetRecordMayBelongTo(record,{...owner,name:owner.name || (owner.oid===identity.oid ? identity.name : '')},roster)) return false;
            const data=record.payload && typeof record.payload==='object' ? record.payload : {};
            const arrays=[data.rows,data.dailyRows,data.daily_rows,data.gmtDailyRows];
            return arrays.some(rows=>Array.isArray(rows)&&rows.some(row=>String(row?.date||row?.recordDate||row?.record_date||'').slice(0,10)===day)) || (canonicalKind(record.kind||record.action)==='clock' && String(record.record_date||'').slice(0,10)===day);
          });
          if (duplicate) throw Object.assign(new Error('An existing day is already recorded; review it before importing.'),{status:409});
        }
        let duplicateCondition='',duplicateValues=[];
        if (normalized.kind==='tasks' || normalized.kind==='calendar') {
          duplicateCondition=`r.owner_oid=? AND r.kind=? AND r.status<>'Deleted' AND json_valid(r.payload_json) AND lower(trim(COALESCE(json_extract(r.payload_json,'$.title'),'')))=? AND (?<>'calendar' OR r.record_date=?)`;
          duplicateValues=[owner.oid,normalized.kind,normalized.payload.title.trim().toLowerCase(),normalized.kind,normalized.recordDate||''];
        } else if (normalized.kind==='job-cards') {
          duplicateCondition=`r.kind='job-cards' AND r.status<>'Deleted' AND json_valid(r.payload_json) AND (replace(replace(replace(lower(trim(COALESCE(json_extract(r.payload_json,'$.jobReference'),''))),'-',''),'/',''),' ','')=? OR replace(replace(replace(lower(trim(COALESCE(json_extract(r.payload_json,'$.candidateFields.cardNumber'),''))),'-',''),'/',''),' ','')=? OR EXISTS (SELECT 1 FROM json_each(r.payload_json,'$.candidateFields.cardNumbers') n WHERE n.type='text' AND replace(replace(replace(lower(trim(n.value)),'-',''),'/',''),' ','')=?))`;
          const reference=normalized.payload.jobReference.trim().toLowerCase().replace(/[\s/-]+/g,'');
          duplicateValues=[reference,reference,reference];
        } else if (normalized.kind==='estimates') {
          duplicateCondition=`r.kind='estimates' AND r.status<>'Deleted' AND json_valid(r.payload_json) AND lower(trim(COALESCE(json_extract(r.payload_json,'$.number'),'')))=?`;
          duplicateValues=[normalized.payload.number.trim().toLowerCase()];
        } else if (normalized.kind==='enquiries') {
          duplicateCondition=`r.owner_oid=? AND r.kind='enquiries' AND r.status<>'Deleted' AND json_valid(r.payload_json) AND lower(trim(COALESCE(json_extract(r.payload_json,'$.customerName'),'')))=? AND lower(trim(COALESCE(json_extract(r.payload_json,'$.message'),'')))=?`;
          duplicateValues=[owner.oid,normalized.payload.customerName.trim().toLowerCase(),normalized.payload.message.trim().toLowerCase()];
        }
        if (duplicateCondition) {
          const similar=await env.DB.prepare(`SELECT r.record_id FROM records r WHERE ${duplicateCondition} LIMIT 1`).bind(...duplicateValues).first();
          if (similar) throw Object.assign(new Error('A similar record already exists; review it before importing.'),{status:409});
        }
        const payload={...normalized.payload,editedBy:identity.upn,editNote:'Imported from a reviewed document.'};
        const bodyRecord={recordId:id,...normalized,payload};
        validatePortalRequestMutation(bodyRecord,null,identity);
        const ownerIdentity={...identity,oid:owner.oid,upn:owner.upn,name:owner.name||identity.name,isAdmin:false,isSubmissionAdmin:false,isOperationsAdmin:false};
        const input=normaliseInput(bodyRecord,ownerIdentity,null,env,payPeriods);
        input.payloadJson=JSON.stringify({...JSON.parse(input.payloadJson),importSourceId:candidate.sourceId,importSourceIndex:candidate.sourceIndex,importSourceName:text(candidate.source,'',240),importedBy:identity.upn});
        try {
          const values=[input.recordId,input.ownerOid,input.ownerUpn,input.employeeName,input.kind,input.action,input.status,input.startDate,input.endDate,input.recordDate,input.submittedAt,input.updatedAt,input.issue,input.payloadJson];
          let statement;
          if (normalized.kind==='timesheets') {
            const arrays=['$.rows','$.dailyRows','$.daily_rows','$.gmtDailyRows'].map(path=>`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END, '${path}') j WHERE CASE WHEN j.type='object' THEN COALESCE(json_extract(j.value,'$.date'),json_extract(j.value,'$.recordDate'),json_extract(j.value,'$.record_date')) END=?)`).join(' OR ');
            // The source may still carry an editor's address after a reviewer
            // identifies a different employee. Check those decisions in the
            // same statement as the insert, including revoked decisions: a
            // revoked identity is unresolved, not proof that the day is free.
            statement=env.DB.prepare(`INSERT INTO records (record_id,owner_oid,owner_upn,employee_name,kind,action,status,start_date,end_date,record_date,submitted_at,updated_at,issue,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
              WHERE NOT EXISTS (SELECT 1 FROM records r WHERE (lower(r.owner_upn)=? OR EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id AND lower(review.subject_oid)=?)) AND r.kind IN ('timesheets','clock') AND r.status<>'Deleted' AND ((r.kind='clock' AND r.record_date=?) OR ${arrays}))
              AND NOT EXISTS (SELECT 1 FROM profile_settings p WHERE lower(p.owner_upn)=? AND p.owner_oid<>'' AND lower(p.owner_oid)<>?)
              AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records source ON source.record_id=review.record_id WHERE lower(review.subject_oid)=? OR lower(source.owner_upn)=?)
              AND NOT EXISTS (SELECT 1 FROM records old WHERE lower(old.owner_upn)=? AND old.action<>'pay_month_correction' AND NOT (old.action='email_archive' AND old.owner_oid='shared-estimate-archive') AND old.owner_oid<>'' AND lower(old.owner_oid)<>?)`)
              .bind(...values,owner.upn,String(owner.oid).toLowerCase(),normalized.recordDate,normalized.recordDate,normalized.recordDate,normalized.recordDate,normalized.recordDate,owner.upn,String(owner.oid).toLowerCase(),String(owner.oid).toLowerCase(),owner.upn,owner.upn,String(owner.oid).toLowerCase());
          } else {
            const indexGuard=normalized.kind==='estimates' ? ` AND NOT EXISTS (SELECT 1 FROM estimate_index e WHERE lower(trim(e.estimate_number))=? OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(e.number_aliases_json) THEN e.number_aliases_json ELSE '[]' END) a WHERE a.type='text' AND lower(trim(a.value))=?))` : '';
            const indexValues=normalized.kind==='estimates' ? [normalized.payload.number.trim().toLowerCase(),normalized.payload.number.trim().toLowerCase()] : [];
            statement=env.DB.prepare(`INSERT INTO records (record_id,owner_oid,owner_upn,employee_name,kind,action,status,start_date,end_date,record_date,submitted_at,updated_at,issue,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM records r WHERE ${duplicateCondition})${indexGuard}`)
              .bind(...values,...duplicateValues,...indexValues);
          }
          const inserted=await statement.run();
          if (Number(inserted?.meta?.changes || 0)<1) throw Object.assign(new Error('A similar record or existing day was found; review it before importing.'),{status:409});
        } catch (error) {
          const raced=await env.DB.prepare('SELECT record_id FROM records WHERE record_id=?').bind(id).first();
          if (raced) { results.push({status:'duplicate',record_id:id,message:'This document entry was already imported.'}); continue; }
          throw error;
        }
        const deliveryMessage=normalized.kind==='timesheets' ? 'Saved to portal; Accounts workbook filing has not been queued.' : ['tasks','calendar'].includes(normalized.kind) ? 'Saved to portal; the Microsoft 365 request has not been sent.' : normalized.kind==='job-cards' ? 'Saved to portal; job-card delivery has not been sent.' : normalized.kind==='estimates' ? 'Saved to portal; estimate has not been sent or archived.' : 'Saved to portal; the enquiry has not been linked to an inbox.';
        results.push({status:'saved',record_id:id,message:deliveryMessage});
      } catch (error) { results.push({status:'rejected',message:error?.publicMessage || (error?.status && error.status<500 ? error.message : 'Entry could not be saved. Check the record and try again.')}); }
    }
    return json({results},200,origin||'');
  }

  if (url.pathname === '/api/records' && request.method === 'POST') {
    const payPeriods = await loadPayPeriods(env);
    const body = await readJson(request);
    const requestedAction=body.action||body.gmtAction||parsePayload(body).action||'';
    if(requestedAction==='pay_month_correction' && body.action!=='pay_month_correction')throw Object.assign(new Error('Use the pay-month editor to save this correction safely.'),{status:409});
    if (body.action === 'pay_month_correction') validatePayMonthCorrection(body, new Date(), payPeriods, identity);
    const recordId = text(body.recordId || body.sourceRecordId || body.source_record_id || body.gmt_record_id, '', MAX_RECORD_ID);
    if (/^document-import-/i.test(recordId)) throw Object.assign(new Error('Import record IDs are reserved for the document import workflow'),{status:403});
    const existing = recordId ? await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first() : null;
    if (existing && existing.status === 'Deleted') throw Object.assign(new Error('This record has been deleted'), { status: 409 });
    if (existing && !canEditRecord(identity, existing, new Date(), payPeriods)) throw Object.assign(new Error('This record is read-only for your account'), { status: 403 });
    if (existing?.action === 'archive_import') throw Object.assign(new Error('Scanned job-card records are managed through Accounts review'), { status: 409 });
    if (existing && existing.action === 'pay_month_correction' && body.action !== 'pay_month_correction') throw Object.assign(new Error('A pay-month correction cannot change record type'), { status: 400 });
    if(body.action==='pay_month_correction'){
      if(typeof body.baseCorrectionExists!=='boolean'||body.baseCorrectionExists!==Boolean(existing)||!Number.isSafeInteger(body.baseOwnerRevision)||body.baseOwnerRevision<0||(existing && (!body.baseCorrectionUpdatedAt||String(body.baseCorrectionUpdatedAt)!==String(existing.updated_at||''))))throw Object.assign(new Error('This timesheet changed since it was opened. Refresh and review it before saving.'),{status:409});
    }
    validatePortalRequestMutation(body, existing, identity);
    const input = normaliseInput(body, existing && (identity.isAdmin || identity.isSubmissionAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing, env, payPeriods);
    if (['timesheets','clock'].includes(canonicalKind(input.kind)) && !canViewAllRecords(identity,'timesheets')) await assertNoHistoricalOwnerConflict(identity,env.DB);
    let result;
    if(body.importReview){
      const review=body.importReview;
      if(body.kind!=='timesheets'||body.action!=='pay_month_correction'||!Array.isArray(review.dates)||!Number.isSafeInteger(review.localRevision)||!review.historyFingerprint)throw Object.assign(new Error('Reviewed timesheet data is invalid.'),{status:400});
      const reviewedRows=Array.isArray(body.payload?.rows)?body.payload.rows:[];
      if(!review.dates.length||new Set(review.dates).size!==review.dates.length||review.dates.some(date=>{const rows=reviewedRows.filter(row=>row?.date===date);return rows.length!==1||!/^[a-f0-9]{64}$/i.test(String(rows[0]?.sourceEvidence?.sourceId||''));}))throw Object.assign(new Error('Each imported day must retain its original source reference.'),{status:400});
      const target=await documentTimesheetTarget(request,env,identity,{employeeEmail:body.employeeEmail,dates:review.dates});
      const expectedId='gmt-paymonth-'+target.payMonth+'-'+Array.from(new TextEncoder().encode(target.employeeUpn.toLowerCase()),b=>b.toString(16).padStart(2,'0')).join('');
      const rowDates=new Set((body.payload?.rows||[]).map(row=>row.date));
      const matchingExisting=existing&&existing.action==='pay_month_correction'&&String(existing.owner_upn||'').toLowerCase()===target.employeeUpn.toLowerCase()&&recordPayMonthKey(existing,payPeriods)===target.payMonth;
      if(target.historyFingerprint!==review.historyFingerprint||target.localRevision!==review.localRevision||target.localRevision!==body.baseOwnerRevision||target.conflicts.length||target.payMonth!==body.payload?.payMonth||(existing?!matchingExisting:recordId!==expectedId)||review.dates.some(date=>!rowDates.has(date)))throw Object.assign(new Error('The timesheet changed during review. Refresh and try again.'),{status:409});
      if (!target.ownerOid || (existing && String(existing.owner_oid||'').toLowerCase()!==String(target.ownerOid).toLowerCase())) {
        throw Object.assign(new Error('Employee identity needs reconciliation before this correction can be changed.'),{status:409});
      }
      if (!existing) input.ownerOid=target.ownerOid;
      result=await saveReviewedPayMonth(env,input,identity,existing,target);
    } else if(body.action==='pay_month_correction'){
      const key=String(input.ownerUpn||'').toLowerCase();
      const owner=await documentImportOwner(identity,{employeeEmail:key},documentImportRoster(env),env);
      if (!owner.oid || (existing && String(existing.owner_oid||'').toLowerCase()!==String(owner.oid).toLowerCase())) {
        throw Object.assign(new Error('Employee identity needs reconciliation before this correction can be changed.'),{status:409});
      }
      if (!existing) input.ownerOid=owner.oid;
      result=await saveReviewedPayMonth(env,input,identity,existing,{employeeUpn:key,localRevision:body.baseOwnerRevision});
    } else result=await saveRecord(env, input, identity, existing);
    return json({ ok: true, record_id: input.recordId, ...result }, result.created ? 201 : 200, origin || '');
  }

  const attachmentContentMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments\/([^/]+)\/content$/);
  if (attachmentContentMatch) {
    const recordId = decodeURIComponent(attachmentContentMatch[1]);
    const attachmentId = decodeURIComponent(attachmentContentMatch[2]);
    if (request.method === 'GET') return jobCardAttachmentContentEndpoint(env, identity, recordId, attachmentId, origin || '');
    if (request.method === 'PUT') return jobCardAttachmentUploadEndpoint(request, env, identity, recordId, attachmentId, origin || '');
  }
  const attachmentCompleteMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments\/([^/]+)\/complete$/);
  if (attachmentCompleteMatch && request.method === 'POST') {
    return jobCardAttachmentCompleteEndpoint(env, identity, decodeURIComponent(attachmentCompleteMatch[1]), decodeURIComponent(attachmentCompleteMatch[2]), origin || '');
  }
  const attachmentMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments$/);
  if (attachmentMatch && ['GET', 'POST'].includes(request.method)) {
    const recordId = decodeURIComponent(attachmentMatch[1]);
    const existing = await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(recordId).first();
    if (!existing) return json({ error: 'Record not found' }, 404, origin || '');
    if (existing.kind === 'job-cards') {
      if (request.method === 'GET') {
        await jobCardRecordForAttachment(env, identity, recordId);
        return json({ attachments: await listJobCardAttachments(env, recordId) }, 200, origin || '');
      }
      return jobCardAttachmentStartEndpoint(request, env, identity, recordId, origin || '');
    }
    if (request.method !== 'POST') return json({ error: 'Attachments are only available for job cards' }, 400, origin || '');
    const payPeriods = await loadPayPeriods(env);
    if (!canEditRecord(identity, existing, new Date(), payPeriods)) return json({ error: 'Record access is not permitted' }, 403, origin || '');
    if (['timesheets','clock'].includes(canonicalKind(existing.kind)) && !canViewAllRecords(identity,'timesheets')) await assertNoHistoricalOwnerConflict(identity,env.DB);
    if (existing.status === 'Deleted') return json({ error: 'Record has been deleted' }, 410, origin || '');
    if (existing.kind !== 'timesheets') return json({ error: 'Only timesheet corrections can be queued' }, 400, origin || '');
    if (/^document-import-/i.test(existing.record_id)) return json({ error: 'An imported day cannot be queued as a complete pay-month workbook.' }, 409, origin || '');
    const body = await readJson(request);
    // Only the separate, authenticated synthetic gateway can construct this
    // internal symbol-bearing context. HTTP inputs cannot supply the symbol.
    const testGrant = ctx?.[syntheticQueueCapability];
    const testCapability = testGrant?.capability === syntheticQueueCapability ? syntheticQueueCapability : null;
    if (testCapability && (typeof testGrant.payloadJson !== 'string' || existing.payload_json !== testGrant.payloadJson ||
        existing.owner_oid !== testGrant.ownerOid || existing.owner_upn !== testGrant.ownerUpn || existing.employee_name !== testGrant.employeeName ||
        existing.kind !== testGrant.kind || existing.action !== testGrant.action || existing.status !== testGrant.status)) {
      return json({ error: 'The verified test correction changed before queueing.' }, 409, origin || '');
    }
    let localSnapshotRevision = testCapability ? testGrant.localSnapshotRevision : undefined;
    if (!testCapability && existing.action === 'pay_month_correction' && !syntheticRecord(existing, payloadObject(existing))) {
      const month = String(payloadObject(existing).payMonth || '');
      const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && payPeriods.periodForMonth(month);
      if (!period) throw Object.assign(new Error('The timesheet history needs review before queueing.'), {status:409});
      // Until independently reviewed external history can be bound here,
      // hold any attachment with a day that the server cannot substantiate.
      // Matching local history is still not proof that external history is
      // complete; delivery remains subject to the separate release gates.
      const snapshot = await readLocalPayMonthSnapshot(env,{oid:existing.owner_oid,upn:existing.owner_upn},period,existing.record_id);
      validateCompletePayMonthSource(existing,snapshot.rows,parseQueuedAttachments(body),period);
      localSnapshotRevision = snapshot.revision;
    }
    const result = await queueRecordAttachments(env, existing, body, testCapability, localSnapshotRevision);
    if (result.skipped) {
      const timestamp = now();
      const skipped=await env.DB.prepare(`UPDATE records SET status = 'Test - not sent', issue = '', updated_at = ?
        WHERE record_id=? AND payload_json IS ? AND owner_oid IS ? AND owner_upn IS ? AND employee_name IS ?
          AND kind IS ? AND action IS ? AND status IS ? AND updated_at IS ? AND issue IS ?
          AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=records.record_id)
          AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=records.record_id AND q.status<>'skipped')`)
        .bind(timestamp,recordId,existing.payload_json,existing.owner_oid,existing.owner_upn,existing.employee_name,existing.kind,existing.action,existing.status,existing.updated_at??null,existing.issue??null).run();
      if (Number(skipped?.meta?.changes||0)<1) return json({error:'The test record changed or needs review. Refresh and try again.'},409,origin || '');
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
    if (request.method === 'GET' && existing.kind === 'timesheets' && !canViewAllRecords(identity,'timesheets')) {
      const oid=String(identity.oid || '').trim().toLowerCase(), upn=String(identity.upn || '').trim().toLowerCase();
      // Resolve the decision and the record in one query. Once a record has
      // ever had a review, its original editor fields cannot restore access
      // after revocation or invalidation.
      const visible = await env.DB.prepare(`SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
          q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at, q.last_error AS dispatch_last_error,
          EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
            JOIN timesheet_review_record_revisions v ON v.record_id=review.record_id AND v.revision=review.record_revision
            WHERE review.record_id=r.record_id AND lower(review.subject_oid)=? AND NOT EXISTS (
              SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated'))) AS reviewed_access
        FROM records r LEFT JOIN dispatch_queue q ON q.record_id=r.record_id
        WHERE r.record_id=? AND r.kind='timesheets' AND r.status<>'Deleted' AND (
          EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
            JOIN timesheet_review_record_revisions v ON v.record_id=review.record_id AND v.revision=review.record_revision
            WHERE review.record_id=r.record_id AND lower(review.subject_oid)=? AND NOT EXISTS (
              SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated')))
          OR (NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id)
            AND lower(r.owner_oid)=? AND (r.action<>'pay_month_correction' OR lower(r.owner_upn)=?)
            AND NOT EXISTS (SELECT 1 FROM profile_settings p WHERE lower(p.owner_upn)=? AND p.owner_oid<>'' AND lower(p.owner_oid)<>?)
            AND NOT EXISTS (SELECT 1 FROM records old WHERE lower(old.owner_upn)=? AND old.action<>'pay_month_correction'
              AND NOT (old.action='email_archive' AND old.owner_oid='shared-estimate-archive') AND old.owner_oid<>'' AND lower(old.owner_oid)<>?)))`)
        .bind(oid,recordId,oid,oid,upn,upn,oid,upn,oid).first();
      if (!visible) return json({ error:'Record access is not permitted' },403,origin || '');
      const payPeriods=await loadPayPeriods(env), reviewed=Boolean(visible.reviewed_access);
      const record=projectRow(visible,true,env,payPeriods);
      record.can_edit=reviewed ? false : canEditRecord(identity,visible,new Date(),payPeriods);
      record.can_edit_record=record.can_edit;
      return json({ record,payload:payloadObject(visible) },200,origin || '');
    }
    if (!canAccessRecord(identity, existing)) return json({ error: 'Record access is not permitted' }, 403, origin || '');
    if (['timesheets','clock'].includes(canonicalKind(existing.kind)) && !canViewAllRecords(identity,'timesheets')) await assertNoHistoricalOwnerConflict(identity,env.DB);
    if (existing.status === 'Deleted') return json({ error: 'Record has been deleted' }, 410, origin || '');
    if (request.method === 'GET') {
      const payPeriods = await loadPayPeriods(env);
      const record = projectRow(existing, true, env, payPeriods);
      record.can_edit = ['timesheets', 'clock'].includes(canonicalKind(existing.kind)) && canEditRecord(identity, existing, new Date(), payPeriods);
      record.can_edit_record = canEditRecord(identity, existing, new Date(), payPeriods);
      return json({ record, payload: payloadObject(existing) }, 200, origin || '');
    }
    if (existing.action === 'archive_import' && (request.method === 'PATCH' || request.method === 'DELETE')) return json({ error: 'Scanned job-card records are managed through Accounts review' }, 409, origin || '');
    if (request.method === 'PATCH') {
      const payPeriods = await loadPayPeriods(env);
      if (!canEditRecord(identity, existing, new Date(), payPeriods)) return json({ error: 'This record is read-only for your account.' }, 403, origin || '');
      const body = await readJson(request);
      if(existing.action==='pay_month_correction')return json({error:'Open the pay-month editor to save this correction safely.'},409,origin||'');
      if((body.action||body.gmtAction||parsePayload(body).action)==='pay_month_correction')return json({error:'Open the pay-month editor to save this correction safely.'},409,origin||'');
      if (/^document-import-/i.test(recordId)) {
        const fields=parsePayload(body);
        const requestedPayloadKind=body.payload && typeof body.payload==='object' && !Array.isArray(body.payload) ? body.payload.kind : '';
        const kind=canonicalKind(body.kind || body.type || fields.kind || existing.kind);
        const action=text(body.action || body.gmtAction || fields.action || (kind==='clock'?'clock_event':'submission'),'submission',100);
        if(kind!==canonicalKind(existing.kind) || (requestedPayloadKind && canonicalKind(requestedPayloadKind)!==canonicalKind(existing.kind))) return json({error:'Imported records cannot change category.'},409,origin||'');
        if(existing.kind==='timesheets' && action!==existing.action) return json({error:'An imported day cannot become a pay-month correction.'},409,origin||'');
      }
      if (existing.action === 'pay_month_correction' && body.action !== 'pay_month_correction') return json({ error: 'A pay-month correction cannot change record type' }, 400, origin || '');
      if (existing.action === 'pay_month_correction') validatePayMonthCorrection(body, new Date(), payPeriods, identity);
      validatePortalRequestMutation(body, existing, identity);
      const input = normaliseInput({ ...body, recordId }, (identity.isAdmin || identity.isSubmissionAdmin || (identity.isOperationsAdmin && existing.kind !== 'timesheets' && existing.kind !== 'clock') || (existing.kind === 'job-cards' && identity.isJobCardAdmin)) ? { ...identity, name: existing.employee_name } : identity, existing, env, payPeriods);
      const result = await saveRecord(env, input, identity, existing);
      return json({ ok: true, record_id: input.recordId, ...result }, 200, origin || '');
    }
    if (request.method === 'DELETE') {
      if (identity.isSubmissionAdmin === true && !isOwnerRecord(identity, existing)) return json({ error: 'Submission managers can edit records but cannot delete another employee’s submission.' }, 403, origin || '');
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
      if (String(error?.message || '').includes('gmt_timesheet_handoff_in_progress')) {
        return json({error:'A timesheet delivery is being handed off. Please wait and try again.'},409,allowedOrigin(request,env) || '');
      }
      if (String(error?.message || '').includes('gmt_timesheet_delivery_in_progress')) {
        return json({error:'A timesheet workbook delivery is in progress or needs review. Please try again later or contact Accounts.'},409,allowedOrigin(request,env) || '');
      }
      const status = Number(error && error.status) || 500;
      const message = error?.publicMessage || (status >= 500 ? 'GMT portal service is temporarily unavailable' : (error.message || 'Request failed'));
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
  verifyPrivateWorkbookDestination,
  normaliseInput,
  validatePortalRequestMutation,
  validatePortalRequestDeletion,
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
  readSharePointHistory,
  historyRecordFingerprint,
  listRecords,
  projectRow,
  canViewAllRecords,
  canViewRecord,
  canAccessRecord,
  canReadHistoryRecord,
  upstreamHistoryScope,
  authenticateToken,
  readBoundedJson,
  tokenIdentity,
  profileView,
  getProfileSettings,
  saveProfileSettings,
  xeroSettings,
  xeroOAuthStateMatches,
  xeroInvoiceProjection,
  xeroInvoicePayload,
  xeroInvoiceRecords,
  xeroInvoiceDeliveryStatus,
  xeroInvoicePaymentStatus,
  xeroInvoiceMutationPolicy,
  xeroAccountingRequest,
  listXeroInvoices,
  lookupXeroInvoice,
  canonicalEstimateInput,
  correlateEstimateRecords,
  upsertEstimateIndex,
  listEstimateIndex,
  encryptXeroSecret,
  decryptXeroSecret
};
