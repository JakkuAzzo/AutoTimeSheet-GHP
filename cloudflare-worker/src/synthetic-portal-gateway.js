// Test-only entry point. It is not selected by the production Worker config.
// Only the fixed fictional correction and its verified attachments may be
// queued. Normal dispatch and the scheduled sender remain disabled.
import baseWorker, { authenticateToken, readBoundedJson, constantTimeEqual, readLocalPayMonthSnapshot, validateCompletePayMonthSource } from './index.js';
import { syntheticFixture, verifySyntheticFixtureBytes, validateSyntheticTarget, validateSyntheticCorrection, validateSyntheticAttachments } from './synthetic-portal-fixture.js';
import { rateFixture, verifyRateFixtureBytes, validateRateTarget, validateRateCorrection, validateRateAttachments } from './synthetic-rate-fixture.js';
import { syntheticQueueCapability } from './synthetic-queue-capability.js';
import { claimSyntheticDelivery, claimBoundSyntheticDelivery, finishSyntheticDelivery, finishBoundSyntheticDelivery } from './synthetic-delivery-handoff.js';
import { bindPublicationFlow, readPublicationSourceForRun } from './timesheet-source-publication-guard.js';
import { verifyBoundSyntheticWorkbook } from './synthetic-bound-workbook-readback.js';

const tenant = '8b182d6b-6f34-4ca2-84ad-50ca712b5488';
const audience = '01b5a6c6-f6c1-47cb-aebe-67f07f415e4b';
const origin = 'http://localhost:4179';
const parent = '01ZURLVFJFVBSV44GD4RA35FCIVFNDWPGP';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reads = new Set(['/api/profile', '/api/access', '/api/history', '/api/pay-month-starts']);
const writes = new Set(['/api/synthetic-fixture-proof', '/api/synthetic-fixture-invalidate', '/api/document-import/timesheet-target', '/api/records']);
const callbacks = new Set(['/api/integrations/private-timesheet-route', '/api/integrations/timesheet-delivery-receipts']);
const legacySpec=Object.freeze({fixture:syntheticFixture,verifyBytes:verifySyntheticFixtureBytes,validateTarget:validateSyntheticTarget,validateCorrection:validateSyntheticCorrection,validateAttachments:validateSyntheticAttachments,marker:'gmt-timesheet-portal-e2e-20261116',workbookId:'01ZURLVFK4SR4OYCGN4NDLSRLLGWGBEDXH',rate:false});
// Deliberately not a provider item ID. A rate-aware provider test needs a new,
// separately reviewed destination and must change this build-only pin first.
const rateSpec=Object.freeze({fixture:rateFixture,verifyBytes:verifyRateFixtureBytes,validateTarget:validateRateTarget,validateCorrection:validateRateCorrection,validateAttachments:validateRateAttachments,marker:'gmt-timesheet-rate-build-only',workbookId:'RATE-DESTINATION-NOT-PROVISIONED',rate:true});
// This entry point is used only by the separately deployed fictional rate
// test. It is pinned to a different restricted folder and workbook.
const providerRateSpec=Object.freeze({...rateSpec,marker:'gmt-timesheet-rate-provider-20261119',parentId:'01ZURLVFIIINPOKIYCCZEJFTFMCUTRGBUL',employeeFolderId:'01ZURLVFLBUIMATW7STNBLMXO3VGLMSTCB',monthFolderId:'01ZURLVFOCW3CCKIKQRZFJYU6JYYWSK3UK',workbookId:'01ZURLVFKFZ6PPD3U36RHLN74B2KFNIR4F',rateMode:'provider-fixture-v1',actorOid:'084af2b4-4427-4986-b7e0-ec163c520282',subjectOid:'bb420999-c705-4dc2-9b0e-33846b43ae2c'});
const same = (a, b) => String(a || '').trim().toLowerCase() === b.toLowerCase();
const failure = (status, request) => new Response(null, { status, headers: {
  'Cache-Control': 'no-store', ...(request.headers.get('Origin') === origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {})
} });

