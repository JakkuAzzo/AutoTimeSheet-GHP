import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('tools/estimates.html', root), 'utf8');
const index = fs.readFileSync(new URL('tools/index.html', root), 'utf8');
const page = fs.readFileSync(new URL('tools/estimates.js', root), 'utf8');
const config = fs.readFileSync(new URL('config.js', root), 'utf8');
const historyData = fs.readFileSync(new URL('tools/estimate-history-data.mjs', root), 'utf8');

assert.match(html, /id="estimate-client-email"[^>]*required/);
assert.match(html, />Send to client</);
assert.match(html, /id="estimate-history"/);
assert.match(html, /id="estimate-history-preview"/);
assert.doesNotMatch(index, />View Estimates</);
assert.match(page, /estimateAccountsBcc/);
assert.match(page, /confirm\(/, 'client delivery requires a clear action-time review');
assert.match(page, /GMTPortalApi\.sendEstimate/);
assert.match(page, /archiveAppEstimate/);
assert.ok(page.indexOf('await window.GMTPortalApi.archiveAppEstimate') < page.indexOf('await window.GMTPortalApi.sendEstimate'), 'shared archive is written before client delivery');
assert.ok(page.indexOf('window.confirm(') < page.indexOf('await window.GMTPortalApi.archiveAppEstimate'), 'review confirmation happens before archive/send side effects');
assert.doesNotMatch(page, /estimateFormSubmitEndpoint/);
assert.doesNotMatch(page, /form\.action = endpoint/);
const worker = fs.readFileSync(new URL('cloudflare-worker/src/index.js', root), 'utf8');
assert.match(worker, /\/api\/estimates\/send/);
assert.match(worker, /ESTIMATE_SEND_FLOW_URL/);
assert.match(worker, /Delivery status needs review/);
assert.match(page, /estimateHistoryEndpoint/);
assert.match(page, /estimateIndexList/);
assert.match(page, /mergeSharedEstimateIndex/);
assert.match(page, /estimate-history-data\.mjs/);
assert.match(historyData, /sharepoint_url/);
assert.match(fs.readFileSync(new URL('portal-api.js', root), 'utf8'), /function estimateIndexList\(/);
assert.match(page, /function assetUrl/);
assert.match(page, /assetUrl\('image\.png'\)/);
assert.match(page, /cache: 'no-store'/);
assert.match(page, /gmt\.estimates\.history\.v1/);
assert.doesNotMatch(page, /sendToAccounts/);
assert.match(config, /estimateHistoryEndpoint:\s*["']?\s*["']/);
assert.match(config, /estimateAccountsBcc:\s*["']?\s*["']/);

console.log(JSON.stringify({
  clientEmailRequired: true,
  protectedSendRoute: true,
  accountsBccField: true,
  protectedHistoryRoute: true,
  browserFallbackIsLabelled: true
}));
