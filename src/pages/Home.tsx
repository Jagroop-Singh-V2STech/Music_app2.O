import { Clock3, Heart, ListMusic, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { useMusic } from "../context/MusicContext";
import { usePlayer } from "../context/PlayerContext";
import { useSearch } from "../hooks/useSearch";
import { Shelf } from "../components/common/Shelf";
import { CardSkeletons } from "../components/common/Loading";
import { SongCard } from "../components/music/SongCard";
import { AlbumCard } from "../components/music/AlbumCard";
import { ArtistCard } from "../components/music/ArtistCard";
import { MixCard } from "../components/music/MixCard";
import { Artwork } from "../components/music/Artwork";
import { PlaylistCard } from "../components/playlist/PlaylistCard";
import type { Song } from "../types/music";
import { deriveAlbums, deriveArtists, deriveMixes, greeting, recentlyAdded, uniqueSongs } from "../utils/library";

// Seed queries for discovery shelves; they go through the existing search API.
const TRENDING_QUERY = "latest";
const FALLBACK_ALBUM_QUERY = "hits";

function QuickTile({ to, title, art, songs }: { to: string; title: string; art: React.ReactNode; songs: Song[] }) {
  const { play } = usePlayer();
  return (
    <div className="quick-tile">
      <Link to={to} className="quick-link">{art}<strong>{title}</strong></Link>
      {songs.length > 0 && <button className="card-play sm" aria-label={`Play ${title}`} onClick={() => void play(songs[0], songs)}><Play fill="currentColor" /></button>}
    </div>
  );
}

export function Home() {
  const { favorites, recent, playlists } = useMusic();
  const { queue } = usePlayer();
  const library = uniqueSongs([...recent, ...favorites, ...playlists.flatMap(p => p.songs)]);
  const libraryArtists = deriveArtists(library);
  const trending = useSearch(TRENDING_QUERY);
  const albumSeed = libraryArtists[0]?.name ?? FALLBACK_ALBUM_QUERY;
  const recommended = useSearch(albumSeed);
  const mixes = deriveMixes(favorites, recent);
  const artists = deriveArtists([...library, ...(trending.data ?? [])]).slice(0, 12);
  const albums = deriveAlbums(recommended.data ?? []).slice(0, 12);
  const added = recentlyAdded(favorites, playlists);

  return (
    <div className="home">
      <header className="home-hero">
        <h1>{greeting()}</h1>
        <div className="quick-grid">
          <QuickTile to="/favorites" title="Liked Songs" songs={favorites} art={<span className="liked-tile"><Heart fill="currentColor" /></span>} />
          <QuickTile to="/recently-played" title="Recently Played" songs={recent} art={<span className="liked-tile alt"><Clock3 /></span>} />
          <QuickTile to="/queue" title={`Your Queue${queue.length ? ` (${queue.length})` : ""}`} songs={queue} art={<span className="liked-tile alt2"><ListMusic /></span>} />
          {playlists.slice(0, 5).map(p => <QuickTile key={p.id} to={`/playlist/${p.id}`} title={p.name} songs={p.songs} art={<Artwork song={{ imageUrl: p.coverImage || p.songs[0]?.imageUrl }} seed={p.name} />} />)}
        </div>
      </header>

      {recent.length > 0 && <Shelf title="Recently Played" to="/recently-played">{recent.slice(0, 12).map(s => <SongCard song={s} list={recent} key={s.id} />)}</Shelf>}

      {mixes.length > 0 && <Shelf title="Made For You" subtitle="Mixes built from what you play and like">{mixes.map(m => <MixCard mix={m} key={m.id} />)}</Shelf>}

      <Shelf title="Popular Artists" to="/artists">{trending.isLoading && !artists.length ? <CardSkeletons round /> : artists.length ? artists.map(a => <ArtistCard artist={a} key={a.name} />) : <p className="muted shelf-note">Artists you play will show up here.</p>}</Shelf>

      <Shelf title="Trending Tracks" to={`/search?q=${TRENDING_QUERY}`}>
        {trending.isLoading ? <CardSkeletons /> : trending.isError ? <p className="muted shelf-note">Trending tracks are unavailable right now.</p> : (trending.data ?? []).slice(0, 14).map(s => <SongCard song={s} list={trending.data} key={s.id} />)}
      </Shelf>

      <Shelf title="Your Playlists" to="/playlists">
        {playlists.length ? playlists.map(p => <PlaylistCard playlist={p} key={p.id} />) : <p className="muted shelf-note">Create a playlist for every moment — use the + in Your Library.</p>}
      </Shelf>

      <Shelf title="Recommended Albums" subtitle={libraryArtists[0] ? `Because you listen to ${albumSeed}` : undefined}>
        {recommended.isLoading ? <CardSkeletons /> : albums.length ? albums.map(a => <AlbumCard album={a} key={a.id} />) : <p className="muted shelf-note">Recommendations will appear as you listen.</p>}
      </Shelf>

      {added.length > 0 && <Shelf title="Recently Added" layout="grid">{added.map(s => <SongCard song={s} list={added} key={s.id} />)}</Shelf>}
    </div>
  );
}
