import { useState } from "react";
import { Crown, UserX } from "lucide-react";
import { useJam } from "../../context/JamContext";
import type { JamParticipant } from "../../types/jam";
import { hueFrom } from "../../utils/library";
import { Modal } from "../common/Modal";

type Confirm = { kind: "remove" | "host"; person: JamParticipant };

export function JamParticipants() {
  const { room, me, isHost, connected, removeParticipant, transferHost } = useJam();
  const [confirm, setConfirm] = useState<Confirm>();
  if (!room) return null;

  // Host first, then you, then whoever is online, oldest first.
  const people = [...room.participants].sort((a, b) =>
    Number(b.id === room.hostId) - Number(a.id === room.hostId) || Number(b.id === me?.id) - Number(a.id === me?.id) || Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt);

  const run = async () => {
    if (!confirm) return;
    const { kind, person } = confirm;
    setConfirm(undefined);
    await (kind === "remove" ? removeParticipant(person.id) : transferHost(person.id));
  };

  return (
    <>
      <ul className="jam-people">
        {people.map(person => (
          <li key={person.id} className={`jam-person ${person.online ? "" : "away"}`}>
            <span className="jam-avatar" style={{ "--hue": hueFrom(person.name) } as React.CSSProperties} aria-hidden="true">{person.name.charAt(0).toUpperCase()}<i className="jam-dot" /></span>
            <span className="jam-person-copy">
              <strong>{person.name}{person.id === me?.id && <span className="jam-you"> (you)</span>}</strong>
              <small>{person.online ? "Listening" : "Away"}</small>
            </span>
            {person.id === room.hostId && <span className="jam-badge">Host</span>}
            {isHost && person.id !== me?.id && (
              <span className="jam-person-actions">
                <button className="icon-button" disabled={!connected} aria-label={`Make ${person.name} the host`} title="Make host" onClick={() => setConfirm({ kind: "host", person })}><Crown /></button>
                <button className="icon-button" disabled={!connected} aria-label={`Remove ${person.name} from the Jam`} title="Remove" onClick={() => setConfirm({ kind: "remove", person })}><UserX /></button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <Modal title={confirm.kind === "remove" ? `Remove ${confirm.person.name}?` : `Make ${confirm.person.name} the host?`} onClose={() => setConfirm(undefined)}>
          <p className="muted">{confirm.kind === "remove"
            ? "They'll leave the Jam right away and can't rejoin it."
            : "They'll be able to remove people and end the Jam. Everyone can still control the music."}</p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setConfirm(undefined)}>Cancel</button>
            <button className={`primary ${confirm.kind === "remove" ? "danger" : ""}`} onClick={() => void run()}>{confirm.kind === "remove" ? "Remove" : "Make host"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
