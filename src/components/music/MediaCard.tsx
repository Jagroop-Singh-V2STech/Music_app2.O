import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import type { Song } from "../../types/music";
import { usePlayer } from "../../context/PlayerContext";
import { Artwork } from "./Artwork";

interface MediaCardProps { title: string; subtitle: ReactNode; songs: Song[]; songId?: string; art?: Partial<Song>; seed?: string; round?: boolean; to?: string; overlay?: ReactNode; className?: string }

// Shared card: the whole card opens `to` (or plays), and the floating button plays/pauses its songs.
export function MediaCard({ title, subtitle, songs, songId, art, seed, round = false, to, overlay, className = "" }: MediaCardProps) {
  const { play, toggle, currentSong, playing } = usePlayer();
  // A single-song card (songId) queues `songs` after it, but is only "playing" when that song is.
  const active = !!currentSong && (songId ? currentSong.id === songId : songs.some(s => s.id === currentSong.id));
  const start = () => { if (active) toggle(); else if (songs[0]) void play(songs[0], songs); };
  return (
    <article className={`card ${active ? "is-active" : ""} ${className}`}>
      <div className={`card-art ${round ? "round" : ""}`}>
        <Artwork song={art ?? songs[0]} seed={seed ?? title} round={round} />
        {overlay}
        {songs.length > 0 && <button className={`card-play ${active && playing ? "visible" : ""}`} aria-label={active && playing ? `Pause ${title}` : `Play ${title}`} onClick={start}>{active && playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>}
      </div>
      {to ? <Link className="card-title card-link" to={to}>{title}</Link> : <button className="card-title card-link" onClick={start}>{title}</button>}
      <span className="card-sub">{subtitle}</span>
    </article>
  );
}
