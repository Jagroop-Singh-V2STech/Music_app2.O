import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Headphones, Link2, LoaderCircle, LogOut, Play, Plus, Share2, Users } from "lucide-react";
import { useJam } from "../context/JamContext";
import { usePlayer } from "../context/PlayerContext";
import { jamErrorMessage, jamInviteUrl, jamSession, normalizeRoomCode, warmUpJamServer } from "../services/jam";
import type { JamCause, JamRoomState, JamUser } from "../types/jam";
import { Artwork } from "../components/music/Artwork";
import { ProgressBar } from "../components/player/ProgressBar";
import { PlayerControls } from "../components/player/PlayerControls";
import { EmptyState } from "../components/common/EmptyState";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
import { useToast } from "../components/common/Toast";
import { JamParticipants } from "../components/jam/JamParticipants";
import { JamQueue } from "../components/jam/JamQueue";
import { JamConnection } from "../components/jam/JamConnection";
import { JamAddSongModal } from "../components/jam/JamAddSongModal";
import { formatTime } from "../utils/formatTime";
import { hueFrom } from "../utils/library";

/** /jam/:roomId — the room itself, or a join prompt when you arrive from an invite link. */
export function JamRoom() {
  const { roomId: param = "" } = useParams();
  const code = normalizeRoomCode(param);
  const jam = useJam();
  if (!code) return <JamGone code="ROOM_NOT_FOUND" />;
  if (jam.roomId === code) return jam.room ? <RoomView room={jam.room} /> : <section className="page jam-page"><Loading rows={3} /></section>;
  if (jam.problem?.roomId === code) return <JamGone code={jam.problem.code} message={jam.problem.message} />;
  return <JoinPrompt code={code} />;
}

function JamGone({ code, message }: { code: string; message?: string }) {
  const { clearProblem } = useJam();
  const title = code === "ROOM_ENDED" ? "This Jam has ended" : code === "ROOM_EXPIRED" ? "This Jam expired" : code === "REMOVED_FROM_ROOM" ? "You were removed" : code === "ROOM_FULL" ? "This Jam is full" : code === "UNAUTHORIZED" ? "Your session expired" : "Jam not found";
  return (
    <section className="page jam-page">
      <EmptyState icon={<Headphones />} title={title} copy={message ?? jamErrorMessage(code)} action={<Link className="pill light" to="/jam" onClick={clearProblem}>Start or join another Jam</Link>} />
    </section>
  );
}

