import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Layers, PlayCircle } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { Bar, Empty, PageHeader } from '../components/ui';
import { chapterLink, doneCount, plural, subjectLessons } from '../lib/course';

export default function SubjectDetail() {
  const { cid = '', sid = '' } = useParams();
  const nav = useNavigate();
  const { courses, syncing } = useCatalog();
  const progress = useLibrary((s) => s.progress);
  const course = courses.find((c) => c.id === cid);
  const subject = course?.subjects.find((s) => s.id === sid);

  if (!course || !subject) {
    return (
      <>
        <PageHeader title="Subject" />
        <Empty icon={<Layers size={28} />} text={syncing || !courses.length ? 'Loading…' : 'Subject not found'} />
      </>
    );
  }
  const all = subjectLessons(subject);
  const card = 'press flex w-full items-center justify-between rounded-2xl border border-white/10 bg-card p-4 text-left';

  return (
    <div className="pb-4">
      <PageHeader title={subject.title} />
      <div className="space-y-3">
        <button onClick={() => nav(chapterLink(course, subject, 'all'))} className={card}>
          <div>
            <div className="text-base font-bold">All Content</div>
            <div className="mt-0.5 text-sm text-sub">All {plural(all.length, 'Lecture')}</div>
          </div>
          <ChevronRight size={20} className="text-sub" />
        </button>
        {subject.chapters.map((ch) => {
          const done = doneCount(ch.lessons, progress);
          return (
            <button key={ch.id} onClick={() => nav(chapterLink(course, subject, ch.id))} className={card}>
              <div className="min-w-0 flex-1 pr-3">
                <div className="line-clamp-2 text-base font-bold leading-snug">{ch.title}</div>
                <div className="mt-0.5 text-sm text-sub">{plural(ch.lessons.length, 'Video')}{done > 0 ? ` · ${done} done` : ''}</div>
                {done > 0 && <Bar value={done / ch.lessons.length} className="mt-2" />}
              </div>
              <ChevronRight size={20} className="shrink-0 text-sub" />
            </button>
          );
        })}
        {!subject.chapters.length && <Empty icon={<PlayCircle size={28} />} text="No chapters yet" />}
      </div>
    </div>
  );
}
