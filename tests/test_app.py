"""Backend tests for the Markdown notebook server (stdlib unittest).

Uses Flask's test client against the real app. The notebook/config folders are
redirected to a temp dir via NOTEBOOK_DATA_DIR / NOTEBOOK_CONFIG_DIR so the
project's real notebook/ and config/ are never touched.

Run:  .venv_$(hostname)/bin/python -m unittest discover -s tests -v
  or:  .venv_$(hostname)/bin/python -m pytest tests   (if pytest is installed)
"""

import json
import os
import shutil
import sys
import tempfile
import time
import unittest
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


class TestIndexAndSeed(BaseTest):
    def test_index_serves_html(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("viewer", r.get_data(as_text=True))

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
        code, data = self.jget("/api/ai/config")
        self.assertEqual(code, 200)
        self.assertEqual(data, {"servers": [], "default": "", "customPrompt": "",
                                "searxngUrl": ""})
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


if __name__ == "__main__":
    unittest.main(verbosity=2)