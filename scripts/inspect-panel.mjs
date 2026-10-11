import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = process.env.EXT_DIR ?? path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome for Testing binary.');

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
    { timeout: 10_000 },
  );
  const extensionId = new URL(worker.url()).host;
  console.log('extension', extensionId);

  if (process.env.SEED_OLD) {
    const sw = await worker.worker();
    await sw.evaluate(async () => {
      const step = (kind, label, extra = {}) => ({
        id: crypto.randomUUID(), kind, url: 'http://127.0.0.1:4173/', selector: '#x', fallbacks: [], label, ...extra,
      });
      await chrome.storage.local.set({
        workflows: [{
          id: 'old', name: 'Advising hold release', createdAt: 1,
          steps: [step('navigate', 'Open'), step('fill', 'Student name', { value: 'avanith', variableKey: 'studentname' }), step('click', 'Continue')],
        }],
      });
      await chrome.storage.session.set({
        session: {
          mode: 'idle', tabId: 1, draft: null, replayWorkflowId: 'old', replayIndex: 3, variables: {},
          log: [{ id: '1', text: 'Workflow finished.', tone: 'ok' }], prompt: null, resolution: null, statusText: 'Finished.',
        },
      });
    });
  }

  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (['error', 'warn'].includes(message.type())) problems.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(problems.length ? problems.join('\n') : 'no errors');
  console.log('PANEL TEXT:\n' + (await page.evaluate(() => document.body.innerText.slice(0, 800))));
} finally {
  await browser.close();
}
