import { Clock3 } from "lucide-react";
import type { Song } from "../../types/music";
import { SongRow } from "./SongRow";

// Column header + rows; each row plays with the whole list queued behind it.
export function TrackList({ songs, draggable = false, header = true }: { songs: Song[]; draggable?: boolean; header?: boolean }) {
  return (
    <div className="song-table">
      {header && <div className="song-table-head" aria-hidden="true"><span>#</span><span /><span>Title</span><span className="song-album">Album</span><span /><Clock3 className="duration" /><span /></div>}
      {songs.map((song, i) => <SongRow song={song} index={i} list={songs} draggable={draggable} key={song.id} />)}
    </div>
  );
}
