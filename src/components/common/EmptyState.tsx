import type { ReactNode } from "react";
import { Music2 } from "lucide-react";

export function EmptyState({ title, copy, icon, action }: { title: string; copy: string; icon?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state fade-in"><span className="empty-icon">{icon ?? <Music2 />}</span><h3>{title}</h3><p>{copy}</p>{action}</div>;
}
