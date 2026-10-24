/**
 * End-to-end: demo Ask phrases through the side panel Ask UI.
 * Needs: npm run demo (http://127.0.0.1:4173)
 * Run: npm run build && CHROME_PATH=/usr/bin/google-chrome node browser-tests/check-ask-demo-flow.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const demo = process.env.DEMO_URL || 'http://127.0.0.1:4173';
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

async function backToAsk(panel) {
  // After an agent run, AgentView still has a Task textarea + Start (not Go). Leave via Back to home.
  const onAgent = await panel.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '');
    return buttons.includes('Start') && !buttons.includes('Go') && buttons.some((label) => /Back to home/i.test(label));
  });
  if (onAgent) {
    await panel.evaluate(() => {
      const back = [...document.querySelectorAll('button')].find((button) => /Back to home/i.test(button.textContent ?? ''));
      back?.click();
    });
    await sleep(600);
  }
  // Data / PDF screen
  const onData = await panel.evaluate(() => Boolean(document.querySelector('label.file input[type=file]')));
  if (onData) {
    await panel.click('button.wordmark, [aria-label="Ghostclick home"]').catch(() => undefined);
    await sleep(500);
  }
  if (!(await panel.$('textarea')) || onAgent || onData) {
    if (await panel.$('.ghost-wake')) {
      /* on ghost home */
    }
    if (await panel.$('.key-btn')) await panel.click('.key-btn');
    else if (await panel.$('.ghost-wake')) await panel.click('.ghost-wake');
    await panel.waitForFunction(
      () => [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Go'),
      { timeout: 8000 },
    );
  }
}

async function askGo(panel, text) {
  await backToAsk(panel);
  await panel.evaluate((value) => {
    const area = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    set?.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await panel.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Go');
    if (!go) throw new Error('Go missing');
    go.click();
  });
}

