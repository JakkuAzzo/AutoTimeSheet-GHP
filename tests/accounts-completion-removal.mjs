import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

for (const pageName of ['submissions', 'timesheets']) {
  const pagePath = path.join(root, 'portal', `${pageName}.html`);
  const scriptPath = path.join(root, 'portal', `${pageName}.js`);
  const page = fs.readFileSync(pagePath, 'utf8');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.doesNotMatch(page, /Accounts completion|Current pay-month status|Employee timesheet coverage|timesheet-completion|submissions-admin-timesheet-summary/i);
  assert.doesNotMatch(script, /renderCompletion|renderAdminTimesheetSummary|timesheet-completion|submissions-admin-timesheet-summary/);

  for (const match of page.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"?#]+)[^\"]*"/g)) {
    if (/^(?:https?:|data:)/.test(match[1])) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(pagePath), match[1])), `${pageName} is missing ${match[1]}`);
  }
}

assert.match(fs.readFileSync(path.join(root, 'portal', 'submissions.html'), 'utf8'), /pay-month-workspace/);
assert.match(fs.readFileSync(path.join(root, 'portal', 'timesheets.html'), 'utf8'), /timesheet-calendar-grid/);
