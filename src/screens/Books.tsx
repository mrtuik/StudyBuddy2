import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, CheckCircle2, ChevronLeft } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useDownloads, dlKey } from '../store/downloads';
import { useLibrary } from '../store/library';
import { Bar, Cover, Empty } from '../components/ui';
import { FolderCard, SaveBtn } from '../components/Cards';
import { fmtSize, pct } from '../lib/format';
import { ALL_FOLDER, buildFolders, folderKey, folderLink } from '../lib/folders';

export default function Books() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const books = useCatalog((s) => s.books);
  const dl = useDownloads((s) => s.items);
  const progress = useLibrary((s) => s.progress);
  const subject = params.get('subject');
  const folders = useMemo(() => buildFolders(books), [books]);

  // ---------- inside one card: the books ----------
  if (subject !== null) {
    const isAll = subject === ALL_FOLDER;
    const list = isAll ? books : (folders.find((f) => f.name === subject)?.books ?? []);
    const back = () => (window.history.state?.idx > 0 ? nav(-1) : nav('/books', { replace: true }));
    return (
      <div>
        <div className="mb-3 mt-1 flex items-center gap-1">
          <button onClick={back} className="press rounded-full p-2" aria-label="Back"><ChevronLeft size={26} /></button>
          <h2 className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-tight">{isAll ? 'All books' : subject}</h2>
          {!isAll && list.length > 0 && <SaveBtn k={folderKey(subject)} />}
        </div>
        {!list.length ? <Empty icon={<BookOpen size={28} />} text="No books here yet" /> : (
          <div className="grid grid-cols-3 gap-3">
            {list.map((b) => {
              const done = dl[dlKey('book', b.id)]?.status === 'done';
              const p = pct(progress[`book:${b.id}`]);
              return (
                <button key={b.id} onClick={() => nav(`/book/${b.id}`)} className="press text-left">
                  <div className="relative">
                    <Cover id={b.coverMsgId} className="aspect-[3/4] w-full rounded-lg" />
                    {done && <CheckCircle2 size={18} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-0.5 text-tint" />}
                  </div>
                  {p > 0 && <Bar value={p} className="mt-2" />}
                  <div className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-tight">{b.title}</div>
                  <div className="truncate text-[11px] text-sub">{b.author ? `${b.author} · ` : ''}{fmtSize(b.size)}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---------- the cards ----------
  return (
    <div>
      <h2 className="mb-3 mt-2 text-xl font-extrabold tracking-tight">Books</h2>
      {!books.length ? <Empty icon={<BookOpen size={28} />} text="No books yet" /> : (
        <div className="space-y-3">
          <FolderCard
            folder={{ name: 'All books', books, size: books.reduce((n, b) => n + b.size, 0), covers: books.map((b) => b.coverMsgId) }}
            to={folderLink(ALL_FOLDER)}
            saveKey={null}
          />
          {folders.map((f) => <FolderCard key={f.name} folder={f} />)}
        </div>
      )}
    </div>
  );
}
