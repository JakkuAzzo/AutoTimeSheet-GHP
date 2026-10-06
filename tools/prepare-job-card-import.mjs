import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);
const REQUIRED_BINARIES = ['pdfinfo', 'pdfseparate', 'pdftoppm', 'tesseract'];
const LOW_CONFIDENCE_THRESHOLD = 60;

class QuickXorAccumulator {
  constructor() {
    this.block = Buffer.alloc(20);
    this.bitOffset = 0;
    this.length = 0n;
  }

  update(chunk) {
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const value = chunk[offset];
      const byteIndex = Math.floor(this.bitOffset / 8);
      const shift = this.bitOffset % 8;
      this.block[byteIndex] ^= (value << shift) & 0xff;
      if (shift > 0) this.block[(byteIndex + 1) % this.block.length] ^= value >>> (8 - shift);
      this.bitOffset = (this.bitOffset + 11) % 160;
      this.length += 1n;
    }
    return this;
  }

  digest() {
    const output = Buffer.from(this.block);
    const lengthBytes = Buffer.alloc(8);
    lengthBytes.writeBigUInt64LE(this.length);
    for (let index = 0; index < lengthBytes.length; index += 1) output[12 + index] ^= lengthBytes[index];
    return output;
  }
}

export function quickXorHash(bytes) {
  return new QuickXorAccumulator().update(Buffer.from(bytes)).digest().toString('base64');
}

export async function hashFile(filePath) {
  const sha256 = createHash('sha256');
  const quickXor = new QuickXorAccumulator();
  let byteCount = 0;
  for await (const chunk of createReadStream(filePath)) {
    sha256.update(chunk);
    quickXor.update(chunk);
    byteCount += chunk.length;
  }
  return { byteCount, sha256: sha256.digest('hex'), quickXorHash: quickXor.digest().toString('base64') };
}

export function recordIdForPage(sourceSha256, pageNumber) {
  if (!/^[a-f0-9]{64}$/i.test(String(sourceSha256))) throw new Error('source SHA-256 must contain 64 hexadecimal characters');
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error('source page must be a positive one-based integer');
  return `jobcard-${String(sourceSha256).toLowerCase()}-${String(pageNumber).padStart(4, '0')}`;
}

function commandRunner(command, args, options = {}) {
  return execFile(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
}

async function ensureBinaries(runCommand) {
  for (const binary of REQUIRED_BINARIES) {
    try {
      await runCommand('which', [binary], { encoding: 'utf8' });
    } catch (error) {
      throw new Error(`Required job-card preparation binary '${binary}' is unavailable: ${error.message}`);
    }
  }
}

function parsePageCount(pdfInfoOutput, fileName) {
  const match = String(pdfInfoOutput).match(/^Pages:\s*(\d+)\s*$/m);
  const pageCount = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error(`pdfinfo did not return a valid page count for ${fileName}`);
  return pageCount;
}

function parseTesseractTsv(tsvOutput) {
  const lines = new Map();
  const confidences = [];
  const rows = String(tsvOutput || '').split(/\r?\n/);
  for (let index = 1; index < rows.length; index += 1) {
    const columns = rows[index].split('\t');
    if (columns.length < 12 || columns[0] !== '5') continue;
    const word = columns.slice(11).join('\t').trim();
    if (!word) continue;
    const lineKey = [columns[1], columns[2], columns[3], columns[4]].join(':');
    if (!lines.has(lineKey)) lines.set(lineKey, []);
    lines.get(lineKey).push({ wordNumber: Number(columns[5]) || 0, word });
    const confidence = Number(columns[10]);
    if (Number.isFinite(confidence) && confidence >= 0) confidences.push(confidence);
  }
  const text = [...lines.values()]
    .map((words) => words.sort((left, right) => left.wordNumber - right.wordNumber).map(({ word }) => word).join(' '))
    .join('\n').trim();
  const meanConfidence = confidences.length
    ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 10) / 10
    : null;
  return { text, meanConfidence };
}

