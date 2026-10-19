import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { lazy, Suspense, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Share2 } from "lucide-react";
import { useMusic } from "../context/MusicContext";
import { Artwork } from "../components/music/Artwork";
import { SongRow } from "../components/music/SongRow";
import { EmptyState } from "../components/common/EmptyState";
import { PageHeader } from "../components/common/PageHeader";
import { CollectionActions } from "../components/music/CollectionActions";
import type { Song } from "../types/music";
import { hueFrom } from "../utils/library";

const ShareModal = lazy(() => import("../components/music/ShareModal"));

function SortableRow({ id, song, index, list }: { id: string; song: Song; index: number; list: Song[] }) { const sortable = useSortable({ id }); return <div ref={sortable.setNodeRef} {...sortable.attributes} {...sortable.listeners} className={sortable.isDragging ? "dragging" : ""} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}><SongRow song={song} index={index} list={list} /></div>; }

export function PlaylistDetails() {
  const { id } = useParams();
  const { playlists, updatePlaylist } = useMusic();
  const playlist = playlists.find(x => x.id === id);
  const [sharing, setSharing] = useState(false);
  if (!playlist) return <section className="page"><EmptyState title="Playlist not found" copy="It may have been removed." action={<Link className="pill light" to="/playlists">Back to playlists</Link>} /></section>;
  const ids = playlist.songs.map((x, i) => `${x.id}-${i}`);
  return (
    <section className="page collection-page">
      <PageHeader eyebrow="Playlist" title={playlist.name} hue={hueFrom(playlist.name)} art={<Artwork song={{ imageUrl: playlist.coverImage || playlist.songs[0]?.imageUrl }} seed={playlist.name} className="header-art" />}
        subtitle={<>{playlist.description || "A collection made with MyMusic."}<br /><b>MyMusic</b> • {playlist.songs.length} {playlist.songs.length === 1 ? "song" : "songs"}</>} />
      <CollectionActions songs={playlist.songs}>
        <button className="icon-button lg" disabled={!playlist.songs.length} aria-label="Share playlist" title="Share playlist" onClick={() => setSharing(true)}><Share2 /></button>
      </CollectionActions>
      {sharing && <Suspense fallback={null}><ShareModal kind="playlist" songs={playlist.songs} name={playlist.name} onClose={() => setSharing(false)} /></Suspense>}
      {playlist.songs.length
        ? <DndContext collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (!over || active.id === over.id) return; updatePlaylist(playlist.id, arrayMove(playlist.songs, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))); }}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}><div className="song-table playlist-songs">{playlist.songs.map((song, i) => <SortableRow id={ids[i]} song={song} index={i} list={playlist.songs} key={ids[i]} />)}</div></SortableContext>
          </DndContext>
        : <EmptyState title="This playlist is empty" copy="Add music from search, or drag a song onto this playlist in the sidebar." action={<Link className="pill light" to="/search">Find songs</Link>} />}
    </section>
  );
}
