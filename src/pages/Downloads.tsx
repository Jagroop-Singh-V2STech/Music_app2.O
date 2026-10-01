import { useEffect, useState } from "react";
import { ArrowDownCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useOffline } from "../context/OfflineContext";
import { useToast } from "../components/common/Toast";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { TrackList } from "../components/music/TrackList";
import { CollectionActions } from "../components/music/CollectionActions";

const formatBytes = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

export function Downloads() {
  const { songs, totalSize, remove, online } = useOffline();
  const toast = useToast();
  const [quota, setQuota] = useState<number>();
  useEffect(() => { navigator.storage?.estimate?.().then(e => setQuota(e.quota)).catch(() => undefined); }, []);

  const clear = () => { if (!window.confirm(`Remove all ${songs.length} downloaded songs?`)) return; void remove(songs.map(s => s.id)); toast("Removed all downloads"); };

  return (
    <section className="page collection-page">
      <PageHeader eyebrow="Playlist" title="Downloads" hue={150} art={<span className="header-art liked-tile downloads-tile"><ArrowDownCircle /></span>}
        subtitle={<>{songs.length} {songs.length === 1 ? "song" : "songs"} · {formatBytes(totalSize)}{quota ? ` of ${formatBytes(quota)} available` : ""}{!online && <><br />You're offline — these songs still play.</>}</>} />
      <CollectionActions songs={songs}>
        {songs.length > 0 && <button className="pill outline" onClick={clear}>Remove all</button>}
      </CollectionActions>
      {songs.length ? <TrackList songs={songs} draggable /> : <EmptyState icon={<ArrowDownCircle />} title="Download songs to listen offline" copy="Use the download button on any playlist, or Download from a song's menu." action={<Link className="pill light" to="/">Browse music</Link>} />}
    </section>
  );
}
