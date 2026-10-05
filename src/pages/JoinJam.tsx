import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LoaderCircle, LogIn, Radio } from "lucide-react";
import { PageHeader } from "../components/common/PageHeader";
import { useToast } from "../components/common/Toast";
import { useJam } from "../context/JamContext";
import { jamSession, normalizeRoomCode, warmUpJamServer } from "../services/jam";

/** /jam — start a new Jam or join one by code. */
export function JoinJam() {
  const jam = useJam();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(jamSession.savedName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"start" | "join">();
  const [error, setError] = useState<string>();
  const hasName = name.trim().length > 0;
  useEffect(warmUpJamServer, []);

  const run = async (kind: "start" | "join") => {
    setError(undefined);
    if (!hasName) { setError("Enter your name so others know who's listening."); return; }
    if (kind === "join" && !normalizeRoomCode(code)) { setError("Enter a valid room code, like JAM-4821AB."); return; }
    setBusy(kind);
    try {
      const roomId = kind === "start" ? await jam.start(name) : await jam.join(code, name);
      navigate(`/jam/${roomId}`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Something went wrong. Try again.";
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(undefined);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void run("join"); };

  return (
    <section className="page jam-entry-page">
      <PageHeader eyebrow="Listen together" title="Jam" subtitle="Start a Jam and everyone you invite can play, pause, skip and add songs. Everyone stays in sync." hue={80} compact />
      {jam.roomId && (
        <div className="jam-callout fade-in">
          <span><i className="jam-dot" aria-hidden="true" /> You're in a Jam right now.</span>
          <Link className="pill light" to={`/jam/${jam.roomId}`}>Open Jam</Link>
        </div>
      )}
      <form className="jam-entry" onSubmit={submit} noValidate>
        <label className="jam-field">
          <span>Your name</span>
          <input value={name} maxLength={32} autoComplete="nickname" autoFocus={!hasName} placeholder="How others will see you" onChange={e => setName(e.target.value)} />
        </label>
        <div className="jam-entry-grid">
          <section className="jam-card">
            <span className="jam-card-icon" aria-hidden="true"><Radio /></span>
            <h2>Start a Jam</h2>
            <p>Bring along what you're playing now, then share the link.</p>
            <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void run("start")}>{busy === "start" ? <LoaderCircle className="spin" /> : null}Start a Jam</button>
          </section>
          <section className="jam-card">
            <span className="jam-card-icon" aria-hidden="true"><LogIn /></span>
            <h2>Join a Jam</h2>
            <label className="jam-field compact">
              <span className="visually-hidden">Room code</span>
              <input value={code} placeholder="Enter room code" autoCapitalize="characters" spellCheck={false} onChange={e => setCode(e.target.value.toUpperCase())} />
            </label>
            <button type="submit" className="secondary" disabled={Boolean(busy) || !code.trim()}>{busy === "join" ? <LoaderCircle className="spin" /> : null}Join Jam</button>
          </section>
        </div>
        {error && <p className="jam-error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
