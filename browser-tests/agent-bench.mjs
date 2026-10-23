// Benchmarks the agent with a REAL WebLLM model on the Northwind Works Automation Challenges.
// Every decision comes from the model. Each run starts from reset demo data on the Dashboard, and
// the result is graded by the demo's own verifier (demo/assets/challenges.js) from the final page
// state. Approvals are answered "yes" and help requests "no", like a person who lets it proceed.
//
// Run:  npm run build
//       CHROME_PATH=... MODEL=Phi-3.5-mini-instruct-q4f16_1-MLC RUNS=3 node browser-tests/agent-bench.mjs
// Options: ONLY=find-person,two-tabs  MAX_STEPS=30  OUT=bench-results.json
// The first run downloads the model (about 2.2 GB) into a profile under .cache/, reused afterwards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CHALLENGES, grade } = await import(pathToFileURL(path.join(root, 'demo/assets/challenges.js')).href);
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome binary.');
const model = process.env.MODEL ?? 'Phi-3.5-mini-instruct-q4f16_1-MLC';
const runs = Number(process.env.RUNS ?? 1);
const maxSteps = Number(process.env.MAX_STEPS ?? 30);
const only = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
const out = path.resolve(process.env.OUT ?? path.join(root, '.cache/bench-results.json'));
const port = 4190;
const demo = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Challenge 11 is a record-and-replay task for the Workflows tab, not an agent instruction.
const AGENT_CHALLENGES = CHALLENGES.filter((challenge) => challenge.id !== 'self-healing' && (!only.size || only.has(challenge.id)));

