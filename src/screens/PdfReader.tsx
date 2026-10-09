import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { screenCtx } from '../lib/screenCtx';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Bookmark, Check, ChevronDown, ChevronLeft, ChevronUp, Download, Eraser, Hand, Highlighter, ListOrdered, Map as MapIcon, MoreHorizontal, Moon, Pencil, PenLine, Redo2, RefreshCw, Share2, Sun, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { dlKey, localUrl, useDownloads } from '../store/downloads';
import { useLibrary } from '../store/library';
import { openLocalPdf, openRemotePdfWarm } from '../telegram/stream';
import { useShareBook } from '../lib/share';
import { NativePdf, nativePdfAvailable } from '../lib/nativePdf';
import { loadChapters, resolveChapters, type ChapterSet } from '../lib/outline';
import { useAnnot, type Stroke } from '../store/annot';
import AnnotLayer, { type Tool } from '../components/AnnotLayer';
import Roadmap from '../components/Roadmap';

const COLORS = ['#FACC15', '#4ADE80', '#F472B6', '#60A5FA', '#EF4444', '#111111'];
const NONE: Stroke[] = [];
const TRK_T = 72, TRK_B = 84, THUMB_H = 52;
const GAP = 8, SIDE = 6, TOP = 64, BOTTOM = 120, ZMIN = 0.75, ZMAX = 4, MAXPX = 9_000_000;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface Sig { cancelled: boolean; cancel?: () => void }
type Bmp = { kind: 'img'; src: string } | { kind: 'canvas'; canvas: HTMLCanvasElement };
type GetBmp = (p: number, wpx: number, sig: Sig) => Promise<{ bmp: Bmp; ratio: number } | undefined>;

interface PageProps {
  p: number; left: number; top: number; w: number; h: number; wpx: number; native: boolean;
  getBmp: GetBmp; onRatio: (p: number, r: number) => void; onFail: (e: unknown) => void;
  filt?: string; strokes: Stroke[]; tool: Tool; color: string; onStrokes: (p: number, s: Stroke[]) => void;
}

/** One page of the continuous scroll. Keeps showing its previous bitmap (stretched) until the sharper one is ready, so zooming never flashes. */
const PageView = memo(function PageView({ p, left, top, w, h, wpx, native, getBmp, onRatio, onFail, filt, strokes, tool, color, onStrokes }: PageProps) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState<string>();
  const [has, setHas] = useState(false);

  useEffect(() => {
    const sig: Sig = { cancelled: false };
    const t = setTimeout(async () => {
      try {
        const r = await getBmp(p, wpx, sig);
        if (!r || sig.cancelled) return;
        if (r.bmp.kind === 'img') {
          const im = new Image();
          im.src = r.bmp.src;
          try { await im.decode(); } catch { /* shown anyway */ }
          if (sig.cancelled) return;
          setSrc(r.bmp.src);
        } else {
          const c = cvs.current;
          if (!c) return;
          const o = r.bmp.canvas;
          c.width = o.width; c.height = o.height;
          c.getContext('2d')!.drawImage(o, 0, 0);
        }
        setHas(true);
        onRatio(p, r.ratio);
      } catch (e) {
        if (!sig.cancelled && (e as { name?: string })?.name !== 'RenderingCancelledException') onFail(e);
      }
    }, 70);
    return () => { sig.cancelled = true; clearTimeout(t); sig.cancel?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, wpx, getBmp]);

  return (
    <div className={`absolute overflow-hidden ${has ? 'bg-white' : 'animate-pulse bg-[#262626]'}`} style={{ left, top, width: w, height: h }}>
      {native
        ? src && <img src={src} alt="" draggable={false} className="h-full w-full max-w-none" style={{ filter: filt }} />
        : <canvas ref={cvs} className="h-full w-full" style={{ filter: filt }} />}
      <AnnotLayer w={w} h={h} strokes={strokes} tool={tool} color={color} onChange={(s) => onStrokes(p, s)} />
    </div>
  );
});

