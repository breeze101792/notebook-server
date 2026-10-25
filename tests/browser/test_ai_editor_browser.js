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
    // Phase A uses the OpenAI stub; ACP is absent.
    try { fs.unlinkSync(path.join(CONFIG, "acp.json")); } catch (_) {}

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
    // ACP-only boot: no ai.json server list, no agent key (command form).
    try { fs.unlinkSync(path.join(CONFIG, "ai.json")); } catch (_) {}
    fs.writeFileSync(path.join(CONFIG, "acp.json"), JSON.stringify({
      name: "acpstub",
      command: PY,
      args: [ACP_STUB, "--mode", "trace"],
      cwd: DATA,
      default: true,
      timeout: 30,
    }));
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
