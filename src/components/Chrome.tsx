import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, Download, House, Pause, Play, PlayCircle, Search, ShieldCheck, UserRound } from 'lucide-react';
import { useLibrary, type Recent } from '../store/library';
import { useCatalog } from '../store/catalog';
import { useDownloads } from '../store/downloads';
import { pct } from '../lib/format';
import { Bar, Cover } from './ui';

export const ROOTS = ['/', '/books', '/videos', '/admin'];
export const openPath = (r: Recent) => (r.type === 'book' ? `/read/${r.id}` : `/watch/${r.id}`);

export function AppBar() {
  const nav = useNavigate();
  const notices = useCatalog((s) => s.notices);
  const seen = useLibrary((s) => s.noticeSeen);
  const unread = notices.some((n) => n.id > seen);
  return (
    <header className="flex items-center justify-between px-4 pb-2 pt-3">
      <button onClick={() => nav('/about')} className="press rounded-full bg-chip p-2.5"><UserRound size={20} /></button>
      <div className="flex items-center gap-2">
        <img src="./logo.png" alt="" className="h-7 w-7 rounded-lg" />
        <span className="text-[19px] font-extrabold tracking-tight">StudyBuddy</span>
      </div>
      <button onClick={() => nav('/notice')} className="press relative rounded-full bg-chip p-2.5" aria-label="Notices">
        <Bell size={20} />
        {unread && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-tint" />}
      </button>
    </header>
  );
}

export function SearchBar() {
  const nav = useNavigate();
  const active = useDownloads((s) => Object.values(s.items).filter((i) => i.status === 'running' || i.status === 'queued').length);
  return (
    <div className="flex items-center gap-3 px-4 pb-3 pt-1">
      <button onClick={() => nav('/search')} className="press flex flex-1 items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left text-[15px] text-sub">
        <Search size={18} /> Search books, lessons, notices
      </button>
      <button onClick={() => nav('/downloads')} className="press relative rounded-2xl bg-card p-3.5">
        <Download size={20} />
        {active > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-tint" />}
      </button>
    </div>
  );
}

export function MiniBar() {
  const nav = useNavigate();
  const cur = useLibrary((s) => s.recents[0]);
  const progress = useLibrary((s) => s.progress);
  if (!cur) return null;
  return (
    <button onClick={() => nav(openPath(cur))} className="press mx-3 mb-2 block overflow-hidden rounded-xl border border-white/10 bg-card text-left">
      <div className="flex items-center gap-3 p-2.5">
        <Cover id={cur.coverId} className="h-11 w-11 rounded-xl" icon={cur.type === 'lesson' ? <PlayCircle size={20} /> : undefined} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{cur.title}</div>
          <div className="truncate text-xs text-sub">{cur.type === 'book' ? 'Continue reading' : 'Continue watching'}{cur.subtitle ? ` · ${cur.subtitle}` : ''}</div>
        </div>
        <div className="rounded-full bg-accent p-2 text-white">{cur.type === 'book' ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}</div>
      </div>
      <Bar value={pct(progress[cur.key])} className="rounded-none" />
    </button>
  );
}

const tabs = [
  { to: '/', label: 'Home', Icon: House },
  { to: '/books', label: 'Books', Icon: BookOpen },
  { to: '/videos', label: 'Videos', Icon: PlayCircle },
  { to: '/admin', label: 'Admin', Icon: ShieldCheck },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="flex border-t border-white/5 bg-bg pb-1 pt-2">
      {tabs.map(({ to, label, Icon }) => {
        const on = to === '/' ? pathname === '/' : pathname.startsWith(to);
        return (
          <NavLink key={to} to={to} replace className="press relative flex flex-1 flex-col items-center gap-1 py-1">
            <div className="relative">
              <Icon size={24} className={on ? 'text-white' : 'text-sub'} strokeWidth={on ? 2.6 : 2} />
            </div>
            <span className={`text-[11px] font-semibold ${on ? 'text-white' : 'text-sub'}`}>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
