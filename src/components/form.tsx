import { useRef, type ReactNode } from 'react';
import { fmtSize } from '../lib/format';

export const inp = 'w-full rounded-xl bg-card px-4 py-3.5 text-[15px] outline-none placeholder:text-sub focus:ring-1 focus:ring-tint';
export const one = (s?: string) => (s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim(); // "|" is the caption separator
export const multi = (s?: string) => (s ?? '').replace(/\|/g, '/').trim();
export const eq = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
export const uniq = (l: string[]) => [...new Set(l)];

export function Field({ label, optional, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] font-semibold text-sub">{label}{optional && <span className="font-normal"> (optional)</span>}</div>
      {children}
    </label>
  );
}

/** tap an existing value instead of typing it again */
export function Suggest({ list, value, onPick }: { list: string[]; value: string; onPick: (v: string) => void }) {
  const items = list.filter((x) => !eq(x, value)).slice(0, 12);
  if (!items.length) return null;
  return (
    <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
      {items.map((x) => (
        <button key={x} type="button" onClick={() => onPick(x)} className="press shrink-0 rounded-lg bg-chip px-3.5 py-2 text-sm font-semibold">{x}</button>
      ))}
    </div>
  );
}

export function Pick({ label, accept, file, onFile, icon }: { label: string; accept: string; file: File | null; onFile: (f: File) => void; icon: ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          // copy into memory right away: on Android the picked file stops being readable once the input is reset
          try { onFile(new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified })); } catch { onFile(f); }
        }} />
      <button type="button" onClick={() => ref.current?.click()} className="press flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left">
        <span className="text-tint">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{file ? file.name : label}</span>
          {file && <span className="block text-xs text-sub">{fmtSize(file.size)}</span>}
        </span>
      </button>
    </>
  );
}
