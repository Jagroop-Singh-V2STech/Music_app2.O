import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { JamError, errors } from "./errors.js";

const FILE_ID = /^[A-Za-z0-9_-]{32}$/;
const AUDIO_TYPE = /^audio\/[a-z0-9.+-]+$/;

/**
 * Songs uploaded from someone's device so everyone in a Jam can hear them. Files live on disk only while their
 * room exists (dropRoom runs when it ends or expires) and are never listed: a file is reachable only through its
 * unguessable id, which the room shares as the song's audioUrl. An <audio> element can't send an Authorization
 * header, so that id is the capability for streaming; uploading needs a room member's session.
 */
export class FileStore {
  constructor(config) {
    this.config = config;
    mkdirSync(config.uploadDir, { recursive: true });
    // A fresh directory per process, so nothing from an earlier run is ever served and close() can remove it whole.
    this.dir = mkdtempSync(path.join(config.uploadDir, "jam-"));
    this.rooms = new Map(); // roomId -> Map(fileId -> { path, size, contentType, addedBy })
    this.total = 0;
  }

  roomBytes(roomId) {
    let bytes = 0;
    for (const file of this.rooms.get(roomId)?.values() ?? []) bytes += file.size;
    return bytes;
  }

  /** Streams the request body to disk, enforcing the per-file, per-room and server-wide limits as bytes arrive. */
  async save(roomId, userId, req) {
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!AUDIO_TYPE.test(contentType)) throw errors.unsupportedType();
    const { maxUploadBytes, maxRoomUploadBytes, maxTotalUploadBytes } = this.config;
    const declared = Number(req.headers["content-length"]);
    if (declared > maxUploadBytes) throw errors.tooLarge(maxUploadBytes);
    const room = maxRoomUploadBytes - this.roomBytes(roomId), server = maxTotalUploadBytes - this.total;
    if (Math.min(room, server) <= 0 || declared > Math.min(room, server)) throw errors.storageFull();

    const fileId = randomBytes(24).toString("base64url");
    const dir = path.join(this.dir, roomId);
    const filePath = path.join(dir, fileId);
    await mkdir(dir, { recursive: true });
    let size = 0;
    const limit = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        if (size > maxUploadBytes) return done(errors.tooLarge(maxUploadBytes));
        if (size > Math.min(room, server)) return done(errors.storageFull());
        done(null, chunk);
      }
    });
    try {
      await pipeline(req, limit, createWriteStream(filePath));
    } catch (error) {
      await rm(filePath, { force: true });
      throw error instanceof JamError ? error : errors.badRequest("The upload didn't finish. Try again.");
    }
    if (!size) { await rm(filePath, { force: true }); throw errors.badRequest("That file is empty."); }

    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Map());
    this.rooms.get(roomId).set(fileId, { path: filePath, size, contentType, addedBy: userId });
    this.total += size;
    return { fileId, size, contentType };
  }

  get(roomId, fileId) {
    const file = FILE_ID.test(fileId ?? "") ? this.rooms.get(roomId)?.get(fileId) : undefined;
    if (!file) throw errors.fileNotFound();
    return file;
  }

  /** Answers GET/HEAD with Range support, so the player can seek without downloading the whole file. */
  serve(req, res, file, extraHeaders = {}) {
    const headers = {
      ...extraHeaders,
      "Content-Type": file.contentType,
      "Accept-Ranges": "bytes",
      // Uploaded bytes are never interpreted as anything but the declared audio type.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600"
    };
    let start = 0, end = file.size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? "").trim());
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1; }
      else start = Math.max(0, file.size - Number(range[2]));
      if (start > end || start >= file.size) {
        res.writeHead(416, { ...headers, "Content-Range": `bytes */${file.size}` });
        return res.end();
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") return res.end();
    createReadStream(file.path, { start, end }).on("error", () => res.destroy()).pipe(res);
  }

  async dropRoom(roomId) {
    const files = this.rooms.get(roomId);
    this.rooms.delete(roomId);
    for (const file of files?.values() ?? []) this.total -= file.size;
    await rm(path.join(this.dir, roomId), { recursive: true, force: true });
  }

  close() {
    this.rooms.clear();
    this.total = 0;
    rmSync(this.dir, { recursive: true, force: true });
  }
}
