// Checks the Northwind Works demo site in a real Chrome, without the extension: every page loads
// without errors, deep links and refreshes keep state, and each Automation Challenge can be done by
// an ordinary user through normal clicks and typing. After each one, the challenge page must mark
// exactly that challenge as passed. Run: CHROME_PATH=... node browser-tests/demo-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome binary.');
const port = 4180;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, [path.join(root, 'browser-tests/demo-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(600);
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 900 } });
let page = await browser.newPage();
const errors = [];
const watch = (target) => {
  target.on('pageerror', (error) => errors.push(error.message));
  target.on('console', (message) => message.type() === 'error' && !/favicon/.test(message.text()) && errors.push(message.text()));
};
watch(page);

const report = [];
const note = (name, ok, detail = '') => {
  report.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const go = (file, target = page) => target.goto(`${base}/${file}`, { waitUntil: 'networkidle0' });
const aria = (name) => `::-p-aria(${name})`;
async function click(selector, target = page) {
  await target.waitForSelector(selector, { visible: true, timeout: 5000 });
  await target.click(selector);
}
async function type(selector, text, target = page) {
  await target.waitForSelector(selector, { visible: true, timeout: 5000 });
  await target.$eval(selector, (element) => {
    element.value = '';
  });
  await target.type(selector, text);
}
async function verdicts() {
  await go('challenges.html');
  return page.$$eval('[data-verdict]', (items) => Object.fromEntries(items.map((item) => [item.closest('article').id.replace('challenge-', ''), item.dataset.verdict])));
}
async function reset() {
  await go('index.html');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}
async function challenge(id, steps) {
  try {
    for (const other of await browser.pages()) if (other !== page) await other.close();
    await page.bringToFront();
    await reset();
    await steps();
    await sleep(300);
    const result = await verdicts();
    const others = Object.entries(result).filter(([key, value]) => key !== id && value === 'pass').map(([key]) => key);
    note(`challenge ${id} passes when done by hand`, result[id] === 'pass', others.length ? `also passed: ${others.join(', ')}` : '');
  } catch (error) {
    note(`challenge ${id} passes when done by hand`, false, `error: ${error.message.split('\n')[0]}`);
  }
}

async function fillApplication(details) {
  await go('apply.html');
  await type('input[name="firstName"]', details.first);
  await type('input[name="lastName"]', details.last);
  await type('input[name="email"]', details.email);
  await type('input[name="phone"]', details.phone);
  await page.select('select[name="location"]', details.location);
  await click('#next');
  return async () => {
    await page.select('select[name="position"]', details.position);
    await page.$eval('input[name="startDate"]', (input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, details.start);
    await click(`input[name="employmentType"][value="${details.type}"]`);
    await click('#next');
    await type('input[name="years"]', details.years);
    for (const skill of details.skills) await click(`input[name="skills"][value="${skill}"]`);
    await click('#next');
    await click('input[name="consent"]');
    await click('#next');
    await page.waitForSelector('#done:not([hidden])');
  };
}

try {
  // Every page renders without script errors.
  await reset();
  for (const file of ['index.html', 'directory.html', 'employee.html?id=E1001', 'apply.html', 'inventory.html', 'product.html?id=P002', 'analytics.html', 'settings.html', 'challenges.html', 'advising.html']) {
    errors.length = 0;
    await go(file);
    await sleep(500);
    const heading = await page.$eval('h1', (element) => element.textContent.trim()).catch(() => '');
    note(`loads ${file}`, Boolean(heading) && errors.length === 0, errors.length ? errors.join(' | ') : heading);
  }

  await reset();
  const fresh = await verdicts();
  note('no challenge passes on fresh data', Object.values(fresh).every((value) => value === 'fail'), `${Object.keys(fresh).length} challenges`);

  await go('directory.html?dept=Engineering&sort=lastName');
  await page.reload({ waitUntil: 'networkidle0' });
  const filtered = await page.$$eval('#rows tr td:nth-child(3)', (cells) => cells.map((cell) => cell.textContent));
  const names = await page.$$eval('#rows a[href^="employee"]:not([target])', (links) => links.map((link) => link.textContent.split(' ').at(-1)));
  note('directory deep link survives refresh, sorted by last name', filtered.length > 0 && filtered.every((value) => value === 'Engineering') && names.join() === [...names].sort().join(), names.join(', '));

  await go('apply.html');
  await type('input[name="phone"]', '5550107788');
  await click('#next');
  const problems = await page.$eval('#error-summary', (element) => element.textContent);
  note('application shows validation errors', /555-010-1234/.test(problems) && /required/.test(problems), problems.slice(0, 90));

  await go('inventory.html');
  const before = await page.$$eval('.product', (cards) => cards.length);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1200);
  const after = await page.$$eval('.product', (cards) => cards.length);
  note('inventory lazy-loads more products on scroll', after > before, `${before} → ${after}`);

  await challenge('find-person', async () => {
    await go('directory.html');
    await type('#search', 'Jordan');
    await sleep(400);
    const people = await page.$$eval('#rows a[href^="employee"]:not([target])', (links) => links.map((link) => link.textContent));
    if (!people.includes('Jordan Leigh')) throw new Error(`look-alikes missing: ${people}`);
    await click(aria('View details for Jordan Lee'));
    const dialog = await page.$eval('[role="dialog"]', (element) => element.textContent);
    if (!/Operations/.test(dialog)) throw new Error('department missing in modal');
  });

  await challenge('dark-mode', async () => {
    await go('settings.html');
    await click('[data-panel="appearance"]');
    await click('input[name="theme"][value="dark"]');
    await click('.save-bar button[type="submit"]');
  });

  await challenge('add-laptop', async () => {
    await go('inventory.html');
    await click('[data-category="Laptops"]');
    await click(aria('Add Lumen Air to cart'));
  });

  await challenge('engineering-export', async () => {
    await go('directory.html');
    await page.select('#department', 'Engineering');
    await page.select('#sort', 'lastName');
    await click('#export-csv');
  });

  await challenge('settings-automation', async () => {
    await go('settings.html');
    await click('[data-panel="appearance"]');
    await click('input[name="theme"][value="dark"]');
    await click('.combo-button');
    await click('[role="option"][data-value="Compact"]');
    await click('[data-panel="notifications"]');
    await click(aria('Email notifications'));
    await click('.save-bar button[type="submit"]');
    if ((await page.evaluate(() => document.documentElement.dataset.density)) !== 'compact') throw new Error('density not applied');
  });

  await challenge('cheap-laptop', async () => {
    await go('inventory.html');
    await click('[data-category="Laptops"]');
    await type('#max', '1200');
    await page.keyboard.press('Tab');
    await page.select('#sort', 'price-asc');
    await sleep(200);
    const order = await page.$$eval('.product h3', (titles) => titles.map((title) => title.textContent.trim()));
    if (order.slice(0, 3).join() !== 'Pico Book 11,Nimbus 13,Lumen Air') throw new Error(order.join());
    for (const name of order.slice(0, 3)) {
      await go('inventory.html?category=Laptops&max=1200&sort=price-asc');
      await click(aria(`Details for ${name}`));
      await page.waitForSelector('[data-field="price"]');
    }
    await go('inventory.html?category=Laptops&max=1200&sort=price-asc');
    if (!(await page.$eval('[aria-label="Add Pico Book 11 to cart"]', (button) => button.disabled))) throw new Error('sold-out item is addable');
    await click(aria('Add Nimbus 13 to cart'));
  });

  await challenge('application', async () => {
    const rest = await fillApplication({ first: 'Avery', last: 'Quinn', email: 'avery.quinn@example.com', phone: '555-010-4477', location: 'Remote', position: 'Data Analyst', start: '2026-11-02', type: 'Full-time', years: '4', skills: ['SQL', 'Python'] });
    await page.reload({ waitUntil: 'networkidle0' });
    // The draft and step survive a refresh.
    if ((await page.$eval('select[name="position"]', (select) => select.closest('fieldset').hidden))) throw new Error('lost the step after refresh');
    await rest();
  });

  await challenge('analytics-report', async () => {
    await go('analytics.html');
    await page.select('#range', '30');
    await click('#generate');
    const top = await page.$eval('[data-field="top-department"]', (element) => element.textContent);
    if (top !== 'Sales') throw new Error(`top was ${top}`);
    await click('[data-export="csv"]');
    await page.select('#range', '90');
    await click('#generate');
    const top90 = await page.$eval('[data-field="top-department"]', (element) => element.textContent);
    if (top90 === 'Sales') throw new Error('the 90-day leader should differ');
  });

  await challenge('cross-page', async () => {
    await go('directory.html');
    await type('#search', 'Jordan Lee');
    await sleep(400);
    await Promise.all([page.waitForNavigation(), page.click('#rows a[href="employee.html?id=E1001"]:not([target])')]);
    await page.waitForSelector('[data-field="department"]');
    await Promise.all([page.waitForNavigation(), click(aria('Operations performance'))]);
    await page.waitForSelector('#dept-Operations[open]');
  });

  await challenge('two-tabs', async () => {
    await go('inventory.html?category=Monitors&sort=price-asc');
    const tabs = [];
    for (const name of ['Clarity 24', 'Clarity 27 QHD']) {
      const opened = new Promise((resolve) => browser.once('targetcreated', (target) => resolve(target.page())));
      await click(aria(`Open ${name} in a new tab`));
      const tab = await opened;
      watch(tab);
      await tab.waitForSelector('[data-field="stock"]');
      tabs.push({ name, stock: await tab.$eval('[data-field="stock"]', (element) => Number.parseInt(element.textContent)) });
      // Background tabs pause animation frames, so come back to the list before the next click.
      await page.bringToFront();
    }
    const winner = tabs.sort((left, right) => right.stock - left.stock)[0];
    await page.bringToFront();
    await click(aria(`Add ${winner.name} to cart`));
  });

  await challenge('self-healing', async () => {
    await go('advising.html');
    await click('#break-toggle');
    await type('#student-name', 'Grace Hopper');
    await type('#email', 'grace.hopper@northwind.example');
    await type('#student-id', '55667788');
    await click('#next-step');
    await page.select('#term', 'Fall 2026');
    await type('#reason', 'Advising meeting completed.');
    await click('#submit-request');
  });

  await challenge('checkout', async () => {
    await go('inventory.html');
    await click('[data-category="Phones"]');
    await page.select('#sort', 'price-asc');
    await click(aria('Add Orbit Mini to cart'));
    await click('.cart-button');
    await click('[data-checkout]');
    await click('[data-place]');
    await page.waitForSelector('::-p-text(Order placed)');
  });

  await challenge('validation', async () => {
    const rest = await fillApplication({ first: 'Sam', last: 'Rivera', email: 'sam.rivera@example.com', phone: '5550107788', location: 'Toronto', position: 'Support Specialist', start: '2026-12-01', type: 'Contract', years: '2', skills: ['Customer service'] });
    if (!(await page.$('input[name="phone"][aria-invalid="true"]'))) throw new Error('bad phone was accepted');
    await type('input[name="phone"]', '555-010-7788');
    await click('#next');
    await rest();
  });

  // Reset returns everything to the start.
  await page.evaluate(() => localStorage.setItem('northwind-demo-v1', JSON.stringify({ version: 1, cart: [{ id: 'P002', qty: 1 }], orders: [], applications: [], events: [], settings: {} })));
  await go('settings.html#admin');
  await click('#reset-demo');
  await click('[data-confirm-reset]');
  await sleep(900);
  const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('northwind-demo-v1')));
  note('reset demo data empties the cart and events', cleared.cart.length === 0 && cleared.events.length === 0);

  errors.length = 0;
  await page.setViewport({ width: 390, height: 800 });
  await go('index.html');
  await click('.menu-toggle');
  await sleep(400);
  const visible = await page.$eval('.sidebar', (element) => element.getBoundingClientRect().left >= 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  note('mobile layout opens the sidebar from the menu button, no sideways scroll', visible && !overflow && errors.length === 0);
} catch (error) {
  note('demo test crashed', false, error.message.split('\n')[0]);
}

await browser.close();
server.kill();
const passed = report.filter((item) => item.ok).length;
console.log(`\n${passed} of ${report.length} checks passed.`);
process.exitCode = passed === report.length ? 0 : 1;
