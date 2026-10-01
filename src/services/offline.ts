import type { Song } from "../types/music";
import { getSongDetails } from "./api";
import { fetchLyricsCandidates, type LyricsCandidate } from "./lyrics";

// Downloaded audio lives in IndexedDB: "tracks" holds metadata (cheap to list), "audio" holds the blobs.
export interface OfflineTrack { id: string; song: Song; size: number; savedAt: string; lyrics?: LyricsCandidate[] }

const DB_NAME = "mymusic-offline";
export const IMAGE_CACHE = "mymusic-images"; // shared with public/sw.js
let dbPromise: Promise<IDBDatabase> | undefined;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("tracks", { keyPath: "id" }); request.result.createObjectStore("audio"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = undefined; reject(request.error); };
  });
  return dbPromise;
}

async function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    tx.oncomplete = () => resolve(request?.result as T);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// Mirror of what's downloaded, so the player can check synchronously (e.g. when skipping while offline).
const downloadedIds = new Set<string>();
export const isDownloaded = (id: string) => downloadedIds.has(id);

export async function listDownloads() {
  const tracks = await run<OfflineTrack[]>(["tracks"], "readonly", tx => tx.objectStore("tracks").getAll());
  downloadedIds.clear();
  tracks.forEach(t => downloadedIds.add(t.id));
  return tracks.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export const getTrack = (id: string) => run<OfflineTrack | undefined>(["tracks"], "readonly", tx => tx.objectStore("tracks").get(id)).catch(() => undefined);

export const getAudio = (id: string) => run<Blob | undefined>(["audio"], "readonly", tx => tx.objectStore("audio").get(id)).catch(() => undefined);

export async function removeDownload(id: string) {
  await run(["tracks", "audio"], "readwrite", tx => { tx.objectStore("tracks").delete(id); tx.objectStore("audio").delete(id); });
  downloadedIds.delete(id);
}

// Artwork hosts don't send CORS headers, so store an opaque copy the service worker can serve to <img>.
async function cacheArtwork(url?: string | null) {
  if (!url || !("caches" in window)) return;
  try { const cache = await caches.open(IMAGE_CACHE); if (!(await cache.match(url))) await cache.put(url, await fetch(url, { mode: "no-cors" })); } catch { /* artwork is optional */ }
}

export async function downloadSong(song: Song, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<OfflineTrack> {
  const audioUrl = song.audioUrl || (song.pageUrl ? (await getSongDetails(song.pageUrl)).audioUrl : undefined);
  if (!audioUrl) throw new Error("No downloadable audio was found");
  const response = await fetch(audioUrl, { signal });
  if (!response.ok || !response.body) throw new Error("Download failed");

  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    if (total) onProgress(received / total);
  }
  const blob = new Blob(chunks, { type: response.headers.get("content-type") || "audio/mpeg" });
  // Lyrics are saved with the track so they show offline too; a lookup failure shouldn't fail the download.
  const lyrics = await fetchLyricsCandidates(song).catch(() => undefined);
  const track: OfflineTrack = { id: song.id, song: { ...song, audioUrl }, size: blob.size, savedAt: new Date().toISOString(), lyrics };
  await run(["tracks", "audio"], "readwrite", tx => { tx.objectStore("tracks").put(track); tx.objectStore("audio").put(blob, song.id); });
  downloadedIds.add(song.id);
  void cacheArtwork(song.imageUrl);
  return track;
}

// Ask the browser not to evict downloads under storage pressure (best effort).
export const requestPersistentStorage = () => navigator.storage?.persist?.().catch(() => false);
