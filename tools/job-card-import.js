(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  let manifest = null;
  let sourceFilesByName = new Map();
  let preparedFilesByPath = new Map();
  let busy = false;

  function status(message) {
    const output = $('#job-card-import-status');
    if (output) output.textContent = String(message || '');
  }

  function filePath(file) {
    const path = String(file.webkitRelativePath || file.name || '');
    const parts = path.split('/').filter(Boolean);
    return parts.length > 1 ? parts.slice(1).join('/') : (parts[0] || file.name);
  }

  function pdfFiles(files) {
    return Array.from(files || []).filter((file) => /\.pdf$/i.test(file.name));
  }

  async function inspectSelectedFiles() {
    const sourceInput = $('#job-card-source-folder');
    const manifestInput = $('#job-card-manifest-file');
    const pageInput = $('#job-card-page-files');
    const summary = $('#job-card-import-file-summary');
    const start = $('#job-card-import-start');
    const sourceFiles = pdfFiles(sourceInput?.files);
    const manifestFiles = Array.from(manifestInput?.files || []);
    const pageFiles = pdfFiles(pageInput?.files);
    const preparedFiles = [...manifestFiles, ...pageFiles];
    sourceFilesByName = new Map(sourceFiles.map((file) => [file.name.toLowerCase(), file]));
    preparedFilesByPath = new Map([
      ...manifestFiles.map((file) => [filePath(file), file]),
      ...pageFiles.map((file) => {
        const path = filePath(file);
        return [/^pages\//i.test(path) ? path : `pages/${file.name}`, file];
      })
    ]);
    manifest = null;
    if (start) start.disabled = true;
    if (!sourceFiles.length || !manifestFiles.length || !pageFiles.length) {
      if (summary) summary.textContent = 'Select the source PDFs, manifest, and page PDFs to check the batch inventory.';
      return;
    }
    const manifests = manifestFiles.filter((file) => file.name.toLowerCase() === 'manifest.json');
    if (manifests.length !== 1) {
      if (summary) summary.textContent = 'Select exactly one file named manifest.json.';
      return;
    }
    try {
      const parsed = JSON.parse(await manifests[0].text());
      if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.pages) || !parsed.inventory) throw new Error('manifest does not contain the expected inventory');
      const expectedSources = new Set(parsed.sources.map((source) => String(source.fileName || '').toLowerCase()));
      const expectedPages = new Set(parsed.pages.map((page) => String(page.file || '')));
      const availablePages = new Set([...preparedFilesByPath.keys()].filter((path) => /^pages\/.+\.pdf$/i.test(path)));
      const sourceMatch = expectedSources.size === parsed.sources.length && expectedSources.size === sourceFilesByName.size && [...expectedSources].every((name) => sourceFilesByName.has(name));
      const pageMatch = expectedPages.size === parsed.pages.length && expectedPages.size === availablePages.size && [...expectedPages].every((path) => availablePages.has(path));
      const countMatch = parsed.inventory.sourceCount === parsed.sources.length && parsed.inventory.pageCount === parsed.pages.length;
      const sourceSizesMatch = parsed.sources.every((source) => sourceFilesByName.get(String(source.fileName).toLowerCase())?.size === Number(source.sizeBytes));
      const pageSizesMatch = parsed.pages.every((page) => preparedFilesByPath.get(String(page.file))?.size === Number(page.sizeBytes));
      if (!sourceMatch || !pageMatch || !countMatch || !sourceSizesMatch || !pageSizesMatch) {
        if (summary) summary.textContent = 'The selected files do not match the manifest inventory. Check the 13 source PDFs, manifest.json, and all PDFs inside the prepared pages folder.';
        return;
      }
      manifest = parsed;
      if (summary) summary.textContent = `${parsed.sources.length} original PDFs and ${parsed.pages.length} scanned pages match the manifest. ${parsed.inventory.needsReviewCount} pages are flagged for Accounts review.`;
      if (start) start.disabled = false;
    } catch (error) {
      if (summary) summary.textContent = `The manifest could not be read: ${error.message || 'invalid JSON'}.`;
    }
  }

  function quickXorHash(bytes) {
    const block = new Uint8Array(20);
    let bitOffset = 0;
    for (let offset = 0; offset < bytes.length; offset += 1) {
      const value = bytes[offset];
      const byteIndex = Math.floor(bitOffset / 8);
      const shift = bitOffset % 8;
      block[byteIndex] ^= (value << shift) & 0xff;
      if (shift > 0) block[(byteIndex + 1) % block.length] ^= value >>> (8 - shift);
      bitOffset = (bitOffset + 11) % 160;
    }
    let length = BigInt(bytes.length);
    for (let index = 0; index < 8; index += 1) {
      block[12 + index] ^= Number(length & 0xffn);
      length >>= 8n;
    }
    return btoa(Array.from(block, (byte) => String.fromCharCode(byte)).join(''));
  }

  async function verifyLocalFile(file, expected, label) {
    if (!file || file.size !== Number(expected.sizeBytes)) throw new Error(`${label} does not match the file size in manifest.json.`);
    status(`Verifying ${label} before upload…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const qx = quickXorHash(bytes);
    if (sha256 !== String(expected.sha256 || '').toLowerCase() || qx !== String(expected.quickXorHash || '')) {
      throw new Error(`${label} does not match the SHA-256 and QuickXorHash in manifest.json. No upload was started.`);
    }
  }

  function pageImportEntry(page) {
    return {
      recordId: page.recordId,
      batchId: manifest.batchId,
      sourceFile: page.sourceFile,
      sourceSha256: page.sourceSha256,
      sourceQuickXorHash: page.sourceQuickXorHash,
      sourcePage: page.sourcePage,
      cardType: page.cardType,
      sizeBytes: page.sizeBytes,
      sha256: page.sha256,
      quickXorHash: page.quickXorHash,
      candidates: page.candidates,
      ocrText: page.ocrText,
      meanOcrConfidence: page.meanOcrConfidence,
      reviewState: page.reviewState,
      reviewReasons: page.reviewReasons
    };
  }

  function setCounts(uploadedSources, importedPages, totalPages) {
    const progress = $('#job-card-import-progress');
    const counts = $('#job-card-import-counts');
    if (progress) { progress.max = totalPages; progress.value = importedPages; }
    if (counts) counts.textContent = `${uploadedSources} of ${manifest?.sources?.length || 0} original PDFs uploaded · ${importedPages} of ${totalPages} page records indexed.`;
  }

  async function importBatch() {
    if (busy || !manifest) return;
    const button = $('#job-card-import-start');
    busy = true;
    if (button) { button.disabled = true; button.textContent = 'Importing…'; }
    const totalPages = manifest.pages.length;
    let uploadedSources = 0;
    let importedPages = 0;
    setCounts(uploadedSources, importedPages, totalPages);
    try {
      for (const source of manifest.sources) {
        const file = sourceFilesByName.get(source.fileName.toLowerCase());
        await verifyLocalFile(file, source, source.fileName);
      }
      for (const page of manifest.pages) {
        const file = preparedFilesByPath.get(page.file);
        if (!file) throw new Error(`The prepared page file for ${page.sourceFile} page ${page.sourcePage} is unavailable.`);
        await verifyLocalFile(file, page, `${page.sourceFile} page ${page.sourcePage}`);
      }
      const batchSources = manifest.sources.map((source) => ({
        fileName: source.fileName, pageCount: source.pageCount, sizeBytes: source.sizeBytes,
        sha256: source.sha256, quickXorHash: source.quickXorHash
      }));
      await window.GMTPortalApi.startJobCardImportBatch({
        batchId: manifest.batchId, sourceCount: batchSources.length,
        pageCount: totalPages, sources: batchSources
      });
      let batchStatus = await window.GMTPortalApi.jobCardImportBatchStatus(manifest.batchId);
      const uploaded = new Set(batchStatus.uploadedSources || []);
      uploadedSources = uploaded.size;
      setCounts(uploadedSources, 0, totalPages);
      if (batchStatus.status !== 'source-complete' && batchStatus.status !== 'pages-complete') {
        for (const source of manifest.sources) {
          if (uploaded.has(source.fileName)) continue;
          const file = sourceFilesByName.get(source.fileName.toLowerCase());
          status(`Creating a SharePoint session for original ${source.fileName}…`);
          const session = await window.GMTPortalApi.createJobCardUploadSession({
            purpose: 'source-batch', batchId: manifest.batchId, fileName: source.fileName,
            pageCount: source.pageCount, sizeBytes: source.sizeBytes, sha256: source.sha256,
            quickXorHash: source.quickXorHash
          });
          await window.GMTPortalApi.uploadJobCardFile(file, session.uploadUrl, (sent, total) => status(`Uploading original ${source.fileName}: ${Math.round((sent / total) * 100)}%`));
          const completed = await window.GMTPortalApi.completeJobCardSourceUpload(session.sessionId);
          uploadedSources = Number(completed.uploadedSourceCount) || (uploadedSources + 1);
          setCounts(uploadedSources, 0, totalPages);
        }
        batchStatus = await window.GMTPortalApi.jobCardImportBatchStatus(manifest.batchId);
        if (batchStatus.status !== 'source-complete' && batchStatus.status !== 'pages-complete') throw new Error('SharePoint has not confirmed every original PDF. Retry the batch to continue.');
      }

      const imported = new Set(batchStatus.importedRecordIds || []);
      importedPages = imported.size;
      setCounts(uploadedSources, importedPages, totalPages);
      for (const [index, page] of manifest.pages.entries()) {
        if (imported.has(page.recordId)) continue;
        const file = preparedFilesByPath.get(page.file);
        if (!file) throw new Error(`The prepared page file for ${page.sourceFile} page ${page.sourcePage} is unavailable.`);
        status(`Creating a SharePoint session for page ${index + 1} of ${totalPages}…`);
        const session = await window.GMTPortalApi.createJobCardUploadSession({
          purpose: 'job-card-page', batchId: manifest.batchId, manifestEntry: pageImportEntry(page)
        });
        await window.GMTPortalApi.uploadJobCardFile(file, session.uploadUrl, (sent, total) => status(`Uploading page ${index + 1} of ${totalPages}: ${Math.round((sent / total) * 100)}%`));
        await window.GMTPortalApi.importJobCardPage(session.sessionId);
        importedPages += 1;
        imported.add(page.recordId);
        setCounts(uploadedSources, importedPages, totalPages);
      }
      status(`Archive import complete. ${totalPages} page records are searchable; ${manifest.inventory.needsReviewCount} are flagged for Accounts review.`);
    } catch (error) {
      status(`${error?.message || 'The scanned job-card archive could not be imported.'} Completed files are recorded by the batch and will be skipped on retry.`);
    } finally {
      busy = false;
      if (button) { button.disabled = false; button.textContent = 'Retry or continue import'; }
    }
  }

  async function initialize() {
    const main = $('#job-card-import-main');
    const denied = $('#job-card-import-denied');
    status('Checking Accounts access…');
    try {
      const access = await window.GMTPortalApi.jobCardArchiveAccess();
      if (!access?.canImport) {
        if (main) main.hidden = true;
        if (denied) denied.hidden = false;
        return;
      }
      if (main) main.hidden = false;
      ['#job-card-source-folder', '#job-card-manifest-file', '#job-card-page-files'].forEach((selector) => $(selector)?.addEventListener('change', inspectSelectedFiles));
      $('#job-card-import-start')?.addEventListener('click', importBatch);
      status('Accounts access verified. Select the archive files to begin.');
    } catch (error) {
      if (main) main.hidden = true;
      if (denied) denied.hidden = false;
      status(error?.message || 'Accounts access could not be verified.');
    }
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