export default function PdfReader() {
  const { id } = useParams();
  const nav = useNavigate();
  const bid = Number(id);
  const key = `book:${bid}`;
  const book = useCatalog((s) => s.books.find((b) => b.id === bid));
  const dl = useDownloads((s) => s.items[dlKey('book', bid)]);
  const addDl = useDownloads((s) => s.add);
  const { progress, bookmarks, setProgress, toggleBookmark, touch } = useLibrary();
  const { share, progress: shareProg } = useShareBook(book);

  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [err, setErr] = useState<string>();
  const [page, setPage] = useState(Math.max(1, progress[key]?.position ?? 1));
  const [zoom, setZoom] = useState(1);
  const [night, setNight] = useState(localStorage.getItem('sb_night') === '1');
  const [ui, setUi] = useState(true);
  const [sheet, setSheet] = useState<'jump' | 'marks' | 'menu' | null>(null);
  const [jumpVal, setJumpVal] = useState('');
  const [stage, setStage] = useState('Connecting…');
  const [tick, setTick] = useState(0);
  // native engine (Android PdfRenderer) is used for downloaded books; pdf.js for streaming / fallback
  const [engine, setEngine] = useState<'pdfjs' | 'native'>('pdfjs');
  const [npages, setNpages] = useState(0);
  const cache = useRef(new Map<string, HTMLCanvasElement>()); // rendered pdf.js pages (LRU)
  const imgCache = useRef(new Map<string, string>());
  const nativeFailed = useRef(false);

  // continuous-scroll layout
  const [cw, setCw] = useState(0);
  const [vis, setVis] = useState({ from: 1, to: 3 });
  const [started, setStarted] = useState(false);
  const [rv, setRv] = useState(0);
  const [def, setDef] = useState(1.414);
  const ratios = useRef<Record<number, number>>({});
  const pendingDelta = useRef(0);
  const inited = useRef(false);
  const rotated = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const zoomLbl = useRef<HTMLSpanElement>(null);
  const anchor = useRef<{ pg: number; fy: number; fx: number; mx: number; my: number } | null>(null);

  // chapters / roadmap
  const chapKey = `sb_chap3_${bid}`;
  const [cset, setCset] = useState<ChapterSet | undefined>(() => { try { return JSON.parse(localStorage.getItem(`sb_chap3_${bid}`) || 'null') ?? undefined; } catch { return undefined; } });
  const [chapBusy, setChapBusy] = useState(false);
  const [chapMsg, setChapMsg] = useState('Reading index…');
  const [offset, setOffsetState] = useState<number | undefined>(() => { const v = localStorage.getItem(`sb_off_${bid}`); return v === null ? undefined : Number(v); });
  const [roadmap, setRoadmap] = useState(false);
  const chapStarted = useRef(false);
  const setOffset = (n: number) => { setOffsetState(n); localStorage.setItem(`sb_off_${bid}`, String(n)); };

  // annotations
  const annotAll = useAnnot((s) => s.data[`book:${bid}`]);
  const setStrokes = useAnnot((s) => s.set);
  const [tool, setTool] = useState<Tool>(null);
  const [annotOn, setAnnotOn] = useState(false);
  const [pan, setPan] = useState(false);          // hand mode: scroll / zoom instead of drawing
  const [color, setColor] = useState(COLORS[0]);
  const redo = useRef<Record<number, Stroke[]>>({});
  const effTool: Tool = annotOn && !pan ? tool : null;

  const local = dl?.status === 'done';
  const native = engine === 'native';
  const ready = native ? npages > 0 : !!doc;
  const total = native ? npages : doc?.numPages ?? progress[key]?.total ?? 0;
  const marks = bookmarks[key] ?? [];

  // refs mirroring state for the native touch listeners
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const toolRef = useRef<Tool>(effTool); toolRef.current = effTool;
  const engineRef = useRef(engine); engineRef.current = engine;

  // ---------- open the document: streamed range requests from Telegram, or the downloaded file ----------
  useEffect(() => {
    if (!book) return;
    let dead = false;
    let d: PDFDocumentProxy | undefined;
    setErr(undefined);
    setDoc(undefined);
    setNpages(0);
    setStarted(false);
    inited.current = false;
    ratios.current = {};
    imgCache.current.clear();
    setStage('Connecting…');
    let usedNative = false;
    (async () => {
      try {
        if (local && dl && nativePdfAvailable() && !nativeFailed.current) {
          try {
            const { uri } = await Filesystem.getUri({ path: dl.path, directory: Directory.Data });
            const r = await NativePdf.open({ uri });
            if (dead) { void NativePdf.close(); return; }
            usedNative = true;
            if (r.ratio) setDef(r.ratio);
            setEngine('native');
            setNpages(r.pages);
            setPage((p) => Math.min(Math.max(1, p), r.pages));
            touch({ key, type: 'book', id: book.id, title: book.title, subtitle: book.subject, coverId: book.coverMsgId });
            return;
          } catch (e) {
            console.warn('native pdf failed, falling back to pdf.js', e);
            nativeFailed.current = true;
          }
        }
        setEngine('pdfjs');
        d = local && dl ? await openLocalPdf(await localUrl(dl)) : await openRemotePdfWarm(book.id, book.size, setStage, (e) => { if (!dead) setErr(`Could not load this book from Telegram (${e.message}). Check your connection and retry.`); });
        if (dead) { void d.destroy(); return; }
        try { const v = (await d.getPage(1)).getViewport({ scale: 1 }); setDef(v.height / v.width); } catch { /* keep default */ }
        if (dead) { void d.destroy(); return; }
        setDoc(d);
        setPage((p) => Math.min(Math.max(1, p), d!.numPages));
        touch({ key, type: 'book', id: book.id, title: book.title, subtitle: book.subject, coverId: book.coverMsgId });
      } catch (e) {
        if (!dead) setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => { dead = true; if (d) void d.destroy(); if (usedNative) void NativePdf.close().catch(() => undefined); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, local, tick]);

  // free cached page bitmaps when the document changes
  useEffect(() => () => { cache.current.forEach((c) => { c.width = 0; }); cache.current.clear(); }, [doc]);

  // watchdog: a stalled connection should show Retry instead of an endless loader
  useEffect(() => {
    if (ready || err) return;
    const t = setTimeout(() => setErr('This is taking too long. Check your connection and retry.'), local ? 40000 : 90000);
    return () => clearTimeout(t);
  }, [ready, err, tick, local]);

  // ---------- chapter list (unchanged behaviour) ----------
  useEffect(() => {
    if (!ready || chapStarted.current || cset) return;
    if (!local && !roadmap) return; // online books: only scan (reads the whole file) when the roadmap is opened
    chapStarted.current = true;
    let dead = false;
    let tmp: PDFDocumentProxy | undefined;
    const t = setTimeout(async () => {
      setChapBusy(true);
      try {
        let d = doc;
        if (!d && local && dl) { tmp = await openLocalPdf(await localUrl(dl)); d = tmp; }
        if (!d) return;
        const r = await loadChapters(d, setChapMsg);
        if (dead) return;
        setCset(r);
        if (r.src !== 'auto') { try { localStorage.setItem(chapKey, JSON.stringify(r)); } catch { /* ignore */ } }
      } catch (e) { console.warn('chapters failed', e); chapStarted.current = false; }
      finally { if (tmp) void tmp.destroy(); if (!dead) setChapBusy(false); }
    }, native ? 900 : 200);
    return () => { dead = true; clearTimeout(t); if (tmp) void tmp.destroy(); chapStarted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, doc, native, cset, roadmap, local]);

  useEffect(() => { const n = native ? npages : doc?.numPages; if (n) setProgress(key, page, n); }, [doc, native, npages, page, key, setProgress]);
  useEffect(() => { localStorage.setItem('sb_night', night ? '1' : '0'); }, [night]);

  // tell Buddy what is on screen
  useEffect(() => {
    screenCtx.set(async () => {
      let text = '';
      try {
        if (doc && !native) {
          const tc = await (await doc.getPage(page)).getTextContent();
          text = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ').slice(0, 3500);
        }
      } catch { /* ignore */ }
      return `The student is reading the book "${book?.title ?? ''}" (subject: ${book?.subject ?? ''}), page ${page} of ${total || '?'}.` + (text ? `\nText of this page:\n${text}` : '\n(The text of this page is not available.)');
    });
    return () => screenCtx.set(undefined);
  }, [doc, native, book, page, total]);

  // ---------- geometry ----------
  const baseW = Math.max(100, cw - SIDE * 2);
  const layout = useMemo(() => {
    const pw = baseW * zoom;
    const offs: number[] = new Array(total + 2).fill(0);
    let y = TOP;
    for (let p = 1; p <= total; p++) { offs[p] = y; y += pw * (ratios.current[p] ?? def) + GAP; }
    offs[total + 1] = y;
    return { pw, offs, H: y + BOTTOM, cwid: Math.max(cw, pw + SIDE * 2) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseW, zoom, total, def, rv, cw]);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const totalRef = useRef(total); totalRef.current = total;
  const ratioOf = (p: number) => ratios.current[p] ?? def;

  const pageAt = useCallback((y: number) => {
    const { offs } = layoutRef.current;
    let lo = 1, hi = Math.max(1, totalRef.current);
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }, []);

  const raf = useRef(0);

  // ---------- fast-scroll handle: drag the thumb on the right edge to move through the whole book ----------
  const thumb = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [dragOn, setDragOn] = useState(false);
  const [recent, setRecent] = useState(false);
  const recentT = useRef(0);
  const placeThumb = useCallback(() => {
    const s = scroller.current, t = thumb.current;
    if (!s || !t) return;
    const range = s.scrollHeight - s.clientHeight;
    const trk = Math.max(1, s.clientHeight - TRK_T - TRK_B - THUMB_H);
    const f = range > 0 ? clamp(s.scrollTop / range, 0, 1) : 0;
    t.style.transform = `translateY(${f * trk}px)`;
  }, []);
  const dragTo = (clientY: number) => {
    const s = scroller.current;
    if (!s) return;
    const r = s.getBoundingClientRect();
    const trk = Math.max(1, s.clientHeight - TRK_T - TRK_B - THUMB_H);
    const f = clamp((clientY - r.top - TRK_T - THUMB_H / 2) / trk, 0, 1);
    s.scrollTop = f * (s.scrollHeight - s.clientHeight);
  };

  const recompute = useCallback(() => {
    const s = scroller.current;
    placeThumb();
    if (!s || !totalRef.current || !inited.current) return;
    const top = s.scrollTop, vh = s.clientHeight;
    const a = pageAt(top - vh * 0.6), b = Math.min(pageAt(top + vh * 1.6), pageAt(top - vh * 0.6) + 6);
    setVis((v) => (v.from === a && v.to === b ? v : { from: a, to: b }));
    const cur = pageAt(top + vh * 0.3);
    setPage((c) => (c === cur ? c : cur));
  }, [pageAt, placeThumb]);
  const onScroll = () => {
    if (!dragging.current) { setRecent(true); window.clearTimeout(recentT.current); recentT.current = window.setTimeout(() => setRecent(false), 1400); }
    if (raf.current) return; raf.current = requestAnimationFrame(() => { raf.current = 0; recompute(); });
  };

  useLayoutEffect(() => { placeThumb(); }, [ui, recent, dragOn, ready, total, placeThumb]);

  // measure the viewport (also follows rotation)
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const ro = new ResizeObserver(() => { const w = s.clientWidth; setCw((o) => { if (o && o !== w) rotated.current = true; return w; }); });
    ro.observe(s);
    return () => ro.disconnect();
  }, []);

  // zoom committed: drop the CSS gesture transform and keep the pinched point under the fingers
  useLayoutEffect(() => {
    const c = content.current, s = scroller.current;
    if (!c || !s) return;
    c.style.transform = ''; c.style.transition = ''; c.style.willChange = '';
    s.style.overflow = '';
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const L = layout;
    const pg = clamp(a.pg, 1, Math.max(1, total));
    const y = L.offs[pg] + a.fy * L.pw * ratioOf(pg);
    const x = Math.max(SIDE, (L.cwid - L.pw) / 2) + a.fx * L.pw;
    s.scrollTop = y - a.my;
    s.scrollLeft = x - a.mx;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // first layout: jump to the saved page; later: compensate for pages that turned out taller/shorter than assumed
  useLayoutEffect(() => {
    const s = scroller.current;
    if (!s) return;
    if (!inited.current) {
      if (!ready || !cw || !total) return;
      inited.current = true;
      s.scrollTop = Math.max(0, layout.offs[clamp(page, 1, total)] - 10);
      setStarted(true);
      recompute();
      return;
    }
    if (rotated.current) { rotated.current = false; s.scrollTop = Math.max(0, layout.offs[clamp(page, 1, total)] - 10); }
    else if (pendingDelta.current) { s.scrollTop += pendingDelta.current; }
    pendingDelta.current = 0;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, ready, recompute]);

  const onRatio = useCallback((p: number, r: number) => {
    const old = ratios.current[p] ?? undefined;
    const cur = old ?? defRef.current;
    if (Math.abs(r - cur) < 0.004) { if (old === undefined) ratios.current[p] = cur; return; }
    ratios.current[p] = r;
    if (p < pageRef.current) pendingDelta.current += layoutRef.current.pw * (r - cur);
    setRv((v) => v + 1);
  }, []);
  const defRef = useRef(def); defRef.current = def;
  const pageRef = useRef(page); pageRef.current = page;

  const onFail = useCallback((e: unknown) => {
    if (engineRef.current === 'native') {
      if (nativeFailed.current) return;
      console.warn('native render failed, using pdf.js', e);
      nativeFailed.current = true; // reopen the whole book with the pdf.js engine
      setEngine('pdfjs');
      setTick((x) => x + 1);
    } else setErr(String((e as Error)?.message ?? e));
  }, []);

  // page bitmap provider for the two engines
  const getBmp = useCallback<GetBmp>(async (p, wpx, sig) => {
    const k = `${p}@${wpx}`;
    if (engineRef.current === 'native') {
      let src = imgCache.current.get(k);
      let ratio: number | undefined;
      if (!src) {
        const r = await NativePdf.renderPage({ page: p, width: wpx });
        if (sig.cancelled) return;
        src = Capacitor.convertFileSrc(r.uri);
        ratio = r.height / r.width;
        for (const ok of [...imgCache.current.keys()]) if (ok.startsWith(`${p}@`)) imgCache.current.delete(ok);
        imgCache.current.set(k, src);
        while (imgCache.current.size > 60) imgCache.current.delete(imgCache.current.keys().next().value as string);
      }
      return { bmp: { kind: 'img', src }, ratio: ratio ?? ratioOfRef.current(p) };
    }
    if (!doc) return;
    const hit = cache.current.get(k);
    if (hit) { cache.current.delete(k); cache.current.set(k, hit); return { bmp: { kind: 'canvas', canvas: hit }, ratio: hit.height / hit.width }; }
    const pg = await doc.getPage(p);
    if (sig.cancelled) return;
    const base = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: wpx / base.width });
    const off = document.createElement('canvas');
    off.width = Math.round(vp.width); off.height = Math.round(vp.height);
    const task = pg.render({ canvasContext: off.getContext('2d')!, viewport: vp });
    sig.cancel = () => task.cancel();
    await task.promise;
    if (sig.cancelled) { off.width = 0; return; }
    cache.current.set(k, off);
    let px = 0;
    cache.current.forEach((c) => { px += c.width * c.height; });
    while (px > 14_000_000 && cache.current.size > 3) {
      const old = cache.current.keys().next().value as string;
      const c = cache.current.get(old);
      if (c) { px -= c.width * c.height; c.width = 0; }
      cache.current.delete(old);
    }
    return { bmp: { kind: 'canvas', canvas: off }, ratio: base.height / base.width };
  }, [doc, npages, engine]);
  const ratioOfRef = useRef(ratioOf); ratioOfRef.current = ratioOf;

  // ---------- touch: smooth pinch zoom (CSS transform while fingers are down, one crisp re-render on release), double tap, tap ----------
  const anchorAt = (ox: number, oy: number) => {
    const L = layoutRef.current;
    const pg = pageAt(oy);
    const h = L.pw * (ratios.current[pg] ?? defRef.current);
    return { pg, fy: (oy - L.offs[pg]) / h, fx: (ox - Math.max(SIDE, (L.cwid - L.pw) / 2)) / L.pw };
  };

  useEffect(() => {
    const s = scroller.current, c = content.current;
    if (!s || !c) return;
    type Pz = { d: number; z0: number; ox: number; oy: number; sl: number; st: number; sc: number; mx: number; my: number; a: { pg: number; fy: number; fx: number } };
    let pz: Pz | null = null;
    let multi = false;
    let tapS: { x: number; y: number; t: number } | null = null;
    let last = { t: 0, x: 0, y: 0 };
    let single = 0;
    let anim = 0;
    const rel = (x: number, y: number) => { const r = s.getBoundingClientRect(); return [x - r.left, y - r.top] as const; };
    const mid = (e: TouchEvent) => rel((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

    const begin = (mx: number, my: number, d: number): Pz => {
      const ox = s.scrollLeft + mx, oy = s.scrollTop + my;
      s.style.overflow = 'hidden';
      c.style.transition = '';
      c.style.willChange = 'transform';
      c.style.transformOrigin = `${ox}px ${oy}px`;
      return { d, z0: zoomRef.current, ox, oy, sl: s.scrollLeft, st: s.scrollTop, sc: 1, mx, my, a: anchorAt(ox, oy) };
    };
    const finish = (p: Pz) => {
      const nz = +clamp(p.z0 * p.sc, ZMIN, ZMAX).toFixed(3);
      if (Math.abs(nz - zoomRef.current) < 0.004) {
        c.style.transform = ''; c.style.willChange = ''; s.style.overflow = '';
        return;
      }
      anchor.current = { ...p.a, mx: p.mx, my: p.my };
      setZoom(nz);
    };

    const onStart = (e: TouchEvent) => {
      if (toolRef.current) return;
      window.clearTimeout(anim);
      if (e.touches.length >= 2) {
        multi = true; tapS = null; window.clearTimeout(single);
        if (!pz) { const [mx, my] = mid(e); pz = begin(mx, my, dist(e)); }
      } else if (!multi) tapS = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    };
    const onMove = (e: TouchEvent) => {
      if (!pz || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      const sc = clamp(dist(e) / pz.d, ZMIN / pz.z0, ZMAX / pz.z0);
      const [mx, my] = mid(e);
      c.style.transform = `translate(${mx + pz.sl - pz.ox}px, ${my + pz.st - pz.oy}px) scale(${sc})`;
      pz.sc = sc; pz.mx = mx; pz.my = my;
      if (zoomLbl.current) zoomLbl.current.textContent = `${Math.round(pz.z0 * sc * 100)}%`;
    };
    const onEnd = (e: TouchEvent) => {
      if (pz && e.touches.length < 2) { const p = pz; pz = null; finish(p); }
      if (e.touches.length > 0) return;
      const t = tapS; tapS = null;
      const was = multi; multi = false;
      if (was || !t || toolRef.current) return;
      const x = e.changedTouches[0].clientX, y = e.changedTouches[0].clientY, now = Date.now();
      if (Math.hypot(x - t.x, y - t.y) > 10 || now - t.t > 300) return;
      if (now - last.t < 300 && Math.hypot(x - last.x, y - last.y) < 40) {
        last.t = 0; window.clearTimeout(single);
        const [mx, my] = rel(x, y);
        const target = zoomRef.current < 1.6 ? 2.5 : 1;
        const p = begin(mx, my, 1);
        const k = target / zoomRef.current;
        requestAnimationFrame(() => { c.style.transition = 'transform .22s ease-out'; c.style.transform = `scale(${k})`; });
        anim = window.setTimeout(() => { anchor.current = { ...p.a, mx, my }; setZoom(target); }, 240);
      } else {
        last = { t: now, x, y };
        window.clearTimeout(single);
        single = window.setTimeout(() => setUi((u) => !u), 280);
      }
    };
    const onCancel = () => { if (pz) { const p = pz; pz = null; finish(p); } multi = false; tapS = null; };

    s.addEventListener('touchstart', onStart, { passive: true });
    s.addEventListener('touchmove', onMove, { passive: false });
    s.addEventListener('touchend', onEnd, { passive: true });
    s.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      s.removeEventListener('touchstart', onStart); s.removeEventListener('touchmove', onMove);
      s.removeEventListener('touchend', onEnd); s.removeEventListener('touchcancel', onCancel);
      window.clearTimeout(single); window.clearTimeout(anim);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageAt]);

  // ---------- actions ----------
  const go = (p: number, smooth = false) => {
    if (!total) return;
    const q = clamp(p, 1, total);
    scroller.current?.scrollTo({ top: Math.max(0, layout.offs[q] - 12), behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) setPage(q);
  };
  const zoomBy = (f: number) => {
    const s = scroller.current;
    if (!s) return;
    const nz = +clamp(zoom * f, ZMIN, ZMAX).toFixed(3);
    if (nz === zoom) return;
    const mx = s.clientWidth / 2, my = s.clientHeight / 2;
    anchor.current = { ...anchorAt(s.scrollLeft + mx, s.scrollTop + my), mx, my };
    setZoom(nz);
  };

  const rows = resolveChapters(cset, offset, total);
  const curRow = rows.reduce<(typeof rows)[number] | undefined>((a, r) => (r.page <= page ? r : a), undefined);
  const strokes = annotAll?.[page] ?? NONE;
  const pickTool = (t: Tool) => { setPan(false); setTool((c) => (c === t ? null : t)); };
  const undo = () => { if (!strokes.length) return; (redo.current[page] ??= []).push(strokes[strokes.length - 1]); setStrokes(key, page, strokes.slice(0, -1)); };
  const redoFn = () => { const r = redo.current[page]; if (!r?.length) return; setStrokes(key, page, [...strokes, r.pop()!]); };
  const toggleAnnot = () => { setAnnotOn((v) => !v); setTool((t) => (annotOn ? null : t ?? 'pen')); setPan(false); setUi(true); };
  const onStrokes = useCallback((p: number, s: Stroke[]) => { redo.current[p] = []; setStrokes(key, p, s); }, [key, setStrokes]);

  if (!book) return <div className="flex h-full items-center justify-center bg-bg text-sub">Loading…</div>;
  const dp = dl ? Math.round((dl.bytes / Math.max(1, dl.size)) * 100) : 0;

  const filt = night ? 'invert(1) hue-rotate(180deg)' : undefined;
  const tbtn = (on: boolean) => `press flex h-10 w-10 items-center justify-center rounded-full ${on ? 'bg-accent text-white' : 'text-white/90'}`;
  const pill = 'rounded-full bg-card/95 shadow-lg backdrop-blur';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const pages: number[] = [];
  if (ready && started) for (let p = Math.max(1, vis.from); p <= Math.min(total, vis.to); p++) pages.push(p);

  return (
    <div className="relative h-full overflow-hidden bg-[#141414]">
      <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-auto" style={{ touchAction: effTool ? 'none' : 'pan-x pan-y', overscrollBehavior: 'contain' }}>
        <div className="relative" style={{ width: layout.cwid, height: layout.H }}>
          <div ref={content} className="absolute left-0 top-0" style={{ width: 0, height: 0 }}>
            {pages.map((p) => {
              const r = ratios.current[p] ?? def;
              const wpx = Math.min(Math.ceil((layout.pw * dpr) / 64) * 64, Math.floor(Math.sqrt(MAXPX / r)));
              return (
                <PageView key={`${engine}${p}`} p={p} left={Math.max(SIDE, (layout.cwid - layout.pw) / 2)} top={layout.offs[p]} w={layout.pw} h={layout.pw * r}
                  wpx={wpx} native={native} getBmp={getBmp} onRatio={onRatio} onFail={onFail} filt={filt}
                  strokes={annotAll?.[p] ?? NONE} tool={effTool} color={color} onStrokes={onStrokes} />
              );
            })}
          </div>
        </div>
      </div>

      {/* loading: a slim bar and a small spinner, no card */}
      {!ready && !err && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-[2px] overflow-hidden bg-white/5"><div className="sb-slide h-full w-1/3 bg-tint" /></div>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/10 border-t-tint" />
            <div className="text-xs text-sub">{stage}</div>
          </div>
        </>
      )}
      {err && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center px-8 text-center">
          <div className="rounded-lg bg-card p-4">
            <p className="text-sm text-red-300">{err}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => { setErr(undefined); setTick((t) => t + 1); }} className="press flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold"><RefreshCw size={16} /> Retry</button>
              {!local && !dl && <button onClick={() => addDl('book', book.id, book.title, book.size)} className="press flex h-10 items-center gap-2 rounded-lg bg-chip px-4 text-sm font-semibold"><Download size={16} /> Download</button>}
            </div>
          </div>
        </div>
      )}

      {/* top-left pill: back + roadmap */}
      {ui && (
        <div className={`absolute left-2 top-2 z-10 flex items-center gap-0.5 p-1 ${pill}`}>
          <button onClick={() => nav(-1)} className={tbtn(false)} aria-label="Back"><ChevronLeft size={22} /></button>
          <button onClick={() => setRoadmap(true)} className={tbtn(false)} aria-label="Roadmap"><MapIcon size={20} /></button>
        </div>
      )}
      {/* top-right pill: annotate, bookmark, more */}
      {ui && (
        <div className={`absolute right-2 top-2 z-10 flex items-center gap-0.5 p-1 ${pill}`}>
          <button onClick={toggleAnnot} className={tbtn(annotOn)} aria-label="Annotate"><PenLine size={19} /></button>
          <button onClick={() => toggleBookmark(key, page)} className={tbtn(false)} aria-label="Bookmark">
            <Bookmark size={19} className={marks.includes(page) ? 'fill-tint text-tint' : ''} />
          </button>
          <button onClick={() => setSheet('menu')} className={tbtn(false)} aria-label="More"><MoreHorizontal size={21} /></button>
        </div>
      )}

      {/* right edge: chapter tab + previous / next page */}
      {ui && curRow && !annotOn && (
        <button onClick={() => setRoadmap(true)} className="absolute right-6 top-[30%] z-10 rounded-l-lg bg-card/90 px-1.5 py-3 text-[10px] font-semibold text-tint shadow"
          style={{ writingMode: 'vertical-rl', maxHeight: '28%' }}>
          <span className="block truncate">{curRow.n}. {curRow.title}</span>
        </button>
      )}
      {ui && chapBusy && !rows.length && <div className="absolute right-3 top-[70px] z-10 rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-sub">{chapMsg}</div>}
      {ui && !annotOn && (
        <div className={`absolute right-7 top-[58%] z-10 flex flex-col p-0.5 ${pill}`}>
          <button onClick={() => go(page - 1, true)} className={tbtn(false)} aria-label="Previous page"><ChevronUp size={22} /></button>
          <button onClick={() => go(page + 1, true)} className={tbtn(false)} aria-label="Next page"><ChevronDown size={22} /></button>
        </div>
      )}

      {/* fast-scroll handle: press and drag up/down to scrub through the whole PDF */}
      {!annotOn && ready && total > 1 && (ui || recent || dragOn) && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[11] w-0">
          <div className="absolute right-0 w-0" style={{ top: TRK_T }}>
            <div ref={thumb} className="pointer-events-auto absolute right-0 top-0 flex items-center justify-end" style={{ height: THUMB_H, width: 44, touchAction: 'none' }}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; setDragOn(true); setRecent(true); dragTo(e.clientY); }}
              onPointerMove={(e) => { if (dragging.current) { e.preventDefault(); dragTo(e.clientY); } }}
              onPointerUp={() => { dragging.current = false; setDragOn(false); window.clearTimeout(recentT.current); recentT.current = window.setTimeout(() => setRecent(false), 1400); }}
              onPointerCancel={() => { dragging.current = false; setDragOn(false); }}>
              {dragOn && (
                <div className="absolute right-12 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-white shadow-lg">{page} / {total}</div>
              )}
              <div className={`mr-0.5 flex h-[52px] w-[14px] items-center justify-center rounded-full shadow-lg transition-colors ${dragOn ? 'bg-accent' : 'bg-card/95 backdrop-blur'}`}>
                <div className="flex flex-col gap-[3px]"><span className="h-px w-[6px] bg-white/60" /><span className="h-px w-[6px] bg-white/60" /><span className="h-px w-[6px] bg-white/60" /></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* bottom-left: page and zoom */}
      {ui && !annotOn && (
        <button onClick={() => { setJumpVal(String(page)); setSheet('jump'); }} className={`press absolute bottom-3 left-2 z-10 flex h-12 items-center gap-3 px-4 ${pill}`}>
          <span className="flex min-w-[28px] flex-col items-center text-[13px] font-semibold leading-none">
            <span>{page}</span>
            <span className="my-[3px] h-px w-full bg-white/30" />
            <span className="text-sub">{total || '–'}</span>
          </span>
          <span className="h-6 w-px bg-white/15" />
          <span ref={zoomLbl} className="min-w-[38px] text-center text-[15px] font-bold">{Math.round(zoom * 100)}%</span>
        </button>
      )}

      {/* annotation panel */}
      {annotOn && (
        <div className="absolute inset-x-2 bottom-3 z-10 rounded-3xl bg-card/95 p-2.5 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center">
              <button onClick={undo} className={tbtn(false)} aria-label="Undo"><Undo2 size={19} /></button>
              <button onClick={redoFn} className={tbtn(false)} aria-label="Redo"><Redo2 size={19} /></button>
              <button onClick={() => setPan((v) => !v)} className={tbtn(pan)} aria-label="Scroll and zoom"><Hand size={19} /></button>
            </div>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button key={c} onClick={() => { setColor(c); setPan(false); if (tool === 'eraser' || !tool) setTool('pen'); }} aria-label={`Colour ${c}`}
                  className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-white' : 'border-white/20'}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button onClick={() => pickTool('pen')} className={tbtn(!pan && tool === 'pen')} aria-label="Pen"><Pencil size={19} /></button>
              <button onClick={() => pickTool('hl')} className={tbtn(!pan && tool === 'hl')} aria-label="Highlighter"><Highlighter size={19} /></button>
              <button onClick={() => pickTool('eraser')} className={tbtn(!pan && tool === 'eraser')} aria-label="Eraser"><Eraser size={19} /></button>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold text-sub">{page}/{total || '–'}</span>
              <button onClick={toggleAnnot} className="press flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold"><Check size={16} /> Done</button>
            </div>
          </div>
        </div>
      )}

      {sheet && (
        <div className="absolute inset-0 z-20 flex items-end bg-black/60" onClick={() => setSheet(null)}>
          <div className="w-full rounded-t-xl bg-card p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold">{sheet === 'jump' ? 'Go to page' : sheet === 'marks' ? 'Bookmarks' : 'Options'}</h3>
              <button onClick={() => setSheet(null)} className="rounded-lg bg-chip p-2"><X size={16} /></button>
            </div>
            {sheet === 'jump' && (
              <div className="flex gap-2">
                <input type="number" inputMode="numeric" value={jumpVal} onChange={(e) => setJumpVal(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-chip px-4 py-3 text-base outline-none" />
                <button onClick={() => { go(Number(jumpVal) || page); setSheet(null); }} className="rounded-lg bg-accent px-6 font-bold">Go</button>
              </div>
            )}
            {sheet === 'marks' && (marks.length ? (
              <div className="flex flex-wrap gap-2">
                {marks.map((m) => <button key={m} onClick={() => { go(m); setSheet(null); }} className="rounded-lg bg-chip px-4 py-2 text-sm font-semibold">Page {m}</button>)}
              </div>
            ) : <p className="text-sm text-sub">No bookmarks yet. Tap the bookmark icon at the top to add one.</p>)}
            {sheet === 'menu' && (
              <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
                <button onClick={() => { setRoadmap(true); setSheet(null); }} className="press flex h-12 items-center gap-2 rounded-lg bg-chip px-3"><MapIcon size={18} /> Roadmap</button>
                <button onClick={() => setSheet('marks')} className="press flex h-12 items-center gap-2 rounded-lg bg-chip px-3"><ListOrdered size={18} /> Bookmarks</button>
                <button onClick={() => setNight(!night)} className="press flex h-12 items-center gap-2 rounded-lg bg-chip px-3">{night ? <Sun size={18} /> : <Moon size={18} />} {night ? 'Light page' : 'Night page'}</button>
                <button onClick={share} className="press flex h-12 items-center gap-2 rounded-lg bg-chip px-3"><Share2 size={18} /> {shareProg !== null ? `${local ? '…' : Math.round(shareProg * 100) + '%'}` : 'Share'}</button>
                <button onClick={() => zoomBy(1 / 1.25)} className="press flex h-12 items-center gap-2 rounded-lg bg-chip px-3"><ZoomOut size={18} /> Zoom out</button>
                <button onClick={() => zoomBy(1.25)} className="press flex h-12 items-center gap-2 rounded-lg bg-chip px-3"><ZoomIn size={18} /> Zoom in</button>
                {local
                  ? <div className="flex h-12 items-center gap-2 rounded-lg bg-chip px-3 text-tint"><Check size={18} /> Downloaded</div>
                  : <button onClick={() => addDl('book', book.id, book.title, book.size)} className="press flex h-12 items-center gap-2 rounded-lg bg-chip px-3"><Download size={18} /> {dl ? `${dp}%` : 'Download'}</button>}
              </div>
            )}
          </div>
        </div>
      )}

      {roadmap && (
        <Roadmap rows={rows} set={cset} loading={chapBusy} msg={chapMsg} onRescan={() => { localStorage.removeItem(chapKey); setCset(undefined); }} page={page} total={total} offset={offset ?? cset?.off ?? 0} setOffset={setOffset}
          onGo={(p) => go(p)} onClose={() => setRoadmap(false)} />
      )}
    </div>
  );
}
