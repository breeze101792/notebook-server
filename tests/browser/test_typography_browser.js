/* Real-browser typography audit -- layer 2 of docs/architecture/typography.md §5.
 *
 * Boots the real Flask app against a fresh temp notebook/config, then walks the
 * visible chrome text in every state of docs/testing/typography.md §3.1 at S, M,
 * L and XL. Every computed `font-size` must land on one of the seven --text-*
 * steps at the live root (0.3 px tolerance, §3.2); a size off the scale fails
 * with the surface, the state, the setting, the selector, the px, the nearest
 * step and the delta.
 *
 * Assertions (docs/testing/typography.md §3.3):
 *   A1  zero unmatched sizes across the matrix
 *   A2  the row-name group measures one px in every panel (the original bug)
 *   A3  every .panel-title measures one px, and it is --text-xs
 *   A4  every panel header and the tab bar are equal in height at every setting
 *   A5  each step equals root × its rem value at S/M/L/XL; --text-2xs stays 9 px
 *   A6  at M: .tab is --text-ui-lg; Settings section controls are --text-ui
 *       (nav items are the navigation role, asserted as --text-ui-lg)
 * Plus the font-size tile specimen, which is deliberately absolute: its four
 * Aa values stay 12.6 / 14 / 16.1 / 18.2 px at every setting (§8 of
 * docs/ui/typography.md), and it is excluded from A1 for that reason.
 *
 * Skipped by construction (typography.md §3.2): .sr-only, #viewer-content and
 * .ai-prose-span prose, rendered SVG text, glyph-only elements (no letter and
 * no digit in their text), and phone-width rules (the viewport stays 1280).
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium node tests/browser/test_typography_browser.js
 * Env:  PORT (default 5097), CHROMIUM_PATH.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const PORT = Number(process.env.PORT || 5097);
const BASE = "http://127.0.0.1:" + PORT;
const { findChromium } = require("./chromium");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || findChromium();
const VIEW = { width: 1280, height: 800 };

/* The seven steps (docs/ui/typography.md §1-2). `rem: 0` marks the fixed 9 px
 * badge step, which must not scale. */
const STEPS = [
  { token: "--text-2xs", rem: 0 },
  { token: "--text-xs", rem: 0.72 },
  { token: "--text-sm", rem: 0.8 },
  { token: "--text-ui", rem: 0.86 },
  { token: "--text-ui-lg", rem: 0.93 },
  { token: "--text-body", rem: 1 },
  { token: "--text-lg", rem: 1.15 },
];
const TOLERANCE = 0.3;
const SIZE_TILE = [
  { sel: ".fs-s .fs-tile-aa", px: 12.6 },
  { sel: ".fs-m .fs-tile-aa", px: 14 },
  { sel: ".fs-l .fs-tile-aa", px: 16.1 },
  { sel: ".fs-xl .fs-tile-aa", px: 18.2 },
];
const SETTINGS_TABS = ["general", "workspaces", "appearance", "shortcuts", "security", "ai", "about"];
const ROW_SELECTORS = [".tree-name", ".session-name", ".bookmark-name", ".recent-name", ".search-panel-hit-file", ".ai-prose-span"];

/* ---- fixtures ------------------------------------------------------ */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-typography-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });

const NOTES = {
  "Welcome.md": [
    "# Welcome",
    "",
    "Root note body.",
    "",
    "## A section",
    "",
    "Text under the section heading.",
    "",
    "### A subsection",
    "",
    "More text for the outline.",
    "",
  ].join("\n"),
  "notes/a.md": "# Note A\n\nAn alpha needle line in a subfolder.\n",
  "notes/b.md": "# Note B\n\nA beta needle line for search results.\n",
  "notes/deep/c.md": "# Note C\n\nGamma text.\n",
};
for (const [rel, body] of Object.entries(NOTES)) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