try {
  const probe = await fetch(demo).then((response) => response.ok).catch(() => false);
  note('0. demo site reachable', probe, demo);
  if (!probe) {
    console.log('\nStart the demo first: npm run demo');
    process.exitCode = 1;
    await browser.close();
    process.exit(1);
  }

  await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 15_000 },
  );
  const extensionId = new URL(
    (await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'))).url(),
  ).host;

  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  await sleep(600);

  // Discover real demo paths from the homepage nav.
  const home = await browser.newPage();
  await home.goto(demo, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const links = await home.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map((anchor) => ({ href: anchor.href, text: (anchor.textContent || '').trim() }))
      .filter((item) => item.href.startsWith(location.origin)),
  );
  const inventoryUrl =
    links.find((item) => /inventory|product/i.test(item.text + item.href))?.href || `${demo}/`;
  const directoryUrl =
    links.find((item) => /director|employee|people/i.test(item.text + item.href))?.href || `${demo}/`;

  const inventory = await browser.newPage();
  await inventory.goto(inventoryUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Reload so the content script attaches (pages opened mid-load often miss it).
  await inventory.reload({ waitUntil: 'domcontentloaded' });
  await inventory.bringToFront();
  await sleep(500);

  const directory = await browser.newPage();
  await directory.goto(directoryUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await directory.reload({ waitUntil: 'domcontentloaded' });
  await directory.bringToFront();
  await sleep(500);

  await panel.bringToFront();

  // Seed recent-tab memory (activation events are flaky under puppeteer).
  const swTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
  );
  const sw = await swTarget.worker();
  await sw.evaluate(async (sites) => {
    await chrome.storage.local.set({
      recentTabs: sites.map((url, index) => ({ url, title: url, at: Date.now() - index * 10 })),
    });
  }, [inventoryUrl, directoryUrl, demo]);

  // A) Tab info
  await askGo(panel, 'How many tabs do I have open?');
  await panel.waitForFunction(() => /You have \d+ tabs? open/i.test(document.body.innerText), { timeout: 12_000 });
  note('A. Ask → tab count', true, (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160));
  await sleep(500);

  // B) Reopen
  await askGo(panel, 'open my last 2 tabs');
  try {
    await panel.waitForFunction(
      () => /Restored exactly 2|brought forward|opened \d+ new|No recent websites|Could not reopen/i.test(document.body.innerText),
      { timeout: 15_000 },
    );
  } catch {
    /* fall through to assert on body text */
  }
  await sleep(500);
  const reopenText = (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  note(
    'B. Ask → reopen last 2',
    /Restored exactly 2|brought forward|opened \d+ new/i.test(reopenText),
    reopenText.slice(0, 200),
  );

  // C) Go to site (no model required for open-only)
  await askGo(panel, 'go to example.com');
  await panel.waitForFunction(() => /Opened|Done|Opening example/i.test(document.body.innerText), { timeout: 20_000 });
  await sleep(1200);
  const hasExample = (await browser.pages()).some((page) => /example\.com/i.test(page.url()));
  note('C. Ask → go to example.com', hasExample, `example open=${hasExample}`);

  // Make the inventory tab the Chrome-active tab (side panel focus alone is not enough).
  async function activateUrl(url) {
    await sw.evaluate(async (target) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => (item.url || '').startsWith(target) || (item.url || '') === target);
      if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { active: true });
    }, url);
    await sleep(400);
  }

  // D) Find/scrape on inventory
  await inventory.reload({ waitUntil: 'domcontentloaded' });
  await activateUrl(inventoryUrl);
  const injected = await sw.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith(target) || (item.url || '') === target);
    if (tab?.id === undefined) return { ok: false, reason: 'no tab' };
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PING' }, { frameId: 0 });
      return { ok: true, reason: 'already' };
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['/content-scripts/content.js'],
        });
        const pong = await chrome.tabs.sendMessage(tab.id, { type: 'PING' }, { frameId: 0 }).catch(() => null);
        return { ok: Boolean(pong?.ok), reason: 'injected' };
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    }
  }, inventoryUrl);
  note('D0. content script on inventory', Boolean(injected?.ok), JSON.stringify(injected));
  await panel.bringToFront();
  await askGo(panel, 'Get every item on this page');
  await panel.waitForFunction(
    () => /Found|kept|No repeated list|cannot read|Reload|rows/i.test(document.body.innerText),
    { timeout: 25_000 },
  ).catch(() => null);
  await sleep(2000);
  const findText = (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  note(
    'D. Ask → scrape/find list',
    /Found|kept|Collected|items|rows|No repeated list|cannot read/i.test(findText),
    findText.slice(0, 200),
  );

  // E) Save page
  await activateUrl(inventoryUrl);
  await panel.bringToFront();
  await askGo(panel, 'Save this page as a clean document');
  await panel.waitForFunction(() => /Saved|Markdown|cannot read/i.test(document.body.innerText), { timeout: 20_000 }).catch(() => null);
  await sleep(1200);
  const saveText = (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  note('E. Ask → save page', /Saved|Markdown|cannot read/i.test(saveText), saveText.slice(0, 160));

  // F) Page question (model may be missing in headless; page must be readable first)
  await activateUrl(inventoryUrl);
  await panel.bringToFront();
  await askGo(panel, 'What is this page about?');
  await panel.waitForFunction(
    () => /From the page|local model did not load|WebGPU|Reading|cannot read/i.test(document.body.innerText),
    { timeout: 45_000 },
  ).catch(() => null);
  await sleep(1500);
  const askText = (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  note(
    'F. Ask → page question (answer, model error, or tab-read error)',
    /From the page|local model did not load|WebGPU|Reading|cannot read/i.test(askText),
    askText.slice(0, 180),
  );

  // G) Agent cart (model may be missing — must still enter agent / show load error)
  await activateUrl(inventoryUrl);
  await panel.bringToFront();
  await askGo(panel, 'Add one Lumen Air laptop to the cart');
  await panel.waitForFunction(
    () => /Working…|Planning|Needs you|local model did not load|WebGPU|Stop|Pause|step \d+/i.test(document.body.innerText),
    { timeout: 45_000 },
  ).catch(() => null);
  await sleep(1500);
  const agentText = (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  note(
    'G. Ask → agent cart task (UI path or model error)',
    /Working|Planning|Needs you|local model did not load|WebGPU|Stop|Pause|step/i.test(agentText),
    agentText.slice(0, 180),
  );

  // H) PDF → Data
  await askGo(panel, 'Read the PDF in this tab');
  await panel.waitForFunction(() => Boolean(document.querySelector('label.file input[type=file]')), { timeout: 12_000 });
  note('H. Ask → read PDF opens Data', Boolean(await panel.$('label.file input[type=file]')));

  // I) Ranking with data (only if scrape left rows in storage — soft check)
  await panel.click('button.wordmark, [aria-label="Ghostclick home"]').catch(() => undefined);
  await sleep(400);
  await askGo(panel, 'Which three are cheapest?');
  await panel.waitForFunction(
    () => /From the|scraped|Nothing has been scraped|local model did not load|WebGPU|Reading/i.test(document.body.innerText),
    { timeout: 30_000 },
  ).catch(() => null);
  await sleep(1000);
  const rankText = (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  note(
    'I. Ask → cheapest (ask_data or scrape-first message)',
    /From the|scraped|Nothing has been scraped|local model|WebGPU|Reading|page/i.test(rankText),
    rankText.slice(0, 180),
  );

  const failed = report.filter((item) => !item.ok);
  console.log(`\n${report.length - failed.length}/${report.length} passed`);
  console.log(
    '\nNote: F/G need WebGPU + a downloaded local model for a full answer/agent run. In headless CI they often show “model did not load” — that still proves Ask routed correctly.',
  );
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
