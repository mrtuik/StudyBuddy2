import { useState } from 'react';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { downloadFast } from '../telegram/media';
import { dlKey, toB64, useDownloads, type DlItem } from '../store/downloads';

interface ShareBook { id: number; title: string; size: number }

const safeName = (t: string) => t.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'book';

/** Puts the PDF in the cache folder (copy if already downloaded, otherwise fetch it) and opens the share sheet. */
export async function shareBook(book: ShareBook, local: DlItem | undefined, onProgress: (f: number) => void) {
  const path = `share_${safeName(book.title)}.pdf`;

  // remove older shared files to save space
  try {
    const { files } = await Filesystem.readdir({ path: '', directory: Directory.Cache });
    for (const f of files) {
      if (f.name.startsWith('share_') && f.name !== path) await Filesystem.deleteFile({ path: f.name, directory: Directory.Cache });
    }
  } catch { /* ignore */ }

  let ready = false;
  try {
    const st = await Filesystem.stat({ path, directory: Directory.Cache });
    ready = st.size === book.size;
  } catch { ready = false; }

  if (!ready) {
    try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* none */ }
    if (local) {
      await Filesystem.copy({ from: local.path, directory: Directory.Data, to: path, toDirectory: Directory.Cache });
    } else {
      let got = 0;
      await downloadFast(book.id, 0, book.size, async (u8) => {
        await Filesystem.appendFile({ path, directory: Directory.Cache, data: await toB64(u8) });
        got += u8.length;
        onProgress(got / Math.max(1, book.size));
      }, () => false);
    }
  }

  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: book.title, dialogTitle: 'Share PDF', files: [uri] });
}

export function useShareBook(book?: ShareBook) {
  const local = useDownloads((s) => (book ? s.items[dlKey('book', book.id)] : undefined));
  const [progress, setProgress] = useState<number | null>(null);

  const share = async () => {
    if (!book || progress !== null) return;
    setProgress(0);
    try {
      await shareBook(book, local?.status === 'done' ? local : undefined, setProgress);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/cancel|dismiss/i.test(msg)) window.alert(`Could not share this PDF.\n${msg}`);
    } finally {
      setProgress(null);
    }
  };
  return { share, progress };
}
