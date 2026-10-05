import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gmt-pages-public-root-'));

try {
  execFileSync(process.execPath, ['tools/build-cloudflare-pages.mjs', output], {
    cwd: repo,
    env: { ...process.env, GMT_WORKER_URL: 'https://example-worker.invalid' },
    stdio: 'pipe'
  });

  const publicRoot = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  const portalRoot = fs.readFileSync(path.join(output, 'portal', 'index.html'), 'utf8');

  assert.match(publicRoot, /<title>GMT Electrical Services \| Motor, Pump, Fan &amp; Gearbox Repairs Croydon<\/title>/);
  assert.match(publicRoot, /public-site\.css/);
  assert.doesNotMatch(publicRoot, /<title>GMT Staff Portal/);
  assert.doesNotMatch(publicRoot, /portal\/auth\.js|\.\/auth\.js/);

  assert.match(portalRoot, /<title>GMT Dashboard/);
  assert.match(portalRoot, /auth\.js\?v=/);
  assert.ok(fs.existsSync(path.join(output, 'calendar-actions.js')));
  const flatTimesheets = fs.readFileSync(path.join(output, 'timesheets.html'), 'utf8');
  assert.match(flatTimesheets, /calendar-actions\.js\?v=/);
  assert.ok(fs.existsSync(path.join(output, 'public-site-mapfix-20260928.js')));
  assert.ok(fs.existsSync(path.join(output, 'assets', 'website', 'workshop', 'pump-repair.jpg')));
  assert.ok(fs.existsSync(path.join(output, 'pay-periods.js')));
  assert.ok(fs.existsSync(path.join(output, 'timesheet-clock-transport.js')));
  assert.ok(fs.existsSync(path.join(output, 'timesheet-row-policy.js')));
  assert.ok(!fs.existsSync(path.join(output, 'calendar', 'index.html')));
  assert.match(fs.readFileSync(path.join(output, '_redirects'), 'utf8'), /\/calendar\/\* \/portal\/submissions 301/);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

console.log('Cloudflare Pages public-root boundary: PASS');
