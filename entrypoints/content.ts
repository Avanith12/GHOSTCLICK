import { captchaPending } from '@/features/workflows/detectCaptcha';
import { pageMarkdown } from '@/features/data/pageToMarkdown';
import { autoExtract, autoExtractAll, inferExtract, runExtract } from '@/features/data/listScraper';
import { pageMatches } from '@/shared/textHelpers';
import { rankCandidates } from '@/features/workflows/selfRepair';
import {
  clickableTarget,
  collectCandidates,
  describeElement,
  fieldTarget,
  findBySelector,
  findStepElement,
  pressEnter,
  readValue,
  setNativeValue,
} from '@/features/workflows/elementSelectors';
import { observePage, performAction } from '@/features/agent/observePage';
import type { ActResult, AgentAction } from '@/features/agent/types';
import type { Candidate, Row, SessionMode, WorkflowStep } from '@/shared/types';

type Job = {
  mode: SessionMode;
  step: WorkflowStep | null;
  variables: Record<string, string>;
  index: number;
  total: number;
};

type LightState = {
  mode: SessionMode;
  replayIndex: number;
  replayTotal: number;
  /** What the agent is doing in this tab, if it is working here. */
  agent?: string;
  showGhostCursor?: boolean;
};

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const scope = globalThis as typeof globalThis & { __ghostclick?: () => boolean };
    if (scope.__ghostclick?.()) return;
    const runtime = chrome.runtime;
    scope.__ghostclick = () => {
      try {
        return Boolean(runtime.id);
      } catch {
        return false;
      }
    };
    if (window === window.top) {
      document
        .querySelectorAll(
          '[data-ghostclick="hud"], [data-ghostclick="outline"], [data-ghostclick="marks"], [data-ghostclick="glow"], [data-ghostclick="cursor"], [data-ghostclick="style"]',
        )
        .forEach((element) => element.remove());
    }

    const top = window === window.top;
    let mode: SessionMode = 'idle';
    let showGhostCursor = true;
    let replaying = false;
    let pending: { selector: string; step: WorkflowStep; timer: number } | null = null;
    let mismatch: { index: number; since: number } | null = null;
    let agentText = '';

    const ui = buildUi(top);

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'PING') {
        sendResponse({ ok: true });
        return undefined;
      }
      if (message?.type === 'RUN') void replayLoop();
      if (message?.type === 'PICK') mode = 'picking';
      if (message?.type === 'PICK_DONE') endPick();
      if (message?.type === 'PAGE_MARKDOWN' && top) {
        sendResponse({ ok: true, ...pageMarkdown(), url: location.href });
      }
      if (message?.type === 'AGENT_OBSERVE' && top) {
        sendResponse(observePage(String(message.goal ?? '')));
        return undefined;
      }
      if (message?.type === 'AGENT_ACT' && top) {
        const action = message.action as AgentAction;
        if (action?.action === 'EXTRACT') {
          void agentExtract().then(sendResponse);
          return true;
        }
        const { result, later } = performAction(action);
        sendResponse(result);
        // Run clicks and submits after replying, because they may unload this page.
        if (later) window.setTimeout(later, 30);
        return undefined;
      }
      if (message?.type === 'AUTO_EXTRACT' && top) {
        void loadAll(() => document.links.length).then(() => {
          const rows = message.all ? mergeLists(autoExtractAll().map((list) => list.rows)) : (autoExtract()?.rows ?? []);
          sendResponse({ ok: rows.length > 0, rows, url: location.href, title: document.title });
        });
        return true;
      }
      return undefined;
    });

    document.addEventListener('input', onType, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('keydown', onKey, true);
    ui.stop?.addEventListener('click', () => {
      if (agentText) void send({ type: 'AGENT_STOP' });
      else if (mode === 'recording') void send({ type: 'STOP_RECORDING' });
      else if (mode === 'picking') void send({ type: 'CANCEL_PICK' });
      else void send({ type: 'STOP_REPLAY', reason: 'You stopped the replay.' });
    });

    void sync();
    window.setInterval(() => void sync(), 700);

    async function sync() {
      const state = await send<LightState>({ type: 'GET_STATE' });
      if (!state) return;
      if (mode === 'picking' && state.mode !== 'picking') endPick();
      mode = state.mode;
      agentText = state.agent ?? '';
      showGhostCursor = state.showGhostCursor !== false;
      ui.show(state);
      if (mode !== 'replaying' && mode !== 'paused') ui.hideGhost();
      if (mode === 'replaying') void replayLoop();
    }

    function onType(event: Event) {
      if (mode !== 'recording' || isOwn(event.target)) return;
      const field = fieldTarget(event.target);
      if (field) scheduleFill(field);
    }

    function onChange(event: Event) {
      if (mode !== 'recording' || isOwn(event.target)) return;
      const target = event.target;
      if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
        commit(target, 'check');
        return;
      }
      const field = fieldTarget(target);
      if (field) {
        scheduleFill(field);
        flushFill();
      }
    }

    function onPointerDown(event: Event) {
      if (mode !== 'recording' || isOwn(event.target)) return;
      if (!fieldTarget(event.target)) flushFill();
    }

    function onClick(event: Event) {
      if (isOwn(event.target)) return;
      if (mode === 'picking') {
        event.preventDefault();
        event.stopPropagation();
        if (event.target instanceof Element) void pick(event.target);
        return;
      }
      if (mode !== 'recording') return;
      const target = clickableTarget(event.target);
      if (!target) return;
      if (target instanceof HTMLInputElement && target.type !== 'submit' && target.type !== 'button') return;
      flushFill();
      commit(target, 'click');
    }

    function onHover(event: Event) {
      if (mode !== 'picking' || !(event.target instanceof Element) || isOwn(event.target)) return;
      ui.outline(event.target);
    }

    function onKey(event: KeyboardEvent) {
      if (mode === 'picking' && event.key === 'Escape') void send({ type: 'CANCEL_PICK' });
    }

    async function pick(target: Element) {
      const { spec, label } = inferExtract(target);
      endPick();
      void log('Scrolling to load the whole list…');
      await loadAll(() => runExtract(spec).length);
      const rows = runExtract(spec);
      void send({
        type: 'PICKED',
        spec,
        rows,
        label: `${label} on ${document.title || location.hostname}`.slice(0, 80),
        url: location.href,
      });
    }

    function endPick() {
      if (mode === 'picking') mode = 'idle';
      ui.outline(null);
    }

    function scheduleFill(field: HTMLElement) {
      const step = makeStep(field, 'fill');
      if (!step) return;
      if (pending?.selector !== step.selector) flushFill();
      if (pending) window.clearTimeout(pending.timer);
      pending = { selector: step.selector, step, timer: window.setTimeout(flushFill, 350) };
    }

    function flushFill() {
      if (!pending) return;
      const step = pending.step;
      window.clearTimeout(pending.timer);
      pending = null;
      void send({ type: 'APPEND_STEP', step });
    }

    function commit(element: Element, kind: 'click' | 'check') {
      const step = makeStep(element, kind);
      if (step) void send({ type: 'APPEND_STEP', step });
    }

    function makeStep(element: Element, kind: WorkflowStep['kind']): WorkflowStep | null {
      const described = describeElement(element);
      if (!described.selector) return null;
      return {
        id: crypto.randomUUID(),
        kind,
        url: location.href,
        selector: described.selector,
        fallbacks: described.fallbacks,
        label: described.label,
        value: kind === 'click' ? undefined : readValue(element),
        variableKey: kind === 'click' ? undefined : described.variableKey,
        inputType: described.inputType,
      };
    }

    async function replayLoop() {
      if (replaying) return;
      replaying = true;
      try {
        while (true) {
          const job = await send<Job>({ type: 'CURRENT_STEP' });
          if (!job || job.mode !== 'replaying' || !job.step) return;
          const step = job.step;
          if (step.kind === 'navigate') {
            // The opening page is handled by the background; later navigate steps (saved from agent
            // runs) open their page here.
            if (!top) return;
            const here = pageMatches(step.url, location.href);
            await advance(job.index);
            if (!here) {
              location.assign(step.url);
              return;
            }
            continue;
          }
          if (!pageMatches(step.url, location.href)) {
            if (!top || !sameOrigin(step.url)) return;
            if (mismatch?.index !== job.index) {
              mismatch = { index: job.index, since: Date.now() };
              await log('Waiting for the page this step was recorded on.');
              return;
            }
            if (Date.now() - mismatch.since < 6000 || document.readyState !== 'complete') return;
            await log('This page has a different address than the recording, so the step runs here.');
          }

          if (step.kind === 'assert') {
            const passed = await waitForText(step.expectedText ?? '');
            await send({ type: 'CHECK_RESULT', index: job.index, text: step.expectedText, passed });
            continue;
          }

          if (step.kind === 'extract' && step.extract) {
            await waitForQuiet();
            const spec = step.extract;
            await loadAll(() => runExtract(spec).length);
            let rows = runExtract(step.extract);
            for (let tries = 0; rows.length === 0 && tries < 12; tries += 1) {
              await sleep(300);
              rows = runExtract(step.extract);
            }
            await send({ type: 'ADD_RESULTS', index: job.index, rows, url: location.href });
            continue;
          }

          const element = await resolve(step);
          if (!element) return;
          if (step.kind === 'click') {
            if (captchaPending()) {
              const cleared = await askForCaptcha(step);
              if (!cleared) return;
            }
            // Mark the step done before clicking on purpose: a click that triggers a
            // navigation tears down this content script, so the next step must already be
            // the active one when the new page's script starts. The trade-off is that a
            // click which silently does nothing still counts as done — recorded page checks
            // (assert steps) are the backstop, so prefer one after a submit.
            await advance(job.index);
            element.scrollIntoView({ block: 'center', inline: 'nearest' });
            await ui.pointAt(element, showGhostCursor);
            flash(element);
            if (element instanceof HTMLElement) element.click();
            await sleep(showGhostCursor ? 420 : 700);
            continue;
          }

          const value =
            step.variableKey && step.variableKey in job.variables
              ? job.variables[step.variableKey]
              : (step.value ?? '');
          element.scrollIntoView({ block: 'center', inline: 'nearest' });
          await ui.pointAt(element, showGhostCursor);
          if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
            const wantOn = value !== 'off';
            if (element.checked !== wantOn) element.click();
          } else if (element instanceof HTMLElement) {
            setNativeValue(element, value ?? '');
          }
          flash(element);
          await advance(job.index);
          if (step.pressEnter) pressEnter(element);
          await sleep(showGhostCursor ? 220 : 160);
        }
      } finally {
        replaying = false;
        ui.hideGhost();
      }
    }

    async function resolve(step: WorkflowStep): Promise<Element | null> {
      for (let tries = 0; tries < 16; tries += 1) {
        const existing = findStepElement(step);
        if (existing) return existing;
        await sleep(300);
      }

      if (captchaPending()) {
        const cleared = await askForCaptcha(step);
        return cleared ? resolve(step) : null;
      }

      const ranked = rankCandidates(step.label, step.selector, candidatesFor(step));
      if (ranked.auto) {
        const repaired = findBySelector(ranked.auto.selector);
        if (repaired) {
          await log(`Repaired “${step.label}” from the page structure.`, 'ok');
          return repaired;
        }
      }

      const unmark = markCandidates(ranked.ranked);
      const decision = await askHuman({
        kind: 'repair',
        step,
        candidates: ranked.ranked,
        reason: `“${step.label}” is not where it was recorded. Pick the control that should be used.`,
      }).finally(unmark);
      if (!decision?.approved || !decision.selector) {
        await send({ type: 'STOP_REPLAY', reason: 'Replay stopped before a repaired step.' });
        return null;
      }
      return findBySelector(decision.selector);
    }

    async function askForCaptcha(step: WorkflowStep) {
      const decision = await askHuman({
        kind: 'captcha',
        step,
        candidates: [],
        reason: 'This site wants to confirm a human is here. Solve the check in the page, then choose Continue.',
      });
      if (!decision?.approved) {
        await send({ type: 'STOP_REPLAY', reason: 'Replay stopped at a human check.' });
        return false;
      }
      return true;
    }

    async function askHuman(prompt: { kind: 'repair' | 'captcha'; step: WorkflowStep; candidates: ReturnType<typeof rankCandidates>['ranked']; reason: string }) {
      const token = crypto.randomUUID();
      await send({ type: 'REQUEST_HUMAN', prompt: { token, ...prompt } });
      while (true) {
        const response = await send<{ ready?: boolean; decision?: { approved: boolean; selector: string } }>({
          type: 'POLL_DECISION',
          token,
        });
        if (!response) return null;
        if (response.ready) return response.decision ?? null;
        await sleep(400);
      }
    }
  },
});

