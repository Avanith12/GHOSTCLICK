import { useState } from 'react';
import { toCsv } from '@/lib/csv';
import { dataContext } from '@/lib/rank';
import type { Snapshot } from '@/lib/types';
import { downloadText, downloadUrls, fileName, pageMarkdown, type Command } from './api';
import { answer, modelReady } from './model';
import { PdfPanel } from './PdfPanel';
import type { ModelState } from './useModel';

const FILE_LINK = /\.(pdf|docx?|xlsx?|csv|pptx?|zip|txt|rtf|odt|epub|jpe?g|png|gif|webp|mp3|mp4)(\?|#|$)/i;

export function DataView({
  snap,
  model,
  command,
  autoReadPdf,
  onAutoReadDone,
}: {
  snap: Snapshot;
  model: ModelState;
  command: Command;
  autoReadPdf: boolean;
  onAutoReadDone: () => void;
}) {
  const { columns, rows, source } = snap.results;
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const files = [
    ...new Set(rows.flatMap((row) => Object.values(row).filter((value) => /^https?:\/\//.test(value) && FILE_LINK.test(value)))),
  ];
  const host = source ? safeHost(source) : 'ghostclick';

  async function savePage() {
    setNote('');
    try {
      const page = await pageMarkdown();
      await downloadText(fileName(page.title, 'md'), page.markdown, 'text/markdown');
      setNote(`Saved “${page.title}” to Downloads.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not save this page.');
    }
  }

  async function ask() {
    if (!question.trim() || !rows.length) return;
    setBusy(true);
    setReply('');
    try {
      if (!modelReady() && !(await model.load(snap.settings.model))) return;
      setReply(await answer(question, dataContext(question, columns, rows)));
    } catch (error) {
      setReply(error instanceof Error ? error.message : 'The model could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="row">
        <button type="button" onClick={() => void command({ type: 'START_PICK' })}>
          Scrape a list on this page
        </button>
        <button type="button" className="ghost" onClick={() => void savePage()}>
          Save page as document
        </button>
      </div>
      <p className="hint">Scrape: click one item in a repeated list or table, and Ghostclick finds the rest.</p>
      {note ? <p className="status">{note}</p> : null}
      <PdfPanel snap={snap} model={model} command={command} autoRead={autoReadPdf} onAutoReadDone={onAutoReadDone} />

      {rows.length ? (
        <>
          <h2>
            {rows.length} rows · {columns.length} columns
          </h2>
          <div className="table">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column} title={row[column]}>
                        {row[column]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 40 ? <p className="hint">Showing the first 40 rows. Downloads include all of them.</p> : null}
          <div className="row">
            <button type="button" onClick={() => void downloadText(fileName(host, 'csv'), toCsv(columns, rows), 'text/csv')}>
              Download CSV
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void downloadText(fileName(host, 'json'), JSON.stringify(rows, null, 2), 'application/json')}
            >
              Download JSON
            </button>
            {files.length ? (
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  void downloadUrls(files).then((count) => setNote(`Started ${count} downloads.`))
                }
              >
                Download {Math.min(files.length, 50)} linked files
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={() => void command({ type: 'CLEAR_RESULTS' })}>
              Clear
            </button>
          </div>

          <div className="box">
            <h2>Ask about this data</h2>
            <textarea
              rows={2}
              value={question}
              placeholder="Which three are cheapest? Group these headlines by topic."
              onChange={(event) => setQuestion(event.target.value)}
            />
            <div className="row">
              <button type="button" disabled={busy || !question.trim()} onClick={() => void ask()}>
                {busy ? 'Thinking…' : 'Ask the local model'}
              </button>
            </div>
            {reply ? <div className="answer">{reply}</div> : null}
          </div>
        </>
      ) : (
        <p>No data yet. Scrape a list, or run a workflow that has a scrape step.</p>
      )}
    </section>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'ghostclick';
  }
}
