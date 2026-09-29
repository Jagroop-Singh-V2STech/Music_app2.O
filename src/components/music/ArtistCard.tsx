import type { Artist } from "../../utils/library";
import { MediaCard } from "./MediaCard";

export const ArtistCard = ({ artist }: { artist: Artist }) => <MediaCard className="artist-card" round title={artist.name} subtitle="Artist" songs={artist.songs} art={{ imageUrl: artist.imageUrl }} seed={artist.name} to={`/artist/${encodeURIComponent(artist.name)}`} />;