function labelValue(text, aliases) {
  const labelPattern = aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`^\\s*(?:${labelPattern})(?:\\s+(?:number|no\\.?|#))?\\s*[:#-]?\\s*(\\S.*)\\s*$`, 'i');
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractCardNumbers(text, cardType) {
  const found = new Set();
  const typed = /\b(?:EC|MTA)\s*[-/]?\s*\d{4,}\b/gi;
  for (const match of String(text).matchAll(typed)) found.add(match[0].replace(/[\s/-]+/g, '').toUpperCase());
  const generic = /\b(?:job\s*card|card)\s*(?:number|no\.?|#)?\s*[:#-]?\s*(\d{4,})\b/gi;
  for (const match of String(text).matchAll(generic)) found.add(`${cardType || 'JOB'}${match[1]}`.toUpperCase());
  return [...found];
}

function extractCandidates(ocrText, cardType) {
  const cardNumbers = extractCardNumbers(ocrText, cardType);
  const date = String(ocrText).match(/\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/)?.[0] || null;
  const labelledAmount = labelValue(ocrText, ['amount', 'total', 'value', 'job value']);
  const amount = labelledAmount || String(ocrText).match(/(?:£|GBP\s*)\s?\d[\d,]*(?:\.\d{2})?/i)?.[0] || null;
  return {
    cardNumber: cardNumbers[0] || null,
    cardNumbers,
    date,
    customer: labelValue(ocrText, ['customer', 'client', 'company', 'customer name']),
    orderNumber: labelValue(ocrText, ['purchase order', 'order', 'po']),
    site: labelValue(ocrText, ['site', 'site address', 'location', 'job address', 'address']),
    engineer: labelValue(ocrText, ['engineer', 'technician', 'operative']),
    report: labelValue(ocrText, ['report', 'description', 'work carried out', 'job details', 'details']),
    amount: amount?.trim() || null
  };
}

function cardTypeFromFile(fileName) {
  return basename(fileName).match(/^(EC|MTA)\d/i)?.[1].toUpperCase() || 'UNKNOWN';
}

function addReviewReason(page, code, reviewIssues) {
  if (!page.reviewReasons.includes(code)) page.reviewReasons.push(code);
  page.reviewState = 'needs-review';
  reviewIssues.push({ recordId: page.recordId, sourceFile: page.sourceFile, sourcePage: page.sourcePage, code });
}

function markPageForReview(page, reviewIssues) {
  if (!page.ocrText) addReviewReason(page, 'blank-ocr', reviewIssues);
  if (page.meanOcrConfidence === null || page.meanOcrConfidence < LOW_CONFIDENCE_THRESHOLD) addReviewReason(page, 'low-ocr-confidence', reviewIssues);
  if (!page.candidates.cardNumber) addReviewReason(page, 'missing-card-number', reviewIssues);
  if (page.candidates.cardNumbers.length > 1) addReviewReason(page, 'ambiguous-card-number', reviewIssues);
  if (!page.candidates.date) addReviewReason(page, 'missing-date', reviewIssues);
  if (!page.candidates.customer) addReviewReason(page, 'missing-customer', reviewIssues);
}

function withinDirectory(directory, candidate) {
  const path = relative(directory, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

async function getSourceEntry(sourcePath, runCommand) {
  const resolvedPath = resolve(sourcePath);
  const info = await stat(resolvedPath);
  if (!info.isFile()) throw new Error(`Job-card source is not a file: ${resolvedPath}`);
  if (extname(resolvedPath).toLowerCase() !== '.pdf') throw new Error(`Job-card source must be a PDF: ${resolvedPath}`);
  const fileName = basename(resolvedPath);
  const pdfInfo = await runCommand('pdfinfo', [resolvedPath], { encoding: 'utf8' });
  const pageCount = parsePageCount(pdfInfo.stdout, fileName);
  const hash = await hashFile(resolvedPath);
  return {
    fileName,
    path: resolvedPath,
    sourcePath: resolvedPath,
    sizeBytes: hash.byteCount,
    pageCount,
    sha256: hash.sha256,
    quickXorHash: hash.quickXorHash,
    cardType: cardTypeFromFile(fileName),
    purpose: 'source-batch'
  };
}

async function renderPage({ source, pageNumber, workDir, outputDir, runCommand }) {
  const recordId = recordIdForPage(source.sha256, pageNumber);
  const temporaryName = `${source.sha256.slice(0, 20)}-p${String(pageNumber).padStart(4, '0')}`;
  const pagePattern = join(workDir, `${temporaryName}-%d.pdf`);
  const temporaryPdf = pagePattern.replace('%d', String(pageNumber));
  const imagePrefix = join(workDir, temporaryName);
  const imagePath = `${imagePrefix}.png`;
  const finalPath = join(outputDir, 'pages', `${recordId}.pdf`);

  await runCommand('pdfseparate', ['-f', String(pageNumber), '-l', String(pageNumber), source.path, pagePattern], { encoding: 'utf8' });
  if (!(await stat(temporaryPdf).catch(() => null))?.isFile()) throw new Error(`pdfseparate did not create source page ${pageNumber} from ${source.fileName}`);
  await runCommand('pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-png', '-gray', '-r', '200', '-singlefile', source.path, imagePrefix], { encoding: 'utf8' });
  if (!(await stat(imagePath).catch(() => null))?.isFile()) throw new Error(`Missing rendered OCR image for ${source.fileName} page ${pageNumber}`);

  const ocrResult = await runCommand('tesseract', [imagePath, 'stdout', '-l', 'eng', 'tsv'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const { text: ocrText, meanConfidence } = parseTesseractTsv(ocrResult.stdout);
  await mkdir(dirname(finalPath), { recursive: true });
  await rename(temporaryPdf, finalPath);
  await rm(imagePath, { force: true });
  const hash = await hashFile(finalPath);
  return {
    batchId: null,
    recordId,
    sourceFile: source.fileName,
    sourcePath: source.path,
    sourceSha256: source.sha256,
    sourceQuickXorHash: source.quickXorHash,
    sourcePage: pageNumber,
    file: relative(outputDir, finalPath).split(sep).join('/'),
    sizeBytes: hash.byteCount,
    sha256: hash.sha256,
    quickXorHash: hash.quickXorHash,
    cardType: source.cardType,
    candidates: extractCandidates(ocrText, source.cardType),
    ocrText,
    meanOcrConfidence: meanConfidence,
    reviewState: 'ready',
    reviewReasons: [],
    purpose: 'job-card-page'
  };
}

export async function prepareImport(sourcePaths, outputDirectory, options = {}) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) throw new Error('At least one job-card PDF source is required');
  if (Number.isSafeInteger(options.expectedSources) && sourcePaths.length !== options.expectedSources) {
    throw new Error(`Expected ${options.expectedSources} source PDFs but found ${sourcePaths.length}`);
  }
  const outputDir = resolve(outputDirectory);
  const runCommand = options.runCommand || commandRunner;
  if (options.checkBinaries !== false) await ensureBinaries(runCommand);

  const sources = [...sourcePaths].map((sourcePath) => resolve(sourcePath)).sort((left, right) => basename(left).localeCompare(basename(right)));
  const fileNames = sources.map((source) => basename(source).toLowerCase());
  if (new Set(fileNames).size !== fileNames.length) throw new Error('Job-card source filenames must be unique');
  for (const source of sources) {
    if (withinDirectory(dirname(source), outputDir)) throw new Error(`Output directory must be outside the source PDF directory: ${outputDir}`);
  }

  const sourceEntries = [];
  for (const source of sources) sourceEntries.push(await getSourceEntry(source, runCommand));
  const pageCount = sourceEntries.reduce((sum, source) => sum + source.pageCount, 0);
  if (Number.isSafeInteger(options.expectedSources) && sourceEntries.length !== options.expectedSources) {
    throw new Error(`Expected ${options.expectedSources} source PDFs but found ${sourceEntries.length}`);
  }
  if (Number.isSafeInteger(options.expectedPages) && pageCount !== options.expectedPages) {
    throw new Error(`Expected ${options.expectedPages} source pages but found ${pageCount}`);
  }

  const batchIdentity = sourceEntries.map(({ fileName, sha256 }) => `${fileName}\n${sha256}`).join('\n');
  const batchId = `jobcard-batch-${createHash('sha256').update(batchIdentity).digest('hex')}`;
  const workDir = join(outputDir, '.work');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(join(outputDir, 'pages'), { recursive: true });
  await mkdir(workDir, { recursive: true });
  const reviewIssues = [];
  const pages = [];
  try {
    for (const source of sourceEntries) {
      for (let pageNumber = 1; pageNumber <= source.pageCount; pageNumber += 1) {
        const page = await renderPage({ source, pageNumber, workDir, outputDir, runCommand });
        page.batchId = batchId;
        markPageForReview(page, reviewIssues);
        pages.push(page);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const hashGroups = new Map();
  for (const page of pages) {
    if (!hashGroups.has(page.sha256)) hashGroups.set(page.sha256, []);
    hashGroups.get(page.sha256).push(page);
  }
  for (const group of hashGroups.values()) {
    if (group.length < 2) continue;
    for (const page of group) addReviewReason(page, 'duplicate-page-content', reviewIssues);
  }

  const byteCount = sourceEntries.reduce((sum, source) => sum + source.sizeBytes, 0);
  const manifest = {
    schemaVersion: 1,
    batchId,
    generatedAt: new Date().toISOString(),
    inventory: {
      sourceCount: sourceEntries.length,
      pageCount: pages.length,
      byteCount,
      duplicatePageCount: pages.filter((page) => page.reviewReasons.includes('duplicate-page-content')).length,
      needsReviewCount: pages.filter((page) => page.reviewState === 'needs-review').length
    },
    sources: sourceEntries,
    pages,
    reviewIssues
  };
  const manifestPath = join(outputDir, 'manifest.json');
  const temporaryManifestPath = join(outputDir, `.manifest-${batchId}.tmp`);
  await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporaryManifestPath, manifestPath);
  return manifest;
}

function parseCliArguments(argv) {
  const parsed = { expectedPages: 559, expectedSources: 13 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--source-dir', '--output-dir', '--expected-pages', '--expected-sources'].includes(key)) {
      throw new Error(`Unknown preparation option: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--source-dir') parsed.sourceDir = resolve(value);
    else if (key === '--output-dir') parsed.outputDir = resolve(value);
    else if (key === '--expected-pages') parsed.expectedPages = Number(value);
    else if (key === '--expected-sources') parsed.expectedSources = Number(value);
    index += 1;
  }
  if (!parsed.sourceDir || !parsed.outputDir) throw new Error('Usage: npm run prepare:job-cards -- --source-dir <path> --output-dir <path>');
  if (!Number.isSafeInteger(parsed.expectedPages) || parsed.expectedPages < 1) throw new Error('--expected-pages must be a positive integer');
  if (!Number.isSafeInteger(parsed.expectedSources) || parsed.expectedSources < 1) throw new Error('--expected-sources must be a positive integer');
  return parsed;
}

async function main() {
  const args = parseCliArguments(process.argv.slice(2));
  const sources = (await readdir(args.sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.pdf')
    .map((entry) => join(args.sourceDir, entry.name));
  const manifest = await prepareImport(sources, args.outputDir, {
    expectedPages: args.expectedPages,
    expectedSources: args.expectedSources
  });
  console.log(`Prepared ${manifest.inventory.sourceCount} original PDFs and ${manifest.inventory.pageCount} page records.`);
  console.log(`Source bytes: ${manifest.inventory.byteCount}; pages needing Accounts review: ${manifest.inventory.needsReviewCount}; duplicate page copies: ${manifest.inventory.duplicatePageCount}.`);
  console.log(`Manifest: ${join(args.outputDir, 'manifest.json')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Job-card preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
