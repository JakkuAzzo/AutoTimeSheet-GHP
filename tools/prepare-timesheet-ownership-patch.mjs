// Build an auditable, narrow ownership-review patch over the captured deployed
// version. This prepares local code only; it does not upload or deploy it.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const expected='97858bb28c2ee8a9f1ec91b1632a281f1c9d6efee72da764b1ccd67e2f3bc147';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const [baselinePath,outputPath]=process.argv.slice(2);
if(!baselinePath||!outputPath||baselinePath===outputPath)throw Error('Provide separate baseline and output paths');
const bytes=await readFile(baselinePath);
if(sha(bytes)!==expected)throw Error('Deployed baseline does not match the reviewed version');
const baseline=bytes.toString('utf8');
const local=await readFile(fileURLToPath(new URL('../cloudflare-worker/src/index.js',import.meta.url)),'utf8');
const start='// This review trail alone does not grant access to a record, its older versions';
const end='function canonicalSourceFields(fields) {';
const first=local.indexOf(start),last=local.indexOf(end,first);
if(first<0||last<0||local.indexOf(start,first+1)!==-1)throw Error('Ownership source boundary is ambiguous');
const lookupStart='async function timesheetReviewSubjectLookup(request,env,identity,origin) {';
const lookupEnd='// Internal only. The caller must independently authorise the requester and';
const lookupFirst=local.indexOf(lookupStart),lookupLast=local.indexOf(lookupEnd,lookupFirst);
if(lookupFirst<0||lookupLast<0||local.indexOf(lookupStart,lookupFirst+1)!==-1)throw Error('Directory lookup boundary is ambiguous');
// The captured production bundle renamed the index module helper to text2.
const lookup=local.slice(lookupFirst,lookupLast).replace("name:text(user.displayName,'',200)","name:text2(user.displayName,'',200)");
const functions=local.slice(first,last)+'\n'+lookup;
for(const name of ['requireTimesheetOwnershipReviewer','timesheetReviewSnapshot','timesheetOwnershipReviewEndpoint','timesheetReviewSubjectLookup']){
 if(!functions.includes('function '+name+'(')||baseline.includes('function '+name+'('))throw Error('Ownership function boundary is unexpected');
}
const entry='async function handle(request, env, ctx) {';
const anchor='  const offsiteClockResponse = await offsiteClockEndpoint(request, env, identity, readJson);';
const access='      canManagePayMonthStarts: identity.canManagePayMonthStarts,';
for(const part of [entry,anchor,access])if(baseline.indexOf(part)<0||baseline.indexOf(part)!==baseline.lastIndexOf(part))throw Error('Production handler boundary is ambiguous');
const route=`  const ownershipMatch = url.pathname.match(/^\\/api\\/admin\\/timesheet-ownership-review\\/([^/]+)(\\/revoke)?$/);\n  if (ownershipMatch && ((!ownershipMatch[2] && ["GET", "POST"].includes(request.method)) || (ownershipMatch[2] && request.method === "POST"))) {\n    return timesheetOwnershipReviewEndpoint(request, env, identity, decodeURIComponent(ownershipMatch[1]), origin || "", Boolean(ownershipMatch[2]));\n  }\n  if (url.pathname === "/api/admin/timesheet-review-subject" && request.method === "GET") return timesheetReviewSubjectLookup(request, env, identity, origin || "");\n`;
const output=baseline.replace(entry,functions+'\n'+entry).replace(anchor,route+anchor).replace(access,access+'\n      canReviewTimesheetOwnership: identity.isAdmin === true && identity.isTimesheetViewer === true && Boolean(identity.oid),');
await writeFile(outputPath,output,{flag:'wx',mode:0o600});
console.log(JSON.stringify({baselineSha256:expected,outputSha256:sha(output),ownershipSourceSha256:sha(functions),outputPath}));
