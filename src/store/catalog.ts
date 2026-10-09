import { create } from 'zustand';
import { getAllItems, getMeta, setMeta } from '../db/idb';
import { syncCatalog } from '../telegram/scanner';
import { readPlaylists, refreshPlaylists, type PlCache } from '../lib/playlistStore';
import { guessCourseSubject, guessRows } from '../lib/playlistGuess';
import { useBuddy } from './buddy';
import { plLessonId, type PlaylistInfo, type Book, type Course, type Item, type Notice, type Subject, type Chapter } from '../types';

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]+/g, '-').replace(/^-|-$/g, '');

export function buildCatalog(items: Item[], pl: Record<string, PlCache> = {}) {
  const covers = new Map<number, number>();
  for (const i of items) if (i.kind === 'cover') covers.set(i.replyTo, i.id);

  const books: Book[] = items
    .flatMap((i) => (i.kind === 'book' ? [i] : []))
    .map((i) => ({
      id: i.id, title: i.title, subject: i.subject, author: i.author,
      size: i.size, coverMsgId: covers.get(i.id), date: i.date,
    }))
    .sort((a, b) => b.date - a.date);

  const notices: Notice[] = items
    .flatMap((i) => (i.kind === 'notice' ? [i] : []))
    .map(({ id, title, body, date }) => ({ id, title, body, date }))
    .sort((a, b) => b.date - a.date);

  const courseMap = new Map<string, Course>();
  const ensure = (title: string): Course => {
    const id = slug(title);
    let c = courseMap.get(id);
    if (!c) courseMap.set(id, (c = { id, title, subjects: [] }));
    return c;
  };
  for (const i of items) {
    if (i.kind === 'course') {
      const c = ensure(i.title);
      c.description = i.description;
      c.msgId = i.id;
      if (i.hasCover) c.coverMsgId = i.id;
    }
  }
  const sorted = items
    .flatMap((i) => (i.kind === 'video' ? [i] : []))
    .sort((a, b) => a.order - b.order || a.id - b.id);
  for (const v of sorted) {
    const course = ensure(v.course);
    let s = course.subjects.find((x) => x.id === slug(v.subject)) as Subject | undefined;
    if (!s) course.subjects.push((s = { id: slug(v.subject), title: v.subject, chapters: [] }));
    let ch = s.chapters.find((x) => x.id === slug(v.chapter)) as Chapter | undefined;
    if (!ch) s.chapters.push((ch = { id: slug(v.chapter), title: v.chapter, lessons: [] }));
    ch.lessons.push({ id: v.id, title: v.title, order: v.order, duration: v.duration, size: v.size, youtubeId: v.youtubeId, date: v.date });
  }

  /* #playlist posts: every video of the playlist becomes a lesson, chapters are guessed from the titles.
     Each post is independent, so the same playlist can be put in several chapters. Inside one chapter a video is never shown twice. */
  const playlists: PlaylistInfo[] = [];
  for (const p of items) {
    if (p.kind !== 'playlist') continue;
    const cache = pl[p.listId];
    const info: PlaylistInfo = { msgId: p.id, listId: p.listId, course: p.course, subject: p.subject, chapter: p.chapter, title: cache?.title ?? '', read: cache?.videos.length ?? 0, added: 0, loaded: !!cache };
    playlists.push(info);
    if (!cache) continue;
    const g = guessCourseSubject(cache.title, [...courseMap.values()]);
    const course = ensure(p.course || g.course || cache.title || 'Playlist');
    const subjectTitle = p.subject || g.subject || cache.title || 'Lessons';
    const part = p.range ? cache.videos.slice(p.range[0] - 1, p.range[1]) : cache.videos;   // optional `1-10` = only the first ten videos
    if (!part.length) continue;
    let s = course.subjects.find((x) => x.id === slug(subjectTitle)) as Subject | undefined;
    if (!s) course.subjects.push((s = { id: slug(subjectTitle), title: subjectTitle, chapters: [] }));
    const forced = p.chapter.trim();      // a chapter written in the post: every video of the playlist goes there
    const { rows } = guessRows(part, forced || p.mode === 'one' ? 'one' : typeof p.mode === 'number' ? 'every' : 'auto', typeof p.mode === 'number' ? p.mode : 5);
    if (forced) rows.forEach((r) => { r.chapter = forced; });
    const next = new Map<string, number>();
    for (const r of rows) {
      const chTitle = r.chapter || 'Lectures';
      let ch = s.chapters.find((x) => x.id === slug(chTitle)) as Chapter | undefined;
      if (!ch) s.chapters.push((ch = { id: slug(chTitle), title: chTitle, lessons: [] }));
      if (ch.lessons.some((l) => l.youtubeId === r.id)) continue;
      if (!next.has(ch.id)) next.set(ch.id, Math.max(0, ...ch.lessons.map((l) => (l.order < 100000 ? l.order : 0))) + 1);
      const order = next.get(ch.id)!;
      next.set(ch.id, order + 1);
      // the id depends on the post too, so one video in two chapters is two lessons (own progress, own place in the list)
      info.added++;
      ch.lessons.push({ id: plLessonId(`${p.id}:${r.id}`), title: r.title, order, duration: 0, size: 0, youtubeId: r.id, date: p.date });
    }
  }

  return { books, notices, playlists, courses: [...courseMap.values()] };
}

/** the Gemini key comes from the newest `#key` post in the channel (none = no key) */
function applyKey(items: Item[]) {
  const k = items.flatMap((i) => (i.kind === 'key' ? [i] : [])).sort((a, b) => b.date - a.date || b.id - a.id)[0]?.key ?? '';
  if (useBuddy.getState().apiKey !== k) useBuddy.getState().update({ apiKey: k });
}

interface CatalogState {
  books: Book[];
  courses: Course[];
  notices: Notice[];
  playlists: PlaylistInfo[];
  syncing: boolean;
  error?: string;
  lastScanned?: number;
  lastSync?: number;
  loadCache: () => Promise<void>;
  sync: () => Promise<void>;
  resyncPlaylists: () => Promise<void>;
}

export const useCatalog = create<CatalogState>((set, get) => ({
  books: [], courses: [], notices: [], playlists: [], syncing: false,

  loadCache: async () => {
    const lastSync = await getMeta<number>('lastSyncAt');
    const items = await getAllItems();
    applyKey(items);
    set({ ...buildCatalog(items, await readPlaylists(items)), lastSync });
  },

  sync: async () => {
    if (get().syncing) return;
    set({ syncing: true, error: undefined });
    try {
      await syncCatalog((id) => set({ lastScanned: id }));
      const lastSync = Date.now();
      await setMeta('lastSyncAt', lastSync);
      const items = await getAllItems();
      applyKey(items);
      const plErr = await refreshPlaylists(items);
      set({ ...buildCatalog(items, await readPlaylists(items)), syncing: false, lastSync, error: plErr });
    } catch (e) {
      set({ syncing: false, error: String((e as Error)?.message ?? e) });
    }
  },

  resyncPlaylists: async () => {
    if (get().syncing) return;
    set({ syncing: true, error: undefined });
    try {
      const items = await getAllItems();
      const err = await refreshPlaylists(items, true);
      set({ ...buildCatalog(items, await readPlaylists(items)), syncing: false, error: err });
    } catch (e) {
      set({ syncing: false, error: String((e as Error)?.message ?? e) });
    }
  },
}));
