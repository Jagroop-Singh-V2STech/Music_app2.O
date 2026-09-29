import { useParams } from "react-router-dom";
import { MicVocal } from "lucide-react";
import { useMusic } from "../context/MusicContext";
import { useSearch } from "../hooks/useSearch";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { Loading, CardSkeletons } from "../components/common/Loading";
import { TrackList } from "../components/music/TrackList";
import { CollectionActions } from "../components/music/CollectionActions";
import { AlbumCard } from "../components/music/AlbumCard";
import { Artwork } from "../components/music/Artwork";
import { Shelf } from "../components/common/Shelf";
import { deriveAlbums, hueFrom, primaryArtist, uniqueSongs } from "../utils/library";

export function Artist() {
  const name = decodeURIComponent(useParams().name ?? "");
  const { favorites, recent, playlists } = useMusic();
  const result = useSearch(name);
  const mine = uniqueSongs([...favorites, ...recent, ...playlists.flatMap(p => p.songs)]).filter(s => primaryArtist(s.artist).toLowerCase() === name.toLowerCase());
  const popular = uniqueSongs([...mine, ...(result.data ?? []).filter(s => s.artist.toLowerCase().includes(name.toLowerCase()))]);
  const songs = popular.length ? popular : result.data ?? [];
  const image = songs.find(s => s.imageUrl)?.imageUrl;
  return (
    <section className="page collection-page">
      <PageHeader eyebrow="Artist" title={name} hue={hueFrom(name)} art={<Artwork song={{ imageUrl: image }} seed={name} round className="header-art" />}
        subtitle={mine.length ? `${mine.length} ${mine.length === 1 ? "song" : "songs"} in your library` : undefined} />
      <CollectionActions songs={songs.slice(0, 20)} />
      <h2 className="section-title">Popular</h2>
      {result.isLoading && !mine.length ? <Loading rows={5} /> : songs.length ? <TrackList songs={songs.slice(0, 10)} header={false} draggable /> : <EmptyState icon={<MicVocal />} title="No songs found" copy={`We couldn't find songs by ${name}.`} />}
      <Shelf title="Discography">{result.isLoading ? <CardSkeletons /> : deriveAlbums(songs).map(a => <AlbumCard album={a} key={a.id} />)}</Shelf>
    </section>
  );
}
