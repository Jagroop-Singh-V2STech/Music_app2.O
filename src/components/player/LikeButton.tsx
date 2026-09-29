import { Heart } from "lucide-react";
import type { Song } from "../../types/music";
import { useMusic } from "../../context/MusicContext";

export function LikeButton({ song, size }: { song?: Song; size?: number }) {
  const { isFavorite, toggleFavorite } = useMusic();
  if (!song) return null;
  const liked = isFavorite(song);
  return <button className={`icon-button like-btn ${liked ? "liked" : ""}`} aria-pressed={liked} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} onClick={e => { e.stopPropagation(); toggleFavorite(song); }}><Heart size={size} fill={liked ? "currentColor" : "none"} /></button>;
}
