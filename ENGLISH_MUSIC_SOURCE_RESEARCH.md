# English Music Source Research

> Research only. No application code was changed.
> Branch inspected: `spotify-import` (HEAD `5a614dd`). Date: 2026-11-25.
>
> Legend used throughout:
> - **[Verified]**: read in this repository, or observed directly with an HTTP request during this research.
> - **[Docs]**: taken from the provider's public documentation or announcements (sources at the end). Check the live page before relying on it.
> - **[Assumption]**: an inference that was not tested.

---

## TL;DR

1. **Today the app has exactly one music source**, `pagalnew.com`. The Cloudflare Worker scrapes its HTML (`worker/worker.js`), and the frontend parses it (`src/services/api.ts`). There is no provider interface. `Song.id` is the PagalNew page path, and dedupe everywhere uses `song.id`. **[Verified]**
2. **Do not use MP3.pm.** Its `data-sound-url` works technically: the token is a fixed, server-rendered value that was the same on two page loads, and the audio host supports HTTP Range. But the site says in its own disclaimer that it does not host the files, has no connection with the servers that do, and that users "must remove a song from the computer after listening". It has no API and no licence. Its `robots.txt` also disallows `/search`. An HTML attribute is not a permission. **[Verified]**
3. **Licensed full-track English playback is only available from catalogues built for reuse**: Audius (free, open API) and Jamendo (Creative Commons, needs a client id). Internet Archive works for public-domain and live material. Mainstream English hits (Dua Lipa, Taylor Swift, …) **cannot legally be streamed in full by a third-party web app** without a licensing deal or the label service's own player. Deezer and iTunes give 30-second previews plus excellent metadata. YouTube allows only its visible embedded player, with no background or audio-only play.
4. **Recommended architecture: Option B (a unified provider interface) with Option C's language routing on top**, implemented inside the existing Worker. Wrap the current PagalNew code *unchanged* as the `pagalnew` provider. Add English providers behind it. Keep one `Song` type, gaining optional `source`/`sourceSongId`/`language` fields, so the single `<audio>` element in `PlayerContext`, along with playlists, favorites, the queue and downloads, keeps working.
5. **Flag for the team:** PagalNew has the same licensing problem as MP3.pm (an unlicensed Bollywood MP3 site). That is outside this task, and nothing here touches it. But "verify permitted usage" applies to the existing Hindi source too. Section 9 covers this.

---

## 1. Existing music architecture **[Verified]**

### 1.1 Components

| Layer | Location | Role |
|---|---|---|
| React SPA (Vite, React 19, React Query, react-router) | `src/` | The current app, deployed to Vercel (`vercel.json`) |
| Legacy vanilla app | `js/*.js`, `css/` | An older version with the same API calls (`js/api.js`). `index.html` no longer loads it, so it is dead code |
| Music API | `worker/worker.js`, a Cloudflare Worker at `https://music-be.jagroop-singh-v2stech.workers.dev` (hard-coded in `src/services/api.ts:3`) | Proxy and scraper for pagalnew.com, plus the Spotify embed import |
| Jam server | `server/src/*` (Node + socket.io, on Render) | Shared listening rooms. It stores song **metadata only**, and each client resolves audio itself (`server/src/songs.js` `sanitizeSong`) |
| Lyrics | `src/services/lyrics.ts` → LRCLIB (`https://lrclib.net/api`) | Called directly from the browser. Includes Hindi/Punjabi romanization (`src/utils/romanize.ts`) |
| Offline | `src/services/offline.ts` (IndexedDB `mymusic-offline`), `public/sw.js` (image cache) | Downloaded audio blobs keyed by `song.id` |

### 1.2 Worker endpoints (`worker/worker.js`, `fetch` router lines 71–141)

| Method & path | Handler | Upstream | Returns |
|---|---|---|---|
| `GET /` | `handleHealth` | none | `{message,status:"ok"}` |
| `GET /api/search?find=` | `handleSearch` | `pagalnew.com/search.php?find=` | **Raw PagalNew HTML** (`htmlResponse`). The browser parses it |
| `GET /api/albums?find=` | `handleAlbumSearch` | Up to `MAX_ALBUM_PAGES = 15` result pages, edge-cached for 1 hour (`fetchCachedHtml`) | `{albums:[{url,name,year}]}` |
| `GET /api/album?url=` | `handleAlbum` → `parseAlbumPage` | Album page (host and `/album/` prefix checked) | `{name,imageUrl,songs:[{pageUrl,title,artist}]}` |
| `GET /api/song?url=` | `handleSong` → `findAudioUrl` | Song page | `{audioUrl:"/api/stream?url=…", sourceUrl}` |
| `GET /api/stream?url=` | `handleStream` | MP3 on pagalnew.com | Byte stream. Forwards `Range`, `Content-Range`, `Accept-Ranges`, `Content-Type`, `Content-Length`. Times out after 30 s |
| `POST /api/spotify/import` | `handleSpotifyImport` | `open.spotify.com/embed/playlist/<id>` | `{id,title,tracks:[…]}`. Errors use the shape `{error:{code,message}}` |

