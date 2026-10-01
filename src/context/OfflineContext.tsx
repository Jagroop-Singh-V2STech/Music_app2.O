import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Song } from "../types/music";
import { useToast } from "../components/common/Toast";
import { downloadSong, listDownloads, removeDownload, requestPersistentStorage, type OfflineTrack } from "../services/offline";

export type DownloadStatus = "none" | "downloading" | "downloaded";
interface OfflineState {
  online: boolean; tracks: OfflineTrack[]; songs: Song[]; totalSize: number; progress: Record<string, number>;
  status(id: string): DownloadStatus; download(songs: Song[]): void; remove(ids: string[]): Promise<void>;
}

const OfflineContext = createContext<OfflineState | null>(null);
const CONCURRENCY = 2;

export function OfflineProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [online, setOnline] = useState(navigator.onLine);
  const [tracks, setTracks] = useState<OfflineTrack[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const pending = useRef<Song[]>([]);
  const active = useRef(0);
  const batch = useRef({ done: 0, failed: 0, quota: false });

  useEffect(() => { listDownloads().then(setTracks).catch(() => undefined); }, []);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  const settle = (id: string) => setProgress(({ [id]: _, ...rest }) => rest);

  // Pulls from the pending list until CONCURRENCY downloads run; reports once the whole batch is idle.
  const pump = () => {
    while (active.current < CONCURRENCY && pending.current.length) {
      const song = pending.current.shift()!;
      active.current++;
      downloadSong(song, fraction => setProgress(p => ({ ...p, [song.id]: fraction })))
        .then(track => { batch.current.done++; setTracks(items => [track, ...items.filter(t => t.id !== track.id)]); })
        .catch(error => { batch.current.failed++; if (error instanceof DOMException && error.name === "QuotaExceededError") { batch.current.quota = true; pending.current.forEach(s => settle(s.id)); pending.current = []; } })
        .finally(() => {
          active.current--; settle(song.id);
          if (!active.current && !pending.current.length) {
            const { done, failed, quota } = batch.current;
            toast(quota ? "Not enough storage space to download more songs" : failed ? `Downloaded ${done} ${done === 1 ? "song" : "songs"}, ${failed} failed` : `Downloaded ${done} ${done === 1 ? "song" : "songs"}`);
            batch.current = { done: 0, failed: 0, quota: false };
          }
          pump();
        });
    }
  };

  const status = (id: string): DownloadStatus => id in progress ? "downloading" : tracks.some(t => t.id === id) ? "downloaded" : "none";

  const download = (songs: Song[]) => {
    const fresh = songs.filter((s, i) => status(s.id) === "none" && songs.findIndex(x => x.id === s.id) === i && !pending.current.some(p => p.id === s.id));
    if (!fresh.length) return;
    if (!navigator.onLine) { toast("Connect to the internet to download"); return; }
    void requestPersistentStorage();
    setProgress(p => ({ ...p, ...Object.fromEntries(fresh.map(s => [s.id, 0])) }));
    pending.current.push(...fresh);
    toast(fresh.length === 1 ? `Downloading ${fresh[0].title}` : `Downloading ${fresh.length} songs`);
    pump();
  };

  const remove = async (ids: string[]) => {
    pending.current = pending.current.filter(s => !ids.includes(s.id));
    await Promise.all(ids.map(removeDownload));
    setTracks(items => items.filter(t => !ids.includes(t.id)));
  };

  const value: OfflineState = {
    online, tracks, progress, status, download, remove,
    songs: tracks.map(t => t.song), totalSize: tracks.reduce((sum, t) => sum + t.size, 0),
  };
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export const useOffline = () => { const context = useContext(OfflineContext); if (!context) throw new Error("OfflineProvider missing"); return context; };
