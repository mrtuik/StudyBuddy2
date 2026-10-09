// Reads the video list of a public YouTube playlist (no API key). CapacitorHttp sends the request from the
// Android side, so the WebView's CORS rule does not block it. In a normal browser it falls back to fetch().
import { CapacitorHttp } from '@capacitor/core';
import { parseYoutubeId } from './youtube';
import type { PlVideo } from './playlistGuess';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEAD = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };

export function parsePlaylistId(input: string): string | undefined {
  const s = input.trim();
  if (/^(PL|UU|FL|OL|RD)[\w-]{10,}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const l = u.searchParams.get('list');
    return l && /^[\w-]{10,}$/.test(l) ? l : undefined;
  } catch { return undefined; }
}

/** pulls the JSON object that follows `marker` out of the page, matching braces (string aware) */
function jsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  const start = html.indexOf('{', at);
  if (start < 0) return undefined;
  let depth = 0, str = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') str = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return undefined; } }
  }
  return undefined;
}

type J = Record<string, unknown>;
/** finds every object stored under `key` anywhere in the JSON */
function collect(root: unknown, key: string): J[] {
  const out: J[] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const o = stack.pop();
    if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) stack.push(o[i]); }
    else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as J)) {
        if (k === key && v && typeof v === 'object') out.push(v as J);
        else stack.push(v);
      }
    }
  }
  return out;
}
const text = (t: unknown): string => {
  const o = t as { simpleText?: string; runs?: { text: string }[] } | undefined;
  return o?.simpleText ?? o?.runs?.map((r) => r.text).join('') ?? '';
};

const OK_ID = /^[\w-]{11}$/;
const junk = (t: string) => !t || /^\[(private|deleted) video\]$/i.test(t) || /^(private|deleted) video$/i.test(t);

/** every video found under the playlist list; handles the old (playlistVideoRenderer) and the new (lockupViewModel) page layout */
function videosIn(root: unknown): PlVideo[] {
  // the real list lives under playlistVideoListRenderer: ignore "recommended" videos elsewhere on the page when it exists
  const lists = collect(root, 'playlistVideoListRenderer');
  const scope: unknown = lists.length ? lists : root;
  const out: PlVideo[] = [];
  const push = (id: unknown, title: unknown) => {
    const t = String(title ?? '').trim();
    if (typeof id === 'string' && OK_ID.test(id) && !junk(t)) out.push({ id, title: t });
  };
  for (const r of collect(scope, 'playlistVideoRenderer')) push(r.videoId, text(r.title));
  for (const r of collect(scope, 'playlistPanelVideoRenderer')) push(r.videoId, text(r.title));
  if (!out.length) {
    for (const r of collect(scope, 'lockupViewModel')) {
      if (!/VIDEO/.test(String(r.contentType ?? ''))) continue;
      const meta = (r.metadata as J | undefined)?.lockupMetadataViewModel as J | undefined;
      push(r.contentId, (meta?.title as { content?: string } | undefined)?.content ?? '');
    }
  }
  return out;
}

/** "load more" token of the playlist list (only the one inside continuationItemRenderer, not the sort-menu tokens) */
const tokenIn = (root: unknown): string | undefined =>
  collect(root, 'continuationItemRenderer')
    .map((c) => String(((c.continuationEndpoint as J | undefined)?.continuationCommand as J | undefined)?.token ?? ''))
    .find(Boolean);

async function http<T = unknown>(o: { url: string; method?: 'GET' | 'POST'; data?: unknown; json?: boolean }): Promise<T> {
  const res = await CapacitorHttp.request({
    url: o.url, method: o.method ?? 'GET',
    headers: o.json ? { ...HEAD, 'Content-Type': 'application/json', Origin: 'https://www.youtube.com' } : HEAD,
    data: o.data, connectTimeout: 15000, readTimeout: 20000,
  });
  if (res.status >= 400) throw new Error(`YouTube answered ${res.status}.`);
  return res.data as T;
}
const asJson = (d: unknown): unknown => { if (typeof d !== 'string') return d; try { return JSON.parse(d); } catch { return undefined; } };

const WEB_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';   // the public key every youtube.com page uses
const ctx = (ver: string) => ({ client: { clientName: 'WEB', clientVersion: ver, hl: 'en', gl: 'US' } });

function titleOf(root: unknown, html = ''): string {
  const h = collect(root, 'playlistHeaderRenderer')[0]?.title;
  const m = (collect(root, 'playlistMetadataRenderer')[0] as J | undefined)?.title;
  const pg = (collect(root, 'pageHeaderViewModel')[0] as J | undefined)?.title as { dynamicTextViewModel?: { text?: { content?: string } } } | undefined;
  const mf = (collect(root, 'microformatDataRenderer')[0] as J | undefined)?.title;
  const tag = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/ - YouTube$/, '');
  return String(text(h) || m || pg?.dynamicTextViewModel?.text?.content || mf || tag || '').trim();
}

