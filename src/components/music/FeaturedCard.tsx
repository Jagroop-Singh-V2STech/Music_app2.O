import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Pause, Play } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { FeaturedPlaylist } from "../../data/featuredPlaylists";
import { usePlayer } from "../../context/PlayerContext";
import { useToast } from "../common/Toast";
import { cachedFeaturedSongs, loadFeaturedSongs } from "../../hooks/useFeaturedPlaylist";

// Spotify-style editorial cover: a colored tile with the playlist name printed on it.
export function FeaturedCover({ playlist, className = "" }: { playlist: FeaturedPlaylist; className?: string }) {
  return (
    <span className={`featured-cover ${className}`} style={{ "--hue": playlist.hue } as React.CSSProperties}>
      <span className="featured-cover-title">{playlist.title}</span>
    </span>
  );
}

export function FeaturedCard({ playlist }: { playlist: FeaturedPlaylist }) {
  const client = useQueryClient();
  const toast = useToast();
  const { play, toggle, currentSong, playing } = usePlayer();
  const [loading, setLoading] = useState(false);
  const active = !!currentSong && cachedFeaturedSongs(client, playlist).some(s => s.id === currentSong.id);

  const start = async () => {
    if (active) return toggle();
    setLoading(true);
    try {
      const songs = await loadFeaturedSongs(client, playlist);
      if (songs[0]) await play(songs[0], songs);
      else toast(`${playlist.title} is unavailable right now`);
    } finally { setLoading(false); }
  };

  return (
    <article className={`card featured-card ${active ? "is-active" : ""}`}>
      <div className="card-art">
        <FeaturedCover playlist={playlist} />
        <button className={`card-play ${(active && playing) || loading ? "visible" : ""}`} aria-label={active && playing ? `Pause ${playlist.title}` : `Play ${playlist.title}`} disabled={loading} onClick={() => void start()}>
          {loading ? <Loader2 className="spin" /> : active && playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
      </div>
      <Link className="card-title card-link" to={`/featured/${playlist.id}`}>{playlist.title}</Link>
      <span className="card-sub">{playlist.description}</span>
    </article>
  );
}
