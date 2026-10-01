import { useQueries, type QueryClient } from "@tanstack/react-query";
import { searchSongs } from "../services/api";
import type { Song } from "../types/music";
import type { FeaturedPlaylist } from "../data/featuredPlaylists";
import { uniqueSongs } from "../utils/library";

// Shares the ["search", query] cache with useSearch; seed results change slowly so keep them longer.
const searchQuery = (query: string) => ({ queryKey: ["search", query], queryFn: () => searchSongs(query), staleTime: 10 * 60_000 });

// Round-robin across seed results so the playlist mixes artists instead of grouping them.
function blend(results: Song[][]) {
  const songs: Song[] = [];
  for (let i = 0; i < Math.max(0, ...results.map(r => r.length)); i++) results.forEach(r => r[i] && songs.push(r[i]));
  return uniqueSongs(songs);
}

export function useFeaturedPlaylist(playlist?: FeaturedPlaylist) {
  return useQueries({
    queries: (playlist?.queries ?? []).map(searchQuery),
    combine: results => ({
      songs: blend(results.map(r => r.data ?? [])),
      isLoading: results.some(r => r.isLoading),
      isError: results.length > 0 && results.every(r => r.isError),
    }),
  });
}

// Used by cards to play a playlist without mounting its queries up front.
export async function loadFeaturedSongs(client: QueryClient, playlist: FeaturedPlaylist) {
  const results = await Promise.allSettled(playlist.queries.map(q => client.fetchQuery(searchQuery(q))));
  return blend(results.map(r => r.status === "fulfilled" ? r.value : []));
}

export const cachedFeaturedSongs = (client: QueryClient, playlist: FeaturedPlaylist) => blend(playlist.queries.map(q => client.getQueryData<Song[]>(["search", q]) ?? []));
