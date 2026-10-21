/* Real-browser test for the Graphviz and WaveDrom design windows.
 *
 * jsdom covers the model/serializer and the shell with fake renderers
 * (tests/dom/test_dom.js); it cannot exercise the real viz / wavedrom
 * bundles, real SVG layout, or the real right-click entry path. This
 * harness drives the REAL app in a REAL browser via Playwright:
 * boot Flask against a temp notebook, open a note with a ```dot or
 * ```wavedrom fence, enter hybrid, open the design window from the real
 * right-click menu, edit through the real inspector/canvas, Apply, and
 * read the note back from disk.
 *
 * Covers the real-browser items in docs/architecture/
 * dot-wavedrom-designer.md:
 *   1. open -> Apply with no gesture is byte-identical (mandatory);
 *   2. select a node/signal, edit it, Apply -> only that construct
 *      changes and the untouched statements + prose stay identical;
 *   3. Cancel/Esc with a dirty edit writes nothing and closes;
 *   4. Edit source instead closes the window and opens the inline raw
 *      fence editor for the same block;
 *   5. Ctrl+Z on the canvas does not touch the note and Esc closes only
 *      the window;
 *   6. no uncaught page errors.
 *
 * Run:  node tests/browser/test_dw_designer_browser.js
 * Env:  PORT          override the server port (default 5096).
 *       CHROMIUM_PATH override the browser binary. With no override the
 *       harness probes Playwright's bundled builds and the system / Nix
 *       Chromium, using the first binary that answers --version (the
 *       Playwright headless shell cannot start on NixOS).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const PORT = Number(process.env.PORT || 5096);
const BASE = "http://127.0.0.1:" + PORT;

function runsVersion(exe) {
  try {
    execFileSync(exe, ["--version"], { stdio: "ignore", timeout: 8000 });
    return true;
  } catch (_) {
    return false;
  }
}

function findChromium() {
  const candidates = [];
  if (process.env.CHROMIUM_PATH) candidates.push(process.env.CHROMIUM_PATH);
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  try {
    for (const name of fs.readdirSync(cache)) {
      if (/^chromium-\d+$/.test(name)) {
        candidates.push(path.join(cache, name, "chrome-linux64", "chrome"));
      }
    }
  } catch (_) { /* no bundled browser */ }
  candidates.push(
    "/run/current-system/sw/bin/chromium",
    "/run/current-system/sw/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  );
  try {
    for (const name of fs.readdirSync("/nix/store")) {
      if (!/-chromium-\d/.test(name) || /sandbox/.test(name)) continue;
      candidates.push(path.join("/nix/store", name, "bin", "chromium"));
      candidates.push(path.join("/nix/store", name, "bin", "chromium-browser"));
    }
  } catch (_) { /* not NixOS */ }
  for (const exe of candidates) {
    if (fs.existsSync(exe) && runsVersion(exe)) return exe;
  }
  return undefined;
}

const CHROMIUM_PATH = findChromium();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-dw-designer-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const DOT_NOTE = "notes/dw-dot.md";
const DOT_SRC = "# Diagram\n\nBefore paragraph.\n\n" +
  "```dot\ndigraph G {\n  rankdir=LR;\n" +
  "  A [label=\"Note\"];\n  A -> B [label=\"renders\"];\n}\n```\n\n" +
  "After paragraph.\n";

const WAVE_NOTE = "notes/dw-wave.md";
const WAVE_SRC = "# Timing\n\n" +
  "```wavedrom\n{signal: [\n" +
  "  {name: 'clk', wave: 'p.....'},\n" +
  "  {name: 'data', wave: 'x.345x', data: ['head', 'body', 'tail']}\n" +
  "]}\n```\n";

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

