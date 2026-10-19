import { useQuery } from "@tanstack/react-query";
import type { Song } from "../types/music";
import { fetchLyricsCandidates, pickLyrics } from "../services/lyrics";
import { getTrack } from "../services/offline";
import { useSettings } from "../context/SettingsContext";

// Downloaded songs carry their lyrics; others are looked up once per session.
export function useLyrics(song: Song | undefined, duration: number) {
  const { lyricsScript } = useSettings().settings;
  const query = useQuery({
    queryKey: ["lyrics", song?.id],
    queryFn: async () => (await getTrack(song!.id))?.lyrics ?? fetchLyricsCandidates(song!),
    enabled: !!song,
    staleTime: Infinity,
    retry: 2, // LRCLIB answers 503 when busy; a short retry usually succeeds
  });
  const lyrics = song && query.data ? pickLyrics(song, query.data, duration || undefined, lyricsScript) : null;
  return { lyrics, isLoading: query.isLoading, isError: query.isError, retry: () => void query.refetch() };
}
