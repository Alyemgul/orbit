"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToastAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

interface ToastInput {
  message: string;
  tone?: "neutral" | "success" | "danger";
  action?: ToastAction;
  durationMs?: number;
}

interface Toast extends ToastInput {
  id: number;
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast(): (toast: ToastInput) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

/** Small stacked notices above the mobile tab bar. Announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { ...input, id }]);
      window.setTimeout(() => dismiss(id), input.durationMs ?? 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-sm shadow-card",
                toast.tone === "danger" && "border-danger/40",
                toast.tone === "success" && "border-success/40",
              )}
            >
              <span className="min-w-0 flex-1">{toast.message}</span>
              {toast.action ? (
                toast.action.href ? (
                  <a
                    href={toast.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-medium text-accent hover:underline"
                  >
                    {toast.action.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 font-medium text-accent hover:underline"
                    onClick={() => {
                      toast.action?.onClick?.();
                      dismiss(toast.id);
                    }}
                  >
                    {toast.action.label}
                  </button>
                )
              ) : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
