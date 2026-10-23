export type OcrProgress = (message: string) => void;

const MAX_OCR_PAGES = 20;
const EMPTY_PAGE_CHARS = 20;

function extensionAsset(path: string) {
  const clean = path.replace(/^\//, '');
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(clean);
    }
  } catch {
    /* unit tests / node */
  }
  return clean.startsWith('http') || clean.startsWith('/') ? clean : `/${clean}`;
}

function inExtensionPage() {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.getURL);
  } catch {
    return false;
  }
}

/** OCR a canvas, blob, file, or image URL. Used for scanned PDF pages. */
export async function ocrImage(image: HTMLCanvasElement | Blob | File | string, onProgress?: OcrProgress) {
  const { createWorker } = await import('tesseract.js');
  onProgress?.('Starting OCR…');

  // Only override worker/core paths inside the Chrome extension build.
  // In Node tests, tesseract.js resolves its own workers.
  const options: {
    workerPath?: string;
    corePath?: string;
    logger: (message: { status: string; progress?: number }) => void;
  } = {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress?.(`OCR ${Math.round(message.progress * 100)}%…`);
      }
    },
  };

  if (inExtensionPage()) {
    try {
      const workerMod = await import('tesseract.js/dist/worker.min.js?url');
      options.workerPath = extensionAsset(workerMod.default);
    } catch {
      /* keep defaults */
    }
    try {
      const coreMod = await import('tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url');
      options.corePath = extensionAsset(coreMod.default);
    } catch {
      /* keep defaults */
    }
    // Bundled English traineddata (public/tessdata) — avoids a CDN fetch from the side panel.
    (options as { langPath?: string }).langPath = extensionAsset('tessdata');
  }

  const worker = await createWorker('eng', 1, options);

  try {
    const { data } = await worker.recognize(image);
    return (data.text ?? '').replace(/\s+/g, ' ').trim();
  } finally {
    await worker.terminate();
  }
}

export function pageNeedsOcr(text: string) {
  return text.replace(/\s+/g, '').length < EMPTY_PAGE_CHARS;
}

export function documentNeedsOcr(pages: string[]) {
  const characters = pages.reduce((total, page) => total + page.replace(/\s+/g, '').length, 0);
  return pages.length > 0 && characters < EMPTY_PAGE_CHARS * Math.min(pages.length, 3);
}

type PdfJsPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  // pdf.js render options vary by version; keep this loose.
  render: (params: Record<string, unknown>) => { promise: Promise<void> };
};

type PdfJsDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfJsPage>;
};

/**
 * Render pdf.js pages that lack text and OCR them (capped for speed).
 * Mutates `pages` in place and returns how many pages were OCR’d.
 */
export async function ocrEmptyPdfPages(pdfDoc: PdfJsDocument, pages: string[], onProgress?: OcrProgress) {
  if (typeof globalThis.document === 'undefined') {
    throw new Error('OCR needs a browser page to render PDF scans.');
  }

  let ocrCount = 0;
  const limit = Math.min(pdfDoc.numPages, MAX_OCR_PAGES);
  for (let number = 1; number <= limit; number += 1) {
    const index = number - 1;
    if (!pageNeedsOcr(pages[index] ?? '')) continue;
    onProgress?.(`OCR page ${number} of ${limit} (scanned PDF)…`);
    const page = await pdfDoc.getPage(number);
    const canvas = await renderPdfPage(page);
    const text = await ocrImage(canvas, onProgress);
    pages[index] = text || pages[index] || '';
    ocrCount += 1;
  }
  if (pdfDoc.numPages > MAX_OCR_PAGES) {
    onProgress?.(`OCR stopped after ${MAX_OCR_PAGES} pages to keep things fast.`);
  }
  return ocrCount;
}

async function renderPdfPage(page: PdfJsPage) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a canvas for OCR.');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas;
}
