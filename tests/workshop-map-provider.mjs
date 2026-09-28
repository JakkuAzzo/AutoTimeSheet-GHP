import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'public-site-mapfix-20260928.js'), 'utf8');
const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(
  source,
  /https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Street_Map\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/,
  'the workshop map must use the keyless Esri street tile endpoint'
);
assert.doesNotMatch(
  source,
  /basemaps\.cartocdn\.com\/light_all/,
  'the workshop map must not use the CARTO tile endpoint that renders an API-key placeholder'
);
assert.match(source, /Tiles\s*&copy; Esri/, 'the live tile layer must retain Esri attribution');
assert.match(homepage, /public-site-mapfix-20260928\.js/, 'the homepage must bypass the cached old script asset');

console.log('Workshop map provider contract passed.');
