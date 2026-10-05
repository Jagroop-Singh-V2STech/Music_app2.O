import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

export type ToastTone = "success" | "info" | "error";
const icons = { success: CheckCircle2, info: Info, error: AlertCircle };

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<{ id: number; text: string; tone: ToastTone }[]>([]);
  const toast = useCallback((text: string, tone: ToastTone = "success") => {
    const id = Date.now() + Math.random();
    setMessages(x => [...x.filter(m => m.text !== text), { id, text, tone }].slice(-3));
    window.setTimeout(() => setMessages(x => x.filter(m => m.id !== id)), 2800);
  }, []);
  return <ToastContext.Provider value={toast}>{children}<div className="toast-region" aria-live="polite">{messages.map(m => { const Icon = icons[m.tone]; return <div className={`toast ${m.tone}`} key={m.id} role={m.tone === "error" ? "alert" : undefined}><Icon />{m.text}</div>; })}</div></ToastContext.Provider>;
}
