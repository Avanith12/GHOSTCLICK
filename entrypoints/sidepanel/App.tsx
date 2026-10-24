import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Candidate, Snapshot } from '@/shared/types';
import type { Command } from './api';
import { agent } from '@/features/agent/chromeBrowser';
import { AgentView } from './AgentView';
import { AskView } from './AskView';
import { DataView } from './DataView';
import { modelReady, suggestRepair, visionReady } from '@/features/local-ai/localModel';
import { pageScreenshot } from '@/features/local-ai/pageScreenshot';
import { useModel, type ModelState } from '@/features/local-ai/useLocalModel';
import { SettingsCog } from './SettingsCog';
import { StepList, WorkflowsView } from './WorkflowsView';

type Panel = 'home' | 'workflows' | 'data';

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [panel, setPanel] = useState<Panel>('home');
  const [waking, setWaking] = useState(false);
  const [cogOpen, setCogOpen] = useState(false);
  const [askMode, setAskMode] = useState<'voice' | 'type'>('voice');
  const [askOpen, setAskOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoReadPdf, setAutoReadPdf] = useState(false);
  const agentState = useSyncExternalStore(
    (listener) => agent.subscribe(listener),
    () => agent.state,
  );
  const wakeTimer = useRef(0);
  const model = useModel();

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT' });
      if (!stop && response?.snapshot) setSnap(response.snapshot as Snapshot);
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 600);
    return () => {
      stop = true;
      window.clearInterval(timer);
      window.clearTimeout(wakeTimer.current);
    };
  }, []);

  const command: Command = async (message) => {
    const response = await chrome.runtime.sendMessage(message);
    if (response?.snapshot) setSnap(response.snapshot as Snapshot);
    if (response?.id) {
      setSelectedId(String(response.id));
      setPanel('workflows');
      setCogOpen(false);
    }
    return response;
  };

  useLayoutEffect(() => {
    if (!snap) return;
    const theme = snap.settings.theme === 'light' ? 'light' : 'dark';
    const root = document.documentElement;
    root.dataset.theme = theme;
    const style = root.style;
    if (theme === 'light') {
      style.setProperty('--bg', '#ffffff');
      style.setProperty('--bg-lift', '#f5f8ff');
      style.setProperty('--ink', '#1e3a8a');
      style.setProperty('--accent', '#2563eb');
      style.setProperty('--accent-bright', '#3b82f6');
      style.setProperty('--accent-dim', '#1d4ed8');
      style.setProperty('--accent-rgb', '37, 99, 235');
      style.setProperty('--accent-dim-rgb', '29, 78, 216');
      style.setProperty('--muted', '#64748b');
      style.setProperty('--line', '#c5d4f0');
      style.setProperty('--line-strong', '#2563eb');
      style.setProperty('--panel', 'rgba(255, 255, 255, 0.92)');
    } else {
      style.setProperty('--bg', '#05080f');
      style.setProperty('--bg-lift', '#0c121c');
      style.setProperty('--ink', '#ffe8f4');
      style.setProperty('--accent', '#ff2d95');
      style.setProperty('--accent-bright', '#ff7ac8');
      style.setProperty('--accent-dim', '#c2186a');
      style.setProperty('--accent-rgb', '255, 45, 149');
      style.setProperty('--accent-dim-rgb', '194, 24, 106');
      style.setProperty('--muted', '#c48aa8');
      style.setProperty('--line', '#402030');
      style.setProperty('--line-strong', '#6a3048');
      style.setProperty('--panel', 'rgba(10, 20, 30, 0.82)');
    }

    // Element-level !important overrides (no data-theme dependency) so light can never stay pink.
    let force = document.getElementById('ghostclick-theme-force') as HTMLStyleElement | null;
    if (!force) {
      force = document.createElement('style');
      force.id = 'ghostclick-theme-force';
      document.head.appendChild(force);
    }
    force.textContent =
      theme === 'light'
        ? `
.ghost-mist { display: none !important; }
.ghost-wake img,
.ghost-wake-xl img {
  box-shadow: none !important;
  filter: none !important;
  border: 2px solid #2563eb !important;
  background: #ffffff !important;
}
.ghost-ring { display: none !important; }
.ghost-hint, .ghost-title, .voice-label { color: #1d4ed8 !important; text-shadow: none !important; }
.voice-dot, .voice-wave i { background: #2563eb !important; }
.voice-dot { box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.2) !important; }
.voice-strip {
  border-color: #2563eb !important;
  color: #1d4ed8 !important;
  background: #ffffff !important;
}
.voice-strip:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.1) !important;
  border-color: #2563eb !important;
  box-shadow: none !important;
}
.cog-btn, .key-btn, button.ghost, button.choice, button.workflow, button.back, button.chip, .cog-link {
  border-color: #2563eb !important;
  color: #1d4ed8 !important;
}
button:hover:not(:disabled),
.cog-btn:hover:not(:disabled), .key-btn:hover:not(:disabled),
button.ghost:hover:not(:disabled), button.choice:hover:not(:disabled),
button.workflow:hover:not(:disabled), button.back:hover:not(:disabled),
button.chip:hover:not(:disabled), .cog-link:hover:not(:disabled),
.voice-strip:hover:not(:disabled), .tabs button:hover:not(:disabled) {
  border-color: #2563eb !important;
  background: #dbeafe !important;
  color: #1d4ed8 !important;
  box-shadow: none !important;
}
button:not(.ghost):not(.choice):not(.workflow):not(.back):not(.chip):not(.cog-link):not(.wordmark):not(.ghost-wake):not(.voice-strip):not(.key-btn) {
  background: #2563eb !important;
  color: #fff !important;
}
button:not(.ghost):not(.choice):not(.workflow):not(.back):not(.chip):not(.cog-link):not(.wordmark):not(.ghost-wake):not(.voice-strip):not(.key-btn):hover:not(:disabled) {
  background: #3b82f6 !important;
  color: #ffffff !important;
  box-shadow: none !important;
}
body, html {
  background-color: #ffffff !important;
  background-image: none !important;
  color: #1e3a8a !important;
}
`
        : '';
  }, [snap?.settings?.theme]);

  /** Workflows / Data from settings — leave settings and stay on that screen. */
  function openPanel(next: Panel) {
    window.clearTimeout(wakeTimer.current);
    setWaking(false);
    setCogOpen(false);
    setAskOpen(false);
    setPanel(next);
    if (next === 'workflows') setSelectedId(null);
  }

  /** Close settings, theme, or load model — always return home. */
  function finishSettings() {
    window.clearTimeout(wakeTimer.current);
    setWaking(false);
    setCogOpen(false);
    setPanel('home');
  }

  function openAsk(mode: 'voice' | 'type') {
    if (cogOpen) return;
    window.clearTimeout(wakeTimer.current);
    setAskMode(mode);
    setPanel('home');
    setAskOpen(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || mode === 'type') {
      setWaking(false);
      return;
    }
    setWaking(true);
    wakeTimer.current = window.setTimeout(() => setWaking(false), 550);
  }

  /** Home from anywhere. */
  function goHome() {
    window.clearTimeout(wakeTimer.current);
    setWaking(false);
    setPanel('home');
    setCogOpen(false);
    setAskOpen(false);
    setAskMode('voice');
  }

  function toggleCog() {
    if (cogOpen) {
      finishSettings();
      return;
    }
    window.clearTimeout(wakeTimer.current);
    setWaking(false);
    setCogOpen(true);
  }

  if (!snap) return <main className="loading">Loading…</main>;
  const brandIcon = chrome.runtime.getURL('icon-48.png');
  const heroIcon = chrome.runtime.getURL('icon-128.png');
  const bannerLight = chrome.runtime.getURL('banner-light.gif');
  const bannerDark = chrome.runtime.getURL('banner-dark.gif');

  if (!snap.results || !snap.settings) {
    return (
      <main>
        <h1 className="brand">
          <img className="brand-icon" src={brandIcon} alt="" width={28} height={28} />
          Ghostclick
        </h1>
        <p className="tagline">Reload to finish updating</p>
        <p>
          The panel is newer than the background script still running in Chrome. Open chrome://extensions, click the reload
          icon on the Ghostclick card, then reopen this panel.
        </p>
      </main>
    );
  }

  const idle = snap.mode === 'idle';
  const showHome = idle && !cogOpen && (panel === 'home' || waking);
  const agentBusy =
    agent.running ||
    agentState.phase === 'waiting' ||
    agentState.phase === 'paused' ||
    agentState.phase === 'planning';
  const agentSession =
    agentBusy ||
    (Boolean(agentState.goal) &&
      (agentState.phase === 'done' || agentState.phase === 'failed' || agentState.phase === 'stopped'));
  const showAskOnHome = showHome && !waking && (askOpen || agentSession);
  const showGhostHome = showHome && !showAskOnHome;
  const showWorkflows = idle && !cogOpen && panel === 'workflows';
  const showData = idle && !cogOpen && panel === 'data';

  return (
    <main className={showHome ? 'main-home agent-shell' : ''}>
      <header className={`top-bar${showHome ? ' top-bar-home' : ''}`}>
        <button type="button" className="wordmark" onClick={goHome} aria-label="Ghostclick home">
          <span className="wordmark-banners" data-theme-banner={snap.settings.theme === 'light' ? 'light' : 'dark'}>
            <img className="wordmark-banner banner-light" src={bannerLight} alt="Ghostclick" draggable={false} />
            <img className="wordmark-banner banner-dark" src={bannerDark} alt="" draggable={false} />
          </span>
        </button>
        <button
          type="button"
          className={`ghost cog-btn${cogOpen ? ' active' : ''}`}
          aria-label="Settings"
          aria-expanded={cogOpen}
          title="Settings"
          onClick={toggleCog}
        >
          <span className="cog-glyph" aria-hidden="true">
            ⚙
          </span>
        </button>
      </header>

      <SettingsCog
        open={cogOpen}
        onClose={finishSettings}
        onDone={finishSettings}
        snap={snap}
        model={model}
        command={command}
        openPanel={(next) => openPanel(next)}
      />

      {snap.statusText && !cogOpen && !showHome ? <p className="status">{snap.statusText}</p> : null}

      {!cogOpen && snap.mode === 'recording' && snap.draft ? <RecordView snap={snap} command={command} /> : null}
      {!cogOpen && snap.mode === 'picking' ? <PickView command={command} /> : null}
      {!cogOpen && (snap.mode === 'replaying' || snap.mode === 'paused') ? (
        <RunView snap={snap} model={model} command={command} />
      ) : null}

      {showGhostHome ? (
        <section className={`ghost-home agent-home${waking ? ' waking' : ''}`}>
          <div className="ghost-mist" aria-hidden="true" />
          <button
            type="button"
            className="ghost-wake ghost-wake-xl"
            aria-label="Talk to Ghostclick"
            disabled={waking}
            onClick={() => openAsk('voice')}
          >
            <span className="ghost-ring" aria-hidden="true" />
            <span className="ghost-ring delay" aria-hidden="true" />
            <span className="ghost-ring delay2" aria-hidden="true" />
            <img src={heroIcon} alt="" width={168} height={168} />
          </button>
          <p className="ghost-hint">{waking ? 'Listening…' : 'Click to ASK :)'}</p>

          <div className="home-input-row">
            <button type="button" className="voice-strip" onClick={() => openAsk('voice')} disabled={waking}>
              <span className="voice-dot" aria-hidden="true" />
              <span className="voice-wave" aria-hidden="true">
                <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
              </span>
              <span className="voice-label">{waking ? 'Waking…' : 'Voice'}</span>
            </button>
            <button
              type="button"
              className="ghost key-btn"
              aria-label="Type instead"
              title="Keyboard"
              disabled={waking}
              onClick={() => openAsk('type')}
            >
              <span className="key-glyph" aria-hidden="true">
                ⌨
              </span>
            </button>
          </div>
        </section>
      ) : null}

      {showAskOnHome ? (
        <section className="home-ask">
          {agentSession ? (
            <p className="status home-working" aria-live="polite">
              {agentState.pending
                ? 'Needs you…'
                : agentState.phase === 'paused'
                  ? 'Paused'
                  : agentBusy
                    ? 'Working…'
                    : agentState.phase === 'done'
                      ? 'Done'
                      : agentState.phase === 'failed'
                        ? 'Could not finish'
                        : 'Stopped'}
              {agentState.current ? ` · ${agentState.current}` : ''}
            </p>
          ) : null}
          <LastRun snap={snap} command={command} />
          {agentSession ? (
            <AgentView snap={snap} model={model} command={command} openData={() => openPanel('data')} />
          ) : (
            <AskView
              key={askMode}
              snap={snap}
              model={model}
              command={command}
              autoVoice={askMode === 'voice'}
              focusType={askMode === 'type'}
              openTab={(next, workflowId, readPdf) => {
                setAskOpen(false);
                setPanel(next);
                setSelectedId(workflowId ?? null);
                if (readPdf) setAutoReadPdf(true);
              }}
            />
          )}
          {!agentBusy ? (
            <button
              type="button"
              className="ghost back-home"
              onClick={() => {
                if (agentSession) agent.reset();
                goHome();
              }}
            >
              Back to home
            </button>
          ) : null}
        </section>
      ) : null}

      {showWorkflows ? (
        <WorkflowsView snap={snap} command={command} selectedId={selectedId} select={setSelectedId} />
      ) : null}

      {showData ? (
        <DataView
          snap={snap}
          model={model}
          command={command}
          autoReadPdf={autoReadPdf}
          onAutoReadDone={() => setAutoReadPdf(false)}
        />
      ) : null}
    </main>
  );
}

