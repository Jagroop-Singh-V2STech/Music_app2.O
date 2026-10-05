import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomStore, normalizeRoomId } from "../src/rooms.js";
import { loadConfig } from "../src/config.js";

const song = (n, extra = {}) => ({ id: `/songs/${n}`, title: `Song ${n}`, artist: "Artist", pageUrl: `https://pagalnew.com/songs/${n}`, ...extra });
const alice = { id: "u_alice", name: "Alice" };
const bob = { id: "u_bob", name: "Bob" };
const carol = { id: "u_carol", name: "Carol" };

function setup(overrides = {}) {
  let now = 1_000_000;
  const clock = { now: () => now, advance: ms => { now += ms; } };
  const config = { ...loadConfig({}), songStartDelayMs: 0, ...overrides };
  const store = new RoomStore(config, { now: clock.now });
  const updates = [];
  store.on("update", (room, cause) => updates.push(cause));
  const room = store.createRoom(alice, { song: song(1), queue: [song(2), song(3)] });
  store.join(room.id, bob);
  return { store, room, clock, updates, config };
}

const cmd = (store, room, user, message) => store.command(room.id, user.id, { baseVersion: room.version, ...message });

test("room codes are normalized and validated", () => {
  assert.equal(normalizeRoomId("jam-ab12cd"), "JAM-AB12CD");
  assert.equal(normalizeRoomId(" ab12cd "), "JAM-AB12CD");
  assert.equal(normalizeRoomId("JAM-"), undefined);
  assert.equal(normalizeRoomId("../etc"), undefined);
});

test("create room makes the creator host and seeds the current song and queue", () => {
  const { store, room } = setup();
  const snap = store.snapshot(room);
  assert.match(snap.roomId, /^JAM-[A-Z0-9]{6}$/);
  assert.equal(snap.hostId, alice.id);
  assert.equal(snap.currentItem.song.title, "Song 1");
  assert.deepEqual(snap.queue.map(i => i.song.title), ["Song 2", "Song 3"]);
  assert.equal(snap.participants.length, 2);
});

test("join is idempotent, rejects full rooms and unknown rooms", () => {
  const { store, room } = setup({ maxParticipants: 2 });
  const version = room.version;
  store.join(room.id, bob);
  assert.equal(room.version, version, "rejoining doesn't change state");
  assert.throws(() => store.join(room.id, carol), { code: "ROOM_FULL" });
  assert.throws(() => store.join("JAM-NOPE00", carol), { code: "ROOM_NOT_FOUND" });
});

test("any participant controls playback, and non-participants can't", () => {
  const { store, room, clock } = setup();
  cmd(store, room, bob, { type: "PLAY" });
  assert.equal(room.isPlaying, true);
  clock.advance(10_000);
  cmd(store, room, alice, { type: "PAUSE", position: 10 });
  assert.equal(room.isPlaying, false);
  assert.equal(room.position, 10);
  cmd(store, room, bob, { type: "SEEK", position: 42 });
  assert.equal(room.position, 42);
  assert.throws(() => cmd(store, room, carol, { type: "PLAY" }), { code: "NOT_A_PARTICIPANT" });
});

test("a stale playback command from another user does not overwrite newer state", () => {
  const { store, room } = setup();
  const seen = room.version;
  store.command(room.id, alice.id, { type: "PLAY", baseVersion: seen });
  // Bob pressed pause before he saw Alice's play.
  assert.throws(() => store.command(room.id, bob.id, { type: "PAUSE", position: 3, baseVersion: seen }), { code: "STALE_COMMAND" });
  assert.equal(room.isPlaying, true);
  // A user's own rapid commands (e.g. scrubbing) never conflict with each other.
  store.command(room.id, alice.id, { type: "SEEK", position: 5, baseVersion: seen });
  assert.equal(room.position, 5);
});

test("queue and presence changes don't make playback commands stale", () => {
  const { store, room } = setup();
  const seen = room.version;
  cmd(store, room, alice, { type: "QUEUE_ITEM_ADDED", songs: [song(9)] });
  store.connect(room.id, alice.id);
  store.command(room.id, bob.id, { type: "PLAY", baseVersion: seen });
  assert.equal(room.isPlaying, true);
});

test("simultaneous NEXT (or every client reporting song end) advances exactly once", () => {
  const { store, room } = setup();
  const from = room.currentItem.itemId;
  store.command(room.id, alice.id, { type: "NEXT", fromItemId: from, baseVersion: room.version });
  assert.throws(() => store.command(room.id, bob.id, { type: "NEXT", fromItemId: from, baseVersion: room.version }), { code: "STALE_COMMAND" });
  assert.equal(room.currentItem.song.title, "Song 2");
  assert.deepEqual(room.queue.map(i => i.song.title), ["Song 3"]);
});

