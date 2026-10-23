import { linesFromItems, type TextItem } from './pdfContent';
import { documentNeedsOcr, ocrEmptyPdfPages, type OcrProgress } from './ocrText';

export type PdfDocument = {
  title: string;
  source: string;
  pages: string[];
  ocrPages?: number;
};

const MAX_BYTES = 40 * 1024 * 1024;

export async function pdfFromUrl(url: string, onProgress?: OcrProgress) {
  if (url.startsWith('file:')) {
    throw new Error('Chrome blocks reading PDFs saved on this computer from a tab. Use “Open a PDF file” instead.');
  }
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include' });
  } catch {
    throw new Error('Could not download this PDF. If it needs a login, save it and use “Open a PDF file”.');
  }
  if (!response.ok) throw new Error(`The site answered ${response.status} when downloading the PDF.`);
  const data = await response.arrayBuffer();
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'document.pdf');
  return readPdf(data, name, url, false, onProgress);
}

export async function pdfFromFile(file: File, onProgress?: OcrProgress) {
  if (!/\.pdf$/i.test(file.name) && file.type && file.type !== 'application/pdf') {
    throw new Error('Please choose a PDF file (.pdf).');
  }
  return readPdf(await file.arrayBuffer(), file.name, file.name, true, onProgress);
}

function workerUrl(bundled: string) {
  // Vite emits an absolute path like "/assets/pdf.worker….mjs". In the side panel that must be a
  // chrome-extension:// URL, or pdf.js fails to start the worker and uploads look broken.
  const path = bundled.replace(/^\//, '');
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
  } catch {
    // Not running as an extension (unit tests).
  }
  return bundled.startsWith('/') || bundled.startsWith('http') ? bundled : `/${path}`;
}

async function readPdf(
  data: ArrayBuffer,
  name: string,
  source: string,
  fromFile = false,
  onProgress?: OcrProgress,
): Promise<PdfDocument> {
  if (data.byteLength > MAX_BYTES) throw new Error('This PDF is larger than 40 MB.');
  const head = new TextDecoder().decode(new Uint8Array(data.slice(0, 1024)));
  if (!head.includes('%PDF')) {
    throw new Error(
      fromFile
        ? 'That file is not a readable PDF (or it is damaged).'
        : 'This tab is not showing a PDF file.',
    );
  }

  onProgress?.('Reading the PDF…');
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl(worker.default);

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  let pdfDoc;
  try {
    pdfDoc = await task.promise;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Could not open this PDF (${detail}). Try another file, or a PDF that is not password-protected.`);
  }
  try {
    const pages: string[] = [];
    for (let number = 1; number <= pdfDoc.numPages; number += 1) {
      const page = await pdfDoc.getPage(number);
      const content = await page.getTextContent();
      const items: TextItem[] = content.items.flatMap((item) =>
        'str' in item ? [{ str: item.str, transform: item.transform }] : [],
      );
      pages.push(linesFromItems(items));
    }

    let ocrPages = 0;
    if (documentNeedsOcr(pages)) {
      onProgress?.('Almost no selectable text — running OCR on scanned pages…');
      try {
        ocrPages = await ocrEmptyPdfPages(pdfDoc as never, pages, onProgress);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'OCR failed';
        throw new Error(
          `${detail} If this is a scanned PDF, try again, or use a PDF with selectable text.`,
        );
      }
    }

    const metadata = await pdfDoc.getMetadata().catch(() => null);
    const info = metadata?.info as { Title?: string } | undefined;
    const title = info?.Title?.trim();
    const usable = title && !/^(about:blank|untitled|microsoft word - )/i.test(title);
    return {
      title: usable ? title : name.replace(/\.pdf$/i, ''),
      source,
      pages,
      ...(ocrPages ? { ocrPages } : {}),
    };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
