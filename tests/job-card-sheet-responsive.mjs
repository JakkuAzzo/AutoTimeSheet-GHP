import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const portalCss = await readFile(new URL('../portal.css', import.meta.url), 'utf8');
const stylesCss = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const estimateCss = await readFile(new URL('../tools/estimates.css', import.meta.url), 'utf8');
const jobsPageHtml = await readFile(new URL('../jobs/index.html', import.meta.url), 'utf8');
const numberField = portalCss.match(/\.job-sheet-number\s*\{([^}]*)\}/)?.[1] || '';
const reference = portalCss.match(/\.job-sheet-number\s+strong\s*\{([^}]*)\}/)?.[1] || '';
const miniSummary = stylesCss.match(/\.day-mini-summary\s*\{([^}]*)\}/)?.[1] || '';
const mobileStyles = portalCss.slice(portalCss.indexOf('@media (max-width: 700px)'));
const mobileTopline = mobileStyles.match(/\.job-sheet-topline\s*\{([^}]*)\}/)?.[1] || '';
const mobileNumber = mobileStyles.match(/\.job-sheet-number\s*\{([^}]*)\}/)?.[1] || '';

assert.match(numberField, /min-width:\s*0/, 'the job-card number grid can shrink inside its preview');
assert.match(reference, /overflow-wrap:\s*anywhere/, 'long unbroken job-card references wrap instead of extending the page');
assert.match(reference, /min-width:\s*0/, 'the reference text can shrink within its grid cell');
assert.match(mobileTopline, /display:\s*grid/, 'mobile job-card headers use bounded grid columns instead of flex intrinsic sizing');
assert.match(mobileTopline, /grid-template-columns:\s*minmax\(0,\s*[\d.]+fr\)\s+minmax\(0,\s*[\d.]+fr\)/, 'both mobile header columns can shrink below long-reference min-content width');
assert.match(mobileNumber, /min-width:\s*0/, 'the mobile job-card number can shrink below its prior fixed minimum');
assert.match(miniSummary, /white-space:\s*normal/, 'collapsed timesheet summaries wrap so their details remain visible');
assert.doesNotMatch(miniSummary, /overflow:\s*hidden|text-overflow:\s*ellipsis/, 'collapsed timesheet summaries do not silently truncate details');
assert.match(jobsPageHtml, /portal\.css\?v=portal-responsive-layout-20261016-v4/, 'job history loads the cache-busted portal stylesheet that contains its shrinkable layout');

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  const longReference = `jobcard-${'a'.repeat(64)}-0001`;
  const viewports = [[320, 568], [390, 844], [667, 375], [768, 1024], [1280, 720], [1440, 900]];
  const historyReference = `jobcard-${'b'.repeat(64)}-0001`;
  await page.setContent(`<!doctype html><html><head><style>${stylesCss}\n${portalCss}\n${estimateCss}</style></head><body>
    <main class="app-main"><section class="card estimate-history-panel"><div class="estimate-history-layout job-card-history-layout">
      <div class="estimate-history-list"><button class="estimate-history-item"><strong>${historyReference}</strong><span>Customer</span><small>MTA card · no date · Archived</small></button></div>
      <article class="job-card-history-preview">Select a card</article><section class="record-invoice-links card">Invoices</section>
    </div></section></main></body></html>`);

  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const history = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      };
      const root = document.documentElement;
      const reference = document.querySelector('.estimate-history-item strong');
      return {
        viewport: innerWidth,
        document: { client: root.clientWidth, scroll: root.scrollWidth },
        layoutDisplay: getComputedStyle(document.querySelector('.job-card-history-layout')).display,
        list: rect('.estimate-history-list'),
        reference: rect('.estimate-history-item strong'),
        referenceOverflow: reference.scrollWidth > reference.clientWidth + 1,
        referenceText: reference.textContent
      };
    });
    assert.equal(history.document.scroll, history.document.client, `${width}px job-card history has no horizontal page overflow`);
    assert.equal(history.layoutDisplay, 'grid', `${width}px job-card history uses its responsive grid layout`);
    assert.ok(history.list.left >= -1 && history.list.right <= width + 1, `${width}px job-card list remains inside the screen`);
    assert.ok(history.reference.left >= history.list.left && history.reference.right <= history.list.right + 1, `${width}px full history reference stays inside the list`);
    assert.equal(history.referenceText, historyReference, `${width}px full history reference remains available`);
    assert.equal(history.referenceOverflow, false, `${width}px history reference wraps without clipping`);
  }

  await page.setContent(`<!doctype html><html><head><style>${stylesCss}\n${portalCss}</style></head><body>
    <main class="app-main"><section class="app-card"><div class="job-card-preview"><article class="job-card-sheet job-card-sheet-mta">
      <div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt=""><span class="job-sheet-brand job-sheet-brand-wide">GMT Electrical Services Ltd.</span></div>
      <div class="job-sheet-number"><span>MTA No.</span><strong>${longReference}</strong></div></div>
    </article></div></section></main></body></html>`);

  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height };
      };
      return {
        viewport: innerWidth,
        document: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
        sheet: rect('.job-card-sheet'),
        topline: getComputedStyle(document.querySelector('.job-sheet-topline')).display,
        reference: rect('.job-sheet-number strong'),
        referenceText: document.querySelector('.job-sheet-number strong').textContent,
        referenceOverflow: document.querySelector('.job-sheet-number strong').scrollWidth > document.querySelector('.job-sheet-number strong').clientWidth + 1
      };
    });
    assert.equal(layout.document.scroll, layout.document.client, `${width}px job-card preview has no horizontal page overflow`);
    assert.ok(layout.sheet.left >= -1 && layout.sheet.right <= width + 1, `${width}px paper preview stays within the screen`);
    assert.ok(layout.reference.left >= layout.sheet.left && layout.reference.right <= layout.sheet.right + 1, `${width}px full job reference stays inside the paper preview`);
    assert.equal(layout.referenceText, longReference, `${width}px full job reference remains available`);
    assert.equal(layout.referenceOverflow, false, `${width}px long job reference wraps without clipping`);
    if (width <= 700) assert.equal(layout.topline, 'grid', `${width}px job-card header uses shrinkable grid columns`);
  }

  await page.setContent(`<!doctype html><html><head><style>${stylesCss}\n${portalCss}\n${estimateCss}</style></head><body>
    <header class="app-header portal-header"><div class="brand-block"><div><p class="eyebrow">GMT Accounts</p><h1>Invoices</h1></div></div>
      <nav class="header-actions"><span class="portal-identity-name">acc.gmtelect@outlook.com</span><a href="/portal/">Dashboard</a><button id="portal-sign-out">Sign out</button></nav>
    </header>
    <main class="app-main estimate-main"><section class="estimate-intro card xero-invoice-intro"><div><p class="portal-card-kicker">Accounts-only workflow</p><h2>Invoices in Xero</h2><p>GMT Accounts invoice access.</p></div>
      <div class="xero-connection-summary"><span class="estimate-status-chip">Not connected</span><div class="xero-connections"><p class="portal-history-empty">No Xero organisation is connected.</p></div>
        <div class="xero-connection-controls"><button class="secondary">Refresh from Xero</button><button class="button button-link">Connect Xero</button></div>
      </div></section></main></body></html>`);

  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      };
      const identity = document.querySelector('.portal-identity-name');
      const controls = document.querySelector('.xero-connection-controls');
      const summary = document.querySelector('.xero-connection-summary');
      return {
        document: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
        identity: { rect: rect('.portal-identity-name'), client: identity.clientWidth, scroll: identity.scrollWidth,
          whiteSpace: getComputedStyle(identity).whiteSpace, textOverflow: getComputedStyle(identity).textOverflow,
          text: identity.textContent },
        controls: rect('.xero-connection-controls'), summary: rect('.xero-connection-summary'),
        intro: rect('.xero-invoice-intro')
      };
    });
    assert.equal(layout.document.scroll, layout.document.client, `${width}px portal header and invoice introduction do not widen the page`);
    assert.ok(layout.controls.left >= layout.summary.left - 1 && layout.controls.right <= layout.summary.right + 1,
      `${width}px Xero connection actions stay inside their summary`);
    assert.ok(layout.controls.left >= 0 && layout.controls.right <= width + 1,
      `${width}px Xero connection actions stay inside the viewport`);
    assert.equal(layout.identity.scroll <= layout.identity.client + 1, true, `${width}px signed-in account name is fully visible`);
    assert.equal(layout.identity.whiteSpace, 'normal', `${width}px signed-in account name can wrap instead of truncating`);
    assert.equal(layout.identity.textOverflow, 'clip', `${width}px signed-in account name does not use an ellipsis`);
    assert.equal(layout.identity.text, 'acc.gmtelect@outlook.com', `${width}px full signed-in account name remains in the portal`);
  }
} finally {
  await browser.close();
}

console.log('Job-card references and collapsed timesheet summaries wrap without truncation; six viewport sizes pass: PASS');
