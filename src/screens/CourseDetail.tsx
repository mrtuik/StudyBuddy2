import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Layers, PlayCircle } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { Empty, PageHeader } from '../components/ui';
import { doneCount, plural, subjectLessons, subjectLink } from '../lib/course';
import { subjectIcon } from '../lib/subjectIcon';

export default function CourseDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { courses, syncing } = useCatalog();
  const progress = useLibrary((s) => s.progress);
  const course = courses.find((c) => c.id === id);

  if (!course) {
    return (
      <>
        <PageHeader title="Course" />
        <Empty icon={<PlayCircle size={28} />} text={syncing || !courses.length ? 'Loading…' : 'Course not found'} />
      </>
    );
  }

  return (
    <div className="pb-4">
      <PageHeader title={course.title} />
      {!course.subjects.length ? (
        <Empty icon={<Layers size={28} />} text="No subjects yet" />
      ) : (
        <div className="space-y-3">
          {course.subjects.map((s) => {
            const ls = subjectLessons(s);
            const done = doneCount(ls, progress);
            const Icon = subjectIcon(s.title);
            return (
              <button key={s.id} onClick={() => nav(subjectLink(course, s))} className="press flex w-full items-center overflow-hidden rounded-2xl border border-white/10 bg-card text-left">
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center self-stretch bg-chip text-tint">
                  <Icon size={30} />
                </div>
                <div className="min-w-0 flex-1 px-4 py-3.5">
                  <div className="line-clamp-2 text-base font-bold leading-snug">{s.title}</div>
                  <div className="mt-0.5 text-sm text-sub">
                    {plural(s.chapters.length, 'Chapter')}{done > 0 ? ` · ${done}/${ls.length} done` : ''}
                  </div>
                </div>
                <ChevronRight size={20} className="mr-3 shrink-0 text-sub" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
