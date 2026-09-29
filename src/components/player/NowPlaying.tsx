import { Link } from "react-router-dom";
import { Artwork } from "../music/Artwork";
import { LikeButton } from "./LikeButton";
import { usePlayer } from "../../context/PlayerContext";
import { primaryArtist } from "../../utils/library";

export const NowPlaying = ({ onOpen }: { onOpen?(): void }) => {
  const { currentSong, loading, error } = usePlayer();
  return (
    <div className="now-playing">
      <button className="np-art" aria-label="Open now playing view" onClick={onOpen} disabled={!currentSong}><Artwork song={currentSong} seed={currentSong?.title} /></button>
      <div className="np-copy">
        <strong key={currentSong?.id} className="fade-in">{loading ? "Loading track…" : currentSong?.title ?? "Nothing playing"}</strong>
        {error ? <span className="np-error">{error}</span>
          : currentSong ? <Link to={`/artist/${encodeURIComponent(primaryArtist(currentSong.artist))}`} onClick={e => e.stopPropagation()}>{currentSong.artist}</Link>
          : <span>Choose a song to begin</span>}
      </div>
      <LikeButton song={currentSong} />
    </div>
  );
};
