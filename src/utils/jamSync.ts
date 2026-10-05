// Pure playback-sync math for Jam rooms. Kept dependency-free so it can be unit tested in plain Node.

export const SYNC = {
  /** Drift below this (seconds) is inaudible enough to leave alone. */
  tolerance: 0.25,
  /** While correcting, stop once drift is back under this. */
  settle: 0.05,
  /** Beyond this, catching up by rate would take too long, so seek once instead. */
  hardSeek: 1,
  /** playbackRate offset used to catch up or fall back (pitch is preserved by the browser). */
  nudge: 0.05
};

export interface PlaybackClock { isPlaying: boolean; position: number; positionUpdatedAt: number }

/**
 * Where the room's playback is right now on the server timeline, in seconds.
 * Negative means a song is scheduled to start that many seconds from now.
 */
export function expectedPosition(state: PlaybackClock, serverNow: number): number {
  if (!state.isPlaying) return state.position;
  return state.position + (serverNow - state.positionUpdatedAt) / 1000;
}

export interface ClockSample { t0: number; t1: number; serverTime: number }

/** NTP-style offset (serverClock − localClock) from the lowest-latency sample, which has the least asymmetric delay. */
export function estimateClockOffset(samples: ClockSample[]): number {
  if (!samples.length) return 0;
  const best = samples.reduce((a, b) => (b.t1 - b.t0 < a.t1 - a.t0 ? b : a));
  return best.serverTime - (best.t0 + best.t1) / 2;
}

export type DriftAction = { kind: "none" } | { kind: "rate"; rate: number } | { kind: "seek"; position: number };

/**
 * Decides how to bring local audio back in line. Small drift is ignored; moderate drift is absorbed smoothly by
 * running slightly fast or slow (no audible skip); only large drift jumps with a seek. Hysteresis via `currentRate`
 * keeps it from flapping around the threshold.
 */
export function correctDrift(expected: number, actual: number, currentRate = 1): DriftAction {
  const drift = expected - actual; // > 0: we're behind
  const size = Math.abs(drift);
  if (size >= SYNC.hardSeek) return { kind: "seek", position: Math.max(0, expected) };
  const correcting = currentRate !== 1;
  if (correcting ? size <= SYNC.settle : size <= SYNC.tolerance) return correcting ? { kind: "rate", rate: 1 } : { kind: "none" };
  const rate = 1 + Math.sign(drift) * SYNC.nudge;
  return rate === currentRate ? { kind: "none" } : { kind: "rate", rate };
}
