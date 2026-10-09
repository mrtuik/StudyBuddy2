import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import bigInt from 'big-integer';
import { getClient, getChannelPeer, checkConnection } from './client';
import { delMeta, getMeta, setMeta } from '../db/idb';

export const CHUNK = 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Request timed out')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

export async function getMessage(id: number): Promise<Api.Message> {
  const c = await getClient();
  const peer = await getChannelPeer();
  const r = await c.getMessages(peer, { ids: [id] });
  const m = r[0];
  if (!(m instanceof Api.Message)) throw new Error('Message not found in channel');
  return m;
}

/* ---------- covers (photo messages), cached in IndexedDB ---------- */
const coverMem = new Map<number, string>();
let coverChain: Promise<unknown> = Promise.resolve();

export function coverUrl(id: number): Promise<string | undefined> {
  const hit = coverMem.get(id);
  if (hit) return Promise.resolve(hit);
  const p = coverChain.then(async () => {
    let data = await getMeta<Uint8Array>(`cover:${id}`);
    if (!data) {
      const m = await getMessage(id);
      const c = await getClient();
      const buf = await c.downloadMedia(m, {});
      if (!buf || typeof buf === 'string') return undefined;
      data = new Uint8Array(buf as Uint8Array);
      await setMeta(`cover:${id}`, data);
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
    coverMem.set(id, url);
    return url;
  });
  coverChain = p.catch(() => undefined);
  return p.catch(() => undefined);
}


/* ---------- lesson thumbnails: Telegram's own preview of the video, cached in IndexedDB ---------- */
const thumbMem = new Map<number, string>();
export function lessonThumbUrl(id: number): Promise<string | undefined> {
  const hit = thumbMem.get(id);
  if (hit) return Promise.resolve(hit);
  const p = coverChain.then(async () => {
    const key = `thumb:${id}`;
    let data = await getMeta<Uint8Array>(key);
    if (!data) {
      const m = await getMessage(id);
      const doc = m.media instanceof Api.MessageMediaDocument && m.media.document instanceof Api.Document ? m.media.document : undefined;
      const thumbs = doc?.thumbs ?? [];
      let idx = -1, best = -1;
      thumbs.forEach((t, i) => { if (t instanceof Api.PhotoSize && t.size > best) { best = t.size; idx = i; } });
      if (idx < 0 && thumbs.length) idx = thumbs.length - 1;   // only a tiny stripped preview exists
      if (idx < 0) data = new Uint8Array(0);                    // this video really has no preview
      else {
        const c = await getClient();
        const buf = await c.downloadMedia(m, { thumb: idx });
        if (!buf || typeof buf === 'string') return undefined;
        data = new Uint8Array(buf as Uint8Array);
      }
      await setMeta(key, data);
    }
    if (!data.length) return undefined;
    const url = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
    thumbMem.set(id, url);
    return url;
  });
  coverChain = p.catch(() => undefined);
  return p.catch(() => undefined);
}

/* ---------- ranged reads (PDF + video streaming) ---------- */
const MAX_CACHED_CHUNKS = 40; // ~40MB in memory
const chunkCache = new Map<string, Uint8Array>();
const inflight = new Map<string, Promise<void>>();
const mediaCache = new Map<number, Api.TypeMessageMedia>();

const ck = (id: number, i: number) => `${id}:${i}`;
const pk = (id: number, size: number, i: number) => `c1:${id}:${size}:${i}`;
const expLen = (size: number, i: number) => Math.min(CHUNK, size - i * CHUNK);

/* ---------- persistent PDF cache: every chunk read for a PDF is kept in IndexedDB (LRU, capped) ---------- */
const CACHE_CAP = 500 * 1024 * 1024;
const persistIds = new Set<number>();
/** Call for PDFs: their chunks are saved so the next opening needs no network. (Videos are not persisted.) */
export const markPersist = (id: number) => { persistIds.add(id); };
/** Videos: only the first 3 chunks and the last one (start of playback + moov atom) are kept, so replays start instantly without filling storage. */
const headIds = new Set<number>();
const keep = (id: number, i: number, lastIdx: number) => persistIds.has(id) || (headIds.has(id) && (i < 3 || i >= lastIdx));

/** Connect and load the start of a video before Play is tapped. Never throws. */
export function warmVideo(id: number, size: number) {
  if (!size) return;
  headIds.add(id);
  const lastIdx = Math.floor((size - 1) / CHUNK);
  void Promise.all([ensureChunks(id, size, 0, Math.min(2, lastIdx)), lastIdx > 2 ? ensureChunks(id, size, lastIdx, lastIdx) : Promise.resolve()]).catch(() => undefined);
}

type CIdx = Record<string, [number, number]>; // key -> [bytes, lastUsed]
let cidx: CIdx | undefined;
let cidxLoad: Promise<CIdx> | undefined;
let cidxTimer: ReturnType<typeof setTimeout> | undefined;
function loadIdx(): Promise<CIdx> {
  cidxLoad ??= getMeta<CIdx>('chunkindex').then((v) => (cidx = v ?? {})).catch(() => (cidx = {}));
  return cidxLoad;
}
function scheduleIdx() {
  if (cidxTimer) return;
  cidxTimer = setTimeout(async () => {
    cidxTimer = undefined;
    const idx = cidx;
    if (!idx) return;
    let total = Object.values(idx).reduce((n, v) => n + v[0], 0);
    if (total > CACHE_CAP) {
      const keys = Object.keys(idx).sort((x, y) => idx[x][1] - idx[y][1]);
      for (const k of keys) {
        if (total <= CACHE_CAP * 0.85) break;
        total -= idx[k][0];
        delete idx[k];
        await delMeta(k).catch(() => undefined);
      }
    }
    await setMeta('chunkindex', idx).catch(() => undefined);
  }, 2000);
}
async function saveChunk(key: string, data: Uint8Array) {
  try {
    await setMeta(key, data);
    (await loadIdx())[key] = [data.length, Date.now()];
    scheduleIdx();
  } catch { /* storage full: still works from memory */ }
}

async function getMedia(id: number, fresh = false): Promise<Api.TypeMessageMedia> {
  let m = fresh ? undefined : mediaCache.get(id);
  if (!m) {
    const msg = await getMessage(id);
    if (!msg.media) throw new Error('No media in message');
    m = msg.media;
    mediaCache.set(id, m);
  }
  return m;
}

// One cached direct-GetFile fetcher per message (same method the fast download uses: DC migration, flood-wait and retries included).
const fetchers = new Map<number, Promise<(offset: number) => Promise<Uint8Array>>>();
function getFetcher(id: number, fresh = false) {
  if (fresh) fetchers.delete(id);
  let f = fetchers.get(id);
  if (!f) {
    f = (async () => makeFetcher(await getClient(), await getMedia(id, fresh), CHUNK))();
    fetchers.set(id, f);
    f.catch(() => fetchers.delete(id));
  }
  return f;
}

async function downloadRun(id: number, size: number, a: number, b: number, lastIdx: number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fetchAt = await getFetcher(id, attempt > 0);
      let next = a;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i > b) return;
          const data = await fetchAt(i * CHUNK);
          if (data.length !== expLen(size, i)) throw new Error('Incomplete chunk from Telegram');
          chunkCache.set(ck(id, i), data);
          if (keep(id, i, lastIdx)) void saveChunk(pk(id, size, i), data);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, b - a + 1) }, worker));
      return;
    } catch (e) {
      if (attempt === 1) throw e;
      fetchers.delete(id);
      mediaCache.delete(id);
      await checkConnection().catch(() => undefined);
    }
  }
}

