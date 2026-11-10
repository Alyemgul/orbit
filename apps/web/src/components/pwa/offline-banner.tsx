"use client";

import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

/** A slim notice while the device is offline; pages shown are the last saved copies. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <AnimatePresence initial={false}>
      {offline ? (
        <motion.div
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b bg-surface-2 text-sm"
        >
          <p className="flex items-center gap-2 px-4 py-2 md:px-8">
            <WifiOff className="size-4 shrink-0 text-warning" aria-hidden />
            You&apos;re offline. You&apos;re seeing the last saved view; swipes and changes will work again once you reconnect.
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