async function readFixtureBytes(request) {
  const length=Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length<0 || length>4096) throw new Error('too large');
  const reader=request.body?.getReader(), chunks=[];
  let size=0;
  if (reader) while (true) {
    const part=await reader.read();
    if (part.done) break;
    size+=part.value.byteLength;
    if (size>4096) { await reader.cancel(); throw new Error('too large'); }
    chunks.push(part.value);
  }
  const result=new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { result.set(chunk,offset); offset+=chunk.byteLength; }
  return result;
}

async function isolated(env,spec) {
  if (env.SYNTHETIC_TEST_SERVICE_ENABLED!=='true' || !same(env.ENTRA_TENANT_ID, tenant) || !same(env.ENTRA_AUDIENCES, audience) ||
      env.ALLOWED_ORIGINS !== origin || !uuid.test(String(env.SYNTHETIC_TEST_ALLOWED_OID || '')) || !uuid.test(String(env.SYNTHETIC_TEST_SUBJECT_OID || '')) ||
      env.PRIVATE_TIMESHEET_PARENT_ID !== (spec.parentId || parent) || String(env.DISPATCH_ENABLED) !== 'false' ||
      String(env.PAY_MONTH_REPLAY_READY) !== 'false' || String(env.DOCUMENT_IMPORT_SHARED_STORAGE_READY) !== 'false' ||
      env.SYNTHETIC_TEST_READ_ONLY_DESTINATION!=='true' || env.TIMESHEET_WORKBOOK_PROVISIONING_ENABLED!=='false' ||
      env.SYNTHETIC_TEST_EMPLOYEE_FOLDER_ID!==(spec.employeeFolderId || '01ZURLVFPFOELOEM7HDJB2SOQSB3IBWSRN') ||
      env.SYNTHETIC_TEST_MONTH_FOLDER_ID!==(spec.monthFolderId || '01ZURLVFLBI6XSXPOOSRCIKDR2EUSAR3I5') ||
      env.SYNTHETIC_TEST_WORKBOOK_ID!==spec.workbookId ||
      (spec.actorOid && !same(env.SYNTHETIC_TEST_ALLOWED_OID,spec.actorOid)) ||
      (spec.subjectOid && !same(env.SYNTHETIC_TEST_SUBJECT_OID,spec.subjectOid)) ||
      (spec.rate && (env.SYNTHETIC_RATE_TEST_MODE!==(spec.rateMode || 'build-only-v1') || env.PAY_MONTH_RATE_DELIVERY_READY!=='true')) ||
      env.HISTORY_UPSTREAM_URL || same(env.HISTORY_SOURCE, 'sharepoint')) return false;
  try {
    const row = await env.DB.prepare('SELECT marker FROM synthetic_test_environment WHERE marker = ?').bind(spec.marker).first();
    return row?.marker === spec.marker;
  } catch (_) { return false; }
}

