import { create } from 'zustand';
import type { Progress } from '../types';

export interface Recent {
  key: string;
  type: 'book' | 'lesson';
  id: number;
  title: string;
  subtitle?: string;
  coverId?: number;
  at: number;
}

interface LibState {
  progress: Record<string, Progress>;
  bookmarks: Record<string, number[]>;
  recents: Recent[];
  noticeSeen: number;
  searches: string[];
  /** saved cards shown in Home > Library: `folder:<name>` or `course:<id>` */
  saved: string[];
  toggleSaved: (key: string) => void;
  setProgress: (key: string, position: number, total: number) => void;
  toggleBookmark: (key: string, page: number) => void;
  touch: (r: Omit<Recent, 'at'>) => void;
  markNoticesSeen: (id: number) => void;
  addSearch: (q: string) => void;
  clearSearches: () => void;
}

const KEY = 'sb_library_v1';
const load = (): Partial<LibState> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
};

export const useLibrary = create<LibState>((set, get) => {
  const init = load();
  const save = () => {
    const { progress, bookmarks, recents, noticeSeen, searches, saved } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ progress, bookmarks, recents, noticeSeen, searches, saved })); } catch { /* ignore */ }
  };
  return {
    progress: init.progress ?? {},
    bookmarks: init.bookmarks ?? {},
    recents: init.recents ?? [],
    noticeSeen: init.noticeSeen ?? 0,
    searches: init.searches ?? [],
    saved: init.saved ?? [],
    toggleSaved: (key) => {
      set((s) => ({ saved: s.saved.includes(key) ? s.saved.filter((k) => k !== key) : [key, ...s.saved] }));
      save();
    },
    setProgress: (key, position, total) => {
      set((s) => ({ progress: { ...s.progress, [key]: { key, position, total, updatedAt: Date.now() } } }));
      save();
    },
    toggleBookmark: (key, page) => {
      set((s) => {
        const cur = s.bookmarks[key] ?? [];
        const next = cur.includes(page) ? cur.filter((p) => p !== page) : [...cur, page].sort((a, b) => a - b);
        return { bookmarks: { ...s.bookmarks, [key]: next } };
      });
      save();
    },
    touch: (r) => {
      set((s) => ({ recents: [{ ...r, at: Date.now() }, ...s.recents.filter((x) => x.key !== r.key)].slice(0, 30) }));
      save();
    },
    markNoticesSeen: (id) => { set({ noticeSeen: id }); save(); },
    addSearch: (q) => {
      set((s) => ({ searches: [q, ...s.searches.filter((x) => x !== q)].slice(0, 8) }));
      save();
    },
    clearSearches: () => { set({ searches: [] }); save(); },
  };
});
