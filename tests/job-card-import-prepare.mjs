import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const modulePath = new URL('../tools/prepare-job-card-import.mjs', import.meta.url);
const { prepareImport, quickXorHash, recordIdForPage } = await import(modulePath);

const sourcePages = [
  ['EC09200.pdf', 3], ['EC09300.pdf', 52], ['EC09400.pdf', 92],
  ['EC09500.pdf', 91], ['EC09600.pdf', 33], ['MTA22900.pdf', 2],
  ['MTA23000.pdf', 2], ['MTA23100.pdf', 2], ['MTA23200.pdf', 70],
  ['MTA23300.pdf', 4], ['MTA23400.pdf', 79], ['MTA23500.pdf', 86],
  ['MTA23600.pdf', 43]
];

function referenceQuickXorHash(input) {
  const mask = (1n << 160n) - 1n;
  let block = 0n;
  for (let index = 0; index < input.length; index += 1) {
    const shifted = BigInt(input[index]) << BigInt((index * 11) % 160);
    block ^= (shifted & mask) | (shifted >> 160n);
  }
  block ^= BigInt(input.length) << 96n;
  const digest = Buffer.alloc(20);
  for (let index = 0; index < digest.length; index += 1) {
    digest[index] = Number((block >> BigInt(index * 8)) & 0xffn);
  }
  return digest.toString('base64');
}

