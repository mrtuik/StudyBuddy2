import { useState } from 'react';
import { Check, ChevronDown, KeyRound, Trash2 } from 'lucide-react';
import VoiceAiIcon from './VoiceAiIcon';
import { useBuddyMemory } from '../store/buddyMemory';
import { useBuddy, DEFAULT_MODEL, type Gender } from '../store/buddy';
import { LANGS, MODEL_HINTS, VOICES } from './config';
import { Chip } from '../components/ui';

/** Profile > Buddy: Gemini API key and the student's details */
export default function BuddySettings() {
  const b = useBuddy();
  const mem = useBuddyMemory();
  const [many, setMany] = useState(30);
  const ready = b.setup && !!b.name.trim() && !!b.gender && b.age >= 5;
  const [open, setOpen] = useState(!ready);          // set up already -> collapsed
  const [memOpen, setMemOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const missing = [!b.name.trim() && 'name', !b.gender && 'gender', !(b.age >= 5 && b.age <= 99) && 'age'].filter(Boolean) as string[];

  const done = () => {
    if (missing.length) return;
    b.update({ setup: true });
    setOpen(false); setMemOpen(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const lab = 'mt-4 block text-xs font-semibold text-sub';
  const inp = 'mt-1 w-full rounded-xl bg-chip px-4 py-3 text-[15px] outline-none';
  return (
    <>
      <h2 className="mb-3 mt-7 text-lg font-bold tracking-tight">Buddy (voice friend)</h2>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-card">
        <button onClick={() => setOpen(!open)} className="press flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-chip"><VoiceAiIcon size={24} /></div>
          <div className="min-w-0 flex-1">
            <div className="font-bold leading-tight">{ready ? (b.name.trim() || 'Buddy') : 'Setup Your Profile'}</div>
            <div className="truncate text-xs text-sub">
              {saved ? <span className="inline-flex items-center gap-1 text-green-400"><Check size={13} /> Saved</span>
                : ready ? `${LANGS.find((l) => l.code === b.lang)?.label ?? ''} · Roast ${b.roast}/5 · tap to edit` : 'Add your details'}
            </div>
          </div>
          <ChevronDown size={20} className={`shrink-0 text-sub transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </button>

        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="min-h-0 overflow-hidden" aria-hidden={!open}>
            <div className="border-t border-white/10 px-4 pb-4 pt-4">
        <div className="flex items-start gap-3 rounded-xl bg-chip p-3 text-sm">
          <KeyRound size={18} className={`mt-0.5 shrink-0 ${b.apiKey.trim() ? 'text-green-400' : 'text-sub'}`} />
          <span className="min-w-0 flex-1">
            {b.apiKey.trim()
              ? <>Gemini key found in your channel <span className="text-green-400">✓</span></>
              : <>No Gemini key yet. Post <b>#key</b> and your key in your Telegram channel, then pull to refresh.</>}
          </span>
        </div>

        <label className={lab}>Name</label>
        <input value={b.name} onChange={(e) => b.update({ name: e.target.value })} className={inp} />
        <label className={lab}>Gender</label>
        <div className="mt-1 flex gap-2">
          {(['male', 'female', 'other'] as Gender[]).map((g) => <Chip key={g} label={g[0].toUpperCase() + g.slice(1)} active={b.gender === g} onClick={() => b.update({ gender: g })} />)}
        </div>
        <label className={lab}>Age</label>
        <input value={b.age || ''} inputMode="numeric" onChange={(e) => b.update({ age: Number(e.target.value.replace(/\D/g, '').slice(0, 2)) })} className={`${inp} w-28`} />
        <label className={lab}>Language</label>
        <div className="mt-1 flex flex-wrap gap-2">{LANGS.map((l) => <Chip key={l.code} label={l.label} active={b.lang === l.code} onClick={() => b.update({ lang: l.code })} />)}</div>
        <label className={lab}>Roast level: {b.roast} / 5</label>
        <div className="mt-1 flex gap-2">{[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={String(n)} active={b.roast === n} onClick={() => b.update({ roast: n })} />)}</div>
        <label className={lab}>Voice</label>
        <div className="mt-1 flex flex-wrap gap-2">{VOICES.map((v) => <Chip key={v} label={v} active={b.voice === v} onClick={() => b.update({ voice: v })} />)}</div>
        <label className={lab}>Model (advanced)</label>
        <input value={b.model} onChange={(e) => b.update({ model: e.target.value })} autoCapitalize="none" spellCheck={false} className={inp} />
        <p className="mt-1 text-[11px] text-sub">If Buddy says the model is not available, try: {MODEL_HINTS.join(' or ')}.</p>
        <button onClick={() => { b.update({ model: DEFAULT_MODEL }); b.resetPos(); }} className="press mt-3 rounded-lg bg-chip px-4 py-2 text-sm font-semibold">Reset model and position</button>

        {/* memory: nested, collapsed */}
        <div className="mt-5 overflow-hidden rounded-xl bg-chip">
          <button onClick={() => setMemOpen(!memOpen)} className="press flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold" aria-expanded={memOpen}>
            <span>What Buddy remembers{mem.notes.length ? ` (${mem.notes.length})` : ''}</span>
            <ChevronDown size={18} className={`text-sub transition-transform duration-300 ${memOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${memOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="min-h-0 overflow-hidden">
              <div className="px-4 pb-4">
        {!mem.notes.length ? (
          <p className="text-sm text-sub">Nothing yet. Buddy saves short notes while you talk (weak topics, exam date, jokes). They stay only on this phone and are never deleted unless you delete them.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-sub">{mem.notes.length} memories · {mem.sessions} chat{mem.sessions === 1 ? '' : 's'} so far</p>
            <ul className="divide-y divide-white/10">
              {[...mem.notes].reverse().slice(0, many).map((n) => (
                <li key={n.id} className="flex items-start gap-3 py-2.5">
                  <span className="min-w-0 flex-1 break-words text-sm">{n.text}</span>
                  <button onClick={() => mem.remove(n.id)} className="press shrink-0 p-1 text-sub" aria-label="Forget"><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
            {mem.notes.length > many && <button onClick={() => setMany(many + 30)} className="press mt-2 text-sm font-semibold text-tint">Show more ({mem.notes.length - many} older)</button>}
            <button onClick={() => { if (window.confirm('Make Buddy forget everything?')) mem.clear(); }} className="press mt-3 rounded-lg bg-chip px-4 py-2 text-sm font-semibold text-red-400">Forget everything</button>
          </>
        )}
              </div>
            </div>
          </div>
        </div>

        <button onClick={done} disabled={missing.length > 0} className="press mt-5 w-full rounded-2xl bg-accent py-3.5 text-base font-bold disabled:opacity-40">Save</button>
        {missing.length > 0 && <p className="mt-2 text-center text-xs text-red-400">Still needed: {missing.join(', ')}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
