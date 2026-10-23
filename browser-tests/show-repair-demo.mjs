/**
 * Visual demo: cyan recording glow + auto AI repair on advising.html.
 * Saves screenshots under browser-tests/shots/
 *
 *   CHROME_PATH=/usr/bin/google-chrome node browser-tests/show-repair-demo.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const shots = path.join(root, 'browser-tests/shots');
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const demoPort = 4195;
const demo = `http://127.0.0.1:${demoPort}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fs.mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, [path.join(root, 'browser-tests/demo-server.mjs')], {
  env: { ...process.env, PORT: String(demoPort) },
  stdio: 'ignore',
});

const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  pipe: true,
  userDataDir: `/tmp/ghostclick-show-demo-${Date.now()}`,
  enableExtensions: [extension],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 600_000,
  args: ['--no-sandbox', '--window-size=1280,900'],
});

const report = [];
const note = (name, ok, detail) => {
  report.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

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

  // Load a small text model so auto-repair can run.
  await panel.bringToFront();
  await panel.click('button[aria-label="Settings"], .cog-btn');
  await sleep(500);
  await panel.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Load model|Reload model/i.test(b.textContent))?.click();
  });
  const loadStart = Date.now();
  let loaded = false;
  while (Date.now() - loadStart < 600_000) {
    const footer = await panel.evaluate(() => document.querySelector('footer p')?.textContent ?? '');
    const readyHint = await panel.evaluate(() => document.body.innerText);
    if (/is ready/i.test(footer) || /is ready/i.test(readyHint)) {
      loaded = true;
      break;
    }
    if (/could not|cannot|not expose|Error/i.test(footer) && !/ready/i.test(footer)) {
      note('Load model', false, footer.slice(0, 160));
      break;
    }
    await sleep(3000);
  }
  note('Load model', loaded, loaded ? `ready in ${((Date.now() - loadStart) / 1000).toFixed(0)}s` : 'model not ready');
  await panel.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close')?.click();
  });
  await sleep(400);

  // --- Recording with cyan glow ---
  await site.bringToFront();
  await site.goto(`${demo}/advising.html`, { waitUntil: 'domcontentloaded' });
  await site.evaluate(() => sessionStorage.setItem('ghostclick-demo-break', '0'));
  await site.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1000);

  const started = await msg({ type: 'START_RECORDING', name: 'Show repair', goal: '' });
  note('Start recording', Boolean(started?.ok), started?.ok ? 'recording' : 'failed');
  await sleep(1500);

  const glow = await site.evaluate(() => {
    const el = document.querySelector('[data-ghostclick="glow"]');
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      display: style.display,
      mode: el.getAttribute('data-mode'),
      boxShadow: style.boxShadow.slice(0, 120),
    };
  });
  note(
    'Cyan recording glow on page',
    glow?.display === 'block' && glow?.mode === 'recording' && /92,\s*225,\s*255|5ce1ff/i.test(glow.boxShadow + ''),
    glow ? JSON.stringify(glow) : 'no glow element',
  );
  await site.screenshot({ path: path.join(shots, '01-recording-glow.png'), fullPage: false });
  console.log('shot:', path.join(shots, '01-recording-glow.png'));

  await site.type('#student-name', 'Ada Lovelace', { delay: 12 });
  await site.type('#email', 'ada@northwind.edu', { delay: 12 });
  await site.type('#student-id', '10203040', { delay: 12 });
  await site.click('#continue');
  await sleep(1000);
  const saved = await msg({ type: 'STOP_RECORDING' });
  const workflow = saved?.snapshot?.workflows?.find((w) => w.id === saved.id);
  note('Saved workflow', Boolean(workflow), `${workflow?.steps?.length ?? 0} steps`);

  // --- Break UI + ambiguous Save so AI must choose ---
  await site.evaluate(() => sessionStorage.setItem('ghostclick-demo-break', '1'));
  await site.goto(`${demo}/advising.html`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await site.evaluate(() => {
    const actions = document.querySelector('#actions');
    if (!actions || document.querySelector('#save-draft')) return;
    const extra = document.createElement('button');
    extra.type = 'button';
    extra.id = 'save-draft';
    extra.textContent = 'Save';
    actions.append(extra);
  });
  await site.screenshot({ path: path.join(shots, '02-redesigned-next-and-save.png'), fullPage: false });
  console.log('shot:', path.join(shots, '02-redesigned-next-and-save.png'));

  await msg({ type: 'CLEAR_LOG' });
  await msg({
    type: 'START_REPLAY',
    workflowId: workflow.id,
    variables: {},
    startFromCurrentTab: true,
  });

  let sawSuggestion = false;
  let reachedStep2 = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await snap();
    if (state.prompt?.kind === 'repair') {
      await panel.bringToFront();
      await sleep(300);
      const sug = await panel.evaluate(() => document.querySelector('.suggestion strong')?.textContent?.trim() ?? '');
      if (sug) {
        sawSuggestion = true;
        await panel.screenshot({ path: path.join(shots, '03-ai-suggestion.png'), fullPage: false });
        console.log('shot:', path.join(shots, '03-ai-suggestion.png'), '→', sug);
        note('AI suggested control', /next/i.test(sug), `“${sug}”`);
      }
    }
    reachedStep2 = await site.evaluate(() => {
      const step1 = document.querySelector('#step-1');
      const step2 = document.querySelector('#step-2');
      return Boolean(step1?.hidden && step2 && !step2.hidden);
    });
    if (reachedStep2) break;
    if (state.mode === 'idle' && Date.now() - deadline + 180_000 > 8000) {
      await sleep(600);
      reachedStep2 = await site.evaluate(() => {
        const step1 = document.querySelector('#step-1');
        const step2 = document.querySelector('#step-2');
        return Boolean(step1?.hidden && step2 && !step2.hidden);
      });
      break;
    }
    await sleep(400);
  }

  await site.bringToFront();
  await sleep(500);
  await site.screenshot({ path: path.join(shots, '04-after-auto-repair.png'), fullPage: false });
  console.log('shot:', path.join(shots, '04-after-auto-repair.png'));
  note('Auto-repair reached step 2', reachedStep2, reachedStep2 ? 'step-2 visible (AI applied itself)' : 'did not advance');
  note('Saw AI suggestion UI (optional flash)', true, sawSuggestion ? 'captured suggestion screenshot' : 'applied too fast to screenshot (still OK if step 2 reached)');
} catch (error) {
  note('Demo run', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close().catch(() => undefined);
  server.kill();
  const passed = report.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${report.length} checks passed.`);
  console.log(`Screenshots: ${shots}`);
  process.exitCode = report.every((r) => r.ok) ? 0 : 1;
}
