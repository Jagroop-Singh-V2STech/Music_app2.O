import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Song } from "../types/music";
import { getSongDetails } from "../services/api";
import { getAudio, isDownloaded } from "../services/offline";
import { musicStorage } from "../utils/storage";
import { useMusic } from "./MusicContext";

interface PlayerState {
  currentSong?: Song; queue: Song[]; playing: boolean; loading: boolean; error?: string;
  volume: number; muted: boolean; shuffle: boolean; repeat: boolean; progress: number; duration: number;
  play(song: Song, list?: Song[]): Promise<void>; toggle(): void; next(): void; previous(): void; seek(value: number): void;
  setVolume(value: number): void; setMuted(value: boolean): void; setQueue(items: Song[]): void; addQueue(song: Song, next?: boolean): void;
  removeQueue(id: string): void; clearQueue(): void; setShuffle(value: boolean): void; setRepeat(value: boolean): void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { addRecent } = useMusic();
  const audio = useRef(new Audio());
  const requestId = useRef(0);
  const objectUrl = useRef<string | undefined>(undefined);
  const [currentSong, setCurrentSong] = useState<Song>();
  const [queue, setQueueState] = useState(musicStorage.queue);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [volume, setVolumeState] = useState(.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const play = useCallback(async (song: Song, list?: Song[]) => {
    const id = ++requestId.current;
    setError(undefined); setLoading(true); setPlaying(false);
    if (list) setQueueState(list.filter(item => item.id !== song.id));
    try {
      // Downloaded songs play from IndexedDB; everything else streams.
      const saved = await getAudio(song.id);
      if (!saved && !navigator.onLine) throw new Error("You're offline. Only downloaded songs can play.");
      const playable = saved || song.audioUrl || !song.pageUrl ? song : { ...song, ...(await getSongDetails(song.pageUrl)) };
      if (id !== requestId.current) return;
      if (!saved && !playable.audioUrl) throw new Error("No playable audio was found for this song");
      const player = audio.current;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = saved ? URL.createObjectURL(saved) : undefined;
      player.pause(); player.src = objectUrl.current ?? playable.audioUrl!; player.load();
      setCurrentSong(playable); setProgress(0); setDuration(0);
      await player.play();
      if (id !== requestId.current) return;
      setPlaying(true); addRecent(playable);
    } catch (playError) {
      if (id !== requestId.current) return;
      setPlaying(false); setError(playError instanceof Error ? playError.message : "Unable to play this song");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [addRecent]);

  const next = useCallback(() => {
    // Offline, only downloaded songs are reachable, so skip past the rest.
    const candidates = queue.map((song, index) => ({ song, index })).filter(({ song }) => navigator.onLine || isDownloaded(song.id));
    if (!candidates.length) { setPlaying(false); return; }
    const index = candidates[shuffle ? Math.floor(Math.random() * candidates.length) : 0].index;
    const song = queue[index];
    setQueueState(items => items.filter((_, itemIndex) => itemIndex !== index));
    void play(song);
  }, [play, queue, shuffle]);

  // Latest handlers for the audio listeners, so they are attached once and never pause playback on re-render.
  const nextRef = useRef(next);
  const repeatRef = useRef(repeat);
  useEffect(() => { nextRef.current = next; repeatRef.current = repeat; }, [next, repeat]);

  useEffect(() => { audio.current.volume = volume; audio.current.muted = muted; }, [muted, volume]);

  useEffect(() => {
    const player = audio.current;
    const syncProgress = () => setProgress(player.currentTime);
    const syncDuration = () => setDuration(Number.isFinite(player.duration) ? player.duration : 0);
    const syncPlaying = () => setPlaying(!player.paused);
    const handleError = () => { setPlaying(false); setLoading(false); setError("This audio source is unavailable. Try another song."); };
    const handleEnded = () => { if (repeatRef.current) { player.currentTime = 0; void player.play(); } else nextRef.current(); };
    player.addEventListener("timeupdate", syncProgress); player.addEventListener("loadedmetadata", syncDuration);
    player.addEventListener("play", syncPlaying); player.addEventListener("pause", syncPlaying);
    player.addEventListener("error", handleError); player.addEventListener("ended", handleEnded);
    return () => { player.pause(); player.removeEventListener("timeupdate", syncProgress); player.removeEventListener("loadedmetadata", syncDuration); player.removeEventListener("play", syncPlaying); player.removeEventListener("pause", syncPlaying); player.removeEventListener("error", handleError); player.removeEventListener("ended", handleEnded); };
  }, []);

  useEffect(() => musicStorage.setQueue(queue), [queue]);

  // Media Session: shows song info and controls in the browser/OS media panel.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentSong) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title, artist: currentSong.artist, album: currentSong.album ?? "MyMusic",
      artwork: currentSong.imageUrl ? [{ src: currentSong.imageUrl, sizes: "512x512" }] : []
    });
    document.title = `${currentSong.title} • ${currentSong.artist}`;
  }, [currentSong]);

  useEffect(() => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused"; }, [playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !duration) return;
    try { navigator.mediaSession.setPositionState({ duration, position: Math.min(progress, duration), playbackRate: audio.current.playbackRate }); } catch { /* ignore invalid state */ }
  }, [duration, progress]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const player = audio.current;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void player.play()], ["pause", () => player.pause()],
      ["nexttrack", () => nextRef.current()], ["previoustrack", () => { player.currentTime = 0; }],
      ["seekto", details => { if (details.seekTime != null) player.currentTime = details.seekTime; }],
      ["seekbackward", details => { player.currentTime = Math.max(0, player.currentTime - (details.seekOffset ?? 10)); }],
      ["seekforward", details => { player.currentTime = Math.min(player.duration || Infinity, player.currentTime + (details.seekOffset ?? 10)); }]
    ];
    handlers.forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ } });
    return () => handlers.forEach(([action]) => { try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported action */ } });
  }, []);

  const toggle = () => {
    if (!currentSong) return;
    if (audio.current.paused) { setError(undefined); void audio.current.play().catch(() => setError("Playback was blocked. Press play to try again.")); }
    else audio.current.pause();
  };
  const previous = () => { if (audio.current.currentTime > 3) audio.current.currentTime = 0; else setPlaying(false); };
  const seek = (value: number) => { if (Number.isFinite(value)) { audio.current.currentTime = value; setProgress(value); } };
  const setVolume = (value: number) => { const nextVolume = Math.min(1, Math.max(0, value)); setVolumeState(nextVolume); setMuted(nextVolume === 0); };
  const value: PlayerState = {
    currentSong, queue, playing, loading, error, volume, muted, shuffle, repeat, progress, duration, play, toggle, next, previous, seek, setVolume, setMuted,
    setQueue: setQueueState, addQueue: (song, playNext = false) => setQueueState(items => playNext ? [song, ...items.filter(item => item.id !== song.id)] : [...items, song]),
    removeQueue: id => setQueueState(items => items.filter(song => song.id !== id)), clearQueue: () => setQueueState([]), setShuffle, setRepeat
  };
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => { const context = useContext(PlayerContext); if (!context) throw new Error("PlayerProvider missing"); return context; };
