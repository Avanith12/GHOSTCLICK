import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome for Testing binary.');
const only = new Set((process.env.TESTS ?? 'scrape,markdown,replay,batch,search,repair,captcha,ask').split(','));
const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = [];
const note = (group, name, ok, detail) => {
  report.push({ group, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${group}] ${name}: ${detail}`);
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  enableExtensions: [extension],
  defaultViewport: { width: 1280, height: 900 },
  args: ['--no-sandbox', `--user-agent=${userAgent}`, '--lang=en-US'],
});

const worker = await browser.waitForTarget(
  (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
  { timeout: 10_000 },
);
const extensionId = new URL(worker.url()).host;
const panel = await browser.newPage();
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
const site = await browser.newPage();
await site.setUserAgent(userAgent);

const msg = (message) => panel.evaluate((m) => chrome.runtime.sendMessage(m), message);
const snap = async () => (await msg({ type: 'GET_SNAPSHOT' })).snapshot;
const activeTabId = () =>
  panel.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]?.id ?? null);

async function open(url) {
  try {
    await site.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (error) {
    return `could not load: ${error.message.split('\n')[0]}`;
  }
  await site.bringToFront();
  await sleep(1500);
  const tabId = await activeTabId();
  for (let tries = 0; tries < 20; tries += 1) {
    const ok = await panel.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: 'PING' }, { frameId: 0 }).then((r) => r?.ok).catch(() => false),
      tabId,
    );
    if (ok) return null;
    await sleep(300);
  }
  return 'content script never answered';
}

async function waitIdle(timeout = 45_000, onPause) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await snap();
    if (state.mode === 'paused' && onPause) {
      const handled = await onPause(state);
      if (handled === 'stop') return state;
    } else if (state.mode === 'idle') return state;
    await sleep(500);
  }
  return { ...(await snap()), timedOut: true };
}

const brief = (row) =>
  Object.fromEntries(Object.entries(row ?? {}).slice(0, 4).map(([key, value]) => [key, String(value).slice(0, 50)]));

async function scrape(name, url, selector) {
  const problem = await open(url);
  if (problem) return note('scrape', name, false, problem);
  try {
    await site.waitForSelector(selector, { timeout: 12_000 });
  } catch {
    return note('scrape', name, false, `item not found; page title “${await site.title()}”`);
  }
  await msg({ type: 'CLEAR_RESULTS' });
  const started = await msg({ type: 'START_PICK' });
  if (!started?.ok) return note('scrape', name, false, `pick did not start: ${started?.snapshot?.statusText}`);
  await sleep(900);
  await site.$eval(selector, (element) => element.scrollIntoView({ block: 'center' }));
  const start = Date.now();
  await site.click(selector);
  const state = await waitIdle(25_000);
  const { rows, columns } = state.results;
  name = `${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`;
  note(
    'scrape',
    name,
    rows.length >= 3,
    `${rows.length} rows; columns [${columns.slice(0, 6).join(', ')}]; first ${JSON.stringify(brief(rows[0]))}`,
  );
}

async function markdown(name, url) {
  const problem = await open(url);
  if (problem) return note('markdown', name, false, problem);
  const tabId = await activeTabId();
  const page = await panel.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: 'PAGE_MARKDOWN' }, { frameId: 0 }),
    tabId,
  );
  const text = page?.markdown ?? '';
  const headings = (text.match(/^#{1,3} .+$/gm) ?? []).slice(1, 5).join(' | ');
  const junk = /cookie|sign in|log in|subscribe|privacy policy/i.test(text.slice(0, 1500));
  note('markdown', name, text.length > 1500, `${text.length} chars; headings: ${headings}; nav junk near top: ${junk}`);
}

async function record(url, actions, check) {
  const problem = await open(url);
  if (problem) throw new Error(problem);
  const started = await msg({ type: 'START_RECORDING', name: `Test ${url}`, goal: '' });
  if (!started?.ok) throw new Error(started?.error ?? 'recording did not start');
  await sleep(1500);
  await actions();
  await sleep(1200);
  if (check) await msg({ type: 'ADD_CHECK', text: check });
  const stopped = await msg({ type: 'STOP_RECORDING' });
  if (!stopped?.ok) throw new Error(`nothing recorded: ${stopped?.snapshot?.statusText}`);
  return stopped.snapshot.workflows.find((workflow) => workflow.id === stopped.id);
}

const describe = (workflow) =>
  workflow.steps
    .map(
      (step) =>
        `${step.kind}:${step.label}${step.variableKey ? `{${step.variableKey}}` : ''}${
          process.env.DEBUG ? `[${step.selector} | ${step.fallbacks.join(' ; ')} | ${step.value ?? ''} | ${step.url}]` : ''
        }`,
    )
    .join(' → ');

async function replay(workflow, variables, onPause) {
  await open(workflow.steps[0].url);
  await msg({ type: 'CLEAR_LOG' });
  const started = await msg({ type: 'START_REPLAY', workflowId: workflow.id, variables });
  if (!started?.ok) throw new Error(started?.error ?? 'replay did not start');
  const state = await waitIdle(60_000, onPause);
  return {
    state,
    url: site.url(),
    log: state.log.map((line) => line.text).join(' / '),
  };
}

async function typeInto(selector, text) {
  await site.waitForSelector(selector, { visible: true, timeout: 10_000 });
  await site.click(selector, { count: 3 });
  await site.type(selector, text, { delay: 25 });
}

async function guarded(group, name, body) {
  try {
    await body();
  } catch (error) {
    note(group, name, false, `error: ${error.message.split('\n')[0]}`);
    await msg({ type: 'STOP_REPLAY', reason: 'test cleanup' }).catch(() => undefined);
    await msg({ type: 'DISCARD_RECORDING' }).catch(() => undefined);
  }
}

if (only.has('scrape')) {
  const sites = [
    ['Books to Scrape (shop)', 'https://books.toscrape.com/', 'article.product_pod h3 a'],
    ['Quotes to Scrape', 'https://quotes.toscrape.com/', '.quote .text'],
    ['Hacker News', 'https://news.ycombinator.com/', '.titleline > a'],
    ['Wikipedia table', 'https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue', 'table.wikitable tbody tr:nth-child(3) td:nth-child(3)'],
    ['GitHub Trending', 'https://github.com/trending', 'article.Box-row h2 a'],
    ['Laptop shop (prices)', 'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops', '.thumbnail .title, .card .title'],
    ['Countries list', 'https://www.scrapethissite.com/pages/simple/', '.country .country-name'],
    ['BBC News', 'https://www.bbc.com/news', '[data-testid="card-headline"]'],
    ['DEV Community', 'https://dev.to/', '.crayons-story__title a'],
    ['Stack Overflow', 'https://stackoverflow.com/questions', '.s-post-summary--content-title a'],
    ['Amazon search', 'https://www.amazon.com/s?k=usb+c+cable', '[data-component-type="s-search-result"] h2'],
    ['arXiv listing', 'https://arxiv.org/list/cs.AI/recent', 'dl dt a[title="Abstract"]'],
    ['Amazon store (loads more as you scroll)', 'https://www.amazon.com/stores/page/EBE27793-5C09-46E0-92C2-15B4414C1154/', '[data-testid="grid-item-buy-price"]'],
  ];
  for (const [name, url, selector] of sites) await guarded('scrape', name, () => scrape(name, url, selector));
}

if (only.has('markdown')) {
  const pages = [
    ['Wikipedia article', 'https://en.wikipedia.org/wiki/Alan_Turing'],
    ['MDN docs', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction'],
    ['Python tutorial', 'https://docs.python.org/3/tutorial/introduction.html'],
    ['Paul Graham essay', 'https://paulgraham.com/greatwork.html'],
    ['Book page', 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html'],
  ];
  for (const [name, url] of pages) await guarded('markdown', name, () => markdown(name, url));
}

let login = null;
if (only.has('replay') || only.has('repair')) {
  await guarded('replay', 'Record login (practicetestautomation.com)', async () => {
    login = await record(
      'https://practicetestautomation.com/practice-test-login/',
      async () => {
        await typeInto('#username', 'student');
        await typeInto('#password', 'Password123');
        await Promise.all([site.waitForNavigation({ timeout: 15_000 }).catch(() => null), site.click('#submit')]);
      },
      'Logged In Successfully',
    );
    note('replay', 'Record login (practicetestautomation.com)', login.steps.length >= 4, describe(login));
  });
}

if (only.has('replay') && login) {
  await guarded('replay', 'Replay login with the right password', async () => {
    const run = await replay(login, { username: 'student', password: 'Password123' });
    const passed = run.state.checks.some((check) => check.passed);
    note('replay', 'Replay login with the right password', passed && !run.state.timedOut, `${run.state.statusText} | ${run.log}`);
  });
  await guarded('replay', 'Replay login with a wrong password (test should fail)', async () => {
    const run = await replay(login, { username: 'student', password: 'wrong' });
    const failed = run.state.checks.some((check) => !check.passed);
    note(
      'replay',
      'Replay login with a wrong password (test should fail)',
      failed && !run.state.timedOut,
      `${run.state.timedOut ? 'TIMED OUT. ' : ''}${run.state.statusText} | ${run.log}`,
    );
  });
}

if (only.has('batch')) {
  await guarded('batch', 'httpbin order form, 3 CSV rows', async () => {
    const form = await record(
      'https://httpbin.org/forms/post',
      async () => {
        await typeInto('input[name="custname"]', 'Ada Lovelace');
        await typeInto('input[name="custtel"]', '5551234');
        await typeInto('input[name="custemail"]', 'ada@example.com');
        await site.click('input[value="medium"]');
        await site.click('input[value="cheese"]');
        await typeInto('textarea[name="comments"]', 'Ring twice');
        await Promise.all([site.waitForNavigation({ timeout: 15_000 }).catch(() => null), site.click('form button')]);
      },
      '"custname"',
    );
    note('batch', 'Record order form', form.steps.length >= 7, describe(form));
    const rows = [
      { custname: 'Grace Hopper', custtel: '111', custemail: 'grace@example.com', comments: 'row one' },
      { custname: 'Alan Turing', custtel: '222', custemail: 'alan@example.com', comments: 'row two' },
      { custname: 'Katherine Johnson', custtel: '333', custemail: 'kj@example.com', comments: 'row three' },
    ];
    await open(form.steps[0].url);
    await msg({ type: 'CLEAR_LOG' });
    const started = await msg({ type: 'START_BATCH', workflowId: form.id, rows });
    if (!started?.ok) throw new Error(started?.error);
    const state = await waitIdle(90_000);
    const body = await site.evaluate(() => document.body.innerText);
    note(
      'batch',
      'httpbin order form, 3 CSV rows',
      !state.timedOut && state.checks.length === 3 && state.checks.every((check) => check.passed) && body.includes('Katherine Johnson'),
      `${state.timedOut ? 'TIMED OUT. ' : ''}${state.statusText} | last page has Katherine Johnson: ${body.includes('Katherine Johnson')}`,
    );
  });
}

if (only.has('search')) {
  await guarded('search', 'Wikipedia search, then replay with a new term', async () => {
    const flow = await record(
      'https://en.wikipedia.org/wiki/Main_Page',
      async () => {
        const box = (await site.$('#searchInput')) ? '#searchInput' : 'input[name="search"]';
        await typeInto(box, 'Alan Turing');
        await Promise.all([site.waitForNavigation({ timeout: 15_000 }).catch(() => null), site.keyboard.press('Enter')]);
      },
      'From Wikipedia, the free encyclopedia',
    );
    note('search', 'Record Wikipedia search (pressing Enter)', flow.steps.length >= 3, describe(flow));
    const key = flow.steps.find((step) => step.kind === 'fill')?.variableKey ?? 'search';
    const run = await replay(flow, { [key]: 'Grace Hopper' });
    note(
      'search',
      'Wikipedia search, then replay with a new term',
      /Grace_Hopper/.test(run.url) && !run.state.timedOut,
      `${run.state.timedOut ? 'TIMED OUT. ' : ''}ended at ${run.url} | ${run.log}`,
    );
  });

  await guarded('search', 'News search + scrape (HN Algolia), replay with new query', async () => {
    const flow = await record('https://hn.algolia.com/', async () => {
      await typeInto('input[type="search"]', 'webgpu');
      await sleep(2500);
      const picked = await msg({ type: 'START_PICK' });
      if (!picked?.ok) throw new Error('pick during recording failed');
      await sleep(900);
      await site.click('.Story_title a, .Story_title span');
      await sleep(1500);
    });
    note('search', 'Record HN search + scrape step', flow.steps.some((step) => step.kind === 'extract'), describe(flow));
    const key = flow.steps.find((step) => step.kind === 'fill')?.variableKey ?? 'search';
    const run = await replay(flow, { [key]: 'rust' });
    const rows = run.state.results.rows;
    const mentions = rows.filter((row) => /rust/i.test(Object.values(row).join(' '))).length;
    if (process.env.DEBUG) {
      console.log('spec', JSON.stringify(flow.steps.find((step) => step.kind === 'extract')?.extract).slice(0, 400));
      rows.forEach((row, index) => console.log(index, Object.values(row).slice(0, 2).join(' | ').slice(0, 100)));
    }
    note(
      'search',
      'News search + scrape (HN Algolia), replay with new query',
      rows.length >= 5 && mentions >= rows.length / 2,
      `${run.state.timedOut ? 'TIMED OUT. ' : ''}${rows.length} rows, ${mentions} mention rust; first ${JSON.stringify(brief(rows[0]))} | ${run.log}`,
    );
  });
}

if (only.has('repair') && login) {
  await guarded('repair', 'Login button renamed and restyled', async () => {
    const script = await site.evaluateOnNewDocument(() => {
      window.addEventListener('load', () => {
        const button = document.querySelector('#submit');
        if (!button) return;
        button.removeAttribute('id');
        button.className = 'btn-primary';
        button.innerHTML = 'Sign in';
        const wrap = document.createElement('div');
        button.replaceWith(wrap);
        wrap.append(button);
      });
    });
    let prompt = null;
    const run = await replay(login, { username: 'student', password: 'Password123' }, async (state) => {
      prompt = state.prompt;
      const pick = state.prompt.candidates.find((candidate) => /sign in/i.test(candidate.label));
      await msg({
        type: 'RESOLVE_HUMAN',
        decision: { token: state.prompt.token, approved: Boolean(pick), selector: pick?.selector ?? '' },
      });
    });
    await site.removeScriptToEvaluateOnNewDocument(script.identifier);
    const offered = prompt ? prompt.candidates.map((candidate) => `${candidate.label} (${candidate.score.toFixed(2)})`).join(', ') : 'no prompt';
    const passed = run.state.checks.some((check) => check.passed);
    note('repair', 'Login button renamed and restyled', passed, `asked human: ${Boolean(prompt)}; offered: ${offered} | ${run.log}`);
  });
}

if (only.has('captcha')) {
  const demos = [
    ['Google reCAPTCHA demo', 'https://www.google.com/recaptcha/api2/demo', '#recaptcha-demo-submit'],
    ['hCaptcha demo', 'https://accounts.hcaptcha.com/demo', 'input[type="submit"], button[type="submit"]'],
    ['Cloudflare Turnstile demo', 'https://2captcha.com/demo/cloudflare-turnstile', 'button[type="submit"], form button'],
  ];
  for (const [name, url, selector] of demos) {
    await guarded('captcha', name, async () => {
      const flow = await record(url, async () => {
        await site.waitForSelector(selector, { timeout: 15_000 });
        await site.click(selector);
        await sleep(1500);
      });
      let seen = null;
      const run = await replay(flow, {}, async (state) => {
        seen = state.prompt;
        await msg({ type: 'RESOLVE_HUMAN', decision: { token: state.prompt.token, approved: false, selector: '' } });
        return 'stop';
      });
      note('captcha', name, seen?.kind === 'captcha', `paused for: ${seen?.kind ?? 'nothing'} | ${run.log}`);
    });
  }
}

if (only.has('ask')) {
  await guarded('ask', 'Ask: “get all the book titles and prices on this page”', async () => {
    await msg({ type: 'CLEAR_RESULTS' });
    await panel.bringToFront();
    await panel.reload({ waitUntil: 'load' });
    await panel.waitForSelector('textarea');
    await open('https://books.toscrape.com/catalogue/category/books/mystery_3/index.html');
    await askPanel('get all the book titles and prices on this page');
    await panel.waitForFunction(() => /items match|Collected|No repeated list|cannot read/.test(document.body.innerText), { timeout: 20_000, polling: 300 });
    const state = await snap();
    note('ask', 'Ask: “get all the book titles and prices on this page”', state.results.rows.length >= 10, `${state.results.rows.length} rows; first ${JSON.stringify(brief(state.results.rows[0]))}`);
  });
}

if (only.has('find')) {
  const requests = [
    ['https://github.com/trending', 'in the trending repos i want every repo that is related to diagram design or something'],
    ['https://github.com/trending', 'find the repos related to AI agents'],
    ['https://news.ycombinator.com/', 'show me every story about AI on this page'],
    ['https://books.toscrape.com/', 'get every book on this page'],
  ];
  for (const [url, request] of requests) {
    await guarded('find', `Ask: “${request}”`, async () => {
      await msg({ type: 'CLEAR_RESULTS' });
      await panel.bringToFront();
      await panel.reload({ waitUntil: 'load' });
      await panel.waitForSelector('textarea');
      await open(url);
      await askPanel(request);
      await panel.waitForFunction(() => /items match|Collected|No repeated list|cannot read/.test(document.body.innerText), { timeout: 20_000, polling: 300 });
      const result = await panel.evaluate(() => {
        const title = [...document.querySelectorAll('.plan h2')].at(-1)?.textContent ?? document.querySelector('.error')?.textContent ?? '';
        const items = [...document.querySelectorAll('ol.found li')].map((item) => item.textContent).slice(0, 5);
        return { title, items };
      });
      const state = await snap();
      note('find', `Ask: “${request}”`, state.results.rows.length > 0 || /0 of \d+/.test(result.title), `${result.title} | ${result.items.join(' ; ')}`);
    });
  }
}

async function askPanel(request) {
  await panel.evaluate((content) => {
    const field = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, content);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, request);
  await sleep(200);
  await panel.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Go')?.click());
}

async function clickText(page, text) {
  const handle = await page.waitForFunction(
    (wanted) => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === wanted),
    { timeout: 8000, polling: 200 },
    text,
  );
  await handle.asElement().click();
}

await browser.close();
const passed = report.filter((item) => item.ok).length;
console.log(`\n${passed} of ${report.length} checks passed.`);
