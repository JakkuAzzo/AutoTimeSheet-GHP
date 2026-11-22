import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { startSyntheticPortalServer } from '../tools/synthetic-portal-server.mjs';

const request = (port, requestPath, options = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: requestPath,
    method: options.method || 'GET', headers: { host: options.host || `localhost:${port}`, ...(options.headers || {}) } }, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
  });
  req.on('error', reject);
  req.end();
});

test('the prepared submission page and its test configuration carry the same restrictions', async () => {
  const build = JSON.parse(execFileSync(process.execPath,
    ['tools/prepare-synthetic-portal.mjs', '--build-only'], { encoding: 'utf8' }));
  const server = await startSyntheticPortalServer(path.join(build.directory, 'site'), 0);
  const port = server.address().port;
  try {
    const page = await request(port, '/portal/submissions.html');
    const config = await request(port, '/config.js');
    assert.equal(page.status, 200);
    assert.match(page.body, /Submitted documents/);
    assert.equal(config.status, 200);
    assert.match(config.body, /gmt-timesheet-portal-e2e-20261116\.raspy-breeze-e230\.workers\.dev/);
    assert.doesNotMatch(config.body, /formsubmit\.co|gmt-portal-api|environment\.api\.powerplatform/);
    assert.equal(page.headers['content-security-policy'], config.headers['content-security-policy']);
    assert.equal((await request(port, '/api/records', { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(build.directory, { recursive: true, force: true });
  }
});

test('the local test server restricts destinations, methods, hosts and files', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmt-isolated-server-test-'));
  const root = path.join(temp, 'site');
  fs.mkdirSync(path.join(root, 'portal'), { recursive: true });
  fs.writeFileSync(path.join(root, 'portal', 'index.html'), '<!doctype html><title>fictional test</title>');
  fs.writeFileSync(path.join(temp, 'private.txt'), 'outside the test root');
  fs.symlinkSync(path.join(temp, 'private.txt'), path.join(root, 'leak.txt'));
  const server = await startSyntheticPortalServer(root, 0);
  const port = server.address().port;
  try {
    const page = await request(port, '/portal/');
    assert.equal(page.status, 200);
    assert.match(page.body, /fictional test/);
    const csp = page.headers['content-security-policy'];
    assert.match(csp, /connect-src 'self' https:\/\/login\.microsoftonline\.com https:\/\/gmt-timesheet-portal-e2e-20261116\.raspy-breeze-e230\.workers\.dev/);
    assert.match(csp, /script-src 'self'(?:;|$)/);
    assert.doesNotMatch(csp, /cdn\.jsdelivr\.net/);
    assert.doesNotMatch(csp, /formsubmit\.co|gmt-portal-api|environment\.api\.powerplatform/);
    assert.match(csp, /form-action 'self' https:\/\/login\.microsoftonline\.com/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal((await request(port, '/portal/', { method: 'POST' })).status, 405);
    assert.equal((await request(port, '/portal/', { host: 'example.invalid' })).status, 421);
    assert.equal((await request(port, '/%2e%2e/private.txt')).status, 404);
    assert.equal((await request(port, '/leak.txt')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('a test window handshake is accepted only for the configured random token', async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gmt-isolated-handshake-test-')),token='a'.repeat(64);
  const server=await startSyntheticPortalServer(temp,0,{handshake:token}),port=server.address().port;
  try {
    assert.equal((await request(port,'/__gmt_test_handshake')).status,403);
    assert.equal((await request(port,'/__gmt_test_handshake',{headers:{'X-GMT-Test-Handshake':'b'.repeat(64)}})).status,403);
    const valid=await request(port,'/__gmt_test_handshake',{headers:{'X-GMT-Test-Handshake':token}});
    assert.equal(valid.status,200);assert.equal(valid.body,'GMT-FICTIONAL-TEST:'+token);
    assert.equal((await request(port,'/__gmt_test_handshake',{method:'POST',headers:{'X-GMT-Test-Handshake':token}})).status,405);
    assert.equal((await request(port,'/__gmt_test_handshake',{host:'example.invalid',headers:{'X-GMT-Test-Handshake':token}})).status,421);
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
});
