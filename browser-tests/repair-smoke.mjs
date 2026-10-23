/**
 * Smoke-test workflow repair on demo/advising.html:
 * record Continue → redesign to Next → replay → expect repair prompt (or auto) → pick Next → step 2.
 * Optional: if a local model loads, check that it suggests Next (not Cancel).
 *
 *   CHROME_PATH=/usr/bin/google-chrome TESTS=repair,ai node browser-tests/repair-smoke.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const wantAi = (process.env.TESTS ?? 'repair,ai').split(',').includes('ai');
const demoPort = 4191;
const demo = `http://127.0.0.1:${demoPort}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const report = [];
const note = (name, ok, detail) => {
  report.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const server = spawn(process.execPath, [path.join(root, 'browser-tests/demo-server.mjs')], {
  env: { ...process.env, PORT: String(demoPort) },
  stdio: 'ignore',
});

// headless is fine for structure/human repair; set HEADED=1 when also loading WebGPU models.
const headed = process.env.HEADED === '1' || wantAi;
const browser = await puppeteer.launch({
  executablePath,
  headless: headed ? false : true,
  pipe: true,
  userDataDir: `/tmp/ghostclick-repair-smoke-${Date.now()}`,
  enableExtensions: [extension],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 600_000,
  args: ['--no-sandbox', '--window-size=1280,900'],
});

try {
  const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 20_000 },
  );
  const extensionId = new URL(worker.url()).host;
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  const site = await browser.newPage();

  const msg = (message) => panel.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const snap = async () => (await msg({ type: 'GET_SNAPSHOT' })).snapshot;

  async function open(url) {
    await site.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await site.bringToFront();
    await sleep(1500);
  }

  // --- Record with original Continue ---
  await open(`${demo}/advising.html`);
  await site.evaluate(() => sessionStorage.setItem('ghostclick-demo-break', '0'));
  await site.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1000);

  const started = await msg({ type: 'START_RECORDING', name: 'Repair smoke', goal: 'Continue step' });
  if (!started?.ok) throw new Error('START_RECORDING failed');
  await sleep(1200);

  await site.type('#student-name', 'Ada Lovelace', { delay: 15 });
  await site.type('#email', 'ada@northwind.edu', { delay: 15 });
  await site.type('#student-id', '10203040', { delay: 15 });
  await site.click('#continue');
  await sleep(1200);

  const saved = await msg({ type: 'STOP_RECORDING' });
  const workflow = saved?.snapshot?.workflows?.find((item) => item.id === saved.id) ?? saved?.snapshot?.workflows?.at(-1);
  note('Record Continue workflow', Boolean(workflow?.steps?.some((step) => /continue/i.test(step.label))), `${workflow?.steps?.length ?? 0} steps`);

  // --- Break UI, then replay ---
  await site.evaluate(() => sessionStorage.setItem('ghostclick-demo-break', '1'));
  await open(`${demo}/advising.html`);
  await sleep(800);
  const broken = await site.evaluate(() => Boolean(document.querySelector('#next-step') && !document.querySelector('#continue')));
  note('Button redesigned to Next', broken, broken ? 'Next present, Continue gone' : 'form still original');

  // For the AI path, add a second forward action so auto-repair stays unsure and the model must choose.
  if (wantAi) {
    await site.evaluate(() => {
      const actions = document.querySelector('#actions');
      if (!actions || document.querySelector('#save-draft')) return;
      const extra = document.createElement('button');
      extra.type = 'button';
      extra.id = 'save-draft';
      extra.textContent = 'Save';
      actions.append(extra);
    });
  }

  await msg({ type: 'CLEAR_LOG' });
  await msg({
    type: 'START_REPLAY',
    workflowId: workflow.id,
    variables: { studentname: 'Grace Hopper', email: 'grace@northwind.edu', 'student-id': '99887766' },
    startFromCurrentTab: true,
  });

  const onStep2 = () =>
    site.evaluate(() => {
      const step1 = document.querySelector('#step-1');
      const step2 = document.querySelector('#step-2');
      return Boolean(step1?.hidden && step2 && !step2.hidden);
    });

  let prompt = null;
  let reachedStep2 = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = await snap();
    if (state.prompt?.kind === 'repair') {
      prompt = state.prompt;
      break;
    }
    reachedStep2 = await onStep2();
    if (reachedStep2) break;
    if (state.mode === 'idle') {
      // DOM can lag the idle snapshot by a tick after an auto-repair click.
      await sleep(800);
      reachedStep2 = await onStep2();
      break;
    }
    await sleep(500);
  }

  if (prompt) {
    const labels = prompt.candidates.map((c) => c.label);
    const next = prompt.candidates.find((c) => /next/i.test(c.label) && !/cancel/i.test(c.label));
    const cancelShown = labels.some((label) => /^cancel$/i.test(label.trim()));
    note(
      'Repair prompt offered candidates',
      Boolean(next) && !cancelShown,
      `candidates: ${labels.join(' | ') || '(none)'}${cancelShown ? ' (Cancel should be hidden)' : ''}`,
    );

    if (wantAi) {
      // Open settings and load the default text model for a real suggestRepair check.
      await panel.bringToFront();
      await panel.evaluate(() => {
        document.querySelector('.cog-btn, button[aria-label="Settings"]')?.click();
      });
      await sleep(600);
      // Stay can't load mid-replay easily from settings while RunView is showing.
      // Instead click "Load model and ask" / wait for auto-suggest on the repair UI.
      await panel.evaluate(() => {
        // Close settings if open so RunView is visible
        [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close')?.click();
      });
      await sleep(400);

      // Trigger model ask from repair panel
      const asked = await panel.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          /Load model and ask|Ask the local model/i.test(item.textContent),
        );
        button?.click();
        return Boolean(button);
      });
      note('Clicked ask-model on repair', asked, asked ? 'button found' : 'no ask button (model may already be loading)');

      let suggestion = '';
      const aiDeadline = Date.now() + (asked ? 600_000 : 30_000);
      while (Date.now() < aiDeadline) {
        suggestion = await panel.evaluate(() => document.querySelector('.suggestion strong')?.textContent?.trim() ?? '');
        if (suggestion) break;
        const footer = await panel.evaluate(() => document.querySelector('footer p')?.textContent ?? '');
        if (/could not|cannot|not expose|Error/i.test(footer) && !/ready/i.test(footer)) {
          note('Load model for repair', false, footer.slice(0, 160));
          break;
        }
        await sleep(2000);
      }
      if (suggestion) {
        note('AI suggested a control', /next/i.test(suggestion) && !/cancel/i.test(suggestion), `“${suggestion}”`);
        await panel.evaluate(() => {
          [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Use this control')?.click();
        });
      } else if (!report.some((item) => item.name === 'Load model for repair' && !item.ok)) {
        note('AI suggested a control', false, 'No suggestion appeared in time (model slow/missing WebGPU). Continuing with manual pick.');
      }
    }

    // If AI didn't resolve, pick Next manually
    const state = await snap();
    if (state.prompt?.kind === 'repair') {
      const pick = state.prompt.candidates.find((c) => /next/i.test(c.label) && !/cancel/i.test(c.label));
      await msg({
        type: 'RESOLVE_HUMAN',
        decision: { token: state.prompt.token, approved: Boolean(pick), selector: pick?.selector ?? '' },
      });
      note('Manual resolve Next', Boolean(pick), pick ? pick.label : 'Next not in candidates');
    }
  } else {
    note(
      'Repair continued without asking',
      reachedStep2,
      reachedStep2
        ? 'Auto-repaired Continue→Next (synonym / structure) — expected when the match is clear'
        : 'No prompt and did not reach step 2',
    );
  }

  await sleep(1200);
  reachedStep2 = await onStep2();
  note('Replay reached step 2 after repair', reachedStep2, reachedStep2 ? 'step-2 visible' : await site.evaluate(() => document.body.innerText.slice(0, 120)));
} catch (error) {
  note('Repair smoke run', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close().catch(() => undefined);
  server.kill();
  const passed = report.filter((item) => item.ok).length;
  console.log(`\n${passed} of ${report.length} checks passed.`);
  process.exitCode = passed === report.length ? 0 : 1;
}
