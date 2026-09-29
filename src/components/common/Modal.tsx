import { X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const titleId = useId();
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}><button className="icon-button close" aria-label="Close" onClick={onClose}><X /></button><h2 id={titleId}>{title}</h2>{children}</section></div>;
}
