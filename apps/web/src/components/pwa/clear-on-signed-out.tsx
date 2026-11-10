"use client";

import { useEffect } from "react";
import { clearOfflineData } from "@/lib/offline";

/** The sign-in page clears pages saved for offline use, so nothing personal outlives a session. */
export function ClearOnSignedOut() {
  useEffect(() => {
    void clearOfflineData();
  }, []);
  return null;
}
