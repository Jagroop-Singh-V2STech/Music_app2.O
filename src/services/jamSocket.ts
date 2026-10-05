import type { JamCommand, JamConnectionStatus, JamServerMessage } from "../types/jam";
import { estimateClockOffset, type ClockSample } from "../utils/jamSync";
import { jamSocketUrl } from "./jam";

const CLOSE = { UNAUTHORIZED: 4401, FORBIDDEN: 4403, NOT_FOUND: 4404, GONE: 4410 };
const FATAL_CODES = new Set(Object.values(CLOSE));
const PING_INTERVAL_MS = 20_000;
const MAX_SAMPLES = 8;

interface Options {
  roomId: string;
  token: string;
  onMessage(message: JamServerMessage): void;
  onStatus(status: JamConnectionStatus): void;
  /** The server closed the socket for good (room ended, removed, bad session). No reconnect is attempted. */
  onFatal(code: number, reason: string): void;
}

/**
 * One Jam WebSocket with automatic reconnection (exponential backoff + jitter, immediate retry when the browser comes
 * back online) and NTP-style clock sync. Every (re)connect gets a full ROOM_STATE, so missed events never matter.
 */
export class JamSocket {
  private ws?: WebSocket;
  private attempt = 0;
  private retryTimer?: number;
  private pingTimer?: number;
  private samples: ClockSample[] = [];
  private stopped = false;
  private offset = 0;

  constructor(private options: Options) {
    window.addEventListener("online", this.retryNow);
  }

  /** Current time on the server's clock, in ms. */
  serverNow = () => Date.now() + this.offset;

  get connected() { return this.ws?.readyState === WebSocket.OPEN && this.welcomed; }
  private welcomed = false;

  connect() {
    if (this.stopped) return;
    window.clearTimeout(this.retryTimer);
    this.options.onStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(jamSocketUrl());
    this.ws = ws;
    this.welcomed = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: "HELLO", token: this.options.token, roomId: this.options.roomId }));
    ws.onmessage = event => {
      let message: JamServerMessage;
      try { message = JSON.parse(String(event.data)) as JamServerMessage; } catch { return; }
      if (message.type === "PONG") return this.recordPong(message.t0, message.serverTime);
      if (message.type === "ROOM_STATE") {
        this.welcomed = true;
        this.attempt = 0;
        this.options.onStatus("connected");
        // Seed the clock from the snapshot, then refine with a few quick pings.
        if (!this.samples.length) this.offset = message.state.serverTime - Date.now();
        this.startPinging();
      }
      this.options.onMessage(message);
    };
    ws.onclose = event => {
      if (this.ws !== ws) return;
      window.clearInterval(this.pingTimer);
      this.welcomed = false;
      if (this.stopped) return;
      if (FATAL_CODES.has(event.code)) { this.stopped = true; this.options.onStatus("disconnected"); this.options.onFatal(event.code, event.reason); return; }
      this.scheduleRetry();
    };
  }

  send(command: JamCommand & { baseVersion: number; requestId: string }) {
    if (!this.connected) return false;
    this.ws!.send(JSON.stringify(command));
    return true;
  }

  close() {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    window.removeEventListener("online", this.retryNow);
    this.ws?.close(1000, "LEFT");
    this.ws = undefined;
  }

  private scheduleRetry() {
    this.attempt++;
    this.options.onStatus(this.attempt > 6 ? "disconnected" : "reconnecting");
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempt - 1, 5)) * (0.75 + Math.random() * 0.5);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private retryNow = () => {
    if (this.stopped || this.connected) return;
    this.attempt = Math.max(this.attempt, 1);
    this.connect();
  };

  private startPinging() {
    window.clearInterval(this.pingTimer);
    const ping = () => { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "PING", t0: Date.now() })); };
    [0, 300, 900].forEach(delay => window.setTimeout(ping, delay));
    this.pingTimer = window.setInterval(ping, PING_INTERVAL_MS);
  }

  private recordPong(t0: number, serverTime: number) {
    if (typeof t0 !== "number") return;
    this.samples = [...this.samples, { t0, t1: Date.now(), serverTime }].slice(-MAX_SAMPLES);
    this.offset = estimateClockOffset(this.samples);
  }
}

export { CLOSE as JAM_CLOSE };
