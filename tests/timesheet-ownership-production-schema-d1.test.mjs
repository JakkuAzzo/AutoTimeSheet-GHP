import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Uses schema metadata only, plus fictional rows. It never connects remotely.
test('ordered ownership migrations preserve legacy rows and invalidate reviews in local D1',
 {skip:!process.env.GMT_LOCAL_WRANGLER||!process.env.GMT_PRODUCTION_SCHEMA,timeout:30000},()=>{
 const schema=JSON.parse(readFileSync(process.env.GMT_PRODUCTION_SCHEMA,'utf8')).objects;
 const names=['records','dispatch_queue','record_versions','record_attachments'];
 const create=names.map(name=>{const item=schema.find(x=>x.type==='table'&&x.name===name);assert.ok(item?.sql);return item.sql+';'}).join('\n');
 const dir=mkdtempSync(path.join(tmpdir(),'gmt-ownership-d1-'));
 const config=path.join(dir,'wrangler.json'),database=path.join(dir,'state'),file=path.join(dir,'init.sql');
 writeFileSync(config,JSON.stringify({name:'gmt-local-ownership-rehearsal',compatibility_date:'2026-09-10',d1_databases:[{binding:'DB',database_name:'fictional',database_id:'11111111-1111-4111-8111-111111111111'}]}));
 const initial=`${create}\nINSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json) VALUES ('fictional','editor','editor@example.test','Fictional','timesheets','pay_month_correction','Queued for Accounts','t','t','{}');\nINSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at) VALUES('fictional','queued','t','t',0,'t');\nINSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at) VALUES('fictional','attachment_record','fictional.json','application/json','e30=',2,'t');`;
 const run=(...args)=>JSON.parse(execFileSync(process.execPath,[process.env.GMT_LOCAL_WRANGLER,'d1','execute','fictional','--local','--config',config,'--persist-to',database,'--json',...args],{encoding:'utf8',maxBuffer:8*1024*1024}));
 try{
  writeFileSync(file,initial);run('--file',file,'--yes');
  const migrationsDir=fileURLToPath(new URL('../cloudflare-worker/migrations/',import.meta.url));
  const migrations=readdirSync(migrationsDir).filter(name=>/^00(?:18|19|2[0-8])_.*\.sql$/.test(name)).sort();
  assert.equal(migrations.length,11);
  writeFileSync(file,migrations.map(name=>readFileSync(path.join(migrationsDir,name),'utf8')).join('\n'));
  run('--file',file,'--yes');
  const query=sql=>run('--command',sql).flatMap(result=>result.results||[]);
  const before=query("SELECT r.owner_oid,r.payload_json,q.status,q.attempts,a.content_base64,v.revision FROM records r JOIN dispatch_queue q USING(record_id) JOIN record_attachments a USING(record_id) JOIN timesheet_review_record_revisions v USING(record_id) WHERE r.record_id='fictional'");
  assert.deepEqual(before,[{owner_oid:'editor',payload_json:'{}',status:'queued',attempts:0,content_base64:'e30=',revision:1}]);
  query(`INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at) VALUES ('fictional',1,'${'a'.repeat(64)}','fictional-subject','fictional-reviewer','fictional','t')`);
  query("UPDATE records SET payload_json='{\"fictional\":true}' WHERE record_id='fictional'");
  const events=query("SELECT event_type FROM timesheet_ownership_review_events ORDER BY event_id");
  assert.deepEqual(events.map(x=>x.event_type),['adopted','invalidated']);
  assert.deepEqual(query("SELECT revision FROM timesheet_review_record_revisions WHERE record_id='fictional'"),[{revision:2}]);
  assert.deepEqual(query("SELECT status,attempts FROM dispatch_queue WHERE record_id='fictional'"),[{status:'queued',attempts:0}]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
