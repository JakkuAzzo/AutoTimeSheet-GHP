import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  createReadStream
} from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const XLSX = require('xlsx');

const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const cleanWeekRows = [
  row('Monday 1st', '8:00am', '4:00pm', '0 mins', '8h 00m', '0h 00m', '0h 00m'),
  row('Tuesday 2nd', '8:00am', '4:00pm', '0 mins', '8h 00m', '0h 00m', '0h 00m'),
  row('Wednesday 3rd', '8:00am', '4:00pm', '0 mins', '8h 00m', '0h 00m', '0h 00m'),
  row('Thursday 4th', '8:00am', '4:00pm', '0 mins', '8h 00m', '0h 00m', '0h 00m'),
  row('Friday 5th', '8:00am', '4:00pm', '0 mins', '8h 00m', '0h 00m', '0h 00m')
];

const ainsleyWeekRows = [
  row('Mon 01', '8.00am', '17.00pm', '1hr', '8', '', '', 'GMT'),
  row('Tues 02', '8.00am', '17.00pm', '1hr', '8', '', '', 'GMT'),
  row('Wed 03', '8.00am', '17.00pm', '1hr', '8', '', '', 'GMT'),
  row('Thur 04', '8.00am', '17.00pm', '1hr', '8', '', '', 'GMT'),
  row('Fri 05', '8.00am', '17.00pm', '1hr', '8', '', '', 'GMT')
];

const cases = [];

function row(label, start = '', finish = '', lunch = '', basic = '', ot15 = '', ot20 = '', site = 'Fixture site') {
  return { label, site, start, finish, lunch, basic, ot15, ot20 };
}

function minutes(hours) {
  return Math.round(hours * 60);
}

function expected({
  sourceCount = 1,
  parsedRows,
  combinedLines = sourceCount,
  actual,
  basic,
  ot15 = 0,
  ot20 = 0,
  issues = 0,
  parseErrors = 0,
  employees
}) {
  return {
    sourceCount,
    parsedRows,
    combinedLines,
    actualMinutes: minutes(actual),
    basicMinutes: minutes(basic),
    ot15Minutes: minutes(ot15),
    ot20Minutes: minutes(ot20),
    issues,
    parseErrors,
    employees
  };
}

function escXml(value) {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[char]));
}

function cell(value) {
  return `<w:tc><w:p><w:r><w:t>${escXml(value)}</w:t></w:r></w:p></w:tc>`;
}

function tableRow(values) {
  return `<w:tr>${values.map(cell).join('')}</w:tr>`;
}

