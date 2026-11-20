/* Real-browser audit: CodeMirror source editor, VIM mode, AI panel,
 * AI tool loop (patch cards), and the ACP provider.
 *
 * Boots the REAL Flask app against a temp notebook/config in headless
 * Chromium. The AI provider is a local OpenAI-compatible HTTP server
 * (node http) that streams SSE frames through the real Flask proxy; the
 * ACP provider is tests/fixtures/stub_acp_agent.py (mode "trace") spawned
 * by acp_client.py. Both are exercised through the real side panel.
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium \
 *         node tests/browser/test_ai_editor_browser.js
 * Env:  CHROMIUM_PATH, PORT (default 5086).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const { findChromium } = require("./chromium");
const BROWSER_PATH = process.env.CHROMIUM_PATH || findChromium();
const PORT = Number(process.env.PORT || 5086);
const BASE = "http://127.0.0.1:" + PORT;

const ACP_STUB = path.join(PROJ, "tests", "fixtures", "stub_acp_agent.py");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-ai-editor-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

/* ACP profiles live in config/ai.json's "acp" list (config/acp.json is no
 * longer read). Rewrite the file, keeping every other key and creating it
 * when absent. */
function writeAiConfig(update) {
  const file = path.join(CONFIG, "ai.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) cfg = {};
  update(cfg);
  fs.writeFileSync(file, JSON.stringify(cfg));
}
function clearAcpProfiles() {
  writeAiConfig((cfg) => { delete cfg.acp; });
}

const A = "a.md";
const B = "b.md";
const TARGET = "target.md";
const A_SRC = "# Note A\n\nAlpha body.\n";
const B_SRC = "# Note B\n\nBeta body.\n";
const TARGET_SRC = "# Target\n\nOLD_TOKEN here.\n";
fs.writeFileSync(path.join(DATA, A), A_SRC);
fs.writeFileSync(path.join(DATA, B), B_SRC);
fs.writeFileSync(path.join(DATA, TARGET), TARGET_SRC);
fs.writeFileSync(path.join(DATA, "Welcome.md"), "# Welcome\n\nAudit smoke test.\n");

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}
function section(name) { console.log("\n== " + name + " =="); }
function readNote(rel) { return fs.readFileSync(path.join(DATA, rel), "utf8"); }

function waitForDisk(rel, needle, timeout) {
  const limit = Date.now() + (timeout || 8000);
  while (Date.now() < limit) {
    try {
      if (readNote(rel).includes(needle)) return true;
    } catch (_) {}
    // A tight synchronous loop would block Node's timers; the Flask write
    // is local and quick, so a handful of retries is enough.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return false;
}

/* ---- local OpenAI-compatible SSE stub ------------------------------- */
let stubServer = null;
let stubPort = 0;
const stubRequests = [];

function toolFence(obj) {
  return "```nb-tool\n" + JSON.stringify(obj) + "\n```";
}

function chunksOf(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function lastUserText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function startStubServer() {
  return new Promise((resolve, reject) => {
    stubServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw); } catch (_) {}
        stubRequests.push(body);
        const prompt = lastUserText(body);
        let reply = "ASSISTANT_PROSE_OK from the local stub.";
        if (prompt.includes("REJECT_PATCH")) {
          reply = "Proposed change.\n\n" + toolFence({
            tool: "patch",
            path: TARGET,
            edits: [{
              op: "find_replace",
              find: "NEW_TOKEN",
              replace_with: "SHOULD_NOT_APPEAR",
            }],
          }) + "\n";
        } else if (prompt.includes("APPLY_PATCH")) {
          reply = "Proposed change.\n\n" + toolFence({
            tool: "patch",
            path: TARGET,
            edits: [{
              op: "find_replace",
              find: "OLD_TOKEN",
              replace_with: "NEW_TOKEN",
            }],
          }) + "\n";
        } else if (prompt.includes("APPLY_IN_EDIT")) {
          reply = "Proposed change.\n\n" + toolFence({
            tool: "patch",
            path: TARGET,
            edits: [{
              op: "find_replace",
              find: "NEW_TOKEN",
              replace_with: "EDIT_TOKEN",
            }],
          }) + "\n";
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "Connection": "keep-alive",
        });
        for (const chunk of chunksOf(reply, 24)) {
          res.write("data: " + JSON.stringify(
            { choices: [{ delta: { content: chunk } }] }) + "\n\n");
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    stubServer.on("error", reject);
    stubServer.listen(0, "127.0.0.1", () => {
      stubPort = stubServer.address().port;
      resolve(stubPort);
    });
  });
}
function stopStubServer() {
  return new Promise((resolve) => {
    if (!stubServer) return resolve();
    const s = stubServer;
    stubServer = null;
    s.close(() => resolve());
    // Do not wait forever for a keep-alive socket.
    setTimeout(resolve, 1000);
  });
}

/* ---- Flask child ---------------------------------------------------- */
let server = null;
let serverLog = "";
process.on("exit", () => {
  if (server) { try { server.kill("SIGKILL"); } catch (_) {} }
});

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/auth");
      if (r.ok || r.status === 401) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start\n" + serverLog.slice(-2000));
}

