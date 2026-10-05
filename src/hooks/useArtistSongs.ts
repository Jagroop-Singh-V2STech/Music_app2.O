import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { searchSongs } from "../services/api";
import type { Song } from "../types/music";

// The search API returns at most 6 songs per query and has no paging, but every word in a query must match. So
// "<artist> b", "<artist> w", … each return a different slice of the artist's catalog. Rarer letters first, since they
// split it best; measured, coverage levels off at about 24 queries (e.g. Arijit Singh: 6 → 69 songs).
const TOKENS = ["b", "w", "z", "k", "j", "la", "ra", "tu", "c", "f", "d", "ma", "p", "g", "v", "y", "na", "ri", "h", "ka", "sa", "t", "m"];
const PAGE_SIZE = 6;
const CONCURRENCY = 4;
const MAX_EMPTY_BATCHES = 2;
const STALE_MS = 10 * 60_000;

const key = (song: Song) => `${song.title}|${song.artist}`.toLowerCase().replace(/\s+/g, " ");

/** Every song the search API has for an artist, found progressively: the first page arrives fast, the rest fill in. */
export function useArtistSongs(name: string) {
  const queryClient = useQueryClient();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const artist = name.trim().toLowerCase();
    if (artist.length < 2) return;
    let cancelled = false;
    const found = new Map<string, Song>();
    setSongs([]); setLoading(true); setError(false);

    // Shares React Query's cache with useSearch, so revisiting an artist doesn't refetch.
    const search = (query: string) => queryClient.fetchQuery({ queryKey: ["search", query], queryFn: () => searchSongs(query), staleTime: STALE_MS });
    const add = (results: Song[]) => {
      const before = found.size;
      for (const song of results) if (song.artist.toLowerCase().includes(artist) && !found.has(key(song))) found.set(key(song), song);
      if (!cancelled && found.size > before) setSongs([...found.values()]);
      return found.size - before;
    };

    (async () => {
      let first: Song[];
      try { first = await search(name); } catch { if (!cancelled) { setError(true); setLoading(false); } return; }
      if (cancelled) return;
      add(first);
      // A short first page means that's the whole catalog.
      if (first.length >= PAGE_SIZE) {
        let empty = 0;
        for (let i = 0; i < TOKENS.length && !cancelled && empty < MAX_EMPTY_BATCHES; i += CONCURRENCY) {
          const results = await Promise.all(TOKENS.slice(i, i + CONCURRENCY).map(token => search(`${name} ${token}`).catch(() => [] as Song[])));
          if (cancelled) return;
          const added = results.reduce((sum, list) => sum + add(list), 0);
          empty = added ? 0 : empty + 1;
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [name, queryClient]);

  return { songs, loading, error };
}
