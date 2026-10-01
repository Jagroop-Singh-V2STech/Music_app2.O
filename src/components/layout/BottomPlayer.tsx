import { ListMusic, Maximize2, MicVocal, Pause, Play } from "lucide-react";
import { NowPlaying } from "../player/NowPlaying";
import { PlayerControls } from "../player/PlayerControls";
import { ProgressBar } from "../player/ProgressBar";
import { VolumeControl } from "../player/VolumeControl";
import { usePlayer } from "../../context/PlayerContext";
import { LikeButton } from "../player/LikeButton";

export function BottomPlayer({ onQueue, onLyrics, onExpand, queueOpen = false, lyricsOpen = false }: { onQueue(): void; onLyrics(): void; onExpand(): void; queueOpen?: boolean; lyricsOpen?: boolean }) {
  const p = usePlayer();
  return (
    <footer className={`bottom-player ${p.currentSong ? "has-song" : ""}`}>
      {/* Mobile: the whole mini player opens the expanded view. */}
      <div className="mini-tap" role="button" tabIndex={-1} aria-hidden="true" onClick={() => p.currentSong && onExpand()} />
      <NowPlaying onOpen={onExpand} />
      <div className="player-center"><PlayerControls /><ProgressBar /></div>
      <div className="player-actions">
        <button className={`icon-button ${lyricsOpen ? "active" : ""}`} aria-label="Lyrics" title="Lyrics" aria-pressed={lyricsOpen} disabled={!p.currentSong} onClick={onLyrics}><MicVocal /></button>
        <button className={`icon-button ${queueOpen ? "active" : ""}`} aria-label="Queue" aria-pressed={queueOpen} onClick={onQueue}><ListMusic /></button>
        <VolumeControl />
        <button className="icon-button" aria-label="Open full-screen player" onClick={onExpand} disabled={!p.currentSong}><Maximize2 /></button>
      </div>
      <div className="mini-actions">
        <LikeButton song={p.currentSong} />
        <button className="icon-button mini-play" aria-label={p.playing ? "Pause" : "Play"} disabled={!p.currentSong} onClick={p.toggle}>{p.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      </div>
      <ProgressBar compact />
    </footer>
  );
}
