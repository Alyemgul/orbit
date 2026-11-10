/** Removes pages saved for offline use and per-browser Orbit data (sign-out, account deletion). */
export async function clearOfflineData(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage("orbit:clear");
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("orbit-pages")).map((k) => caches.delete(k)));
    }
  } catch {
    // Nothing cached or storage blocked.
  }
  try {
    for (const key of ["orbit-demo-resume", "orbit-min-match"]) window.localStorage.removeItem(key);
  } catch {
    // Storage blocked.
  }
}
