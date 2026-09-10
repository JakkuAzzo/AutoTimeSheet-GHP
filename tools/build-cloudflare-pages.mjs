import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || '/tmp/gmt-pages-final-20260910');
const workerUrl = String(process.env.GMT_WORKER_URL || '').trim().replace(/\/$/, '');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

function copy(relativePath, destination = relativePath) {
  const source = path.join(repo, relativePath);
  const target = path.join(output, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function copyText(relativePath, destination, transform) {
  const source = path.join(repo, relativePath);
  const target = path.join(output, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let contents = fs.readFileSync(source, 'utf8');
  contents = transform(contents);
  fs.writeFileSync(target, contents);
}

// Keep the original portal routes available for existing bookmarks and also
// publish a flat Pages root so the Cloudflare project works at its root URL.
copy('portal');
for (const directory of ['timesheets', 'jobs', 'tasks', 'calendar', 'tools', 'training', 'audit']) copy(directory);
fs.rmSync(path.join(output, 'tools', 'build-cloudflare-pages.mjs'), { force: true });

for (const file of [
  'styles.css', 'portal.css', 'analytics.js', 'add-logo.js', 'favicon.svg',
  'image.png', 'image.webp', 'lazy-xlsx.js', 'portal-api.js', 'portal.js',
  'script.js', 'timesheet-clock.js', 'timesheet-input-fix.js',
  'timesheet-mobile-fixes.js', 'timesheet-preflight.js', 'timesheet-status-labels.js'
]) copy(file);
copy('portal/profile.js', 'profile.js');
copy('assets/brand/gmt-icon-256.png');

const rootTransform = (contents) => contents
  .replaceAll('../portal/auth.js', './auth.js')
  .replaceAll('../portal-api.js', './portal-api.js')
  .replaceAll('../styles.css', './styles.css')
  .replaceAll('../portal.css', './portal.css')
  .replaceAll('../config.js', './config.js')
  .replaceAll('../analytics.js', './analytics.js')
  .replaceAll('../image.webp', './image.webp')
  .replaceAll('../image.png', './image.png')
  .replaceAll('../assets/', './assets/')
  .replaceAll('../timesheets/', './timesheets/')
  .replaceAll('../jobs/', './jobs/')
  .replaceAll('../tools/', './tools/')
  .replaceAll('../tasks/', './tasks/')
  .replaceAll('../calendar/', './calendar/')
  .replaceAll('../training/', './training/')
  .replaceAll('../', './');

copyText('portal/index.html', 'index.html', rootTransform);
copyText('portal/account.html', 'account.html', rootTransform);
copyText('portal/timesheets.html', 'timesheets.html', (contents) => rootTransform(contents)
  .replace('src="./history-frame.html', 'src="history-frame.html')
  .replace('href="./timesheets/"', 'href="timesheets/"'));
copyText('portal/history-frame.html', 'history-frame.html', rootTransform);

// These scripts are loaded by the flat history page and need the same root
// relative paths as the bundled HTML.
copy('portal/timesheets.js', 'timesheets.js');
copy('portal/history-frame.js', 'history-frame.js');
copy('portal/calendar-preview.js', 'calendar-preview.js');
copy('portal/auth.js', 'auth.js');

// Feature pages live one directory below the flat root. Their auth script is
// kept in /auth.js while their other ../ references already resolve correctly.
for (const file of [
  'timesheets/index.html', 'timesheets/create.html', 'jobs/index.html',
  'tasks/index.html', 'calendar/index.html', 'tools/index.html',
  'tools/estimates.html', 'training/index.html'
]) {
  const target = path.join(output, file);
  let contents = fs.readFileSync(target, 'utf8');
  contents = contents.replaceAll('../portal/auth.js', '../auth.js');
  fs.writeFileSync(target, contents);
}

// Cloudflare's Pages host needs the custom-domain path rules as well as the
// protected Worker origin. The worker URL is injected only at deployment
// time; local builds remain API-disabled by default.
copyText('config.js', 'config.js', (contents) => {
  let result = contents
    .replace(/\/\(\^\|\\\.\)gmt-services\\\.co\\\.uk\$\/i\.test\(window\.location\.hostname\)/,
      '/(^|\\.)gmt-services\\.co\\.uk$/i.test(window.location.hostname) || /(^|\\.)gmt-timesheets\\.pages\\.dev$/i.test(window.location.hostname)')
    .replace(/redirectPath:\s*\/\(\^\|\\\.\)gmt-services\\\.co\\\.uk\$\/i\.test\(window\.location\.hostname\)\s*\?\s*"\/portal\/"\s*:\s*"\/AutoTimeSheet-GHP\/portal\/"/, 'redirectPath: GMT_SITE_BASE_PATH + "/portal/"');
  if (workerUrl) {
    result = result.replace(/portalApiEndpoint:\s*"[^"]*"/, `portalApiEndpoint: ${JSON.stringify(workerUrl)}`);
    result = result.replace(/portalHistoryEndpoint:\s*"[^"]*"/, `portalHistoryEndpoint: ${JSON.stringify(workerUrl + '/api/history')}`);
  }
  return result;
});

fs.writeFileSync(path.join(output, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n\n/portal/*\n  Cache-Control: no-store\n\n/timesheets/*\n  Cache-Control: no-store\n\n/tools/*\n  Cache-Control: no-store\n\n/jobs/*\n  Cache-Control: no-store\n\n/tasks/*\n  Cache-Control: no-store\n\n/calendar/*\n  Cache-Control: no-store\n*/\n`);
console.log(JSON.stringify({ output, workerUrl: workerUrl || null, files: fs.readdirSync(output).length }));
