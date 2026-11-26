import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { createJamServer } from "../src/app.js";
import { loadConfig } from "../src/config.js";

// Songs uploaded from a device into a Jam: upload, stream with Range, limits, and cleanup when the room ends.

let jam, base;
before(async () => {
  jam = createJamServer({ ...loadConfig({}), allowedOrigins: ["http://localhost:5173"], songStartDelayMs: 0, maxUploadBytes: 1000, maxRoomUploadBytes: 2500 });
  await new Promise(resolve => jam.server.listen(0, resolve));
  base = `http://localhost:${jam.server.address().port}/api/jam`;
});
after(() => jam.close());

const json = async res => { const text = await res.text(); return text ? JSON.parse(text) : undefined; };
const session = async name => json(await fetch(`${base}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }));
const createRoom = async token => json(await fetch(`${base}/rooms`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}" }));
const upload = (roomId, token, bytes, type = "audio/mpeg") => fetch(`${base}/rooms/${roomId}/files`, { method: "POST", headers: { "Content-Type": type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: bytes });
const bytes = n => Uint8Array.from({ length: n }, (_, i) => i % 256);

test("a member uploads a song and anyone with the link streams it, with Range for seeking", async () => {
  const alice = await session("Alice");
  const room = await createRoom(alice.token);
  const res = await upload(room.roomId, alice.token, bytes(600));
  assert.equal(res.status, 201);
  const { fileId, size, contentType } = await json(res);
  assert.equal(size, 600);
  assert.equal(contentType, "audio/mpeg");
  assert.match(fileId, /^[A-Za-z0-9_-]{32}$/);

  const url = `${base}/rooms/${room.roomId}/files/${fileId}`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), bytes(600));

  const part = await fetch(url, { headers: { Range: "bytes=100-109" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 100-109/600");
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes(600).slice(100, 110)]);

  const tail = await fetch(url, { headers: { Range: "bytes=-5" } });
  assert.equal(tail.headers.get("content-range"), "bytes 595-599/600");
  assert.equal((await fetch(url, { headers: { Range: "bytes=900-" } })).status, 416);
  assert.equal((await fetch(url, { method: "HEAD" })).headers.get("content-length"), "600");
});

test("uploads need a member's session and an audio type, and respect size limits", async () => {
  const alice = await session("Alice"), mallory = await session("Mallory");
  const room = await createRoom(alice.token);
  assert.equal((await upload(room.roomId, undefined, bytes(10))).status, 401);
  assert.equal((await upload(room.roomId, mallory.token, bytes(10))).status, 403);
  const html = await upload(room.roomId, alice.token, bytes(10), "text/html");
  assert.equal(html.status, 415);
  assert.equal((await json(html)).error.code, "UNSUPPORTED_FILE");
  assert.equal((await json(await upload(room.roomId, alice.token, bytes(1001)))).error.code, "FILE_TOO_LARGE");
  assert.equal((await upload(room.roomId, alice.token, new Uint8Array(0))).status, 400);
  // Room limit is 2500 bytes: two 1000-byte songs fit, a third doesn't.
  assert.equal((await upload(room.roomId, alice.token, bytes(1000))).status, 201);
  assert.equal((await upload(room.roomId, alice.token, bytes(1000))).status, 201);
  assert.equal((await json(await upload(room.roomId, alice.token, bytes(1000)))).error.code, "UPLOAD_STORAGE_FULL");
});

test("unknown or malformed file ids are not found, and files are deleted when the Jam ends", async () => {
  const alice = await session("Alice");
  const room = await createRoom(alice.token);
  assert.equal((await fetch(`${base}/rooms/${room.roomId}/files/${"a".repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${base}/rooms/${room.roomId}/files/..%2F..%2Fetc%2Fpasswd`)).status, 404);

  const { fileId } = await json(await upload(room.roomId, alice.token, bytes(50)));
  const onDisk = path.join(jam.files.dir, room.roomId, fileId);
  assert.ok(existsSync(onDisk));
  const end = await fetch(`${base}/rooms/${room.roomId}/end`, { method: "POST", headers: { Authorization: `Bearer ${alice.token}` } });
  assert.equal(end.status, 204);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(!existsSync(onDisk));
  assert.equal((await fetch(`${base}/rooms/${room.roomId}/files/${fileId}`)).status, 410);
});
