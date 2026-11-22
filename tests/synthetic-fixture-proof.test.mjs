import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifySyntheticFixtureBytes } from '../cloudflare-worker/src/synthetic-portal-fixture.js';

test('the isolated service verifies the actual uploaded bytes, not a supplied digest', async () => {
  const bytes=fs.readFileSync('tests/fixtures/GMT-FICTIONAL-PORTAL-UPLOAD.json');
  assert.equal(await verifySyntheticFixtureBytes(bytes),true);
  const changed=Buffer.from(bytes);changed[changed.length-2]^=1;
  assert.equal(await verifySyntheticFixtureBytes(changed),false);
  assert.equal(await verifySyntheticFixtureBytes(Buffer.alloc(4097)),false);
  assert.equal(await verifySyntheticFixtureBytes(new Uint8Array()),false);
});
