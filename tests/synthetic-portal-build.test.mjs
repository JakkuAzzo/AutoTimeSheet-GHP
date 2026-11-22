import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('the disposable portal build has only the isolated API and disables delivery fallbacks', () => {
  const result = JSON.parse(execFileSync(process.execPath,
    ['tools/prepare-synthetic-portal.mjs', '--build-only'], { encoding: 'utf8' }));
  try {
    assert.equal(result.safeToRun, false, 'build alone does not establish a network boundary');
    assert.match(path.basename(result.directory), /^gmt-isolated-portal-/);
    const source = fs.readFileSync(path.join(result.directory, 'site', 'config.js'), 'utf8');
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const c = context.window.GMT_APP_CONFIG;
    assert.equal(c.portalApiEndpoint, 'https://gmt-timesheet-portal-e2e-20261116.raspy-breeze-e230.workers.dev');
    assert.equal(c.portalHistoryEndpoint, c.portalApiEndpoint);
    for (const key of ['timesheetIntakeEndpoint', 'timesheetFormSubmitEndpoint', 'formSubmitTimesheetEndpoint',
      'fallbackFormSubmitEndpoint', 'formSubmitEndpoint', 'timesheetHistoryEndpoint', 'auditFormSubmitEndpoint',
      'contactFormSubmitEndpoint', 'formSubmitCc']) assert.equal(c[key], '', key);
    assert.equal(c.umami.enabled, false);
    assert.equal(c.entraSpaAuth.redirectPath, '/portal/');
    assert.doesNotMatch(source, /formsubmit\.co|gmt-portal-api|environment\.api\.powerplatform/i);
    assert.ok(fs.existsSync(path.join(result.directory, 'site', 'portal', 'submissions.html')));
    const callback=fs.readFileSync(path.join(result.directory, 'site', 'portal', 'index.html'),'utf8');
    const callbackScripts=[...callback.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match=>match[1]);
    assert.deepEqual(callbackScripts,['/config.js','/portal/auth.js'], 'the callback loads only configuration and sign-in');
    assert.doesNotMatch(callback,/<(?:a|form|iframe)\b/i, 'the callback exposes no unrelated navigation or submission controls');
    const page=fs.readFileSync(path.join(result.directory, 'site', 'portal', 'submissions.html'),'utf8');
    const uploadUi=fs.readFileSync(path.join(result.directory, 'site', 'portal', 'submission-upload-ui.js'),'utf8');
    const submissions=fs.readFileSync(path.join(result.directory, 'site', 'portal', 'submissions.js'),'utf8');
    assert.match(submissions,/Retry fictional workbook filing/);
    assert.match(submissions,/previous\.testMode === true && correctionRecordId\(sheet\) === recordId\(existing\)/);
    assert.match(page,/synthetic-fixture-proof\.js/);
    assert.match(uploadUi,/await root\.GMTSyntheticVerifyUpload\(file\)/);
    const auth = fs.readFileSync(path.join(result.directory,'site','portal','auth.js'),'utf8');
    const xlsx = fs.readFileSync(path.join(result.directory,'site','lazy-xlsx.js'),'utf8');
    assert.doesNotMatch(auth,/cdn\.jsdelivr\.net/);
    assert.doesNotMatch(xlsx,/cdn\.jsdelivr\.net/);
    assert.ok(fs.existsSync(path.join(result.directory,'site','vendor','test-only','msal-browser.min.js')));
    assert.ok(fs.existsSync(path.join(result.directory,'site','vendor','test-only','xlsx.full.min.js')));
    const requestedPath=auth.match(/function requestedPath\(\) \{([\s\S]*?)\n  \}/);
    assert.ok(requestedPath, 'the sign-in return-path function is present');
    const resolvePath = candidate => vm.runInNewContext(`(function () {${requestedPath[1]}\n})()`, {
      sessionStorage: { getItem: () => candidate }, postSignInKey: 'fictional', portalRootPath: () => '/'
    });
    assert.equal(resolvePath('/portal/submissions.html'),'/portal/submissions.html');
    for(const path of ['//attacker.invalid/','/portal/../../other','/portal/index.html','https://attacker.invalid/']) {
      assert.equal(resolvePath(path),'',path);
    }
  } finally {
    fs.rmSync(result.directory, { recursive: true, force: true });
  }
});
