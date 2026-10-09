// Guesses course / subject / chapter for the videos of a YouTube playlist, from the video titles only.
// Pure functions (no network, no React) so they are easy to test.

export interface PlVideo { id: string; title: string }
export interface Row { id: string; title: string; chapter: string; skip?: boolean }
export type Mode = 'auto' | 'every' | 'one';
export type Found = 'markers' | 'titles' | 'chunks' | 'one';

const SEP = /\s*[|｜]\s*|\s+[-–—]\s+|\s*:\s+/;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const clean = (s: string) => s.replace(/#[^\d\s]\S*/g, ' ').replace(/\s+/g, ' ').trim();   // drops #hashtags, keeps "#3"
const trimSep = (s: string) => s.replace(/^[\s\-–—:|.,]+|[\s\-–—:|.,]+$/g, '').trim();

/** "Unit 3", "Chapter-2", "Ch. 4", "Module IV" ... */
const MARK = /\b(chapter|chap|ch|unit|module|section)\b\.?\s*[-:#.]?\s*(\d{1,3}|[ivx]{1,4})\b/i;
const MARK_WORD: Record<string, string> = { chapter: 'Chapter', chap: 'Chapter', ch: 'Chapter', unit: 'Unit', module: 'Module', section: 'Section' };

/** numbering that is part of a lesson (not a chapter): "Part 2", "Lecture 5", "L-3" */
const LESSON_NO = /\b(part|pt|lecture|lec|class|lesson|day|episode|ep|video|session)\b\.?\s*[-:#]?\s*\d+/gi;
const stripNo = (s: string) => {
  const r = trimSep(s.replace(LESSON_NO, ' ').replace(/^\s*\d+\s*[.)\-–:]\s*/, '').replace(/\s+/g, ' '));
  return r || s;
};

function segmentsOf(videos: PlVideo[]): string[][] {
  const all = videos.map((v) => clean(v.title).split(SEP).map((s) => s.trim()).filter(Boolean));
  // a segment that is in (almost) every title is a channel / course name, not a chapter: drop it
  if (all.length >= 6) {
    const cnt = new Map<string, number>();
    for (const segs of all) for (const s of new Set(segs.map(norm))) cnt.set(s, (cnt.get(s) ?? 0) + 1);
    const common = new Set([...cnt].filter(([, c]) => c >= Math.ceil(all.length * 0.8)).map(([s]) => s));
    return all.map((segs, i) => {
      const kept = segs.filter((s) => !common.has(norm(s)));
      return kept.length ? kept : all[i].length ? all[i] : [videos[i].title];
    });
  }
  return all.map((s, i) => (s.length ? s : [videos[i].title]));
}

function chunk(videos: PlVideo[], titles: string[], n: number): Row[] {
  const size = Math.max(1, Math.floor(n));
  return videos.map((v, i) => ({ id: v.id, title: titles[i], chapter: `Chapter ${Math.floor(i / size) + 1}` }));
}

export function guessRows(videos: PlVideo[], mode: Mode = 'auto', n = 5): { rows: Row[]; found: Found } {
  const segs = segmentsOf(videos);
  const full = segs.map((s) => s.join(' - '));

  if (mode === 'one') return { rows: videos.map((v, i) => ({ id: v.id, title: full[i], chapter: 'Lectures' })), found: 'one' };
  if (mode === 'every') return { rows: chunk(videos, full, n), found: 'chunks' };

  /* 1. explicit "Unit 2" / "Chapter 3" in the titles */
  const marks = segs.map((s) => MARK.exec(s.join(' | ')));
  if (marks.filter(Boolean).length >= Math.max(2, Math.ceil(videos.length * 0.3))) {
    const key = (m: RegExpExecArray) => {
      const w = MARK_WORD[m[1].toLowerCase()];
      const no = /^\d+$/.test(m[2]) ? String(Number(m[2])) : m[2].toUpperCase();
      return `${w} ${no}`;
    };
    let cur = marks.find(Boolean) ? 'Introduction' : 'Lectures';
    const rows = videos.map((v, i) => {
      const m = marks[i];
      if (m) cur = key(m);                                   // videos without a marker stay in the previous chapter
      const t = m ? trimSep(segs[i].join(' - ').replace(MARK, ' ').replace(/\s+/g, ' ')) : '';
      return { id: v.id, title: t || full[i], chapter: cur };
    });
    return { rows, found: 'markers' };
  }

  /* 2. same title start ("Bacterial growth | Part 1", "Bacterial growth - Part 2") */
  const bases = segs.map((s) => (s.length >= 2 ? s[0] : stripNo(s[0])));
  const groups: { b: string; idx: number[] }[] = [];
  bases.forEach((b, i) => {
    const last = groups[groups.length - 1];
    if (last && norm(last.b) === norm(b)) last.idx.push(i); else groups.push({ b, idx: [i] });
  });
  const singles = groups.filter((g) => g.idx.length === 1).length;
  if (groups.length <= 1 || singles / groups.length <= 0.6) {
    const rows: Row[] = [];
    for (const g of groups) for (const i of g.idx) {
      let rest = segs[i].length >= 2 ? segs[i].slice(1).join(' - ') : full[i];
      if (/^(part|pt|lecture|lec|class|lesson|day|episode|ep|video|session)\.?\s*[-:#]?\s*\d+$/i.test(rest)) rest = `${g.b} - ${rest}`;   // keep "Part 2" readable
      rows[i] = { id: videos[i].id, title: rest || full[i], chapter: g.b };
    }
    return { rows, found: 'titles' };
  }

  /* 3. nothing to go on: blocks of 5, the admin renames them in the preview */
  return { rows: chunk(videos, full, n), found: 'chunks' };
}

/** course + subject from the playlist title, helped by the names that already exist in the channel */
export function guessCourseSubject(
  plTitle: string,
  courses: { title: string; subjects: { title: string }[] }[],
): { course: string; subject: string } {
  const t = norm(plTitle);
  const segs = clean(plTitle).split(SEP).map((s) => s.trim()).filter(Boolean);
  const has = (name: string) => name.length >= 3 && t.includes(norm(name));
  const course = courses.find((c) => has(c.title));
  const pool = course ? course.subjects : courses.flatMap((c) => c.subjects);
  const subject = pool.find((s) => has(s.title));
  if (course && subject) return { course: course.title, subject: subject.title };
  const rest = (name: string) => segs.filter((s) => norm(s) !== norm(name));
  if (course) return { course: course.title, subject: rest(course.title)[0] ?? '' };
  if (subject) return { course: rest(subject.title).pop() ?? '', subject: subject.title };
  if (segs.length >= 2) return { course: segs[segs.length - 1], subject: segs[0] };
  return { course: '', subject: segs[0] ?? '' };
}
