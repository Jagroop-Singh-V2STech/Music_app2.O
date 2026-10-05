import { WebSocketServer } from "ws";
import { JamError } from "./errors.js";
import { COMMANDS } from "./rooms.js";
import { originAllowed } from "./config.js";

export const CLOSE = { UNAUTHORIZED: 4401, FORBIDDEN: 4403, NOT_FOUND: 4404, GONE: 4410 };
const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const RATE = { perSecond: 15, burst: 40 };

const closeCodeFor = error => {
  if (error.status === 401) return CLOSE.UNAUTHORIZED;
  if (error.status === 404) return CLOSE.NOT_FOUND;
  if (error.status === 410) return CLOSE.GONE;
  return CLOSE.FORBIDDEN;
};

/**
 * WebSocket endpoint: /api/jam/ws
 * The first message must be { type: "HELLO", token, roomId }. The token is sent in-band rather than in the URL so it
 * never lands in proxy/access logs. After that the socket carries commands up and room snapshots down.
 */
export function attachSockets(server, { rooms, sessions, config }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const byRoom = new Map(); // roomId -> Set<ws>

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://jam.local");
    if (pathname !== "/api/jam/ws" || !originAllowed(req.headers.origin, config)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => onConnection(ws));
  });

  const send = (ws, message) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message)); };
  const broadcast = (roomId, message) => {
    const data = JSON.stringify(message);
    for (const ws of byRoom.get(roomId) ?? []) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const reject = (ws, error, requestId) => send(ws, { type: "COMMAND_REJECTED", requestId, code: error.code, message: error.message });
  const fail = (ws, error) => {
    send(ws, { type: "ERROR", code: error.code, message: error.message });
    ws.close(closeCodeFor(error), error.code);
  };

  function onConnection(ws) {
    ws.isAlive = true;
    ws.tokens = RATE.burst;
    ws.lastRefill = Date.now();
    ws.on("pong", () => { ws.isAlive = true; });
    const helloTimer = setTimeout(() => ws.close(CLOSE.UNAUTHORIZED, "HELLO_TIMEOUT"), HELLO_TIMEOUT_MS);

    ws.on("message", raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!message || typeof message !== "object") return;

      if (!ws.user) {
        if (message.type !== "HELLO") return ws.close(CLOSE.UNAUTHORIZED, "HELLO_REQUIRED");
        clearTimeout(helloTimer);
        try {
          const user = sessions.authenticate(message.token);
          const room = rooms.requireMember(message.roomId, user.id);
          ws.user = user;
          ws.roomId = room.id;
          rooms.connect(room.id, user.id); // broadcasts presence to the others before this socket joins the set
          if (!byRoom.has(room.id)) byRoom.set(room.id, new Set());
          byRoom.get(room.id).add(ws);
          send(ws, { type: "ROOM_STATE", state: rooms.snapshot(room), you: user });
        } catch (error) {
          if (error instanceof JamError) fail(ws, error); else ws.close(1011, "INTERNAL_ERROR");
        }
        return;
      }

      if (message.type === "PING") return send(ws, { type: "PONG", t0: message.t0, serverTime: Date.now() });
      if (!COMMANDS.has(message.type)) return;

      // Token bucket per socket so one client can't flood the room.
      const now = Date.now();
      ws.tokens = Math.min(RATE.burst, ws.tokens + ((now - ws.lastRefill) / 1000) * RATE.perSecond);
      ws.lastRefill = now;
      const requestId = typeof message.requestId === "string" ? message.requestId.slice(0, 64) : undefined;
      if (ws.tokens < 1) return send(ws, { type: "COMMAND_REJECTED", requestId, code: "RATE_LIMITED", message: "Slow down a little and try again." });
      ws.tokens--;

      try {
        rooms.command(ws.roomId, ws.user.id, message);
      } catch (error) {
        if (!(error instanceof JamError)) { console.error("[jam] command failed", error); return send(ws, { type: "COMMAND_REJECTED", requestId, code: "INTERNAL_ERROR", message: "That didn't work. Try again." }); }
        reject(ws, error, requestId);
        // The room may be gone or this user removed; tell the socket why and close it.
        if (["ROOM_NOT_FOUND", "ROOM_ENDED", "ROOM_EXPIRED", "NOT_A_PARTICIPANT", "REMOVED_FROM_ROOM"].includes(error.code)) fail(ws, error);
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (!ws.roomId) return;
      byRoom.get(ws.roomId)?.delete(ws);
      if (!byRoom.get(ws.roomId)?.size) byRoom.delete(ws.roomId);
      rooms.disconnect(ws.roomId, ws.user.id);
    });
  }

  rooms.on("update", (room, cause) => broadcast(room.id, { type: "ROOM_STATE_UPDATED", state: rooms.snapshot(room), cause }));
  rooms.on("ended", (roomId, reason) => {
    broadcast(roomId, { type: "ROOM_ENDED", roomId, reason });
    for (const ws of byRoom.get(roomId) ?? []) { ws.roomId = undefined; ws.close(CLOSE.GONE, reason); }
    byRoom.delete(roomId);
  });
  rooms.on("removed", (roomId, userId) => {
    for (const ws of [...(byRoom.get(roomId) ?? [])]) {
      if (ws.user.id !== userId) continue;
      byRoom.get(roomId)?.delete(ws);
      ws.roomId = undefined;
      send(ws, { type: "PARTICIPANT_REMOVED", roomId });
      ws.close(CLOSE.FORBIDDEN, "REMOVED_FROM_ROOM");
    }
  });

  // Drop sockets that stopped answering pings (closed laptop, dead network) so presence stays accurate.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return { close: () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); } };
}
