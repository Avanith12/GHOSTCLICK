/**
 * Feature smoke for the simplified home Ask UI.
 * Run: npm run build && CHROME_PATH=/usr/bin/google-chrome node browser-tests/feature-smoke.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const report = [];
const note = (name, ok, detail = '') => {
  report.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  enableExtensions: [extension],
  args: ['--no-sandbox'],
});

try {
  const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 15_000 },
  );
  const extensionId = new URL(worker.url()).host;
  const panel = await browser.newPage();
  const problems = [];
  panel.on('pageerror', (error) => problems.push(error.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await sleep(900);

  // 1. Home ghost
  const home = await panel.evaluate(() => ({
    ghost: Boolean(document.querySelector('.ghost-wake')),
    voice: [...document.querySelectorAll('button')].some((b) => /Voice/i.test(b.textContent ?? '')),
    key: Boolean(document.querySelector('.key-btn')),
    tabs: [...document.querySelectorAll('button')]
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => /Do anything|Quick ask/i.test(t)),
  }));
  note('1. home shows ghost + voice + keyboard, no mode tabs', home.ghost && home.voice && home.key && home.tabs.length === 0, JSON.stringify(home));

  // 2. Keyboard opens Ask on home
  await panel.click('.key-btn');
  await panel.waitForSelector('textarea', { timeout: 5000 });
  const ask = await panel.evaluate(() => ({
    label: document.querySelector('label')?.textContent?.trim() ?? '',
    go: [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Go'),
    stray: [...document.querySelectorAll('button')]
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => /Do anything|Quick ask/i.test(t)),
    back: [...document.querySelectorAll('button')].some((b) => /Back to home/i.test(b.textContent ?? '')),
  }));
  note('2. Ask opens on home (Go, Back, no mode tabs)', ask.go && ask.back && ask.stray.length === 0, JSON.stringify(ask));

  // 3. Ask → read PDF routes into Data
  await panel.type('textarea', 'Read the PDF in this tab');
  await panel.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Go');
    go?.click();
  });
  await panel.waitForFunction(
    () =>
      Boolean(document.querySelector('label.file input[type=file]')) ||
      /PDF|Data|Reading/i.test(document.body.innerText),
    { timeout: 12_000 },
  );
  const dataFromAsk = await panel.evaluate(() => ({
    file: Boolean(document.querySelector('label.file input[type=file]')),
    text: document.body.innerText.slice(0, 400),
  }));
  note('3. Ask “read PDF” opens Data', dataFromAsk.file, dataFromAsk.file ? 'file input present' : dataFromAsk.text.replace(/\s+/g, ' ').slice(0, 160));

  // 4. Settings → Workflows
  await panel.click('button[aria-label="Settings"], .cog-btn');
  await sleep(400);
  await panel.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Workflows'));
    button?.click();
  });
  await sleep(500);
  const workflows = await panel.evaluate(() => ({
    record: [...document.querySelectorAll('button')].some((b) => /Record/i.test(b.textContent ?? '')),
    settingsOpen: Boolean(document.querySelector('.cog-btn.active, [aria-expanded="true"]')),
    text: document.body.innerText.slice(0, 300),
  }));
  note('4. Settings → Workflows', workflows.record, workflows.record ? 'Record control present' : workflows.text.replace(/\s+/g, ' ').slice(0, 160));

  // 5. Settings → Data
  await panel.click('.cog-btn');
  await sleep(500);
  const openedSettings = await panel.evaluate(() => Boolean(document.querySelector('.cog-panel')));
  await panel.evaluate(() => {
    const button = [...document.querySelectorAll('.cog-panel button')].find((b) => /^Data/i.test(b.textContent?.trim() ?? ''));
    button?.click();
  });
  await sleep(600);
  const data = await panel.evaluate(() => ({
    title: /(?:^|\n)Data(?:\n|$)/.test(document.body.innerText),
    file: Boolean(document.querySelector('label.file input[type=file]')),
    scrape: [...document.querySelectorAll('button')].some((b) => /Scrape list/i.test(b.textContent ?? '')),
    settingsWasOpen: false,
  }));
  data.settingsWasOpen = openedSettings;
  note('5. Settings → Data', data.file && data.scrape, JSON.stringify(data));

  // 6. Back to home via wordmark
  await panel.click('button.wordmark, [aria-label="Ghostclick home"]');
  await sleep(500);
  const backHome = await panel.evaluate(() => Boolean(document.querySelector('.ghost-wake')));
  note('6. wordmark returns to ghost home', backHome);

  // 7. Agent plan path: type imperative task → Working / agent UI (model may fail to load; UI should still switch or show Go working)
  await panel.click('.key-btn');
  await panel.waitForSelector('textarea', { timeout: 5000 });
  await panel.click('textarea', { clickCount: 3 });
  await panel.type('textarea', 'Add one Lumen Air laptop to the cart');
  await panel.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Go');
    go?.click();
  });
  // Wait for either agent chrome, Working… on Go, or a model-load error from the agent path.
  await panel.waitForFunction(
    () => {
      const text = document.body.innerText;
      const goBusy = [...document.querySelectorAll('button')].some((b) => /Working…/i.test(b.textContent ?? ''));
      const agentChrome = Boolean(document.querySelector('.agent')) || /\b(Needs you|Paused|Planning)\b/.test(text);
      const modelFail = /local model did not load|WebGPU|could not understand/i.test(text);
      const workingStatus = /\bWorking…\b/.test(text);
      return goBusy || agentChrome || modelFail || workingStatus;
    },
    { timeout: 20_000 },
  ).catch(() => null);
  const agentUi = await panel.evaluate(() => {
    const text = document.body.innerText;
    return {
      goBusy: [...document.querySelectorAll('button')].some((b) => /Working…/i.test(b.textContent ?? '')),
      agentChrome: Boolean(document.querySelector('.agent')),
      modelFail: /local model did not load|WebGPU|could not understand/i.test(text),
      workingStatus: /\bWorking…\b/.test(text),
      snippet: text.replace(/\s+/g, ' ').slice(0, 220),
    };
  });
  note(
    '7. Ask imperative task starts agent path',
    agentUi.goBusy || agentUi.agentChrome || agentUi.modelFail || agentUi.workingStatus,
    agentUi.snippet,
  );

  if (problems.length) {
    note('pageerrors', false, problems.slice(0, 3).join(' | '));
  } else {
    note('pageerrors', true, 'none');
  }
} finally {
  await browser.close();
}

const failed = report.filter((row) => !row.ok);
console.log(`\n${report.length - failed.length}/${report.length} passed`);
process.exit(failed.length ? 1 : 0);
