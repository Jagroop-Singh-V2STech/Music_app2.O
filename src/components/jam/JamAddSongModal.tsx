import { useEffect, useState } from "react";
import { Check, ListStart, Plus } from "lucide-react";
import { useJam } from "../../context/JamContext";
import { useMusic } from "../../context/MusicContext";
import { useSearch } from "../../hooks/useSearch";
import { useOffline } from "../../context/OfflineContext";
import { isUploaded } from "../../services/offline";
import { tokenize } from "../../utils/match";
import type { Song } from "../../types/music";
import { uniqueSongs } from "../../utils/library";
import { Artwork } from "../music/Artwork";
import { Modal } from "../common/Modal";
import { Loading } from "../common/Loading";
import { useToast } from "../common/Toast";

export function JamAddSongModal({ onClose }: { onClose(): void }) {
  const { addSongs } = useJam();
  const { favorites, recent } = useMusic();
  const { songs: offlineSongs } = useOffline();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  useEffect(() => { const id = setTimeout(() => setDebounced(query), 400); return () => clearTimeout(id); }, [query]);
  const result = useSearch(debounced);

  const searching = debounced.trim().length > 1;
  // Songs uploaded from this device are shared to the Jam when added; they show first and match searches too.
  const uploaded = offlineSongs.filter(isUploaded);
  const words = tokenize(debounced);
  const matchingUploads = uploaded.filter(song => { const hay = tokenize(`${song.title} ${song.artist}`).join(" "); return words.every(w => hay.includes(w)); });
  const songs = searching ? uniqueSongs([...matchingUploads, ...(result.data ?? [])]) : uniqueSongs([...uploaded, ...recent, ...favorites]).slice(0, 30);
  const add = (song: Song, playNext = false) => {
    addSongs([song], playNext);
    setAdded(ids => new Set(ids).add(song.id));
    toast(playNext ? `“${song.title}” plays next` : `Added “${song.title}” to the Jam`);
  };

  return (
    <Modal title="Add songs to the Jam" onClose={onClose}>
      <label>Search
        <input type="search" autoFocus placeholder="What do you want to play?" value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <h3 className="jam-modal-sub">{searching ? "Results" : "From your library"}</h3>
      <div className="jam-pick-list">
        {searching && (result.isLoading || query !== debounced) && !result.data ? <Loading rows={4} />
          : searching && result.isError ? <p className="muted">Search is unavailable right now. Try again in a moment.</p>
          : !songs.length ? <p className="muted">{searching ? `No songs found for “${debounced}”.` : "Search for a song, or like some songs to see them here."}</p>
          : songs.map(song => (
            <div className="queue-item jam-pick" key={song.id}>
              <Artwork song={song} />
              <span className="queue-copy"><strong>{song.title}</strong><small>{isUploaded(song) ? `Your upload · ${song.artist}` : song.artist}</small></span>
              <button className="icon-button" aria-label={`Play ${song.title} next`} title="Play next" onClick={() => add(song, true)}><ListStart /></button>
              <button className={`icon-button ${added.has(song.id) ? "active" : ""}`} aria-label={`Add ${song.title} to the queue`} title="Add to queue" onClick={() => add(song)}>{added.has(song.id) ? <Check /> : <Plus />}</button>
            </div>
          ))}
      </div>
      <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
