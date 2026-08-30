/* Service worker for the notebook PWA.
 *
 * STRATEGY: network-first for pages and static assets, cache fallback
 * only when offline; /api/ is always network-only (data must be live,
 * never cached). The earlier cache-first strategy froze every precached
 * file at install time -- style.css changes never reached browsers that
 * had an older install, which made in-flight CSS bugfixes look like they
 * "didn't work". Network-first trades a (cheap, LAN-local) request per
 * asset for always-fresh code; the cache is still populated (precached
 * at install + updated on every successful fetch) so offline launches
 * keep working.
 *
 * CACHE is versioned: bumping the name makes every installed worker
 * re-run install (re-precache the current assets) and activate (delete
 * the old cache). */
const CACHE = "notebook-v2";
const PRECACHE = [
  "/",
  "/static/manifest.json",
  "/static/favicon.svg",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/apple-touch-icon.png",
  "/static/css/style.css",
  "/static/css/vimnav.css",
  "/static/vendor/marked.min.js",
  "/static/vendor/highlight.min.js",
  "/static/vendor/codemirror.bundle.js",
  "/static/js/api.js",
  "/static/js/auth.js",
  "/static/js/cm-bridge.js",
  "/static/js/mermaid.js",
  "/static/js/viewer.js",
  "/static/js/editbar.js",
  "/static/js/hybrid.js",
  "/static/js/watcher.js",
  "/static/js/outline.js",
  "/static/js/sidebar.js",
  "/static/js/search.js",
  "/static/js/tabs.js",
  "/static/js/settings.js",
  "/static/js/ai.js",
  "/static/js/activity.js",
  "/static/js/graph.js",
  "/static/js/vimnav.js",
  "/static/js/shortcuts.js",
  "/static/js/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (e.request.url.startsWith(self.location.origin + "/api/")) {
    e.respondWith(networkOnly(e.request));
    return;
  }
  e.respondWith(networkFirst(e.request));
});

/* Live data: never serve from cache, never store. Offline surfaces an
 * explicit 503 JSON error the app can show. */
async function networkOnly(req) {
  try {
    return await fetch(req);
  } catch {
    return new Response(JSON.stringify({ error: "Offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/* Pages + static assets: hit the network first so every deploy is picked
 * up immediately; mirror successful responses into the cache so the
 * offline copy stays current; fall back to the cache when offline. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response("Offline", { status: 503 });
  }
}
