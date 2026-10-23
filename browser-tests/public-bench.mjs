// Runs the agent with a REAL WebLLM model on a few public websites, read-only: navigation, links,
// reading, extraction, and tabs. No form is submitted and no account is touched. Each task's
// answer is checked against facts read from the live page by this script, not against the agent's
// own claim. Site permission prompts are answered "Allow for this task"; approvals are DECLINED, so
// nothing consequential can happen even if the model tries.
// Run: CHROME_PATH=... MODEL=Phi-3.5-mini-instruct-q4f16_1-MLC node browser-tests/public-bench.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome binary.');
const model = process.env.MODEL ?? 'Phi-3.5-mini-instruct-q4f16_1-MLC';
const runs = Number(process.env.RUNS ?? 1);
const only = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
const out = path.resolve(process.env.OUT ?? path.join(root, '.cache/public-results.json'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read a fact from a live page in a scratch tab, so checks follow the site as it is today. */
async function fact(browser, url, read) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return await page.evaluate(read);
  } finally {
    await page.close();
  }
}

const TASKS = [
  {
    id: 'books-category',
    start: 'https://books.toscrape.com/',
    instruction: 'Open the Mystery category and tell me the title and price of the first book listed there.',
    shows: 'navigation by link, reading',
    expect: (browser) => fact(browser, 'https://books.toscrape.com/catalogue/category/books/mystery_3/index.html', () => ({
      title: document.querySelector('article.product_pod h3 a')?.getAttribute('title'),
      price: document.querySelector('article.product_pod .price_color')?.textContent.trim(),
    })),
    check: (run, expected) => [
      ['Answer names the first Mystery book', includesLoose(run.result, expected.title)],
      ['Answer gives its price', run.result.includes(expected.price.replace('Â', ''))],
    ],
  },
  {
    id: 'quotes-page-2',
    start: 'https://quotes.toscrape.com/',
    instruction: 'Go to the next page of quotes and tell me who wrote the first quote on that page.',
    shows: 'pagination link, reading',
    expect: (browser) => fact(browser, 'https://quotes.toscrape.com/page/2/', () => document.querySelector('.quote .author')?.textContent.trim()),
    check: (run, expected) => [
      ['Ended on page 2', /\/page\/2\/?$/.test(run.finalUrl)],
      ['Answer names the author', includesLoose(run.result, expected)],
    ],
  },
  {
    id: 'books-extract',
    start: 'https://books.toscrape.com/catalogue/category/books/travel_2/index.html',
    instruction: 'Put every book on this page with its price into a table.',
    shows: 'extraction into Data',
    expect: (browser) => fact(browser, 'https://books.toscrape.com/catalogue/category/books/travel_2/index.html', () => document.querySelectorAll('article.product_pod').length),
    check: (run, expected) => [['Extracted every book on the page', run.rows >= expected]],
  },
  {
    id: 'wiki-two-tabs',
    start: 'https://en.wikipedia.org/wiki/Alan_Turing',
    instruction: 'Open the Wikipedia article about Grace Hopper in a new tab and find the year she was born. Then switch back to the Alan Turing tab, find the year he was born, and tell me both years.',
    shows: 'open tab, read, switch back, read, answer from both',
    expect: async () => ({ hopper: '1906', turing: '1912' }),
    check: (run, expected) => [
      ['Opened a second tab', run.tabsOpened >= 1],
      ['Switched back to the Turing tab', run.log.some((line) => /SWITCH_TAB/.test(line))],
      ['Answer has both birth years', run.result.includes(expected.hopper) && run.result.includes(expected.turing)],
    ],
  },
  {
    id: 'hn-comments',
    start: 'https://news.ycombinator.com/',
    instruction: 'Open the comments page of the top story on Hacker News and tell me the story title.',
    shows: 'choosing among many similar links',
    expect: (browser) => fact(browser, 'https://news.ycombinator.com/', () => ({
      title: document.querySelector('.titleline > a')?.textContent.trim(),
      id: document.querySelector('tr.athing')?.id,
    })),
    check: (run, expected) => [
      ['Ended on the top story comments page', run.finalUrl.includes(`item?id=${expected.id}`)],
      ['Answer names the story', includesLoose(run.result, expected.title.split(/[:(–-]/)[0])],
    ],
  },
  {
    id: 'cross-site-tabs',
    start: 'https://example.com/',
    instruction: 'Open books.toscrape.com and quotes.toscrape.com in two new tabs. Tell me the title of the first book and the author of the first quote.',
    shows: 'two sites, permission prompts, reading across tabs',
    expect: async (browser) => ({
      book: await fact(browser, 'https://books.toscrape.com/', () => document.querySelector('article.product_pod h3 a')?.getAttribute('title')),
      author: await fact(browser, 'https://quotes.toscrape.com/', () => document.querySelector('.quote .author')?.textContent.trim()),
    }),
    check: (run, expected) => [
      ['Asked before reading each new site', run.siteAsks >= 2],
      ['Answer has the first book', includesLoose(run.result, expected.book)],
      ['Answer has the first quote author', includesLoose(run.result, expected.author)],
    ],
  },
].filter((task) => !only.size || only.has(task.id));

function includesLoose(text, wanted) {
  const clean = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9£$.]+/g, ' ').trim();
  return Boolean(wanted) && clean(text).includes(clean(wanted));
}

