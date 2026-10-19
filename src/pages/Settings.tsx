import { useState, type ReactNode } from "react";
import { Keyboard } from "lucide-react";
import { PageHeader } from "../components/common/PageHeader";
import { Modal } from "../components/common/Modal";
import { useToast } from "../components/common/Toast";
import { useSettings } from "../context/SettingsContext";
import { useMusic } from "../context/MusicContext";
import { useOffline } from "../context/OfflineContext";
import { jamSession } from "../services/jam";
import { musicStorage } from "../utils/storage";

function Row({ title, copy, children }: { title: string; copy?: string; children: ReactNode }) {
  return <div className="setting-row"><div className="setting-copy"><strong>{title}</strong>{copy && <small>{copy}</small>}</div><div className="setting-control">{children}</div></div>;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange(value: boolean): void; label: string }) {
  return <label className="switch"><input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={e => onChange(e.target.checked)} /><span aria-hidden="true" /></label>;
}

type Confirm = { title: string; copy: string; action: string; run(): void };

export function Settings({ onShortcuts }: { onShortcuts(): void }) {
  const { settings, update } = useSettings();
  const { recent, clearRecent } = useMusic();
  const offline = useOffline();
  const toast = useToast();
  const [name, setName] = useState(jamSession.savedName);
  const [confirm, setConfirm] = useState<Confirm>();

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast("Enter a name", "error"); return; }
    jamSession.setName(trimmed);
    toast("Jam name saved. It's used the next time you start or join a Jam.");
  };

  return (
    <section className="page settings-page">
      <PageHeader eyebrow="Your preferences" title="Settings" hue={150} compact />

      <section className="settings-group">
        <h2>Playback</h2>
        <Row title="Autoplay" copy="Play the next song in your queue when one finishes.">
          <Switch label="Autoplay" checked={settings.autoplay} onChange={autoplay => update({ autoplay })} />
        </Row>
        <Row title="Sleep timer fade" copy="Gently lower the volume before the sleep timer stops the music.">
          <select className="setting-select" aria-label="Sleep timer fade" value={settings.sleepFadeSeconds} onChange={e => update({ sleepFadeSeconds: Number(e.target.value) })}>
            <option value={0}>Off</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option><option value={30}>30 seconds</option>
          </select>
        </Row>
      </section>

      <section className="settings-group">
        <h2>Lyrics</h2>
        <Row title="Hindi & Punjabi lyrics" copy="Show lyrics in Hinglish (“mujhe ishq hua”) or in the original script (“मुझे इश्क़ हुआ”).">
          <div className="segmented" role="radiogroup" aria-label="Lyrics script">
            {(["hinglish", "original"] as const).map(script => (
              <button key={script} role="radio" aria-checked={settings.lyricsScript === script} className={settings.lyricsScript === script ? "active" : ""} onClick={() => update({ lyricsScript: script })}>{script === "hinglish" ? "Hinglish" : "Original"}</button>
            ))}
          </div>
        </Row>
      </section>

      <section className="settings-group">
        <h2>Jam</h2>
        <Row title="Display name" copy="How others see you in a Jam.">
          <form className="setting-inline" onSubmit={e => { e.preventDefault(); saveName(); }}>
            <input className="setting-input" value={name} maxLength={32} placeholder="Your name" aria-label="Jam display name" onChange={e => setName(e.target.value)} />
            <button className="pill outline" type="submit" disabled={!name.trim() || name.trim() === jamSession.savedName()}>Save</button>
          </form>
        </Row>
      </section>

      <section className="settings-group">
        <h2>Storage</h2>
        <Row title="Listening history" copy={`${recent.length} recently played ${recent.length === 1 ? "song" : "songs"}.`}>
          <button className="pill outline" disabled={!recent.length} onClick={() => setConfirm({ title: "Clear listening history?", copy: "Recently played songs and the mixes built from them will be reset.", action: "Clear history", run: () => { clearRecent(); toast("Listening history cleared"); } })}>Clear</button>
        </Row>
        <Row title="Downloads" copy={`${offline.songs.length} ${offline.songs.length === 1 ? "song" : "songs"} saved for offline listening.`}>
          <button className="pill outline" disabled={!offline.songs.length} onClick={() => setConfirm({ title: "Remove all downloads?", copy: "These songs won't play offline until you download them again.", action: "Remove all", run: () => { void offline.remove(offline.songs.map(song => song.id)); toast("Removed all downloads"); } })}>Remove all</button>
        </Row>
        <Row title="Search history" copy="Your recent searches on the Search page.">
          <button className="pill outline" onClick={() => setConfirm({ title: "Clear search history?", copy: "Your recent searches will be removed.", action: "Clear", run: () => { musicStorage.setSearches([]); toast("Search history cleared"); } })}>Clear</button>
        </Row>
      </section>

      <section className="settings-group">
        <h2>Help</h2>
        <Row title="Keyboard shortcuts" copy="Press ? anywhere to see them.">
          <button className="pill outline" onClick={onShortcuts}><Keyboard aria-hidden="true" /> Show</button>
        </Row>
      </section>

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(undefined)}>
          <p className="muted">{confirm.copy}</p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setConfirm(undefined)}>Cancel</button>
            <button className="primary danger" onClick={() => { confirm.run(); setConfirm(undefined); }}>{confirm.action}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
