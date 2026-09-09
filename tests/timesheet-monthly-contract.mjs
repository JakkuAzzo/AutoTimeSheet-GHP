import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const [contractText, weeklyScript, clockScript, upsertScript, filingContract, flowSpecText] = await Promise.all([
  readFile(join(repoRoot, 'power-platform/submission-envelope-contract.json'), 'utf8'),
  readFile(join(repoRoot, 'script.js'), 'utf8'),
  readFile(join(repoRoot, 'timesheet-clock.js'), 'utf8'),
  readFile(join(repoRoot, 'power-platform/office-scripts/upsert-monthly-timesheet-row.ts'), 'utf8'),
  readFile(join(repoRoot, 'docs/timesheet-monthly-filing-contract.md'), 'utf8'),
  readFile(join(repoRoot, 'power-platform/timesheet-monthly-upsert-flow-spec.json'), 'utf8')
]);

const contract = JSON.parse(contractText);
const flowSpec = JSON.parse(flowSpecText);
assert.ok(contract.timesheet.required.includes('gmt_workbook_key'));
assert.ok(contract.timesheet.required.includes('gmt_filing_mode'));
assert.equal(contract.timesheet.filingMode, 'monthly-upsert');
assert.equal(contract.timesheet.dedupeKey, 'gmt_record_id');
assert.match(weeklyScript, /name="gmt_workbook_key"/);
assert.match(weeklyScript, /name="gmt_filing_mode"/);
assert.match(weeklyScript, /field\('gmtFilingMode'\)\.value = 'monthly-upsert'/);
assert.match(clockScript, /const workbookKey = `timesheet-/);
assert.match(clockScript, /hidden\(form, 'gmt_filing_mode', 'monthly-upsert'\)/);
assert.match(upsertScript, /Source record ID/);
assert.match(upsertScript, /existingById/);
assert.match(upsertScript, /getUsedRange\(true\)/);
assert.match(filingContract, /one employee\/month workbook/);
assert.equal(flowSpec.acceptedEnvelope.filingMode, 'monthly-upsert');
assert.equal(flowSpec.acceptedEnvelope.monthFormat, 'MM');
assert.equal(flowSpec.idempotency.eventKey, 'gmt_record_id');
assert.equal(flowSpec.idempotency.workbookKey, 'gmt_workbook_key');
assert.ok(flowSpec.actions.includes('run-office-script-upsert-monthly-timesheet-row'));

console.log(JSON.stringify({
  filingMode: contract.timesheet.filingMode,
  dedupeKey: contract.timesheet.dedupeKey,
  sharedWorkbookPrefix: 'timesheet-{employee}-{yyyy-mm}',
  upsertScript: 'power-platform/office-scripts/upsert-monthly-timesheet-row.ts'
}, null, 2));
