import { useEffect, useRef, useState } from 'react';
import { siteList } from '@/features/agent/actions';
import { agent } from '@/features/agent/chromeBrowser';
import { bestKeywordMatches, rowTitle } from '@/features/ask/keywordSearch';
import { choosePlan, rulesPlan, validatePlan, workflowFields, type Plan } from '@/features/ask/requestPlanner';
import { dataContext } from '@/features/data/sortRowsForQuestion';
import { parseTabCount } from '@/features/tabs/recentTabs';
import type { Row, Snapshot } from '@/shared/types';
import { downloadText, fileName, findList, pageMarkdown, type Command } from './api';
import { answer, filterRows, planTask, textModelReady, visionReady } from '@/features/local-ai/localModel';
import type { ModelState } from '@/features/local-ai/useLocalModel';

type Found = { total: number; kept: Row[]; filter: string; byModel: boolean };

export function AskView({
  snap,
  model,
  command,
  openTab,
  autoVoice = false,
  focusType = false,
}: {
  snap: Snapshot;
  model: ModelState;
  command: Command;
  openTab: (tab: 'data' | 'workflows', workflowId?: string, readPdf?: boolean) => void;
  autoVoice?: boolean;
  focusType?: boolean;
}) {
  const [request, setRequest] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [replyFrom, setReplyFrom] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [progress, setProgress] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const voiceWindowId = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const startedVoice = useRef(false);

  useEffect(() => {
    if (focusType) textareaRef.current?.focus();
  }, [focusType]);

  useEffect(() => {
    if (!autoVoice || startedVoice.current) return;
    startedVoice.current = true;
    void beginListen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVoice]);

  useEffect(() => {
    const onMessage = (message: { type?: string; text?: string; final?: boolean }) => {
      if (message.type !== 'VOICE_TRANSCRIPT' || typeof message.text !== 'string') return;
      const text = message.text.trim();
      setRequest(message.text);
      setListening(true);
      setVoiceNote('Listening in the Voice window…');
      if (message.final) {
        setListening(false);
        setVoiceNote('');
        voiceWindowId.current = null;
        // Speak → auto Go (no need to press Go / Run for voice).
        if (text) void makePlan(text, { fromVoice: true });
      }
    };
    const onRemoved = (id: number) => {
      if (voiceWindowId.current === id) {
        voiceWindowId.current = null;
        setListening(false);
        setVoiceNote('');
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.windows.onRemoved.addListener(onRemoved);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.windows.onRemoved.removeListener(onRemoved);
    };
    // makePlan is stable enough for this listener; recreate if snap/model identity matters mid-listen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, model]);

  async function beginListen() {
    setVoiceNote('');
    try {
      if (voiceWindowId.current != null) {
        try {
          await chrome.windows.update(voiceWindowId.current, { focused: true });
          setListening(true);
          setVoiceNote('Listening in the Voice window…');
          return;
        } catch {
          voiceWindowId.current = null;
        }
      }
      const win = await chrome.windows.create({
        url: chrome.runtime.getURL('voice.html'),
        type: 'popup',
        width: 380,
        height: 240,
        focused: true,
      });
      if (!win?.id) {
        setListening(false);
        setVoiceNote('Could not open Voice. Type instead, or try again.');
        return;
      }
      voiceWindowId.current = win.id;
      setListening(true);
      setVoiceNote('Speak in the small Voice window. Allow the mic if Chrome asks.');
    } catch {
      setListening(false);
      setVoiceNote('Could not open Voice. Type instead, or try again.');
    }
  }

  async function stopListening() {
    const id = voiceWindowId.current;
    voiceWindowId.current = null;
    setListening(false);
    setVoiceNote('');
    if (id != null) {
      try {
        await chrome.windows.remove(id);
      } catch {
        /* already closed */
      }
    }
  }

  async function makePlan(text = request, options: { fromVoice?: boolean } = {}) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setReply('');
    setReplyFrom('');
    setError('');
    setFound(null);
    let answerNow: Plan | null = null;
    let runValues: Record<string, string> | undefined;
    try {
      let next: Plan | null = null;
      if (textModelReady()) {
        const raw = await planTask(
          text,
          snap.workflows.map((workflow) => ({
            id: workflow.id,
            name: workflow.name,
            goal: workflow.goal,
            fields: workflowFields(workflow),
          })),
          snap.results.rows.length > 0,
        );
        next = validatePlan(raw, snap.workflows, text);
      }
      next = choosePlan(next, rulesPlan(text, snap.workflows, snap.results.rows.length > 0), text);
      if (next.action === 'record') {
        // Recording belongs in Workflows, not Ask.
        setPlan(null);
        openTab('workflows');
      } else if (next.action === 'run') {
        const workflow = snap.workflows.find((item) => item.id === next?.workflowId);
        const defaults: Record<string, string> = {};
        if (workflow) {
          for (const field of workflowFields(workflow)) defaults[field.key] = field.example;
        }
        runValues = { ...defaults, ...(next.variables ?? {}) };
        setValues(runValues);
        if (options.fromVoice) {
          // Voice: start immediately — no extra Run click.
          setPlan(null);
          answerNow = next;
        } else {
          setPlan(next);
        }
      } else {
        setPlan(null);
        answerNow = next;
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Ghostclick could not understand that request.');
    } finally {
      setBusy(false);
    }
    if (answerNow) await carryOut(answerNow, text, runValues);
  }

  async function needModel() {
    const ok = await model.loadForText(snap.settings.model);
    if (!ok) {
      setError('The local model did not load. Pick a model in ⚙ settings, or try again once WebGPU is available.');
    }
    return ok;
  }

  async function carryOut(current = plan, asked = request, variableOverride?: Record<string, string>) {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      if (current.action === 'run' && current.workflowId) {
        const response = await command({
          type: 'START_REPLAY',
          workflowId: current.workflowId,
          variables: variableOverride ?? values,
        });
        if (response?.ok) setPlan(null);
      } else if (current.action === 'find') {
        const filter = current.question?.trim() ?? '';
        const list = await findList(Boolean(filter));
        let kept = list.rows;
        let byModel = false;
        if (filter) {
          if (textModelReady()) {
            setProgress('Reading items…');
            const keep = await filterRows(filter, list.rows, (done, total) => setProgress(`Reading items ${done} of ${total}…`));
            kept = keep.map((index) => list.rows[index]!).filter(Boolean);
            byModel = true;
          } else {
            kept = bestKeywordMatches(filter, list.rows).map((index) => list.rows[index]!);
          }
        }
        await command({ type: 'SET_RESULTS', rows: kept, source: list.url });
        setFound({ total: list.rows.length, kept, filter, byModel });
        setPlan(null);
      } else if (current.action === 'scrape') {
        const response = await command({ type: 'START_PICK' });
        if (response?.ok) {
          setPlan(null);
          openTab('data');
        }
      } else if (current.action === 'read_pdf') {
        setPlan(null);
        openTab('data', undefined, true);
      } else if (current.action === 'save_page') {
        const page = await pageMarkdown();
        await downloadText(fileName(page.title, 'md'), page.markdown, 'text/markdown');
        setReply(`Saved “${page.title}” as a Markdown document in Downloads.`);
      } else if (current.action === 'ask_page') {
        const page = await pageMarkdown();
        if (!(await needModel())) return;
        setProgress(`Reading “${page.title || page.url}”…`);
        setReply(await answer(current.question || asked, page.markdown));
        setReplyFrom(`From the page “${page.title || page.url}”`);
      } else if (current.action === 'ask_data') {
        if (!snap.results.rows.length) {
          setError('Nothing has been scraped yet. Scrape a list first, then ask about it.');
          return;
        }
        if (!(await needModel())) return;
        const question = current.question || asked;
        setProgress('Reading the scraped data…');
        setReply(await answer(question, dataContext(question, snap.results.columns, snap.results.rows)));
        setReplyFrom(`From the ${snap.results.rows.length} scraped rows`);
      } else if (current.action === 'record') {
        setPlan(null);
        openTab('workflows');
      } else if (current.action === 'reopen_tabs') {
        // Re-parse the spoken/typed request so “three” / “3” always win over a stale plan count.
        const count = parseTabCount(asked, current.count ?? 5);
        const response = await command({ type: 'REOPEN_RECENT_TABS', count });
        if (!response?.ok) throw new Error(response?.error || 'Could not reopen recent tabs.');
        setReply(response.message || current.reply);
        setReplyFrom('From your recent tabs');
        setPlan(null);
      } else if (current.action === 'tab_info') {
        const response = await command({ type: 'GET_TAB_INFO' });
        if (!response?.ok) throw new Error(response?.error || 'Could not read open tabs.');
        setReply(response.message || current.reply);
        setReplyFrom('From your open tabs');
        setPlan(null);
      } else if (current.action === 'agent') {
        if (!(await needModel())) return;
        setPlan(null);
        void agent.run(asked, {
          maxSteps: snap.settings.agentMaxSteps,
          allowed: siteList(snap.settings.agentAllowed),
          blocked: siteList(snap.settings.agentBlocked),
          readAnySite: snap.settings.agentReadAny,
        });
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That did not work.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function pickInstead() {
    setFound(null);
    const response = await command({ type: 'START_PICK' });
    if (response?.ok) openTab('data');
  }

  const workflow = snap.workflows.find((item) => item.id === plan?.workflowId);
  const fields = workflow ? workflowFields(workflow) : [];

  return (
    <section className="ask-panel">
      <label>
        Ask
        <textarea
          ref={textareaRef}
          value={request}
          rows={3}
          placeholder={listening ? 'Listening…' : 'Speak (auto-runs) or type, then Go'}
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (listening) void stopListening();
              if (!busy) void makePlan();
            }
          }}
        />
      </label>
      <div className="row">
        <button
          type="button"
          className={`ghost mic-btn${listening ? ' mic-live' : ''}`}
          aria-pressed={listening}
          onClick={() => (listening ? void stopListening() : void beginListen())}
        >
          {listening ? 'Stop' : 'Voice'}
        </button>
        <button
          type="button"
          disabled={busy || !request.trim()}
          onClick={() => {
            if (listening) void stopListening();
            void makePlan();
          }}
        >
          {busy && !plan ? 'Working…' : 'Go'}
        </button>
      </div>
      {listening ? <p className="status listen-status">Listening…</p> : null}
      {voiceNote ? <p className="hint">{voiceNote}</p> : null}
      {visionReady() ? (
        <p className="hint">Phi-3.5 Vision is ready for replay repairs. Load a text model in settings for questions.</p>
      ) : !textModelReady() ? (
        <p className="hint">Simple requests work now. Summaries use the default model in settings.</p>
      ) : null}

      {plan ? (
        <div className="plan">
          <p className="tag">{plan.source === 'model' ? 'Understood by the local model' : 'Understood without AI'}</p>
          <h2>{title(plan, workflow?.name)}</h2>
          {plan.reply ? <p>{plan.reply}</p> : null}

          {plan.action === 'run' && workflow ? (
            <div className="fields">
              {fields.map((field) => {
                const changed = (values[field.key] ?? '') !== field.example;
                return (
                  <label key={field.key} className={changed ? 'changed' : ''}>
                    {field.label}
                    <input
                      value={values[field.key] ?? ''}
                      onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                    />
                  </label>
                );
              })}
              <p className="hint">Highlighted fields differ from the recording. Check them before you run.</p>
            </div>
          ) : null}

          <div className="row">
            <button type="button" disabled={busy} onClick={() => void carryOut()}>
              {busy ? 'Working…' : 'Run'}
            </button>
            {workflow ? (
              <button type="button" className="ghost" onClick={() => openTab('workflows', workflow.id)}>
                Open workflow
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {progress ? <p className="status">{progress}</p> : null}
      {found ? (
        <div className="plan">
          <h2>
            {found.filter
              ? `${found.kept.length} of ${found.total} items match “${found.filter}”`
              : `Collected ${found.total} items`}
          </h2>
          {found.filter && !found.byModel ? (
            <p className="hint">Matched by keywords. Load a model below to match by meaning.</p>
          ) : null}
          {found.byModel && !/Phi/.test(snap.settings.model) ? (
            <p className="hint">Small models miss some matches. Phi-3.5 Mini, chosen below, is much better at this.</p>
          ) : null}
          {found.kept.length ? (
            <ol className="found">
              {found.kept.slice(0, 10).map((row, index) => (
                <li key={index}>{rowTitle(row)}</li>
              ))}
            </ol>
          ) : (
            <p>Nothing on this page matched.</p>
          )}
          {found.kept.length > 10 ? <p className="hint">and {found.kept.length - 10} more in Data.</p> : null}
          <div className="row">
            <button type="button" onClick={() => openTab('data')}>
              Open in Data
            </button>
            <button type="button" className="ghost" onClick={() => void pickInstead()}>
              Not the right list? Pick it yourself
            </button>
          </div>
        </div>
      ) : null}
      {reply ? (
        <>
          {replyFrom ? <p className="hint">{replyFrom}</p> : null}
          <div className="answer">{reply}</div>
        </>
      ) : null}
      {error ? (
        <p className="error">
          {error}{' '}
          {/list/i.test(error) ? (
            <button type="button" className="ghost" onClick={() => void pickInstead()}>
              Pick it yourself
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

function title(_plan: Plan, workflowName?: string) {
  return `Run “${workflowName ?? 'workflow'}”`;
}
