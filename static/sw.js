const CACHE = "notebook-v1";
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
  "/static/js/watcher.js",
  "/static/js/outline.js",
  "/static/js/sidebar.js",
  "/static/js/search.js",
  "/static/js/tabs.js",
  "/static/js/settings.js",
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
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).catch(() => new Response("Offline", { status: 503 })))
  );
});

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
