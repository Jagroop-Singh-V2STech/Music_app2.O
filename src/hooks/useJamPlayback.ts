import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePlayer } from "../context/PlayerContext";
import type { JamQueueItem, JamRoomState } from "../types/jam";
import { SYNC, correctDrift, expectedPosition } from "../utils/jamSync";

const TICK_MS = 1000;
const SEEK_COOLDOWN_MS = 2000; // let a hard seek finish buffering before judging drift again

interface Options {
  room?: JamRoomState;
  serverNow(): number;
  /** True while this client has commands in flight, so a periodic check doesn't undo an optimistic local change. */
  hasPending(): boolean;
  blocked: boolean;
  onBlocked(): void;
  onUnavailable(item: JamQueueItem): void;
}

/**
 * Keeps the existing player in step with the room. Each client plays audio locally; this only steers it:
 * load the room's song, follow play/pause, and correct drift — gently by playbackRate, or with one seek if far off.
 * Runs on every new room snapshot and once a second.
 */
export function useJamPlayback({ room, serverNow, hasPending, blocked, onBlocked, onUnavailable }: Options) {
  const { engine, currentSong } = usePlayer();
  const roomRef = useRef(room);
  const currentSongId = useRef(currentSong?.id);
  useEffect(() => { currentSongId.current = currentSong?.id; }, [currentSong]);
  const loaded = useRef<string | undefined>(undefined); // itemId currently in the audio element
  const loading = useRef<string | undefined>(undefined);
  const failed = useRef<string | undefined>(undefined);
  const startTimer = useRef<number | undefined>(undefined);
  const lastSeek = useRef(0);
  const callbacks = useRef({ serverNow, hasPending, blocked, onBlocked, onUnavailable });
  useEffect(() => { callbacks.current = { serverNow, hasPending, blocked, onBlocked, onUnavailable }; });
  useEffect(() => { roomRef.current = room; }, [room]);

  const hardSeek = useCallback((position: number) => {
    engine.setRate(1);
    engine.seek(position);
    lastSeek.current = Date.now();
  }, [engine]);

  const reconcile = useCallback(async (fromTick = false) => {
    const state = roomRef.current;
    const { serverNow: now, hasPending: pending, blocked: isBlocked, onBlocked: blockedCb, onUnavailable: unavailableCb } = callbacks.current;
    if (!state) return;
    if (fromTick && pending()) return;
    window.clearTimeout(startTimer.current);

    const item = state.currentItem;
    if (!item) { if (engine.isPlaying()) engine.pause(); return; }
    const expected = expectedPosition(state, now());

    // Starting a Jam with the song that's already playing here: keep it instead of reloading.
    if (loaded.current === undefined && !loading.current && currentSongId.current === item.song.id) loaded.current = item.itemId;

    // A different song is current: load it at the room's position.
    if (loaded.current !== item.itemId) {
      if (loading.current === item.itemId) return;
      loading.current = item.itemId;
      engine.setRate(1);
      const autoplay = state.isPlaying && expected >= 0 && !isBlocked;
      const result = await engine.load(item.song, { position: Math.max(0, state.isPlaying ? expected : state.position), autoplay });
      if (loading.current !== item.itemId) return; // a newer song took over meanwhile
      loading.current = undefined;
      if (result === "superseded") return;
      loaded.current = item.itemId;
      lastSeek.current = Date.now();
      if (result === "failed") { failed.current = item.itemId; unavailableCb(item); return; }
      if (result === "blocked") blockedCb();
      failed.current = undefined;
      void reconcile(); // loading took time; line up with where the room is now
      return;
    }
    if (failed.current === item.itemId || engine.isBusy()) return;

    if (!state.isPlaying) {
      engine.setRate(1);
      if (engine.isPlaying()) engine.pause();
      if (Math.abs(engine.position() - state.position) > SYNC.tolerance) hardSeek(state.position);
      return;
    }

    // Song change scheduled slightly ahead so everyone can buffer: hold at 0 and start on time.
    if (expected < 0) {
      if (engine.isPlaying()) engine.pause();
      if (engine.position() > SYNC.settle) hardSeek(0);
      startTimer.current = window.setTimeout(() => void reconcile(), -expected * 1000);
      return;
    }

    if (!engine.isPlaying()) {
      if (isBlocked) return; // waiting for a tap (browser autoplay policy)
      if (Math.abs(engine.position() - expected) > SYNC.tolerance) hardSeek(expected);
      const result = await engine.resume();
      if (result === "blocked") blockedCb();
      return;
    }

    if (Date.now() - lastSeek.current < SEEK_COOLDOWN_MS) return;
    const action = correctDrift(expected, engine.position(), engine.rate());
    if (action.kind === "seek") hardSeek(action.position);
    else if (action.kind === "rate") engine.setRate(action.rate);
  }, [engine, hardSeek]);

  // New authoritative state → reconcile right away.
  useEffect(() => { if (room) void reconcile(); }, [room, reconcile]);
  // Retry after the user unblocks autoplay.
  useEffect(() => { if (!blocked) void reconcile(); }, [blocked, reconcile]);

  const active = Boolean(room);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void reconcile(true), TICK_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(startTimer.current);
      engine.setRate(1);
      loaded.current = loading.current = failed.current = undefined;
    };
  }, [active, engine, reconcile]);

  // Memoized: callers put this in effect deps, and a new object per render would re-register the Jam controller constantly.
  return useMemo(() => ({ reconcile, markSeeked: () => { lastSeek.current = Date.now(); } }), [reconcile]);
}
