import { useEffect, useRef, useState } from 'react';
import type { Candidate, Snapshot } from '@/shared/types';
import type { Command } from './api';
import { AskView } from './AskView';
import { DataView } from './DataView';
import { modelReady, suggestRepair, visionReady } from '@/features/local-ai/localModel';
import { pageScreenshot } from '@/features/local-ai/pageScreenshot';
import { useModel, type ModelState } from '@/features/local-ai/useLocalModel';
import { SettingsCog } from './SettingsCog';
import { StepList, WorkflowsView } from './WorkflowsView';

type Panel = 'home' | 'ask' | 'workflows' | 'data';

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [panel, setPanel] = useState<Panel>('home');
  const [waking, setWaking] = useState(false);
  const [cogOpen, setCogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoReadPdf, setAutoReadPdf] = useState(false);
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

  useEffect(() => {
    const theme = snap?.settings?.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
  }, [snap?.settings?.theme]);

  /** Workflows / Data from settings — leave settings and stay on that screen. */
  function openPanel(next: Panel) {
    window.clearTimeout(wakeTimer.current);
    setWaking(false);
    setCogOpen(false);
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

  function wakeGhost() {
    if (cogOpen) return;
    window.clearTimeout(wakeTimer.current);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      setWaking(false);
      setPanel('ask');
      return;
    }

    setWaking(true);
    wakeTimer.current = window.setTimeout(() => {
      setWaking(false);
      setPanel('ask');
    }, 600);
  }

  /** Top Ghostclick mark — home from anywhere. */
  function goHome() {
    window.clearTimeout(wakeTimer.current);
    setWaking(false);
    setPanel('home');
    setCogOpen(false);
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
  const showAsk = idle && !cogOpen && panel === 'ask' && !waking;
  const showWorkflows = idle && !cogOpen && panel === 'workflows';
  const showData = idle && !cogOpen && panel === 'data';

  return (
    <main className={showHome ? 'main-home' : ''}>
      <header className="top-bar">
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

      {showHome ? (
        <section className={`ghost-home${waking ? ' waking' : ''}`}>
          <div className="ghost-mist" aria-hidden="true" />
          <button
            type="button"
            className="ghost-wake"
            aria-label="Wake Ghostclick"
            disabled={waking}
            onClick={wakeGhost}
          >
            <span className="ghost-ring" aria-hidden="true" />
            <span className="ghost-ring delay" aria-hidden="true" />
            <span className="ghost-ring delay2" aria-hidden="true" />
            <img src={heroIcon} alt="" width={96} height={96} />
          </button>
          <h1 className="ghost-title">Ghostclick</h1>
          <p className="ghost-hint">{waking ? 'Waking…' : 'Click to ASK :)'}</p>
        </section>
      ) : null}

      {showAsk ? (
        <>
          <LastRun snap={snap} command={command} />
          <AskView
            snap={snap}
            model={model}
            command={command}
            openTab={(next, workflowId, readPdf) => {
              setPanel(next);
              setSelectedId(workflowId ?? null);
              if (readPdf) setAutoReadPdf(true);
            }}
          />
        </>
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
      setSuggestion(await suggestRepair(prompt, screenshot ?? undefined));
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
              <button type="button" onClick={() => void decide(true, suggestion.selector)}>
                Use this control
              </button>
            </div>
          ) : null}
          <p className="hint">Or pick it yourself. The numbers match the orange tags on the page:</p>
          <div className="choices">
            {prompt.candidates.map((candidate, index) => (
              <button key={candidate.selector} type="button" className="choice" onClick={() => void decide(true, candidate.selector)}>
                <span>
                  {index + 1}. {candidate.label}
                </span>
                <small>{candidate.tag}</small>
              </button>
            ))}
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
