import { useState } from 'react';
import { toCsv } from '@/shared/csv';
import { dataContext } from '@/features/data/sortRowsForQuestion';
import type { Snapshot } from '@/shared/types';
import { downloadText, downloadUrls, fileName, pageMarkdown, type Command } from './api';
import { answer } from '@/features/local-ai/localModel';
import { PdfPanel } from './PdfPanel';
import type { ModelState } from '@/features/local-ai/useLocalModel';

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

  async function scrapeList() {
    setNote('');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const url = tab?.url ?? '';
    if (/^file:/i.test(url) || /\.pdf(\?|#|$)/i.test(url) || /\/pdf(\?|#|$)/i.test(url)) {
      setNote('That tab looks like a PDF. Use Read / Open a PDF below instead of scrape.');
      return;
    }
    await command({ type: 'START_PICK' });
  }

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
      if (!(await model.loadForText(snap.settings.model))) return;
      setReply(await answer(question, dataContext(question, columns, rows)));
    } catch (error) {
      setReply(error instanceof Error ? error.message : 'The model could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-view">
      <h2 className="data-title">Data</h2>
      <p className="hint">Pull a table from a PDF, or scrape a list on a web page. One place for results.</p>
      {note ? <p className="status">{note}</p> : null}

      <PdfPanel snap={snap} model={model} command={command} autoRead={autoReadPdf} onAutoReadDone={onAutoReadDone} />

      <div className="data-quiet">
        <p className="tag">Web page</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => void scrapeList()}>
            Scrape list
          </button>
          <button type="button" className="ghost" onClick={() => void savePage()}>
            Save as Markdown
          </button>
        </div>
      </div>

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
                onClick={() => void downloadUrls(files).then((count) => setNote(`Started ${count} downloads.`))}
              >
                Download {Math.min(files.length, 50)} linked files
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={() => void command({ type: 'CLEAR_RESULTS' })}>
              Clear
            </button>
          </div>

          <label>
            Ask about this table
            <textarea
              rows={2}
              value={question}
              placeholder="Which three are cheapest?"
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <div className="row">
            <button type="button" className="ghost" disabled={busy || !question.trim()} onClick={() => void ask()}>
              {busy ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          {reply ? <div className="answer">{reply}</div> : null}
        </>
      ) : (
        <p className="hint">No rows yet — read a PDF and pull a table, or scrape a list on a page.</p>
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
