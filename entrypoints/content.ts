import { captchaPending, inferExtract, pageMarkdown, runExtract } from '@/lib/extract';
import { pageMatches } from '@/lib/format';
import { rankCandidates } from '@/lib/heal';
import {
  clickableTarget,
  collectCandidates,
  describeElement,
  fieldTarget,
  findBySelector,
  findStepElement,
  readValue,
  setNativeValue,
} from '@/lib/selectors';
import type { SessionMode, WorkflowStep } from '@/lib/types';

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
};

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const scope = globalThis as typeof globalThis & { __ghostclick?: boolean };
    if (scope.__ghostclick) return;
    scope.__ghostclick = true;

    const top = window === window.top;
    let mode: SessionMode = 'idle';
    let replaying = false;
    let pending: { selector: string; step: WorkflowStep; timer: number } | null = null;
    let mismatch: { index: number; since: number } | null = null;

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
      return undefined;
    });

    document.addEventListener('input', onType, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('keydown', onKey, true);
    ui.stop?.addEventListener('click', () => {
      if (mode === 'recording') void send({ type: 'STOP_RECORDING' });
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
      ui.show(state);
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
        if (event.target instanceof Element) pick(event.target);
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

    function pick(target: Element) {
      const { spec, label } = inferExtract(target);
      const rows = runExtract(spec);
      endPick();
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
            await advance(job.index);
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
            await advance(job.index);
            element.scrollIntoView({ block: 'center', inline: 'nearest' });
            flash(element);
            if (element instanceof HTMLElement) element.click();
            await sleep(700);
            continue;
          }

          const value =
            step.variableKey && step.variableKey in job.variables
              ? job.variables[step.variableKey]
              : (step.value ?? '');
          if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
            const wantOn = value !== 'off';
            if (element.checked !== wantOn) element.click();
          } else if (element instanceof HTMLElement) {
            setNativeValue(element, value ?? '');
          }
          flash(element);
          await advance(job.index);
          await sleep(160);
        }
      } finally {
        replaying = false;
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

      const decision = await askHuman({
        kind: 'repair',
        step,
        candidates: ranked.ranked,
        reason: `“${step.label}” is not where it was recorded. Pick the control that should be used.`,
      });
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
  if (!top) {
    return { stop: null as HTMLButtonElement | null, show: (_state: LightState) => undefined, outline: (_target: Element | null) => undefined };
  }
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
  const style = document.createElement('style');
  style.textContent = `
    [data-ghostclick="hud"] {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      display: none; align-items: center; gap: 10px;
      max-width: min(380px, calc(100vw - 32px)); padding: 10px 12px;
      border-radius: 999px; background: #1c1915; color: #f7f3ea;
      font: 13px/1.3 "Segoe UI", sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.25);
    }
    [data-ghostclick="dot"] { width: 8px; height: 8px; border-radius: 99px; background: #e26a3d; flex: none; }
    [data-ghostclick="stop"] {
      border: 0; border-radius: 999px; background: #f7f3ea; color: #1c1915;
      font: inherit; padding: 4px 10px; cursor: pointer;
    }
    [data-ghostclick="outline"] {
      position: fixed; z-index: 2147483645; pointer-events: none; display: none;
      border: 2px solid #c4552a; background: rgba(196,85,42,.08); border-radius: 4px;
    }
  `;
  document.documentElement.append(style, box, hud);
  const text = hud.querySelector('[data-ghostclick="text"]');

  return {
    stop,
    show(state: LightState) {
      hud.style.display = state.mode === 'idle' ? 'none' : 'flex';
      if (!text) return;
      text.textContent =
        state.mode === 'recording'
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
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function send<T>(message: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}
