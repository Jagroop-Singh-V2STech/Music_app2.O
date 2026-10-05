import { EventEmitter } from "node:events";
import { randomInt } from "node:crypto";
import { errors } from "./errors.js";
import { sanitizeSong } from "./songs.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const MAX_POSITION = 86_400;
const PREVIOUS_RESTARTS_AFTER = 3; // seconds: "previous" restarts the song past this point, like most players
const MAX_HISTORY = 50;
const MAX_SONGS_PER_ADD = 100;

export const PLAYBACK_COMMANDS = new Set(["PLAY", "PAUSE", "SEEK"]);
export const COMMANDS = new Set([...PLAYBACK_COMMANDS, "NEXT", "PREVIOUS", "SONG_CHANGED", "QUEUE_ITEM_ADDED", "QUEUE_ITEM_REMOVED", "QUEUE_REORDERED", "QUEUE_CLEARED"]);

export const normalizeRoomId = value => {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase().replace(/^JAM-?/, "");
  return /^[A-Z0-9]{4,12}$/.test(code) ? `JAM-${code}` : undefined;
};

const position = value => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw errors.badRequest("A valid position is required.");
  return Math.min(MAX_POSITION, Math.max(0, value));
};

/**
 * Authoritative state for every Jam room. All mutations go through here; each one bumps the room's version
 * and emits "update" so the socket layer can broadcast the new snapshot.
 *
 * Events: "update" (room, cause) · "ended" (roomId, reason) · "removed" (roomId, userId)
 */
export class RoomStore extends EventEmitter {
  constructor(config, { now = Date.now } = {}) {
    super();
    this.config = config;
    this.now = now;
    this.rooms = new Map();
    this.closed = new Map(); // roomId -> { reason, at }, so old links report "ended" instead of "not found"
    this.itemSeq = 0;
  }

  // ---------- Lookup ----------

  get(roomId) {
    const id = normalizeRoomId(roomId);
    const room = id && this.rooms.get(id);
    if (room) return room;
    const closed = id && this.closed.get(id);
    if (closed) throw closed.reason === "EXPIRED" ? errors.expired() : errors.ended();
    throw errors.notFound();
  }

  requireMember(roomId, userId) {
    const room = this.get(roomId);
    if (!room.participants.has(userId)) throw room.banned.has(userId) ? errors.removed() : errors.notParticipant();
    return room;
  }

  // ---------- Lifecycle ----------

  createRoom(user, seed = {}) {
    let id;
    do id = `JAM-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")}`;
    while (this.rooms.has(id) || this.closed.has(id));
    const now = this.now();
    const room = {
      id,
      name: typeof seed.name === "string" && seed.name.trim() ? seed.name.trim().slice(0, 60) : `${user.name}'s Jam`,
      hostId: user.id,
      createdAt: now,
      lastActiveAt: now,
      participants: new Map(),
      banned: new Set(),
      currentItem: null,
      isPlaying: false,
      position: 0,
      positionUpdatedAt: now,
      queue: [],
      history: [],
      version: 1,
      playbackVersion: 1,
      playbackChangedBy: user.id
    };
    this.addParticipant(room, user);
    // Seed from the host's player so the Jam starts with what they were already listening to.
    if (seed.song) {
      room.currentItem = this.item(sanitizeSong(seed.song), user.id);
      room.position = typeof seed.position === "number" ? position(seed.position) : 0;
      room.isPlaying = seed.isPlaying === true;
    }
    if (Array.isArray(seed.queue)) {
      for (const song of seed.queue.slice(0, this.config.maxQueue)) {
        try { room.queue.push(this.item(sanitizeSong(song), user.id)); } catch { /* skip songs that can't be shared */ }
      }
    }
    this.rooms.set(id, room);
    return room;
  }

  join(roomId, user) {
    const room = this.get(roomId);
    if (room.banned.has(user.id)) throw errors.removed();
    const existing = room.participants.get(user.id);
    if (existing) { existing.name = user.name; return room; }
    if (room.participants.size >= this.config.maxParticipants) throw errors.full(this.config.maxParticipants);
    this.addParticipant(room, user);
    this.commit(room, { type: "PARTICIPANT_JOINED", userId: user.id, name: user.name });
    return room;
  }

  leave(roomId, userId) {
    const room = this.requireMember(roomId, userId);
    this.removeParticipant(room, userId, "PARTICIPANT_LEFT");
  }

  end(roomId, userId) {
    const room = this.requireMember(roomId, userId);
    if (room.hostId !== userId) throw errors.notHost();
    this.close(room, "HOST_ENDED");
  }

  kick(roomId, actorId, targetId) {
    const room = this.requireMember(roomId, actorId);
    if (room.hostId !== actorId) throw errors.notHost();
    if (targetId === actorId) throw errors.badRequest("Use Leave Jam to leave the room yourself.");
    if (!room.participants.has(targetId)) throw errors.notParticipant();
    room.banned.add(targetId);
    this.removeParticipant(room, targetId, "PARTICIPANT_REMOVED");
    this.emit("removed", room.id, targetId);
  }

