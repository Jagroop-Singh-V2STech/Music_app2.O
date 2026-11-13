import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../common/Modal";
import { useToast } from "../common/Toast";
import { useMusic } from "../../context/MusicContext";
import { importSpotifyPlaylist, matchSpotifyTracks, type SpotifyPlaylist, type TrackMatch } from "../../services/api";
import { formatTime } from "../../utils/formatTime";
import type { Song } from "../../types/music";

// Experimental: the worker reads Spotify's public embed widget (not an official
// Spotify API). Only songs from our own music source are ever saved; Spotify
// rows are just what we search for.

const SPOTIFY_PLAYLIST = /^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/[A-Za-z0-9]{22}\/?(?:\?.*)?|spotify:playlist:[A-Za-z0-9]{22})$/i;

const STATUS_LABEL = { matched: "Matched", possible: "Check match", unmatched: "Not found" } as const;
const STATUS_ICON = { matched: CheckCircle2, possible: CircleHelp, unmatched: XCircle } as const;

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
      setError("Paste a Spotify playlist link, like https://open.spotify.com/playlist/…");
      return;
    }
    abort.current?.abort();
    setError("");
    setLoading(true);
    setPlaylist(null);
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
      setMatching(false);
    } finally {
      setLoading(false);
    }
  };

  const songFor = (index: number): Song | undefined => {
    const id = choice[index];
    return matches[index]?.candidates.find(c => c.song.id === id)?.song;
  };

  const counts = useMemo(() => {
    const done = matches.filter(Boolean) as TrackMatch[];
    return {
      done: done.length,
      matched: done.filter(m => m.status === "matched").length,
      possible: done.filter(m => m.status === "possible").length,
      unmatched: done.filter(m => m.status === "unmatched" || !m.candidates.length).length,
    };
  }, [matches]);

  // Unique local songs, in playlist order; two Spotify rows can point at the same song.
  const chosenSongs = useMemo(() => {
    const seen = new Set<string>();
    return [...selected].sort((a, b) => a - b).map(songFor).filter((s): s is Song => !!s && !seen.has(s.id) && !!seen.add(s.id));
  }, [selected, choice, matches]);

  const selectable = (index: number) => !!matches[index]?.candidates.length;
  const toggle = (index: number) => setSelected(s => { const next = new Set(s); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  // Weak "not found" guesses stay manual-only.
  const selectAll = () => setSelected(new Set(matches.flatMap((m, i) => (m && m.candidates.length && m.status !== "unmatched" ? [i] : []))));

  const save = () => {
    if (!chosenSongs.length) return;
    if (destination === "new") {
      const title = name.trim() || playlist!.title;
      const created = createPlaylist({ name: title.slice(0, 60), description: `Imported from Spotify: ${playlist!.title}` });
      updatePlaylist(created.id, chosenSongs);
      toast(`Created “${created.name}” with ${chosenSongs.length} ${chosenSongs.length === 1 ? "song" : "songs"}`, "success");
      navigate(`/playlist/${created.id}`);
    } else {
      const target = playlists.find(p => p.id === existingId);
      if (!target) return;
      const fresh = chosenSongs.filter(s => !target.songs.some(x => x.id === s.id));
      if (fresh.length) updatePlaylist(target.id, [...target.songs, ...fresh]);
      const already = chosenSongs.length - fresh.length;
      toast(fresh.length ? `Added ${fresh.length} ${fresh.length === 1 ? "song" : "songs"} to “${target.name}”${already ? ` (${already} already there)` : ""}` : `All selected songs are already in “${target.name}”`, fresh.length ? "success" : "info");
      navigate(`/playlist/${target.id}`);
    }
    onClose();
  };

  return (
    <Modal title="Import from Spotify" onClose={onClose} className="spotify-import">
      <p className="muted import-note">Experimental: reads the playlist from Spotify's public player widget, then looks for each song in your music. Up to about 100 songs.</p>
      <form className="import-url" onSubmit={fetchPlaylist}>
        <label>Spotify playlist link
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/…" inputMode="url" autoFocus={!playlist} disabled={loading} />
        </label>
        <button className="primary" disabled={loading || !url.trim()}>{loading ? <><Loader2 className="spin" /> Fetching…</> : "Fetch playlist"}</button>
      </form>
      {error && <p className="import-error" role="alert"><AlertTriangle /> {error}</p>}

      {playlist && <>
        <div className="import-head">
          {playlist.image ? <img src={playlist.image} alt="" /> : <span className="import-cover-blank">♫</span>}
          <div>
            <strong>{playlist.title}</strong>
            <span className="muted">{playlist.tracks.length} {playlist.tracks.length === 1 ? "song" : "songs"} on Spotify{playlist.skipped_tracks ? ` · ${playlist.skipped_tracks} skipped (episodes or duplicates)` : ""}</span>
            <span className="muted">{matching ? <><Loader2 className="spin inline-icon" /> Finding songs… {counts.done}/{playlist.tracks.length}</> : `${counts.matched} matched · ${counts.possible} to check · ${counts.unmatched} not found`}</span>
          </div>
        </div>
        {playlist.possibly_truncated && <p className="import-warning"><AlertTriangle /> Spotify's widget only lists the first 100 songs, so this playlist may have more that can't be imported.</p>}

        {!playlist.tracks.length ? <p className="muted import-empty">This playlist has no songs to import.</p> : <>
          <div className="import-toolbar">
            <span>{chosenSongs.length} selected</span>
            <button type="button" className="chip" onClick={selectAll} disabled={matching && !counts.done}>Select all with a match</button>
            <button type="button" className="chip" onClick={() => setSelected(new Set())}>Deselect all</button>
          </div>
          <div className="import-table-wrap">
            <table className="import-table">
              <thead><tr><th aria-label="Selected" /><th>Spotify song</th><th className="col-time">Time</th><th>Your music</th></tr></thead>
              <tbody>
                {playlist.tracks.map((t, i) => {
                  const m = matches[i];
                  const status = m ? (m.candidates.length ? m.status : "unmatched") : null;
                  const Icon = status ? STATUS_ICON[status] : Loader2;
                  return (
                    <tr key={t.spotify_id ?? i} className={status === "unmatched" ? "is-unmatched" : undefined}>
                      <td><input type="checkbox" aria-label={`Import ${t.title}`} checked={selected.has(i)} disabled={!selectable(i)} onChange={() => toggle(i)} /></td>
                      <td><strong>{t.title}</strong><span className="muted">{t.artist}</span></td>
                      <td className="col-time muted">{t.duration_ms ? formatTime(t.duration_ms / 1000) : "–"}</td>
                      <td>
                        <span className={`match-badge ${status ?? "pending"}`}><Icon className={status ? undefined : "spin"} /> {status ? STATUS_LABEL[status] : "Searching"}</span>
                        {m && m.candidates.length > 0 && (
                          <select value={choice[i] ?? ""} aria-label={`Match for ${t.title}`} onChange={e => { setChoice(c => ({ ...c, [i]: e.target.value })); setSelected(s => new Set(s).add(i)); }}>
                            {m.candidates.map(c => <option key={c.song.id} value={c.song.id}>{c.song.title} — {c.song.artist}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <fieldset className="import-destination">
            <legend>Save to</legend>
            <label className="radio"><input type="radio" checked={destination === "new"} onChange={() => setDestination("new")} /> New playlist</label>
            {destination === "new" && <input value={name} onChange={e => setName(e.target.value)} maxLength={60} aria-label="New playlist name" placeholder={playlist.title} />}
            <label className="radio"><input type="radio" checked={destination === "existing"} disabled={!playlists.length} onChange={() => setDestination("existing")} /> Existing playlist{!playlists.length && " (none yet)"}</label>
            {destination === "existing" && <select value={existingId} onChange={e => setExistingId(e.target.value)} aria-label="Existing playlist">{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          </fieldset>
        </>}
      </>}

      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        {playlist && playlist.tracks.length > 0 && <button type="button" className="primary" disabled={!chosenSongs.length || (destination === "existing" && !existingId)} onClick={save}>Import {chosenSongs.length || ""} {chosenSongs.length === 1 ? "song" : "songs"}</button>}
      </div>
    </Modal>
  );
}
