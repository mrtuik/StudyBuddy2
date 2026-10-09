import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { screenCtx } from '../lib/screenCtx';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import {
  Download, Gauge, Info, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play,
  RotateCcw, RotateCw, SkipForward, Volume2, VolumeX, X,
} from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { dlKey, localUrl, useDownloads } from '../store/downloads';
import { useLibrary } from '../store/library';
import { Bar, LessonThumb } from '../components/ui';
import { fmtDur, fmtSize, fmtSpeed } from '../lib/format';
import { streamReady, streamUrl } from '../telegram/streamSw';
import { warmVideo } from '../telegram/media';
import { YouTubeBox } from '../components/YouTubeBox';
import { lessonDur, setYtDur } from '../lib/youtube';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const glass = 'bg-white/15 backdrop-blur-md';
const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

function RoundBtn({ onClick, children, size = 'h-11 w-11' }: { onClick: (e: React.MouseEvent) => void; children: ReactNode; size?: string }) {
  return <button type="button" onClick={onClick} className={`press flex touch-manipulation items-center justify-center rounded-full ${size} ${glass}`}>{children}</button>;
}

function Pill({ children }: { children: ReactNode }) {
  return <div className={`flex items-center gap-0.5 rounded-full p-1 ${glass}`}>{children}</div>;
}

function PillBtn({ onClick, children }: { onClick: (e: React.MouseEvent) => void; children: ReactNode }) {
  return <button onClick={onClick} className="press flex h-9 w-9 items-center justify-center rounded-full">{children}</button>;
}

function Skip({ dir, big, onClick }: { dir: -1 | 1; big?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} className={`press relative flex items-center justify-center rounded-full ${glass} ${big ? 'h-16 w-16' : 'h-12 w-12'}`}>
      {dir < 0 ? <RotateCcw size={big ? 30 : 24} strokeWidth={1.8} /> : <RotateCw size={big ? 30 : 24} strokeWidth={1.8} />}
      <span className={`absolute font-bold ${big ? 'text-[11px]' : 'text-[9px]'}`}>10</span>
    </button>
  );
}

