# Jam: collaborative listening

Several people join one room and listen together. **Everyone controls the music**: play, pause, seek, skip, change songs, and add, remove or reorder the shared queue. The host only manages the room: ending it, removing people and handing over host.

Audio is never relayed. Each browser plays the song itself through the existing player. The Jam server holds the authoritative **playback state** and broadcasts it, and each client keeps its local audio in step with that state.

```
            Jam server (server/)  ── authoritative room state, versioned
                 │  REST: room lifecycle     WebSocket: commands up, snapshots down
     ┌───────────┼───────────┐
   Alice        Bob        Carol      ← each runs the existing PlayerContext audio element
```

## Running it

```bash
npm install            # app (no new app dependencies)
npm run server:install # server: installs `ws`
npm run server         # Jam server on :8787
npm run dev            # Vite on :5173; the app calls http://localhost:8787 directly (.env.local)
npm test               # client sync tests + server unit/integration tests
```

The Jam server URL comes from `VITE_JAM_SERVER_URL`, which Vite bakes in at build time:

| File | Used by | Value |
|---|---|---|
| `.env.local` | `npm run dev` | `http://localhost:8787` |
| `.env.production` | `npm run build`, `vite preview`, Vercel | `https://jam-ahm1.onrender.com` |

The app derives `${VITE_JAM_SERVER_URL}/api/jam` for HTTP and swaps `https://`→`wss://` (`http://`→`ws://`) for `/api/jam/ws`. For production that gives `https://jam-ahm1.onrender.com/api/jam` and `wss://jam-ahm1.onrender.com/api/jam/ws`. The Vite `/api/jam` proxy is only a fallback for when the variable is unset. A variable set in the Vercel dashboard overrides `.env.production`. On the server, set `JAM_ALLOWED_ORIGINS` to the app's origins (e.g. `https://music-app2-o.vercel.app,http://localhost:5173`). The server root `/` returning `NOT_FOUND` is expected, since it only serves `/api/jam/*`. `vercel.json` rewrites every path to `index.html`, so invite links like `/jam/JAM-4821AB` open the app.

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | `8787` | HTTP/WebSocket port |
| `JAM_ALLOWED_ORIGINS` | server | `http://localhost:5173,http://localhost:4173` | Comma-separated browser origins allowed to use the API (`*` = any) |
| `JAM_MAX_PARTICIPANTS` | server | `20` | Room capacity |
| `JAM_MAX_QUEUE` | server | `200` | Maximum songs in a shared queue |
| `JAM_ROOM_IDLE_TTL_MS` | server | `1800000` (30 min) | A room nobody is connected to expires after this |
| `JAM_PARTICIPANT_GRACE_MS` | server | `120000` (2 min) | A disconnected participant is removed after this, while others are still listening |
| `JAM_SERVER_PROXY` | Vite (dev/preview) | `http://localhost:8787` | Proxy target, used only when `VITE_JAM_SERVER_URL` is unset |
| `VITE_JAM_SERVER_URL` | app build | `.env.local`: `http://localhost:8787` · `.env.production`: `https://jam-ahm1.onrender.com` | Jam server base URL (HTTP + derived WS) |

## Identity

The app had no authentication, so the Jam server issues a **guest session**. `POST /api/jam/session` with a display name returns an opaque bearer token, and the server maps that token to a user id. Every other call identifies the user by token only, so a client can't claim another user's id. Sessions are in memory and expire after 7 days unused. To switch to real auth later, replace `SessionStore.authenticate()` in `server/src/sessions.js`; nothing else depends on how tokens map to users.

## REST API

Base path: `/api/jam`. All bodies are JSON. Every endpoint except `POST /session` and `GET /health` needs:

```
Authorization: Bearer <token>
Content-Type: application/json
```

Errors always look like this:

```json
{ "error": { "code": "ROOM_NOT_FOUND", "message": "That Jam doesn't exist. Check the code and try again." } }
```

