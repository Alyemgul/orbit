/*
 * Orbit service worker: lets the installed app open offline.
 *
 * - Build assets (/_next/static) are immutable, so they are served from cache first.
 * - Pages are fetched from the network first; the last good copy of each app page is kept
 *   so it can be shown offline, and anything else falls back to /offline.
 * - Nothing else is touched: no API calls, no server actions, nothing from other origins.
 * - Signing out or deleting the account clears the saved pages (message "orbit:clear").
 */

const VERSION = "v1";
const STATIC_CACHE = `orbit-static-${VERSION}`;
const PAGE_CACHE = `orbit-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
const APP_PAGES = /^\/(discover|pipeline|inbox|resume|profile)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("orbit-") && ![STATIC_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "orbit:clear") {
    event.waitUntil(
      caches.delete(PAGE_CACHE).then(() => caches.open(PAGE_CACHE)).then((cache) => cache.add(OFFLINE_URL)).catch(() => undefined),
    );
  }
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function staticFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

async function pageNetworkFirst(request) {
  const url = new URL(request.url);
  try {
    const response = await withTimeout(fetch(request), 6000);
    // Only keep real app pages (not redirects to sign-in, not errors).
    if (response.ok && !response.redirected && APP_PAGES.test(url.pathname) && !url.search) {
      (await caches.open(PAGE_CACHE)).put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    return cached || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(pageNetworkFirst(request));
  }
});
