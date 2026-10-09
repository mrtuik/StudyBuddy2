import { create } from 'zustand';
import { CHAR_H, CHAR_W, POS_BOTTOM, POS_RIGHT } from '../buddy/config';

export type Gender = 'male' | 'female' | 'other';
export type Status = 'off' | 'connecting' | 'live' | 'error';

export const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const POS = { right: POS_RIGHT, bottom: POS_BOTTOM };

interface Saved {
  name: string; gender: Gender | ''; age: number; lang: string; roast: number; voice: string;
  model: string; apiKey: string; setup: boolean; right: number; bottom: number;
}
const KEY = 'sb_buddy_v1';
const DEFAULTS: Saved = {
  name: '', gender: '', age: 0, lang: 'bn', roast: 4, voice: 'Puck', model: DEFAULT_MODEL, apiKey: '', setup: false, ...POS,
};
const load = (): Saved => {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if (s.bottom === 128) s.bottom = POS_BOTTOM;          // old default sat on top of the continue bar
    return s;
  } catch { return DEFAULTS; }
};

interface BuddyState extends Saved {
  status: Status;
  muted: boolean;
  peek: boolean;
  watching: boolean;
  sheet: boolean;
  micBlocked: boolean;
  caption: string;
  gesture: { name: string; n: number };
  update: (p: Partial<Saved>) => void;
  set: (p: Partial<Pick<BuddyState, 'status' | 'muted' | 'peek' | 'watching' | 'sheet' | 'caption' | 'micBlocked'>>) => void;
  doGesture: (name: string) => void;
  moveTo: (where: string) => void;
  resetPos: () => void;
}

export const useBuddy = create<BuddyState>((set, get) => ({
  ...load(),
  status: 'off', muted: false, peek: false, watching: false, sheet: false, micBlocked: false, caption: '', gesture: { name: '', n: 0 },
  update: (p) => {
    set(p);
    const s = get();
    const saved: Saved = { name: s.name, gender: s.gender, age: s.age, lang: s.lang, roast: s.roast, voice: s.voice, model: s.model, apiKey: s.apiKey, setup: s.setup, right: s.right, bottom: s.bottom };
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* ignore */ }
  },
  set: (p) => set(p),
  doGesture: (name) => set((s) => ({ gesture: { name, n: s.gesture.n + 1 } })),
  moveTo: (where) => {
    const w = window.innerWidth, h = window.innerHeight;
    if (where === 'hide' || where === 'peek') { set({ peek: true }); return; }
    set({ peek: false });
    if (where === 'left') get().update({ right: w - CHAR_W - 12 });
    else if (where === 'right') get().update({ right: POS.right });
    else if (where === 'top') get().update({ bottom: Math.max(POS.bottom, h - CHAR_H - 140) });
    else get().update({ right: POS.right, bottom: POS.bottom });
  },
  resetPos: () => get().update(POS),
}));
