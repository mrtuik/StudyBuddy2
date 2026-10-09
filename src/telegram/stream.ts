import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { CHUNK, markPersist, readAhead, readRange } from './media';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const BASE_OPTS = {
  disableAutoFetch: true,
  enableXfa: false,
  isEvalSupported: false,
  useSystemFonts: true,
};

class TgTransport extends pdfjsLib.PDFDataRangeTransport {
  private msgId: number;
  private total: number;
  private onFail?: (e: Error) => void;
  private onStage?: (s: string) => void;
  private n = 0;
  constructor(msgId: number, total: number, initial: Uint8Array, onFail?: (e: Error) => void, onStage?: (s: string) => void) {
    super(total, initial);
    this.onFail = onFail;
    this.onStage = onStage;
    this.msgId = msgId;
    this.total = total;
  }
  requestDataRange(begin: number, end: number) {
    readRange(this.msgId, this.total, begin, end)
      .then(({ start, data }) => { this.onDataRange(start, data); this.onStage?.(`Reading document… ${++this.n}`); readAhead(this.msgId, this.total, end); })
      .catch((e) => { console.error('range error', e); this.onFail?.(e instanceof Error ? e : new Error(String(e))); });
  }
}

/** Only the needed byte ranges are pulled from Telegram. Header + xref chunks load in parallel (and are cached on disk). */
export async function openRemotePdf(msgId: number, size: number, onStage?: (s: string) => void, onFail?: (e: Error) => void): Promise<PDFDocumentProxy> {
  onStage?.('Opening…');
  markPersist(msgId);
  const lastIdx = Math.floor((size - 1) / CHUNK);
  const [first] = await Promise.all([
    readRange(msgId, size, 0, CHUNK),
    lastIdx > 0 ? readRange(msgId, size, lastIdx * CHUNK, size) : Promise.resolve(undefined),
  ]);
  readAhead(msgId, size, 0, 4);                 // the next chunks after the header usually hold fonts / first pages: load them in the background
  onStage?.('Reading document…');
  const transport = new TgTransport(msgId, size, first.data.slice(0, CHUNK), onFail, onStage);
  return pdfjsLib.getDocument({
    ...BASE_OPTS,
    range: transport,
    length: size,
    rangeChunkSize: CHUNK, // one pdf.js request == one cached Telegram chunk
    disableStream: true,
  }).promise;
}

export function openLocalPdf(url: string): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ ...BASE_OPTS, url, rangeChunkSize: CHUNK * 2 }).promise;
}

/* ---------- warm open: start opening the PDF while the user is still on the book page ---------- */
const warm = new Map<number, Promise<PDFDocumentProxy>>();

/** Opens the document and pre-loads the page the reader will show (resume page), before "Read" is tapped. */
export function warmRemotePdf(msgId: number, size: number, page = 1) {
  if (!size || warm.has(msgId)) return;
  for (const [k, old] of warm) { warm.delete(k); void old.then((d) => d.destroy()).catch(() => undefined); } // keep a single warm document
  const p = openRemotePdf(msgId, size);
  warm.set(msgId, p);
  p.then(async (d) => {
    const pg = await d.getPage(Math.min(Math.max(1, page), d.numPages));
    await pg.getOperatorList(); // pulls the fonts / images this page needs into the cache
  }).catch(() => { if (warm.get(msgId) === p) warm.delete(msgId); });
}

/** Opens a streamed PDF, reusing the warm document when there is one. */
export async function openRemotePdfWarm(msgId: number, size: number, onStage?: (s: string) => void, onFail?: (e: Error) => void): Promise<PDFDocumentProxy> {
  const w = warm.get(msgId);
  warm.delete(msgId);
  if (w) {
    try { onStage?.('Opening…'); return await w; } catch { /* fall back to a fresh open */ }
  }
  return openRemotePdf(msgId, size, onStage, onFail);
}