async function loadRun(id: number, size: number, a: number, b: number, lastIdx: number) {
  const idxs = Array.from({ length: b - a + 1 }, (_, k) => a + k);
  const elig = idxs.filter((i) => keep(id, i, lastIdx));
  const hit = new Set<number>();
  if (elig.length) {
    await loadIdx().catch(() => undefined);
    const got = await Promise.all(elig.map((i) => getMeta<Uint8Array>(pk(id, size, i)).catch(() => undefined)));
    elig.forEach((i, k) => {
      const d = got[k];
      if (d && d.length === expLen(size, i)) {
        chunkCache.set(ck(id, i), d);
        hit.add(i);
        const e = cidx?.[pk(id, size, i)];
        if (e) { e[1] = Date.now(); scheduleIdx(); }
      }
    });
  }
  const miss = idxs.filter((i) => !hit.has(i));
  let s = 0;
  while (s < miss.length) {
    let e = s;
    while (e + 1 < miss.length && miss[e + 1] === miss[e] + 1) e++;
    await downloadRun(id, size, miss[s], miss[e], lastIdx);
    s = e + 1;
  }
}

/** Makes sure chunks [first..last] are in memory. Concurrent callers share in-flight downloads. */
async function ensureChunks(id: number, size: number, first: number, last: number) {
  const lastIdx = Math.floor((size - 1) / CHUNK);
  const waits: Promise<void>[] = [];
  const todo: number[] = [];
  for (let i = first; i <= last; i++) {
    if (chunkCache.has(ck(id, i))) continue;
    const f = inflight.get(ck(id, i));
    if (f) waits.push(f); else todo.push(i);
  }
  let s = 0;
  while (s < todo.length) {
    let e = s;
    while (e + 1 < todo.length && todo[e + 1] === todo[e] + 1) e++;
    const a = todo[s], b = todo[e];
    const p = loadRun(id, size, a, b, lastIdx).finally(() => { for (let i = a; i <= b; i++) inflight.delete(ck(id, i)); });
    for (let i = a; i <= b; i++) inflight.set(ck(id, i), p);
    waits.push(p);
    s = e + 1;
  }
  await Promise.all(waits);
}