function RecordView({ snap, command }: { snap: Snapshot; command: Command }) {
  const [check, setCheck] = useState('');
  const draft = snap.draft!;
  return (
    <section>
      <h2>Recording “{draft.name}”</h2>
      <p>Use the page as you normally would. Each click and field becomes a step.</p>
      <div className="row">
        <button type="button" onClick={() => void command({ type: 'STOP_RECORDING' })}>
          Save workflow
        </button>
        <button type="button" className="ghost" onClick={() => void command({ type: 'DISCARD_RECORDING' })}>
          Discard
        </button>
      </div>
      <div className="box">
        <h2>Add to this workflow</h2>
        <div className="row">
          <button type="button" className="ghost" onClick={() => void command({ type: 'START_PICK' })}>
            Scrape a list here
          </button>
        </div>
        <label>
          Check that the page shows this text
          <input value={check} placeholder="Request submitted" onChange={(event) => setCheck(event.target.value)} />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={!check.trim()}
          onClick={() => {
            void command({ type: 'ADD_CHECK', text: check });
            setCheck('');
          }}
        >
          Add check
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={snap.settings.screenshots}
            onChange={(event) => void command({ type: 'SET_SETTINGS', settings: { screenshots: event.target.checked } })}
          />
          While recording, save a screenshot with each new step (helps repair later)
        </label>
      </div>
      <h2>Steps so far</h2>
      <StepList steps={draft.steps} />
    </section>
  );
}