function documentXml({ employee, weekText = 'Week Beginning 1 June 2026', rows }) {
  const header = ['DATE', 'WORK SITE ADDRESS', 'START', 'FINISH', 'LUNCH', 'BASIC HRS', 'O/T 1.5', 'O/T 2.0'];
  const bodyRows = [
    tableRow(['June 2026', '', '', '', '', '', '', '']),
    ...rows.map((r) => tableRow([r.label, r.site, r.start, r.finish, r.lunch, r.basic, r.ot15, r.ot20])),
    tableRow(['Saturday 6th', '', '', '', '', '', '', '']),
    tableRow(['Sunday 7th', '', '', '', '', '', '', '']),
    tableRow(['Total Basic', '', '', '', '', '', '', '']),
    tableRow(['Overtime hrs', '', '', '', '', '', '', '']),
    tableRow(['Please hand timesheet to accounts', '', '', '', '', '', '', ''])
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>GMT ELECTRICAL SERVICES LTD - WEEKLY TIMESHEET</w:t></w:r></w:p>
    <w:p><w:r><w:t>${escXml(weekText)}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Name: ${escXml(employee)}</w:t></w:r></w:p>
    <w:tbl>${tableRow(header)}${bodyRows}</w:tbl>
  </w:body>
</w:document>`;
}

function createWordFile(root, name, spec) {
  const packageDir = join(root, `${name}-pkg`);
  mkdirSync(join(packageDir, 'word'), { recursive: true });
  writeFileSync(join(packageDir, 'word/document.xml'), documentXml(spec));
  const outputPath = join(root, name);
  execFileSync('zip', ['-qr', outputPath, '.'], { cwd: packageDir });
  return outputPath;
}

function createZip(root, name, filePaths) {
  const zipDir = join(root, `${name}-bundle`);
  mkdirSync(zipDir, { recursive: true });
  filePaths.forEach((filePath, index) => {
    const base = filePath.split('/').pop();
    const target = existsSync(join(zipDir, base)) ? `${index + 1}-${base}` : base;
    execFileSync('cp', [filePath, join(zipDir, target)]);
  });
  const outputPath = join(root, name);
  execFileSync('zip', ['-qr', outputPath, '.'], { cwd: zipDir });
  return outputPath;
}

function createAppXlsxFile(root, name, { employee, employeeEmail = '', weekStart = '2026-06-01', weekEnd = '2026-06-05', rows }) {
  const workbook = XLSX.utils.book_new();
  const allRows = rows.map((r) => ({
    Status: r.status || 'Recorded',
    Category: r.category || 'Basic day',
    Employee: employee,
    'Employee email': employeeEmail,
    'Week start': weekStart,
    'Week end': weekEnd,
    Day: r.label,
    Date: r.date,
    Weekday: r.weekday,
    Start: r.start,
    Finish: r.finish,
    Break: r.breakLabel,
    'Absence reason': r.absence || 'NA',
    'Worked hours': r.worked,
    'Basic hours': r.basic,
    'OT x1.5 hours': r.ot15 || 0,
    'OT x2.0 hours': r.ot20 || 0,
    'Weighted hours': r.weighted || r.basic,
    Note: r.note || ''
  }));
  const totalsRows = [
    ['GMT Weekly Timesheet Totals'],
    [],
    ['Employee', employee],
    ['Employee email', employeeEmail],
    ['Week start', weekStart],
    ['Week end', weekEnd]
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(allRows), 'All');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(totalsRows), 'Totals');
  const outputPath = join(root, name);
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}

function addCase(item) {
  cases.push(item);
}

function buildFixtures(root) {
  const cleanDocx = createWordFile(root, 'clean-docx.docx', { employee: 'Fixture Alpha', rows: cleanWeekRows });
  const cleanDocm = createWordFile(root, 'clean-docm.docm', { employee: 'Fixture Macro', rows: cleanWeekRows });
  const mixedDocx = createWordFile(root, 'mixed-alpha.docx', { employee: 'Fixture Mixed Alpha', rows: cleanWeekRows });
  const mixedDocm = createWordFile(root, 'mixed-beta.docm', { employee: 'Fixture Mixed Beta', weekText: 'Week Beginning 8 June 2026', rows: cleanWeekRows });
  const employeeOne = createWordFile(root, 'employee-one.docx', { employee: 'Fixture Person One', rows: cleanWeekRows });
  const employeeTwo = createWordFile(root, 'employee-two.docx', { employee: 'Fixture Person Two', rows: cleanWeekRows });
  const weekdayOt = createWordFile(root, 'weekday-ot.docx', { employee: 'Fixture Weekday Ot', rows: [row('Monday 1st', '8:00am', '6:00pm', '30 mins', '8h 00m', '1h 30m', '0h 00m')] });
  const saturdaySplit = createWordFile(root, 'saturday-split.docx', { employee: 'Fixture Saturday Split', rows: [row('Saturday 6th', '10:00am', '3:00pm', '0 mins', '0h 00m', '3h 00m', '2h 00m')] });
  const sundayOt = createWordFile(root, 'sunday-ot.docx', { employee: 'Fixture Sunday Ot', rows: [row('Sunday 7th', '9:00am', '1:00pm', '0 mins', '0h 00m', '0h 00m', '4h 00m')] });
  const overnight = createWordFile(root, 'overnight-typo.docx', { employee: 'Fixture Overnight', rows: [row('Friday 5th', '7:00pm', '6:00pm', '30 mins', '8h 00m', '2h 30m', '0h 00m')] });
  const ainsley = createWordFile(root, 'AINSLEY TIMESHEET GMT WEEK 1st June 2026 (2).docx', { employee: 'Ainsley Williams', rows: ainsleyWeekRows });
  const cleanAppXlsxRows = [
    { label: 'Day 1', date: '2026-06-01', weekday: 'Monday', start: '08:00', finish: '17:00', breakLabel: '1 hour', worked: 8, basic: 8 },
    { label: 'Day 2', date: '2026-06-02', weekday: 'Tuesday', start: '08:00', finish: '17:00', breakLabel: '1 hour', worked: 8, basic: 8 },
    { label: 'Day 3', date: '2026-06-03', weekday: 'Wednesday', start: '08:00', finish: '17:00', breakLabel: '1 hour', worked: 8, basic: 8 },
    { label: 'Day 4', date: '2026-06-04', weekday: 'Thursday', start: '08:00', finish: '17:00', breakLabel: '1 hour', worked: 8, basic: 8 },
    { label: 'Day 5', date: '2026-06-05', weekday: 'Friday', start: '08:00', finish: '17:00', breakLabel: '1 hour', worked: 8, basic: 8 }
  ];
  const cleanAppXlsx = createAppXlsxFile(root, 'clean-app-generated-timesheet.xlsx', { employee: 'Fixture App Xlsx', employeeEmail: 'fixture.app@example.com', rows: cleanAppXlsxRows });
  const unsupportedDoc = join(root, 'unsupported-legacy.doc');
  writeFileSync(unsupportedDoc, 'legacy binary placeholder');

  addCase({ name: 'docx-only-clean', zip: createZip(root, 'docx-only-clean.zip', [cleanDocx]), expected: expected({ parsedRows: 5, actual: 40, basic: 40, employees: ['fixture alpha'] }) });
  addCase({ name: 'docm-only-clean', zip: createZip(root, 'docm-only-clean.zip', [cleanDocm]), expected: expected({ parsedRows: 5, actual: 40, basic: 40, employees: ['fixture macro'] }) });
  addCase({ name: 'mixed-docx-docm', zip: createZip(root, 'mixed-docx-docm.zip', [mixedDocx, mixedDocm]), expected: expected({ sourceCount: 2, parsedRows: 10, combinedLines: 2, actual: 80, basic: 80, employees: ['fixture mixed alpha', 'fixture mixed beta'] }) });
  addCase({ name: 'multiple-employees', zip: createZip(root, 'multiple-employees.zip', [employeeOne, employeeTwo]), expected: expected({ sourceCount: 2, parsedRows: 10, combinedLines: 2, actual: 80, basic: 80, employees: ['fixture person one', 'fixture person two'] }) });
  addCase({ name: 'clean-week-no-warnings', zip: createZip(root, 'clean-week-no-warnings.zip', [cleanDocx]), expected: expected({ parsedRows: 5, actual: 40, basic: 40, employees: ['fixture alpha'] }) });
  addCase({ name: 'ainsley-dot-am-pm-blank-ot', zip: createZip(root, 'ainsley-dot-am-pm-blank-ot.zip', [ainsley]), expected: expected({ parsedRows: 5, actual: 40, basic: 40, employees: ['ainsley williams'] }) });
  addCase({ name: 'app-generated-xlsx-clean', zip: createZip(root, 'app-generated-xlsx-clean.zip', [cleanAppXlsx]), expected: expected({ parsedRows: 5, actual: 40, basic: 40, employees: ['fixture app xlsx'] }), statusIncludes: ['app-generated XLSX file'] });
  addCase({ name: 'mixed-word-and-app-xlsx', zip: createZip(root, 'mixed-word-and-app-xlsx.zip', [cleanDocx, cleanAppXlsx]), expected: expected({ sourceCount: 2, parsedRows: 10, combinedLines: 2, actual: 80, basic: 80, employees: ['fixture alpha', 'fixture app xlsx'] }), statusIncludes: ['source files', 'Word file', 'app-generated XLSX file'] });
  addCase({ name: 'weekday-ot-x15', zip: createZip(root, 'weekday-ot-x15.zip', [weekdayOt]), expected: expected({ parsedRows: 1, actual: 9.5, basic: 8, ot15: 1.5, employees: ['fixture weekday ot'] }) });
  addCase({ name: 'saturday-before-after-1300', zip: createZip(root, 'saturday-before-after-1300.zip', [saturdaySplit]), expected: expected({ parsedRows: 1, actual: 5, basic: 0, ot15: 3, ot20: 2, employees: ['fixture saturday split'] }) });
  addCase({ name: 'sunday-ot-x20', zip: createZip(root, 'sunday-ot-x20.zip', [sundayOt]), expected: expected({ parsedRows: 1, actual: 4, basic: 0, ot20: 4, employees: ['fixture sunday ot'] }) });
  addCase({ name: 'overnight-typo-warning', zip: createZip(root, 'overnight-typo-warning.zip', [overnight]), expected: expected({ parsedRows: 1, actual: 22.5, basic: 8, ot15: 14.5, issues: 1, employees: ['fixture overnight'] }), warningIncludes: ['overnight shift', '7:00pm'] });
  addCase({ name: 'unsupported-file-included', zip: createZip(root, 'unsupported-file-included.zip', [cleanDocx, unsupportedDoc]), expected: expected({ parsedRows: 5, actual: 40, basic: 40, parseErrors: 1, employees: ['fixture alpha'] }) });
  addCase({ name: 'duplicate-week-file-scenario', zip: createZip(root, 'duplicate-week-file-scenario.zip', [employeeOne, employeeOne]), expected: expected({ sourceCount: 2, parsedRows: 10, combinedLines: 1, actual: 80, basic: 80, employees: ['fixture person one'] }) });

  if (process.env.AUDIT_ZIP_PATH && existsSync(process.env.AUDIT_ZIP_PATH)) {
    addCase({
      name: 'jason-attached-baseline',
      zip: process.env.AUDIT_ZIP_PATH,
      expected: {
        sourceCount: 4,
        parsedRows: 20,
        combinedLines: 4,
        actualMinutes: minutes(206.5),
        basicMinutes: minutes(157.5),
        ot15Minutes: minutes(49),
        ot20Minutes: 0,
        issues: 3,
        parseErrors: 0,
        employees: ['jason brown-bennett']
      },
      warningIncludes: ['overnight shift', '7:00pm should be 7:00am']
    });
  }
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const filePath = normalize(join(repoRoot, rawPath));

    if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (rawPath === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(readFileSync(filePath, 'utf8').replace('enabled: true', 'enabled: false'));
      return;
    }

    res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen(server)));
}

async function runCase(page, port, item) {
  await page.goto(`http://127.0.0.1:${port}/audit/`, { waitUntil: 'load' });
  await page.locator('#sourceInput').setInputFiles(item.zip);
  await page.locator('#addSourcesBtn').click();
  await page.locator('#runBtn').click();
  await page.waitForFunction(() => !document.querySelector('#resultsCard')?.classList.contains('hidden'), null, { timeout: 30000 });
  const result = await page.evaluate(() => {
    const totals = AUDIT.combined.reduce((acc, item) => {
      acc.actualMinutes += item.total;
      acc.basicMinutes += item.basic;
      acc.ot15Minutes += item.ot15;
      acc.ot20Minutes += item.ot20;
      return acc;
    }, { actualMinutes: 0, basicMinutes: 0, ot15Minutes: 0, ot20Minutes: 0 });
    return {
      sourceCount: AUDIT.files.filter((file) => ['docx', 'docm', 'xlsx', 'xls', 'csv'].includes(file.type) && file.rows.length).length,
      parsedRows: AUDIT.rows.length,
      combinedLines: AUDIT.combined.length,
      ...totals,
      issues: AUDIT.rows.filter((row) => row.issues.length).length,
      parseErrors: AUDIT.files.reduce((total, file) => total + (file.issues?.length || 0), 0),
      employees: [...new Set(AUDIT.rows.map((row) => row.employeeKey))].sort(),
      warnings: AUDIT.rows.flatMap((row) => row.issues).concat(AUDIT.issues),
      status: document.querySelector('#status')?.textContent || '',
      statusBanner: document.querySelector('#statusBanner')?.textContent || '',
      correctionTitle: document.querySelector('#adminCorrectionsTitle')?.textContent || '',
      correctionText: document.querySelector('#adminCorrections')?.textContent || '',
      detailHeading: document.querySelector('.detail-heading')?.textContent || '',
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  });

  assert.deepEqual(
    {
      sourceCount: result.sourceCount,
      parsedRows: result.parsedRows,
      combinedLines: result.combinedLines,
      actualMinutes: result.actualMinutes,
      basicMinutes: result.basicMinutes,
      ot15Minutes: result.ot15Minutes,
      ot20Minutes: result.ot20Minutes,
      issues: result.issues,
      parseErrors: result.parseErrors,
      employees: result.employees
    },
    item.expected,
    item.name
  );

  for (const fragment of item.warningIncludes || []) {
    assert.match(result.warnings.join('\n'), new RegExp(fragment, 'i'), item.name);
  }

  for (const fragment of item.statusIncludes || []) {
    assert.match(result.status, new RegExp(fragment, 'i'), item.name);
  }

  assert.equal(result.detailHeading, 'Detailed audit data', `${item.name} should keep detailed tables below the decision summary`);
  if (item.expected.parseErrors === 0 && item.expected.issues === 0) {
    assert.match(result.statusBanner, /No issues found\. No action needed\./, item.name);
    assert.equal(result.correctionTitle, 'No action needed', item.name);
    assert.match(result.correctionText, /No corrections are needed\./, item.name);
  } else if (item.expected.issues > 0) {
    assert.match(result.statusBanner, new RegExp(`${item.expected.issues} issue${item.expected.issues === 1 ? '' : 's'} need review`), item.name);
    assert.equal(result.correctionTitle, 'Action required', item.name);
  }

  assert.equal(result.horizontalOverflow, false, `${item.name} should not horizontally overflow mobile viewport`);
  return result;
}

const tmp = mkdtempSync(join(tmpdir(), 'gmt-audit-fixtures-'));
mkdirSync(dirname(join(tmp, 'placeholder')), { recursive: true });
let server;
let browser;
try {
  buildFixtures(tmp);
  server = await startServer();
  const { port } = server.address();
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromePath) ? { executablePath: chromePath } : {})
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true });
  const logs = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  const results = [];
  for (const item of cases) {
    results.push({ name: item.name, ...(await runCase(page, port, item)) });
  }

  assert.equal(logs.length, 0, `Unexpected browser logs:\n${logs.join('\n')}`);
  console.log(JSON.stringify({ fixtures: results.map(({ name, parsedRows, combinedLines, issues, parseErrors, employees }) => ({ name, parsedRows, combinedLines, issues, parseErrors, employees })) }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server?.close(resolveClose) ?? resolveClose());
  rmSync(tmp, { recursive: true, force: true });
}
