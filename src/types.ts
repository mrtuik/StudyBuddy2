export type MsgId = number;

/** lessons that come from a #playlist post have no Telegram message: their id is built from the YouTube id and is always above this */
export const PL_BASE = 4_000_000_000;
export const isPlLesson = (id: number) => id >= PL_BASE;
export function plLessonId(ytId: string): number {
  let h = 2166136261;                                  // FNV-1a
  for (let i = 0; i < ytId.length; i++) { h ^= ytId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return PL_BASE + (h % 900_000_000);
}

export interface Book {
  id: MsgId;
  title: string;
  subject: string;
  author?: string;
  size: number;
  coverMsgId?: MsgId;
  date: number;
}

export interface Lesson {
  id: MsgId;
  title: string;
  order: number;
  duration: number;
  size: number;
  thumbMsgId?: MsgId;
  youtubeId?: string; // set for YouTube lessons (no Telegram file)
  date?: number;
}
export interface Chapter { id: string; title: string; lessons: Lesson[]; }
export interface Subject { id: string; title: string; chapters: Chapter[]; }
export interface Course {
  id: string;
  title: string;
  description?: string;
  coverMsgId?: MsgId;
  msgId?: MsgId; // the #course message (edit / delete from Admin)
  subjects: Subject[];
}

export interface Notice { id: MsgId; title: string; body: string; date: number; }

export interface Progress {
  key: string;
  position: number;
  total: number;
  updatedAt: number;
}

export interface DownloadItem {
  key: string;
  path: string;
  bytes: number;
  size: number;
  status: 'queued' | 'running' | 'paused' | 'done' | 'error';
}

// Raw parsed Telegram messages (stored in IndexedDB, catalog is built from these)
export type Item =
  | { kind: 'book'; id: MsgId; date: number; title: string; subject: string; author?: string; size: number }
  | { kind: 'video'; id: MsgId; date: number; course: string; subject: string; chapter: string; title: string; order: number; duration: number; size: number; youtubeId?: string }
  | { kind: 'playlist'; id: MsgId; date: number; listId: string; course: string; subject: string; chapter: string; mode: 'auto' | 'one' | number; range?: [number, number] }
  | { kind: 'course'; id: MsgId; date: number; title: string; description?: string; hasCover: boolean }
  | { kind: 'notice'; id: MsgId; date: number; title: string; body: string }
  | { kind: 'login'; id: MsgId; date: number; user: string; pass: string }
  | { kind: 'cover'; id: MsgId; date: number; replyTo: MsgId };

/** one #playlist post and what the app made of it (shown in Admin > Playlist) */
export interface PlaylistInfo { msgId: number; listId: string; course: string; subject: string; chapter: string; title: string; read: number; added: number; loaded: boolean }
