import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createJamServer } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const song = n => ({ id: `/songs/${n}`, title: `Song ${n}`, artist: "Artist", pageUrl: `https://pagalnew.com/songs/${n}` });

let jam, base, wsUrl;
before(async () => {
  jam = createJamServer({ ...loadConfig({}), allowedOrigins: ["http://localhost:5173"], songStartDelayMs: 0 });
  await new Promise(resolve => jam.server.listen(0, resolve));
  const { port } = jam.server.address();
  base = `http://localhost:${port}/api/jam`;
  wsUrl = `ws://localhost:${port}/api/jam/ws`;
});
after(() => jam.close());

async function api(path, { method = "GET", token, body, origin } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const session = async name => (await api("/session", { method: "POST", body: { name } })).body;

/** A WebSocket client that records messages and can wait for a matching one. */
function connect(token, roomId) {
  const ws = new WebSocket(wsUrl);
  const messages = [];
  const waiters = [];
  ws.on("message", raw => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const waiter of [...waiters]) if (waiter.match(message)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message); }
  });
  const client = {
    ws, messages,
    get state() { return [...messages].reverse().find(m => m.state)?.state; },
    next: (match, timeout = 2000) => {
      const found = messages.find(m => match(m) && !m.__seen);
      if (found) { found.__seen = true; return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeout);
        waiters.push({ match, resolve: m => { clearTimeout(timer); m.__seen = true; resolve(m); } });
      });
    },
    send: message => ws.send(JSON.stringify(message)),
    command: message => client.send({ baseVersion: client.state.version, ...message }),
    closed: new Promise(resolve => ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })))
  };
  ws.on("open", () => client.send({ type: "HELLO", token, roomId }));
  return client;
}

async function twoPeople() {
  const a = await session("Alice");
  const b = await session("Bob");
  const created = await api("/rooms", { method: "POST", token: a.token, body: { song: song(1), queue: [song(2), song(3)] } });
  assert.equal(created.status, 201);
  const roomId = created.body.roomId;
  assert.equal((await api(`/rooms/${roomId}/join`, { method: "POST", token: b.token })).status, 200);
  const alice = connect(a.token, roomId);
  await alice.next(m => m.type === "ROOM_STATE");
  const bob = connect(b.token, roomId);
  await bob.next(m => m.type === "ROOM_STATE");
  await alice.next(m => m.cause?.type === "PARTICIPANT_ONLINE" && m.cause.userId === b.user.id);
  return { a, b, roomId, alice, bob };
}

test("REST: session, create, get, join errors", async () => {
  assert.equal((await api("/session", { method: "POST", body: { name: "   " } })).status, 400);
  assert.equal((await api("/rooms", { method: "POST", body: {} })).status, 401);
  assert.equal((await api("/rooms", { method: "POST", token: "forged", body: {} })).status, 401);
  const a = await session("Alice");
  const c = await session("Carol");
  const { body: room } = await api("/rooms", { method: "POST", token: a.token, body: {} });
  assert.equal(room.hostId, a.user.id);
  assert.equal((await api(`/rooms/${room.roomId}`, { token: a.token })).status, 200);
  assert.equal((await api(`/rooms/${room.roomId}`, { token: c.token })).body.error.code, "NOT_A_PARTICIPANT");
  assert.equal((await api("/rooms/JAM-NOPE00/join", { method: "POST", token: c.token })).body.error.code, "ROOM_NOT_FOUND");
  assert.equal((await api(`/rooms/${room.roomId}/end`, { method: "POST", token: c.token })).status, 403);
  assert.equal((await api(`/rooms/${room.roomId}/end`, { method: "POST", token: a.token })).status, 204);
  const ended = await api(`/rooms/${room.roomId}/join`, { method: "POST", token: c.token });
  assert.equal(ended.status, 410);
  assert.equal(ended.body.error.code, "ROOM_ENDED");
});

