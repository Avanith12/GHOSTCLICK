import { useEffect, useRef, useState } from 'react';
import type { Candidate, Snapshot } from '@/shared/types';
import type { Command } from './api';
import { AskView } from './AskView';
import { DataView } from './DataView';
import { MODELS, modelReady, suggestRepair } from '@/features/model/model';
import { useModel, type ModelState } from '@/features/model/useModel';
import { StepList, WorkflowsView } from './WorkflowsView';

type Tab = 'ask' | 'workflows' | 'data';

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>('ask');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoReadPdf, setAutoReadPdf] = useState(false);
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
    };
  }, []);

  const command: Command = async (message) => {
    const response = await chrome.runtime.sendMessage(message);
    if (response?.snapshot) setSnap(response.snapshot as Snapshot);
    if (response?.id) {
      setSelectedId(String(response.id));
      setTab('workflows');
    }
    return response;
  };

  if (!snap) return <main className="loading">Loading…</main>;
  if (!snap.results || !snap.settings) {
    return (
      <main>
        <p className="mark">Ghostclick</p>
        <h1>Reload Ghostclick to finish updating</h1>
        <p>
          The panel is newer than the background script still running in Chrome. Open chrome://extensions, click the reload
          icon on the Ghostclick card, then reopen this panel.
        </p>
      </main>
    );
  }

  return (
    <main>
      <header>
        <p className="mark">Ghostclick</p>
        <h1>Show it once. Ask it again.</h1>
        {snap.statusText ? <p className="status">{snap.statusText}</p> : null}
      </header>

      {snap.mode === 'recording' && snap.draft ? <RecordView snap={snap} command={command} /> : null}
      {snap.mode === 'picking' ? <PickView command={command} /> : null}
      {snap.mode === 'replaying' || snap.mode === 'paused' ? <RunView snap={snap} model={model} command={command} /> : null}

      {snap.mode === 'idle' ? (
        <>
          <nav className="tabs">
            {(['ask', 'workflows', 'data'] as Tab[]).map((name) => (
              <button
                key={name}
                type="button"
                className={tab === name ? 'active' : ''}
                onClick={() => {
                  setTab(name);
                  if (name === 'workflows') setSelectedId(null);
                }}
              >
                {name === 'ask' ? 'Ask' : name === 'workflows' ? `Workflows (${snap.workflows.length})` : `Data (${snap.results.rows.length})`}
              </button>
            ))}
          </nav>
          <LastRun snap={snap} command={command} />
          {tab === 'ask' ? (
            <AskView
              snap={snap}
              model={model}
              command={command}
              openTab={(next, workflowId, readPdf) => {
                setTab(next);
                setSelectedId(workflowId ?? null);
                if (readPdf) setAutoReadPdf(true);
              }}
            />
          ) : null}
          {tab === 'workflows' ? (
            <WorkflowsView snap={snap} command={command} selectedId={selectedId} select={setSelectedId} />
          ) : null}
          {tab === 'data' ? (
            <DataView
              snap={snap}
              model={model}
              command={command}
              autoReadPdf={autoReadPdf}
              onAutoReadDone={() => setAutoReadPdf(false)}
            />
          ) : null}
        </>
      ) : null}

      <ModelBar snap={snap} model={model} command={command} />
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
          Save a screenshot with each new step
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
  const [suggestion, setSuggestion] = useState<{ selector: string; reason: string } | null>(null);
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
      setSuggestion(await suggestRepair(prompt));
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
          {thinking ? <p className="hint">The local model is reading the page’s controls…</p> : null}
          {suggestion ? (
            <div className="suggestion">
              <p className="tag">Local model suggests</p>
              <strong>{labelFor(prompt.candidates, suggestion.selector)}</strong>
              <p>{suggestion.reason}</p>
              <button type="button" onClick={() => void decide(true, suggestion.selector)}>
                Use this control
              </button>
            </div>
          ) : null}
          <p className="hint">Or pick it yourself:</p>
          <div className="choices">
            {prompt.candidates.map((candidate) => (
              <button key={candidate.selector} type="button" className="choice" onClick={() => void decide(true, candidate.selector)}>
                <span>{candidate.label}</span>
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

function ModelBar({ snap, model, command }: { snap: Snapshot; model: ModelState; command: Command }) {
  return (
    <footer>
      <h2>Local model</h2>
      <select
        value={snap.settings.model}
        disabled={model.phase === 'loading'}
        onChange={(event) => void command({ type: 'SET_SETTINGS', settings: { model: event.target.value } })}
      >
        {MODELS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p>{model.text}</p>
      <button
        type="button"
        className="ghost"
        disabled={model.phase === 'loading'}
        onClick={() => void model.load(snap.settings.model)}
      >
        {model.phase === 'loading' ? 'Loading…' : model.phase === 'ready' ? 'Load selected model' : 'Load model'}
      </button>
    </footer>
  );
}

function labelFor(candidates: Candidate[], selector: string) {
  return candidates.find((candidate) => candidate.selector === selector)?.label ?? selector;
}
