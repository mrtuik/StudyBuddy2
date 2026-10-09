import { useState, type ReactNode } from 'react';
import { ChevronLeft, Film, GraduationCap, Image as ImageIcon, Loader2, Pencil, PlayCircle, Plus, Trash2, X } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { Cover, Empty } from '../components/ui';
import { Chip } from '../components/ui';
import { Field, Pick, Suggest, inp, one, uniq } from '../components/form';
import { fmtSize } from '../lib/format';
import {
  deleteBook, deleteChapter, deleteCourse, deleteLesson, deleteNotice, deleteSubject,
  editBook, editCourse, editLesson, editNotice, renameChapter, renameSubject, type Step,
} from '../telegram/manage';
import { isPlLesson, type Book, type Chapter, type Course, type Lesson, type Notice, type Subject } from '../types';

/* ---------- small building blocks ---------- */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center gap-2 px-3 py-3">
        <button onClick={onClose} className="press rounded-full p-2" aria-label="Close"><X size={24} /></button>
        <h2 className="flex-1 truncate text-lg font-bold">{title}</h2>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-10">{children}</div>
    </div>
  );
}

function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<[number, number] | null>(null);
  const [err, setErr] = useState('');
  const run = async (fn: (s: Step) => Promise<void>) => {
    setBusy(true); setErr(''); setStep(null);
    try { await fn((d, t) => setStep([d, t])); onDone(); } catch (e) { setErr(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
  };
  return { busy, step, err, run };
}

function Status({ busy, step, err }: { busy: boolean; step: [number, number] | null; err: string }) {
  return (
    <>
      {busy && <p className="flex items-center gap-2 text-sm text-sub"><Loader2 size={16} className="animate-spin" />Working{step ? ` ${step[0]}/${step[1]}` : ''}... keep the app open.</p>}
      {err && <p className="rounded-xl bg-red-500/10 px-3.5 py-3 text-sm text-red-300">{err}</p>}
    </>
  );
}

function SaveBtn({ busy, disabled, onClick }: { busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy || disabled} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-60">
      {busy && <Loader2 size={18} className="animate-spin" />}{busy ? 'Saving...' : 'Save changes'}
    </button>
  );
}

/** two taps so nothing is deleted by accident */
function DeleteBtn({ label, note, busy, onConfirm }: { label: string; note?: string; busy: boolean; onConfirm: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="pt-4">
      {note && <p className="mb-2 text-xs text-sub">{note}</p>}
      <button disabled={busy} onClick={() => (sure ? onConfirm() : setSure(true))}
        className={`press flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold disabled:opacity-60 ${sure ? 'bg-red-600 text-white' : 'bg-red-500/10 text-red-300'}`}>
        <Trash2 size={18} />{sure ? 'Tap again to delete' : label}
      </button>
      {sure && !busy && <button onClick={() => setSure(false)} className="mt-2 w-full text-center text-xs text-sub">Cancel</button>}
    </div>
  );
}

const lessonCount = (c: Course) => c.subjects.reduce((n, s) => n + s.chapters.reduce((m, ch) => m + ch.lessons.length, 0), 0);
const chapterLessons = (s: Subject) => s.chapters.reduce((n, ch) => n + ch.lessons.length, 0);

/* ---------- edit sheets ---------- */
function BookSheet({ b, onClose }: { b: Book; onClose: () => void }) {
  const books = useCatalog((s) => s.books);
  const [v, setV] = useState({ title: b.title, subject: b.subject, author: b.author ?? '' });
  const [cover, setCover] = useState<File | null>(null);
  const r = useRun(onClose);
  return (
    <Sheet title="Edit book" onClose={onClose}>
      <Field label="Title"><input className={inp} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label="Subject">
        <input className={inp} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
        <Suggest list={uniq(books.map((x) => x.subject))} value={v.subject} onPick={(x) => setV({ ...v, subject: x })} />
      </Field>
      <Field label="Author" optional><input className={inp} value={v.author} onChange={(e) => setV({ ...v, author: e.target.value })} /></Field>
      <Pick label={b.coverMsgId ? 'Change cover photo' : 'Add cover photo'} accept="image/*" file={cover} onFile={setCover} icon={<ImageIcon size={20} />} />
      <Status {...r} />
      <SaveBtn busy={r.busy} disabled={!one(v.title) || !one(v.subject)} onClick={() => r.run((s) => editBook(b, { ...v, cover }, s))} />
      <DeleteBtn label="Delete book" note="Removes the PDF (and its cover) from the channel for everyone." busy={r.busy} onConfirm={() => r.run(() => deleteBook(b))} />
    </Sheet>
  );
}

