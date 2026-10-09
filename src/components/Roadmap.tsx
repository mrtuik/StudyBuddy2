import { useState } from 'react';
import { ChevronDown, Minus, Plus, RefreshCw, X } from 'lucide-react';
import type { ChapRow, ChapterSet } from '../lib/outline';

interface Props {
  rows: ChapRow[];
  set?: ChapterSet;
  loading: boolean;
  msg: string;
  page: number;
  total: number;
  offset: number;
  setOffset: (n: number) => void;
  onGo: (p: number) => void;
  onClose: () => void;
  onRescan: () => void;
}

export default function Roadmap({ rows, set, loading, msg, page, total, offset, setOffset, onGo, onClose, onRescan }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const cur = rows.reduce((a, r, i) => (r.page <= page ? i : a), 0);
  const pct = total ? Math.round((page / total) * 100) : 0;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg">
      <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-4">
        <div>
          <div className="text-xl font-bold">Contents</div>
          <div className="mt-0.5 text-xs text-sub">{rows.length} chapters · {pct}% read</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onRescan} className="press flex h-10 w-10 items-center justify-center rounded-full text-sub" aria-label="Rescan"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={onClose} className="press flex h-10 w-10 items-center justify-center rounded-full text-white" aria-label="Close"><X size={22} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 pb-12">
        {loading && !rows.length && <p className="py-10 text-center text-sm text-sub">{msg}</p>}

        {set?.src === 'text' && (
          <div className="mb-3 flex items-center justify-between text-xs text-sub">
            <span>Printed page 1 = PDF page <b className="text-white">{1 + offset}</b></span>
            <span className="flex gap-1.5">
              <button onClick={() => setOffset(offset - 1)} className="press flex h-8 w-8 items-center justify-center rounded-full bg-chip"><Minus size={14} /></button>
              <button onClick={() => setOffset(offset + 1)} className="press flex h-8 w-8 items-center justify-center rounded-full bg-chip"><Plus size={14} /></button>
            </span>
          </div>
        )}
        {set?.src === 'auto' && <p className="mb-3 text-xs text-sub">No chapter titles found in this PDF, so it is split into parts.</p>}

        {rows.map((r, i) => {
          const here = i === cur;
          const len = Math.max(1, r.end - r.page + 1);
          const cp = Math.min(100, Math.round(((page - r.page + 1) / len) * 100));
          return (
            <div key={`${r.n}-${r.page}`} className="border-t border-white/[0.07]">
              <div className="flex items-start">
                <button onClick={() => { onGo(r.page); onClose(); }} className="press flex min-w-0 flex-1 items-baseline gap-4 py-3.5 text-left">
                  <span className={`w-6 shrink-0 text-sm tabular-nums ${here ? 'text-tint' : 'text-sub'}`}>{r.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] leading-snug ${here ? 'font-semibold text-white' : i < cur ? 'text-white/50' : 'text-white/90'}`}>{r.title}</span>
                    {here && <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-tint" style={{ width: `${cp}%` }} /></span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-sub">{r.page}</span>
                </button>
                {r.items.length > 0 && (
                  <button onClick={() => setOpen(open === i ? null : i)} className="press flex h-12 w-9 shrink-0 items-center justify-center text-sub" aria-label="Topics">
                    <ChevronDown size={16} className={open === i ? 'rotate-180' : ''} />
                  </button>
                )}
              </div>
              {open === i && (
                <div className="pb-2 pl-10">
                  {r.items.map((k, j) => (
                    <button key={j} onClick={() => { onGo(k.page); onClose(); }} className="press flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-[13px] text-white/70">
                      <span className="min-w-0 flex-1">{k.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-sub">{k.page}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
