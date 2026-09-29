import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";

const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setMessages(x => [...x, { id, text }]);
    window.setTimeout(() => setMessages(x => x.filter(m => m.id !== id)), 2800);
  }, []);
  return <ToastContext.Provider value={toast}>{children}<div className="toast-region" aria-live="polite">{messages.map(m => <div className="toast" key={m.id}><CheckCircle2 />{m.text}</div>)}</div></ToastContext.Provider>;
}
