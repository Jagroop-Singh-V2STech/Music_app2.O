import type { Song } from "../types/music";
import { primaryArtist } from "../utils/library";
import { hasIndicScript, isLatinText, romanize } from "../utils/romanize";

// Lyrics come from LRCLIB (https://lrclib.net): free, keyless, CORS-enabled, with time-synced lyrics.
const BASE = "https://lrclib.net/api";

export interface LyricsCandidate { trackName: string; artistName: string; duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null }
export interface LyricLine { time: number; text: string }
export type Lyrics = { kind: "synced"; lines: LyricLine[] } | { kind: "plain"; lines: string[] } | { kind: "instrumental" };

const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// "Kesariya (From "Brahmastra")" -> "Kesariya"; also drops "- From ...", "feat." tails.
const cleanTitle = (title: string) => title.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s+-\s+from\b.*$/i, "").replace(/\s+(feat|ft)\.?\s.*$/i, "").replace(/\s+/g, " ").trim();
const artistsOf = (artist: string) => artist.split(/,|&| x | feat\.? | ft\.? /i).map(normalize).filter(Boolean);

function score(song: Song, c: LyricsCandidate, duration?: number) {
  const title = normalize(cleanTitle(song.title)), name = normalize(c.trackName);
  const wanted = normalize(song.artist), have = normalize(c.artistName);
  let points = name === title ? 50 : name.startsWith(title) || title.startsWith(name) ? 30 : name.includes(title) ? 15 : 0;
  if (have.includes(normalize(primaryArtist(song.artist)))) points += 30;
  else if (wanted.split(" ").some(word => word.length > 2 && have.includes(word))) points += 10;
  if (c.syncedLyrics) points += 15; else if (!c.plainLyrics && !c.instrumental) points -= 100;
  // Lyrics are shown in English letters: a version already typed that way beats our romanization,
  // and scripts we can't romanize (e.g. Urdu) rank last. Synced still beats plain.
  const text = c.syncedLyrics || c.plainLyrics || "";
  if (text && isLatinText(text)) points += 12;
  else if (text && !hasIndicScript(text)) points -= 25;
  if (duration && c.duration) points -= Math.min(30, Math.abs(c.duration - duration) * 2);
  return points;
}

async function search(params: Record<string, string>) {
  const response = await fetch(`${BASE}/search?${new URLSearchParams(params)}`);
  if (!response.ok) throw new Error("Lyrics are unavailable right now");
  return (await response.json()) as LyricsCandidate[];
}

// Returns the most plausible matches (best first); the final pick happens once the song's duration is known.
export async function fetchLyricsCandidates(song: Song): Promise<LyricsCandidate[]> {
  const track_name = cleanTitle(song.title), artist = primaryArtist(song.artist);
  let found = await search({ track_name, artist_name: artist });
  if (!found.length) found = await search({ q: `${track_name} ${artist}` });
  if (!found.length) found = (await search({ track_name })).filter(c => artistsOf(song.artist).some(a => normalize(c.artistName).includes(a)));
  return found.map(c => ({ c, s: score(song, c) })).filter(x => x.s >= 40).sort((a, b) => b.s - a.s).slice(0, 5).map(x => x.c);
}

export function pickLyrics(song: Song, candidates: LyricsCandidate[], duration?: number): Lyrics | null {
  const best = [...candidates].sort((a, b) => score(song, b, duration) - score(song, a, duration))[0];
  if (!best) return null;
  if (best.instrumental) return { kind: "instrumental" };
  if (best.syncedLyrics) { const lines = parseLrc(best.syncedLyrics); if (lines.length) return { kind: "synced", lines: lines.map(l => ({ ...l, text: romanize(l.text) })) }; }
  return best.plainLyrics ? { kind: "plain", lines: best.plainLyrics.split("\n").map(romanize) } : null;
}

// "[01:02.34] text" — a line may carry several timestamps.
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    stamps.forEach(m => lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text }));
  }
  return lines.sort((a, b) => a.time - b.time);
}
