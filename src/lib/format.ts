import type { Progress } from '../types';

export const fmtSize = (b: number) =>
  b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB`
  : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : `${Math.max(1, Math.round(b / 1024))} KB`;

export const fmtSpeed = (bps: number) => `${(bps / 1048576).toFixed(1)} MB/s`;

export const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};

export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const pct = (p?: Progress) => (p && p.total ? Math.min(1, p.position / p.total) : 0);

export const APP_VERSION = '6.9.3';
export const CONTACT_URL = 'https://t.me/mrtuik'; // change to your Telegram link