function JoinPrompt({ code }: { code: string }) {
  const jam = useJam();
  const toast = useToast();
  const [name, setName] = useState(jamSession.savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string }>();
  useEffect(warmUpJamServer, []);

  // Joining is an explicit tap on purpose: it also counts as the gesture browsers require before audio can play.
  const join = async () => {
    if (!name.trim()) { setError({ code: "NAME_REQUIRED", message: "Enter your name so others know who's listening." }); return; }
    setBusy(true);
    setError(undefined);
    try { await jam.join(code, name); }
    catch (failure) {
      const info = { code: (failure as { code?: string }).code ?? "NETWORK_ERROR", message: failure instanceof Error ? failure.message : "Couldn't join the Jam." };
      setError(info);
      toast(info.message, "error");
    } finally { setBusy(false); }
  };

  if (error && ["ROOM_NOT_FOUND", "ROOM_ENDED", "ROOM_EXPIRED", "REMOVED_FROM_ROOM", "ROOM_FULL"].includes(error.code)) return <JamGone code={error.code} message={error.message} />;
  return (
    <section className="page jam-page">
      <form className="jam-join-card fade-up" onSubmit={e => { e.preventDefault(); void join(); }} noValidate>
        <span className="jam-card-icon" aria-hidden="true"><Users /></span>
        <span className="eyebrow">You're invited</span>
        <h1>Join the Jam</h1>
        <p className="muted">Room <span className="jam-code">{code}</span>. Everyone listens together and anyone can control the music.</p>
        {jam.roomId && <p className="jam-note">Joining will take you out of your current Jam.</p>}
        <label className="jam-field">
          <span>Your name</span>
          <input value={name} maxLength={32} autoComplete="nickname" autoFocus placeholder="How others will see you" onChange={e => setName(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Headphones />}Join Jam</button>
        {error && <p className="jam-error" role="alert">{error.message}</p>}
      </form>
    </section>
  );
}

function describe(cause: JamCause, me: JamUser | undefined, room: JamRoomState) {
  const who = cause.userId === me?.id ? "You" : cause.name ?? "Someone";
  const song = cause.title ? `“${cause.title}”` : "the next song";
  switch (cause.type) {
    case "PLAY": return `${who} pressed play`;
    case "PAUSE": return `${who} paused`;
    case "SEEK": return `${who} jumped to ${formatTime(cause.position ?? room.position)}`;
    case "NEXT": return cause.title ? (cause.auto ? `Up next: ${song}` : `${who} skipped to ${song}`) : "That's the end of the queue";
    case "PREVIOUS": return cause.restarted ? `${who} restarted the song` : `${who} went back to ${song}`;
    case "SONG_CHANGED": return `${who} played ${song}`;
    case "QUEUE_ITEM_ADDED": return (cause.count ?? 1) > 1 ? `${who} added ${cause.count} songs` : `${who} added ${song}`;
    case "QUEUE_ITEM_REMOVED": return `${who} removed ${song}`;
    case "QUEUE_REORDERED": return `${who} reordered the queue`;
    case "QUEUE_CLEARED": return `${who} cleared the queue`;
    case "PARTICIPANT_JOINED": return `${who === "You" ? "You" : cause.name} joined the Jam`;
    case "PARTICIPANT_LEFT": return `${cause.name} left the Jam`;
    case "PARTICIPANT_REMOVED": return `${cause.name} was removed`;
    case "HOST_CHANGED": return `${cause.newHostId === me?.id ? "You are" : `${cause.name} is`} now the host`;
    default: return undefined;
  }
}

function RoomView({ room }: { room: JamRoomState }) {
  const jam = useJam();
  const { error } = usePlayer();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const song = room.currentItem?.song;
  const online = room.participants.filter(p => p.online).length;
  const activity = jam.lastCause && describe(jam.lastCause, jam.me, room);
  const invite = jamInviteUrl(room.roomId);

  const copy = async () => {
    try { await navigator.clipboard.writeText(invite); toast("Invite link copied"); }
    catch { toast(`Couldn't copy. Share the code ${room.roomId} instead.`, "error"); }
  };
  const share = typeof navigator.share === "function"
    ? () => void navigator.share({ title: room.name, text: `Join my Jam on MyMusic (${room.roomId})`, url: invite }).catch(() => undefined)
    : undefined;

  return (
    <section className="page jam-page" style={{ "--hue": hueFrom(song?.title ?? room.name) } as React.CSSProperties}>
      <header className="jam-hero">
        <span className="eyebrow jam-eyebrow"><Headphones aria-hidden="true" /> Jam session</span>
        <h1>{room.name}</h1>
        <p className="jam-meta">
          <span>{online} {online === 1 ? "person" : "people"} listening</span>
          <span className="jam-code" title="Room code">{room.roomId}</span>
          <JamConnection status={jam.status} />
        </p>
      </header>

      {jam.needsGesture && <button className="primary jam-unlock fade-up" onClick={jam.unlockAudio}><Play fill="currentColor" /> Tap to start listening</button>}

      <div className="jam-layout">
        <section className="jam-stage" aria-label="Now playing">
          <div className="jam-art fade-in" key={room.currentItem?.itemId ?? "empty"}><Artwork song={song} seed={song?.title ?? room.name} /></div>
          <div className="jam-now">
            <h2 key={room.currentItem?.itemId} className="fade-in">{song?.title ?? "Nothing playing yet"}</h2>
            <p>{song ? song.artist : "Add a song to get the Jam going"}</p>
            {song && error && <p className="np-error">{error}</p>}
          </div>
          <fieldset className="jam-controls" disabled={!jam.connected || !song}>
            <legend className="visually-hidden">Playback controls, shared with everyone</legend>
            <ProgressBar />
            <PlayerControls large />
          </fieldset>
          <p className="jam-activity" aria-live="polite">{activity && <span key={jam.lastCause?.at} className="fade-in">{activity}</span>}</p>
        </section>

        <div className="jam-side">
          <section className="jam-panel">
            <div className="jam-panel-head"><h2>People listening</h2><span className="jam-count">{room.participants.length}/{room.maxParticipants}</span></div>
            <JamParticipants />
          </section>
          <section className="jam-panel">
            <div className="jam-panel-head"><h2>Shared queue</h2><button className="pill outline" disabled={!jam.connected} onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Add songs</button></div>
            <JamQueue />
          </section>
        </div>
      </div>

      <footer className="jam-actions">
        <button className="primary" onClick={() => void copy()}><Link2 aria-hidden="true" /> Copy invite link</button>
        {share && <button className="secondary" onClick={share}><Share2 aria-hidden="true" /> Share</button>}
        <button className="secondary" onClick={() => void jam.leave()}><LogOut aria-hidden="true" /> Leave Jam</button>
        {jam.isHost && <button className="text-btn jam-end" onClick={() => setConfirmEnd(true)}>End Jam for everyone</button>}
      </footer>

      {adding && <JamAddSongModal onClose={() => setAdding(false)} />}
      {confirmEnd && (
        <Modal title="End the Jam for everyone?" onClose={() => setConfirmEnd(false)}>
          <p className="muted">Everyone will be disconnected and the invite link will stop working. To hand over instead, make someone else the host and leave.</p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setConfirmEnd(false)}>Cancel</button>
            <button className="primary danger" onClick={() => { setConfirmEnd(false); void jam.end(); }}>End Jam</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
