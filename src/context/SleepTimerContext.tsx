import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePlayer } from "./PlayerContext";
import { useJam } from "./JamContext";
import { useSettings } from "./SettingsContext";
import { useToast } from "../components/common/Toast";

type Timer = { mode: "time"; endsAt: number } | { mode: "endOfSong" };

interface SleepTimerState {
  timer?: Timer;
  /** Seconds left for a timed sleep, updated every second. */
  remaining?: number;
  start(minutes: number): void;
  startEndOfSong(): void;
  cancel(): void;
}

const SleepTimerContext = createContext<SleepTimerState | null>(null);

export function SleepTimerProvider({ children }: { children: ReactNode }) {
  const { engine, setEndedHandler } = usePlayer();
  const jam = useJam();
  const { sleepFadeSeconds } = useSettings().settings;
  const toast = useToast();
  const [timer, setTimer] = useState<Timer>();
  const [remaining, setRemaining] = useState<number>();
  const inJam = useRef(false);
  useEffect(() => { inJam.current = Boolean(jam.roomId); }, [jam.roomId]);
  const pauseLocally = useRef(jam.pauseLocally);
  useEffect(() => { pauseLocally.current = jam.pauseLocally; }, [jam.pauseLocally]);

  // In a Jam only this device stops; the room keeps playing for everyone else.
  const sleep = useCallback(() => {
    if (inJam.current) { pauseLocally.current(); toast("Sleep timer paused your playback. The Jam continues.", "info"); }
    else { engine.pause(); toast("Sleep timer ended. Goodnight!", "info"); }
    engine.setFade(1);
    setTimer(undefined);
    setRemaining(undefined);
  }, [engine, toast]);

  const cancel = useCallback(() => { engine.setFade(1); setTimer(undefined); setRemaining(undefined); }, [engine]);
  const start = useCallback((minutes: number) => { engine.setFade(1); setTimer({ mode: "time", endsAt: Date.now() + minutes * 60_000 }); }, [engine]);
  const startEndOfSong = useCallback(() => { engine.setFade(1); setTimer({ mode: "endOfSong" }); setRemaining(undefined); }, [engine]);

  // Timed: tick every second (more often while fading) and lower the volume over the last few seconds.
  useEffect(() => {
    if (timer?.mode !== "time") return;
    const tick = () => {
      const left = (timer.endsAt - Date.now()) / 1000;
      if (left <= 0) { sleep(); return; }
      setRemaining(Math.ceil(left));
      engine.setFade(sleepFadeSeconds > 0 && left < sleepFadeSeconds ? left / sleepFadeSeconds : 1);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [engine, sleep, sleepFadeSeconds, timer]);

  // End of song: stop when the current song finishes instead of moving on.
  useEffect(() => {
    if (timer?.mode !== "endOfSong") return;
    setEndedHandler(() => { sleep(); return true; });
    return () => setEndedHandler(null);
  }, [setEndedHandler, sleep, timer]);

  const value = useMemo(() => ({ timer, remaining, start, startEndOfSong, cancel }), [cancel, remaining, start, startEndOfSong, timer]);
  return <SleepTimerContext.Provider value={value}>{children}</SleepTimerContext.Provider>;
}

export const useSleepTimer = () => { const context = useContext(SleepTimerContext); if (!context) throw new Error("SleepTimerProvider missing"); return context; };