Conventions worth reusing:
- **SSRF guard:** every URL-taking handler parses the URL and requires `https:` and `hostname === PAGALNEW_HOSTNAME`. `findAudioUrl` also re-validates the resolved MP3 host. The Spotify fetch uses `redirect:"manual"`, a byte cap and a timeout.
- **Timeouts:** `AbortSignal.timeout(15000)` for pages, 30 s for streams.
- **Errors:** upstream failures map to `502`, bad input to `400`, and a missing audio URL to `404`. Older routes use `{message, error}`, while the newer Spotify route uses `{error:{code,message}}`. The new API should standardise on the newer shape.
- **CORS:** `Access-Control-Allow-Origin: *`.

### 1.3 End-to-end flow: Search → Playback

```
Search.tsx (400 ms debounce)
  → useSearch(query)                       src/hooks/useSearch.ts  (React Query key ["search", q], staleTime 30 s)
    → searchSongs(query)                   src/services/api.ts:24
        → searchExact(phrase)              GET {base}/api/search?find=…   → HTML
            → parseSearchResults(html)     DOMParser, <a href*="/songs/"> → Song{id: href, title, artist, pageUrl, imageUrl}
        → (≤3 words, no exact title) songsFromNamedAlbums → /api/albums → /api/album
        → (<4 results) fuzzySearch: ≤6 extra searchExact calls on words/stems, ranked by matchScore (src/utils/match.ts)
        → dedupe by song.id, exact-title matches first
  → SongRow click → usePlayer().play(song, list)       src/context/PlayerContext.tsx:97
    → load(song)                                       PlayerContext.tsx:64
        → getAudio(song.id)  (IndexedDB, offline copy?)
        → else getSongDetails(song.pageUrl)            api.ts:122 → GET /api/song?url=…
             ← {audioUrl:"/api/stream?url=<mp3>"}      made absolute against `base`
        → audio.src = audioUrl; audio.play()           a single `new Audio()` for the whole app
    → Worker /api/stream proxies the MP3 with Range → <audio> seeks natively
```

### 1.4 The answers to the Phase 1 questions

