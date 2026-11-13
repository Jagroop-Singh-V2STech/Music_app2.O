import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/worker.js";

// POST /api/spotify/import against mocked Spotify embed pages. No network.

const ID = "37i9dQZF1EIfFUEPTOA50z";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const track = (n, extra = {}) => ({ uri: `spotify:track:${String(n).padStart(22, "a")}`, uid: `u${n}`, title: `Song ${n}`, subtitle: `Artist ${n}`, duration: 200000 + n, entityType: "track", isPlayable: true, ...extra });
const embedHtml = (entity, pageProps) => `<!doctype html><html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: pageProps ?? { state: { data: { entity } } } } })}</script></body></html>`;
const playlist = (trackList, extra = {}) => ({ type: "playlist", name: "Soft Love Song Mix", uri: `spotify:playlist:${ID}`, coverArt: { sources: [{ url: "https://image-cdn.example/cover.jpg", width: null, height: null }] }, trackList, ...extra });

function mockSpotify(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return respond(String(url), init); };
  return calls;
}
const html = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html" } });
const importRequest = (body, env = {}) => worker.fetch(new Request("https://worker.example/api/spotify/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), env);

test("imports a playlist: metadata, normalized tracks, embed URL built from the ID only", async () => {
  const calls = mockSpotify(() => html(embedHtml(playlist([track(1, { title: "love.", subtitle: "wave to earth", duration: 307750 }), track(2)]))));
  const res = await importRequest({ playlist_url: `https://open.spotify.com/playlist/${ID}?si=abc123` });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assert.deepEqual(calls.map(c => c.url), [`https://open.spotify.com/embed/playlist/${ID}`]);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(body.id, ID);
  assert.equal(body.title, "Soft Love Song Mix");
  assert.equal(body.image, "https://image-cdn.example/cover.jpg");
  assert.equal(body.total_tracks, 2);
  assert.equal(body.possibly_truncated, false);
  assert.deepEqual(body.tracks[0], { spotify_id: "aaaaaaaaaaaaaaaaaaaaa1", title: "love.", artist: "wave to earth", duration_ms: 307750 });
});

test("accepts intl links and spotify: URIs", async () => {
  mockSpotify(() => html(embedHtml(playlist([track(1)]))));
  for (const playlist_url of [`https://open.spotify.com/intl-de/playlist/${ID}`, `spotify:playlist:${ID}`, `  https://open.spotify.com/playlist/${ID}/  `]) {
    const res = await importRequest({ playlist_url });
    assert.equal(res.status, 200, playlist_url);
  }
});

test("rejects invalid URLs and IDs without fetching anything (no SSRF)", async () => {
  const calls = mockSpotify(() => { throw new Error("must not fetch"); });
  for (const playlist_url of [
    "not a url",
    `http://open.spotify.com/playlist/${ID}`,
    `https://evil.example/playlist/${ID}`,
    `https://open.spotify.com.evil.example/playlist/${ID}`,
    `https://user@open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com:8443/playlist/${ID}`,
    `https://open.spotify.com/album/${ID}`,
    "https://open.spotify.com/playlist/tooShort",
    "https://open.spotify.com/playlist/37i9dQZF1EIfFUEPTOA50z!",
    `https://open.spotify.com/playlist/${ID}/../../embed/x`,
    123,
    undefined,
  ]) {
    const res = await importRequest({ playlist_url });
    assert.equal(res.status, 400, String(playlist_url));
    assert.equal((await res.json()).error.code, "INVALID_URL");
  }
  const bad = await importRequest("{not json");
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "INVALID_REQUEST");
  assert.equal(calls.length, 0);
});

test("a missing or private playlist (Spotify's error page) is PLAYLIST_UNAVAILABLE", async () => {
  mockSpotify(() => html(embedHtml(null, { status: 500, title: "Page not available" })));
  const res = await importRequest({ playlist_url: `https://open.spotify.com/playlist/${"A".repeat(22)}` });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, "PLAYLIST_UNAVAILABLE");
});

test("a page without __NEXT_DATA__ or with an unexpected shape is EMBED_FORMAT_CHANGED, never a partial success", async () => {
  for (const body of [
    "<html><body>new layout</body></html>",
    '<script id="__NEXT_DATA__" type="application/json">{broken</script>',
    embedHtml(null, { somethingElse: true }),
    embedHtml({ type: "playlist", name: "X", tracks: [] }),
    embedHtml(playlist([{ foo: 1 }, { bar: 2 }])),
  ]) {
    mockSpotify(() => html(body));
    const res = await importRequest({ playlist_url: `https://open.spotify.com/playlist/${ID}` });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, "EMBED_FORMAT_CHANGED");
  }
});

test("an empty playlist imports with zero tracks", async () => {
  mockSpotify(() => html(embedHtml(playlist([]))));
  const body = await (await importRequest({ playlist_url: `https://open.spotify.com/playlist/${ID}` })).json();
  assert.equal(body.total_tracks, 0);
  assert.deepEqual(body.tracks, []);
});

test("skips episodes, untitled entries and duplicates; flags a 100-song list as possibly truncated", async () => {
  const list = Array.from({ length: 100 }, (_, i) => track(i + 1));
  list[10] = track(1); // duplicate of the first song
  list[20] = { ...track(21), entityType: "episode" };
  list[30] = { ...track(31), title: "" };
  mockSpotify(() => html(embedHtml(playlist(list))));
  const body = await (await importRequest({ playlist_url: `https://open.spotify.com/playlist/${ID}` })).json();
  assert.equal(body.total_tracks, 100);
  assert.equal(body.tracks.length, 97);
  assert.equal(body.skipped_tracks, 3);
  assert.equal(body.possibly_truncated, true);
  assert.equal(new Set(body.tracks.map(t => t.spotify_id)).size, 97);
});

test("upstream errors: timeout, 429, redirect/challenge and 5xx", async () => {
  const cases = [
    [() => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }, 504, "UPSTREAM_TIMEOUT"],
    [() => html("slow down", 429), 429, "RATE_LIMITED"],
    [() => new Response(null, { status: 302, headers: { Location: "https://challenge.example" } }), 502, "SPOTIFY_UNAVAILABLE"],
    [() => html("oops", 503), 502, "SPOTIFY_UNAVAILABLE"],
    [() => html("gone", 404), 404, "PLAYLIST_UNAVAILABLE"],
    [() => { throw new TypeError("network down"); }, 502, "SPOTIFY_UNAVAILABLE"],
  ];
  for (const [respond, status, code] of cases) {
    mockSpotify(respond);
    const res = await importRequest({ playlist_url: `https://open.spotify.com/playlist/${ID}` });
    assert.equal(res.status, status, code);
    assert.equal((await res.json()).error.code, code);
  }
});

test("the timeout is configurable", async () => {
  const calls = mockSpotify(() => html(embedHtml(playlist([track(1)]))));
  await importRequest({ playlist_url: `https://open.spotify.com/playlist/${ID}` }, { SPOTIFY_EMBED_TIMEOUT_MS: "5000" });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("CORS preflight allows POST; existing GET routes still answer", async () => {
  const pre = await worker.fetch(new Request("https://worker.example/api/spotify/import", { method: "OPTIONS" }), {});
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Methods"), /POST/);
  const health = await worker.fetch(new Request("https://worker.example/"), {});
  assert.equal(health.status, 200);
  const wrongMethod = await worker.fetch(new Request("https://worker.example/api/spotify/import"), {});
  assert.equal(wrongMethod.status, 404);
});
