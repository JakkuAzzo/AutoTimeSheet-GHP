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
  const offsiteClockPage = fs.readFileSync(path.join(output, 'portal', 'offsite-clock.html'), 'utf8');
  const notFoundPage = fs.readFileSync(path.join(output, '404.html'), 'utf8');

  assert.match(notFoundPage, /Page not found/i);
  assert.match(notFoundPage, /href="\/"/);
  assert.doesNotMatch(notFoundPage, /href="\/portal\/"/);
  assert.match(notFoundPage, /name="robots" content="noindex"/);
  const staffNotFoundPage = fs.readFileSync(path.join(output, 'portal', '404.html'), 'utf8');
  assert.match(staffNotFoundPage, /href="\/"/);
  assert.match(staffNotFoundPage, /href="\/portal\/"[^>]*hidden/);
  assert.match(staffNotFoundPage, /404-auth\.js/);

  assert.match(publicRoot, /<title>GMT Electrical Services \| Motor, Pump, Fan &amp; Gearbox Repairs Croydon<\/title>/);
  assert.match(publicRoot, /public-site\.css/);
  assert.doesNotMatch(publicRoot, /<title>GMT Staff Portal/);
  assert.doesNotMatch(publicRoot, /portal\/auth\.js|\.\/auth\.js/);

  assert.match(portalRoot, /<title>GMT Dashboard/);
  assert.match(portalRoot, /auth\.js\?v=/);
  assert.ok(fs.existsSync(path.join(output, 'calendar-actions.js')));
  assert.equal(fs.existsSync(path.join(output, 'portal', 'timesheets.html')), false, 'the obsolete portal timesheet editor should not be published');
  assert.equal(fs.existsSync(path.join(output, 'timesheets.html')), false, 'the obsolete flat timesheet editor should not be published');
  const redirects = fs.readFileSync(path.join(output, '_redirects'), 'utf8');
  assert.match(redirects, /^\/portal\/timesheets \/portal\/submissions 301$/m);
  assert.match(redirects, /^\/portal\/timesheets\.html \/portal\/submissions 301$/m);
  assert.match(redirects, /^\/timesheets\.html \/portal\/submissions 301$/m);
  assert.ok(fs.existsSync(path.join(output, 'public-site-mapfix-20260928.js')));
  assert.ok(fs.existsSync(path.join(output, 'assets', 'website', 'workshop', 'pump-repair.jpg')));
  assert.ok(fs.existsSync(path.join(output, 'reviews', 'index.html')));
  assert.ok(fs.existsSync(path.join(output, 'pay-periods.js')));
  assert.ok(fs.existsSync(path.join(output, 'responsive-tables.js')));
  assert.ok(fs.existsSync(path.join(output, 'responsive-tables.css')));
  assert.match(portalRoot, /responsive-tables\.js\?v=/);
  assert.match(portalRoot, /responsive-tables\.css\?v=/);
  assert.match(portalRoot, /href="offsite-clock\.html"/);
  assert.match(offsiteClockPage, /offsite-clock\.js\?v=/);
  assert.ok(fs.existsSync(path.join(output, 'portal', 'offsite-clock.js')));
  assert.ok(fs.existsSync(path.join(output, 'portal', 'offsite-clock.css')));
  assert.ok(fs.existsSync(path.join(output, 'timesheet-clock-transport.js')));
  assert.ok(fs.existsSync(path.join(output, 'timesheet-row-policy.js')));
  assert.ok(!fs.existsSync(path.join(output, 'calendar', 'index.html')));
  assert.match(redirects, /\/calendar\/\* \/portal\/submissions 301/);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

console.log('Cloudflare Pages public-root boundary: PASS');
