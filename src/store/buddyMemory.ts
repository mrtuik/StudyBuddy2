import { create } from 'zustand';
import { openDB, type DBSchema } from 'idb';

/** What Buddy remembers about the student. Stored in IndexedDB on this phone: no limit, old notes are never removed automatically. */
export interface Note { id: number; text: string; at: number; }

interface MemDB extends DBSchema {
  notes: { key: number; value: Note };
  meta: { key: string; value: number };
}

// its own database, so catalog cache resets can never touch Buddy's memory
let dbp: ReturnType<typeof open> | undefined;
const open = () => openDB<MemDB>('studybuddy-buddy', 1, {
  upgrade(d) { d.createObjectStore('notes', { keyPath: 'id' }); d.createObjectStore('meta'); },
});
const db = () => (dbp ??= open());
const quiet = (p: Promise<unknown>) => { p.catch(() => undefined); };

interface Mem {
  notes: Note[];                       // all notes, oldest first
  sessions: number;
  lastSeen: number;
  ready: boolean;
  add: (text: string) => boolean;
  remove: (id: number) => void;
  clear: () => void;
  endSession: () => void;
  /** notes for the system instruction: the newest ones plus a few random old ones, so the prompt stays small */
  pick: (n: number) => Note[];
  /** keyword search over ALL notes (used by Buddy's recall_notes tool) */
  search: (q: string, n?: number) => Note[];
}

export const useBuddyMemory = create<Mem>((set, get) => ({
  notes: [], sessions: 0, lastSeen: 0, ready: false,

  add: (raw) => {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text.length < 3) return false;
    if (get().notes.some((n) => n.text.toLowerCase() === text.toLowerCase())) return false;
    const note: Note = { id: Date.now() * 1000 + Math.floor(Math.random() * 1000), text, at: Date.now() };
    set((s) => ({ notes: [...s.notes, note] }));
    quiet(db().then((d) => d.put('notes', note)));
    return true;
  },
  remove: (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    quiet(db().then((d) => d.delete('notes', id)));
  },
  clear: () => {
    set({ notes: [], sessions: 0, lastSeen: 0 });
    quiet(db().then(async (d) => { await d.clear('notes'); await d.clear('meta'); }));
  },
  endSession: () => {
    const sessions = get().sessions + 1, lastSeen = Date.now();
    set({ sessions, lastSeen });
    quiet(db().then(async (d) => { await d.put('meta', sessions, 'sessions'); await d.put('meta', lastSeen, 'lastSeen'); }));
  },

  pick: (n) => {
    const all = get().notes;
    if (all.length <= n) return all;
    const recent = Math.ceil(n * 0.7);
    const older = all.slice(0, all.length - recent);
    const extra: Note[] = [];
    const pool = [...older];
    for (let i = 0; i < n - recent && pool.length; i++) extra.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return [...extra.sort((a, b) => a.at - b.at), ...all.slice(-recent)];
  },

  search: (q, n = 10) => {
    const words = q.toLowerCase().split(/[^a-z0-9\u0980-\u09ff]+/).filter((w) => w.length >= 3);
    if (!words.length) return get().notes.slice(-n).reverse();
    return get().notes
      .map((note) => ({ note, score: words.reduce((s, w) => s + (note.text.toLowerCase().includes(w) ? 1 : 0), 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.note.at - a.note.at)
      .slice(0, n)
      .map((x) => x.note);
  },
}));

const LEGACY = 'sb_buddy_mem_v1';     // the first version kept 40 notes in localStorage; move them over once

/** resolves when the saved notes are loaded; Buddy waits for it before it starts */
export const memoryReady: Promise<void> = (async () => {
  try {
    const d = await db();
    const old = localStorage.getItem(LEGACY);
    if (old) {
      try {
        const j = JSON.parse(old) as { notes?: Note[]; sessions?: number; lastSeen?: number };
        for (const n of j.notes ?? []) await d.put('notes', n);
        if (j.sessions) await d.put('meta', j.sessions, 'sessions');
        if (j.lastSeen) await d.put('meta', j.lastSeen, 'lastSeen');
      } catch { /* ignore broken old data */ }
      localStorage.removeItem(LEGACY);
    }
    const notes = (await d.getAll('notes')).sort((a, b) => a.at - b.at);
    useBuddyMemory.setState({
      notes,
      sessions: (await d.get('meta', 'sessions')) ?? 0,
      lastSeen: (await d.get('meta', 'lastSeen')) ?? 0,
      ready: true,
    });
  } catch {
    useBuddyMemory.setState({ ready: true });
  }
})();
