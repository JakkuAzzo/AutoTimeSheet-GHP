import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { createZip } = require('./portal/zip-store.js');
const folder = mkdtempSync(join(tmpdir(), 'gmt-zip-test-'));
try {
  const archivePath = join(folder, 'sheets.zip');
  const archive = createZip([
    { name: 'GMT Timesheet - Michelle - Pay Month 2026-09.xlsx', data: new TextEncoder().encode('workbook-one') },
    { name: 'GMT Timesheet - Jason - Pay Month 2026-09.xlsx', data: new TextEncoder().encode('workbook-two') }
  ]);
  writeFileSync(archivePath, archive);
  const listing = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(listing, [
    'GMT Timesheet - Michelle - Pay Month 2026-09.xlsx',
    'GMT Timesheet - Jason - Pay Month 2026-09.xlsx'
  ]);
  assert.equal(execFileSync('unzip', ['-p', archivePath, listing[0]], { encoding: 'utf8' }), 'workbook-one');
  assert.equal(execFileSync('unzip', ['-p', archivePath, listing[1]], { encoding: 'utf8' }), 'workbook-two');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
console.log('PASS: downloaded sheet ZIP contains each complete named workbook.');
