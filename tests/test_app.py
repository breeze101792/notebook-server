"""Backend tests for the Markdown notebook server (stdlib unittest).

Uses Flask's test client against the real app. The notebook/config folders are
redirected to a temp dir via NOTEBOOK_DATA_DIR / NOTEBOOK_CONFIG_DIR so the
project's real notebook/ and config/ are never touched.

Run:  .venv_$(hostname)/bin/python -m unittest discover -s tests -v
  or:  .venv_$(hostname)/bin/python -m pytest tests   (if pytest is installed)
"""

import contextlib
import io
import json
import os
import queue
import re
import runpy
import shutil
import socket
import sys
import tempfile
import time
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler

# Put the project root on sys.path so `import app` works from tests/.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Redirect notebook/config to a temp dir BEFORE importing the app module (the
# module resolves DATA_DIR/CONFIG_DIR at import time and calls seed()).
_TMP = tempfile.mkdtemp(prefix="nbtest_")
os.environ["NOTEBOOK_DATA_DIR"] = os.path.join(_TMP, "notebook")
os.environ["NOTEBOOK_CONFIG_DIR"] = os.path.join(_TMP, "config")

import app as nb  # noqa: E402  (import after env + sys.path setup)


class BaseTest(unittest.TestCase):
    def setUp(self):
        """Reset the temp notebook/config dirs to a freshly-seeded state."""
        if os.path.isdir(nb.DATA_DIR):
            shutil.rmtree(nb.DATA_DIR)
        if os.path.isdir(nb.CONFIG_DIR):
            shutil.rmtree(nb.CONFIG_DIR)
        nb.seed()  # creates notebook/Welcome.md and config/config.json (={})
        self.client = nb.app.test_client()

    # --- helpers --------------------------------------------------------
    def post(self, path, body):
        return self.client.post(path, json=body)

    def jget(self, path):
        r = self.client.get(path)
        return r.status_code, (r.get_json() if r.is_json else None)

    # --- active side-panel view first-paint helpers ---------------------
    def view_hidden(self, html, view_id):
        """True when the .side-panel-view host data-view=view_id is hidden.

        Fails if the shell ships no such host, so a renamed view id is
        caught rather than silently reported as hidden."""
        m = re.search(r'data-view="%s"[^>]*>' % re.escape(view_id), html)
        self.assertIsNotNone(m, "no side-panel host for view id %r" % view_id)
        return "hidden" in m.group(0)

    def assert_only_view(self, html, active):
        """Exactly the `active` view host is visible; every other host is
        hidden. This is the first-paint contract (exactly one host shown)."""
        for view in nb._ACTIVE_VIEWS:
            self.assertEqual(
                self.view_hidden(html, view), view != active,
                "view %r visibility wrong for active view %r" % (view, active))


class TestIndexAndSeed(BaseTest):
    def test_index_serves_html(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("viewer", r.get_data(as_text=True))

    def test_index_paints_saved_boot_state(self):
        # The saved chrome must be rendered into the shell itself so the
        # first frame matches the config -- otherwise the browser paints
        # the defaults and visibly reflows once /api/config lands (title
        # text, font size, and pane widths all jump). Regression cover for
        # that flash.
        self.post("/api/config", {
            "theme": "light", "siteTitle": "My Notes", "fontSize": "xlarge",
            "sidebarWidth": 312, "outlineWidth": 344,
            "sidebarCollapsed": False, "outlineCollapsed": True,
            "wallpaper": "grid", "wallpaperColor": "green",
            "wallpaperIntensity": "bold", "wallpaperScroll": "fixed",
        })
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn("<title>My Notes</title>", html)
        self.assertIn("--font-scale: 1.3", html)
        self.assertIn("--side-panel-width: 312px", html)
        # The outline is collapsed -> its width is 0 and it carries the
        # collapsed class, matching what app.js would apply post-fetch.
        self.assertIn("--outline-width: 0px", html)
        self.assertIn('id="outline-pane" class="collapsed"', html)
        self.assertIn("wallpaper-grid", html)
        self.assertIn("wallpaper-color-green", html)
        self.assertIn("wallpaper-intensity-bold", html)
        self.assertIn("wallpaper-fixed", html)

    def test_index_defaults_when_config_empty(self):
        # Fresh install: the same defaults app.js's DEFAULTS use, so the
        # first frame is correct even before any config is saved.
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn("<title>Notebook</title>", html)
        self.assertIn("--font-scale: 1.0", html)
        self.assertIn("--side-panel-width: 240px", html)
        self.assertIn("--outline-width: 220px", html)
        self.assertNotIn('id="side-panel" class="collapsed"', html)
        self.assertNotIn('id="outline-pane" class="collapsed"', html)
        self.assertIn("wallpaper-none", html)

    def test_boot_state_sanitizes_hostile_config(self):
        # A hand-edited config.json must never inject markup into the
        # shell or produce an out-of-range layout. boot_state() is the
        # allowlist/clamp chokepoint; this exercises it directly with the
        # nasty values a text editor could produce.
        state = nb.boot_state({
            "theme": "<script>alert(1)</script>",
            "siteTitle": "  <img src=x onerror=alert(1)>  ",
            "fontSize": "' onmouseover='alert(1)",
            "sidebarWidth": "not-a-number",
            "outlineWidth": 999999,
            "wallpaper": "javascript:alert(1)",
            "wallpaperColor": "rgb(1,2,3);background:url(javascript:1)",
            "wallpaperIntensity": "nope",
            "wallpaperScroll": "evil",
        })
        self.assertEqual(state["theme"], "auto")
        self.assertEqual(state["font_scale"], 1.0)
        self.assertEqual(state["side_panel_width"], 240)   # bad -> default
        self.assertEqual(state["outline_width"], 2000)     # clamped to ceiling
        self.assertEqual(state["wallpaper_classes"],
                         "wallpaper-none wallpaper-intensity-subtle")
        # The hostile strings must be allowlist-rejected, so they never
        # appear in the rendered page. Jinja autoescaping is the second
        # line of defense for the free-text title.
        self.post("/api/config", {
            "theme": "x", "siteTitle": "<script>alert(1)</script>",
            "fontSize": "x", "wallpaper": "x",
        })
        html = self.client.get("/").get_data(as_text=True)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertNotIn("javascript:", html)
        # The title is escaped, never emitted as live markup.
        self.assertNotIn("<img src=x", html)

    def test_boot_state_clamps_pane_widths(self):
        # Widths below the drag minimum or above the max are clamped, so a
        # corrupt value can't collapse the layout to an unusable size.
        self.assertEqual(nb.boot_state({"sidebarWidth": 1})["side_panel_width"], 140)
        self.assertEqual(nb.boot_state({"sidebarWidth": 9999})["side_panel_width"], 2000)
        # Collapsed wins over the saved width: the pane is 0 either way.
        self.assertEqual(
            nb.boot_state({"sidebarWidth": 300, "sidebarCollapsed": True})["side_panel_width"], 0)
        self.assertEqual(
            nb.boot_state({"outlineWidth": 300, "outlineCollapsed": True})["outline_width"], 0)

    def test_boot_state_does_not_leak_content(self):
        # The shell is served before auth, so nothing content-bearing may
        # be embedded. Guard the allowlist so recent/open file lists and
        # bookmarks can never sneak into the page.
        self.post("/api/config", {
            "recentFiles": ["secret/recent.md"],
            "openFiles": ["secret/open.md"],
            "bookmarks": ["secret/bookmark.md"],
            "activeFile": "secret/active.md",
            "lastFile": "secret/last.md",
            "vimrc": "nmap x :!rm -rf /<CR>",
        })
        html = self.client.get("/").get_data(as_text=True)
        for secret in ("secret/recent.md", "secret/open.md",
                       "secret/bookmark.md", "secret/active.md",
                       "secret/last.md"):
            self.assertNotIn(secret, html)

    def test_index_paints_defaults_until_authenticated(self):
        # With auth on, the shell is served before login. An unauthenticated
        # /api/config 401s, so app.js falls back to DEFAULTS -- the server
        # must paint those same defaults, or the first frame (saved values)
        # would visibly reflow to defaults (and leak the saved prefs) once
        # the 401 lands. Once logged in, the saved chrome is embedded so a
        # reload is flash-free.
        import bcrypt as _bcrypt
        # Save the prefs while auth is still off (POST /api/config is
        # admin-gated), then turn auth on for the anonymous check.
        self.post("/api/config", {
            "theme": "dark", "siteTitle": "Secret Title",
            "fontSize": "xlarge", "sidebarWidth": 333,
            "sidebarCollapsed": True, "wallpaper": "grid",
        })
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "x" * 64,
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw-secret", _bcrypt.gensalt(4)).decode(),
            }, f)
        anon = nb.app.test_client()
        html = anon.get("/").get_data(as_text=True)
        self.assertIn("<title>Notebook</title>", html)
        self.assertIn("--font-scale: 1.0", html)
        self.assertIn("--side-panel-width: 240px", html)
        self.assertNotIn("Secret Title", html)
        self.assertIn("wallpaper-none", html)
        # The saved theme is not a secret; keep it so the login screen
        # matches the user's chosen theme.
        self.assertIn("dark", html)
        # After a real login the shell embeds the saved chrome.
        client = nb.app.test_client()
        client.post("/api/login", json={"password": "admin-pw-secret"})
        authed = client.get("/").get_data(as_text=True)
        self.assertIn("<title>Secret Title</title>", authed)
        self.assertIn("--font-scale: 1.3", authed)

    def test_spa_catch_all_also_paints_boot_state(self):
        # The catch-all route (e.g. /README.md) renders the same shell, so
        # a deep-link reload must not flash either.
        self.post("/api/config", {"fontSize": "large", "siteTitle": "Deep"})
        html = self.client.get("/README.md").get_data(as_text=True)
        self.assertIn("<title>Deep</title>", html)
        self.assertIn("--font-scale: 1.15", html)

    # --- active side-panel view first paint ------------------------------
    def test_index_paints_saved_active_view(self):
        # The saved active view is first-paint chrome: the shell must show
        # exactly that view and hide the rest, so an authenticated reload
        # never paints the file tree before the saved view.
        self.post("/api/config", {"activeView": "bookmarks"})
        html = self.client.get("/").get_data(as_text=True)
        self.assert_only_view(html, "bookmarks")
        self.assertFalse(self.view_hidden(html, "bookmarks"))
        self.assertTrue(self.view_hidden(html, "explorer"))

    def test_index_paints_explorer_for_default_and_missing(self):
        # Explicit "explorer" and the no-key case both boot Explorer.
        self.post("/api/config", {"activeView": "explorer"})
        html = self.client.get("/").get_data(as_text=True)
        self.assert_only_view(html, "explorer")
        self.assertFalse(self.view_hidden(html, "explorer"))

        self.post("/api/config", {})
        html = self.client.get("/").get_data(as_text=True)
        self.assert_only_view(html, "explorer")

    def test_index_paints_each_saved_active_view(self):
        for view in ("recent", "search", "ai"):
            self.post("/api/config", {"activeView": view})
            html = self.client.get("/").get_data(as_text=True)
            self.assert_only_view(html, view)
            self.assertFalse(self.view_hidden(html, view))

    def test_index_falls_back_to_explorer_for_bad_active_view(self):
        # Unknown id and non-string values must fall back silently, never
        # error or leave the panel empty.
        for bad in ("gone", 42, None):
            self.post("/api/config", {"activeView": bad})
            r = self.client.get("/")
            self.assertEqual(r.status_code, 200)
            self.assert_only_view(r.get_data(as_text=True), "explorer")

    def test_index_paints_saved_view_in_collapsed_shell(self):
        # Collapse is orthogonal to the active view: the shell stays
        # collapsed at width 0 and still shows the saved view inside.
        self.post("/api/config", {"activeView": "bookmarks",
                                  "sidebarCollapsed": True})
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn('id="side-panel" class="collapsed"', html)
        self.assertIn("--side-panel-width: 0", html)
        self.assertFalse(self.view_hidden(html, "bookmarks"))
        self.assertTrue(self.view_hidden(html, "explorer"))

    def test_spa_catch_all_paints_active_view(self):
        # The catch-all route renders the same shell, so a deep-link reload
        # must not flash the file tree either.
        self.post("/api/config", {"activeView": "search"})
        root = self.client.get("/").get_data(as_text=True)
        deep = self.client.get("/Welcome.md").get_data(as_text=True)
        self.assert_only_view(root, "search")
        self.assert_only_view(deep, "search")

    def test_active_view_not_leaked_until_authenticated(self):
        # The shell is served before login, so an unauthenticated request
        # must select Explorer and never paint the saved view. After a real
        # login the reload paints the saved view.
        import bcrypt as _bcrypt
        self.post("/api/config", {"activeView": "bookmarks"})
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "x" * 64,
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw-secret", _bcrypt.gensalt(4)).decode(),
            }, f)
        anon = nb.app.test_client()
        html = anon.get("/").get_data(as_text=True)
        self.assert_only_view(html, "explorer")
        self.assertTrue(self.view_hidden(html, "bookmarks"))
        client = nb.app.test_client()
        client.post("/api/login", json={"password": "admin-pw-secret"})
        authed = client.get("/").get_data(as_text=True)
        self.assert_only_view(authed, "bookmarks")

    def test_active_view_allowlist_matches_registry_and_dom(self):
        # boot_state's allowlist must equal the view ids activity.js
        # registers and the data-view hosts the shell ships; a drift is a
        # defect. Parsed textually, in the same cross-file-guard style as
        # the renderer-registry and version-drift tests.
        with open(os.path.join(ROOT, "app.py"), encoding="utf-8") as f:
            app_src = f.read()
        m = re.search(r"_ACTIVE_VIEWS\s*=\s*\(([^)]*)\)", app_src)
        self.assertIsNotNone(m, "_ACTIVE_VIEWS tuple not found in app.py")
        allow = set(re.findall(r'"([^"]+)"', m.group(1)))

        with open(os.path.join(ROOT, "static", "js", "activity.js"),
                  encoding="utf-8") as f:
            activity_src = f.read()
        registered = set(re.findall(
            r'(?:NB\.activity\.)?register\(\{\s*id:\s*"([^"]+)"', activity_src))

        with open(os.path.join(ROOT, "templates", "index.html"),
                  encoding="utf-8") as f:
            shell_src = f.read()
        hosts = set(re.findall(r'data-view="([^"]+)"', shell_src))

        self.assertEqual(
            allow, registered,
            "boot_state _ACTIVE_VIEWS and activity.js registry differ "
            "(missing from registry: %s)" % sorted(allow - registered))
        self.assertEqual(
            allow, hosts,
            "boot_state _ACTIVE_VIEWS and index.html data-view hosts differ "
            "(missing from shell: %s)" % sorted(allow - hosts))


    def test_seed_creates_welcome_and_empty_config(self):
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "Welcome.md")))
        with open(nb.CONFIG_FILE) as f:
            self.assertEqual(json.load(f), {})

    def test_tree_seeded(self):
        code, data = self.jget("/api/tree")
        self.assertEqual(code, 200)
        names = [n["name"] for n in data["tree"]]
        self.assertIn("Welcome.md", names)

    def test_gated_reads_have_no_store_cache_header(self):
        # The gated read endpoints (tree, file, search, config GET,
        # info) must never be cacheable: a previously-authorized
        # browser holding a cached response would re-display the
        # content after the auth state tightens (e.g. admin enables
        # the viewer password). The server prevents this with
        # `Cache-Control: no-store, private` so the browser drops the
        # response and re-validates with the server.
        from urllib.parse import quote
        for path in ("/api/tree", "/api/ls", "/api/info",
                     "/api/config", "/api/search?q=foo",
                     "/api/file?path=" + quote("Welcome.md")):
            r = self.client.get(path)
            self.assertEqual(r.headers.get("Cache-Control"), "no-store, private",
                "missing/incorrect Cache-Control on %s: %r" % (path, r.headers.get("Cache-Control")))

    def test_gated_reads_with_viewer_required_return_401_with_no_content(self):
        # When the viewer password is set and there's no admin session,
        # gated reads return 401 with NO body (the server must not leak
        # the content to an unauthorized client, regardless of caching).
        # The Cache-Control header is still set so the browser doesn't
        # hold onto the 401 (or any prior cached 200) in a way that
        # could re-display content.
        import bcrypt as _bcrypt
        from urllib.parse import quote as _quote
        os.makedirs(nb.CONFIG_DIR, exist_ok=True)
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(b"admin-pw", _bcrypt.gensalt(4)).decode(),
                "viewer_password_hash": _bcrypt.hashpw(b"viewer-pw", _bcrypt.gensalt(4)).decode(),
            }, f)
        for path in ("/api/tree", "/api/file?path=" + _quote("Welcome.md"),
                     "/api/search?q=foo", "/api/config"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 401,
                "%s should be 401, got %s" % (path, r.status_code))
            # The 401 body is just an error message -- but it must NOT
            # contain the file/tree content the server is protecting.
            body = r.get_data(as_text=True)
            self.assertNotIn("Welcome content", body,
                "%s 401 leaked file content: %r" % (path, body[:200]))
            self.assertNotIn("## One", body,
                "%s 401 leaked note content: %r" % (path, body[:200]))
            self.assertEqual(r.headers.get("Cache-Control"), "no-store, private")

    def test_admin_only_gated_reads_return_401_with_no_content(self):
        # The "admin password set, viewer password NOT set" mode used
        # to leave all read endpoints open with only a cosmetic blur in
        # front of the rendered content. The actual file bodies / tree
        # / search hits were on the wire. After the read-gating policy
        # change, the admin password alone is enough to gate every
        # read; the server must return 401 with no note content in the
        # body, regardless of whether the viewer password is set.
        # This is the regression test for that fix.
        import bcrypt as _bcrypt
        from urllib.parse import quote as _quote
        os.makedirs(nb.CONFIG_DIR, exist_ok=True)
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(b"admin-pw", _bcrypt.gensalt(4)).decode(),
                # no viewer_password_hash -- this is the admin-only mode
            }, f)
        for path in ("/api/tree", "/api/file?path=" + _quote("Welcome.md"),
                     "/api/search?q=Welcome", "/api/config", "/api/info"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 401,
                "admin-only mode: %s should be 401, got %s" % (path, r.status_code))
            body = r.get_data(as_text=True)
            self.assertNotIn("Welcome content", body,
                "%s 401 leaked file content: %r" % (path, body[:200]))
            self.assertNotIn("## One", body,
                "%s 401 leaked note content: %r" % (path, body[:200]))
            self.assertEqual(r.headers.get("Cache-Control"), "no-store, private")


class TestSpaCatchAll(BaseTest):
    # The notebook is a single-page app: every path that isn't an
    # /api/* route (or a /static/* file served by Flask's built-in
    # static handler) should land on index.html so the boot path
    # can parse the URL as a deep link. This is what makes
    # `http://server/README.md#core-rules` work -- a fresh load of
    # any notebook file path serves the SPA shell, and the frontend
    # opens the file + scrolls to the heading.

    def assert_serves_spa(self, path):
        r = self.client.get(path)
        self.assertEqual(r.status_code, 200,
            f"GET {path} should serve the SPA shell, got {r.status_code}")
        body = r.get_data(as_text=True)
        self.assertIn("viewer", body,
            f"GET {path} should serve index.html (looked for 'viewer')")

    def test_root_serves_spa(self):
        self.assert_serves_spa("/")

    def test_root_file_path_serves_spa(self):
        # The user's bug report URL: a fresh load of /README.md
        # should serve the SPA, not 404.
        self.assert_serves_spa("/README.md")

    def test_subfolder_file_path_serves_spa(self):
        self.assert_serves_spa("/notes/a.md")
        self.assert_serves_spa("/some/deeply/nested/path.md")

    def test_deep_link_with_fragment_serves_spa(self):
        # The browser never sends the fragment to the server (it's a
        # client-only concept), but the test client URL strips it
        # anyway -- what matters is that the path matches the
        # catch-all and the SPA shell is served.
        self.assert_serves_spa("/README.md")

    def test_api_routes_unaffected(self):
        # The catch-all must not shadow /api/*. The BaseTest setUp
        # doesn't configure a viewer password, so /api/config is
        # open (read_login_required only fires when reads are
        # actually gated). Either way, the body must be JSON, not
        # the SPA HTML.
        r = self.client.get("/api/config")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.is_json, "/api/config should return JSON, not the SPA shell")

    def test_search_routes_unaffected(self):
        # Same proof: /api/search is read-gated but open by default;
        # the body must be JSON, not the SPA HTML.
        r = self.client.get("/api/search?q=foo")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.is_json)


class TestWebAppManifest(BaseTest):
    # iOS builds a Home Screen web clip from the apple-touch-icon link and
    # also probes the two root paths directly. Both must answer with a PNG;
    # the SPA catch-all used to answer with HTML and iOS cached that.

    PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

    def test_apple_touch_icon_route_serves_png(self):
        for path in ("/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertEqual(r.mimetype, "image/png", path)
            self.assertTrue(r.get_data().startswith(self.PNG_MAGIC), path)
            r.close()

    def test_v2_icons_are_served(self):
        for name in ("apple-touch-icon-v2.png", "icon-192-v2.png",
                     "icon-512-v2.png", "icon-1024-v2.png"):
            r = self.client.get("/static/icons/" + name)
            self.assertEqual(r.status_code, 200, name)
            self.assertEqual(r.mimetype, "image/png", name)
            self.assertTrue(r.get_data().startswith(self.PNG_MAGIC), name)
            r.close()

    def test_index_links_the_v2_icon_and_theme_colour(self):
        body = self.client.get("/").get_data(as_text=True)
        self.assertIn('rel="apple-touch-icon"', body)
        self.assertIn("/static/icons/apple-touch-icon-v2.png", body)
        self.assertIn('name="theme-color"', body)

    def test_manifest_declares_the_v2_icons(self):
        r = self.client.get("/static/manifest.json")
        self.assertEqual(r.status_code, 200)
        m = json.loads(r.get_data(as_text=True))
        self.assertEqual(m["start_url"], "/")
        self.assertEqual(m["scope"], "/")
        self.assertEqual(m["display"], "standalone")
        sizes = {i["sizes"] for i in m["icons"]}
        self.assertIn("192x192", sizes)
        self.assertIn("512x512", sizes)
        self.assertTrue(all(i["src"].endswith("-v2.png") for i in m["icons"]))


class TestFileRead(BaseTest):
    def test_read_existing(self):
        code, data = self.jget("/api/file?path=Welcome.md")
        self.assertEqual(code, 200)
        self.assertEqual(data["path"], "Welcome.md")
        self.assertIn("Welcome", data["content"])

    def test_read_missing(self):
        code, _ = self.jget("/api/file?path=nope.md")
        self.assertEqual(code, 404)

    def test_read_invalid_path(self):
        code, _ = self.jget("/api/file?path=../app.py")
        self.assertEqual(code, 400)
        code, _ = self.jget("/api/file?path=/etc/passwd")
        self.assertEqual(code, 400)
        code, _ = self.jget("/api/file?path=notes/../../app.py")
        self.assertEqual(code, 400)

    def test_read_returns_mtime(self):
        code, data = self.jget("/api/file?path=Welcome.md")
        self.assertEqual(code, 200)
        self.assertIsInstance(data.get("mtime"), (int, float))
        self.assertGreater(data["mtime"], 0)

    def test_read_conditional_304_when_unchanged(self):
        code, data = self.jget("/api/file?path=Welcome.md")
        mtime = data["mtime"]
        # Sub-second filesystem timestamps can drift between calls; ask the
        # server for a value that is definitively past any read mtime.
        r = self.client.get("/api/file?path=Welcome.md&ifModifiedSince=%f" % (mtime + 1))
        self.assertEqual(r.status_code, 304)
        self.assertEqual(r.get_data(as_text=True), "")

    def test_read_conditional_falls_through_when_changed(self):
        self.post("/api/file", {"path": "hello.md", "content": "v1"})
        _, d1 = self.jget("/api/file?path=hello.md")
        # Tell the client the file changed a long time ago -> 200 with body.
        r = self.client.get("/api/file?path=hello.md&ifModifiedSince=0")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["content"], "v1")
        self.assertIsInstance(body["mtime"], (int, float))


class TestFileSave(BaseTest):
    def test_save_creates_and_reads_back(self):
        r = self.post("/api/file", {"path": "hello.md", "content": "# Hi"})
        self.assertEqual(r.status_code, 200)
        code, data = self.jget("/api/file?path=hello.md")
        self.assertEqual(code, 200)
        self.assertEqual(data["content"], "# Hi")

    def test_save_overwrites(self):
        self.post("/api/file", {"path": "hello.md", "content": "v1"})
        self.post("/api/file", {"path": "hello.md", "content": "v2"})
        code, data = self.jget("/api/file?path=hello.md")
        self.assertEqual(data["content"], "v2")

    def test_save_missing_parent_rejected(self):
        r = self.post("/api/file", {"path": "nodir/x.md", "content": "x"})
        self.assertEqual(r.status_code, 400)

    def test_save_traversal_rejected(self):
        r = self.post("/api/file", {"path": "../config/config.json", "content": "x"})
        self.assertEqual(r.status_code, 400)
        # config.json must NOT be overwritten
        with open(nb.CONFIG_FILE) as f:
            self.assertEqual(json.load(f), {})

    def test_save_missing_fields(self):
        r = self.post("/api/file", {"path": "x.md"})  # no content
        self.assertEqual(r.status_code, 400)

    def test_concurrent_atomic_writes_do_not_crash_or_tear(self):
        # atomic_write used a FIXED "<path>.tmp" shared by every writer:
        # with two writers in flight, one os.replace consumed the temp
        # file and the other writer died with FileNotFoundError (a 500
        # for a user save), and interleaved open("w")s could publish
        # torn content. The temp name is now unique per write, so
        # concurrent saves to the same target all succeed and every
        # published file is exactly one writer's content.
        import threading

        path = os.path.join(nb.DATA_DIR, "race.md")
        payload = {c: c * 64 * 1024 for c in "ABCDEFGH"}
        errors = []
        barrier = threading.Barrier(len(payload))
        stop = threading.Event()

        def writer(ch):
            try:
                barrier.wait()
                for _ in range(20):
                    nb.atomic_write(path, payload[ch])
            except Exception as exc:   # noqa: BLE001 - record any failure
                errors.append(exc)

        threads = [threading.Thread(target=writer, args=(ch,)) for ch in payload]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        stop.set()
        self.assertEqual(errors, [], "concurrent atomic_write raised: %r" % errors[:3])
        with open(path) as f:
            final = f.read()
        self.assertIn(final, [payload[c] for c in payload],
                      "published file is torn (not one writer's content)")
        # Normal operation leaves no temp litter behind.
        leftovers = [n for n in os.listdir(nb.DATA_DIR) if ".tmp" in n]
        self.assertEqual(leftovers, [], "leftover temp files: %r" % leftovers)


