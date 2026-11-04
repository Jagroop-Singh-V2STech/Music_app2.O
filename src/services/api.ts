import type { Song } from "../types/music";
const base = "https://music-be.jagroop-singh-v2stech.workers.dev";
export async function searchExact(query: string): Promise<Song[]> {
  const response = await fetch(
    `${base}/api/search?find=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error("Search is unavailable");
  return parseSearchResults(await response.text());
}

// The upstream only matches the whole query as one literal substring and
// returns ~6 songs, so "kesariya arijit", a typo like "kesarya", or a common
// word like "khat" (crowded out by "Khatarnak Jasoos") miss the song you want.
// - few results: also search each word (and shorter stems of it) and rank the
//   merged results by how well they match every query word;
// - no song titled exactly the query: look for albums with that exact name
//   (the worker pages through all album results) and pull in their songs.
const ENOUGH_RESULTS = 4;
const MAX_EXTRA_QUERIES = 6;
const MAX_ALBUM_WORDS = 3;
const MAX_NAMED_ALBUMS = 3;

export async function searchSongs(query: string): Promise<Song[]> {
  const phrase = query.trim().replace(/\s+/g, " ");
  const exact = await searchExact(phrase);
  const words = tokenize(phrase);
  const named = (s: Song) => tokenize(s.title).join(" ") === words.join(" ");
  // A song titled exactly what was typed is the top result.
  const namedFirst = (songs: Song[]) => [
    ...songs.filter(named),
    ...songs.filter((s) => !named(s)),
  ];
  const wantAlbums =
    words.length > 0 && words.length <= MAX_ALBUM_WORDS && !exact.some(named);
  const wantFuzzy = words.length > 0 && exact.length < ENOUGH_RESULTS;
  if (!wantAlbums && !wantFuzzy) return namedFirst(exact);

  const [albumSongs, fuzzy] = await Promise.all([
    wantAlbums ? songsFromNamedAlbums(phrase, words).catch(() => []) : [],
    wantFuzzy ? fuzzySearch(phrase, words) : [],
  ]);
  const seen = new Set<string>();
  return namedFirst(
    [...exact, ...albumSongs, ...fuzzy].filter(
      (s) => !seen.has(s.id) && seen.add(s.id),
    ),
  );
}

interface AlbumResult {
  url: string;
  name: string;
  year: number | null;
}
interface AlbumPage {
  name: string;
  imageUrl: string | null;
  songs: { pageUrl: string; title: string; artist: string }[];
}

async function songsFromNamedAlbums(
  phrase: string,
  words: string[],
): Promise<Song[]> {
  const response = await fetch(
    `${base}/api/albums?find=${encodeURIComponent(phrase)}`,
  );
  if (!response.ok) return [];
  const { albums } = (await response.json()) as { albums: AlbumResult[] };
  const matches = albums
    .filter((a) => tokenize(a.name).join(" ") === words.join(" "))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, MAX_NAMED_ALBUMS);
  const pages = await Promise.allSettled(
    matches.map(async (a) => {
      const res = await fetch(
        `${base}/api/album?url=${encodeURIComponent(a.url)}`,
      );
      if (!res.ok) throw new Error("Album is unavailable");
      return (await res.json()) as AlbumPage;
    }),
  );
  return pages.flatMap((p) =>
    p.status === "fulfilled"
      ? p.value.songs.map((s) => ({
          // Same id as search results (the relative href), so they dedupe.
          id: new URL(s.pageUrl).pathname,
          title: s.title,
          artist: s.artist || "Unknown artist",
          album: p.value.name,
          pageUrl: s.pageUrl,
          imageUrl: p.value.imageUrl,
        }))
      : [],
  );
}

async function fuzzySearch(phrase: string, words: string[]): Promise<Song[]> {
  const extra = new Set<string>();
  const longestFirst = [...new Set(words)]
    .filter((w) => w.length >= 3)
    .sort((a, b) => b.length - a.length);
  if (words.length > 1) longestFirst.forEach((w) => extra.add(w));
  // Stems give the upstream substring match a chance to survive a typo late in a word.
  for (const w of longestFirst)
    for (const n of [Math.ceil(w.length * 0.7), 4])
      if (n >= 4 && n < w.length) extra.add(w.slice(0, n));
  extra.delete(phrase.toLowerCase());

  const batches = await Promise.allSettled(
    [...extra].slice(0, MAX_EXTRA_QUERIES).map(searchExact),
  );
  return batches
    .flatMap((b) => (b.status === "fulfilled" ? b.value : []))
    .map((song) => ({ song, score: matchScore(song, words) }))
    .filter((r) => r.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.song);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

// Average, over the query words, of the best similarity to any word of the
// song's title, artist or page slug (which also carries the album/movie name).
function matchScore(song: Song, words: string[]): number {
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
export async function getSongDetails(
  url: string,
): Promise<Pick<Song, "audioUrl">> {
  const response = await fetch(
    `${base}/api/song?url=${encodeURIComponent(url)}`,
  );
  if (!response.ok) throw new Error("Song cannot be played");
  const result = (await response.json()) as Pick<Song, "audioUrl">;
  return {
    audioUrl: result.audioUrl && new URL(result.audioUrl, base).href,
  };
}
function parseSearchResults(html: string): Song[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = new Set<string>();
  return Array.from(doc.querySelectorAll("a")).flatMap((link) => {
    const href = link.getAttribute("href");
    const raw =
      link.querySelector("b")?.textContent?.trim() || link.textContent?.trim();
    if (!href || !raw || !href.includes("/songs/") || found.has(href))
      return [];
    found.add(href);
    // "Title - " (no artist) would otherwise leave a stray " -" on the title.
    const parts = raw.replace(/\s+-\s*$/, "").split(" - ");
    const image = link.querySelector("img")?.getAttribute("src");
    return [
      {
        id: href,
        title: parts.shift()?.trim() || "Untitled",
        artist: parts.join(" - ").trim() || "Unknown artist",
        pageUrl: new URL(href, "https://pagalnew.com").href,
        imageUrl: image ? new URL(image, "https://pagalnew.com").href : null,
      },
    ];
  });
}