/* Seed the workspace state the matrix needs: two sessions, three bookmarks,
 * three recents and one pinned folder. These are the same config keys the core
 * suite writes through the UI (config.json -> workspaceState.<id>). */
fs.writeFileSync(path.join(CONFIG, "config.json"), JSON.stringify({
  fontSize: "medium",
  theme: "dark",
  workspaceState: {
    default: {
      openFiles: ["Welcome.md", "notes/a.md"],
      activeFile: "Welcome.md",
      pinnedFiles: [],
      sessions: [
        { id: "sess-one", name: "Session one", openFiles: ["Welcome.md"], activeFile: "Welcome.md" },
        { id: "sess-two", name: "Session two", openFiles: ["notes/a.md"], activeFile: "notes/a.md" },
      ],
      activeSessionId: "sess-one",
      bookmarks: ["notes/a.md", "notes/b.md", "Welcome.md"],
      recentFiles: ["notes/a.md", "notes/b.md", "Welcome.md"],
      pinnedFolders: ["notes"],
    },
  },
}, null, 2));

/* ---- local OpenAI-compatible SSE stub (no provider, no network) ----- */

let stub = null;
let stubPort = 0;

function startStub() {
  return new Promise((resolve, reject) => {
    stub = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw); } catch (_) { body = {}; }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        let prompt = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m && m.role === "user" && typeof m.content === "string") { prompt = m.content; break; }
        }
        if (prompt.includes("TRIGGER_ERROR")) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "stub failure" }));
          return;
        }
        const reply = "Assistant reply.\n\n```js\nconst stub = 1;\n```\n";
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "Connection": "keep-alive",
        });
        for (let i = 0; i < reply.length; i += 24) {
          res.write("data: " + JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 24) } }] }) + "\n\n");
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    stub.on("error", reject);
    stub.listen(0, "127.0.0.1", () => {
      stubPort = stub.address().port;
      resolve(stubPort);
    });
  });
}

function stopStub() {
  return new Promise((resolve) => {
    if (!stub) return resolve();
    const s = stub;
    stub = null;
    s.close(() => resolve());
    setTimeout(resolve, 1000);
  });
}

/* ---- harness ------------------------------------------------------- */

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("  ok   " + name);
  } else {
    failed++;
    console.log("  FAIL " + name + (detail ? "\n         " + String(detail).split("\n").join("\n         ") : ""));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, timeout, interval) {
  const deadline = Date.now() + (timeout || 5000);
  while (Date.now() < deadline) {
    try { if (await pred()) return true; } catch (_) { /* not ready */ }
    await sleep(interval || 80);
  }
  return false;
}

async function serverAnswers() {
  try {
    const r = await fetch(BASE + "/api/auth");
    return r.ok || r.status === 401;
  } catch (_) {
    return false;
  }
}

async function waitForServer(child) {
  let exited = false;
  child.once("exit", () => { exited = true; });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (exited) throw new Error("app.py exited before it served");
    if (await serverAnswers()) return;
    await sleep(250);
  }
  throw new Error("server did not start");
}

/* Two animation frames: layout and the computed-style flush are done, and
 * app.js has re-run applyFontSize. */
const nextFrame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

/* ---- the walk ------------------------------------------------------ */

/* Runs in the page. Returns the violations plus the role measurements the
 * assertions need. Pure measurement: it reads computed styles and writes
 * nothing to the document. */
const ROW_SELECTOR_LIST = ROW_SELECTORS;

