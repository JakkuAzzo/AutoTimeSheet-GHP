import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync(new URL('../calendar/calendar-view.js', import.meta.url), 'utf8');
const portal = fs.readFileSync(new URL('../portal.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../calendar/index.html', import.meta.url), 'utf8');
const shared = fs.readFileSync(new URL('../shared-data.js', import.meta.url), 'utf8');

assert.equal(view.includes('localStorage'), false, 'shared calendar view must not read browser-local events');
assert.match(view, /publishedEvents\.filter/);
assert.match(view, /No local requests are published here/);
assert.match(portal, /Calendar export is unavailable until the protected Microsoft 365 calendar feed is connected/);
assert.match(page, /disabled title="Available after protected Microsoft 365 calendar publication is connected"/);
assert.doesNotMatch(shared, /download-events-json/);
assert.match(shared, /Calendar requests are not exportable from browser storage/);

console.log('Calendar protected-boundary checks: PASS');
