import {
  isHttpUrl,
  rememberVisit,
  siteKey,
  tabKey,
  titleMatchesSite,
  urlPatternsForSite,
  type RecentTab,
} from '@/features/tabs/recentTabs';
import { stepSummary } from '@/shared/textHelpers';
import { reachTab } from '@/shared/tabConnection';
import type {
  Decision,
  ExtractSpec,
  LogLine,
  Results,
  Row,
  Session,
  Settings,
  Snapshot,
  Workflow,
  WorkflowStep,
} from '@/shared/types';

const MAX_ROWS = 2000;

const emptySession = (): Session => ({
  mode: 'idle',
  tabId: null,
  draft: null,
  replayWorkflowId: null,
  replayIndex: 0,
  variables: {},
  batch: null,
  log: [],
  prompt: null,
  resolution: null,
  checks: [],
  statusText: '',
  pickReturnMode: 'idle',
});

const emptyResults = (): Results => ({ columns: [], rows: [], source: '' });

let session = emptySession();
let workflows: Workflow[] = [];
let results = emptyResults();
let settings: Settings = {
  screenshots: false,
  model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  theme: 'dark',
  agentMaxSteps: 25,
  agentAllowed: '',
  agentBlocked: '',
  agentReadAny: false,
  showGhostCursor: true,
};
// What the side panel's agent is doing, shown in that tab's on-page bar. Not persisted: a run ends
// when the side panel closes.
let agent = { tabId: null as number | null, text: '', stop: false };
/** Sites you recently focused — used for “open my last N tabs”. */
let recentTabs: RecentTab[] = [];
let ready: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();

export default defineBackground(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  // The agent lives in the side panel. When the panel closes, its run ends, so clear the on-page bar;
  // the panel offers to resume the task from its last checkpoint when it opens again.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel') return;
    port.onDisconnect.addListener(() => {
      agent = { tabId: null, text: '', stop: false };
    });
  });

  chrome.tabs.onActivated.addListener((info) => {
    void chrome.tabs.get(info.tabId).then((tab) => trackRecentTab(tab)).catch(() => undefined);
  });
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (tab.active && (change.url || change.title || change.status === 'complete')) {
      void trackRecentTab(tab);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handle(message, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  });
});

async function ensureReady() {
  if (!ready) {
    ready = (async () => {
      const [local, stored] = await Promise.all([
        chrome.storage.local.get(['workflows', 'settings', 'recentTabs']),
        chrome.storage.session.get(['session', 'results']),
      ]);
      workflows = ((local.workflows as Workflow[] | undefined) ?? []).map((workflow) => ({
        ...workflow,
        goal: workflow.goal ?? '',
      }));
      const saved = (local.settings as Partial<Settings> | undefined) ?? {};
      settings = {
        ...settings,
        ...saved,
        theme: saved.theme === 'light' ? 'light' : 'dark',
        showGhostCursor: saved.showGhostCursor !== false,
      };
      recentTabs = Array.isArray(local.recentTabs) ? (local.recentTabs as RecentTab[]) : [];
      session = { ...emptySession(), ...((stored.session as Session | undefined) ?? {}) };
      results = (stored.results as Results | undefined) ?? emptyResults();
    })();
  }
  await ready;
}

function persist() {
  const sessionCopy = structuredClone(session);
  const workflowCopy = structuredClone(workflows);
  const resultsCopy = structuredClone(results);
  const settingsCopy = structuredClone(settings);
  const recentCopy = structuredClone(recentTabs);
  writing = writing.then(async () => {
    await chrome.storage.session.set({ session: sessionCopy, results: resultsCopy });
    await chrome.storage.local.set({ workflows: workflowCopy, settings: settingsCopy, recentTabs: recentCopy });
  });
  return writing;
}

async function trackRecentTab(tab: chrome.tabs.Tab) {
  if (!tab.url || !isHttpUrl(tab.url)) return;
  await ensureReady();
  const before = recentTabs[0]?.url;
  recentTabs = rememberVisit(recentTabs, tab.url, tab.title ?? '');
  if (recentTabs[0]?.url !== before) await persist();
}

function log(text: string, tone: LogLine['tone'] = 'info') {
  session.log.push({ id: crypto.randomUUID(), text, tone });
  if (session.log.length > 60) session.log.splice(0, session.log.length - 60);
}

