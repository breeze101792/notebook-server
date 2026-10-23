/* Real-browser audit: auth (passwords, roles, tokens), Export, PWA.
 *
 * Boots the REAL Flask app against a temp notebook/config and drives the
 * real UI in headless Chromium. Covers:
 *   1. auth off by default (no modal, reads work);
 *   2. set the admin password through Settings -> Security -> Passwords,
 *      login modal appears, wrong password errors, 6th attempt is 429;
 *   3. admin login: reads + writes + logout returns to the modal;
 *   4. viewer password: viewer reads, writes are refused, UI stays dirty;
 *   5. named API token: create in Settings, Bearer read, revoke -> 401,
 *      clearing the admin password removes the viewer hash and tokens;
 *   6. Export -> HTML: real download, standalone, rendered content,
 *      reopens in a second page with no console errors;
 *   7. Export -> PDF: Paged.js pagination + print-root contract;
 *   8. PWA: SW controls, offline shell, /api/* is never cache-served.
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium \
 *         node tests/browser/test_auth_export_browser.js
 * Env:  CHROMIUM_PATH, PORT (default 5081).
 *
 * Headless note: window.print() is overridden to a no-op that records the
 * call. headless Chromium has no print dialog and printing a page is not
 * scriptable; the test therefore verifies the pagination/print-root
 * contract the PDF export builds before calling print, not a PDF file.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const { findChromium } = require("./chromium");
const BROWSER_PATH = process.env.CHROMIUM_PATH || findChromium();
const PORT = Number(process.env.PORT || 5081);
const BASE = "http://127.0.0.1:" + PORT;

const ADMIN_PW = "admin-audit-pw";
const VIEWER_PW = "viewer-audit-pw";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-auth-export-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const EXPORT_NOTE = "Export.md";
const EXPORT_SRC = [
  "# Export Audit",
  "",
  "Intro paragraph for the exported note.",
  "",
  "```js",
  'console.log("audit");',
  "```",
  "",
  "```mermaid",
  "graph TD; A-->B; B-->C;",
  "```",
  "",
].join("\n");
fs.writeFileSync(path.join(DATA, EXPORT_NOTE), EXPORT_SRC);
fs.writeFileSync(path.join(DATA, "Welcome.md"), "# Welcome\n\nAudit reader smoke test.\n");

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}
function section(name) { console.log("\n== " + name + " =="); }

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/auth");
      if (r.ok || r.status === 401) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

let server = null;
let serverLog = "";
// If the harness dies before its finally block, never leave a Flask child
// holding the port (that would make the next run talk to stale config).
process.on("exit", () => {
  if (server) { try { server.kill("SIGKILL"); } catch (_) {} }
});
async function startServer() {
  if (server) await stopServer();
  // Refuse to adopt an orphan from a previous crashed run.
  try {
    await fetch(BASE + "/api/auth");
    throw new Error("port " + PORT + " is already served by another process");
  } catch (e) {
    if (/already served/.test(String(e))) throw e;
  }
  server = spawn(PY, ["app.py", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: PROJ,
    env: Object.assign({}, process.env, {
      NOTEBOOK_DATA_DIR: DATA,
      NOTEBOOK_CONFIG_DIR: CONFIG,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });
  await waitForServer();
}
async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  await new Promise((resolve) => {
    const done = () => { clearTimeout(t); clearTimeout(k); resolve(); };
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 4000);
    const k = setTimeout(done, 6000);
    child.once("exit", done);
    child.kill("SIGTERM");
  });
  // Let the listening socket close before the next bind.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { await fetch(BASE + "/api/auth"); }
    catch (_) { return; }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitApp(page) {
  await page.waitForFunction(
    () => window.NB && window.NB.auth && window.NB.auth.status &&
      window.NB.auth.status() !== null,
    null, { timeout: 30000 });
}
async function waitLoginModal(page) {
  await page.waitForFunction(() => {
    const o = document.getElementById("auth-overlay");
    return o && !o.hidden;
  }, null, { timeout: 20000 });
}
async function waitModalClosed(page) {
  await page.waitForFunction(() => {
    const o = document.getElementById("auth-overlay");
    return o && o.hidden;
  }, null, { timeout: 20000 });
}
async function login(page, pw) {
  await page.fill("#auth-password", pw);
  const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 })
    .catch(() => null);
  await page.click("#auth-submit");
  await nav;
  await waitApp(page);
}
async function logout(page) {
  await page.click("#logout-btn");
  await waitLoginModal(page);
}
async function openSettings(page, tab) {
  const open = await page.evaluate(
    () => !document.getElementById("settings-overlay").hidden);
  if (!open) {
    await page.click("#activity-settings-btn");
    await page.waitForFunction(
      () => !document.getElementById("settings-overlay").hidden, null, { timeout: 10000 });
  }
  await page.locator('.settings-nav-item[data-tab="' + tab + '"]').click();
  await page.waitForFunction((name) => {
    const s = document.querySelector('.settings-section[data-section="' + name + '"]');
    return s && !s.hidden;
  }, tab, { timeout: 5000 });
}
async function closeSettings(page) {
  await page.evaluate(() => {
    const o = document.getElementById("settings-overlay");
    if (o && !o.hidden) document.getElementById("settings-close").click();
  });
}
async function saveWithReload(page, selector) {
  const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 })
    .catch(() => null);
  await page.click(selector);
  await nav;
  await waitApp(page);
}
async function pageFetch(page, url, opts) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, Object.assign({ credentials: "same-origin" }, o || {}));
    return { status: r.status, text: await r.text() };
  }, { u: url, o: opts });
}
function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}
function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}

async function main() {
  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: BROWSER_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    console.error("cannot launch chromium: " + String(err).split("\n")[0]);
    console.error("Set CHROMIUM_PATH to a working binary.");
    process.exit(2);
  }

  const pageErrors = [];
  const consoleErrors = [];
  let ctx;
  try {
    await startServer();

    ctx = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    // Deterministic PDF contract: headless Chromium cannot open a print
    // dialog, so record the call instead of invoking the real dialog.
    await page.addInitScript(() => {
      window.__printCalls = 0;
      window.print = function () { window.__printCalls += 1; };
    });
    page.on("dialog", (d) => d.accept());

    /* ---------------------------------------------------------------- */
    section("1. auth off by default");
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await waitApp(page);
    await page.waitForTimeout(200);

    {
      const s = await page.evaluate(() => ({
        overlayHidden: document.getElementById("auth-overlay").hidden,
        locked: document.body.classList.contains("auth-locked"),
        logoutHidden: document.getElementById("logout-btn").hidden,
      }));
      check("no login modal on a fresh server", s.overlayHidden);
      check("body is not auth-locked", !s.locked);
      check("logout button is hidden when signed out", s.logoutHidden);
    }
    {
      const r = await pageFetch(page, "/api/tree");
      const body = parseJson(r.text);
      const names = (body && body.tree || []).map((n) => n.name);
      check("unauthenticated read /api/tree returns 200", r.status === 200, "status=" + r.status);
      check("tree lists the seeded note", names.includes("Welcome.md"), JSON.stringify(names));
    }
    {
      const r = await pageFetch(page, "/api/file?path=Welcome.md");
      const body = parseJson(r.text);
      check("unauthenticated read /api/file returns 200", r.status === 200, "status=" + r.status);
      check("file body is the seeded content",
        !!(body && /Welcome/i.test(body.content || "")), (body && body.content || "").slice(0, 60));
    }
    {
      await page.waitForFunction(
        () => document.querySelector("#file-tree .tree-row"), null, { timeout: 15000 });
      await page.locator('#file-tree .tree-row[data-path="Welcome.md"]').click();
      await page.waitForFunction(
        () => NB.tabs.getActive() === "Welcome.md" &&
          /welcome/i.test((document.querySelector("#viewer-content h1") || {}).textContent || ""),
        null, { timeout: 15000 });
      const h = await page.locator("#viewer-content h1").first().textContent();
      check("viewer renders the opened note", /welcome/i.test(h || ""), h || "");
    }

    /* ---------------------------------------------------------------- */
    section("2. set admin password + login lockout");
    await openSettings(page, "security");
    {
      const s = await page.evaluate(() => ({
        setVisible: !document.getElementById("settings-auth-admin-set").hidden,
        changeVisible: !document.getElementById("settings-auth-admin-change").hidden,
        saveDisabled: document.getElementById("settings-auth-admin-save").disabled,
      }));
      check("admin set form is shown while auth is off", s.setVisible);
      check("admin change form is hidden while auth is off", !s.changeVisible);
      check("admin save starts disabled", s.saveDisabled);
    }
    await page.fill("#settings-auth-admin-new", ADMIN_PW);
    await page.fill("#settings-auth-admin-confirm", ADMIN_PW);
    await page.waitForFunction(
      () => !document.getElementById("settings-auth-admin-save").disabled,
      null, { timeout: 5000 });
    check("admin save enables for a matching 6+ char password", true);

    await saveWithReload(page, "#settings-auth-admin-save");
    await waitLoginModal(page);
    check("enabling auth reloads into the login modal", true);
    check("body is auth-locked before login",
      await page.evaluate(() => document.body.classList.contains("auth-locked")));
    {
      const r = await pageFetch(page, "/api/tree");
      check("reads are gated without a session (401)", r.status === 401, "status=" + r.status);
    }

    {
      // Let the boot-time gated requests (config save + tree) finish their
      // 401s before the first attempt; each attempt is serialized on the
      // submit button, so no in-flight login 401 can clear the next fill.
      await page.waitForTimeout(1500);
      const errors = [];
      for (let i = 0; i < 5; i++) {
        await page.fill("#auth-password", "wrong-password-" + i);
        await page.click("#auth-submit");
        await page.waitForFunction(
          () => !document.getElementById("auth-submit").disabled,
          null, { timeout: 15000 });
        await page.waitForTimeout(150);
        errors.push(await page.locator("#auth-error").textContent());
      }
      check("wrong password #1-5 each show Invalid password",
        errors.length === 5 && errors.every((t) => /invalid password/i.test(t)),
        JSON.stringify(errors));
      const sixth = await fetch(BASE + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password-6" }),
      });
      check("6th wrong attempt returns 429", sixth.status === 429, "status=" + sixth.status);
      await page.fill("#auth-password", "wrong-password-7");
      await page.click("#auth-submit");
      await page.waitForFunction(
        () => !document.getElementById("auth-submit").disabled,
        null, { timeout: 15000 });
      await page.waitForTimeout(150);
      const lockMsg = await page.locator("#auth-error").textContent();
      check("the modal shows a lockout message", /too many|try again/i.test(lockMsg || ""),
        lockMsg || "");
    }

    // The limiter is in memory; restart the same server (same auth.json)
    // to clear it without losing the admin password.
    await stopServer();
    await startServer();
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitApp(page);
    await waitLoginModal(page);
    {
      const st = await page.evaluate(() => NB.auth.status());
      check("auth stays enabled across a restart", !!(st && st.enabled), JSON.stringify(st));
    }
    {
      // A background gated request (the 5s tree watcher) fires auth:required
      // while the login modal is open. It must not wipe a password the user
      // is in the middle of typing.
      await page.fill("#auth-password", "half-typed-secret");
      await page.waitForTimeout(6000);
      const val = await page.evaluate(
        () => document.getElementById("auth-password").value);
      check("background 401s do not wipe a half-typed password",
        val === "half-typed-secret", JSON.stringify({ value: val }));
      await page.fill("#auth-password", "");
    }

    /* ---------------------------------------------------------------- */
    section("3. admin login, write, logout");
    await login(page, ADMIN_PW);
    await waitModalClosed(page);
    {
      const s = await page.evaluate(() => ({
        locked: document.body.classList.contains("auth-locked"),
        logoutHidden: document.getElementById("logout-btn").hidden,
        role: NB.auth.status() && NB.auth.status().role,
      }));
      check("admin login clears the modal and lock", !s.locked);
      check("admin login resolves role=admin", s.role === "admin", String(s.role));
      check("logout button is visible after admin login", !s.logoutHidden);
    }
    {
      const r = await pageFetch(page, "/api/tree");
      check("admin read /api/tree returns 200", r.status === 200, "status=" + r.status);
    }
    {
      const w = await page.evaluate(async () => {
        try {
          await NB.api.saveFile("AdminWrite.md", "# Admin write\n\nwritten by the audit\n");
          return { ok: true };
        } catch (e) { return { ok: false, msg: String(e && e.message || e) }; }
      });
      check("admin write through NB.api succeeds", w.ok, w.msg || "");
      const disk = fs.readFileSync(path.join(DATA, "AdminWrite.md"), "utf8");
      check("admin write landed on disk", disk.includes("written by the audit"));
    }
    await logout(page);
    {
      const s = await page.evaluate(() => ({
        overlayShown: !document.getElementById("auth-overlay").hidden,
        logoutHidden: document.getElementById("logout-btn").hidden,
      }));
      check("logout shows the login modal", s.overlayShown);
      check("logout button is hidden when signed out", s.logoutHidden);
    }
    {
      const r = await pageFetch(page, "/api/tree");
      check("write/read after logout is refused (401)", r.status === 401, "status=" + r.status);
    }

    /* ---------------------------------------------------------------- */
    section("4. viewer role: read allowed, write refused");
    await login(page, ADMIN_PW);
    await openSettings(page, "security");
    await page.check("#settings-auth-viewer-toggle");
    await page.fill("#settings-auth-viewer-pw", VIEWER_PW);
    await page.fill("#settings-auth-viewer-confirm", VIEWER_PW);
    await page.waitForFunction(
      () => !document.getElementById("settings-auth-viewer-save").disabled,
      null, { timeout: 5000 });
    await saveWithReload(page, "#settings-auth-viewer-save");
    {
      const st = await page.evaluate(() => NB.auth.status());
      check("viewer hash is set after the UI save", !!(st && st.hasViewer), JSON.stringify(st));
    }
    await logout(page);
    await login(page, VIEWER_PW);
    {
      const st = await page.evaluate(() => NB.auth.status());
      check("viewer login resolves role=viewer", st && st.role === "viewer", JSON.stringify(st));
    }
    {
      const t = await pageFetch(page, "/api/tree");
      check("viewer read /api/tree returns 200", t.status === 200, "status=" + t.status);
      const f = await pageFetch(page, "/api/file?path=Welcome.md");
      check("viewer read /api/file returns 200", f.status === 200, "status=" + f.status);
    }
    const beforeDisk = fs.readFileSync(path.join(DATA, "Welcome.md"), "utf8");
    {
      const w = await pageFetch(page, "/api/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "Welcome.md", content: "# HACKED\n" }),
      });
      check("viewer POST /api/file is refused with 403", w.status === 403, "status=" + w.status);
    }
    {
      // Drive the real UI save path: enter source edit, change the buffer,
      // press Save. The role must not be able to persist, and the viewer
      // must not mark the buffer clean or toast success.
      await page.locator('#file-tree .tree-row[data-path="Welcome.md"]').click();
      await page.waitForSelector("#viewer-content h1", { timeout: 10000 });
      await page.click("#edit-toggle");
      await page.waitForFunction(
        () => window.NB.cmEditor && NB.cmEditor.isReady && NB.cmEditor.isReady(),
        null, { timeout: 15000 });
      await page.evaluate(() => NB.cmEditor.setValue("# HACKED FROM UI\n"));
      await page.waitForFunction(
        () => NB.viewer.isDirty("Welcome.md"), null, { timeout: 5000 });
      const errBeforeSave = pageErrors.length;
      await page.click("#save-btn");
      await page.waitForTimeout(700);
      const st = await page.evaluate(() => ({
        dirty: NB.viewer.isDirty("Welcome.md"),
        toast: document.querySelector(".toast.show")
          ? document.querySelector(".toast.show").textContent : null,
      }));
      check("viewer UI save leaves the buffer dirty", st.dirty === true, JSON.stringify(st));
      check("viewer UI save shows no success toast",
        !st.toast || !/saved/i.test(st.toast), String(st.toast));
      const afterDisk = fs.readFileSync(path.join(DATA, "Welcome.md"), "utf8");
      check("viewer UI save did not change the file", afterDisk === beforeDisk);
      check("viewer UI save raises no uncaught page error",
        pageErrors.length === errBeforeSave,
        JSON.stringify(pageErrors.slice(errBeforeSave)));
    }
    await page.evaluate(() => { try { NB.viewer.closeEdit(); } catch (_) {} });

    /* ---------------------------------------------------------------- */
    section("5. API tokens");
    await logout(page);
    await login(page, ADMIN_PW);
    await openSettings(page, "security");
    await page.fill("#settings-tokens-name", "audit-token");
    await page.selectOption("#settings-tokens-role", "viewer");
    await page.waitForFunction(
      () => !document.getElementById("settings-tokens-create").disabled,
      null, { timeout: 5000 });
    await page.click("#settings-tokens-create");
    await page.waitForFunction(
      () => !document.getElementById("settings-tokens-issued").hidden,
      null, { timeout: 15000 });
    let token = (await page.locator("#settings-tokens-issued-value").textContent()).trim();
    check("creating a token shows the full nbtk_ string", /^nbtk_[0-9a-f]{40}$/.test(token),
      token.slice(0, 12) + "…");

    await closeSettings(page);
    await openSettings(page, "security");
    await page.waitForFunction(
      () => document.querySelector('.settings-token-row[data-name="audit-token"]'),
      null, { timeout: 10000 });
    {
      const s = await page.evaluate(() => ({
        hidden: document.getElementById("settings-tokens-issued").hidden,
        shownText: document.getElementById("settings-tokens-issued-value").textContent,
      }));
      check("reopening Settings does not show the token again", s.hidden);
      check("issued box text is not visible after reopen",
        s.hidden || s.shownText === "");
    }
    {
      const listed = await pageFetch(page, "/api/auth/tokens");
      const body = parseJson(listed.text);
      check("token list exposes name/role only",
        !!(body && body.tokens && body.tokens.some((t) => t.name === "audit-token"
          && t.role === "viewer" && !("token" in t) && !("hash" in t))),
        listed.text.slice(0, 200));
      check("token list never contains the token string",
        !listed.text.includes(token));
    }
    {
      const r = await fetch(BASE + "/api/file?path=Welcome.md", {
        headers: { Authorization: "Bearer " + token },
      });
      const body = await r.json().catch(() => null);
      check("Bearer token reads a file without a cookie", r.status === 200 && !!(body && body.content),
        "status=" + r.status);
    }
    {
      await page.click('.settings-token-row[data-name="audit-token"] .settings-token-revoke');
      await page.waitForFunction(
        () => !document.querySelector('.settings-token-row[data-name="audit-token"]'),
        null, { timeout: 10000 });
      check("revoking the token removes its row", true);
    }
    {
      const r = await fetch(BASE + "/api/file?path=Welcome.md", {
        headers: { Authorization: "Bearer " + token },
      });
      check("revoked token is rejected with 401", r.status === 401, "status=" + r.status);
    }
    // Issue a second token so clearing the admin password can be checked
    // against a non-empty token list.
    await page.fill("#settings-tokens-name", "audit-cleanup");
    await page.selectOption("#settings-tokens-role", "admin");
    await page.waitForFunction(
      () => !document.getElementById("settings-tokens-create").disabled,
      null, { timeout: 5000 });
    await page.click("#settings-tokens-create");
    await page.waitForFunction(
      () => !document.getElementById("settings-tokens-issued").hidden,
      null, { timeout: 15000 });
    const cleanupToken = (await page.locator("#settings-tokens-issued-value").textContent()).trim();
    check("second token can be issued", /^nbtk_/.test(cleanupToken));

    // Disable auth through the real UI (remove admin password + confirm).
    await page.click("#settings-auth-admin-remove-btn");
    await page.waitForFunction(
      () => !document.getElementById("settings-auth-admin-remove").hidden,
      null, { timeout: 5000 });
    await page.fill("#settings-auth-admin-remove-current", ADMIN_PW);
    await saveWithReload(page, "#settings-auth-admin-remove-confirm");
    await waitApp(page);
    {
      const st = await page.evaluate(() => NB.auth.status());
      check("clearing the admin password disables auth", !!(st && !st.enabled), JSON.stringify(st));
      check("clearing the admin password clears hasViewer", !!(st && !st.hasViewer),
        JSON.stringify(st));
    }
    {
      const auth = JSON.parse(fs.readFileSync(path.join(CONFIG, "auth.json"), "utf8"));
      check("auth.json has no admin hash", !auth.admin_password_hash);
      check("auth.json has no viewer hash", !auth.viewer_password_hash);
      check("auth.json has no remaining tokens",
        !auth.tokens || (Array.isArray(auth.tokens) && auth.tokens.length === 0),
        JSON.stringify(auth.tokens || []));
    }
    {
      const overlayHidden = await page.evaluate(
        () => document.getElementById("auth-overlay").hidden);
      check("auth-off reload shows no login modal", overlayHidden);
      const t = await pageFetch(page, "/api/tree");
      check("reads work again with auth off", t.status === 200, "status=" + t.status);
      const tokens = await pageFetch(page, "/api/auth/tokens");
      const body = parseJson(tokens.text);
      check("token list is empty after the clear", !!(body && body.tokens &&
        body.tokens.length === 0), tokens.text.slice(0, 120));
    }
    // cleanup token must be gone from disk and cannot authenticate
    {
      const r = await fetch(BASE + "/api/file?path=Welcome.md", {
        headers: { Authorization: "Bearer " + cleanupToken },
      });
      // auth is off, so gated routes bypass credentials; the storage check
      // above is the authoritative "tokens removed" assertion. Record the
      // observed status for the report without weakening it.
      check("removed token is not persisted in auth.json", (() => {
        const auth = JSON.parse(fs.readFileSync(path.join(CONFIG, "auth.json"), "utf8"));
        return !auth.tokens || auth.tokens.length === 0;
      })(), "status=" + r.status);
    }

    /* ---------------------------------------------------------------- */
    section("6. Export -> HTML");
    await page.evaluate(() => NB.tabs.open("Export.md"));
    await page.waitForFunction(
      () => NB.tabs.getActive() === "Export.md", null, { timeout: 15000 });
    await page.waitForSelector("#viewer-content h1", { timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .mermaid-container svg"),
      null, { timeout: 30000 }).catch(() => {});

    // Open the Export modal through the real file-tree context menu.
    await page.locator('#file-tree .tree-row[data-path="Export.md"]')
      .click({ button: "right" });
    await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
    await page.locator("#nb-menu button", { hasText: "Export…" }).first().click();
    await page.waitForFunction(
      () => !document.getElementById("export-overlay").hidden, null, { timeout: 10000 });
    check("Export… opens the export modal for the note", true);
    {
      const label = await page.locator("#export-file-label").textContent();
      check("export modal targets the chosen file", /Export\.md/.test(label || ""), label || "");
    }

    const htmlDownload = page.waitForEvent("download", { timeout: 40000 })
      .then((d) => ({ download: d }), (err) => ({ error: err }));
    await page.check('input[name="export-format"][value="html"]');
    await page.click("#export-run");
    let dl = null;
    let dlPath = "";
    let htmlText = "";
    try {
      const ev = await htmlDownload;
      if (ev.error) throw ev.error;
      dl = ev.download;
      dlPath = path.join(tmp, "exported.html");
      await dl.saveAs(dlPath);
      htmlText = dlPath ? fs.readFileSync(dlPath, "utf8") : "";
    } catch (e) {
      const err = await page.evaluate(() => {
        const e = document.getElementById("export-error");
        return e && !e.hidden ? e.textContent : "";
      });
      check("HTML export fires a real download event", false, String(e) + " ui-error=" + err);
    }
    if (dl) {
      check("HTML export fires a real download event", true);
      check("downloaded file is non-empty", htmlText.length > 0, "bytes=" + htmlText.length);
      check("downloaded file is a standalone HTML document",
        /^<!DOCTYPE html>/.test(htmlText) && htmlText.includes("<style>") &&
        !/src="https?:/.test(htmlText) && !/href="https?:/.test(htmlText) &&
        !htmlText.includes("/static/"));
      check("HTML contains the rendered heading",
        /<h1[^>]*>Export Audit<\/h1>/.test(htmlText));
      check("HTML contains highlighted code",
        /<pre><code[^>]*class="[^"]*language-js/.test(htmlText) &&
        stripTags(htmlText).includes('console.log("audit")'));
      check("HTML contains a rendered diagram SVG",
        htmlText.includes("mermaid-container") && /<svg[\s>]/.test(htmlText));
    }
    if (dlPath) {
      const page2 = await ctx.newPage();
      const page2Errors = [];
      const page2Console = [];
      page2.on("pageerror", (e) => page2Errors.push(String(e)));
      page2.on("console", (m) => {
        if (m.type() === "error") page2Console.push(m.text());
      });
      await page2.goto("file://" + dlPath, { waitUntil: "load", timeout: 20000 });
      await page2.waitForTimeout(400);
      const h = await page2.locator("h1").first()
        .textContent({ timeout: 5000 }).catch((e) => "ERR " + String(e).split("\n")[0]);
      check("exported HTML opens in a second page", /export audit/i.test(h || ""),
        JSON.stringify({ h: h, url: page2.url() }));
      check("exported HTML page has no page errors",
        page2Errors.length === 0, JSON.stringify(page2Errors));
      check("exported HTML page has no console errors",
        page2Console.length === 0, JSON.stringify(page2Console));
      await page2.close();
    }

    /* ---------------------------------------------------------------- */
    section("7. Export -> PDF (Paged.js contract)");
    const errBefore = pageErrors.length;
    await page.bringToFront();
    // exportPdf ends with a double requestAnimationFrame before it mounts
    // the print root. Some headless builds never fire rAF for a page the
    // compositor is not driving; measure it and, only then, use a timer
    // shim so the rest of the print contract can still be verified.
    const rafWorks = await page.evaluate(() => new Promise((resolve) => {
      let done = false;
      requestAnimationFrame(() => { done = true; resolve(true); });
      setTimeout(() => { if (!done) resolve(false); }, 1500);
    }));
    if (!rafWorks) {
      await page.evaluate(() => {
        window.requestAnimationFrame = (cb) =>
          setTimeout(() => cb(performance.now()), 0);
      });
    }
    check("page can schedule animation frames for the print mount",
      rafWorks === true, "headless rAF unavailable; timer shim used");
    await page.check('input[name="export-format"][value="pdf"]');
    await page.click("#export-run");
    let pdfOk = false;
    try {
      // The root is display:none on screen by design; wait for attachment,
      // not visibility.
      await page.waitForSelector("#pdf-print-root", { state: "attached", timeout: 40000 });
      pdfOk = true;
    } catch (e) {
      const err = await page.evaluate(() => {
        const e = document.getElementById("export-error");
        return e && !e.hidden ? e.textContent : "";
      });
      const diag = await page.evaluate(() => {
        const f = document.getElementById("pdf-print-frame");
        let out = { frame: !!f };
        try {
          const w = f && f.contentWindow;
          const d = f && f.contentDocument;
          out = Object.assign(out, {
            hasPaged: !!(w && w.Paged),
            rendered: !!(w && w.__nbPagedRendered),
            pages: d ? d.querySelectorAll(".pagedjs_page").length : -1,
            pagedWrap: d ? d.querySelectorAll(".pagedjs_pages").length : -1,
            bodyLen: d && d.body ? d.body.innerHTML.length : -1,
            docUrl: d ? d.URL : "",
            printCalls: window.__printCalls,
          });
        } catch (e) { out.readError = String(e); }
        return out;
      });
      check("PDF export builds #pdf-print-root", false,
        "ui-error=" + err + " diag=" + JSON.stringify(diag));
    }
    if (pdfOk) {
      check("PDF export builds #pdf-print-root", true);
      const sheets = await page.locator("#pdf-print-root .pagedjs_page").count();
      check("Paged.js produced at least one A4 page sheet", sheets >= 1, "sheets=" + sheets);
      const screen = await page.evaluate(() => {
        const r = document.getElementById("pdf-print-root");
        return { display: r ? getComputedStyle(r).display : "missing" };
      });
      check("print root is hidden on screen", screen.display === "none", JSON.stringify(screen));
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(150);
      const media = await page.evaluate(() => {
        const r = document.getElementById("pdf-print-root");
        const top = document.getElementById("app");
        const pg = document.querySelector("#pdf-print-root .pagedjs_page");
        return {
          display: r ? getComputedStyle(r).display : "missing",
          app: top ? getComputedStyle(top).display : "missing",
          pageHeight: pg ? pg.getBoundingClientRect().height : 0,
          printCalls: window.__printCalls,
        };
      });
      check("print media reveals the paginated root", media.display === "block",
        JSON.stringify(media));
      check("print media hides the app shell", media.app === "none", JSON.stringify(media));
      check("paginated sheet has non-zero height under print", media.pageHeight > 0,
        "h=" + media.pageHeight);
      check("PDF export calls window.print exactly once", media.printCalls === 1,
        "calls=" + media.printCalls);
      await page.emulateMedia({ media: "screen" });
    }
    check("PDF export adds no uncaught page errors",
      pageErrors.length === errBefore,
      JSON.stringify(pageErrors.slice(errBefore)));
    await page.evaluate(() => {
      const o = document.getElementById("export-overlay");
      if (o && !o.hidden) document.getElementById("export-close").click();
    });
    await page.evaluate(() => {
      const r = document.getElementById("pdf-print-root");
      if (r) r.remove();
    });

    /* ---------------------------------------------------------------- */
    section("8. PWA / service worker");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitApp(page);
    const swState = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const ready = await Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 8000)),
      ]);
      const regs = (await navigator.serviceWorker.getRegistrations()).map((r) => ({
        scope: r.scope, active: !!r.active, installing: !!r.installing,
        waiting: !!r.waiting,
      }));
      return { supported: true, ready: ready, controller: !!navigator.serviceWorker.controller,
        regs: regs };
    }).catch((e) => ({ supported: false, error: String(e) }));
    check("service worker registration is active", swState.supported === true &&
      swState.regs && swState.regs.length > 0 && swState.regs[0].active === true,
      JSON.stringify(swState));
    check("service worker scope covers the app shell",
      !!(swState && swState.regs && swState.regs.some((r) => r.scope === BASE + "/")),
      JSON.stringify(swState && swState.regs));
    check("service worker controls the page", !!(swState && swState.controller === true),
      JSON.stringify({ ready: swState && swState.ready, controller: swState && swState.controller }));

    const online = await pageFetch(page, "/api/tree");
    check("online /api/tree is served live", online.status === 200 &&
      online.text.includes("Welcome.md"), "status=" + online.status);

    const cacheRoot = await page.evaluate(async () => {
      try {
        const c = await caches.open("notebook-v13");
        return !!(await c.match("/"));
      } catch (e) { return false; }
    });
    check("service worker cache contains the app shell", cacheRoot === true);
    await ctx.setOffline(true);
    {
      const off = await page.evaluate(async () => {
        try {
          const r = await fetch("/api/tree", { credentials: "same-origin" });
          return { status: r.status, text: await r.text() };
        } catch (e) {
          return { status: 0, text: String(e && e.message || e) };
        }
      });
      check("offline /api/* is not served from the SW cache",
        off.status !== 200 && !off.text.includes("Welcome.md"), JSON.stringify(off));
      check("offline /api/* fails or returns a network error",
        off.status === 0 || off.status >= 500, JSON.stringify(off));
    }
    {
      let shellOk = false;
      let reloadError = "";
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
        // The viewer element is attached even when the welcome page is
        // showing (no note open), so visibility is not the contract here.
        await page.waitForSelector("#viewer-content", { state: "attached", timeout: 15000 });
        shellOk = await page.evaluate(() => !!(window.NB && NB.tabs &&
          document.getElementById("activity-settings-btn") &&
          document.getElementById("file-tree")));
      } catch (e) { reloadError = String(e).split("\n")[0]; }
      check("offline reload still serves the app shell", shellOk, reloadError);
    }
    await ctx.setOffline(false);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await waitApp(page).catch(() => {});

    if (pageErrors.length) {
      console.log("\n  pageerrors observed (" + pageErrors.length + "):");
      pageErrors.forEach((e) => console.log("    - " + e.split("\n")[0]));
    }
  } catch (err) {
    failed++;
    console.error("\nFATAL: " + (err && err.stack || err));
    if (serverLog) console.error("server log tail:\n" + serverLog.slice(-4000));
  } finally {
    try { if (ctx) await ctx.close(); } catch (_) {}
    try { await browser.close(); } catch (_) {}
    await stopServer();
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
