import { useNavigate } from 'react-router-dom';
import { BookOpen, PlayCircle } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { Cover, SectionTitle } from '../components/ui';
import { CourseMini, FolderCard } from '../components/Cards';
import { buildFolders, courseKey, folderKey } from '../lib/folders';
import { openPath } from '../components/Chrome';

export default function Home() {
  const nav = useNavigate();
  const { books, courses, notices, syncing, error } = useCatalog();
  const { recents, saved } = useLibrary();
  const folders = buildFolders(books);
  const shelf = saved.flatMap((k) => {
    const f = folders.find((x) => folderKey(x.name) === k);
    if (f) return [{ key: k, node: <FolderCard folder={f} /> }];
    const c = courses.find((x) => courseKey(x.id) === k);
    return c ? [{ key: k, node: <CourseMini course={c} /> }] : [];
  });

  return (
    <div>
      {error && <p className="mb-3 rounded-2xl bg-card p-4 text-sm text-red-400">{error}</p>}

      {recents.length > 0 && (
        <>
          <SectionTitle>Quick access</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            {recents.slice(0, 8).map((r) => (
              <button key={r.key} onClick={() => nav(openPath(r))} className="press flex items-center gap-3 overflow-hidden rounded-xl bg-card text-left">
                <Cover id={r.coverId} className="h-12 w-12 shrink-0" icon={r.type === 'lesson' ? <PlayCircle size={20} /> : undefined} />
                <span className="line-clamp-2 pr-2 text-[13px] font-semibold leading-tight">{r.title}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {(books.length > 0 || courses.length > 0) && (
        <>
        <SectionTitle action={<button onClick={() => nav('/books')} className="text-sm font-semibold text-tint">See all</button>}>Library</SectionTitle>
        {shelf.length > 0 ? (
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4">
            {shelf.map((x) => (
              <div key={x.key} className="w-[86%] shrink-0 snap-start">{x.node}</div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-sub">
            Tap <span className="font-semibold text-white">Save</span> on a Books or Videos card and it will show up here.
          </p>
        )}
        </>
      )}

      {!books.length && !notices.length && !courses.length && !syncing && !error && (
        <div className="mt-24 flex flex-col items-center gap-3 text-sub">
          <BookOpen size={40} />
          <p className="text-sm">Post in your Telegram channel and it will show up here.</p>
        </div>
      )}
    </div>
  );
}
