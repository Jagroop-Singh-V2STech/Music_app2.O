import { useNavigate, useParams } from "react-router-dom";
import { ListMusic, ListPlus } from "lucide-react";
import { useMusic } from "../context/MusicContext";
import { useToast } from "../components/common/Toast";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { Loading } from "../components/common/Loading";
import { Shelf } from "../components/common/Shelf";
import { TrackList } from "../components/music/TrackList";
import { CollectionActions } from "../components/music/CollectionActions";
import { FeaturedCard, FeaturedCover } from "../components/music/FeaturedCard";
import { featuredPlaylists, findFeatured } from "../data/featuredPlaylists";
import { useFeaturedPlaylist } from "../hooks/useFeaturedPlaylist";

export function FeaturedPlaylist() {
  const playlist = findFeatured(useParams().id ?? "");
  const { songs, isLoading, isError } = useFeaturedPlaylist(playlist);
  const { createPlaylist, updatePlaylist } = useMusic();
  const toast = useToast();
  const navigate = useNavigate();

  if (!playlist) return <section className="page"><EmptyState icon={<ListMusic />} title="Playlist not found" copy="This playlist doesn't exist." /></section>;

  // Saving snapshots the current songs into an editable playlist in the user's library.
  const save = () => {
    const created = createPlaylist({ name: playlist.title, description: playlist.description });
    updatePlaylist(created.id, songs);
    toast(`Saved ${playlist.title} to Your Library`);
    navigate(`/playlist/${created.id}`);
  };

  return (
    <section className="page collection-page">
      <PageHeader eyebrow="Playlist" title={playlist.title} hue={playlist.hue} art={<FeaturedCover playlist={playlist} className="header-art" />}
        subtitle={<>{playlist.description}{songs.length > 0 && <> · {songs.length} songs</>}</>} />
      <CollectionActions songs={songs}>
        <button className="icon-button lg" disabled={!songs.length} aria-label="Save to Your Library" title="Save to Your Library" onClick={save}><ListPlus /></button>
      </CollectionActions>
      {isLoading && !songs.length ? <Loading rows={8} /> : songs.length ? <TrackList songs={songs} draggable /> : <EmptyState icon={<ListMusic />} title={isError ? "Playlist unavailable" : "No songs found"} copy={isError ? "We couldn't load this playlist. Try again in a moment." : "Check back later for fresh tracks."} />}
      <Shelf title="More playlists">{featuredPlaylists.filter(p => p.id !== playlist.id).map(p => <FeaturedCard playlist={p} key={p.id} />)}</Shelf>
    </section>
  );
}
