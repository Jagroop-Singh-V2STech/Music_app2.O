import { useEffect, useRef, useState } from "react";
import { Check, Moon, X } from "lucide-react";
import { useSleepTimer } from "../../context/SleepTimerContext";
import { useToast } from "../common/Toast";

const OPTIONS = [15, 30, 45, 60];

const short = (seconds: number) => seconds >= 60 ? `${Math.ceil(seconds / 60)}m` : `${seconds}s`;

/** Moon button + menu: sleep after N minutes or at the end of the song, with a countdown badge while active. */
export function SleepTimerButton({ up = true }: { up?: boolean }) {
  const { timer, remaining, start, startEndOfSong, cancel } = useSleepTimer();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const choose = (fn: () => void, message: string) => { fn(); setOpen(false); toast(message, "info"); };
  const label = timer?.mode === "endOfSong" ? "Sleep timer: end of song" : remaining ? `Sleep timer: ${short(remaining)} left` : "Sleep timer";

  return (
    <div className="menu-wrap sleep-timer" ref={ref}>
      <button className={`icon-button ${timer ? "active" : ""}`} aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Moon />
        {timer && <span className="sleep-badge" aria-hidden="true">{timer.mode === "endOfSong" ? "♪" : remaining ? short(remaining) : ""}</span>}
      </button>
      {open && (
        <div className={`context-menu sleep-menu ${up ? "up" : ""}`} role="menu" aria-label="Sleep timer">
          <span className="sleep-menu-title">Stop playing in…</span>
          {OPTIONS.map(minutes => <button role="menuitem" key={minutes} onClick={() => choose(() => start(minutes), `Sleep timer set for ${minutes} minutes`)}>{minutes} minutes</button>)}
          <button role="menuitem" onClick={() => choose(startEndOfSong, "Music will stop at the end of this song")}>End of this song{timer?.mode === "endOfSong" && <Check />}</button>
          {timer && <button role="menuitem" className="sleep-cancel" onClick={() => choose(cancel, "Sleep timer off")}><X /> Turn off timer</button>}
        </div>
      )}
    </div>
  );
}