/** follows "load more" until the whole playlist is read */
async function pages(first: unknown, key: string, ver: string, add: (l: PlVideo[]) => number) {
  let token = tokenIn(first);
  for (let page = 0; token && page < 40; page++) {
    const next = asJson(await http<unknown>({
      url: `https://www.youtube.com/youtubei/v1/browse?key=${key}&prettyPrint=false`,
      method: 'POST', json: true, data: { context: ctx(ver), continuation: token },
    }));
    const got = add(videosIn(next));
    const t = tokenIn(next);
    token = got > 0 && t && t !== token ? t : undefined;
  }
}

export async function fetchPlaylist(input: string): Promise<{ title: string; videos: PlVideo[] }> {
  const id = parsePlaylistId(input);
  if (!id) throw new Error('That is not a YouTube playlist link (it must contain list=...).');
  const seen = new Set<string>();
  const videos: PlVideo[] = [];
  const add = (l: PlVideo[]) => { let n = 0; for (const v of l) if (!seen.has(v.id)) { seen.add(v.id); videos.push(v); n++; } return n; };
  let title = '';
  const diag: string[] = [];
  let key = WEB_KEY, ver = '2.20250101.00.00';

  /* 1. the playlist web page */
  try {
    const raw = await http<unknown>({ url: `https://www.youtube.com/playlist?list=${id}&hl=en&gl=US` });
    const html = typeof raw === 'string' ? raw : JSON.stringify(raw);
    key = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1] ?? key;
    ver = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1] ?? ver;
    const data = jsonAfter(html, 'ytInitialData');
    if (!data) diag.push(`page ${Math.round(html.length / 1024)} KB without data${/consent/i.test(html) ? ' (consent page)' : ''}`);
    else {
      title = titleOf(data, html);
      add(videosIn(data));
      if (videos.length) await pages(data, key, ver, add);
      else diag.push(`page had no video list (${Object.keys(data as J).slice(0, 5).join(',')})`);
    }
  } catch (e) { diag.push(`page: ${String((e as Error)?.message ?? e)}`); }

  /* 2. YouTube's own browse API (does not depend on the page layout) */
  if (!videos.length) {
    try {
      const data = asJson(await http<unknown>({
        url: `https://www.youtube.com/youtubei/v1/browse?key=${key}&prettyPrint=false`,
        method: 'POST', json: true, data: { context: ctx(ver), browseId: `VL${id}` },
      }));
      title = title || titleOf(data);
      add(videosIn(data));
      if (videos.length) await pages(data, key, ver, add); else diag.push('browse: no videos');
    } catch (e) { diag.push(`browse: ${String((e as Error)?.message ?? e)}`); }
  }

  /* 3. the "up next" panel of the player: up to 200 videos */
  if (!videos.length) {
    try {
      const data = asJson(await http<unknown>({
        url: `https://www.youtube.com/youtubei/v1/next?key=${key}&prettyPrint=false`,
        method: 'POST', json: true, data: { context: ctx(ver), playlistId: id },
      }));
      title = title || String(text((collect(data, 'playlistPanelRenderer')[0] as J | undefined)?.title)).trim();
      add(videosIn(data));
      if (!videos.length) diag.push('next: no videos');
    } catch (e) { diag.push(`next: ${String((e as Error)?.message ?? e)}`); }
  }

  /* 4. the public RSS feed (newest 15 videos only, but it always works for public playlists) */
  if (!videos.length) {
    try {
      const xml = String(await http<unknown>({ url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${id}` }));
      title = title || (/<title>([^<]*)<\/title>/.exec(xml)?.[1] ?? '').trim();
      const dec = (t: string) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      add(xml.split('<entry>').slice(1).flatMap((e) => {
        const vid = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1];
        const t = /<title>([^<]*)<\/title>/.exec(e)?.[1];
        return vid && t && OK_ID.test(vid) ? [{ id: vid, title: dec(t).trim() }] : [];
      }));
      if (!videos.length) diag.push('feed: empty');
    } catch (e) { diag.push(`feed: ${String((e as Error)?.message ?? e)}`); }
  }

  if (!videos.length) throw new Error(`No videos were found in that playlist (is it public?). [${diag.join('; ')}]`);
  return { title: title.trim(), videos };
}

/** fallback: paste video links (one per line, an optional title after the link) */
export async function videosFromLines(raw: string, onTitle?: (n: number) => void): Promise<PlVideo[]> {
  const out: PlVideo[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const parts = l.split(/\s+/);
    const at = parts.findIndex((p) => parseYoutubeId(p));
    if (at < 0) continue;
    const id = parseYoutubeId(parts[at])!;
    if (out.some((v) => v.id === id)) continue;
    out.push({ id, title: [...parts.slice(0, at), ...parts.slice(at + 1)].join(' ').replace(/^[-–|:]+\s*/, '').trim() });
  }
  // links without a title: ask YouTube for it, a few at a time
  const todo = out.filter((v) => !v.title);
  let k = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, async () => {
    while (k < todo.length) {
      const v = todo[k++];
      try {
        const r = await http<{ title?: string }>({ url: `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://youtu.be/${v.id}`)}&format=json` });
        v.title = String((typeof r === 'string' ? JSON.parse(r) : r).title ?? '').trim();
      } catch { /* named below */ }
      onTitle?.(++done);
    }
  }));
  out.forEach((v, i) => { if (!v.title) v.title = `Lesson ${i + 1}`; });
  return out;
}
