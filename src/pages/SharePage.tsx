import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Link2Off, Play, Plus } from "lucide-react";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { Loading } from "../components/common/Loading";
import { useToast } from "../components/common/Toast";
import { TrackList } from "../components/music/TrackList";
import { Artwork } from "../components/music/Artwork";
import { usePlayer } from "../context/PlayerContext";
import { useMusic } from "../context/MusicContext";
import { decodeShare, type SharePayload } from "../utils/share";
import { hueFrom } from "../utils/library";

/** /share#<data>: a song or playlist someone shared. Everything needed is in the link itself. */
export function SharePage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { play } = usePlayer();
  const { createPlaylist, updatePlaylist } = useMusic();
  const toast = useToast();
  const [payload, setPayload] = useState<SharePayload | null>();

  useEffect(() => {
    let cancelled = false;
    setPayload(undefined);
    decodeShare(hash.replace(/^#/, "")).then(result => { if (!cancelled) setPayload(result ?? null); });
    return () => { cancelled = true; };
  }, [hash]);

  if (payload === undefined) return <section className="page"><Loading rows={4} /></section>;
  if (payload === null) return <section className="page"><EmptyState icon={<Link2Off />} title="This link doesn't work" copy="It may have been cut off when it was copied. Ask for the link again." action={<Link className="pill light" to="/">Go home</Link>} /></section>;

  const { songs } = payload;
  const title = payload.kind === "song" ? songs[0].title : payload.name ?? "Shared playlist";
  const save = () => {
    const playlist = createPlaylist({ name: title, description: "Shared with you on MyMusic" });
    updatePlaylist(playlist.id, songs);
    toast(`Saved “${title}” to Your Library`);
    navigate(`/playlist/${playlist.id}`);
  };

  return (
    <section className="page collection-page">
      <PageHeader eyebrow={payload.kind === "song" ? "Shared song" : "Shared playlist"} title={title} hue={hueFrom(title)}
        art={<Artwork song={{ imageUrl: songs.find(s => s.imageUrl)?.imageUrl }} seed={title} className="header-art" />}
        subtitle={payload.kind === "song" ? songs[0].artist : `${songs.length} ${songs.length === 1 ? "song" : "songs"}`} />
      <div className="collection-actions share-actions">
        <button className="big-play" aria-label="Play" onClick={() => void play(songs[0], songs)}><Play fill="currentColor" /></button>
        {payload.kind === "playlist" && <button className="pill outline" onClick={save}><Plus aria-hidden="true" /> Save to Your Library</button>}
      </div>
      <TrackList songs={songs} header={false} />
    </section>
  );
}
