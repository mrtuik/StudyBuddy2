import { create } from 'zustand';
import { Preferences } from '@capacitor/preferences';
import { Api } from 'telegram';
import { deleteItems, getAllItems, putItems } from '../db/idb';
import { getChannelPeer, getClient } from '../telegram/client';
import { parseLogin } from '../telegram/parser';
import { useCatalog } from './catalog';
import type { Item } from '../types';

type LoginItem = Extract<Item, { kind: 'login' }>;
const SKEY = 'admin_session';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

async function cachedLogins(): Promise<LoginItem[]> {
  return (await getAllItems()).filter((i): i is LoginItem => i.kind === 'login');
}

/**
 * Re-reads the stored login messages straight from Telegram, so an id you delete or edit in the channel
 * stops working immediately (the normal sync only re-checks the last 200 messages). Offline = cached ids.
 */
export async function refreshLogins(): Promise<LoginItem[]> {
  const known = await cachedLogins();
  if (!known.length) return known;
  try {
    const res = await withTimeout((async () => {
      const c = await getClient();
      const peer = await getChannelPeer();
      return c.getMessages(peer, { ids: known.map((k) => k.id) });
    })(), 12000);
    const live = new Map<number, Api.Message>();
    for (const m of res as unknown[]) if (m instanceof Api.Message) live.set(m.id, m);
    const out: LoginItem[] = [];
    const gone: number[] = [];
    const changed: LoginItem[] = [];
    for (const k of known) {
      const m = live.get(k.id);
      const lg = m ? parseLogin(m.message ?? '') : null;
      if (!m || !lg) { gone.push(k.id); continue; }
      const next: LoginItem = { ...k, user: lg.user, pass: lg.pass };
      out.push(next);
      if (lg.user !== k.user || lg.pass !== k.pass) changed.push(next);
    }
    if (gone.length) await deleteItems(gone);
    if (changed.length) await putItems(changed);
    return out;
  } catch {
    return known;
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface AdminState {
  ready: boolean;
  busy: boolean;
  user?: string;
  pass?: string;
  error?: string;
  init: () => Promise<void>;
  login: (user: string, pass: string) => Promise<boolean>;
  verify: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAdmin = create<AdminState>((set, get) => ({
  ready: false,
  busy: false,

  init: async () => {
    if (get().ready) return;
    try {
      const { value } = await Preferences.get({ key: SKEY });
      if (value) {
        const s = JSON.parse(value) as { user: string; pass: string };
        set({ user: s.user, pass: s.pass });
      }
    } catch { /* ignore */ }
    set({ ready: true });
  },

  login: async (user, pass) => {
    set({ busy: true, error: undefined });
    try {
      await useCatalog.getState().sync();
      for (let i = 0; i < 50 && useCatalog.getState().syncing; i++) await sleep(300);
      const list = await refreshLogins();
      const hit = list.find((l) => same(l.user, user) && l.pass === pass.trim());
      if (!hit) {
        set({
          busy: false,
          error: list.length
            ? 'Wrong id or password.'
            : 'No admin id found in the channel yet. Post a message like "#id1", then the id, then the password (one per line), and try again.',
        });
        return false;
      }
      await Preferences.set({ key: SKEY, value: JSON.stringify({ user: hit.user, pass: hit.pass }) });
      set({ busy: false, user: hit.user, pass: hit.pass });
      return true;
    } catch (e) {
      set({ busy: false, error: String((e as Error)?.message ?? e) });
      return false;
    }
  },

  /** called when the Admin tab opens: logs out if the id was removed or its password changed in the channel */
  verify: async () => {
    const { user, pass } = get();
    if (!user) return;
    const list = await refreshLogins();
    if (!list.some((l) => same(l.user, user) && l.pass === pass)) await get().logout();
  },

  logout: async () => {
    await Preferences.remove({ key: SKEY });
    set({ user: undefined, pass: undefined, error: undefined });
  },
}));