function tsv(lines, confidence = 92) {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = lines.flatMap((line, lineIndex) => line.split(/\s+/).filter(Boolean).map((word, wordIndex) =>
    `5\t1\t1\t1\t${lineIndex + 1}\t${wordIndex + 1}\t0\t0\t100\t18\t${confidence}\t${word}`));
  return `${header}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function createRunner({ omitRenderedPage = null } = {}) {
  const imageSources = new Map();
  return async (command, args) => {
    const executable = basename(command);
    if (executable === 'pdfinfo') {
      const source = basename(args.at(-1));
      const pages = new Map(sourcePages).get(source);
      return { stdout: `Pages:          ${pages}\n`, stderr: '' };
    }
    if (executable === 'pdfseparate') {
      const page = Number(args[args.indexOf('-f') + 1]);
      const source = basename(args.at(-2));
      const pattern = args.at(-1);
      const output = pattern.replace('%d', String(page));
      const duplicate = (source === 'EC09200.pdf' && page === 3)
        || (source === 'EC09300.pdf' && page === 1);
      await writeFile(output, duplicate ? 'duplicate-page-pdf' : `page-pdf:${source}:${page}`);
      return { stdout: '', stderr: '' };
    }
    if (executable === 'pdftoppm') {
      const page = Number(args[args.indexOf('-f') + 1]);
      const source = basename(args[args.length - 2]);
      const prefix = args.at(-1);
      const pageKey = `${source}:${page}`;
      if (omitRenderedPage === pageKey) return { stdout: '', stderr: '' };
      await writeFile(`${prefix}.png`, `render:${pageKey}`);
      imageSources.set(`${prefix}.png`, pageKey);
      return { stdout: '', stderr: '' };
    }
    if (executable === 'tesseract') {
      const pageKey = imageSources.get(args[0]);
      if (pageKey === 'EC09200.pdf:2') return { stdout: tsv([]), stderr: '' };
      if (pageKey === 'EC09200.pdf:1') {
        return { stdout: tsv(['Job card no EC12345', 'Date 12/05/2026', 'Customer ACME', 'Engineer ALEX', 'PO number PO1234', 'Site Main Street', 'Report Repaired socket', 'Amount £250.00']), stderr: '' };
      }
      return { stdout: tsv(['Job card no JOB12345', 'Customer ACME', 'Date 12/05/2026']), stderr: '' };
    }
    throw new Error(`Unexpected command in test runner: ${command} ${args.join(' ')}`);
  };
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'gmt-job-card-prepare-'));
try {
  assert.equal(quickXorHash(Buffer.alloc(0)), referenceQuickXorHash(Buffer.alloc(0)));
  const quickXorFixture = Buffer.from(Array.from({ length: 113 }, (_, index) => (index * 37) & 0xff));
  assert.equal(quickXorHash(quickXorFixture), referenceQuickXorHash(quickXorFixture), 'QuickXorHash matches the 160-bit circular-shift reference');

  const sourceDir = join(fixtureRoot, 'sources');
  const outputDir = join(fixtureRoot, 'output');
  await mkdir(sourceDir, { recursive: true });
  const sources = [];
  const originalHashes = new Map();
  for (const [name, pages] of sourcePages) {
    const path = join(sourceDir, name);
    const bytes = Buffer.from(`fixture source PDF ${name} with ${pages} pages`);
    await writeFile(path, bytes);
    sources.push(path);
    originalHashes.set(path, createHash('sha256').update(bytes).digest('hex'));
  }

  const manifest = await prepareImport(sources, outputDir, {
    expectedPages: 559,
    expectedSources: 13,
    runCommand: createRunner(),
    checkBinaries: false
  });
  assert.equal(manifest.sources.length, 13);
  assert.equal(manifest.inventory.pageCount, 559);
  assert.equal(manifest.pages.length, 559);
  assert.equal(manifest.inventory.byteCount, sources.reduce((sum, path) => sum + Buffer.byteLength(`fixture source PDF ${basename(path)} with ${new Map(sourcePages).get(basename(path))} pages`), 0));
  assert.ok(manifest.batchId);

  for (const source of manifest.sources) {
    assert.equal(source.sourcePath, source.path, 'each source entry keeps its original path');
    assert.equal(source.sha256, originalHashes.get(source.path), 'source bytes are identified without rewriting the input');
    assert.equal(source.quickXorHash, quickXorHash(await readFile(source.path)));
  }

  const sourceHash = manifest.sources.find((source) => source.fileName === 'EC09200.pdf').sha256;
  const firstPage = manifest.pages.find((page) => page.sourceFile === 'EC09200.pdf' && page.sourcePage === 1);
  assert.equal(firstPage.recordId, recordIdForPage(sourceHash, 1));
  assert.equal(recordIdForPage(sourceHash, 1), recordIdForPage(sourceHash, 1), 'page IDs are deterministic');
  assert.equal(firstPage.cardType, 'EC');
  assert.equal(firstPage.candidates.cardNumber, 'EC12345');
  assert.equal(firstPage.candidates.date, '12/05/2026');
  assert.equal(firstPage.candidates.customer, 'ACME');
  assert.equal(firstPage.candidates.amount, '£250.00');
  assert.ok(firstPage.ocrText.includes('PO1234'));
  assert.ok(firstPage.meanOcrConfidence > 90);
  assert.match(firstPage.sha256, /^[a-f0-9]{64}$/);
  assert.equal(firstPage.quickXorHash, quickXorHash(await readFile(join(outputDir, firstPage.file))));

  const blankPage = manifest.pages.find((page) => page.sourceFile === 'EC09200.pdf' && page.sourcePage === 2);
  assert.equal(blankPage.ocrText, '');
  assert.equal(blankPage.reviewState, 'needs-review', 'blank OCR remains an explicit review item');
  assert.ok(blankPage.reviewReasons.includes('blank-ocr'));

  const duplicatePages = manifest.pages.filter((page) => page.reviewReasons.includes('duplicate-page-content'));
  assert.equal(duplicatePages.length, 2, 'duplicate scans remain in the inventory and are flagged, not discarded');
  assert.equal(manifest.reviewIssues.filter((issue) => issue.code === 'blank-ocr').length, 1);

  const onDiskManifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(onDiskManifest.pages.length, 559);
  const pageFiles = await readdir(join(outputDir, 'pages'));
  assert.equal(pageFiles.filter((file) => file.endsWith('.pdf')).length, 559);

  const failedOutputDir = join(fixtureRoot, 'missing-render-output');
  await assert.rejects(
    prepareImport([sources[0]], failedOutputDir, {
      expectedPages: 3,
      expectedSources: 1,
      runCommand: createRunner({ omitRenderedPage: 'EC09200.pdf:2' }),
      checkBinaries: false
    }),
    /render.*page 2|missing.*render/i,
    'a page with no rendered image fails the preparation instead of being omitted'
  );
  assert.equal(await readdir(failedOutputDir).then((entries) => entries.includes('manifest.json')), false,
    'a failed partial run does not publish an incomplete manifest');
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log('Job-card preparation, source integrity, QuickXorHash, OCR review flags, and 559-page inventory: PASS');