/** Returns aligned data covering [begin, end). `start` is the byte offset of data[0]. */
export async function readRange(id: number, size: number, begin: number, end: number) {
  const first = Math.floor(begin / CHUNK);
  const last = Math.floor((Math.min(end, size) - 1) / CHUNK);
  await ensureChunks(id, size, first, last);

  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = first; i <= last; i++) {
    const part = chunkCache.get(ck(id, i));
    if (!part) throw new Error('Chunk missing');
    parts.push(part);
    total += part.length;
  }
  const data = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }

  // trim memory cache (oldest first) but never the chunks we just served
  if (chunkCache.size > MAX_CACHED_CHUNKS) {
    for (const key of chunkCache.keys()) {
      if (chunkCache.size <= MAX_CACHED_CHUNKS) break;
      const [kid, ki] = key.split(':').map(Number);
      if (kid === id && ki >= first && ki <= last) continue;
      chunkCache.delete(key);
    }
  }
  return { start: first * CHUNK, data };
}

/** Quietly loads the next few chunks after `afterByte` so page turns do not wait on the network. */
export function readAhead(id: number, size: number, afterByte: number, count = 3) {
  if (inflight.size > 3) return;
  const lastIdx = Math.floor((size - 1) / CHUNK);
  const first = Math.floor(afterByte / CHUNK) + 1;
  const last = Math.min(lastIdx, first + count - 1);
  if (first > last) return;
  void ensureChunks(id, size, first, last).catch(() => undefined);
}

/** Warm up a PDF before the reader opens: message lookup + header chunk + xref (tail) chunk. Never throws. */
export async function prefetchPdf(id: number, size: number) {
  if (!size) return;
  markPersist(id);
  try {
    const lastIdx = Math.floor((size - 1) / CHUNK);
    await Promise.all([ensureChunks(id, size, 0, 0), ensureChunks(id, size, lastIdx, lastIdx)]);
  } catch { /* best effort */ }
}

