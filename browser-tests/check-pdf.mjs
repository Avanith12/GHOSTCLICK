import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome for Testing binary.');
const fixture = '/tmp/ghostclick-courses.pdf';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  enableExtensions: [extension],
  args: ['--no-sandbox'],
});

try {
  const maker = await browser.newPage();
  await maker.setContent(`
    <h1>Fall 2026 Course List</h1>
    <table border="1"><tr><th>Code</th><th>Title</th><th>Credits</th></tr>
    <tr><td>CS 101</td><td>Intro to Programming</td><td>3</td></tr>
    <tr><td>BIO 210</td><td>Cell Biology</td><td>4</td></tr></table>
    <p style="page-break-before: always">Advising holds must be cleared by October 30.</p>`);
  await maker.pdf({ path: fixture, format: 'Letter' });
  await maker.close();

  const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 10_000 },
  );
  const extensionId = new URL(worker.url()).host;
  const panel = await browser.newPage();
  const problems = [];
  panel.on('pageerror', (error) => problems.push(error.message));
  panel.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await sleep(800);

  // Settings cog → Data (tabs UI was removed).
  await panel.click('button[aria-label="Settings"], .cog-btn');
  await sleep(400);
  await panel.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Data'));
    button?.click();
  });
  await sleep(500);

  const input = await panel.waitForSelector('label.file input[type=file]', { timeout: 10_000 });
  await input.uploadFile(fixture);
  await panel.waitForFunction(
    () => {
      const status = document.querySelector('.pdf-block .status, .data-view .status')?.textContent ?? '';
      return /Read “|Could not|still has almost no text|Chrome blocks/i.test(status) && !/^Reading the PDF/i.test(status);
    },
    { timeout: 60_000 },
  );
  const status = await panel.$eval('.pdf-block .status, .data-view .status', (element) => element.textContent);
  console.log('status:', status);
  if (problems.length) console.log('errors:\n' + problems.join('\n'));
  if (!/\d+\s*pages?/i.test(status ?? '')) throw new Error('PDF was not read as expected.');
  console.log('pdf ok');
} finally {
  await browser.close();
}