| Status | Codes |
|---|---|
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` (missing, unknown or expired token) |
| 403 | `NOT_A_PARTICIPANT`, `REMOVED_FROM_ROOM`, `NOT_HOST`, `FORBIDDEN_ORIGIN` |
| 404 | `ROOM_NOT_FOUND`, `NOT_FOUND` |
| 409 | `ROOM_FULL` |
| 410 | `ROOM_ENDED`, `ROOM_EXPIRED` (kept for 24 h after a room closes) |
| 422 | `INVALID_SONG` |
| 429 | `RATE_LIMITED` (more than 20 joins to unknown rooms per minute per IP) |
| 500 | `INTERNAL_ERROR` |

### Room snapshot (`RoomState`)

Returned by the room endpoints and pushed over the socket.

```json
{
  "roomId": "JAM-4821AB",
  "name": "Jagroop's Jam",
  "hostId": "u_h2Q9...",
  "status": "active",
  "createdAt": 1791178200000,
  "maxParticipants": 20,
  "participants": [{ "id": "u_h2Q9...", "name": "Jagroop", "online": true, "joinedAt": 1791178200000 }],
  "currentItem": { "itemId": "i3k2", "song": { "id": "/songs/x.html", "title": "Blinding Lights", "artist": "The Weeknd", "pageUrl": "https://…", "imageUrl": "https://…" }, "addedBy": "u_h2Q9..." },
  "isPlaying": true,
  "position": 84.52,
  "positionUpdatedAt": 1791178235000,
  "queue": [{ "itemId": "i3k3", "song": { "…": "…" }, "addedBy": "u_7fK1..." }],
  "canGoBack": true,
  "version": 26,
  "playbackVersion": 25,
  "serverTime": 1791178235120
}
```

- `song` uses the app's existing `Song` model (`src/types/music.ts`). The server checks it: `id` and `title` are required, URLs must be http(s), and it must have a `pageUrl` or `audioUrl`.
- `position` is in seconds at `positionUpdatedAt` (ms, server clock). Right after a song change, `positionUpdatedAt` is about 800 ms in the future so every client can buffer before playback starts.
- `version` goes up on **every** change. `playbackVersion` is the version of the last playback change and is used for conflict checks.

---

### `POST /api/jam/session`: create a guest identity
- **Auth:** none
- **Body:** `{ "name": "Jagroop" }` (1–32 characters after trimming)
- **201:** `{ "token": "q8V…", "user": { "id": "u_h2Q9…", "name": "Jagroop" } }`
- **Errors:** 400 `BAD_REQUEST` (missing or empty name)

### `POST /api/jam/rooms`: start a Jam
The caller becomes the host. The optional seed lets the host bring along what's already playing.
- **Body (all optional):**
  ```json
  { "name": "Friday Night Jam", "song": { /* Song */ }, "position": 42.1, "isPlaying": true, "queue": [ /* Song[] */ ] }
  ```
- **201:** `RoomState`
- **Errors:** 401 `UNAUTHORIZED`; 422 `INVALID_SONG` (the seed song can't be shared). Seed queue songs that can't be shared are skipped.

### `GET /api/jam/rooms/{roomId}`: current room state
- **200:** `RoomState`
- **Errors:** 401; 403 `NOT_A_PARTICIPANT` / `REMOVED_FROM_ROOM`; 404 `ROOM_NOT_FOUND`; 410 `ROOM_ENDED` / `ROOM_EXPIRED`

### `POST /api/jam/rooms/{roomId}/join`: join a Jam
Idempotent: joining again just returns the state. `roomId` is case-insensitive and the `JAM-` prefix is optional.
- **Body:** none
- **200:** `RoomState`
- **Errors:** 401; 403 `REMOVED_FROM_ROOM`; 404 `ROOM_NOT_FOUND`; 409 `ROOM_FULL`; 410 `ROOM_ENDED` / `ROOM_EXPIRED`; 429 `RATE_LIMITED`

### `POST /api/jam/rooms/{roomId}/leave`: leave a Jam
If the host leaves, host passes to the participant who has been there longest, preferring people who are online. If the last person leaves, the room ends.
- **204:** no body
- **Errors:** 401; 403 `NOT_A_PARTICIPANT`; 404; 410

### `POST /api/jam/rooms/{roomId}/end`: end the Jam for everyone (host only)
- **204:** no body. Every socket receives `ROOM_ENDED`, then closes with 4410.
- **Errors:** 401; 403 `NOT_HOST` / `NOT_A_PARTICIPANT`; 404; 410

### `DELETE /api/jam/rooms/{roomId}/participants/{userId}`: remove someone (host only)
The removed user's sockets receive `PARTICIPANT_REMOVED` and close with 4403. They can't rejoin this room.
- **204:** no body
- **Errors:** 400 `BAD_REQUEST` (removing yourself); 401; 403 `NOT_HOST` / `NOT_A_PARTICIPANT`; 404; 410

### `POST /api/jam/rooms/{roomId}/host`: transfer host (host only)
- **Body:** `{ "userId": "u_7fK1…" }`
- **200:** `RoomState`
- **Errors:** 400 (missing `userId`); 401; 403 `NOT_HOST` / `NOT_A_PARTICIPANT` (target isn't in the room); 404; 410

### `GET /api/jam/health`
- **200:** `{ "ok": true, "rooms": 3 }`

## WebSocket: `/api/jam/ws`

One socket per open room. The first message must be `HELLO`, within 5 s. The token goes in the message rather than the URL so it never appears in access logs. Messages are JSON, with at most 64 KB per frame and 15 commands/s per socket (burst 40). The server pings every 15 s and drops sockets that stop answering.

### Client → server

Every command carries `baseVersion` (the `version` of the latest snapshot the client has) and an optional `requestId`, which the server echoes back in `cause.requestId` or in `COMMAND_REJECTED`.

| Event | Payload | When | Server behavior |
|---|---|---|---|
| `HELLO` | `{ token, roomId }` | Right after connecting, and on every reconnect | Authenticates, checks membership, marks the user online (broadcasts `PARTICIPANT_ONLINE`), replies `ROOM_STATE`. On failure: `ERROR` and close (4401 / 4403 / 4404 / 4410). |
| `PING` | `{ t0 }` | Clock sync: three quick pings after joining, then every 20 s | Replies `PONG { t0, serverTime }` |
| `PLAY` | `{ position? }` | Someone presses play | Resumes from `position`, or from the server's current position if omitted |
| `PAUSE` | `{ position }` | Someone presses pause; `position` is what they heard | Pauses at `position` |
| `SEEK` | `{ position }` | Someone scrubs (sent 200 ms after they stop dragging) | Moves to `position` and keeps the play/pause state |
| `NEXT` | `{ fromItemId, auto? }` | Skip forward. `auto: true` means a client's song ended. | Plays the head of the queue, or pauses at 0 if the queue is empty |
| `PREVIOUS` | `{ fromItemId }` | Skip back | Past 3 s: restarts the song. Otherwise returns to the previous song and puts the current one back at the front of the queue. |
| `SONG_CHANGED` | `{ itemId }` or `{ song }` | Pick a song from the queue, or play any song now (e.g. from search) | Makes it current and starts playback about 800 ms later |
| `QUEUE_ITEM_ADDED` | `{ songs: Song[] (1–100), playNext? }` | Add to queue / play next. Several adds in one tick are batched into one message. | Appends, or inserts at the front with `playNext`. If nothing is playing, the first song starts. |
| `QUEUE_ITEM_REMOVED` | `{ itemId }` | Remove from queue | Removes the item |
| `QUEUE_REORDERED` | `{ itemId, afterItemId \| null }` | Drag to reorder (`null` = move to top) | Moves the item after `afterItemId` |
| `QUEUE_CLEARED` | `{}` | Clear queue | Empties the queue |

### Server → client

| Event | Payload | When fired | Client behavior |
|---|---|---|---|
| `ROOM_STATE` | `{ state: RoomState, you: { id, name } }` | Reply to `HELLO` (every connect and reconnect) | Replaces local room state completely (no reliance on missed events) and resyncs the player |
| `ROOM_STATE_UPDATED` | `{ state: RoomState, cause }` | After **every** change: any command above, plus `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT` (with `newHostId` / `newHostName` if host moved), `PARTICIPANT_REMOVED`, `PARTICIPANT_ONLINE`, `PARTICIPANT_OFFLINE`, `HOST_CHANGED` (`newHostId`) | Ignored if `state.version` isn't newer than local. Otherwise applies it, reconciles the player, shows join/leave/host toasts and the activity line. |
| `COMMAND_REJECTED` | `{ requestId?, code, message }` | A command failed validation: `STALE_COMMAND`, `ITEM_NOT_FOUND`, `INVALID_SONG`, `QUEUE_FULL`, `NO_CURRENT_SONG`, `BAD_REQUEST`, `RATE_LIMITED` | Undoes any optimistic local change by re-applying the room state. Shows a toast, except for automatic song-end skips. |
| `PONG` | `{ t0, serverTime }` | Reply to `PING` | Updates the clock offset estimate |
| `ROOM_ENDED` | `{ roomId, reason: "HOST_ENDED" \| "EXPIRED" \| "EMPTY" }` | Host ended it, it expired, or the last person left. The socket then closes with 4410. | Leaves the room UI and shows "This Jam has ended". Local audio keeps playing. |
| `PARTICIPANT_REMOVED` | `{ roomId }` | Sent only to the removed user, then the socket closes with 4403 | Leaves the room and shows a notice |
| `ERROR` | `{ code, message }` | `HELLO` failed, just before closing | Handled through the close code |

`cause` = `{ type, userId, name, requestId?, title?, count?, position?, auto?, restarted?, newHostId?, newHostName?, reason? }`.

**Close codes:** `4401` bad or expired session · `4403` not a participant or removed · `4404` room not found · `4410` room ended or expired. On 4401, or on 4403 with reason `NOT_A_PARTICIPANT` (removed after being away too long), the client tries to rejoin once over REST before giving up. Any other close triggers automatic reconnection with backoff (0.5 s → 10 s with jitter, plus an immediate retry when the browser comes back online).

## Concurrency rules

The server applies commands in the order they arrive and decides what wins. Client clocks never decide.

1. **Playback (`PLAY`/`PAUSE`/`SEEK`)** is rejected as `STALE_COMMAND` when `baseVersion < playbackVersion` *and* another user made that newer playback change. You can't override a change you hadn't seen yet. Your own rapid commands, such as scrubbing, never conflict with each other. Queue and presence changes don't make playback commands stale.
2. **`NEXT`/`PREVIOUS`** apply only while `fromItemId` is still the current item. Two people skipping at once, or every client reporting that the song ended, advance exactly once.
3. **Queue edits** refer to stable `itemId`s and `afterItemId`, never to indexes, so concurrent adds, removes and moves combine. Acting on an item someone already removed gives a harmless `ITEM_NOT_FOUND`.
4. Clients drop any snapshot whose `version` isn't newer than the one they have.

## Playback synchronization

- **Clock offset:** NTP-style. Each `PING`/`PONG` gives `offset = serverTime − (t0 + t1)/2`, and the client keeps the sample with the lowest round-trip time out of the last 8.
- **Expected position:** `position + (serverNow − positionUpdatedAt) / 1000`. If a client gets "playing from 100 s" 500 ms late, it starts at 100.5 s. A negative value means a song is scheduled to start, so the client holds at 0 and starts on time.
- **Drift correction** (checked every 1 s, `src/utils/jamSync.ts`):
  - |drift| ≤ 250 ms: do nothing.
  - 250 ms – 1 s: play at 1.05× or 0.95× with pitch preserved until within 50 ms, then return to 1×. This is inaudible and never skips.
  - ≥ 1 s: one seek, followed by a 2 s cooldown while it buffers.
- **Optimistic UI:** pause, play and seek apply locally right away. The server's answer confirms them, and a rejection rolls them back.
- **Autoplay:** if the browser blocks audio, for example after a page refresh, a "Tap to listen" prompt appears in the header and in the room.

## Limitations

- **In-memory state.** Rooms and sessions are lost when the server restarts, and the server can't be scaled horizontally as-is. Clients that were in a room see "Jam not found". Moving `RoomStore`/`SessionStore` into Redis or a database (or a Cloudflare Durable Object next to the existing Worker) is the next step for production.
- **Guest identity**, not real accounts (there were none to reuse).
- **Song availability depends on each listener.** Every client resolves audio from `pageUrl` through the existing song API. If it fails for one person, they get a notice and everyone else keeps listening. Songs that exist only as local downloads can't be shared.
- **Full snapshots** are broadcast on every change. That's fine at the current limits (20 people, 200 songs). Use deltas if those limits grow a lot.
- Shuffle and repeat are turned off inside a Jam. The shared queue order is what everyone hears.
