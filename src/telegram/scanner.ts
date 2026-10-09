import { Api } from 'telegram';
import { getClient, getChannelPeer } from './client';
import { messageToItem } from './parser';
import { deleteItems, getAllItems, getMeta, putItems, setMeta } from '../db/idb';
import type { Item } from '../types';

const BATCH = 100;
const RECHECK = 200;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

async function withFlood<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 4; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = /FLOOD_WAIT_(\d+)/.exec(String((e as Error)?.message ?? e));
      if (!m) throw e;
      await new Promise((r) => setTimeout(r, (Number(m[1]) + 1) * 1000));
    }
  }
  return fn();
}

async function fetchIds(ids: number[]): Promise<Api.Message[]> {
  const c = await getClient();
  const peer = await getChannelPeer();
  const res = await withFlood(() => c.getMessages(peer, { ids }));
  return (res as unknown[]).filter((m): m is Api.Message => m instanceof Api.Message);
}

const fetchRange = (from: number, to: number) => fetchIds(range(from, to));

/**
 * Bots cannot use getHistory, so we walk message IDs.
 * 1) re-check last 200 IDs for edits/deletes  2) scan forward until two empty batches.
 * Returns number of new/changed items.
 */
export async function syncCatalog(onProgress?: (scannedId: number) => void): Promise<number> {
  let last = (await getMeta<number>('lastScannedId')) ?? 0;
  let changed = 0;

  // re-check every known item plus the last 200 ids: edits show up, deleted or un-tagged messages disappear
  const stored = await getAllItems();
  const storedIds = new Set(stored.map((i) => i.id));
  const check = new Set(storedIds);
  if (last > 0) for (let id = Math.max(1, last - RECHECK + 1); id <= last; id++) check.add(id);
  const ids = [...check].sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const msgs = await fetchIds(chunk);
    const present = new Set(msgs.map((m) => m.id));
    const drop = chunk.filter((id) => !present.has(id));
    const items: Item[] = [];
    for (const m of msgs) {
      const it = messageToItem(m);
      if (it) items.push(it);
      else if (storedIds.has(m.id)) drop.push(m.id);
    }
    if (drop.length) await deleteItems(drop);
    if (items.length) await putItems(items);
  }

  let cursor = last + 1;
  let misses = 0;
  while (misses < 2) {
    const msgs = await fetchRange(cursor, cursor + BATCH - 1);
    cursor += BATCH;
    if (!msgs.length) {
      misses++;
      continue;
    }
    misses = 0;
    const items = msgs.map(messageToItem).filter((x): x is Item => !!x);
    if (items.length) {
      await putItems(items);
      changed += items.length;
    }
    last = Math.max(last, ...msgs.map((m) => m.id));
    await setMeta('lastScannedId', last);
    onProgress?.(last);
  }
  return changed;
}
