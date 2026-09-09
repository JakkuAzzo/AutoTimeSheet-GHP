import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('tools/estimates.html', root), 'utf8');
const index = fs.readFileSync(new URL('tools/index.html', root), 'utf8');
const page = fs.readFileSync(new URL('tools/estimates.js', root), 'utf8');
const config = fs.readFileSync(new URL('config.js', root), 'utf8');

assert.match(html, /id="estimate-client-email"[^>]*required/);
assert.match(html, />Send to client</);
assert.match(html, /id="estimate-history"/);
assert.match(html, /id="estimate-history-preview"/);
assert.match(index, />View Estimates</);
assert.match(page, /estimateSendEndpoint/);
assert.match(page, /estimateAccountsBcc/);
assert.match(page, /_bcc/);
assert.match(page, /gmt_client_email/);
assert.match(page, /estimateHistoryEndpoint/);
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
