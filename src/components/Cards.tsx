import { useNavigate } from 'react-router-dom';
import { Bookmark, BookmarkCheck, ChevronRight, Folder as FolderIcon, PlayCircle } from 'lucide-react';
import { useLibrary } from '../store/library';
import type { Course } from '../types';
import { Cover } from './ui';
import { fmtSize } from '../lib/format';
import { courseThumb } from '../lib/youtube';
import { allLessons, courseLink, plural } from '../lib/course';
import { courseKey, folderKey, folderLink, type Folder } from '../lib/folders';

/** Save / Saved button. Saved cards show up in Home > Library. */
export function SaveBtn({ k, overlay = false }: { k: string; overlay?: boolean }) {
  const saved = useLibrary((s) => s.saved.includes(k));
  const toggle = useLibrary((s) => s.toggleSaved);
  const look = overlay
    ? (saved ? 'bg-black/70 text-tint' : 'bg-black/60 text-white')
    : (saved ? 'bg-tint/20 text-tint' : 'bg-chip text-white');
  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggle(k); }}
      aria-label={saved ? 'Remove from Library' : 'Save to Library'}
      className={`press flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-bold ${look}`}
    >
      {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}

const THUMB = 'h-[72px] w-[72px] shrink-0 rounded-xl';

function FolderThumb({ covers }: { covers: (number | undefined)[] }) {
  const ids = covers.filter((c): c is number => !!c);
  if (!ids.length) {
    return <div className={`flex items-center justify-center bg-chip text-white/40 ${THUMB}`}><FolderIcon size={28} /></div>;
  }
  if (ids.length < 4) return <Cover id={ids[0]} className={THUMB} />;
  return (
    <div className={`grid grid-cols-2 gap-0.5 overflow-hidden ${THUMB}`}>
      {ids.slice(0, 4).map((id) => <Cover key={id} id={id} className="h-full w-full" />)}
    </div>
  );
}

const shell = 'flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-card p-2.5';

/** compact "course like" card for a group of books. Tap opens the books inside. */
export function FolderCard({ folder, to, title, saveKey }: { folder: Pick<Folder, 'books' | 'size' | 'covers'> & { name: string }; to?: string; title?: string; saveKey?: string | null }) {
  const nav = useNavigate();
  const key = saveKey === undefined ? folderKey(folder.name) : saveKey;
  return (
    <div className={shell}>
      <button onClick={() => nav(to ?? folderLink(folder.name))} className="press flex min-w-0 flex-1 items-center gap-3 text-left">
        <FolderThumb covers={folder.covers} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-tint">Books</div>
          <div className="line-clamp-2 text-[16px] font-bold leading-snug">{title ?? folder.name}</div>
          <div className="mt-0.5 truncate text-[13px] text-sub">{plural(folder.books.length, 'book')} · {fmtSize(folder.size)}</div>
        </div>
        {!key && <ChevronRight size={20} className="shrink-0 text-sub" />}
      </button>
      {key && <SaveBtn k={key} />}
    </div>
  );
}

/** compact card for a video course (used in Home > Library) */
export function CourseMini({ course }: { course: Course }) {
  const nav = useNavigate();
  const ls = allLessons(course);
  return (
    <div className={shell}>
      <button onClick={() => nav(courseLink(course))} className="press flex min-w-0 flex-1 items-center gap-3 text-left">
        <Cover id={course.coverMsgId} src={courseThumb(course)} className={THUMB} icon={<PlayCircle size={28} />} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-tint">Course</div>
          <div className="line-clamp-2 text-[16px] font-bold leading-snug">{course.title}</div>
          <div className="mt-0.5 truncate text-[13px] text-sub">{plural(ls.length, 'lecture')}</div>
        </div>
      </button>
      <SaveBtn k={courseKey(course.id)} />
    </div>
  );
}
