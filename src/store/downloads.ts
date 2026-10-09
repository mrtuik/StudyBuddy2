import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { DownloadItem } from '../types';
import { DL_CHUNK, downloadFast } from '../telegram/media';

export interface DlItem extends DownloadItem {
  type: 'book' | 'lesson';
  msgId: number;
  title: string;
  speed?: number;
  error?: string;
  stage?: string;
}

export const dlKey = (type: 'book' | 'lesson', id: number) => `${type}:${id}`;

const KEY = 'sb_downloads_v1';
const MAX_PARALLEL = 2;
const ctls = new Map<string, { stop: boolean; removed: boolean }>();

const load = (): Record<string, DlItem> => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, DlItem>;
    for (const k of Object.keys(raw)) if (raw[k].status === 'running' || raw[k].status === 'queued') raw[k].status = 'paused';
    return raw;
  } catch { return {}; }
};

export const toB64 = (u8: Uint8Array) =>
  new Promise<string>((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve((fr.result as string).split(',')[1] ?? '');
    fr.readAsDataURL(new Blob([u8]));
  });

interface DlState {
  items: Record<string, DlItem>;
  add: (type: 'book' | 'lesson', msgId: number, title: string, size: number) => void;
  pause: (key: string) => void;
  resume: (key: string) => void;
  remove: (key: string) => Promise<void>;
}

export const useDownloads = create<DlState>((set, get) => {
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(get().items)); } catch { /* ignore */ } };
  const patch = (key: string, p: Partial<DlItem>) => {
    const it = get().items[key];
    if (!it) return;
    set((s) => ({ items: { ...s.items, [key]: { ...it, ...p } } }));
    save();
  };

  const pump = () => {
    const items = Object.values(get().items);
    let running = items.filter((i) => i.status === 'running').length;
    for (const it of items) {
      if (running >= MAX_PARALLEL) break;
      if (it.status === 'queued' && !ctls.has(it.key)) { running++; void run(it.key); }
    }
  };

  const run = async (key: string) => {
    const it = get().items[key];
    if (!it) return;
    const ctl = { stop: false, removed: false };
    ctls.set(key, ctl);
    patch(key, { status: 'running', error: undefined, speed: 0 });
    try {
      let offset = 0;
      try {
        const st = await Filesystem.stat({ path: it.path, directory: Directory.Data });
        offset = st.size % DL_CHUNK === 0 ? st.size : 0;
      } catch { offset = 0; }
      if (offset === 0) { try { await Filesystem.deleteFile({ path: it.path, directory: Directory.Data }); } catch { /* none */ } }
      patch(key, { bytes: offset });
      const t0 = Date.now();
      await downloadFast(it.msgId, offset, it.size, async (u8) => {
        await Filesystem.appendFile({ path: it.path, directory: Directory.Data, data: await toB64(u8) });
        const cur = get().items[key];
        if (cur) {
          const bytes = cur.bytes + u8.length;
          const secs = (Date.now() - t0) / 1000;
          patch(key, { bytes, stage: 'Downloading', speed: secs > 1 ? (bytes - offset) / secs : 0 });
        }
      }, () => ctl.stop, 6, (stage) => patch(key, { stage }));
      if (!ctl.removed) patch(key, { status: ctl.stop ? 'paused' : 'done' });
    } catch (e) {
      console.error('download error', e);
      if (!ctl.removed) patch(key, { status: 'error', error: String((e as Error)?.message ?? e) });
    } finally {
      ctls.delete(key);
      pump();
    }
  };

  return {
    items: load(),
    add: (type, msgId, title, size) => {
      const key = dlKey(type, msgId);
      if (get().items[key]) { get().resume(key); return; }
      const path = `sb_${type}_${msgId}.${type === 'book' ? 'pdf' : 'mp4'}`;
      set((s) => ({ items: { ...s.items, [key]: { key, path, bytes: 0, size, status: 'queued', type, msgId, title } } }));
      save();
      pump();
    },
    pause: (key) => { const c = ctls.get(key); if (c) c.stop = true; else patch(key, { status: 'paused' }); },
    resume: (key) => {
      const it = get().items[key];
      if (!it || it.status === 'done' || it.status === 'running') return;
      patch(key, { status: 'queued' });
      pump();
    },
    remove: async (key) => {
      const it = get().items[key];
      const c = ctls.get(key);
      if (c) { c.stop = true; c.removed = true; }
      if (it) { try { await Filesystem.deleteFile({ path: it.path, directory: Directory.Data }); } catch { /* ignore */ } }
      set((s) => { const n = { ...s.items }; delete n[key]; return { items: n }; });
      save();
    },
  };
});

export async function localUrl(it: DlItem): Promise<string> {
  const { uri } = await Filesystem.getUri({ path: it.path, directory: Directory.Data });
  return Capacitor.convertFileSrc(uri);
}
