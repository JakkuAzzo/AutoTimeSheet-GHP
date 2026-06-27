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
    XLSX.writeFile = (workbook, filename) => {
      window.__auditDownloadedSheets = workbook.SheetNames.slice();
      return original(workbook, filename);
    };
  });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadXlsxBtn').click();
  await downloadPromise;

  const result = await page.evaluate(() => {
    const wordFiles = AUDIT.files.filter((file) => ['docx', 'docm'].includes(file.type));
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
      categories: wordFiles.map((file) => file.meta?.categories || {})
    };
  });

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
