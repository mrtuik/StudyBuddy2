import { useMemo, useState } from 'react';
import { ArrowLeftRight, Link2, ListPlus, Loader2, RefreshCw, Scissors, Trash2, Merge } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { Field, Suggest, eq, inp, one, uniq } from '../components/form';
import { ytThumb } from '../lib/youtube';
import { guessCourseSubject, guessRows, type Found, type Mode, type PlVideo, type Row } from '../lib/playlistGuess';
import { fetchPlaylist, parsePlaylistId, videosFromLines } from '../lib/playlistFetch';
import { postText } from '../telegram/poster';

const NOTE: Record<Found, string> = {
  markers: 'Chapters were found from "Unit / Chapter" numbers in the titles.',
  titles: 'Chapters were found from titles that start the same way.',
  chunks: 'The titles have no chapter hints, so the videos were cut into blocks. Rename the chapters below, or use the Split / Join buttons.',
  one: 'All videos are in one chapter.',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function PlaylistForm() {
  const { courses, sync, playlists, resyncPlaylists, syncing, error } = useCatalog();
  const [link, setLink] = useState('');
  const [paste, setPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pl, setPl] = useState<{ title: string; videos: PlVideo[] } | null>(null);
  const [course, setCourse] = useState('');
  const [subject, setSubject] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  const [n, setN] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [found, setFound] = useState<Found>('titles');
  const [done, setDone] = useState<Set<string>>(new Set());
  const [prog, setProg] = useState(0);

  // videos that are already somewhere in the channel are skipped, so nothing is posted twice
  const have = useMemo(() => new Set(courses.flatMap((c) => c.subjects.flatMap((s) => s.chapters.flatMap((ch) => ch.lessons.map((l) => l.youtubeId))))), [courses]);
  const courseList = uniq(courses.map((c) => c.title));
  const cObj = courses.find((c) => eq(c.title, course));
  const subjectList = uniq((cObj ? cObj.subjects : courses.flatMap((c) => c.subjects)).map((s) => s.title));

  const regroup = (videos: PlVideo[], m: Mode, k: number) => {
    const g = guessRows(videos, m, k);
    setRows(g.rows.map((r) => ({ ...r, skip: have.has(r.id) })));
    setFound(g.found);
  };

  async function load() {
    setMsg(null); setInfo(''); setBusy(true);
    try {
      const got = paste
        ? { title: '', videos: await videosFromLines(link, (k) => setInfo(`Reading titles ${k}...`)) }
        : await fetchPlaylist(link);
      if (!got.videos.length) throw new Error('No YouTube links found.');
      const g = guessCourseSubject(got.title, courses);
      setPl(got); setCourse(g.course); setSubject(g.subject); setDone(new Set()); setMode('auto');
      regroup(got.videos, 'auto', n);
    } catch (e) {
      setMsg({ ok: false, text: `${String((e as Error)?.message ?? e)}${paste ? '' : ' You can also paste the video links one per line (switch to "Paste links").'}` });
    } finally { setBusy(false); setInfo(''); }
  }

  const rename = (from: string, to: string) => setRows((p) => p.map((r) => (r.chapter === from ? { ...r, chapter: to } : r)));
  const retitle = (id: string, title: string) => setRows((p) => p.map((r) => (r.id === id ? { ...r, title } : r)));
  const drop = (id: string) => setRows((p) => p.filter((r) => r.id !== id));
  const toggleSplit = (i: number) => setRows((p) => {
    const prev = p[i - 1].chapter;
    const names = new Set(p.map((r) => r.chapter));
    let to = prev;
    if (p[i].chapter === prev) {   // split: this video starts a new chapter, together with everything after it that was in the same chapter
      let k = names.size + 1;
      while (names.has(`Chapter ${k}`)) k++;
      to = `Chapter ${k}`;
      return p.map((r, j) => (j >= i && r.chapter === prev ? { ...r, chapter: to } : r));
    }
    const from = p[i].chapter;     // join: the whole chapter that starts here is merged into the one above
    return p.map((r) => (r.chapter === from ? { ...r, chapter: to } : r));
  });

  const groups = useMemo(() => {
    const g: { name: string; items: { r: Row; i: number }[] }[] = [];
    rows.forEach((r, i) => {
      const last = g[g.length - 1];
      if (last && last.name === r.chapter) last.items.push({ r, i }); else g.push({ name: r.chapter, items: [{ r, i }] });
    });
    return g;
  }, [rows]);

  const todo = rows.filter((r) => !r.skip && !done.has(r.id));

  async function post() {
    setMsg(null);
    const c = one(course), s = one(subject);
    if (!c) return setMsg({ ok: false, text: 'Course is required.' });
    if (!s) return setMsg({ ok: false, text: 'Subject is required.' });
    if (!todo.length) return setMsg({ ok: false, text: 'Nothing to post.' });
    const canonC = courseList.find((x) => eq(x, c)) ?? c;
    const co = courses.find((x) => eq(x.title, canonC));
    const canonS = uniq((co ? co.subjects : []).map((x) => x.title)).find((x) => eq(x, s)) ?? s;
    const so = co?.subjects.find((x) => eq(x.title, canonS));
    const next = new Map<string, number>();   // next order number per chapter
    setBusy(true); setProg(0);
    let ok = 0;
    try {
      for (const r of todo) {
        const chRaw = one(r.chapter) || 'Lectures';
        const exist = so?.chapters.find((x) => eq(x.title, chRaw));
        const ch = exist?.title ?? chRaw;
        const key = ch.toLowerCase();
        if (!next.has(key)) next.set(key, Math.max(0, ...(exist?.lessons ?? []).map((l) => (l.order < 100000 ? l.order : 0))) + 1);
        const order = next.get(key)!;
        next.set(key, order + 1);
        await postText(`#video ${canonC} | ${canonS} | ${ch} | ${one(r.title) || 'Lesson'} | ${order} | https://youtu.be/${r.id}`);
        ok++;
        setDone((p) => new Set(p).add(r.id));
        setProg(ok / todo.length);
        await sleep(1200);                      // stay under Telegram's posting limit for channels
      }
      await sync();
      setMsg({ ok: true, text: `${ok} lessons posted to the channel.` });
    } catch (e) {
      try { await sync(); } catch { /* ignore */ }
      setMsg({ ok: false, text: `${ok} posted, then it stopped: ${String((e as Error)?.message ?? e)} Tap Post again to continue with the rest.` });
    } finally { setBusy(false); }
  }

  // one #playlist message: every phone reads the playlist itself and guesses the chapters (new videos appear by themselves)
  async function postLink() {
    setMsg(null);
    const id = parsePlaylistId(link);
    if (!id) return setMsg({ ok: false, text: 'This only works with a playlist link.' });
    setBusy(true);
    try {
      await postText(`#playlist ${[one(course), one(subject)].filter(Boolean).join(' | ')}${course || subject ? ' | ' : ''}https://www.youtube.com/playlist?list=${id}`);
      await sync();
      setMsg({ ok: true, text: 'Playlist posted as one message. Chapters are guessed by the app.' });
    } catch (e) { setMsg({ ok: false, text: String((e as Error)?.message ?? e) }); } finally { setBusy(false); }
  }

  /* ---------- step 1: the link ---------- */
  if (!pl) {
    return (
      <div className="space-y-4">
        {playlists.length > 0 && (
          <div className="space-y-2 rounded-2xl bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">Playlists in the channel</span>
              <button onClick={() => void resyncPlaylists()} disabled={syncing} className="press flex items-center gap-1.5 rounded-lg bg-chip px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />Read again
              </button>
            </div>
            {playlists.map((p) => (
              <div key={p.msgId} className="rounded-xl bg-bg/60 px-3 py-2 text-[13px]">
                <div className="font-semibold">{[p.subject || 'auto subject', p.chapter || 'auto chapters'].join(' / ')}</div>
                <div className={p.loaded ? 'text-sub' : 'text-red-300'}>
                  {p.loaded ? `${p.read} videos read, ${p.added} shown${p.title ? ` · ${p.title}` : ''}` : `not read yet · ${p.listId.slice(0, 10)}...`}
                </div>
              </div>
            ))}
            {error && <p className="text-xs text-red-300">{error}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-card p-1">
          {[false, true].map((p) => (
            <button key={String(p)} onClick={() => { setPaste(p); setLink(''); setMsg(null); }} className={`press rounded-lg py-2 text-[13px] font-bold ${paste === p ? 'bg-white text-black' : 'text-sub'}`}>
              {p ? 'Paste links' : 'Playlist link'}
            </button>
          ))}
        </div>
        {paste ? (
          <Field label="Video links (one per line, a title after the link is optional)">
            <textarea className={`${inp} min-h-[160px] resize-none`} value={link} onChange={(e) => setLink(e.target.value)} placeholder={'https://youtu.be/xxxxxxxxxxx Unit 1 Introduction\nhttps://youtu.be/yyyyyyyyyyy'} autoCapitalize="off" autoCorrect="off" />
          </Field>
        ) : (
          <Field label="YouTube playlist link">
            <input className={inp} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtube.com/playlist?list=..." autoCapitalize="off" autoCorrect="off" />
          </Field>
        )}
        {msg && <p className={`rounded-xl px-3.5 py-3 text-sm ${msg.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{msg.text}</p>}
        <button onClick={load} disabled={busy || !link.trim()} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />}{busy ? info || 'Reading playlist...' : 'Load videos'}
        </button>
      </div>
    );
  }

  /* ---------- step 2: preview ---------- */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold">{pl.title || 'Pasted links'}</p>
          <p className="text-xs text-sub">{pl.videos.length} videos{rows.some((r) => r.skip) ? `, ${rows.filter((r) => r.skip).length} already in the channel` : ''}</p>
        </div>
        <button onClick={() => { setPl(null); setRows([]); setMsg(null); }} disabled={busy} className="press shrink-0 rounded-lg bg-chip px-3 py-2 text-xs font-semibold">Change</button>
      </div>

      <Field label="Course">
        <input className={inp} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Course" />
        <Suggest list={courseList} value={course} onPick={setCourse} />
      </Field>
      <Field label="Subject">
        <input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
        <Suggest list={subjectList} value={subject} onPick={setSubject} />
      </Field>
      <button type="button" onClick={() => { setCourse(subject); setSubject(course); }} className="press flex items-center gap-2 text-xs font-semibold text-tint"><ArrowLeftRight size={14} />Swap course and subject</button>

      <div>
        <div className="mb-1.5 text-[13px] font-semibold text-sub">How to make chapters</div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-card p-1">
          {([['auto', 'Auto'], ['every', `Every ${n}`], ['one', 'One chapter']] as [Mode, string][]).map(([m, l]) => (
            <button key={m} onClick={() => { setMode(m); regroup(pl.videos, m, n); }} className={`press rounded-lg py-2 text-[13px] font-bold ${mode === m ? 'bg-white text-black' : 'text-sub'}`}>{l}</button>
          ))}
        </div>
        {mode === 'every' && (
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span className="text-sub">Videos per chapter</span>
            <button className="press h-9 w-9 rounded-lg bg-chip font-bold" onClick={() => { const k = Math.max(1, n - 1); setN(k); regroup(pl.videos, 'every', k); }}>-</button>
            <b className="w-6 text-center">{n}</b>
            <button className="press h-9 w-9 rounded-lg bg-chip font-bold" onClick={() => { const k = n + 1; setN(k); regroup(pl.videos, 'every', k); }}>+</button>
          </div>
        )}
        <p className="mt-2 text-xs leading-relaxed text-sub">{NOTE[found]} This is only a guess: check it before posting.</p>
      </div>

      <div className="space-y-3">
        {groups.map((g, gi) => (
          <div key={`${gi}:${g.name}`} className="overflow-hidden rounded-2xl bg-card">
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
              <span className="text-xs font-bold text-sub">{gi + 1}</span>
              <input className="min-w-0 flex-1 bg-transparent text-[15px] font-bold outline-none" value={g.name} onChange={(e) => rename(g.name, e.target.value)} />
              <span className="text-xs text-sub">{g.items.length}</span>
            </div>
            {g.items.map(({ r, i }, k) => (
              <div key={r.id} className={`flex items-center gap-2 px-3 py-2 ${r.skip || done.has(r.id) ? 'opacity-45' : ''}`}>
                <img src={ytThumb(r.id)} alt="" className="h-9 w-16 shrink-0 rounded bg-chip object-cover" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <input className="w-full bg-transparent text-[13px] font-semibold outline-none" value={r.title} onChange={(e) => retitle(r.id, e.target.value)} />
                  {(r.skip || done.has(r.id)) && <p className="text-[11px] text-sub">{done.has(r.id) ? 'Posted' : 'Already in the channel'}</p>}
                </div>
                {i > 0 && (
                  <button onClick={() => toggleSplit(i)} disabled={busy} className="press shrink-0 p-1.5 text-sub" aria-label={k === 0 ? 'Join with the chapter above' : 'Start a new chapter here'}>
                    {k === 0 ? <Merge size={16} /> : <Scissors size={16} />}
                  </button>
                )}
                <button onClick={() => drop(r.id)} disabled={busy} className="press shrink-0 p-1.5 text-sub" aria-label="Remove"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {busy && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-chip"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round(prog * 100)}%` }} /></div>
          <p className="mt-1.5 text-xs text-sub">Posting {Math.round(prog * todo.length)} / {todo.length}. Keep the app open.</p>
        </div>
      )}
      {msg && <p className={`rounded-xl px-3.5 py-3 text-sm ${msg.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{msg.text}</p>}
      {!paste && <button onClick={postLink} disabled={busy} className="press w-full rounded-xl bg-chip py-3 text-sm font-semibold disabled:opacity-60">Post only the playlist link (app adds new videos by itself)</button>}
      <button onClick={post} disabled={busy || !todo.length} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-60">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <ListPlus size={18} />}{busy ? 'Posting...' : `Post ${todo.length} lessons`}
      </button>
    </div>
  );
}
