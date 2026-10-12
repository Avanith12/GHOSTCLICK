import { useEffect, useRef, useState } from 'react';
import { chunkPages, cleanRows, pdfMarkdown, relevantText, UNVERIFIED, verifyRows } from '@/features/read-pdf/pdfContent';
import type { Row, Snapshot } from '@/shared/types';
import { downloadText, fileName, type Command } from './api';
import { answer, extractRows, modelReady } from '@/features/local-ai/localModel';
import { pdfFromFile, pdfFromUrl, type PdfDocument } from '@/features/read-pdf/loadPdf';
import type { ModelState } from '@/features/local-ai/useLocalModel';

const MAX_PARTS = 20;

export function PdfPanel({
  snap,
  model,
  command,
  autoRead,
  onAutoReadDone,
}: {
  snap: Snapshot;
  model: ModelState;
  command: Command;
  autoRead: boolean;
  onAutoReadDone: () => void;
}) {
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [want, setWant] = useState('');
  const [columns, setColumns] = useState('');
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState('');
  const cancelled = useRef(false);

  useEffect(() => {
    if (!autoRead) return;
    onAutoReadDone();
    void readTab();
    // Run once when the Ask tab hands off a PDF request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead]);

  async function load(task: () => Promise<PdfDocument>) {
    setBusy(true);
    setReply('');
    setStatus('Reading the PDF…');
    try {
      const doc = await task();
      const characters = doc.pages.reduce((total, page) => total + page.length, 0);
      setPdf(doc);
      setStatus(
        characters < 20
          ? `“${doc.title}” has ${doc.pages.length} pages but almost no text. It is probably scanned images, which need text recognition (OCR).`
          : `Read “${doc.title}”: ${doc.pages.length} pages, ${characters.toLocaleString()} characters.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not read that PDF.');
    } finally {
      setBusy(false);
    }
  }

  async function readTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) {
      setStatus('Open the PDF in a tab first.');
      return;
    }
    await load(() => pdfFromUrl(tab.url!));
  }

  async function needModel() {
    if (modelReady()) return true;
    return model.load(snap.settings.model);
  }

  async function pullOut() {
    if (!pdf || !want.trim()) return;
    setBusy(true);
    cancelled.current = false;
    try {
      if (!(await needModel())) return;
      const parts = chunkPages(pdf.pages).slice(0, MAX_PARTS);
      let keys = columns
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      const collected: Row[] = [];
      for (let index = 0; index < parts.length; index += 1) {
        if (cancelled.current) break;
        setStatus(`Reading part ${index + 1} of ${parts.length}…`);
        const rows = await extractRows(want, keys, parts[index] ?? '');
        if (!keys.length && rows[0]) keys = Object.keys(rows[0]);
        collected.push(...rows);
      }
      const source = pdf.pages.join('\n');
      const checked = verifyRows(cleanRows(collected, keys), source);
      const flagged = checked.filter((row) => row[UNVERIFIED]).length;
      const response = await command({
        type: 'SET_RESULTS',
        rows: checked,
        source: pdf.source,
      });
      if (!response?.ok) throw new Error('Could not save the table.');
      const skipped = chunkPages(pdf.pages).length > MAX_PARTS ? ` Only the first ${MAX_PARTS} parts were read.` : '';
      setStatus(
        `${checked.length} rows added to the table below.${
          flagged ? ` ${flagged} rows have values that do not appear word for word in the PDF; check the “${UNVERIFIED}” column.` : ''
        }${skipped}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The model could not read the PDF.');
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    if (!pdf || !question.trim()) return;
    setBusy(true);
    setReply('');
    try {
      if (!(await needModel())) return;
      setReply(await answer(question, relevantText(chunkPages(pdf.pages), question)));
    } catch (error) {
      setReply(error instanceof Error ? error.message : 'The model could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="box">
      <h2>PDF</h2>
      <div className="row">
        <button type="button" className="ghost" disabled={busy} onClick={() => void readTab()}>
          Read the PDF in this tab
        </button>
        <label className="file">
          Open a PDF file
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(() => pdfFromFile(file));
              event.target.value = '';
            }}
          />
        </label>
      </div>
      {status ? <p className="status">{status}</p> : null}

      {pdf ? (
        <>
          <div className="row">
            <button
              type="button"
              className="ghost"
              onClick={() => void downloadText(fileName(pdf.title, 'md'), pdfMarkdown(pdf.title, pdf.source, pdf.pages), 'text/markdown')}
            >
              Save as text
            </button>
          </div>

          <label>
            What should be pulled out?
            <textarea
              rows={2}
              value={want}
              placeholder="Every course with its code, title, and credits"
              onChange={(event) => setWant(event.target.value)}
            />
          </label>
          <label>
            Columns (optional, comma separated)
            <input value={columns} placeholder="code, title, credits" onChange={(event) => setColumns(event.target.value)} />
          </label>
          <div className="row">
            <button type="button" disabled={busy || !want.trim()} onClick={() => void pullOut()}>
              {busy ? 'Working…' : 'Pull out into a table'}
            </button>
            {busy ? (
              <button type="button" className="ghost" onClick={() => (cancelled.current = true)}>
                Stop
              </button>
            ) : null}
          </div>

          <label>
            Ask about this PDF
            <textarea rows={2} value={question} placeholder="When is the deadline?" onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <button type="button" className="ghost" disabled={busy || !question.trim()} onClick={() => void ask()}>
            Ask the local model
          </button>
          {reply ? <div className="answer">{reply}</div> : null}
        </>
      ) : null}
    </div>
  );
}
