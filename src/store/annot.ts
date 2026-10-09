import { create } from 'zustand';

/** Coordinates are 0..1 of the page; w is a fraction of page width, so notes scale with zoom. */
export interface Stroke { c: string; w: number; hl?: boolean; p: number[] }

interface AnnotState {
  data: Record<string, Record<number, Stroke[]>>;
  set: (key: string, page: number, s: Stroke[]) => void;
}

const KEY = 'sb_annot_v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

export const useAnnot = create<AnnotState>((set, get) => ({
  data: load(),
  set: (key, page, s) => {
    set((st) => ({ data: { ...st.data, [key]: { ...(st.data[key] ?? {}), [page]: s } } }));
    try { localStorage.setItem(KEY, JSON.stringify(get().data)); } catch { /* storage full */ }
  },
}));
