import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronLeft, PlayCircle } from 'lucide-react';
import { coverUrl, lessonThumbUrl } from '../telegram/media';
import { ytThumb } from '../lib/youtube';

export function Cover({ id, className = '', icon, src }: { id?: number; className?: string; icon?: ReactNode; src?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let on = true;
    setUrl(undefined);
    if (id) coverUrl(id).then((u) => on && setUrl(u));
    return () => { on = false; };
  }, [id]);
  if (url || src) return <img src={url ?? src} alt="" loading="lazy" className={`object-cover ${className}`} />;
  return (
    <div className={`flex items-center justify-center bg-chip text-white/35 ${className}`}>
      {icon ?? <BookOpen size={22} />}
    </div>
  );
}

export function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`press shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${active ? 'bg-white text-black' : 'bg-chip text-white'}`}
    >
      {label}
    </button>
  );
}

export function ChipRow({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      {items.map((i) => <Chip key={i} label={i} active={i === value} onClick={() => onChange(i)} />)}
    </div>
  );
}

export const SectionTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="mb-2.5 mt-6 flex items-center justify-between">
    <h2 className="text-lg font-bold tracking-tight">{children}</h2>
    {action}
  </div>
);

export const Bar = ({ value, className = '' }: { value: number; className?: string }) => (
  <div className={`h-1 overflow-hidden rounded-full bg-white/15 ${className}`}>
    <div className="h-full rounded-full bg-tint" style={{ width: `${Math.round(value * 100)}%` }} />
  </div>
);

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-2 bg-bg/95 px-3 py-3 backdrop-blur">
      <button onClick={() => nav(-1)} className="press rounded-full p-2"><ChevronLeft size={26} /></button>
      <h1 className="flex-1 truncate text-lg font-bold">{title}</h1>
      {right}
    </div>
  );
}

export const Empty = ({ icon, text }: { icon: ReactNode; text: string }) => (
  <div className="mt-24 flex flex-col items-center gap-3 text-sub">
    <div className="rounded-full bg-card p-5">{icon}</div>
    <p className="text-sm">{text}</p>
  </div>
);

export function Ring({ value, size = 36 }: { value: number; size?: number }) {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.18)" strokeWidth="3" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#B0A8FA" strokeWidth="3" fill="none"
        strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round" />
    </svg>
  );
}

/** Thumbnail of one lesson: the YouTube thumbnail, or the preview Telegram made for the video. Never another lesson's picture. */
export function LessonThumb({ id, yt, className = '' }: { id: number; yt?: string; className?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let on = true;
    setUrl(undefined);
    if (!yt) lessonThumbUrl(id).then((u) => on && setUrl(u));
    return () => { on = false; };
  }, [id, yt]);
  const src = yt ? ytThumb(yt) : url;
  if (src) return <img src={src} alt="" loading="lazy" className={`object-cover ${className}`} />;
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-chip to-card text-white/30 ${className}`}>
      <PlayCircle size={30} />
    </div>
  );
}