async function walk(page, scope) {
  return page.evaluate(({ scope, tolerance, rowSelectors }) => {
    const STEPS = [
      { token: "--text-2xs", rem: 0 },
      { token: "--text-xs", rem: 0.72 },
      { token: "--text-sm", rem: 0.8 },
      { token: "--text-ui", rem: 0.86 },
      { token: "--text-ui-lg", rem: 0.93 },
      { token: "--text-body", rem: 1 },
      { token: "--text-lg", rem: 1.15 },
    ];
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const steps = STEPS.map((s) => ({ token: s.token, px: s.rem ? s.rem * root : 9 }));
    const rootEl = scope ? document.querySelector(scope) : document.body;
    const out = {
      root,
      count: 0,
      violations: [],
      titles: [],
      rows: [],
      headers: [],
      missing: !rootEl,
    };
    if (!rootEl) return out;

    const visible = (el) => {
      try { return el.checkVisibility({ checkVisibilityCSS: true }); }
      catch (_) { return el.getClientRects().length > 0; }
    };
    const chain = (el) => {
      const parts = [];
      let node = el;
      for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++, node = node.parentElement) {
        let tag = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift(tag + "#" + node.id);
          break;
        }
        const cls = (typeof node.className === "string" ? node.className : "")
          .trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) tag += "." + cls.join(".");
        parts.unshift(tag);
      }
      return parts.join(" > ");
    };

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el) continue;
      if (el.closest(".sr-only, #viewer-content, .ai-prose-span, .fs-tile-aa, svg")) continue;
      // Glyph-only elements (×, ‹, ⋯, ★) are decoration, not chrome text.
      if (!/[A-Za-z0-9]/.test(text)) continue;
      if (!visible(el)) continue;

      const px = parseFloat(getComputedStyle(el).fontSize);
      out.count++;
      let best = null;
      for (const step of steps) {
        const delta = Math.abs(step.px - px);
        if (!best || delta < best.delta) best = { token: step.token, px: step.px, delta };
      }
      if (best.delta > tolerance) {
        out.violations.push({
          px: +px.toFixed(2),
          nearest: best.token,
          nearestPx: +best.px.toFixed(2),
          delta: +(px - best.px).toFixed(2),
          selector: chain(el),
          text: text.slice(0, 24),
        });
      }

      if (el.classList.contains("panel-title")) out.titles.push(+px.toFixed(2));
    }

    /* Rows are measured per element, not per text node: a search hit's file
     * line is a wrapper whose children hold the text. */
    for (const sel of rowSelectors) {
      for (const el of rootEl.querySelectorAll(sel)) {
        if (!visible(el) || !el.textContent.trim()) continue;
        out.rows.push({
          sel,
          px: +parseFloat(getComputedStyle(el).fontSize).toFixed(2),
          text: el.textContent.trim().slice(0, 24),
        });
      }
    }

    for (const header of rootEl.querySelectorAll(".panel-header, #tab-bar")) {
      if (!visible(header)) continue;
      out.headers.push({
        what: header.id === "tab-bar" ? "#tab-bar" : chain(header),
        height: +header.getBoundingClientRect().height.toFixed(2),
      });
    }
    return out;
  }, { scope, tolerance: TOLERANCE, rowSelectors: ROW_SELECTOR_LIST });
}

/* ---- the state machine --------------------------------------------- */

async function closeOverlays(page) {
  await page.evaluate(() => {
    if (window.NB && NB.settings && NB.settings.isOpen && NB.settings.isOpen()) NB.settings.close();
    if (window.NB && NB.export && NB.export.isOpen && NB.export.isOpen()) NB.export.close();
    // Close each dialog through its own close control so the module that owns
    // it resets its `dialogOpen` flag; hiding the element directly leaves it
    // believing the dialog is still open and the next open() becomes a no-op.
    for (const [overlayId, closeId] of [["workspace-dialog", "ws-dialog-close"], ["session-dialog", "session-dialog-close"]]) {
      const overlay = document.getElementById(overlayId);
      if (!overlay || overlay.hidden) continue;
      const close = document.getElementById(closeId);
      if (close) close.click();
      if (!overlay.hidden) {
        overlay.hidden = true;
        if (window.NB && NB.dialog) NB.dialog.close(overlay);
      }
    }
    if (window.NB && NB.menu) NB.menu.close();
  });
  await nextFrame(page);
}

