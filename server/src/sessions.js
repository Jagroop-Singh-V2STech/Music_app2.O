import { randomBytes } from "node:crypto";
import { errors } from "./errors.js";
import { sanitizeName } from "./songs.js";

// Guest identity: the server issues an opaque bearer token and derives the user id from it, so clients can't claim another user's id.
// Replace this with the app's real auth when one exists; nothing else depends on how a token maps to a user.
export class SessionStore {
  constructor(config, now = Date.now) {
    this.config = config;
    this.now = now;
    this.sessions = new Map();
  }

  create(rawName) {
    const name = sanitizeName(rawName);
    const token = randomBytes(32).toString("base64url");
    const user = { id: `u_${randomBytes(9).toString("base64url")}`, name };
    this.sessions.set(token, { user, lastSeen: this.now() });
    return { token, user };
  }

  authenticate(token) {
    const session = typeof token === "string" ? this.sessions.get(token) : undefined;
    if (!session) throw errors.unauthorized();
    session.lastSeen = this.now();
    return session.user;
  }

  fromHeader(header) {
    const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
    return this.authenticate(match?.[1]);
  }

  sweep() {
    const cutoff = this.now() - this.config.sessionTtlMs;
    for (const [token, session] of this.sessions) if (session.lastSeen < cutoff) this.sessions.delete(token);
  }
}
