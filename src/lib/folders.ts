import type { Book } from '../types';

export interface Folder { name: string; books: Book[]; size: number; covers: (number | undefined)[]; }

export const folderKey = (name: string) => `folder:${name}`;
export const courseKey = (id: string) => `course:${id}`;
export const ALL_FOLDER = '__all';
export const folderLink = (name: string) => `/books?subject=${encodeURIComponent(name)}`;

/** one folder per book subject (the #hashtag / category the book was posted with) */
export function buildFolders(books: Book[]): Folder[] {
  const map = new Map<string, Book[]>();
  for (const b of books) {
    const list = map.get(b.subject);
    if (list) list.push(b); else map.set(b.subject, [b]);
  }
  return [...map.entries()].map(([name, list]) => ({
    name,
    books: list,
    size: list.reduce((n, b) => n + b.size, 0),
    covers: list.map((b) => b.coverMsgId),
  }));
}
