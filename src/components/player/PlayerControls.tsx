import { LoaderCircle, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";

export function PlayerControls({ large = false }: { large?: boolean }) {
  const p = usePlayer();
  return (
    <div className={`player-controls ${large ? "large" : ""}`}>
      <button className={`ctrl toggle ${p.shuffle && !p.controlled ? "active" : ""}`} aria-label="Shuffle" aria-pressed={p.shuffle && !p.controlled} disabled={p.controlled} title={p.controlled ? "Not available in a Jam" : undefined} onClick={() => p.setShuffle(!p.shuffle)}><Shuffle /></button>
      <button className="ctrl" aria-label="Previous" onClick={p.previous}><SkipBack fill="currentColor" /></button>
      <button className="main-play" aria-label={p.playing ? "Pause" : "Play"} disabled={!p.currentSong && !p.loading} onClick={p.toggle}>{p.loading ? <LoaderCircle className="spin" /> : p.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      <button className="ctrl" aria-label="Next" onClick={p.next}><SkipForward fill="currentColor" /></button>
      <button className={`ctrl toggle ${p.repeat && !p.controlled ? "active" : ""}`} aria-label="Repeat" aria-pressed={p.repeat && !p.controlled} disabled={p.controlled} title={p.controlled ? "Not available in a Jam" : undefined} onClick={() => p.setRepeat(!p.repeat)}><Repeat /></button>
    </div>
  );
}