| # | Question | Finding |
|---|---|---|
| 1 | Hindi sources | One: **pagalnew.com** (Bollywood/Punjabi/Haryanvi MP3 site), scraped. JioSaavn, Gaana and similar sources are not used |
| 2 | Searching | PagalNew `search.php` substring match, about 6 results and no paging. The client adds album expansion and fuzzy re-queries (`api.ts:12–120`). Artist pages run about 24 narrow queries (`useArtistSongs.ts`) |
| 3 | Metadata | Title and artist come from link text (`"Title - Artist"`), artwork from `<img>`. Album only when found via album pages. **No duration, language, year or ISRC** |
| 4 | Playback URL | `findAudioUrl` prefers a "128 kbps" download link, falling back to `<audio src>`, and only accepts pagalnew.com hosts |
| 5 | Streaming | Worker proxy with Range passthrough, so seeking works. No caching of audio |
| 6 | Multiple sources | **None.** `base` and the PagalNew host are hard-coded. `parseSearchResults` builds `pageUrl` against `https://pagalnew.com` |
| 7 | Common interface | **None.** The only "interface" is the frontend `Song` type (`src/types/music.ts`) and `PlayerEngine` (player side) |
| 8 | Duplicates | By `song.id` (the PagalNew href) in `searchSongs`, `uniqueSongs` (`utils/library.ts:8`), favorites, playlists and the queue. Artist pages dedupe by `title|artist` (`useArtistSongs.ts` `key`). Spotify import ranks candidates with `rankMatches` (`utils/match.ts`) |
| 9 | Playlists, favorites, history, queue | `MusicContext` stores **whole `Song` objects** in localStorage (`music_favorites`, `music_playlists`, `music_recent` (max 50), `music_queue`, plus search history in `musicStorage.searches`). Shares (`utils/share.ts`) and Jam (`server/src/songs.js`) carry `{id,title,artist,imageUrl,pageUrl}` |
| 10 | Errors and unavailable songs | Worker: 400/404/502 JSON. Player: `load()` catches and sets `error`, `audio` `error` event → "This audio source is unavailable", autoplay block → `"blocked"`, offline → downloaded songs only. **No retry or URL refresh** (PagalNew URLs don't expire, so none was needed) |

**Implication for new providers:** a `Song` object is persisted on the device and shared between devices, so it must be **self-describing and resolvable later**. It needs a stable id and a source reference. It must never carry a temporary playback URL.

---

## 2. Existing Hindi provider analysis (PagalNew)

| Aspect | Observation |
|---|---|
| Access method | HTML scraping with a spoofed desktop Chrome `User-Agent` (`browserHeaders`) and `Referer` **[Verified]** |
| API | None. Search returns HTML, which the browser parses **[Verified]** |
| Catalogue | Hindi, Punjabi and Haryanvi film and pop. Featured playlists are seed searches (`src/data/featuredPlaylists.ts`) **[Verified]** |
| Stability | Depends on the page markup. The regexes in `parseAlbumPage`/`findAudioUrl` break when markup changes **[Verified from code]** |
| Licensing | **[Assumption, high confidence]** PagalNew is a free MP3-download site with no visible licence from labels. It falls in the same risk category as MP3.pm |
| Strengths for us | Works today. URLs don't expire. Range is supported. Users like the catalogue |

Constraint from the brief: keep it intact. The proposal below wraps it as is.

---

## 3. MP3.pm technical investigation

All requests were plain `curl` GET/HEAD calls with no cookies, no JS execution and no evasion. In total: 2 homepage loads, robots.txt, the disclaimer page, 1 HEAD and one 2-byte Range request.

| # | Question | Finding |
|---|---|---|
| 1 | Discovery | Homepage lists "Most popular songs" (50 items). Artist subdomains look like `https://9545933-dua-lipa.mp3.pm/song/77040035-…/` **[Verified]** |
| 2 | Search endpoint | No public API. The search form is an AngularJS controller (`SearchElementCtrl.search`) posting to site routes. **`robots.txt`: `Disallow: /search`** **[Verified]** |
| 3 | IDs and metadata in results | `li.cplayer-sound-item[data-sound-id]` plus a filename such as `Dua_Lipa_-_Lost_In_Your_Light_feat._Miguel_(mp3.pm).mp3`. No structured album, duration or artwork fields were seen in list markup **[Verified]** |
| 4 | Playback URL on page | Yes: `data-sound-url` (`/listen/…`), `data-download-url` (`/download/…`) and `data-share-url` (malformed: `https://mp3.pmhttps://…`) **[Verified]** |
| 5 | How `data-sound-url` is populated | **Server-rendered** into the HTML (present in the raw response without running JS) **[Verified]** |
| 6 | Token nature | Opaque token: base64 of base64 of 96 random-looking bytes (likely encrypted). **It was identical on two page loads about 20 s apart.** **[Verified]** Whether it varies by IP, time or session is **[Unknown]** |
| 7 | Expiry | Not determined. The audio response has `Expires: 2037` and `Cache-Control: max-age=315360000`, but that describes the file, not the token **[Verified headers, expiry unknown]** |
| 8 | Cookies, headers, Referer | The HEAD succeeded **without** cookies or Referer **[Verified]** |
| 9 | Range and seeking | `Accept-Ranges: bytes`. `Range: bytes=0-1` → `206` with `Content-Range: bytes 0-1/6735173` **[Verified]** |
| 10 | Content type | **`audio/aac`** with `Content-Disposition: attachment; filename=….aac`, despite the `.mp3` name. Most browsers play AAC in `<audio>`, but metadata/duration probing and offline blob types would be wrong if `.mp3` is assumed **[Verified]** |
| 11 | Bot blocking and rate limits | Plain curl was not blocked. No rate-limit headers were seen. Behaviour under load is **[Unknown]** and was deliberately not tested |
| 12 | Permitted use and authorization | **Negative.** The disclaimer (`/disclaimer/`) says MP3.pm "does not host any of the music files … (just proxy files via server)", indexes files on servers it has no connection with, presents music "only for fact-finding listening", and tells users to delete files after listening. There are no Terms of Use or API terms and no rights-holder licence. **[Verified]** |

**Conclusion: reject MP3.pm.** It has no API or terms, its robots.txt disallows search, it disclaims all rights, and its content is mainstream label music, so streaming it through our Worker would be redistribution of unlicensed copies. It is also technically fragile: an opaque token of unknown lifetime, a wrong MIME type, and a malformed share URL. Building on it is exactly the "MP3 URL ≠ permission" case the brief warns about.

---

## 4. Alternative English music providers

| Provider | Discovery | Playback available to a 3rd-party web app | Auth | Licensing and terms notes |
|---|---|---|---|---|
| **Audius** | REST search for tracks, artists and playlists | **Full tracks**, `GET /v1/tracks/{id}/stream` (MP3, **Range supported**) **[Docs]** | None. Send `app_name` (API keys are newer and optional) **[Docs]** | Artist-uploaded and decentralised. Free API. Asks you to credit artists **[Docs]**. Catalogue is mostly indie, electronic and hip-hop. **Few major-label hits** |
| **Jamendo** | `GET /v3.0/tracks?search=…` with tags, `lang` and so on | **Full tracks**, `audio` field (stream URL) and `audioformat` **[Docs]** | `client_id` (free registration) **[Docs]** | Creative Commons, per-track licence fields. Non-commercial use is free under its Terms of Use §3.3. Indie only |
| **Internet Archive** | `advancedsearch.php` + `/metadata/{id}` JSON | Full files over a CDN with Range [Assumption: standard archive.org behaviour] | None | Per-item rights. Use public-domain or CC collections only (78 rpm, Live Music Archive for taper-friendly bands). Not a source of modern pop |
| **Deezer API** | `api.deezer.com/search?q=` (no key) with excellent metadata (ISRC, album, artwork, duration) | **30-second `preview` only** (time-limited CDN URL) **[Docs / 3rd-party reports]** | None for search | Deezer Terms of Use apply. Full streaming needs a Deezer user plus SDK/commercial agreement **[Docs]** |
| **iTunes Search API** | `itunes.apple.com/search?term=&entity=song` | **30-second `previewUrl`** | None | Apple's terms. Previews are for promoting the track, so link back to Apple Music. Full playback means MusicKit JS + a user's Apple Music subscription |
| **Spotify Web API** | Search and metadata | **None for 3rd-party audio**: `preview_url` has been effectively null since the Nov 2024 changes. The Web Playback SDK needs the user's Premium account **[Docs]** | OAuth. As of Feb/Mar 2026, Dev Mode requires Premium and limits test users. Extended quota needs an "established, scalable" app **[Docs]** | Good for metadata only, and **already used unofficially** (embed scraping) by `/api/spotify/import` |
| **YouTube Data API + IFrame Player** | `search.list` (100 quota units per call, 10k per day default) | Only through the **visible embedded YouTube player**. Background play and modifying or blocking the player are prohibited, and autoplay requires the player to be ≥50% visible **[Docs]** | API key | Licensed via YouTube itself. Cannot feed our `<audio>` element or the queue, sleep timer, offline mode or Jam sync as they are |
| **SoundCloud API** | Search tracks | Stream for `access: "playable"` tracks. Limit of 15,000 play requests per 24 h per client id **[Docs]** | OAuth 2.1. App registration needs an Artist Pro subscription **[Docs]** | Ripping or copying content is prohibited, "webcasting radio apps" are prohibited, and access can be revoked without notice **[Docs]** |
| MusicBrainz / Cover Art Archive | Metadata, ISRC, language tags | None | None (1 req/s, custom UA) | CC0 metadata. Useful for dedupe and language detection, not for playback |
| **MP3.pm** | HTML only | Full file, unlicensed | None | Rejected (section 3) |

---

## 5. Comparison table

Scores range from ★ to ★★★.

| Source | Legal to stream in our app | Full tracks | Mainstream English catalogue | Metadata quality | API stability | Fits our `<audio>` + Worker proxy | Effort |
|---|---|---|---|---|---|---|---|
| Audius | ★★★ | ✅ | ★ | ★★ | ★★★ (documented) | ✅ (Range) | Low |
| Jamendo | ★★★ (CC, non-commercial) | ✅ | ★ | ★★ | ★★★ | ✅ | Low |
| Internet Archive | ★★★ (PD/CC items only) | ✅ | ✗ | ★ | ★★ | ✅ | Medium (rights filtering) |
| Deezer | ★★★ for previews | ✗ (30 s) | ★★★ | ★★★ | ★★★ | ✅ for previews | Low |
| iTunes Search | ★★★ for previews | ✗ (30 s) | ★★★ | ★★★ | ★★★ | ✅ for previews | Low |
| Spotify | ★★★ metadata only | ✗ | ★★★ | ★★★ | ★ (repeated restrictions) | ✗ | High |
| YouTube | ★★ (embed only) | ✅ (visible player) | ★★★ | ★★ | ★★★ | ✗ (separate player) | High |
| SoundCloud | ★★ (gated, revocable) | Partial | ★★ | ★★ | ★ (access gated) | ✅ | Medium–High |
| MP3.pm | ✗ | ✅ | ★★★ | ★ | ✗ | ✅ | Rejected |
| PagalNew (existing) | ✗ [Assumption] | ✅ | – (Hindi) | ★ | ✗ | ✅ | Existing |

**The trade-off:** no free, licensed source gives full-length mainstream English hits to a third-party web player. Choose among:
- (a) **licensed full tracks from indie/CC catalogues** (Audius, Jamendo),
- (b) **licensed 30-second previews of mainstream songs** (Deezer/iTunes) for discovery, with a link out to the full track, or
- (c) the **visible YouTube embed** as a separate playback mode (a large UX and architecture change).

Recommendation: ship (a) plus (b) first.

---

## 6. Recommended integration architecture

### 6.1 Options evaluated

| Option | Fit with this codebase |
|---|---|
| **A. Separate providers** (bolt English endpoints on beside PagalNew) | Quickest, but duplicates search, normalization and dedupe logic in `api.ts`, and the frontend would need per-source branches in search and `getSongDetails` |
| **B. Unified provider interface** | The best long-term fit. The app already funnels everything through one `Song` type and one `load()` path. A provider registry in the Worker removes the hard-coded PagalNew assumptions |
| **C. Language routing** | A **policy** that sits on top of B, not an alternative to it. Language is a property of the provider (and later of the track), and the router picks providers |

**Recommended: B + C.** Build the provider registry (B) in the Worker, and route requests by language (C): `hi` → `pagalnew`, `en` → `audius`, `jamendo`, `deezer-preview`, and `all` → fan-out with a per-provider timeout.

### 6.2 Worker provider interface (proposed, in a new `worker/providers/` directory)

```js
// Each provider is a plain object; the Worker router never imports provider internals.
/** @typedef {{ id, title, artist, album, artwork, duration, language, source, source_song_id, playback: "full"|"preview"|"none", explicit?, isrc? }} NormalizedSong */
export const provider = {
  id: "audius",                         // stable, used in song ids
  name: "Audius",
  languages: ["en"],                    // routing (Option C)
  playback: "full",                     // "full" | "preview"
  allowedMediaHosts: [/\.audius\.co$/], // SSRF allow-list for /api/v2/play
  async search(q, { limit, signal }) { /* → NormalizedSong[] */ },
  async getSong(sourceSongId, { signal }) { /* → NormalizedSong */ },
  async resolvePlayback(sourceSongId, { signal }) { /* → { url, expiresAt?, contentType? } (server-side only) */ },
};
```

- **`pagalnew` provider:** a thin adapter that **calls the existing functions** (`fetch` of `search.php`, `findAudioUrl`, `parseAlbumPage`) and moves the HTML parsing that lives in `parseSearchResults` (client) into the Worker. The existing `/api/search`, `/api/song`, `/api/stream`, `/api/albums` and `/api/album` routes **stay as they are**, so the current frontend keeps working throughout the migration.
- Its `source_song_id` is the PagalNew path (for example `/songs/kesariya-arijit-singh.html`). The unified id is `pagalnew:<path>`. **Backward compatibility:** a stored `Song` without `source` is treated as `pagalnew` with `sourceSongId = song.id`, so existing favorites, playlists, downloads (IndexedDB is keyed by the old id) and share links keep resolving.

### 6.3 Frontend `Song` type change (additive)

```ts
// src/types/music.ts: all new fields optional, old data stays valid
export interface Song {
  id: string; title: string; artist: string; album?: string; imageUrl?: string | null;
  pageUrl?: string; audioUrl?: string; duration?: number;
  source?: "pagalnew" | "audius" | "jamendo" | "deezer" | string; // default "pagalnew"
  sourceSongId?: string;
  language?: "hi" | "pa" | "en" | "unknown";
  playback?: "full" | "preview";
}
```

`PlayerContext.load` changes in one line: when there is no `audioUrl`, call `resolvePlayback(song)`, which uses `/api/v2/play` for non-PagalNew songs and `getSongDetails(pageUrl)` for legacy ones. The `<audio>` element, MediaSession, sleep timer, queue and Jam stay untouched.

---

## 7. Proposed backend API specification

Base: the existing Worker. The new routes live under `/api/v2/` so the current `/api/*` stays frozen.
**Authentication:** none from the client, which matches the current Worker. Provider secrets (Jamendo `client_id`, any future keys) go in **Worker secrets** (`env.JAMENDO_CLIENT_ID`) and are never sent to the browser.
**Error shape** (adopting the newer `/api/spotify/import` convention): `{ "error": { "code": "STRING", "message": "Human text", "provider"?: "id" } }`.

### 7.1 Normalized song

```json
{
  "id": "audius:D7KyD",
  "title": "Midnight Drive",
  "artist": "Example Artist",
  "album": null,
  "artwork": "https://…/480x480.jpg",
  "duration": 214,
  "language": "en",
  "source": "audius",
  "source_song_id": "D7KyD",
  "playback_available": true,
  "playback_type": "full",
  "attribution": { "label": "Listen on Audius", "url": "https://audius.co/…" },
  "isrc": null
}
```

`playback_available` is false when a provider says the track is blocked or region-locked. `playback_type: "preview"` tells the UI to show a "30-sec preview" badge and the attribution link. **No playback URL is included in search or details responses.**

### 7.2 `GET /api/v2/search`

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string, 1–100 chars | required | Trimmed, control chars stripped |
| `lang` | `hi` \| `en` \| `all` | `all` | Language routing |
| `sources` | comma list of provider ids | per `lang` | Must be registered ids, otherwise `400` |
| `limit` | 1–50 | 20 | Per response, after merge |
| `playback` | `full` \| `any` | `any` | `full` hides preview-only results |

Example: `GET /api/v2/search?q=midnight&lang=en&limit=2`

```json
{
  "query": "midnight",
  "lang": "en",
  "results": [
    { "id": "audius:D7KyD", "title": "Midnight Drive", "artist": "Example Artist", "album": null,
      "artwork": "https://…/480x480.jpg", "duration": 214, "language": "en", "source": "audius",
      "source_song_id": "D7KyD", "playback_available": true, "playback_type": "full",
      "attribution": { "label": "Listen on Audius", "url": "https://audius.co/example/midnight-drive" } },
    { "id": "deezer:3135556", "title": "Midnight City", "artist": "M83", "album": "Hurry Up, We're Dreaming",
      "artwork": "https://…/500x500.jpg", "duration": 244, "language": "en", "source": "deezer",
      "source_song_id": "3135556", "playback_available": true, "playback_type": "preview",
      "attribution": { "label": "Full song on Deezer", "url": "https://www.deezer.com/track/3135556" } }
  ],
  "providers": [
    { "id": "audius", "status": "ok", "count": 1, "ms": 312 },
    { "id": "jamendo", "status": "ok", "count": 0, "ms": 401 },
    { "id": "deezer", "status": "ok", "count": 1, "ms": 188 }
  ],
  "partial": false
}
```

Errors:

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_QUERY` | Missing, empty or over-long `q` |
| 400 | `UNKNOWN_SOURCE` | `sources` lists an unregistered id |
| 429 | `RATE_LIMITED` | Per-IP limit exceeded (`Retry-After` header) |
| 502 | `ALL_PROVIDERS_FAILED` | Every routed provider failed. The body includes the `providers` array |

If only **some** providers fail, the response is `200` with `"partial": true` and that provider marked `"status": "timeout" | "error"`.

`GET /api/v2/search/english?q=…` can be an alias for `lang=en` if the team wants an explicit English route. It returns the same response shape.

### 7.3 `GET /api/v2/songs/{id}`

`{id}` = `source:source_song_id`, URL-encoded (for PagalNew: `pagalnew:%2Fsongs%2Fkesariya-arijit-singh.html`).

Example: `GET /api/v2/songs/audius%3AD7KyD` → `200` with a normalized song plus optional `"genre"`, `"release_date"`.

| Status | Code |
|---|---|
| 400 | `INVALID_ID` (bad format or unknown source) |
| 404 | `SONG_NOT_FOUND` |
| 502 | `PROVIDER_UNAVAILABLE` |

### 7.4 `POST /api/v2/play`: resolve authorized playback

The browser never receives a provider token. It receives a **Worker-signed, short-lived URL to the Worker's own stream route**.

Request:
```json
{ "id": "audius:D7KyD" }
```
Response `200`:
```json
{
  "id": "audius:D7KyD",
  "stream_url": "https://music-be…workers.dev/api/v2/stream/audius%3AD7KyD?exp=1764089700&sig=Jx3…",
  "expires_at": "2026-11-25T17:15:00Z",
  "playback_type": "full",
  "content_type": "audio/mpeg",
  "duration": 214
}
```
- `sig` = HMAC-SHA256(`env.STREAM_SIGNING_KEY`, `id|exp`). TTL is about 15 min. The client re-calls `/play` on expiry or on a `403`.
- `GET /api/v2/stream/{id}?exp&sig`: the Worker verifies the signature, calls `provider.resolvePlayback()` (cached in memory or KV until the upstream expiry), checks the media host against `allowedMediaHosts`, then proxies with `Range` passthrough. This mirrors `handleStream` today.
- PagalNew: `/play` simply returns the existing `/api/stream?url=…`. It can be signed later as well.
- An alternative for providers that require direct client playback (Audius asks for direct streams by app): the Worker may return a `302` to the provider URL instead of proxying. That is a per-provider config flag.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_ID` | |
| 403 | `PLAYBACK_NOT_PERMITTED` | Provider says blocked or region-locked |
| 404 | `SONG_NOT_FOUND` | |
| 410 | `STREAM_EXPIRED` | Expired or bad `sig` on `/stream`. The client should call `/play` again |
| 502 | `PROVIDER_UNAVAILABLE` | Upstream timeout or 5xx |

### 7.5 `GET /api/v2/providers`

```json
{
  "providers": [
    { "id": "pagalnew", "name": "PagalNew", "languages": ["hi", "pa"], "playback": "full", "status": "ok", "default_for": ["hi"] },
    { "id": "audius", "name": "Audius", "languages": ["en"], "playback": "full", "status": "ok", "default_for": ["en"],
      "attribution_required": true, "terms_url": "https://docs.audius.org/" },
    { "id": "jamendo", "name": "Jamendo", "languages": ["en"], "playback": "full", "status": "ok", "default_for": ["en"],
      "license": "Creative Commons (per track)" },
    { "id": "deezer", "name": "Deezer (previews)", "languages": ["en"], "playback": "preview", "status": "ok", "default_for": ["en"] }
  ]
}
```
`status` is the last health result (`ok` | `degraded` | `down`), recorded by the circuit breaker (section 9). There are no error cases apart from a `500`.

---

## 8. Frontend integration approach

| Need | Approach (reusing existing code) |
|---|---|
| Hindi / English / All filter | Add a language chip row next to the existing `FILTERS` chips in `src/pages/Search.tsx`. Store the choice in `SettingsContext` (new `searchLanguage`, default `all`) so it persists. Pass it as `lang` and include it in the React Query key `["search", query, lang]` |
| Unified results | New `searchV2(query, lang)` in `src/services/api.ts`. **Keep `searchSongs` for `lang=hi`** so the tuned PagalNew fuzzy/album logic is unchanged. For `all`, merge `searchSongs` (Hindi) with `/api/v2/search?lang=en` client-side, or move the logic server-side later |
| Source identification | Small source badge in `SongRow`/`SongCard` (`song.source`). A "Preview" badge plus link-out when `playback === "preview"`. Attribution link in `NowPlaying` |
| Duplicates | Keep the id-based dedupe (`uniqueSongs`). Add **cross-source** dedupe that reuses `matchScore`/`cleanTrackTitle` from `src/utils/match.ts` (already built for Spotify matching): same normalized title + primary artist ± 3 s duration → keep the `full` version over `preview`, and the preferred provider by language. Use ISRC when both sides have it |
| Playlists, favorites, recent, queue | No schema migration needed because the fields are optional. They work as soon as `Song` carries `source`/`sourceSongId`. Never persist `stream_url` (strip it in `musicStorage` writes, the way `toSharedSong` already strips fields) |
| Single player | Change `PlayerContext.load` (line 71) so `getSongDetails(pageUrl)` becomes `resolvePlayable(song)`, which branches on `song.source`. Add **one retry**: on the `audio` `error` event or a `410`, re-resolve once and restore `currentTime`. MediaSession, Jam and the sleep timer are untouched |
| Offline downloads | `downloadSong` (`offline.ts:58`) should only allow providers whose terms permit download (Jamendo `audiodownload_allowed`, never for previews). Gate it with `playback === "full" && provider.download_allowed` |
| Share and Jam | Add `source` and `sourceSongId` to `SharedSong` (`utils/share.ts`) and `sanitizeSong` (`server/src/songs.js`). The rule that a song needs `pageUrl \|\| audioUrl` becomes "or `source`+`sourceSongId`". Each client resolves its own playback, as today |
| Lyrics | `lyrics.ts` already works for English (LRCLIB). Skip `romanize` when `language === "en"` (it's already a no-op on Latin text) |
| Featured playlists | Add English seeds (for example "Indie English", "Chill Electronic") with a `lang: "en"` field in `src/data/featuredPlaylists.ts` |

---

## 9. Technical limitations and risks

| Risk | Mitigation |
|---|---|
| **Licensing (highest):** mainstream English hits are not legally streamable in full | Be honest in the UI: full tracks from Audius/Jamendo, 30-second previews from Deezer/iTunes with a link out. Don't add MP3.pm or similar. **Separately review PagalNew**, which carries the same risk. Note too that `/api/spotify/import` reads Spotify's embed page, which the code comment itself says is against Spotify's guidelines |
| Temporary URL expiry | Never persist playback URLs. Worker-signed 15-minute URLs. Re-resolve on `410` or a media `error`, one retry restoring position |
| Provider downtime | Per-provider timeout (search 4 s, resolve 8 s, stream 30 s as today). `Promise.allSettled` fan-out → `partial: true`. Circuit breaker in KV: after 5 failures in 60 s, skip the provider for 2 min and report `status: "down"` in `/providers` |
| Timeouts | Reuse the `AbortSignal.timeout` pattern already in the Worker |
| Metadata caching | Cloudflare cache API / `cf.cacheTtl` (already used by `fetchCachedHtml`): search for 10 min, song details for 24 h, resolved upstream URLs until their expiry minus a margin. React Query client cache as today |
| Duplicate detection | See section 8. Normalization is already in `utils/match.ts`. ISRC from Deezer/iTunes when available |
| Rate limiting | Cloudflare rate-limiting binding on `/api/v2/*` per IP (for example 60 req/min search, 120/min play). Respect upstream limits (SoundCloud 15k plays/day, YouTube 10k units/day, MusicBrainz 1 req/s) |
| **SSRF** | `/api/v2/*` **never takes a URL from the client**, only `source:id`. Each provider builds its own upstream URLs from fixed origins. Resolved media URLs are checked against `allowedMediaHosts` (https only, no IP literals or private ranges) and use `redirect: "manual"` (pattern already in `fetchSpotifyEmbed`) with a byte cap. Keep the existing hostname checks on legacy routes |
| Token exposure | No provider tokens or keys reach the client. Secrets live in Worker env. The `sig` is an HMAC with no secret material |
| Content type | Use the upstream `Content-Type` (for example, MP3.pm served `audio/aac` under `.mp3`). Store the blob type from the response in `offline.ts`, which it already does |
| Catalogue expectations | Audius and Jamendo will not have most chart songs, and users may perceive "English search is weak". Previews (Deezer) fill discovery, but they are not full playback |
| Spotify/YouTube/SoundCloud policy churn | Treat them as optional and metadata-only, and keep them out of the critical path |

---

## 10. Recommended implementation phases

| Phase | Scope | Touches existing Hindi path? |
|---|---|---|
| **0. Decisions** | Confirm product stance on previews vs full tracks. Legal review of PagalNew and the Spotify embed import. Register a Jamendo `client_id` and choose an Audius `app_name` | No |
| **1. Provider layer in the Worker** | `worker/providers/{pagalnew,audius,jamendo}.js`, registry, `/api/v2/providers`, `/api/v2/search`, `/api/v2/songs/:id`, `/api/v2/play`, `/api/v2/stream/:id` with signing, allow-lists, timeouts and caching. The `pagalnew` adapter calls the current functions. Legacy `/api/*` stays untouched | No (additive) |
| **2. Types and player** | Optional `Song` fields. `resolvePlayable` in `api.ts`. `PlayerContext.load` branch plus a single retry. `SharedSong`/`sanitizeSong` accept `source` ids. Tests next to `tests/match.test.mjs` | One-line change in `load()`. Legacy songs take the old path |
| **3. Search UI** | Language chips, `searchV2`, source/preview badges, cross-source dedupe, English featured playlists | `lang=hi` keeps calling `searchSongs` unchanged |
| **4. Previews (optional)** | `deezer` provider (`playback: "preview"`), link-outs, autoplay skips previews in the queue unless the user opts in | No |
| **5. Hardening** | Rate limiting, circuit breaker, monitoring of provider health, download gating per provider licence | No |
| **6. Later** | Migrate PagalNew search parsing from the browser to the Worker (removes `DOMParser` in `api.ts`). Consider a licensed Hindi source if the PagalNew review requires it | Yes, but only after v2 is proven |

---

## Final recommendation

**Put a single provider interface in the existing Cloudflare Worker, and route by language on top of it.** Wrap PagalNew, unchanged, as the `pagalnew` provider for Hindi. Add **Audius** and **Jamendo** as licensed full-track English providers. Optionally add **Deezer** (or iTunes) as a clearly labelled 30-second preview and metadata provider for mainstream English songs. Results come back as one normalized `Song` shape, so the existing single `<audio>` player, queue, favorites, playlists, Jam and lyrics work across languages without a second player. Playback goes through Worker-signed, short-lived stream URLs, so no provider token reaches the browser.

**Do not integrate MP3.pm.** Its playback URL works, but the site has no API or licence and disclaims the files it serves. Expect that full-length mainstream English hits cannot be offered legally without a commercial licence or the label service's own player. Apply the same licensing test to the current PagalNew source.

---

## Sources

- Repository files cited inline (`worker/worker.js`, `src/services/api.ts`, `src/context/PlayerContext.tsx`, `src/context/MusicContext.tsx`, `src/utils/{storage,library,match,share}.ts`, `src/services/{offline,lyrics}.ts`, `src/hooks/{useSearch,useArtistSongs,useFeaturedPlaylist}.ts`, `server/src/songs.js`).
- MP3.pm: `https://mp3.pm/`, `https://mp3.pm/robots.txt`, `https://mp3.pm/disclaimer/` (fetched 2026-11-25).
- [Spotify: Update on Developer Access and Platform Security (Feb 2026)](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) · [Feb 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) · [Extended access criteria (Apr 2025)](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access) · [preview_url null reports](https://community.spotify.com/t5/Spotify-for-Developers/Missing-Preview-URL-using-Client-Credentials/td-p/6492694)
- [Deezer developer guidelines](https://developers.deezer.com/guidelines) · [Deezer FAQs for developers](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)
- [Jamendo API: tracks](https://developer.jamendo.com/v3.0/tracks) · [authentication](https://developer.jamendo.com/v3.0/authentication) · [tracks/file](https://developer.jamendo.com/v3.0/tracks/file)
- [Audius REST API guide](https://docs.audius.org/developers/guides/rest-api) · [Stream track](https://docs.audius.org/developers/api/stream-track)
- [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies) · [Policies guide](https://developers.google.com/youtube/terms/developer-policies-guide) · [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use) · [Get an API key](https://developers.soundcloud.com/docs/api/register-app) · [LLM context / rate limits](https://developers.soundcloud.com/docs/llm-context)
