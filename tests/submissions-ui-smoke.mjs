import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = readFileSync(resolve(root, 'portal/submissions.html'), 'utf8');
const scripts = readFileSync(resolve(root, 'portal/submissions.js'), 'utf8');
const workbook = readFileSync(resolve(root, 'portal/pay-month-workbook.js'), 'utf8');

assert.match(html, /class="pay-month-filters"/, 'pay-month and staff filters belong to the combined records workspace');
assert.match(html, /id="submissions-pay-month"/);
assert.match(html, /id="submissions-employee"/);
assert.match(html, /id="submissions-day"[^>]*type="date"/, 'the pay-month workspace has a day filter');
assert.match(html, /class="pay-month-layout"/, 'the pay-month list and selected-sheet preview share one workspace');
assert.match(html, /data-submission-tab="enquiries"/);
assert.match(html, /data-submission-tab="job-cards"/);
assert.match(html, /data-submission-tab="tasks"/);
assert.match(html, /data-submission-tab="estimates"/);
assert.match(html, /data-submission-tab="invoices"/);
assert.doesNotMatch(html, /submissions-admin-timesheet-summary/, 'the removed completion dashboard must not return');
assert.match(scripts, /data-pay-month-download/, 'selected pay-month sheets can be downloaded');
assert.match(html, /data-download-all-sheets/, 'the pay-month list has a bulk-download control');
assert.match(scripts, /GMTZipStore/, 'bulk downloads are packaged as a ZIP');
assert.match(scripts, /Current - /, 'current pay month labels are readable');
assert.match(scripts, /submissions-day/, 'day filter changes the visible records and sheet preview');
assert.doesNotMatch(scripts, /plus labelled examples|Labelled examples are shown below/, 'the records status does not advertise demo data');
assert.doesNotMatch(scripts, /demo-job-card|demo-estimate|demo-task|withExamples\(/, 'the submitted-history view does not append demonstration records');
assert.match(scripts, /sheet\.rows\.forEach\(function \(item, index\)/, 'filtered sheet edits recalculate the full pay-month total');
assert.match(html, /Correction delivery status/);
assert.doesNotMatch(html, /Retry queued corrections/);
assert.match(html, /submissions-delivery-dialog/, 'delivery details open in a dialog');
assert.match(workbook, /absence\)\) return 480/, 'paid holiday rows count as eight hours');

console.log('PASS: Submitted Documents keeps the pay-month workspace, filters, downloads, and correction delivery guidance.');