  transferHost(roomId, actorId, targetId) {
    const room = this.requireMember(roomId, actorId);
    if (room.hostId !== actorId) throw errors.notHost();
    const target = room.participants.get(targetId);
    if (!target) throw errors.notParticipant();
    if (targetId === actorId) return room;
    room.hostId = targetId;
    this.commit(room, { type: "HOST_CHANGED", userId: actorId, newHostId: targetId, name: target.name });
    return room;
  }

  /** Tracks open sockets per participant; presence flips (and is broadcast) only on the first connect / last disconnect. */
  connect(roomId, userId) {
    const room = this.requireMember(roomId, userId);
    const participant = room.participants.get(userId);
    participant.connections++;
    room.lastActiveAt = this.now();
    if (participant.connections === 1) {
      participant.online = true;
      participant.offlineSince = undefined;
      this.commit(room, { type: "PARTICIPANT_ONLINE", userId, name: participant.name });
    }
    return room;
  }

  disconnect(roomId, userId) {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(userId);
    if (!participant) return;
    participant.connections = Math.max(0, participant.connections - 1);
    if (participant.connections === 0) {
      participant.online = false;
      participant.offlineSince = this.now();
      this.commit(room, { type: "PARTICIPANT_OFFLINE", userId, name: participant.name });
    }
  }

