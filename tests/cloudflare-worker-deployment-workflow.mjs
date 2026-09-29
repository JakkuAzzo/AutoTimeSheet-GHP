import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(repo, '.github', 'workflows', 'deploy-cloudflare-worker.yml'), 'utf8');

assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /cloudflare-worker\/\*\*|paths:/);
assert.match(workflow, /cloudflare\/wrangler-action@v4/);
assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
assert.match(workflow, /d1 migrations apply gmt-portal --remote/);
assert.match(workflow, /command:\s*deploy --config cloudflare-worker\/wrangler\.toml/);
assert.match(workflow, /npm run test:xero:integration-contract/);

console.log('Cloudflare Worker GitHub deployment workflow contract: PASS');
