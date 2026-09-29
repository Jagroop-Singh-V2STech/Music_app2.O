import { useState } from "react";
import { Music2 } from "lucide-react";
import type { Song } from "../../types/music";
import { hueFrom } from "../../utils/library";

interface ArtworkProps { song?: Partial<Song>; className?: string; seed?: string; round?: boolean }

export function Artwork({ song, className = "", seed, round = false }: ArtworkProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const hue = hueFrom(seed ?? song?.title ?? song?.id ?? "music");
  const showImage = song?.imageUrl && !failed;
  return (
    <div className={`artwork ${round ? "round" : ""} ${className}`} style={{ "--hue": hue } as React.CSSProperties}>
      {showImage
        ? <img src={song.imageUrl!} alt="" loading="lazy" decoding="async" className={loaded ? "loaded" : ""} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        : <Music2 aria-hidden="true" className="artwork-fallback" />}
    </div>
  );
}
