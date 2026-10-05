import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ListMusic, Trash2 } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";
import type { Song } from "../../types/music";
import { Artwork } from "../music/Artwork";
import { Equalizer } from "../music/Equalizer";
import { EmptyState } from "../common/EmptyState";
import { useJam } from "../../context/JamContext";
import { JamQueue } from "../jam/JamQueue";

function QueueItem({ id, song, current = false }: { id: string; song: Song; current?: boolean }) {
  const p = usePlayer();
  const sort = useSortable({ id, disabled: current });
  return (
    <div ref={sort.setNodeRef} style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }} className={`queue-item ${current ? "is-active" : ""} ${sort.isDragging ? "dragging" : ""}`}>
      {current ? <span className="drag"><Equalizer paused={!p.playing} /></span> : <button {...sort.attributes} {...sort.listeners} className="drag" aria-label={`Reorder ${song.title}`}><GripVertical /></button>}
      <Artwork song={song} />
      <button className="queue-copy" onClick={() => !current && void p.play(song)}><strong>{song.title}</strong><small>{song.artist}</small></button>
      {!current && <button className="icon-button" aria-label={`Remove ${song.title} from queue`} onClick={() => p.removeQueue(song.id)}><Trash2 /></button>}
    </div>
  );
}

export function QueueList() {
  const p = usePlayer();
  const jam = useJam();
  // In a Jam the queue is the room's shared queue.
  if (jam.room) return <JamQueue note />;
  const ids = p.queue.map((x, i) => `${x.id}-${i}`);
  const onEnd = ({ active, over }: DragEndEvent) => { if (!over || active.id === over.id) return; p.setQueue(arrayMove(p.queue, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))); };
  return (
    <div className="queue-list">
      {p.currentSong && <div className="queue-group"><h3>Now playing</h3><QueueItem id="current" song={p.currentSong} current /></div>}
      <div className="queue-group">
        <div className="queue-group-head"><h3>Next up</h3>{p.queue.length > 0 && <button className="text-btn" onClick={p.clearQueue}>Clear queue</button>}</div>
        {p.queue.length
          ? <DndContext collisionDetection={closestCenter} onDragEnd={onEnd}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{p.queue.map((song, i) => <QueueItem id={ids[i]} song={song} key={ids[i]} />)}</SortableContext></DndContext>
          : <EmptyState icon={<ListMusic />} title="Queue is empty" copy="Add songs with “Add to queue” to keep the music going." />}
      </div>
    </div>
  );
}
