import { ArrowDownCircle, Clock3, Disc3, Heart, House, Library, ListMusic, MicVocal, PanelLeftClose, PanelLeftOpen, Plus, Search, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useMusic } from "../../context/MusicContext";
import { useOffline } from "../../context/OfflineContext";
import type { Song } from "../../types/music";
import { useToast } from "../common/Toast";
import { Artwork } from "../music/Artwork";

interface SidebarProps { onCreate(): void; collapsed: boolean; onToggle(): void; mobileOpen: boolean; onClose(): void }

export function Sidebar({ onCreate, collapsed, onToggle, mobileOpen, onClose }: SidebarProps) {
  const { playlists, favorites, addToPlaylists } = useMusic();
  const { songs: downloads } = useOffline();
  const toast = useToast();
  const drop = (event: React.DragEvent, playlistId: string) => { event.preventDefault(); event.currentTarget.classList.remove("drop-target"); try { const song = JSON.parse(event.dataTransfer.getData("song")) as Song; const names = addToPlaylists(song, [playlistId]); toast(names.length ? `Added to ${names[0]}` : "Song is already in this playlist"); } catch { /* non-song drag */ } };
  const link = (to: string, Icon: typeof House, label: string, end = false) => <NavLink to={to} end={end} title={collapsed ? label : undefined} className="nav-link"><Icon aria-hidden="true" /><span className="nav-label">{label}</span></NavLink>;
  return (
    <>
      <div className={`scrim nav-scrim ${mobileOpen ? "open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`} aria-label="Sidebar">
        <div className="side-card">
          <div className="brand-row">
            <NavLink to="/" className="brand" aria-label="MyMusic home"><span className="brand-mark"><Disc3 /></span><span className="nav-label">MyMusic</span></NavLink>
            <button className="icon-button drawer-close" aria-label="Close menu" onClick={onClose}><X /></button>
          </div>
          <nav aria-label="Main">{link("/", House, "Home", true)}{link("/search", Search, "Search")}</nav>
        </div>
        <div className="side-card library-card">
          <div className="library-head">
            <button className="icon-button collapse-btn" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggle}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
            <NavLink to="/library" end className="library-title nav-label"><Library aria-hidden="true" /> Your Library</NavLink>
            <button className="icon-button add-btn" aria-label="Create playlist" title="Create playlist" onClick={onCreate}><Plus /></button>
          </div>
          <nav aria-label="Your library">
            {link("/playlists", ListMusic, "Playlists")}
            {link("/albums", Disc3, "Albums")}
            {link("/artists", MicVocal, "Artists")}
            {link("/recently-played", Clock3, "Recently played")}
            {link("/queue", ListMusic, "Queue")}
          </nav>
          <div className="side-divider" />
          <nav className="playlist-nav" aria-label="Playlists">
            <NavLink to="/favorites" className="playlist-link" title={collapsed ? "Liked Songs" : undefined}>
              <span className="liked-tile"><Heart fill="currentColor" /></span>
              <span className="nav-label"><strong>Liked Songs</strong><small>Playlist • {favorites.length} songs</small></span>
            </NavLink>
            <NavLink to="/downloads" className="playlist-link" title={collapsed ? "Downloads" : undefined}>
              <span className="liked-tile downloads-tile"><ArrowDownCircle /></span>
              <span className="nav-label"><strong>Downloads</strong><small>Offline • {downloads.length} songs</small></span>
            </NavLink>
            {playlists.map(p => (
              <NavLink key={p.id} to={`/playlist/${p.id}`} className="playlist-link" title={collapsed ? p.name : undefined}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drop-target"); }} onDragLeave={e => e.currentTarget.classList.remove("drop-target")} onDrop={e => drop(e, p.id)}>
                <Artwork song={{ imageUrl: p.coverImage || p.songs[0]?.imageUrl }} seed={p.name} className="tiny-cover" />
                <span className="nav-label"><strong>{p.name}</strong><small>Playlist • {p.songs.length} songs</small></span>
              </NavLink>
            ))}
            {!playlists.length && !collapsed && <div className="side-promo"><strong>Create your first playlist</strong><p>It's easy, we'll help you.</p><button className="pill light" onClick={onCreate}>Create playlist</button></div>}
          </nav>
        </div>
      </aside>
    </>
  );
}
