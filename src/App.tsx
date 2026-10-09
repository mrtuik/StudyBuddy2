import { useEffect, useRef } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useCatalog } from './store/catalog';
import { useLibrary } from './store/library';
import { useDownloads, dlKey } from './store/downloads';
import { warmRemotePdf } from './telegram/stream';
import { AppBar, BottomNav, MiniBar, ROOTS, SearchBar } from './components/Chrome';
import Home from './screens/Home';
import Books from './screens/Books';
import BookDetail from './screens/BookDetail';
import PdfReader from './screens/PdfReader';
import Courses from './screens/Courses';
import CourseDetail from './screens/CourseDetail';
import SubjectDetail from './screens/SubjectDetail';
import ChapterLectures from './screens/ChapterLectures';
import VideoPlayer from './screens/VideoPlayer';
import Notice from './screens/Notice';
import Search from './screens/Search';
import Downloads from './screens/Downloads';
import About from './screens/About';
import Admin from './screens/Admin';
import BuddyOverlay from './buddy/BuddyOverlay';

export default function App() {
  const { loadCache, sync } = useCatalog();
  const { pathname } = useLocation();
  useEffect(() => { loadCache().then(sync); }, [loadCache, sync]);

  // open the PDF the learner was reading in the background, so Continue reading does not start from zero
  const books = useCatalog((s) => s.books);
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || !books.length) return;
    const r = useLibrary.getState().recents.find((x) => x.type === 'book');
    const b = r && books.find((x) => x.id === r.id);
    if (!b) return;
    warmed.current = true;
    if (useDownloads.getState().items[dlKey('book', b.id)]?.status === 'done') return;   // already on the phone
    warmRemotePdf(b.id, b.size, useLibrary.getState().progress[`book:${b.id}`]?.position ?? 1);
  }, [books]);

  // refresh when the app returns to the foreground (at most once every 30s)
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 30000) { last = Date.now(); void sync(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  const full = pathname.startsWith('/read') || pathname.startsWith('/watch');
  return (
    <div className="flex h-full flex-col bg-bg">
      {ROOTS.includes(pathname) && <><AppBar />{pathname !== '/admin' && <SearchBar />}</>}
      <main className={`flex-1 overflow-y-auto ${full ? '' : 'px-4 pb-4'}`}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/books" element={<Books />} />
          <Route path="/book/:id" element={<BookDetail />} />
          <Route path="/read/:id" element={<PdfReader />} />
          <Route path="/videos" element={<Courses />} />
          <Route path="/course/:id" element={<CourseDetail />} />
          <Route path="/course/:cid/:sid" element={<SubjectDetail />} />
          <Route path="/course/:cid/:sid/:chid" element={<ChapterLectures />} />
          <Route path="/watch/:id" element={<VideoPlayer />} />
          <Route path="/notice" element={<Notice />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/search" element={<Search />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </main>
      {!full && <MiniBar />}
      {!full && <BottomNav />}
      <BuddyOverlay />
    </div>
  );
}
