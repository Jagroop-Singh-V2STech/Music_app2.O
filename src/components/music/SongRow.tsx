import { Heart, ListEnd, ListPlus, ListStart, MoreHorizontal, Pause, Play, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Song } from "../../types/music";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Equalizer";
import { usePlayer } from "../../context/PlayerContext";
import { useMusic } from "../../context/MusicContext";
import { AddToPlaylistModal } from "../playlist/AddToPlaylistModal";
import { useToast } from "../common/Toast";
import { primaryArtist } from "../../utils/library";
import { formatTime } from "../../utils/formatTime";

interface SongRowProps { song: Song; index?: number; draggable?: boolean; list?: Song[] }

export function SongRow({ song, index, draggable = false, list }: SongRowProps) {
  const { play, addQueue, currentSong, playing, toggle } = usePlayer();
  const { isFavorite, toggleFavorite } = useMusic();
  const [menu, setMenu] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const [modal, setModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const active = currentSong?.id === song.id;
  const liked = isFavorite(song);
  const start = () => { if (active) toggle(); else void play(song, list); };

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [menu]);

  const act = (fn: () => void) => () => { fn(); setMenu(false); };

  return (
    <div className={`song-row ${active ? "is-active" : ""}`} draggable={draggable} onDragStart={e => e.dataTransfer.setData("song", JSON.stringify(song))} onDoubleClick={() => void play(song, list)}>
      <span className="song-number">
        <span className="num">{active ? <Equalizer paused={!playing} /> : index === undefined ? "•" : index + 1}</span>
        <button className="row-play" aria-label={active && playing ? `Pause ${song.title}` : `Play ${song.title}`} onClick={start}>{active && playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      </span>
      <button className="row-art-btn" onClick={start} tabIndex={-1} aria-hidden="true"><Artwork song={song} className="row-art" /></button>
      <div className="song-copy">
        <button className="song-title" onClick={start}>{song.title}</button>
        <Link className="song-artist" to={`/artist/${encodeURIComponent(primaryArtist(song.artist))}`}>{song.artist}</Link>
      </div>
      <span className="song-album">{song.album ?? "Single"}</span>
      <button className={`icon-button like-btn ${liked ? "liked" : ""}`} aria-pressed={liked} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} onClick={() => { toggleFavorite(song); toast(liked ? "Removed from Liked Songs" : "Added to Liked Songs"); }}><Heart fill={liked ? "currentColor" : "none"} /></button>
      <span className="duration">{song.duration ? formatTime(song.duration) : "—"}</span>
      <div className="menu-wrap" ref={menuRef}>
        <button className="icon-button more-btn" aria-label={`More options for ${song.title}`} aria-expanded={menu} onClick={e => { setMenuUp(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 320); setMenu(!menu); }}><MoreHorizontal /></button>
        {menu && <div className={`context-menu ${menuUp ? "up" : ""}`} role="menu">
          <button role="menuitem" onClick={act(start)}><Play /> Play</button>
          <button role="menuitem" onClick={act(() => { addQueue(song, true); toast("Playing next"); })}><ListStart /> Play next</button>
          <button role="menuitem" onClick={act(() => { addQueue(song); toast("Added to queue"); })}><ListEnd /> Add to queue</button>
          <button role="menuitem" onClick={act(() => setModal(true))}><ListPlus /> Add to playlist</button>
          <Link role="menuitem" to={`/artist/${encodeURIComponent(primaryArtist(song.artist))}`} onClick={() => setMenu(false)}><UserRound /> Go to artist</Link>
        </div>}
      </div>
      {modal && <AddToPlaylistModal song={song} onClose={() => setModal(false)} />}
    </div>
  );
}
