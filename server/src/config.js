const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function loadConfig(env = process.env) {
  return {
    port: positiveInt(env.PORT, 8787),
    // Comma-separated browser origins allowed to call the API; "*" allows any.
    allowedOrigins: (env.JAM_ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4173").split(",").map(origin => origin.trim()).filter(Boolean),
    maxParticipants: positiveInt(env.JAM_MAX_PARTICIPANTS, 20),
    // A room with nobody connected for this long expires.
    roomIdleTtlMs: positiveInt(env.JAM_ROOM_IDLE_TTL_MS, 30 * 60_000),
    // A participant who stays disconnected this long is removed (and loses host) while others are still listening.
    participantGraceMs: positiveInt(env.JAM_PARTICIPANT_GRACE_MS, 2 * 60_000),
    maxQueue: positiveInt(env.JAM_MAX_QUEUE, 200),
    sessionTtlMs: 7 * 24 * 60 * 60_000,
    endedRoomTtlMs: 24 * 60 * 60_000,
    // Song changes start slightly in the future so every client can buffer before playback begins.
    songStartDelayMs: 800,
    sweepIntervalMs: 5_000
  };
}

// Requests without an Origin header (curl, server-to-server) aren't browser cross-origin requests, so they pass.
export const originAllowed = (origin, config) => !origin || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
