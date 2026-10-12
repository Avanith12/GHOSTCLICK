import { linesFromItems, type TextItem } from './pdfText';

export type PdfDocument = {
  title: string;
  source: string;
  pages: string[];
};

const MAX_BYTES = 40 * 1024 * 1024;

export async function pdfFromUrl(url: string) {
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
  return readPdf(data, name, url);
}

export async function pdfFromFile(file: File) {
  return readPdf(await file.arrayBuffer(), file.name, file.name);
}

async function readPdf(data: ArrayBuffer, name: string, source: string): Promise<PdfDocument> {
  if (data.byteLength > MAX_BYTES) throw new Error('This PDF is larger than 40 MB.');
  const head = new TextDecoder().decode(new Uint8Array(data.slice(0, 1024)));
  if (!head.includes('%PDF')) throw new Error('This tab is not showing a PDF file.');

  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const document = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const items: TextItem[] = content.items.flatMap((item) =>
      'str' in item ? [{ str: item.str, transform: item.transform }] : [],
    );
    pages.push(linesFromItems(items));
  }
  const metadata = await document.getMetadata().catch(() => null);
  const info = metadata?.info as { Title?: string } | undefined;
  await task.destroy();
  const title = info?.Title?.trim();
  const usable = title && !/^(about:blank|untitled|microsoft word - )/i.test(title);
  return { title: usable ? title : name.replace(/\.pdf$/i, ''), source, pages };
}
