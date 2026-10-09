import type { Course, Lesson, Subject } from '../types';
import { pct } from './format';
import type { Progress } from '../types';

export const allLessons = (c: { subjects: { chapters: { lessons: Lesson[] }[] }[] }): Lesson[] =>
  c.subjects.flatMap((s) => s.chapters.flatMap((ch) => ch.lessons));

export const subjectLessons = (s: Subject): Lesson[] => s.chapters.flatMap((ch) => ch.lessons);

export const doneCount = (ls: Lesson[], progress: Record<string, Progress>) =>
  ls.filter((l) => pct(progress[`lesson:${l.id}`]) >= 0.95).length;

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const courseLink = (c: Course) => `/course/${encodeURIComponent(c.id)}`;
export const subjectLink = (c: { id: string }, s: { id: string }) => `/course/${encodeURIComponent(c.id)}/${encodeURIComponent(s.id)}`;
export const chapterLink = (c: { id: string }, s: { id: string }, chId: string) => `${subjectLink(c, s)}/${encodeURIComponent(chId)}`;
