import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// src/utils/share.ts is dependency-free; transpile it with the project's TypeScript and import it directly.
// Node 18 lacks "deflate-raw", so this exercises the uncompressed "j" fallback; the browser test covers compression.
globalThis.window = { location: { origin: "https://music.example" } };
const source = await readFile(new URL("../src/utils/share.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { encodeShare, decodeShare, shareUrl, MAX_SHARED_SONGS } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const song = n => ({ id: `/songs/song-${n}.html`, title: `Song ${n} — दिल`, artist: "Artist", pageUrl: `https://pagalnew.com/songs/song-${n}.html`, imageUrl: `https://pagalnew.com/img/${n}.jpg`, audioUrl: "https://private.example/stream", duration: 200 });

test("a song round-trips, keeping only shareable fields (and Unicode)", async () => {
  const data = await encodeShare("song", [song(1)]);
  assert.match(data, /^[zj][A-Za-z0-9_-]+$/, "URL-safe");
  const decoded = await decodeShare(data);
  assert.equal(decoded.kind, "song");
  assert.deepEqual(decoded.songs[0], { id: "/songs/song-1.html", title: "Song 1 — दिल", artist: "Artist", pageUrl: "https://pagalnew.com/songs/song-1.html", imageUrl: "https://pagalnew.com/img/1.jpg" });
  assert.equal(decoded.songs[0].audioUrl, undefined, "this device's stream URL is not shared");
});

test("a playlist round-trips with its name and order", async () => {
  const decoded = await decodeShare(await encodeShare("playlist", [song(1), song(2), song(3)], "Road trip"));
  assert.equal(decoded.name, "Road trip");
  assert.deepEqual(decoded.songs.map(s => s.title), ["Song 1 — दिल", "Song 2 — दिल", "Song 3 — दिल"]);
});

test(`playlists are capped at ${MAX_SHARED_SONGS} songs`, async () => {
  const many = Array.from({ length: MAX_SHARED_SONGS + 20 }, (_, i) => song(i));
  const decoded = await decodeShare(await encodeShare("playlist", many, "Big"));
  assert.equal(decoded.songs.length, MAX_SHARED_SONGS);
});

test("songs that can't play elsewhere are dropped; nothing shareable throws", async () => {
  const localOnly = { id: "x", title: "On my device", artist: "Me" };
  const decoded = await decodeShare(await encodeShare("playlist", [localOnly, song(1)], "Mixed"));
  assert.equal(decoded.songs.length, 1);
  await assert.rejects(() => encodeShare("song", [localOnly]));
});

test("malformed or tampered links decode to undefined instead of throwing", async () => {
  const b64 = value => "j" + Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const bad of ["", "x123", "j!!!", "jbm90IGpzb24", b64({ v: 2, kind: "song", songs: [song(1)] }), b64({ v: 1, kind: "album", songs: [song(1)] }), b64({ v: 1, kind: "song", songs: [] }), b64({ v: 1, kind: "song", songs: "nope" })]) {
    assert.equal(await decodeShare(bad), undefined, `rejects ${bad.slice(0, 20)}`);
  }
});

test("unsafe URLs in a crafted link are stripped", async () => {
  const crafted = "j" + Buffer.from(JSON.stringify({ v: 1, kind: "song", songs: [{ id: "a", title: "T", artist: "A", pageUrl: "javascript:alert(1)" }, { ...song(1), imageUrl: "javascript:alert(2)" }] })).toString("base64url");
  const decoded = await decodeShare(crafted);
  assert.equal(decoded.songs.length, 1, "song with a javascript: page URL is dropped");
  assert.equal(decoded.songs[0].imageUrl, undefined, "javascript: image URL is removed");
});

test("share URLs put the data in the fragment", () => {
  assert.equal(shareUrl("jabc"), "https://music.example/share#jabc");
});
