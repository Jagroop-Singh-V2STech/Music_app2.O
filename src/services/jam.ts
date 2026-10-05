import type { Song } from "../types/music";
import type { JamRoomState, JamUser } from "../types/jam";

// VITE_JAM_SERVER_URL: http://localhost:8787 in development (.env.local), the Render URL in production (.env.production).
// If unset, requests go to this origin's /api/jam (the Vite dev proxy).
const base = ((import.meta.env.VITE_JAM_SERVER_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");
const SESSION_KEY = "music_jam_session";
const NAME_KEY = "music_jam_name";
// Render's free tier sleeps when idle and can take ~30–60s to wake, so allow for that before giving up.
const REQUEST_TIMEOUT_MS = 70_000;

export const jamApiBase = `${base}/api/jam`;
/** https:// → wss://, http:// → ws:// (from VITE_JAM_SERVER_URL, or this page's origin). */
export const jamSocketUrl = () => {
  const origin = new URL(base || window.location.origin);
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  return `${origin.origin}/api/jam/ws`;
};
export const jamInviteUrl = (roomId: string) => `${window.location.origin}/jam/${roomId}`;

/** Accepts "JAM-AB12CD", "jam-ab12cd" or just "AB12CD". */
export function normalizeRoomCode(input: string) {
  const code = input.trim().toUpperCase().replace(/^.*\/JAM\//, "").replace(/^JAM-?/, "");
  return /^[A-Z0-9]{4,12}$/.test(code) ? `JAM-${code}` : undefined;
}

export class JamApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); }
}

const friendly: Record<string, string> = {
  NETWORK_ERROR: "Can't reach the Jam server. Check your connection and try again.",
  TIMEOUT: "The Jam server is taking too long to respond. It may be waking up — try again in a moment.",
  SERVER_UNAVAILABLE: "The Jam server is starting up or temporarily unavailable. Try again in a moment.",
  INTERNAL_ERROR: "Something went wrong on the Jam server. Try again.",
  ROOM_NOT_FOUND: "That Jam doesn't exist. Check the code and try again.",
  ROOM_ENDED: "This Jam has ended.",
  ROOM_EXPIRED: "This Jam expired after everyone left.",
  ROOM_FULL: "This Jam is full.",
  UNAUTHORIZED: "Your Jam session expired. Join again to continue.",
  NOT_A_PARTICIPANT: "You're not part of this Jam anymore.",
  REMOVED_FROM_ROOM: "The host removed you from this Jam."
};
export const jamErrorMessage = (code: string, fallback?: string) => friendly[code] ?? fallback ?? "Something went wrong with the Jam.";

interface Session { token: string; user: JamUser }
const readSession = (): Session | undefined => { try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) as Session : undefined; } catch { return undefined; } };
const writeSession = (session?: Session) => { try { if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ } };

export const jamSession = {
  get: readSession,
  savedName: () => { try { return localStorage.getItem(NAME_KEY) ?? readSession()?.user.name ?? ""; } catch { return ""; } },
  clear: () => writeSession(undefined)
};

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(`${jamApiBase}${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: controller.signal
    });
  } catch {
    const code = controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR";
    throw new JamApiError(code, jamErrorMessage(code));
  } finally {
    window.clearTimeout(timer);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => undefined) as { error?: { code: string; message: string } } | undefined;
  if (!response.ok) {
    // Render answers 502/503/504 with an HTML page while the service is deploying or waking up.
    const code = payload?.error?.code ?? ([502, 503, 504].includes(response.status) ? "SERVER_UNAVAILABLE" : response.status >= 500 ? "INTERNAL_ERROR" : "NETWORK_ERROR");
    throw new JamApiError(code, jamErrorMessage(code, payload?.error?.message), response.status);
  }
  return payload as T;
}

/**
 * Returns a server-issued guest session, creating one when there's none or the display name changed.
 * The server derives the user id from the token, so a client can't act as someone else.
 */
export async function ensureJamSession(name?: string): Promise<Session> {
  const wanted = name?.trim();
  const existing = readSession();
  if (existing && (!wanted || wanted === existing.user.name)) return existing;
  const displayName = wanted || existing?.user.name;
  if (!displayName) throw new JamApiError("NAME_REQUIRED", "Enter your name to start or join a Jam.");
  const session = await call<Session>("/session", { method: "POST", body: { name: displayName } });
  writeSession(session);
  try { localStorage.setItem(NAME_KEY, session.user.name); } catch { /* storage unavailable */ }
  return session;
}

/** Calls an authenticated endpoint; if the server forgot the session (e.g. it restarted), makes a new one and retries once. */
async function authed<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = await ensureJamSession();
  try {
    return await call<T>(path, { ...init, token: session.token });
  } catch (error) {
    if (!(error instanceof JamApiError) || error.code !== "UNAUTHORIZED") throw error;
    writeSession(undefined);
    const fresh = await ensureJamSession(session.user.name);
    return call<T>(path, { ...init, token: fresh.token });
  }
}

export interface CreateJamSeed { song?: Song; position?: number; isPlaying?: boolean; queue?: Song[] }

/** Fire-and-forget ping so a sleeping Render instance starts waking while the user types their name. */
export const warmUpJamServer = () => { void fetch(`${jamApiBase}/health`, { cache: "no-store" }).catch(() => undefined); };

export const jamApi = {
  createRoom: (seed: CreateJamSeed) => authed<JamRoomState>("/rooms", { method: "POST", body: seed }),
  getRoom: (roomId: string) => authed<JamRoomState>(`/rooms/${roomId}`),
  joinRoom: (roomId: string) => authed<JamRoomState>(`/rooms/${roomId}/join`, { method: "POST" }),
  leaveRoom: (roomId: string) => authed<void>(`/rooms/${roomId}/leave`, { method: "POST" }),
  endRoom: (roomId: string) => authed<void>(`/rooms/${roomId}/end`, { method: "POST" }),
  removeParticipant: (roomId: string, userId: string) => authed<void>(`/rooms/${roomId}/participants/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  transferHost: (roomId: string, userId: string) => authed<JamRoomState>(`/rooms/${roomId}/host`, { method: "POST", body: { userId } })
};
