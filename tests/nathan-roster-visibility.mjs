import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectRow, staffDirectory } from '../cloudflare-worker/src/index.js';

const config = readFileSync(new URL('../cloudflare-worker/wrangler.toml', import.meta.url), 'utf8');
const match = config.match(/^STAFF_DIRECTORY_JSON = '(.*)'$/m);
assert.ok(match, 'Worker roster must be configured');
const env = { STAFF_DIRECTORY_JSON: match[1] };
const nathan = staffDirectory(env).find((entry) => entry.upn === 'nathanbrown-bennett@gmt-services.co.uk');
assert.ok(nathan, 'Nathan must be included in the approved employee roster');
assert.deepEqual(nathan.workdays, [1, 2, 3, 4, 5], 'Nathan follows the standard Monday-Friday schedule');

const record = projectRow({
  record_id: 'nathan-paymonth-test', owner_oid: 'nathan-oid',
  owner_upn: 'nathanbrown-bennett@gmt-services.co.uk', employee_name: 'Nathan Brown-Bennett',
  kind: 'timesheets', action: 'submission', status: 'Submitted',
  start_date: '2026-08-24', end_date: '2026-08-26', record_date: '2026-08-24',
  payload_json: JSON.stringify({ rows: [{ date: '2026-08-24', absence: 'Holiday' }] })
}, true, env);
assert.equal(record.synthetic, false, 'Nathan’s real submission must appear in ordinary protected history');
assert.deepEqual(record.schedule_weekdays, [1, 2, 3, 4, 5]);

console.log('Nathan roster visibility regression passed.');
