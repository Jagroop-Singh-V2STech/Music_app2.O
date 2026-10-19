import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Settings } from "../types/music";
import { musicStorage } from "../utils/storage";

interface SettingsState { settings: Settings; update(patch: Partial<Settings>): void }

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(musicStorage.settings);
  useEffect(() => { try { musicStorage.setSettings(settings); } catch { /* storage unavailable */ } }, [settings]);
  const update = useCallback((patch: Partial<Settings>) => setSettings(current => ({ ...current, ...patch })), []);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => { const context = useContext(SettingsContext); if (!context) throw new Error("SettingsProvider missing"); return context; };
