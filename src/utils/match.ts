import type { Song } from "../types/music";

// Text matching shared by search (services/api.ts) and Spotify import.
// Dependency-free so it can be unit-tested directly.

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

// Average, over the query words, of the best similarity to any word of the
// song's title, artist or page slug (which also carries the album/movie name).
export function matchScore(song: Song, words: string[]): number {
  const hay = tokenize(`${song.title} ${song.artist} ${song.pageUrl}`);
  const best = (w: string) =>
    Math.max(0, ...hay.map((h) => (h.startsWith(w) ? 1 : similarity(w, h))));
  return words.reduce((sum, w) => sum + best(w), 0) / words.length;
}

// Dice coefficient over character bigrams; tolerant of small typos.
function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n) {
      shared++;
      grams.set(g, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

// ---------- Spotify import matching ----------

export type MatchStatus = "matched" | "possible" | "unmatched";
export interface MatchCandidate { song: Song; score: number }

const MAX_CANDIDATES = 5;

// "Kesariya (From "Brahmastra")", "Song - Remastered 2011", "Song [Live]",
// "Song (feat. X)" → "Kesariya", "Song". The music source titles songs plainly.
export function cleanTrackTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || title.trim();
}

// Import needs "is this the same song?", which is stricter than search's
// "is this worth showing?": matchScore() also searches the page slug and
// accepts word prefixes, so "blue" would match "Blue Hai Paani Paani".
// Here titles are compared both ways (every word of each must appear in the
// other) and artists only against artists, with the same word similarity.

// Average, over `words`, of the best similarity to any of `others`.
function coverage(words: string[], others: string[]): number {
  if (!words.length || !others.length) return 0;
  return words.reduce((sum, w) => sum + Math.max(...others.map(o => similarity(w, o))), 0) / words.length;
}

export interface TrackMatchScore { score: number; title: number; artist: number }

export function scoreTrackMatch(song: Song, track: { title: string; artist: string }): TrackMatchScore {
  const wanted = tokenize(cleanTrackTitle(track.title));
  const found = tokenize(cleanTrackTitle(song.title));
  const title = Math.min(coverage(wanted, found), coverage(found, wanted));
  const localArtist = tokenize(song.artist);
  // Best of the credited artists: Spotify lists composers first ("Sachin-Jigar, Arijit Singh").
  const artist = Math.max(0, ...track.artist.split(",").map(a => coverage(tokenize(a), localArtist)));
  return { score: 0.65 * title + 0.35 * artist, title, artist };
}

// Preselected only when the title is the same and a credited artist matches.
const CONFIDENT = { title: 0.9, artist: 0.75 };
// Worth offering, unselected, when the title is close whoever sings it.
const POSSIBLE_TITLE = 0.75;

export function rankMatches(track: { title: string; artist: string }, songs: Song[]): { status: MatchStatus; candidates: MatchCandidate[] } {
  const seen = new Set<string>();
  const scored = songs
    .filter(s => !seen.has(s.id) && seen.add(s.id))
    .map(song => ({ song, ...scoreTrackMatch(song, track) }))
    .filter(c => c.title >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
  const best = scored[0];
  const status: MatchStatus = !best ? "unmatched"
    : best.title >= CONFIDENT.title && best.artist >= CONFIDENT.artist ? "matched"
    : best.title >= POSSIBLE_TITLE ? "possible"
    : "unmatched";
  return { status, candidates: scored.map(({ song, score }) => ({ song, score })) };
}
