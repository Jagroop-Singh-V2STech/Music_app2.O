import { useEffect, useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ListMusic, Trash2 } from "lucide-react";
import { useJam } from "../../context/JamContext";
import { usePlayer } from "../../context/PlayerContext";
import type { JamQueueItem } from "../../types/jam";
import { Artwork } from "../music/Artwork";
import { Equalizer } from "../music/Equalizer";
import { EmptyState } from "../common/EmptyState";

function JamQueueRow({ item, addedBy, current = false }: { item: JamQueueItem; addedBy: string; current?: boolean }) {
  const { connected, playItem, removeItem } = useJam();
  const { playing } = usePlayer();
  const sort = useSortable({ id: item.itemId, disabled: current || !connected });
  return (
    <div ref={sort.setNodeRef} style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }} className={`queue-item jam-queue-item fade-up ${current ? "is-active" : ""} ${sort.isDragging ? "dragging" : ""}`}>
      {current
        ? <span className="drag"><Equalizer paused={!playing} /></span>
        : <button {...sort.attributes} {...sort.listeners} className="drag" disabled={!connected} aria-label={`Reorder ${item.song.title}`}><GripVertical /></button>}
      <Artwork song={item.song} />
      <button className="queue-copy" disabled={current || !connected} title={current ? undefined : "Play now for everyone"} onClick={() => playItem(item.itemId)}>
        <strong>{item.song.title}</strong>
        <small>{item.song.artist} · {addedBy}</small>
      </button>
      {!current && <button className="icon-button" disabled={!connected} aria-label={`Remove ${item.song.title} from the shared queue`} onClick={() => removeItem(item.itemId)}><Trash2 /></button>}
    </div>
  );
}

export function JamQueue({ note = false }: { note?: boolean }) {
  const { room, me, connected, moveItem, clearQueue } = useJam();
  // Optimistic order while a reorder is in flight; the next snapshot from the server replaces it.
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => setOrder(null), [room?.version]);

  const items = useMemo(() => {
    const queue = room?.queue ?? [];
    if (!order) return queue;
    const byId = new Map(queue.map(item => [item.itemId, item]));
    return order.map(id => byId.get(id)).filter((item): item is JamQueueItem => Boolean(item));
  }, [order, room?.queue]);

  if (!room) return null;
  const nameOf = (userId: string) => userId === me?.id ? "Added by you" : `Added by ${room.participants.find(p => p.id === userId)?.name ?? "someone who left"}`;
  const ids = items.map(item => item.itemId);

  const onEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    const index = next.indexOf(String(active.id));
    setOrder(next);
    // Sent as "after this item" rather than an index, so it still lands right if someone else edits the queue meanwhile.
    moveItem(String(active.id), index === 0 ? null : next[index - 1]);
  };

  return (
    <div className="queue-list jam-queue">
      {note && <p className="jam-note">Shared with everyone in the Jam. Anyone can add, remove or reorder songs.</p>}
      {room.currentItem && <div className="queue-group"><h3>Now playing</h3><JamQueueRow item={room.currentItem} addedBy={nameOf(room.currentItem.addedBy)} current /></div>}
      <div className="queue-group">
        <div className="queue-group-head"><h3>Next up{items.length > 0 && ` · ${items.length}`}</h3>{items.length > 0 && <button className="text-btn" disabled={!connected} onClick={clearQueue}>Clear queue</button>}</div>
        {items.length
          ? <DndContext collisionDetection={closestCenter} onDragEnd={onEnd}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{items.map(item => <JamQueueRow key={item.itemId} item={item} addedBy={nameOf(item.addedBy)} />)}</SortableContext></DndContext>
          : <EmptyState icon={<ListMusic />} title="The queue is empty" copy="Add songs to keep the music going. Anyone in the Jam can." />}
      </div>
    </div>
  );
}
