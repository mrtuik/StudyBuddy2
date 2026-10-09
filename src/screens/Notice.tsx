import { useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { Empty, PageHeader } from '../components/ui';
import { fmtDate } from '../lib/format';

export default function Notice() {
  const notices = useCatalog((s) => s.notices);
  const { noticeSeen, markNoticesSeen } = useLibrary();
  const newest = notices[0]?.id ?? 0;
  useEffect(() => { if (newest > noticeSeen) { const t = setTimeout(() => markNoticesSeen(newest), 1500); return () => clearTimeout(t); } }, [newest, noticeSeen, markNoticesSeen]);

  return (
    <div>
      <PageHeader title="Notices" />
      {!notices.length ? <Empty icon={<Bell size={28} />} text="No notices yet" /> : (
        <div className="space-y-3">
          {notices.map((n) => (
            <div key={n.id} className="rounded-2xl bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[17px] font-bold leading-tight">{n.title}</div>
                {n.id > noticeSeen && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-tint" />}
              </div>
              <div className="mt-0.5 text-xs text-sub">{fmtDate(n.date)}</div>
              {n.body && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-white/85">{n.body}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