/* ---------- sequential download (slow but safe) ---------- */
export async function downloadChunks(
  id: number,
  offset: number,
  onChunk: (data: Uint8Array) => Promise<void>,
  shouldStop: () => boolean,
) {
  const c = await getClient();
  const media = await getMedia(id, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const it = (c.iterDownload({ file: media as any, offset: bigInt(offset), requestSize: CHUNK }) as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  try {
    for (;;) {
      if (shouldStop()) break;
      const r = await withTimeout(it.next(), 45000);
      if (r.done) break;
      await onChunk(new Uint8Array(r.value));
    }
  } finally {
    Promise.resolve(it.return?.()).catch(() => undefined);
  }
}

/* ---------- fast download: direct GetFile requests, several in flight, written in order ---------- */
export const DL_CHUNK = 1024 * 1024;
const FIRST_DATA_MS = 15000;

async function makeFetcher(c: TelegramClient, media: Api.TypeMessageMedia, limit = DL_CHUNK) {
  if (!(media instanceof Api.MessageMediaDocument) || !(media.document instanceof Api.Document)) throw new Error('Message has no document');
  const doc = media.document;
  const location = new Api.InputDocumentFileLocation({ id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference, thumbSize: '' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyC = c as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let send: (r: any) => Promise<any> = (r) => c.invoke(r);
  const useDc = async (dc: number) => { const s = await withTimeout<any>(anyC._borrowExportedSender(dc), 15000); send = (r) => s.send(r); };
  if (doc.dcId && doc.dcId !== c.session.dcId) { try { await useDc(doc.dcId); } catch { /* stay on home DC */ } }

  return async (offset: number): Promise<Uint8Array> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await withTimeout(send(new Api.upload.GetFile({ location, offset: bigInt(offset), limit })), 30000);
        if (!res?.bytes) throw new Error('Unexpected response from Telegram');
        return new Uint8Array(res.bytes);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        const mig = /FILE_MIGRATE_(\d+)/.exec(msg);
        const flood = /FLOOD_WAIT_(\d+)/.exec(msg);
        if (mig && attempt < 4) { await useDc(Number(mig[1])); continue; }
        if (flood && attempt < 6) { await sleep((Number(flood[1]) + 1) * 1000); continue; }
        if (attempt >= 3) throw e;
        await sleep(500 * (attempt + 1));
      }
    }
  };
}

async function downloadDirect(
  id: number, offset: number, size: number,
  onWrite: (data: Uint8Array) => Promise<void>, shouldStop: () => boolean, parallel: number,
  onStage?: (s: string) => void,
) {
  const c = await getClient();
  onStage?.('Requesting file…');
  const fetchAt = await makeFetcher(c, await getMedia(id, true));
  const total = Math.ceil(size / DL_CHUNK);
  let nextFetch = Math.floor(offset / DL_CHUNK);
  let nextWrite = nextFetch;
  const ready = new Map<number, Uint8Array>();
  let failed: unknown;
  let aborted = false;
  let gotAny = false;
  const t0 = Date.now();

  const worker = async () => {
    while (!failed && !aborted && !shouldStop()) {
      if (nextFetch >= total) return;
      if (nextFetch - nextWrite >= parallel * 2) { await sleep(20); continue; }
      const i = nextFetch++;
      try { ready.set(i, await fetchAt(i * DL_CHUNK)); gotAny = true; } catch (e) { failed = e; return; }
    }
  };
  for (let w = 0; w < parallel; w++) void worker();

  let batch: Uint8Array[] = [];
  let lastFlush = Date.now();
  const flush = async () => {
    if (!batch.length) return;
    const merged = new Uint8Array(batch.reduce((n, b) => n + b.length, 0));
    let o = 0;
    for (const b of batch) { merged.set(b, o); o += b.length; }
    batch = [];
    lastFlush = Date.now();
    await onWrite(merged);
  };

  try {
    while (nextWrite < total && !failed) {
      const chunk = ready.get(nextWrite);
      if (!chunk) {
        if (shouldStop()) break;
        if (!gotAny && Date.now() - t0 > FIRST_DATA_MS) { failed = new Error('No data received from Telegram'); break; }
        await sleep(15);
        continue;
      }
      ready.delete(nextWrite);
      nextWrite++;
      batch.push(chunk);
      if (batch.length >= 2 || Date.now() - lastFlush > 700) await flush();
    }
    await flush();
  } finally {
    aborted = true; // stops idle workers; requests already in flight finish on their own
  }
  if (failed) throw failed;
}

/** Parallel download. If the direct method fails or stalls, continue with the sequential method. */
export async function downloadFast(
  id: number, offset: number, size: number,
  onWrite: (data: Uint8Array) => Promise<void>, shouldStop: () => boolean, parallel = 6,
  onStage?: (s: string) => void,
) {
  let written = 0;
  const track = async (d: Uint8Array) => { await onWrite(d); written += d.length; };
  onStage?.('Connecting…');
  await checkConnection();
  try {
    await downloadDirect(id, offset, size, track, shouldStop, parallel, onStage);
  } catch (e) {
    console.warn('direct download failed, falling back to sequential', e);
    if (shouldStop()) return;
    onStage?.('Switching to safe mode…');
    await downloadChunks(id, offset + written, track, shouldStop);
  }
}
