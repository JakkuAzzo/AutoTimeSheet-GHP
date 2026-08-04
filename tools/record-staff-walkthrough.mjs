import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, createReadStream, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mediaDir = resolve(repoRoot, 'training/media');
const selected = process.argv[2] || 'all';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(mediaDir, { recursive: true });

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

function label(key) {
  return `gmt-training-${key}`;
}

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });

async function record(key, steps) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: mediaDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('gmt.portal.profile.v1', JSON.stringify({
      name: 'Demo Employee', username: 'demo.employee@gmt-services.co.uk'
    }));
  });
  await page.goto(`${baseUrl}${steps.path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.id = 'gmt-training-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    Object.assign(cursor.style, {
      position: 'fixed', zIndex: '100000', width: '22px', height: '22px', left: '48px', top: '48px',
      border: '3px solid #fff', borderRadius: '50%', background: '#d5b64a', boxShadow: '0 0 0 3px #123c24, 0 5px 12px rgba(0,0,0,.35)',
      pointerEvents: 'none', transition: 'left .55s ease, top .55s ease'
    });
    const caption = document.createElement('aside');
    caption.id = 'gmt-training-caption';
    caption.setAttribute('aria-live', 'polite');
    Object.assign(caption.style, {
      position: 'fixed', zIndex: '99999', right: '26px', bottom: '24px', maxWidth: '500px',
      padding: '16px 20px', background: '#123c24', color: '#fff', border: '2px solid #d5b64a',
      borderRadius: '8px', boxShadow: '0 16px 36px rgba(0,0,0,.35)', fontFamily: 'system-ui, sans-serif'
    });
    document.body.append(cursor, caption);
  });

  async function pause(ms = 1800) { await page.waitForTimeout(ms); }
  async function callout(step, title, copy) {
    await page.evaluate(({ step, title, copy }) => {
      document.getElementById('gmt-training-caption').innerHTML = `<div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#f4d86b">${step}</div><div style="font-size:25px;font-weight:800;margin:3px 0 6px">${title}</div><div style="font-size:16px;line-height:1.4">${copy}</div>`;
    }, { step, title, copy });
  }
  async function point(target, note) {
    const locator = typeof target === 'string' ? page.locator(target) : target;
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Cannot point at ${target}`);
    const x = box.x + Math.min(28, box.width / 2);
    const y = box.y + Math.min(24, box.height / 2);
    await page.mouse.move(x, y, { steps: 24 });
    await page.evaluate(({ x, y, note }) => {
      const cursor = document.getElementById('gmt-training-cursor');
      cursor.style.left = `${x - 11}px`;
      cursor.style.top = `${y - 11}px`;
      document.querySelectorAll('[data-gmt-training-focus]').forEach(el => {
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.removeAttribute('data-gmt-training-focus');
      });
      const node = document.elementFromPoint(x, y);
      const focus = node && node.closest('button, input, select, textarea, a, summary, label, section, article');
      if (focus) {
        focus.dataset.gmtTrainingFocus = 'true';
        focus.style.outline = '4px solid #d5b64a';
        focus.style.outlineOffset = '3px';
      }
      if (note) document.getElementById('gmt-training-caption').dataset.point = note;
    }, { x, y, note });
    await pause(1200);
  }
  async function highlight(target, step, title, copy) {
    await callout(step, title, copy);
    await point(target);
    await pause(2600);
  }

  try {
    await steps.run({ page, pause, callout, point, highlight });
    await page.screenshot({ path: join(mediaDir, `${key}.png`) });
    const videoPath = await page.video().path();
    await context.close();
    await run('ffmpeg', ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(mediaDir, `${label(key)}.mp4`)]);
    if (existsSync(videoPath)) unlinkSync(videoPath);
  } finally {
    if (context.pages().length) await context.close();
  }
}

const demos = {
  'portal-profile': {
    path: '/portal/',
    run: async ({ page, pause, highlight, callout }) => {
      await callout('Portal training', 'Sign in with your GMT account', 'Use the GMT Microsoft 365 account issued to you. The portal opens after Microsoft verifies your account.');
      await pause(3200);
      await highlight('#portal-profile-name', 'Step 1', 'Confirm your name', 'Your name is reused in staff portal forms, so you do not have to type it repeatedly.');
      await page.locator('#portal-profile-name').fill('Demo Employee');
      await highlight('#portal-profile-email', 'Step 2', 'Add a contact email if needed', 'This optional address is saved only in this browser for copies and contact details.');
      await page.locator('#portal-profile-email').fill('demo.employee@gmt-services.co.uk');
      await highlight('#portal-profile-form button[type="submit"]', 'Step 3', 'Save before using the portal', 'Use Save profile after changing your details. Then choose the workflow you need below.');
      await pause(2200);
    }
  },
  'clock-record': {
    path: '/timesheets/',
    run: async ({ page, pause, highlight, callout }) => {
      await callout('Quick records', 'Use this card for one event now', 'For a full week or a longer period, use Create Timesheet instead. This demonstration does not submit anything.');
      await pause(3000);
      await highlight('[name="employee_name"]', 'Step 1', 'Confirm your name', 'Your portal profile normally pre-fills this field. Check it is correct before you record an event.');
      await page.locator('[name="employee_name"]').fill('Demo Employee');
      await highlight('[data-clock-action="clock_in"]', 'Step 2', 'Choose the event', 'Tap Clock in, Lunch start, Lunch end, Clock out, Absent, or + for a complete day.');
      await page.getByRole('button', { name: 'Lunch start' }).click();
      await highlight('[data-clock-action="lunch_start"]', 'Step 3', 'The selected event is highlighted', 'Check the highlighted button and the title before you continue.');
      await highlight('[name="clock_date"]', 'Step 4', 'Check the date and time', 'The date and current time are set automatically. Change either one only when needed.');
      await page.getByRole('button', { name: 'Absent' }).click();
      await highlight('[name="absence_reason"]', 'Step 5', 'Record an absence for the whole day', 'Choose Absent, then choose Sick, Holiday, Time Off or Other. A time is not needed for an absence.');
      await page.locator('[name="absence_reason"]').selectOption('Sick');
      await page.getByRole('button', { name: 'Fill out a whole day' }).click();
      await highlight('[data-full-day-fields]', 'Step 6', 'Use + to record a full day', 'Enter Start, Lunch start, Lunch end and Finish. The weekly timesheet remains best for several days.');
      await page.locator('[name="day_start"]').fill('08:00');
      await page.locator('[name="day_lunch_start"]').fill('12:00');
      await page.locator('[name="day_lunch_end"]').fill('13:00');
      await page.locator('[name="day_finish"]').fill('17:00');
      await highlight('.clock-note-details', 'Step 7', 'Add a note only when useful', 'Notes give accounts context for an unusual clock record or absence.');
      await page.locator('.clock-note-details summary').click();
      await page.locator('[name="clock_note"]').fill('Training example only.');
      await highlight('[data-clock-submit]', 'Final check', 'Review, then submit once', 'On the live portal, this creates a timesheet-format XLSX and CSV for accounts.');
      await pause(2600);
    }
  },
  'weekly-timesheet': {
    path: '/timesheets/create.html',
    run: async ({ page, pause, highlight, callout }) => {
      await callout('Weekly timesheet', 'Create one complete weekly record', 'Use actual start, finish and break times. Daily cards calculate against the same source used by the exports.');
      await pause(2800);
      await highlight('#week-start', 'Step 1', 'Choose the week', 'Set the week start and end dates before generating daily cards.');
      await page.locator('#week-start').fill('2026-08-03');
      await page.locator('#week-end').fill('2026-08-09');
      await highlight('#week-end', 'Step 2', 'Confirm the end date', 'Use the full working week you are submitting.');
      await highlight('button:has-text("Generate day cards")', 'Step 3', 'Generate daily cards', 'The form creates one card per day. You can collapse a card after checking it.');
      await page.getByRole('button', { name: 'Generate day cards' }).click();
      await pause(1800);
      const firstCard = page.locator('.day-card').first();
      await highlight(firstCard, 'Step 4', 'Enter actual daily time', 'Use the Start, Finish and Break fields on each day. Mark an absence before entering time.');
      await highlight(firstCard.locator('select').first(), 'Step 5', 'Select the break', 'No break, 30 minutes or 1 hour. Sick and Holiday days lock the time and break fields.');
      await highlight(firstCard.locator('button').last(), 'Step 6', 'Review calculated totals', 'Check the daily results, then use the form submit action to create XLSX and CSV attachments.');
      await pause(2600);
    }
  },
  'job-card': {
    path: '/jobs/',
    run: async ({ page, pause, highlight, callout }) => {
      await callout('Job card', 'Create a request accounts can identify', 'Use one clear job reference. Add a photo only when it helps explain the site or work.');
      await pause(2600);
      await highlight('#job-ref', 'Step 1', 'Start with the job reference', 'Use the agreed GMT reference so the email and OneDrive folder can be matched.');
      await page.locator('#job-ref').fill('GMT-DEMO-001');
      await highlight('#job-client', 'Step 2', 'Add the client', 'Enter the customer or company name.');
      await page.locator('#job-client').fill('Example Client');
      await highlight('#job-site', 'Step 3', 'Add site and engineer', 'Include the site address and the assigned engineer where known.');
      await page.locator('#job-site').fill('93-95 Gloucester Rd, Croydon');
      await page.locator('#job-engineer').fill('Demo Employee');
      await highlight('#job-image', 'Step 4', 'Attach one useful image if needed', 'The image is attached to the same job-card submission, not emailed separately.');
      await highlight('#job-description', 'Step 5', 'Describe the work clearly', 'Include the request, access notes, risks and useful context.');
      await page.locator('#job-description').fill('Training example only - do not submit.');
      await highlight('#job-card-form button[type="submit"]', 'Final check', 'Submit one complete job card', 'Review the details before sending. Accounts then manages the authoritative status in Microsoft 365.');
      await pause(2400);
    }
  },
  'task-request': {
    path: '/tasks/',
    run: async ({ page, pause, highlight, callout }) => {
      await callout('Task request', 'Request a clear piece of work', 'Tasks remain pending until a licensed accounts user approves the operational record.');
      await pause(2600);
      await highlight('#task-title', 'Step 1', 'Write a concise task title', 'Use a title that makes sense without opening the task.');
      await page.locator('#task-title').fill('Inspect extractor motor at Example Client');
      await highlight('#task-job-ref', 'Step 2', 'Add a job reference when relevant', 'This helps connect task work to the right job card.');
      await page.locator('#task-job-ref').fill('GMT-DEMO-001');
      await highlight('#task-assignee', 'Step 3', 'Assign the responsible person', 'Choose the person expected to complete or manage the work.');
      await page.locator('#task-assignee').fill('Demo Employee');
      await highlight('#task-due', 'Step 4', 'Set due date and priority', 'Use a realistic due date. Use urgent only when the work is genuinely urgent.');
      await page.locator('#task-due').fill('2026-08-07');
      await page.locator('#task-priority').selectOption('High');
      await highlight('#task-form button[type="submit"]', 'Final check', 'Send for approval', 'Review the request before submitting. The board shows approved work by status.');
      await pause(2400);
    }
  },
  'calendar-request': {
    path: '/calendar/',
    run: async ({ page, pause, highlight, callout }) => {
      await callout('Calendar request', 'Request a future operational event', 'This can be planned work, training, holiday or an absence. Accounts controls publication to Outlook.');
      await pause(2600);
      await highlight('#calendar-title', 'Step 1', 'Give the event a clear title', 'Keep it short and specific so the shared calendar is easy to scan.');
      await page.locator('#calendar-title').fill('Example Client extractor inspection');
      await highlight('#calendar-date', 'Step 2', 'Choose the event date and type', 'Choose the date, then select the most accurate type.');
      await page.locator('#calendar-date').fill('2026-08-07');
      await page.locator('#calendar-type').selectOption('Job');
      await highlight('#calendar-owner', 'Step 3', 'Confirm the owner', 'Your portal profile usually supplies this. Check it identifies the requester or engineer.');
      await page.locator('#calendar-owner').fill('Demo Employee');
      await highlight('#calendar-notes', 'Step 4', 'Add the necessary context', 'Use notes for access arrangements, timing or any information accounts needs to approve it.');
      await page.locator('#calendar-notes').fill('Training example only - do not submit.');
      await highlight('#calendar-form button[type="submit"]', 'Final check', 'Submit for accounts approval', 'Approved events become controlled Outlook calendar updates.');
      await pause(2400);
    }
  },
  'timesheet-audit': {
    path: '/audit/',
    run: async ({ page, pause, highlight, callout }) => {
      await callout('Timesheet audit', 'Check source files before accounts action', 'The audit reads supported Word, spreadsheet and ZIP inputs. It does not silently alter a source document.');
      await pause(2800);
      await highlight('#sourceInput', 'Step 1', 'Choose one or more source files', 'Use DOCX, DOCM, XLSX, CSV or ZIP files. Legacy .doc needs conversion before automatic checking.');
      await highlight('#addSourcesBtn', 'Step 2', 'Add the selected sources', 'First add the files, then run the calculation and check.');
      await highlight('#runBtn', 'Step 3', 'Calculate and check sources', 'The result starts with a plain-English decision: no action needed, issues to review, or parse errors.');
      await highlight('#status', 'Step 4', 'Read the decision first', 'Use the detailed audit data only after reviewing the decision and correction cards.');
      await pause(2800);
    }
  }
};

try {
  const entries = selected === 'all' ? Object.entries(demos) : [[selected, demos[selected]]];
  if (!entries[0][1]) throw new Error(`Unknown walkthrough: ${selected}. Use one of ${Object.keys(demos).join(', ')}, or all.`);
  for (const [key, steps] of entries) await record(key, steps);
  console.log(JSON.stringify({ mediaDir, created: entries.map(([key]) => ({ video: `${label(key)}.mp4`, poster: `${key}.png` })) }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
