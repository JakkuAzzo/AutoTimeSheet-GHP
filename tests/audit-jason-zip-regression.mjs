import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const zipPath = process.env.AUDIT_ZIP_PATH;

if (!zipPath || !existsSync(zipPath)) {
  console.error('Set AUDIT_ZIP_PATH to the Jason June 26 Time Sheets ZIP before running this regression test.');
  process.exit(1);
}

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, rawPath));

  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromePath) ? { executablePath: chromePath } : {})
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const logs = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  await page.goto(`http://127.0.0.1:${port}/audit/`, { waitUntil: 'load' });
  await page.locator('#sourceInput').setInputFiles(zipPath);
  await page.locator('#addSourcesBtn').click();
  await page.locator('#runBtn').click();
  await page.waitForFunction(() => !document.querySelector('#resultsCard')?.classList.contains('hidden'), null, { timeout: 30000 });

  await page.evaluate(() => {
    const original = XLSX.writeFile;
    window.__auditDownloadedSheets = null;
    window.__auditDownloadedRows = null;
    XLSX.writeFile = (workbook, filename) => {
      window.__auditDownloadedSheets = workbook.SheetNames.slice();
      window.__auditDownloadedRows = XLSX.utils.sheet_to_json(workbook.Sheets['Source Row Checks'], { defval: '' });
      return original(workbook, filename);
    };
  });
  await page.locator('[data-tab="exportsPane"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadXlsxBtn').click();
  await downloadPromise;
  await page.waitForFunction(() => Array.isArray(window.__auditDownloadedSheets), null, { timeout: 5000 });

  const beforeSubmit = await page.evaluate(() => ({
    forms: document.querySelectorAll('form').length,
    iframes: document.querySelectorAll('iframe').length,
    submitDisabled: document.querySelector('#submitAuditBtn')?.disabled,
    corrections: [...document.querySelectorAll('#adminCorrections .correction-card')].map((card) => card.textContent.trim())
  }));
  await page.evaluate(() => {
    window.__auditSubmitted = false;
    HTMLFormElement.prototype.submit = function submitStub() {
      window.__auditSubmitted = true;
    };
  });
  await page.locator('#submitAuditBtn').click();
  await page.waitForFunction(() => window.__auditSubmitted === true, null, { timeout: 5000 });

  const result = await page.evaluate((beforeSubmit) => {
    const wordFiles = AUDIT.files.filter((file) => ['docx', 'docm'].includes(file.type));
    const form = document.querySelector('form[enctype="multipart/form-data"]');
    const field = (name) => form?.querySelector(`[name="${name}"]`)?.value || '';
    const files = [...(form?.querySelectorAll('input[type="file"]') || [])].map((input) => ({
      name: input.name,
      files: [...input.files].map((file) => ({ name: file.name, size: file.size, type: file.type }))
    }));
    return {
      title: document.title,
      status: document.querySelector('#status')?.textContent || '',
      filesParsed: wordFiles.length,
      docxParsed: wordFiles.filter((file) => file.type === 'docx').length,
      docmParsed: wordFiles.filter((file) => file.type === 'docm').length,
      sourceRows: AUDIT.rows.length,
      combinedTotalLines: AUDIT.combined.length,
      fileLevelParseErrors: AUDIT.files.reduce((total, file) => total + (file.issues?.length || 0), 0),
      auditMismatches: AUDIT.rows.filter((row) => row.issues.length).length,
      overnightWarnings: AUDIT.rows.filter((row) => row.issues.some((issue) => issue.includes('overnight shift'))).length,
      downloadedSheets: window.__auditDownloadedSheets,
      downloadedRows: window.__auditDownloadedRows,
      categories: wordFiles.map((file) => file.meta?.categories || {}),
      beforeSubmit,
      submitStatus: document.querySelector('#submitAuditStatus')?.textContent || '',
      form: {
        action: form?.action || '',
        method: form?.method || '',
        target: form?.target || '',
        subject: field('_subject'),
        summary: field('summary'),
        parsedFiles: field('parsed_files_count'),
        parsedRows: field('parsed_rows_count'),
        auditWarnings: field('audit_warnings_count'),
        parseErrors: field('parse_errors_count'),
        sourceFilenames: field('source_filenames'),
        adminCorrectionNotes: field('admin_correction_notes'),
        files
      },
      ui: {
        statusBanner: document.querySelector('#statusBanner')?.textContent || '',
        sourceCardOpen: document.querySelector('#sourcesCard')?.open,
        rowsCards: document.querySelectorAll('#rowsCards .row-card').length,
        correctionCards: document.querySelectorAll('#adminCorrections .correction-card').length,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      },
      jsonMetadata: auditJsonPayload().metadata
    };
  }, beforeSubmit);

  assert.equal(logs.length, 0, `Unexpected browser logs: ${logs.join('\n')}`);
  assert.equal(result.title, 'GMT Timesheet Audit Checker');
  assert.match(result.status, /Parsed successfully: 20 rows from 4 Word files/);
  assert.equal(result.filesParsed, 4);
  assert.equal(result.docxParsed, 2);
  assert.equal(result.docmParsed, 2);
  assert.equal(result.sourceRows, 20);
  assert.equal(result.combinedTotalLines, 4);
  assert.equal(result.fileLevelParseErrors, 0);
  assert.equal(result.auditMismatches, 3);
  assert.equal(result.overnightWarnings, 1);
  assert.deepEqual(result.downloadedSheets, ['Combined Totals', 'Source Row Checks', 'Sources']);
  assert.match(result.downloadedRows.find((row) => row.Source.includes('Friday 12th'))['Recommended action'], /Likely correction: check whether start should be 7:00am/);
  assert.equal(result.downloadedRows.find((row) => row.Source.includes('Friday 12th')).Start, '7:00pm');
  assert.equal(result.downloadedRows.find((row) => row.Source.includes('Friday 12th')).Finish, '6:00pm');
  assert.equal(result.beforeSubmit.forms, 0);
  assert.equal(result.beforeSubmit.iframes, 0);
  assert.equal(result.beforeSubmit.submitDisabled, false);
  assert.equal(result.beforeSubmit.corrections.length, 3);
  assert.match(result.beforeSubmit.corrections.join('\n'), /Friday 12th: Source has 7:00pm to 6:00pm/);
  assert.equal(result.submitStatus, 'Corrected audit sent to accounts with Excel attachment.');
  assert.equal(result.form.action, 'https://formsubmit.co/acc.gmtelect+audit@outlook.com');
  assert.equal(result.form.method, 'post');
  assert.equal(result.form.subject, '[GMT][AUDIT][CORRECTED] Corrected timesheet audit');
  assert.match(result.form.summary, /Parsed successfully: 20 rows from 4 Word files/);
  assert.equal(result.form.parsedFiles, '4');
  assert.equal(result.form.parsedRows, '20');
  assert.equal(result.form.auditWarnings, '3');
  assert.equal(result.form.parseErrors, '0');
  assert.match(result.form.sourceFilenames, /wk beg 25th May 2026\.docx/);
  assert.match(result.form.adminCorrectionNotes, /Friday 12th: Source has 7:00pm to 6:00pm/);
  assert.match(result.ui.statusBanner, /Parsed 20 rows from 4 files. 3 warnings need review. 0 parse errors./);
  assert.equal(result.ui.sourceCardOpen, false);
  assert.equal(result.ui.rowsCards, 20);
  assert.equal(result.ui.correctionCards, 3);
  assert.equal(result.ui.horizontalOverflow, false);
  assert.equal(result.jsonMetadata.parser_version, 'audit-openxml-v2');
  assert.equal(result.jsonMetadata.policy_version, 'gmt-daily-basic-v1');
  assert.equal(result.jsonMetadata.row_count, 20);
  assert.equal(result.jsonMetadata.totals.audit_warnings, 3);
  assert.deepEqual(result.form.files.map((fileInput) => fileInput.name), ['attachment', 'attachment_csv']);
  assert.equal(result.form.files[0].files[0].name, 'GMT corrected timesheet audit.xlsx');
  assert.equal(result.form.files[0].files[0].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(result.form.files[1].files[0].name, 'GMT audit correction warnings.csv');
  assert.equal(result.form.files[1].files[0].type, 'text/csv');
  assert.ok(result.form.files[0].files[0].size > 1000);
  assert.ok(result.form.files[1].files[0].size > 100);
  assert.equal(result.categories.reduce((total, item) => total + (item['Bank Holiday row'] || 0), 0), 1);
  assert.equal(result.categories.reduce((total, item) => total + (item['Empty weekend row ignored'] || 0), 0), 8);
  assert.equal(result.categories.reduce((total, item) => total + (item['Month marker row ignored'] || 0), 0), 4);
  assert.equal(result.categories.reduce((total, item) => total + (item['Total row ignored'] || 0), 0), 8);
  assert.equal(result.categories.reduce((total, item) => total + (item['Footer row ignored'] || 0), 0), 4);

  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
