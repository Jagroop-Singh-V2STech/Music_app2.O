import { usePlayer } from "../../context/PlayerContext";
import { formatTime } from "../../utils/formatTime";

export const ProgressBar = ({ compact = false }: { compact?: boolean }) => {
  const p = usePlayer();
  const pct = p.duration ? Math.min(100, (p.progress / p.duration) * 100) : 0;
  if (compact) return <div className="progress-line" aria-hidden="true"><span style={{ transform: `scaleX(${pct / 100})` }} /></div>;
  return (
    <div className="progress">
      <span className="time">{formatTime(p.progress)}</span>
      <input className="range" type="range" min="0" max={p.duration || 1} step="0.1" value={p.progress} disabled={!p.currentSong} aria-label="Seek" aria-valuetext={`${formatTime(p.progress)} of ${formatTime(p.duration)}`} style={{ "--pct": `${pct}%` } as React.CSSProperties} onChange={e => p.seek(Number(e.target.value))} />
      <span className="time">{formatTime(p.duration)}</span>
    </div>
  );
};
