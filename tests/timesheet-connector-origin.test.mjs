import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-worker/src/index.js';

const env = {
  DB: {},
  TIMESHEET_PRIVATE_ROUTE_RESOLVER_ENABLED: 'true',
  TIMESHEET_DELIVERY_CALLBACK_KEY: 'a'.repeat(48),
  TIMESHEET_CONNECTOR_ORIGIN: 'https://make.powerautomate.com',
  ALLOWED_ORIGINS: 'https://gmt-services.co.uk'
};
const request = (path, origin, method = 'POST') => new Request(`https://test.invalid${path}`, {
  method,
  headers: { origin, 'content-type': 'application/json', 'X-GMT-Delivery-Key': 'wrong-key' },
  ...(method === 'POST' ? { body: '{}' } : {})
});

test('connector origin reaches only authenticated delivery endpoints without browser CORS', async () => {
  for (const path of ['/api/integrations/private-timesheet-route', '/api/integrations/timesheet-delivery-receipts']) {
    const response = await worker.fetch(request(path, 'https://make.powerautomate.com'), env, {});
    assert.equal(response.status, 401, `${path} must still require the delivery key`);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await worker.fetch(request(path, 'https://untrusted.invalid'), env, {})).status, 403);
    assert.equal((await worker.fetch(request(path, 'https://make.powerautomate.com', 'OPTIONS'), env, {})).status, 403);
  }
  assert.equal((await worker.fetch(request('/api/health', 'https://make.powerautomate.com', 'GET'), env, {})).status, 403);
  assert.equal((await worker.fetch(request('/api/integrations/private-timesheet-route', 'https://make.powerautomate.com'), {...env, TIMESHEET_CONNECTOR_ORIGIN: ''}, {})).status, 403);
});
