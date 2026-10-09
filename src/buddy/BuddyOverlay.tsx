import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronsRight, Eye, EyeOff, KeyRound, Mic, MicOff, Power, X } from 'lucide-react';
import { useBuddy, type Gender } from '../store/buddy';
import { buddyLevel, buddyStart, buddyStop, buddyWatch } from './engine';
import { screenCaptureAvailable } from './screen';
import VoiceAiIcon from './VoiceAiIcon';
import { openMicSettings } from './mic';
import { CHAR_H, CHAR_W, LANGS, POS_BOTTOM, POS_RIGHT } from './config';
import { Chip } from '../components/ui';

const Character = lazy(() => import('./Character'));      // three.js is loaded only when Buddy is first used

export default function BuddyOverlay() {
  const { pathname } = useLocation();
  const b = useBuddy();
  const [ctl, setCtl] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef({ x: 0, y: 0, moved: false });
  const full = pathname.startsWith('/read') || pathname.startsWith('/watch');
  const on = b.status !== 'off';

  // caption fades out
  useEffect(() => {
    if (!b.caption || b.status === 'error') return;
    const t = setTimeout(() => useBuddy.getState().set({ caption: '' }), 6000);
    return () => clearTimeout(t);
  }, [b.caption, b.status]);
  useEffect(() => { if (!ctl) return; const t = setTimeout(() => setCtl(false), 4000); return () => clearTimeout(t); }, [ctl]);
  useEffect(() => () => buddyStop(), []);

  const tapFab = () => {
    if (!b.setup || !b.apiKey.trim()) { b.set({ sheet: true }); return; }
    void buddyStart();
  };

  const toggleWatch = () => {
    if (b.watching) { buddyWatch(false); return; }
    if (!localStorage.getItem('sb_buddy_watch_ok')) {
      if (!window.confirm('While "watch my screen" is on, small pictures of THIS app screen and your voice are sent to Google Gemini. Nothing outside the app is captured. Turn it on?')) return;
      try { localStorage.setItem('sb_buddy_watch_ok', '1'); } catch { /* ignore */ }
    }
    buddyWatch(true);
  };

  // ---------- floating icon ----------
  const fab = (
    <button
      onClick={tapFab}
      aria-label="Talk to Buddy"
      className="press fixed z-40 flex items-center justify-center rounded-2xl border border-white/10 bg-card text-white shadow-lg shadow-black/50"
      style={full ? { left: 8, top: '38%', width: 42, height: 42 } : { right: POS_RIGHT, bottom: POS_BOTTOM, width: 50, height: 50 }}
    >
      <VoiceAiIcon size={full ? 22 : 26} />
    </button>
  );

  // ---------- the character ----------
  const px = drag ? drag.dx : 0, py = drag ? drag.dy : 0;
  const character = (
    <div
      className="fixed z-40 select-none"
      style={{
        right: b.right, bottom: b.bottom, width: CHAR_W, height: CHAR_H, touchAction: 'none',
        transform: `translate(${px}px, ${py}px) translateX(${b.peek && !drag ? '72%' : '0'})`,
        transition: drag ? 'none' : 'transform .3s ease',
      }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); start.current = { x: e.clientX, y: e.clientY, moved: false }; setDrag({ dx: 0, dy: 0 }); }}
      onPointerMove={(e) => {
        if (!drag) return;
        const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
        if (Math.abs(dx) + Math.abs(dy) > 8) start.current.moved = true;
        setDrag({ dx, dy });
      }}
      onPointerUp={() => {
        if (!drag) return;
        if (start.current.moved) {
          const right = Math.min(window.innerWidth - CHAR_W, Math.max(0, b.right - drag.dx));
          const bottom = Math.min(window.innerHeight - CHAR_H - 40, Math.max(0, b.bottom - drag.dy));
          b.update({ right: right < 40 ? 0 : right, bottom });
        } else if (b.peek) b.set({ peek: false });
        else if (b.status === 'error') void buddyStart();
        else setCtl((v) => !v);
        setDrag(null);
      }}
    >
      {b.caption && (
        <div className="absolute bottom-full right-0 mb-1.5 rounded-2xl rounded-br-sm bg-white/95 px-3 py-2 text-[12.5px] font-medium leading-snug text-black shadow-lg" style={{ width: 'max-content', maxWidth: 'min(250px, calc(100vw - 24px))' }}>
          {b.caption}
        </div>
      )}
      {/* video-call window: the character is framed head to waist inside */}
      <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/20 bg-black shadow-xl shadow-black/60">
        <Suspense fallback={null}><Character getLevel={buddyLevel} /></Suspense>
        {b.status === 'live' && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />LIVE
          </div>
        )}
        {b.watching && !b.peek && (
          <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-green-400" aria-label="Buddy is watching your screen">
            <Eye size={11} />
          </div>
        )}
        {b.status === 'connecting' && <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] font-semibold text-white/80">Waking up…</div>}
        {!ctl && <div className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">Buddy</div>}
        {ctl && !b.peek && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-6" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <button onClick={() => b.set({ muted: !b.muted })} className="press flex h-8 w-8 items-center justify-center rounded-full bg-white/15 backdrop-blur" aria-label="Mute">
              {b.muted ? <MicOff size={16} className="text-red-400" /> : <Mic size={16} />}
            </button>
            {screenCaptureAvailable() && (
              <button onClick={toggleWatch} className="press flex h-8 w-8 items-center justify-center rounded-full bg-white/15 backdrop-blur" aria-label="Watch my screen">
                {b.watching ? <Eye size={15} className="text-green-400" /> : <EyeOff size={15} />}
              </button>
            )}
            <button onClick={() => { b.set({ peek: true }); setCtl(false); }} className="press flex h-8 w-8 items-center justify-center rounded-full bg-white/15 backdrop-blur" aria-label="Move aside"><ChevronsRight size={17} /></button>
            <button onClick={() => buddyStop()} className="press flex h-8 w-8 items-center justify-center rounded-full bg-red-600" aria-label="End"><Power size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {on ? character : fab}
      {b.caption && !on && (
        <div style={{ bottom: POS_BOTTOM + 58 }} className="fixed right-3 z-40 max-w-[230px] rounded-2xl bg-white/95 px-3 py-2 text-[12.5px] font-medium text-black shadow-lg">
          {b.caption}
          {b.micBlocked && <button onClick={() => void openMicSettings()} className="press mt-2 block w-full rounded-lg bg-accent py-1.5 text-white">Open settings</button>}
        </div>
      )}
      {b.sheet && <Sheet onClose={() => b.set({ sheet: false })} />}
    </>
  );
}

