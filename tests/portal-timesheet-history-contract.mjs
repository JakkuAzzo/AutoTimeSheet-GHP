import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const contract = JSON.parse(fs.readFileSync(new URL('../power-platform/portal-timesheet-history-contract.json', import.meta.url)));
const config = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../portal/timesheets.html', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../portal/timesheets.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../portal/auth.js', import.meta.url), 'utf8');

assert.equal(contract.securityModel, 'server-enforced Entra identity mapping');
assert.equal(contract.visibility.ordinaryEmployees, 'own records only');
assert.equal(contract.visibility.rawWorkbookLinks, false);
assert.match(html, /My completed timesheets/);
assert.match(html, /timesheet-history-refresh/);
assert.match(page, /cache:\s*["']no-store["']/);
assert.match(page, /credentials:\s*["']include["']/);
assert.match(page, /Authorization/);
assert.match(page, /No records are displayed until the protected history service responds/);
assert.match(auth, /window\.GMT_PORTAL_AUTH/);
assert.match(auth, /window\.GMT_PORTAL_AUTH_READY/);
assert.match(auth, /acquireTokenSilent/);
assert.match(config, /timesheetHistoryEndpoint:\s*["']?["']/);
assert.doesNotMatch(page, /sharepoint\.com/i, 'the browser must not call SharePoint directly');

function makeElement() {
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; }
  };
}

async function runPage({ endpoint, scopes = [], response }) {
  const elements = {
    'timesheet-history-status': makeElement(),
    'timesheet-history-link': makeElement(),
    'timesheet-history-list': makeElement(),
    'timesheet-history-refresh': makeElement()
  };
  let domReady;
  let request;
  const context = {
    window: {
      GMT_APP_CONFIG: { timesheetHistoryEndpoint: endpoint, timesheetHistoryScopes: scopes },
      GMT_PORTAL_AUTH: { acquireToken: async requested => {
        assert.deepEqual(requested, scopes);
        return 'test-access-token';
      } }
    },
    document: {
      getElementById(id) { return elements[id]; },
      addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady = callback; }
    },
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => response };
    }
  };
  vm.runInNewContext(page, context, { filename: 'portal/timesheets.js' });
  await domReady();
  return { elements, request };
}

const successful = await runPage({
  endpoint: '/api/history',
  scopes: ['api://gmt-history/History.Read'],
  response: {
    records: [{
      employee_name: '<employee>',
      start_date: '2026-09-01',
      end_date: '2026-09-07',
      status: 'Completed',
      submitted_at: '2026-09-08T10:00:00Z',
      updated_at: '2026-09-08T10:05:00Z',
      issue: '<review>',
      source_record_id: 'record-1',
      raw_workbook_link: 'must-not-render'
    }]
  }
});
assert.equal(successful.request.url, '/api/history');
assert.equal(successful.request.options.cache, 'no-store');
assert.equal(successful.request.options.credentials, 'include');
assert.equal(successful.request.options.headers.Authorization, 'Bearer test-access-token');
assert.match(successful.elements['timesheet-history-list'].innerHTML, /&lt;employee&gt;/);
assert.doesNotMatch(successful.elements['timesheet-history-list'].innerHTML, /must-not-render/);
assert.match(successful.elements['timesheet-history-status'].textContent, /1 completed timesheet/);

const notConfigured = await runPage({ endpoint: '', response: { records: [] } });
assert.equal(notConfigured.elements['timesheet-history-status'].textContent,
  'Your completed timesheets will appear here when the protected Microsoft 365 history connection is enabled.');
assert.match(notConfigured.elements['timesheet-history-list'].innerHTML, /securely unavailable/);

console.log(JSON.stringify({
  securityModel: contract.securityModel,
  employeeVisibility: contract.visibility.ordinaryEmployees,
  endpointConfigured: false,
  authenticatedRequest: true,
  projectionOnly: true,
  setupState: true
}));
