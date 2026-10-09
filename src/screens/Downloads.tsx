import { useNavigate } from 'react-router-dom';
import { Check, Download, FileText, Pause, Play, PlayCircle, Trash2 } from 'lucide-react';
import { useDownloads } from '../store/downloads';
import { Bar, Empty, PageHeader } from '../components/ui';
import { fmtSize, fmtSpeed } from '../lib/format';

export default function Downloads() {
  const nav = useNavigate();
  const { items, pause, resume, remove } = useDownloads();
  const list = Object.values(items).reverse();
  const used = list.reduce((n, i) => n + i.bytes, 0);

  return (
    <div>
      <PageHeader title="Downloads" />
      <div className="mb-4 rounded-2xl bg-card p-4">
        <div className="text-xs text-sub">Storage used</div>
        <div className="text-2xl font-extrabold">{fmtSize(used)}</div>
      </div>
      {!list.length ? <Empty icon={<Download size={28} />} text="No downloads yet" /> : (
        <div className="space-y-2.5">
          {list.map((i) => {
            const p = i.bytes / Math.max(1, i.size);
            const run = i.status === 'running' || i.status === 'queued';
            return (
              <div key={i.key} className="rounded-2xl bg-card p-3.5">
                <div className="flex items-center gap-3">
                  <button onClick={() => i.status === 'done' && nav(i.type === 'book' ? `/read/${i.msgId}` : `/watch/${i.msgId}`)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent">
                    {i.type === 'book' ? <FileText size={22} /> : <PlayCircle size={22} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{i.title}</div>
                    <div className="flex items-center gap-1 text-xs text-sub">
                      {i.status === 'done' ? <><Check size={13} className="text-tint" /> {fmtSize(i.size)}</>
                        : `${i.status === 'error' ? 'Failed' : i.status === 'paused' ? 'Paused' : i.status === 'queued' ? 'Queued' : 'Downloading'} · ${Math.round(p * 100)}%${i.status === 'running' && i.speed ? ' · ' + fmtSpeed(i.speed) : ''}`}
                    </div>
                  </div>
                  {i.status !== 'done' && (
                    <button onClick={() => (run ? pause(i.key) : resume(i.key))} className="rounded-full bg-chip p-2.5">{run ? <Pause size={16} /> : <Play size={16} />}</button>
                  )}
                  <button onClick={() => remove(i.key)} className="rounded-full bg-chip p-2.5"><Trash2 size={16} className="text-red-300" /></button>
                </div>
                {i.status !== 'done' && <Bar value={p} className="mt-3" />}
                {i.status === 'error' && i.error && <p className="mt-2 break-words text-xs text-red-300">{i.error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
