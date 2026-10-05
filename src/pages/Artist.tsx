import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LoaderCircle, MicVocal } from "lucide-react";
import { useMusic } from "../context/MusicContext";
import { useArtistSongs } from "../hooks/useArtistSongs";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { Loading, CardSkeletons } from "../components/common/Loading";
import { TrackList } from "../components/music/TrackList";
import { CollectionActions } from "../components/music/CollectionActions";
import { AlbumCard } from "../components/music/AlbumCard";
import { Artwork } from "../components/music/Artwork";
import { Shelf } from "../components/common/Shelf";
import { deriveAlbums, hueFrom, primaryArtist, uniqueSongs } from "../utils/library";

const POPULAR_COUNT = 10;

export function Artist() {
  const name = decodeURIComponent(useParams().name ?? "");
  const { favorites, recent, playlists } = useMusic();
  const found = useArtistSongs(name);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [name]);
  const mine = uniqueSongs([...favorites, ...recent, ...playlists.flatMap(p => p.songs)]).filter(s => primaryArtist(s.artist).toLowerCase() === name.toLowerCase());
  const songs = uniqueSongs([...mine, ...found.songs]);
  const firstLoad = found.loading && !songs.length;
  const visible = showAll ? songs : songs.slice(0, POPULAR_COUNT);
  const image = songs.find(s => s.imageUrl)?.imageUrl;
  return (
    <section className="page collection-page">
      <PageHeader eyebrow="Artist" title={name} hue={hueFrom(name)} art={<Artwork song={{ imageUrl: image }} seed={name} round className="header-art" />}
        subtitle={songs.length ? `${songs.length} ${songs.length === 1 ? "song" : "songs"}${mine.length ? ` · ${mine.length} in your library` : ""}` : undefined} />
      <CollectionActions songs={songs} />
      <h2 className="section-title">{showAll ? "All songs" : "Popular"}</h2>
      {firstLoad ? <Loading rows={5} />
        : songs.length ? <TrackList songs={visible} header={false} draggable />
        : <EmptyState icon={<MicVocal />} title="No songs found" copy={found.error ? "Search is unavailable right now. Try again in a moment." : `We couldn't find songs by ${name}.`} />}
      {!firstLoad && songs.length > 0 && (
        <div className="artist-more">
          {songs.length > POPULAR_COUNT && <button className="text-btn" onClick={() => setShowAll(value => !value)}>{showAll ? "Show less" : `Show all ${songs.length} songs`}</button>}
          {found.loading && <span className="muted artist-finding" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /> Finding more songs…</span>}
        </div>
      )}
      <Shelf title="Discography">{firstLoad ? <CardSkeletons /> : deriveAlbums(songs).map(a => <AlbumCard album={a} key={a.id} />)}</Shelf>
    </section>
  );
}
