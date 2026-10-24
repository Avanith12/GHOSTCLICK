import { useEffect, useRef, useState } from 'react';
import {
  chunkPages,
  cleanRows,
  partsForExtract,
  pdfMarkdown,
  relevantText,
  shapeRows,
  UNVERIFIED,
  verifyRows,
} from '@/features/data/pdfContent';
import type { Row, Snapshot } from '@/shared/types';
import { downloadText, fileName, type Command } from './api';
import { ANSWER_CHARS, answer, extractRows } from '@/features/local-ai/localModel';
import { pdfFromFile, pdfFromUrl, type PdfDocument } from '@/features/data/loadPdf';
import type { ModelState } from '@/features/local-ai/useLocalModel';

const MAX_PARTS = 24;

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
    // Run once when Ask hands off a PDF request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead]);

  async function load(task: (onProgress: (message: string) => void) => Promise<PdfDocument>) {
    setBusy(true);
    setReply('');
    setStatus('Reading the PDF…');
    try {
      const doc = await task((message) => setStatus(message));
      const characters = doc.pages.reduce((total, page) => total + page.length, 0);
      setPdf(doc);
      const ocrNote = doc.ocrPages ? ` OCR’d ${doc.ocrPages} scanned page${doc.ocrPages === 1 ? '' : 's'}.` : '';
      setStatus(
        characters < 20
          ? `“${doc.title}” still has almost no text after OCR.${ocrNote} Try a clearer scan, or a PDF with selectable text.`
          : `Read “${doc.title}”: ${doc.pages.length} pages, ${characters.toLocaleString()} characters.${ocrNote} Next: Ask about this PDF, or Pull out into a table. Load a text model in Settings (⚙) if needed.`,
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
    if (/^file:/i.test(tab.url)) {
      setStatus('Chrome blocks reading file:// PDF tabs. Use “Open a PDF file” below and pick it from disk.');
      return;
    }
    await load((onProgress) => pdfFromUrl(tab.url!, onProgress));
  }

  async function needModel() {
    return model.loadForText(snap.settings.model);
  }

  async function pullOut() {
    if (!pdf || !want.trim()) return;
    const keys = columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
    if (!keys.length) {
      setStatus('Add Columns first (comma separated), for example: code, title, credits.');
      return;
    }
    setBusy(true);
    cancelled.current = false;
    try {
      if (!(await needModel())) return;
      const parts = partsForExtract(pdf.pages, want, MAX_PARTS);
      if (!parts.length) {
        setStatus('No text chunks were available to extract from.');
        return;
      }
      const collected: Row[] = [];
      for (let index = 0; index < parts.length; index += 1) {
        if (cancelled.current) break;
        setStatus(`Pulling table · part ${index + 1} of ${parts.length}…`);
        const rows = await extractRows(want, keys, parts[index] ?? '');
        collected.push(...shapeRows(rows, keys));
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
      const totalParts = chunkPages(pdf.pages).length;
      const skipped = totalParts > parts.length ? ` Used ${parts.length} of ${totalParts} text parts (most relevant first).` : '';
      setStatus(
        checked.length === 0
          ? `No rows matched “${want.trim()}”. Try clearer columns or a narrower request.${skipped}`
          : `${checked.length} rows added to the table below.${
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
      setStatus('Finding the best PDF pages for your question…');
      // Keep under the local model’s context window (dense form PDFs tokenize tightly).
      const context = relevantText(chunkPages(pdf.pages), question, ANSWER_CHARS);
      if (!context.trim()) {
        setReply('No usable text chunks were found in this PDF.');
        return;
      }
      setStatus(`Asking with ${context.length.toLocaleString()} characters of PDF text…`);
      setReply(await answer(question, context, ANSWER_CHARS));
      setStatus(`Answered from “${pdf.title}”. For tables of rows, use Pull out into a table instead of Ask.`);
    } catch (error) {
      setReply(error instanceof Error ? error.message : 'The model could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pdf-block">
      <p className="tag">PDF</p>
      <div className="row">
        <button type="button" className="ghost" disabled={busy} onClick={() => void readTab()}>
          Read tab
        </button>
        <label className="file">
          Open file
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load((onProgress) => pdfFromFile(file, onProgress));
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
            Pull out
            <textarea
              rows={2}
              value={want}
              placeholder="Course list with code, title, and credits"
              onChange={(event) => setWant(event.target.value)}
            />
          </label>
          <label>
            Columns
            <input value={columns} placeholder="code, title, credits" onChange={(event) => setColumns(event.target.value)} />
          </label>
          <div className="row">
            <button type="button" disabled={busy || !want.trim() || !columns.trim()} onClick={() => void pullOut()}>
              {busy ? 'Working…' : 'Pull into table'}
            </button>
            {busy ? (
              <button type="button" className="ghost" onClick={() => (cancelled.current = true)}>
                Stop
              </button>
            ) : null}
          </div>

          <label>
            Ask this PDF
            <textarea
              rows={2}
              value={question}
              placeholder="What is this form for?"
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <button type="button" className="ghost" disabled={busy || !question.trim()} onClick={() => void ask()}>
            Ask
          </button>
          {reply ? <div className="answer">{reply}</div> : null}
        </>
      ) : null}
    </div>
  );
}