function NoticeSheet({ n, onClose }: { n: Notice; onClose: () => void }) {
  const [v, setV] = useState({ title: n.title, body: n.body });
  const r = useRun(onClose);
  return (
    <Sheet title="Edit notice" onClose={onClose}>
      <Field label="Title"><input className={inp} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label="Details"><textarea className={`${inp} min-h-[140px] resize-none`} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
      <Status {...r} />
      <SaveBtn busy={r.busy} disabled={!one(v.title) || !v.body.trim()} onClick={() => r.run(() => editNotice(n, v))} />
      <DeleteBtn label="Delete notice" busy={r.busy} onConfirm={() => r.run(() => deleteNotice(n))} />
    </Sheet>
  );
}

function CourseSheet({ c, onClose }: { c: Course; onClose: () => void }) {
  const [v, setV] = useState({ title: c.title, description: c.description ?? '' });
  const [cover, setCover] = useState<File | null>(null);
  const r = useRun(onClose);
  const n = lessonCount(c);
  const renamed = one(v.title) !== c.title;
  return (
    <Sheet title="Edit course" onClose={onClose}>
      <Field label="Course name"><input className={inp} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      {renamed && n > 0 && <p className="text-xs text-sub">Renaming also updates the {n} lesson{n === 1 ? '' : 's'} in this course, so it takes a moment.</p>}
      <Field label="Description" optional><input className={inp} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <Pick label={c.coverMsgId ? 'Change cover photo' : 'Add cover photo'} accept="image/*" file={cover} onFile={setCover} icon={<ImageIcon size={20} />} />
      <Status {...r} />
      <SaveBtn busy={r.busy} disabled={!one(v.title)} onClick={() => r.run((s) => editCourse(c, { ...v, cover }, s))} />
      <DeleteBtn label="Delete course" note={`Removes the course and all ${n} lesson${n === 1 ? '' : 's'} from the channel for everyone.`} busy={r.busy} onConfirm={() => r.run((s) => deleteCourse(c, s))} />
    </Sheet>
  );
}

