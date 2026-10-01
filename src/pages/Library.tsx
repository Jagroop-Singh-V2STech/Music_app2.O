import { ArrowDownCircle, Heart, Plus } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useMusic } from "../context/MusicContext";
import { useOffline } from "../context/OfflineContext";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { PlaylistCard } from "../components/playlist/PlaylistCard";
import { AlbumCard } from "../components/music/AlbumCard";
import { ArtistCard } from "../components/music/ArtistCard";
import { MediaCard } from "../components/music/MediaCard";
import { deriveAlbums, deriveArtists, uniqueSongs } from "../utils/library";

export type LibraryTab = "all" | "playlists" | "albums" | "artists";
const TABS: [LibraryTab, string, string][] = [["all", "All", "/library"], ["playlists", "Playlists", "/playlists"], ["albums", "Albums", "/albums"], ["artists", "Artists", "/artists"]];

export const Library = ({ tab = "all", onCreate }: { tab?: LibraryTab; onCreate?(): void }) => {
  const { playlists, favorites, recent } = useMusic();
  const { songs: downloads } = useOffline();
  const songs = uniqueSongs([...favorites, ...playlists.flatMap(p => p.songs), ...recent]);
  const albums = deriveAlbums(songs);
  const artists = deriveArtists(songs);
  const title = TABS.find(t => t[0] === tab)![1];
  return (
    <section className="page">
      <PageHeader eyebrow="Your Library" title={tab === "all" ? "Your Library" : title} hue={200} compact />
      <nav className="chips" aria-label="Library filters">{TABS.map(([id, label, to]) => <NavLink key={id} to={to} end className="chip">{label}</NavLink>)}</nav>

      {(tab === "all" || tab === "playlists") && <section className="result-group fade-up">
        {tab === "all" && <h2>Playlists</h2>}
        <div className="card-grid">
          <MediaCard title="Liked Songs" subtitle={`Playlist • ${favorites.length} songs`} songs={favorites} to="/favorites" overlay={<span className="liked-art"><Heart fill="currentColor" /></span>} />
          <MediaCard title="Downloads" subtitle={`Offline • ${downloads.length} songs`} songs={downloads} to="/downloads" overlay={<span className="liked-art downloads-tile"><ArrowDownCircle /></span>} />
          {playlists.map(p => <PlaylistCard playlist={p} key={p.id} />)}
          {onCreate && <button className="card create-card" onClick={onCreate}><span className="create-art"><Plus /></span><strong>Create playlist</strong><span className="card-sub">Name it, add a cover, fill it up</span></button>}
        </div>
      </section>}

      {(tab === "all" || tab === "albums") && <section className="result-group fade-up">
        {tab === "all" && <h2>Albums & Singles</h2>}
        {albums.length ? <div className="card-grid">{albums.map(a => <AlbumCard album={a} key={a.id} />)}</div> : <EmptyState title="No albums yet" copy="Albums and singles from songs you like, play or save to playlists show up here." />}
      </section>}

      {(tab === "all" || tab === "artists") && <section className="result-group fade-up">
        {tab === "all" && <h2>Artists</h2>}
        {artists.length ? <div className="card-grid">{artists.map(a => <ArtistCard artist={a} key={a.name} />)}</div> : <EmptyState title="No artists yet" copy="Artists you listen to will appear here." />}
      </section>}
    </section>
  );
};