async function activate(page, view) {
  await page.evaluate((v) => window.NB.activity.activate(v, false), view);
}

async function prepareState(page, key) {
  switch (key) {
    case "shell":
      await closeOverlays(page);
      await activate(page, "explorer");
      break;
    case "explorer":
      await closeOverlays(page);
      await activate(page, "explorer");
      // One folder expanded, so its children are real visible rows.
      await page.evaluate(async () => {
        const row = document.querySelector('#file-tree .tree-row[data-path="notes"]');
        if (!row) return;
        if (row.getAttribute("aria-expanded") !== "true") row.click();
        await new Promise((r) => setTimeout(r, 150));
      });
      break;
    case "explorer-menu":
      await prepareState(page, "explorer");
      await page.evaluate(() => {
        const row = document.querySelector('#file-tree .tree-row[data-path="notes/a.md"]');
        if (row) {
          const r = row.getBoundingClientRect();
          row.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8,
          }));
        }
      });
      await waitFor(() => page.evaluate(() => !document.getElementById("nb-menu").hidden), 3000);
      break;
    case "sessions":
      await closeOverlays(page);
      await activate(page, "sessions");
      break;
    case "pinned":
      await closeOverlays(page);
      await activate(page, "pinned");
      break;
    case "bookmarks":
      await closeOverlays(page);
      await activate(page, "bookmarks");
      break;
    case "recent":
      await closeOverlays(page);
      await activate(page, "recent");
      break;
    case "search-idle":
      await closeOverlays(page);
      await activate(page, "search");
      // Clear through the panel's own clear button (clearQuery + setIdle);
      // an empty programmatic fill is a no-op when the app already cleared
      // the field but kept the last result list.
      await page.evaluate(() => {
        const clear = document.querySelector("#search-view .search-panel-clear");
        if (clear && !clear.hidden) clear.click();
      });
      await page.fill("#search-view .search-panel-input", "");
      await page.evaluate(() => {
        const toggle = document.querySelector("#search-view .search-panel-advanced-toggle");
        if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
      });
      break;
    case "search-advanced":
      await prepareState(page, "search-idle");
      await page.evaluate(() => {
        const toggle = document.querySelector("#search-view .search-panel-advanced-toggle");
        if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      });
      break;
    case "search-results":
      await prepareState(page, "search-advanced");
      await page.fill("#search-view .search-panel-input", "needle");
      await page.press("#search-view .search-panel-input", "Enter");
      await waitFor(() => page.evaluate(() =>
        !!document.querySelector("#search-view .search-panel-hit-file")), 8000);
      break;
    case "ai":
      await closeOverlays(page);
      await activate(page, "ai");
      break;
    case "outline":
      await closeOverlays(page);
      await activate(page, "explorer");
      break;
    default:
      if (key.startsWith("settings:")) {
        const tab = key.slice("settings:".length);
        await closeOverlays(page);
        await page.evaluate(() => {
          if (!NB.settings.isOpen()) NB.settings.open();
        });
        await page.click('#settings-overlay .settings-nav-item[data-tab="' + tab + '"]');
        break;
      }
      throw new Error("unknown state " + key);
  }
  await nextFrame(page);
}

/* ---- role measurements --------------------------------------------- */

async function measureSteps(page) {
  return page.evaluate((steps) => {
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;left:-9999px;top:0;white-space:nowrap;";
    document.body.appendChild(probe);
    const out = {};
    for (const step of steps) {
      probe.style.fontSize = "var(" + step + ")";
      out[step] = +parseFloat(getComputedStyle(probe).fontSize).toFixed(2);
    }
    probe.remove();
    return out;
  }, STEPS.map((s) => s.token));
}

async function measureTile(page) {
  return page.evaluate((sels) => {
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector("#settings-overlay " + sel);
      out[sel] = el ? +parseFloat(getComputedStyle(el).fontSize).toFixed(2) : null;
    }
    return out;
  }, SIZE_TILE.map((t) => t.sel));
}

