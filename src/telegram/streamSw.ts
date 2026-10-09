import { readAhead, readRange } from './media';

/** Answers byte-range requests coming from the service worker (used for direct play). */
export async function initStreaming() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', async (ev) => {
    const d = ev.data;
    const port = ev.ports?.[0];
    if (!d || d.type !== 'range' || !port) return;
    try {
      const r = await readRange(d.id, d.total, d.start, d.end + 1);
      const off = d.start - r.start;
      const out = r.data.slice(off, off + (d.end - d.start + 1));
      port.postMessage({ buffer: out.buffer }, [out.buffer]);
      readAhead(d.id, d.total, d.end, 3); // keep the next few MB ready while playing
    } catch (e) {
      port.postMessage({ error: String((e as Error)?.message ?? e) });
    }
  });
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}

/** Resolves true once this page is controlled by the streaming service worker. Never waits forever. */
export async function streamReady(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const sw = navigator.serviceWorker;
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const controlled = (ms: number) => new Promise<boolean>((resolve) => {
    if (sw.controller) { resolve(true); return; }
    const t = setTimeout(() => resolve(!!sw.controller), ms);
    sw.addEventListener('controllerchange', () => { clearTimeout(t); resolve(true); }, { once: true });
  });
  try {
    if (sw.controller) return true;
    // registration may have failed at start-up: try again, then wait (at most a few seconds) for it to take control
    let reg = await sw.getRegistration();
    if (!reg) reg = await sw.register('./sw.js');
    await Promise.race([sw.ready, wait(5000)]);
    if (await controlled(3000)) return true;
    try { await reg.update(); } catch { /* ignore */ }
    if (await controlled(2000)) return true;
    // last resort: a page that loads while a worker is active is controlled from the start, so reload once
    if (reg.active && sessionStorage.getItem('sb_sw_reload') !== '1') {
      sessionStorage.setItem('sb_sw_reload', '1');
      location.reload();
      return new Promise<boolean>(() => undefined);
    }
    return !!sw.controller;
  } catch { return false; }
}

export const streamUrl = (id: number, size: number) => `/stream/${id}?size=${size}&type=video/mp4`;
