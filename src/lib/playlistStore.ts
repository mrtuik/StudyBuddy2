// Keeps the video list of every playlist named in a #playlist post on the phone, so lessons also show offline.
import { getMeta, setMeta } from '../db/idb';
import { fetchPlaylist } from './playlistFetch';
import type { PlVideo } from './playlistGuess';
import type { Item } from '../types';

export interface PlCache { title: string; videos: PlVideo[]; at: number }
const key = (id: string) => `pl:${id}`;
const FRESH = 6 * 3600 * 1000;           // new videos added to the playlist show up within 6 hours (or on a manual Sync after that)

export const readPlaylists = async (items: Item[]): Promise<Record<string, PlCache>> => {
  const out: Record<string, PlCache> = {};
  for (const i of items) {
    if (i.kind !== 'playlist' || out[i.listId]) continue;
    const c = await getMeta<PlCache>(key(i.listId));
    if (c) out[i.listId] = c;
  }
  return out;
};

/** downloads the playlists that are missing or old. Returns a message when one could not be read. */
export async function refreshPlaylists(items: Item[], force = false): Promise<string | undefined> {
  let err: string | undefined;
  const ids = [...new Set(items.flatMap((i) => (i.kind === 'playlist' ? [i.listId] : [])))];
  for (const id of ids) {
    const old = await getMeta<PlCache>(key(id));
    if (old && !force && Date.now() - old.at < FRESH) continue;
    try {
      const got = await fetchPlaylist(id);
      await setMeta(key(id), { ...got, at: Date.now() } satisfies PlCache);
    } catch (e) {
      if (!old || force) err = `Playlist ${id.slice(0, 8)}... could not be read: ${String((e as Error)?.message ?? e)}`;
    }
  }
  return err;
}