class TestCreate(BaseTest):
    def test_create_file_and_dir(self):
        r = self.post("/api/create", {"path": "notes", "type": "dir"})
        self.assertEqual(r.status_code, 200)
        r = self.post("/api/create", {"path": "notes/a.md", "type": "file"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "notes", "a.md")))

    def test_create_duplicate_conflict(self):
        self.post("/api/create", {"path": "a.md", "type": "file"})
        r = self.post("/api/create", {"path": "a.md", "type": "file"})
        self.assertEqual(r.status_code, 409)

    def test_create_bad_type(self):
        r = self.post("/api/create", {"path": "x", "type": "weird"})
        self.assertEqual(r.status_code, 400)

    def test_create_traversal_rejected(self):
        r = self.post("/api/create", {"path": "../escape", "type": "dir"})
        self.assertEqual(r.status_code, 400)

    # --- upsert / idempotent create ---------------------------------------
    def test_create_upsert_creates_when_missing(self):
        r = self.post("/api/create", {"path": "new.md", "type": "file",
                                      "upsert": True, "content": "# Seed"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["existed"])
        code, data = self.jget("/api/file?path=new.md")
        self.assertEqual(data["content"], "# Seed")

    def test_create_upsert_existing_is_idempotent(self):
        self.post("/api/file", {"path": "a.md", "content": "real content"})
        r = self.post("/api/create", {"path": "a.md", "type": "file",
                                      "upsert": True, "content": "seed"})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["existed"])
        # Existing content must NOT be clobbered by an upsert.
        code, data = self.jget("/api/file?path=a.md")
        self.assertEqual(data["content"], "real content")

    def test_create_upsert_dir(self):
        self.post("/api/create", {"path": "d", "type": "dir"})
        r = self.post("/api/create", {"path": "d", "type": "dir",
                                      "upsert": True})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["existed"])

    def test_create_upsert_type_mismatch_conflict(self):
        # A file at that path is not a dir and vice versa: still a 409
        # even under upsert, so agents don't silently "ensure" the wrong kind.
        self.post("/api/create", {"path": "thing", "type": "file"})
        r = self.post("/api/create", {"path": "thing", "type": "dir",
                                      "upsert": True})
        self.assertEqual(r.status_code, 409)
        self.post("/api/create", {"path": "d2", "type": "dir"})
        r = self.post("/api/create", {"path": "d2", "type": "file",
                                      "upsert": True})
        self.assertEqual(r.status_code, 409)

    def test_create_upsert_must_be_boolean(self):
        r = self.post("/api/create", {"path": "x.md", "type": "file",
                                      "upsert": "yes"})
        self.assertEqual(r.status_code, 400)


class TestMove(BaseTest):
    def test_move_renames(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        r = self.post("/api/move", {"from": "a.md", "to": "b.md"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.exists(os.path.join(nb.DATA_DIR, "a.md")))
        self.assertTrue(os.path.exists(os.path.join(nb.DATA_DIR, "b.md")))

    def test_move_into_subdir(self):
        self.post("/api/create", {"path": "sub", "type": "dir"})
        self.post("/api/file", {"path": "a.md", "content": "A"})
        r = self.post("/api/move", {"from": "a.md", "to": "sub/a.md"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "sub", "a.md")))

    def test_move_onto_existing_conflict(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        self.post("/api/file", {"path": "b.md", "content": "B"})
        r = self.post("/api/move", {"from": "a.md", "to": "b.md"})
        self.assertEqual(r.status_code, 409)

    def test_move_missing_source(self):
        r = self.post("/api/move", {"from": "nope.md", "to": "x.md"})
        self.assertEqual(r.status_code, 404)

    # --- onConflict modes -------------------------------------------------
    def test_move_skip_conflict_leaves_both_sides_alone(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        self.post("/api/file", {"path": "b.md", "content": "B"})
        r = self.post("/api/move", {"from": "a.md", "to": "b.md",
                                    "onConflict": "skip"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["skipped"])
        # Nothing changed.
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "a.md")))
        code, data = self.jget("/api/file?path=b.md")
        self.assertEqual(data["content"], "B")

    def test_move_overwrite_conflict_replaces_destination(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        self.post("/api/file", {"path": "b.md", "content": "B"})
        r = self.post("/api/move", {"from": "a.md", "to": "b.md",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.exists(os.path.join(nb.DATA_DIR, "a.md")))
        code, data = self.jget("/api/file?path=b.md")
        self.assertEqual(data["content"], "A")

    def test_move_bad_conflict_mode(self):
        r = self.post("/api/move", {"from": "a.md", "to": "b.md",
                                    "onConflict": "merge"})
        self.assertEqual(r.status_code, 400)

    def test_move_onto_itself_rejected(self):
        # Overwrite mode removes the destination first; when source ==
        # destination that destroys the file before the rename happens.
        # Reject outright so the file is never lost.
        self.post("/api/file", {"path": "v.md", "content": "IMPORTANT"})
        r = self.post("/api/move", {"from": "v.md", "to": "v.md",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 400)
        code, data = self.jget("/api/file?path=v.md")
        self.assertEqual(data["content"], "IMPORTANT")

    def test_move_to_root_rejected(self):
        # The notebook root is not a valid destination: with overwrite,
        # the conflict resolution would rmtree the whole data tree.
        self.post("/api/file", {"path": "a.md", "content": "A"})
        r = self.post("/api/move", {"from": "a.md", "to": ".",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 400)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "a.md")))
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "Welcome.md")))

    def test_move_symlink_dir_moves_link_not_target(self):
        # A symlinked "directory" must move as a link (mv semantics),
        # never relocate the real target tree it points at.
        target = os.path.join(_TMP, "mv-target")
        os.makedirs(os.path.join(target, "proj"), exist_ok=True)
        with open(os.path.join(target, "proj", "keep.md"), "w") as f:
            f.write("keep")
        os.symlink(target, os.path.join(nb.DATA_DIR, "proj"))
        r = self.post("/api/move", {"from": "proj", "to": "proj2"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.lexists(os.path.join(nb.DATA_DIR, "proj")))
        self.assertTrue(os.path.islink(os.path.join(nb.DATA_DIR, "proj2")))
        self.assertTrue(os.path.isfile(os.path.join(target, "proj", "keep.md")),
                        "the link target must not have moved")

    def test_move_dir_overwrite(self):
        self.post("/api/create", {"path": "d1", "type": "dir"})
        self.post("/api/create", {"path": "d2", "type": "dir"})
        self.post("/api/file", {"path": "d1/x.md", "content": "X"})
        self.post("/api/file", {"path": "d2/y.md", "content": "Y"})
        r = self.post("/api/move", {"from": "d1", "to": "d2",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.exists(os.path.join(nb.DATA_DIR, "d1")))
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "d2", "x.md")))
        self.assertFalse(os.path.exists(os.path.join(nb.DATA_DIR, "d2", "y.md")))


