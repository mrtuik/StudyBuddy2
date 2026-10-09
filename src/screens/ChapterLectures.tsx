import { useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { Check, Download, Layers, Play, PlayCircle } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { dlKey, useDownloads } from '../store/downloads';
import { Bar, Empty, LessonThumb, PageHeader } from '../components/ui';
import { fmtDate, fmtDur, fmtSize, pct } from '../lib/format';
import { lessonDur } from '../lib/youtube';
import { warmVideo } from '../telegram/media';
import { subjectLessons } from '../lib/course';

export default function ChapterLectures() {
  const { cid = '', sid = '', chid = '' } = useParams();
  const nav = useNavigate();
  const { courses, syncing } = useCatalog();
  const { progress, recents } = useLibrary();
  const dl = useDownloads((s) => s.items);
  const add = useDownloads((s) => s.add);
  const course = courses.find((c) => c.id === cid);
  const subject = course?.subjects.find((s) => s.id === sid);
  const chapter = chid === 'all' ? undefined : subject?.chapters.find((c) => c.id === chid);

  // connect and load the start of the lecture the learner will most likely open, so it plays at once
  const warmTarget = (() => {
    const ls = chapter ? chapter.lessons : subject ? subjectLessons(subject) : [];
    const lastRecent = recents.find((r) => r.type === 'lesson' && ls.some((l) => l.id === r.id));
    return ls.find((l) => l.id === lastRecent?.id) ?? ls[0];
  })();
  useEffect(() => {
    if (warmTarget && !warmTarget.youtubeId && dl[dlKey('lesson', warmTarget.id)]?.status !== 'done') warmVideo(warmTarget.id, warmTarget.size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmTarget?.id]);

  if (!course || !subject || (chid !== 'all' && !chapter)) {
    return (
      <>
        <PageHeader title="Lectures" />
        <Empty icon={<Layers size={28} />} text={syncing || !courses.length ? 'Loading…' : 'Not found'} />
      </>
    );
  }
  const lessons = chapter ? chapter.lessons : subjectLessons(subject);
  const offline = lessons.filter((l) => !l.youtubeId && !dl[dlKey('lesson', l.id)]);
  const last = recents.find((r) => r.type === 'lesson' && lessons.some((l) => l.id === r.id));
  const lastLesson = last && lessons.find((l) => l.id === last.id);
  const lastP = last ? pct(progress[last.key]) : 0;

  return (
    <div className="pb-4">
      <PageHeader title={chapter?.title ?? `${subject.title} · All Content`} />
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-chip px-3 py-1 text-xs font-bold text-tint">Lectures · {lessons.length}</span>
        {offline.length > 0 && (
          <button onClick={() => offline.forEach((l) => add('lesson', l.id, l.title, l.size))} className="press flex items-center gap-1.5 rounded-lg bg-chip px-3 py-1.5 text-xs font-semibold">
            <Download size={14} /> Download all
          </button>
        )}
      </div>
      {lastLesson && lastP < 0.95 && (
        <button onClick={() => nav(`/watch/${lastLesson.id}`)} className="press mb-3 flex w-full items-center gap-3 rounded-2xl bg-accent px-4 py-3 text-left">
          <Play size={18} fill="currentColor" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-white/75">Continue watching</span>
            <span className="block truncate text-sm font-bold">{lastLesson.title}</span>
          </span>
        </button>
      )}
      {!lessons.length ? <Empty icon={<PlayCircle size={28} />} text="No lectures yet" /> : (
        <div className="space-y-3">
          {lessons.map((l) => {
            const p = pct(progress[`lesson:${l.id}`]);
            const d = dl[dlKey('lesson', l.id)];
            const dur = lessonDur(l);
            return (
              <div key={l.id} className="overflow-hidden rounded-2xl border border-white/10 bg-card">
                <div className="flex gap-3 p-2.5">
                  <button onClick={() => nav(`/watch/${l.id}`)} onPointerDown={() => !l.youtubeId && warmVideo(l.id, l.size)} className="press relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-chip" aria-label={`Play ${l.title}`}>
                    <LessonThumb id={l.id} yt={l.youtubeId} className="h-full w-full" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55">
                        {p >= 0.95 ? <Check size={18} /> : <PlayCircle size={20} />}
                      </span>
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                    <button onClick={() => nav(`/watch/${l.id}`)} className="text-left">
                      <div className="break-words text-[14px] font-semibold leading-snug">{l.title}</div>
                    </button>
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0 text-xs text-sub">
                        <div className="truncate">{dur ? fmtDur(dur) : ''}{dur && l.date ? ' · ' : ''}{l.date ? fmtDate(l.date) : ''}</div>
                        {!l.youtubeId && <div className="truncate">{fmtSize(l.size)}{d?.status === 'done' ? ' · Downloaded' : d ? ` · ${Math.round((d.bytes / Math.max(1, d.size)) * 100)}%` : ''}</div>}
                        {l.youtubeId && <div>Online only</div>}
                      </div>
                      {!l.youtubeId && (
                        d?.status === 'done' ? <Check size={20} className="mb-0.5 shrink-0 text-tint" aria-label="Downloaded" />
                        : d ? <span className="mb-0.5 shrink-0 text-xs font-bold text-tint">{d.status === 'error' ? 'Retry' : '…'}</span>
                        : <button onClick={() => add('lesson', l.id, l.title, l.size)} className="press shrink-0 rounded-full p-1.5" aria-label="Download"><Download size={20} /></button>
                      )}
                    </div>
                  </div>
                </div>
                {p > 0 && p < 0.95 && <Bar value={p} className="rounded-none" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
