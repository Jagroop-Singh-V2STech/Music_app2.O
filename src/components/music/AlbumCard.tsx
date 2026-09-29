import type { Album } from "../../utils/library";
import { MediaCard } from "./MediaCard";

export const AlbumCard = ({ album }: { album: Album }) => <MediaCard title={album.name} subtitle={`${album.kind} • ${album.artist}`} songs={album.songs} art={{ imageUrl: album.imageUrl }} seed={album.name} />;