class TestCopy(BaseTest):
    def test_copy_file(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        r = self.post("/api/copy", {"from": "a.md", "to": "b.md"})
        self.assertEqual(r.status_code, 200)
        # both exist, b has same content
        code, data = self.jget("/api/file?path=b.md")
        self.assertEqual(data["content"], "A")

    def test_copy_dir_recursive(self):
        self.post("/api/create", {"path": "d", "type": "dir"})
        self.post("/api/file", {"path": "d/x.md", "content": "X"})
        r = self.post("/api/copy", {"from": "d", "to": "d2"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "d2", "x.md")))

    def test_copy_onto_existing_conflict(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        self.post("/api/file", {"path": "b.md", "content": "B"})
        r = self.post("/api/copy", {"from": "a.md", "to": "b.md"})
        self.assertEqual(r.status_code, 409)

    # --- onConflict modes -------------------------------------------------
    def test_copy_skip_conflict(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        self.post("/api/file", {"path": "b.md", "content": "B"})
        r = self.post("/api/copy", {"from": "a.md", "to": "b.md",
                                    "onConflict": "skip"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["skipped"])
        code, data = self.jget("/api/file?path=b.md")
        self.assertEqual(data["content"], "B")

    def test_copy_overwrite_conflict(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        self.post("/api/file", {"path": "b.md", "content": "B"})
        r = self.post("/api/copy", {"from": "a.md", "to": "b.md",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 200)
        code, data = self.jget("/api/file?path=b.md")
        self.assertEqual(data["content"], "A")

    def test_copy_onto_itself_rejected(self):
        # Overwrite removes the destination first; source == destination
        # would truncate the file to zero before copying from the (gone)
        # source. Reject outright so content is never lost.
        self.post("/api/file", {"path": "w.md", "content": "IMPORTANT"})
        r = self.post("/api/copy", {"from": "w.md", "to": "w.md",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 400)
        code, data = self.jget("/api/file?path=w.md")
        self.assertEqual(data["content"], "IMPORTANT")

    def test_copy_to_root_rejected(self):
        # The notebook root is not a copyable destination: with
        # overwrite the conflict resolution would delete the whole tree.
        self.post("/api/file", {"path": "b.md", "content": "B"})
        r = self.post("/api/copy", {"from": "b.md", "to": ".",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 400)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "b.md")))
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "Welcome.md")))

    def test_copy_bad_conflict_mode(self):
        r = self.post("/api/copy", {"from": "a.md", "to": "b.md",
                                    "onConflict": "dedupe"})
        self.assertEqual(r.status_code, 400)


class TestDelete(BaseTest):
    def test_delete_file(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        r = self.post("/api/delete", {"path": "a.md"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.exists(os.path.join(nb.DATA_DIR, "a.md")))

    def test_delete_dir(self):
        self.post("/api/create", {"path": "d", "type": "dir"})
        self.post("/api/file", {"path": "d/x.md", "content": "X"})
        r = self.post("/api/delete", {"path": "d"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.exists(os.path.join(nb.DATA_DIR, "d")))

    def test_delete_missing(self):
        r = self.post("/api/delete", {"path": "nope.md"})
        self.assertEqual(r.status_code, 404)

    def test_delete_root_rejected(self):
        r = self.post("/api/delete", {"path": ""})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/delete", {"path": ".."})
        self.assertEqual(r.status_code, 400)

    def test_delete_dot_variants_rejected(self):
        # "." (and spellings that normalise to it) resolve to the notebook
        # root itself; deleting it would wipe every note in one call.
        for probe in (".", "./", "x/..", "sub/.."):
            r = self.post("/api/delete", {"path": probe})
            self.assertEqual(r.status_code, 400, probe)
        self.assertTrue(os.path.isdir(nb.DATA_DIR))
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "Welcome.md")))

    def test_delete_symlink_dir_removes_link_not_target(self):
        # An interior symlink is a link, not a directory: delete must
        # unlink the link (rm semantics) and leave the target's tree
        # untouched -- the target may hold data outside the notebook.
        target = os.path.join(_TMP, "outside-target")
        os.makedirs(os.path.join(target, "important"), exist_ok=True)
        with open(os.path.join(target, "important", "db.txt"), "w") as f:
            f.write("precious")
        link = os.path.join(nb.DATA_DIR, "link")
        os.symlink(target, link)
        r = self.post("/api/delete", {"path": "link"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.lexists(link))
        self.assertTrue(os.path.isfile(os.path.join(target, "important", "db.txt")),
                        "delete must not rmtree the symlink target")


class TestSymlinkedDataDir(BaseTest):
    """safe_path()/rel_from() with DATA_DIR itself a symlink.

    The production layout symlinks notebook/ (e.g. to another folder),
    so the lexical/realpath distinction is load-bearing: safe_path()
    must return paths that stay textually under DATA_DIR so boundary
    guards and rel_from() agree with it.
    """

    def setUp(self):
        super().setUp()
        # Re-point the module's DATA_DIR at a symlinked view of the
        # seeded test notebook. seed() already ran in BaseTest.setUp on
        # the real folder; move it behind a symlink and re-seed via the
        # app's own helpers (no route touches DATA_DIR between the two).
        real = nb.DATA_DIR + ".real"
        if os.path.isdir(real):
            shutil.rmtree(real)
        if os.path.isdir(nb.DATA_DIR):
            shutil.move(nb.DATA_DIR, real)
        os.symlink(real, nb.DATA_DIR)

    def tearDown(self):
        # Restore the real dir before the next test's setUp wipes it.
        if os.path.islink(nb.DATA_DIR):
            os.unlink(nb.DATA_DIR)
            real = nb.DATA_DIR + ".real"
            if os.path.isdir(real):
                shutil.move(real, nb.DATA_DIR)
        super().tearDown()

    def test_delete_root_rejected_through_symlink(self):
        # safe_path(".") must return a path the root guard recognises.
        r = self.post("/api/delete", {"path": "."})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/delete", {"path": "./"})
        self.assertEqual(r.status_code, 400)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "Welcome.md")))

    def test_ls_reports_clean_relative_paths(self):
        self.post("/api/create", {"path": "sub", "type": "dir"})
        self.post("/api/file", {"path": "sub/a.md", "content": "needle here"})
        r = self.client.get("/api/ls?path=sub")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["path"], "sub")
        r = self.client.get("/api/search?q=needle&file=sub/a.md")
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertEqual(data["file"], "sub/a.md")
        self.assertEqual(data["matches"][0]["file"], "sub/a.md")

    def test_move_and_copy_root_rejected(self):
        self.post("/api/file", {"path": "a.md", "content": "A"})
        r = self.post("/api/move", {"from": "a.md", "to": ".",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 400)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "a.md")))
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "Welcome.md")))
        r = self.post("/api/copy", {"from": "a.md", "to": ".",
                                    "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 400)
        self.assertTrue(os.path.isfile(os.path.join(nb.DATA_DIR, "a.md")))


class TestLs(BaseTest):
    """GET /api/ls: non-recursive single-directory listing."""

    def setUp(self):
        super().setUp()
        self.post("/api/create", {"path": "notes", "type": "dir"})
        self.post("/api/file", {"path": "notes/a.md", "content": "A"})
        # Non-markdown file: /api/tree hides it, /api/ls must show it.
        self.post("/api/file", {"path": "notes/attachment.txt",
                                "content": "not markdown"})
        with open(os.path.join(nb.DATA_DIR, ".hidden"), "w") as f:
            f.write("x")

    def _entries(self, qs=""):
        code, data = self.jget("/api/ls" + qs)
        self.assertEqual(code, 200)
        return data

    def test_lists_one_folder_non_recursive_all_types(self):
        data = self._entries("?path=notes")
        self.assertEqual(data["path"], "notes")
        entries = {e["name"]: e for e in data["entries"]}
        # Only this folder's direct children; no recursion happened
        # (there are no subfolders here to leak), and .txt is included.
        self.assertEqual(set(entries), {"a.md", "attachment.txt"})
        self.assertEqual(entries["a.md"]["type"], "file")
        self.assertEqual(entries["attachment.txt"]["size"], len("not markdown"))
        self.assertIsInstance(entries["a.md"]["mtime"], float)

    def test_root_listing_default(self):
        data = self._entries()
        names = {e["name"] for e in data["entries"]}
        self.assertIn("Welcome.md", names)
        self.assertIn("notes", names)
        self.assertNotIn(".hidden", names)   # hidden entries skipped

    def test_dirs_sort_before_files(self):
        self.post("/api/file", {"path": "aaa.md", "content": "A"})
        data = self._entries()
        types = [e["type"] for e in data["entries"]]
        self.assertEqual(types[0], "dir")   # notes first despite name order
        self.assertNotIn("dir", types[1:])

    def test_missing_and_nonfolder_paths(self):
        code, _ = self.jget("/api/ls?path=nope")
        self.assertEqual(code, 404)
        code, _ = self.jget("/api/ls?path=Welcome.md")
        self.assertEqual(code, 404)   # a file is not a folder

    def test_traversal_rejected(self):
        for bad in ("../config", "/etc", "notes/../../etc"):
            r = self.client.get("/api/ls?path=" + bad)
            self.assertEqual(r.status_code, 400)


class TestAppend(BaseTest):
    """POST /api/file/append: atomic O_APPEND writes."""

    def test_append_to_existing_file(self):
        self.post("/api/file", {"path": "log.md", "content": "line1\n"})
        r = self.post("/api/file/append", {"path": "log.md",
                                           "content": "line2\n"})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["appended"], len("line2\n"))
        code, data = self.jget("/api/file?path=log.md")
        self.assertEqual(data["content"], "line1\nline2\n")
        self.assertEqual(body["size"], len("line1\nline2\n"))

    def test_appends_accumulate_in_order(self):
        self.post("/api/file", {"path": "log.md", "content": ""})
        for chunk in ("a", "b", "c"):
            r = self.post("/api/file/append", {"path": "log.md",
                                               "content": chunk})
            self.assertEqual(r.status_code, 200)
        _, data = self.jget("/api/file?path=log.md")
        self.assertEqual(data["content"], "abc")

    def test_append_missing_404_without_create_flag(self):
        r = self.post("/api/file/append", {"path": "nope.md", "content": "x"})
        self.assertEqual(r.status_code, 404)

    def test_append_create_flag_makes_new_file(self):
        # create:true makes the FILE; its parent folder must already
        # exist (same rule as POST /api/file).
        self.post("/api/create", {"path": "journal", "type": "dir"})
        r = self.post("/api/file/append", {"path": "journal/new.md",
                                           "content": "first\n",
                                           "create": True})
        self.assertEqual(r.status_code, 200)
        _, data = self.jget("/api/file?path=journal/new.md")
        self.assertEqual(data["content"], "first\n")

    def test_append_create_with_missing_parent_400(self):
        r = self.post("/api/file/append", {"path": "nodir/x.md",
                                           "content": "x", "create": True})
        self.assertEqual(r.status_code, 400)

    def test_append_traversal_and_type_rejected(self):
        r = self.post("/api/file/append", {"path": "../escape.md",
                                           "content": "x"})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/file/append", {"path": "x.md", "content": 42})
        self.assertEqual(r.status_code, 400)


class TestEdit(BaseTest):
    """POST /api/edit: all-or-nothing server-side patches."""

    CONTENT = "alpha beta\ngamma delta\nepsilon zeta"

    def setUp(self):
        super().setUp()
        self.post("/api/file", {"path": "patch.md", "content": self.CONTENT})

    def _content(self):
        code, data = self.jget("/api/file?path=patch.md")
        self.assertEqual(code, 200)
        return data["content"]

    def _edit(self, edits, expect=200):
        r = self.post("/api/edit", {"path": "patch.md", "edits": edits})
        self.assertEqual(
            r.status_code, expect,
            "edits %r -> %s: %s" % (edits, r.status_code, r.get_data(as_text=True)))
        return r.get_json() if r.status_code == 200 else None

    def test_append_and_prepend(self):
        self._edit([{"op": "append", "text": "\ntail"},
                    {"op": "prepend", "text": "# Top\n"}])
        self.assertEqual(
            self._content(),
            "# Top\nalpha beta\ngamma delta\nepsilon zeta\ntail")

    def test_find_replace_literal_count(self):
        self._edit([{"op": "find_replace", "find": "a", "replace_with": "@",
                     "count": 2}])
        # Only the first two 'a's replaced; count=0/all would hit many more.
        self.assertTrue(self._content().startswith("@lph@ beta"))

    def test_find_replace_strict_when_no_match(self):
        before = self._content()
        resp = self.post("/api/edit", {"path": "patch.md", "edits": [
            {"op": "find_replace", "find": "absent-text",
             "replace_with": "x"}]})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("no match", resp.get_json()["error"])
        self.assertEqual(self._content(), before)       # untouched

    def test_find_replace_optional_allows_noop(self):
        self._edit([{"op": "find_replace", "find": "absent-text",
                     "replace_with": "x", "optional": True}])
        self.assertEqual(self._content(), self.CONTENT)

    def test_find_replace_regex_backrefs(self):
        self._edit([{"op": "find_replace",
                     "find": r"(\w+) (\w+)", "replace_with": r"\2 \1",
                     "regex": True, "count": 1}])
        self.assertEqual(
            self._content(), "beta alpha\ngamma delta\nepsilon zeta")

    def test_find_replace_ignore_case(self):
        # ignore_case is a regex-mode flag (literal matching uses the
        # global ?case= behaviour instead).
        self._edit([{"op": "find_replace", "find": "gamma",
                     "replace_with": "GAMMA!", "regex": True,
                     "ignore_case": True}])
        self.assertIn("GAMMA! delta", self._content())

    def test_line_insert_before_after(self):
        self._edit([{"op": "line_insert", "after_line": 0, "text": "top"}])
        self._edit([{"op": "line_insert", "after_line": 2, "text": "mid"}])
        self.assertEqual(
            self._content(),
            "top\nalpha beta\nmid\ngamma delta\nepsilon zeta\n")
        self._edit([{"op": "line_insert", "before_line": 2,
                     "text": "pre-alpha"}])
        self.assertEqual(
            self._content(),
            "top\npre-alpha\nalpha beta\nmid\ngamma delta\nepsilon zeta\n")

    def test_line_insert_requires_exactly_one_position(self):
        self._edit([{"op": "line_insert", "text": "x"}], expect=400)
        self._edit([{"op": "line_insert", "text": "x", "after_line": 1,
                     "before_line": 1}], expect=400)
        self.assertEqual(self._content(), self.CONTENT)

    def test_line_replace_range(self):
        self._edit([{"op": "line_replace", "start": 2, "end": 99}],
                   expect=400)   # out of range -> rejected, nothing written
        self._edit([{"op": "line_replace", "start": 2, "end": 3,
                     "text": "replaced\nlines"}])
        self.assertEqual(self._content(),
                         "alpha beta\nreplaced\nlines\n")

    def test_line_delete_range_and_default_end(self):
        # end defaults to start: deleting line 1 removes just that line.
        # The buffer gains the trailing newline line ops normalise in.
        self._edit([{"op": "line_delete", "start": 1}])
        self.assertEqual(self._content(), "gamma delta\nepsilon zeta\n")
        self._edit([{"op": "line_delete", "start": 1, "end": 2}])
        self.assertEqual(self._content(), "")

    def test_batch_is_all_or_nothing(self):
        before = self._content()
        self._edit([
            {"op": "append", "text": "\nok"},
            {"op": "find_replace", "find": "does-not-exist",
             "replace_with": "x"},   # second op fails...
        ], expect=400)
        # ...so even the successful first op must NOT be applied.
        self.assertEqual(self._content(), before)

    def test_unknown_op_and_bad_payloads_rejected(self):
        self._edit([{"op": "teleport"}], expect=400)
        self._edit(["not-an-object"], expect=400)
        r = self.post("/api/edit", {"path": "patch.md", "edits": []})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/edit", {"path": "patch.md"})
        self.assertEqual(r.status_code, 400)

    def test_edit_missing_file_and_traversal(self):
        r = self.post("/api/edit", {"path": "nope.md",
                                    "edits": [{"op": "append", "text": "x"}]})
        self.assertEqual(r.status_code, 404)
        r = self.post("/api/edit", {"path": "../app.py",
                                    "edits": [{"op": "append", "text": "x"}]})
        self.assertEqual(r.status_code, 400)

    def test_line_ops_normalise_trailing_newline(self):
        # patch.md has no trailing newline; a line op adds one so later
        # inserts can't glue onto the last fragment.
        self._edit([{"op": "line_delete", "start": 3}])
        content = self._content()
        self.assertEqual(content, "alpha beta\ngamma delta\n")
        self.assertTrue(content.endswith("\n"))


class TestSearch(BaseTest):
    def setUp(self):
        super().setUp()
        self.post("/api/file", {"path": "a.md",
            "content": "# A\n\nTODO fix this bug here\n\n## Sub\n\nbody fix this again"})
        self.post("/api/file", {"path": "b.md", "content": "# B\n\nFix This with capitals\n"})

    def _matches(self, q, case=False, **params):
        qs = "q=%s&case=%d" % (q, 1 if case else 0)
        for key, val in params.items():
            if val is True:
                val = "1"
            qs += "&%s=%s" % (key, val)
        code, data = self.jget("/api/search?" + qs)
        self.assertEqual(code, 200)
        return data

    def test_case_insensitive_finds_all(self):
        data = self._matches("fix this")
        files = {m["file"] for m in data["matches"]}
        self.assertIn("a.md", files)
        self.assertIn("b.md", files)
        self.assertGreater(len(data["matches"]), 1)

    def test_case_sensitive_only_exact(self):
        data = self._matches("Fix This", case=True)
        files = {m["file"] for m in data["matches"]}
        self.assertEqual(files, {"b.md"})

    def test_snippet_markers(self):
        data = self._matches("fix this")
        self.assertTrue(any("<<" in m["snippet"] and ">>" in m["snippet"]
                            for m in data["matches"]))
        # line numbers are 1-based and present
        self.assertTrue(all(m["line"] >= 1 for m in data["matches"]))

    def test_empty_query_rejected(self):
        code, _ = self.jget("/api/search?q=")
        self.assertEqual(code, 400)

    # --- regex mode -------------------------------------------------------
    def test_regex_mode_word_boundary(self):
        # \bfix\b matches whole words only: a.md's two hits plus b.md's
        # capitalised "Fix This", but NOT template words like "Fixed" or
        # "--debug" that merely contain the letters.
        data = self._matches(r"\bfix\b", regex=True)
        counts = {}
        for m in data["matches"]:
            counts[m["file"]] = counts.get(m["file"], 0) + 1
        self.assertEqual(counts, {"a.md": 2, "b.md": 1})

    def test_regex_invalid_rejected(self):
        r = self.client.get("/api/search?q=(unclosed&regex=1")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Invalid regex", r.get_json()["error"])

    def test_regex_alternation(self):
        # "TODO" lives only in a.md, "capitals" only in b.md; template
        # notes contain neither word.
        data = self._matches(r"todo|capitals", regex=True)
        files = {m["file"] for m in data["matches"]}
        self.assertEqual(files, {"a.md", "b.md"})

    def test_regex_respects_case_flag(self):
        # Case-sensitive regex matches only a.md's lowercase "fix this";
        # default insensitive matching also picks up b.md's "Fix This".
        data = self._matches(r"fix this", case=True)
        files = {m["file"] for m in data["matches"]}
        self.assertIn("a.md", files)
        self.assertNotIn("b.md", files)
        data = self._matches(r"FIX THIS")
        self.assertIn("b.md", {m["file"] for m in data["matches"]})

    # --- single-file scope -------------------------------------------------
    def test_file_scope_searches_only_that_file(self):
        code, data = self.jget("/api/search?q=fix%20this&file=a.md")
        self.assertEqual(code, 200)
        self.assertEqual(data.get("file"), "a.md")
        self.assertTrue(data["matches"])
        self.assertEqual({m["file"] for m in data["matches"]}, {"a.md"})

    def test_file_scope_missing_and_invalid(self):
        r = self.client.get("/api/search?q=x&file=nope.md")
        self.assertEqual(r.status_code, 404)
        r = self.client.get("/api/search?q=x&file=../app.py")
        self.assertEqual(r.status_code, 400)

    # --- glob filter -------------------------------------------------------
    def test_glob_filters_files_scanned(self):
        from urllib.parse import quote
        _, full = self.jget("/api/search?q=" + quote("fix this"))
        self.assertGreaterEqual(len(full["matches"]), 2)
        _, only_b = self.jget("/api/search?q=" + quote("fix this") + "&glob=b*")
        self.assertEqual({m["file"] for m in only_b["matches"]}, {"b.md"})
        _, none_ = self.jget("/api/search?q=" + quote("fix this") + "&glob=nope*")
        self.assertEqual(none_["matches"], [])
        self.assertFalse(none_["truncated"])

    # --- caps ----------------------------------------------------------------
    def test_per_file_cap_override(self):
        # a.md contains two "fix this" hits; default cap is 20 so both
        # come back. perFile=1 must return exactly one from that file.
        _, full = self.jget("/api/search?q=fix%20this")
        in_a = [m for m in full["matches"] if m["file"] == "a.md"]
        self.assertEqual(len(in_a), 2)
        _, capped = self.jget("/api/search?q=fix%20this&perFile=1")
        in_a_capped = [m for m in capped["matches"] if m["file"] == "a.md"]
        self.assertEqual(len(in_a_capped), 1)

    def test_total_limit_override_truncates(self):
        _, data = self.jget("/api/search?q=fix%20this&limit=1")
        self.assertEqual(len(data["matches"]), 1)
        self.assertTrue(data["truncated"])

    def test_bad_caps_rejected(self):
        r = self.client.get("/api/search?q=x&limit=abc")
        self.assertEqual(r.status_code, 400)
        r = self.client.get("/api/search?q=x&perFile=abc")
        self.assertEqual(r.status_code, 400)

    # --- ordering --------------------------------------------------------------
    def test_order_count_desc_most_matches_first(self):
        # a.md has 2 hits, b.md has 1 -> with order=count desc, a first.
        _, data = self.jget("/api/search?q=fix%20this&order=count&desc=1")
        files = [m["file"] for m in data["matches"]]
        self.assertEqual(files[0], "a.md")

    def test_order_mtime_desc_newest_first(self):
        # Stamp explicit mtimes so the assertion is deterministic:
        # a.md older than b.md -> desc puts b's match first. a.md has
        # two hits for this query, b.md one.
        base = time.time()
        os.utime(os.path.join(nb.DATA_DIR, "a.md"), (base - 1000, base - 1000))
        os.utime(os.path.join(nb.DATA_DIR, "b.md"), (base, base))
        _, data = self.jget("/api/search?q=fix%20this&order=mtime&desc=1")
        self.assertEqual([m["file"] for m in data["matches"]],
                         ["b.md", "a.md", "a.md"])
        _, asc = self.jget("/api/search?q=fix%20this&order=mtime")
        self.assertEqual([m["file"] for m in asc["matches"]],
                         ["a.md", "a.md", "b.md"])

    def test_order_path_groups_files(self):
        _, data = self.jget("/api/search?q=fix%20this&order=path")
        files = [m["file"] for m in data["matches"]]
        self.assertEqual(files, sorted(files, key=str.lower))

    def test_order_invalid_rejected(self):
        r = self.client.get("/api/search?q=x&order=size")
        self.assertEqual(r.status_code, 400)

    # --- unique mode (AC6-AC12, AC22-AC24) --------------------------------
    def _write(self, path, content):
        r = self.post("/api/file", {"path": path, "content": content})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))

    def test_hidden_directories_are_not_scanned(self):
        # The tree hides dot-directories; search must not surface notes the
        # user cannot browse.
        self._write("visible.md", "zzhidden\n")
        os.makedirs(os.path.join(nb.DATA_DIR, ".trash"), exist_ok=True)
        self._write(".trash/gone.md", "zzhidden\n")
        data = self._matches("zzhidden")
        self.assertEqual([m["file"] for m in data["matches"]], ["visible.md"])
        data = self._matches("zzhidden", unique=1)
        self.assertEqual([m["file"] for m in data["matches"]], ["visible.md"])

    def test_unique_one_row_per_note_exact_count_and_first_hit(self):
        # AC6/AC10/AC22/AC23: two notes, one with 3 hits (two on one line),
        # one with a single hit. Unique returns one bundle per path; the
        # count is every occurrence and line/col/snippet describe the first.
        self._write("line.md", "zzline zzline\n\nzzline\n")
        self._write("one.md", "zzline\n")
        data = self._matches("zzline", unique=1)
        self.assertFalse(data["truncated"])
        self.assertFalse(data["perFileTruncated"])
        self.assertEqual(len(data["matches"]), 2)
        by_file = {m["file"]: m for m in data["matches"]}
        self.assertEqual(set(by_file), {"line.md", "one.md"})
        first = by_file["line.md"]
        self.assertEqual(first["count"], 3)
        self.assertEqual(first["line"], 1)
        self.assertEqual(first["col"], 1)
        self.assertEqual(first["snippet"].count("<<"), 1)
        self.assertIn("<<zzline>>", first["snippet"])
        self.assertEqual(by_file["one.md"]["count"], 1)

    def test_unique_two_hits_on_one_line_counts_two(self):
        # AC6: two occurrences on one line are two matches, one row.
        self._write("pair.md", "zztwo zztwo\n")
        data = self._matches("zztwo", unique=1)
        self.assertEqual(len(data["matches"]), 1)
        hit = data["matches"][0]
        self.assertEqual(hit["file"], "pair.md")
        self.assertEqual(hit["count"], 2)
        self.assertEqual(hit["line"], 1)
        self.assertEqual(hit["col"], 1)
        self.assertEqual(hit["snippet"].count("<<"), 1)

    def test_unique_per_file_cap_ignored_and_count_uncapped(self):
        # AC9/AC22: perFile is ignored in unique mode; the count is the true
        # number of occurrences even above the every-match per-file cap.
        self._write("many.md", "zzmany\n" * 25)
        data = self._matches("zzmany", unique=1, perFile=1)
        self.assertEqual(len(data["matches"]), 1)
        hit = data["matches"][0]
        self.assertEqual(hit["file"], "many.md")
        self.assertEqual(hit["count"], 25)
        self.assertFalse(data["perFileTruncated"])
        self.assertFalse(data["truncated"])

    def test_unique_order_count_desc_limit_caps_notes(self):
        # AC8: ordering runs over the full note set before the note cap, so
        # the two highest-count notes survive limit=2 and the third is gone.
        self._write("c1.md", "zzrank\n")
        self._write("c2.md", "zzrank\n" * 2)
        self._write("c3.md", "zzrank\n" * 3)
        data = self._matches("zzrank", unique=1, order="count", desc=1, limit=2)
        self.assertEqual([m["file"] for m in data["matches"]], ["c3.md", "c2.md"])
        self.assertEqual([m["count"] for m in data["matches"]], [3, 2])
        self.assertTrue(data["truncated"])
        self.assertNotIn("c1.md", {m["file"] for m in data["matches"]})
        # limit above the note count clears truncated.
        data = self._matches("zzrank", unique=1, order="count", desc=1, limit=3)
        self.assertFalse(data["truncated"])

    def test_unique_order_mtime_and_count_tiebreak_path(self):
        # AC7: unique honours order=mtime&desc=1 and uses path A-Z as the
        # deterministic tie-break for equal counts.
        self._write("zzold.md", "zzorder\n")
        self._write("zznew.md", "zzorder\n")
        base = time.time()
        os.utime(os.path.join(nb.DATA_DIR, "zzold.md"), (base - 1000, base - 1000))
        os.utime(os.path.join(nb.DATA_DIR, "zznew.md"), (base, base))
        data = self._matches("zzorder", unique=1, order="mtime", desc=1)
        self.assertEqual([m["file"] for m in data["matches"]],
                         ["zznew.md", "zzold.md"])
        data = self._matches("zzorder", unique=1, order="mtime")
        self.assertEqual([m["file"] for m in data["matches"]],
                         ["zzold.md", "zznew.md"])
        # Both notes have one hit: count desc must fall back to path A-Z.
        data = self._matches("zzorder", unique=1, order="count", desc=1)
        self.assertEqual([m["file"] for m in data["matches"]],
                         ["zznew.md", "zzold.md"])
        data = self._matches("zzorder", unique=1, order="path")
        self.assertEqual([m["file"] for m in data["matches"]],
                         ["zznew.md", "zzold.md"])

    def test_every_match_per_file_cap_disclosure_and_unique_false(self):
        # AC11/AC12: every-match mode flags a clipped file; unique mode
        # returns perFileTruncated false because the per-file cap is ignored.
        self._write("many.md", "zzcap\n" * 25)
        data = self._matches("zzcap")
        self.assertEqual(len(data["matches"]), 20)
        self.assertTrue(data["perFileTruncated"])
        self.assertFalse(data["truncated"])
        data = self._matches("zzcap", perFile=1)
        self.assertEqual(len(data["matches"]), 1)
        self.assertTrue(data["perFileTruncated"])
        data = self._matches("zzcap", unique=1, perFile=1)
        self.assertFalse(data["perFileTruncated"])
        self.assertEqual(data["matches"][0]["count"], 25)
        # A file under the cap never sets the flag.
        data = self._matches("fix this")
        self.assertFalse(data["perFileTruncated"])

    def test_legacy_response_unchanged_when_unique_absent_or_zero(self):
        # AC12: unique absent and unique=0 are the same legacy shape; count
        # is additive-only and never appears without unique=1.
        absent = self._matches("fix this")
        zero = self._matches("fix this", unique=0)
        self.assertEqual(absent, zero)
        self.assertEqual(set(absent),
                         {"query", "matches", "truncated", "perFileTruncated"})
        self.assertTrue(absent["matches"])
        self.assertTrue(all("count" not in m for m in absent["matches"]))
        self.assertFalse(absent["perFileTruncated"])

    def test_unique_paths_differing_only_by_case_not_merged(self):
        # AC24: the dedupe key is the exact relative path string.
        if os.path.normcase("CaseTwin.md") == os.path.normcase("casetwin.md"):
            self.skipTest("case-insensitive filesystem cannot hold both paths")
        self._write("CaseTwin.md", "zztwin\n")
        self._write("casetwin.md", "zztwin\n")
        data = self._matches("zztwin", unique=1)
        self.assertEqual(len(data["matches"]), 2)
        self.assertEqual({m["file"] for m in data["matches"]},
                         {"CaseTwin.md", "casetwin.md"})

    def test_unique_invalid_input_still_rejected(self):
        # Invalid input keeps the current 400 shapes in unique mode.
        for qs in ("q=x&unique=1&order=size",
                   "q=x&unique=1&limit=abc",
                   "q=x&unique=1&perFile=abc",
                   "q=x&unique=1&file=../app.py",
                   "q=&unique=1"):
            r = self.client.get("/api/search?" + qs)
            self.assertEqual(r.status_code, 400, qs)

    # --- name mode (basename search) --------------------------------------
    def _name_files(self, q, **params):
        data = self._matches(q, name=1, **params)
        self.assertFalse(data["perFileTruncated"])
        self.assertTrue(all(set(m) == {"file"} for m in data["matches"]))
        return [m["file"] for m in data["matches"]]

    def test_name_matches_basename_not_content(self):
        # A token in a note's body but in no basename returns nothing; the
        # same token in the basename returns that note once, with {file} only.
        self._write("weekly-review.md", "nothing relevant in the body\n")
        self._write("body-only.md", "weekly review notes in the body\n")
        self.assertEqual(self._name_files("weekly-review"), ["weekly-review.md"])
        self.assertEqual(self._name_files("relevant"), [])
        self.assertEqual(self._name_files("body-only.md"), ["body-only.md"])

    def test_name_case_and_regex_apply_to_basename(self):
        self._write("NameCase-Report.md", "zz\n")
        self.assertIn("NameCase-Report.md", self._name_files("namecase"))
        self.assertNotIn("NameCase-Report.md",
                         self._name_files("namecase", case=1))
        self.assertIn("NameCase-Report.md",
                      self._name_files("NameCase", case=1))
        self._write("regextarget-42.md", "zz\n")
        self.assertEqual(self._name_files(r"regextarget-\d\d", regex=1),
                         ["regextarget-42.md"])
        # Without regex the same text is a literal substring and misses.
        self.assertEqual(self._name_files(r"regextarget-\d\d"), [])
        self.assertEqual(self._name_files(r"REGEXTARGET-\d\d", regex=1,
                                          case=1), [])

    def test_name_limit_caps_notes_and_truncated(self):
        for suffix in ("a", "b", "c"):
            self._write("capname-%s.md" % suffix, "zz\n")
        self.assertEqual(len(self._name_files("capname", limit=2)), 2)
        self.assertTrue(self._matches("capname", name=1,
                                      limit=2)["truncated"])
        data = self._matches("capname", name=1, limit=3)
        self.assertEqual(len(data["matches"]), 3)
        self.assertFalse(data["truncated"])

    def test_name_order_path_mtime_and_count(self):
        self._write("zorder-b.md", "zz\n")
        self._write("zorder-a.md", "zz\n")
        base = time.time()
        os.utime(os.path.join(nb.DATA_DIR, "zorder-a.md"),
                 (base - 1000, base - 1000))
        os.utime(os.path.join(nb.DATA_DIR, "zorder-b.md"), (base, base))
        self.assertEqual(self._name_files("zorder", order="path"),
                         ["zorder-a.md", "zorder-b.md"])
        self.assertEqual(self._name_files("zorder", order="path", desc=1),
                         ["zorder-b.md", "zorder-a.md"])
        self.assertEqual(self._name_files("zorder", order="mtime", desc=1),
                         ["zorder-b.md", "zorder-a.md"])
        self.assertEqual(self._name_files("zorder", order="mtime"),
                         ["zorder-a.md", "zorder-b.md"])
        # Every note counts once, so count ordering is path ordering.
        self.assertEqual(self._name_files("zorder", order="count"),
                         self._name_files("zorder", order="path"))
        self.assertEqual(self._name_files("zorder", order="count", desc=1),
                         self._name_files("zorder", order="path", desc=1))

    def test_name_glob_and_file_scope(self):
        self._write("globname-a.md", "zz\n")
        self._write("globname-b.md", "zz\n")
        self.assertEqual(self._name_files("globname", glob="globname-a*"),
                         ["globname-a.md"])
        self.assertEqual(self._name_files("globname", glob="nope*"), [])
        self.assertEqual(self._name_files("globname-a", file="globname-a.md"),
                         ["globname-a.md"])
        data = self._matches("globname-a", name=1, file="globname-b.md")
        self.assertEqual(data["matches"], [])
        self.assertEqual(data.get("file"), "globname-b.md")

    def test_name_absent_keeps_content_search(self):
        # The basename token does not occur in the body, so the default
        # content search sees nothing while name mode finds the note.
        self._write("contentonly-token.md", "plain body\n")
        data = self._matches("contentonly-token")
        self.assertEqual(data["matches"], [])
        self.assertFalse(data["truncated"])
        self.assertEqual(self._name_files("contentonly-token"),
                         ["contentonly-token.md"])

    def test_name_invalid_input_still_rejected(self):
        for qs in ("q=x&name=1&order=size",
                   "q=x&name=1&limit=abc",
                   "q=&name=1",
                   "q=x&name=1&file=../app.py"):
            r = self.client.get("/api/search?" + qs)
            self.assertEqual(r.status_code, 400, qs)


class TestGraph(BaseTest):
    """The /api/graph endpoint scans .md files for [[wikilinks]] and
    standard [text](x.md) links and returns nodes + edges for the
    frontend's force-directed graph view."""

    def setUp(self):
        super().setUp()
        # Three files that link to each other so the graph has edges.
        #   index.md  -> [[Welcome]] (wikilink by stem)
        #              -> [notes](notes/a.md) (relative markdown link)
        #   notes/a.md -> [[index]] (wikilink by stem, no extension)
        #   notes/b.md -> (no links, should still appear as an orphan node)
        os.makedirs(os.path.join(nb.DATA_DIR, "notes"), exist_ok=True)
        self.post("/api/file", {"path": "index.md",
            "content": "# Index\n\nSee [[Welcome]] and [notes](notes/a.md).\n"})
        self.post("/api/file", {"path": "notes/a.md",
            "content": "# A\n\nBack to [[index]].\n"})
        self.post("/api/file", {"path": "notes/b.md",
            "content": "# B\n\nNo links here.\n"})

    def _graph(self):
        code, data = self.jget("/api/graph")
        self.assertEqual(code, 200)
        return data

    def test_returns_all_files_as_nodes(self):
        data = self._graph()
        ids = {n["id"] for n in data["nodes"]}
        # The template ships README.md, Syntax.md, Welcome.md; the test
        # adds index.md, notes/a.md, notes/b.md. Assert the test files are
        # present (a subset check) rather than exact equality so the
        # test doesn't break on template changes.
        self.assertTrue({"index.md", "notes/a.md", "notes/b.md"}.issubset(ids))

    def test_nodes_carry_name_and_degree(self):
        data = self._graph()
        for n in data["nodes"]:
            self.assertIn("name", n)
            self.assertIn("links", n)
            self.assertIsInstance(n["links"], int)
        # Welcome.md is linked from index.md via [[Welcome]] -> degree 1
        welcome = next(n for n in data["nodes"] if n["id"] == "Welcome.md")
        self.assertEqual(welcome["links"], 1)
        # notes/b.md has no links in or out -> degree 0
        b = next(n for n in data["nodes"] if n["id"] == "notes/b.md")
        self.assertEqual(b["links"], 0)

    def test_wikilink_by_stem_creates_edge(self):
        data = self._graph()
        pairs = {(e["source"], e["target"]) for e in data["edges"]}
        # Edges are stored sorted by id; "Welcome.md" < "index.md"
        self.assertIn(("Welcome.md", "index.md"), pairs)

    def test_relative_markdown_link_creates_edge(self):
        data = self._graph()
        pairs = {(e["source"], e["target"]) for e in data["edges"]}
        # index.md links to notes/a.md via [notes](notes/a.md)
        self.assertIn(("index.md", "notes/a.md"), pairs)

    def test_wikilink_without_extension_resolves(self):
        data = self._graph()
        pairs = {(e["source"], e["target"]) for e in data["edges"]}
        # notes/a.md links to [[index]] -> resolves to index.md
        self.assertIn(("index.md", "notes/a.md"), pairs)

    def test_self_link_dropped(self):
        # Write a file that links to itself; the edge should not appear.
        self.post("/api/file", {"path": "self.md",
            "content": "# Self\n\n[[self]] link to me.\n"})
        data = self._graph()
        for e in data["edges"]:
            self.assertNotEqual(e["source"], e["target"])

    def test_edges_undirected_dedup(self):
        # index.md -> Welcome.md and if Welcome.md also linked to index.md,
        # only one edge should exist. The dedup is by frozenset({src, dst}).
        self.post("/api/file", {"path": "Welcome.md",
            "content": "# Welcome\n\nLink to [[index]] and [a](notes/a.md).\n"})
        data = self._graph()
        pairs = {(e["source"], e["target"]) for e in data["edges"]}
        # Only one edge between index.md and Welcome.md regardless of
        # direction of the link.
        self.assertEqual(
            sum(1 for s, t in pairs
                if {s, t} == {"index.md", "Welcome.md"}), 1)

    def test_link_to_nonexistent_file_dropped(self):
        # A link to a file that doesn't exist should not create a ghost
        # node or edge.
        self.post("/api/file", {"path": "ghost.md",
            "content": "# Ghost\n\n[[nonexistent]] and [missing](nope.md).\n"})
        data = self._graph()
        ids = {n["id"] for n in data["nodes"]}
        self.assertNotIn("nonexistent", ids)
        self.assertNotIn("nope.md", ids)

    def test_anchor_fragment_stripped(self):
        # [[Welcome#section]] should link to Welcome.md, not a ghost node.
        self.post("/api/file", {"path": "anchor.md",
            "content": "# Anchor\n\n[[Welcome#intro]] link.\n"})
        data = self._graph()
        pairs = {(e["source"], e["target"]) for e in data["edges"]}
        self.assertIn(("Welcome.md", "anchor.md"), pairs)


class TestConfig(BaseTest):
    def test_default_empty(self):
        code, data = self.jget("/api/config")
        self.assertEqual(code, 200)
        self.assertEqual(data, {})

    def test_roundtrip(self):
        r = self.post("/api/config", {"theme": "light", "lastFile": "a.md",
                                      "sidebarCollapsed": True})
        self.assertEqual(r.status_code, 200)
        code, data = self.jget("/api/config")
        self.assertEqual(code, 200)
        self.assertEqual(data["theme"], "light")
        self.assertTrue(data["sidebarCollapsed"])

    def test_rejects_non_object(self):
        r = self.client.post("/api/config", json=["not", "an", "object"])
        # json= with a list still sends a JSON array; server checks for dict
        self.assertEqual(r.status_code, 400)


class TestInfo(BaseTest):
    def test_returns_dirs(self):
        code, data = self.jget("/api/info")
        self.assertEqual(code, 200)
        self.assertEqual(data["data_dir"], nb.DATA_DIR)
        self.assertEqual(data["config_dir"], nb.CONFIG_DIR)
        # Sanity: these are absolute paths under the temp dir.
        self.assertTrue(os.path.isabs(data["data_dir"]))


