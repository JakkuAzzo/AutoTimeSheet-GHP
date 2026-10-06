import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedPages = [
  'services/',
  'services/electric-motor-rewinds-croydon/',
  'services/electrical-motor-repair/',
  'services/pump-repairs-london/',
  'services/fan-repairs-croydon/',
  'services/extractor-fan-repairs-restaurants/',
  'services/gearbox-repairs-south-london/',
  'services/ac-motor-rewinding-uk/',
  'services/dc-motor-rewinding-london/',
  'services/testing-diagnostics/',
  'services/balancing/',
  'services/component-manufacturing/',
  'services/on-site-engineering/',
  'services/breakdown-enquiries/',
  'process/',
  'process/electric-motor-repair/',
  'process/pump-repair/',
  'process/fan-extractor-servicing/',
  'process/gearbox-refurbishment/'
];

const homepage = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const sitemap = fs.readFileSync(path.join(repo, 'sitemap.xml'), 'utf8');
const robots = fs.readFileSync(path.join(repo, 'robots.txt'), 'utf8');
const titles = new Set();
const serviceIndex = fs.readFileSync(path.join(repo, 'services/index.html'), 'utf8');
const processIndex = fs.readFileSync(path.join(repo, 'process/index.html'), 'utf8');
const publicSiteScript = fs.readFileSync(path.join(repo, 'public-site-mapfix-20260928.js'), 'utf8');

assert.match(homepage, /Specialist Motor, Pump, Fan &amp; Gearbox Repairs/i);
assert.match(homepage, /Why Choose GMT\?/i);
assert.match(homepage, /id="services"/);
assert.doesNotMatch(homepage, /Trusted Across London|useful turnaround/i,
  'Unverified trust and turnaround claims must stay out of public copy');
assert.match(homepage, /public-site-mapfix-20260928\.js\?v=carousel-track-20261006-v1/);
assert.match(homepage, /href="#services"/,
  'The homepage service navigation must target the service carousel');
assert.match(homepage, /href="\/process\/"/);
assert.equal((homepage.match(/class="button primary service-enquiry-link" href="\/#workshop-enquiry" data-enquire-nav/g) || []).length, 9,
  'Each homepage service card must have an enquiry button wired to open the mobile form');
assert.equal((homepage.match(/class="service-benefit"/g) || []).length, 9,
  'Each homepage service card must state a customer benefit');
assert.match(publicSiteScript, /querySelectorAll\(['"]\[data-enquire-nav\], \[data-service-enquiry-open\]['"]\)/,
  'Every homepage enquiry navigation control must be wired');
assert.match(publicSiteScript, /window\.location\.hash\s*===\s*['"]#workshop-enquiry['"]/,
  'Direct links from service pages must open the homepage enquiry form');

for (const route of expectedPages) {
  const file = path.join(repo, route, 'index.html');
  assert.ok(fs.existsSync(file), `Missing marketing page: ${route}`);
  const html = fs.readFileSync(file, 'utf8');
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1];
  assert.ok(title && title.length > 20, `Missing useful title: ${route}`);
  assert.ok(!titles.has(title), `Duplicate title: ${title}`);
  titles.add(title);
  assert.ok(description && description.length > 60, `Missing useful description: ${route}`);
  assert.match(html, /<h1\b/i, `Missing page heading: ${route}`);
  assert.match(html, /class="skip-link"/, `Missing skip link: ${route}`);
  assert.match(html, /rel="canonical"/, `Missing canonical URL: ${route}`);
  assert.match(html, /#workshop-enquiry/, `Missing enquiry CTA: ${route}`);
  if (route !== 'services/' && route !== 'process/') {
    const indexPage = route.startsWith('services/') ? serviceIndex : processIndex;
    assert.match(indexPage, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `Directory page must link to ${route}`);
  }
  assert.match(sitemap, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `Sitemap must list ${route}`);
  assert.doesNotMatch(html, /\b(?:24[- ]hour|same[- ]day|48[- ]hour|ATEX|flameproof|1,000\s*kW|10[-–]30%|3[-–]5x|OEM[- ]standard|£\s?4,800)\b/i,
    `Unapproved performance or compliance claim found on ${route}`);
  for (const asset of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) {
    assert.ok(fs.existsSync(path.join(repo, asset[1].slice(1))), `Missing page asset ${asset[1]} on ${route}`);
  }
}

assert.match(robots, /Sitemap:\s*https:\/\/gmt-services\.co\.uk\/sitemap\.xml/i);

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gmt-marketing-pages-'));
try {
  execFileSync(process.execPath, ['tools/build-cloudflare-pages.mjs', output], { cwd: repo, stdio: 'pipe' });
  assert.ok(fs.existsSync(path.join(output, 'services', 'index.html')));
  assert.ok(fs.existsSync(path.join(output, 'process', 'index.html')));
  assert.ok(fs.existsSync(path.join(output, 'sitemap.xml')));
  assert.ok(fs.existsSync(path.join(output, 'robots.txt')));
  for (const route of expectedPages) assert.ok(fs.existsSync(path.join(output, route, 'index.html')), `Cloudflare bundle missing ${route}`);
  for (const route of expectedPages) {
    const html = fs.readFileSync(path.join(output, route, 'index.html'), 'utf8');
    assert.match(html, /href="\/public-site\.css\?/);
    assert.ok(fs.existsSync(path.join(output, 'public-site.css')));
  }
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

console.log(`Public marketing pages: PASS (${expectedPages.length} routes)`);