async function measureRoles(page) {
  return page.evaluate(() => {
    const px = (el) => +parseFloat(getComputedStyle(el).fontSize).toFixed(2);
    const out = { tab: [], nav: [], controls: [] };
    out.tab = [...new Set([...document.querySelectorAll("#tab-bar .tab")].map(px))];
    out.nav = [...new Set([...document.querySelectorAll("#settings-overlay .settings-nav-item")].map(px))];
    for (const section of document.querySelectorAll("#settings-overlay .settings-section")) {
      if (section.hidden) continue;
      for (const el of section.querySelectorAll("button, input, select")) {
        if (/^(checkbox|radio|range|hidden)$/.test(el.type || "")) continue;
        if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
        // A wrapper with no text of its own (a workspace row) is a row, not a
        // control; its visible text is audited by A1 inside the spans. A field
        // carries its text in `value`, so it is always a control.
        const isField = el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
        const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
        if (!direct && !isField) continue;
        out.controls.push({ sel: el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + String(el.className).trim().split(/\s+/)[0], px: px(el) });
      }
    }
    return out;
  });
}

/* ---- formatting ---------------------------------------------------- */

function violationText(surface, state, setting, v) {
  return surface + " · " + state + " · " + setting + " · " + v.selector +
    " · " + v.px + " px · nearest " + v.nearest + " " + v.nearestPx +
    " (" + (v.delta > 0 ? "+" : "") + v.delta + ")";
}

/* ---- main ---------------------------------------------------------- */