class TestAuth(BaseTest):
    """Two-password auth: admin (r/w) + viewer (r/o).

    Each test starts with a freshly-seeded config dir (BaseTest.setUp wipes
    it), then writes a custom auth.json with bcrypt-hashed admin + viewer
    passwords. The rate limiter is reset between tests so failures in one
    test don't bleed into the next.
    """

    ADMIN_PW = "admin-pw-secret"
    VIEWER_PW = "viewer-pw-secret"

    def setUp(self):
        super().setUp()
        # Reset the in-memory rate limiter so a test that intentionally trips
        # 5 failures doesn't lock out the next test's IP.
        nb._login_failures.clear()
        # BaseTest.setUp already wiped CONFIG_DIR; write our own auth.json
        # with both roles configured.
        import bcrypt as _bcrypt
        self._auth = {
            "secret": "test-secret-not-used-for-signing-just-a-stand-in",
            "admin_password_hash": _bcrypt.hashpw(
                self.ADMIN_PW.encode("utf-8"), _bcrypt.gensalt(12)
            ).decode(),
            "viewer_password_hash": _bcrypt.hashpw(
                self.VIEWER_PW.encode("utf-8"), _bcrypt.gensalt(12)
            ).decode(),
        }
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(self._auth, f)

    def _login(self, password):
        return self.client.post("/api/login", json={"password": password})

    def _login_session(self, password):
        """Log in and return a fresh test client with the session cookie set."""
        client = nb.app.test_client()
        r = client.post("/api/login", json={"password": password})
        self.assertEqual(r.status_code, 200, "login failed: %s" % r.get_data(as_text=True))
        return client

    # --- status / no-auth bypass -----------------------------------------
    def test_status_reports_enabled_when_passwords_set(self):
        code, data = self.jget("/api/auth")
        self.assertEqual(code, 200)
        self.assertTrue(data["enabled"])
        self.assertIsNone(data["role"])

    def test_status_reports_role_when_logged_in(self):
        client = self._login_session(self.ADMIN_PW)
        r = client.get("/api/auth")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["role"], "admin")

    def test_no_auth_file_disables_layer(self):
        # Fresh client + no auth.json on disk -> enabled is False.
        if os.path.isfile(nb.AUTH_FILE):
            os.remove(nb.AUTH_FILE)
        client = nb.app.test_client()
        # Reads work without any session.
        r = client.get("/api/auth")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["enabled"])
        # Writes work without any session.
        r = client.post("/api/file", json={"path": "x.md", "content": "y"})
        self.assertEqual(r.status_code, 200)

    # --- gating ----------------------------------------------------------
    def test_read_requires_login(self):
        r = self.client.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 401)

    def test_viewer_can_read(self):
        client = self._login_session(self.VIEWER_PW)
        r = client.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Welcome", r.get_json()["content"])

    def test_admin_can_read(self):
        client = self._login_session(self.ADMIN_PW)
        r = client.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 200)

    def test_viewer_cannot_write(self):
        client = self._login_session(self.VIEWER_PW)
        r = client.post("/api/file", json={"path": "x.md", "content": "y"})
        self.assertEqual(r.status_code, 403)

    def test_admin_can_write(self):
        client = self._login_session(self.ADMIN_PW)
        r = client.post("/api/file", json={"path": "x.md", "content": "y"})
        self.assertEqual(r.status_code, 200)
        # Round-trip
        r = client.get("/api/file?path=x.md")
        self.assertEqual(r.get_json()["content"], "y")

    def test_viewer_cannot_use_any_mutating_route(self):
        client = self._login_session(self.VIEWER_PW)
        for path, body in [
            ("/api/file",   {"path": "x.md", "content": "y"}),
            ("/api/file/append", {"path": "x.md", "content": "y"}),
            ("/api/edit",   {"path": "x.md", "edits": [{"op": "append", "text": "y"}]}),
            ("/api/create", {"path": "x", "type": "dir"}),
            ("/api/move",   {"from": "Welcome.md", "to": "x.md"}),
            ("/api/copy",   {"from": "Welcome.md", "to": "x.md"}),
            ("/api/delete", {"path": "Welcome.md"}),
            ("/api/config", {"theme": "dark"}),
        ]:
            r = client.post(path, json=body)
            self.assertEqual(
                r.status_code, 403,
                "viewer should be 403 on %s, got %s: %s"
                % (path, r.status_code, r.get_data(as_text=True)),
            )

    def test_admin_can_use_all_mutating_routes(self):
        client = self._login_session(self.ADMIN_PW)
        # create
        r = client.post("/api/create", json={"path": "sub", "type": "dir"})
        self.assertEqual(r.status_code, 200)
        # save
        r = client.post("/api/file", json={"path": "sub/a.md", "content": "A"})
        self.assertEqual(r.status_code, 200)
        # move
        r = client.post("/api/move", json={"from": "sub/a.md", "to": "sub/b.md"})
        self.assertEqual(r.status_code, 200)
        # copy
        r = client.post("/api/copy", json={"from": "sub/b.md", "to": "sub/c.md"})
        self.assertEqual(r.status_code, 200)
        # delete
        r = client.post("/api/delete", json={"path": "sub/c.md"})
        self.assertEqual(r.status_code, 200)
        # config
        r = client.post("/api/config", json={"theme": "light"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["ok"], True)

    def test_index_unauthenticated(self):
        # GET / must always work so the login UI can load.
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)

    # --- login / logout --------------------------------------------------
    def test_login_with_admin_password(self):
        r = self._login(self.ADMIN_PW)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["role"], "admin")

    def test_login_with_viewer_password(self):
        r = self._login(self.VIEWER_PW)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["role"], "viewer")

    def test_admin_takes_precedence_when_password_matches_both(self):
        # Make the admin hash equal the viewer hash so the same password
        # works for both; the server should still resolve to admin.
        import bcrypt as _bcrypt
        shared = _bcrypt.hashpw(b"shared", _bcrypt.gensalt(12)).decode()
        self._auth["admin_password_hash"] = shared
        self._auth["viewer_password_hash"] = shared
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(self._auth, f)
        r = self._login("shared")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["role"], "admin")

    def test_login_with_wrong_password(self):
        r = self._login("nope")
        self.assertEqual(r.status_code, 401)

    def test_login_rejects_empty_password(self):
        r = self._login("")
        self.assertEqual(r.status_code, 400)

    def test_logout_clears_session(self):
        client = self._login_session(self.ADMIN_PW)
        r = client.post("/api/logout")
        self.assertEqual(r.status_code, 200)
        # Subsequent gated call is 401 again.
        r = client.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 401)

    def test_logout_requires_login_when_auth_enabled(self):
        r = self.client.post("/api/logout")
        self.assertEqual(r.status_code, 401)

    # --- rate limiter ----------------------------------------------------
    def test_rate_limiter_locks_out_after_5_failures(self):
        for _ in range(nb._LOGIN_FAIL_LIMIT):
            r = self._login("wrong-pw")
            self.assertEqual(
                r.status_code, 401,
                "expected 401, got %s" % r.status_code,
            )
        # The next attempt, even with the right password, is 429.
        r = self._login(self.ADMIN_PW)
        self.assertEqual(r.status_code, 429)

    def test_rate_limiter_resets_on_success(self):
        # Trip 4 failures (under the limit), then log in successfully.
        for _ in range(nb._LOGIN_FAIL_LIMIT - 1):
            self._login("wrong-pw")
        r = self._login(self.ADMIN_PW)
        self.assertEqual(r.status_code, 200)
        # Subsequent failures are counted from scratch.
        for _ in range(nb._LOGIN_FAIL_LIMIT - 1):
            r = self._login("wrong-pw")
            self.assertEqual(r.status_code, 401)


class TestAuthNoViewer(BaseTest):
    """Admin password set, viewer password NOT set: auth layer is on,
    so both reads and writes require a session. The viewer password
    is now a secondary login option, not a read-gating switch: as
    soon as the admin password exists, the server must not hand any
    notebook data to a client that hasn't logged in. Earlier this
    class asserted that reads were open in the admin-only mode; the
    CSS blur in front of the render was cosmetic, the data was
    already on the wire. See the read_login_required docstring in
    app.py for the policy."""

    ADMIN_PW = "admin-only-pw"

    def setUp(self):
        super().setUp()
        nb._login_failures.clear()
        import bcrypt as _bcrypt
        self._auth = {
            "secret": "test-secret",
            "admin_password_hash": _bcrypt.hashpw(
                self.ADMIN_PW.encode("utf-8"), _bcrypt.gensalt(12)
            ).decode(),
        }
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(self._auth, f)

    def test_status_shape(self):
        code, data = self.jget("/api/auth")
        self.assertEqual(code, 200)
        self.assertTrue(data["enabled"])
        self.assertTrue(data["hasAdmin"])
        self.assertFalse(data["hasViewer"])
        self.assertIsNone(data["role"])

    def test_reads_require_session(self):
        # Admin set, no viewer -> reads are still 401 without a session.
        # The admin-only mode used to leave reads open (with only a
        # cosmetic blur on the rendered content), which leaked the full
        # file tree + bodies + search hits to any visitor. That's gone.
        for path in [
            "/api/tree",
            "/api/file?path=Welcome.md",
            "/api/search?q=Welcome",
            "/api/config",
            "/api/info",
        ]:
            r = self.client.get(path)
            self.assertEqual(
                r.status_code, 401,
                "expected 401 on %s, got %s" % (path, r.status_code),
            )
            body = r.get_data(as_text=True)
            # The 401 body is just an error message; it must not contain
            # any note content the server is protecting.
            self.assertNotIn("Welcome content", body,
                "%s 401 leaked file content: %r" % (path, body[:200]))
            self.assertNotIn("## One", body,
                "%s 401 leaked note content: %r" % (path, body[:200]))

    def test_admin_can_read_after_login(self):
        # Logging in (with the admin password) unlocks the reads.
        client = self._login_session(self.ADMIN_PW)
        r = client.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Welcome", r.get_json()["content"])
        r = client.get("/api/tree")
        self.assertEqual(r.status_code, 200)
        r = client.get("/api/config")
        self.assertEqual(r.status_code, 200)
        r = client.get("/api/info")
        self.assertEqual(r.status_code, 200)

    def test_writes_still_require_admin(self):
        r = self.client.post("/api/file", json={"path": "x.md", "content": "y"})
        self.assertEqual(r.status_code, 401)

        viewer_client = nb.app.test_client()   # no session at all
        r = viewer_client.post("/api/file", json={"path": "x.md", "content": "y"})
        self.assertEqual(r.status_code, 401)

        admin_client = nb.app.test_client()
        r = admin_client.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200)
        r = admin_client.post("/api/file", json={"path": "x.md", "content": "y"})
        self.assertEqual(r.status_code, 200)

    def test_login_with_nonexistent_viewer_password(self):
        # No viewer password on disk; any attempt with a non-admin password
        # is just a 401 (we don't reveal that the role is missing).
        r = self.client.post("/api/login", json={"password": "anything"})
        self.assertEqual(r.status_code, 401)

    # Used by this class. Not in BaseTest.
    def _login_session(self, password):
        client = nb.app.test_client()
        r = client.post("/api/login", json={"password": password})
        self.assertEqual(r.status_code, 200, "login failed: %s" % r.get_data(as_text=True))
        return client


class TestAuthSetPasswords(BaseTest):
    """/api/auth/passwords: admin sets or changes admin/viewer passwords.

    Starts with NO auth configured. Each test logs in as admin (after
    setting one), then exercises the passwords route. The rate limiter
    is reset between tests.
    """

    ADMIN_PW = "admin-pw-secret"
    VIEWER_PW = "viewer-pw-secret"
    NEW_ADMIN_PW = "new-admin-pw-secret"
    NEW_VIEWER_PW = "new-viewer-pw-secret"

    def setUp(self):
        super().setUp()
        nb._login_failures.clear()
        # Start with NO auth on disk; we'll set the admin password via
        # the route once a test is ready to exercise it.
        # (BaseTest.setUp already wiped CONFIG_DIR.)

    def _set_initial_admin(self):
        """Write a barebones auth.json (admin only) directly so we can
        log in. Real flows go through the route under test."""
        import bcrypt as _bcrypt
        data = {
            "secret": "test-secret",
            "admin_password_hash": _bcrypt.hashpw(
                self.ADMIN_PW.encode("utf-8"), _bcrypt.gensalt(12)
            ).decode(),
        }
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def _admin_client(self):
        client = nb.app.test_client()
        r = client.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200, "login failed: %s" % r.get_data(as_text=True))
        return client

    def _set(self, client, body):
        return client.post("/api/auth/passwords", json=body)

    # --- gating ----------------------------------------------------------
    def test_requires_admin_role(self):
        # No admin password set yet -> the route is open (no auth at all).
        # We can't easily test "auth is on, viewer tries passwords" without
        # a way to create an admin session, so we test the negative case
        # separately. When auth is fully off, the route is also un-gated.
        r = self.client.post("/api/auth/passwords",
                             json={"admin_password": "abcdef", "viewer_password": None})
        self.assertEqual(r.status_code, 200,
            "when auth is fully off, passwords route is open; got %s"
            % r.get_data(as_text=True))

    def test_viewer_cannot_change_passwords(self):
        self._set_initial_admin()
        # Add a viewer hash so we can log in as viewer.
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "r", encoding="utf-8") as f:
            auth = json.load(f)
        auth["viewer_password_hash"] = _bcrypt.hashpw(
            self.VIEWER_PW.encode("utf-8"), _bcrypt.gensalt(12)
        ).decode()
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(auth, f)
        client = nb.app.test_client()
        r = client.post("/api/login", json={"password": self.VIEWER_PW})
        self.assertEqual(r.status_code, 200)
        r = client.post("/api/auth/passwords",
                        json={"admin_password": "hacked", "viewer_password": None})
        self.assertEqual(r.status_code, 403)

    def test_unauthenticated_cannot_change_passwords(self):
        self._set_initial_admin()
        r = self.client.post("/api/auth/passwords",
                             json={"admin_password": "hacked", "viewer_password": None})
        self.assertEqual(r.status_code, 401)

    # --- happy paths -----------------------------------------------------
    def test_admin_can_set_viewer_password(self):
        self._set_initial_admin()
        client = self._admin_client()
        r = self._set(client, {"admin_password": None, "viewer_password": self.NEW_VIEWER_PW})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        body = r.get_json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["hasAdmin"])
        self.assertTrue(body["hasViewer"])
        # Log in as the new viewer to confirm it sticks.
        new_client = nb.app.test_client()
        r = new_client.post("/api/login", json={"password": self.NEW_VIEWER_PW})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["role"], "viewer")

    def test_admin_can_change_admin_password(self):
        self._set_initial_admin()
        client = self._admin_client()
        # Changing the admin password requires the current one
        # (guards against an unattended / shared-machine admin
        # session silently rotating the password).
        r = self._set(client, {"admin_password": self.NEW_ADMIN_PW,
                               "admin_current_password": self.ADMIN_PW,
                               "viewer_password": None})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        # Old password no longer works.
        old_client = nb.app.test_client()
        r = old_client.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 401)
        # New password works.
        new_client = nb.app.test_client()
        r = new_client.post("/api/login", json={"password": self.NEW_ADMIN_PW})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["role"], "admin")

    def test_change_admin_password_requires_current(self):
        # Changing the admin password requires admin_current_password and
        # verifies it against the stored hash. A missing or wrong current
        # is rejected; the stored hash is unchanged.
        self._set_initial_admin()
        client = self._admin_client()
        # Missing current -> 400.
        r = self._set(client, {"admin_password": self.NEW_ADMIN_PW,
                               "viewer_password": None})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Current admin password", r.get_json()["error"])
        # Wrong current -> 400.
        r = self._set(client, {"admin_password": self.NEW_ADMIN_PW,
                               "admin_current_password": "wrong-pw",
                               "viewer_password": None})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Current admin password", r.get_json()["error"])
        # Confirm the original admin still works (no partial change).
        c = nb.app.test_client()
        r = c.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200)
        # Correct current -> 200 and the new password takes effect.
        r = self._set(client, {"admin_password": self.NEW_ADMIN_PW,
                               "admin_current_password": self.ADMIN_PW,
                               "viewer_password": None})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        new_client = nb.app.test_client()
        r = new_client.post("/api/login", json={"password": self.NEW_ADMIN_PW})
        self.assertEqual(r.status_code, 200)

    def test_admin_can_clear_viewer_password(self):
        self._set_initial_admin()
        # Add a viewer password first.
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "r", encoding="utf-8") as f:
            auth = json.load(f)
        auth["viewer_password_hash"] = _bcrypt.hashpw(
            self.VIEWER_PW.encode("utf-8"), _bcrypt.gensalt(12)
        ).decode()
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(auth, f)
        client = self._admin_client()
        r = self._set(client, {"admin_password": None, "viewer_password": ""})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertFalse(r.get_json()["hasViewer"])
        # Reads are still gated: the admin password is what gates reads
        # now, not the viewer password. Clearing the viewer only means
        # the secondary login option is gone; admin logins still work
        # and reads without a session still 401.
        r = self.client.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 401)
        # Admin can still log in and read.
        admin_client = nb.app.test_client()
        r = admin_client.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200)
        r = admin_client.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 200)

    def test_admin_pw_only_save_keeps_viewer_unchanged(self):
        self._set_initial_admin()
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "r", encoding="utf-8") as f:
            auth = json.load(f)
        auth["viewer_password_hash"] = _bcrypt.hashpw(
            self.VIEWER_PW.encode("utf-8"), _bcrypt.gensalt(12)
        ).decode()
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(auth, f)
        client = self._admin_client()
        # Save only the admin password (viewer_password: null = don't touch).
        # Current admin password is required to change it.
        r = self._set(client, {"admin_password": self.NEW_ADMIN_PW,
                               "admin_current_password": self.ADMIN_PW,
                               "viewer_password": None})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertTrue(r.get_json()["hasViewer"])
        # Viewer still logs in with the old password.
        v = nb.app.test_client()
        r = v.post("/api/login", json={"password": self.VIEWER_PW})
        self.assertEqual(r.status_code, 200)

    # --- rejections ------------------------------------------------------
    def test_short_passwords_rejected(self):
        self._set_initial_admin()
        client = self._admin_client()
        # The length check runs after the current-password check on a
        # change, so we include admin_current_password to get past that
        # gate and reach the length validation.
        r = self._set(client, {"admin_password": "abc",
                               "admin_current_password": self.ADMIN_PW,
                               "viewer_password": None})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Admin password", r.get_json()["error"])
        r = self._set(client, {"admin_password": None, "viewer_password": "abc"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Viewer password", r.get_json()["error"])

    def test_first_save_requires_admin_password(self):
        # No auth configured yet: a no-op save ({admin: null, viewer: null})
        # is technically valid (it just doesn't enable auth). The UI's
        # job is to require the field before allowing submit. We document
        # the permissive behavior here: the server does not refuse a
        # no-op when nothing's configured.
        r = self.client.post("/api/auth/passwords",
                             json={"admin_password": None, "viewer_password": None})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertFalse(body["hasAdmin"])
        self.assertFalse(body["hasViewer"])

    def test_clear_admin_password_with_current(self):
        # Clearing the admin password (admin_password: "") is now allowed
        # when admin_current_password is provided and verified. This
        # disables the auth layer entirely.
        self._set_initial_admin()
        client = self._admin_client()
        r = self._set(client, {"admin_password": "",
                               "admin_current_password": self.ADMIN_PW,
                               "viewer_password": None})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        body = r.get_json()
        self.assertFalse(body["hasAdmin"])
        # Auth is now disabled: reads and writes work without a session.
        anon = nb.app.test_client()
        r = anon.get("/api/auth")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["enabled"])
        r = anon.get("/api/file?path=Welcome.md")
        self.assertEqual(r.status_code, 200)
        r = anon.post("/api/file", json={"path": "x.md", "content": "y"})
        self.assertEqual(r.status_code, 200)

    def test_clear_admin_password_requires_current(self):
        # Clearing without admin_current_password is rejected.
        self._set_initial_admin()
        client = self._admin_client()
        r = self._set(client, {"admin_password": "", "viewer_password": None})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Current admin password", r.get_json()["error"])
        # Admin can still log in (hash not changed).
        c = nb.app.test_client()
        r = c.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200)

    def test_clear_admin_password_wrong_current(self):
        # Clearing with a wrong current password is rejected.
        self._set_initial_admin()
        client = self._admin_client()
        r = self._set(client, {"admin_password": "",
                               "admin_current_password": "wrong-pw",
                               "viewer_password": None})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Current admin password", r.get_json()["error"])
        # Admin can still log in (hash not changed).
        c = nb.app.test_client()
        r = c.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200)

    def test_clear_admin_also_clears_viewer(self):
        # Clearing the admin password also clears the viewer password,
        # since it is meaningless once auth is off.
        self._set_initial_admin()
        # Add a viewer password first.
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "r", encoding="utf-8") as f:
            auth = json.load(f)
        auth["viewer_password_hash"] = _bcrypt.hashpw(
            self.VIEWER_PW.encode("utf-8"), _bcrypt.gensalt(12)
        ).decode()
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(auth, f)
        client = self._admin_client()
        r = self._set(client, {"admin_password": "",
                               "admin_current_password": self.ADMIN_PW,
                               "viewer_password": None})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertFalse(r.get_json()["hasAdmin"])
        self.assertFalse(r.get_json()["hasViewer"])
        # The viewer password no longer works (auth is disabled).
        v = nb.app.test_client()
        r = v.post("/api/login", json={"password": self.VIEWER_PW})
        self.assertEqual(r.status_code, 400)  # auth not enabled

    def test_clear_admin_when_no_admin_is_noop(self):
        # If no admin password is set, sending admin_password: "" is a
        # no-op (nothing to clear). The route is open when auth is off.
        r = self.client.post("/api/auth/passwords",
                             json={"admin_password": "", "viewer_password": None})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["hasAdmin"])
        self.assertFalse(r.get_json()["hasViewer"])

    def test_non_string_passwords_rejected(self):
        self._set_initial_admin()
        client = self._admin_client()
        r = self._set(client, {"admin_password": 12345, "viewer_password": None})
        self.assertEqual(r.status_code, 400)
        self.assertIn("admin_password", r.get_json()["error"])
        r = self._set(client, {"admin_password": None, "viewer_password": ["x"]})
        self.assertEqual(r.status_code, 400)
        self.assertIn("viewer_password", r.get_json()["error"])

    def test_missing_keys_rejected(self):
        self._set_initial_admin()
        client = self._admin_client()
        r = self._set(client, {"admin_password": "abc"})
        # viewer_password is missing -> expect_json rejects.
        self.assertEqual(r.status_code, 400)


class TestApiTokens(BaseTest):
    """Named API tokens: bearer credentials for agents/scripts, mapped
    onto the existing admin/viewer roles.

    Each test starts with a freshly-seeded config dir and an auth.json
    holding only the admin password (auth on). Tokens are created through
    the real POST /api/auth/tokens route so hashing + storage are exercised
    end to end. The rate limiter is reset between tests.
    """

    ADMIN_PW = "admin-pw-secret"
    VIEWER_PW = "viewer-pw-secret"

    def setUp(self):
        super().setUp()
        nb._login_failures.clear()
        import bcrypt as _bcrypt
        self._auth = {
            "secret": "test-secret",
            "admin_password_hash": _bcrypt.hashpw(
                self.ADMIN_PW.encode("utf-8"), _bcrypt.gensalt(12)
            ).decode(),
            "viewer_password_hash": _bcrypt.hashpw(
                self.VIEWER_PW.encode("utf-8"), _bcrypt.gensalt(12)
            ).decode(),
        }
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(self._auth, f)

    # --- helpers --------------------------------------------------------
    def _admin_client(self):
        client = nb.app.test_client()
        r = client.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        return client

    def _create_token(self, name="agent", role="admin"):
        """Create a token through the API as admin; return the token string."""
        client = nb.app.test_client()
        r = client.post("/api/login", json={"password": self.ADMIN_PW})
        self.assertEqual(r.status_code, 200)
        r = client.post("/api/auth/tokens", json={"name": name, "role": role})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        return r.get_json()["token"]

    def _bearer(self, token):
        return {"Authorization": "Bearer %s" % token}

    # --- creation / listing ----------------------------------------------
    def test_create_returns_token_exactly_once(self):
        client = self._admin_client()
        r = client.post("/api/auth/tokens", json={"name": "opencode", "role": "viewer"})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["name"], "opencode")
        self.assertEqual(body["role"], "viewer")
        token = body["token"]
        self.assertTrue(token.startswith("nbtk_"))
        # The issued token must never appear in any later response.
        r = client.get("/api/auth/tokens")
        listed = r.get_json()["tokens"]
        self.assertEqual([t["name"] for t in listed], ["opencode"])
        self.assertEqual(listed[0]["role"], "viewer")
        self.assertNotIn(token, r.get_data(as_text=True))
        for t in listed:
            self.assertNotIn("hash", t)
            self.assertNotIn("id", t)
            self.assertNotIn("token", t)

    def test_duplicate_name_conflict(self):
        client = self._admin_client()
        r = client.post("/api/auth/tokens", json={"name": "dup", "role": "viewer"})
        self.assertEqual(r.status_code, 200)
        r = client.post("/api/auth/tokens", json={"name": "dup", "role": "admin"})
        self.assertEqual(r.status_code, 409)

    def test_create_validation_errors(self):
        client = self._admin_client()
        for body in [
            {"name": "", "role": "admin"},                # empty name
            {"name": "has space", "role": "admin"},       # bad charset
            {"name": "/etc/bad", "role": "admin"},        # slash would break DELETE URL
            {"name": "a" * 65, "role": "admin"},          # too long
            {"name": "ok-name", "role": "root"},          # bad role
            {"role": "admin"},                            # missing name
            {"name": "ok-name"},                          # missing role
        ]:
            r = client.post("/api/auth/tokens", json=body)
            self.assertEqual(r.status_code, 400,
                "expected 400 for %r, got %s: %s" % (body, r.status_code, r.get_data(as_text=True)))

    def test_create_refused_when_auth_disabled(self):
        # No admin password -> every route is open anyway; issuing a
        # token would be meaningless so the server refuses.
        if os.path.isfile(nb.AUTH_FILE):
            os.remove(nb.AUTH_FILE)
        client = nb.app.test_client()
        r = client.post("/api/auth/tokens", json={"name": "x", "role": "admin"})
        self.assertEqual(r.status_code, 400)

    def test_create_requires_admin_role(self):
        # Anonymous -> 401 (auth is on).
        r = self.client.post("/api/auth/tokens", json={"name": "x", "role": "admin"})
        self.assertEqual(r.status_code, 401)
        # Viewer session -> 403.
        v = nb.app.test_client()
        r = v.post("/api/login", json={"password": self.VIEWER_PW})
        self.assertEqual(r.status_code, 200)
        r = v.post("/api/auth/tokens", json={"name": "x", "role": "admin"})
        self.assertEqual(r.status_code, 403)
        # Listing and revoking are admin-only too.
        r = v.get("/api/auth/tokens")
        self.assertEqual(r.status_code, 403)
        r = v.delete("/api/auth/tokens/x")
        self.assertEqual(r.status_code, 403)

    # --- bearer auth against gated routes ---------------------------------
    def test_admin_token_reads_and_writes_without_session(self):
        token = self._create_token(name="writer", role="admin")
        fresh = nb.app.test_client()   # no cookies at all
        r = fresh.get("/api/file?path=Welcome.md", headers=self._bearer(token))
        self.assertEqual(r.status_code, 200)
        self.assertIn("Welcome", r.get_json()["content"])
        r = fresh.post("/api/file", json={"path": "tok.md", "content": "via token"},
                       headers=self._bearer(token))
        self.assertEqual(r.status_code, 200)
        r = fresh.get("/api/file?path=tok.md")
        self.assertEqual(r.status_code, 401)   # no header, no session -> still gated

    def test_viewer_token_is_read_only(self):
        token = self._create_token(name="reader", role="viewer")
        fresh = nb.app.test_client()
        r = fresh.get("/api/tree", headers=self._bearer(token))
        self.assertEqual(r.status_code, 200)
        r = fresh.get("/api/search?q=Welcome", headers=self._bearer(token))
        self.assertEqual(r.status_code, 200)
        r = fresh.post("/api/file", json={"path": "x.md", "content": "y"},
                       headers=self._bearer(token))
        self.assertEqual(r.status_code, 403)
        r = fresh.delete("/api/auth/tokens/reader", headers=self._bearer(token))
        self.assertEqual(r.status_code, 403)   # viewer token can't manage tokens

    def test_invalid_token_fails_hard_no_session_fallback(self):
        # A presented-but-invalid bearer must NOT silently downgrade to a
        # valid cookie session: machine clients get a deterministic 401.
        client = self._admin_client()   # valid admin session cookie
        r = client.get("/api/tree")     # sanity: works with session alone
        self.assertEqual(r.status_code, 200)
        r = client.get("/api/tree",
                       headers=self._bearer("nbtk_" + "0" * 40))
        self.assertEqual(r.status_code, 401)
        # Garbage bearer values fail the same way.
        for value in ("garbage", "nbtk_short", ""):
            r = client.get("/api/tree", headers={"Authorization": "Bearer %s" % value})
            self.assertEqual(r.status_code, 401)

    def test_non_bearer_authorization_ignored(self):
        # Only "Bearer ..." credentials take the token path; other auth
        # schemes fall back to the session cookie as before.
        client = self._admin_client()
        r = client.get("/api/tree", headers={"Authorization": "Basic dXNlcjpwdw=="})
        self.assertEqual(r.status_code, 200)

    def test_revoked_token_stops_working(self):
        client = self._admin_client()
        r = client.post("/api/auth/tokens", json={"name": "temp", "role": "admin"})
        token = r.get_json()["token"]
        fresh = nb.app.test_client()
        r = fresh.get("/api/tree", headers=self._bearer(token))
        self.assertEqual(r.status_code, 200)
        r = client.delete("/api/auth/tokens/temp")
        self.assertEqual(r.status_code, 200)
        r = fresh.get("/api/tree", headers=self._bearer(token))
        self.assertEqual(r.status_code, 401)

    def test_delete_missing_token_404(self):
        client = self._admin_client()
        r = client.delete("/api/auth/tokens/nope")
        self.assertEqual(r.status_code, 404)

    def test_clearing_admin_password_clears_tokens(self):
        client = self._admin_client()
        r = client.post("/api/auth/tokens", json={"name": "gone", "role": "admin"})
        self.assertEqual(r.status_code, 200)
        r = client.post("/api/auth/passwords",
                        json={"admin_password": "",
                              "admin_current_password": self.ADMIN_PW,
                              "viewer_password": None})
        self.assertEqual(r.status_code, 200)
        with open(nb.AUTH_FILE, "r", encoding="utf-8") as f:
            auth = json.load(f)
        self.assertNotIn("tokens", auth)

    def test_rate_limiter_applies_to_bad_tokens(self):
        token = self._create_token(name="good", role="admin")
        fresh = nb.app.test_client()
        for _ in range(nb._LOGIN_FAIL_LIMIT):
            r = fresh.get("/api/tree", headers=self._bearer("nbtk_" + "f" * 40))
            self.assertEqual(r.status_code, 401)
        # Even the valid token is now locked out from this IP.
        r = fresh.get("/api/tree", headers=self._bearer(token))
        self.assertEqual(r.status_code, 429)


