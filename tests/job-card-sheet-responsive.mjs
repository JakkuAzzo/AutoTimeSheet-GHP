import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const portalCss = await readFile(new URL('../portal.css', import.meta.url), 'utf8');
const stylesCss = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
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

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  const longReference = `jobcard-${'a'.repeat(64)}-0001`;
  await page.setContent(`<!doctype html><html><head><style>${stylesCss}\n${portalCss}</style></head><body>
    <main class="app-main"><section class="app-card"><div class="job-card-preview"><article class="job-card-sheet job-card-sheet-mta">
      <div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt=""><span class="job-sheet-brand job-sheet-brand-wide">GMT Electrical Services Ltd.</span></div>
      <div class="job-sheet-number"><span>MTA No.</span><strong>${longReference}</strong></div></div>
    </article></div></section></main></body></html>`);

  const viewports = [[320, 568], [390, 844], [667, 375], [768, 1024], [1280, 720], [1440, 900]];
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
} finally {
  await browser.close();
}

console.log('Job-card references and collapsed timesheet summaries wrap without truncation; six viewport sizes pass: PASS');
