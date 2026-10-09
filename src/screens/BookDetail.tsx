import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Check, ChevronLeft, Download, Loader2, Pause, Play, Share2, Trash2 } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { dlKey, useDownloads } from '../store/downloads';
import { useLibrary } from '../store/library';
import { Bar, Cover, Empty, PageHeader, Ring, SectionTitle } from '../components/ui';
import { fmtDate, fmtSize, fmtSpeed, pct } from '../lib/format';
import { useShareBook } from '../lib/share';
import { warmRemotePdf } from '../telegram/stream';

export default function BookDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const bid = Number(id);
  const book = useCatalog((s) => s.books.find((b) => b.id === bid));
  const related = useCatalog((s) => s.books.filter((b) => b.id !== bid && book && b.subject === book.subject));
  const dl = useDownloads((s) => s.items[dlKey('book', bid)]);
  const { add, pause, resume, remove } = useDownloads();
  const progress = useLibrary((s) => s.progress[`book:${bid}`]);
  const { share, progress: shareProg } = useShareBook(book);
  const isLocal = dl?.status === 'done';
  // warm open: connect, read the header/xref, parse the document and load the resume page while the user is still on this screen
  useEffect(() => { if (book && !isLocal) warmRemotePdf(book.id, book.size, progress?.position ?? 1); }, [book?.id, book?.size, isLocal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!book) return <><PageHeader title="Book" /><Empty icon={<BookOpen size={28} />} text="Loading…" /></>;

  const p = pct(progress);
  const dp = dl ? dl.bytes / Math.max(1, dl.size) : 0;
  const running = dl?.status === 'running' || dl?.status === 'queued';
  const sharing = shareProg !== null;

  const stats = [
    { label: 'Subject', value: book.subject },
    { label: 'Size', value: fmtSize(book.size) },
    { label: 'Added', value: fmtDate(book.date) },
  ];

  // one square action next to the main button: download -> pause/resume -> remove
  let side: { icon: JSX.Element; label: string; onClick: () => void };
  if (!dl) side = { icon: <Download size={18} />, label: 'Download', onClick: () => add('book', bid, book.title, book.size) };
  else if (dl.status === 'done') side = { icon: <Trash2 size={18} />, label: 'Remove download', onClick: () => remove(dl.key) };
  else side = { icon: running ? <Pause size={18} /> : <Play size={18} />, label: running ? 'Pause' : 'Resume', onClick: () => (running ? pause(dl.key) : resume(dl.key)) };

  return (
    <div className="-mt-px">
      {/* hero: blurred cover backdrop, centred cover, title */}
      <section className="relative -mx-4 overflow-hidden px-4 pb-6">
        <Cover id={book.coverMsgId} icon={<span />} className="absolute inset-0 h-full w-full scale-125 opacity-40 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/20 via-bg/40 to-bg" />

        <div className="relative z-10 flex items-center justify-between pt-3">
          <button onClick={() => nav(-1)} className="press rounded-full bg-black/40 p-2.5 backdrop-blur" aria-label="Back"><ChevronLeft size={22} /></button>
          <button onClick={share} disabled={sharing} className="press flex h-[42px] items-center gap-2 rounded-full bg-black/40 px-3.5 text-sm font-semibold backdrop-blur disabled:opacity-80" aria-label="Share">
            {sharing ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
            {sharing && <span>{dl?.status === 'done' ? 'Preparing…' : `${Math.round((shareProg ?? 0) * 100)}%`}</span>}
          </button>
        </div>

        <div className="relative z-10 mt-4 flex flex-col items-center text-center">
          <Cover id={book.coverMsgId} className="aspect-[3/4] w-44 rounded-xl shadow-2xl shadow-black/70 ring-1 ring-white/10" />
          <h1 className="mt-5 text-[22px] font-extrabold leading-tight tracking-tight">{book.title}</h1>
          <p className="mt-1 text-sm text-sub">{book.author ?? 'Unknown author'}</p>
        </div>
      </section>

      {/* quick facts */}
      <div className="grid grid-cols-3 divide-x divide-white/10 rounded-2xl bg-card py-3.5">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 px-3 text-center">
            <div className="truncate text-[15px] font-bold">{s.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-sub">{s.label}</div>
          </div>
        ))}
      </div>

      {/* reading progress */}
      {p > 0 && (
        <button onClick={() => nav(`/read/${bid}`)} className="press mt-3 flex w-full items-center gap-4 rounded-2xl bg-card p-4 text-left">
          <div className="relative">
            <Ring value={p} size={48} />
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">{Math.round(p * 100)}%</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold">Your progress</div>
            <div className="text-xs text-sub">Page {progress?.position} of {progress?.total}</div>
          </div>
          <ChevronLeft size={20} className="rotate-180 text-sub" />
        </button>
      )}

      {/* download state */}
      {dl && dl.status !== 'done' && (
        <div className="mt-3 rounded-2xl bg-card p-4">
          <div className="mb-2 flex justify-between text-sm font-semibold">
            <span>{dl.status === 'error' ? 'Download failed' : dl.status === 'paused' ? 'Download paused' : 'Downloading'}</span>
            <span className="text-tint">{Math.round(dp * 100)}%</span>
          </div>
          <Bar value={dp} />
          <div className="mt-2 flex justify-between text-xs text-sub">
            <span>{fmtSize(dl.bytes)} of {fmtSize(dl.size)}</span>
            <span>{running && dl.speed ? fmtSpeed(dl.speed) : ''}</span>
          </div>
          {dl.status === 'error' && dl.error && <p className="mt-2 break-words text-xs text-red-300">{dl.error}</p>}
          <button onClick={() => remove(dl.key)} className="mt-3 text-xs font-semibold text-red-300">Cancel download</button>
        </div>
      )}
      {dl?.status === 'done' && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-card p-4">
          <div className="rounded-full bg-accent/25 p-2 text-tint"><Check size={16} strokeWidth={3} /></div>
          <div>
            <div className="text-sm font-bold">Available offline</div>
            <div className="text-xs text-sub">Saved on this phone, opens without internet</div>
          </div>
        </div>
      )}

      {/* same subject */}
      {related.length > 0 && (
        <>
          <SectionTitle>More in {book.subject}</SectionTitle>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {related.slice(0, 10).map((b) => (
              <button key={b.id} onClick={() => nav(`/book/${b.id}`, { replace: true })} className="press w-24 shrink-0 text-left">
                <Cover id={b.coverMsgId} className="aspect-[3/4] w-full rounded-lg" />
                <div className="mt-2 line-clamp-2 text-[13px] font-semibold leading-tight">{b.title}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* sticky action bar: small buttons on the right */}
      <div className="sticky bottom-0 -mx-4 mt-6 bg-gradient-to-t from-bg via-bg to-bg/0 px-4 pb-3 pt-5">
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => nav(`/read/${bid}`)} className="press flex h-10 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-bold">
            <BookOpen size={16} /> {p > 0 ? 'Continue reading' : 'Read now'}
          </button>
          <button onClick={side.onClick} aria-label={side.label} className="press flex h-10 w-10 items-center justify-center rounded-lg bg-chip">
            {side.icon}
          </button>
        </div>
      </div>
    </div>
  );
}