function PickView({ command }: { command: Command }) {
  return (
    <section>
      <h2>Pick what to scrape</h2>
      <p>Hover the page and click one item in the list or one row of the table. Ghostclick finds the matching items.</p>
      <button type="button" className="ghost" onClick={() => void command({ type: 'CANCEL_PICK' })}>
        Cancel
      </button>
    </section>
  );
}

function RunView({ snap, model, command }: { snap: Snapshot; model: ModelState; command: Command }) {
  const [suggestion, setSuggestion] = useState<{ selector: string; reason: string; sawPage?: boolean } | null>(null);
  const [thinking, setThinking] = useState(false);
  const asked = useRef('');
  const prompt = snap.prompt;

  useEffect(() => {
    setSuggestion(null);
    if (prompt?.kind === 'repair' && modelReady() && asked.current !== prompt.token) {
      asked.current = prompt.token;
      void askModel();
    }
    // Ask the model once for each new repair prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.token]);

  async function askModel() {
    if (!prompt) return;
    setThinking(true);
    try {
      if (!modelReady() && !(await model.load(snap.settings.model))) return;
      const screenshot = visionReady() && snap.tabId ? await pageScreenshot(snap.tabId).catch(() => null) : null;
      const pick = await suggestRepair(prompt, screenshot ?? undefined);
      setSuggestion(pick);
      // Small redesigns: apply the model's choice automatically so replay keeps going.
      if (pick?.selector) {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        void command({
          type: 'RESOLVE_HUMAN',
          decision: { token: prompt.token, approved: true, selector: pick.selector },
        });
      }
    } finally {
      setThinking(false);
    }
  }

  const decide = (approved: boolean, selector = '') =>
    command({ type: 'RESOLVE_HUMAN', decision: { token: prompt?.token, approved, selector } });

  return (
    <section>
      <h2>{snap.batch ? `Row ${snap.batch.index + 1} of ${snap.batch.rows.length}` : 'Running'}</h2>
      {snap.replayTotal ? (
        <progress max={snap.replayTotal} value={Math.max(0, Math.min(snap.replayIndex, snap.replayTotal))} />
      ) : null}

      {prompt?.kind === 'captcha' ? (
        <div className="prompt">
          <p>{prompt.reason}</p>
          <div className="row">
            <button type="button" onClick={() => void decide(true)}>
              Continue
            </button>
            <button type="button" className="ghost" onClick={() => void decide(false)}>
              Stop
            </button>
          </div>
        </div>
      ) : null}

      {prompt?.kind === 'repair' ? (
        <div className="prompt">
          <p>{prompt.reason}</p>
          {thinking ? (
            <p className="hint">
              {visionReady() ? 'The vision model is looking at a screenshot of the page…' : 'The local model is reading the page’s controls…'}
            </p>
          ) : null}
          {suggestion ? (
            <div className="suggestion">
              <p className="tag">{suggestion.sawPage ? 'Vision model suggests, from a screenshot' : 'Local model suggests'}</p>
              <strong>{labelFor(prompt.candidates, suggestion.selector)}</strong>
              <p>{suggestion.reason}</p>
              <button type="button" className="primary" onClick={() => void decide(true, suggestion.selector)}>
                Use this control
              </button>
            </div>
          ) : null}
          <p className="hint">
            {suggestion
              ? 'Or pick a different control. Numbers match the orange tags on the page:'
              : 'Pick the control that should be used. Numbers match the orange tags on the page:'}
          </p>
          <div className="choices">
            {prompt.candidates.map((candidate, index) => {
              const recommended = suggestion?.selector === candidate.selector;
              return (
                <button
                  key={candidate.selector}
                  type="button"
                  className={`choice${recommended ? ' recommended' : ''}`}
                  onClick={() => void decide(true, candidate.selector)}
                >
                  <span>
                    {index + 1}. {candidate.label}
                    {recommended ? ' · suggested' : ''}
                  </span>
                  <small>{candidate.tag}</small>
                </button>
              );
            })}
          </div>
          <div className="row">
            {!suggestion && !thinking ? (
              <button type="button" className="ghost" onClick={() => void askModel()}>
                {modelReady() ? 'Ask the local model' : 'Load model and ask'}
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={() => void decide(false)}>
              Stop
            </button>
          </div>
        </div>
      ) : null}

      {!prompt ? (
        <button type="button" className="ghost" onClick={() => void command({ type: 'STOP_REPLAY', reason: 'You stopped the replay.' })}>
          Stop
        </button>
      ) : null}

      <ol className="log">
        {snap.log.map((line) => (
          <li key={line.id} className={line.tone}>
            {line.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function LastRun({ snap, command }: { snap: Snapshot; command: Command }) {
  if (!snap.log.length) return null;
  const failed = snap.checks.filter((check) => !check.passed);
  return (
    <details className="box">
      <summary>
        Last run · {snap.checks.length ? `${snap.checks.length - failed.length}/${snap.checks.length} checks passed` : `${snap.log.length} events`}
      </summary>
      {failed.length ? (
        <ul className="log">
          {failed.map((check, index) => (
            <li key={index} className="warn">
              Row {check.run}: “{check.text}” did not appear.
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="log">
        {snap.log.map((line) => (
          <li key={line.id} className={line.tone}>
            {line.text}
          </li>
        ))}
      </ol>
      <button type="button" className="ghost" onClick={() => void command({ type: 'CLEAR_LOG' })}>
        Clear
      </button>
    </details>
  );
}

function labelFor(candidates: Candidate[], selector: string) {
  return candidates.find((candidate) => candidate.selector === selector)?.label ?? selector;
}
