import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BookOpen, ChevronLeft, PlayCircle, Search as SearchIcon, X } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { Cover } from '../components/ui';

interface Hit { key: string; type: 'Book' | 'Lesson' | 'Course' | 'Notice'; title: string; sub: string; to: string; cover?: number }

export default function Search() {
  const nav = useNavigate();
  const { books, courses, notices } = useCatalog();
  const { searches, addSearch, clearSearches } = useLibrary();
  const [q, setQ] = useState('');

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const m = (...f: (string | undefined)[]) => f.some((x) => x?.toLowerCase().includes(s));
    const out: Hit[] = [];
    books.filter((b) => m(b.title, b.subject, b.author)).forEach((b) => out.push({ key: `b${b.id}`, type: 'Book', title: b.title, sub: `${b.subject}${b.author ? ' · ' + b.author : ''}`, to: `/book/${b.id}`, cover: b.coverMsgId }));
    courses.forEach((c) => {
      if (m(c.title, c.description)) out.push({ key: `c${c.id}`, type: 'Course', title: c.title, sub: c.description ?? '', to: `/course/${encodeURIComponent(c.id)}`, cover: c.coverMsgId });
      c.subjects.forEach((su) => su.chapters.forEach((ch) => ch.lessons.forEach((l) => {
        if (m(l.title, su.title, ch.title)) out.push({ key: `l${l.id}`, type: 'Lesson', title: l.title, sub: `${c.title} · ${ch.title}`, to: `/watch/${l.id}`, cover: c.coverMsgId });
      })));
    });
    notices.filter((n) => m(n.title, n.body)).forEach((n) => out.push({ key: `n${n.id}`, type: 'Notice', title: n.title, sub: n.body, to: '/notice' }));
    return out;
  }, [q, books, courses, notices]);

  const Icon = (t: Hit['type']) => (t === 'Book' ? <BookOpen size={20} /> : t === 'Notice' ? <Bell size={20} /> : <PlayCircle size={20} />);

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 bg-bg px-3 py-3">
        <button onClick={() => nav(-1)} className="press rounded-full p-2"><ChevronLeft size={26} /></button>
        <div className="flex flex-1 items-center gap-3 rounded-2xl bg-card px-4 py-3">
          <SearchIcon size={18} className="text-sub" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim() && addSearch(q.trim())}
            placeholder="Search books, lessons, notices" className="w-full bg-transparent text-[15px] outline-none placeholder:text-sub" />
          {q && <button onClick={() => setQ('')}><X size={18} className="text-sub" /></button>}
        </div>
      </div>

      {!q && searches.length > 0 && (
        <div className="mt-2">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-extrabold">Recent</h2><button onClick={clearSearches} className="text-sm font-semibold text-tint">Clear</button></div>
          <div className="flex flex-wrap gap-2">{searches.map((s) => <button key={s} onClick={() => setQ(s)} className="press rounded-full bg-chip px-4 py-2 text-sm font-semibold">{s}</button>)}</div>
        </div>
      )}
      {q && !hits.length && <p className="mt-16 text-center text-sm text-sub">No results found</p>}
      <div className="mt-2 space-y-1">
        {hits.map((h) => (
          <button key={h.key} onClick={() => { addSearch(q.trim()); nav(h.to); }} className="press flex w-full items-center gap-3 rounded-xl p-2 text-left">
            <Cover id={h.cover} className="h-14 w-14 shrink-0 rounded-xl" icon={Icon(h.type)} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{h.title}</div>
              <div className="truncate text-xs text-sub">{h.sub}</div>
            </div>
            <span className="rounded-full bg-chip px-2.5 py-1 text-[11px] font-bold text-tint">{h.type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
