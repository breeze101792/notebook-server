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
/* Bumped v7 -> v8: the newly precached copy-image.js must reach already
 * installed workers, which only re-run install when CACHE changes. */
/* Bumped v8 -> v9: the newly precached bookmarks.js must reach already installed workers. */
/* Bumped v9 -> v10: mobile.js joins the precache. */
/* Bumped v10 -> v11: the opaque v2 icon set replaces the transparent icons. */
/* Bumped v11 -> v12: the Graphviz / WaveDrom designer modules join the precache. */
/* Bumped v12 -> v13: navigation requests fall back to the cached app shell. */
/* Bumped v13 -> v14: the phone WYSIWYG edit surface (CSS + JS) must reach
 * already installed workers. */
const CACHE = "notebook-v14";
// Only the assets needed to boot are precached. The heavy on-demand
// renderer bundles (mermaid, graphviz, CodeMirror, KaTeX, WaveDrom) are
// deliberately NOT listed: precaching 6.8MB at install would make the
// first page load slow again. They are fetched on first use and mirror
// into the cache through the network-first handler like any other asset,
// so offline still works once a note has used that renderer.
const PRECACHE = [
  "/",
  "/static/manifest.json",
  "/static/favicon.svg",
  "/static/icons/icon-192-v2.png",
  "/static/icons/icon-512-v2.png",
  "/static/icons/apple-touch-icon-v2.png",
  "/static/css/style.css",
  "/static/css/vimnav.css",
  "/static/vendor/marked.min.js",
  "/static/vendor/highlight.min.js",
  "/static/vendor/turndown.browser.js",
  "/static/vendor/turndown-plugin-gfm.browser.js",
  "/static/js/api.js",
  "/static/js/auth.js",
  "/static/js/cm-bridge.js",
  "/static/js/lightbox.js",
  "/static/js/blocks.js",
  "/static/js/menu.js",
  "/static/js/mermaid.js",
  "/static/js/wavedrom.js",
  "/static/js/katex.js",
  "/static/js/viz.js",
  "/static/js/htmlpreview.js",
  "/static/js/svg.js",
  "/static/js/copy-image.js",
  "/static/js/viewer.js",
  "/static/js/editbar.js",
  "/static/js/hybrid.js",
  "/static/js/table-edit.js",
  "/static/js/list-edit.js",
  "/static/js/table-view.js",
  "/static/js/table-select.js",
  "/static/js/watcher.js",
  "/static/js/outline.js",
  "/static/js/sidebar.js",
  "/static/js/search.js",
  "/static/js/tabs.js",
  "/static/js/windows.js",
  "/static/js/settings.js",
  "/static/js/export.js",
  "/static/js/mermaid-designer.js",
  "/static/js/designer-shell.js",
  "/static/js/dot-designer.js",
  "/static/js/wavedrom-designer.js",
  "/static/js/ai.js",
  "/static/js/activity.js",
  "/static/js/bookmarks.js",
  "/static/js/mobile.js",
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
    let cached = await cache.match(req);
    // Any in-app URL (a deep link, or a reload that kept ?file=...) is
    // served by the same SPA shell. Only "/" is precached, so a navigation
    // needs that fallback to boot offline.
    if (!cached && req.mode === "navigate") cached = await cache.match("/");
    if (cached) return cached;
    return new Response("Offline", { status: 503 });
  }
}
