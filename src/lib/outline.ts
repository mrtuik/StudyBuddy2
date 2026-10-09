import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface Chap { title: string; page: number; items?: Chap[] }
/** src: 'outline' = PDF bookmarks, 'text' = parsed from the printed index page, 'auto' = fixed-size parts */
export interface ChapterSet { src: 'outline' | 'text' | 'headings' | 'auto'; items: Chap[]; off?: number }
export interface ChapRow { n: number; title: string; page: number; end: number; items: Chap[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function destPage(doc: PDFDocumentProxy, dest: Any): Promise<number | undefined> {
  try {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d) || d[0] == null) return undefined;
    if (typeof d[0] === 'number') return d[0] + 1;
    return (await doc.getPageIndex(d[0])) + 1;
  } catch { return undefined; }
}

async function fromOutline(doc: PDFDocumentProxy): Promise<Chap[]> {
  let out: Any[] | null = null;
  try { out = (await doc.getOutline()) as Any[] | null; } catch { /* none */ }
  if (!out?.length) return [];
  if (out.length === 1 && out[0].items?.length > 1) out = out[0].items; // single book-title root
  const res: Chap[] = [];
  for (const o of out!) {
    const page = await destPage(doc, o.dest);
    if (!page) continue;
    const kids: Chap[] = [];
    for (const k of (o.items ?? []) as Any[]) {
      const kp = await destPage(doc, k.dest);
      if (kp) kids.push({ title: String(k.title).trim(), page: kp });
    }
    res.push({ title: String(o.title).trim(), page, items: kids });
  }
  return res;
}

type Line = { s: string; size: number; y: number };

async function pageLines(doc: PDFDocumentProxy, p: number): Promise<{ lines: Line[]; h: number }> {
  const pg = await doc.getPage(p);
  const tc = await pg.getTextContent();
  const h = pg.view[3] - pg.view[1];
  const rows = new Map<number, { x: number; w: number; s: string; size: number; y: number }[]>();
  for (const it of tc.items as Any[]) {
    if (!it.str || !String(it.str).trim()) continue;
    const y = Math.round(it.transform[5] / 3);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push({ x: it.transform[4], w: Number(it.width) || 0, s: String(it.str), size: Math.hypot(it.transform[0], it.transform[1]), y: it.transform[5] });
  }
  const lines: Line[] = [...rows.keys()].sort((a, b) => b - a).map((k) => {
    const r = rows.get(k)!.sort((a, b) => a.x - b.x);
    let line = '';
    r.forEach((x, i) => {
      const prev = r[i - 1];
      const gap = prev ? x.x - (prev.x + prev.w) : 0;
      const space = prev && (gap > prev.size * 0.3 || /\s$/.test(prev.s) || /^\s/.test(x.s));
      line += (space ? ' ' : '') + x.s.trim();
    });
    return { s: line.replace(/\s+/g, ' ').trim(), size: Math.max(...r.map((x) => x.size)), y: r[0].y };
  });
  pg.cleanup();
  return { lines, h };
}

async function fromText(doc: PDFDocumentProxy): Promise<{ items: Chap[]; nums: number[] }> {
  const numbered: Chap[] = [];
  const nums: number[] = [];
  const n = Math.min(doc.numPages, 30);
  for (let p = 1; p <= n; p++) {
    try {
      const { lines } = await pageLines(doc, p);
      for (const { s } of lines) {
        const m = s.match(/^(?:chapter\s+)?(\d{1,2})[.):\s-]+([A-Za-z][^]{3,}?)[\s.·…_-]*\s(\d{1,4})$/i);
        if (m && Number(m[3]) <= doc.numPages) { numbered.push({ title: m[2].replace(/[.·…_\s]+$/, '').trim(), page: Number(m[3]) }); nums.push(Number(m[1])); }
      }
    } catch { /* skip page */ }
  }
  const out: Chap[] = [];
  const on: number[] = [];
  let want = 1;
  numbered.forEach((c, i) => {
    if (nums[i] === want && (!out.length || c.page >= out[out.length - 1].page)) { out.push(c); on.push(want); want++; }
  });
  return out.length >= 3 ? { items: out, nums: on } : { items: [], nums: [] };
}

interface Scan { openers: Map<number, Chap>; big: Chap[]; vocab: Map<string, number> }