class TestAgentGuide(BaseTest):
    """/agent.md: the machine-oriented API guide for AI agents/scripts.

    The guide is plain Markdown (agent.md in the project root) served
    verbatim as text/markdown with the auth state substituted into a
    placeholder. Deliberately not gated by auth -- an agent has to be
    able to discover HOW to authenticate before it holds any credential,
    and the page carries documentation only (no notebook data, no
    secrets).
    """

    def test_serves_markdown_with_key_sections(self):
        r = self.client.get("/agent.md")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/markdown", r.headers["Content-Type"])
        body = r.get_data(as_text=True)
        for marker in (
            "Agent Guide",
            "/api/auth",
            "/api/login",
            "/api/tree",
            "/api/ls",
            "/api/file/append",
            "/api/edit",
            "/api/create",
            "upsert",
            "onConflict",
            "regex=1",
            "Authorization: Bearer nbtk_",
            "/api/auth/tokens",
            "ifModifiedSince",
            "html-live",
            "```mermaid",
            # Fixed vendored versions + html-live sandbox restrictions, so
            # external agents emit only syntax the build supports and do
            # not assume blocked capabilities.
            "Mermaid **11.16**",
            "WaveDrom **3.3**",
            "KaTeX **0.16**",
            "Graphviz **2.40.1**",
            "allow-same-origin",
            "opaque origin",
            "localStorage",
        ):
            self.assertIn(marker, body, "missing %r on /agent.md page" % marker)

    def test_old_agent_url_falls_through_to_spa(self):
        # The guide moved from /agent to /agent.md; the bare /agent path
        # is no longer an API route, so it lands on the SPA catch-all.
        r = self.client.get("/agent")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/html", r.headers["Content-Type"])
        self.assertNotIn("Agent Guide", r.get_data(as_text=True))

    def test_auth_state_placeholder_substituted(self):
        # The {{auth_state}} marker must never leak to clients; the
        # served text carries the rendered state instead.
        r = self.client.get("/agent.md")
        body = r.get_data(as_text=True)
        self.assertNotIn("{{auth_state}}", body)
        self.assertIn("disabled", body)   # no auth.json in BaseTest setUp

    def test_guide_not_cached_and_no_secrets(self):
        # The rendered auth state changes with config, so the response
        # must not be cacheable; and it must never contain hashes.
        r = self.client.get("/agent.md")
        self.assertEqual(r.headers.get("Cache-Control"), "no-store")
        self.assertNotIn("admin_password_hash", r.get_data(as_text=True))

    def test_open_when_auth_enabled(self):
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw", _bcrypt.gensalt(4)).decode(),
            }, f)
        r = self.client.get("/agent.md")
        self.assertEqual(r.status_code, 200,
            "the guide must stay reachable without credentials so an "
            "unauthenticated agent can learn how to authenticate")

    def test_notice_reflects_auth_state(self):
        # Auth off -> the notice says so; on -> it warns requests will 401.
        body_off = self.client.get("/agent.md").get_data(as_text=True)
        self.assertIn("disabled", body_off)
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw", _bcrypt.gensalt(4)).decode(),
            }, f)
        body_on = self.client.get("/agent.md").get_data(as_text=True)
        self.assertIn("enabled", body_on)


class _StubOpenAIHandler(BaseHTTPRequestHandler):
    """A tiny OpenAI-compatible stand-in for the AI proxy tests.

    Records the last request (path, Authorization header, parsed body) in
    the module-level LAST_UPSTREAM dict, then either streams a canned SSE
    chat completion or returns a configurable status. The notebook tests
    point a profile at this server's loopback port and assert on what the
    relay actually forwarded.
    """

    def do_POST(self):
        import json as _json
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        import app as _nb
        _nb.LAST_UPSTREAM = {
            "path": self.path,
            "auth": self.headers.get("Authorization"),
            "body": _json.loads(raw.decode("utf-8") or "{}"),
        }
        if _nb.UPSTREAM_STATUS != 200:
            detail = _json.dumps({"error": {"message": "stub says no"}}).encode()
            self.send_response(_nb.UPSTREAM_STATUS)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(detail)))
            self.end_headers()
            self.wfile.write(detail)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        # Two deltas + DONE, exactly the wire shape /v1/chat/completions
        # produces with stream=true. The client may close early (test
        # client drains the generator); a broken pipe then is harmless.
        try:
            for piece in (
                'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
                "data: [DONE]\n\n",
            ):
                self.wfile.write(piece.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt, *args):  # keep test output clean
        pass


class TestAiTools(BaseTest):
    """POST /api/ai/fetch and /api/ai/search: server-side web tools for
    the AI assistant. Both are admin-gated and bounded."""

    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import HTTPServer
        cls.httpd = HTTPServer(("127.0.0.1", 0), _StubWebHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(
            target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        super().setUp()
        nb.LAST_WEB = None

    def test_fetch_returns_body(self):
        r = self.post("/api/ai/fetch", {"url": "http://127.0.0.1:%d/page" % self.port})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["url"], "http://127.0.0.1:%d/page" % self.port)
        self.assertIn("text/html", body["contentType"])
        self.assertIn("hello from stub", body["content"])
        self.assertFalse(body["truncated"])

    def test_fetch_rejects_bad_urls(self):
        for bad in ("", "not a url", "file:///etc/passwd", "ftp://x"):
            r = self.post("/api/ai/fetch", {"url": bad})
            self.assertEqual(r.status_code, 400, bad)
        r = self.post("/api/ai/fetch", {})
        self.assertEqual(r.status_code, 400)

    def test_fetch_upstream_error_is_502(self):
        r = self.post("/api/ai/fetch", {"url": "http://127.0.0.1:%d/error" % self.port})
        self.assertEqual(r.status_code, 502)

    def test_search_requires_configured_instance(self):
        # No searxngUrl configured -> the tool is disabled.
        r = self.post("/api/ai/search", {"q": "hello"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("No SearXNG", r.get_json()["error"])

    def test_search_queries_instance(self):
        self.post("/api/ai/config", {"servers": [], "default": "",
                                     "searxngUrl": "http://127.0.0.1:%d" % self.port})
        r = self.post("/api/ai/search", {"q": "embedded systems"})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["query"], "embedded systems")
        self.assertEqual(len(body["results"]), 2)
        self.assertEqual(body["results"][0]["title"], "Result One")
        self.assertIn("http://", body["results"][0]["url"])
        self.assertIn("snippet", body["results"][0])
        # The instance was queried with the JSON format + quoted query.
        self.assertIn("/search?q=", nb.LAST_WEB["path"])
        self.assertIn("format=json", nb.LAST_WEB["path"])

    def test_search_rejects_bad_query(self):
        r = self.post("/api/ai/search", {"q": ""})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/ai/search", {})
        self.assertEqual(r.status_code, 400)

    def test_tools_admin_required_when_auth_on(self):
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw", _bcrypt.gensalt(4)).decode(),
            }, f)
        self.assertEqual(
            self.post("/api/ai/fetch", {"url": "http://x"}).status_code, 401)
        self.assertEqual(
            self.post("/api/ai/search", {"q": "x"}).status_code, 401)


class _StubWebHandler(BaseHTTPRequestHandler):
    """A tiny stand-in for the fetch/search targets.

    GET /page returns a small HTML body; GET /error returns 500; GET
    /search?q=...&format=json returns a SearXNG-style JSON result list.
    Records the last request path in the module-level LAST_WEB dict.
    """

    def do_GET(self):
        import app as _nb
        _nb.LAST_WEB = {"path": self.path}
        if self.path.startswith("/error"):
            self.send_response(500)
            self.end_headers()
            return
        if self.path.startswith("/search"):
            body = json.dumps({"results": [
                {"title": "Result One", "url": "http://example.com/1",
                 "content": "first snippet"},
                {"title": "Result Two", "url": "http://example.com/2",
                 "content": "second snippet"},
            ]}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        body = b"<html><body>hello from stub</body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # keep test output clean
        pass


class TestAiConfig(BaseTest):
    """GET/POST /api/ai/config: profiles live in config/ai.json, keys
    never echo back."""

    def test_get_empty_by_default(self):
        # Patch which so acpAgents is deterministic (all absent) rather than
        # reflecting whatever happens to be installed on the host.
        with mock.patch.object(nb.shutil, "which", return_value=None):
            code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        expected_agents = [{"key": e["key"], "label": e["label"],
                            "available": False} for e in nb.ACP_KNOWN_AGENTS]
        self.assertEqual(data, {"servers": [], "default": "", "customPrompt": "",
                                "searxngUrl": "", "acp": None,
                                "acpAgents": expected_agents})
        # No file is created by a read.
        self.assertFalse(os.path.isfile(nb.AI_FILE))

    def test_post_roundtrip_masks_key(self):
        r = self.post("/api/ai/config", {"servers": [{
            "name": "openai", "baseUrl": "https://api.openai.com/v1/",
            "apiKey": "sk-secret", "model": "gpt-4o-mini",
        }], "default": "openai"})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["default"], "openai")
        self.assertEqual(len(body["servers"]), 1)
        self.assertEqual(body["servers"][0]["name"], "openai")
        self.assertEqual(body["servers"][0]["baseUrl"], "https://api.openai.com")
        self.assertTrue(body["servers"][0]["hasKey"])
        # The cleartext key must never appear in any response.
        self.assertNotIn("sk-secret", r.get_data(as_text=True))
        # ...butmust be on disk.
        with open(nb.AI_FILE) as f:
            stored = json.load(f)
        self.assertEqual(stored["servers"][0]["api_key"], "sk-secret")

    def test_replace_secret_carries_stored_key(self):
        self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://x", "apiKey": "sk-1",
        }], "default": "p"})
        # Re-save with a blank key + replaceSecret: the stored key stays.
        r = self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://x", "apiKey": "",
            "replaceSecret": True, "model": "m2",
        }], "default": "p"})
        self.assertEqual(r.status_code, 200)
        with open(nb.AI_FILE) as f:
            stored = json.load(f)
        self.assertEqual(stored["servers"][0]["api_key"], "sk-1")
        self.assertEqual(stored["servers"][0]["model"], "m2")

    def test_base_url_trailing_v1_is_stripped(self):
        # The chat URL builder appends /v1/chat/completions itself, so a
        # base URL pasted with /v1 must be normalized on save.
        self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://host:1234/v1/",
        }], "default": "p"})
        with open(nb.AI_FILE) as f:
            stored = json.load(f)
        self.assertEqual(stored["servers"][0]["base_url"], "http://host:1234")
        self.assertEqual(nb._chat_url("http://host:1234"),
                         "http://host:1234/v1/chat/completions")

    def test_custom_prompt_global_roundtrip(self):
        # customPrompt is a GLOBAL setting (applies to whichever provider
        # is active): stored outside the server list, returned at the
        # config root, trimmed, and preserved when a POST omits it
        # (round-trip safety for provider-only saves).
        r = self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://x", "apiKey": "sk-1",
        }], "default": "p",
            "customPrompt": "  Always answer in Traditional Chinese.  "})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r.get_json()["customPrompt"],
            "Always answer in Traditional Chinese.")
        with open(nb.AI_FILE) as f:
            stored = json.load(f)
        self.assertEqual(stored["custom_prompt"],
                         "Always answer in Traditional Chinese.")
        # Provider-only save (no customPrompt field) PRESERVES the prompt;
        # the key carry still works.
        r = self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://y", "apiKey": "",
            "replaceSecret": True,
        }], "default": "p"})
        self.assertEqual(r.get_json()["customPrompt"],
                         "Always answer in Traditional Chinese.")
        # Explicit empty string clears it.
        r = self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://y", "apiKey": "",
            "replaceSecret": True,
        }], "default": "p", "customPrompt": ""})
        self.assertEqual(r.get_json()["customPrompt"], "")
        # Per-server customPrompt keys are ignored (no longer a profile
        # field): the server doesn't store unknown fields.
        r = self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://x", "apiKey": "",
            "replaceSecret": True, "customPrompt": "ignored",
        }], "default": "p", "customPrompt": "global wins"})
        self.assertEqual(r.get_json()["customPrompt"], "global wins")
        with open(nb.AI_FILE) as f:
            stored = json.load(f)
        self.assertNotIn("custom_prompt", stored["servers"][0])
        # Oversized prompt rejected.
        r = self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://x",
            "apiKey": "", "replaceSecret": True,
        }], "default": "p", "customPrompt": "x" * 8001})
        self.assertEqual(r.status_code, 400)

    def test_searxng_url_global_roundtrip(self):
        # searxngUrl is a GLOBAL setting (like customPrompt): stored at the
        # config root, returned to the browser, preserved when a POST omits
        # it, and cleared when sent as "".
        r = self.post("/api/ai/config", {"servers": [], "default": "",
                                         "searxngUrl": "  https://searxng.example.com/  "})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["searxngUrl"],
                         "https://searxng.example.com")
        with open(nb.AI_FILE) as f:
            stored = json.load(f)
        self.assertEqual(stored["searxng_url"], "https://searxng.example.com")
        # Provider-only save (no searxngUrl field) PRESERVES it.
        r = self.post("/api/ai/config", {"servers": [], "default": ""})
        self.assertEqual(r.get_json()["searxngUrl"],
                         "https://searxng.example.com")
        # Explicit empty string clears it.
        r = self.post("/api/ai/config", {"servers": [], "default": "",
                                         "searxngUrl": ""})
        self.assertEqual(r.get_json()["searxngUrl"], "")
        # Bad scheme rejected.
        r = self.post("/api/ai/config", {"servers": [], "default": "",
                                         "searxngUrl": "ftp://x"})
        self.assertEqual(r.status_code, 400)

    def test_rename_carries_key_via_replace_secret_for(self):
        # The Edit flow may change the profile name; the stored key must
        # follow via replaceSecretFor=<old name>.
        self.post("/api/ai/config", {"servers": [{
            "name": "old", "baseUrl": "http://x", "apiKey": "sk-keep",
        }], "default": "old"})
        r = self.post("/api/ai/config", {"servers": [{
            "name": "new", "baseUrl": "http://x", "apiKey": "",
            "replaceSecret": True, "replaceSecretFor": "old",
        }], "default": "new"})
        self.assertEqual(r.status_code, 200)
        with open(nb.AI_FILE) as f:
            stored = json.load(f)
        self.assertEqual(stored["servers"][0]["name"], "new")
        self.assertEqual(stored["servers"][0]["api_key"], "sk-keep")
        # The renamed server still works for chat (key attaches by name).
        self.assertEqual(nb._saved_server("new")["api_key"], "sk-keep")

    def test_validation_errors(self):
        cases = [
            # not an object
            "nope",
            # missing baseUrl
            {"name": "p"},
            # bad scheme
            {"name": "p", "baseUrl": "ftp://x"},
            # duplicate names
        ]
        r = self.post("/api/ai/config", {"servers": ["nope"]})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/ai/config", {"servers": [{"name": "p"}]})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/ai/config",
                      {"servers": [{"name": "p", "baseUrl": "ftp://x"}]})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/ai/config", {"servers": [
            {"name": "p", "baseUrl": "http://a"},
            {"name": "p", "baseUrl": "http://b"},
        ]})
        self.assertEqual(r.status_code, 400)
        # default must name one of the supplied servers
        r = self.post("/api/ai/config", {"servers": [
            {"name": "p", "baseUrl": "http://a"}], "default": "other"})
        self.assertEqual(r.status_code, 400)

    def test_admin_required_when_auth_on(self):
        import bcrypt as _bcrypt
        self._enable_auth("admin-pw")
        self.assertEqual(self.client.get("/api/ai/config").status_code, 401)
        self.assertEqual(
            self.post("/api/ai/config", {"servers": []}).status_code, 401)
        self.assertEqual(
            self.client.get("/api/ai/probe?server=x").status_code, 401)
        self.assertEqual(
            self.client.post("/api/ai/chat", json={"server": "x"}).status_code,
            401)

    # shared helper (mirrors TestAuth.setUp-ish pattern)
    def _enable_auth(self, pw):
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(
                    pw.encode(), _bcrypt.gensalt(4)).decode(),
            }, f)