async function startServer() {
  if (server) await stopServer();
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
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { await fetch(BASE + "/api/auth"); }
    catch (_) { return; }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/* ---- page helpers --------------------------------------------------- */
async function waitApp(page) {
  await page.waitForFunction(
    () => window.NB && NB.viewer && NB.tabs && NB.tabs.getActive,
    null, { timeout: 30000 });
}

async function openSourceEdit(page) {
  await page.click("#edit-toggle");
  await page.waitForFunction(
    () => window.CM6 && window.NB.cmEditor &&
      document.querySelector("#cm-host .cm-content") &&
      !document.getElementById("cm-host").hidden,
    null, { timeout: 30000 });
}

async function caretAtEnd(page) {
  await page.evaluate(() => {
    const v = window.NB.cmEditor.view();
    const end = v ? v.state.doc.length : 0;
    window.NB.cmEditor.setSelection(end, end);
    window.NB.cmEditor.focus();
  });
}

async function sendAi(page, text) {
  await page.fill("#ai-input", text);
  await page.press("#ai-input", "Enter");
}

async function main() {
  let browser = null;
  const pageErrors = [];

  let stubStarted = false;
  try {
    await startStubServer();
    stubStarted = true;

    fs.writeFileSync(path.join(CONFIG, "ai.json"), JSON.stringify({
      servers: [{
        name: "stubai",
        base_url: "http://127.0.0.1:" + stubPort,
        model: "stub-model",
      }],
      default: "stubai",
    }));
    // Phase A uses the OpenAI stub; no ACP profile is stored.
    clearAcpProfiles();

    await startServer();

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

    /* ================================================================
     * Phase A: source editor, VIM, AI prose, AI patch permission cards
     * ================================================================ */
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push("phase A: " + String(e)));

    let dialogAction = "dismiss";
    const dialogs = [];
    page.on("dialog", async (d) => {
      dialogs.push({ type: d.type(), message: d.message() });
      try {
        if (dialogAction === "accept") await d.accept();
        else await d.dismiss();
      } catch (_) {}
    });
    const editPosts = [];
    page.on("request", (req) => {
      try {
        if (req.method() === "POST" &&
            new URL(req.url()).pathname === "/api/edit") editPosts.push(req.url());
      } catch (_) {}
    });

    await page.goto(BASE + "/?file=" + encodeURIComponent(A),
      { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#viewer-content h1", { timeout: 20000 });
    await waitApp(page);

    section("source editor");
    await openSourceEdit(page);
    check("source editor: clicking #edit-toggle opens CodeMirror",
      await page.evaluate(() => {
        const el = document.querySelector("#cm-host .cm-content");
        return !!(el && el.isContentEditable);
      }));

    await page.click("#cm-host .cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nSOURCE_EDIT_OK", { delay: 10 });
    check("source editor: typed text lands in the CM buffer",
      await page.evaluate(() =>
        window.NB.cmEditor.getValue().includes("SOURCE_EDIT_OK")));

    await page.keyboard.press("Control+s");
    check("source editor: Ctrl+S writes the buffer to disk",
      waitForDisk(A, "SOURCE_EDIT_OK"), JSON.stringify(readNote(A)));

    // Undo / redo through the real CodeMirror history keymap.
    await page.keyboard.type("\nUNDO_TOKEN_X", { delay: 10 });
    check("source editor: second edit is in the buffer",
      await page.evaluate(() =>
        window.NB.cmEditor.getValue().includes("UNDO_TOKEN_X")));
    await page.keyboard.press("Control+z");
    await new Promise((r) => setTimeout(r, 150));
    check("source editor: Ctrl+Z removes the typed text",
      await page.evaluate(() =>
        !window.NB.cmEditor.getValue().includes("UNDO_TOKEN_X")));
    // Uppercase "Z": a real Shift+z produces event.key "Z". Lowercase "z"
    // with shiftKey set is not a faithful physical chord and CodeMirror
    // (correctly) reads it as plain Ctrl+z.
    await page.keyboard.press("Control+Shift+Z");
    await new Promise((r) => setTimeout(r, 150));
    check("source editor: Ctrl+Shift+Z restores the typed text",
      await page.evaluate(() =>
        window.NB.cmEditor.getValue().includes("UNDO_TOKEN_X")));
    await page.keyboard.press("Control+s");
    check("source editor: redo result saved to disk",
      waitForDisk(A, "UNDO_TOKEN_X"), JSON.stringify(readNote(A)));

    await page.click("#close-edit-btn");
    await page.waitForFunction(
      () => document.getElementById("cm-host").hidden, null, { timeout: 8000 });
    check("source editor: closing edit mode returns to the rendered preview",
      await page.evaluate(() => {
        const v = document.getElementById("viewer-content");
        return !document.getElementById("viewer").hidden &&
          !!(v && v.querySelector("h1") &&
             v.textContent.includes("SOURCE_EDIT_OK") &&
             v.textContent.includes("UNDO_TOKEN_X"));
      }));

    // Per-file cache. Open a second file so both are in the cache.
    await page.click('.tree-row[data-path="' + B + '"]');
    await page.waitForFunction(
      (p) => window.NB.tabs.getActive() === p, B, { timeout: 8000 });
    await page.click('.tab[data-path="' + A + '"]');
    await page.waitForFunction(
      (p) => window.NB.tabs.getActive() === p, A, { timeout: 8000 });

    await openSourceEdit(page);
    await caretAtEnd(page);
    await page.keyboard.type("\nUNSAVED_CACHE_OK", { delay: 10 });
    const beforeDialogs = dialogs.length;
    await page.click('.tab[data-path="' + B + '"]');
    await page.waitForFunction(
      (p) => window.NB.tabs.getActive() === p, B, { timeout: 8000 });
    check("per-file cache: a dirty tab switch leaves without prompting",
      dialogs.length === beforeDialogs,
      JSON.stringify(dialogs.slice(beforeDialogs)));
    check("per-file cache: the unsaved buffer is kept as a draft",
      await page.evaluate(() => !!window.NB.viewer.getDraft("a.md")));
    check("per-file cache: the source tab stays marked dirty",
      (await page.locator('.tab[data-path="' + A + '"].dirty').count()) === 1);

    await page.click('.tab[data-path="' + A + '"]');
    await page.waitForFunction(
      (p) => window.NB.tabs.getActive() === p, A, { timeout: 8000 });
    check("per-file cache: the Recover bar appears on return",
      await page.locator("#draft-bar").isVisible());
    await page.click("#draft-recover");
    await page.waitForFunction(
      () => !document.getElementById("cm-host").hidden, null, { timeout: 8000 });
    check("per-file cache: Recover restores the unsaved buffer",
      await page.evaluate(() =>
        window.NB.cmEditor.getValue().includes("UNSAVED_CACHE_OK") &&
        window.NB.viewer.isDirty("a.md")));

    // Discard the unsaved edit and leave edit mode for the VIM block.
    await page.evaluate(() => window.NB.viewer.forceCloseEdit());
    await page.waitForFunction(
      () => document.getElementById("cm-host").hidden, null, { timeout: 8000 });
    check("per-file cache: forced close discards the unsaved buffer cleanly",
      await page.evaluate(() => !window.NB.viewer.isDirty("a.md")));

    /* ---- VIM mode -------------------------------------------------- */
    section("vim mode");
    await page.click("#activity-settings-btn");
    await page.waitForFunction(
      () => !document.getElementById("settings-overlay").hidden,
      null, { timeout: 8000 });
    await page.check("#settings-vim-toggle");
    check("vim mode: Settings toggle enables the live vim mode",
      await page.evaluate(() => window.NB.app.getVimMode() === true));
    await page.click("#settings-close");
    await page.waitForFunction(
      () => document.getElementById("settings-overlay").hidden,
      null, { timeout: 8000 });

    await openSourceEdit(page);
    check("vim mode: the CodeMirror vim plugin is active",
      await page.evaluate(() => {
        const v = window.NB.cmEditor.view();
        const cm5 = window.CM6 && v ? window.CM6.getCM(v) : null;
        return !!(cm5 && cm5.state && cm5.state.vim);
      }));

    await page.evaluate(() => window.NB.cmEditor.focus());
    // normal mode: G -> last line, $ -> end of line, i -> insert.
    await page.keyboard.press("G");
    await page.keyboard.press("$");
    await page.keyboard.press("i");
    await page.keyboard.type(" VIM_INSERT_OK", { delay: 15 });
    await page.keyboard.press("Escape");
    check("vim mode: Escape returns to normal mode after insert",
      await page.evaluate(() => {
        const v = window.NB.cmEditor.view();
        const cm5 = window.CM6 && v ? window.CM6.getCM(v) : null;
        return !!(cm5 && cm5.state && cm5.state.vim && !cm5.state.vim.insertMode);
      }));
    await page.keyboard.type(":w", { delay: 20 });
    await page.keyboard.press("Enter");
    check("vim mode: :w writes the insert to disk",
      waitForDisk(A, "VIM_INSERT_OK"), JSON.stringify(readNote(A)));

    await page.click("#edit-toggle");
    await page.waitForFunction(
      () => document.getElementById("cm-host").hidden, null, { timeout: 8000 });

    /* ---- AI panel: prose through the real proxy -------------------- */
    section("ai panel");
    await page.click('.activity-btn[data-view="ai"]');
    await page.waitForSelector("#ai-input", { state: "visible", timeout: 10000 });
    await page.waitForFunction(() => {
      const sel = document.getElementById("ai-model-select");
      return !!(sel && sel.querySelector('option[value="stubai"]'));
    }, null, { timeout: 10000 });
    check("ai panel: the configured provider is the active picker entry",
      await page.evaluate(() => {
        const sel = document.getElementById("ai-model-select");
        return sel.value === "stubai";
      }));

    /* ---- chat manager: Delete all chats ---------------------------- *
     * A fresh context has an empty chat store, so the open note has no
     * chats: the footer control is hidden. Two footer New chats give it a
     * count, Cancel keeps them, and Delete all empties the store. */
    section("ai chat manager · delete all");
    const deleteAllState = () => page.evaluate(() => {
      const raw = localStorage.getItem("nb:aiChats");
      let store = null;
      try { store = raw ? JSON.parse(raw) : null; } catch (_) { store = null; }
      const btn = document.querySelector('[data-test-chat-delete-all]');
      const empty = document.querySelector(".ai-cm-list .ai-empty-title");
      return {
        chats: store && Array.isArray(store.chats) ? store.chats.length : 0,
        stored: raw !== null,
        hidden: btn ? btn.hidden : null,
        label: btn ? btn.getAttribute("aria-label") : null,
        buttonText: btn ? btn.textContent.trim() : null,
        storage: document.querySelector("[data-test-chat-storage]").textContent,
        emptyTitle: empty ? empty.textContent : null,
        status: document.querySelector(".ai-cm-status").textContent,
        activeId: document.activeElement ? document.activeElement.id : "",
        activeText: document.activeElement
          ? document.activeElement.textContent.trim() : "",
      };
    });

    await page.click('[data-test-chat-manage]');
    await page.waitForSelector('[data-test-chat-manager]', { state: "visible" });
    let cmState = await deleteAllState();
    check("delete all: hidden when the open note has no chats",
      cmState.hidden === true, JSON.stringify(cmState));
    check("delete all: the footer reports the empty store",
      cmState.storage === "0 chats · 0 B of 4 MB", cmState.storage);

    await page.click('[data-test-chat-new-manager]');
    await page.click('[data-test-chat-manage]');
    await page.waitForSelector('[data-test-chat-manager]', { state: "visible" });
    cmState = await deleteAllState();
    check("delete all: one chat names the control in the singular",
      cmState.hidden === false && cmState.label ===
        "Delete all 1 chat for this note" &&
        cmState.buttonText === "Delete all chats",
      JSON.stringify(cmState));

    await page.click('[data-test-chat-new-manager]');
    await page.click('[data-test-chat-manage]');
    await page.waitForSelector('[data-test-chat-manager]', { state: "visible" });
    cmState = await deleteAllState();
    check("delete all: two chats name the control with the count",
      cmState.chats === 2 && cmState.label ===
        "Delete all 2 chats for this note",
      JSON.stringify(cmState));

    /* A query narrows the rows, never the scope: the confirm says so and
     * Esc walks away from it. */
    await page.fill('[data-test-chat-search]', "no-such-chat");
    await page.click('[data-test-chat-delete-all]');
    await page.waitForSelector('[data-test-chat-delete-all-confirm]',
      { state: "visible" });
    check("delete all: a search does not narrow the scope, and says so",
      await page.evaluate(() => {
        const box = document.querySelector('[data-test-chat-delete-all-confirm]');
        return document.querySelectorAll(".ai-chat-row").length === 0 &&
          box.querySelector(".ai-chat-confirm-text").textContent ===
            "Delete all 2 chats for this note? This cannot be undone. " +
            "This includes chats hidden by the search.";
      }));
    await page.press('[data-test-chat-delete-all-confirm] .ai-cm-btn', "Escape");
    cmState = await deleteAllState();
    check("delete all: Esc cancels the confirm and keeps the chats",
      cmState.chats === 2 && cmState.stored &&
        !(await page.evaluate(() =>
          !!document.querySelector('[data-test-chat-delete-all-confirm]'))));
    check("delete all: Esc returns focus to the button",
      await page.evaluate(() => document.activeElement ===
        document.querySelector('[data-test-chat-delete-all]')));
    await page.fill('[data-test-chat-search]', "");

    await page.click('[data-test-chat-delete-all]');
    await page.waitForSelector('[data-test-chat-delete-all-confirm]',
      { state: "visible" });
    check("delete all: the confirm states the scope and its cost",
      await page.evaluate(() => {
        const box = document.querySelector('[data-test-chat-delete-all-confirm]');
        return box.getAttribute("role") === "group" &&
          box.getAttribute("aria-label") === "Confirm delete all chats" &&
          box.querySelector(".ai-chat-confirm-text").textContent ===
            "Delete all 2 chats for this note? This cannot be undone.";
      }));
    cmState = await deleteAllState();
    check("delete all: the confirm focuses Cancel",
      cmState.activeText === "Cancel", JSON.stringify(cmState));

    /* The confirm's clause tracks the query while the box stays open. */
    await page.fill('[data-test-chat-search]', "Second");
    check("delete all: the search clause appears while the confirm is open",
      await page.evaluate(() => document.querySelector(
        '[data-test-chat-delete-all-confirm] .ai-chat-confirm-text')
        .textContent ===
          "Delete all 2 chats for this note? This cannot be undone. " +
          "This includes chats hidden by the search."));
    await page.fill('[data-test-chat-search]', "");
    check("delete all: the clause leaves with the cleared query",
      await page.evaluate(() => document.querySelector(
        '[data-test-chat-delete-all-confirm] .ai-chat-confirm-text')
        .textContent ===
          "Delete all 2 chats for this note? This cannot be undone."));

    await page.click('[data-test-chat-delete-all-confirm] .ai-cm-btn:not(.danger)');
    cmState = await deleteAllState();
    check("delete all: Cancel keeps both chats",
      cmState.chats === 2 && cmState.stored, JSON.stringify(cmState));
    check("delete all: Cancel returns focus to the button",
      await page.evaluate(() => document.activeElement ===
        document.querySelector('[data-test-chat-delete-all]')));

    await page.click('[data-test-chat-delete-all]');
    await page.waitForSelector('[data-test-chat-delete-all-confirm]',
      { state: "visible" });
    await page.click('[data-test-chat-delete-all-confirm] .ai-cm-btn.danger');
    await page.waitForFunction(() => !localStorage.getItem("nb:aiChats"),
      null, { timeout: 10000 });
    cmState = await deleteAllState();
    check("delete all: confirming empties the store",
      cmState.chats === 0 && !cmState.stored, JSON.stringify(cmState));
    check("delete all: the manager falls back to its empty state",
      cmState.emptyTitle === "No chats yet.", cmState.emptyTitle);
    check("delete all: the storage line reads zero",
      cmState.storage === "0 chats · 0 B of 4 MB", cmState.storage);
    check("delete all: the live region announces the delete",
      cmState.status === "Deleted all 2 chats for this note.", cmState.status);
    check("delete all: focus moves to the search field",
      cmState.activeId === "ai-cm-search", cmState.activeId);
    check("delete all: the control hides again with no chats",
      cmState.hidden === true, String(cmState.hidden));

    await page.click('[data-test-chat-close]');
    await page.waitForSelector('[data-test-chat-bar]', { state: "visible" });

    /* ---- scope and the active chat, from a seeded store ------------- *
     * Two chats for a.md (one active), one for b.md and one Unfiled. The
     * seed goes through the real loader, so this is the shipped restore
     * path; the footer control must only take a.md's two. */
    await page.evaluate(() => {
      const now = Date.now();
      const rec = (id, file, title, ago) => ({
        id, file, title, custom: true,
        createdAt: now - ago, updatedAt: now - ago,
        conversation: [], toolFlags: [], lastPrompt: "",
      });
      localStorage.setItem("nb:aiChats", JSON.stringify({
        v: 1,
        activeId: "a2",
        chats: [
          rec("a2", "a.md", "Second A chat", 1000),
          rec("a3", "a.md", "Third A chat", 1500),
          rec("a1", "a.md", "First A chat", 2000),
          rec("b2", "b.md", "B chat newer", 3000),
          rec("b1", "b.md", "B chat", 4000),
          rec("u1", "", "Unfiled chat", 5000),
        ],
      }));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitApp(page);
    if (!(await page.isVisible("#ai-input"))) {
      await page.click('.activity-btn[data-view="ai"]');
    }
    await page.waitForSelector("#ai-input", { state: "visible", timeout: 10000 });
    await page.waitForFunction(() => {
      const sel = document.getElementById("ai-model-select");
      return !!(sel && sel.querySelector('option[value="stubai"]'));
    }, null, { timeout: 10000 });
    check("delete all: the seeded store restores the active chat",
      await page.evaluate(() =>
        document.querySelector(".ai-chat-pick").value === "a2"));

    await page.click('[data-test-chat-manage]');
    await page.waitForSelector('[data-test-chat-manager]', { state: "visible" });
    cmState = await deleteAllState();
    check("delete all: the label counts the open note, not the store",
      cmState.chats === 6 && cmState.label ===
        "Delete all 3 chats for this note", JSON.stringify(cmState));

    /* The question names one note: another note opening drops it. */
    await page.click('[data-test-chat-delete-all]');
    await page.waitForSelector('[data-test-chat-delete-all-confirm]',
      { state: "visible" });
    await page.evaluate(() => window.NB.tabs.open("b.md"));
    await page.waitForFunction(
      () => window.NB.viewer.getPath() === "b.md", null, { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector(
      "[data-test-chat-delete-all-confirm]"), null, { timeout: 10000 });
    check("delete all: another note opening drops the open confirm",
      await page.evaluate(() => document.querySelector(
        "[data-test-chat-delete-all]").getAttribute("aria-label") ===
        "Delete all 2 chats for this note"));
    await page.evaluate(() => window.NB.tabs.open("a.md"));
    await page.waitForFunction(
      () => window.NB.viewer.getPath() === "a.md", null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(
      "[data-test-chat-delete-all]").getAttribute("aria-label") ===
      "Delete all 3 chats for this note", null, { timeout: 10000 });

    /* ---- switching chats opens the chat's note --------------------- *
     * Both the picker and a manager row cross files now: the note's tab
     * opens first, and the pressed chat stays the active one. */
    await page.waitForFunction(() =>
      document.querySelector(".ai-chat-pick").value === "a2",
      null, { timeout: 10000 });
    await page.click(
      '[data-test-chat-row][data-chat-id="b1"] [data-test-chat-open]');
    await page.waitForFunction(() => window.NB.tabs.getActive() === "b.md",
      null, { timeout: 10000 });
    check("switch: a row for another note opens that note's tab",
      await page.evaluate(() => window.NB.tabs.getOpen().includes("b.md")));
    check("switch: the pressed chat wins over the note's newest",
      await page.evaluate(() =>
        document.querySelector(".ai-chat-pick").value === "b1"));
    check("switch: the manager closes on the row press",
      await page.evaluate(() =>
        document.getElementById("ai-chat-manager").hidden === true));

    await page.evaluate(() => window.NB.tabs.open("a.md"));
    await page.waitForFunction(() => window.NB.tabs.getActive() === "a.md",
      null, { timeout: 10000 });
    await page.waitForFunction(() =>
      document.querySelector(".ai-chat-pick").value === "a2",
      null, { timeout: 10000 });

    await page.evaluate(() => {
      const sel = document.querySelector(".ai-chat-pick");
      sel.value = "b1";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => window.NB.tabs.getActive() === "b.md",
      null, { timeout: 10000 });
    check("switch: the select opens the note of the picked chat",
      await page.evaluate(() => window.NB.tabs.getOpen().includes("b.md")));
    check("switch: the picked chat becomes active",
      await page.evaluate(() =>
        document.querySelector(".ai-chat-pick").value === "b1"));

    await page.evaluate(() => {
      const sel = document.querySelector(".ai-chat-pick");
      sel.value = "u1";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      document.querySelector(".ai-chat-pick").value === "u1",
      null, { timeout: 10000 });
    check("switch: an Unfiled chat leaves the active tab alone",
      await page.evaluate(() => window.NB.tabs.getActive() === "b.md"));

    /* A refused open (the session cap) changes nothing. */
    await page.evaluate(() => {
      window.__aiTabsOpen = window.NB.tabs.open;
      window.NB.tabs.open = () => false;
    });
    try {
      await page.evaluate(() => {
        const sel = document.querySelector(".ai-chat-pick");
        sel.value = "a2";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(200);
      check("switch: a refused open keeps the active tab",
        await page.evaluate(() => window.NB.tabs.getActive() === "b.md"));
      check("switch: a refused open puts the picker back",
        await page.evaluate(() =>
          document.querySelector(".ai-chat-pick").value === "u1"));

      await page.click('[data-test-chat-manage]');
      await page.waitForSelector('[data-test-chat-manager]',
        { state: "visible" });
      await page.click(
        '[data-test-chat-row][data-chat-id="a2"] [data-test-chat-open]');
      await page.waitForTimeout(200);
      check("switch: a refused row press keeps the active chat",
        await page.evaluate(() => {
          const cur = document.querySelector(
            '.ai-chat-row[aria-current="true"]');
          return !!cur && cur.dataset.chatId === "u1" &&
            window.NB.tabs.getActive() === "b.md";
        }));
      check("switch: a refused row press keeps the manager open",
        await page.evaluate(() =>
          document.getElementById("ai-chat-manager").hidden === false));
    } finally {
      await page.evaluate(() => {
        window.NB.tabs.open = window.__aiTabsOpen;
        delete window.__aiTabsOpen;
      });
    }

    /* Back to the state the delete-all checks expect: a.md open, a2 active. */
    await page.click('[data-test-chat-close]');
    await page.evaluate(() => window.NB.tabs.open("a.md"));
    await page.waitForFunction(() => window.NB.tabs.getActive() === "a.md",
      null, { timeout: 10000 });
    await page.waitForFunction(() =>
      document.querySelector(".ai-chat-pick").value === "a2",
      null, { timeout: 10000 });
    await page.click('[data-test-chat-manage]');
    await page.waitForSelector('[data-test-chat-manager]', { state: "visible" });

    /* A row confirm and the footer confirm exclude each other. */
    await page.click(
      '[data-test-chat-row][data-chat-id="a2"] [data-test-chat-delete]');
    check("delete all: the row confirm opens first",
      await page.evaluate(() =>
        !!document.querySelector("[data-test-chat-confirm]")));
    await page.click('[data-test-chat-delete-all]');
    check("delete all: the footer confirm replaces the row confirm",
      await page.evaluate(() => {
        const row = document.querySelectorAll("[data-test-chat-confirm]");
        const all = document.querySelectorAll(
          "[data-test-chat-confirm], [data-test-chat-delete-all-confirm]");
        return row.length === 0 && all.length === 1 &&
          !!document.querySelector('[data-test-chat-delete-all-confirm]');
      }));
    await page.press('[data-test-chat-delete-all-confirm] .ai-cm-btn', "Escape");
    check("delete all: one Escape cancels the footer confirm",
      await page.evaluate(() => !document.querySelector(
        "[data-test-chat-confirm]") &&
        document.getElementById("ai-chat-manager").hidden === false));
    await page.press('[data-test-chat-delete-all]', "Escape");
    check("delete all: the next Escape still closes the manager",
      await page.evaluate(() =>
        document.getElementById("ai-chat-manager").hidden === true));

    await page.click('[data-test-chat-manage]');
    await page.waitForSelector('[data-test-chat-manager]', { state: "visible" });
    await page.click('[data-test-chat-delete-all]');
    await page.waitForSelector('[data-test-chat-delete-all-confirm]',
      { state: "visible" });
    await page.click('[data-test-chat-delete-all-confirm] .ai-cm-btn.danger');
    await page.waitForFunction(() => {
      const raw = localStorage.getItem("nb:aiChats");
      if (!raw) return false;
      return (JSON.parse(raw).chats || []).length === 3;
    }, null, { timeout: 10000 });
    check("delete all: chats for other files and Unfiled survive",
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("nb:aiChats"));
        const files = s.chats.map((c) => c.file).sort();
        return files.length === 3 && files[0] === "" &&
          files[1] === "b.md" && files[2] === "b.md" &&
          !s.chats.some((c) => c.file === "a.md");
      }));
    cmState = await deleteAllState();
    check("delete all: the live region announces the open note's count",
      cmState.status === "Deleted all 3 chats for this note.", cmState.status);
    check("delete all: the surviving groups keep the manager list non-empty",
      await page.evaluate(() => {
        const list = document.querySelector(".ai-cm-list");
        return !!list && !list.querySelector(".ai-empty") &&
          list.textContent.includes("B chat");
      }));
    check("delete all: the footer control hides now the note has no chats",
      cmState.hidden === true, String(cmState.hidden));

    await page.click('[data-test-chat-close]');
    await page.waitForSelector('[data-test-chat-bar]', { state: "visible" });
    check("delete all: the bar falls back to No chat yet",
      await page.evaluate(() => {
        const sel = document.querySelector(".ai-chat-pick");
        return !sel.disabled && sel.options.length === 1 &&
          sel.options[0].textContent === "No chat yet";
      }));
    check("delete all: the log shows its no-chat state",
      await page.evaluate(() => {
        const t = document.querySelector("#ai-chat-log .ai-empty-title");
        return !!t && t.textContent === "No chat for this file.";
      }));

    /* No file open: no scope, so the control is not offered. */
    await page.evaluate(() =>
      window.NB.tabs.getOpen().slice().forEach((p) =>
        window.NB.tabs.close(p, { force: true })));
    await page.waitForFunction(() => !window.NB.viewer.getPath(),
      null, { timeout: 10000 });
    await page.click('[data-test-chat-manage]');
    await page.waitForSelector('[data-test-chat-manager]', { state: "visible" });
    check("delete all: hidden with no file open",
      (await deleteAllState()).hidden === true);
    await page.click('[data-test-chat-close]');
    await page.waitForSelector('[data-test-chat-bar]', { state: "visible" });
    await page.evaluate(() => window.NB.tabs.open("a.md"));
    await page.waitForFunction(() => window.NB.viewer.getPath() === "a.md",
      null, { timeout: 10000 });
    await page.waitForSelector('[data-test-chat-manage]', { state: "visible" });

    const stubBefore = stubRequests.length;
    await sendAi(page, "hello assistant");
    await page.waitForFunction(() => {
      const bubbles = Array.from(
        document.querySelectorAll(".ai-msg-assistant .ai-prose-span"));
      return bubbles.some((b) => b.textContent.includes("ASSISTANT_PROSE_OK"));
    }, null, { timeout: 20000 });
    check("ai panel: streamed assistant prose renders in the panel",
      await page.evaluate(() => {
        const bubbles = Array.from(
          document.querySelectorAll(".ai-msg-assistant .ai-prose-span"));
        return bubbles.some((b) => b.textContent.includes("ASSISTANT_PROSE_OK"));
      }));
    check("ai panel: the real Flask proxy relayed the request to the stub",
      stubRequests.length > stubBefore);
    check("ai panel: the proxy sent the configured model upstream",
      stubRequests.length > 0 && stubRequests[stubRequests.length - 1].model === "stub-model",
      JSON.stringify(stubRequests[stubRequests.length - 1] || null));

    /* ---- AI tool loop: apply --------------------------------------- */
    const editsBeforeApply = editPosts.length;
    await sendAi(page, "APPLY_PATCH please");
    await page.waitForFunction(
      () => document.querySelectorAll('.ai-edit-card[data-test-patch-card]').length >= 1,
      null, { timeout: 20000 });
    const cardIndex = await page.evaluate(
      () => document.querySelectorAll('.ai-edit-card[data-test-patch-card]').length - 1);
    check("ai tool loop: a patch permission card appears",
      cardIndex >= 0);
    check("ai tool loop: nothing is written before Apply",
      readNote(TARGET) === TARGET_SRC, JSON.stringify(readNote(TARGET)));

    await page.evaluate((idx) => {
      const cards = document.querySelectorAll('.ai-edit-card[data-test-patch-card]');
      cards[idx].querySelector(".ai-apply").click();
    }, cardIndex);
    await page.waitForFunction((idx) => {
      const cards = document.querySelectorAll('.ai-edit-card[data-test-patch-card]');
      return !!(cards[idx] && cards[idx].querySelector(".ai-card-status.applied"));
    }, cardIndex, { timeout: 20000 });
    check("ai tool loop: Apply changes the file on disk",
      waitForDisk(TARGET, "NEW_TOKEN") && !readNote(TARGET).includes("OLD_TOKEN"),
      JSON.stringify(readNote(TARGET)));
    check("ai tool loop: Apply called /api/edit exactly once",
      editPosts.length === editsBeforeApply + 1,
      "posts=" + (editPosts.length - editsBeforeApply));

    /* ---- AI tool loop: reject -------------------------------------- */
    await sendAi(page, "REJECT_PATCH please");
    await page.waitForFunction(
      () => document.querySelectorAll('.ai-edit-card[data-test-patch-card]').length >= 2,
      null, { timeout: 20000 });
    const rejectIndex = await page.evaluate(
      () => document.querySelectorAll('.ai-edit-card[data-test-patch-card]').length - 1);
    const diskBeforeReject = readNote(TARGET);
    await page.evaluate((idx) => {
      const cards = document.querySelectorAll('.ai-edit-card[data-test-patch-card]');
      cards[idx].querySelector(".ai-reject").click();
    }, rejectIndex);
    await page.waitForFunction((idx) => {
      const cards = document.querySelectorAll('.ai-edit-card[data-test-patch-card]');
      return !!(cards[idx] && cards[idx].querySelector(".ai-card-status.rejected"));
    }, rejectIndex, { timeout: 8000 });
    check("ai tool loop: Reject writes nothing to disk",
      readNote(TARGET) === diskBeforeReject &&
        !readNote(TARGET).includes("SHOULD_NOT_APPEAR"),
      JSON.stringify(readNote(TARGET)));
    check("ai tool loop: Reject never called /api/edit",
      editPosts.length === editsBeforeApply + 1,
      "posts=" + (editPosts.length - editsBeforeApply));

    /* ---- AI tool loop: apply while the source editor is open --------
     * The edit bar belongs to the open edit session. An applied patch
     * refresh must load the bytes into CM6 instead of going through the
     * view-mode path that hides the bar. The jsdom suite also covers the
     * watcher-race variant, where file:external-change lands before
     * ai:applied. */
    section("ai apply in edit mode");
    // The earlier VIM block left vim on; vim hides the source edit bar by
    // design. Turn it off so this phase observes the bar itself.
    await page.evaluate(() => window.NB.app.setVimMode(false));
    await page.evaluate((p) => window.NB.tabs.open(p), TARGET);
    await page.waitForFunction(
      (p) => window.NB.viewer.getPath() === p, TARGET, { timeout: 10000 });
    await openSourceEdit(page);
    check("ai apply in edit mode: edit bar visible before Apply",
      await page.evaluate(() => !document.getElementById("edit-bar").hidden));
    const editCardsBefore = await page.evaluate(() =>
      document.querySelectorAll('.ai-edit-card[data-test-patch-card]').length);
    await sendAi(page, "APPLY_IN_EDIT please");
    await page.waitForFunction(
      (n) => document.querySelectorAll('.ai-edit-card[data-test-patch-card]').length > n,
      editCardsBefore, { timeout: 20000 });
    const editCardIndex = await page.evaluate(() =>
      document.querySelectorAll('.ai-edit-card[data-test-patch-card]').length - 1);
    await page.evaluate((idx) => {
      const cards = document.querySelectorAll('.ai-edit-card[data-test-patch-card]');
      cards[idx].querySelector(".ai-apply").click();
    }, editCardIndex);
    await page.waitForFunction((idx) => {
      const cards = document.querySelectorAll('.ai-edit-card[data-test-patch-card]');
      return !!(cards[idx] && cards[idx].querySelector(".ai-card-status.applied"));
    }, editCardIndex, { timeout: 20000 });
    await page.waitForTimeout(300);
    const editApplyState = await page.evaluate(() => ({
      barHidden: document.getElementById("edit-bar").hidden,
      cmHidden: document.getElementById("cm-host").hidden,
      editing: document.getElementById("edit-toggle").classList.contains("editing"),
      buffer: window.NB.cmEditor.getValue(),
    }));
    check("ai apply in edit mode: edit bar stays visible", !editApplyState.barHidden);
    check("ai apply in edit mode: editor stays open", !editApplyState.cmHidden);
    check("ai apply in edit mode: edit button still .editing", editApplyState.editing);
    check("ai apply in edit mode: patched bytes land in the CM buffer",
      /EDIT_TOKEN/.test(editApplyState.buffer), editApplyState.buffer);

    check("no uncaught page errors in the source-editor / AI phase",
      pageErrors.length === 0, pageErrors.join(" | "));

    try { await ctx.close(); } catch (_) {}

    /* ================================================================
     * Phase B: ACP provider
     * ================================================================ */
    await stopServer();
    // ACP-only boot: no ai.json server list, one hand-written profile. Its
    // "command"/"args" make it server-local (editable:false), which the
    // settings editor shows but never posts back.
    writeAiConfig((cfg) => {
      cfg.servers = [];
      cfg.default = "acpstub";
      cfg.acp = [{
        name: "acpstub",
        command: PY,
        args: [ACP_STUB, "--mode", "trace"],
        cwd: DATA,
        default: true,
        timeout: 30,
      }];
    });
    await startServer();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    page2.on("pageerror", (e) => pageErrors.push("phase B: " + String(e)));

    await page2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await waitApp(page2);

    section("acp provider");
    // The persisted activeView from phase A can boot the panel already
    // open; the activity button is a toggle, so only click it when hidden.
    if (!(await page2.isVisible("#ai-input"))) {
      await page2.click('.activity-btn[data-view="ai"]');
    }
    await page2.waitForSelector("#ai-input", { state: "visible", timeout: 10000 });
    await page2.waitForFunction(() => {
      const sel = document.getElementById("ai-model-select");
      return !!(sel && sel.querySelector('option[value="acpstub"]'));
    }, null, { timeout: 10000 });
    check("acp: the provider picker offers the ACP profile",
      await page2.evaluate(() => {
        const opt = document.querySelector(
          '#ai-model-select option[value="acpstub"]');
        return !!opt && opt.textContent.includes("ACP");
      }));
    check("acp: default:true selects the ACP profile at boot",
      await page2.evaluate(() =>
        document.getElementById("ai-model-select").value === "acpstub"));

    await sendAi(page2, "hello acp");
    await page2.waitForFunction(() => {
      const bubbles = Array.from(
        document.querySelectorAll(".ai-msg-assistant .ai-prose-span"));
      return bubbles.some((b) => b.textContent.includes("Hello world"));
    }, null, { timeout: 30000 });
    check("acp: the stub agent's streamed prose renders",
      await page2.evaluate(() => {
        const bubbles = Array.from(
          document.querySelectorAll(".ai-msg-assistant .ai-prose-span"));
        return bubbles.some((b) => b.textContent.includes("Hello world"));
      }));
    await page2.waitForFunction(
      () => !!document.querySelector(".ai-tool-trace"),
      null, { timeout: 30000 });
    check("acp: a tool-call trace line appears",
      await page2.evaluate(() => {
        const el = document.querySelector(".ai-tool-trace");
        return !!(el && el.textContent.includes("Running a shell command"));
      }));
    check("acp: no in-band error surfaced",
      await page2.evaluate(() => !document.querySelector(".ai-error")));

    check("no uncaught page errors in the ACP phase",
      pageErrors.length === 0, pageErrors.join(" | "));

    try { await ctx2.close(); } catch (_) {}
  } catch (err) {
    failed++;
    console.error("\nFATAL: " + (err && err.stack || err));
    if (serverLog) console.error("server log tail:\n" + serverLog.slice(-4000));
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
    await stopServer();
    if (stubStarted) await stopStubServer();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  if (pageErrors.length) {
    console.log("\n  page errors (" + pageErrors.length + "):");
    pageErrors.forEach((e) => console.log("    - " + e.split("\n")[0]));
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
