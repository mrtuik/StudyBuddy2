/* Serves /stream/<messageId>?size=N as a seekable video by asking the app for byte ranges. */
const CAP = 4 * 1024 * 1024;
const FIRST = 1024 * 1024; // answer the first request after one chunk so playback starts without waiting for 4 MB

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/stream/')) return;
  event.respondWith(serve(event, url));
});

async function pickClient(event) {
  if (event.clientId) {
    const c = await self.clients.get(event.clientId);
    if (c) return c;
  }
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all[0];
}

async function serve(event, url) {
  try {
    const id = Number(url.pathname.split('/')[2]);
    const total = Number(url.searchParams.get('size'));
    const type = url.searchParams.get('type') || 'video/mp4';
    const m = /bytes=(\d*)-(\d*)/.exec(event.request.headers.get('range') || '');
    let start = 0;
    let end = total - 1;
    if (m) {
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Number(m[2]); }
      else if (m[2]) { start = Math.max(0, total - Number(m[2])); }
    }
    if (start >= total) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
    end = Math.min(end, total - 1, start + (start < FIRST ? FIRST : CAP) - 1);

    const client = await pickClient(event);
    if (!client) return new Response('No client', { status: 503 });

    const buf = await new Promise((resolve, reject) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => reject(new Error('timeout')), 60000);
      ch.port1.onmessage = (e) => {
        clearTimeout(t);
        if (e.data && e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.buffer);
      };
      client.postMessage({ type: 'range', id, total, start, end }, [ch.port2]);
    });

    return new Response(buf, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(buf.byteLength),
        'Content-Range': 'bytes ' + start + '-' + (start + buf.byteLength - 1) + '/' + total,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (e) {
    return new Response(String(e), { status: 502 });
  }
}
