import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.output/chrome-mv3');
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome for Testing binary.');
const only = new Set((process.env.TESTS ?? 'plan,find,summary,data,pdf,repair').split(','));
const demoPort = 4174;
const demo = `http://127.0.0.1:${demoPort}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (start) => `${((Date.now() - start) / 1000).toFixed(1)}s`;
const report = [];
const note = (name, ok, detail) => {
  report.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const server = spawn(process.execPath, [path.join(root, 'scripts/demo-server.mjs')], {
  env: { ...process.env, PORT: String(demoPort) },
  stdio: 'ignore',
});

// A visible window is needed because headless Chrome on Linux exposes no WebGPU adapter.
const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  pipe: true,
  userDataDir: '/tmp/ghostclick-model-profile',
  enableExtensions: [extension],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 900_000,
  args: ['--no-sandbox', '--window-position=-2400,-2400', '--window-size=1280,900'],
});

try {
  const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 15_000 },
  );
  const extensionId = new URL(worker.url()).host;
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
  const site = await browser.newPage();
  if (process.env.DEBUG) panel.on('console', (message) => message.text().startsWith('GC_') && console.log(' ', message.text().slice(0, 1500)));

  const msg = (message) => panel.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const snap = async () => (await msg({ type: 'GET_SNAPSHOT' })).snapshot;
  const text = () => panel.evaluate(() => document.body.innerText);

  async function open(url) {
    await site.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    await site.bringToFront();
    await sleep(2000);
  }

  async function click(label, timeout = 15_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const found = await panel.evaluate((wanted) => {
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === wanted && !item.disabled);
        button?.click();
        return Boolean(button);
      }, label);
      if (found) return;
      await sleep(300);
    }
    throw new Error(`button “${label}” not found; panel shows: ${(await text()).slice(0, 200).replace(/\n/g, ' / ')}`);
  }

  async function fill(selector, value) {
    await panel.evaluate(
      (wanted, content) => {
        const field = [...document.querySelectorAll(wanted)].at(-1);
        const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, content);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      selector,
      value,
    );
    await sleep(200);
  }

  async function waitText(pattern, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (pattern.test(await text())) return true;
      await sleep(500);
    }
    return false;
  }

  async function listSample() {
    return panel.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const response = await chrome.tabs.sendMessage(active.id, { type: 'AUTO_EXTRACT' }, { frameId: 0 }).catch((error) => ({ error: String(error) }));
      return { url: active.url, count: response?.rows?.length, first: response?.rows?.slice(0, 2), error: response?.error };
    });
  }

  async function tab(name) {
    await panel.evaluate((wanted) => {
      [...document.querySelectorAll('nav.tabs button')].find((button) => button.textContent.startsWith(wanted))?.click();
    }, name);
    await sleep(400);
  }

  async function plan(request) {
    await tab('Ask');
    await fill('textarea', request);
    const start = Date.now();
    await click('Plan it');
    await waitText(/planned by/i, 120_000);
    const card = await panel.evaluate(() => ({
      tag: document.querySelector('.plan .tag')?.textContent ?? '',
      title: document.querySelector('.plan h2')?.textContent ?? '',
      fields: [...document.querySelectorAll('.plan input')].map((input) => input.value),
    }));
    return { ...card, time: seconds(start) };
  }

  const seeded = await snap();
  if (!seeded.workflows.some((workflow) => workflow.name === 'Advising hold release')) {
    const sw = await worker.worker();
    await sw.evaluate(async (base) => {
      const step = (kind, label, extra = {}) => ({ id: crypto.randomUUID(), kind, url: `${base}/`, selector: '#x', fallbacks: [], label, ...extra });
      const stored = await chrome.storage.local.get('workflows');
      await chrome.storage.local.set({
        workflows: [
          {
            id: 'advising',
            name: 'Advising hold release',
            goal: 'Clear an advising hold for a student',
            createdAt: Date.now(),
            steps: [
              step('navigate', 'Open the recorded page'),
              step('fill', 'Student name', { value: 'Ada Lovelace', variableKey: 'studentname' }),
              step('fill', 'Email', { value: 'ada@northwind.edu', variableKey: 'email' }),
              step('fill', 'Student ID', { value: '10203040', variableKey: 'student-id' }),
              step('click', 'Continue'),
            ],
          },
          ...(stored.workflows ?? []),
        ],
      });
    }, demo);
    await panel.reload({ waitUntil: 'load' });
  }

  if (process.env.MODEL) {
    await msg({ type: 'SET_SETTINGS', settings: { model: process.env.MODEL } });
    await panel.reload({ waitUntil: 'load' });
  }
  await panel.bringToFront();
  const loadStart = Date.now();
  await click('Load model');
  let footer = '';
  let loaded = false;
  while (Date.now() - loadStart < 1_200_000) {
    footer = await panel.evaluate(() => document.querySelector('footer p')?.textContent ?? '');
    if (/is ready\.|could not|cannot|not expose|Error|error/.test(footer)) {
      loaded = /is ready\./.test(footer);
      break;
    }
    console.log(`  loading ${seconds(loadStart)}: ${footer.slice(0, 120)}`);
    await sleep(15_000);
  }
  note('Load model', loaded && /is ready/.test(footer), `${seconds(loadStart)} | ${footer}`);
  if (!/is ready/.test(footer)) throw new Error('model did not load');

  if (only.has('plan')) {
    const cases = [
      ['Clear the advising hold for Grace Hopper, ID 55667788, grace@navy.mil', /Run “Advising hold release”/],
      ['in the trending repos i want every repo that is related to diagram design or something', /Find items|Collect the list/],
      ['save this article as a clean document', /Save this page/],
      ['Read the PDF in this tab', /Read a PDF/],
      ['book a dentist appointment on this site', /Teach Ghostclick/],
    ];
    for (const [request, expected] of cases) {
      const result = await plan(request);
      note(
        `Planner: “${request}”`,
        expected.test(result.title),
        `${result.time} | ${result.tag} | ${result.title} | fields ${JSON.stringify(result.fields)}`,
      );
      await click('Cancel', 2000).catch(() => undefined);
    }
  }

  if (only.has('find')) {
    for (const request of ['find the repos related to drawing diagrams or charts', 'find the repos that are about AI coding agents']) {
      await panel.bringToFront();
      const planned = await plan(request);
      await open('https://github.com/trending');
      if (process.env.DEBUG) console.log('  list:', JSON.stringify(await listSample()));
      const start = Date.now();
      await click('Find them');
      await waitText(/items match|Collected|No repeated list|cannot read/, 300_000);
      const result = await panel.evaluate(() => ({
        title: [...document.querySelectorAll('.plan h2')].at(-1)?.textContent ?? document.querySelector('.error')?.textContent ?? '',
        hint: document.querySelector('.plan .hint')?.textContent ?? '',
        items: [...document.querySelectorAll('ol.found li')].map((item) => item.textContent),
      }));
      note(
        `Find by meaning: “${request}”`,
        /items match/.test(result.title) && !/keywords/.test(result.hint),
        `${seconds(start)} | plan “${planned.title}” | ${result.title} | ${result.items.join(' ; ')}`,
      );
    }
  }

  if (only.has('summary')) {
    await open('https://en.wikipedia.org/wiki/WebGPU');
    await tab('Ask');
    await fill('textarea', 'Summarize this page');
    const start = Date.now();
    await click('Plan it');
    const done = await panel.waitForSelector('.answer', { timeout: 300_000 }).then(() => true).catch(() => false);
    const answerText = done ? await panel.$eval('.answer', (element) => element.textContent) : await text();
    const source = done ? await panel.evaluate(() => document.querySelector('.answer')?.previousElementSibling?.textContent ?? '') : '';
    note('Summarize a Wikipedia article', done && answerText.length > 80 && /WebGPU/.test(source), `${seconds(start)} | ${source} | ${answerText.slice(0, 400)}`);
  }

  if (only.has('data')) {
    await panel.bringToFront();
    await plan('get every book on this page');
    await open('https://books.toscrape.com/');
    if (process.env.DEBUG) console.log('  list:', JSON.stringify(await listSample()).slice(0, 400));
    await click('Find them');
    await waitText(/items match|Collected|No repeated list|cannot read/, 60_000);
    const rows = (await snap()).results.rows;
    if (!rows.length) throw new Error(`no books collected; panel shows: ${(await text()).slice(0, 300).replace(/\n/g, ' / ')}`);
    const priced = rows
      .map((row) => ({ title: row.title, price: Number.parseFloat(String(row.price ?? '').replace(/[^\d.]/g, '')) }))
      .filter((row) => !Number.isNaN(row.price))
      .sort((left, right) => left.price - right.price)
      .slice(0, 3);
    await tab('Data');
    await fill('.box textarea', 'Which 3 books are cheapest? Give titles and prices.');
    const start = Date.now();
    await click('Ask the local model');
    const done = await panel.waitForSelector('.box .answer', { timeout: 300_000 }).then(() => true).catch(() => false);
    const answerText = done ? await panel.$eval('.box .answer', (element) => element.textContent) : '';
    const correct = priced.filter((book) => answerText.includes(book.price.toFixed(2))).length;
    note(
      'Ask about scraped data (3 cheapest books)',
      correct >= 2,
      `${seconds(start)} | truth: ${priced.map((book) => `${book.title} £${book.price}`).join('; ')} | model: ${answerText.slice(0, 300)} | ${correct}/3 prices right`,
    );
  }

  if (only.has('pdf')) {
    await msg({ type: 'CLEAR_RESULTS' });
    await open('https://arxiv.org/pdf/1706.03762');
    await tab('Data');
    await click('Read the PDF in this tab');
    const read = await waitText(/Read “|Could not|not a PDF|larger/, 90_000);
    const status = await panel.evaluate(() => document.querySelector('.box .status')?.textContent ?? '');
    note('Read a PDF from a tab (Attention Is All You Need)', read && /Read “/.test(status), status);

    if (/Read “/.test(status)) {
      await fill('.box textarea[placeholder="When is the deadline?"]', 'What is the Transformer, in one or two sentences?');
      let start = Date.now();
      await click('Ask the local model');
      const answered = await panel
        .waitForFunction(() => document.querySelector('.box .answer')?.textContent?.length > 20, { timeout: 300_000, polling: 500 })
        .then(() => true)
        .catch(() => false);
      const answerText = answered ? await panel.$eval('.box .answer', (element) => element.textContent) : '';
      note('Ask about the PDF', answered && /attention/i.test(answerText), `${seconds(start)} | ${answerText.slice(0, 300)}`);

      await fill('.box textarea[placeholder^="Every course"]', 'the numbered section headings, like "3 Model Architecture"');
      await fill('.box input[placeholder="code, title, credits"]', 'number, heading');
      start = Date.now();
      await click('Pull out into a table');
      await waitText(/rows added|could not|Load a local model/, 900_000);
      const result = await panel.evaluate(() => document.querySelector('.box .status')?.textContent ?? '');
      const rows = (await snap()).results.rows;
      note(
        'Pull PDF section headings into a table',
        rows.length >= 3,
        `${seconds(start)} | ${result} | ${rows.slice(0, 8).map((row) => Object.values(row).slice(0, 3).join(' | ')).join(' ; ')}`,
      );
    }
  }

  if (only.has('repair')) {
    await open(`${demo}/`);
    await site.evaluate(() => sessionStorage.setItem('ghostclick-demo-break', '0'));
    await site.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const started = await msg({ type: 'START_RECORDING', name: 'Demo hold', goal: '' });
    if (!started?.ok) throw new Error('recording did not start');
    await sleep(1500);
    await site.type('#student-name', 'Ada Lovelace', { delay: 20 });
    await site.type('#email', 'ada@northwind.edu', { delay: 20 });
    await site.type('#student-id', '10203040', { delay: 20 });
    await Promise.all([site.waitForNavigation().catch(() => null), site.click('#continue')]);
    await sleep(1500);
    const saved = await msg({ type: 'STOP_RECORDING' });
    const workflow = saved.snapshot.workflows.find((item) => item.id === saved.id);

    await site.evaluate(() => sessionStorage.setItem('ghostclick-demo-break', '1'));
    await open(`${demo}/`);
    await msg({ type: 'CLEAR_LOG' });
    await msg({ type: 'START_REPLAY', workflowId: workflow.id, variables: { studentname: 'Grace Hopper' } });
    const start = Date.now();
    const suggested = await panel
      .waitForSelector('.suggestion strong', { timeout: 300_000 })
      .then(() => true)
      .catch(() => false);
    const choice = suggested ? await panel.$eval('.suggestion strong', (element) => element.textContent) : '';
    const reason = suggested ? await panel.$eval('.suggestion p:not(.tag)', (element) => element.textContent) : await text();
    const source = suggested ? await panel.$eval('.suggestion .tag', (element) => element.textContent) : '';
    if (suggested) await click('Use this control');
    await sleep(3000);
    note('Model repairs the redesigned button', /next/i.test(choice) && /details\.html/.test(site.url()), `${seconds(start)} | ${source} “${choice}”: ${reason.slice(0, 200)} | page now ${site.url()}`);
    await site.evaluate(() => sessionStorage.setItem('ghostclick-demo-break', '0')).catch(() => undefined);
  }
} catch (error) {
  note('model test run', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
  server.kill();
  console.log(`\n${report.filter((item) => item.ok).length} of ${report.length} checks passed.`);
}