function Seek({ cur, dur, onSeek }: { cur: number; dur: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const frac = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const shown = drag ?? (dur ? cur / dur : 0);
  return (
    <div ref={ref} className="flex h-8 touch-none items-center"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDrag(frac(e)); }}
      onPointerMove={(e) => { if (drag !== null) setDrag(frac(e)); }}
      onPointerUp={(e) => { const f = frac(e); setDrag(null); if (dur) onSeek(f * dur); }}
      onPointerCancel={() => setDrag(null)}>
      <div className="relative h-1.5 w-full rounded-full bg-white/25">
        <div className="h-full rounded-full bg-white" style={{ width: `${shown * 100}%` }} />
        <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${shown * 100}%` }} />
      </div>
    </div>
  );
}

export default function VideoPlayer() {
  const { id } = useParams();
  const nav = useNavigate();
  const lid = Number(id);
  const key = `lesson:${lid}`;
  const courses = useCatalog((s) => s.courses);
  const dl = useDownloads((s) => s.items[dlKey('lesson', lid)]);
  const { add, pause, resume, remove } = useDownloads();
  const { progress, setProgress, touch } = useLibrary();

  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string>();
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [ui, setUi] = useState(true);
  const [mode, setMode] = useState<'idle' | 'stream'>('idle');
  const [errMsg, setErrMsg] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [menu, setMenu] = useState<'speed' | 'info' | null>(null);
  const [land, setLand] = useState(() => window.matchMedia('(orientation: landscape)').matches);
  const lastSave = useRef(0);
  const tap = useRef({ t: 0, x: 0 });

  const ctx = useMemo(() => {
    for (const c of courses) {
      const flat = c.subjects.flatMap((s) => s.chapters.map((ch) => ({ s, ch })).flatMap(({ s, ch }) => ch.lessons.map((l) => ({ l, s, ch }))));
      const i = flat.findIndex((x) => x.l.id === lid);
      if (i >= 0) return { course: c, lesson: flat[i].l, subject: flat[i].s.title, chapter: flat[i].ch, next: flat[i + 1]?.l };
    }
    return undefined;
  }, [courses, lid]);

  const done = dl?.status === 'done';
  useEffect(() => {
    setSrc(undefined); setMode('idle'); setErrMsg(undefined); setCur(0); setDur(0); setPlaying(false);
  }, [lid]);
  useEffect(() => {
    let on = true;
    if (done && dl && mode !== 'stream') localUrl(dl).then((u) => on && setSrc(u));
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, lid, mode]);

  useEffect(() => {
    if (ctx) touch({ key, type: 'lesson', id: lid, title: ctx.lesson.title, subtitle: ctx.course.title, coverId: ctx.course.coverMsgId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.lesson.id]);

  // tell Buddy what is on screen
  useEffect(() => {
    if (!ctx) return;
    screenCtx.set(() => {
      const t = Math.round(video.current?.currentTime ?? useLibrary.getState().progress[key]?.position ?? 0);
      return `The student is watching the lecture "${ctx.lesson.title}" (course: ${ctx.course.title}, subject: ${ctx.subject}, chapter: ${ctx.chapter.title}), at about ${Math.floor(t / 60)} min ${t % 60} sec.`;
    });
    return () => screenCtx.set(undefined);
  }, [ctx, key]);

  // warm start: connect and load the first MB before Play is tapped; while playing, warm the next lesson too
  useEffect(() => {
    const l = ctx?.lesson;
    if (!l || l.youtubeId || done) return;
    warmVideo(l.id, l.size);
    void streamReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.lesson.id, done]);
  useEffect(() => {
    const n = ctx?.next;
    if (playing && n && !n.youtubeId) warmVideo(n.id, n.size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ctx?.next?.id]);

  // follow device rotation; restore system behaviour when leaving
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const f = () => setLand(mq.matches);
    mq.addEventListener('change', f);
    return () => {
      mq.removeEventListener('change', f);
      if (Capacitor.isNativePlatform()) {
        ScreenOrientation.unlock().catch(() => undefined);
        StatusBar.show().catch(() => undefined);
      }
    };
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (land ? StatusBar.hide() : StatusBar.show()).catch(() => undefined);
  }, [land]);

  // auto-hide controls while playing
  useEffect(() => {
    if (!ui || !playing || menu) return;
    const t = setTimeout(() => setUi(false), 3500);
    return () => clearTimeout(t);
  }, [ui, playing, menu]);

  // Telegram lessons start streaming by themselves: no second tap on Play
  const autoFor = useRef<number>();
  useEffect(() => {
    const l = ctx?.lesson;
    if (!l || l.youtubeId || done || mode !== 'idle' || autoFor.current === lid) return;
    autoFor.current = lid;
    let alive = true;
    (async () => {
      setStarting(true); setErrMsg(undefined);
      const ok = await streamReady();
      if (!alive) return;
      setStarting(false);
      if (!ok) { setErrMsg('Direct play is not available right now. Tap Play to retry, or download the lesson.'); return; }
      setMode('stream');
      setSrc(streamUrl(lid, l.size));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.lesson.id, done, mode]);

  if (!ctx) return <div className="flex h-full items-center justify-center bg-black text-sub">Loading…</div>;
  const { lesson, course, chapter, subject, next } = ctx;
  const yt = lesson.youtubeId;
  const savedP = progress[key];
  const ytStart = savedP && savedP.total && savedP.position < savedP.total - 5 ? savedP.position : 0;
  const metaLine = yt ? `${fmtDur(lessonDur(lesson))} · YouTube · Online only` : `${fmtDur(lesson.duration || dur)} · ${fmtSize(lesson.size)}`;
  const dp = dl ? dl.bytes / Math.max(1, dl.size) : 0;
  const pipOk = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;

  // close: go back, or to the course list if this screen was opened directly
  // always works: stop and release the video first, then leave; if going back lands on this same page, go to the course list
  const goBack = () => {
    const v = video.current;
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* ignore */ } }
    const here = window.location.hash;
    if ((window.history.state?.idx ?? 0) > 0) nav(-1); else nav('/videos', { replace: true });
    window.setTimeout(() => { if (window.location.hash === here) nav('/videos', { replace: true }); }, 350);
  };
  const poke = () => setUi(true);
  const toggle = () => { const v = video.current; if (v) { poke(); if (v.paused) void v.play(); else v.pause(); } };
  const seekBy = (d: number) => { const v = video.current; if (v) { poke(); v.currentTime = Math.min(v.duration || Infinity, Math.max(0, v.currentTime + d)); } };
  const seekTo = (t: number) => { const v = video.current; if (v) { v.currentTime = t; setCur(t); poke(); } };
  const goNext = () => { if (next) nav(`/watch/${next.id}`, { replace: true }); };
  const setRate = (r: number) => { setSpeed(r); if (video.current) video.current.playbackRate = r; setMenu(null); };
  const toggleFull = async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (land) { await ScreenOrientation.lock({ orientation: 'portrait' }); setTimeout(() => ScreenOrientation.unlock().catch(() => undefined), 700); }
      else await ScreenOrientation.lock({ orientation: 'landscape' });
    } catch { /* ignore */ }
  };
  const setVolume = (v: number) => { setVol(v); if (video.current) video.current.volume = v; };

  // single tap toggles controls, double tap on the sides seeks 10s
  const onSurface = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const now = Date.now();
    if (now - tap.current.t < 280 && (x < 0.35 || x > 0.65) && Math.abs(x - tap.current.x) < 0.2) {
      seekBy(x < 0.5 ? -10 : 10);
      tap.current.t = 0;
      return;
    }
    tap.current = { t: now, x };
    setMenu(null);
    setUi((u) => !u);
  };

  const startStream = async () => {
    if (starting) return;
    setStarting(true);
    setErrMsg(undefined);
    const ok = await streamReady();
    setStarting(false);
    if (!ok) { setErrMsg('Direct play is not available on this device. Please download the lesson instead.'); return; }
    setMode('stream');
    setSrc(streamUrl(lid, lesson.size));
  };

  const running = dl?.status === 'running' || dl?.status === 'queued';
  const small = 'press flex h-9 w-9 items-center justify-center rounded-lg bg-chip';
  const downloadCard = (
    <div className="mt-4 rounded-xl border border-white/10 bg-card p-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-chip">
          <Download size={18} className="text-tint" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {!dl ? 'Save for offline' : dl.status === 'error' ? 'Download failed' : dl.status === 'paused' ? 'Paused'
              : dl.bytes === 0 && dl.stage ? dl.stage : 'Downloading'}
          </div>
          <div className="truncate text-xs text-sub">
            {!dl ? `${fmtSize(lesson.size)} · watch without internet`
              : `${fmtSize(dl.bytes)} of ${fmtSize(dl.size)}${running && dl.speed ? ` · ${fmtSpeed(dl.speed)}` : ''}`}
          </div>
        </div>
        {!dl && <button onClick={() => add('lesson', lid, lesson.title, lesson.size)} className="press h-9 rounded-lg bg-accent px-4 text-sm font-semibold">Download</button>}
        {dl && dl.status !== 'done' && (
          <div className="flex gap-1.5">
            <button onClick={() => (running ? pause(dl.key) : resume(dl.key))} className={small} aria-label={running ? 'Pause' : 'Resume'}>
              {running ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={() => remove(dl.key)} className={small} aria-label="Cancel"><X size={16} /></button>
          </div>
        )}
      </div>
      {dl && dl.status !== 'done' && <Bar value={dp} className="mt-3" />}
      {dl?.status === 'error' && dl.error && <p className="mt-2 break-words text-xs text-red-300">{dl.error}</p>}
    </div>
  );

  const poster = (
    <>
      <LessonThumb id={lesson.id} yt={lesson.youtubeId} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-black/45" />
      <div className="absolute left-3 top-3 z-20"><RoundBtn onClick={stop(goBack)}><X size={22} /></RoundBtn></div>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        <button onClick={startStream} className={`press pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full ${glass}`} aria-label="Play now">
          {starting ? <Loader2 size={28} className="animate-spin" /> : <Play size={28} fill="currentColor" />}
        </button>
        <span className="text-xs font-semibold text-white/85">{starting ? 'Starting…' : errMsg ? 'Tap to retry' : 'Play now'}</span>
      </div>
    </>
  );

  const nextBtn = next && (
    <PillBtn onClick={stop(goNext)}><SkipForward size={19} /></PillBtn>
  );

  return (
    <div className={`h-full bg-black ${land ? 'relative' : 'flex flex-col'}`}>
      <div className={land ? 'absolute inset-0' : 'relative aspect-video w-full shrink-0 bg-black'}>
        {yt ? (
          <>
            <YouTubeBox key={lesson.id} videoId={yt} start={ytStart}
              onTime={(t, d) => {
                setYtDur(yt, d);
                if (Date.now() - lastSave.current > 4000) { lastSave.current = Date.now(); setProgress(key, t, d); }
              }}
              onEnded={() => { setProgress(key, 1, 1); goNext(); }} />
            <div className="absolute left-3 top-3 z-20 flex gap-2 opacity-80">
              <RoundBtn size="h-11 w-11" onClick={stop(goBack)}><X size={20} /></RoundBtn>
              {Capacitor.isNativePlatform() && <RoundBtn size="h-11 w-11" onClick={stop(toggleFull)}>{land ? <Minimize size={20} /> : <Maximize size={20} />}</RoundBtn>}
            </div>
          </>
        ) : src ? (
          <>
            <video ref={video} src={src} playsInline autoPlay className="absolute inset-0 h-full w-full bg-black object-contain"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setDur(v.duration || 0);
                const p = progress[key];
                if (p && p.total && p.position < p.total - 5) v.currentTime = p.position;
                v.playbackRate = speed;
              }}
              onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                setCur(v.currentTime);
                if (v.duration && Date.now() - lastSave.current > 4000) { lastSave.current = Date.now(); setProgress(key, v.currentTime, v.duration); }
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => { setProgress(key, 1, 1); goNext(); }}
              onError={() => {
                if (mode === 'stream') { setSrc(undefined); setMode('idle'); setErrMsg('Could not play this video directly. Check your connection or download it instead.'); }
              }} />

            <div className="absolute inset-0 select-none" onClick={onSurface}>
              <div className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${ui ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                {/* top bar */}
                <div className="absolute left-3 right-3 top-3 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <RoundBtn onClick={stop(goBack)}><X size={22} /></RoundBtn>
                    {(pipOk || land) && (
                      <Pill>
                        {pipOk && <PillBtn onClick={stop(() => { video.current?.requestPictureInPicture().catch(() => undefined); })}><PictureInPicture2 size={19} /></PillBtn>}
                        {land && <PillBtn onClick={stop(() => setMenu('info'))}><Info size={19} /></PillBtn>}
                      </Pill>
                    )}
                  </div>
                  {land && (
                    <div className={`flex items-center gap-2 rounded-full px-3 py-2.5 ${glass}`} onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setVolume(vol > 0 ? 0 : 1)}>{vol === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
                      <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVolume(Number(e.target.value))} className="h-1 w-28 accent-white" />
                    </div>
                  )}
                </div>

                {/* centre controls */}
                <div className={`absolute inset-0 flex items-center justify-center ${land ? 'gap-14' : 'gap-7'}`}>
                  <Skip dir={-1} big={land} onClick={stop(() => seekBy(-10))} />
                  <button onClick={stop(toggle)} className={`press flex items-center justify-center rounded-full ${glass} ${land ? 'h-24 w-24' : 'h-16 w-16'}`}>
                    {playing ? <Pause size={land ? 40 : 28} fill="currentColor" /> : <Play size={land ? 40 : 28} fill="currentColor" />}
                  </button>
                  <Skip dir={1} big={land} onClick={stop(() => seekBy(10))} />
                </div>

                {/* bottom */}
                <div className="absolute inset-x-4 bottom-2">
                  {land && (
                    <div className="flex items-end justify-between">
                      <div className="min-w-0 pr-4">
                        <div className="truncate text-xs text-white/70">{course.title} · {chapter.title}</div>
                        <div className="truncate text-2xl font-extrabold">{lesson.title}</div>
                      </div>
                      <Pill>
                        {nextBtn}
                        <PillBtn onClick={stop(() => setMenu(menu === 'speed' ? null : 'speed'))}><Gauge size={19} /></PillBtn>
                        <PillBtn onClick={stop(toggleFull)}><Minimize size={19} /></PillBtn>
                      </Pill>
                    </div>
                  )}
                  <Seek cur={cur} dur={dur} onSeek={seekTo} />
                  <div className="flex items-center justify-between text-xs font-semibold text-white/80">
                    <span>{fmtDur(cur)}</span>
                    {!land && (
                      <Pill>
                        {nextBtn}
                        <PillBtn onClick={stop(() => setMenu(menu === 'speed' ? null : 'speed'))}><Gauge size={19} /></PillBtn>
                        <PillBtn onClick={stop(toggleFull)}><Maximize size={19} /></PillBtn>
                      </Pill>
                    )}
                    <span>-{fmtDur(Math.max(0, dur - cur))}</span>
                  </div>
                  {land && (
                    <div className="mt-2 flex gap-2 pb-1">
                      <button onClick={stop(() => setMenu('info'))} className={`press rounded-full px-5 py-2.5 text-sm font-semibold ${glass}`}>Info</button>
                      {next && <button onClick={stop(goNext)} className={`press max-w-[60%] truncate rounded-full px-5 py-2.5 text-sm font-semibold ${glass}`}>Next: {next.title}</button>}
                    </div>
                  )}
                </div>

                {menu === 'speed' && (
                  <div className="absolute bottom-24 right-4 flex flex-col rounded-2xl bg-card p-1.5" onClick={(e) => e.stopPropagation()}>
                    {SPEEDS.map((s) => (
                      <button key={s} onClick={() => setRate(s)} className={`rounded-xl px-6 py-2 text-left text-sm font-bold ${s === speed ? 'bg-white text-black' : ''}`}>{s}x</button>
                    ))}
                  </div>
                )}
              </div>

              {menu === 'info' && (
                <div className="absolute inset-0 z-20 flex items-end bg-black/60" onClick={stop(() => setMenu(null))}>
                  <div className="w-full rounded-t-3xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <h3 className="text-lg font-extrabold leading-tight">{lesson.title}</h3>
                      <button onClick={() => setMenu(null)} className="rounded-full bg-chip p-2"><X size={16} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div><div className="text-xs text-sub">Course</div>{course.title}</div>
                      <div><div className="text-xs text-sub">Subject</div>{subject}</div>
                      <div><div className="text-xs text-sub">Chapter</div>{chapter.title}</div>
                      <div><div className="text-xs text-sub">Length</div>{metaLine}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          poster
        )}
      </div>

      {!land && (
        <div className="flex-1 overflow-y-auto bg-bg px-4 pb-6 pt-4">
          <h1 className="text-xl font-extrabold leading-tight">{lesson.title}</h1>
          <p className="mt-1 text-sm text-sub">{course.title} · {subject} · {chapter.title}</p>
          <p className="mt-0.5 text-xs text-sub">{metaLine}</p>

          {errMsg && <p className="mt-3 rounded-lg bg-card p-3 text-xs text-red-300">{errMsg}</p>}
          {!done && !yt && downloadCard}

          {next && (
            <button onClick={goNext} className="press mt-5 flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left">
              <div className="rounded-full bg-accent p-2.5"><SkipForward size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-sub">Up next</div>
                <div className="break-words font-bold leading-snug">{next.title}</div>
              </div>
            </button>
          )}

          <h2 className="mb-2 mt-6 text-lg font-extrabold">More in this chapter</h2>
          <div className="space-y-1">
            {chapter.lessons.map((l) => {
              const cur = l.id === lid;
              const d = l.youtubeId ? lessonDur(l) : l.duration;
              return (
                <button key={l.id} onClick={() => !cur && nav(`/watch/${l.id}`, { replace: true })}
                  className={`press flex w-full items-start gap-3 rounded-xl p-2.5 text-left ${cur ? 'bg-card' : ''}`}>
                  <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-chip">
                    <LessonThumb id={l.id} yt={l.youtubeId} className="h-full w-full" />
                    {cur && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                        <div className="rounded-full bg-accent p-1.5">{playing ? <Pause size={14} /> : <Play size={14} />}</div>
                      </div>
                    )}
                    {d > 0 && <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] font-semibold">{fmtDur(d)}</span>}
                  </div>
                  <div className="min-w-0 flex-1 py-0.5">
                    <div className="break-words text-[14px] font-semibold leading-snug">{l.title}</div>
                    <div className="mt-1 text-xs text-sub">{l.youtubeId ? 'YouTube' : cur ? 'Now playing' : ''}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
