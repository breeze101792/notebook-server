/* Real-browser test for the visual Mermaid designer ("designer").
 *
 * jsdom cannot exercise the Visimer canvas: the vendored bundle is ESM +
 * DOM and needs a real browser to mount and render through real mermaid.
 * This harness drives the REAL app in a REAL browser via Playwright:
 * boot Flask against a temp notebook, open a note with a ```mermaid
 * fence, enter hybrid mode, open the designer from the real right-click
 * menu, edit through the real Visimer model, Apply, and read the note
 * back from disk.
 *
 * Covers the plan's browser verification items 7-10
 * (docs/architecture/mermaid-designer.md):
 *   7. open -> Apply with no gesture is byte-identical (mandatory);
 *      add a node -> Apply -> the expected fence lands, untouched lines
 *      byte-identical.
 *   8. Apply -> one Ctrl+Z restores the previous fence.
 *   9. Ctrl+Z inside the modal does not touch the note; Esc closes only
 *      the modal.
 *  10. the canvas follows body[data-theme] via designerMermaid().
 *
 * Run:  node tests/browser/test_designer_browser.js
 * Env:  BROWSER=chromium|firefox   (default chromium)
 *       CHROMIUM_PATH / FIREFOX_PATH  override the browser binary.
 *       With no override Playwright's bundled browser is used; on NixOS
 *       that bundled build cannot start (its dynamic loader is a stub),
 *       so point the path at a nix-provided browser instead.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const BROWSER = (process.env.BROWSER || "chromium").toLowerCase();
if (BROWSER !== "chromium" && BROWSER !== "firefox") {
  throw new Error("BROWSER must be chromium or firefox, got " + BROWSER);
}
const BROWSER_TYPE = playwright[BROWSER];
const BROWSER_PATH = process.env[
  BROWSER === "firefox" ? "FIREFOX_PATH" : "CHROMIUM_PATH"
] || undefined;
const PORT = Number(process.env.PORT || 5098);
const BASE = "http://127.0.0.1:" + PORT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-designer-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

// A note with a mermaid fence flanked by prose, so "untouched lines are
// byte-identical" is a meaningful assertion.
const NOTE = "notes/designer.md";
const SRC = "# Diagram\n\nBefore paragraph.\n\n" +
  "```mermaid\ngraph TD; A-->B; B-->C;\n```\n\nAfter paragraph.\n";
const ORIGINAL_CODE = "graph TD; A-->B; B-->C;";

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}

function writeNote(rel, body) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}
function readNote(rel) { return fs.readFileSync(path.join(DATA, rel), "utf8"); }
// Replace the mermaid fence body, so a byte comparison of the rest proves
// every untouched line survived.
function stripFence(s) {
  return s.replace(/```mermaid\n[\s\S]*?\n```/, "```mermaid\n<SRC>\n```");
}

async function waitForServer(child) {
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

async function main() {
  writeNote(NOTE, SRC);
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

  let browser;
  try {
    browser = await BROWSER_TYPE.launch({
      headless: true,
      executablePath: BROWSER_PATH,
      args: BROWSER === "chromium"
        ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
    });
  } catch (err) {
    console.error("cannot launch " + BROWSER + ": " + String(err).split("\n")[0]);
    console.error("Set " + (BROWSER === "firefox" ? "FIREFOX_PATH" : "CHROMIUM_PATH") +
      " to a working binary, or install the browser for this platform.");
    child.kill("SIGTERM");
    process.exit(2);
  }
  try {
    await waitForServer(child);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 15000 });

    // Enter hybrid through the real button.
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });

    // Open the designer through the real right-click menu.
    async function openDesigner() {
      await page.locator("#viewer-content .mermaid-container").first()
        .click({ button: "right" });
      await page.waitForSelector("#hybrid-context-menu:not([hidden])", { timeout: 5000 });
      await page.locator("#hybrid-context-menu button",
        { hasText: "Design diagram" }).first().click();
      await page.waitForFunction(() => {
        const o = document.getElementById("designer-overlay");
        return o && !o.hidden;
      }, null, { timeout: 15000 });
      // Ready = Apply enabled (loaded + mounted + first render done).
      await page.waitForFunction(() => {
        const b = document.getElementById("designer-apply");
        return b && !b.disabled;
      }, null, { timeout: 25000 });
    }
    async function closeDesigner() {
      await page.waitForFunction(
        () => document.getElementById("designer-overlay").hidden, null, { timeout: 8000 });
    }

    // --- (7a) open -> Apply with no gesture is byte-identical -------
    {
      const before = readNote(NOTE);
      await openDesigner();
      check("designer browser: open unhides the modal",
        await page.evaluate(() => !document.getElementById("designer-overlay").hidden));
      await page.click("#designer-apply");
      await closeDesigner();
      check("designer browser: open -> Apply with no gesture is byte-identical",
        readNote(NOTE) === before, JSON.stringify(readNote(NOTE)));
    }

    // Wrap the Visimer editor constructor so the test can drive its
    // public model API (the same dispatch the gate used). The bundle is
    // loaded by the first open above; a wrapper installed now is seen by
    // the next mount.
    const wrapped = await page.evaluate(() => {
      const Real = window.Visimer && window.Visimer.MermaidWysiwygEditor;
      if (!Real) return false;
      window.Visimer.MermaidWysiwygEditor = function (opts) {
        const ed = new Real(opts);
        window.__designerEditor = ed;
        return ed;
      };
      return true;
    });
    check("designer browser: the Visimer bundle loaded in the real browser", wrapped);

    // --- (7b) add a node -> Apply -> fence lands, untouched bytes ----
    {
      const before = readNote(NOTE);
      await openDesigner();
      const code = await page.evaluate(() => {
        const ed = window.__designerEditor;
        if (!ed) return null;
        if (typeof ed.dispatch === "function") ed.dispatch({ type: "addNode" });
        return ed.code;
      });
      check("designer browser: the canvas model changed after addNode",
        !!code && code.indexOf(ORIGINAL_CODE) === -1 && code !== before,
        JSON.stringify(code));
      await page.click("#designer-apply");
      await closeDesigner();
      await page.click("#save-exit-btn");
      await page.waitForFunction(() => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const after = readNote(NOTE);
      check("designer browser: the note now holds a mermaid fence with the new diagram",
        after.indexOf("```mermaid") !== -1 && !!code && after.indexOf(code.trim()) !== -1,
        JSON.stringify(after));
      check("designer browser: untouched lines are byte-identical across the edit",
        stripFence(after) === stripFence(before), JSON.stringify(after));
      check("designer browser: the fence language is still mermaid",
        /```mermaid\n/.test(after));
    }

    // Re-open the original note for the undo test.
    writeNote(NOTE, SRC);
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });

    // --- (8) Apply -> one Ctrl+Z restores the previous fence ---------
    {
      const before = readNote(NOTE);
      await openDesigner();
      await page.evaluate(() => {
        const ed = window.__designerEditor;
        if (ed && typeof ed.dispatch === "function") ed.dispatch({ type: "addNode" });
      });
      await page.click("#designer-apply");
      await closeDesigner();
      // Focus the note body so the hybrid keydown listener sees Ctrl+Z.
      await page.click("#viewer-content", { position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(200);
      await page.click("#save-exit-btn");
      await page.waitForFunction(() => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      check("designer browser: one Ctrl+Z restores the previous fence bytes",
        readNote(NOTE) === before, JSON.stringify(readNote(NOTE)));
    }

    // Re-open for the modal-isolation tests.
    writeNote(NOTE, SRC);
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });

    // --- (9) Ctrl+Z inside the modal is isolated --------------------
    {
      const before = readNote(NOTE);
      await openDesigner();
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(150);
      check("designer browser: Ctrl+Z inside the modal keeps the modal open",
        await page.evaluate(() => !document.getElementById("designer-overlay").hidden));
      check("designer browser: Ctrl+Z inside the modal does not touch the note",
        readNote(NOTE) === before, JSON.stringify(readNote(NOTE)));

      // --- Esc closes only the modal -------------------------------
      await page.keyboard.press("Escape");
      await closeDesigner();
      check("designer browser: Esc closes the modal",
        await page.evaluate(() => document.getElementById("designer-overlay").hidden));
      check("designer browser: Esc leaves hybrid mode active",
        await page.evaluate(() => window.NB.hybrid.isActive()));
      check("designer browser: Esc writes nothing",
        readNote(NOTE) === before, JSON.stringify(readNote(NOTE)));
    }

    // --- (10) the canvas follows body[data-theme] -------------------
    {
      await page.evaluate(() => {
        window.__mmdTheme = null;
        const orig = window.mermaid.initialize.bind(window.mermaid);
        window.mermaid.initialize = (cfg) => {
          window.__mmdTheme = cfg && cfg.theme;
          return orig(cfg);
        };
      });
      await page.evaluate(() => window.NB.app.setTheme("dark"));
      await page.waitForTimeout(80);
      await openDesigner();
      const darkTheme = await page.evaluate(() => window.__mmdTheme);
      check("designer browser: canvas initializes with the dark body theme",
        darkTheme === "dark", String(darkTheme));
      await page.keyboard.press("Escape");
      await closeDesigner();

      await page.evaluate(() => window.NB.app.setTheme("light"));
      await page.waitForTimeout(80);
      await openDesigner();
      const lightTheme = await page.evaluate(() => window.__mmdTheme);
      check("designer browser: canvas initializes with the light body theme",
        lightTheme === "default", String(lightTheme));
      await page.keyboard.press("Escape");
      await closeDesigner();
    }

    check("designer browser: no uncaught page errors", pageErrors.length === 0,
      pageErrors.join(" | "));

    await page.screenshot({ path: path.join(tmp, "designer.png") });
  } finally {
    await browser.close();
    child.kill("SIGTERM");
  }

  console.log("\nRESULT: " + (failed ? "FAIL" : "PASS") +
    "  (" + passed + " ok, " + failed + " failed)");
  if (failed) {
    console.log("--- server log tail ---\n" + serverLog.slice(-2000));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
