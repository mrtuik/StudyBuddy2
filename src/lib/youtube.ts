const ID = /^[\w-]{11}$/;

/** Extracts the 11-char video id from watch / youtu.be / shorts / live / embed links. */
export function parseYoutubeId(input?: string): string | undefined {
  if (!input) return undefined;
  const s = input.trim();
  if (!s || /\s/.test(s)) return undefined;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return undefined; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null | undefined;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    id = u.searchParams.get('v') ?? (['shorts', 'live', 'embed', 'v'].includes(parts[0]) ? parts[1] : undefined);
  }
  return id && ID.test(id) ? id : undefined;
}

export const isYoutubeUrl = (s?: string) => !!parseYoutubeId(s);
export const ytThumb = (id?: string) => (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined);
export const ytWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/* duration is only known once the player has loaded the video, so it is cached */
const DKEY = 'sb_yt_dur_v1';
const readDur = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch { return {}; } };
export const getYtDur = (id: string) => readDur()[id] ?? 0;
export function setYtDur(id: string, sec: number) {
  if (!sec || Math.abs(getYtDur(id) - sec) < 1) return;
  try { localStorage.setItem(DKEY, JSON.stringify({ ...readDur(), [id]: Math.round(sec) })); } catch { /* ignore */ }
}
export const lessonDur = (l: { duration: number; youtubeId?: string }) => l.duration || (l.youtubeId ? getYtDur(l.youtubeId) : 0);

/** First YouTube thumbnail of a course, used when the course has no cover photo. */
export const courseThumb = (c: { subjects: { chapters: { lessons: { youtubeId?: string }[] }[] }[] }) =>
  ytThumb(c.subjects.flatMap((s) => s.chapters.flatMap((ch) => ch.lessons)).find((l) => l.youtubeId)?.youtubeId);

/* IFrame Player API loader */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type W = any;
let apiP: Promise<W> | undefined;
export function loadYtApi(): Promise<W> {
  const w = window as W;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  apiP ??= new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiP = undefined; reject(new Error('YouTube could not be loaded. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return apiP;
}
