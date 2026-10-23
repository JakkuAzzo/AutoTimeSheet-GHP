import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trainingPage = readFileSync(resolve(repoRoot, 'training/index.html'), 'utf8');
const recorder = readFileSync(resolve(repoRoot, 'tools/record-staff-walkthrough.mjs'), 'utf8');

const expected = [
  { key: 'portal-profile', route: '/portal/account.html', video: 'gmt-training-portal-profile.mp4', poster: 'portal-profile.png' },
  { key: 'clock-record', route: '/portal/', video: 'gmt-training-clock-record.mp4', poster: 'clock-record.png' },
  { key: 'weekly-timesheet', route: '/timesheets/create.html', video: 'gmt-training-weekly-timesheet.mp4', poster: 'weekly-timesheet.png' },
  { key: 'job-card', route: '/jobs/', video: 'gmt-training-job-card.mp4', poster: 'job-card.png' },
  { key: 'task-request', route: '/tasks/', video: 'gmt-training-task-request.mp4', poster: 'task-request.png' },
  { key: 'calendar-request', route: '/portal/', video: 'gmt-training-calendar-request.mp4', poster: 'calendar-request.png' },
  { key: 'timesheet-audit', route: '/audit/', video: 'gmt-training-timesheet-audit.mp4', poster: 'timesheet-audit.png' },
];

const cards = [...trainingPage.matchAll(/<article\b[^>]*class="training-video-card"[^>]*>[\s\S]*?<\/article>/g)];
assert.equal(cards.length, expected.length, 'training page must contain all seven walkthroughs');

for (const item of expected) {
  const card = cards.map((match) => match[0]).find((value) => value.includes(`data-training-key="${item.key}"`));
  assert.ok(card, `training card ${item.key} must be listed`);
  assert.match(card, /data-training-audience="all-staff"/, `${item.key} audience must be explicit`);
  assert.match(card, new RegExp(`poster="media/${item.poster}"`), `${item.key} poster must resolve`);
  assert.match(card, new RegExp(`<source src="media/${item.video}" type="video/mp4">`), `${item.key} MP4 must resolve`);
  assert.match(card, /<video\b[^>]*controls\b/, `${item.key} video must expose playback controls`);
  assert.match(card, /<details\b[^>]*class="training-transcript"[\s\S]*?<\/details>/, `${item.key} must provide an accessible transcript`);

  const videoPath = resolve(repoRoot, 'training/media', item.video);
  const posterPath = resolve(repoRoot, 'training/media', item.poster);
  assert.ok(existsSync(videoPath) && statSync(videoPath).size > 1024, `${item.video} must be a non-empty video asset`);
  assert.ok(existsSync(posterPath) && statSync(posterPath).size > 1024, `${item.poster} must be a non-empty poster asset`);

  const sectionStart = recorder.indexOf(`'${item.key}': {`);
  assert.notEqual(sectionStart, -1, `${item.key} must have a recorder walkthrough`);
  const nextSection = expected
    .slice(expected.findIndex((entry) => entry.key === item.key) + 1)
    .map((entry) => recorder.indexOf(`'${entry.key}': {`, sectionStart + 1))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  const section = recorder.slice(sectionStart, nextSection === undefined ? recorder.indexOf('\n};', sectionStart) : nextSection);
  const route = section.match(/\bpath:\s*'([^']+)'/);
  assert.equal(route?.[1], item.route, `${item.key} recorder route must match the current workflow`);

  const routeFile = item.route.endsWith('/') ? `${item.route}index.html` : item.route;
  assert.ok(existsSync(resolve(repoRoot, `.${routeFile}`)), `${item.key} route ${item.route} must exist in this checkout`);
}

assert.match(trainingPage, /<script defer src="\.\.\/auth\.js[^"]*"><\/script>/, 'training page must use the shared GMT sign-in gate');
assert.match(trainingPage, /<main[^>]*hidden/, 'training content must remain hidden until the shared sign-in gate reveals it');
assert.doesNotMatch(trainingPage, /data-admin-users-link|users\.html/i, 'admin-only user management must not be shown as staff training');

const weeklyPage = readFileSync(resolve(repoRoot, 'timesheets/create.html'), 'utf8');
assert.match(weeklyPage, /href="\.\.\/audit\/index\.html"/, 'the shared staff workflow must expose timesheet analysis to signed-in staff');
const dashboardPage = readFileSync(resolve(repoRoot, 'portal/index.html'), 'utf8');
const dashboardAccess = readFileSync(resolve(repoRoot, 'portal/dashboard-updates.js'), 'utf8');
assert.match(dashboardPage, /data-admin-users-link hidden/, 'admin-only user management must start hidden');
assert.match(dashboardAccess, /access && access\.isAdmin/, 'admin-only user management must depend on the protected Accounts role response');

console.log(`Training asset contract passed for ${expected.length} walkthroughs.`);