const server = spawn(process.execPath, [path.join(root, 'browser-tests/demo-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(600);
const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  pipe: true,
  userDataDir: path.join(root, '.cache/bench-profile'),
  enableExtensions: [path.join(root, '.output/chrome-mv3')],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 3_600_000,
  args: [
    '--no-sandbox',
    '--window-position=-2400,-2400',
    '--window-size=1280,900',
    // The side panel runs as a background tab here; keep its timers and GPU work at full speed.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

const worker = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'), { timeout: 15_000 });
const extensionId = new URL(worker.url()).host;
const panel = await browser.newPage();
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
const site = await browser.newPage();

console.log(`Loading ${model}…`);
const loadStarted = Date.now();
let lastProgress = '';
await panel.exposeFunction('benchProgress', (text) => {
  if (text !== lastProgress && /\d+%|Finish|Loading model from cache/.test(text)) {
    lastProgress = text;
    process.stdout.write(`\r${text.slice(0, 110).padEnd(110)}`);
  }
});
const loaded = await panel.evaluate(async (id) => {
  try {
    await window.ghostclickAgent.loadModel(id, (text) => window.benchProgress(text));
    return { ok: true, id: window.ghostclickAgent.loadedModel() };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}, model);
console.log(`\n${loaded.ok ? `Loaded ${loaded.id}` : `Model failed to load: ${loaded.error}`} in ${((Date.now() - loadStarted) / 1000).toFixed(0)} s`);
if (!loaded.ok) {
  await browser.close();
  server.kill();
  process.exit(1);
}

async function resetDemo() {
  for (const page of await browser.pages()) if (page !== panel && page !== site) await page.close();
  await site.goto(`${demo}/index.html`, { waitUntil: 'networkidle0' });
  await site.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await site.goto(`${demo}/index.html`, { waitUntil: 'networkidle0' });
  await site.bringToFront();
  await sleep(800);
}

async function runOne(challenge) {
  await resetDemo();
  const started = Date.now();
  const run = await panel.evaluate(
    async (goal, maxSteps) => {
      const { agent, chatWithTimeout } = window.ghostclickAgent;
      const calls = [];
      const asked = [];
      const stop = agent.subscribe((state) => {
        if (state.pending && asked.at(-1)?.message !== state.pending.message) {
          asked.push({ ...state.pending });
          setTimeout(() => agent.respond(state.pending?.kind === 'user' ? 'no' : 'yes'), 50);
        }
      });
      const decide = async (system, user, maxTokens, schema, temperature) => {
        const begin = performance.now();
        const reply = await chatWithTimeout(system, user, maxTokens, schema, temperature);
        calls.push({ kind: system.startsWith('You plan') ? 'plan' : system.startsWith('You check') ? 'verify' : 'step', ms: Math.round(performance.now() - begin), user, reply });
        return reply;
      };
      try {
        const state = await agent.run(goal, { maxSteps, decide, readAnySite: false });
        agent.reset();
        return { phase: state.phase, result: state.result, error: state.error, log: state.log, plan: state.plan, notes: state.notes, steps: state.steps.length, calls, asked };
      } catch (error) {
        return { phase: 'crashed', error: String(error?.message ?? error), log: [], calls, asked };
      } finally {
        stop();
      }
    },
    challenge.instruction,
    maxSteps,
  );
  const seconds = (Date.now() - started) / 1000;
  const state = await site.evaluate(() => JSON.parse(localStorage.getItem('northwind-demo-v1') ?? 'null'));
  const graded = state ? grade({ cart: [], orders: [], applications: [], events: [], settings: { notifications: {}, privacy: {} }, ...state }).find((item) => item.id === challenge.id) : { pass: false, criteria: [] };
  const executed = run.log.filter((entry) => !/^(Unreadable reply)$/.test(entry.action) && !/^Rejected|Skipped a repeated|There is no element|needs|is not|is a /.test(entry.result));
  return {
    id: challenge.id,
    pass: graded.pass,
    criteria: graded.criteria,
    phase: run.phase,
    claimedDone: run.phase === 'done',
    answer: run.result,
    error: run.error,
    seconds: Math.round(seconds),
    modelCalls: run.calls.length,
    stepsTaken: run.log.length,
    browserActions: executed.length,
    failedOrRejected: run.log.filter((entry) => !entry.ok).length,
    unparseable: run.log.filter((entry) => entry.action === 'Unreadable reply').length,
    approvals: run.asked.map((item) => `${item.kind}: ${item.message}`),
    log: run.log.map((entry) => `${entry.step}. ${entry.action} → ${entry.result}${entry.ok ? '' : ' ✗'}`),
    plan: run.plan,
    calls: run.calls,
    avgCallMs: run.calls.length ? Math.round(run.calls.reduce((sum, call) => sum + call.ms, 0) / run.calls.length) : 0,
  };
}

const results = [];
fs.mkdirSync(path.dirname(out), { recursive: true });
for (const challenge of AGENT_CHALLENGES) {
  for (let attempt = 1; attempt <= runs; attempt += 1) {
    let result;
    try {
      result = await runOne(challenge);
    } catch (error) {
      result = { id: challenge.id, pass: false, phase: 'harness error', error: error.message.split('\n')[0], seconds: 0, log: [], calls: [] };
    }
    result.attempt = attempt;
    results.push(result);
    fs.writeFileSync(out, JSON.stringify({ model, maxSteps, results }, null, 2));
    console.log(
      `${result.pass ? 'PASS' : 'FAIL'} ${challenge.id} #${attempt}: ${result.phase}, ${result.browserActions ?? 0} actions, ${result.failedOrRejected ?? 0} failed/rejected, ${result.seconds}s, ${result.avgCallMs ?? 0} ms/call${result.error ? ` | ${result.error}` : ''}`,
    );
    for (const line of result.log ?? []) console.log(`    ${line.slice(0, 200)}`);
    for (const item of (result.criteria ?? []).filter((entry) => !entry.met)) console.log(`    unmet: ${item.text}`);
  }
}

console.log('\nChallenge | Passed | Avg actions | Avg failed | Avg time');
for (const challenge of AGENT_CHALLENGES) {
  const mine = results.filter((item) => item.id === challenge.id);
  const avg = (key) => (mine.reduce((sum, item) => sum + (item[key] ?? 0), 0) / mine.length).toFixed(1);
  console.log(`${challenge.id} | ${mine.filter((item) => item.pass).length}/${mine.length} | ${avg('browserActions')} | ${avg('failedOrRejected')} | ${avg('seconds')}s`);
}
const passed = results.filter((item) => item.pass).length;
console.log(`\nOverall: ${passed}/${results.length} runs passed (${Math.round((passed / results.length) * 100)}%). Details: ${out}`);
await browser.close();
server.kill();
