import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalCss = await readFile(new URL('../portal.css', import.meta.url), 'utf8');
const stylesCss = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const numberField = portalCss.match(/\.job-sheet-number\s*\{([^}]*)\}/)?.[1] || '';
const reference = portalCss.match(/\.job-sheet-number\s+strong\s*\{([^}]*)\}/)?.[1] || '';
const miniSummary = stylesCss.match(/\.day-mini-summary\s*\{([^}]*)\}/)?.[1] || '';

assert.match(numberField, /min-width:\s*0/, 'the job-card number grid can shrink inside its preview');
assert.match(reference, /overflow-wrap:\s*anywhere/, 'long unbroken job-card references wrap instead of extending the page');
assert.match(reference, /min-width:\s*0/, 'the reference text can shrink within its grid cell');
assert.match(miniSummary, /white-space:\s*normal/, 'collapsed timesheet summaries wrap so their details remain visible');
assert.doesNotMatch(miniSummary, /overflow:\s*hidden|text-overflow:\s*ellipsis/, 'collapsed timesheet summaries do not silently truncate details');

console.log('Job-card references and collapsed timesheet summaries wrap without truncation: PASS');
