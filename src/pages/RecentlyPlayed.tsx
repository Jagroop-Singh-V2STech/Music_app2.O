import { Clock3 } from "lucide-react";
import { useMusic } from "../context/MusicContext";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { TrackList } from "../components/music/TrackList";
import { CollectionActions } from "../components/music/CollectionActions";

export const RecentlyPlayed = () => {
  const { recent } = useMusic();
  return (
    <section className="page collection-page">
      <PageHeader eyebrow="Your history" title="Recently Played" hue={160} subtitle={`${recent.length} songs`} art={<span className="header-art liked-tile alt"><Clock3 /></span>} />
      <CollectionActions songs={recent} />
      {recent.length ? <TrackList songs={recent} draggable /> : <EmptyState icon={<Clock3 />} title="Nothing played yet" copy="Your listening history will show up here." />}
    </section>
  );
};