  /** Periodic housekeeping: drop long-disconnected participants, expire abandoned rooms, forget old tombstones. */
  sweep() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      const participants = [...room.participants.values()];
      if (participants.some(p => p.online)) {
        room.lastActiveAt = now;
        // Only prune while someone is still listening, so a room everyone briefly dropped from survives until it expires.
        for (const p of participants) {
          if (!p.online && p.offlineSince !== undefined && now - p.offlineSince >= this.config.participantGraceMs) this.removeParticipant(room, p.id, "PARTICIPANT_LEFT", "timeout");
        }
      } else if (now - room.lastActiveAt >= this.config.roomIdleTtlMs) {
        this.close(room, "EXPIRED");
      }
    }
    for (const [id, closed] of this.closed) if (now - closed.at >= this.config.endedRoomTtlMs) this.closed.delete(id);
  }

  // ---------- Commands (playback + queue), sent by any participant ----------

  /**
   * Applies a participant's command. Conflict rules (the server, not client clocks, decides order):
   * - PLAY / PAUSE / SEEK carry baseVersion; they're rejected as stale if another user changed playback after that version.
   * - NEXT / PREVIOUS carry fromItemId; they apply only while that item is still current, so simultaneous skips (or every
   *   client reporting "song ended") advance exactly once.
   * - Queue edits address items by itemId / afterItemId, so concurrent edits compose instead of clobbering by index.
   */
  command(roomId, userId, message) {
    const room = this.requireMember(roomId, userId);
    const { type, baseVersion } = message;
    if (!COMMANDS.has(type)) throw errors.badRequest("Unknown command.");
    if (!Number.isInteger(baseVersion) || baseVersion < 1 || baseVersion > room.version) throw errors.badRequest("A valid baseVersion is required.");
    const now = this.now();
    const cause = { type, userId, name: room.participants.get(userId).name };
    let playbackChanged = false;

    const assertFresh = () => {
      if (baseVersion < room.playbackVersion && room.playbackChangedBy !== userId) throw errors.stale();
    };
    const assertCurrent = () => {
      if (!room.currentItem || message.fromItemId !== room.currentItem.itemId) throw errors.stale();
    };
    const setPlayback = (isPlaying, at) => {
      room.isPlaying = isPlaying;
      room.position = at;
      room.positionUpdatedAt = now;
      playbackChanged = true;
    };
    const start = item => {
      if (room.currentItem) this.pushHistory(room, room.currentItem);
      room.currentItem = item;
      room.isPlaying = true;
      room.position = 0;
      room.positionUpdatedAt = now + this.config.songStartDelayMs;
      playbackChanged = true;
      cause.title = item.song.title;
    };

    switch (type) {
      case "PLAY":
        assertFresh();
        if (!room.currentItem) throw errors.noSong();
        setPlayback(true, message.position == null ? this.positionOf(room) : position(message.position));
        break;
      case "PAUSE":
        assertFresh();
        if (!room.currentItem) throw errors.noSong();
        setPlayback(false, message.position == null ? this.positionOf(room) : position(message.position));
        break;
      case "SEEK":
        assertFresh();
        if (!room.currentItem) throw errors.noSong();
        setPlayback(room.isPlaying, position(message.position));
        cause.position = room.position;
        break;
      case "NEXT": {
        assertCurrent();
        const next = room.queue.shift();
        if (next) start(next);
        else setPlayback(false, 0); // end of the queue: stay on the last song, paused at its start
        cause.auto = message.auto === true;
        break;
      }
      case "PREVIOUS": {
        assertCurrent();
        const previous = room.history.pop();
        if (!previous || this.positionOf(room) > PREVIOUS_RESTARTS_AFTER) {
          if (previous) room.history.push(previous);
          setPlayback(room.isPlaying, 0);
          cause.restarted = true;
        } else {
          room.queue.unshift(room.currentItem);
          room.currentItem = null; // so start() doesn't push it back onto history
          start(previous);
        }
        break;
      }
      case "SONG_CHANGED":
        if (typeof message.itemId === "string") {
          const index = room.queue.findIndex(item => item.itemId === message.itemId);
          if (index < 0) throw errors.itemNotFound();
          start(room.queue.splice(index, 1)[0]);
        } else {
          start(this.item(sanitizeSong(message.song), userId));
        }
        break;
      case "QUEUE_ITEM_ADDED": {
        if (!Array.isArray(message.songs) || !message.songs.length || message.songs.length > MAX_SONGS_PER_ADD) throw errors.badRequest(`Add between 1 and ${MAX_SONGS_PER_ADD} songs at a time.`);
        const items = message.songs.map(song => this.item(sanitizeSong(song), userId));
        if (room.queue.length + items.length > this.config.maxQueue) throw errors.queueFull(this.config.maxQueue);
        if (message.playNext === true) room.queue.unshift(...items); else room.queue.push(...items);
        cause.count = items.length;
        cause.title = items[0].song.title;
        // Nothing playing yet: the first added song starts the Jam.
        if (!room.currentItem) start(room.queue.shift());
        break;
      }
      case "QUEUE_ITEM_REMOVED": {
        const index = room.queue.findIndex(item => item.itemId === message.itemId);
        if (index < 0) throw errors.itemNotFound();
        cause.title = room.queue.splice(index, 1)[0].song.title;
        break;
      }
      case "QUEUE_REORDERED": {
        const index = room.queue.findIndex(item => item.itemId === message.itemId);
        if (index < 0) throw errors.itemNotFound();
        const [moved] = room.queue.splice(index, 1);
        if (message.afterItemId == null) room.queue.unshift(moved);
        else {
          const after = room.queue.findIndex(item => item.itemId === message.afterItemId);
          if (after < 0) { room.queue.splice(index, 0, moved); throw errors.itemNotFound(); }
          room.queue.splice(after + 1, 0, moved);
        }
        break;
      }
      case "QUEUE_CLEARED":
        room.queue = [];
        break;
    }

    if (typeof message.requestId === "string") cause.requestId = message.requestId.slice(0, 64);
    this.commit(room, cause, playbackChanged ? userId : undefined);
    return room;
  }

  // ---------- Snapshots ----------

  positionOf(room, now = this.now()) {
    if (!room.isPlaying) return room.position;
    return Math.max(0, room.position + (now - room.positionUpdatedAt) / 1000);
  }

  snapshot(room) {
    return {
      roomId: room.id,
      name: room.name,
      hostId: room.hostId,
      status: "active",
      createdAt: room.createdAt,
      maxParticipants: this.config.maxParticipants,
      participants: [...room.participants.values()].map(({ id, name, online, joinedAt }) => ({ id, name, online, joinedAt })),
      currentItem: room.currentItem,
      isPlaying: room.isPlaying,
      position: room.position,
      positionUpdatedAt: room.positionUpdatedAt,
      queue: room.queue,
      canGoBack: room.history.length > 0,
      version: room.version,
      playbackVersion: room.playbackVersion,
      serverTime: this.now()
    };
  }

  // ---------- Internals ----------

  item(song, addedBy) {
    return { itemId: `i${(++this.itemSeq).toString(36)}${randomInt(1296).toString(36)}`, song, addedBy };
  }

  pushHistory(room, item) {
    room.history.push(item);
    if (room.history.length > MAX_HISTORY) room.history.shift();
  }

  addParticipant(room, user) {
    room.participants.set(user.id, { id: user.id, name: user.name, joinedAt: this.now(), online: false, connections: 0, offlineSince: this.now() });
  }

  removeParticipant(room, userId, type, reason) {
    const participant = room.participants.get(userId);
    room.participants.delete(userId);
    if (!room.participants.size) { this.close(room, "EMPTY"); return; }
    const cause = { type, userId, name: participant?.name, reason };
    if (room.hostId === userId) {
      // Hand host to whoever has been here longest, preferring people who are connected right now.
      const candidates = [...room.participants.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt);
      room.hostId = candidates[0].id;
      cause.newHostId = room.hostId;
      cause.newHostName = candidates[0].name;
    }
    this.commit(room, cause);
  }

  close(room, reason) {
    this.rooms.delete(room.id);
    this.closed.set(room.id, { reason, at: this.now() });
    this.emit("ended", room.id, reason);
  }

  commit(room, cause, playbackChangedBy) {
    room.version++;
    if (playbackChangedBy) {
      room.playbackVersion = room.version;
      room.playbackChangedBy = playbackChangedBy;
    }
    this.emit("update", room, cause);
  }
}
