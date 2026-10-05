import http from "node:http";
import { JamError, errors } from "./errors.js";
import { RoomStore } from "./rooms.js";
import { SessionStore } from "./sessions.js";
import { attachSockets } from "./socket.js";
import { originAllowed } from "./config.js";

const MAX_BODY_BYTES = 256 * 1024;
const FAILED_JOINS_PER_MINUTE = 20;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(errors.badRequest("Request body is too large.")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(body && typeof body === "object" && !Array.isArray(body) ? body : {});
      } catch { reject(errors.badRequest("Request body must be valid JSON.")); }
    });
    req.on("error", reject);
  });
}

export function createJamServer(config, { now = Date.now } = {}) {
  const sessions = new SessionStore(config, now);
  const rooms = new RoomStore(config, { now });
  const failedJoins = new Map(); // ip -> { count, resetAt }: slows down guessing room codes

  const send = (res, status, body, origin) => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (origin && originAllowed(origin, config)) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin" });
    res.writeHead(status, headers);
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const guardJoinAttempts = ip => {
    const entry = failedJoins.get(ip);
    if (entry && entry.resetAt > now() && entry.count >= FAILED_JOINS_PER_MINUTE) throw errors.rateLimited();
  };
  const recordFailedJoin = ip => {
    const entry = failedJoins.get(ip);
    if (!entry || entry.resetAt <= now()) failedJoins.set(ip, { count: 1, resetAt: now() + 60_000 });
    else entry.count++;
  };

  async function route(req, res) {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", "http://jam.local");
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api", "jam", ...]

    if (origin && !originAllowed(origin, config)) return send(res, 403, { error: { code: "FORBIDDEN_ORIGIN", message: "This origin is not allowed." } });
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" });
      return res.end();
    }
    if (parts[0] !== "api" || parts[1] !== "jam") return send(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } }, origin);

    const [, , resource, roomId, action, targetId] = parts;
    const method = req.method;
    const ok = (status, body) => send(res, status, body, origin);
    const user = () => sessions.fromHeader(req.headers.authorization);

    if (resource === "health" && method === "GET" && !roomId) return ok(200, { ok: true, rooms: rooms.rooms.size });

    if (resource === "session" && method === "POST" && !roomId) {
      const body = await readJson(req);
      return ok(201, sessions.create(body.name));
    }

    if (resource !== "rooms") return ok(404, { error: { code: "NOT_FOUND", message: "Not found." } });

    if (!roomId && method === "POST") {
      const me = user();
      const body = await readJson(req);
      const room = rooms.createRoom(me, body);
      return ok(201, rooms.snapshot(room));
    }
    if (!roomId) return ok(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });

    if (!action && method === "GET") return ok(200, rooms.snapshot(rooms.requireMember(roomId, user().id)));

    if (action === "join" && method === "POST" && !targetId) {
      const me = user();
      const ip = req.socket.remoteAddress ?? "unknown";
      guardJoinAttempts(ip);
      try {
        return ok(200, rooms.snapshot(rooms.join(roomId, me)));
      } catch (error) {
        if (error instanceof JamError && error.code === "ROOM_NOT_FOUND") recordFailedJoin(ip);
        throw error;
      }
    }
    if (action === "leave" && method === "POST" && !targetId) { rooms.leave(roomId, user().id); return ok(204); }
    if (action === "end" && method === "POST" && !targetId) { rooms.end(roomId, user().id); return ok(204); }
    if (action === "participants" && method === "DELETE" && targetId) { rooms.kick(roomId, user().id, decodeURIComponent(targetId)); return ok(204); }
    if (action === "host" && method === "POST" && !targetId) {
      const me = user();
      const body = await readJson(req);
      if (typeof body.userId !== "string") throw errors.badRequest("userId is required.");
      return ok(200, rooms.snapshot(rooms.transferHost(roomId, me.id, body.userId)));
    }
    return ok(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch(error => {
      if (res.headersSent) return res.end();
      if (error instanceof JamError) return send(res, error.status, { error: { code: error.code, message: error.message } }, req.headers.origin);
      console.error("[jam] unexpected error", error);
      send(res, 500, { error: { code: "INTERNAL_ERROR", message: "Something went wrong on the Jam server." } }, req.headers.origin);
    });
  });

  const sockets = attachSockets(server, { rooms, sessions, config });
  const sweeper = setInterval(() => {
    rooms.sweep();
    sessions.sweep();
    for (const [ip, entry] of failedJoins) if (entry.resetAt <= now()) failedJoins.delete(ip);
  }, config.sweepIntervalMs);
  sweeper.unref();

  return {
    server,
    rooms,
    sessions,
    close: () => new Promise(resolve => {
      clearInterval(sweeper);
      sockets.close();
      server.close(() => resolve());
      // Drop keep-alive connections too, so a stopping instance can't keep answering with state that's about to vanish.
      server.closeAllConnections?.();
    })
  };
}