function RenameSheet({ kind, name, count, onSave, onDelete, onClose }: {
  kind: 'subject' | 'chapter'; name: string; count: number;
  onSave: (v: string, s: Step) => Promise<void>; onDelete: () => Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState(name);
  const r = useRun(onClose);
  return (
    <Sheet title={`Edit ${kind}`} onClose={onClose}>
      <Field label={kind === 'subject' ? 'Subject name' : 'Chapter name'}><input className={inp} value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <p className="text-xs text-sub">Renaming updates the {count} lesson{count === 1 ? '' : 's'} inside it.</p>
      <Status {...r} />
      <SaveBtn busy={r.busy} disabled={!one(v)} onClick={() => r.run((s) => onSave(one(v), s))} />
      <DeleteBtn label={`Delete ${kind}`} note={`Removes its ${count} lesson${count === 1 ? '' : 's'} from the channel for everyone.`} busy={r.busy} onConfirm={() => r.run(onDelete)} />
    </Sheet>
  );
}

function LessonSheet({ c, l, s, ch, onClose }: { c: Course; l: Lesson; s: Subject; ch: Chapter; onClose: () => void }) {
  const [v, setV] = useState({ title: l.title, order: l.order < 100000 ? String(l.order) : '', subject: s.title, chapter: ch.title });
  const r = useRun(onClose);
  const moved = v.subject !== s.title || v.chapter !== ch.title;
  return (
    <Sheet title="Edit lesson" onClose={onClose}>
      <Field label="Lesson title"><input className={inp} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label="Order number" optional><input className={inp} inputMode="numeric" value={v.order} onChange={(e) => setV({ ...v, order: e.target.value.replace(/\D/g, '') })} /></Field>
      <Field label="Subject">
        <input className={inp} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
        <Suggest list={c.subjects.map((x) => x.title)} value={v.subject} onPick={(x) => setV({ ...v, subject: x })} />
      </Field>
      <Field label="Chapter">
        <input className={inp} value={v.chapter} onChange={(e) => setV({ ...v, chapter: e.target.value })} />
        <Suggest list={uniq(c.subjects.flatMap((x) => x.chapters.map((y) => y.title)))} value={v.chapter} onPick={(x) => setV({ ...v, chapter: x })} />
      </Field>
      {moved && <p className="text-xs text-sub">The lesson moves to the subject / chapter above.</p>}
      <Status {...r} />
      <SaveBtn busy={r.busy} disabled={!one(v.title) || !one(v.subject) || !one(v.chapter)} onClick={() => r.run(() => editLesson(c, l, v))} />
      <DeleteBtn label="Delete lesson" busy={r.busy} onConfirm={() => r.run(() => deleteLesson(l))} />
    </Sheet>
  );
}

/* ---------- lists ---------- */
type Edit =
  | { t: 'book'; b: Book }
  | { t: 'notice'; n: Notice }
  | { t: 'course'; c: Course }
  | { t: 'subject'; c: Course; s: Subject }
  | { t: 'chapter'; c: Course; s: Subject; ch: Chapter }
  | { t: 'lesson'; c: Course; s: Subject; ch: Chapter; l: Lesson };

const iconBtn = 'press flex h-9 w-9 items-center justify-center rounded-lg bg-chip';

function CourseDetail({ c, onBack, onEdit, onAdd }: { c: Course; onBack: () => void; onEdit: (e: Edit) => void; onAdd: (init: Record<string, string>) => void }) {
  return (
    <div>
      <button onClick={onBack} className="press -ml-1 mb-3 flex items-center gap-1 text-sm font-semibold text-sub"><ChevronLeft size={18} />All courses</button>
      <div className="flex items-center gap-3">
        <Cover id={c.coverMsgId} icon={<GraduationCap size={22} />} className="h-16 w-16 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-extrabold">{c.title}</h2>
          <p className="text-xs text-sub">{c.subjects.length} subject{c.subjects.length === 1 ? '' : 's'} · {lessonCount(c)} lesson{lessonCount(c) === 1 ? '' : 's'}</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={() => onEdit({ t: 'course', c })} className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-chip text-sm font-bold"><Pencil size={16} />Edit course</button>
        <button onClick={() => onAdd({ course: c.title })} className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-bold"><Plus size={18} />New subject / lesson</button>
      </div>

      {!c.subjects.length && <p className="mt-8 text-center text-sm text-sub">No lessons yet. Use "New subject / lesson".</p>}

      <div className="mt-5 space-y-4">
        {c.subjects.map((s) => (
          <section key={s.id} className="rounded-2xl bg-card p-3.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-extrabold">{s.title}</div>
                <div className="text-xs text-sub">{s.chapters.length} chapter{s.chapters.length === 1 ? '' : 's'} · {chapterLessons(s)} lessons</div>
              </div>
              <button onClick={() => onAdd({ course: c.title, subject: s.title })} className={iconBtn} aria-label="New chapter"><Plus size={18} /></button>
              <button onClick={() => onEdit({ t: 'subject', c, s })} className={iconBtn} aria-label="Edit subject"><Pencil size={16} /></button>
            </div>

            <div className="mt-3 space-y-3">
              {s.chapters.map((ch) => (
                <div key={ch.id} className="rounded-xl bg-bg/60 p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-bold">{ch.title}</div>
                    <button onClick={() => onAdd({ course: c.title, subject: s.title, chapter: ch.title })} className={iconBtn} aria-label="New lesson"><Plus size={18} /></button>
                    <button onClick={() => onEdit({ t: 'chapter', c, s, ch })} className={iconBtn} aria-label="Edit chapter"><Pencil size={16} /></button>
                  </div>
                  <div className="mt-2 divide-y divide-white/5">
                    {ch.lessons.map((l) => (
                      <button key={l.id} disabled={isPlLesson(l.id)} onClick={() => onEdit({ t: 'lesson', c, s, ch, l })} className="press flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-60">
                        <span className="text-tint">{l.youtubeId ? <PlayCircle size={18} /> : <Film size={18} />}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{l.title}</span>
                        {l.order < 100000 && <span className="text-xs text-sub">#{l.order}</span>}
                        {isPlLesson(l.id) ? <span className="text-[10px] text-sub">playlist</span> : <Pencil size={14} className="text-sub" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={() => onAdd({ course: c.title, subject: s.title })} className="press flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2.5 text-sm font-semibold text-tint">
                <Plus size={16} />New chapter in {s.title}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function Manage({ onAdd }: { onAdd: (init: Record<string, string>) => void }) {
  const { books, courses, notices } = useCatalog();
  const [tab, setTab] = useState<'courses' | 'books' | 'notices'>('courses');
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const close = () => setEdit(null);
  const course = openId ? courses.find((c) => c.id === openId) : undefined;

  let sheet: ReactNode = null;
  if (edit?.t === 'book') sheet = <BookSheet b={edit.b} onClose={close} />;
  else if (edit?.t === 'notice') sheet = <NoticeSheet n={edit.n} onClose={close} />;
  else if (edit?.t === 'course') sheet = <CourseSheet c={edit.c} onClose={close} />;
  else if (edit?.t === 'subject') {
    const { c, s } = edit;
    sheet = <RenameSheet kind="subject" name={s.title} count={chapterLessons(s)} onClose={close}
      onSave={(v, st) => renameSubject(c, s, v, st)} onDelete={() => deleteSubject(s)} />;
  } else if (edit?.t === 'chapter') {
    const { c, s, ch } = edit;
    sheet = <RenameSheet kind="chapter" name={ch.title} count={ch.lessons.length} onClose={close}
      onSave={(v, st) => renameChapter(c, s, ch, v, st)} onDelete={() => deleteChapter(ch)} />;
  } else if (edit?.t === 'lesson') sheet = <LessonSheet c={edit.c} l={edit.l} s={edit.s} ch={edit.ch} onClose={close} />;

  return (
    <div>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {([['courses', 'Courses'], ['books', 'Books'], ['notices', 'Notices']] as const).map(([k, label]) => (
          <Chip key={k} label={label} active={tab === k} onClick={() => { setTab(k); setOpenId(null); }} />
        ))}
      </div>

      {tab === 'courses' && (course
        ? <CourseDetail c={course} onBack={() => setOpenId(null)} onEdit={setEdit} onAdd={onAdd} />
        : !courses.length ? <Empty icon={<GraduationCap size={28} />} text="No courses yet" /> : (
          <div className="space-y-2.5">
            {courses.map((c) => (
              <button key={c.id} onClick={() => setOpenId(c.id)} className="press flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left">
                <Cover id={c.coverMsgId} icon={<GraduationCap size={20} />} className="h-14 w-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{c.title}</div>
                  <div className="text-xs text-sub">{c.subjects.length} subject{c.subjects.length === 1 ? '' : 's'} · {lessonCount(c)} lesson{lessonCount(c) === 1 ? '' : 's'}</div>
                </div>
                <ChevronLeft size={18} className="rotate-180 text-sub" />
              </button>
            ))}
          </div>
        ))}

      {tab === 'books' && (!books.length ? <Empty icon={<ImageIcon size={28} />} text="No books yet" /> : (
        <div className="space-y-2.5">
          {books.map((b) => (
            <button key={b.id} onClick={() => setEdit({ t: 'book', b })} className="press flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left">
              <Cover id={b.coverMsgId} className="aspect-[3/4] w-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-bold leading-tight">{b.title}</div>
                <div className="mt-0.5 text-xs text-sub">{b.subject} · {fmtSize(b.size)}</div>
              </div>
              <Pencil size={16} className="text-sub" />
            </button>
          ))}
        </div>
      ))}

      {tab === 'notices' && (!notices.length ? <Empty icon={<Pencil size={28} />} text="No notices yet" /> : (
        <div className="space-y-2.5">
          {notices.map((n) => (
            <button key={n.id} onClick={() => setEdit({ t: 'notice', n })} className="press flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{n.title}</div>
                <div className="line-clamp-1 text-xs text-sub">{n.body}</div>
              </div>
              <Pencil size={16} className="text-sub" />
            </button>
          ))}
        </div>
      ))}

      {sheet}
    </div>
  );
}