function createGateway(delegate,spec) {
  const syntheticFixture=spec.fixture,verifySyntheticFixtureBytes=spec.verifyBytes,validateSyntheticTarget=spec.validateTarget,
    validateSyntheticCorrection=spec.validateCorrection,validateSyntheticAttachments=spec.validateAttachments;
  const attachmentPath='/api/records/'+encodeURIComponent(syntheticFixture.recordId)+'/attachments';
  return {
    async fetch(request, env, ctx) {
      if (!(await isolated(env,spec))) return failure(503, request);
      const url = new URL(request.url);
      if (['/api/synthetic-delivery/claim','/api/synthetic-delivery/claim-bound','/api/synthetic-delivery/finish','/api/synthetic-delivery/finish-bound','/api/synthetic-delivery/bind-run','/api/synthetic-delivery/read-source','/api/synthetic-delivery/verify-bound'].includes(url.pathname)) {
        // Power Automate's test connector forwards its browser Origin. Only
        // the explicitly pinned provider fixture accepts that exact origin.
        const source=request.headers.get('Origin');
        const connectorOrigin=spec===providerRateSpec && source==='https://make.powerautomate.com';
        const machineFailure=status=>connectorOrigin ? new Response(null,{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':source,Vary:'Origin'}}) : failure(status,request);
        if (request.method!=='POST' || (source && !connectorOrigin) || env.SYNTHETIC_TEST_QUEUE_ENABLED!=='true') return machineFailure(403);
        const boundMode=env.SYNTHETIC_TEST_BOUND_HANDOFF_ENABLED==='true';
        if ((['/api/synthetic-delivery/claim','/api/synthetic-delivery/finish'].includes(url.pathname) && boundMode) ||
            (!['/api/synthetic-delivery/claim','/api/synthetic-delivery/finish'].includes(url.pathname) && !boundMode)) return machineFailure(403);
        const configured=String(env.TIMESHEET_DELIVERY_CALLBACK_KEY||''),supplied=request.headers.get('X-GMT-Delivery-Key')||'';
        if (configured.length<32 || configured.length>500) return machineFailure(503);
        if (supplied.length>500 || !constantTimeEqual(supplied,configured)) return machineFailure(401);
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')) return machineFailure(415);
        let body;try {body=await readBoundedJson(request,4096);} catch (error) {return machineFailure(error?.status===413?413:400);}
        if (!body || typeof body!=='object' || Array.isArray(body)) return machineFailure(400);
        try {
          let result;
          if (url.pathname.endsWith('/claim-bound')) {
            if (Object.keys(body).length) return machineFailure(400);
            result=await claimBoundSyntheticDelivery(env,validateSyntheticAttachments);
          } else if(url.pathname.endsWith('/finish-bound')) {
            if (Object.keys(body).length!==3 || !Object.keys(body).every(key=>['attemptId','generation','outcome'].includes(key))) return machineFailure(400);
            result=await finishBoundSyntheticDelivery(env,body);
          } else if (url.pathname.endsWith('/claim')) {
            if (Object.keys(body).length) return machineFailure(400);
            result=await claimSyntheticDelivery(env,validateSyntheticAttachments);
          } else if(url.pathname.endsWith('/finish')) {
            if (Object.keys(body).length!==2 || !Object.keys(body).every(key=>['generation','outcome'].includes(key))) return machineFailure(400);
            result=await finishSyntheticDelivery(env,body.generation,body.outcome,validateSyntheticAttachments);
          } else {
            if(Object.keys(body).length!==3 || !Object.keys(body).every(key=>['attemptId','generation','flowRunId'].includes(key)) ||
              typeof body.attemptId!=='string' || !uuid.test(body.attemptId) || typeof body.generation!=='string' || !/^[a-f0-9]{64}$/.test(body.generation) ||
              typeof body.flowRunId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(body.flowRunId))return machineFailure(400);
            const selected=await env.DB.prepare(`SELECT a.subject_oid,a.pay_month,a.revision FROM timesheet_publication_attempts a
              JOIN timesheet_publication_scopes p ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month AND p.desired_revision=a.revision AND p.generation=a.generation
              JOIN records r ON r.record_id=a.record_id JOIN dispatch_queue q ON q.record_id=a.record_id
              WHERE a.attempt_id=? AND a.record_id=? AND a.generation=? AND lower(a.subject_oid)=? AND lower(p.subject_upn)=?
                AND r.employee_name=? AND json_valid(r.payload_json) AND json_extract(r.payload_json,'$.testMode')=1
                AND q.status IN ('sending','sent','uncertain','completed')`).bind(body.attemptId.toLowerCase(),syntheticFixture.recordId,body.generation,String(env.SYNTHETIC_TEST_SUBJECT_OID).toLowerCase(),syntheticFixture.employeeUpn.toLowerCase(),syntheticFixture.employeeName).first();
            if(!selected)return machineFailure(409);
            const binding={attemptId:body.attemptId,flowRunId:body.flowRunId,generation:body.generation,subjectOid:selected.subject_oid,payMonth:selected.pay_month,publicationRevision:Number(selected.revision)};
            if(url.pathname.endsWith('/bind-run')){
              await bindPublicationFlow(env,{...binding,boundAt:new Date().toISOString()});result={bound:true};
            }else if(url.pathname.endsWith('/read-source'))result=await readPublicationSourceForRun(env,binding);
            else result=await verifyBoundSyntheticWorkbook(env,binding);
          }
          return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(connectorOrigin?{'Access-Control-Allow-Origin':source,Vary:'Origin'}:{})}});
        } catch (error) {return machineFailure(error?.status===409?409:503);}
      }
      if (request.method === 'POST' && callbacks.has(url.pathname)) {
        // A legacy route or receipt must not complete a source-bound attempt.
        if(env.SYNTHETIC_TEST_BOUND_HANDOFF_ENABLED==='true')return failure(403,request);
        const source = request.headers.get('Origin');
        if (source && source !== 'https://make.powerautomate.com') return failure(403, request);
        // The underlying endpoints enforce their existing connection-managed key.
        return delegate.fetch(request, env, ctx);
      }
      const expectedMethod=reads.has(url.pathname)?'GET':writes.has(url.pathname) || url.pathname===attachmentPath?'POST':'';
      if (!expectedMethod || ![expectedMethod, 'OPTIONS'].includes(request.method)) return failure(404, request);
      if (request.headers.get('Origin') !== origin) return failure(403, request);
      if (request.method === 'OPTIONS') {
        if (request.headers.get('Access-Control-Request-Method') !== expectedMethod) return failure(403, request);
        return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': `${expectedMethod}, OPTIONS`, 'Access-Control-Allow-Headers': 'authorization, content-type',
          'Access-Control-Allow-Credentials': 'true', 'Cache-Control': 'no-store', Vary: 'Origin' } });
      }
      const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
      let identity;
      try { identity = await authenticateToken(token, env); } catch (_) { return failure(401, request); }
      if (!same(identity.oid, env.SYNTHETIC_TEST_ALLOWED_OID)) return failure(403, request);
      // The isolated database contains only test records. Show them in this
      // test history so a partially saved correction can be recovered through
      // the normal portal; production history retains its existing filter.
      if (expectedMethod==='GET' && url.pathname==='/api/history') {
        if (!identity.isAdmin) return failure(403,request);
        url.searchParams.set('includeSynthetic','1');
        request=new Request(url,request);
      }
      if (expectedMethod==='POST') {
        if (url.pathname==='/api/synthetic-fixture-invalidate') {
          try { await env.DB.prepare('DELETE FROM synthetic_test_fixture_proofs WHERE actor_oid=?')
            .bind(String(identity.oid).toLowerCase()).run(); } catch (_) { return failure(503,request); }
          return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':origin,
            'Access-Control-Allow-Credentials':'true',Vary:'Origin'}});
        }
        if (url.pathname==='/api/synthetic-fixture-proof') {
          // A later upload attempt supersedes any earlier proof for this actor.
          try { await env.DB.prepare('DELETE FROM synthetic_test_fixture_proofs WHERE actor_oid=?')
            .bind(String(identity.oid).toLowerCase()).run(); } catch (_) { return failure(503,request); }
          if (!/^application\/octet-stream(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return failure(415,request);
          let bytes; try { bytes=await readFixtureBytes(request); } catch (_) { return failure(413,request); }
          if (!(await verifySyntheticFixtureBytes(bytes))) return failure(400,request);
          try {
            const result=await env.DB.prepare(`INSERT INTO synthetic_test_fixture_proofs (actor_oid,fixture_sha256,expires_at) VALUES (?,?,?)
              ON CONFLICT(actor_oid) DO UPDATE SET fixture_sha256=excluded.fixture_sha256,expires_at=excluded.expires_at`)
              .bind(String(identity.oid).toLowerCase(),syntheticFixture.sourceId,Date.now()+15*60*1000).run();
            if (Number(result?.meta?.changes || 0)!==1) return failure(503,request);
          } catch (_) { return failure(503,request); }
          return new Response(JSON.stringify({ok:true,sourceId:syntheticFixture.sourceId}),{status:200,headers:{
            'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,
            'Access-Control-Allow-Credentials':'true',Vary:'Origin'}});
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return failure(415, request);
        let proof;
        try { proof=await env.DB.prepare('SELECT 1 AS verified FROM synthetic_test_fixture_proofs WHERE actor_oid=? AND fixture_sha256=? AND expires_at>=?')
          .bind(String(identity.oid).toLowerCase(),syntheticFixture.sourceId,Date.now()).first(); }
        catch (_) { return failure(503,request); }
        if (!proof?.verified) return failure(403,request);
        let body;
        try { body=await readBoundedJson(request.clone(),url.pathname===attachmentPath?50000:32768); } catch (error) { return failure(error?.status===413?413:400,request); }
        if (url.pathname==='/api/document-import/timesheet-target') {
          if (!validateSyntheticTarget(body)) return failure(400,request);
        } else if (url.pathname===attachmentPath) {
          if (env.SYNTHETIC_TEST_QUEUE_ENABLED!=='true') return failure(403,request);
          let record, payload;
          try {
            record=await env.DB.prepare('SELECT * FROM records WHERE record_id = ?').bind(syntheticFixture.recordId).first();
            payload=JSON.parse(record?.payload_json || 'null');
          } catch (_) { return failure(503,request); }
          if (!record || record.kind!=='timesheets' || record.action!=='pay_month_correction' ||
              record.status!=='Submitted' || !same(record.owner_oid,env.SYNTHETIC_TEST_SUBJECT_OID) || !same(record.owner_upn,syntheticFixture.employeeUpn) ||
              record.employee_name!==syntheticFixture.employeeName || !(await validateSyntheticAttachments(body,payload))) return failure(400,request);
          let snapshot;
          try {
            const period={start:payload.cycleStart,cycleEnd:payload.cycleEnd};
            snapshot=await readLocalPayMonthSnapshot(env,{oid:record.owner_oid,upn:record.owner_upn},period,record.record_id);
            validateCompletePayMonthSource(record,snapshot.rows,body.attachments,period);
          } catch (error) { return failure(error?.status===409?409:503,request); }
          // The base Worker re-reads and compares this exact snapshot; its
          // transactional queue guard compares it again at write time.
          const testContext={ [syntheticQueueCapability]:Object.freeze({capability:syntheticQueueCapability,payloadJson:record.payload_json,
            ownerOid:record.owner_oid,ownerUpn:record.owner_upn,employeeName:record.employee_name,kind:record.kind,action:record.action,status:record.status,
            localSnapshotRevision:snapshot.revision}) };
          if (typeof ctx?.waitUntil==='function') testContext.waitUntil=ctx.waitUntil.bind(ctx);
          return delegate.fetch(request,env,testContext);
        } else {
          if (!validateSyntheticCorrection(body)) return failure(400,request);
          body.payload.testMode=true;
          const headers=new Headers(request.headers); headers.delete('content-length');
          request=new Request(request,{headers,body:JSON.stringify(body)});
        }
      }
      return delegate.fetch(request, env, ctx);
    },
    async scheduled() { /* No scheduled dispatch in the isolated test. */ }
  };
}

export function createSyntheticPortalGateway(delegate=baseWorker){return createGateway(delegate,legacySpec);}
export function createRateSyntheticPortalGateway(delegate=baseWorker){return createGateway(delegate,rateSpec);}
export function createProviderRateSyntheticGateway(delegate=baseWorker){return createGateway(delegate,providerRateSpec);}
export default createSyntheticPortalGateway();
