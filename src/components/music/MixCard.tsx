import type { Mix } from "../../utils/library";
import { MediaCard } from "./MediaCard";

export const MixCard = ({ mix }: { mix: Mix }) => <MediaCard className="mix-card" title={mix.title} subtitle={mix.subtitle} songs={mix.songs} art={{ imageUrl: mix.imageUrl }} seed={mix.title} overlay={<span className="mix-label" style={{ "--hue": mix.hue } as React.CSSProperties}>{mix.title}</span>} />;
