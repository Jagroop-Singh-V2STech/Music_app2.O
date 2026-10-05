import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Song } from "../types/music";
import { getSongDetails } from "../services/api";
import { getAudio, isDownloaded } from "../services/offline";
import { musicStorage } from "../utils/storage";
import { useMusic } from "./MusicContext";

export type LoadResult = "playing" | "ready" | "blocked" | "failed" | "superseded";

/**
 * Takes over the user-facing controls (buttons, keyboard, media keys, song rows) while something else owns playback —
 * a Jam room. The player keeps doing the actual audio work through `engine`.
 */
export interface PlayerController {
  toggle(): void; playSong(song: Song): void; next(): void; previous(): void; seek(value: number): void;
  addQueue(song: Song, next: boolean): void; removeQueue(id: string): void; clearQueue(): void; ended(): void;
}

/** Low-level access to the one audio element, for code that drives playback itself (Jam sync). */
export interface PlayerEngine {
  load(song: Song, options: { position: number; autoplay: boolean }): Promise<LoadResult>;
  resume(): Promise<LoadResult>; pause(): void; seek(value: number): void;
  position(): number; isPlaying(): boolean; isBusy(): boolean; rate(): number; setRate(rate: number): void;
}

interface PlayerState {
  currentSong?: Song; queue: Song[]; playing: boolean; loading: boolean; error?: string;
  volume: number; muted: boolean; shuffle: boolean; repeat: boolean; progress: number; duration: number;
  play(song: Song, list?: Song[]): Promise<void>; toggle(): void; next(): void; previous(): void; seek(value: number): void;
  setVolume(value: number): void; setMuted(value: boolean): void; setQueue(items: Song[]): void; addQueue(song: Song, next?: boolean): void;
  removeQueue(id: string): void; clearQueue(): void; setShuffle(value: boolean): void; setRepeat(value: boolean): void;
  /** True while a controller (a Jam) owns playback. */
  controlled: boolean; setController(controller: PlayerController | null): void; engine: PlayerEngine;
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
  const controllerRef = useRef<PlayerController | null>(null);
  const [controlled, setControlled] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async (song: Song, { position = 0, autoplay = true } = {}): Promise<LoadResult> => {
    const id = ++requestId.current;
    setError(undefined); setLoading(true); setPlaying(false); loadingRef.current = true;
    try {
      // Downloaded songs play from IndexedDB; everything else streams.
      const saved = await getAudio(song.id);
      if (!saved && !navigator.onLine) throw new Error("You're offline. Only downloaded songs can play.");
      const playable = saved || song.audioUrl || !song.pageUrl ? song : { ...song, ...(await getSongDetails(song.pageUrl)) };
      if (id !== requestId.current) return "superseded";
      if (!saved && !playable.audioUrl) throw new Error("No playable audio was found for this song");
      const player = audio.current;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = saved ? URL.createObjectURL(saved) : undefined;
      player.pause(); player.src = objectUrl.current ?? playable.audioUrl!; player.load();
      if (position > 0) player.currentTime = position;
      setCurrentSong(playable); setProgress(position); setDuration(0);
      if (!autoplay) return "ready";
      await player.play();
      if (id !== requestId.current) return "superseded";
      setPlaying(true); addRecent(playable);
      return "playing";
    } catch (playError) {
      if (id !== requestId.current) return "superseded";
      setPlaying(false);
      // Autoplay policy: the song is loaded, it just needs a tap before it can start.
      if (playError instanceof DOMException && playError.name === "NotAllowedError") { setError("Playback was blocked. Press play to try again."); return "blocked"; }
      setError(playError instanceof Error ? playError.message : "Unable to play this song");
      return "failed";
    } finally {
      if (id === requestId.current) { setLoading(false); loadingRef.current = false; }
    }
  }, [addRecent]);

  const play = useCallback(async (song: Song, list?: Song[]) => {
    if (controllerRef.current) { controllerRef.current.playSong(song); return; }
    if (list) setQueueState(list.filter(item => item.id !== song.id));
    await load(song);
  }, [load]);

  const next = useCallback(() => {
    // Offline, only downloaded songs are reachable, so skip past the rest.
    const candidates = queue.map((song, index) => ({ song, index })).filter(({ song }) => navigator.onLine || isDownloaded(song.id));
    if (!candidates.length) { setPlaying(false); return; }
    const index = candidates[shuffle ? Math.floor(Math.random() * candidates.length) : 0].index;
    const song = queue[index];
    setQueueState(items => items.filter((_, itemIndex) => itemIndex !== index));
    void load(song);
  }, [load, queue, shuffle]);

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
    const handleEnded = () => { if (controllerRef.current) controllerRef.current.ended(); else if (repeatRef.current) { player.currentTime = 0; void player.play(); } else nextRef.current(); };
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
    // While a Jam owns playback, media keys act on the room rather than only this device.
    const seekTo = (value: number) => { if (controllerRef.current) controllerRef.current.seek(value); else player.currentTime = value; };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => { if (controllerRef.current) { if (player.paused) controllerRef.current.toggle(); } else void player.play(); }],
      ["pause", () => { if (controllerRef.current) { if (!player.paused) controllerRef.current.toggle(); } else player.pause(); }],
      ["nexttrack", () => { if (controllerRef.current) controllerRef.current.next(); else nextRef.current(); }],
      ["previoustrack", () => { if (controllerRef.current) controllerRef.current.previous(); else player.currentTime = 0; }],
      ["seekto", details => { if (details.seekTime != null) seekTo(details.seekTime); }],
      ["seekbackward", details => seekTo(Math.max(0, player.currentTime - (details.seekOffset ?? 10)))],
      ["seekforward", details => seekTo(Math.min(player.duration || Infinity, player.currentTime + (details.seekOffset ?? 10)))]
    ];
    handlers.forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ } });
    return () => handlers.forEach(([action]) => { try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported action */ } });
  }, []);

  const localSeek = useCallback((value: number) => { if (Number.isFinite(value)) { audio.current.currentTime = Math.max(0, value); setProgress(Math.max(0, value)); } }, []);
  const resume = useCallback(async (): Promise<LoadResult> => {
    setError(undefined);
    try { await audio.current.play(); return "playing"; }
    catch (playError) {
      if (playError instanceof DOMException && playError.name === "NotAllowedError") { setError("Playback was blocked. Press play to try again."); return "blocked"; }
      return "failed";
    }
  }, []);
  // Stable identity so code holding the engine (Jam sync) isn't torn down whenever `load` is recreated.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const engine = useMemo<PlayerEngine>(() => ({
    load: (song, options) => loadRef.current(song, options),
    resume,
    pause: () => audio.current.pause(),
    seek: localSeek,
    position: () => audio.current.currentTime,
    isPlaying: () => !audio.current.paused,
    isBusy: () => loadingRef.current || audio.current.seeking || audio.current.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
    rate: () => audio.current.playbackRate,
    setRate: rate => { if (audio.current.playbackRate !== rate) { audio.current.preservesPitch = true; audio.current.playbackRate = rate; } }
  }), [localSeek, resume]);
  const setController = useCallback((controller: PlayerController | null) => {
    controllerRef.current = controller;
    setControlled(Boolean(controller));
    if (!controller) audio.current.playbackRate = 1;
  }, []);

  const toggle = () => {
    if (controllerRef.current) return controllerRef.current.toggle();
    if (!currentSong) return;
    if (audio.current.paused) { setError(undefined); void audio.current.play().catch(() => setError("Playback was blocked. Press play to try again.")); }
    else audio.current.pause();
  };
  const previous = () => { if (controllerRef.current) return controllerRef.current.previous(); if (audio.current.currentTime > 3) audio.current.currentTime = 0; else setPlaying(false); };
  const seek = (value: number) => { if (controllerRef.current) return controllerRef.current.seek(value); localSeek(value); };
  const setVolume = (value: number) => { const nextVolume = Math.min(1, Math.max(0, value)); setVolumeState(nextVolume); setMuted(nextVolume === 0); };
  const value: PlayerState = {
    currentSong, queue, playing, loading, error, volume, muted, shuffle, repeat, progress, duration, play, toggle, previous, seek, setVolume, setMuted,
    next: () => { if (controllerRef.current) controllerRef.current.next(); else next(); },
    setQueue: setQueueState,
    addQueue: (song, playNext = false) => { if (controllerRef.current) return controllerRef.current.addQueue(song, playNext); setQueueState(items => playNext ? [song, ...items.filter(item => item.id !== song.id)] : [...items, song]); },
    removeQueue: id => { if (controllerRef.current) return controllerRef.current.removeQueue(id); setQueueState(items => items.filter(song => song.id !== id)); },
    clearQueue: () => { if (controllerRef.current) return controllerRef.current.clearQueue(); setQueueState([]); },
    setShuffle, setRepeat, controlled, setController, engine
  };
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => { const context = useContext(PlayerContext); if (!context) throw new Error("PlayerProvider missing"); return context; };
