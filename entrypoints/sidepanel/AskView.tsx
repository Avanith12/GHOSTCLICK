import { useState } from 'react';
import { toCsv } from '@/lib/csv';
import { keywordFilter, rowTitle } from '@/lib/filter';
import { rulesPlan, validatePlan, workflowFields, type Plan } from '@/lib/plan';
import type { Row, Snapshot } from '@/lib/types';
import { downloadText, fileName, findList, pageMarkdown, type Command } from './api';
import { answer, filterRows, modelReady, planTask } from './model';
import type { ModelState } from './useModel';

type Found = { total: number; kept: Row[]; filter: string; byModel: boolean };

const EXAMPLES = [
  'Clear the advising hold for Grace Hopper, ID 55667788, grace@navy.mil',
  'Get every item on this page',
  'Find the items on this page related to AI',
  'Save this page as a clean document',
  'Summarize this page',
  'Read the PDF in this tab',
];

export function AskView({
  snap,
  model,
  command,
  openTab,
}: {
  snap: Snapshot;
  model: ModelState;
  command: Command;
  openTab: (tab: 'data' | 'workflows', workflowId?: string, readPdf?: boolean) => void;
}) {
  const [request, setRequest] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [progress, setProgress] = useState('');

  async function makePlan(text = request) {
    if (!text.trim()) return;
    setBusy(true);
    setReply('');
    setError('');
    setFound(null);
    try {
      let next: Plan | null = null;
      if (modelReady()) {
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
      next ??= rulesPlan(text, snap.workflows, snap.results.rows.length > 0);
      setPlan(next);
      setName(next.name || text.slice(0, 60));
      const workflow = snap.workflows.find((item) => item.id === next?.workflowId);
      if (workflow) {
        const defaults: Record<string, string> = {};
        for (const field of workflowFields(workflow)) defaults[field.key] = field.example;
        setValues({ ...defaults, ...(next.variables ?? {}) });
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Planning failed.');
    } finally {
      setBusy(false);
    }
  }

  async function needModel() {
    if (modelReady()) return true;
    return model.load(snap.settings.model);
  }

  async function carryOut() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      if (plan.action === 'run' && plan.workflowId) {
        const response = await command({ type: 'START_REPLAY', workflowId: plan.workflowId, variables: values });
        if (response?.ok) setPlan(null);
      } else if (plan.action === 'find') {
        const list = await findList();
        const filter = plan.question?.trim() ?? '';
        let kept = list.rows;
        let byModel = false;
        if (filter) {
          if (modelReady()) {
            setProgress(`Reading items 0 of ${list.rows.length}…`);
            const keep = await filterRows(filter, list.rows, (done) => setProgress(`Reading items ${done} of ${list.rows.length}…`));
            kept = keep.map((index) => list.rows[index]!).filter(Boolean);
            byModel = true;
          } else {
            kept = keywordFilter(filter, list.rows).map((index) => list.rows[index]!);
          }
        }
        await command({ type: 'SET_RESULTS', rows: kept, source: list.url });
        setFound({ total: list.rows.length, kept, filter, byModel });
        setPlan(null);
      } else if (plan.action === 'scrape') {
        const response = await command({ type: 'START_PICK' });
        if (response?.ok) {
          setPlan(null);
          openTab('data');
        }
      } else if (plan.action === 'read_pdf') {
        setPlan(null);
        openTab('data', undefined, true);
      } else if (plan.action === 'save_page') {
        const page = await pageMarkdown();
        await downloadText(fileName(page.title, 'md'), page.markdown, 'text/markdown');
        setReply(`Saved “${page.title}” as a Markdown document in Downloads.`);
      } else if (plan.action === 'ask_page') {
        if (!(await needModel())) return;
        const page = await pageMarkdown();
        setReply(await answer(plan.question || request, page.markdown));
      } else if (plan.action === 'ask_data') {
        if (!snap.results.rows.length) {
          setError('Nothing has been scraped yet.');
          return;
        }
        if (!(await needModel())) return;
        setReply(await answer(plan.question || request, toCsv(snap.results.columns, snap.results.rows.slice(0, 80))));
      } else if (plan.action === 'record') {
        const response = await command({ type: 'START_RECORDING', name, goal: request });
        if (response?.ok) setPlan(null);
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
    <section>
      <label>
        What should Ghostclick do?
        <textarea
          value={request}
          rows={3}
          placeholder="Describe the task in your own words"
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void makePlan();
          }}
        />
      </label>
      <div className="row">
        <button type="button" disabled={busy || !request.trim()} onClick={() => void makePlan()}>
          {busy && !plan ? 'Thinking…' : 'Plan it'}
        </button>
      </div>
      <div className="chips">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="chip"
            onClick={() => {
              setRequest(example);
              void makePlan(example);
            }}
          >
            {example}
          </button>
        ))}
      </div>
      {!modelReady() ? (
        <p className="hint">No local model is loaded, so plans use simple rules. Load one below for real understanding.</p>
      ) : null}

      {plan ? (
        <div className="plan">
          <p className="tag">{plan.source === 'model' ? 'Planned by the local model' : 'Planned by simple rules'}</p>
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

          {plan.action === 'find' ? (
            <label>
              Keep only items about (leave empty for all)
              <input
                value={plan.question ?? ''}
                placeholder="for example: diagrams and design tools"
                onChange={(event) => setPlan({ ...plan, question: event.target.value })}
              />
            </label>
          ) : null}

          {plan.action === 'record' ? (
            <label>
              Name for the new workflow
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          ) : null}

          <div className="row">
            <button type="button" disabled={busy} onClick={() => void carryOut()}>
              {busy ? 'Working…' : actionLabel(plan)}
            </button>
            {plan.action === 'run' && workflow ? (
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
      {reply ? <div className="answer">{reply}</div> : null}
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

function title(plan: Plan, workflowName?: string) {
  switch (plan.action) {
    case 'run':
      return `Run “${workflowName ?? 'workflow'}”`;
    case 'find':
      return plan.question ? `Find items about “${plan.question}”` : 'Collect the list on this page';
    case 'scrape':
      return 'Scrape a list from this page';
    case 'save_page':
      return 'Save this page as a document';
    case 'ask_page':
      return 'Answer from this page';
    case 'ask_data':
      return 'Answer from scraped data';
    case 'read_pdf':
      return 'Read a PDF';
    default:
      return 'Teach Ghostclick a new task';
  }
}

function actionLabel(plan: Plan) {
  switch (plan.action) {
    case 'run':
      return 'Run';
    case 'find':
      return 'Find them';
    case 'scrape':
      return 'Pick the list';
    case 'save_page':
      return 'Save document';
    case 'record':
      return 'Start recording';
    case 'read_pdf':
      return 'Read the PDF';
    default:
      return 'Answer';
  }
}
