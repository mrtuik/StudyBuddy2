import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Item } from '../types';

interface StudyDB extends DBSchema {
  items: { key: number; value: Item };
  meta: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<StudyDB>> | null = null;
function db() {
  dbp ??= openDB<StudyDB>('studybuddy', 1, {
    upgrade(d) {
      d.createObjectStore('items', { keyPath: 'id' });
      d.createObjectStore('meta');
    },
  });
  return dbp;
}

export async function getAllItems(): Promise<Item[]> {
  return (await db()).getAll('items');
}
export async function putItems(items: Item[]) {
  const d = await db();
  const tx = d.transaction('items', 'readwrite');
  await Promise.all([...items.map((i) => tx.store.put(i)), tx.done]);
}
export async function deleteItems(ids: number[]) {
  const d = await db();
  const tx = d.transaction('items', 'readwrite');
  await Promise.all([...ids.map((i) => tx.store.delete(i)), tx.done]);
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined;
}
export async function setMeta(key: string, value: unknown) {
  await (await db()).put('meta', value, key);
}

export async function delMeta(key: string) {
  await (await db()).delete('meta', key);
}
