import { useEffect } from "react";
import { X } from "lucide-react";
import { QueueList } from "./QueueList";

export function QueueDrawer({ open, close }: { open: boolean; close(): void }) {
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [open, close]);
  return (
    <>
      <div className={`scrim ${open ? "open" : ""}`} onClick={close} aria-hidden="true" />
      <aside className={`queue-drawer ${open ? "open" : ""}`} aria-label="Queue" aria-hidden={!open} inert={!open}>
        <header><div><span className="eyebrow">Your listening</span><h2>Queue</h2></div><button className="icon-button" aria-label="Close queue" onClick={close}><X /></button></header>
        <QueueList />
      </aside>
    </>
  );
}
