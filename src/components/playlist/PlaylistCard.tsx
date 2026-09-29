import type { Playlist } from "../../types/music";
import { MediaCard } from "../music/MediaCard";

export const PlaylistCard = ({ playlist }: { playlist: Playlist }) => <MediaCard title={playlist.name} subtitle={`Playlist • ${playlist.songs.length} ${playlist.songs.length === 1 ? "song" : "songs"}`} songs={playlist.songs} art={{ imageUrl: playlist.coverImage || playlist.songs[0]?.imageUrl }} seed={playlist.name} to={`/playlist/${playlist.id}`} />;
