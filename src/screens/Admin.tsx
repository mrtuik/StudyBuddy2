import { useEffect, useState } from 'react';
import { BookOpen, Bell, Film, GraduationCap, Image as ImageIcon, KeyRound, ListVideo, Loader2, LogOut, Paperclip, PlayCircle, ShieldCheck } from 'lucide-react';
import { useAdmin } from '../store/admin';
import { useCatalog } from '../store/catalog';
import { Bar } from '../components/ui';
import { Field, Pick, Suggest, eq, inp, multi, one, uniq } from '../components/form';
import Manage from './AdminManage';
import PlaylistForm from './AdminPlaylist';
import { fmtSize } from '../lib/format';
import { parseYoutubeId } from '../lib/youtube';
import { connectPoster, forgetPoster, getPosterToken, postFile, postPhoto, postText, readVideoMeta } from '../telegram/poster';

type Kind = 'book' | 'video' | 'yt' | 'playlist' | 'course' | 'notice';
const KINDS: { k: Kind; label: string; Icon: typeof BookOpen }[] = [
  { k: 'book', label: 'Book', Icon: BookOpen },
  { k: 'video', label: 'Video', Icon: Film },
  { k: 'yt', label: 'YouTube', Icon: PlayCircle },
  { k: 'playlist', label: 'Playlist', Icon: ListVideo },
  { k: 'course', label: 'Course', Icon: GraduationCap },
  { k: 'notice', label: 'Notice', Icon: Bell },
];

const BIG = 200 * 1048576;

