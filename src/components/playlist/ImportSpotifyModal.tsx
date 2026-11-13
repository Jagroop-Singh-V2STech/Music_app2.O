import { AlertTriangle, ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../common/Modal";
import { useToast } from "../common/Toast";
import { Artwork } from "../music/Artwork";
import { useMusic } from "../../context/MusicContext";
import { importSpotifyPlaylist, matchSpotifyTracks, type SpotifyPlaylist, type SpotifyTrack, type TrackMatch } from "../../services/api";
import { formatTime } from "../../utils/formatTime";
import type { Song } from "../../types/music";

// Experimental: the worker reads Spotify's public embed widget (not an official
// Spotify API). Only songs from our own music source are ever saved; Spotify
// rows are just what we search for.

const SPOTIFY_PLAYLIST = /^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/[A-Za-z0-9]{22}\/?(?:\?.*)?|spotify:playlist:[A-Za-z0-9]{22})$/i;

type Group = "ready" | "check" | "missing";
const groupOf = (m: TrackMatch): Group => m.status === "matched" ? "ready" : m.candidates.length ? "check" : "missing";
const songs = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

export function ImportSpotifyModal({ onClose }: { onClose(): void }) {
  const { playlists, createPlaylist, updatePlaylist } = useMusic();
  const toast = useToast();
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playlist, setPlaylist] = useState<SpotifyPlaylist | null>(null);
  const [matches, setMatches] = useState<(TrackMatch | undefined)[]>([]);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [matching, setMatching] = useState(false);
  const [destination, setDestination] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [existingId, setExistingId] = useState(playlists[0]?.id ?? "");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const fetchPlaylist = async (e: FormEvent) => {
    e.preventDefault();
    const link = url.trim();
    if (!SPOTIFY_PLAYLIST.test(link)) {
      setError("That doesn't look like a Spotify playlist link. It should start with https://open.spotify.com/playlist/");
      return;
    }
    abort.current?.abort();
    setError("");
    setLoading(true);
    try {
      const result = await importSpotifyPlaylist(link);
      const controller = new AbortController();
      abort.current = controller;
      setPlaylist(result);
      setName(result.title);
      setMatches([]);
      setChoice({});
      setSelected(new Set());
      setMatching(true);
      setLoading(false);
      await matchSpotifyTracks(result.tracks, (index, match) => {
        setMatches(m => { const next = [...m]; next[index] = match; return next; });
        const best = match.candidates[0];
        if (best) setChoice(c => ({ ...c, [index]: best.song.id }));
        // Only confident matches start selected; the rest wait for the user.
        if (match.status === "matched") setSelected(s => new Set(s).add(index));
      }, controller.signal);
      if (!controller.signal.aborted) setMatching(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spotify import failed.");
      setPlaylist(null);
      setMatching(false);
      setLoading(false);
    }
  };

  const changeLink = () => {
    abort.current?.abort();
    setPlaylist(null);
    setMatching(false);
    setError("");
  };

  const songFor = (index: number): Song | undefined => {
    const id = choice[index];
    return matches[index]?.candidates.find(c => c.song.id === id)?.song;
  };

  const groups = useMemo(() => {
    const out: Record<Group, number[]> = { ready: [], check: [], missing: [] };
    matches.forEach((m, i) => { if (m) out[groupOf(m)].push(i); });
    return out;
  }, [matches]);
  const total = playlist?.tracks.length ?? 0;
  const done = groups.ready.length + groups.check.length + groups.missing.length;

  // Unique local songs, in playlist order; two Spotify rows can point at the same song.
  const chosenSongs = useMemo(() => {
    const seen = new Set<string>();
    return [...selected].sort((a, b) => a - b).map(songFor).filter((s): s is Song => !!s && !seen.has(s.id) && !!seen.add(s.id));
  }, [selected, choice, matches]);

  const toggle = (index: number) => setSelected(s => { const next = new Set(s); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const toggleGroup = (indexes: number[], on: boolean) => setSelected(s => { const next = new Set(s); indexes.forEach(i => on ? next.add(i) : next.delete(i)); return next; });
  const target = playlists.find(p => p.id === existingId);

  const save = () => {
    if (!chosenSongs.length || !playlist) return;
    if (destination === "new") {
      const created = createPlaylist({ name: (name.trim() || playlist.title).slice(0, 60), description: `Imported from Spotify: ${playlist.title}` });
      updatePlaylist(created.id, chosenSongs);
      toast(`Created “${created.name}” with ${songs(chosenSongs.length)}`, "success");
      navigate(`/playlist/${created.id}`);
    } else {
      if (!target) return;
      const fresh = chosenSongs.filter(s => !target.songs.some(x => x.id === s.id));
      if (fresh.length) updatePlaylist(target.id, [...target.songs, ...fresh]);
      const already = chosenSongs.length - fresh.length;
      toast(fresh.length ? `Added ${songs(fresh.length)} to “${target.name}”${already ? `. ${already} were already there.` : ""}` : `Those songs are already in “${target.name}”`, fresh.length ? "success" : "info");
      navigate(`/playlist/${target.id}`);
    }
    onClose();
  };

  const actionLabel = !chosenSongs.length ? "Select songs to add"
    : destination === "new" ? `Create playlist with ${songs(chosenSongs.length)}`
    : `Add ${songs(chosenSongs.length)}`;

  return (
    <Modal title="Import from Spotify" onClose={onClose} className="spotify-import">
      {!playlist ? (
        <form onSubmit={fetchPlaylist} noValidate>
          <p className="import-lede">Paste a public Spotify playlist. You'll see which songs are in your music and choose the ones to add.</p>
          <label>Playlist link
            <input value={url} onChange={e => { setUrl(e.target.value); setError(""); }} placeholder="https://open.spotify.com/playlist/…" inputMode="url" autoFocus disabled={loading} aria-invalid={!!error} aria-describedby="import-hint" />
          </label>
          {error
            ? <p className="import-error" role="alert"><AlertTriangle aria-hidden="true" /> {error}</p>
            : <p className="import-hint" id="import-hint">In Spotify, open the playlist and choose Share, then Copy link to playlist. Only the first 100 songs can be read.</p>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={loading || !url.trim()}>{loading ? <><Loader2 className="spin" aria-hidden="true" /> Reading playlist…</> : "Find songs"}</button>
          </div>
        </form>
      ) : <>
        <div className="import-source">
          {playlist.image ? <img src={playlist.image} alt="" /> : <span className="import-cover-blank" aria-hidden="true">♫</span>}
          <div>
            <strong>{playlist.title}</strong>
            <span>{songs(total)} from Spotify</span>
          </div>
          <button type="button" className="import-change" onClick={changeLink}>Change link</button>
        </div>
        {playlist.possibly_truncated && <p className="import-warning"><AlertTriangle aria-hidden="true" /> Spotify only shows the first 100 songs of long playlists, so some may be missing here.</p>}

        {total === 0 ? <p className="import-empty">This playlist has no songs to import.</p> : <>
          <div className="match-meter" role="progressbar" aria-label="Songs checked" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <span className="ready" style={{ flexGrow: groups.ready.length }} />
            <span className="check" style={{ flexGrow: groups.check.length }} />
            <span className="missing" style={{ flexGrow: groups.missing.length }} />
            <span className="pending" style={{ flexGrow: total - done }} />
          </div>
          <p className="match-legend" aria-live="polite">
            {matching
              ? <>Looking for each song in your music: {done} of {total} checked</>
              : <><span className="key ready">{groups.ready.length} ready</span><span className="key check">{groups.check.length} to check</span><span className="key missing">{groups.missing.length} not in your music</span></>}
          </p>

          <div className="match-groups">
            {!matching && !groups.ready.length && !groups.check.length && <p className="import-empty">None of these songs are in your music yet.</p>}
            <MatchGroup kind="ready" title="Ready to add" note="Same song and artist in your music." indexes={groups.ready} {...{ playlist, matches, choice, selected, toggle, toggleGroup, setChoice }} />
            <MatchGroup kind="check" title="Check these" note="Close titles or other artists. Pick the right version or leave them out." indexes={groups.check} {...{ playlist, matches, choice, selected, toggle, toggleGroup, setChoice }} />
            {groups.missing.length > 0 && (
              <details className="match-group missing">
                <summary><span>Not in your music</span><span className="count">{groups.missing.length}</span><ChevronDown className="chev" aria-hidden="true" /></summary>
                <ul>{groups.missing.map(i => <li key={i}><SpotifySide track={playlist.tracks[i]} /></li>)}</ul>
              </details>
            )}
          </div>

          <div className="import-footer">
            <div className="segmented" role="radiogroup" aria-label="Where to add songs">
              <button type="button" role="radio" aria-checked={destination === "new"} className={destination === "new" ? "active" : ""} onClick={() => setDestination("new")}>New playlist</button>
              <button type="button" role="radio" aria-checked={destination === "existing"} className={destination === "existing" ? "active" : ""} disabled={!playlists.length} title={playlists.length ? undefined : "You have no playlists yet"} onClick={() => setDestination("existing")}>Existing playlist</button>
            </div>
            {destination === "new"
              ? <input className="import-field" value={name} onChange={e => setName(e.target.value)} maxLength={60} aria-label="Playlist name" placeholder={playlist.title} />
              : <select className="import-field" value={existingId} onChange={e => setExistingId(e.target.value)} aria-label="Playlist">{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
            <div className="import-footer-actions">
              <button type="button" className="secondary import-cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="primary" disabled={!chosenSongs.length || (destination === "existing" && !target)} onClick={save}>{actionLabel}</button>
            </div>
          </div>
        </>}
      </>}
    </Modal>
  );
}

function SpotifySide({ track }: { track: SpotifyTrack }) {
  return (
    <div className="from">
      <strong>{track.title}</strong>
      <span className="meta"><span className="artist">{track.artist}</span>{track.duration_ms ? <span className="dur">{formatTime(track.duration_ms / 1000)}</span> : null}</span>
    </div>
  );
}

interface GroupProps {
  kind: "ready" | "check"; title: string; note: string; indexes: number[];
  playlist: SpotifyPlaylist; matches: (TrackMatch | undefined)[]; choice: Record<number, string>; selected: Set<number>;
  toggle(i: number): void; toggleGroup(indexes: number[], on: boolean): void;
  setChoice: React.Dispatch<React.SetStateAction<Record<number, string>>>;
}

function MatchGroup({ kind, title, note, indexes, playlist, matches, choice, selected, toggle, toggleGroup, setChoice }: GroupProps) {
  const groupBox = useRef<HTMLInputElement>(null);
  const on = indexes.filter(i => selected.has(i)).length;
  useEffect(() => { if (groupBox.current) groupBox.current.indeterminate = on > 0 && on < indexes.length; }, [on, indexes.length]);
  if (!indexes.length) return null;
  return (
    <section className={`match-group ${kind}`}>
      <header>
        <label>
          <input ref={groupBox} type="checkbox" checked={on === indexes.length} onChange={e => toggleGroup(indexes, e.target.checked)} aria-label={`Select all in ${title}`} />
          <h3>{title}</h3>
        </label>
        <span className="count">{on} of {indexes.length} selected</span>
      </header>
      <p className="group-note">{note}</p>
      <ul>
        {indexes.map(i => {
          const track = playlist.tracks[i];
          const candidates = matches[i]!.candidates;
          const song = candidates.find(c => c.song.id === choice[i])?.song ?? candidates[0].song;
          return (
            <li key={i} className={selected.has(i) ? "match-row on" : "match-row"}>
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} aria-label={`Add ${song.title} by ${song.artist}`} />
              <SpotifySide track={track} />
              <ArrowRight className="link-arrow" aria-hidden="true" />
              <div className={candidates.length > 1 ? "to has-choices" : "to"}>
                <Artwork song={song} className="match-art" />
                <div>
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
                {candidates.length > 1 && <>
                  <ChevronDown className="chev" aria-hidden="true" />
                  <select value={song.id} aria-label={`Other versions of ${track.title}`} onChange={e => { const id = e.target.value; setChoice(c => ({ ...c, [i]: id })); if (!selected.has(i)) toggle(i); }}>
                    {candidates.map(c => <option key={c.song.id} value={c.song.id}>{c.song.title}, {c.song.artist}</option>)}
                  </select>
                </>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