class TestAiChat(BaseTest):
    """POST /api/ai/chat relays to the configured upstream as SSE."""

    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import HTTPServer
        cls.httpd = HTTPServer(("127.0.0.1", 0), _StubOpenAIHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(
            target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        super().setUp()
        nb.LAST_UPSTREAM = None
        nb.UPSTREAM_STATUS = 200
        r = self.post("/api/ai/config", {"servers": [{
            "name": "stub", "baseUrl": "http://127.0.0.1:%d" % self.port,
            "apiKey": "sk-upstream", "model": "test-model",
        }], "default": "stub"})
        assert r.status_code == 200, r.get_data(as_text=True)

    def _chat(self, body):
        return self.client.post("/api/ai/chat", json=body)

    def test_chat_relays_sse(self):
        r = self._chat({"server": "stub",
                        "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/event-stream", r.content_type)
        body = r.get_data(as_text=True)
        self.assertIn('{"choices":[{"delta":{"content":"hello"}}]}', body)
        self.assertIn("data: [DONE]", body)
        # What the upstream actually received: the stored key + model, the
        # caller's messages, streaming on -- and NOT the "server" selector.
        up = nb.LAST_UPSTREAM
        self.assertEqual(up["path"], "/v1/chat/completions")
        self.assertEqual(up["auth"], "Bearer sk-upstream")
        self.assertEqual(up["body"]["model"], "test-model")
        self.assertEqual(up["body"]["messages"],
                         [{"role": "user", "content": "hi"}])
        self.assertTrue(up["body"]["stream"])
        self.assertNotIn("server", up["body"])

    def test_chat_unknown_server(self):
        r = self._chat({"server": "ghost",
                        "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(r.status_code, 400)

    def test_chat_validates_messages(self):
        for bad in (
            {"server": "stub"},
            {"server": "stub", "messages": []},
            {"server": "stub", "messages": ["hi"]},
            {"server": "stub", "messages": [{"role": "tool", "content": "x"}]},
            {"server": "stub", "messages": [{"role": "user"}]},
        ):
            r = self._chat(bad)
            self.assertEqual(r.status_code, 400, bad)

    def test_chat_accepts_content_part_array(self):
        # Criterion 17 (accept): a user turn may carry a content-part array
        # of text + image_url parts; it is relayed to the upstream unchanged.
        img = "data:image/png;base64," + "A" * 16
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": [
                {"type": "text", "text": "what is this?"},
                {"type": "image_url", "image_url": {"url": img}},
            ]},
            {"role": "assistant", "content": "an image"},
        ]
        r = self._chat({"server": "stub", "messages": msgs})
        self.assertEqual(r.status_code, 200)
        up = nb.LAST_UPSTREAM
        self.assertEqual(up["body"]["messages"], msgs)
        self.assertEqual(up["body"]["model"], "test-model")
        self.assertTrue(up["body"]["stream"])
        self.assertNotIn("server", up["body"])

    def test_chat_rejects_bad_content_parts(self):
        # Criterion 17 (reject): unknown part type, wrong content shape,
        # image parts on non-user roles, bad image URLs.
        img = "data:image/png;base64,AAAA"
        for bad in (
            # unknown part type
            {"role": "user", "content": [{"type": "audio", "audio": {"url": img}}]},
            # content neither a string nor a list
            {"role": "user", "content": 123},
            {"role": "user", "content": {}},
            # empty list
            {"role": "user", "content": []},
            # part not an object
            {"role": "user", "content": ["text"]},
            # text part without a string text
            {"role": "user", "content": [{"type": "text", "text": 5}]},
            # image part on a non-user message
            {"role": "assistant",
             "content": [{"type": "image_url", "image_url": {"url": img}}]},
            {"role": "system",
             "content": [{"type": "image_url", "image_url": {"url": img}}]},
            # url not a data:image/ URL
            {"role": "user",
             "content": [{"type": "image_url",
                          "image_url": {"url": "https://x/y.png"}}]},
            {"role": "user",
             "content": [{"type": "image_url",
                          "image_url": {"url": "data:text/plain;base64,AA"}}]},
            {"role": "user",
             "content": [{"type": "image_url", "image_url": {"url": ""}}]},
            # image_url part missing its image_url object
            {"role": "user", "content": [{"type": "image_url"}]},
        ):
            r = self._chat({"server": "stub", "messages": [bad]})
            self.assertEqual(r.status_code, 400, bad)

    def test_chat_image_part_cap_is_eight(self):
        # Criterion 17 (cap): at most 8 image_url parts per user message.
        img = "data:image/png;base64,AAAA"
        part = {"type": "image_url", "image_url": {"url": img}}
        eight = [part for _ in range(8)]
        r = self._chat({"server": "stub", "messages": [
            {"role": "user", "content": eight}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            len(nb.LAST_UPSTREAM["body"]["messages"][0]["content"]), 8)
        nine = [part for _ in range(9)]
        r = self._chat({"server": "stub", "messages": [
            {"role": "user", "content": nine}]})
        self.assertEqual(r.status_code, 400)

    def test_chat_strips_per_message_extra_keys(self):
        # Criterion 17 (whitelist): only {role, content} survives, and the
        # rebuild keeps only the known part fields, so no client key leaks.
        img = "data:image/png;base64,AAAA"
        r = self._chat({"server": "stub", "messages": [
            {"role": "user",
             "name": "n", "tool_calls": [1],
             "content": [
                 {"type": "text", "text": "hi", "evil": "x"},
                 {"type": "image_url", "image_url": {"url": img, "extra": 1},
                  "junk": 2},
             ]},
        ]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(nb.LAST_UPSTREAM["body"]["messages"], [
            {"role": "user", "content": [
                {"type": "text", "text": "hi"},
                {"type": "image_url", "image_url": {"url": img}},
            ]}])
        self.assertNotIn("server", nb.LAST_UPSTREAM["body"])

    def test_chat_image_send_writes_no_file(self):
        # Criterion 20: no server storage -- config/ai.json is byte-identical
        # and neither the config nor the data dir gains a file.
        with open(nb.AI_FILE, "rb") as f:
            cfg_before = f.read()
        config_before = set(os.listdir(nb.CONFIG_DIR))
        data_before = set(os.listdir(nb.DATA_DIR))
        img = "data:image/png;base64," + "A" * 32
        r = self._chat({"server": "stub", "messages": [
            {"role": "user", "content": [
                {"type": "text", "text": "look"},
                {"type": "image_url", "image_url": {"url": img}},
            ]}]})
        self.assertEqual(r.status_code, 200)
        with open(nb.AI_FILE, "rb") as f:
            self.assertEqual(f.read(), cfg_before)
        self.assertEqual(set(os.listdir(nb.CONFIG_DIR)), config_before)
        self.assertEqual(set(os.listdir(nb.DATA_DIR)), data_before)

    def test_request_body_cap_is_32_mib_and_413_is_json(self):
        # The 32 MiB MAX_CONTENT_LENGTH bound (R8) has a JSON 413 handler.
        self.assertEqual(nb.app.config["MAX_CONTENT_LENGTH"], 32 * 1024 * 1024)
        original = nb.app.config["MAX_CONTENT_LENGTH"]
        nb.app.config["MAX_CONTENT_LENGTH"] = 1024
        try:
            r = self._chat({"server": "stub", "messages": [
                {"role": "user", "content": "x" * 4096}]})
            self.assertEqual(r.status_code, 413)
            self.assertEqual(r.get_json(), {"error": "Request body too large"})
        finally:
            nb.app.config["MAX_CONTENT_LENGTH"] = original

    def test_chat_upstream_http_error_becomes_sse_error_event(self):
        nb.UPSTREAM_STATUS = 401
        try:
            r = self._chat({"server": "stub",
                            "messages": [{"role": "user", "content": "hi"}]})
            self.assertEqual(r.status_code, 200)  # SSE always answers 200
            body = r.get_data(as_text=True)
            self.assertIn("event: error", body)
            self.assertIn('"status": 401', body)
        finally:
            nb.UPSTREAM_STATUS = 200

    def test_probe_reports_unreachable_cleanly(self):
        # Port 1 on loopback is never listening; the probe must answer
        # 200 with ok:false (JSON), never a traceback / hang.
        self.post("/api/ai/config", {"servers": [{
            "name": "dead", "baseUrl": "http://127.0.0.1:1",
        }], "default": ""})
        r = self.client.get("/api/ai/probe?server=dead")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["ok"])

    def test_probe_reachable_reports_ok(self):
        r = self.client.get("/api/ai/probe?server=stub")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["ok"])

    def test_probe_unknown_server_404(self):
        r = self.client.get("/api/ai/probe?server=ghost")
        self.assertEqual(r.status_code, 404)

    def test_ai_config_file_is_not_gated_read_but_chat_is(self):
        # /api/ai/config is admin-only even with auth off? No: with auth
        # off everything is open BY DESIGN (same as every other admin
        # route). This test pins the contract the other way: when auth
        # is ON, chat must demand the credential like every write.
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw", _bcrypt.gensalt(4)).decode(),
            }, f)
        self.assertEqual(
            self.client.post("/api/ai/chat",
                             json={"server": "stub", "messages":
                                   [{"role": "user", "content": "x"}]}
                             ).status_code, 401)

    def test_acp_name_collision_routes_to_openai_profile(self):
        # With an ai.json profile and a config/acp.json profile sharing a name,
        # the collision disables ACP, so POST /api/ai/chat must resolve the
        # OpenAI profile and relay it -- never hand the turn to the ACP runner.
        # The ACP command is deliberately unrunnable: were it reached, the
        # response would be an in-band ACP error frame instead of the stream.
        with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
            json.dump({"name": "stub", "command": "/nonexistent/acp-agent",
                       "args": [], "timeout": 5}, f)
        r = self._chat({"server": "stub",
                        "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn('{"choices":[{"delta":{"content":"hello"}}]}', body)
        self.assertIn("data: [DONE]", body)
        self.assertNotIn("event: error", body)
        self.assertEqual(nb.LAST_UPSTREAM["path"], "/v1/chat/completions")

def _pid_reaped(pid, deadline=5.0):
    """True once `pid` no longer exists (its parent has reaped it).

    The ACP runner enqueues the terminal event only after the spawn context
    manager has finished its teardown, so a completed turn normally means the
    child is already gone; poll anyway so a slow child-exit is not a flake.
    ESRCH means reaped; EPERM means still alive (owned by another user), which
    counts as not reaped.
    """
    end = time.time() + deadline
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        if time.time() >= end:
            return False
        time.sleep(0.02)


class TestAcpConfig(BaseTest):
    """config/acp.json: a hand-edited, server-local ACP profile.

    GET /api/ai/config exposes a masked view under "acp" (name + fixed type
    label + selected agent key + default flag only). Anything malformed turns
    the feature off (acp = None) without raising. The file is deliberately NOT
    POSTable: POST /api/ai/config must never create or touch it, because a
    config blob any authed client can send must not be able to choose a command
    to run.
    """

    def _write_acp(self, obj):
        with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
            json.dump(obj, f)

    def test_valid_file_exposed_masked(self):
        self._write_acp({"name": "  opencode  ", "command": "opencode",
                         "args": ["acp"], "default": True, "timeout": 30})
        code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertEqual(data["acp"], {"name": "opencode", "model": "ACP",
                                       "agent": "", "default": True})
        # Only name/model/agent/default reach the browser; the command line and
        # its cwd/env/timeout stay server-side.
        self.assertEqual(set(data["acp"]), {"name", "model", "agent", "default"})
        self.assertNotIn("command", data["acp"])
        self.assertNotIn("args", data["acp"])

    def test_default_false_when_absent(self):
        self._write_acp({"name": "opencode", "command": "opencode"})
        code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertEqual(data["acp"], {"name": "opencode", "model": "ACP",
                                       "agent": "", "default": False})

    def test_missing_file_is_none(self):
        self.assertFalse(os.path.isfile(nb.ACP_FILE))
        code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertIsNone(data["acp"])

    def test_malformed_files_degrade_to_none(self):
        # Each entry is invalid per load_acp_config(); the endpoint must
        # answer 200 with acp=None, never raise.
        for bad in (
            {},                                                    # no name/command
            {"command": "opencode"},                               # no name
            {"name": "x"},                                         # no command
            {"name": "x", "command": ""},                          # blank command
            {"name": "x", "command": "c", "args": "not-a-list"},   # args not a list
            {"name": "x", "command": "c", "args": [1, 2]},         # non-string arg
            {"name": "x", "command": "c", "args": ["ok", {"x": 1}]},
            {"name": "x", "command": "c", "timeout": -1},          # bad timeout
            {"name": "x", "command": "c", "timeout": 0},
            {"name": "x", "command": "c", "timeout": "soon"},
            {"name": "x", "command": "c", "timeout": True},        # bool rejected
            {"name": "x", "command": "c", "timeout": float("nan")},   # NaN
            {"name": "x", "command": "c", "timeout": float("inf")},   # Infinity
            {"name": "x", "command": "c", "env": {"A": 1}},         # non-str env
            {"name": "x", "command": "c", "cwd": 5},                # non-str cwd
            {"name": "x", "command": "c", "default": "yes"},       # non-bool default
            "not-an-object",
            [1, 2, 3],
        ):
            with self.subTest(bad=bad):
                if isinstance(bad, str):
                    with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
                        f.write(bad)          # valid JSON string scalar
                elif isinstance(bad, list):
                    with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
                        f.write(json.dumps(bad))
                else:
                    self._write_acp(bad)
                code, data = self.jget("/api/ai/config")
                self.assertEqual(code, 200)
                self.assertIsNone(data["acp"], "expected None for %r" % (bad,))

    def test_invalid_json_is_none(self):
        with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
            f.write("{ this is not json")
        code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertIsNone(data["acp"])

    def test_config_post_never_touches_acp_file(self):
        # A hand-edited ACP profile must survive any number of config saves
        # byte-for-byte, and no save may ever create the file.
        payload = {"name": "acpstub", "command": "python", "args": ["agent.py"],
                   "cwd": "/tmp", "env": {"A": "b"}, "default": True,
                   "timeout": 12}
        self._write_acp(payload)
        with open(nb.ACP_FILE, "rb") as f:
            before = f.read()
        r = self.post("/api/ai/config", {"servers": [{
            "name": "openai", "baseUrl": "https://api.openai.com",
            "apiKey": "sk-secret", "model": "gpt-4o-mini",
        }], "default": "openai", "customPrompt": "hi"})
        self.assertEqual(r.status_code, 200)
        with open(nb.ACP_FILE, "rb") as f:
            self.assertEqual(f.read(), before)
        # And starting with no file, a save must not create one.
        os.remove(nb.ACP_FILE)
        r = self.post("/api/ai/config", {"servers": [], "default": ""})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(os.path.isfile(nb.ACP_FILE))

    def test_name_collision_with_ai_profile_disables_acp(self):
        # A name shared with an ai.json profile would be a dead picker entry:
        # ai_chat resolves the OpenAI profile first, so the ACP branch could
        # never run. load_acp_config() fails closed instead.
        r = self.post("/api/ai/config", {"servers": [{
            "name": "shared", "baseUrl": "http://x", "apiKey": "k"}],
            "default": "shared"})
        self.assertEqual(r.status_code, 200)
        self._write_acp({"name": "shared", "command": "opencode",
                         "args": ["acp"]})
        code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertIsNone(data["acp"])
        # A non-colliding name is still exposed...
        self._write_acp({"name": "other", "command": "opencode",
                         "args": ["acp"]})
        code, data = self.jget("/api/ai/config")
        self.assertEqual(data["acp"], {"name": "other", "model": "ACP",
                                       "agent": "", "default": False})
        # ...and removing the colliding profile re-enables the entry.
        self._write_acp({"name": "shared", "command": "opencode",
                         "args": ["acp"]})
        self.post("/api/ai/config", {"servers": [], "default": ""})
        code, data = self.jget("/api/ai/config")
        self.assertEqual(data["acp"], {"name": "shared", "model": "ACP",
                                       "agent": "", "default": False})

    # --- agent-key resolution (ACP_KNOWN_AGENTS) --------------------------
    def test_known_agent_key_resolves_command(self):
        # "agent" names a table entry; the command and args are resolved from
        # the table (absolute path from which()), not carried in the file.
        fake = "/fake/bin/opencode"
        self._write_acp({"name": "x", "agent": "opencode"})
        with mock.patch.object(nb.shutil, "which",
                               side_effect=lambda name: fake if name == "opencode"
                               else None):
            cfg = nb.load_acp_config()
            code, data = self.jget("/api/ai/config")
        self.assertEqual(cfg["agent"], "opencode")
        self.assertEqual(cfg["command"], fake)
        self.assertEqual(cfg["args"], ["acp"])
        self.assertEqual(data["acp"]["agent"], "opencode")

    def test_known_agent_missing_executable_fails_closed(self):
        # A known key whose executable is not on PATH must turn ACP off, never
        # store a command that cannot launch.
        self._write_acp({"name": "x", "agent": "opencode"})
        with mock.patch.object(nb.shutil, "which", return_value=None):
            self.assertEqual(nb.load_acp_config(), {})
            code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertIsNone(data["acp"])

    def test_unknown_agent_key_fails_closed(self):
        self._write_acp({"name": "x", "agent": "definitely-not-a-known-agent"})
        with mock.patch.object(nb.shutil, "which", return_value="/somewhere"):
            self.assertEqual(nb.load_acp_config(), {})
            code, data = self.jget("/api/ai/config")
        self.assertIsNone(data["acp"])

    def test_agent_and_command_are_mutually_exclusive(self):
        # Two sources for the same argv would be an ambiguity; fail closed.
        self._write_acp({"name": "x", "agent": "opencode",
                         "command": "opencode"})
        with mock.patch.object(nb.shutil, "which", return_value="/fake/opencode"):
            self.assertEqual(nb.load_acp_config(), {})
            code, data = self.jget("/api/ai/config")
        self.assertIsNone(data["acp"])

    def test_agent_must_be_a_string(self):
        self._write_acp({"name": "x", "agent": 123})
        self.assertEqual(nb.load_acp_config(), {})

    def test_command_escape_hatch_has_empty_agent(self):
        # The command+args form is the escape hatch for an agent the table does
        # not know; it loads with agent == "".
        self._write_acp({"name": "x", "command": "/bin/echo", "args": ["hi"]})
        cfg = nb.load_acp_config()
        self.assertEqual(cfg["agent"], "")
        self.assertEqual(cfg["command"], "/bin/echo")
        self.assertEqual(cfg["args"], ["hi"])
        code, data = self.jget("/api/ai/config")
        self.assertEqual(data["acp"]["agent"], "")

    # --- detection (_detect_acp_agents) -----------------------------------
    def test_detect_agents_marks_available_and_adapter_missing(self):
        present = {"opencode": "/fake/bin/opencode", "claude": "/fake/bin/claude"}
        with mock.patch.object(nb.shutil, "which",
                               side_effect=lambda name: present.get(name)):
            agents = nb._detect_acp_agents()
            code, data = self.jget("/api/ai/config")
        by_key = {a["key"]: a for a in agents}
        self.assertEqual(len(agents), len(nb.ACP_KNOWN_AGENTS))
        for item in agents:
            self.assertEqual(set(item) - {"adapterMissing", "hint"},
                             {"key", "label", "available"})
        # (a) present adapter -> available.
        self.assertTrue(by_key["opencode"]["available"])
        self.assertNotIn("adapterMissing", by_key["opencode"])
        # (b) wrapping CLI present, adapter missing -> hint.
        self.assertFalse(by_key["claude"]["available"])
        self.assertTrue(by_key["claude"].get("adapterMissing"))
        self.assertIn("claude", by_key["claude"].get("hint", ""))
        # (c) nothing present -> unavailable, no hint.
        self.assertFalse(by_key["codex"]["available"])
        self.assertNotIn("adapterMissing", by_key["codex"])
        # The endpoint exposes the same array.
        self.assertEqual(data["acpAgents"], agents)

    def test_detect_agents_is_a_read_only_path_lookup(self):
        # detection must only resolve bare names against PATH; nothing runs.
        calls = []

        def fake_which(name):
            calls.append(name)
            return None

        with mock.patch.object(nb.shutil, "which", side_effect=fake_which):
            agents = nb._detect_acp_agents()
            bogus = nb._acp_agent_command(
                {"commands": ("definitely-not-a-real-binary-xyz",), "args": ()})
        self.assertIsNone(bogus)
        self.assertTrue(calls)
        # Every probe was a bare command name, never a path or a shell string.
        for name in calls:
            self.assertNotIn("/", name)
            self.assertNotIn(" ", name)
        self.assertTrue(all(a["available"] is False for a in agents))


class TestAcpChat(BaseTest):
    """POST /api/ai/chat driven through the ACP branch (config/acp.json).

    Every turn spawns one stub agent subprocess (tests/fixtures/
    stub_acp_agent.py -- stdlib-only, newline-delimited JSON-RPC on stdio).
    A per-test pidfile records the child's PID so each test can prove the
    backend reaped it. No real agent (`opencode` or otherwise) is ever run.
    """

    STUB = os.path.join(ROOT, "tests", "fixtures", "stub_acp_agent.py")
    SERVER = "acpstub"

    def setUp(self):
        super().setUp()
        self._pidfile = os.path.join(nb.CONFIG_DIR, "acp-stub.pid")
        self._configure_acp()

    # --- helpers --------------------------------------------------------
    def _configure_acp(self, mode="normal", timeout=15, command=None,
                       args=None, name=None):
        if args is None:
            args = [self.STUB, "--mode", mode, "--pidfile", self._pidfile]
        cfg = {"name": name or self.SERVER,
               "command": sys.executable if command is None else command,
               "args": args,
               "cwd": nb.DATA_DIR,
               "timeout": timeout}
        with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f)

    def _configure_acp_agent(self, key, timeout=15, name=None):
        """Write config/acp.json in the key-based form (no command/args)."""
        cfg = {"name": name or self.SERVER, "agent": key,
               "cwd": nb.DATA_DIR, "timeout": timeout}
        with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f)

    def _chat(self, body):
        return self.client.post("/api/ai/chat", json=body)

    def _write_config(self, obj):
        """Overwrite config/config.json (the frontend state blob)."""
        with open(nb.CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(obj, f)

    def _write_ai_custom_prompt(self, text):
        """Write config/ai.json carrying the global custom prompt."""
        with open(nb.AI_FILE, "w", encoding="utf-8") as f:
            json.dump({"servers": [], "default": "", "custom_prompt": text}, f)

    def _user_turn(self, text="hello"):
        return {"server": self.SERVER,
                "messages": [{"role": "user", "content": text}]}

    def _assert_reaped(self, deadline=5.0):
        """The stub writes its PID before doing anything; assert it is gone.

        `deadline` is how long to wait for reaping. The fixed agent path
        completes its kill ladder *before* reporting the turn done, so the
        default is generous but an eof test can pass a tight value to prove
        the child was already gone when the terminal event arrived.
        """
        if not os.path.exists(self._pidfile):
            self.fail("stub pidfile was never written")
        with open(self._pidfile, "r", encoding="utf-8") as f:
            pid = int(f.read().strip())
        self.assertTrue(_pid_reaped(pid, deadline),
                        "stub child %d was not reaped" % pid)

    # --- key-based launch -------------------------------------------------
    def test_agent_key_launches_agent_end_to_end(self):
        # Key-based config: "agent": "opencode" with no command. which() is
        # faked to resolve the key to a wrapper that logs its argv and runs the
        # stub, proving the table path really resolves and launches an agent
        # (and that the table's args are the ones passed).
        import shlex
        argv_log = os.path.join(nb.CONFIG_DIR, "wrapper-argv.txt")
        wrapper = os.path.join(nb.CONFIG_DIR, "fake-opencode")
        wrapper_src = (
            "#!/bin/sh\n"
            "printf '%s\\n' \"$@\" > " + shlex.quote(argv_log) + "\n"
            "exec " + shlex.quote(sys.executable) + " "
            + shlex.quote(self.STUB) + " --mode normal --pidfile "
            + shlex.quote(self._pidfile) + "\n"
        )
        with open(wrapper, "w", encoding="utf-8") as f:
            f.write(wrapper_src)
        os.chmod(wrapper, 0o755)

        self._configure_acp_agent("opencode")
        with mock.patch.object(nb.shutil, "which",
                               side_effect=lambda name: wrapper if name == "opencode"
                               else None):
            r = self._chat(self._user_turn())
            body = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        self.assertIn('{"choices":[{"delta":{"content":"Hello"}}]}', body)
        self.assertIn('{"choices":[{"delta":{"content":" world"}}]}', body)
        self.assertIn("data: [DONE]", body)
        self.assertNotIn("event: error", body)
        # The wrapper saw exactly the table's args for the opencode entry.
        with open(argv_log, encoding="utf-8") as f:
            self.assertEqual(f.read().split(), ["acp"])
        self._assert_reaped()

    # --- happy path ------------------------------------------------------
    def test_chat_streams_two_deltas_then_done(self):
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/event-stream", r.content_type)
        body = r.get_data(as_text=True)
        self.assertIn('{"choices":[{"delta":{"content":"Hello"}}]}', body)
        self.assertIn('{"choices":[{"delta":{"content":" world"}}]}', body)
        self.assertIn("data: [DONE]", body)
        # No in-band error frame on the success path.
        self.assertNotIn("event: error", body)
        self._assert_reaped()

    def test_tool_call_update_streams_a_trace_frame(self):
        # A tool_call update becomes a namespaced trace frame the panel renders
        # as a trace line; the text deltas and [DONE] must be unaffected.
        self._configure_acp(mode="trace")
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn('{"acp":"trace","text":"Running a shell command"}', body)
        self.assertIn('{"choices":[{"delta":{"content":"Hello"}}]}', body)
        self.assertIn('{"choices":[{"delta":{"content":" world"}}]}', body)
        self.assertIn("data: [DONE]", body)
        self.assertNotIn("event: error", body)
        self._assert_reaped()

    def test_system_message_dropped_from_flattened_prompt(self):
        # The ACP agent brings its own system prompt, so the client drops
        # system turns before flattening. The echo stub returns the exact
        # prompt it received, so the system text must be absent from the
        # stream while the user/assistant turns survive, labelled.
        self._configure_acp(mode="echo")
        r = self._chat({"server": self.SERVER, "messages": [
            {"role": "system", "content": "SYS-SECRET-INSTRUCTION"},
            {"role": "user", "content": "user-visible-turn"},
            {"role": "assistant", "content": "prior-reply"},
        ]})
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("User: user-visible-turn", body)
        self.assertIn("Assistant: prior-reply", body)
        self.assertNotIn("SYS-SECRET-INSTRUCTION", body)
        self.assertNotIn("System:", body)
        self._assert_reaped()

    # --- context preamble -------------------------------------------------
    def test_preamble_reaches_agent_with_open_file_and_custom_prompt(self):
        # The dropped system turn's context is rebuilt into the ACP prompt: the
        # fixed lead, the open note from config/config.json, and the global
        # custom prompt from config/ai.json. The echo stub returns the exact
        # prompt it received.
        self._configure_acp(mode="echo")
        self._write_config({"activeFile": "notes/open.md"})
        self._write_ai_custom_prompt("CUSTOM-INSTRUCTION-XYZ")
        r = self._chat(self._user_turn("hello there"))
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn(nb.ACP_CONTEXT_PREAMBLE, body)
        self.assertIn("The note currently open: notes/open.md", body)
        self.assertIn("CUSTOM-INSTRUCTION-XYZ", body)
        self.assertIn("User: hello there", body)
        self._assert_reaped()

    def test_preamble_degrades_to_fixed_lead_when_context_absent(self):
        # No activeFile and no custom prompt -> only the fixed lead.
        self._configure_acp(mode="echo")
        self._write_config({})
        self._write_ai_custom_prompt("")
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn(nb.ACP_CONTEXT_PREAMBLE, body)
        self.assertNotIn("The note currently open:", body)
        self.assertEqual(body.count(nb.ACP_CONTEXT_PREAMBLE), 1)
        self._assert_reaped()

    def test_preamble_prepended_once_even_with_prior_turns(self):
        # The preamble is prepended once per turn, not per message: a
        # multi-turn transcript still carries exactly one copy of the lead.
        self._configure_acp(mode="echo")
        self._write_config({"activeFile": "notes/open.md"})
        self._write_ai_custom_prompt("")
        r = self._chat({"server": self.SERVER, "messages": [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
            {"role": "user", "content": "second question"},
        ]})
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertEqual(body.count(nb.ACP_CONTEXT_PREAMBLE), 1)
        self.assertIn("User: first question", body)
        self.assertIn("Assistant: first answer", body)
        self.assertIn("User: second question", body)
        self._assert_reaped()

    # --- validation / routing -------------------------------------------
    def test_image_attachment_rejected_400(self):
        img = "data:image/png;base64,AAAA"
        r = self._chat({"server": self.SERVER, "messages": [
            {"role": "user", "content": [
                {"type": "text", "text": "look"},
                {"type": "image_url", "image_url": {"url": img}},
            ]}]})
        self.assertEqual(r.status_code, 400)
        self.assertIn("ACP profiles do not support image attachments",
                      r.get_json()["error"])
        # Rejected before any agent process is spawned.
        self.assertFalse(os.path.exists(self._pidfile))

    def test_system_only_messages_rejected_400(self):
        # A transcript of only system turns flattens to an empty prompt; the
        # branch rejects it before spawning anything.
        r = self._chat({"server": self.SERVER, "messages": [
            {"role": "system", "content": "instructions only"}]})
        self.assertEqual(r.status_code, 400)
        self.assertIn("require at least one user or assistant message",
                      r.get_json()["error"])
        self.assertFalse(os.path.exists(self._pidfile))

    def test_unknown_server_does_not_fall_through_to_acp(self):
        # A name that matches neither an OpenAI profile nor the ACP profile
        # is a plain 400; it must not be handed to the ACP runner.
        r = self._chat({"server": "ghost",
                        "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["error"], "Unknown or missing server")
        self.assertFalse(os.path.exists(self._pidfile))
        # Sanity: the configured ACP name DOES route to ACP (so "ghost" is
        # genuinely unmatched, not a broken config).
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        self.assertIn("data: [DONE]", r.get_data(as_text=True))
        self._assert_reaped()

    # --- failure paths (must be in-band SSE, never a 500) ----------------
    def test_bad_command_is_inband_error_not_500(self):
        # The backend deliberately returns a generic message and logs the
        # specifics server-side (a security fix), so the configured command
        # line must not appear in the response.
        bad = "/nonexistent/no-such-acp-binary"
        self._configure_acp(command=bad, args=[])
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)          # SSE always answers 200
        body = r.get_data(as_text=True)
        self.assertIn("event: error", body)
        self.assertIn('"error": true', body)
        self.assertIn("ACP agent failed to start", body)
        self.assertNotIn(bad, body)
        self.assertNotIn("command not found", body)

    def test_protocol_version_mismatch_names_both_versions(self):
        self._configure_acp(mode="mismatch")
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("event: error", body)
        self.assertIn("protocol version mismatch", body)
        self.assertIn("offered 2", body)
        self.assertIn("requires 1", body)
        self._assert_reaped()

    def test_eof_ignoring_agent_is_reaped_before_done(self):
        # Regression for the orphaned-child bug: the agent answers the prompt
        # normally but then ignores stdin EOF and SIGTERM, so only the SDK's
        # escalate-to-kill ladder ends it. The backend must run that ladder to
        # completion *before* it reports the turn done, or a `run_turn` whose
        # finally cancels the task orphans the child.
        #
        # Discriminating check: the child must already be gone when the
        # terminal event is delivered. Under the pre-fix ordering the terminal
        # was enqueued inside the spawn context, the caller returned at once,
        # and the still-running child (4s of teardown ahead of it) would fail a
        # 1.0s reaping deadline.
        self._configure_acp(mode="eof")
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn('{"choices":[{"delta":{"content":"Hello"}}]}', body)
        self.assertIn("data: [DONE]", body)
        self._assert_reaped(deadline=1.0)

    def test_permission_request_is_auto_allowed(self):
        # The agent asks for permission (offering one allow_once option); the
        # client's trusted single-user auto-allow must pick it so the turn
        # completes. The stub echoes the decision it received.
        self._configure_acp(mode="perm")
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("perm outcome=selected option=allow-1", body)
        self.assertIn("data: [DONE]", body)
        self.assertNotIn("event: error", body)
        self._assert_reaped()

    def test_client_bound_fs_terminal_and_elicitation_are_refused(self):
        # The client advertises no fs/terminal capability and does not enable
        # the unstable elicitation route, so an agent request for any of them
        # must come back as a JSON-RPC method-not-found error and must not hang
        # the turn. The stub reports all three codes. The SDK warns that
        # elicitation/create is unstable before refusing it; silence that one
        # expected warning so the passing test stays quiet.
        self._configure_acp(mode="cap")
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            r = self._chat(self._user_turn())
            body = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        self.assertIn("cap fs=error/-32601 term=error/-32601 elic=error/-32601",
                      body)
        self.assertIn("data: [DONE]", body)
        self._assert_reaped()

    def test_crash_before_initialize_is_inband_error(self):
        self._configure_acp(mode="crash")
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("event: error", body)
        self.assertIn('"error": true', body)
        self._assert_reaped()

    def test_junk_line_before_valid_response_is_skipped(self):
        # A malformed line must be ignored by the NDJSON reader, not abort
        # the turn; the valid response that follows still completes it.
        # The SDK logs the skipped line via logging.exception; silence it so
        # the passing test doesn't print a traceback.
        self._configure_acp(mode="junk")
        import logging
        previous = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        try:
            r = self._chat(self._user_turn())
            body = r.get_data(as_text=True)
        finally:
            logging.disable(previous)
        self.assertEqual(r.status_code, 200)
        self.assertIn('{"choices":[{"delta":{"content":"Hello"}}]}', body)
        self.assertIn("data: [DONE]", body)
        self._assert_reaped()

    def test_hung_agent_times_out_and_is_reaped(self):
        # The `hang` stub never answers session/prompt; the turn must fail
        # in-band after the small timeout and the child must be reaped.
        self._configure_acp(mode="hang", timeout=2)
        start = time.time()
        r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("event: error", body)
        self.assertIn("timed out", body)
        self.assertLess(time.time() - start, 30)
        self._assert_reaped()

    def test_missing_sdk_degrades_to_inband_error(self):
        # A missing agent-client-protocol package must disable only ACP: the
        # route answers 200 with one in-band error frame, never a 500.
        from unittest import mock
        with mock.patch.dict(sys.modules, {"acp_client": None}):
            r = self._chat(self._user_turn())
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("event: error", body)
        self.assertIn("agent-client-protocol", body)
        self.assertFalse(os.path.exists(self._pidfile))

    # --- authorization ---------------------------------------------------
    def test_viewer_token_is_rejected(self):
        import bcrypt as _bcrypt
        nb._login_failures.clear()
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw", _bcrypt.gensalt(4)).decode(),
                "viewer_password_hash": _bcrypt.hashpw(
                    b"viewer-pw", _bcrypt.gensalt(4)).decode(),
            }, f)
        body = self._user_turn()
        # No credential -> 401 (route is @admin_required).
        self.assertEqual(self.client.post("/api/ai/chat", json=body).status_code,
                         401)
        # Mint a viewer token as admin.
        admin = nb.app.test_client()
        self.assertEqual(
            admin.post("/api/login", json={"password": "admin-pw"}).status_code,
            200)
        tok = admin.post("/api/auth/tokens",
                         json={"name": "viewer-tok", "role": "viewer"})
        self.assertEqual(tok.status_code, 200, tok.get_data(as_text=True))
        token = tok.get_json()["token"]
        fresh = nb.app.test_client()
        r = fresh.post("/api/ai/chat", json=body,
                       headers={"Authorization": "Bearer %s" % token})
        self.assertEqual(r.status_code, 403)
        # No agent was spawned for the rejected viewer request.
        self.assertFalse(os.path.exists(self._pidfile))


class TestAcpClient(unittest.TestCase):
    """Direct unit tests for acp_client.run_turn (no Flask app involved).

    These cover paths the SSE-level tests only reach indirectly and cheaply:
    the exactly-one-terminal-event invariant, the generic dead-agent error,
    the timeout error, and the version-mismatch message. `acp_client` is
    imported lazily so collection still works if the SDK is absent.
    """

    STUB = os.path.join(ROOT, "tests", "fixtures", "stub_acp_agent.py")

    def _run(self, mode, timeout=15, command=None, args=None, prompt="User: hi"):
        import acp_client
        if args is None:
            args = [self.STUB, "--mode", mode]
        return list(acp_client.run_turn(
            sys.executable if command is None else command,
            args=args, cwd=tempfile.gettempdir(), prompt=prompt,
            timeout=timeout))

    @staticmethod
    def _terminals(events):
        return [e for e in events if e.get("type") in ("done", "error")]

    def test_normal_turn_has_exactly_one_terminal_event(self):
        events = self._run("normal")
        terminals = self._terminals(events)
        self.assertEqual(len(terminals), 1)
        self.assertIs(terminals[0], events[-1])
        self.assertEqual(terminals[0]["type"], "done")
        self.assertEqual(terminals[0]["stopReason"], "end_turn")

    def test_mismatch_turn_has_exactly_one_terminal_event(self):
        terminals = self._terminals(self._run("mismatch"))
        self.assertEqual(len(terminals), 1)
        self.assertEqual(terminals[0]["type"], "error")

    def test_dead_agent_yields_single_generic_error(self):
        bad = "/nonexistent/no-such-acp-binary"
        events = self._run("normal", command=bad, args=[])
        terminals = self._terminals(events)
        self.assertEqual(len(terminals), 1)
        self.assertEqual(terminals[0]["type"], "error")
        self.assertEqual(terminals[0]["message"], "ACP agent failed to start")
        # The configured command line must not leak into the event.
        self.assertNotIn(bad, terminals[0]["message"])

    def test_timeout_yields_single_error(self):
        terminals = self._terminals(self._run("hang", timeout=2))
        self.assertEqual(len(terminals), 1)
        self.assertEqual(terminals[0]["type"], "error")
        self.assertIn("timed out", terminals[0]["message"])

    def test_version_mismatch_names_both_versions(self):
        message = self._terminals(self._run("mismatch"))[0]["message"]
        self.assertIn("offered 2", message)
        self.assertIn("requires 1", message)

    def test_create_elicitation_override_refuses_method(self):
        # The _Client override must fail loudly with method_not_found rather
        # than let the SDK encode the base's None as an empty success. The
        # stub-level cap test only proves the wire refusal (the SDK's unstable
        # route gate also returns -32601 before the handler runs), so exercise
        # the override directly to cover the changed line.
        import asyncio
        import queue as queue_mod
        import acp
        import acp_client
        client = acp_client._Client(queue_mod.Queue())
        with self.assertRaises(acp.RequestError) as ctx:
            asyncio.run(client.create_elicitation(message="need input",
                                                  mode="form"))
        self.assertEqual(ctx.exception.code, -32601)

    def test_tool_call_update_yields_trace_event(self):
        # `_Client.session_update` translates a started tool call into a
        # {"type": "trace"} event; the turn still ends normally.
        events = self._run("trace")
        traces = [e for e in events if e.get("type") == "trace"]
        self.assertEqual([e["text"] for e in traces],
                         ["Running a shell command"])
        self.assertEqual(self._terminals(events)[0]["type"], "done")


class TestSeedMigration(unittest.TestCase):
    """seed(): legacy data/ migration and template/bootstrap branches.

    These run against a throw-away BASE_DIR so the real project folders are
    never touched. The module constants are patched only for the duration of
    the call and restored by mock.patch.
    """

    def _layout(self):
        base = tempfile.mkdtemp(prefix="nbseed_")
        data = os.path.join(base, "notebook")
        template = os.path.join(base, "template")
        config = os.path.join(base, "config")
        return base, data, template, config

    def test_seed_migrates_legacy_data_and_drops_empty_source(self):
        base, data, template, config = self._layout()
        try:
            os.makedirs(os.path.join(base, "data"))
            with open(os.path.join(base, "data", "old.md"), "w") as f:
                f.write("old")
            os.makedirs(template)
            with mock.patch.object(nb, "BASE_DIR", base), \
                    mock.patch.object(nb, "DATA_DIR", data), \
                    mock.patch.object(nb, "TEMPLATE_DIR", template), \
                    mock.patch.object(nb, "CONFIG_DIR", config), \
                    mock.patch.object(nb, "CONFIG_FILE",
                                      os.path.join(config, "config.json")):
                notes = nb.seed()
            self.assertIn("Migrated data/ -> notebook/ (one-time)", notes)
            self.assertTrue(os.path.isfile(os.path.join(data, "old.md")))
            self.assertFalse(os.path.isdir(os.path.join(base, "data")))
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_seed_leaves_non_empty_legacy_dir_alone(self):
        # A move that leaves something behind must not rmdir the source.
        base, data, template, config = self._layout()
        try:
            os.makedirs(os.path.join(base, "data"))
            with open(os.path.join(base, "data", "old.md"), "w") as f:
                f.write("old")
            os.makedirs(template)
            real_copytree = shutil.copytree

            def fake_move(src, dst):
                real_copytree(src, dst)
                with open(os.path.join(src, "leftover"), "w") as f:
                    f.write("stay")

            with mock.patch.object(nb, "BASE_DIR", base), \
                    mock.patch.object(nb, "DATA_DIR", data), \
                    mock.patch.object(nb, "TEMPLATE_DIR", template), \
                    mock.patch.object(nb, "CONFIG_DIR", config), \
                    mock.patch.object(nb, "CONFIG_FILE",
                                      os.path.join(config, "config.json")), \
                    mock.patch.object(nb.shutil, "move", side_effect=fake_move):
                notes = nb.seed()
            self.assertIn("Migrated data/ -> notebook/ (one-time)", notes)
            self.assertTrue(os.path.isdir(os.path.join(base, "data")))
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_seed_swallows_rmdir_failure(self):
        base, data, template, config = self._layout()
        try:
            os.makedirs(os.path.join(base, "data"))
            with open(os.path.join(base, "data", "old.md"), "w") as f:
                f.write("old")
            os.makedirs(template)
            real_copytree = shutil.copytree

            def fake_move(src, dst):
                # Copy and leave an EMPTY source so the rmdir path runs.
                real_copytree(src, dst)
                os.remove(os.path.join(src, "old.md"))

            with mock.patch.object(nb, "BASE_DIR", base), \
                    mock.patch.object(nb, "DATA_DIR", data), \
                    mock.patch.object(nb, "TEMPLATE_DIR", template), \
                    mock.patch.object(nb, "CONFIG_DIR", config), \
                    mock.patch.object(nb, "CONFIG_FILE",
                                      os.path.join(config, "config.json")), \
                    mock.patch.object(nb.shutil, "move", side_effect=fake_move), \
                    mock.patch.object(nb.os, "rmdir", side_effect=OSError("busy")):
                notes = nb.seed()
            self.assertIn("Migrated data/ -> notebook/ (one-time)", notes)
            self.assertTrue(os.path.isdir(os.path.join(base, "data")))
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_seed_creates_empty_data_dir_without_template(self):
        base, data, template, config = self._layout()
        try:
            with mock.patch.object(nb, "BASE_DIR", base), \
                    mock.patch.object(nb, "DATA_DIR", data), \
                    mock.patch.object(nb, "TEMPLATE_DIR", template), \
                    mock.patch.object(nb, "CONFIG_DIR", config), \
                    mock.patch.object(nb, "CONFIG_FILE",
                                      os.path.join(config, "config.json")):
                notes = nb.seed()
            self.assertEqual(notes, [])
            self.assertTrue(os.path.isdir(data))
            self.assertEqual(os.listdir(data), [])
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_seed_is_idempotent_when_config_exists(self):
        # BaseTest's temp dirs are already seeded, so a second run is a no-op.
        self.assertEqual(nb.seed(), [])


class TestBackendHelperBranches(BaseTest):
    """Direct unit coverage for helpers whose error/edge branches the
    request-level suite does not happen to exercise."""

    def test_safe_path_blank_after_strip(self):
        self.assertIsNone(nb.safe_path("   "))
        self.assertIsNone(nb.safe_path(""))
        self.assertIsNone(nb.safe_path(None))
        self.assertIsNone(nb.safe_path(123))

    def test_expect_json_rejects_non_object_body(self):
        # get_json(silent=True) returns a list here; expect_json must reject it
        # with the generic JSON-object error, not a key error.
        r = self.client.post("/api/file", json=[1, 2, 3])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json(),
                         {"error": "Expected a JSON object body"})

    def test_build_tree_missing_dir_is_empty(self):
        self.assertEqual(nb.build_tree(os.path.join(nb.DATA_DIR, "nope")), [])

    def test_build_tree_skips_hidden_pycache_non_md_and_nests(self):
        os.makedirs(os.path.join(nb.DATA_DIR, "sub"))
        os.makedirs(os.path.join(nb.DATA_DIR, "__pycache__"))
        for rel in ("sub/b.md", "sub/a.md", "__pycache__/x.md",
                    ".hidden.md", "pic.png", "z.md"):
            with open(os.path.join(nb.DATA_DIR, rel), "w") as f:
                f.write("x")
        tree = nb.build_tree(nb.DATA_DIR)
        names = [e["name"] for e in tree]
        self.assertEqual(names[0], "sub")        # dirs sort first
        for excluded in (".hidden.md", "pic.png", "__pycache__"):
            self.assertNotIn(excluded, names)
        self.assertIn("z.md", names)
        sub = next(e for e in tree if e["name"] == "sub")
        self.assertEqual([e["name"] for e in sub["children"]],
                         ["a.md", "b.md"])

    def test_boot_state_clamps_nan_and_inf_widths(self):
        for bad in (float("nan"), float("inf"), float("-inf"), "wide"):
            with self.subTest(bad=bad):
                state = nb.boot_state({"sidebarWidth": bad,
                                       "outlineWidth": bad})
                self.assertEqual(state["side_panel_width"],
                                 nb._DEFAULT_SIDEBAR_WIDTH)
                self.assertEqual(state["outline_width"],
                                 nb._DEFAULT_OUTLINE_WIDTH)

    def test_boot_state_rejects_non_string_or_blank_title(self):
        self.assertEqual(nb.boot_state({"siteTitle": 42})["site_title"],
                         "Notebook")
        self.assertEqual(nb.boot_state({"siteTitle": "   "})["site_title"],
                         "Notebook")

    def test_read_public_config_corrupt_json_is_empty(self):
        with open(nb.CONFIG_FILE, "w", encoding="utf-8") as f:
            f.write("{ not json")
        self.assertEqual(nb._read_public_config(), {})
        # GET /api/config and the SPA shell both degrade to defaults.
        code, data = self.jget("/api/config")
        self.assertEqual((code, data), (200, {}))
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_chat_url_strips_trailing_v1(self):
        self.assertEqual(nb._chat_url("http://host/v1"),
                         "http://host/v1/chat/completions")
        self.assertEqual(nb._chat_url("http://host/v1/"),
                         "http://host/v1/chat/completions")
        self.assertEqual(nb._chat_url(""), "")

    def test_sse_bytes_joins_chunks(self):
        self.assertEqual(nb._sse_bytes([b"a", b"bc"]), b"abc")

    def test_flatten_acp_prompt_handles_parts_and_unknown_content(self):
        self.assertEqual(
            nb._flatten_acp_prompt([
                {"role": "user",
                 "content": [{"type": "text", "text": "a"},
                             {"type": "image_url", "image_url": {"url": "x"}}]},
                {"role": "assistant", "content": None},
            ]),
            "User: a\n\nAssistant: ")

    def test_public_token_omits_missing_created(self):
        self.assertEqual(nb._public_token({"name": "t", "role": "viewer"}),
                         {"name": "t", "role": "viewer"})

    def test_load_auth_corrupt_json_is_empty(self):
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            f.write("{ nope")
        self.assertEqual(nb.load_auth(), {})

    def test_has_viewer_password(self):
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({"viewer_password_hash": "hash"}, f)
        self.assertTrue(nb.has_viewer_password())
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({"admin_password_hash": "hash"}, f)
        self.assertFalse(nb.has_viewer_password())

    def test_check_password_rejects_bad_stored_hashes(self):
        self.assertFalse(nb._check_password("pw", None))
        self.assertFalse(nb._check_password("pw", ""))
        self.assertFalse(nb._check_password("pw", 123))
        self.assertFalse(nb._check_password("pw", "not-a-bcrypt-hash"))

    def test_ensure_auth_secret_keeps_existing(self):
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({"secret": "already-here"}, f)
        self.assertEqual(nb.ensure_auth_secret()["secret"], "already-here")

    def test_find_token_rejects_non_hex_and_wrong_secret(self):
        self.assertIsNone(nb._find_token("nbtk_" + "g" * 40))
        import bcrypt as _bcrypt
        good = "nbtk_" + "a" * 10 + "b" * 30
        bad = "nbtk_" + "a" * 10 + "c" * 30
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({"tokens": [{
                "name": "t", "role": "admin", "id": "a" * 10,
                "hash": _bcrypt.hashpw(good.encode(), _bcrypt.gensalt(4)).decode(),
            }]}, f)
        self.assertIsNone(nb._find_token(bad))

    def test_logout_with_auth_off_bypasses_login_required(self):
        r = self.client.post("/api/logout")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(), {"ok": True})


