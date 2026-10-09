// Edit / delete of existing posts. Everything is done by editing captions or deleting messages in the channel,
// then the local catalog is re-synced (the scanner re-checks every known post, so edits and deletes show up).
import { deleteMessages, editCaption, postPhoto, postText } from './poster';
import { useCatalog } from '../store/catalog';
import { isPlLesson, type Book, type Chapter, type Course, type Lesson, type Notice, type Subject } from '../types';

export type Step = (done: number, total: number) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const one = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const body = (s: string) => s.replace(/\|/g, '/').trim();

export async function resync() {
  for (let i = 0; i < 60 && useCatalog.getState().syncing; i++) await sleep(300);
  await useCatalog.getState().sync();
}

async function editMany(list: { id: number; text: string }[], onStep?: Step) {
  for (let i = 0; i < list.length; i++) {
    await editCaption(list[i].id, list[i].text);
    onStep?.(i + 1, list.length);
    if (i < list.length - 1) await sleep(350); // stay under Telegram's edit rate limit
  }
}

/** the exact caption the app reads; order is left out when the lesson never had one */
function lessonText(course: string, subject: string, chapter: string, l: Lesson, o: { title?: string; order?: number | null } = {}) {
  const order = o.order === undefined ? (l.order < 100000 ? l.order : null) : o.order;
  const parts = [one(course), one(subject), one(chapter), one(o.title ?? l.title)];
  if (order != null) parts.push(String(order));
  const head = `#video ${parts.join(' | ')}`;
  return l.youtubeId ? `${head} | https://youtu.be/${l.youtubeId}` : head;
}

// lessons that come from a #playlist post have no message of their own: only the #playlist post itself can be changed
const real = (ls: Lesson[]) => ls.filter((l) => !isPlLesson(l.id));
const lessonsOf = (c: Course) => c.subjects.flatMap((s) => s.chapters.flatMap((ch) => real(ch.lessons).map((l) => ({ s, ch, l }))));

/* ---------- books ---------- */
export async function editBook(b: Book, v: { title: string; subject: string; author: string; cover: File | null }, onStep?: Step) {
  const author = one(v.author);
  await editCaption(b.id, `#book ${one(v.title)} | ${one(v.subject)}${author ? ` | ${author}` : ''}`);
  if (v.cover) {
    onStep?.(1, 2);
    if (b.coverMsgId) await deleteMessages([b.coverMsgId]);
    await postPhoto(v.cover, { replyTo: b.id });
  }
  await resync();
}
export async function deleteBook(b: Book) {
  await deleteMessages([b.id, b.coverMsgId ?? 0]);
  await resync();
}

/* ---------- notices ---------- */
export async function editNotice(n: Notice, v: { title: string; body: string }) {
  await editCaption(n.id, `#notice ${one(v.title)} | ${body(v.body)}`);
  await resync();
}
export async function deleteNotice(n: Notice) {
  await deleteMessages([n.id]);
  await resync();
}

/* ---------- courses ---------- */
export async function editCourse(c: Course, v: { title: string; description: string; cover: File | null }, onStep?: Step) {
  const title = one(v.title);
  const desc = one(v.description);
  const cap = `#course ${title}${desc ? ` | ${desc}` : ''}`;

  // a new name has to be written into every lesson of the course
  if (title !== c.title) await editMany(lessonsOf(c).map(({ s, ch, l }) => ({ id: l.id, text: lessonText(title, s.title, ch.title, l) })), onStep);

  if (v.cover) {
    await postPhoto(v.cover, { caption: cap });          // new post with the new cover first,
    if (c.msgId) await deleteMessages([c.msgId]);        // then remove the old one
  } else if (c.msgId) {
    await editCaption(c.msgId, cap);
  } else if (desc) {
    await postText(cap);
  }
  await resync();
}
export async function deleteCourse(c: Course, onStep?: Step) {
  const ids = [c.msgId ?? 0, ...lessonsOf(c).map((x) => x.l.id)];
  onStep?.(0, ids.length);
  await deleteMessages(ids);
  await resync();
}

/* ---------- subjects / chapters ---------- */
export async function renameSubject(c: Course, s: Subject, name: string, onStep?: Step) {
  const list = s.chapters.flatMap((ch) => real(ch.lessons).map((l) => ({ id: l.id, text: lessonText(c.title, name, ch.title, l) })));
  await editMany(list, onStep);
  await resync();
}
export async function deleteSubject(s: Subject) {
  await deleteMessages(s.chapters.flatMap((ch) => real(ch.lessons).map((l) => l.id)));
  await resync();
}
export async function renameChapter(c: Course, s: Subject, ch: Chapter, name: string, onStep?: Step) {
  await editMany(real(ch.lessons).map((l) => ({ id: l.id, text: lessonText(c.title, s.title, name, l) })), onStep);
  await resync();
}
export async function deleteChapter(ch: Chapter) {
  await deleteMessages(real(ch.lessons).map((l) => l.id));
  await resync();
}

/* ---------- lessons ---------- */
export async function editLesson(c: Course, l: Lesson, v: { title: string; order: string; subject: string; chapter: string }) {
  const order = v.order.trim() ? Number(v.order.trim()) : null;
  await editCaption(l.id, lessonText(c.title, v.subject, v.chapter, l, { title: v.title, order }));
  await resync();
}
export async function deleteLesson(l: Lesson) {
  await deleteMessages([l.id]);
  await resync();
}
