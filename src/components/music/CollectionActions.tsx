import type { ReactNode } from "react";
import { ListEnd, Pause, Play, Shuffle } from "lucide-react";
import type { Song } from "../../types/music";
import { usePlayer } from "../../context/PlayerContext";
import { useToast } from "../common/Toast";
import { shuffled } from "../../utils/library";

// Big play / shuffle / queue-all row shown under collection headers.
export function CollectionActions({ songs, children }: { songs: Song[]; children?: ReactNode }) {
  const { play, toggle, playing, currentSong, addQueue } = usePlayer();
  const toast = useToast();
  const active = !!currentSong && songs.some(s => s.id === currentSong.id);
  const disabled = !songs.length;
  return (
    <div className="collection-actions">
      <button className="big-play" disabled={disabled} aria-label={active && playing ? "Pause" : "Play"} onClick={() => active ? toggle() : void play(songs[0], songs)}>{active && playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      <button className="icon-button lg" disabled={disabled} aria-label="Shuffle play" title="Shuffle play" onClick={() => { const order = shuffled(songs); void play(order[0], order); }}><Shuffle /></button>
      <button className="icon-button lg" disabled={disabled} aria-label="Add all to queue" title="Add all to queue" onClick={() => { songs.forEach(s => addQueue(s)); toast(`Added ${songs.length} songs to queue`); }}><ListEnd /></button>
      {children}
    </div>
  );
}