function fenceBody(src, lang) {
  const m = new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```").exec(src);
  return m ? m[1] : "";
}
// A rendered block's stored source keeps the final newline before the
// closing fence; the Apply serializer writes lines without one.
function renderedFenceBody(src, lang) {
  const body = fenceBody(src, lang);
  return body ? body + "\n" : "";
}
function replaceFence(src, lang) {
  return src.replace(new RegExp("```" + lang + "\\n[\\s\\S]*?\\n```"),
    "```" + lang + "\n<SRC>\n```");
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

async function bootNote(page, rel, containerSel) {
  await page.goto(BASE + "/?file=" + encodeURIComponent(rel));
  await page.waitForSelector("#viewer-content " + containerSel, { timeout: 60000 });
  await page.click("#hybrid-toggle");
  await page.waitForFunction(
    () => document.getElementById("viewer-content")
      .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
}

async function openDesigner(page, containerSel) {
  await page.locator("#viewer-content " + containerSel).first()
    .click({ button: "right" });
  await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
  const item = page.locator("#nb-menu button",
    { hasText: /Design (graph|timing|diagram)/ }).first();
  if (await item.count() === 0) throw new Error("design menu item missing");
  await item.click();
  await page.waitForFunction(() => {
    const o = document.getElementById("dw-designer-overlay");
    return o && !o.hidden;
  }, null, { timeout: 15000 });
  // Ready = the model is built, the UI is mounted, and the first preview
  // has rendered. Apply is enabled whenever the window is ready.
  await page.waitForFunction(
    () => document.getElementById("dw-status").textContent === "Ready",
    null, { timeout: 30000 });
  await page.waitForFunction(
    () => !!document.querySelector("#dw-diagram-card > svg"),
    null, { timeout: 30000 });
}

async function closeDesigner(page) {
  await page.waitForFunction(
    () => document.getElementById("dw-designer-overlay").hidden,
    null, { timeout: 10000 });
}

async function saveAndExit(page) {
  await page.evaluate(() => window.NB.hybrid.save());
  await page.click("#close-edit-btn");
  await page.waitForFunction(() => !window.NB.hybrid.isActive(),
    null, { timeout: 8000 });
}

async function main() {
  writeNote(DOT_NOTE, DOT_SRC);
  writeNote(WAVE_NOTE, WAVE_SRC);

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
    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    console.error("cannot launch chromium: " + String(err).split("\n")[0]);
    console.error("Set CHROMIUM_PATH to a working binary, or install one.");
    child.kill("SIGTERM");
    process.exit(2);
  }

  let dialogResponse = "accept";
  let dialogCount = 0;

  try {
    await waitForServer(child);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("dialog", async (d) => {
      dialogCount++;
      if (dialogResponse === "accept") await d.accept();
      else await d.dismiss();
    });

    // --- Dot: open, badge, preview, Apply state --------------------
    {
      writeNote(DOT_NOTE, DOT_SRC);
      await bootNote(page, DOT_NOTE, ".viz-container");
      const before = readNote(DOT_NOTE);
      await openDesigner(page, ".viz-container");

      const state = await page.evaluate(() => {
        const overlay = document.getElementById("dw-designer-overlay");
        const card = document.getElementById("dw-diagram-card");
        return {
          open: overlay && !overlay.hidden,
          type: document.getElementById("dw-type").textContent,
          status: document.getElementById("dw-status").textContent,
          svgInCard: !!document.querySelector("#dw-diagram-card > svg"),
          applyDisabled: document.getElementById("dw-apply").disabled,
          cancelDisabled: document.getElementById("dw-cancel").disabled,
        };
      });

      check("dw dot browser: the right-click Design item opens the overlay",
        state.open, JSON.stringify(state));
      check("dw dot browser: the type badge says Graphviz",
        state.type === "Graphviz", state.type);
      check("dw dot browser: an SVG preview exists inside #dw-diagram-card",
        state.svgInCard, JSON.stringify(state));
      check("dw dot browser: Apply is enabled once the window is ready",
        state.applyDisabled === false,
        "status=" + state.status + " applyDisabled=" + state.applyDisabled);

      // --- Dot: no-op Apply must be byte-identical (mandatory) -----
      let closedByApply = false;
      if (!state.applyDisabled) {
        await page.click("#dw-apply");
        await closeDesigner(page);
        closedByApply = true;
      } else {
        // A real user cannot press a disabled button. Try it anyway so the
        // failure names the exact repro; the note comparison below still
        // proves the attempt wrote nothing.
        try {
          await page.locator("#dw-apply").click({ timeout: 1500 });
          closedByApply = true;
        } catch (_) { /* disabled: no user-reachable no-op Apply */ }
      }
      await page.waitForTimeout(400);
      const after = readNote(DOT_NOTE);

      check("dw dot browser: open -> Apply with no edits is driveable and closes",
        state.applyDisabled === false && closedByApply,
        "repro: open a dot note in hybrid, right-click .viz-container, choose " +
        "design entry; status is Ready, SVG preview is present, but " +
        "#dw-apply.disabled === true, so the no-op Apply path cannot be reached");
      check("dw dot browser: open -> Apply with no edits leaves the note byte-identical",
        after === before, JSON.stringify(after));

      if (!closedByApply) {
        await page.keyboard.press("Escape");
        await closeDesigner(page);
      }
      check("dw dot browser: the no-op attempt leaves hybrid mode active",
        await page.evaluate(() => window.NB.hybrid.isActive()));
    }

    // --- Dot: select node A, change its label, Apply ----------------
    {
      writeNote(DOT_NOTE, DOT_SRC);
      await bootNote(page, DOT_NOTE, ".viz-container");
      await openDesigner(page, ".viz-container");

      const nodeHit = page.locator('#dw-overlay-layer .dw-hit[data-node-id="A"]');
      await nodeHit.waitFor({ state: "visible", timeout: 10000 });
      await nodeHit.click();
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Node",
        null, { timeout: 5000 });

      const label = page.locator("#dw-node-label");
      await label.fill("Note edited");
      await page.waitForFunction(
        () => !document.getElementById("dw-apply").disabled,
        null, { timeout: 5000 });

      await page.click("#dw-apply");
      await closeDesigner(page);
      await saveAndExit(page);

      const after = readNote(DOT_NOTE);
      const expected = DOT_SRC.replace('A [label="Note"];',
        'A [label="Note edited"];');
      check("dw dot browser: the changed node label lands in the saved note",
        after.indexOf('A [label="Note edited"];') !== -1, JSON.stringify(after));
      check("dw dot browser: other statements and both prose paragraphs are byte-identical",
        after === expected, JSON.stringify(after));
      check("dw dot browser: the fence language stays dot",
        /```dot\n/.test(after), JSON.stringify(after));
    }

    // --- Dot: shape/style/line/arrow + History ---------------------
    {
      writeNote(DOT_NOTE, DOT_SRC);
      await bootNote(page, DOT_NOTE, ".viz-container");
      await openDesigner(page, ".viz-container");

      const nodeHit = page.locator('#dw-overlay-layer .dw-hit[data-node-id="A"]');
      await nodeHit.waitFor({ state: "visible", timeout: 10000 });
      await nodeHit.click();
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Node",
        null, { timeout: 5000 });

      await page.click('#dw-inspector-body .dw-shape-btn[data-shape="ellipse"]');
      await page.waitForFunction(
        () => !document.getElementById("dw-undo").disabled,
        null, { timeout: 5000 });
      check("dw dot browser: the shape grid edit enables Undo",
        await page.evaluate(() => !document.getElementById("dw-undo").disabled));

      await page.click("#dw-undo");
      await page.waitForTimeout(350);
      await page.locator('#dw-overlay-layer .dw-hit[data-node-id="A"]').click();
      await page.waitForFunction(
        () => {
          const b = document.querySelector(
            '#dw-inspector-body .dw-shape-btn[data-shape="box"]');
          return b && b.getAttribute("aria-pressed") === "true";
        }, null, { timeout: 5000 });
      check("dw dot browser: Undo restores the box shape and clears selection first",
        await page.evaluate(() =>
          document.getElementById("dw-inspector-kind").textContent === "Node"));

      await page.click("#dw-redo");
      await page.waitForTimeout(350);
      await page.locator('#dw-overlay-layer .dw-hit[data-node-id="A"]').click();
      await page.waitForFunction(
        () => {
          const b = document.querySelector(
            '#dw-inspector-body .dw-shape-btn[data-shape="ellipse"]');
          return b && b.getAttribute("aria-pressed") === "true";
        }, null, { timeout: 5000 });
      check("dw dot browser: Redo re-applies the ellipse shape and reaches the top",
        await page.evaluate(() =>
          document.getElementById("dw-redo").disabled === true));

      await page.selectOption("#dw-node-style", "filled");
      await page.locator("#dw-overlay-layer .dw-edge-midpoint").first().click();
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Edge",
        null, { timeout: 5000 });
      await page.selectOption("#dw-edge-line", "dashed");
      await page.selectOption("#dw-edge-arrow", "both");

      await page.click("#dw-apply");
      await closeDesigner(page);
      await saveAndExit(page);

      const after = readNote(DOT_NOTE);
      const expected = DOT_SRC
        .replace('A [label="Note"];',
          'A [label="Note", shape=ellipse, style=filled];')
        .replace('A -> B [label="renders"];',
          'A -> B [label="renders", style=dashed, dir=both, arrowhead=normal];');
      check("dw dot browser: shape/style/line/arrow land in the saved note",
        after === expected, JSON.stringify(after));
      check("dw dot browser: shape/style/line/arrow keep prose and other statements intact",
        after.indexOf("rankdir=LR;") !== -1 &&
        after.indexOf("Before paragraph.") !== -1 &&
        after.indexOf("After paragraph.") !== -1);
    }

    // --- WaveDrom: open, white card, preview, edit signal ----------
    {
      writeNote(WAVE_NOTE, WAVE_SRC);
      await bootNote(page, WAVE_NOTE, ".wavedrom-container");
      await openDesigner(page, ".wavedrom-container");

      const cardState = await page.evaluate(() => {
        const card = document.getElementById("dw-diagram-card");
        return {
          type: document.getElementById("dw-type").textContent,
          svgInCard: !!document.querySelector("#dw-diagram-card > svg"),
          className: card.className,
          background: getComputedStyle(card).backgroundColor,
          signalHits: document.querySelectorAll(
            "#dw-overlay-layer .dw-wave-hit[data-signal-index]").length,
        };
      });
      check("dw wave browser: the type badge says WaveDrom",
        cardState.type === "WaveDrom", cardState.type);
      check("dw wave browser: an SVG preview exists inside #dw-diagram-card",
        cardState.svgInCard, JSON.stringify(cardState));
      check("dw wave browser: the preview sits in the white WaveDrom card",
        /dw-card--wavedrom/.test(cardState.className) &&
        cardState.background === "rgb(255, 255, 255)",
        JSON.stringify(cardState));
      check("dw wave browser: both signal rows are selectable",
        cardState.signalHits === 2, "hits=" + cardState.signalHits);

      const dataHit = page.locator(
        '#dw-overlay-layer .dw-wave-hit[data-signal-index="1"]');
      await dataHit.waitFor({ state: "visible", timeout: 10000 });
      await dataHit.click({ position: { x: 6, y: 8 } });
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Signal",
        null, { timeout: 5000 });

      await page.locator("#dw-wave-name").fill("data2");
      await page.waitForFunction(
        () => !document.getElementById("dw-apply").disabled,
        null, { timeout: 5000 });

      await page.click("#dw-apply");
      await closeDesigner(page);
      await saveAndExit(page);

      const after = readNote(WAVE_NOTE);
      const body = fenceBody(after, "wavedrom");
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (_) { parsed = null; }
      check("dw wave browser: Apply writes a strict-JSON wavedrom fence",
        !!parsed && Array.isArray(parsed.signal), JSON.stringify(body));
      check("dw wave browser: the selected signal's name changed",
        !!parsed && parsed.signal[1] && parsed.signal[1].name === "data2",
        JSON.stringify(parsed));
      check("dw wave browser: the clk signal is unchanged",
        !!parsed && parsed.signal[0] &&
        parsed.signal[0].name === "clk" &&
        parsed.signal[0].wave === "p.....",
        JSON.stringify(parsed && parsed.signal[0]));
      check("dw wave browser: the data wave and its labels are unchanged",
        !!parsed && parsed.signal[1] &&
        parsed.signal[1].wave === "x.345x" &&
        JSON.stringify(parsed.signal[1].data) ===
          JSON.stringify(["head", "body", "tail"]),
        JSON.stringify(parsed && parsed.signal[1]));
      check("dw wave browser: the heading and surrounding prose are byte-identical",
        replaceFence(after, "wavedrom") === replaceFence(WAVE_SRC, "wavedrom"),
        JSON.stringify(after));
      check("dw wave browser: the fence language stays wavedrom",
        /```wavedrom\n/.test(after), JSON.stringify(after));
    }

    // --- WaveDrom: ruler, track, palette, hscale, data label ------
    {
      writeNote(WAVE_NOTE, WAVE_SRC);
      await bootNote(page, WAVE_NOTE, ".wavedrom-container");
      await openDesigner(page, ".wavedrom-container");

      const rulerCells = await page.locator("#dw-slice-ruler .dw-slice-cell").count();
      check("dw wave browser: the slice ruler has one cell per time slice",
        rulerCells === 6, "cells=" + rulerCells);
      await page.locator('#dw-slice-ruler .dw-slice-cell[data-slice="2"]').click();
      await page.waitForFunction(
        () => /slice 3/.test(document.getElementById("dw-inspector-meta").textContent),
        null, { timeout: 5000 });
      check("dw wave browser: clicking a ruler cell selects the slice and shows the band",
        await page.evaluate(() =>
          !document.getElementById("dw-slice-band").hidden &&
          /slice 3/.test(document.getElementById("dw-inspector-meta").textContent)));

      const dataRow = page.locator(
        '#dw-overlay-layer .dw-wave-hit[data-signal-index="1"]');
      await dataRow.click({ position: { x: 6, y: 8 } });
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Signal",
        null, { timeout: 5000 });
      const trackCells = await page.locator("#dw-wave-track .dw-cell").count();
      check("dw wave browser: the character track renders one cell per character",
        trackCells === 6, "cells=" + trackCells);

      const beforeWave = await page.inputValue("#dw-wave-wave");
      await page.click('#dw-glyph-palette .dw-glyph-btn[title="High"]');
      const afterWave = await page.inputValue("#dw-wave-wave");
      check("dw wave browser: the glyph palette replaces the selected cell",
        afterWave !== beforeWave && afterWave.length === beforeWave.length,
        beforeWave + " -> " + afterWave);

      await page.selectOption("#dw-hscale", "3");
      await page.locator(
        '#dw-overlay-layer .dw-data-hit[data-label-index="1"]').click();
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Data label",
        null, { timeout: 5000 });
      await page.fill("#dw-data-label", "BODY");

      await page.click("#dw-apply");
      await closeDesigner(page);
      await saveAndExit(page);

      const after = readNote(WAVE_NOTE);
      const body = fenceBody(after, "wavedrom");
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (_) {}
      check("dw wave browser: Time scale writes config.hscale",
        !!parsed && parsed.config && parsed.config.hscale === 3,
        JSON.stringify(parsed && parsed.config));
      check("dw wave browser: the palette edit lands in the saved wave",
        !!parsed && parsed.signal[1] && parsed.signal[1].wave === afterWave,
        JSON.stringify(parsed && parsed.signal[1] && parsed.signal[1].wave));
      check("dw wave browser: the data label inspector edits data[j]",
        !!parsed && parsed.signal[1] && parsed.signal[1].data[1] === "BODY",
        JSON.stringify(parsed && parsed.signal[1] && parsed.signal[1].data));
    }

    // --- WaveDrom: Move up reorders signals -----------------------
    {
      writeNote(WAVE_NOTE, WAVE_SRC);
      await bootNote(page, WAVE_NOTE, ".wavedrom-container");
      await openDesigner(page, ".wavedrom-container");
      const dataRow = page.locator(
        '#dw-overlay-layer .dw-wave-hit[data-signal-index="1"]');
      await dataRow.click({ position: { x: 6, y: 8 } });
      await page.locator("#dw-inspector-body button", { hasText: "Move up" }).click();
      await page.waitForTimeout(250);
      await page.click("#dw-apply");
      await closeDesigner(page);
      await saveAndExit(page);

      const body = fenceBody(readNote(WAVE_NOTE), "wavedrom");
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (_) {}
      check("dw wave browser: Move up reorders the saved signal array",
        !!parsed && parsed.signal[0] && parsed.signal[0].name === "data" &&
        parsed.signal[1] && parsed.signal[1].name === "clk",
        JSON.stringify(parsed && parsed.signal.map((s) => s.name)));
    }

    // --- WaveDrom: period slices and band geometry ----------------
    {
      const PERIOD_SRC = "# Period\n\n```wavedrom\n" +
        "{signal: [{name: 'bus', wave: 'p.....', period: 2, data: ['a']}]}\n" +
        "```\n";
      writeNote(WAVE_NOTE, PERIOD_SRC);
      await bootNote(page, WAVE_NOTE, ".wavedrom-container");
      await openDesigner(page, ".wavedrom-container");

      const ruler = await page.evaluate(() => {
        const cells = Array.from(
          document.querySelectorAll("#dw-slice-ruler .dw-slice-cell"));
        const first = cells[0];
        const rect = first.getBoundingClientRect();
        return {
          count: cells.length,
          label: first.getAttribute("aria-label"),
          orientation: document.getElementById("dw-slice-ruler")
            .getAttribute("aria-orientation"),
          width: rect.width,
          height: rect.height,
        };
      });
      check("dw wave browser: period 2 gives 3 slices from a 6-character wave",
        ruler.count === 3 && ruler.label === "Slice 1 of 3" &&
        ruler.orientation === "horizontal" &&
        ruler.width >= 24 && ruler.height >= 30,
        JSON.stringify(ruler));

      await page.locator('#dw-slice-ruler .dw-slice-cell[data-slice="1"]').click();
      await page.waitForFunction(
        () => /slice 2/.test(document.getElementById("dw-inspector-meta").textContent),
        null, { timeout: 5000 });
      check("dw wave browser: slice 2 selects the first character of period 2",
        await page.evaluate(() => {
          const cell = document.querySelector("#dw-wave-track .dw-cell.is-selected");
          return !!cell && cell.dataset.index === "2";
        }));
      check("dw wave browser: period separators show slice ordinals 1,2,3",
        await page.evaluate(() =>
          Array.from(document.querySelectorAll(
            "#dw-wave-track .dw-cell-slice")).map((el) => el.textContent)
            .join(",") === "1,2,3"));

      const band = await page.evaluate(() => {
        const b = document.getElementById("dw-slice-band");
        const card = document.getElementById("dw-diagram-card");
        const rr = document.getElementById("dw-slice-ruler");
        const br = b.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const rrr = rr.getBoundingClientRect();
        return {
          hidden: b.hidden,
          left: br.left, width: br.width, top: br.top, height: br.height,
          cardTop: cr.top, cardBottom: cr.bottom,
          rulerBottom: rrr.bottom,
        };
      });
      check("dw wave browser: the slice band spans ruler through waveform",
        band.hidden === false && band.width > 0 && band.height > 0 &&
        Math.abs(band.top - band.rulerBottom) < 2 &&
        Math.abs((band.top + band.height) - band.cardBottom) < 2,
        JSON.stringify(band));

      await page.keyboard.press("Escape");
      await closeDesigner(page);
    }

    // --- Dot: hover, double-click, keyboard, compact layout -------
    {
      await page.setViewportSize({ width: 900, height: 800 });
      writeNote(DOT_NOTE, DOT_SRC);
      await bootNote(page, DOT_NOTE, ".viz-container");
      await openDesigner(page, ".viz-container");

      const layout = await page.evaluate(() => {
        const overlay = document.getElementById("dw-designer-overlay");
        const side = document.getElementById("dw-sidebar");
        const stage = document.querySelector(
          "#dw-designer-overlay .designer-stage");
        const main = document.querySelector(
          "#dw-designer-overlay .designer-stage-main");
        const body = document.querySelector(
          "#dw-designer-overlay .designer-body");
        const inspector = document.getElementById("dw-inspector");
        const nav = overlay.querySelector(".dw-compact-nav");
        const btn = nav.querySelector("[data-compact]");
        return {
          compact: overlay.classList.contains("is-compact"),
          sideDir: getComputedStyle(side).flexDirection,
          nav: nav.querySelectorAll("[data-compact]").length,
          stripH: nav.getBoundingClientRect().height,
          btnW: btn.getBoundingClientRect().width,
          inspectorInStage: inspector.parentElement === stage,
          mainRatio: main.getBoundingClientRect().height /
            body.getBoundingClientRect().height,
          inspectorPos: getComputedStyle(inspector).position,
          footerVisible: (() => {
            const f = document.querySelector(
              "#dw-designer-overlay .designer-footer");
            if (!f) return false;
            const r = f.getBoundingClientRect();
            return r.height > 0 && r.bottom <= window.innerHeight + 1;
          })(),
        };
      });
      check("dw dot browser: <=960 applies the compact strip/sheet layout",
        layout.compact === true && layout.sideDir === "row" &&
        layout.nav === 5 && layout.stripH === 48 && layout.btnW === 40 &&
        layout.inspectorInStage === true && layout.inspectorPos === "absolute" &&
        layout.mainRatio >= 0.45 && layout.footerVisible === true,
        JSON.stringify(layout));

      await page.click('.dw-compact-nav [data-compact="add"]');
      const addSheet = await page.evaluate(() => {
        const sheet = document.getElementById("dw-compact-sheet");
        const stage = document.querySelector(
          "#dw-designer-overlay .designer-stage");
        const body = document.getElementById("dw-compact-sheet-body");
        const sr = sheet.getBoundingClientRect();
        const str = stage.getBoundingClientRect();
        return {
          hidden: sheet.hidden,
          aria: sheet.getAttribute("aria-hidden"),
          inStage: sheet.parentElement === stage,
          formInSheet: body.contains(document.getElementById("dw-add-section")),
          focused: document.getElementById("dw-add-form")
            .contains(document.activeElement),
          ratio: sr.height / str.height,
          hasGrabber: !!sheet.querySelector(".dw-sheet-grabber"),
          hasClose: !!document.getElementById("dw-sheet-close"),
        };
      });
      check("dw compact: Add opens the sheet with the Add form and focuses a field",
        addSheet.hidden === false && addSheet.aria === "false" &&
        addSheet.inStage === true && addSheet.formInSheet === true &&
        addSheet.focused === true && addSheet.hasGrabber && addSheet.hasClose,
        JSON.stringify(addSheet));
      check("dw compact: the sheet is inside the stage and capped at 55%",
        addSheet.ratio > 0 && addSheet.ratio <= 0.55 + 0.01,
        "ratio=" + addSheet.ratio);

      await page.click('.dw-compact-nav [data-compact="chart"]');
      const chartSheet = await page.evaluate(() => {
        const sheet = document.getElementById("dw-compact-sheet");
        const body = document.getElementById("dw-compact-sheet-body");
        const side = document.getElementById("dw-sidebar");
        return {
          hidden: sheet.hidden,
          chartInSheet: body.contains(document.getElementById("dw-chart")),
          addRestored: side.contains(document.getElementById("dw-add-section")),
          focused: document.getElementById("dw-chart")
            .contains(document.activeElement),
        };
      });
      check("dw compact: Chart swaps the sheet content and restores Add",
        chartSheet.hidden === false && chartSheet.chartInSheet === true &&
        chartSheet.addRestored === true && chartSheet.focused === true,
        JSON.stringify(chartSheet));

      await page.click("#dw-sheet-close");
      const closed = await page.evaluate(() => {
        const sheet = document.getElementById("dw-compact-sheet");
        const side = document.getElementById("dw-sidebar");
        return {
          hidden: sheet.hidden,
          aria: sheet.getAttribute("aria-hidden"),
          overlayOpen: !document.getElementById("dw-designer-overlay").hidden,
          addBack: side.contains(document.getElementById("dw-add-section")),
          chartBack: side.contains(document.getElementById("dw-chart")),
          strip: document.querySelector(".dw-compact-nav")
            .getBoundingClientRect().height,
        };
      });
      check("dw compact: closing the sheet restores the strip without closing the window",
        closed.hidden === true && closed.aria === "true" &&
        closed.overlayOpen === true && closed.addBack === true &&
        closed.chartBack === true && closed.strip === 48,
        JSON.stringify(closed));

      // Return to desktop for hover/double-click: in the compact sheet the
      // first click reveals the sheet, so a second click at the same point
      // would land on the sheet rather than the hit target.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(150);
      const nodeHit = page.locator('#dw-overlay-layer .dw-hit[data-node-id="A"]');
      await nodeHit.hover();
      check("dw dot browser: hovering a node adds the 45% ring",
        await page.evaluate(() => {
          const b = document.querySelector(
            '#dw-overlay-layer .dw-hit[data-node-id="A"]');
          return b && b.classList.contains("is-hover");
        }));
      await nodeHit.dblclick({ force: true });
      await page.waitForTimeout(150);
      const dbg = await page.evaluate(() => ({
        active: document.activeElement && (document.activeElement.id ||
          document.activeElement.className),
        kind: document.getElementById("dw-inspector-kind").textContent,
        hasLabel: !!document.getElementById("dw-node-label"),
        sheetHidden: document.getElementById("dw-inspector")
          .classList.contains("is-sheet-hidden"),
        fieldDisabled: (document.getElementById("dw-node-label") || {}).disabled,
        fieldOffset: !!(document.getElementById("dw-node-label") || {}).offsetParent,
        inspDisplay: getComputedStyle(document.getElementById("dw-inspector")).display,
        inspInert: document.getElementById("dw-inspector").inert,
      }));
      check("dw dot browser: double-click focuses the label field",
        dbg.active === "dw-node-label", JSON.stringify(dbg));

      await page.locator("#dw-canvas").focus();
      await page.keyboard.press("End");
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Edge",
        null, { timeout: 5000 });
      check("dw dot browser: End selects the last entity", true);
      await page.keyboard.press("Home");
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Node",
        null, { timeout: 5000 });
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => document.activeElement && document.activeElement.id === "dw-node-label",
        null, { timeout: 5000 });
      check("dw dot browser: Home + Enter focus the inspector field", true);

      // Esc closes the build sheet first, then the window.
      await page.setViewportSize({ width: 900, height: 800 });
      await page.waitForTimeout(150);
      await page.click('.dw-compact-nav [data-compact="add"]');
      await page.keyboard.press("Escape");
      check("dw compact: Esc closes the sheet and keeps the window open",
        await page.evaluate(() => {
          const sheet = document.getElementById("dw-compact-sheet");
          return sheet.hidden === true &&
            !document.getElementById("dw-designer-overlay").hidden;
        }));
      await page.keyboard.press("Escape");
      await closeDesigner(page);
      check("dw compact: the second Esc closes the window",
        await page.evaluate(() =>
          document.getElementById("dw-designer-overlay").hidden));
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    // --- Dot: dirty Cancel closes without writing ------------------
    {
      writeNote(DOT_NOTE, DOT_SRC);
      await bootNote(page, DOT_NOTE, ".viz-container");
      await openDesigner(page, ".viz-container");
      const before = readNote(DOT_NOTE);

      const nodeHit = page.locator('#dw-overlay-layer .dw-hit[data-node-id="A"]');
      await nodeHit.waitFor({ state: "visible", timeout: 10000 });
      await nodeHit.click();
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Node",
        null, { timeout: 5000 });
      await page.locator("#dw-node-label").fill("Discard me");

      dialogResponse = "accept";
      dialogCount = 0;
      await page.click("#dw-cancel");
      await closeDesigner(page);
      await page.waitForTimeout(400);

      check("dw dot browser: a dirty Cancel asks before discarding",
        dialogCount > 0, "dialogs=" + dialogCount);
      check("dw dot browser: a dirty Cancel closes the window",
        await page.evaluate(() => document.getElementById("dw-designer-overlay").hidden));
      check("dw dot browser: a dirty Cancel writes nothing",
        readNote(DOT_NOTE) === before, JSON.stringify(readNote(DOT_NOTE)));
      check("dw dot browser: a dirty Cancel leaves hybrid mode active",
        await page.evaluate(() => window.NB.hybrid.isActive()));
    }

    // --- WaveDrom: dirty Esc closes without writing ----------------
    {
      writeNote(WAVE_NOTE, WAVE_SRC);
      await bootNote(page, WAVE_NOTE, ".wavedrom-container");
      await openDesigner(page, ".wavedrom-container");
      const before = readNote(WAVE_NOTE);

      const clkHit = page.locator(
        '#dw-overlay-layer .dw-wave-hit[data-signal-index="0"]');
      await clkHit.waitFor({ state: "visible", timeout: 10000 });
      await clkHit.click();
      await page.waitForFunction(
        () => document.getElementById("dw-inspector-kind").textContent === "Signal",
        null, { timeout: 5000 });
      await page.locator("#dw-wave-name").fill("clk2");

      dialogResponse = "accept";
      dialogCount = 0;
      await page.keyboard.press("Escape");
      await closeDesigner(page);
      await page.waitForTimeout(400);

      check("dw wave browser: a dirty Esc asks before discarding",
        dialogCount > 0, "dialogs=" + dialogCount);
      check("dw wave browser: a dirty Esc closes the window",
        await page.evaluate(() => document.getElementById("dw-designer-overlay").hidden));
      check("dw wave browser: a dirty Esc writes nothing",
        readNote(WAVE_NOTE) === before, JSON.stringify(readNote(WAVE_NOTE)));
      check("dw wave browser: a dirty Esc leaves hybrid mode active",
        await page.evaluate(() => window.NB.hybrid.isActive()));
    }

    // --- Edit source instead: both languages ----------------------
    {
      writeNote(DOT_NOTE, DOT_SRC);
      await bootNote(page, DOT_NOTE, ".viz-container");
      await openDesigner(page, ".viz-container");

      await page.click("#dw-edit-source");
      await closeDesigner(page);
      const pre = page.locator(
        "#viewer-content pre.hybrid-plugin-editing > code.language-dot");
      await pre.waitFor({ state: "visible", timeout: 10000 });
      const code = await pre.textContent();
      check("dw dot browser: Edit source instead swaps the block for a raw dot fence",
        code === renderedFenceBody(DOT_SRC, "dot"), JSON.stringify(code));
      check("dw dot browser: Edit source instead closes the design window",
        await page.evaluate(() => document.getElementById("dw-designer-overlay").hidden));

      await page.evaluate(() => window.NB.hybrid.exit(false));
      await page.waitForFunction(() => !window.NB.hybrid.isActive(),
        null, { timeout: 8000 });
    }
    {
      writeNote(WAVE_NOTE, WAVE_SRC);
      await bootNote(page, WAVE_NOTE, ".wavedrom-container");
      await openDesigner(page, ".wavedrom-container");

      await page.click("#dw-edit-source");
      await closeDesigner(page);
      const pre = page.locator(
        "#viewer-content pre.hybrid-plugin-editing > code.language-wavedrom");
      await pre.waitFor({ state: "visible", timeout: 10000 });
      const code = await pre.textContent();
      check("dw wave browser: Edit source instead swaps the block for a raw wavedrom fence",
        code === renderedFenceBody(WAVE_SRC, "wavedrom"), JSON.stringify(code));
      check("dw wave browser: Edit source instead closes the design window",
        await page.evaluate(() => document.getElementById("dw-designer-overlay").hidden));

      await page.evaluate(() => window.NB.hybrid.exit(false));
      await page.waitForFunction(() => !window.NB.hybrid.isActive(),
        null, { timeout: 8000 });
    }

    // --- Ctrl+Z on the canvas, then Esc closes only the window -----
    {
      writeNote(DOT_NOTE, DOT_SRC);
      await bootNote(page, DOT_NOTE, ".viz-container");
      await openDesigner(page, ".viz-container");
      const before = readNote(DOT_NOTE);

      await page.waitForFunction(
        () => document.activeElement && document.activeElement.id === "dw-canvas",
        null, { timeout: 5000 }).catch(() => {});
      const focused = await page.evaluate(() =>
        document.activeElement ? document.activeElement.id : "");
      check("dw dot browser: the canvas owns focus when the window opens",
        focused === "dw-canvas", "activeElement=" + focused);

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(250);
      check("dw dot browser: Ctrl+Z on the canvas keeps the window open",
        await page.evaluate(() =>
          !document.getElementById("dw-designer-overlay").hidden));
      check("dw dot browser: Ctrl+Z on the canvas does not change the note",
        readNote(DOT_NOTE) === before, JSON.stringify(readNote(DOT_NOTE)));
      check("dw dot browser: Ctrl+Z on the canvas leaves hybrid mode active",
        await page.evaluate(() => window.NB.hybrid.isActive()));

      await page.keyboard.press("Escape");
      await closeDesigner(page);
      check("dw dot browser: Esc closes only the design window",
        await page.evaluate(() =>
          document.getElementById("dw-designer-overlay").hidden &&
          window.NB.hybrid.isActive() &&
          !!document.querySelector("#viewer-content .viz-container")));
      check("dw dot browser: Esc writes nothing",
        readNote(DOT_NOTE) === before, JSON.stringify(readNote(DOT_NOTE)));
    }

    check("dw designer browser: no uncaught page errors",
      pageErrors.length === 0, pageErrors.join(" | "));

    await page.screenshot({ path: path.join(tmp, "dw-designer.png") });
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
