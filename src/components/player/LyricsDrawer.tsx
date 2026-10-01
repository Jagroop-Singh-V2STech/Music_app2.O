import { useEffect } from "react";
import { X } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";
import { LyricsView } from "./LyricsView";

export function LyricsDrawer({ open, close }: { open: boolean; close(): void }) {
  const { currentSong } = usePlayer();
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [open, close]);
  return (
    // No scrim: the player stays usable while reading lyrics.
    <aside className={`queue-drawer lyrics-drawer ${open ? "open" : ""}`} aria-label="Lyrics" aria-hidden={!open} inert={!open}>
      <header><div><span className="eyebrow">Lyrics</span><h2>{currentSong?.title ?? "Nothing playing"}</h2></div><button className="icon-button" aria-label="Close lyrics" onClick={close}><X /></button></header>
      {/* Only fetch while visible. */}
      {open && <LyricsView />}
    </aside>
  );
}
