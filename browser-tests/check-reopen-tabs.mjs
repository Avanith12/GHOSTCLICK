/**
 * Live test: reopen last N tabs without duplicates.
 * Run: npm run build && CHROME_PATH=/usr/bin/google-chrome node browser-tests/check-reopen-tabs.mjs
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

function httpPages(pages) {
  return pages.filter((page) => /^https?:/i.test(page.url()));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

try {
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 15_000 },
  );
  const extensionId = new URL(workerTarget.url()).host;

  // Side panel page can send runtime messages (service worker cannot message itself).
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await sleep(400);

  const sendReopen = (count) =>
    panel.evaluate(
      (n) => chrome.runtime.sendMessage({ type: 'REOPEN_RECENT_TABS', count: n }),
      count,
    );

  // Open three sites; activate each so the extension can remember them.
  const urls = ['https://example.com/', 'https://example.org/', 'https://example.net/'];
  const sitePages = [];
  for (const url of urls) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.bringToFront();
    await sleep(500);
    sitePages.push(page);
  }
  await sleep(500);

  // Ensure storage has the three sites (puppeteer activation events can be flaky).
  const sw = await workerTarget.worker();
  await sw.evaluate(async (sites) => {
    await chrome.storage.local.set({
      recentTabs: sites.map((url, index) => ({ url, title: url, at: Date.now() - index * 10 })),
    });
  }, urls);

  const before = httpPages(await browser.pages()).length;

  // 0) Parallel double-send (simulates Strict Mode / double Go) must not duplicate.
  const [raceA, raceB] = await Promise.all([sendReopen(2), sendReopen(2)]);
  await sleep(900);
  let pages = httpPages(await browser.pages());
  let hosts = pages.map((page) => hostOf(page.url()));
  let dups = ['example.com', 'example.org', 'example.net'].filter(
    (host) => hosts.filter((item) => item === host).length > 1,
  );
  note(
    '0. parallel double reopen → no duplicate hosts',
    dups.length === 0 && pages.length <= before + 0,
    JSON.stringify({ raceA, raceB, before, after: pages.length, dups, hosts }),
  );

  // 1) Request 2 while those sites are already open → focus only, no duplicates.
  const first = await sendReopen(2);
  await sleep(900);
  pages = httpPages(await browser.pages());
  hosts = pages.map((page) => hostOf(page.url()));
  dups = ['example.com', 'example.org', 'example.net'].filter(
    (host) => hosts.filter((item) => item === host).length > 1,
  );
  note(
    '1. count 2 while open → opened=2, created=0, no duplicate hosts',
    Boolean(first?.ok && first.opened === 2 && first.created === 0 && dups.length === 0),
    JSON.stringify({ first, before, after: pages.length, dups, hosts }),
  );

  // Close two of the sites so reopen must create them again.
  for (const page of sitePages) {
    const host = hostOf(page.url());
    if (host === 'example.com' || host === 'example.org') await page.close().catch(() => undefined);
  }
  await sleep(500);

  const second = await sendReopen(2);
  await sleep(1200);
  pages = httpPages(await browser.pages());
  hosts = pages.map((page) => hostOf(page.url()));
  note(
    '2. count 2 after close → restores example.com and example.org',
    Boolean(second?.ok && second.opened === 2 && hosts.includes('example.com') && hosts.includes('example.org')),
    JSON.stringify({ second, hosts, tabs: pages.length }),
  );

  // 3) Ask again — still no duplicates.
  const third = await sendReopen(2);
  await sleep(900);
  pages = httpPages(await browser.pages());
  hosts = pages.map((page) => hostOf(page.url()));
  dups = ['example.com', 'example.org'].filter((host) => hosts.filter((item) => item === host).length > 1);
  note(
    '3. count 2 again → created=0, no duplicates',
    Boolean(third?.ok && third.created === 0 && third.opened === 2 && dups.length === 0),
    JSON.stringify({ third, dups, hosts, tabs: pages.length }),
  );

  // 4) Ask UI path: word number “two” on a fresh panel.
  const askPanel = await browser.newPage();
  await askPanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await sleep(700);
  await askPanel.click('.key-btn');
  await askPanel.waitForSelector('textarea', { timeout: 5000 });
  // Set React-controlled textarea via native setter so Go sees the text.
  await askPanel.evaluate(() => {
    const area = document.querySelector('textarea');
    if (!area) throw new Error('textarea missing');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    set?.call(area, 'open the last two tabs');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const beforeAsk = httpPages(await browser.pages()).length;
  await askPanel.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Go');
    if (!go) throw new Error('Go button missing');
    go.click();
  });
  let reply = '';
  try {
    await askPanel.waitForFunction(
      () => /Restored exactly 2|brought forward|opened \d+ new|You asked for 2|From your recent tabs/i.test(document.body.innerText),
      { timeout: 20_000 },
    );
    reply = await askPanel.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  } catch {
    reply = await askPanel.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  }
  note(
    '4. Ask “last two tabs” reports 2 (not 5)',
    /exactly 2|asked for 2|brought forward 2|From your recent tabs/i.test(reply) && !/asked for 5/i.test(reply),
    reply.slice(0, 280),
  );

  await sleep(800);
  pages = httpPages(await browser.pages());
  hosts = pages.map((page) => hostOf(page.url()));
  dups = ['example.com', 'example.org', 'example.net'].filter(
    (host) => hosts.filter((item) => item === host).length > 1,
  );
  note(
    '5. after Ask UI still no duplicate hosts / tab count stable',
    dups.length === 0 && pages.length <= beforeAsk + 1,
    JSON.stringify({ dups, hosts, beforeAsk, tabs: pages.length }),
  );

  const failed = report.filter((item) => !item.ok);
  console.log(`\n${report.length - failed.length}/${report.length} passed`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