function snapshot(): Snapshot {
  return {
    ...session,
    workflows,
    replayTotal: currentWorkflow()?.steps.length ?? 0,
    results,
    settings,
  };
}

function usableTab(tab: chrome.tabs.Tab | undefined) {
  if (!tab?.id || !tab.url) return 'Open the website you want to use, then try again.';
  if (!/^https?:\/\//.test(tab.url)) return 'Ghostclick works on normal websites, not browser settings pages.';
  return null;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function handle(message: { type?: string; [key: string]: unknown }, sender: chrome.runtime.MessageSender) {
  await ensureReady();
  switch (message.type) {
    case 'GET_SNAPSHOT':
      return { ok: true, snapshot: snapshot() };
    case 'GET_STATE':
      return {
        mode: sender.tab?.id === session.tabId ? session.mode : 'idle',
        replayIndex: session.replayIndex,
        replayTotal: currentWorkflow()?.steps.length ?? 0,
        agent: sender.tab?.id !== undefined && sender.tab.id === agent.tabId ? agent.text : '',
        showGhostCursor: settings.showGhostCursor !== false,
      };
    case 'AGENT_STATUS':
      agent = { ...agent, tabId: typeof message.tabId === 'number' ? message.tabId : null, text: String(message.text ?? '').slice(0, 120) };
      if (agent.tabId === null) agent.stop = false;
      return { ok: true };
    case 'AGENT_STOP':
      agent = { ...agent, stop: true, text: 'Stopping…' };
      return { ok: true };
    case 'AGENT_STOP_REQUESTED': {
      const stop = agent.stop;
      agent.stop = false;
      return { ok: true, stop };
    }
    case 'ALLOW_SITE': {
      const host = String(message.host ?? '').trim().toLowerCase();
      const current = settings.agentAllowed.split(/\s+/).filter(Boolean);
      if (host && !current.includes(host)) settings = { ...settings, agentAllowed: [...current, host].join('\n') };
      await persist();
      return { ok: true };
    }
    case 'APPEND_RESULTS':
      mergeResults(((message.rows as Row[]) ?? []).slice(0, MAX_ROWS), String(message.source ?? ''));
      await persist();
      return { ok: true, snapshot: snapshot() };
    case 'SAVE_WORKFLOW':
      return saveWorkflow(String(message.name ?? ''), String(message.goal ?? ''), (message.steps as WorkflowStep[]) ?? []);
    case 'DELETE_STEP':
      return deleteStep(String(message.workflowId), String(message.stepId));
    case 'START_RECORDING':
      return startRecording(String(message.name ?? ''), String(message.goal ?? ''));
    case 'APPEND_STEP':
      return appendStep(message.step as WorkflowStep, sender);
    case 'ADD_CHECK':
      return addCheck(String(message.text ?? ''));
    case 'STOP_RECORDING':
      return stopRecording();
    case 'DISCARD_RECORDING':
      session = emptySession();
      session.statusText = 'Recording discarded.';
      await persist();
      return { ok: true, snapshot: snapshot() };
    case 'UPDATE_WORKFLOW':
      return updateWorkflow(String(message.id), message.name as string | undefined, message.goal as string | undefined);
    case 'DELETE_WORKFLOW':
      return deleteWorkflow(String(message.id));
    case 'START_REPLAY':
      return startReplay(
        String(message.workflowId),
        [(message.variables as Record<string, string>) ?? {}],
        Boolean(message.startFromCurrentTab),
      );
    case 'START_BATCH':
      return startReplay(String(message.workflowId), (message.rows as Record<string, string>[]) ?? [], false);
    case 'CURRENT_STEP':
      return currentStep();
    case 'ADVANCE':
      return advance(Number(message.index));
    case 'CHECK_RESULT':
      return checkResult(Number(message.index), String(message.text ?? ''), Boolean(message.passed));
    case 'ADD_RESULTS':
      return addResults(Number(message.index), (message.rows as Row[]) ?? [], String(message.url ?? ''));
    case 'REQUEST_HUMAN':
      return requestHuman(message.prompt as Snapshot['prompt']);
    case 'POLL_DECISION':
      return pollDecision(String(message.token));
    case 'RESOLVE_HUMAN':
      return resolveHuman(message.decision as Decision);
    case 'STOP_REPLAY':
      return stopReplay(String(message.reason ?? 'Replay stopped.'));
    case 'START_PICK':
      return startPick();
    case 'PICKED':
      return picked(message as unknown as { spec: ExtractSpec; rows: Row[]; label: string; url: string });
    case 'CANCEL_PICK':
      return cancelPick();
    case 'SET_RESULTS':
      results = emptyResults();
      mergeResults(((message.rows as Row[]) ?? []).slice(0, MAX_ROWS), String(message.source ?? ''));
      await persist();
      return { ok: true, snapshot: snapshot() };
    case 'CLEAR_RESULTS':
      results = emptyResults();
      await persist();
      return { ok: true, snapshot: snapshot() };
    case 'SET_SETTINGS':
      settings = { ...settings, ...((message.settings as Partial<Settings>) ?? {}) };
      await persist();
      return { ok: true, snapshot: snapshot() };
    case 'CLEAR_LOG':
      session.log = [];
      session.checks = [];
      session.statusText = '';
      await persist();
      return { ok: true, snapshot: snapshot() };
    case 'LOG':
      if (session.mode === 'replaying' || session.mode === 'paused') {
        log(String(message.text ?? ''), (message.tone as LogLine['tone']) ?? 'info');
        await persist();
      }
      return { ok: true };
    case 'VOICE_TRANSCRIPT':
      // Side panel listens for this; background only acknowledges.
      return { ok: true };
    case 'GET_TAB_INFO':
      return getTabInfo();
    case 'REOPEN_RECENT_TABS':
      return reopenRecentTabs(Math.min(10, Math.max(1, Number(message.count) || 5)));
    default:
      return { ok: false, error: 'Unknown message' };
  }
}

async function getTabInfo() {
  await seedRecentFromOpenTabs();
  const tabs = await chrome.tabs.query({});
  const httpTabs = tabs.filter((tab) => isHttpUrl(tab.url));
  const titles = httpTabs
    .slice(0, 12)
    .map((tab) => tab.title || tab.url || 'Untitled')
    .map((title) => title.replace(/\s+/g, ' ').trim().slice(0, 60));
  const remembered = recentTabs.length;
  const lines = [
    `You have ${tabs.length} tab${tabs.length === 1 ? '' : 's'} open (${httpTabs.length} on normal websites).`,
    remembered ? `Ghostclick remembers ${remembered} recent site${remembered === 1 ? '' : 's'} you used.` : 'Browse a few sites first so Ghostclick can remember them for “open my last tabs”.',
  ];
  if (titles.length) lines.push(`Open now: ${titles.join('; ')}${httpTabs.length > titles.length ? '…' : ''}`);
  return { ok: true, message: lines.join(' '), count: tabs.length, httpCount: httpTabs.length, remembered };
}

async function closedSessionTabs(): Promise<RecentTab[]> {
  try {
    const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 20 });
    const out: RecentTab[] = [];
    for (const item of closed) {
      const tab = item.tab;
      if (tab?.url && isHttpUrl(tab.url)) {
        out.push({ url: tab.url, title: tab.title || tab.url, at: item.lastModified ?? 0 });
      }
      for (const windowTab of item.window?.tabs ?? []) {
        if (windowTab.url && isHttpUrl(windowTab.url)) {
          out.push({ url: windowTab.url, title: windowTab.title || windowTab.url, at: item.lastModified ?? 0 });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function tabUrl(tab: chrome.tabs.Tab) {
  return tab.url || tab.pendingUrl || '';
}

/** Merge remembered visits with Chrome’s recently closed list (most recent first, one per site). */
async function candidateRecentTabs() {
  const closed = await closedSessionTabs();
  const merged: RecentTab[] = [];
  const seen = new Set<string>();
  for (const item of [...recentTabs, ...closed]) {
    const key = siteKey(item.url) || tabKey(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function seedRecentFromOpenTabs() {
  if (recentTabs.length) return;
  const openTabs = await chrome.tabs.query({});
  // Oldest first so the last rememberVisit ends up most recent.
  const ordered = [...openTabs].reverse();
  for (const tab of ordered) {
    const url = tabUrl(tab);
    if (isHttpUrl(url)) recentTabs = rememberVisit(recentTabs, url, tab.title ?? '');
  }
  if (recentTabs.length) await persist();
}

/** Find an already-open tab for this site. Prefer URL patterns — tab.url is often blank in queries. */
async function findOpenTabForSite(url: string, usedIds: Set<number>) {
  const patterns = urlPatternsForSite(url);
  if (patterns.length) {
    try {
      const matched = await chrome.tabs.query({ url: patterns });
      const hit = matched.find((tab) => tab.id !== undefined && !usedIds.has(tab.id));
      if (hit) return hit;
    } catch {
      /* bad pattern — fall through */
    }
  }
  const site = siteKey(url);
  if (!site) return undefined;
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id === undefined || usedIds.has(tab.id)) continue;
    // Prefer a fresh get() — list queries often omit url in the side-panel/SW context.
    let u = tabUrl(tab);
    try {
      const fresh = await chrome.tabs.get(tab.id);
      u = tabUrl(fresh) || u;
      if (u && siteKey(u) === site) return fresh;
      if (titleMatchesSite(fresh.title || tab.title || '', site)) return fresh;
    } catch {
      if (u && siteKey(u) === site) return tab;
      if (titleMatchesSite(tab.title || '', site)) return tab;
    }
  }
  return undefined;
}

async function reloadRecentFromStorage() {
  const local = await chrome.storage.local.get(['recentTabs']);
  if (Array.isArray(local.recentTabs)) recentTabs = local.recentTabs as RecentTab[];
}

/** Only one reopen at a time — parallel Ask/voice calls were creating duplicate tabs. */
let reopenInFlight: Promise<{
  ok: boolean;
  message?: string;
  error?: string;
  opened?: number;
  created?: number;
  focused?: number;
  requested?: number;
  total?: number;
}> | null = null;

async function reopenRecentTabs(count: number) {
  if (reopenInFlight) return reopenInFlight;
  reopenInFlight = runReopenRecentTabs(count).finally(() => {
    reopenInFlight = null;
  });
  return reopenInFlight;
}

async function runReopenRecentTabs(count: number) {
  const wanted = Math.min(10, Math.max(1, Math.floor(Number(count) || 5)));
  await reloadRecentFromStorage();
  await seedRecentFromOpenTabs();
  const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const currentSite = siteKey(tabUrl(current ?? { url: '' } as chrome.tabs.Tab));

  // Exactly `wanted` sites — never more.
  const picks = (await candidateRecentTabs())
    .filter((item) => siteKey(item.url) !== currentSite)
    .slice(0, wanted);

  if (!picks.length) {
    return {
      ok: false,
      error:
        'No recent websites to reopen yet. Browse a few pages (or close some tabs), then ask again — for example “open my last 5 tabs”.',
    };
  }

  let focused = 0;
  let created = 0;
  let lastId: number | undefined;
  const usedIds = new Set<number>();
  for (const pick of picks) {
    // Always re-check right before create — never open a second YouTube/Gmail/etc.
    const existing = await findOpenTabForSite(pick.url, usedIds);
    if (existing?.id !== undefined) {
      usedIds.add(existing.id);
      lastId = existing.id;
      focused += 1;
      continue;
    }
    const tab = await chrome.tabs.create({ url: pick.url, active: false });
    if (tab.id === undefined) continue;
    // If another tab for this site already existed (race / missed match), drop the copy we just made.
    const other = await findOpenTabForSite(pick.url, new Set([tab.id]));
    if (other?.id !== undefined) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      usedIds.add(other.id);
      lastId = other.id;
      focused += 1;
      continue;
    }
    usedIds.add(tab.id);
    lastId = tab.id;
    created += 1;
  }
  if (lastId !== undefined) await chrome.tabs.update(lastId, { active: true }).catch(() => undefined);

  const total = (await chrome.tabs.query({})).length;
  const names = picks.map((item) => item.title || item.url).slice(0, wanted);
  const short =
    picks.length < wanted
      ? `You asked for ${wanted}, but only ${picks.length} recent site${picks.length === 1 ? '' : 's'} were on hand`
      : `Restored exactly ${wanted} recent site${wanted === 1 ? '' : 's'}`;
  const parts = [
    created ? `opened ${created} new` : '',
    focused ? `brought forward ${focused} already open` : '',
  ].filter(Boolean);
  const message = `${short}${parts.length ? ` (${parts.join(', ')})` : ''}: ${names.join('; ')}. You now have ${total} tabs open in total.`;
  return { ok: true, message, opened: picks.length, created, focused, requested: wanted, total };
}

async function startRecording(name: string, goal: string) {
  const tab = await activeTab();
  const problem = usableTab(tab);
  if (problem || !tab?.id || !tab.url) {
    session.statusText = problem ?? 'Open a website tab first.';
    await persist();
    return { ok: false, snapshot: snapshot(), error: session.statusText };
  }

  session = emptySession();
  session.mode = 'recording';
  session.tabId = tab.id;
  session.draft = {
    id: crypto.randomUUID(),
    name: (name || tab.title || 'Recorded task').slice(0, 80),
    goal: goal.slice(0, 300),
    createdAt: Date.now(),
    steps: [
      {
        id: crypto.randomUUID(),
        kind: 'navigate',
        url: tab.url,
        selector: '',
        fallbacks: [],
        label: 'Open the recorded page',
      },
    ],
  };
  session.statusText = 'Recording. Do the task in the page, then save.';
  await persist();
  if (!(await reachTab(tab.id))) await chrome.tabs.reload(tab.id);
  return { ok: true, snapshot: snapshot() };
}

async function capture(step: WorkflowStep, sender: chrome.runtime.MessageSender) {
  if (!settings.screenshots || !sender.tab?.windowId) return;
  try {
    const image = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 35 });
    const key = `shot:${step.id}`;
    await chrome.storage.local.set({ [key]: image });
    step.screenshot = key;
  } catch {
    // Chrome limits how often a tab can be captured. The step is still saved without an image.
  }
}

async function appendStep(step: WorkflowStep, sender: chrome.runtime.MessageSender) {
  if (session.mode !== 'recording' || !session.draft || !step?.kind) return { ok: false };
  if (sender.tab?.id && sender.tab.id !== session.tabId) return { ok: false };
  const steps = session.draft.steps;
  const previous = steps.at(-1);
  if (previous && step.kind === 'fill' && previous.kind === 'fill' && sameField(previous, step)) {
    previous.value = step.value;
    previous.label = step.label;
    previous.fallbacks = [...new Set([...previous.fallbacks, step.selector, ...step.fallbacks])].filter(
      (selector) => selector !== previous.selector,
    );
  } else {
    if (step.variableKey) {
      const used = new Set(steps.map((item) => item.variableKey).filter(Boolean));
      let key = step.variableKey;
      let count = 2;
      while (used.has(key)) {
        key = `${step.variableKey}-${count}`;
        count += 1;
      }
      step.variableKey = key;
    }
    steps.push(step);
    await capture(step, sender);
  }
  session.statusText = `${steps.length} steps recorded.`;
  await persist();
  return { ok: true };
}

function sameField(left: WorkflowStep, right: WorkflowStep) {
  if (left.selector === right.selector) return true;
  if (left.label !== right.label) return false;
  const known = new Set([left.selector, ...left.fallbacks]);
  return [right.selector, ...right.fallbacks].some((selector) => known.has(selector) && !selector.includes('nth-of-type'));
}

async function addCheck(text: string) {
  if (session.mode !== 'recording' || !session.draft || !session.tabId || !text.trim()) return { ok: false };
  const tab = await chrome.tabs.get(session.tabId);
  session.draft.steps.push({
    id: crypto.randomUUID(),
    kind: 'assert',
    url: tab.url ?? '',
    selector: '',
    fallbacks: [],
    label: 'Page check',
    expectedText: text.trim().slice(0, 200),
  });
  session.statusText = 'Check added.';
  await persist();
  return { ok: true, snapshot: snapshot() };
}

async function stopRecording() {
  const draft = session.draft;
  const actions = draft?.steps.filter((step) => step.kind !== 'navigate') ?? [];
  if (!draft || actions.length === 0) {
    session = emptySession();
    session.statusText = 'Nothing was recorded. Click through the task, then save.';
    await persist();
    return { ok: false, snapshot: snapshot() };
  }
  workflows = [draft, ...workflows].slice(0, 50);
  session = emptySession();
  session.statusText = `Saved “${draft.name}”.`;
  await persist();
  return { ok: true, snapshot: snapshot(), id: draft.id };
}

/** Save steps from an agent run as an ordinary workflow, so replay and CSV batches work on it. */
async function saveWorkflow(name: string, goal: string, steps: WorkflowStep[]) {
  const kinds = new Set(['navigate', 'fill', 'click', 'check', 'extract', 'assert']);
  const valid = steps.filter((step) => step && kinds.has(step.kind) && typeof step.url === 'string').slice(0, 200);
  if (!valid.some((step) => step.kind !== 'navigate')) {
    session.statusText = 'That task has no page actions to save.';
    await persist();
    return { ok: false, snapshot: snapshot(), error: session.statusText };
  }
  const used = new Set<string>();
  const cleaned = valid.map((step) => {
    const copy = { ...step, id: crypto.randomUUID(), fallbacks: Array.isArray(step.fallbacks) ? step.fallbacks : [] };
    if (copy.variableKey) {
      let key = copy.variableKey;
      for (let count = 2; used.has(key); count += 1) key = `${copy.variableKey}-${count}`;
      copy.variableKey = key;
      used.add(key);
    }
    return copy;
  });
  const workflow: Workflow = {
    id: crypto.randomUUID(),
    name: (name.trim() || goal.trim() || 'Agent task').slice(0, 80),
    goal: goal.trim().slice(0, 300),
    createdAt: Date.now(),
    steps: cleaned,
  };
  workflows = [workflow, ...workflows].slice(0, 50);
  session.statusText = `Saved “${workflow.name}”.`;
  await persist();
  return { ok: true, snapshot: snapshot(), id: workflow.id };
}

async function deleteStep(workflowId: string, stepId: string) {
  const workflow = workflows.find((item) => item.id === workflowId);
  if (!workflow || session.mode !== 'idle') return { ok: false, snapshot: snapshot() };
  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step || workflow.steps.length <= 1) return { ok: false, snapshot: snapshot() };
  if (step.screenshot) await chrome.storage.local.remove(step.screenshot);
  workflow.steps = workflow.steps.filter((item) => item.id !== stepId);
  await persist();
  return { ok: true, snapshot: snapshot() };
}

async function updateWorkflow(id: string, name?: string, goal?: string) {
  const workflow = workflows.find((item) => item.id === id);
  if (!workflow) return { ok: false };
  if (name !== undefined) workflow.name = name.trim().slice(0, 80) || workflow.name;
  if (goal !== undefined) workflow.goal = goal.trim().slice(0, 300);
  await persist();
  return { ok: true, snapshot: snapshot() };
}

async function deleteWorkflow(id: string) {
  const workflow = workflows.find((item) => item.id === id);
  const shots = (workflow?.steps ?? []).map((step) => step.screenshot).filter((key): key is string => Boolean(key));
  if (shots.length) await chrome.storage.local.remove(shots);
  workflows = workflows.filter((item) => item.id !== id);
  await persist();
  return { ok: true, snapshot: snapshot() };
}

function currentWorkflow() {
  return workflows.find((workflow) => workflow.id === session.replayWorkflowId) ?? null;
}

async function startReplay(workflowId: string, rows: Record<string, string>[], startFromCurrentTab: boolean) {
  const workflow = workflows.find((item) => item.id === workflowId);
  const tab = await activeTab();
  const problem = usableTab(tab);
  if (!workflow || problem || !tab?.id || rows.length === 0) {
    session.statusText = problem ?? (rows.length === 0 ? 'The file had no rows to run.' : 'That workflow is missing.');
    await persist();
    return { ok: false, snapshot: snapshot(), error: session.statusText };
  }

  session = emptySession();
  session.tabId = tab.id;
  session.replayWorkflowId = workflow.id;
  session.batch = rows.length > 1 ? { rows, index: 0 } : null;
  if (workflow.steps.some((step) => step.kind === 'extract')) results = emptyResults();
  log(
    rows.length > 1 ? `Running “${workflow.name}” for ${rows.length} rows.` : `Running “${workflow.name}”.`,
  );
  await beginRun(workflow, rows[0] ?? {}, startFromCurrentTab);
  return { ok: true, snapshot: snapshot() };
}

async function beginRun(workflow: Workflow, variables: Record<string, string>, startFromCurrentTab: boolean) {
  const opening = workflow.steps[0];
  let index = opening?.kind === 'navigate' ? 1 : 0;
  if (startFromCurrentTab) {
    while (workflow.steps[index]?.kind === 'navigate') index += 1;
  }
  session.mode = 'replaying';
  session.replayIndex = index;
  session.variables = variables;
  session.prompt = null;
  session.resolution = null;
  session.statusText = session.batch
    ? `Replaying row ${session.batch.index + 1} of ${session.batch.rows.length}.`
    : 'Replaying.';
  await persist();

  if (!session.tabId) return;
  if (!startFromCurrentTab && opening?.kind === 'navigate') {
    await chrome.tabs.update(session.tabId, { url: opening.url });
  } else {
    void chrome.tabs.sendMessage(session.tabId, { type: 'RUN' }).catch(() => undefined);
  }
}

function currentStep() {
  const workflow = currentWorkflow();
  const step = workflow?.steps[session.replayIndex] ?? null;
  return {
    ok: true,
    mode: session.mode,
    step,
    variables: session.variables,
    index: session.replayIndex,
    total: workflow?.steps.length ?? 0,
  };
}

async function stepDone(index: number, line?: { text: string; tone: LogLine['tone'] }) {
  if (session.mode !== 'replaying' || index !== session.replayIndex) return false;
  const workflow = currentWorkflow();
  const step = workflow?.steps[index];
  if (line) log(line.text, line.tone);
  else if (step) log(stepSummary(step), 'ok');
  session.replayIndex += 1;
  if (!workflow || session.replayIndex >= workflow.steps.length) {
    await finishRun();
  } else {
    await persist();
  }
  return true;
}

function advance(index: number) {
  return stepDone(index).then((ok) => ({ ok }));
}

function checkResult(index: number, text: string, passed: boolean) {
  if (session.mode === 'replaying' && index === session.replayIndex) {
    session.checks.push({ text, passed, run: (session.batch?.index ?? 0) + 1 });
  }
  return stepDone(index, {
    text: passed ? `Check passed: the page shows “${text}”.` : `Check failed: “${text}” did not appear.`,
    tone: passed ? 'ok' : 'warn',
  }).then((ok) => ({ ok }));
}

function addResults(index: number, rows: Row[], url: string) {
  if (session.mode === 'replaying' && index === session.replayIndex) {
    const run = session.batch ? String(session.batch.index + 1) : '';
    const tagged = rows.map((row) => (run ? { run, ...row } : row));
    mergeResults(tagged, url);
  }
  return stepDone(index, {
    text: rows.length ? `Scraped ${rows.length} rows.` : 'Scrape found no rows on this page.',
    tone: rows.length ? 'ok' : 'warn',
  }).then((ok) => ({ ok }));
}

function mergeResults(rows: Row[], source: string) {
  const columns = new Set(results.columns);
  for (const row of rows) Object.keys(row).forEach((key) => columns.add(key));
  results = {
    columns: [...columns],
    rows: [...results.rows, ...rows].slice(0, MAX_ROWS),
    source: source || results.source,
  };
}

async function finishRun() {
  const batch = session.batch;
  if (batch && batch.index + 1 < batch.rows.length) {
    batch.index += 1;
    session.statusText = `Starting row ${batch.index + 1} of ${batch.rows.length}.`;
    log(`Row ${batch.index} finished.`, 'ok');
    session.replayIndex = -1;
    await persist();
    void continueBatch(batch.index);
    return;
  }

  session.mode = 'idle';
  const failed = session.checks.filter((check) => !check.passed).length;
  const passed = session.checks.length - failed;
  const parts = [batch ? `Finished ${batch.rows.length} rows.` : 'Finished.'];
  if (session.checks.length) parts.push(`${passed} checks passed, ${failed} failed.`);
  if (results.rows.length && currentWorkflow()?.steps.some((step) => step.kind === 'extract')) {
    parts.push(`${results.rows.length} rows are in Data.`);
  }
  session.statusText = parts.join(' ');
  log(session.statusText, failed ? 'warn' : 'ok');
  await persist();
}

async function continueBatch(rowIndex: number) {
  if (session.tabId) await waitForTab(session.tabId);
  const workflow = currentWorkflow();
  const batch = session.batch;
  if (!workflow || !batch || batch.index !== rowIndex || session.mode !== 'replaying') return;
  await beginRun(workflow, batch.rows[rowIndex] ?? {}, false);
}

async function waitForTab(tabId: number) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  for (let tries = 0; tries < 40; tries += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function requestHuman(prompt: Snapshot['prompt']) {
  if (!prompt || session.mode !== 'replaying') return { ok: false };
  session.mode = 'paused';
  session.prompt = prompt;
  session.resolution = null;
  session.statusText = prompt.kind === 'captcha' ? 'Waiting for you to finish a human check.' : 'A step needs you.';
  log(prompt.reason, 'wait');
  await persist();
  return { ok: true };
}

async function pollDecision(token: string) {
  if (session.resolution?.token === token) {
    const decision = session.resolution;
    session.resolution = null;
    await persist();
    return { ok: true, ready: true, decision };
  }
  if (session.mode === 'idle') return { ok: true, ready: true, decision: { token, approved: false, selector: '' } };
  return { ok: true, ready: false };
}

async function resolveHuman(decision: Decision) {
  if (!session.prompt || session.prompt.token !== decision?.token) return { ok: false };
  const kind = session.prompt.kind;
  session.resolution = decision;
  session.prompt = null;
  if (decision.approved) {
    session.mode = 'replaying';
    session.statusText = 'Continuing.';
    log(kind === 'captcha' ? 'You finished the human check.' : 'You confirmed the repaired step.', 'ok');
  } else {
    session.mode = 'idle';
    session.batch = null;
    session.statusText = 'Replay stopped.';
    log('You stopped the run.', 'warn');
  }
  await persist();
  return { ok: true, snapshot: snapshot() };
}

async function stopReplay(reason: string) {
  const token = session.prompt?.token;
  session.mode = 'idle';
  session.prompt = null;
  session.batch = null;
  if (token) session.resolution = { token, approved: false, selector: '' };
  session.statusText = reason;
  log(reason, 'warn');
  await persist();
  return { ok: true, snapshot: snapshot() };
}

async function startPick() {
  const recording = session.mode === 'recording';
  if (!recording && session.mode !== 'idle') return { ok: false, snapshot: snapshot() };
  const tab = recording && session.tabId ? await chrome.tabs.get(session.tabId) : await activeTab();
  const problem = usableTab(tab);
  if (problem || !tab?.id) {
    session.statusText = problem ?? 'Open a website first.';
    await persist();
    return { ok: false, snapshot: snapshot() };
  }
  if (!(await reachTab(tab.id))) {
    session.statusText = 'Reload the page once so Ghostclick can reach it, then try again.';
    await persist();
    return { ok: false, snapshot: snapshot() };
  }
  session.pickReturnMode = recording ? 'recording' : 'idle';
  session.mode = 'picking';
  session.tabId = tab.id;
  session.statusText = 'Click one item in the list you want.';
  await persist();
  void chrome.tabs.sendMessage(tab.id, { type: 'PICK' }).catch(() => undefined);
  return { ok: true, snapshot: snapshot() };
}

async function endPick() {
  session.mode = session.pickReturnMode === 'recording' ? 'recording' : 'idle';
  session.pickReturnMode = 'idle';
  if (session.tabId) void chrome.tabs.sendMessage(session.tabId, { type: 'PICK_DONE' }).catch(() => undefined);
}

async function picked(message: { spec: ExtractSpec; rows: Row[]; label: string; url: string }) {
  if (session.mode !== 'picking') return { ok: false };
  const returning = session.pickReturnMode === 'recording';
  await endPick();
  results = emptyResults();
  mergeResults(message.rows, message.url);
  if (returning && session.draft) {
    session.draft.steps.push({
      id: crypto.randomUUID(),
      kind: 'extract',
      url: message.url,
      selector: message.spec.itemSelector,
      fallbacks: [],
      label: message.label,
      extract: message.spec,
    });
    session.statusText = `Scrape step added. Preview has ${message.rows.length} rows.`;
  } else {
    session.statusText = `Scraped ${message.rows.length} rows. Open Data to export them.`;
  }
  await persist();
  return { ok: true };
}

async function cancelPick() {
  if (session.mode !== 'picking') return { ok: false };
  await endPick();
  session.statusText = 'Scrape cancelled.';
  await persist();
  return { ok: true, snapshot: snapshot() };
}
