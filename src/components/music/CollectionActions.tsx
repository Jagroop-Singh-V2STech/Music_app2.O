import type { ReactNode } from "react";
import { ArrowDownCircle, ListEnd, Pause, Play, Shuffle } from "lucide-react";
import type { Song } from "../../types/music";
import { usePlayer } from "../../context/PlayerContext";
import { useOffline } from "../../context/OfflineContext";
import { ProgressRing } from "./DownloadIndicator";
import { useToast } from "../common/Toast";
import { shuffled } from "../../utils/library";

// Big play / shuffle / queue-all row shown under collection headers.
export function CollectionActions({ songs, children }: { songs: Song[]; children?: ReactNode }) {
  const { play, toggle, playing, currentSong, addQueue } = usePlayer();
  const toast = useToast();
  const active = !!currentSong && songs.some(s => s.id === currentSong.id);
  const disabled = !songs.length;
  const offline = useOffline();
  const states = songs.map(s => offline.status(s.id));
  const allDownloaded = !disabled && states.every(s => s === "downloaded");
  const inFlight = songs.filter((s, i) => states[i] === "downloading");
  const toggleDownload = () => {
    if (allDownloaded) { void offline.remove(songs.map(s => s.id)); toast(`Removed ${songs.length} songs from Downloads`); }
    else offline.download(songs);
  };
  return (
    <div className="collection-actions">
      <button className="big-play" disabled={disabled} aria-label={active && playing ? "Pause" : "Play"} onClick={() => active ? toggle() : void play(songs[0], songs)}>{active && playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      <button className="icon-button lg" disabled={disabled} aria-label="Shuffle play" title="Shuffle play" onClick={() => { const order = shuffled(songs); void play(order[0], order); }}><Shuffle /></button>
      <button className="icon-button lg" disabled={disabled} aria-label="Add all to queue" title="Add all to queue" onClick={() => { songs.forEach(s => addQueue(s)); toast(`Added ${songs.length} songs to queue`); }}><ListEnd /></button>
      <button className={`icon-button lg download-toggle ${allDownloaded ? "on" : ""}`} disabled={disabled || inFlight.length > 0} aria-pressed={allDownloaded}
        aria-label={allDownloaded ? "Remove downloads" : inFlight.length ? "Downloading" : "Download"} title={allDownloaded ? "Remove downloads" : inFlight.length ? `Downloading ${inFlight.length} songs…` : "Download for offline"} onClick={toggleDownload}>
        {inFlight.length ? <ProgressRing value={(states.filter(s => s === "downloaded").length + inFlight.reduce((sum, s) => sum + (offline.progress[s.id] ?? 0), 0)) / songs.length} /> : <ArrowDownCircle />}
      </button>
      {children}
    </div>
  );
}
