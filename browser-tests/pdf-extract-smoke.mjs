/**
 * PDF pull-out smoke: fixture course PDF → Data → extract code/title/credits.
 *
 *   CHROME_PATH=/usr/bin/google-chrome node browser-tests/pdf-extract-smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const fixture = '/tmp/ghostclick-extract-courses.pdf';
const profile = '/tmp/ghostclick-pdf-extract-profile';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const report = [];
const note = (name, ok, detail) => {
  report.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  pipe: true,
  userDataDir: profile,
  enableExtensions: [extension],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 900_000,
  args: ['--no-sandbox', '--window-size=1280,900'],
});

try {
  const maker = await browser.newPage();
  await maker.setContent(`<!doctype html><html><body style="font:14px Helvetica">
    <h1>Fall 2026 Course List</h1>
    <table border="1" cellpadding="6">
      <tr><th>Code</th><th>Title</th><th>Credits</th></tr>
      <tr><td>CS 101</td><td>Intro to Programming</td><td>3</td></tr>
      <tr><td>BIO 210</td><td>Cell Biology</td><td>4</td></tr>
      <tr><td>MATH 220</td><td>Linear Algebra</td><td>3</td></tr>
      <tr><td>ENG 150</td><td>College Writing</td><td>3</td></tr>
    </table>
    <p>Office of the Registrar · Northwind College</p>
  </body></html>`);
  await maker.pdf({ path: fixture, format: 'Letter' });
  await maker.close();
  note('Fixture PDF', fs.existsSync(fixture), fixture);

  const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 20_000 },
  );
  const extensionId = new URL(worker.url()).host;
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await sleep(800);

  const msg = (message) => panel.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const snap = async () => (await msg({ type: 'GET_SNAPSHOT' })).snapshot;
  const bodyText = () => panel.evaluate(() => document.body.innerText);

  // Open Settings and finish loading the model BEFORE leaving for Data
  // (Load model calls onDone → home; Data must be opened after ready).
  await panel.click('button[aria-label="Settings"], .cog-btn');
  await sleep(600);
  await panel.waitForSelector('.cog-panel', { timeout: 5000 });

  const hint = () => panel.evaluate(() => document.querySelector('.cog-panel .hint')?.textContent ?? '');
  let ready = /is ready/i.test(await hint());
  if (!ready) {
    const clicked = await panel.evaluate(() => {
      const button = [...document.querySelectorAll('.cog-panel button')].find((b) =>
        /Load model|Reload model/i.test(b.textContent),
      );
      button?.click();
      return Boolean(button);
    });
    if (!clicked) throw new Error('Load model button not found in settings');
    const start = Date.now();
    while (Date.now() - start < 600_000) {
      // Settings may close when load finishes (onDone → home). Re-open to read status if needed.
      const open = await panel.$('.cog-panel');
      if (!open) {
        await panel.click('button[aria-label="Settings"], .cog-btn');
        await sleep(500);
      }
      const text = await hint();
      const page = await bodyText();
      if (/is ready/i.test(text) || /is ready/i.test(page)) {
        ready = true;
        break;
      }
      if (/could not load|not expose WebGPU|ran out of memory/i.test(text + page)) {
        note('Load text model', false, (text || page).slice(0, 200));
        break;
      }
      console.log(`  loading ${((Date.now() - start) / 1000).toFixed(0)}s: ${(text || '…').slice(0, 100)}`);
      await sleep(5000);
    }
  }
  note('Load text model', ready, ready ? 'ready' : (await hint() || await bodyText()).slice(0, 180));
  if (!ready) throw new Error('model did not load');

  // Ensure settings is open, then go to Data
  if (!(await panel.$('.cog-panel'))) {
    await panel.click('button[aria-label="Settings"], .cog-btn');
    await sleep(500);
  }
  await panel.evaluate(() => {
    [...document.querySelectorAll('.cog-panel button, button')].find((b) => /^\s*Data/.test(b.textContent))?.click();
  });
  await sleep(800);

  const input = await panel.waitForSelector('label.file input[type=file]', { timeout: 10_000 });
  await input.uploadFile(fixture);
  await panel.waitForFunction(
    () => {
      const status = document.querySelector('.box .status')?.textContent ?? '';
      return /Read “|Could not|still has almost no text/i.test(status) && !/^Reading the PDF/i.test(status);
    },
    { timeout: 60_000 },
  );
  const readStatus = await panel.$eval('.box .status', (el) => el.textContent);
  note('Read PDF', /\d+\s*pages?/i.test(readStatus ?? ''), readStatus ?? '');

  await panel.evaluate(() => {
    const want = [...document.querySelectorAll('textarea')].find((el) =>
      /course list|pulled out|Cancer/i.test(el.placeholder || ''),
    );
    const cols = [...document.querySelectorAll('input')].find((el) =>
      /code, title|type, count|comma separated/i.test(el.placeholder || ''),
    );
    if (want) {
      const proto = HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(want, 'course list rows with code, title, and credits');
      want.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (cols) {
      const proto = HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(cols, 'code, title, credits');
      cols.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(300);

  await panel.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Pull out into a table/i.test(b.textContent) && !b.disabled)?.click();
  });

  const pullStart = Date.now();
  await panel.waitForFunction(
    () => {
      const status = document.querySelector('.box .status')?.textContent ?? '';
      return /\d+\s+rows added|No rows matched|could not|Load a local model/i.test(status);
    },
    { timeout: 300_000 },
  );
  const pullStatus = await panel.$eval('.box .status', (el) => el.textContent);
  const state = await snap();
  const rows = state.results?.rows ?? [];
  const sample = rows
    .slice(0, 4)
    .map((row) => Object.values(row).slice(0, 3).join(' | '))
    .join(' ; ');
  note(
    'Pull out course rows',
    rows.length >= 3 && rows.some((row) => /CS\s*101/i.test(JSON.stringify(row))),
    `${((Date.now() - pullStart) / 1000).toFixed(1)}s | ${pullStatus} | ${sample}`,
  );

  const shots = path.join(root, 'browser-tests/shots');
  fs.mkdirSync(shots, { recursive: true });
  await panel.screenshot({ path: path.join(shots, '05-pdf-extract.png'), fullPage: true });
  console.log('shot:', path.join(shots, '05-pdf-extract.png'));
} catch (error) {
  note('PDF extract smoke', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close().catch(() => undefined);
  const passed = report.filter((item) => item.ok).length;
  console.log(`\n${passed} of ${report.length} checks passed.`);
  process.exitCode = passed === report.length ? 0 : 1;
}
