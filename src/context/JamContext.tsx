import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Song } from "../types/music";
import type { JamCause, JamCommand, JamConnectionStatus, JamQueueItem, JamRoomState, JamServerMessage, JamUser } from "../types/jam";
import { JamApiError, ensureJamSession, jamApi, jamErrorMessage, jamSession, normalizeRoomCode } from "../services/jam";
import { JAM_CLOSE, JamSocket } from "../services/jamSocket";
import { usePlayer, type PlayerController } from "./PlayerContext";
import { useToast } from "../components/common/Toast";
import { useJamPlayback } from "../hooks/useJamPlayback";
import { expectedPosition } from "../utils/jamSync";

const ACTIVE_KEY = "music_jam_active";
const PENDING_TTL_MS = 2500;
const SEEK_DEBOUNCE_MS = 200;
const MAX_SONGS_PER_ADD = 100;

export interface JamProblem { roomId: string; code: string; message: string }

interface JamState {
  roomId?: string;
  room?: JamRoomState;
  me?: JamUser;
  status: JamConnectionStatus;
  connected: boolean;
  isHost: boolean;
  /** The browser blocked autoplay (e.g. after a refresh); a tap on unlockAudio() starts listening. */
  needsGesture: boolean;
  problem?: JamProblem;
  lastCause?: JamCause & { at: number };
  start(name?: string): Promise<string>;
  join(code: string, name?: string): Promise<string>;
  leave(): Promise<void>;
  end(): Promise<void>;
  removeParticipant(userId: string): Promise<void>;
  transferHost(userId: string): Promise<void>;
  playItem(itemId: string): void;
  addSongs(songs: Song[], playNext?: boolean): void;
  removeItem(itemId: string): void;
  moveItem(itemId: string, afterItemId: string | null): void;
  clearQueue(): void;
  unlockAudio(): void;
  clearProblem(): void;
}

const JamContext = createContext<JamState | null>(null);

const readActive = () => { try { return localStorage.getItem(ACTIVE_KEY) ?? undefined; } catch { return undefined; } };
const writeActive = (roomId?: string) => { try { if (roomId) localStorage.setItem(ACTIVE_KEY, roomId); else localStorage.removeItem(ACTIVE_KEY); } catch { /* storage unavailable */ } };

/** Everyone resolves audio themselves, so a shared song carries its page URL rather than this device's stream URL. */
export function shareableSong(song: Song): Song | undefined {
  const { audioUrl, ...rest } = song;
  if (song.pageUrl) return rest;
  return audioUrl && /^https?:/.test(audioUrl) ? song : undefined;
}

