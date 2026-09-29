import { useEffect } from "react";
import { ChevronDown, ListMusic } from "lucide-react";
import { Link } from "react-router-dom";
import { usePlayer } from "../../context/PlayerContext";
import { Artwork } from "../music/Artwork";
import { PlayerControls } from "./PlayerControls";
import { ProgressBar } from "./ProgressBar";
import { VolumeControl } from "./VolumeControl";
import { LikeButton } from "./LikeButton";
import { hueFrom, primaryArtist } from "../../utils/library";

interface ExpandedPlayerProps { open?: boolean; inline?: boolean; onClose?(): void; onQueue(): void }

// Full-screen "now playing" view: an overlay sheet on mobile / from the maximize button, or inline on /now-playing.
export function ExpandedPlayer({ open = true, inline = false, onClose, onQueue }: ExpandedPlayerProps) {
  const { currentSong, playing, error } = usePlayer();
  useEffect(() => { if (!open || inline) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [open, inline, onClose]);
  const hue = hueFrom(currentSong?.title ?? "music");
  return (
    <section className={`expanded-player ${inline ? "inline" : ""} ${open ? "open" : ""}`} style={{ "--hue": hue } as React.CSSProperties} aria-label="Now playing" aria-hidden={!open} inert={!open}>
      {currentSong?.imageUrl && <div className="xp-backdrop" style={{ backgroundImage: `url(${currentSong.imageUrl})` }} aria-hidden="true" />}
      <header className="xp-head">
        {!inline ? <button className="icon-button" aria-label="Close now playing" onClick={onClose}><ChevronDown /></button> : <span />}
        <span className="eyebrow">Now playing</span>
        <button className="icon-button" aria-label="Open queue" onClick={onQueue}><ListMusic /></button>
      </header>
      <div className="xp-body">
        <div className={`vinyl ${playing ? "spinning" : ""}`}><div className="vinyl-disc"><Artwork song={currentSong} seed={currentSong?.title} round /></div></div>
        <div className="xp-info">
          <div className="xp-meta">
            <h2 key={currentSong?.id} className="fade-in">{currentSong?.title ?? "Nothing playing"}</h2>
            {currentSong ? <Link to={`/artist/${encodeURIComponent(primaryArtist(currentSong.artist))}`} onClick={() => !inline && onClose?.()}>{currentSong.artist}</Link> : <span>Choose a song to begin</span>}
            {error && <p className="np-error">{error}</p>}
          </div>
          <LikeButton song={currentSong} size={26} />
        </div>
        <ProgressBar />
        <PlayerControls large />
        <div className="xp-foot"><VolumeControl /></div>
      </div>
    </section>
  );
}
