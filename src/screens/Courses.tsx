import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight, PlayCircle } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { Cover, Empty } from '../components/ui';
import { fmtDate, fmtDur } from '../lib/format';
import { courseThumb, lessonDur } from '../lib/youtube';
import { allLessons, courseLink, doneCount, plural } from '../lib/course';
import { SaveBtn } from '../components/Cards';
import { courseKey } from '../lib/folders';

export { allLessons };

export default function Courses() {
  const nav = useNavigate();
  const courses = useCatalog((s) => s.courses);
  const syncing = useCatalog((s) => s.syncing);
  const progress = useLibrary((s) => s.progress);

  return (
    <div>
      <h2 className="mb-3 mt-2 text-xl font-extrabold tracking-tight">Popular Courses</h2>
      {!courses.length ? (
        <Empty icon={<PlayCircle size={28} />} text={syncing ? 'Loading courses…' : 'No courses yet'} />
      ) : (
        <div className="space-y-4">
          {courses.map((c) => {
            const ls = allLessons(c);
            const done = doneCount(ls, progress);
            const dur = ls.reduce((n, l) => n + lessonDur(l), 0);
            const pctDone = ls.length ? Math.round((done / ls.length) * 100) : 0;
            const updated = Math.max(0, ...ls.map((l) => l.date ?? 0));
            return (
              <div key={c.id} className="relative">
              <button onClick={() => nav(courseLink(c))} className="press block w-full overflow-hidden rounded-2xl border border-white/10 bg-card text-left">
                <Cover id={c.coverMsgId} src={courseThumb(c)} className="aspect-video w-full" icon={<PlayCircle size={36} />} />
                <div className="p-4">
                  <div className="text-sm font-bold text-tint">Course</div>
                  <div className="mt-1 line-clamp-2 text-[19px] font-bold leading-snug">{c.title}</div>
                  <div className="mt-2 flex items-center gap-2 text-[15px] text-white/85">
                    <BookOpen size={18} className="shrink-0" />
                    <span className="truncate">{plural(c.subjects.length, 'subject')} · {plural(ls.length, 'lecture')}{dur ? ` · ${fmtDur(dur)}` : ''}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-sm text-sub">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                    <span>Ongoing</span>
                    {updated > 0 && <><span className="text-white/20">|</span><span className="truncate">Updated {fmtDate(updated)}</span></>}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xl font-extrabold">{plural(ls.length, 'Lecture')}</div>
                      <div className={`text-sm font-bold ${pctDone ? 'text-emerald-400' : 'text-sub'}`}>{pctDone}% completed</div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="rounded-xl bg-accent px-7 py-3.5 text-[15px] font-bold text-white">Watch Now</span>
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20"><ChevronRight size={22} /></span>
                    </div>
                  </div>
                </div>
              </button>
              <div className="absolute right-3 top-3"><SaveBtn k={courseKey(c.id)} overlay /></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
