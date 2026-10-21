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

// A line-based flowchart for the inspector checks. The semicolon form above
// keeps the older add/undo tests stable; Visimer's semantic parser only
// builds nodes for the line-per-statement form, which a real note uses.
const FLOW = "notes/designer-flow.md";
const FLOWSRC = "# Flow\n\n```mermaid\ngraph TD\n" +
  "  A[Start] --> B[Mid]\n  B --> C[End]\n```\n";

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

// Save the hybrid DOM, then exit hybrid mode. The edit bar no longer
// has a combined Save & Exit button, so tests drive the two actions.
async function saveAndExit(page) {
  await page.evaluate(() => window.NB.hybrid.save());
  await page.click("#close-edit-btn");
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

    // Capture the live Visimer editor instance so the test can drive its
    // public model API. The bundle's ESM namespace exposes getter-only
    // exports (configurable: false, no setter), so assigning
    // `Visimer.MermaidWysiwygEditor = ...` silently does nothing. Hook the
    // configurable `result` prototype getter instead: mount reads it right
    // after construction, so every editor instance is captured. The
    // `Visimer` accessor makes the hook run when the lazy-loaded bundle
    // assigns the global, which also covers every later page.goto (where
    // the bundle is loaded afresh).
    await page.addInitScript(() => {
      let V;
      Object.defineProperty(window, "Visimer", {
        configurable: true,
        get() { return V; },
        set(value) {
          V = value;
          const Real = value && value.MermaidWysiwygEditor;
          const proto = Real && Real.prototype;
          const desc = proto && Object.getOwnPropertyDescriptor(proto, "result");
          if (!desc || typeof desc.get !== "function" || !desc.configurable) return;
          Object.defineProperty(proto, "result", {
            configurable: true,
            get() {
              window.__designerEditor = this;
              return desc.get.call(this);
            },
          });
        },
      });
    });

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
      await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
      await page.locator("#nb-menu button",
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

    // The bundle is loaded by the first open above, and the init-script
    // hook has captured the editor instance from that mount.
    const wrapped = await page.evaluate(() =>
      !!(window.Visimer &&
        typeof window.Visimer.MermaidWysiwygEditor === "function" &&
        window.__designerEditor));
    check("designer browser: the Visimer bundle loaded in the real browser", wrapped);

    // --- (7b) add a node -> Apply -> fence lands, untouched bytes ----
    {
      const before = readNote(NOTE);
      await openDesigner();
      const beforeCode = await page.evaluate(() =>
        window.__designerEditor ? window.__designerEditor.code : null);
      const code = await page.evaluate(() => {
        const ed = window.__designerEditor;
        if (!ed) return null;
        if (typeof ed.dispatch === "function") ed.dispatch({ type: "addNode" });
        return ed.code;
      });
      // addNode appends a node line; the original statement line stays in
      // place, so compare against the pre-dispatch code, not a substring.
      check("designer browser: the canvas model changed after addNode",
        !!code && !!beforeCode && code !== beforeCode,
        JSON.stringify(code));
      await page.click("#designer-apply");
      await closeDesigner();
      await saveAndExit(page);
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
      await saveAndExit(page);
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

    // --- inspector selection, focus retention, double edge --------
    {
      writeNote(FLOW, FLOWSRC);
      await page.goto(BASE + "/?file=" + encodeURIComponent(FLOW));
      await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 15000 });
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await openDesigner();

      await page.locator('#designer-canvas [data-mw-entity^="node:"]').first().click();
      await page.waitForFunction(() => {
        const i = document.getElementById("designer-inspector");
        return i && !i.hidden &&
          document.getElementById("designer-inspector-kind").textContent === "Node";
      }, null, { timeout: 5000 });
      check("designer browser: a real canvas click opens the node inspector",
        await page.evaluate(() => !document.getElementById("designer-inspector").hidden));

      const label = page.locator("#designer-node-label");
      await label.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.type("Renamed");
      check("designer browser: typing in the inspector keeps focus",
        await page.evaluate(() => document.activeElement &&
          document.activeElement.id === "designer-node-label"));
      await page.keyboard.press("Tab");
      await page.waitForFunction(() => {
        const ed = window.__designerEditor;
        return ed && ed.result.flowchart &&
          ed.result.flowchart.nodes[0].label === "Renamed";
      }, null, { timeout: 5000 });
      check("designer browser: the inspector commits the label on blur",
        await page.evaluate(() => window.__designerEditor.result.flowchart.nodes[0].label === "Renamed"));

      await page.locator("#designer-add-tab-edge").click();
      await page.selectOption("#designer-add-from", { index: 1 });
      await page.selectOption("#designer-add-to", { index: 2 });
      await page.selectOption("#designer-add-arrow", "double");
      await page.click("#designer-add-submit");
      const doubleCode = await page.evaluate(() =>
        window.__designerEditor ? window.__designerEditor.code : "");
      check("designer browser: Add edge with a double arrow writes <-->",
        doubleCode.indexOf("<-->") !== -1, JSON.stringify(doubleCode));

      await page.click("#designer-apply");
      await closeDesigner();
      await saveAndExit(page);
      await page.waitForFunction(() => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const saved = readNote(FLOW);
      check("designer browser: the double-headed edge lands in the saved fence",
        saved.indexOf("<-->") !== -1 && saved.indexOf("Renamed") !== -1,
        JSON.stringify(saved));
    }

    // --- compact layout at 1280 / 1024 / 900 ----------------------
    // 900 keeps the desktop shell (phone mode starts at 860) while sitting
    // under the designer's 960px compact breakpoint. Widths at or below
    // 860 hide #hybrid-toggle, the only entry to the designer.
    {
      for (const width of [1280, 1024, 900]) {
        await page.setViewportSize({ width: width, height: 900 });
        await page.goto(BASE + "/?file=" + encodeURIComponent(FLOW));
        await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 15000 });
        await page.click("#hybrid-toggle");
        await page.waitForFunction(
          () => document.getElementById("viewer-content")
            .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
        await openDesigner();
        const layout = await page.evaluate(() => {
          const sidebar = document.getElementById("designer-sidebar");
          const grabber = document.getElementById("designer-inspector-grabber");
          const footer = document.querySelector("#designer-overlay .designer-footer");
          return {
            dir: getComputedStyle(sidebar).flexDirection,
            grabber: getComputedStyle(grabber).display,
            footerH: footer.getBoundingClientRect().height,
            overflowX: document.documentElement.scrollWidth >
              document.documentElement.clientWidth + 1,
          };
        });
        if (width >= 1024) {
          check("designer browser(" + width + "): wide layout keeps a column sidebar",
            layout.dir === "column" && layout.grabber === "none",
            JSON.stringify(layout));
        } else {
          check("designer browser(" + width + "): compact layout uses a strip + sheet",
            layout.dir === "row" && layout.grabber === "flex",
            JSON.stringify(layout));
        }
        check("designer browser(" + width + "): footer stays visible",
          layout.footerH > 0, JSON.stringify(layout));
        check("designer browser(" + width + "): no horizontal page overflow",
          layout.overflowX === false, JSON.stringify(layout));
        await page.keyboard.press("Escape");
        await closeDesigner();
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    // --- sequence: selection, autonumber, add positions, apply ----
    {
      const SEQ = "notes/designer-seq.md";
      writeNote(SEQ,
        "# Sequence\n\n```mermaid\nsequenceDiagram\n" +
        "  participant A as Alice\n  participant B as Bob\n" +
        "  A->>B: Hello\n  B-->>A: Hi\n```\n");
      await page.goto(BASE + "/?file=" + encodeURIComponent(SEQ));
      await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 15000 });
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await openDesigner();

      await page.locator('#designer-canvas [data-mw-entity^="event:"]').first().click();
      await page.waitForFunction(() => {
        const k = document.getElementById("designer-inspector-kind");
        return k && k.textContent === "Message";
      }, null, { timeout: 5000 });
      check("designer browser: a real click selects a sequence message",
        await page.evaluate(() =>
          document.getElementById("designer-inspector-kind").textContent === "Message"));

      await page.locator("#designer-autonumber-input").check({ force: true });
      await page.waitForFunction(
        () => window.__designerEditor &&
          /autonumber/.test(window.__designerEditor.code), null, { timeout: 5000 });
      check("designer browser: the autonumber switch writes the directive",
        await page.evaluate(() => /autonumber/.test(window.__designerEditor.code)));

      // Autonumber inserted a line, so the old event ids no longer exist
      // and the selection was cleared. Wait for the canvas to re-render
      // with the new ids before clicking; clicking the stale SVG element
      // would select an id that no longer exists and do nothing.
      await page.waitForFunction(() => {
        const ed = window.__designerEditor;
        const first = document.querySelector(
          '#designer-canvas [data-mw-entity^="event:"]');
        return ed && ed.result.sequence && first &&
          first.getAttribute("data-mw-entity") ===
            ed.result.sequence.events[0].entityId;
      }, null, { timeout: 5000 });
      await page.locator('#designer-canvas [data-mw-entity^="event:"]').first().click();
      await page.waitForSelector("#designer-message-text", { timeout: 5000 });
      await page.locator("#designer-message-text").fill("Updated");
      await page.locator("#designer-message-text").press("Tab");
      await page.waitForFunction(
        () => window.__designerEditor.code.indexOf("Updated") !== -1,
        null, { timeout: 5000 });
      check("designer browser: editing a selected message updates the model",
        await page.evaluate(() => window.__designerEditor.code.indexOf("Updated") !== -1));

      await page.locator("#designer-add-tab-message").click();
      await page.selectOption("#designer-add-from", "A");
      await page.selectOption("#designer-add-to", "B");
      await page.fill("#designer-add-text", "First");
      await page.selectOption("#designer-add-position", "start");
      await page.click("#designer-add-submit");
      await page.waitForFunction(
        () => window.__designerEditor.code.indexOf("First") !== -1,
        null, { timeout: 5000 });
      const startCode = await page.evaluate(() => window.__designerEditor.code);
      // The first event was renamed to "Updated" above, so compare against
      // that text rather than the original "Hello".
      check("designer browser: Add message at Start inserts before the first event",
        startCode.indexOf("First") !== -1 &&
        startCode.indexOf("First") < startCode.indexOf("Updated"),
        JSON.stringify(startCode));

      const eventId = await page.evaluate(() =>
        window.__designerEditor.result.sequence.events[0].entityId);
      await page.selectOption("#designer-add-position", "after:" + eventId);
      await page.fill("#designer-add-text", "Second");
      await page.click("#designer-add-submit");
      await page.waitForFunction(
        () => window.__designerEditor.code.indexOf("Second") !== -1,
        null, { timeout: 5000 });
      check("designer browser: Add message After X inserts after the chosen event",
        await page.evaluate(() =>
          window.__designerEditor.code.indexOf("Second") <
          window.__designerEditor.code.indexOf("Updated")));

      await page.click("#designer-apply");
      await closeDesigner();
      await saveAndExit(page);
      await page.waitForFunction(() => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const seqSaved = readNote(SEQ);
      check("designer browser: sequence edits land in the saved fence",
        seqSaved.indexOf("autonumber") !== -1 &&
        seqSaved.indexOf("First") !== -1 &&
        seqSaved.indexOf("Second") !== -1 &&
        seqSaved.indexOf("Updated") !== -1,
        JSON.stringify(seqSaved));
    }

    // The sequence test saved and exited hybrid; restore it for the theme
    // check, which opens the designer through the hybrid menu.
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });

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
