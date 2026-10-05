import type { Song } from "./music";

export interface JamUser { id: string; name: string }
export interface JamParticipant extends JamUser { online: boolean; joinedAt: number }
export interface JamQueueItem { itemId: string; song: Song; addedBy: string }

/** Authoritative room snapshot, exactly as the Jam server sends it. */
export interface JamRoomState {
  roomId: string;
  name: string;
  hostId: string;
  status: "active";
  createdAt: number;
  maxParticipants: number;
  participants: JamParticipant[];
  currentItem: JamQueueItem | null;
  isPlaying: boolean;
  /** Seconds into currentItem at positionUpdatedAt (server clock, ms). May be in the future right after a song change. */
  position: number;
  positionUpdatedAt: number;
  queue: JamQueueItem[];
  canGoBack: boolean;
  version: number;
  playbackVersion: number;
  serverTime: number;
}

export type JamCommand =
  | { type: "PLAY"; position?: number }
  | { type: "PAUSE"; position: number }
  | { type: "SEEK"; position: number }
  | { type: "NEXT"; fromItemId: string; auto?: boolean }
  | { type: "PREVIOUS"; fromItemId: string }
  | { type: "SONG_CHANGED"; itemId: string }
  | { type: "SONG_CHANGED"; song: Song }
  | { type: "QUEUE_ITEM_ADDED"; songs: Song[]; playNext?: boolean }
  | { type: "QUEUE_ITEM_REMOVED"; itemId: string }
  | { type: "QUEUE_REORDERED"; itemId: string; afterItemId: string | null }
  | { type: "QUEUE_CLEARED" };

export interface JamCause {
  type: string;
  userId?: string;
  name?: string;
  requestId?: string;
  newHostId?: string;
  newHostName?: string;
  reason?: string;
  title?: string;
  count?: number;
  position?: number;
  auto?: boolean;
  restarted?: boolean;
}

export type JamServerMessage =
  | { type: "ROOM_STATE"; state: JamRoomState; you: JamUser }
  | { type: "ROOM_STATE_UPDATED"; state: JamRoomState; cause: JamCause }
  | { type: "COMMAND_REJECTED"; requestId?: string; code: string; message: string }
  | { type: "PONG"; t0: number; serverTime: number }
  | { type: "ROOM_ENDED"; roomId: string; reason: "HOST_ENDED" | "EXPIRED" | "EMPTY" }
  | { type: "PARTICIPANT_REMOVED"; roomId: string }
  | { type: "ERROR"; code: string; message: string };

export type JamConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