function PostForm({ kind, initial }: { kind: Kind; initial?: Record<string, string> }) {
  const { books, courses, sync } = useCatalog();
  const [v, setV] = useState<Record<string, string>>(initial ?? {});
  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  // suggestions come from what is already in the channel
  const course = courses.find((c) => eq(c.title, v.course));
  const subj = course?.subjects.find((s) => eq(s.title, v.subject));
  const chap = subj?.chapters.find((c) => eq(c.title, v.chapter));
  const courseList = uniq(courses.map((c) => c.title));
  const subjectList = uniq((course ? course.subjects : courses.flatMap((c) => c.subjects)).map((s) => s.title));
  const chapterList = uniq((subj ? subj.chapters : course ? course.subjects.flatMap((s) => s.chapters) : courses.flatMap((c) => c.subjects.flatMap((s) => s.chapters))).map((c) => c.title));
  const bookSubjects = uniq(books.map((b) => b.subject));
  const autoOrder = chap ? Math.max(0, ...chap.lessons.map((l) => (l.order < 100000 ? l.order : 0))) + 1 : 1;

  const canon = (val: string, list: string[]) => list.find((x) => eq(x, val)) ?? val;
  const need = (val: string, name: string) => { if (!val) throw new Error(`${name} is required.`); return val; };

  async function submit() {
    setMsg(null);
    try {
      let id = 0;
      if (kind === 'book') {
        if (!file) throw new Error('Choose the PDF file.');
        const title = need(one(v.title), 'Title');
        const subject = canon(need(one(v.subject), 'Subject'), bookSubjects);
        const author = one(v.author);
        const cap = `#book ${title} | ${subject}${author ? ` | ${author}` : ''}`;
        setBusy(true); setProg(0);
        id = await postFile(file, cap, { onProgress: setProg });
        if (cover) {
          try { await postPhoto(cover, { replyTo: id }); } catch (e) {
            await sync();
            throw new Error(`The book was posted, but its cover failed: ${String((e as Error)?.message ?? e)} You can add the cover later from Manage.`);
          }
        }
      } else if (kind === 'video' || kind === 'yt') {
        const c = canon(need(one(v.course), 'Course'), courseList);
        const s = canon(need(one(v.subject), 'Subject'), subjectList);
        const ch = canon(need(one(v.chapter), 'Chapter'), chapterList);
        const title = need(one(v.title), 'Lesson title');
        const order = one(v.order) || String(autoOrder);
        if (!/^\d{1,5}$/.test(order)) throw new Error('Order must be a number like 3.');
        const base = `#video ${c} | ${s} | ${ch} | ${title} | ${order}`;
        if (kind === 'yt') {
          const yt = parseYoutubeId(v.url);
          if (!yt) throw new Error('That is not a YouTube link.');
          setBusy(true);
          id = await postText(`${base} | https://youtu.be/${yt}`);
        } else {
          if (!file) throw new Error('Choose the video file.');
          setBusy(true); setProg(0);
          const meta = await readVideoMeta(file);
          id = await postFile(file, base, { video: meta, onProgress: setProg });
        }
      } else if (kind === 'course') {
        const title = need(one(v.title), 'Course name');
        const desc = one(v.description);
        const cap = `#course ${title}${desc ? ` | ${desc}` : ''}`;
        setBusy(true);
        id = cover ? await postPhoto(cover, { caption: cap }) : await postText(cap);
      } else {
        const title = need(one(v.title), 'Title');
        const body = need(multi(v.body), 'Details');
        setBusy(true);
        id = await postText(`#notice ${title} | ${body}`);
      }
      await sync();
      setMsg({ ok: true, text: `Posted to the channel (id ${id}).` });
      setFile(null); setCover(null);
      setV((p) => (kind === 'video' || kind === 'yt'
        ? { course: p.course, subject: p.subject, chapter: p.chapter }
        : kind === 'book' ? { subject: p.subject } : {}));
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  const pickFile = (f: File, asTitle: boolean) => {
    setFile(f);
    if (asTitle && !v.title) set('title', f.name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').trim());
  };

  const lessonFields = (
    <>
      <Field label="Course">
        <input className={inp} value={v.course ?? ''} onChange={(e) => set('course', e.target.value)} placeholder="Microbiology Course" />
        <Suggest list={courseList} value={v.course ?? ''} onPick={(x) => set('course', x)} />
      </Field>
      <Field label="Subject">
        <input className={inp} value={v.subject ?? ''} onChange={(e) => set('subject', e.target.value)} placeholder="Bacteriology" />
        <Suggest list={subjectList} value={v.subject ?? ''} onPick={(x) => set('subject', x)} />
      </Field>
      <Field label="Chapter">
        <input className={inp} value={v.chapter ?? ''} onChange={(e) => set('chapter', e.target.value)} placeholder="Introduction" />
        <Suggest list={chapterList} value={v.chapter ?? ''} onPick={(x) => set('chapter', x)} />
      </Field>
      <Field label="Lesson title">
        <input className={inp} value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Lesson 3 - Staining" />
      </Field>
      <Field label="Order number" optional>
        <input className={inp} inputMode="numeric" value={v.order ?? ''} onChange={(e) => set('order', e.target.value)} placeholder={`Auto: ${autoOrder}`} />
      </Field>
    </>
  );

  return (
    <div className="space-y-4">
      {kind === 'book' && (
        <>
          <Pick label="Choose PDF" accept="application/pdf" file={file} onFile={(f) => pickFile(f, true)} icon={<Paperclip size={20} />} />
          <Field label="Title"><input className={inp} value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Subject">
            <input className={inp} value={v.subject ?? ''} onChange={(e) => set('subject', e.target.value)} placeholder="DMLT" />
            <Suggest list={bookSubjects} value={v.subject ?? ''} onPick={(x) => set('subject', x)} />
          </Field>
          <Field label="Author" optional><input className={inp} value={v.author ?? ''} onChange={(e) => set('author', e.target.value)} /></Field>
          <Pick label="Cover photo (optional)" accept="image/*" file={cover} onFile={setCover} icon={<ImageIcon size={20} />} />
        </>
      )}
      {kind === 'video' && (
        <>
          <Pick label="Choose video" accept="video/*" file={file} onFile={(f) => pickFile(f, true)} icon={<Film size={20} />} />
          {lessonFields}
        </>
      )}
      {kind === 'yt' && (
        <>
          <Field label="YouTube link"><input className={inp} value={v.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://youtu.be/..." autoCapitalize="off" autoCorrect="off" /></Field>
          {lessonFields}
        </>
      )}
      {kind === 'course' && (
        <>
          <Field label="Course name"><input className={inp} value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Description" optional><input className={inp} value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
          <Pick label="Cover photo (optional)" accept="image/*" file={cover} onFile={setCover} icon={<ImageIcon size={20} />} />
        </>
      )}
      {kind === 'notice' && (
        <>
          <Field label="Title"><input className={inp} value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Details">
            <textarea className={`${inp} min-h-[120px] resize-none`} value={v.body ?? ''} onChange={(e) => set('body', e.target.value)} />
          </Field>
        </>
      )}

      {file && file.size > BIG && (
        <p className="rounded-xl bg-amber-500/10 px-3.5 py-3 text-[13px] text-amber-300">
          This file is large ({fmtSize(file.size)}). The phone loads it into memory while uploading, so the app can run out of memory. For very big files use the Telegram bot upload instead.
        </p>
      )}
      {busy && file && (
        <div>
          <Bar value={prog} />
          <p className="mt-1.5 text-xs text-sub">Uploading {Math.round(prog * 100)}%. Keep the app open.</p>
        </div>
      )}
      {msg && <p className={`rounded-xl px-3.5 py-3 text-sm ${msg.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{msg.text}</p>}

      <button onClick={submit} disabled={busy} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-60">
        {busy && <Loader2 size={18} className="animate-spin" />}{busy ? 'Posting...' : 'Post to channel'}
      </button>
    </div>
  );
}

function PosterSetup({ onReady }: { onReady: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { await connectPoster(token); onReady(); } catch (e) { setErr(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3 rounded-2xl bg-card p-4">
      <div className="flex items-center gap-2 font-bold"><KeyRound size={18} className="text-tint" />Posting bot token</div>
      <p className="text-[13px] leading-relaxed text-sub">
        Create a second bot in @BotFather just for posting, add it to the channel as admin with the "Post messages", "Edit messages of others" and "Delete messages" permissions, then paste its token here once.
        The token stays on this phone only (it is not inside the APK).
      </p>
      <input className={inp.replace('bg-card', 'bg-chip')} value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA..." autoCapitalize="off" autoCorrect="off" />
      {err && <p className="text-sm text-red-300">{err}</p>}
      <button onClick={go} disabled={busy || !token.trim()} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[15px] font-bold text-white disabled:opacity-60">
        {busy && <Loader2 size={18} className="animate-spin" />}{busy ? 'Connecting...' : 'Connect'}
      </button>
    </div>
  );
}

function LoginCard() {
  const { login, busy, error } = useAdmin();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  return (
    <div className="mx-auto mt-8 max-w-sm space-y-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-full bg-card p-5 text-tint"><ShieldCheck size={30} /></div>
        <h1 className="text-xl font-extrabold">Admin login</h1>
        <p className="text-[13px] text-sub">Ids and passwords are managed in your Telegram channel.</p>
      </div>
      <input className={inp} value={u} onChange={(e) => setU(e.target.value)} placeholder="Id" autoCapitalize="off" autoCorrect="off" />
      <input className={inp} type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Password" autoCapitalize="off" autoCorrect="off" />
      {error && <p className="rounded-xl bg-red-500/10 px-3.5 py-3 text-sm text-red-300">{error}</p>}
      <button onClick={() => login(u, p)} disabled={busy || !u.trim() || !p.trim()} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-60">
        {busy && <Loader2 size={18} className="animate-spin" />}{busy ? 'Checking...' : 'Login'}
      </button>
    </div>
  );
}

export default function Admin() {
  const { ready, user, init, verify, logout } = useAdmin();
  const [kind, setKind] = useState<Kind>('book');
  const [tab, setTab] = useState<'create' | 'manage'>('create');
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [hasPoster, setHasPoster] = useState<boolean | null>(null);

  useEffect(() => { void init(); }, [init]);
  useEffect(() => { if (ready && user) void verify(); }, [ready, user, verify]);
  useEffect(() => { if (user) getPosterToken().then((t) => setHasPoster(!!t)); }, [user]);

  if (!ready) return null;
  if (!user) return <LoginCard />;

  return (
    <div className="pb-6 pt-1">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold">Admin</h1>
          <p className="text-xs text-sub">Signed in as {user}</p>
        </div>
        <button onClick={logout} className="press flex items-center gap-1.5 rounded-lg bg-chip px-3.5 py-2 text-sm font-semibold"><LogOut size={16} />Logout</button>
      </div>

      {hasPoster === false && <PosterSetup onReady={() => setHasPoster(true)} />}

      {hasPoster && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-card p-1">
            {(['create', 'manage'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`press rounded-lg py-2.5 text-sm font-bold ${tab === t ? 'bg-white text-black' : 'text-sub'}`}>
                {t === 'create' ? 'Create' : 'Manage'}
              </button>
            ))}
          </div>
          {tab === 'manage' && (
            <Manage onAdd={(init) => { setInitial(init); setKind('video'); setTab('create'); }} />
          )}
          {tab === 'create' && <>
          <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
            {KINDS.map(({ k, label, Icon }) => (
              <button key={k} onClick={() => { setKind(k); setInitial({}); }}
                className={`press flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold ${kind === k ? 'bg-white text-black' : 'bg-chip text-white'}`}>
                <Icon size={16} />{label}
              </button>
            ))}
          </div>
          {kind === 'playlist' ? <PlaylistForm /> : <PostForm key={`${kind}:${JSON.stringify(initial)}`} kind={kind} initial={initial} />}
          </>}
          <button onClick={async () => { await forgetPoster(); setHasPoster(false); }} className="mt-6 w-full text-center text-xs text-sub underline">
            Change posting bot
          </button>
        </>
      )}
    </div>
  );
}
