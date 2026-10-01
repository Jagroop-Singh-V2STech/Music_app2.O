import { useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { BottomPlayer } from "./components/layout/BottomPlayer";
import { MobileNavigation } from "./components/layout/MobileNavigation";
import { QueueDrawer } from "./components/player/QueueDrawer";
import { ExpandedPlayer } from "./components/player/ExpandedPlayer";
import { CreatePlaylistModal } from "./components/playlist/CreatePlaylistModal";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Library } from "./pages/Library";
import { Favorites } from "./pages/Favorites";
import { RecentlyPlayed } from "./pages/RecentlyPlayed";
import { Queue } from "./pages/Queue";
import { PlaylistDetails } from "./pages/PlaylistDetails";
import { Artist } from "./pages/Artist";
import { FeaturedPlaylist } from "./pages/FeaturedPlaylist";
import { Downloads } from "./pages/Downloads";
import { usePlayer } from "./context/PlayerContext";
import { useMediaQuery } from "./hooks/useMediaQuery";

function Shortcuts() { const p = usePlayer(); const navigate = useNavigate(); useEffect(() => { const onKey = (e: KeyboardEvent) => { if (["INPUT", "TEXTAREA"].includes((document.activeElement as HTMLElement)?.tagName)) return; if (e.key === " ") { e.preventDefault(); p.toggle(); } if (e.key === "ArrowRight") p.seek(p.progress + 5); if (e.key === "ArrowLeft") p.seek(Math.max(0, p.progress - 5)); if (e.key.toLowerCase() === "n") p.next(); if (e.key.toLowerCase() === "m") p.setMuted(!p.muted); if (e.key === "/") { e.preventDefault(); navigate("/search"); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [navigate, p]); return null; }

const COLLAPSE_KEY = "music_sidebar_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

export default function App() {
  const [create, setCreate] = useState(false);
  const [queue, setQueue] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const scroller = useRef<HTMLElement>(null);
  const location = useLocation();
  // Tablets always show the icon rail; the menu button opens the full sidebar as a drawer.
  const tablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const railOnly = tablet ? !drawer : collapsed;

  const toggleCollapsed = () => setCollapsed(value => { try { localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1"); } catch { /* storage unavailable */ } return !value; });
  const openCreate = useCallback(() => { setDrawer(false); setCreate(true); }, []);
  const closeQueue = useCallback(() => setQueue(false), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const openQueue = useCallback(() => { setExpanded(false); setQueue(value => !value); }, []);

  // New page: close the mobile drawer and start at the top.
  useEffect(() => { setDrawer(false); scroller.current?.scrollTo({ top: 0 }); setScrolled(false); }, [location.pathname]);
  useEffect(() => { if (!drawer) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [drawer]);

  return (
    <div className={`app ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <Shortcuts />
      <Sidebar onCreate={openCreate} collapsed={railOnly} onToggle={toggleCollapsed} mobileOpen={drawer} onClose={() => setDrawer(false)} />
      <main id="main" ref={scroller} className="main" onScroll={e => setScrolled(e.currentTarget.scrollTop > 24)}>
        <Header onMenu={() => setDrawer(true)} solid={scrolled} />
        <div className="content page-enter" key={location.pathname}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/library" element={<Library onCreate={openCreate} />} />
            <Route path="/playlists" element={<Library tab="playlists" onCreate={openCreate} />} />
            <Route path="/albums" element={<Library tab="albums" />} />
            <Route path="/artists" element={<Library tab="artists" />} />
            <Route path="/artist/:name" element={<Artist />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/liked" element={<Favorites />} />
            <Route path="/recently-played" element={<RecentlyPlayed />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/playlist/:id" element={<PlaylistDetails />} />
            <Route path="/featured/:id" element={<FeaturedPlaylist />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/now-playing" element={<div className="now-playing-page"><ExpandedPlayer inline onQueue={openQueue} /></div>} />
          </Routes>
        </div>
      </main>
      <QueueDrawer open={queue} close={closeQueue} />
      <BottomPlayer onQueue={openQueue} onExpand={() => setExpanded(true)} queueOpen={queue} />
      <MobileNavigation />
      <ExpandedPlayer open={expanded} onClose={closeExpanded} onQueue={openQueue} />
      {create && <CreatePlaylistModal onClose={() => setCreate(false)} />}
    </div>
  );
}