/** One pass over the whole book: finds "Chapter N" opener pages, big-title pages, and builds a word list of the book itself. */
async function scanBook(doc: PDFDocumentProxy, onP?: (m: string) => void): Promise<Scan> {
  const total = doc.numPages;
  const hist = new Map<number, number>();
  const openers = new Map<number, Chap>();
  const bigRaw: { page: number; text: string; size: number }[] = [];
  const vocab = new Map<string, number>();
  const rx = /^(?:chapter|unit|section|lesson)\s*([0-9]{1,2})\b\s*[:.\-–]?\s*(.*)$/i;
  for (let p = 1; p <= total; p++) {
    if (p % 8 === 0) { onP?.(`Finding chapters… ${p}/${total}`); await new Promise((r) => setTimeout(r, 0)); }
    try {
      const { lines, h } = await pageLines(doc, p);
      for (const l of lines) {
        const k = Math.round(l.size); hist.set(k, (hist.get(k) ?? 0) + l.s.length);
        for (const w of l.s.match(/[A-Za-z]{2,}/g) ?? []) { const lw = w.toLowerCase(); vocab.set(lw, (vocab.get(lw) ?? 0) + 1); }
      }
      const top = lines.filter((l) => l.y > h * 0.45).slice(0, 8);
      for (let i = 0; i < top.length; i++) {
        if (/[.·…]{3,}\s*\d+$/.test(top[i].s)) continue;
        const m = top[i].s.match(rx);
        if (!m) continue;
        const num = Number(m[1]);
        let title = m[2].trim();
        if (title.length < 3 && top[i + 1]) {
          title = top[i + 1].s;
          // title may wrap onto a second line of the same size
          if (top[i + 2] && Math.abs(top[i + 2].size - top[i + 1].size) < 1 && title.length < 40) title += ' ' + top[i + 2].s;
        }
        if (!openers.has(num)) openers.set(num, { title: title.slice(0, 90) || `Chapter ${num}`, page: p });
        break;
      }
      const first = top[0];
      if (first && first.s.length >= 3 && first.s.length <= 90 && /[A-Za-z]{3}/.test(first.s)) {
        let t = first.s;
        for (let i = 1; i < top.length && Math.abs(top[i].size - first.size) < 1 && t.length < 90; i++) t += ' ' + top[i].s;
        bigRaw.push({ page: p, text: t, size: first.size });
      }
    } catch { /* skip page */ }
  }
  let body = 10, best = 0;
  hist.forEach((v, k) => { if (v > best) { best = v; body = k; } });
  const freq = new Map<string, number>();
  bigRaw.forEach((b) => freq.set(b.text, (freq.get(b.text) ?? 0) + 1));
  const big: Chap[] = [];
  for (const b of bigRaw) {
    if (b.size < body * 1.5 || (freq.get(b.text) ?? 0) > 2 || b.page < 2) continue;
    if (big.length && b.page - big[big.length - 1].page < 5) continue;
    big.push({ title: b.text, page: b.page });
  }
  return { openers, big, vocab };
}

/** Joins fragments like "Morpho l ogy" back into words, using words that appear in the book itself. */
function fixTitle(t: string, vocab: Map<string, number>): string {
  const w = t.replace(/\s+/g, ' ').trim().split(' ');
  const cnt = (x: string) => vocab.get(x.toLowerCase()) ?? 0;
  const out: string[] = [];
  for (let i = 0; i < w.length;) {
    let merged = false;
    for (let j = Math.min(w.length, i + 5); j > i + 1; j--) {
      const frag = w.slice(i, j);
      if (!frag.every((f) => /^[A-Za-z]+$/.test(f))) continue;
      const m = frag.join('');
      if (cnt(m) >= 3 && frag.some((f) => cnt(f) < cnt(m))) { out.push(m); i = j; merged = true; break; }
    }
    if (!merged) { out.push(w[i]); i++; }
  }
  return out.join(' ');
}

export async function loadChapters(doc: PDFDocumentProxy, onP?: (m: string) => void): Promise<ChapterSet> {
  const o = await fromOutline(doc);
  if (o.length >= 2) return { src: 'outline', items: o };
  onP?.('Reading index page…');
  const toc = await fromText(doc);
  const scan = await scanBook(doc, onP);
  const fix = (c: Chap): Chap => ({ ...c, title: fixTitle(c.title, scan.vocab) });

  // 1) "Chapter N" opener pages: exact PDF pages, no offset needed
  const asc = [...scan.openers.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).filter((c, i, a) => !i || c.page > a[i - 1].page);
  if (asc.length >= 3) return { src: 'headings', items: asc.map(fix) };

  // 2) printed index page; work out the printed -> PDF page shift from any opener we did find
  if (toc.items.length) {
    const diffs: number[] = [];
    toc.nums.forEach((n, i) => { const op = scan.openers.get(n); if (op) diffs.push(op.page - toc.items[i].page); });
    diffs.sort((a, b) => a - b);
    const off = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
    return { src: 'text', items: toc.items.map(fix), off };
  }

  // 3) pages that start with a much bigger title
  if (scan.big.length >= 3) return { src: 'headings', items: scan.big.map(fix) };

  const size = 25;
  const parts: Chap[] = [];
  for (let p = 1; p <= doc.numPages; p += size) parts.push({ title: `Part ${parts.length + 1}`, page: p });
  return { src: 'auto', items: parts };
}

/** Numbered chapter rows (1, 2, 3 …) with start/end pages. `offset` shifts printed page numbers to PDF pages. */
export function resolveChapters(set: ChapterSet | undefined, userOffset: number | undefined, total: number): ChapRow[] {
  if (!set || !total) return [];
  const off = set.src === 'text' ? userOffset ?? set.off ?? 0 : 0;
  const items = set.items
    .map((c) => ({ ...c, page: Math.min(total, Math.max(1, c.page + off)) }))
    .sort((a, b) => a.page - b.page);
  return items.map((c, i) => ({
    n: i + 1,
    title: c.title,
    page: c.page,
    end: i + 1 < items.length ? Math.max(c.page, items[i + 1].page - 1) : total,
    items: (c.items ?? []).filter((k) => k.page >= c.page),
  }));
}
