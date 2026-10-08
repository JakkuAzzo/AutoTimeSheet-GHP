import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const calls = [];
const tokenRequests = [];
const browserWindow = {
  GMT_APP_CONFIG: {
    portalApiEndpoint: 'https://worker.example.test', portalApiScopes: ['api://gmt/access'],
    estimateSendScopes: ['https://service.flow.microsoft.com//.default']
  },
  GMT_PORTAL_AUTH: { async acquireToken(scopes) {
    tokenRequests.push(scopes);
    return scopes[0] === 'https://service.flow.microsoft.com//.default' ? 'signed-flow-token' : 'signed-portal-token';
  } },
  setTimeout
};
browserWindow.parent = browserWindow;
globalThis.window = browserWindow;
let downloaded = false;
globalThis.document = {
  body: { appendChild() {} },
  createElement() { return { click() { downloaded = true; }, remove() {} }; }
};
const createdObjectUrls = [];
URL.createObjectURL = () => { const value = 'blob:archive-test'; createdObjectUrls.push(value); return value; };
URL.revokeObjectURL = (value) => { assert.equal(value, 'blob:archive-test'); };
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (String(url).includes('/content/')) return new Response(new Uint8Array([1, 2, 3]), {
    status: 200, headers: { 'content-disposition': 'attachment; filename="estimate.pdf"', 'content-type': 'application/pdf' }
  });
  if (String(url).endsWith('/api/archive/estimates')) return Response.json({ records: [], nextCursor: null, indexState: 'ready' });
  if (String(url).endsWith('/api/archive/estimates/app')) return Response.json({ ok: true, id: 'app-1' }, { status: 201 });
  if (String(url).endsWith('/api/estimates/send')) return Response.json({ ok: true, status: 'Sent to client', sent_at: '2026-10-06T12:00:00.000Z' });
  return Response.json({ message: { id: 'message-1' }, conversation: [], attachments: [], associations: [] });
};

await import('../portal-api.js');
const api = window.GMTPortalApi;
assert.equal(typeof api.searchEstimateArchive, 'function');
assert.equal(typeof api.getEstimateArchiveRecord, 'function');
assert.equal(typeof api.getEstimateArchiveContent, 'function');
assert.equal(typeof api.archiveAppEstimate, 'function');
await api.searchEstimateArchive({ q: 'pump', from: '2025-01-01', limit: 50, cursor: 'opaque-cursor' });
assert.match(calls.at(-1).url, /q=pump/);
assert.match(calls.at(-1).url, /from=2025-01-01/);
assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer signed-portal-token');
await api.getEstimateArchiveRecord('message-1');
assert.match(calls.at(-1).url, /\/api\/archive\/estimates\/message-1$/);
await api.archiveAppEstimate({ estimate_number: 'EST-1', contentBase64: 'eA==' });
assert.equal(JSON.parse(calls.at(-1).options.body).estimate_number, 'EST-1');
await api.sendEstimate({ recordId: 'estimate-test-1', to: 'client@example.com' });
assert.match(calls.at(-1).url, /\/api\/estimates\/send$/);
assert.equal(JSON.parse(calls.at(-1).options.body).to, 'client@example.com');
assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer signed-portal-token');
assert.equal(calls.at(-1).options.headers['X-GMT-Upstream-Authorization'], 'Bearer signed-flow-token', 'estimate sending separately acquires and forwards the Flow Service token');
assert.deepEqual(tokenRequests.at(-1), ['https://service.flow.microsoft.com//.default']);
await api.getEstimateArchiveContent('message-1', 'attachment-1', 'estimate.pdf');
assert.match(calls.at(-1).url, /\/api\/archive\/estimates\/message-1\/content\/attachment-1$/);
assert.equal(downloaded, true, 'archive content is downloaded through the authenticated portal request');
assert.deepEqual(createdObjectUrls, ['blob:archive-test']);
const conversationBody = await api.fetchEstimateArchiveContent('message-1', 'eml');
assert.equal(typeof conversationBody.text, 'function', 'conversation email content can be fetched without forcing a download');
assert.match(calls.at(-1).url, /\/api\/archive\/estimates\/message-1\/content\/eml$/);
assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer signed-portal-token');

const html = await readFile(new URL('../tools/estimates.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../tools/estimates.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../tools/estimates.css', import.meta.url), 'utf8');
for (const id of ['estimate-archive-search', 'estimate-archive-query', 'estimate-archive-from', 'estimate-archive-to', 'estimate-archive-results', 'estimate-archive-detail', 'estimate-archive-more', 'estimate-conversation-dialog', 'estimate-conversation-messages', 'estimate-conversation-message-body']) {
  assert.ok(html.includes(`id="${id}"`), `Estimates UI contains ${id}`);
}
assert.doesNotMatch(html, /id="estimate-archive-from"[^>]*disabled/, 'From date is directly editable');
assert.doesNotMatch(html, /id="estimate-archive-to"[^>]*disabled/, 'To date is directly editable');
assert.doesNotMatch(html, /id="estimate-archive-range"/, 'date range inputs do not depend on the removed range selector');
assert.match(script, /nextCursor/);
assert.match(script, /Email conversation/);
assert.match(script, /View conversation/);
assert.match(script, /showModal\(\)/, 'the conversation control opens an accessible browser dialog');
assert.match(script, /fetchEstimateArchiveContent/, 'conversation messages can be fetched for browser preview');
assert.match(script, /Download attachment/);
assert.match(script, /message\.source_kind === 'email'/, 'app-created document rows do not offer a missing EML download');
assert.match(css, /estimate-archive-layout/);
console.log('Estimate archive authenticated UI contract: PASS');