async function main() {
  await startStub();
  fs.writeFileSync(path.join(CONFIG, "ai.json"), JSON.stringify({
    servers: [{
      name: "stubai",
      base_url: "http://127.0.0.1:" + stubPort,
      model: "stub-model",
    }],
    default: "stubai",
  }));

  if (await serverAnswers()) {
    console.error("port " + PORT + " is already in use; stop that process and re-run.");
    process.exit(2);
  }
  const child = spawn(PY, ["app.py", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: PROJ,
    env: Object.assign({}, process.env, {
      NOTEBOOK_DATA_DIR: DATA,
      NOTEBOOK_CONFIG_DIR: CONFIG,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (d) => { serverLog += d; });
  child.stderr.on("data", (d) => { serverLog += d; });

  let browser = null;
  const pageErrors = [];
  try {
    await waitForServer(child);
    try {
      browser = await playwright.chromium.launch({
        headless: true,
        executablePath: CHROMIUM_PATH,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch (err) {
      console.error("cannot launch chromium: " + String(err).split("\n")[0]);
      console.error("Set CHROMIUM_PATH to a working binary.");
      child.kill("SIGTERM");
      process.exit(2);
    }

    const ctx = await browser.newContext({ viewport: VIEW, serviceWorkers: "block" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));
    await page.goto(BASE + "/?file=Welcome.md");
    await page.waitForFunction(
      () => window.NB && NB.tabs && NB.viewer && NB.activity &&
        document.querySelectorAll("#file-tree .tree-row").length > 0,
      null, { timeout: 30000 });
    await page.waitForSelector("#viewer-content h1", { timeout: 15000 });
    await sleep(300);

    /* ---- AI: one user message, one assistant message with a fence, and
     * one error card, all through the app's own composer and a local stub. */
    await activate(page, "ai");
    await nextFrame(page);
    const aiReady = await waitFor(() => page.evaluate(() =>
      !!(window.NB && NB.ai && NB.ai._getCurrentServer && NB.ai._getCurrentServer())), 15000);
    check("AI stub: the provider config is live", aiReady,
      "NB.ai reports no current server; the ai.json fixture was not adopted");
    const emptyAi = await walk(page, "#ai-view");
    await page.fill("#ai-input", "Hello from the typography audit");
    await page.press("#ai-input", "Enter");
    let ok = await waitFor(() => page.evaluate(() =>
      !!document.querySelector("#ai-view .ai-msg-assistant .ai-prose-span")), 30000);
    const aiDump = ok ? "" : await page.evaluate(() =>
      (document.querySelector("#ai-view") || {}).innerText || "(no #ai-view)");
    check("AI stub: an assistant message renders", ok,
      "the local SSE stub returned no assistant prose\n" + String(aiDump).slice(0, 3000));
    await page.fill("#ai-input", "TRIGGER_ERROR");
    await page.press("#ai-input", "Enter");
    ok = await waitFor(() => page.evaluate(() =>
      !!document.querySelector("#ai-view .ai-error")), 20000);
    check("AI stub: a failed send renders an error card", ok,
      "no .ai-error after the stub answered 500");

    /* ---- the setting loop -------------------------------------------- */
    console.log("\n== surfaces at S / M / L / XL ==");
    const settings = [
      { name: "S", key: "small" },
      { name: "M", key: "medium" },
      { name: "L", key: "large" },
      { name: "XL", key: "xlarge" },
    ];
    const states = [
      { key: "shell", surface: "shell", state: "default", scope: "#layout" },
      { key: "explorer", surface: "explorer", state: "folder expanded", scope: "#side-panel" },
      { key: "explorer-menu", surface: "explorer", state: "context menu", scope: "#nb-menu" },
      { key: "sessions", surface: "sessions", state: "two sessions", scope: "#sessions-view" },
      { key: "pinned", surface: "pinned", state: "one pinned folder", scope: "#pinned-view" },
      { key: "bookmarks", surface: "bookmarks", state: "three bookmarks", scope: "#bookmarks-view" },
      { key: "recent", surface: "recent", state: "three entries", scope: "#recent-view" },
      { key: "search-idle", surface: "search", state: "idle", scope: "#search-view" },
      { key: "search-advanced", surface: "search", state: "advanced open", scope: "#search-view" },
      { key: "search-results", surface: "search", state: "with results", scope: "#search-view" },
      { key: "ai", surface: "ai", state: "messages and error", scope: "#ai-view" },
      { key: "outline", surface: "outline", state: "note open", scope: "#outline-pane" },
    ];
    const settingsStates = SETTINGS_TABS.map((tab) => ({
      key: "settings:" + tab, surface: "settings", state: tab, scope: "#settings-overlay",
    }));
    const dialogStates = [
      { key: "dialog:export", surface: "export dialog", state: "open", scope: "#export-overlay" },
      { key: "dialog:workspace", surface: "workspace dialog", state: "open", scope: "#workspace-dialog" },
      { key: "dialog:session", surface: "session dialog", state: "open", scope: "#session-dialog" },
    ];
    const matrix = states.concat(settingsStates, dialogStates);

    /* Per-setting accumulators for the role assertions. */
    const rowsBySetting = {};
    const titlesBySetting = {};
    const headersBySetting = {};
    const emptyStates = [];

    for (const setting of settings) {
      await page.evaluate((s) => NB.app.setFontSize(s), setting.key);
      await nextFrame(page);

      const violations = [];
      let audited = 0;
      rowsBySetting[setting.name] = [];
      titlesBySetting[setting.name] = [];
      headersBySetting[setting.name] = [];

      for (const state of matrix) {
        let key = state.key;
        if (key.startsWith("dialog:")) {
          await closeOverlays(page);
          await page.evaluate((name) => {
            if (name === "export") NB.export.open();
            else if (name === "workspace") NB.workspaces.openAdd();
            else if (name === "session") NB.sessions.openCreate();
          }, key.slice("dialog:".length));
          await nextFrame(page);
        } else {
          await prepareState(page, key);
        }
        const result = await walk(page, state.scope);
        audited += result.count;
        if (result.count === 0) emptyStates.push(setting.name + " " + state.surface + "/" + state.state);
        if (result.missing) {
          violations.push(state.surface + " · " + state.state + " · " + setting.name +
            " · scope " + state.scope + " is missing");
        }
        for (const v of result.violations) {
          violations.push(violationText(state.surface, state.state, setting.name, v));
        }
        rowsBySetting[setting.name].push(...result.rows.map((r) => Object.assign({ state: state.surface, rootPx: result.root }, r)));
        titlesBySetting[setting.name].push(...result.titles.map((px) => ({ state: state.surface, px })));
        headersBySetting[setting.name].push(...result.headers);
      }
      await closeOverlays(page);

      check("A1 " + setting.name + ": every visible chrome size is on the scale (" + audited + " text nodes)",
        violations.length === 0,
        violations.slice(0, 40).join("\n"));
      if (violations.length > 40) console.log("         ... " + (violations.length - 40) + " more");
    }

    check("every state in the matrix has visible text to audit", emptyStates.length === 0,
      emptyStates.join("\n"));

    /* ---- A2: one row role in every panel ---------------------------- */
    for (const setting of settings) {
      const rows = rowsBySetting[setting.name];
      const sizes = [...new Set(rows.map((r) => r.px))];
      const seen = [...new Set(rows.map((r) => r.sel))];
      const detail = rows.map((r) => r.sel + " (" + r.state + ") = " + r.px + " px [" + r.text + "]").join("\n");
      check("A2 " + setting.name + ": the row group measures one px (" + seen.length + " selectors)",
        seen.length >= 5 && sizes.length === 1,
        "expected one size across " + ROW_SELECTORS.join(", ") + "; found " + sizes.join(" / ") + " px\n" + detail);
    }

    /* ---- A3: every panel title, one step ---------------------------- */
    for (const setting of settings) {
      const titles = titlesBySetting[setting.name];
      const sizes = [...new Set(titles.map((t) => t.px))];
      const detail = titles.map((t) => t.state + " = " + t.px + " px").join("\n");
      const rootPx = +((rowsBySetting[setting.name][0] || {}).rootPx || 0);
      const titleStep = +(0.72 * (rootPx || 0)).toFixed(2);
      const stepOk = !rootPx || Math.abs(sizes[0] - titleStep) <= TOLERANCE;
      check("A3 " + setting.name + ": all .panel-title measure one px and it is --text-xs (" + titles.length + " titles)",
        titles.length >= 7 && sizes.length === 1 && stepOk,
        "found " + sizes.join(" / ") + " px; --text-xs = " + titleStep + " px\n" + detail);
    }

    /* ---- A4: panel headers equal the tab bar ------------------------ */
    for (const setting of settings) {
      const headers = headersBySetting[setting.name];
      const unique = [...new Set(headers.map((h) => h.height))];
      const tabBar = headers.filter((h) => h.what === "#tab-bar").map((h) => h.height);
      const panels = headers.filter((h) => h.what !== "#tab-bar");
      const spread = unique.length ? Math.max(...unique) - Math.min(...unique) : 0;
      check("A4 " + setting.name + ": panel headers and the tab bar are one height",
        panels.length >= 5 && tabBar.length === 1 && spread <= 0.6 &&
          Math.abs(panels[0].height - tabBar[0]) <= 0.6,
        "tab bar " + tabBar.join(", ") + "; panels: " +
          [...new Set(panels.map((p) => p.height))].join(", ") + " px");
    }

    /* ---- A5: the steps follow the root ------------------------------ */
    for (const setting of settings) {
      await page.evaluate((s) => NB.app.setFontSize(s), setting.key);
      await nextFrame(page);
      const values = await measureSteps(page);
      const root = await page.evaluate(() =>
        +parseFloat(getComputedStyle(document.documentElement).fontSize).toFixed(2));
      const wrong = STEPS.filter((step) => {
        const expected = step.rem ? step.rem * root : 9;
        return Math.abs(values[step.token] - expected) > 0.01;
      }).map((step) => step.token + ": expected " + (step.rem ? (step.rem * root).toFixed(2) : "9") +
        ", measured " + values[step.token]);
      check("A5 " + setting.name + ": each step equals root × " + root + " px (2xs fixed at 9)",
        wrong.length === 0,
        wrong.join("\n"));
    }

    /* ---- A6: control ranks at M ------------------------------------- */
    await page.evaluate((s) => NB.app.setFontSize(s), "medium");
    await nextFrame(page);
    await closeOverlays(page);
    await page.evaluate(() => { if (!NB.settings.isOpen()) NB.settings.open(); });
    const roles = { tab: [], nav: [], controls: [] };
    for (const tab of SETTINGS_TABS) {
      await page.click('#settings-overlay .settings-nav-item[data-tab="' + tab + '"]');
      await nextFrame(page);
      const part = await measureRoles(page);
      roles.tab = [...new Set(roles.tab.concat(part.tab))];
      roles.nav = [...new Set(roles.nav.concat(part.nav))];
      roles.controls.push(...part.controls);
    }
    await closeOverlays(page);
    const mRoot = 14;
    const uiLg = +(mRoot * 0.93).toFixed(2);
    const ui = +(mRoot * 0.86).toFixed(2);
    check("A6 M: .tab measures --text-ui-lg", roles.tab.length === 1 && Math.abs(roles.tab[0] - uiLg) <= TOLERANCE,
      "tabs: " + roles.tab.join(", ") + " px; expected " + uiLg);
    check("A6 M: Settings nav items measure --text-ui-lg",
      roles.nav.length === 1 && Math.abs(roles.nav[0] - uiLg) <= TOLERANCE,
      "nav: " + roles.nav.join(", ") + " px; expected " + uiLg);
    const badControls = roles.controls.filter((c) => Math.abs(c.px - ui) > TOLERANCE);
    check("A6 M: Settings section controls measure --text-ui (" + roles.controls.length + " controls)",
      roles.controls.length > 0 && badControls.length === 0,
      badControls.map((c) => c.sel + " = " + c.px + " px; expected " + ui).join("\n"));

    /* ---- the font-size tile specimen: deliberately absolute --------- */
    for (const setting of settings) {
      await page.evaluate((s) => NB.app.setFontSize(s), setting.key);
      await nextFrame(page);
      await closeOverlays(page);
      await page.evaluate(() => { if (!NB.settings.isOpen()) NB.settings.open(); });
      await page.click('#settings-overlay .settings-nav-item[data-tab="appearance"]');
      await nextFrame(page);
      const tile = await measureTile(page);
      const wrong = SIZE_TILE.filter((t) => Math.abs((tile[t.sel] || 0) - t.px) > 0.1);
      check("tile " + setting.name + ": Aa stays 12.6 / 14 / 16.1 / 18.2 px",
        wrong.length === 0,
        wrong.map((t) => t.sel + " = " + tile[t.sel] + " px; expected " + t.px).join("\n"));
      await closeOverlays(page);
    }

    /* ---- the AI-empty surface exists only before the first send ----- */
    check("A1 M: AI empty state is on the scale", emptyAi.violations.length === 0,
      emptyAi.violations.map((v) => violationText("ai", "empty", "M", v)).join("\n"));

    check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join("\n"));
  } catch (err) {
    failed++;
    console.log("  FAIL suite crashed: " + String((err && err.stack) || err));
    if (serverLog) console.log(serverLog.slice(-2000));
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
    await stopStub();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  console.log("\n" + "=".repeat(60));
  if (failed) {
    console.log("RESULT: FAIL  (" + passed + " ok, " + failed + " failed)");
    process.exit(1);
  }
  console.log("RESULT: PASS  (" + passed + " ok, 0 failed)");
  process.exit(0);
}

main();
