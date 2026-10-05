export class JamError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const errors = {
  badRequest: message => new JamError("BAD_REQUEST", message, 400),
  unauthorized: () => new JamError("UNAUTHORIZED", "Your Jam session is missing or has expired.", 401),
  notFound: () => new JamError("ROOM_NOT_FOUND", "That Jam doesn't exist. Check the code and try again.", 404),
  ended: () => new JamError("ROOM_ENDED", "This Jam has ended.", 410),
  expired: () => new JamError("ROOM_EXPIRED", "This Jam expired after everyone left.", 410),
  full: max => new JamError("ROOM_FULL", `This Jam is full (${max} people max).`, 409),
  notParticipant: () => new JamError("NOT_A_PARTICIPANT", "You're not part of this Jam.", 403),
  removed: () => new JamError("REMOVED_FROM_ROOM", "The host removed you from this Jam.", 403),
  notHost: () => new JamError("NOT_HOST", "Only the host can do that.", 403),
  stale: () => new JamError("STALE_COMMAND", "Someone else changed playback first.", 409),
  invalidSong: message => new JamError("INVALID_SONG", message ?? "That song can't be shared in a Jam.", 422),
  itemNotFound: () => new JamError("ITEM_NOT_FOUND", "That song is no longer in the queue.", 409),
  queueFull: max => new JamError("QUEUE_FULL", `The shared queue is full (${max} songs max).`, 409),
  noSong: () => new JamError("NO_CURRENT_SONG", "Add a song to the queue first.", 409),
  rateLimited: () => new JamError("RATE_LIMITED", "Slow down a little and try again.", 429)
};
