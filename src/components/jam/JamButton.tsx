import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LoaderCircle, Play, Users } from "lucide-react";
import { useJam } from "../../context/JamContext";
import { jamSession } from "../../services/jam";
import { useToast } from "../common/Toast";

/** Player entry point: "Start a Jam", or "Open your Jam" while you're in one. */
export function JamButton({ className = "" }: { className?: string }) {
  const jam = useJam();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (jam.roomId) {
    return <button className={`icon-button active jam-button live ${className}`} aria-label="Open your Jam" title="Open your Jam" onClick={() => navigate(`/jam/${jam.roomId}`)}><Users /></button>;
  }
  const start = async () => {
    // First time: the Jam page asks for a display name before starting.
    if (!jamSession.get()) { navigate("/jam"); return; }
    setBusy(true);
    try { navigate(`/jam/${await jam.start()}`); }
    catch (error) { toast(error instanceof Error ? error.message : "Couldn't start a Jam. Try again.", "error"); }
    finally { setBusy(false); }
  };
  return <button className={`icon-button jam-button ${className}`} aria-label="Start a Jam" title="Start a Jam" disabled={busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" /> : <Users />}</button>;
}

/** Header indicator while in a Jam (always visible, including on mobile). */
export function JamPill() {
  const { roomId, room, status, needsGesture, unlockAudio } = useJam();
  if (!roomId) return null;
  if (needsGesture) return <button className="offline-pill jam-pill attention" onClick={unlockAudio}><Play aria-hidden="true" />Tap to listen</button>;
  const online = room?.participants.filter(p => p.online).length ?? 0;
  return (
    <Link to={`/jam/${roomId}`} className={`offline-pill jam-pill ${status}`} title={status === "connected" ? "Open your Jam" : "Reconnecting to your Jam…"}>
      <i className="jam-dot" aria-hidden="true" />Jam{room ? ` · ${online}` : ""}
    </Link>
  );
}
