import type { Row, WorkflowStep } from '@/shared/types';
import { actionKey, describeAction, firstJsonObject, isBlocked, needsApproval, parseAction, validateAction } from './actions';
import { AGENT_SYSTEM, PLAN_SCHEMA, PLAN_SYSTEM, STEP_SCHEMA, VERIFY_SCHEMA, VERIFY_SYSTEM, planPrompt, stepPrompt, verifyPrompt, type HistoryLine } from './agentPrompt';
import type { ActResult, AgentAction, ObservedElement, PageObservation, TabInfo } from './types';

/** Everything the loop needs from Chrome. The side panel implements it; tests use a fake. */
export interface AgentBrowser {
  activeTab(): Promise<{ tabId: number; url: string } | null>;
  tabs(): Promise<{ tabId: number; title: string; url: string }[]>;
  tabUrl(tabId: number): Promise<string>;
  observe(tabId: number, goal: string): Promise<PageObservation | null>;
  act(tabId: number, action: AgentAction): Promise<ActResult & { newTabId?: number }>;
  navigate(tabId: number, url: string): Promise<void>;
  history(tabId: number, direction: 'back' | 'forward'): Promise<void>;
  openTab(url: string): Promise<number>;
  switchTab(tabId: number): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  download(url: string): Promise<boolean>;
  screenshot(tabId: number): Promise<string | null>;
  saveRows(rows: Row[], source: string, append: boolean): Promise<void>;
  allowSite(host: string): Promise<void>;
  /** Keep (or with null, forget) the checkpoint of a running task. */
  saveRun(saved: SavedRun | null): Promise<void>;
  status(tabId: number | null, text: string): Promise<void>;
  stopRequested(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

/** Ask the model. `schema` is a JSON schema the reply must follow (used for constrained decoding). */
export type Decide = (system: string, user: string, maxTokens: number, schema?: object, temperature?: number) => Promise<string>;

export type AgentPhase = 'idle' | 'planning' | 'running' | 'paused' | 'waiting' | 'done' | 'failed' | 'stopped';
export type PendingKind = 'approve' | 'site' | 'user';
export type Answer = 'yes' | 'no' | 'always';
export type Pending = { kind: PendingKind; message: string; host?: string };
export type AgentEntry = { step: number; say: string; action: string; result: string; ok: boolean };

export type AgentState = {
  phase: AgentPhase;
  goal: string;
  step: number;
  maxSteps: number;
  current: string;
  say: string;
  plan: string[];
  doneWhen: string;
  log: AgentEntry[];
  notes: string[];
  pending: Pending | null;
  result: string;
  error: string;
  steps: WorkflowStep[];
  rows: number;
  screenshots: string[];
  page: string;
};

/** A checkpoint of a running task, written before every step. */
export type SavedRun = {
  goal: string;
  maxSteps: number;
  blocked: string[];
  allowed: string[];
  readAnySite: boolean;
  tabId: number;
  opened: number[];
  history: HistoryLine[];
  extracted: boolean;
  step: number;
  memory: Pick<AgentState, 'plan' | 'doneWhen' | 'notes' | 'log' | 'steps' | 'rows'>;
  at: number;
};

export type RunOptions = {
  maxSteps?: number;
  /** Sites the agent must never open or act on. */
  blocked?: string[];
  /** Sites the person always lets the agent read. */
  allowed?: string[];
  /** Read any site without asking (the person turned this on). */
  readAnySite?: boolean;
  decide?: Decide;
};

const MAX_FAILURES = 4;
const PAGE_ACTIONS = new Set(['CLICK', 'TYPE', 'SUBMIT', 'SELECT', 'HOVER', 'CLEAR']);
const REPEATABLE: Record<string, number> = { SCROLL: 3, WAIT: 3, READ: 2 };

export const SEARCH_URL = 'https://duckduckgo.com/html/?q=';

class Stopped extends Error {}

const initial = (): AgentState => ({
  phase: 'idle',
  goal: '',
  step: 0,
  maxSteps: 0,
  current: '',
  say: '',
  plan: [],
  doneWhen: '',
  log: [],
  notes: [],
  pending: null,
  result: '',
  error: '',
  steps: [],
  rows: 0,
  screenshots: [],
  page: '',
});

export function hostOf(url: string) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function navigateStep(url: string): WorkflowStep {
  return { id: crypto.randomUUID(), kind: 'navigate', url, selector: '', fallbacks: [], label: `Open ${hostOf(url) || url}` };
}

/** Per-run working memory. Survives tab switches; the model sees it every step. */
type Run = {
  goal: string;
  decide: Decide;
  maxSteps: number;
  blocked: string[];
  allowed: Set<string>;
  readAnySite: boolean;
  tabId: number;
  opened: Set<number>;
  history: HistoryLine[];
  extracted: boolean;
  tabs: TabInfo[];
};

export class AgentRunner {
  state: AgentState = initial();
  private listeners = new Set<(state: AgentState) => void>();
  private stopping = false;
  private pausing = false;
  private wake: (() => void) | null = null;
  private reply: ((answer: Answer) => void) | null = null;

  constructor(
    private browser: AgentBrowser,
    private decide: Decide,
    private interrupt: () => void = () => undefined,
  ) {}

  subscribe(listener: (state: AgentState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get running() {
    return ['planning', 'running', 'paused', 'waiting'].includes(this.state.phase);
  }

  private set(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  pause() {
    if (!this.running || this.pausing) return;
    this.pausing = true;
    this.set({ phase: 'paused', current: 'Pausing after this step…' });
  }

  resume() {
    if (!this.pausing) return;
    this.pausing = false;
    this.set({ phase: 'running', current: 'Resuming…' });
    this.wake?.();
  }

  stop() {
    if (!this.running) return;
    this.stopping = true;
    this.pausing = false;
    this.interrupt();
    this.wake?.();
    this.respond('no');
  }

  respond(answer: Answer) {
    const reply = this.reply;
    this.reply = null;
    reply?.(answer);
  }

  /** Forget a finished run so a new one starts clean. */
  reset() {
    if (!this.running) this.set(initial());
  }

  private async checkpoint() {
    if (!this.stopping && (await this.browser.stopRequested().catch(() => false))) this.stopping = true;
    if (this.stopping) throw new Stopped();
    while (this.pausing) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
    if (this.stopping) throw new Stopped();
  }

  private async ask(pending: Pending): Promise<Answer> {
    if (this.stopping) throw new Stopped();
    const before = this.state.phase;
    this.set({ phase: 'waiting', pending });
    const answer = await new Promise<Answer>((resolve) => {
      this.reply = resolve;
    });
    this.set({ phase: before === 'waiting' ? 'running' : before, pending: null });
    if (this.stopping) throw new Stopped();
    return answer;
  }

  private async think(run: Run, system: string, user: string, maxTokens: number, schema?: object, temperature = 0) {
    const reply = await run.decide(system, user, maxTokens, schema, temperature);
    if (this.stopping) throw new Stopped();
    return reply;
  }

  private log(entry: AgentEntry) {
    this.set({ log: [...this.state.log, entry].slice(-80) });
  }

  private addStep(step: WorkflowStep | undefined) {
    if (!step) return;
    const last = this.state.steps.at(-1);
    if (step.kind === 'navigate' && last?.kind === 'navigate') {
      this.set({ steps: [...this.state.steps.slice(0, -1), step] });
      return;
    }
    if (step.kind === 'navigate' && last && last.url === step.url) return;
    this.set({ steps: [...this.state.steps, step] });
  }

  private addNote(note: string) {
    this.set({ notes: [...this.state.notes, note.replace(/\s+/g, ' ').trim().slice(0, 400)].slice(-30) });
  }

  private allowed(run: Run, url: string) {
    const host = hostOf(url);
    return Boolean(host) && (run.readAnySite || run.allowed.has(host) || [...run.allowed].some((site) => host.endsWith(`.${site}`)));
  }

  /** Ask the person before reading a site they have not authorized. */
  private async permitSite(run: Run, url: string) {
    if (this.allowed(run, url)) return true;
    const host = hostOf(url);
    const answer = await this.ask({
      kind: 'site',
      host,
      message: `Let Ghostclick read and use ${host} for this task?`,
    });
    if (answer === 'no') return false;
    run.allowed.add(host);
    if (answer === 'always') await this.browser.allowSite(host).catch(() => undefined);
    return true;
  }

  /** Observe the agent's current tab, respecting blocked and authorized sites. */
  private async look(run: Run): Promise<{ page: PageObservation | null; note: string }> {
    const url = await this.browser.tabUrl(run.tabId).catch(() => '');
    if (!hostOf(url)) return { page: null, note: '' };
    if (isBlocked(url, run.blocked)) return { page: null, note: `${hostOf(url)} is blocked in Ghostclick settings. Go somewhere else.` };
    if (!(await this.permitSite(run, url))) {
      return { page: null, note: `The person did not allow Ghostclick to read ${hostOf(url)}. Use GO_BACK, another tab, or another site.` };
    }
    let page = await this.browser.observe(run.tabId, run.goal).catch(() => null);
    if (!page) {
      await this.browser.sleep(1200);
      page = await this.browser.observe(run.tabId, run.goal).catch(() => null);
    }
    return { page, note: page ? '' : 'The page could not be read yet. WAIT, then try again, or NAVIGATE elsewhere.' };
  }

  private async tabList(run: Run): Promise<TabInfo[]> {
    const all = await this.browser.tabs().catch(() => []);
    const current = all.filter((tab) => tab.tabId === run.tabId);
    const others = all.filter((tab) => tab.tabId !== run.tabId);
    return [...current, ...others].slice(0, 12).map((tab) => ({
      ...tab,
      current: tab.tabId === run.tabId,
      opened: run.opened.has(tab.tabId),
      allowed: this.allowed(run, tab.url),
    }));
  }

  async run(goal: string, options: RunOptions = {}) {
    if (this.running) return this.state;
    this.stopping = false;
    this.pausing = false;
    const maxSteps = Math.min(60, Math.max(3, options.maxSteps ?? 25));
    this.state = { ...initial(), phase: 'planning', goal, maxSteps, current: 'Planning…' };
    this.set({});

    const start = await this.browser.activeTab();
    if (!start) {
      this.set({ phase: 'failed', error: 'Open a browser tab first.' });
      return this.state;
    }
    const blocked = options.blocked ?? [];
    if (hostOf(start.url) && isBlocked(start.url, blocked)) {
      this.set({ phase: 'failed', error: `${hostOf(start.url)} is blocked in Ghostclick settings.` });
      return this.state;
    }
    const run: Run = {
      goal,
      decide: options.decide ?? this.decide,
      maxSteps,
      blocked,
      // Starting the task on a site is permission to read that site.
      allowed: new Set([...(options.allowed ?? []), hostOf(start.url)].filter(Boolean)),
      readAnySite: Boolean(options.readAnySite),
      tabId: start.tabId,
      opened: new Set(),
      history: [],
      extracted: false,
      tabs: [],
    };
    if (hostOf(start.url)) this.addStep(navigateStep(start.url));

    return this.guarded(async () => {
      // Clear a Stop left over from an earlier run, so it cannot end this one.
      await this.browser.stopRequested().catch(() => false);
      await this.browser.status(run.tabId, 'Planning…');
      const first = await this.look(run);
      try {
        const planned = firstJsonObject(await this.think(run, PLAN_SYSTEM, planPrompt(goal, first.page), 200, PLAN_SCHEMA));
        const plan = Array.isArray(planned?.plan) ? planned.plan.map((item) => String(item).slice(0, 120)).slice(0, 6) : [];
        this.set({ plan, doneWhen: String(planned?.done_when ?? '').slice(0, 200) });
      } catch (error) {
        if (error instanceof Stopped) throw error;
      }
      this.set({ phase: this.pausing ? 'paused' : 'running' });
      await this.loop(run, 1, 'Nothing yet. This is the first step.');
    });
  }

  /**
   * Continue a task that was interrupted, usually because the side panel closed. Memory, plan,
   * recorded steps, and the step count come from the last checkpoint; the page is looked at fresh.
   */
  async continueSaved(saved: SavedRun, options: Pick<RunOptions, 'decide'> = {}) {
    if (this.running) return this.state;
    this.stopping = false;
    this.pausing = false;
    let tabId = saved.tabId;
    if (!(await this.browser.tabUrl(tabId).then(Boolean).catch(() => false))) {
      const active = await this.browser.activeTab();
      if (!active) {
        this.set({ ...initial(), phase: 'failed', goal: saved.goal, error: 'Open a browser tab first.' });
        return this.state;
      }
      tabId = active.tabId;
    }
    this.state = { ...initial(), ...saved.memory, phase: 'running', goal: saved.goal, maxSteps: saved.maxSteps, step: saved.step, current: 'Resuming…' };
    this.set({});
    const run: Run = {
      goal: saved.goal,
      decide: options.decide ?? this.decide,
      maxSteps: saved.maxSteps,
      blocked: saved.blocked,
      allowed: new Set(saved.allowed),
      readAnySite: saved.readAnySite,
      tabId,
      opened: new Set(saved.opened),
      history: saved.history,
      extracted: saved.extracted,
      tabs: [],
    };
    return this.guarded(() =>
      this.loop(run, saved.step, 'The side panel was closed and reopened, which interrupted the task. Look at the current page and continue from where you were.'),
    );
  }

  /** Run part of a task, turning Stop and errors into a final state and always tidying up. */
  private async guarded(body: () => Promise<void>) {
    try {
      await body();
    } catch (error) {
      if (error instanceof Stopped) {
        this.set({ phase: 'stopped', pending: null, current: '', error: '', result: this.state.result || 'Stopped. Nothing else will be done.' });
      } else {
        this.set({ phase: 'failed', pending: null, current: '', error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.pausing = false;
      // The task ended here, so there is nothing to resume. (If the panel closes mid-task this never
      // runs, and the last checkpoint is offered as a resume when the panel opens again.)
      await this.browser.saveRun(null).catch(() => undefined);
      await this.browser.status(null, '').catch(() => undefined);
    }
    return this.state;
  }

  /** Save everything needed to continue this task after the side panel closes. */
  private async saveCheckpoint(run: Run, step: number) {
    const { plan, doneWhen, notes, log, steps, rows } = this.state;
    await this.browser
      .saveRun({
        goal: run.goal,
        maxSteps: run.maxSteps,
        blocked: run.blocked,
        allowed: [...run.allowed],
        readAnySite: run.readAnySite,
        tabId: run.tabId,
        opened: [...run.opened],
        history: run.history.slice(-30),
        extracted: run.extracted,
        step,
        memory: { plan, doneWhen, notes, log: log.slice(-40), steps, rows },
        at: Date.now(),
      })
      .catch(() => undefined);
  }

  private async loop(run: Run, firstStep: number, firstResult: string) {
    let lastResult = firstResult;
    let failures = 0;
    let verifyTries = 0;
    let before = '';
    let pageAction = false;
    const seen = new Map<string, number>();

    for (let step = firstStep; step <= run.maxSteps; step += 1) {
      await this.saveCheckpoint(run, step);
      await this.checkpoint();
      this.set({ step, current: 'Looking at the page…' });
      const { page, note } = await this.look(run);
      run.tabs = await this.tabList(run);
      this.set({ page: page ? `${page.title || page.url}` : (run.tabs.find((tab) => tab.current)?.url ?? '') });
      if (note) lastResult = `${lastResult} ${note}`;
      if (page && pageAction && before && page.fingerprint === before) lastResult += ' The page did not visibly change.';

      if (page?.captcha) {
        await this.browser.status(run.tabId, 'Waiting for you to solve a human check');
        const answer = await this.ask({ kind: 'user', message: 'This page shows a human check (captcha). Solve it in the page, then choose Continue. Ghostclick never solves these itself.' });
        lastResult = answer === 'no' ? 'The person could not pass the human check.' : 'The person solved the human check.';
        continue;
      }

      await this.browser.status(run.tabId, `Step ${step}: thinking…`);
      this.set({ current: 'Choosing the next action…' });
      const reply = await this.think(
        run,
        AGENT_SYSTEM,
        stepPrompt({ goal: run.goal, plan: this.state.plan, doneWhen: this.state.doneWhen, notes: this.state.notes, history: run.history, lastResult, step, maxSteps: run.maxSteps, tabs: run.tabs, page }),
        160,
        STEP_SCHEMA,
        // After a rejected or pointless action, sample a little so the model does not resend the same reply.
        /^(Rejected|You already did)/.test(lastResult) ? 0.6 : 0,
      );
      const parsed = parseAction(reply);
      const checked = parsed ? validateAction(parsed, page, run.tabs.length) : null;
      if (!parsed || !checked?.ok) {
        const problem = !parsed ? 'The reply was not one JSON action from the list.' : (checked as { error: string }).error;
        lastResult = `Rejected: ${problem}`;
        this.log({ step, say: parsed?.say ?? '', action: parsed ? describeAction(parsed) : 'Unreadable reply', result: problem, ok: false });
        run.history.push({ step, action: parsed ? describeAction(parsed) : 'invalid reply', result: `rejected: ${problem}` });
        failures += 1;
        if (failures >= MAX_FAILURES) throw new Error(`Ghostclick stopped after ${failures} failed attempts in a row. Last problem: ${problem}`);
        continue;
      }

      const { action, element } = checked;
      const label = describeAction(action, element);
      this.set({ say: action.say, current: label });
      await this.browser.status(run.tabId, label);

      const key = `${actionKey(action, element)}@${page?.fingerprint ?? 'none'}`;
      const count = seen.get(key) ?? 0;
      if (count >= (REPEATABLE[action.action] ?? 1) && action.action !== 'FINISH') {
        const problem = 'You already did exactly this on this unchanged page and it did not help. Do something different.';
        lastResult = problem;
        this.log({ step, say: action.say, action: label, result: 'Skipped a repeated action that made no progress.', ok: false });
        run.history.push({ step, action: label, result: 'skipped: repeated without progress' });
        failures += 1;
        if (failures >= MAX_FAILURES) throw new Error('Ghostclick kept repeating actions that made no progress, so it stopped.');
        continue;
      }
      seen.set(key, count + 1);

      const approval = action.action === 'CLOSE_TAB' ? this.closeApproval(run, action) : needsApproval(action, element);
      if (approval) {
        const answer = await this.ask({ kind: 'approve', message: approval });
        if (answer === 'no') {
          lastResult = 'The person did not approve that action. Find another way, ASK_USER, or FINISH with success false.';
          this.log({ step, say: action.say, action: label, result: 'You declined this action.', ok: false });
          run.history.push({ step, action: label, result: 'declined by the person' });
          continue;
        }
      }

      if (action.action === 'FINISH') {
        const answer = action.text ?? '';
        if (action.success === false) {
          this.log({ step, say: action.say, action: label, result: answer, ok: false });
          this.set({ phase: 'failed', current: '', result: answer, error: 'Ghostclick could not complete this task.' });
          return;
        }
        if (verifyTries < 2) {
          verifyTries += 1;
          this.set({ current: 'Checking that the goal is really done…' });
          const verdict = firstJsonObject(
            await this.think(run, VERIFY_SYSTEM, verifyPrompt({ goal: run.goal, doneWhen: this.state.doneWhen, notes: this.state.notes, history: run.history, answer, page }), 100, VERIFY_SCHEMA),
          );
          if (verdict && (verdict.complete === false || verdict.complete === 'false')) {
            const missing = String(verdict.missing ?? '').slice(0, 200) || 'the goal is not met yet';
            lastResult = `Not finished yet: ${missing}. Keep working.`;
            this.log({ step, say: action.say, action: label, result: `Not accepted yet: ${missing}`, ok: false });
            run.history.push({ step, action: label, result: `not accepted: ${missing}` });
            continue;
          }
        }
        this.log({ step, say: action.say, action: label, result: 'Task complete.', ok: true });
        this.set({ phase: 'done', current: '', result: answer });
        return;
      }

      before = page?.fingerprint ?? '';
      pageAction = PAGE_ACTIONS.has(action.action);
      const outcome = await this.execute(run, action, element, page);
      run.history.push({ step, action: label, result: outcome.message.slice(0, 220) });
      this.log({ step, say: action.say, action: label, result: outcome.message.slice(0, 400), ok: outcome.ok });
      lastResult = outcome.detail ? `${outcome.message}\n${outcome.detail}` : outcome.message;
      failures = outcome.ok ? 0 : failures + 1;
      if (failures >= MAX_FAILURES) throw new Error(`Ghostclick stopped after ${failures} failed actions in a row. Last problem: ${outcome.message}`);
    }
    throw new Error(`Reached the limit of ${run.maxSteps} steps before the goal was done. Raise the step limit or make the request more specific.`);
  }

  private closeApproval(run: Run, action: AgentAction) {
    const target = action.tab ? run.tabs[action.tab - 1] : run.tabs.find((tab) => tab.current);
    if (!target || run.opened.has(target.tabId)) return null;
    return `Close the tab "${target.title || target.url}", which Ghostclick did not open.`;
  }

  private async goTo(run: Run, url: string, newTab: boolean) {
    if (isBlocked(url, run.blocked)) return { ok: false, message: `${hostOf(url)} is blocked in Ghostclick settings.` };
    if (newTab) {
      run.tabId = await this.browser.openTab(url);
      run.opened.add(run.tabId);
    } else {
      await this.browser.navigate(run.tabId, url);
    }
    this.addStep(navigateStep(url));
    const now = await this.browser.tabUrl(run.tabId).catch(() => url);
    return { ok: true, message: `${newTab ? 'Opened a new tab with' : 'Opened'} ${now}.${newTab ? ' You are now working in that tab.' : ''}` };
  }

  private async execute(
    run: Run,
    action: AgentAction,
    element: ObservedElement | undefined,
    page: PageObservation | null,
  ): Promise<{ ok: boolean; message: string; detail?: string }> {
    switch (action.action) {
      case 'NAVIGATE':
        return this.goTo(run, action.url!, false);
      case 'OPEN_TAB':
        return this.goTo(run, action.url!, true);
      case 'SEARCH':
        return this.goTo(run, `${SEARCH_URL}${encodeURIComponent(action.text ?? '')}`, false);
      case 'SWITCH_TAB': {
        const target = run.tabs[(action.tab ?? 0) - 1]!;
        if (target.tabId === run.tabId) return { ok: true, message: 'That is already the current tab.' };
        if (isBlocked(target.url, run.blocked)) return { ok: false, message: `${hostOf(target.url)} is blocked in Ghostclick settings.` };
        if (hostOf(target.url) && !(await this.permitSite(run, target.url))) {
          return { ok: false, message: `The person did not allow Ghostclick to read ${hostOf(target.url)}, so it stayed in this tab.` };
        }
        await this.browser.switchTab(target.tabId);
        run.tabId = target.tabId;
        if (hostOf(target.url)) this.addStep(navigateStep(target.url));
        return { ok: true, message: `Switched to tab "${target.title}" (${target.url}). Your notes and plan carry over.` };
      }
      case 'CLOSE_TAB': {
        const target = action.tab ? run.tabs[action.tab - 1]! : run.tabs.find((tab) => tab.current)!;
        await this.browser.closeTab(target.tabId);
        run.opened.delete(target.tabId);
        if (target.tabId === run.tabId) {
          const next = await this.browser.activeTab();
          if (!next) throw new Error('No tab is left to work in.');
          run.tabId = next.tabId;
          if (hostOf(next.url)) this.addStep(navigateStep(next.url));
          return { ok: true, message: `Closed "${target.title}". Now in ${next.url}.` };
        }
        return { ok: true, message: `Closed "${target.title}".` };
      }
      case 'GO_BACK':
      case 'GO_FORWARD': {
        await this.browser.history(run.tabId, action.action === 'GO_BACK' ? 'back' : 'forward');
        const url = await this.browser.tabUrl(run.tabId);
        if (hostOf(url)) this.addStep(navigateStep(url));
        return { ok: true, message: `Went ${action.action === 'GO_BACK' ? 'back' : 'forward'} to ${url}.` };
      }
      case 'WAIT':
        await this.browser.sleep(action.ms ?? 1500);
        return { ok: true, message: `Waited ${((action.ms ?? 1500) / 1000).toFixed(1)} s.` };
      case 'NOTE':
        this.addNote(action.text ?? '');
        return { ok: true, message: 'Noted.' };
      case 'SCREENSHOT': {
        const shot = await this.browser.screenshot(run.tabId).catch(() => null);
        if (!shot) return { ok: false, message: 'Could not take a screenshot of this tab.' };
        this.set({ screenshots: [...this.state.screenshots, shot].slice(-4) });
        return { ok: true, message: 'Took a screenshot for the person.' };
      }
      case 'ASK_USER':
      case 'UPLOAD_FILE': {
        const message =
          action.action === 'UPLOAD_FILE'
            ? `Choose the file for "${element?.label ?? 'the upload field'}" in the page yourself (Ghostclick never picks files), then choose Continue.`
            : (action.text ?? 'Ghostclick needs your help.');
        await this.browser.status(run.tabId, 'Waiting for you in the side panel');
        const answer = await this.ask({ kind: 'user', message });
        return answer === 'no'
          ? { ok: true, message: 'The person could not help with that. Find another way or FINISH with success false.' }
          : { ok: true, message: 'The person finished that and chose Continue.' };
      }
      case 'DOWNLOAD': {
        const result = await this.browser.act(run.tabId, action);
        if (!result.ok || !result.href) return result;
        const started = await this.browser.download(result.href);
        return started ? { ok: true, message: `Started downloading ${result.href}.` } : { ok: false, message: 'Chrome refused that download.' };
      }
      case 'EXTRACT': {
        const result = await this.browser.act(run.tabId, action);
        const rows = result.rows ?? [];
        if (!rows.length) return { ok: false, message: result.message || 'No repeated list or table was found on this page.' };
        const append = run.extracted;
        await this.browser.saveRows(rows, page?.url ?? '', append);
        run.extracted = true;
        this.addStep(result.step);
        this.set({ rows: append ? this.state.rows + rows.length : rows.length });
        const sample = rows
          .slice(0, 5)
          .map((row) => Object.values(row).filter((value) => !/^https?:\/\//.test(value)).slice(0, 3).join(' · '))
          .join('\n');
        this.addNote(`Extracted ${rows.length} rows from ${page?.title || page?.url}.`);
        return { ok: true, message: `Extracted ${rows.length} rows into Data (columns: ${Object.keys(rows[0]!).slice(0, 6).join(', ')}).`, detail: `First rows:\n${sample}` };
      }
      case 'READ': {
        const result = await this.browser.act(run.tabId, action);
        if (result.ok && result.text) this.addNote(`From "${page?.title ?? ''}": ${result.text.slice(0, 300)}`);
        return { ok: result.ok, message: result.message, detail: result.text?.slice(0, 1200) };
      }
      default: {
        const result = await this.browser.act(run.tabId, action);
        this.addStep(result.step);
        if (result.newTabId) {
          run.tabId = result.newTabId;
          run.opened.add(result.newTabId);
          const url = await this.browser.tabUrl(result.newTabId).catch(() => '');
          if (hostOf(url)) this.addStep(navigateStep(url));
          return { ok: result.ok, message: `${result.message} It opened a new tab (${url}), which is now the current tab.` };
        }
        return { ok: result.ok, message: result.message };
      }
    }
  }
}