const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  pipe: true,
  userDataDir: path.join(root, '.cache/bench-profile'),
  enableExtensions: [path.join(root, '.output/chrome-mv3')],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 3_600_000,
  args: ['--no-sandbox', '--window-position=-2400,-2400', '--window-size=1280,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const worker = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'), { timeout: 15_000 });
const extensionId = new URL(worker.url()).host;
const panel = await browser.newPage();
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
const site = await browser.newPage();
const loaded = await panel.evaluate(async (id) => {
  try {
    await window.ghostclickAgent.loadModel(id, () => undefined);
    return window.ghostclickAgent.loadedModel();
  } catch (error) {
    return `error: ${error?.message ?? error}`;
  }
}, model);
console.log(`Model: ${loaded}`);

const results = [];
for (const task of TASKS) {
  for (let attempt = 1; attempt <= runs; attempt += 1) {
    for (const page of await browser.pages()) if (page !== panel && page !== site) await page.close();
    const result = { id: task.id, attempt, shows: task.shows };
    try {
      const expected = await task.expect(browser);
      await site.goto(task.start, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await site.bringToFront();
      await sleep(1500);
      await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'CLEAR_RESULTS' }));
      const before = (await browser.pages()).length;
      const started = Date.now();
      const run = await panel.evaluate(async (goal) => {
        const { agent } = window.ghostclickAgent;
        const asked = [];
        const stop = agent.subscribe((state) => {
          if (state.pending && asked.at(-1)?.message !== state.pending.message) {
            asked.push({ ...state.pending });
            // Allow reading new sites for this task; decline anything consequential.
            setTimeout(() => agent.respond(state.pending?.kind === 'site' ? 'yes' : 'no'), 50);
          }
        });
        try {
          const state = await agent.run(goal, { maxSteps: 20, readAnySite: false });
          agent.reset();
          return { phase: state.phase, result: state.result ?? '', error: state.error, rows: state.rows, log: state.log.map((entry) => `${entry.step}. ${entry.action} → ${entry.result}${entry.ok ? '' : ' ✗'}`), asked };
        } finally {
          stop();
        }
      }, task.instruction);
      const pages = await browser.pages();
      const current = await panel.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url ?? '');
      Object.assign(result, run, {
        seconds: Math.round((Date.now() - started) / 1000),
        finalUrl: current,
        tabsOpened: Math.max(0, pages.length - before),
        siteAsks: run.asked.filter((item) => item.kind === 'site').length,
        approvalsDeclined: run.asked.filter((item) => item.kind === 'approve').length,
        actions: run.log.length,
        failed: run.log.filter((line) => line.endsWith('✗')).length,
      });
      result.criteria = task.check(result, expected).map(([text, met]) => ({ text, met: Boolean(met) }));
      result.pass = result.criteria.every((item) => item.met);
      result.expected = expected;
    } catch (error) {
      Object.assign(result, { pass: false, error: error.message.split('\n')[0], log: [] });
    }
    results.push(result);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ model, results }, null, 2));
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${task.id} #${attempt}: ${result.phase ?? ''} ${result.actions ?? 0} actions, ${result.failed ?? 0} failed, ${result.seconds ?? 0}s${result.error ? ` | ${result.error}` : ''}`);
    console.log(`    answer: ${String(result.result ?? '').slice(0, 200)}`);
    for (const line of result.log ?? []) console.log(`    ${line.slice(0, 180)}`);
    for (const item of (result.criteria ?? []).filter((entry) => !entry.met)) console.log(`    unmet: ${item.text}`);
  }
}
const passed = results.filter((item) => item.pass).length;
console.log(`\nPublic sites: ${passed}/${results.length} passed.`);
await browser.close();
