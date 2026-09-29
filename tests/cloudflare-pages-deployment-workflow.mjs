import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repo, '.github', 'workflows', 'deploy-cloudflare-pages.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /contents:\s*read/);
assert.match(workflow, /deployments:\s*write/);
assert.match(workflow, /npm run test:pages:public-root/);
assert.match(workflow, /tools\/build-cloudflare-pages\.mjs \.\/dist\/gmt-pages/);
assert.match(workflow, /cloudflare\/wrangler-action@v4/);
assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
assert.match(workflow, /pages deploy \.\/dist\/gmt-pages --project-name=gmt-timesheets --branch=main/);
assert.match(workflow, /github\.token/);

console.log('Cloudflare Pages GitHub deployment workflow contract: PASS');
