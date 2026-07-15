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
import unittest

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


class TestSearch(BaseTest):
    def setUp(self):
        super().setUp()
        self.post("/api/file", {"path": "a.md",
            "content": "# A\n\nTODO fix this bug here\n\n## Sub\n\nbody fix this again"})
        self.post("/api/file", {"path": "b.md", "content": "# B\n\nFix This with capitals\n"})

    def _matches(self, q, case=False):
        qs = "q=%s&case=%d" % (q, 1 if case else 0)
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


if __name__ == "__main__":
    unittest.main(verbosity=2)