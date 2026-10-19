// Share links carry the songs themselves in the URL fragment (never sent to a server, so no URL-length limit there).
// Format: "z" + base64url(deflate-raw(JSON)) when the browser can compress, else "j" + base64url(JSON).

export interface SharedSong { id: string; title: string; artist: string; imageUrl?: string | null; pageUrl?: string }
export interface SharePayload { v: 1; kind: "song" | "playlist"; name?: string; songs: SharedSong[] }

export const MAX_SHARED_SONGS = 100;

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}
// Some browsers have CompressionStream but not "deflate-raw"; constructing one is the only reliable check.
let compressionSupport: boolean | undefined;
const canCompress = () => {
  if (compressionSupport === undefined) {
    try { new CompressionStream("deflate-raw"); new DecompressionStream("deflate-raw"); compressionSupport = true; }
    catch { compressionSupport = false; }
  }
  return compressionSupport;
};

const httpUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; } catch { return undefined; }
};
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/** Keeps only what another device needs to show and play a song (each device resolves audio itself). */
export function toSharedSong(song: SharedSong): SharedSong | undefined {
  const pageUrl = httpUrl(song.pageUrl);
  const id = text(song.id, 512), title = text(song.title, 300);
  if (!id || !title || !pageUrl) return undefined;
  return { id, title, artist: text(song.artist, 300) ?? "Unknown artist", pageUrl, ...(httpUrl(song.imageUrl) ? { imageUrl: httpUrl(song.imageUrl) } : {}) };
}

export async function encodeShare(kind: SharePayload["kind"], songs: SharedSong[], name?: string): Promise<string> {
  const shared = songs.map(toSharedSong).filter((song): song is SharedSong => Boolean(song)).slice(0, MAX_SHARED_SONGS);
  if (!shared.length) throw new Error("None of these songs can be shared.");
  const payload: SharePayload = { v: 1, kind, ...(name ? { name: name.slice(0, 100) } : {}), songs: shared };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return canCompress() ? `z${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}` : `j${toBase64Url(json)}`;
}

/** Returns undefined for anything malformed, so a mangled link shows a friendly message instead of crashing. */
export async function decodeShare(data: string): Promise<SharePayload | undefined> {
  try {
    const kind = data[0];
    let bytes = fromBase64Url(data.slice(1));
    if (kind === "z") { if (!canCompress()) return undefined; bytes = await pipe(bytes, new DecompressionStream("deflate-raw")); }
    else if (kind !== "j") return undefined;
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload>;
    if (raw.v !== 1 || (raw.kind !== "song" && raw.kind !== "playlist") || !Array.isArray(raw.songs)) return undefined;
    const songs = raw.songs.slice(0, MAX_SHARED_SONGS).map(song => toSharedSong(song as SharedSong)).filter((song): song is SharedSong => Boolean(song));
    if (!songs.length) return undefined;
    return { v: 1, kind: raw.kind, name: text(raw.name, 100), songs };
  } catch {
    return undefined;
  }
}

export const shareUrl = (data: string) => `${window.location.origin}/share#${data}`;
