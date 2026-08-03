import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, createReadStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputDir = resolve(repoRoot, 'outputs/staff-walkthrough');
const part = process.argv[2] || 'all';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

mkdirSync(outputDir, { recursive: true });

if (part === 'combine') {
  const first = join(outputDir, 'gmt-staff-portal-walkthrough-part-1.mp4');
  const second = join(outputDir, 'gmt-staff-portal-walkthrough-part-2.mp4');
  const output = join(outputDir, 'gmt-staff-portal-walkthrough.mp4');
  await run('ffmpeg', [
    '-y', '-i', first, '-i', second,
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[outv]',
    '-map', '[outv]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output
  ]);
  console.log(JSON.stringify({ video: output }, null, 2));
  process.exit(0);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rawPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const filePath = normalize(join(repoRoot, rawPath));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  if (rawPath === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(filePath, 'utf8').replace('enabled: true', 'enabled: false'));
    return;
  }
  res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } }
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({
    name: 'Demo Employee', username: 'demo.employee@gmt-services.co.uk'
  }));
});

async function wait(milliseconds) {
  await page.waitForTimeout(milliseconds);
}

async function caption(step, title, copy) {
  await page.evaluate(({ step, title, copy }) => {
    let card = document.getElementById('gmt-walkthrough-caption');
    if (!card) {
      card = document.createElement('aside');
      card.id = 'gmt-walkthrough-caption';
      card.setAttribute('aria-live', 'polite');
      Object.assign(card.style, {
        position: 'fixed', left: '28px', bottom: '28px', zIndex: '99999', maxWidth: '530px',
        padding: '16px 20px', background: '#123c24', color: '#fff', border: '2px solid #d5b64a',
        borderRadius: '8px', boxShadow: '0 16px 36px rgba(0,0,0,.35)', fontFamily: 'system-ui, sans-serif'
      });
      document.body.appendChild(card);
    }
    card.innerHTML = `<div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#f4d86b">${step}</div><div style="font-size:25px;font-weight:800;margin:3px 0 6px">${title}</div><div style="font-size:16px;line-height:1.35">${copy}</div>`;
  }, { step, title, copy });
}

async function capture(name) {
  await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: false });
}

async function visit(path, step, title, copy, name) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
  await wait(700);
  await caption(step, title, copy);
  await wait(2400);
  await capture(name);
}

let videoPath;
try {
  if (part !== 'two') {
    await visit('/portal/', 'Step 1 of 7', 'Sign in to the Staff Portal', 'Use your existing GMT Microsoft 365 account. Your profile name is reused in portal forms.', '01-portal');

  await visit('/timesheets/', 'Step 2 of 7', 'Quick clock records', 'Choose Clock in, Lunch start, Lunch end, Clock out, Absent, or the + whole-day option. Do not press Submit during this training demo.', '02-clock-in');
  await page.getByRole('button', { name: 'Lunch start' }).click();
  await caption('Step 2 of 7', 'Record lunch and clock events', 'Tap the event being recorded. The highlighted option changes the record type before it is sent to accounts.');
  await wait(1800);
  await page.getByRole('button', { name: 'Absent' }).click();
  await page.locator('[name="absence_reason"]').selectOption('Sick');
  await caption('Step 2 of 7', 'Record an absence', 'Select Absent, choose the reason, confirm the date and submit one record for the whole day.');
  await wait(1800);
  await page.getByRole('button', { name: 'Fill out a whole day' }).click();
  await page.locator('[name="day_start"]').fill('08:00');
  await page.locator('[name="day_lunch_start"]').fill('12:00');
  await page.locator('[name="day_lunch_end"]').fill('13:00');
  await page.locator('[name="day_finish"]').fill('17:00');
  await caption('Step 2 of 7', 'Use + for a complete day', 'Enter start, lunch start/end and finish. Use Create Timesheet for a full week or longer period.');
  await wait(2500);
  await capture('03-full-day');

    await visit('/timesheets/create.html', 'Step 3 of 7', 'Create a weekly timesheet', 'Confirm your details, choose the week start and end dates, then generate the daily cards.', '04-weekly-timesheet');
  await page.locator('#week-start').fill('2026-08-03');
  await page.locator('#week-end').fill('2026-08-07');
  await page.getByRole('button', { name: 'Generate day cards' }).click();
  await wait(1100);
  await caption('Step 3 of 7', 'Complete daily cards and review totals', 'Enter the actual times and selected breaks. Mark Sick, Holiday or Time Off before submitting the generated XLSX and CSV.');
  await wait(2600);
    await capture('05-daily-cards');
  }

  if (part !== 'one') {
    await visit('/jobs/', 'Step 4 of 7', 'Create a job card', 'Enter the job reference, client, site, engineer, planned date and work description. Add one optional photo when relevant.', '06-job-cards');
  await page.locator('#job-ref').fill('GMT-DEMO-001');
  await page.locator('#job-client').fill('Example Client');
  await page.locator('#job-description').fill('Training example only - do not submit.');
    await wait(1200);
  await capture('06-job-cards-filled');

    await visit('/tasks/', 'Step 5 of 7', 'Request a task', 'Give the task a clear title, owner, due date and priority. Accounts approves requests before they become operational work.', '07-tasks');
  await page.locator('#task-title').fill('Training example task');
  await page.locator('#task-assignee').fill('Demo Employee');
  await page.locator('#task-due').fill('2026-08-07');
    await wait(1200);
  await capture('07-tasks-filled');

    await visit('/calendar/', 'Step 6 of 7', 'Request a calendar update', 'Use this for planned work, training or time away. A licensed accounts user approves requests before Outlook publishes them.', '08-calendar');
  await page.locator('#calendar-title').fill('Training example event');
  await page.locator('#calendar-date').fill('2026-08-07');
  await page.locator('#calendar-owner').fill('Demo Employee');
    await wait(1200);
  await capture('08-calendar-filled');

    await visit('/audit/', 'Step 7 of 7', 'Audit received timesheets', 'Upload a DOCX, DOCM, XLSX or ZIP. Review any correction cards before exporting or submitting a corrected audit to accounts.', '09-audit');

    await visit('/portal/', 'Finished', 'Submit accurately and review before sending', 'Weekly timesheets, job cards, tasks and calendar updates are filed and approved through GMT operational processes.', '10-finish');
    await wait(1200);
  }
  videoPath = await page.video().path();
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

const outputVideo = join(outputDir, `gmt-staff-portal-walkthrough-${part === 'two' ? 'part-2' : 'part-1'}.mp4`);
await run('ffmpeg', ['-y', '-i', videoPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputVideo]);
console.log(JSON.stringify({ video: outputVideo, screenshots: outputDir }, null, 2));
