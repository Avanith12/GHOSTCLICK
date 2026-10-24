// Drives Ghostclick's agent loop in a real Chrome with the extension loaded, against the local
// Northwind Works demo. A scripted "model" replaces WebLLM: it reads the real prompt the agent
// builds, finds elements and tabs by their labels in it, and replies with JSON actions. Everything
// else is real: page observation, element ids, validation, approvals, site permissions, tabs,
// execution, saving the run as a workflow, and replaying it without any model.
// Run: npm run build, then CHROME_PATH=... node browser-tests/agent-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome binary.');
const port = 4182;
const demo = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, [path.join(root, 'browser-tests/demo-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(600);
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  enableExtensions: [path.join(root, '.output/chrome-mv3')],
  defaultViewport: { width: 1280, height: 900 },
  args: ['--no-sandbox'],
});
const worker = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'), { timeout: 10_000 });
const extensionId = new URL(worker.url()).host;
const panel = await browser.newPage();
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
const site = await browser.newPage();

const report = [];
const note = (name, ok, detail = '') => {
  report.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const msg = (message) => panel.evaluate((m) => chrome.runtime.sendMessage(m), message);

async function open(url) {
  await site.goto(url, { waitUntil: 'networkidle0' });
  await site.bringToFront();
  await sleep(800);
}
async function demoState() {
  return site.evaluate(() => JSON.parse(localStorage.getItem('northwind-demo-v1') ?? '{"events":[],"cart":[]}'));
}
async function verdict(id) {
  const tab = await browser.newPage();
  await tab.goto(`${demo}/challenges.html`, { waitUntil: 'networkidle0' });
  const result = await tab.$eval(`#challenge-${id} [data-verdict]`, (element) => element.dataset.verdict);
  await tab.close();
  await site.bringToFront();
  return result;
}
async function resetDemo() {
  await open(`${demo}/index.html`);
  await site.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  for (const page of await browser.pages()) if (page !== panel && page !== site) await page.close();
}

/**
 * Run the agent with scripted decisions. Each step is an action object; `label` is replaced by the id
 * of the element with that label in the current prompt, `tabTitle` by the matching tab number.
 * `answers` reply to approval, site, and help requests in order.
 */
async function runAgent(goal, steps, { answers = [], options = {} } = {}) {
  await site.bringToFront();
  return panel.evaluate(
    async (goal, steps, answers, options) => {
      const { agent } = window.ghostclickAgent;
      const prompts = [];
      const asked = [];
      const stop = agent.subscribe((state) => {
        if (state.pending && asked.at(-1)?.message !== state.pending.message) {
          asked.push({ ...state.pending });
          const answer = answers.shift() ?? 'no';
          setTimeout(() => agent.respond(answer), 50);
        }
      });
      const decide = async (system, user) => {
        if (system.startsWith('You plan')) return '{"plan":["Follow the scripted steps"],"done_when":"the script ends"}';
        if (system.startsWith('You check')) return '{"complete":true,"missing":""}';
        prompts.push(user);
        const step = steps.shift();
        if (!step) return '{"action":"FINISH","text":"Script ran out of steps","success":false}';
        if (step.stopNow) {
          agent.stop();
          return '{"action":"WAIT","ms":500}';
        }
        const action = { say: step.say ?? 'scripted step', ...step };
        if (step.label) {
          const lines = user.split('\n');
          // Match the element's own label (its first quoted text), not a field value that repeats it.
          const exact = lines.find((line) => {
            const found = line.match(/^\[\d+\] \S+ ("(?:[^"\\]|\\.)*")/);
            return Boolean(found) && JSON.parse(found[1]) === step.label;
          });
          const loose = lines.find((line) => /^\[\d+\] /.test(line) && line.toLowerCase().includes(step.label.toLowerCase()));
          const line = exact ?? loose;
          action.id = line ? Number(line.match(/^\[(\d+)\]/)[1]) : 999;
          delete action.label;
        }
        if (step.tabTitle) {
          const line = user.split('\n').find((item) => /^\[\d+\] "/.test(item) && item.includes(step.tabTitle));
          action.tab = line ? Number(line.match(/^\[(\d+)\]/)[1]) : 99;
          delete action.tabTitle;
        }
        return JSON.stringify(action);
      };
      try {
        const state = await agent.run(goal, { maxSteps: 30, ...options, decide });
        agent.reset();
        return { phase: state.phase, result: state.result, error: state.error, log: state.log, steps: state.steps, rows: state.rows, notes: state.notes, prompts, asked };
      } finally {
        stop();
      }
    },
    goal,
    steps,
    answers,
    options,
  );
}
const summary = (run) => `${run.phase}${run.error ? ` (${run.error})` : ''} | ${run.log.map((entry) => `${entry.action} → ${entry.result}`).join(' / ').slice(0, 500)}`;

async function scenario(name, body) {
  try {
    await body();
  } catch (error) {
    note(name, false, `error: ${error.message.split('\n')[0]}`);
  }
}

await scenario('0. side panel opens Ask on the home screen (no mode tabs)', async () => {
  const problems = [];
  panel.on('pageerror', (error) => problems.push(error.message));
  await panel.bringToFront();
  // Keyboard on home opens Ask inline (voice/type are the same Ask).
  await panel.click('.key-btn');
  await panel.waitForSelector('textarea', { timeout: 5000 });
  const tabs = await panel.$$eval('button', (buttons) =>
    buttons.map((button) => button.textContent.trim()).filter((label) => /Do anything|Quick ask/i.test(label)),
  );
  const hasAsk = Boolean(await panel.$('textarea'));
  const hasGo = await panel.$$eval('button', (buttons) => buttons.some((button) => button.textContent.trim() === 'Go'));
  note(
    '0. side panel opens Ask on the home screen (no mode tabs)',
    hasAsk && hasGo && tabs.length === 0 && problems.length === 0,
    `ask=${hasAsk}; go=${hasGo}; stray tabs=${tabs.join(', ') || 'none'}${problems.length ? ` | errors: ${problems.join(' | ')}` : ''}`,
  );
});

await scenario('1. navigate by instruction', async () => {
  await resetDemo();
  const run = await runAgent('Open the employee directory', [
    { action: 'NAVIGATE', url: `${demo}/directory.html` },
    { action: 'FINISH', text: 'The directory is open.' },
  ]);
  note('1. navigate by instruction', run.phase === 'done' && site.url().endsWith('/directory.html'), summary(run));
});

await scenario('2. find and click an element (look-alike names, modal)', async () => {
  const run = await runAgent('What department is Jordan Lee in?', [
    { action: 'TYPE', label: 'Search', text: 'Jordan' },
    { action: 'CLICK', label: 'View details for Jordan Lee' },
    { action: 'READ', text: 'department' },
    { action: 'FINISH', text: 'Jordan Lee is in Operations.' },
  ]);
  const prompt = run.prompts[2] ?? '';
  const views = (await demoState()).events.filter((event) => event.type === 'view-employee').map((event) => event.data.name);
  const graded = await verdict('find-person');
  note(
    '2. find and click an element (look-alike names, modal)',
    run.phase === 'done' && /dialog is open \("Jordan Lee"\)/.test(prompt) && graded === 'pass',
    `${summary(run)} | modal seen: ${/dialog is open/.test(prompt)} | views: ${views.join(', ')} | verdict: ${graded}`,
  );
});

let formRun = null;
await scenario('3. complete a two-step form, with approval before submitting', async () => {
  await resetDemo();
  await open(`${demo}/advising.html`);
  formRun = await runAgent(
    'Release the advising hold for Ada Lovelace, ada@northwind.example, ID 1234567, Fall 2026, reason: meeting done',
    [
      { action: 'TYPE', label: 'Student name', text: 'Ada Lovelace' },
      { action: 'TYPE', label: 'Email', text: 'ada@northwind.example' },
      { action: 'TYPE', label: 'Student ID', text: '1234567' },
      { action: 'CLICK', label: 'Continue' },
      { action: 'SELECT', label: 'Term', option: 'Fall 2026' },
      { action: 'TYPE', label: 'Reason', text: 'meeting done' },
      { action: 'CLICK', label: 'Submit request' },
      { action: 'VERIFY', text: 'Request submitted' },
      { action: 'FINISH', text: 'Submitted the request for Ada Lovelace.' },
    ],
    { answers: ['yes'] },
  );
  const sent = (await demoState()).events.filter((event) => event.type === 'advising-submitted');
  // Continue only moves to step 2, so only the final Submit request needs approval.
  note(
    '3. complete a two-step form, with approval before submitting',
    formRun.phase === 'done' && formRun.asked.length === 1 && /Submit request/.test(formRun.asked[0]?.message) && sent.some((event) => event.data.studentName === 'Ada Lovelace'),
    `${summary(formRun)} | asked: ${formRun.asked.map((item) => item.message).join(' ; ')}`,
  );
});

await scenario('4. decline a consequential action', async () => {
  await resetDemo();
  await open(`${demo}/inventory.html?category=Phones&sort=price-asc`);
  const run = await runAgent('Buy the cheapest phone that is in stock', [
    { action: 'CLICK', label: 'Add Orbit Mini to cart' },
    { action: 'CLICK', label: 'Open cart' },
    { action: 'CLICK', label: 'Checkout' },
    { action: 'CLICK', label: 'Place order' },
    { action: 'FINISH', text: 'You chose not to place the order.', success: false },
  ], { answers: ['no'] });
  const state = await demoState();
  note(
    '4. decline a consequential action',
    run.asked.some((item) => /Place order/.test(item.message)) && !state.events.some((event) => event.type === 'order-placed') && run.phase === 'failed',
    summary(run),
  );
});

await scenario('5. navigate across pages and carry information (challenge cross-page)', async () => {
  await resetDemo();
  await open(`${demo}/index.html`);
  const run = await runAgent("Find Jordan Lee, check their department, then open that department's analytics for the last 30 days", [
    { action: 'CLICK', label: 'Find a colleague' },
    { action: 'TYPE', label: 'Search', text: 'Jordan Lee' },
    { action: 'CLICK', label: 'Jordan Lee' },
    { action: 'NOTE', text: 'Jordan Lee works in Operations.' },
    { action: 'CLICK', label: 'Operations performance' },
    { action: 'VERIFY', text: 'Department details' },
    { action: 'FINISH', text: 'Operations: details are open for the last 30 days.' },
  ]);
  note('5. navigate across pages and carry information (challenge cross-page)', run.phase === 'done' && (await verdict('cross-page')) === 'pass' && /Operations/.test(run.prompts.at(-1)), summary(run));
});

await scenario('5b. custom dropdown and switches (challenge settings-automation)', async () => {
  await resetDemo();
  await open(`${demo}/settings.html`);
  const run = await runAgent('Switch to dark mode, enable email notifications, change the display density to Compact, and save', [
    { action: 'CLICK', label: 'Appearance' },
    { action: 'CLICK', label: 'Dark mode' },
    { action: 'CLICK', label: 'Display density Comfortable' },
    { action: 'CLICK', label: 'Compact' },
    { action: 'CLICK', label: 'Notifications' },
    { action: 'CLICK', label: 'Email notifications' },
    { action: 'CLICK', label: 'Save changes' },
    { action: 'FINISH', text: 'Dark mode, email notifications, and Compact density are saved.' },
  ], { answers: ['yes'] });
  const switchSeen = run.prompts.some((prompt) => /checkbox "Email notifications" \(unchecked\)/.test(prompt));
  note('5b. custom dropdown and switches (challenge settings-automation)', run.phase === 'done' && switchSeen && (await verdict('settings-automation')) === 'pass', `switch state seen: ${switchSeen} | ${summary(run)}`);
});

await scenario('5c. date filter, report, export (challenge analytics-report)', async () => {
  await resetDemo();
  await open(`${demo}/analytics.html?range=90`);
  const run = await runAgent('In Analytics, select the last 30 days, find the highest-performing department, generate the report, and export it as CSV', [
    { action: 'SELECT', label: 'Date range', option: 'Last 30 days' },
    { action: 'CLICK', label: 'Apply' },
    { action: 'CLICK', label: 'Generate report' },
    { action: 'READ', text: 'Top department' },
    { action: 'CLICK', label: 'Export report as CSV' },
    { action: 'FINISH', text: 'Sales performed best in the last 30 days; the report is exported.' },
  ]);
  const read = run.log.find((entry) => entry.action.startsWith('READ'));
  const sawSales = run.prompts.some((prompt) => /Top department: Sales/.test(prompt));
  note('5c. date filter, report, export (challenge analytics-report)', run.phase === 'done' && sawSales && (await verdict('analytics-report')) === 'pass', `report text reached the agent: ${sawSales} | ${read?.result ?? ''} | ${summary(run)}`);
});

await scenario('6. extract structured data into Data', async () => {
  await open(`${demo}/inventory.html?category=Laptops`);
  const run = await runAgent('Put every laptop and its price in a table', [{ action: 'EXTRACT' }, { action: 'FINISH', text: 'Done' }]);
  const snapshot = (await msg({ type: 'GET_SNAPSHOT' })).snapshot;
  const titles = snapshot.results.rows.map((row) => Object.values(row).join(' ')).join(' ');
  note('6. extract structured data into Data', run.rows >= 7 && /Aurora 14/.test(titles) && /\$1,149/.test(titles), `${run.rows} rows; ${summary(run)}`);
});

await scenario('7. recover from an invented element id and a missing control', async () => {
  await open(`${demo}/directory.html`);
  const run = await runAgent('Open the next page of the directory', [
    { action: 'CLICK', id: 999 },
    { action: 'CLICK', label: 'Delete everyone' },
    { action: 'CLICK', label: 'Next page' },
    { action: 'FINISH', text: 'Page 2 is open.' },
  ]);
  const page = await site.$eval('#pagination', (element) => element.textContent);
  note('7. recover from an invented element id and a missing control', run.phase === 'done' && /no element \[999\]/.test(run.prompts[1]) && /Page 2 of/.test(page), summary(run));
});

await scenario('8. multiple tabs: discover, switch, read, act (challenge two-tabs)', async () => {
  await resetDemo();
  await open(`${demo}/inventory.html?category=Monitors&sort=price-asc`);
  const run = await runAgent('Open the two cheapest monitors in new tabs, compare their stock, and add the one with more units to the cart', [
    { action: 'CLICK', label: 'Open Clarity 24 in a new tab' },
    { action: 'READ', text: 'in stock' },
    { action: 'NOTE', text: 'Clarity 24 has 6 in stock.' },
    { action: 'SWITCH_TAB', tabTitle: 'Product Inventory' },
    { action: 'CLICK', label: 'Open Clarity 27 QHD in a new tab' },
    { action: 'READ', text: 'in stock' },
    { action: 'SWITCH_TAB', tabTitle: 'Product Inventory' },
    { action: 'CLICK', label: 'Add Clarity 27 QHD to cart' },
    { action: 'FINISH', text: 'Clarity 27 QHD has more stock (18 vs 6) and is in the cart.' },
  ]);
  const tabsSeen = run.prompts.some((prompt) => /Open tabs[\s\S]*\[2\] "Clarity 24/.test(prompt) || /"Clarity 24 · Northwind Works"/.test(prompt));
  const keptNotes = /Clarity 24 has 6 in stock/.test(run.prompts.at(-1));
  note('8. multiple tabs: discover, switch, read, act (challenge two-tabs)', run.phase === 'done' && tabsSeen && keptNotes && (await verdict('two-tabs')) === 'pass', `tabs listed: ${tabsSeen}, notes kept across tabs: ${keptNotes} | ${summary(run)}`);
});

await scenario('9. ask before reading another site, and close only with permission', async () => {
  await resetDemo();
  await open(`${demo}/index.html`);
  const other = `http://localhost:${port}/directory.html`;
  const run = await runAgent('Open the directory on the localhost address in a new tab, then close the dashboard tab', [
    { action: 'OPEN_TAB', url: other },
    { action: 'READ' },
    { action: 'CLOSE_TAB', tabTitle: 'Dashboard' },
    { action: 'FINISH', text: 'Done' },
  ], { answers: ['yes', 'no'] });
  const kinds = run.asked.map((item) => item.kind).join(',');
  const dashboardOpen = (await browser.pages()).some((page) => page.url().endsWith('/index.html'));
  note('9. ask before reading another site, and close only with permission', kinds === 'site,approve' && dashboardOpen && run.phase === 'done', `asked: ${run.asked.map((item) => item.message).join(' ; ')}`);
  for (const page of await browser.pages()) if (page.url().startsWith('http://localhost')) await page.close();
});

await scenario('10. stop midway', async () => {
  await open(`${demo}/directory.html`);
  const run = await runAgent('Type a search, then keep going', [{ action: 'TYPE', label: 'Search', text: 'Grace' }, { stopNow: true }, { action: 'CLICK', label: 'Next page' }]);
  const typed = await site.$eval('#search', (input) => input.value);
  note('10. stop midway', run.phase === 'stopped' && typed === 'Grace' && run.log.length === 1, summary(run));
});

await scenario('11. on-page Stop button ends the run', async () => {
  await open(`${demo}/directory.html`);
  const pending = runAgent('Wait around', Array.from({ length: 20 }, () => ({ action: 'WAIT', ms: 1500 })));
  await sleep(2500);
  const bar = await site.$eval('[data-ghostclick="hud"]', (element) => element.textContent).catch(() => '');
  await site.click('[data-ghostclick="stop"]');
  const run = await pending;
  note('11. on-page Stop button ends the run', run.phase === 'stopped' && /Ghostclick agent/.test(bar), `bar said: ${bar.slice(0, 60)}`);
});

await scenario('12. report a task that cannot be done', async () => {
  const run = await runAgent('Book a flight to Paris on this site', [{ action: 'READ', text: 'flights' }, { action: 'FINISH', text: 'This site has no flight booking.', success: false }]);
  note('12. report a task that cannot be done', run.phase === 'failed' && run.result === 'This site has no flight booking.', summary(run));
});

await scenario('13. save the agent run as a workflow and replay it without the model', async () => {
  if (!formRun) throw new Error('form run missing');
  const saved = await msg({ type: 'SAVE_WORKFLOW', name: 'Release an advising hold', goal: 'Release an advising hold', steps: formRun.steps });
  const workflow = saved.snapshot.workflows.find((item) => item.id === saved.id);
  const kinds = workflow.steps.map((step) => step.kind).join(',');
  const keys = workflow.steps.filter((step) => step.variableKey).map((step) => step.variableKey);
  await resetDemo();
  await open(`${demo}/index.html`);
  const variables = Object.fromEntries(keys.map((key) => [key, key.startsWith('studentname') ? 'Katherine Johnson' : key.startsWith('studentid') ? '7654321' : undefined]).filter(([, value]) => value));
  const started = await msg({ type: 'START_REPLAY', workflowId: workflow.id, variables });
  let state = null;
  for (let tries = 0; tries < 80; tries += 1) {
    state = (await msg({ type: 'GET_SNAPSHOT' })).snapshot;
    if (state.mode === 'paused') await msg({ type: 'RESOLVE_HUMAN', decision: { token: state.prompt.token, approved: false, selector: '' } });
    if (state.mode === 'idle' && tries > 2) break;
    await sleep(500);
  }
  const sent = (await demoState()).events.filter((event) => event.type === 'advising-submitted').map((event) => event.data.studentName);
  note(
    '13. save the agent run as a workflow and replay it without the model',
    started.ok && sent.includes('Katherine Johnson') && /Finished\. 1 checks passed/.test(state.statusText),
    `steps: ${kinds} | fields: ${keys.join(', ')} | ${state.statusText} | submitted: ${sent.join(', ')}`,
  );
});

await browser.close();
server.kill();
const passed = report.filter((item) => item.ok).length;
console.log(`\n${passed} of ${report.length} checks passed.`);
process.exitCode = passed === report.length ? 0 : 1;
