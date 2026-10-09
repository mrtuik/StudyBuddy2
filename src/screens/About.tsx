import { useNavigate } from 'react-router-dom';
import { BadgeCheck, BookOpen, ExternalLink, Headphones, Link2, Music, NotebookPen, Play, RefreshCw, Send, Table2 } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { useDownloads } from '../store/downloads';
import { useProfile } from '../store/profile';
import { Bar, Cover, PageHeader } from '../components/ui';
import { openPath } from '../components/Chrome';
import BuddySettings from '../buddy/BuddySettings';
import { APP_VERSION, CONTACT_URL, fmtSize, pct } from '../lib/format';

const apps = [
  { name: 'StudyBuddy', desc: 'Books, videos and notices in one place', Icon: BookOpen },
  { name: 'Mr. Tuik Notes', desc: 'Exam suggestion notes', Icon: NotebookPen },
  { name: 'Sheet.md', desc: 'Listen to your study notes', Icon: Headphones },
  { name: 'Love Music', desc: 'Music player app', Icon: Music },
  { name: 'Pathhelp', desc: 'Pathology helper extension', Icon: Table2 },
];

const round = 'flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/30 press';

export default function About() {
  const nav = useNavigate();
  const { books, courses, notices, syncing, error, lastSync, sync } = useCatalog();
  const progress = useLibrary((s) => s.progress);
  const recents = useLibrary((s) => s.recents);
  const dl = useDownloads((s) => s.items);
  const p = useProfile((s) => s.profile);

  const lessons = courses.flatMap((c) => c.subjects.flatMap((s) => s.chapters.flatMap((ch) => ch.lessons)));
  const quick: [string, string | number][] = [['Books', books.length], ['Courses', courses.length], ['Lessons', lessons.length]];
  const grid: [string, string | number][] = [
    ['Books started', books.filter((b) => pct(progress[`book:${b.id}`]) > 0).length],
    ['Lessons completed', lessons.filter((l) => pct(progress[`lesson:${l.id}`]) >= 0.95).length],
    ['Downloads', Object.values(dl).filter((i) => i.status === 'done').length],
    ['Storage used', fmtSize(Object.values(dl).reduce((n, i) => n + i.bytes, 0))],
  ];
  const cont = recents.slice(0, 10);
  const link = p.link || CONTACT_URL;
  const linkLabel = link.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <div>
      <PageHeader title="Profile" />

      {/* profile card */}
      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black">
        <div className="relative flex h-40 items-center justify-center bg-[#F1EFEA] px-6">
          <p className="text-center text-[13px] font-semibold uppercase tracking-[0.18em] text-black">{p.tagline}</p>
          <div className="absolute -bottom-9 left-5 flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-[18px] border-4 border-black bg-[#F1EFEA]">
            {p.avatarMsgId
              ? <Cover id={p.avatarMsgId} className="h-full w-full" />
              : <span className="text-4xl font-black text-black">{p.name.charAt(0).toUpperCase()}</span>}
          </div>
        </div>

        <div className="px-5 pb-5">
          <div className="flex h-14 items-center justify-end gap-2">
            <a href={CONTACT_URL} target="_blank" rel="noreferrer" aria-label="Telegram" className={round}><Send size={16} /></a>
            <a href={link} target="_blank" rel="noreferrer" aria-label="Link" className={round}><Link2 size={16} /></a>
            <button onClick={sync} disabled={syncing} className="press flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-black disabled:opacity-60">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing' : 'Sync'}
            </button>
          </div>

          <div className="mt-1 flex items-center gap-1.5">
            <h1 className="text-[22px] font-extrabold leading-tight">{p.name}</h1>
            <BadgeCheck size={20} className="fill-[#1D9BF0] text-black" />
          </div>
          <div className="text-sm text-sub">@{p.handle.replace(/^@/, '')}</div>
          <p className="mt-3 text-[15px] leading-snug">{p.bio}</p>

          <div className="mt-4 flex gap-5 text-sm">
            {quick.map(([label, v]) => (
              <div key={label}><span className="font-bold">{v}</span> <span className="text-sub">{label}</span></div>
            ))}
          </div>

          <a href={link} target="_blank" rel="noreferrer" className="press mt-3 inline-flex max-w-full items-center gap-1.5 text-sm text-[#1D9BF0]">
            <Link2 size={14} className="shrink-0" /> <span className="truncate">{linkLabel}</span>
          </a>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-sub">{lastSync ? `Last synced ${new Date(lastSync).toLocaleString()}` : 'Not synced yet'}</p>
      {error && <p className="mt-2 rounded-2xl bg-card p-4 text-sm text-red-400">{error}</p>}

      {/* continue */}
      {cont.length > 0 && (
        <>
          <h2 className="mb-3 mt-7 text-lg font-bold tracking-tight">Continue</h2>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {cont.map((r) => (
              <button key={r.key} onClick={() => nav(openPath(r))} className="press w-28 shrink-0 text-left">
                <Cover id={r.coverId} icon={r.type === 'lesson' ? <Play size={22} /> : undefined}
                  className={`w-full rounded-xl ${r.type === 'book' ? 'aspect-[3/4]' : 'aspect-video'}`} />
                <div className="mt-1.5 line-clamp-2 text-xs font-semibold leading-tight">{r.title}</div>
                <Bar value={pct(progress[r.key])} className="mt-1.5" />
              </button>
            ))}
          </div>
        </>
      )}

      {/* stats */}
      <h2 className="mb-3 mt-7 text-lg font-bold tracking-tight">Your activity</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {grid.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-card p-4">
            <div className="text-2xl font-extrabold">{value}</div>
            <div className="text-xs text-sub">{label}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-sub">{notices.length} notices in your channel</p>

      <BuddySettings />

      {/* apps */}
      <h2 className="mb-3 mt-7 text-lg font-bold tracking-tight">More apps</h2>
      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-card">
        {apps.map(({ name, desc, Icon }) => (
          <div key={name} className="flex items-center gap-3 p-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent"><Icon size={19} /></div>
            <div className="min-w-0"><div className="font-bold leading-tight">{name}</div><div className="truncate text-xs text-sub">{desc}</div></div>
          </div>
        ))}
      </div>

      <a href={CONTACT_URL} target="_blank" rel="noreferrer" className="press mt-6 flex items-center justify-center gap-2 rounded-2xl bg-accent py-4 font-bold">
        <Send size={18} /> Contact on Telegram <ExternalLink size={14} />
      </a>
      <a href={CONTACT_URL} target="_blank" rel="noreferrer" className="press mt-3 block rounded-2xl bg-chip py-4 text-center font-bold">Send feedback</a>
      <p className="mt-6 text-center text-xs text-sub">StudyBuddy v{APP_VERSION}</p>
    </div>
  );
}
