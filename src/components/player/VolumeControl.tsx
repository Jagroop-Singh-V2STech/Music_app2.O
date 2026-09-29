import { Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";

export const VolumeControl = () => {
  const p = usePlayer();
  const level = p.muted ? 0 : p.volume;
  const Icon = level === 0 ? VolumeX : level < .5 ? Volume1 : Volume2;
  return (
    <div className="volume">
      <button className="icon-button" aria-label={p.muted ? "Unmute" : "Mute"} onClick={() => p.setMuted(!p.muted)}><Icon /></button>
      <input className="range" type="range" min="0" max="1" step=".01" value={level} aria-label="Volume" style={{ "--pct": `${level * 100}%` } as React.CSSProperties} onChange={e => p.setVolume(Number(e.target.value))} />
    </div>
  );
};
