import { ArrowDown } from "lucide-react";
import { useOffline } from "../../context/OfflineContext";

// Progress ring that fills while downloading, then turns into a solid "downloaded" badge.
export function ProgressRing({ value, className = "" }: { value: number; className?: string }) {
  return (
    <svg className={`progress-ring ${className}`} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" pathLength="100" />
      <circle cx="10" cy="10" r="8" pathLength="100" strokeDasharray={`${Math.max(4, value * 100)} 100`} />
    </svg>
  );
}

export function DownloadIndicator({ id }: { id: string }) {
  const { status, progress } = useOffline();
  const state = status(id);
  if (state === "none") return null;
  return state === "downloading"
    ? <span className="download-indicator" title="Downloading"><ProgressRing value={progress[id] ?? 0} /></span>
    : <span className="download-indicator done" title="Downloaded" aria-label="Downloaded"><ArrowDown strokeWidth={3} /></span>;
}