const requestId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function JamProvider({ children }: { children: ReactNode }) {
  const { engine, setController, currentSong, queue } = usePlayer();
  const toast = useToast();
  const [roomId, setRoomId] = useState<string | undefined>(readActive);
  const [room, setRoom] = useState<JamRoomState>();
  const [me, setMe] = useState<JamUser | undefined>(() => jamSession.get()?.user);
  const [status, setStatus] = useState<JamConnectionStatus>("idle");
  const [problem, setProblem] = useState<JamProblem>();
  const [needsGesture, setNeedsGesture] = useState(false);
  const [lastCause, setLastCause] = useState<JamCause & { at: number }>();
  const [epoch, setEpoch] = useState(0); // bump to reconnect with a fresh session

  const roomRef = useRef<JamRoomState | undefined>(undefined);
  const roomIdRef = useRef(roomId);
  const meRef = useRef(me);
  const socketRef = useRef<JamSocket | undefined>(undefined);
  const pending = useRef(new Map<string, { at: number; silent: boolean }>());
  const seekTimer = useRef<number | undefined>(undefined);
  const adds = useRef<{ song: Song; playNext: boolean }[]>([]);
  const rejoined = useRef(false);
  useEffect(() => { roomIdRef.current = roomId; meRef.current = me; }, [roomId, me]);

  const serverNow = useCallback(() => socketRef.current?.serverNow() ?? Date.now(), []);
  const hasPending = useCallback(() => {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, entry] of pending.current) if (entry.at < cutoff) pending.current.delete(id);
    return pending.current.size > 0;
  }, []);

  const playback = useJamPlayback({
    room,
    serverNow,
    hasPending,
    blocked: needsGesture,
    onBlocked: useCallback(() => setNeedsGesture(true), []),
    onUnavailable: useCallback((item: JamQueueItem) => toast(`Couldn't play “${item.song.title}” on this device. Everyone else keeps listening.`, "error"), [toast])
  });

  // ---------- Room lifecycle ----------

  const finish = useCallback((next?: JamProblem) => {
    socketRef.current?.close();
    socketRef.current = undefined;
    roomRef.current = undefined;
    pending.current.clear();
    window.clearTimeout(seekTimer.current);
    setRoom(undefined);
    setRoomId(undefined);
    setStatus("idle");
    setNeedsGesture(false);
    setLastCause(undefined);
    writeActive(undefined);
    if (next) setProblem(next);
  }, []);

  const enter = useCallback((state: JamRoomState) => {
    socketRef.current?.close();
    socketRef.current = undefined;
    roomRef.current = state;
    rejoined.current = false;
    setProblem(undefined);
    setRoom(state);
    setRoomId(state.roomId);
    setMe(jamSession.get()?.user);
    writeActive(state.roomId);
    setEpoch(value => value + 1);
  }, []);

  const accept = useCallback((state: JamRoomState, force = false) => {
    // Never let an older snapshot overwrite a newer one.
    if (!force && roomRef.current && state.version <= roomRef.current.version) return;
    roomRef.current = state;
    setRoom(state);
  }, []);

  const announce = useCallback((cause: JamCause) => {
    const self = meRef.current?.id;
    if (cause.type === "PARTICIPANT_ONLINE" || cause.type === "PARTICIPANT_OFFLINE") return;
    setLastCause({ ...cause, at: Date.now() });
    const someoneElse = cause.userId !== self;
    if (cause.type === "PARTICIPANT_JOINED" && someoneElse) toast(`${cause.name} joined the Jam`, "info");
    if (cause.type === "PARTICIPANT_LEFT" && someoneElse) toast(`${cause.name} left the Jam`, "info");
    if (cause.type === "PARTICIPANT_REMOVED" && someoneElse) toast(`${cause.name} was removed from the Jam`, "info");
    const newHost = cause.newHostId;
    if (newHost && (cause.type === "HOST_CHANGED" || cause.newHostName)) {
      toast(newHost === self ? "You're now the host of this Jam" : `${cause.newHostName ?? cause.name} is now the host`, "info");
    }
  }, [toast]);

  const onMessage = (message: JamServerMessage) => {
    switch (message.type) {
      case "ROOM_STATE":
        setMe(message.you);
        accept(message.state, true);
        break;
      case "ROOM_STATE_UPDATED":
        if (message.cause.requestId) pending.current.delete(message.cause.requestId);
        accept(message.state);
        announce(message.cause);
        break;
      case "COMMAND_REJECTED": {
        const entry = message.requestId ? pending.current.get(message.requestId) : undefined;
        if (message.requestId) pending.current.delete(message.requestId);
        if (!entry?.silent) toast(message.message, message.code === "STALE_COMMAND" ? "info" : "error");
        void playback.reconcile(); // undo any optimistic local change
        break;
      }
      case "ROOM_ENDED": {
        const code = message.reason === "EXPIRED" ? "ROOM_EXPIRED" : "ROOM_ENDED";
        toast(message.reason === "HOST_ENDED" ? "The host ended the Jam" : jamErrorMessage(code), "info");
        finish({ roomId: message.roomId, code, message: jamErrorMessage(code) });
        break;
      }
      case "PARTICIPANT_REMOVED":
        toast(jamErrorMessage("REMOVED_FROM_ROOM"), "error");
        finish({ roomId: message.roomId, code: "REMOVED_FROM_ROOM", message: jamErrorMessage("REMOVED_FROM_ROOM") });
        break;
    }
  };

  const onFatal = (code: number, reason: string) => {
    const id = roomIdRef.current;
    if (!id) return;
    // Dropped for being away too long, or the server forgot our session: try to rejoin once before giving up.
    if ((code === JAM_CLOSE.FORBIDDEN && reason === "NOT_A_PARTICIPANT") || code === JAM_CLOSE.UNAUTHORIZED) {
      if (!rejoined.current) {
        rejoined.current = true;
        setStatus("reconnecting");
        jamApi.joinRoom(id).then(state => { accept(state, true); setMe(jamSession.get()?.user); setEpoch(value => value + 1); }).catch(error => {
          const errorCode = error instanceof JamApiError ? error.code : "NETWORK_ERROR";
          toast(jamErrorMessage(errorCode), "error");
          finish({ roomId: id, code: errorCode, message: jamErrorMessage(errorCode) });
        });
        return;
      }
    }
    const errorCode = code === JAM_CLOSE.NOT_FOUND ? "ROOM_NOT_FOUND" : code === JAM_CLOSE.GONE ? (reason.includes("EXPIRED") ? "ROOM_EXPIRED" : "ROOM_ENDED") : reason || "NOT_A_PARTICIPANT";
    toast(jamErrorMessage(errorCode), "error");
    finish({ roomId: id, code: errorCode, message: jamErrorMessage(errorCode) });
  };

  const handlers = useRef({ onMessage, onFatal });
  useEffect(() => { handlers.current = { onMessage, onFatal }; });

  // One socket per active room; reconnects itself and resyncs from a full snapshot every time.
  useEffect(() => {
    if (!roomId) return;
    const session = jamSession.get();
    if (!session) { finish({ roomId, code: "UNAUTHORIZED", message: jamErrorMessage("UNAUTHORIZED") }); return; }
    const socket = new JamSocket({
      roomId,
      token: session.token,
      onMessage: message => handlers.current.onMessage(message),
      onStatus: setStatus,
      onFatal: (code, reason) => handlers.current.onFatal(code, reason)
    });
    socketRef.current = socket;
    socket.connect();
    return () => { socket.close(); if (socketRef.current === socket) socketRef.current = undefined; };
  }, [roomId, epoch, finish]);

  // ---------- Commands ----------

  const send = useCallback((command: JamCommand, silent = false) => {
    const socket = socketRef.current;
    const state = roomRef.current;
    if (!socket || !state) return false;
    const id = requestId();
    if (!socket.send({ ...command, baseVersion: state.version, requestId: id })) {
      if (!silent) toast("Reconnecting to the Jam… try again in a moment", "info");
      return false;
    }
    pending.current.set(id, { at: Date.now(), silent });
    return true;
  }, [toast]);

  const flushAdds = useCallback(() => {
    const batch = adds.current;
    adds.current = [];
    for (const playNext of [true, false]) {
      const songs = batch.filter(entry => entry.playNext === playNext).map(entry => entry.song);
      for (let i = 0; i < songs.length; i += MAX_SONGS_PER_ADD) send({ type: "QUEUE_ITEM_ADDED", songs: songs.slice(i, i + MAX_SONGS_PER_ADD), playNext });
    }
  }, [send]);

  const addSongs = useCallback((songs: Song[], playNext = false) => {
    const shareable = songs.map(shareableSong).filter((song): song is Song => Boolean(song));
    if (shareable.length < songs.length) toast(shareable.length ? "Some songs are only on your device and weren't added" : "This song is only on your device, so it can't be added to the Jam", "error");
    if (!shareable.length) return;
    // Batch calls made in the same tick (e.g. "Add all to queue") into one command.
    if (!adds.current.length) queueMicrotask(flushAdds);
    adds.current.push(...shareable.map(song => ({ song, playNext })));
  }, [flushAdds, toast]);

  const unlockAudio = useCallback(() => {
    setNeedsGesture(false);
    const state = roomRef.current;
    if (!state?.isPlaying) return;
    const expected = expectedPosition(state, serverNow());
    if (expected >= 0) engine.seek(expected);
    // Must run inside the click handler so the browser treats it as user-initiated.
    void engine.resume().then(result => { if (result === "blocked") setNeedsGesture(true); });
  }, [engine, serverNow]);

  /** Routes the existing player's controls (bottom bar, full-screen player, keyboard, media keys, song rows) to the room. */
  const controller = useMemo<PlayerController>(() => {
    const current = () => roomRef.current?.currentItem;
    const offline = () => !socketRef.current?.connected;
    return {
      toggle: () => {
        const state = roomRef.current;
        if (!state?.currentItem) return;
        if (offline()) {
          // Can't change the room right now; still let people silence their own device.
          if (engine.isPlaying()) engine.pause(); else void engine.resume();
          toast("Reconnecting to the Jam… playback will resync when you're back", "info");
          return;
        }
        if (engine.isPlaying()) {
          engine.pause();
          send({ type: "PAUSE", position: engine.position() });
        } else if (state.isPlaying) {
          unlockAudio(); // the room is playing; this device just isn't yet
        } else {
          send({ type: "PLAY" });
          setNeedsGesture(false);
          void engine.resume();
        }
      },
      seek: value => {
        if (!current() || !Number.isFinite(value)) return;
        engine.seek(value);
        playback.markSeeked();
        window.clearTimeout(seekTimer.current);
        seekTimer.current = window.setTimeout(() => send({ type: "SEEK", position: Math.max(0, value) }), SEEK_DEBOUNCE_MS);
      },
      next: () => { const item = current(); if (item) send({ type: "NEXT", fromItemId: item.itemId }); },
      previous: () => { const item = current(); if (item) send({ type: "PREVIOUS", fromItemId: item.itemId }); },
      playSong: song => {
        const shareable = shareableSong(song);
        if (!shareable) { toast("This song is only on your device, so it can't be played in the Jam", "error"); return; }
        setNeedsGesture(false);
        send({ type: "SONG_CHANGED", song: shareable });
      },
      addQueue: (song, playNext) => addSongs([song], playNext),
      removeQueue: songId => { const item = roomRef.current?.queue.find(entry => entry.song.id === songId); if (item) send({ type: "QUEUE_ITEM_REMOVED", itemId: item.itemId }); },
      clearQueue: () => send({ type: "QUEUE_CLEARED" }),
      // Every client reports the end; the server advances once (fromItemId makes the rest stale).
      ended: () => { const item = current(); if (item) send({ type: "NEXT", fromItemId: item.itemId, auto: true }, true); }
    };
  }, [addSongs, engine, playback, send, toast, unlockAudio]);

  useEffect(() => {
    if (!roomId) return;
    setController(controller);
    return () => setController(null);
  }, [roomId, controller, setController]);

  // ---------- Public API ----------

  const leaveQuietly = async (id: string) => { try { await jamApi.leaveRoom(id); } catch { /* already gone */ } };

  const start = useCallback(async (name?: string) => {
    await ensureJamSession(name);
    const song = currentSong && shareableSong(currentSong);
    const state = await jamApi.createRoom({
      song,
      position: song ? engine.position() : undefined,
      isPlaying: song ? engine.isPlaying() : undefined,
      queue: queue.map(shareableSong).filter((item): item is Song => Boolean(item))
    });
    const previous = roomIdRef.current;
    if (previous) void leaveQuietly(previous);
    enter(state);
    return state.roomId;
  }, [currentSong, engine, enter, queue]);

  const join = useCallback(async (code: string, name?: string) => {
    const id = normalizeRoomCode(code);
    if (!id) throw new JamApiError("ROOM_NOT_FOUND", "Enter a valid room code, like JAM-4821AB.");
    await ensureJamSession(name);
    if (roomIdRef.current === id && roomRef.current) return id;
    const previous = roomIdRef.current;
    if (previous && previous !== id) { finish(); await leaveQuietly(previous); }
    const state = await jamApi.joinRoom(id);
    enter(state);
    setNeedsGesture(false);
    return id;
  }, [enter, finish]);

  const leave = useCallback(async () => {
    const id = roomIdRef.current;
    if (!id) return;
    finish();
    await leaveQuietly(id);
    toast("You left the Jam", "info");
  }, [finish, toast]);

  const end = useCallback(async () => {
    const id = roomIdRef.current;
    if (!id) return;
    try {
      await jamApi.endRoom(id);
      finish({ roomId: id, code: "ROOM_ENDED", message: jamErrorMessage("ROOM_ENDED") });
      toast("You ended the Jam", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't end the Jam", "error");
    }
  }, [finish, toast]);

  const hostAction = useCallback(async (action: () => Promise<unknown>, success: string) => {
    try { await action(); toast(success, "info"); }
    catch (error) { toast(error instanceof Error ? error.message : "That didn't work. Try again.", "error"); }
  }, [toast]);

  const value = useMemo<JamState>(() => {
    const participantName = (userId: string) => room?.participants.find(p => p.id === userId)?.name ?? "them";
    return {
      roomId, room, me, status, problem, needsGesture, lastCause,
      connected: status === "connected",
      isHost: Boolean(room && me && room.hostId === me.id),
      start, join, leave, end, addSongs, unlockAudio,
      removeParticipant: userId => hostAction(() => jamApi.removeParticipant(roomId!, userId), `Removed ${participantName(userId)} from the Jam`),
      transferHost: userId => hostAction(() => jamApi.transferHost(roomId!, userId), `${participantName(userId)} is now the host`),
      playItem: itemId => { setNeedsGesture(false); send({ type: "SONG_CHANGED", itemId }); },
      removeItem: itemId => send({ type: "QUEUE_ITEM_REMOVED", itemId }),
      moveItem: (itemId, afterItemId) => send({ type: "QUEUE_REORDERED", itemId, afterItemId }),
      clearQueue: () => send({ type: "QUEUE_CLEARED" }),
      clearProblem: () => setProblem(undefined)
    };
  }, [addSongs, end, hostAction, join, lastCause, leave, me, needsGesture, problem, room, roomId, send, start, status, unlockAudio]);

  return <JamContext.Provider value={value}>{children}</JamContext.Provider>;
}

export const useJam = () => { const context = useContext(JamContext); if (!context) throw new Error("JamProvider missing"); return context; };