test("REST: disallowed browser origins are refused", async () => {
  const res = await api("/session", { method: "POST", body: { name: "Eve" }, origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("WS: a socket must authenticate as a member", async () => {
  const a = await session("Alice");
  const c = await session("Carol");
  const { body: room } = await api("/rooms", { method: "POST", token: a.token, body: {} });
  const outsider = connect(c.token, room.roomId);
  assert.equal((await outsider.closed).code, 4403);
  const forged = connect("not-a-token", room.roomId);
  assert.equal((await forged.closed).code, 4401);
});

test("WS: Alice plays → Bob receives; Bob pauses → Alice receives; seek and song change propagate", async () => {
  const { alice, bob } = await twoPeople();

  alice.command({ type: "PLAY", requestId: "r1" });
  let update = await bob.next(m => m.cause?.type === "PLAY");
  assert.equal(update.state.isPlaying, true);
  assert.equal(update.cause.requestId, "r1");

  await alice.next(m => m.cause?.type === "PLAY");
  bob.command({ type: "PAUSE", position: 12.5 });
  update = await alice.next(m => m.cause?.type === "PAUSE");
  assert.equal(update.state.isPlaying, false);
  assert.equal(update.state.position, 12.5);

  await bob.next(m => m.cause?.type === "PAUSE");
  bob.command({ type: "SEEK", position: 80 });
  update = await alice.next(m => m.cause?.type === "SEEK");
  assert.equal(update.state.position, 80);

  await bob.next(m => m.cause?.type === "SEEK");
  const target = alice.state.queue[1];
  alice.command({ type: "SONG_CHANGED", itemId: target.itemId });
  update = await bob.next(m => m.cause?.type === "SONG_CHANGED");
  assert.equal(update.state.currentItem.itemId, target.itemId);
  assert.equal(update.state.isPlaying, true);
});

test("WS: queue edits from either user reach everyone", async () => {
  const { alice, bob } = await twoPeople();
  bob.command({ type: "QUEUE_ITEM_ADDED", songs: [song(4)] });
  let update = await alice.next(m => m.cause?.type === "QUEUE_ITEM_ADDED");
  assert.deepEqual(update.state.queue.map(i => i.song.title), ["Song 2", "Song 3", "Song 4"]);
  await bob.next(m => m.cause?.type === "QUEUE_ITEM_ADDED");
  const [two, , four] = alice.state.queue;
  alice.command({ type: "QUEUE_REORDERED", itemId: four.itemId, afterItemId: null });
  update = await bob.next(m => m.cause?.type === "QUEUE_REORDERED");
  assert.deepEqual(update.state.queue.map(i => i.song.title), ["Song 4", "Song 2", "Song 3"]);
  bob.command({ type: "QUEUE_ITEM_REMOVED", itemId: two.itemId });
  update = await alice.next(m => m.cause?.type === "QUEUE_ITEM_REMOVED");
  assert.deepEqual(update.state.queue.map(i => i.song.title), ["Song 4", "Song 3"]);
});

test("WS: concurrent conflicting commands — one wins, the stale one is rejected, everyone converges", async () => {
  const { alice, bob } = await twoPeople();
  const version = alice.state.version;
  alice.send({ type: "PLAY", baseVersion: version, requestId: "a" });
  bob.send({ type: "PAUSE", position: 0, baseVersion: version, requestId: "b" });
  const rejected = await Promise.race([
    alice.next(m => m.type === "COMMAND_REJECTED"),
    bob.next(m => m.type === "COMMAND_REJECTED")
  ]);
  assert.equal(rejected.code, "STALE_COMMAND");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(alice.state.version, bob.state.version);
  assert.equal(alice.state.isPlaying, bob.state.isPlaying);
});

test("WS: both clients reporting song end advance once", async () => {
  const { alice, bob } = await twoPeople();
  const from = alice.state.currentItem.itemId;
  alice.command({ type: "NEXT", fromItemId: from, auto: true });
  bob.command({ type: "NEXT", fromItemId: from, auto: true });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(alice.state.currentItem.song.title, "Song 2");
  assert.deepEqual(alice.state.queue.map(i => i.song.title), ["Song 3"]);
});

test("WS: reconnect restores full authoritative state, including changes missed while offline", async () => {
  const { b, roomId, alice, bob } = await twoPeople();
  bob.ws.close();
  await alice.next(m => m.cause?.type === "PARTICIPANT_OFFLINE");
  alice.command({ type: "SEEK", position: 33 });
  await alice.next(m => m.cause?.type === "SEEK");
  alice.command({ type: "QUEUE_ITEM_ADDED", songs: [song(9)] });
  await alice.next(m => m.cause?.type === "QUEUE_ITEM_ADDED");
  const versionWhileAway = alice.state.version;

  const again = connect(b.token, roomId);
  const welcome = await again.next(m => m.type === "ROOM_STATE");
  assert.equal(welcome.state.position, 33);
  assert.equal(welcome.state.queue.at(-1).song.title, "Song 9");
  assert.equal(welcome.state.version, versionWhileAway + 1, "includes Bob coming back online");
  assert.ok(welcome.state.participants.find(p => p.id === b.user.id).online);
});

test("WS: host leaves → host transfers and everyone is told", async () => {
  const { a, b, roomId, bob } = await twoPeople();
  assert.equal((await api(`/rooms/${roomId}/leave`, { method: "POST", token: a.token })).status, 204);
  const update = await bob.next(m => m.cause?.type === "PARTICIPANT_LEFT");
  assert.equal(update.cause.newHostId, b.user.id);
  assert.equal(update.state.hostId, b.user.id);
});

test("WS: host removes a participant → their socket is closed and they can't rejoin", async () => {
  const { a, b, roomId, alice, bob } = await twoPeople();
  assert.equal((await api(`/rooms/${roomId}/participants/${b.user.id}`, { method: "DELETE", token: a.token })).status, 204);
  await bob.next(m => m.type === "PARTICIPANT_REMOVED");
  assert.equal((await bob.closed).code, 4403);
  await alice.next(m => m.cause?.type === "PARTICIPANT_REMOVED");
  assert.equal((await api(`/rooms/${roomId}/join`, { method: "POST", token: b.token })).body.error.code, "REMOVED_FROM_ROOM");
});

test("WS: host ends the Jam → everyone gets ROOM_ENDED and sockets close", async () => {
  const { a, roomId, bob } = await twoPeople();
  await api(`/rooms/${roomId}/end`, { method: "POST", token: a.token });
  const ended = await bob.next(m => m.type === "ROOM_ENDED");
  assert.equal(ended.reason, "HOST_ENDED");
  assert.equal((await bob.closed).code, 4410);
});

test("WS: PING returns server time for clock sync", async () => {
  const { alice } = await twoPeople();
  alice.send({ type: "PING", t0: 123 });
  const pong = await alice.next(m => m.type === "PONG");
  assert.equal(pong.t0, 123);
  assert.ok(Math.abs(pong.serverTime - Date.now()) < 1000);
});