test("PREVIOUS restarts after 3s, otherwise returns to the previous song", () => {
  const { store, room, clock } = setup();
  cmd(store, room, alice, { type: "NEXT", fromItemId: room.currentItem.itemId });
  clock.advance(10_000);
  cmd(store, room, bob, { type: "PREVIOUS", fromItemId: room.currentItem.itemId });
  assert.equal(room.currentItem.song.title, "Song 2", "restarted instead of going back");
  assert.equal(room.position, 0);
  cmd(store, room, bob, { type: "PREVIOUS", fromItemId: room.currentItem.itemId });
  assert.equal(room.currentItem.song.title, "Song 1");
  assert.deepEqual(room.queue.map(i => i.song.title), ["Song 2", "Song 3"]);
});

test("NEXT at the end of the queue pauses on the last song", () => {
  const { store, room } = setup();
  cmd(store, room, alice, { type: "QUEUE_CLEARED" });
  cmd(store, room, alice, { type: "NEXT", fromItemId: room.currentItem.itemId });
  assert.equal(room.isPlaying, false);
  assert.equal(room.currentItem.song.title, "Song 1");
});

test("SONG_CHANGED plays a queue item or a new song and keeps history", () => {
  const { store, room } = setup();
  const target = room.queue[1];
  cmd(store, room, bob, { type: "SONG_CHANGED", itemId: target.itemId });
  assert.equal(room.currentItem.itemId, target.itemId);
  assert.equal(room.isPlaying, true);
  assert.deepEqual(room.queue.map(i => i.song.title), ["Song 2"]);
  cmd(store, room, alice, { type: "SONG_CHANGED", song: song(7) });
  assert.equal(room.currentItem.song.title, "Song 7");
  assert.equal(room.history.length, 2);
});

test("queue add / remove / reorder by item id", () => {
  const { store, room } = setup();
  cmd(store, room, bob, { type: "QUEUE_ITEM_ADDED", songs: [song(4), song(5)] });
  cmd(store, room, alice, { type: "QUEUE_ITEM_ADDED", songs: [song(6)], playNext: true });
  assert.deepEqual(room.queue.map(i => i.song.title), ["Song 6", "Song 2", "Song 3", "Song 4", "Song 5"]);
  const [six, two, three] = room.queue;
  cmd(store, room, bob, { type: "QUEUE_REORDERED", itemId: six.itemId, afterItemId: three.itemId });
  assert.deepEqual(room.queue.map(i => i.song.title), ["Song 2", "Song 3", "Song 6", "Song 4", "Song 5"]);
  cmd(store, room, alice, { type: "QUEUE_REORDERED", itemId: six.itemId, afterItemId: null });
  assert.equal(room.queue[0].itemId, six.itemId);
  cmd(store, room, bob, { type: "QUEUE_ITEM_REMOVED", itemId: two.itemId });
  assert.ok(!room.queue.some(i => i.itemId === two.itemId));
});

test("concurrent queue edits compose instead of clobbering", () => {
  const { store, room } = setup();
  const seen = room.version;
  const [two, three] = room.queue;
  // Both users act on the queue they saw at the same version.
  store.command(room.id, alice.id, { type: "QUEUE_ITEM_ADDED", songs: [song(8)], baseVersion: seen });
  store.command(room.id, bob.id, { type: "QUEUE_REORDERED", itemId: three.itemId, afterItemId: null, baseVersion: seen });
  assert.deepEqual(room.queue.map(i => i.song.title), ["Song 3", "Song 2", "Song 8"]);
  // Removing an item someone else already removed is rejected harmlessly.
  store.command(room.id, alice.id, { type: "QUEUE_ITEM_REMOVED", itemId: two.itemId, baseVersion: seen });
  assert.throws(() => store.command(room.id, bob.id, { type: "QUEUE_ITEM_REMOVED", itemId: two.itemId, baseVersion: seen }), { code: "ITEM_NOT_FOUND" });
});

test("adding to an empty Jam starts playback", () => {
  const { store } = setup();
  const room = store.createRoom(carol);
  store.command(room.id, carol.id, { type: "QUEUE_ITEM_ADDED", songs: [song(1)], baseVersion: room.version });
  assert.equal(room.currentItem.song.title, "Song 1");
  assert.equal(room.isPlaying, true);
});

