import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, WifiOff } from 'lucide-react';
import { loadYtApi, ytWatchUrl } from '../lib/youtube';

const ERRORS: Record<number, string> = {
  2: 'This YouTube link is not valid.',
  5: 'YouTube could not play this video on this device.',
  100: 'This video was removed or is private.',
  101: 'The owner does not allow this video to be played inside apps.',
  150: 'The owner does not allow this video to be played inside apps.',
  153: 'YouTube blocked the embedded player for this video.',
};

interface Props {
  videoId: string;
  start: number;
  onTime: (t: number, d: number) => void;
  onEnded: () => void;
}

/** YouTube lesson player (IFrame API, privacy-friendly nocookie host). Fills its parent. */
export function YouTubeBox({ videoId, start, onTime, onEnded }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string>();
  const [online, setOnline] = useState(navigator.onLine);
  const [tick, setTick] = useState(0);
  const cb = useRef({ onTime, onEnded });
  cb.current = { onTime, onEnded };
  const startAt = useRef(start);
  startAt.current = start;

  useEffect(() => {
    const f = () => setOnline(navigator.onLine);
    window.addEventListener('online', f);
    window.addEventListener('offline', f);
    return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); };
  }, []);

  useEffect(() => {
    if (!online) return;
    let dead = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let player: any;
    let timer: number | undefined;
    setErr(undefined);
    const poll = () => {
      try {
        const d = player.getDuration?.();
        if (d > 0) cb.current.onTime(player.getCurrentTime(), d);
      } catch { /* player not ready */ }
    };
    loadYtApi().then((YT) => {
      if (dead || !host.current) return;
      host.current.innerHTML = '';
      const el = document.createElement('div');
      host.current.appendChild(el);
      player = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0, autoplay: 1, start: Math.floor(startAt.current), origin: window.location.origin },
        events: {
          onReady: poll,
          onStateChange: (e: { data: number }) => {
            if (e.data === 1 && timer === undefined) timer = window.setInterval(poll, 1000);
            if (e.data === 0) { poll(); cb.current.onEnded(); }
          },
          onError: (e: { data: number }) => setErr(ERRORS[e.data] ?? 'YouTube could not play this video.'),
        },
      });
    }).catch((e) => { if (!dead) setErr(String((e as Error)?.message ?? e)); });
    return () => {
      dead = true;
      if (timer !== undefined) clearInterval(timer);
      try { player?.destroy(); } catch { /* ignore */ }
    };
  }, [videoId, online, tick]);

  if (!online) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black px-8 text-center">
        <WifiOff size={30} className="text-white/60" />
        <p className="text-sm font-semibold">This lesson needs internet</p>
        <p className="text-xs text-sub">YouTube lessons cannot be downloaded. Connect and it will start by itself.</p>
      </div>
    );
  }
  return (
    <>
      <div ref={host} className="yt-host absolute inset-0 bg-black" />
      {err && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black px-8 text-center">
          <p className="text-sm text-red-300">{err}</p>
          <div className="flex gap-2">
            <button onClick={() => setTick((t) => t + 1)} className="press flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold"><RefreshCw size={16} /> Retry</button>
            <a href={ytWatchUrl(videoId)} target="_blank" rel="noreferrer" className="press flex h-10 items-center gap-2 rounded-lg bg-chip px-4 text-sm font-semibold"><ExternalLink size={16} /> Open in YouTube</a>
          </div>
        </div>
      )}
    </>
  );
}
