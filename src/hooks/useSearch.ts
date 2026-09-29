import { useQuery } from "@tanstack/react-query"; import { searchSongs } from "../services/api";
export const useSearch = (query: string) => useQuery({ queryKey: ["search", query], queryFn: () => searchSongs(query), enabled: query.trim().length > 1, staleTime: 30_000 });
