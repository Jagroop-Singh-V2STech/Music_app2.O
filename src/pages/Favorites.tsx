import { Heart } from "lucide-react";
import { Link } from "react-router-dom";
import { useMusic } from "../context/MusicContext";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { TrackList } from "../components/music/TrackList";
import { CollectionActions } from "../components/music/CollectionActions";

export const Favorites = () => {
  const { favorites } = useMusic();
  return (
    <section className="page collection-page">
      <PageHeader eyebrow="Playlist" title="Liked Songs" hue={255} subtitle={`${favorites.length} ${favorites.length === 1 ? "song" : "songs"}`} art={<span className="header-art liked-tile"><Heart fill="currentColor" /></span>} />
      <CollectionActions songs={favorites} />
      {favorites.length ? <TrackList songs={favorites} draggable /> : <EmptyState icon={<Heart />} title="Songs you like will appear here" copy="Save songs by tapping the heart icon." action={<Link className="pill light" to="/search">Find songs</Link>} />}
    </section>
  );
};