test("invalid songs and bad versions are rejected", () => {
  const { store, room } = setup();
  assert.throws(() => cmd(store, room, alice, { type: "SONG_CHANGED", song: { id: "x", title: "No source" } }), { code: "INVALID_SONG" });
  assert.throws(() => cmd(store, room, alice, { type: "SONG_CHANGED", song: song(1, { pageUrl: "javascript:alert(1)" }) }), { code: "INVALID_SONG" });
  assert.throws(() => store.command(room.id, alice.id, { type: "PLAY", baseVersion: room.version + 5 }), { code: "BAD_REQUEST" });
  assert.throws(() => store.command(room.id, alice.id, { type: "DROP_TABLES", baseVersion: room.version }), { code: "BAD_REQUEST" });
});

test("versions increase monotonically with every change", () => {
  const { store, room } = setup();
  const versions = [room.version];
  cmd(store, room, alice, { type: "PLAY" }); versions.push(room.version);
  cmd(store, room, bob, { type: "QUEUE_ITEM_ADDED", songs: [song(4)] }); versions.push(room.version);
  store.connect(room.id, bob.id); versions.push(room.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  assert.equal(new Set(versions).size, versions.length);
});

test("host can end the room; others can't", () => {
  const { store, room } = setup();
  const ended = [];
  store.on("ended", (id, reason) => ended.push([id, reason]));
  assert.throws(() => store.end(room.id, bob.id), { code: "NOT_HOST" });
  store.end(room.id, alice.id);
  assert.deepEqual(ended, [[room.id, "HOST_ENDED"]]);
  assert.throws(() => store.join(room.id, carol), { code: "ROOM_ENDED" });
});

test("host leaving transfers host to the longest-present online participant", () => {
  const { store, room, clock, updates } = setup();
  clock.advance(1000);
  store.join(room.id, carol);
  store.connect(room.id, carol.id); // Bob joined first but is offline
  store.leave(room.id, alice.id);
  assert.equal(room.hostId, carol.id);
  assert.equal(updates.at(-1).newHostId, carol.id);
});

test("last participant leaving ends the room", () => {
  const { store, room } = setup();
  store.leave(room.id, bob.id);
  store.leave(room.id, alice.id);
  assert.throws(() => store.get(room.id), { code: "ROOM_ENDED" });
});

test("host can remove a participant, who can't rejoin; host can transfer host", () => {
  const { store, room } = setup();
  const removed = [];
  store.on("removed", (id, userId) => removed.push(userId));
  store.join(room.id, carol);
  assert.throws(() => store.kick(room.id, bob.id, carol.id), { code: "NOT_HOST" });
  store.kick(room.id, alice.id, carol.id);
  assert.deepEqual(removed, [carol.id]);
  assert.throws(() => store.join(room.id, carol), { code: "REMOVED_FROM_ROOM" });
  store.transferHost(room.id, alice.id, bob.id);
  assert.equal(room.hostId, bob.id);
  assert.throws(() => store.end(room.id, alice.id), { code: "NOT_HOST" });
});

test("disconnected participants are pruned after the grace period while others listen; host moves on", () => {
  const { store, room, clock } = setup({ participantGraceMs: 60_000 });
  store.connect(room.id, alice.id);
  store.connect(room.id, bob.id);
  store.disconnect(room.id, alice.id);
  clock.advance(30_000); store.sweep();
  assert.ok(room.participants.has(alice.id), "still within grace");
  clock.advance(31_000); store.sweep();
  assert.ok(!room.participants.has(alice.id));
  assert.equal(room.hostId, bob.id);
});

test("a room nobody is connected to expires after the idle TTL", () => {
  const { store, room, clock } = setup({ roomIdleTtlMs: 60_000, participantGraceMs: 10_000 });
  store.connect(room.id, alice.id);
  store.disconnect(room.id, alice.id);
  clock.advance(30_000); store.sweep();
  assert.ok(store.rooms.has(room.id), "nobody pruned while everyone is away");
  clock.advance(31_000); store.sweep();
  assert.throws(() => store.get(room.id), { code: "ROOM_EXPIRED" });
});

test("server position extrapolates while playing; song changes start after the buffer delay", () => {
  const { store, room, clock } = setup({ songStartDelayMs: 800 });
  cmd(store, room, alice, { type: "SEEK", position: 100 });
  cmd(store, room, alice, { type: "PLAY" });
  clock.advance(500);
  assert.equal(store.positionOf(room), 100.5);
  cmd(store, room, bob, { type: "NEXT", fromItemId: room.currentItem.itemId });
  assert.equal(room.positionUpdatedAt, clock.now() + 800);
  assert.equal(store.positionOf(room), 0, "never negative on the server");
});