function buildUi(top: boolean) {
  const noop = {
    stop: null as HTMLButtonElement | null,
    show: (_state: LightState) => undefined,
    outline: (_target: Element | null) => undefined,
    pointAt: async (_target: Element, _enabled: boolean) => undefined,
    hideGhost: () => undefined,
  };
  if (!top) return noop;

  const hud = document.createElement('div');
  hud.dataset.ghostclick = 'hud';
  hud.innerHTML = '<span data-ghostclick="dot"></span><span data-ghostclick="text"></span>';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.dataset.ghostclick = 'stop';
  stop.textContent = 'Stop';
  hud.append(stop);

  const box = document.createElement('div');
  box.dataset.ghostclick = 'outline';

  const glow = document.createElement('div');
  glow.dataset.ghostclick = 'glow';
  glow.setAttribute('aria-hidden', 'true');

  const cursor = document.createElement('div');
  cursor.dataset.ghostclick = 'cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = `
    <span data-ghostclick="cursor-ring"></span>
    <svg data-ghostclick="cursor-ghost" viewBox="0 0 64 72" width="44" height="50" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ghostclick-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.2" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path filter="url(#ghostclick-soft)" fill="#f4fbff" stroke="#5ce1ff" stroke-width="2.2"
        d="M32 6c-11.5 0-20 9-20 22v22c0 3.2 2.2 4.4 4.4 2.6 2.4-2 5.2-2 7.6 0 2.2 1.8 4.4.6 4.4-2.6V42c0-1.4 1.2-2.4 2.6-2.2 1.2.2 2 .1 3.2-1.8L48 18.4C50.6 14.2 47.4 6 32 6z"/>
      <circle cx="24.5" cy="28" r="3.2" fill="#0b1c24"/>
      <circle cx="36.5" cy="28" r="3.2" fill="#0b1c24"/>
      <path d="M26 36c2.4 2.2 9.6 2.2 12 0" fill="none" stroke="#0b1c24" stroke-width="2" stroke-linecap="round"/>
      <path d="M46 20l12 18" stroke="#5ce1ff" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M58 38l-8-2 3 8z" fill="#5ce1ff"/>
    </svg>
  `;

  const style = document.createElement('style');
  style.dataset.ghostclick = 'style';
  style.textContent = `
    [data-ghostclick="hud"] {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      display: none; align-items: center; gap: 10px;
      max-width: min(380px, calc(100vw - 32px)); padding: 10px 12px;
      border-radius: 999px; background: #0f1a20; color: #e8f7ff;
      font: 13px/1.3 "Segoe UI", sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.35);
      border: 1px solid rgba(92,225,255,.28);
    }
    [data-ghostclick="dot"] {
      width: 8px; height: 8px; border-radius: 99px; background: #5ce1ff; flex: none;
      box-shadow: 0 0 0 0 rgba(92,225,255,.55);
      animation: ghostclick-dot 1.4s ease-out infinite;
    }
    [data-ghostclick="hud"][data-mode="recording"] [data-ghostclick="dot"] {
      background: #ff6b5a;
      box-shadow: 0 0 0 0 rgba(255,107,90,.5);
      animation-name: ghostclick-dot-rec;
    }
    [data-ghostclick="stop"] {
      border: 0; border-radius: 999px; background: #e8f7ff; color: #0f1a20;
      font: inherit; padding: 4px 10px; cursor: pointer;
    }
    [data-ghostclick="outline"] {
      position: fixed; z-index: 2147483645; pointer-events: none; display: none;
      border: 2px solid #5ce1ff; background: rgba(92,225,255,.08); border-radius: 4px;
    }
    [data-ghostclick="glow"] {
      position: fixed; inset: 0; z-index: 2147483644; pointer-events: none; display: none;
      border-radius: 0;
      box-shadow:
        inset 0 0 0 3px rgba(92,225,255,.55),
        inset 0 0 42px rgba(92,225,255,.22),
        inset 0 0 90px rgba(92,225,255,.1);
      animation: ghostclick-glow 1.8s ease-in-out infinite;
    }
    [data-ghostclick="glow"][data-mode="recording"] {
      box-shadow:
        inset 0 0 0 3px rgba(255,107,90,.62),
        inset 0 0 48px rgba(255,107,90,.24),
        inset 0 0 100px rgba(255,107,90,.1);
      animation-name: ghostclick-glow-rec;
    }
    [data-ghostclick="cursor"] {
      position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
      width: 44px; height: 50px; margin: 0; opacity: 0;
      transform: translate3d(-999px, -999px, 0) scale(1);
      transition: transform 0.55s cubic-bezier(.22,.9,.28,1), opacity 0.18s ease;
      filter: drop-shadow(0 8px 16px rgba(8,20,28,.4));
      will-change: transform, opacity;
    }
    [data-ghostclick="cursor"].visible { opacity: 1; }
    [data-ghostclick="cursor"].clicking { transform: translate3d(var(--gx), var(--gy), 0) scale(.86) !important; }
    [data-ghostclick="cursor-ghost"] { display: block; overflow: visible; }
    [data-ghostclick="cursor-ring"] {
      position: absolute; left: 34px; top: 40px; width: 10px; height: 10px; border-radius: 99px;
      border: 2px solid rgba(92,225,255,.9); opacity: 0; transform: scale(.4);
      pointer-events: none;
    }
    [data-ghostclick="cursor"].clicking [data-ghostclick="cursor-ring"] {
      animation: ghostclick-ring .42s ease-out;
    }
    @keyframes ghostclick-glow {
      0%, 100% { opacity: .72; }
      50% { opacity: 1; }
    }
    @keyframes ghostclick-glow-rec {
      0%, 100% { opacity: .7; }
      50% { opacity: 1; }
    }
    @keyframes ghostclick-dot {
      0% { box-shadow: 0 0 0 0 rgba(92,225,255,.5); }
      70% { box-shadow: 0 0 0 10px rgba(92,225,255,0); }
      100% { box-shadow: 0 0 0 0 rgba(92,225,255,0); }
    }
    @keyframes ghostclick-dot-rec {
      0% { box-shadow: 0 0 0 0 rgba(255,107,90,.5); }
      70% { box-shadow: 0 0 0 10px rgba(255,107,90,0); }
      100% { box-shadow: 0 0 0 0 rgba(255,107,90,0); }
    }
    @keyframes ghostclick-ring {
      0% { opacity: .9; transform: scale(.35); }
      100% { opacity: 0; transform: scale(2.4); }
    }
  `;
  document.documentElement.append(style, glow, box, cursor, hud);
  const text = hud.querySelector('[data-ghostclick="text"]');

  let ghostX = window.innerWidth * 0.72;
  let ghostY = window.innerHeight * 0.78;
  let moving: Promise<void> = Promise.resolve();

  function place(x: number, y: number, animate: boolean) {
    ghostX = x;
    ghostY = y;
    cursor.style.setProperty('--gx', `${x}px`);
    cursor.style.setProperty('--gy', `${y}px`);
    cursor.style.transition = animate
      ? 'transform 0.55s cubic-bezier(.22,.9,.28,1), opacity 0.18s ease'
      : 'opacity 0.18s ease';
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1)`;
  }

  place(ghostX, ghostY, false);

  return {
    stop,
    show(state: LightState) {
      const active = state.mode !== 'idle' || Boolean(state.agent);
      hud.style.display = active ? 'flex' : 'none';
      hud.dataset.mode = state.mode;
      glow.style.display = state.mode === 'recording' || state.mode === 'replaying' ? 'block' : 'none';
      glow.dataset.mode = state.mode;
      if (!text) return;
      text.textContent = state.agent
        ? `Ghostclick agent · ${state.agent}`
        : state.mode === 'recording'
          ? 'Recording this page'
          : state.mode === 'picking'
            ? 'Click an item in the list to scrape. Esc cancels.'
            : state.mode === 'paused'
              ? 'Needs a decision in the side panel'
              : state.mode === 'replaying'
                ? `Replaying step ${Math.min(state.replayIndex + 1, state.replayTotal)} of ${state.replayTotal}`
                : '';
    },
    outline(target: Element | null) {
      if (!target) {
        box.style.display = 'none';
        return;
      }
      const rect = target.getBoundingClientRect();
      Object.assign(box.style, {
        display: 'block',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    },
    async pointAt(target: Element, enabled: boolean) {
      if (!enabled) return;
      const rect = target.getBoundingClientRect();
      const x = Math.max(8, Math.min(window.innerWidth - 52, rect.left + rect.width / 2 - 8));
      const y = Math.max(8, Math.min(window.innerHeight - 58, rect.top + rect.height / 2 - 10));
      const dist = Math.hypot(x - ghostX, y - ghostY);
      const duration = Math.max(280, Math.min(780, dist * 0.85));
      cursor.classList.add('visible');
      cursor.classList.remove('clicking');
      cursor.style.transition = `transform ${duration}ms cubic-bezier(.22,.9,.28,1), opacity 0.18s ease`;
      place(x, y, true);
      moving = sleep(duration + 40);
      await moving;
      cursor.classList.add('clicking');
      await sleep(160);
      cursor.classList.remove('clicking');
      await sleep(80);
    },
    hideGhost() {
      cursor.classList.remove('visible', 'clicking');
    },
  };
}

function candidatesFor(step: WorkflowStep) {
  const wanted = step.kind === 'click' ? new Set(['button', 'a']) : new Set(['input', 'textarea', 'select']);
  const recordedTag = [step.selector, ...step.fallbacks]
    .map((selector) => selector.split('>').pop()?.trim().match(/^([a-z]+)(?=[:.[#]|$)/i)?.[1]?.toLowerCase())
    .find((tag) => tag && wanted.has(tag));
  const candidates = collectCandidates().filter((candidate) => wanted.has(candidate.tag));
  return recordedTag
    ? [...candidates.filter((item) => item.tag === recordedTag), ...candidates.filter((item) => item.tag !== recordedTag)]
    : candidates;
}

function markCandidates(candidates: Candidate[]) {
  const layer = document.createElement('div');
  layer.dataset.ghostclick = 'marks';
  candidates.forEach((candidate, index) => {
    const rect = findBySelector(candidate.selector)?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'absolute', left: `${left - 3}px`, top: `${top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px`,
      border: '3px solid #e2571e', borderRadius: '6px', pointerEvents: 'none', zIndex: '2147483646', boxSizing: 'border-box',
    });
    const tag = document.createElement('div');
    tag.textContent = String(index + 1);
    Object.assign(tag.style, {
      position: 'absolute', left: `${Math.max(0, left - 14)}px`, top: `${Math.max(0, top - 14)}px`,
      minWidth: '26px', height: '26px', borderRadius: '13px', background: '#e2571e', color: '#ffffff',
      font: 'bold 17px/26px Arial, sans-serif', textAlign: 'center', pointerEvents: 'none', zIndex: '2147483647',
      boxShadow: '0 0 0 2px #ffffff',
    });
    layer.append(ring, tag);
  });
  document.documentElement.append(layer);
  return () => layer.remove();
}

/** The agent's EXTRACT: load a lazily loaded list, then copy the page's main list or table. */
async function agentExtract(): Promise<ActResult> {
  await loadAll(() => document.links.length, 6000);
  const found = autoExtract();
  if (!found?.rows.length) return { ok: false, message: 'No repeated list or table was found on this page.' };
  return {
    ok: true,
    message: `Extracted ${found.rows.length} rows.`,
    rows: found.rows.slice(0, 500),
    step: {
      id: crypto.randomUUID(),
      kind: 'extract',
      url: location.href,
      selector: found.spec.itemSelector,
      fallbacks: [],
      label: `list on ${document.title || location.hostname}`.slice(0, 80),
      extract: found.spec,
    },
  };
}

function mergeLists(lists: Row[][]) {
  const seen = new Set<string>();
  const merged: Row[] = [];
  for (const row of lists.flat()) {
    const links = Object.values(row).filter((value) => /^https?:\/\//.test(value)).map((value) => value.split('?')[0]);
    const key = links.length ? links.join(' ') : JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

function sameOrigin(url: string) {
  try {
    return new URL(url).origin === location.origin;
  } catch {
    return false;
  }
}

async function waitForText(expected: string) {
  const needle = expected.trim().toLowerCase();
  if (!needle) return true;
  for (let tries = 0; tries < 14; tries += 1) {
    if ((document.body?.innerText ?? '').toLowerCase().includes(needle)) return true;
    await sleep(300);
  }
  return false;
}

async function loadAll(count: () => number, limit = 20_000) {
  const root = document.scrollingElement ?? document.documentElement;
  const start = window.scrollY;
  const began = Date.now();
  let lastCount = count();
  let lastHeight = root.scrollHeight;
  let idle = 0;
  while (idle < 8 && Date.now() - began < limit) {
    window.scrollBy(0, window.innerHeight * 0.9);
    await sleep(400);
    const atBottom = window.innerHeight + window.scrollY >= root.scrollHeight - 4;
    if (atBottom) await waitForQuiet(700, 3000);
    const nextCount = count();
    const height = root.scrollHeight;
    idle = nextCount > lastCount || height > lastHeight ? 0 : idle + (atBottom ? 4 : 1);
    lastCount = Math.max(lastCount, nextCount);
    lastHeight = Math.max(lastHeight, height);
  }
  window.scrollTo(0, start);
}

function waitForQuiet(quiet = 1200, limit = 8000) {
  return new Promise<void>((resolve) => {
    let timer = window.setTimeout(finish, quiet);
    const cap = window.setTimeout(finish, limit);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, quiet);
    };
    const observer = new MutationObserver((records) => {
      if (records.every((record) => record.target instanceof Element && record.target.closest('[data-ghostclick]'))) return;
      restart();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    let network: PerformanceObserver | null = null;
    try {
      network = new PerformanceObserver(restart);
      network.observe({ type: 'resource' });
    } catch {
      network = null;
    }
    function finish() {
      observer.disconnect();
      network?.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(cap);
      resolve();
    }
  });
}

function advance(index: number) {
  return send({ type: 'ADVANCE', index });
}

function log(text: string, tone: 'info' | 'ok' | 'warn' = 'info') {
  return send({ type: 'LOG', text, tone });
}

function isOwn(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-ghostclick]'));
}

function flash(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  const previous = element.style.outline;
  element.style.outline = '3px solid #c4552a';
  window.setTimeout(() => {
    element.style.outline = previous;
  }, 700);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function send<T>(message: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}