function Sheet({ onClose }: { onClose: () => void }) {
  const b = useBuddy();
  const [name, setName] = useState(b.name);
  const [gender, setGender] = useState<Gender | ''>(b.gender);
  const [age, setAge] = useState(b.age ? String(b.age) : '');
  const [lang, setLang] = useState(b.lang);
  const hasKey = !!b.apiKey.trim();
  const ageN = Number(age);
  const missing = [!name.trim() && 'name', !gender && 'gender', !(ageN >= 5 && ageN <= 99) && 'age', !hasKey && 'Gemini key'].filter(Boolean) as string[];
  const ok = missing.length === 0;

  const go = () => {
    b.update({ name: name.trim(), gender, age: ageN, lang, setup: true });
    onClose();
    void buddyStart();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={onClose}>
      <div className="max-h-[92%] w-full overflow-y-auto rounded-t-3xl bg-card p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-extrabold">Meet Buddy</h3>
          <button onClick={onClose} className="press rounded-full p-2" aria-label="Close"><X size={20} /></button>
        </div>
        <p className="mt-1 text-sm text-sub">Your study friend. Talks, explains, plays games and roasts you.</p>

        <label className="mt-4 block text-xs font-semibold text-sub">Your name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahim" className="mt-1 w-full rounded-xl bg-chip px-4 py-3 text-[15px] outline-none" />

        <label className="mt-4 block text-xs font-semibold text-sub">Gender</label>
        <div className="mt-1 flex gap-2">
          {(['male', 'female', 'other'] as Gender[]).map((g) => <Chip key={g} label={g[0].toUpperCase() + g.slice(1)} active={gender === g} onClick={() => setGender(g)} />)}
        </div>

        <label className="mt-4 block text-xs font-semibold text-sub">Age</label>
        <input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" placeholder="e.g. 19" className="mt-1 w-32 rounded-xl bg-chip px-4 py-3 text-[15px] outline-none" />

        <label className="mt-4 block text-xs font-semibold text-sub">Language Buddy speaks</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {LANGS.map((l) => <Chip key={l.code} label={l.label} active={lang === l.code} onClick={() => setLang(l.code)} />)}
        </div>

        {!hasKey && (
          <div className="mt-5 flex w-full items-center gap-3 rounded-xl border border-white/15 bg-chip p-3 text-left text-sm">
            <KeyRound size={20} className="shrink-0 text-tint" />
            <span>No Gemini key yet. Post <b>#key</b> and your key in your Telegram channel, then reopen the app.</span>
          </div>
        )}
        <button onClick={go} disabled={!ok} className="press mt-5 w-full rounded-2xl bg-accent py-4 text-base font-bold disabled:opacity-40">Start talking</button>
        {!ok && <p className="mt-2 text-center text-xs text-red-400">Still needed: {missing.join(', ')}</p>}
        <p className="mt-2 text-center text-[11px] text-sub">Your voice goes to Google Gemini while Buddy is on. The microphone will ask for permission.</p>
      </div>
    </div>
  );
}
