import { useEffect, useState } from 'react';
import { mapColumns, parseCsv } from '@/shared/csv';
import { stepSummary } from '@/shared/format';
import { workflowFields } from '@/features/planner/plan';
import type { Snapshot, Workflow, WorkflowStep } from '@/shared/types';
import type { Command } from './api';

export function WorkflowsView({
  snap,
  command,
  selectedId,
  select,
}: {
  snap: Snapshot;
  command: Command;
  selectedId: string | null;
  select: (id: string | null) => void;
}) {
  const selected = snap.workflows.find((workflow) => workflow.id === selectedId) ?? null;
  if (selected) return <WorkflowDetail key={selected.id} workflow={selected} command={command} back={() => select(null)} />;

  return (
    <section>
      <div className="row">
        <button type="button" onClick={() => void command({ type: 'START_RECORDING' })}>
          Record this page
        </button>
      </div>
      <h2>Saved workflows</h2>
      {snap.workflows.length === 0 ? <p>Record a task once to create the first workflow.</p> : null}
      <ul className="workflows">
        {snap.workflows.map((workflow) => (
          <li key={workflow.id}>
            <button type="button" className="workflow" onClick={() => select(workflow.id)}>
              <span>
                <strong>{workflow.name}</strong>
                {workflow.goal ? <small>{workflow.goal}</small> : null}
              </span>
              <small>{workflow.steps.filter((step) => step.kind !== 'navigate').length} steps</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkflowDetail({ workflow, command, back }: { workflow: Workflow; command: Command; back: () => void }) {
  const fields = workflowFields(workflow);
  const [name, setName] = useState(workflow.name);
  const [goal, setGoal] = useState(workflow.goal);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.example])),
  );
  const [startHere, setStartHere] = useState(false);
  const [batch, setBatch] = useState<{ rows: Record<string, string>[]; matched: string[]; file: string } | null>(null);

  async function readFile(file: File) {
    const records = parseCsv(await file.text());
    const headers = Object.keys(records[0] ?? {});
    const mapping = mapColumns(headers, fields);
    const rows = records.map((record) => {
      const row = { ...values };
      for (const [key, header] of Object.entries(mapping)) row[key] = record[header] ?? '';
      return row;
    });
    setBatch({
      rows,
      file: file.name,
      matched: fields.filter((field) => mapping[field.key]).map((field) => field.label),
    });
  }

  async function remove() {
    if (!window.confirm(`Delete “${workflow.name}”?`)) return;
    back();
    await command({ type: 'DELETE_WORKFLOW', id: workflow.id });
  }

  return (
    <section>
      <button type="button" className="back" onClick={back}>
        All workflows
      </button>
      <label>
        Name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void command({ type: 'UPDATE_WORKFLOW', id: workflow.id, name })}
        />
      </label>
      <label>
        What this workflow does
        <input
          value={goal}
          placeholder="Helps the planner pick this workflow from a sentence"
          onChange={(event) => setGoal(event.target.value)}
          onBlur={() => void command({ type: 'UPDATE_WORKFLOW', id: workflow.id, goal })}
        />
      </label>

      {fields.length ? (
        <div className="fields">
          {fields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                value={values[field.key] ?? ''}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="hint">No typed fields. Run repeats the same clicks, checks, and scrapes.</p>
      )}

      <label className="check">
        <input type="checkbox" checked={startHere} onChange={(event) => setStartHere(event.target.checked)} />
        Start from the tab that is already open
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void command({ type: 'START_REPLAY', workflowId: workflow.id, variables: values, startFromCurrentTab: startHere })
          }
        >
          Run
        </button>
        <button type="button" className="ghost" onClick={() => void remove()}>
          Delete
        </button>
      </div>

      {fields.length ? (
        <div className="box">
          <h2>Run once per row</h2>
          <p className="hint">
            Upload a CSV whose headers match the field names, such as {fields.map((field) => `“${field.label}”`).join(', ')}.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])} />
          {batch ? (
            <>
              <p>
                {batch.rows.length} rows in {batch.file}. Matched: {batch.matched.join(', ') || 'no columns'}. Unmatched fields
                keep the values above.
              </p>
              <button
                type="button"
                disabled={!batch.rows.length || !batch.matched.length}
                onClick={() => void command({ type: 'START_BATCH', workflowId: workflow.id, rows: batch.rows })}
              >
                Run {batch.rows.length} times
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <h2>Steps</h2>
      <StepList steps={workflow.steps} />
    </section>
  );
}

export function StepList({ steps }: { steps: WorkflowStep[] }) {
  if (steps.length === 0) return <p>No steps yet.</p>;
  return (
    <ol className="steps">
      {steps.map((step) => (
        <li key={step.id}>
          <span>{stepSummary(step)}</span>
          {step.screenshot ? <Thumb storageKey={step.screenshot} /> : null}
        </li>
      ))}
    </ol>
  );
}

function Thumb({ storageKey }: { storageKey: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void chrome.storage.local.get(storageKey).then((stored) => setSrc(String(stored[storageKey] ?? '')));
  }, [storageKey]);
  return src ? <img className="thumb" src={src} alt="Page when this step was recorded" /> : null;
}