class TestEditValidationBranches(BaseTest):
    """Every _EditError validation branch in the patch engine, plus the one
    text-normalisation branch the happy-path edit tests miss."""

    CONTENT = "alpha\nbeta\n"

    def setUp(self):
        super().setUp()
        self.post("/api/file", {"path": "patch.md", "content": self.CONTENT})

    def _content(self):
        return self.jget("/api/file?path=patch.md")[1]["content"]

    def test_bad_edit_payloads_leave_file_untouched(self):
        bad_edits = [
            {"op": "append"},                                    # missing text
            {"op": "append", "text": 1},                         # non-string text
            {"op": "line_delete"},                               # missing start
            {"op": "line_delete", "start": True},                # bool not int
            {"op": "line_delete", "start": 0},                   # lo bound
            {"op": "find_replace", "find": "a", "replace_with": "b",
             "count": -1},                                       # bad count
            {"op": "find_replace", "find": "(", "replace_with": "b",
             "regex": True},                                     # bad regex
            {"op": "find_replace", "find": "", "replace_with": "b"},  # empty find
        ]
        for edit in bad_edits:
            with self.subTest(edit=edit):
                r = self.post("/api/edit",
                              {"path": "patch.md", "edits": [edit]})
                self.assertEqual(r.status_code, 400, r.get_data(as_text=True))
                self.assertEqual(self._content(), self.CONTENT)

    def test_text_to_lines_drops_trailing_empty_part(self):
        # insert text ending in a newline: split() leaves a trailing "".
        r = self.post("/api/edit", {"path": "patch.md", "edits": [
            {"op": "line_insert", "after_line": 0, "text": "top\n"}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self._content(), "top\nalpha\nbeta\n")


class TestConfigAndPasswordErrors(BaseTest):
    """Config write failure and password endpoint validation branches."""

    def test_set_config_write_failure_is_500(self):
        # Make CONFIG_FILE a directory so os.replace(tmp, CONFIG_FILE) fails
        # with a real OSError (no monkeypatching of the write path).
        os.remove(nb.CONFIG_FILE)
        os.mkdir(nb.CONFIG_FILE)
        r = self.post("/api/config", {"theme": "dark"})
        self.assertEqual(r.status_code, 500)
        self.assertIn("Could not write config", r.get_json()["error"])

    def test_set_passwords_missing_field(self):
        r = self.post("/api/auth/passwords", {"admin_password": None})
        self.assertEqual(r.status_code, 400)

    def test_set_passwords_rejects_non_string_current(self):
        r = self.post("/api/auth/passwords", {
            "admin_password": None, "viewer_password": None,
            "admin_current_password": 123})
        self.assertEqual(r.status_code, 400)
        self.assertIn("admin_current_password", r.get_json()["error"])


class TestAuthLoginValidation(BaseTest):
    """Login body validation that sits behind the auth-enabled check."""

    def setUp(self):
        super().setUp()
        nb._login_failures.clear()
        import bcrypt as _bcrypt
        with open(nb.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "secret": "test-secret",
                "admin_password_hash": _bcrypt.hashpw(
                    b"admin-pw", _bcrypt.gensalt(4)).decode(),
            }, f)

    def test_login_missing_password_field(self):
        r = self.client.post("/api/login", json={})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Missing required field: password",
                      r.get_json()["error"])


class TestAcpConfigBranches(BaseTest):
    """load_acp_config() defaults for args/cwd/env that the malformed-file
    table does not cover."""

    def _write(self, obj):
        with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
            json.dump(obj, f)

    def test_args_none_and_cwd_none_default(self):
        self._write({"name": "x", "command": "/bin/true",
                     "args": None, "cwd": None})
        cfg = nb.load_acp_config()
        self.assertEqual(cfg["args"], [])
        self.assertEqual(cfg["cwd"], "")

    def test_env_must_be_an_object(self):
        self._write({"name": "x", "command": "/bin/true", "env": ["A", "b"]})
        self.assertEqual(nb.load_acp_config(), {})


class TestAiConfigErrorPaths(BaseTest):
    """POST /api/ai/config validation table, save failure, and masked-view
    filtering."""

    def _post(self, body):
        return self.post("/api/ai/config", body)

    def test_sanitize_server_rejects_bad_fields(self):
        bad_servers = [
            {"name": 123, "baseUrl": "http://x"},
            {"name": "", "baseUrl": "http://x"},
            {"name": "x" * 61, "baseUrl": "http://x"},
            {"name": "ok", "baseUrl": 123},
            {"name": "ok", "baseUrl": ""},
            {"name": "ok", "baseUrl": "http://" + "a" * 300},
            {"name": "ok", "baseUrl": "http://x", "apiKey": 123},
            {"name": "ok", "baseUrl": "http://x", "apiKey": "k" * 501},
            {"name": "ok", "baseUrl": "http://x", "model": 123},
            {"name": "ok", "baseUrl": "http://x", "replaceSecret": True,
             "replaceSecretFor": "ghost"},
        ]
        for server in bad_servers[:-1]:
            with self.subTest(server=server):
                r = self._post({"servers": [server]})
                self.assertEqual(r.status_code, 400,
                                 r.get_data(as_text=True))
        # The last one is valid (blank key, no stored match -> empty key).
        r = self._post({"servers": [bad_servers[-1]]})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["servers"][0]["hasKey"])

    def test_null_optional_fields_default(self):
        r = self._post({"servers": [{
            "name": "ok", "baseUrl": "http://x", "apiKey": None,
            "model": None}]})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()["servers"][0]
        self.assertFalse(body["hasKey"])
        self.assertEqual(body["model"], "")

    def test_top_level_validation_errors(self):
        cases = [
            ({}, "servers"),                                   # missing
            ({"servers": "nope"}, "servers must be a list"),
            ({"servers": [], "default": 1}, "default must be a string"),
            ({"servers": [], "customPrompt": 1},
             "customPrompt must be a string"),
            ({"servers": [], "searxngUrl": 1},
             "searxngUrl must be a string"),
            ({"servers": [], "searxngUrl": "http://" + "a" * 300},
             "searxngUrl is longer than 300 chars"),
        ]
        for body, marker in cases:
            with self.subTest(body=body):
                r = self._post(body)
                self.assertEqual(r.status_code, 400)
                self.assertIn(marker, r.get_json()["error"])

    def test_save_failure_is_500(self):
        with mock.patch.object(nb, "save_ai_config",
                               side_effect=OSError("disk full")):
            r = self._post({"servers": [], "default": ""})
        self.assertEqual(r.status_code, 500)
        self.assertIn("Could not write AI config", r.get_json()["error"])

    def test_public_config_skips_non_object_servers(self):
        with open(nb.AI_FILE, "w", encoding="utf-8") as f:
            json.dump({"servers": [
                {"name": "ok", "base_url": "http://x", "api_key": "k",
                 "model": "m"},
                "junk",
                42,
            ], "default": "ok"}, f)
        code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertEqual([s["name"] for s in data["servers"]], ["ok"])

    def test_replace_secret_scans_all_stored_servers(self):
        # Stored list has a non-matching dict and a non-object; both continue
        # the scan, ending with an empty key (not an error).
        with open(nb.AI_FILE, "w", encoding="utf-8") as f:
            json.dump({"servers": [{"name": "other", "api_key": "k"},
                                   "junk"]}, f)
        r = self._post({"servers": [{
            "name": "new", "baseUrl": "http://x", "apiKey": "",
            "replaceSecret": True, "replaceSecretFor": "ghost"}]})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["servers"][0]["hasKey"])


