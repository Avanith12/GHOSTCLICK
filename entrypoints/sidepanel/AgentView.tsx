import { useEffect, useState, useSyncExternalStore } from 'react';
import { siteList } from '@/features/agent/actions';
import type { AgentState, SavedRun } from '@/features/agent/agentLoop';
import { agent, forgetInterruptedRun, interruptedRun } from '@/features/agent/chromeBrowser';
import { isVisionModel, MODELS } from '@/features/local-ai/localModel';
import type { ModelState } from '@/features/local-ai/useLocalModel';
import { stepSummary } from '@/shared/textHelpers';
import type { Snapshot } from '@/shared/types';
import type { Command } from './api';

const PHASES: Record<AgentState['phase'], string> = {
  idle: 'Ready',
  planning: 'Planning',
  running: 'Working',
  paused: 'Paused',
  waiting: 'Needs you',
  done: 'Done',
  failed: 'Could not finish',
  stopped: 'Stopped',
};

const TEXT_MODELS = MODELS.filter((option) => !isVisionModel(option.id));

export function AgentView({
  snap,
  model,
  command,
  openData,
}: {
  snap: Snapshot;
  model: ModelState;
  command: Command;
  openData: () => void;
}) {
  const state = useSyncExternalStore(
    (listener) => agent.subscribe(listener),
    () => agent.state,
  );
  const [goal, setGoal] = useState(state.goal);
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('');
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const running = agent.running;
  const finished = ['done', 'failed', 'stopped'].includes(state.phase);
  const savable = finished && state.steps.some((step) => step.kind !== 'navigate');

  const [interrupted, setInterrupted] = useState<SavedRun | null>(null);
  useEffect(() => {
    if (!agent.running) void interruptedRun().then(setInterrupted).catch(() => undefined);
  }, []);

  async function continueInterrupted() {
    const saved = interrupted;
    if (!saved) return;
    setProblem('');
    try {
      if (!(await model.loadForText(snap.settings.model))) {
        setProblem('The local model did not load. See the note under the model picker.');
        return;
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The local model did not load.');
      return;
    }
    setInterrupted(null);
    setGoal(saved.goal);
    void agent.continueSaved(saved);
  }

  useEffect(() => {
    if (finished && !name) setName(state.goal.slice(0, 60));
    // Suggest a name once per finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  async function start() {
    const text = goal.trim();
    if (!text || running) return;
    setProblem('');
    setSkipped(new Set());
    setName('');
    try {
      if (!(await model.loadForText(snap.settings.model))) {
        setProblem('The local model did not load. See the note under the model picker.');
        return;
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The local model did not load.');
      return;
    }
    void agent.run(text, {
      maxSteps: snap.settings.agentMaxSteps,
      allowed: siteList(snap.settings.agentAllowed),
      blocked: siteList(snap.settings.agentBlocked),
      readAnySite: snap.settings.agentReadAny,
    });
  }

  async function save() {
    const steps = state.steps.filter((step) => !skipped.has(step.id));
    const response = await command({ type: 'SAVE_WORKFLOW', name, goal: state.goal, steps });
    if (!response?.ok) setProblem(response?.error ?? 'Could not save the workflow.');
  }

  const setting = (patch: Partial<Snapshot['settings']>) => void command({ type: 'SET_SETTINGS', settings: patch });

  return (
    <section className="agent">
      <h2>{running || state.phase === 'planning' || state.phase === 'waiting' || state.phase === 'paused' ? 'Working' : 'Ask'}</h2>
      <p className="hint">
        Ghostclick looks at the page, picks one action at a time, and keeps going until the task is done. It asks before anything
        consequential.
      </p>
      {interrupted && !running ? (
        <div className="prompt">
          <p className="tag">Interrupted task</p>
          <p>
            The side panel closed while Ghostclick was working on “{interrupted.goal}” (step {interrupted.step} of {interrupted.maxSteps}). It can
            continue from the current page with its notes and steps so far.
          </p>
          <div className="row">
            <button type="button" disabled={model.phase === 'loading'} onClick={() => void continueInterrupted()}>
              Resume task
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setInterrupted(null);
                void forgetInterruptedRun();
              }}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <label>
        Task
        <textarea
          value={goal}
          rows={3}
          disabled={running}
          placeholder="Find the three cheapest mystery books on this site and put them in a table"
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void start();
            }
          }}
        />
      </label>

      <div className="agent-model">
        <select
          aria-label="Model"
          value={snap.settings.model}
          disabled={running || model.phase === 'loading'}
          onChange={(event) => setting({ model: event.target.value })}
        >
          {TEXT_MODELS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="hint">{model.text}</p>
      </div>

      <div className="row">
        {!running ? (
          <button type="button" disabled={!goal.trim() || model.phase === 'loading'} onClick={() => void start()}>
            {model.phase === 'loading' ? 'Loading model…' : 'Start'}
          </button>
        ) : (
          <>
            {state.phase === 'paused' ? (
              <button type="button" onClick={() => agent.resume()}>
                Resume
              </button>
            ) : (
              <button type="button" className="ghost" disabled={state.phase === 'waiting'} onClick={() => agent.pause()}>
                Pause
              </button>
            )}
            <button type="button" className="ghost danger" onClick={() => agent.stop()}>
              Stop
            </button>
          </>
        )}
        {finished ? (
          <button type="button" className="ghost" onClick={() => agent.reset()}>
            Clear
          </button>
        ) : null}
      </div>
      {problem ? <p className="error">{problem}</p> : null}

      {state.phase !== 'idle' ? (
        <div className="box agent-status">
          <p className="tag">
            {PHASES[state.phase]}
            {state.step ? ` · step ${state.step} of ${state.maxSteps}` : ''}
          </p>
          {running ? <progress max={state.maxSteps} value={state.step} /> : null}
          {state.current ? <p className="status">{state.current}</p> : null}
          {state.say && running ? <p className="hint">Why: {state.say}</p> : null}
          {state.page && running ? <p className="hint">On: {state.page}</p> : null}

          {state.pending ? <PendingCard pending={state.pending} /> : null}

          {state.plan.length ? (
            <details>
              <summary>Plan</summary>
              <ol className="agent-plan">
                {state.plan.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
              {state.doneWhen ? <p className="hint">Done when: {state.doneWhen}</p> : null}
            </details>
          ) : null}

          {state.result || state.error ? (
            <>
              {state.error ? <p className="error">{state.error}</p> : null}
              {state.result ? <div className="answer">{state.result}</div> : null}
            </>
          ) : null}
          {state.rows ? (
            <button type="button" className="ghost" onClick={openData}>
              {state.rows} rows in Data
            </button>
          ) : null}
          {state.screenshots.map((shot, index) => (
            <img key={index} className="thumb" src={shot} alt={`Screenshot ${index + 1} taken during the task`} />
          ))}

          {state.log.length ? (
            <details open={running}>
              <summary>Steps taken ({state.log.length})</summary>
              <ol className="log">
                {state.log.map((entry, index) => (
                  <li key={index} className={entry.ok ? 'ok' : 'warn'} title={entry.say}>
                    {entry.step}. {entry.action} → {entry.result}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : null}

      {savable ? (
        <div className="box">
          <h2>Save as workflow</h2>
          <p className="hint">
            The page actions below replay without the model, and typed values become fields you can change or fill from a CSV. Untick any
            step you do not want.
          </p>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <ol className="steps">
            {state.steps.map((step) => (
              <li key={step.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!skipped.has(step.id)}
                    onChange={(event) => {
                      const next = new Set(skipped);
                      if (event.target.checked) next.delete(step.id);
                      else next.add(step.id);
                      setSkipped(next);
                    }}
                  />
                  {stepSummary(step)}
                  {step.kind === 'fill' && step.value ? ` = “${step.value}”` : ''}
                </label>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => void save()}>
            Save workflow
          </button>
        </div>
      ) : null}

      <details className="box">
        <summary>Agent options</summary>
        <label>
          Most steps per task
          <input
            type="number"
            min={3}
            max={60}
            defaultValue={snap.settings.agentMaxSteps}
            onBlur={(event) => setting({ agentMaxSteps: Math.min(60, Math.max(3, Number(event.target.value) || 25)) })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={snap.settings.agentReadAny} onChange={(event) => setting({ agentReadAny: event.target.checked })} />
          Read any site the agent opens without asking me first
        </label>
        <label>
          Sites the agent may always read (one per line)
          <textarea
            rows={2}
            defaultValue={snap.settings.agentAllowed}
            placeholder="books.toscrape.com"
            onBlur={(event) => setting({ agentAllowed: event.target.value })}
          />
        </label>
        <label>
          Sites the agent must never open or use
          <textarea
            rows={2}
            defaultValue={snap.settings.agentBlocked}
            placeholder="mybank.com"
            onBlur={(event) => setting({ agentBlocked: event.target.value })}
          />
        </label>
        <p className="hint">
          The site you start on is always readable. Other sites need your OK once per task. Small local models make mistakes on long tasks:
          Phi-3.5 Mini and Llama 3.2 3B follow multi-step tasks best, Qwen2.5 1.5B is fastest but loses track more often.
        </p>
      </details>
    </section>
  );
}

function PendingCard({ pending }: { pending: NonNullable<AgentState['pending']> }) {
  return (
    <div className="prompt">
      <p className="tag">{pending.kind === 'approve' ? 'Approve this action?' : pending.kind === 'site' ? 'Allow this site?' : 'Your turn'}</p>
      <p>{pending.message}</p>
      <div className="row">
        {pending.kind === 'approve' ? (
          <>
            <button type="button" onClick={() => agent.respond('yes')}>
              Approve
            </button>
            <button type="button" className="ghost" onClick={() => agent.respond('no')}>
              Skip it
            </button>
          </>
        ) : pending.kind === 'site' ? (
          <>
            <button type="button" onClick={() => agent.respond('yes')}>
              Allow for this task
            </button>
            <button type="button" className="ghost" onClick={() => agent.respond('always')}>
              Always allow
            </button>
            <button type="button" className="ghost" onClick={() => agent.respond('no')}>
              Don’t allow
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => agent.respond('yes')}>
              Continue
            </button>
            <button type="button" className="ghost" onClick={() => agent.respond('no')}>
              I can’t
            </button>
          </>
        )}
        <button type="button" className="ghost danger" onClick={() => agent.stop()}>
          Stop task
        </button>
      </div>
    </div>
  );
}
