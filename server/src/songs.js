import { errors } from "./errors.js";

const text = (value, max, required = false) => {
  if (value == null || value === "") { if (required) throw errors.invalidSong(); return undefined; }
  if (typeof value !== "string") throw errors.invalidSong();
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!trimmed && required) throw errors.invalidSong();
  return trimmed.slice(0, max) || undefined;
};

const url = value => {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 2048) throw errors.invalidSong();
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    return parsed.href;
  } catch { throw errors.invalidSong(); }
};

// Mirrors the client's Song model (src/types/music.ts). Each client resolves audio itself, so a song only needs a pageUrl or audioUrl.
export function sanitizeSong(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw errors.invalidSong();
  const song = {
    id: text(input.id, 512, true),
    title: text(input.title, 300, true),
    artist: text(input.artist, 300) ?? "Unknown artist",
    album: text(input.album, 300),
    imageUrl: url(input.imageUrl) ?? null,
    pageUrl: url(input.pageUrl),
    audioUrl: url(input.audioUrl),
    duration: typeof input.duration === "number" && Number.isFinite(input.duration) && input.duration > 0 ? Math.min(input.duration, 86_400) : undefined
  };
  if (!song.pageUrl && !song.audioUrl) throw errors.invalidSong("This song is only on your device, so it can't be shared in a Jam.");
  return Object.fromEntries(Object.entries(song).filter(([, value]) => value !== undefined));
}

export function sanitizeName(input) {
  if (typeof input !== "string") throw errors.badRequest("Enter a display name.");
  const name = input.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);
  if (!name) throw errors.badRequest("Enter a display name.");
  return name;
}