def _http_error(code=500):
    return nb.urllib.error.HTTPError("http://stub", code, "boom", {},
                                     io.BytesIO(b"boom"))


class _FakeHttpResponse:
    """Minimal urlopen() context manager for stubbing upstream replies."""

    def __init__(self, body=b"", content_type="application/json", status=200):
        self._body = body
        self.headers = {"Content-Type": content_type}
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, amt=None):
        if amt is None or amt < 0:
            chunk, self._body = self._body, b""
        else:
            chunk, self._body = self._body[:amt], self._body[amt:]
        return chunk


class TestAiUpstreamErrorPaths(BaseTest):
    """Failure paths in probe / fetch / search / chat that the loopback
    happy-path stubs do not reach."""

    def test_probe_missing_and_empty_base_url(self):
        self.assertEqual(self.client.get("/api/ai/probe").status_code, 400)
        with open(nb.AI_FILE, "w", encoding="utf-8") as f:
            json.dump({"servers": [{"name": "nobase", "base_url": ""}],
                       "default": "nobase"}, f)
        r = self.client.get("/api/ai/probe?server=nobase")
        self.assertEqual(r.status_code, 400)

    def test_probe_http_error_counts_as_reachable(self):
        self.post("/api/ai/config", {"servers": [{
            "name": "p", "baseUrl": "http://host"}], "default": "p"})
        with mock.patch.object(nb.urllib.request, "urlopen",
                               side_effect=_http_error(500)):
            r = self.client.get("/api/ai/probe?server=p")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(), {"ok": True, "status": 500})

    def test_fetch_long_url_and_connection_error(self):
        r = self.post("/api/ai/fetch", {"url": "http://" + "a" * 2000})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/ai/fetch", {"url": "http://127.0.0.1:1/x"})
        self.assertEqual(r.status_code, 502)

    def test_search_long_query_and_http_error(self):
        self.post("/api/ai/config", {"servers": [], "default": "",
                                     "searxngUrl": "http://stub"})
        r = self.post("/api/ai/search", {"q": "q" * 501})
        self.assertEqual(r.status_code, 400)
        with mock.patch.object(nb.urllib.request, "urlopen",
                               side_effect=_http_error(500)):
            r = self.post("/api/ai/search", {"q": "x"})
        self.assertEqual(r.status_code, 502)

    def test_search_connection_error(self):
        self.post("/api/ai/config", {"servers": [], "default": "",
                                     "searxngUrl": "http://127.0.0.1:1"})
        r = self.post("/api/ai/search", {"q": "x"})
        self.assertEqual(r.status_code, 502)

    def test_search_non_json_and_mixed_results(self):
        self.post("/api/ai/config", {"servers": [], "default": "",
                                     "searxngUrl": "http://stub"})
        with mock.patch.object(nb.urllib.request, "urlopen",
                               return_value=_FakeHttpResponse(b"not json")):
            r = self.post("/api/ai/search", {"q": "x"})
        self.assertEqual(r.status_code, 502)
        mixed = json.dumps({"results": [
            {"title": "a", "url": "u1", "content": "s1"},
            "junk",
            {"title": "b", "url": "u2", "content": "s2"},
        ]}).encode()
        with mock.patch.object(nb.urllib.request, "urlopen",
                               return_value=_FakeHttpResponse(mixed)):
            r = self.post("/api/ai/search", {"q": "x"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x["title"] for x in r.get_json()["results"]],
                         ["a", "b"])

    def test_chat_non_object_body_and_empty_base_url(self):
        r = self.client.post("/api/ai/chat", json=[])
        self.assertEqual(r.status_code, 400)
        with open(nb.AI_FILE, "w", encoding="utf-8") as f:
            json.dump({"servers": [{"name": "nobase", "base_url": ""}],
                       "default": "nobase"}, f)
        r = self.client.post("/api/ai/chat", json={
            "server": "nobase",
            "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 400)

    def test_chat_connection_failure_is_sse_error(self):
        with open(nb.AI_FILE, "w", encoding="utf-8") as f:
            json.dump({"servers": [{
                "name": "dead", "base_url": "http://127.0.0.1:1"}],
                "default": "dead"}, f)
        r = self.client.post("/api/ai/chat", json={
            "server": "dead",
            "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("event: error", body)
        self.assertIn('"status": 0', body)


class TestAcpChatErrorPaths(BaseTest):
    """Validation and disconnect paths in the ACP SSE branch."""

    NAME = "acp"

    def setUp(self):
        super().setUp()
        with open(nb.ACP_FILE, "w", encoding="utf-8") as f:
            json.dump({"name": self.NAME, "command": sys.executable,
                       "args": ["-c", "raise SystemExit(0)"],
                       "timeout": 5}, f)

    def _chat(self, body):
        return self.client.post("/api/ai/chat", json=body)

    def test_invalid_messages_are_rejected(self):
        r = self._chat({"server": self.NAME, "messages": "nope"})
        self.assertEqual(r.status_code, 400)

    def test_oversize_prompt_is_rejected(self):
        with mock.patch.object(nb, "ACP_MAX_PROMPT_BYTES", 20):
            r = self._chat({"server": self.NAME, "messages": [
                {"role": "user", "content": "x" * 100}]})
        self.assertEqual(r.status_code, 400)
        self.assertIn("ACP prompt exceeds", r.get_json()["error"])

    def test_context_preamble_degrades_on_corrupt_config(self):
        with open(nb.CONFIG_FILE, "w", encoding="utf-8") as f:
            f.write("{ nope")
        self.assertEqual(nb._acp_context_preamble(), nb.ACP_CONTEXT_PREAMBLE)

    def test_client_disconnect_closes_pump_generator(self):
        # Drive the SSE pump one frame, then close it. That delivers
        # GeneratorExit to the yield and must re-raise (cancelling the turn),
        # not escape as a traceback.
        import acp_client

        def fake_run_turn(*args, **kwargs):
            yield {"type": "text", "text": "hi"}
            yield {"type": "ping"}

        with mock.patch.object(acp_client, "run_turn", fake_run_turn):
            r = self.client.post("/api/ai/chat", json={
                "server": self.NAME,
                "messages": [{"role": "user", "content": "hi"}]},
                buffered=False)
            self.assertEqual(r.status_code, 200)
            iterator = r.response
            try:
                first = next(iterator)
                if isinstance(first, bytes):
                    first = first.decode()
                self.assertIn('"content":"hi"', first)
            finally:
                iterator.close()

    def test_empty_event_stream_closes_cleanly(self):
        import acp_client

        def empty_run_turn(*args, **kwargs):
            return
            yield  # unreachable; marks the function as a generator

        with mock.patch.object(acp_client, "run_turn", empty_run_turn):
            r = self.client.post("/api/ai/chat", json={
                "server": self.NAME,
                "messages": [{"role": "user", "content": "hi"}]},
                buffered=False)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(list(r.response), [])


class TestRouteErrorPaths(BaseTest):
    """OSError / bad-input branches in the file, ls, search and graph routes."""

    def test_ls_listdir_failure_is_500(self):
        with mock.patch.object(nb.os, "listdir", side_effect=OSError("denied")):
            r = self.client.get("/api/ls")
        self.assertEqual(r.status_code, 500)

    def test_ls_skips_entries_that_vanish_before_stat(self):
        os.symlink(os.path.join(nb.DATA_DIR, "gone"),
                   os.path.join(nb.DATA_DIR, "broken-link"))
        r = self.client.get("/api/ls")
        self.assertEqual(r.status_code, 200)
        names = [e["name"] for e in r.get_json()["entries"]]
        self.assertNotIn("broken-link", names)

    def test_file_get_stat_failure_and_read_failure(self):
        self.post("/api/file", {"path": "a.md", "content": "hi"})
        with mock.patch.object(nb.os.path, "getmtime",
                               side_effect=OSError("denied")):
            r = self.client.get("/api/file?path=a.md")
        self.assertEqual(r.status_code, 500)
        with mock.patch("builtins.open", side_effect=OSError("denied")):
            r = self.client.get("/api/file?path=a.md")
        self.assertEqual(r.status_code, 500)

    def test_file_get_ignores_bad_if_modified_since(self):
        self.post("/api/file", {"path": "a.md", "content": "hi"})
        r = self.client.get("/api/file?path=a.md&ifModifiedSince=nope")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["content"], "hi")

    def test_file_save_rejects_non_string_and_write_failure(self):
        r = self.post("/api/file", {"path": "a.md", "content": 1})
        self.assertEqual(r.status_code, 400)
        with mock.patch.object(nb, "atomic_write", side_effect=OSError("full")):
            r = self.post("/api/file", {"path": "a.md", "content": "x"})
        self.assertEqual(r.status_code, 500)

    def test_append_missing_field_and_open_failure(self):
        r = self.post("/api/file/append", {"path": "a.md"})
        self.assertEqual(r.status_code, 400)
        self.post("/api/file", {"path": "a.md", "content": "x"})
        with mock.patch.object(nb.os, "open", side_effect=OSError("denied")):
            r = self.post("/api/file/append",
                          {"path": "a.md", "content": "more"})
        self.assertEqual(r.status_code, 500)

    def test_edit_read_and_write_failures(self):
        self.post("/api/file", {"path": "a.md", "content": "one\n"})
        body = {"path": "a.md", "edits": [{"op": "append", "text": "two"}]}
        with mock.patch("builtins.open", side_effect=OSError("denied")):
            r = self.post("/api/edit", body)
        self.assertEqual(r.status_code, 500)
        with mock.patch.object(nb, "atomic_write", side_effect=OSError("full")):
            r = self.post("/api/edit", body)
        self.assertEqual(r.status_code, 500)

    def test_create_missing_field_non_string_content_and_failure(self):
        r = self.post("/api/create", {"path": "x"})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/create", {"path": "x", "type": "file",
                                      "content": 1})
        self.assertEqual(r.status_code, 400)
        with mock.patch.object(nb.os, "makedirs",
                               side_effect=OSError("denied")):
            r = self.post("/api/create", {"path": "d", "type": "dir"})
        self.assertEqual(r.status_code, 500)

    def test_agent_guide_missing_file_is_500(self):
        with mock.patch.object(nb, "AGENT_GUIDE_FILE",
                               os.path.join(nb.CONFIG_DIR, "missing.md")):
            r = self.client.get("/agent.md")
        self.assertEqual(r.status_code, 500)

    def test_search_skips_non_markdown_files(self):
        with open(os.path.join(nb.DATA_DIR, "notes.txt"), "w") as f:
            f.write("zz_needle_zz")
        r = self.client.get("/api/search?q=zz_needle_zz")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["matches"], [])

    def test_search_skips_unreadable_files(self):
        self.post("/api/file", {"path": "a.md", "content": "needle"})
        with mock.patch("builtins.open", side_effect=OSError("denied")):
            r = self.client.get("/api/search?q=needle")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["matches"], [])

    def test_search_mtime_failure_falls_back_to_zero(self):
        self.post("/api/file", {"path": "a.md", "content": "needle"})
        with mock.patch.object(nb.os.path, "getmtime",
                               side_effect=OSError("denied")):
            r = self.client.get("/api/search?q=needle&order=mtime")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.get_json()["matches"]), 1)

    def test_graph_skips_non_md_and_unresolvable_links(self):
        # Clear the seeded template so only the links under test contribute.
        shutil.rmtree(nb.DATA_DIR)
        os.makedirs(nb.DATA_DIR)
        self.post("/api/file", {"path": "target.md", "content": "target"})
        self.post("/api/file", {"path": "links.md", "content": (
            "[[#frag]]\n"
            "[[/absolute.md]]\n"
            "[out](../../escape.md)\n"
            "[[target]]\n")})
        with open(os.path.join(nb.DATA_DIR, "attachment.txt"), "w") as f:
            f.write("not a note")
        code, data = self.jget("/api/graph")
        self.assertEqual(code, 200)
        ids = {n["id"] for n in data["nodes"]}
        self.assertIn("links.md", ids)
        self.assertIn("target.md", ids)
        self.assertNotIn("attachment.txt", ids)
        self.assertEqual(len(data["edges"]), 1)
        self.assertEqual({data["edges"][0]["source"],
                          data["edges"][0]["target"]},
                         {"links.md", "target.md"})

    def test_graph_unreadable_file_contributes_no_links(self):
        shutil.rmtree(nb.DATA_DIR)
        os.makedirs(nb.DATA_DIR)
        self.post("/api/file", {"path": "a.md", "content": "[[b]]"})
        self.post("/api/file", {"path": "b.md", "content": "b"})
        with mock.patch("builtins.open", side_effect=OSError("denied")):
            r = self.client.get("/api/graph")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["edges"], [])


class TestMoveCopyDeleteErrorPaths(BaseTest):
    """Conflict/race/OSError branches in move, copy and delete."""

    def _file(self, rel, content="x"):
        self.post("/api/file", {"path": rel, "content": content})

    def test_move_missing_field_and_invalid_paths(self):
        r = self.post("/api/move", {"from": "a.md"})
        self.assertEqual(r.status_code, 400)
        self._file("a.md")
        r = self.post("/api/move", {"from": "/etc/passwd", "to": "b.md"})
        self.assertEqual(r.status_code, 400)

    def test_move_overwrite_remove_failure_is_500(self):
        self._file("a.md")
        self._file("b.md")
        with mock.patch.object(nb, "_remove_path", side_effect=OSError("busy")):
            r = self.post("/api/move", {"from": "a.md", "to": "b.md",
                                        "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 500)

    def test_move_lost_race_is_409(self):
        self._file("a.md")
        with mock.patch.object(nb.os, "link",
                               side_effect=FileExistsError("race")):
            r = self.post("/api/move", {"from": "a.md", "to": "b.md"})
        self.assertEqual(r.status_code, 409)

    def test_move_falls_back_to_rename_without_hardlinks(self):
        self._file("a.md", "moved")
        with mock.patch.object(nb.os, "link", side_effect=OSError("no links")):
            r = self.post("/api/move", {"from": "a.md", "to": "b.md"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.jget("/api/file?path=b.md")[1]["content"],
                         "moved")

    def test_move_rename_failure_is_500(self):
        os.makedirs(os.path.join(nb.DATA_DIR, "d1"))
        with mock.patch.object(nb.os, "rename", side_effect=OSError("denied")):
            r = self.post("/api/move", {"from": "d1", "to": "d2"})
        self.assertEqual(r.status_code, 500)

    def test_copy_missing_field_invalid_path_and_missing_source(self):
        r = self.post("/api/copy", {"from": "a.md"})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/copy", {"from": "/etc/passwd", "to": "b.md"})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/copy", {"from": "nope.md", "to": "b.md"})
        self.assertEqual(r.status_code, 404)

    def test_copy_overwrite_remove_failure_is_500(self):
        self._file("a.md")
        self._file("b.md")
        with mock.patch.object(nb, "_remove_path", side_effect=OSError("busy")):
            r = self.post("/api/copy", {"from": "a.md", "to": "b.md",
                                        "onConflict": "overwrite"})
        self.assertEqual(r.status_code, 500)

    def test_copy_lost_race_error_and_skip(self):
        self._file("a.md")
        with mock.patch("builtins.open",
                        side_effect=FileExistsError("race")):
            r = self.post("/api/copy", {"from": "a.md", "to": "b.md"})
            self.assertEqual(r.status_code, 409)
            r = self.post("/api/copy", {"from": "a.md", "to": "b.md",
                                        "onConflict": "skip"})
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.get_json()["skipped"])

    def test_copy_partial_write_cleans_up_and_is_500(self):
        self._file("a.md")
        with mock.patch("builtins.open", side_effect=OSError("full")), \
                mock.patch.object(nb, "_remove_path") as remove:
            r = self.post("/api/copy", {"from": "a.md", "to": "b.md"})
        self.assertEqual(r.status_code, 500)
        remove.assert_called_once()

    def test_delete_missing_field_and_remove_failure(self):
        r = self.post("/api/delete", {})
        self.assertEqual(r.status_code, 400)
        self._file("a.md")
        with mock.patch.object(nb, "_remove_path", side_effect=OSError("busy")):
            r = self.post("/api/delete", {"path": "a.md"})
        self.assertEqual(r.status_code, 500)


class TestAcpClientExtra(unittest.TestCase):
    """Direct unit coverage for acp_client paths the stub-agent tests do not
    hit: callback filtering, permission choice, capability refusals, queue
    overflow, generic failures, and cancellation."""

    STUB = os.path.join(ROOT, "tests", "fixtures", "stub_acp_agent.py")

    def test_session_update_ignores_empty_text_other_kinds_and_bad_titles(self):
        import asyncio
        from types import SimpleNamespace
        import acp_client

        client = acp_client._Client(queue.Queue())

        async def feed(update):
            await client.session_update("s", update)

        # agent_message_chunk with missing/non-string/empty text -> no event.
        for content in (None, SimpleNamespace(text=123),
                        SimpleNamespace(text="")):
            asyncio.run(feed(SimpleNamespace(
                session_update="agent_message_chunk", content=content)))
        # Any other update kind is dropped.
        asyncio.run(feed(SimpleNamespace(session_update="plan")))
        # tool_call without a usable title is dropped.
        for title in (None, "", "   ", 7):
            asyncio.run(feed(SimpleNamespace(
                session_update="tool_call", title=title)))
        self.assertTrue(client.events.empty())

    def test_permission_prefers_allow_once_else_allow_always_else_denies(self):
        import asyncio
        from acp import schema
        import acp_client

        client = acp_client._Client(queue.Queue())
        once = schema.PermissionOption(optionId="once", name="Once",
                                       kind="allow_once")
        always = schema.PermissionOption(optionId="always", name="Always",
                                         kind="allow_always")
        result = asyncio.run(client.request_permission(
            "s", None, [always, once]))
        self.assertEqual(result.outcome.outcome, "selected")
        self.assertEqual(result.outcome.option_id, "once")
        # Only allow_always offered -> use it (covers the elif branch).
        result = asyncio.run(client.request_permission(
            "s", None, [always]))
        self.assertEqual(result.outcome.option_id, "always")
        # A second allow_always is skipped once one is already chosen.
        result = asyncio.run(client.request_permission(
            "s", None, [always, always]))
        self.assertEqual(result.outcome.option_id, "always")
        # No allow option at all -> explicit deny, never a fake success.
        result = asyncio.run(client.request_permission("s", None, []))
        self.assertEqual(result.outcome.outcome, "cancelled")

    def test_all_capability_overrides_refuse_with_method_not_found(self):
        import asyncio
        import acp
        import acp_client

        client = acp_client._Client(queue.Queue())
        calls = [
            (client.read_text_file, ("s", "p")),
            (client.write_text_file, ("s", "p", "c")),
            (client.create_terminal, ("s", "cmd")),
            (client.terminal_output, ("s", "t")),
            (client.release_terminal, ("s", "t")),
            (client.wait_for_terminal_exit, ("s", "t")),
            (client.kill_terminal, ("s", "t")),
            (client.create_elicitation, ("msg", "form")),
        ]
        for fn, args in calls:
            with self.subTest(method=fn.__name__):
                with self.assertRaises(acp.RequestError) as ctx:
                    asyncio.run(fn(*args))
                self.assertEqual(ctx.exception.code, -32601)

    def test_queue_overflow_flips_the_flag(self):
        import acp_client

        events = queue.Queue(maxsize=1)
        events.put_nowait({"type": "text", "text": "fill"})
        client = acp_client._Client(events)
        client._enqueue({"type": "text", "text": "overflow"})
        self.assertTrue(client.overflowed)

    def test_generic_turn_failure_yields_single_error(self):
        import acp_client

        with self.assertLogs("acp_client", level="WARNING"):
            with mock.patch.object(acp_client, "spawn_agent_process",
                                   side_effect=RuntimeError("sdk exploded")):
                events = list(acp_client.run_turn("/bin/true", prompt="hi"))
        terminal = [e for e in events
                    if e.get("type") in ("done", "error")]
        self.assertEqual(len(terminal), 1)
        self.assertEqual(terminal[0]["message"], "ACP turn failed")

    def test_overflowed_client_aborts_before_reading_events(self):
        import acp_client

        class OverflowClient(acp_client._Client):
            def __init__(self, events):
                super().__init__(events)
                self.overflowed = True

        with mock.patch.object(acp_client, "_Client", OverflowClient):
            events = list(acp_client.run_turn("/nonexistent", prompt="hi"))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "error")
        self.assertIn("overflowed", events[0]["message"])

    def test_turn_finishing_without_terminal_event_reports_error(self):
        import acp_client

        async def silent_drive(*args, **kwargs):
            return None

        with mock.patch.object(acp_client, "_drive", silent_drive):
            events = list(acp_client.run_turn("/nonexistent", prompt="hi"))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "error")
        self.assertIn("without a result", events[0]["message"])

    def test_generator_close_cancels_the_turn(self):
        import acp_client

        gen = acp_client.run_turn(
            sys.executable,
            args=[self.STUB, "--mode", "hang"],
            cwd=tempfile.gettempdir(), prompt="hi", timeout=15,
            keepalive=True)
        try:
            next(gen)              # waits one poll interval for a ping
        finally:
            gen.close()
        # Give the cancellation a moment to unwind the event loop task.
        time.sleep(0.3)


class TestCliUnit(unittest.TestCase):
    """parse_args / reachable_urls / _lan_ipv4_addresses, without running
    a server."""

    def test_parse_args_defaults_and_flags(self):
        args = nb.parse_args([])
        self.assertEqual(args.host, "0.0.0.0")
        self.assertEqual(args.port, 5000)
        self.assertFalse(args.debug)
        args = nb.parse_args(["--host", "127.0.0.1", "--port", "8080",
                              "--debug"])
        self.assertEqual((args.host, args.port, args.debug),
                         ("127.0.0.1", 8080, True))

    def test_reachable_urls_adds_localhost_and_lan_ips(self):
        with mock.patch.object(nb, "_lan_ipv4_addresses",
                               return_value=["192.168.1.10", "127.0.0.1",
                                             "0.0.0.0"]):
            urls = nb.reachable_urls("0.0.0.0", 5000)
        self.assertEqual(urls, ["http://0.0.0.0:5000",
                                "http://localhost:5000",
                                "http://192.168.1.10:5000"])
        with mock.patch.object(nb, "_lan_ipv4_addresses", return_value=[]):
            self.assertEqual(nb.reachable_urls("localhost", 5000),
                             ["http://localhost:5000"])

    def test_lan_ipv4_addresses_uses_hostname_and_dedupes(self):
        with mock.patch.object(nb.socket, "gethostbyname_ex",
                               return_value=("h", [], [
                                   "192.168.1.5", "127.0.0.1",
                                   "192.168.1.5", ""])):
            self.assertEqual(nb._lan_ipv4_addresses(), ["192.168.1.5"])

    def test_lan_ipv4_addresses_falls_back_to_udp_socket(self):
        class FakeSocket:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def connect(self, addr):
                pass

            def getsockname(self):
                return ("10.0.0.7", 1234)

        with mock.patch.object(nb.socket, "gethostbyname_ex",
                               side_effect=socket.gaierror), \
                mock.patch.object(nb.socket, "socket", return_value=FakeSocket()):
            self.assertEqual(nb._lan_ipv4_addresses(), ["10.0.0.7"])

    def test_lan_ipv4_addresses_swallows_socket_errors(self):
        class BrokenSocket:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def connect(self, addr):
                raise OSError("no route")

        with mock.patch.object(nb.socket, "gethostbyname_ex",
                               side_effect=socket.gaierror), \
                mock.patch.object(nb.socket, "socket",
                                  return_value=BrokenSocket()):
            self.assertEqual(nb._lan_ipv4_addresses(), [])


class TestMainEntrypoint(unittest.TestCase):
    """Execute app.py's __main__ block with Flask.run stubbed out.

    This is the only way to cover the entrypoint print/URL logic without
    starting a real server. DNS is stubbed so nothing leaves the host.
    """

    def test_main_block_prints_and_runs(self):
        original_argv = sys.argv
        try:
            sys.argv = ["app.py", "--host", "0.0.0.0", "--port", "5123",
                        "--debug"]
            with mock.patch("flask.Flask.run") as run, \
                    mock.patch.object(nb.socket, "gethostbyname_ex",
                                      return_value=("host", [],
                                                    ["192.168.1.9"])):
                # First run: data dir exists -> seed_notes is empty.
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    runpy.run_path(os.path.join(ROOT, "app.py"),
                                   run_name="__main__")
                self.assertIn("Markdown notebook server",
                              buf.getvalue())
                self.assertTrue(run.called)
                # Second run: missing data dir -> seed() reports the
                # template copy, covering the non-empty-notes loop.
                shutil.rmtree(nb.DATA_DIR, ignore_errors=True)
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    runpy.run_path(os.path.join(ROOT, "app.py"),
                                   run_name="__main__")
                self.assertIn("Created notebook/", buf.getvalue())
                self.assertIn("WARNING:", buf.getvalue())
                # Third run: loopback/no-debug -> the warning branch is false.
                sys.argv = ["app.py", "--host", "127.0.0.1",
                            "--port", "5123"]
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    runpy.run_path(os.path.join(ROOT, "app.py"),
                                   run_name="__main__")
                self.assertNotIn("WARNING:", buf.getvalue())
        finally:
            sys.argv = original_argv


if __name__ == "__main__":
    unittest.main(verbosity=2)