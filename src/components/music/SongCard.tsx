import type { Song } from "../../types/music";
import { MediaCard } from "./MediaCard";
export { Artwork } from "./Artwork";

export const SongCard = ({ song, list }: { song: Song; list?: Song[] }) => {
  const songs = list ? [song, ...list.filter(x => x.id !== song.id)] : [song];
  return <MediaCard title={song.title} subtitle={song.artist} songs={songs} art={song} seed={song.title} />;
};
