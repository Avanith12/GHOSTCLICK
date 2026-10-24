/**
 * Ask → match a saved workflow and show Run.
 * Run: CHROME_PATH=/usr/bin/google-chrome node browser-tests/check-ask-workflow.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await sleep(600);

  // Save a workflow through the normal background API (updates in-memory list).
  const saved = await panel.evaluate(async () => {
    const step = (kind, label, extra = {}) => ({
      id: crypto.randomUUID(),
      kind,
      url: 'http://127.0.0.1:4173/advising.html',
      selector: '#x',
      fallbacks: [],
      label,
      ...extra,
    });
    return chrome.runtime.sendMessage({
      type: 'SAVE_WORKFLOW',
      name: 'Advising hold release',
      goal: 'Clear an advising hold for a student',
      steps: [
        step('navigate', 'Open'),
        step('fill', 'Student name', { value: 'Ada', variableKey: 'studentname' }),
        step('fill', 'Email', { value: 'a@x.edu', variableKey: 'email' }),
        step('fill', 'Student ID', { value: '1', variableKey: 'studentid' }),
        step('click', 'Continue'),
      ],
    });
  });
  if (!saved?.ok) throw new Error(`SAVE_WORKFLOW failed: ${JSON.stringify(saved)}`);

  // Refresh panel snapshot so Ask sees the workflow.
  await panel.reload({ waitUntil: 'load' });
  await sleep(700);
  await panel.click('.key-btn');
  await panel.waitForSelector('textarea', { timeout: 5000 });
  await panel.evaluate(() => {
    const area = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    set?.call(area, 'Clear the advising hold for Grace Hopper, ID 55667788, grace@navy.mil');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await panel.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Go');
    go?.click();
  });
  await panel
    .waitForFunction(
      () => /Advising hold|Grace Hopper|55667788|Open workflow|\bRun\b/i.test(document.body.innerText),
      { timeout: 15_000 },
    )
    .catch(() => null);
  await sleep(800);

  const text = await panel.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const buttons = await panel.evaluate(() =>
    [...document.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '').filter(Boolean),
  );
  const fields = await panel.evaluate(() =>
    [...document.querySelectorAll('input, textarea')]
      .map((el) => ('value' in el ? String(el.value) : ''))
      .join(' '),
  );
  const ok =
    /Advising hold/i.test(text) &&
    buttons.includes('Run') &&
    buttons.some((label) => /Open workflow/i.test(label)) &&
    (/Grace Hopper/i.test(fields) || /55667788/i.test(fields) || /grace@navy/i.test(fields) || /Student name/i.test(text));

  console.log(ok ? 'PASS Ask → workflow plan with Run' : 'FAIL Ask → workflow plan');
  console.log(text.slice(0, 320));
  console.log('fields:', fields.slice(0, 200));
  console.log('buttons:', buttons.filter((label) => /Run|Open|Go|Back/i.test(label)).join(' | '));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
