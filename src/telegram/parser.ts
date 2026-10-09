import { Api } from 'telegram';
import type { Item } from '../types';
import { parseYoutubeId } from '../lib/youtube';
import { parsePlaylistId } from '../lib/playlistFetch';

type Tag = 'book' | 'video' | 'course' | 'notice' | 'playlist';

export function parseCaption(text: string): { tag: Tag; parts: string[] } | null {
  const m = text.trim().match(/^#(book|video|course|notice|playlist)\s+([\s\S]+)$/i);
  if (!m) return null;
  return { tag: m[1].toLowerCase() as Tag, parts: m[2].split('|').map((s) => s.trim()) };
}

/**
 * Admin login message in the channel:
 *   #id1
 *   Studybuddy
 *   tuik@123
 * (or on one line: `#id1 Studybuddy tuik@123`). Add #id2, #id3 ... for more logins.
 */
export function parseLogin(text: string): { user: string; pass: string } | null {
  const t = text.trim();
  if (!/^#id\d*(\s|$)/i.test(t)) return null;
  const rest = t.replace(/^#id\d*/i, '').trim();
  const lines = rest.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const parts = lines.length >= 2 ? lines : rest.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { user: parts[0], pass: parts[1] };
}

/** Convert one Telegram message to a catalog Item. Returns null for invalid/unrelated messages. */
export function messageToItem(m: Api.Message): Item | null {
  const id = m.id;
  const date = (m.date ?? 0) * 1000;
  const lg = parseLogin(m.message ?? '');
  if (lg) return { kind: 'login', id, date, user: lg.user, pass: lg.pass };
  const p = parseCaption(m.message ?? '');

  if (!p) {
    // untagged photo replying to a PDF = book cover
    const replyTo = (m.replyTo as Api.MessageReplyHeader | undefined)?.replyToMsgId;
    if (m.photo && replyTo) return { kind: 'cover', id, date, replyTo };
    return null;
  }

  const doc = m.document instanceof Api.Document ? m.document : undefined;
  const mime = doc?.mimeType ?? '';
  const size = doc ? Number(doc.size) : 0;
  const [a, b, c, d, e, f] = p.parts;

  switch (p.tag) {
    case 'book': {
      const isPdf = mime === 'application/pdf';
      if (!doc || !isPdf || !a) return null;
      return { kind: 'book', id, date, title: a, subject: b || 'General', author: c || undefined, size };
    }
    case 'video': {
      if (!a || !b || !c || !d) return null;
      const isVideoFile = !!doc && mime.startsWith('video/');
      // YouTube lesson: `#video Course | Subject | Chapter | Title | Order | https://youtu.be/xxxx` (order may be left out)
      const yt = isVideoFile ? undefined : parseYoutubeId(f) ?? parseYoutubeId(e);
      if (!isVideoFile && !yt) return null;
      if (yt) {
        const ord = e && !isNaN(Number(e)) ? Number(e) : id;
        return { kind: 'video', id, date, course: a, subject: b, chapter: c, title: d, order: ord, duration: 0, size: 0, youtubeId: yt };
      }
      if (!doc) return null;
      const va = doc.attributes.find((x) => x instanceof Api.DocumentAttributeVideo) as
        | Api.DocumentAttributeVideo
        | undefined;
      const order = e && !isNaN(Number(e)) ? Number(e) : id;
      return {
        kind: 'video', id, date,
        course: a, subject: b, chapter: c, title: d,
        order, duration: Math.round(va?.duration ?? 0), size,
      };
    }
    case 'playlist': {
      // `#playlist Course | Subject | Chapter | https://youtube.com/playlist?list=...` (course / subject / chapter can be left out, extra: `5` = videos per chapter, `one` = one chapter)
      let listId: string | undefined;
      let mode: 'auto' | 'one' | number = 'auto';
      let range: [number, number] | undefined;
      const text: string[] = [];
      for (const x of p.parts) {
        if (!x) continue;
        if (!listId && (/list=/.test(x) || /^(PL|UU|FL|OL)[\w-]{16,}$/.test(x))) { listId = parsePlaylistId(x); continue; }
        const rg = /^(\d{1,4})\s*[-–—]\s*(\d{0,4})$/.exec(x);          // `1-10`, `11-20`, `21-` = which videos of the playlist
        if (rg) { range = [Math.max(1, Number(rg[1])), rg[2] ? Number(rg[2]) : 99999]; continue; }
        const n = /^(?:every\s*)?(\d{1,2})$/i.exec(x);
        if (n) { mode = Number(n[1]) || 'auto'; continue; }
        if (/^one(\s+chapter)?$/i.test(x)) { mode = 'one'; continue; }
        text.push(x);
      }
      if (!listId) return null;
      return { kind: 'playlist', id, date, listId, course: text[0] ?? '', subject: text[1] ?? '', chapter: text[2] ?? '', mode, range };
    }
    case 'course': {
      if (!a) return null;
      return { kind: 'course', id, date, title: a, description: b || undefined, hasCover: !!m.photo };
    }
    case 'notice': {
      if (!a) return null;
      return { kind: 'notice', id, date, title: a, body: p.parts.slice(1).join(' | ') };
    }
  }
}
