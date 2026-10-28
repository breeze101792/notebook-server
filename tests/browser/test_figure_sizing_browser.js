/* Real-browser test for the rendered-block sizing system (blocks.js
 * prepareSvg/planFigure/layoutFigure) and its CSS / export / hybrid seams.
 *
 * jsdom has no layout, so every check here runs in Chromium through
 * Playwright against the real Flask app. Synthetic SVGs mirror each
 * renderer's output (including Graphviz pt units) so the matrix and unit
 * cases are deterministic; one real Mermaid render proves the actual
 * renderer path, and the export/hybrid sections use real fences.
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium node tests/browser/test_figure_sizing_browser.js
 * Env:  PORT (default 5083), CHROMIUM_PATH override the browser binary.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const PORT = Number(process.env.PORT || 5083);
const BASE = "http://127.0.0.1:" + PORT;
const { findChromium } = require("./chromium");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || findChromium();
const VIEW = { width: 1280, height: 900 };
const PHONE_VIEW = { width: 390, height: 844 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-figure-sizing-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const LONG_BODY = (() => {
  const lines = ["# Long note", ""];
  for (let i = 1; i <= 18; i++) {
    lines.push("## Section " + i, "");
    lines.push(("Paragraph " + i + " with enough prose to make the viewer " +
      "scroll when the page is wheeled. ").repeat(4), "");
  }
  return lines.join("\n");
})();

// Explicit, narrow, tall: in the viewer this is taller than 70% of the
// reading area but less than 3 viewports, so the real layout picks the
// tall mode (the property the hybrid round-trip must preserve).
const TALL_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 1000" width="100" height="1000">',
  '  <rect x="0" y="0" width="100" height="1000" fill="#8a8f98"/>',
  "</svg>",
].join("\n");

const FIGURE_MERMAID = "graph TD; A[Start]-->B[Finish];";

const FIGURE_WAVEDROM = [
  "{signal: [",
  "  {name: 'clk', wave: 'p.....|...'},",
  "  {name: 'data', wave: 'x.345x|=.x', data: ['head', 'body', 'tail']}",
  "]}",
].join("\n");

const FIGURE_DOT = [
  "digraph G {",
  "  rankdir=LR;",
  '  A [label="Alpha"];',
  '  A -> B [label="beta"];',
  "}",
].join("\n");

const FIGURE_KATEX =
  "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}";

// Wide enough to overflow the reading column at both medium and xlarge.
const FIGURE_WIDE_KATEX =
  "\\sum_{i=1}^{n} \\frac{a_i^2 + b_i^2 + c_i^2 + d_i^2}" +
  "{\\sqrt{x_i^2 + y_i^2 + z_i^2 + w_i^2}} + " +
  "\\sum_{j=1}^{m} \\frac{p_j^3 - q_j^3 + r_j^3 + s_j^3}" +
  "{\\sqrt{u_j^2 + v_j^2 + t_j^2 + k_j^2}} + " +
  "\\prod_{k=1}^{m} \\left(1 + \\frac{1}{k}\\right) + " +
  "\\int_0^1 \\frac{1+2x+3x^2+4x^3}{1+x+x^2+x^3+x^4}\\,dx = \\infty";

// A genuinely long single code line for the wrap/no-scroll contract.
const FIGURE_LONG_CODE =
  "const longLine = \"" + "wrapped-token ".repeat(70) + "\";";

const FIGURE_HTML_LIVE =
  '<div class="demo" style="font-size:20px">' +
  "<strong>Live HTML demo</strong><p>Body text at 20px.</p>" +
  "<button>Click me</button></div>";

const FIGURE_HTML_LIVE_TALL =
  '<div class="demo" style="height:640px;background:#eef;font-size:20px">' +
  "<strong>Tall demo</strong><p>Top</p>" +
  '<div style="height:500px"></div><p>Bottom</p></div>';

const FIGURE_HTML_LIVE_SCROLL =
  '<div class="demo" style="height:120px;overflow:auto;font-size:20px">' +
  '<div style="height:600px">scroll me</div></div>';

const NOTES = {
  "Welcome.md": "# Welcome\n\nFigure sizing fixture.\n",
  "Long.md": LONG_BODY,
  "Mermaid.md": "# Mermaid\n\n```mermaid\ngraph TD; A-->B; B-->C; C-->D;\n```\n",
  "ExportFig.md": "# Export Figure\n\nIntro prose.\n\n```svg\n" + TALL_SVG + "\n```\n",
  "Roundtrip.md": "# Roundtrip\n\nBefore the diagram.\n\n```svg\n" + TALL_SVG +
    "\n```\n\nAfter the diagram.\n",
  "Phone.md": "# Phone\n\nPhone reader prose.\n",
  "FigMermaid.md": "# Mermaid Figure\n\nProse before the diagram.\n\n" +
    "```mermaid\n" + FIGURE_MERMAID + "\n```\n",
  "FigWavedrom.md": "# WaveDrom Figure\n\nProse before the waveform.\n\n" +
    "```wavedrom\n" + FIGURE_WAVEDROM + "\n```\n",
  "FigDot.md": "# Graphviz Figure\n\nProse before the graph.\n\n" +
    "```dot\n" + FIGURE_DOT + "\n```\n",
  "FigKatex.md": "# KaTeX Figure\n\nProse before the equation.\n\n" +
    "```math\n" + FIGURE_KATEX + "\n```\n",
  "FigWideKatex.md": "# Wide KaTeX Figure\n\nProse before the equation.\n\n" +
    "```math\n" + FIGURE_WIDE_KATEX + "\n```\n\n" +
    "```javascript\n" + FIGURE_LONG_CODE + "\n```\n",
  "FigErrors.md": "# Error Boxes\n\nProse before the broken blocks.\n\n" +
    "```mermaid\nthis is not valid mermaid @@@ " +
    "and more broken tokens ".repeat(28) + "\n```\n\n" +
    "```wavedrom\n{ not valid json\n```\n\n" +
    "```dot\nnot a graph {{{\n```\n\n" +
    "```svg\n<svg><not-closed>\n```\n",
  "FigHtmlLive.md": "# Live HTML\n\nProse before the preview.\n\n" +
    "```html-live\n" + FIGURE_HTML_LIVE + "\n```\n",
  "FigHtmlLiveTall.md": "# Tall Live HTML\n\nProse before the preview.\n\n" +
    "```html-live\n" + FIGURE_HTML_LIVE_TALL + "\n```\n",
  "FigHtmlLiveScroll.md": "# Scrolling Live HTML\n\nProse before the preview.\n\n" +
    "```html-live\n" + FIGURE_HTML_LIVE_SCROLL + "\n```\n",
};
for (const [rel, body] of Object.entries(NOTES)) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}
function section(name) { console.log("\n== " + name + " =="); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1.5 : eps);
// Playwright's service-worker probe throws inside sandboxed html-live
// frames. The sandbox is working as intended; that is not an app page
// error, so keep it out of the error collectors.
const SANDBOX_SW_PROBE =
  /Service worker is disabled because the context is sandboxed/;
function recordPageError(list, e) {
  const msg = String((e && e.stack) || e);
  if (!SANDBOX_SW_PROBE.test(msg)) list.push(msg);
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/auth");
      if (r.ok || r.status === 401) return;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error("server did not start");
}

async function main() {
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
    console.error("Set CHROMIUM_PATH to a working binary.");
    child.kill("SIGTERM");
    process.exit(2);
  }

  const ctx = await browser.newContext({
    viewport: VIEW,
    serviceWorkers: "block",
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => recordPageError(pageErrors, e));

  // Small page-side harness installed before any app script runs. It
  // builds figures exactly as a renderer would (card + SVG + prepareSvg)
  // and returns the measured geometry the assertions read.
  await page.addInitScript(() => {
    const NS = "http://www.w3.org/2000/svg";
    window.__nbSizing = {
      clear() {
        document.querySelectorAll(".nb-test-figure").forEach((n) => n.remove());
      },
      build(spec) {
        const viewer = document.getElementById("viewer-content");
        const card = document.createElement("div");
        card.className = spec.cardClass + " nb-test-figure";
        card.id = spec.id;
        if (spec.marker) {
          card.dataset[spec.marker] = "ok";
          card.dataset[spec.marker + "Source"] = spec.source || "";
        }
        const svg = document.createElementNS(NS, "svg");
        Object.keys(spec.attrs || {}).forEach((k) => svg.setAttribute(k, spec.attrs[k]));
        const vb = String((spec.attrs && spec.attrs.viewBox) || "")
          .trim().split(/[\s,]+/).map(Number);
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", vb.length === 4 ? String(vb[2]) : "10");
        rect.setAttribute("height", vb.length === 4 ? String(vb[3]) : "10");
        rect.setAttribute("fill", "#8a8f98");
        svg.appendChild(rect);
        if (spec.text) {
          const text = document.createElementNS(NS, "text");
          text.setAttribute("x", "10");
          text.setAttribute("y", "40");
          text.setAttribute("font-size", spec.textSize || "13");
          text.textContent = spec.text;
          svg.appendChild(text);
        }
        card.appendChild(svg);
        viewer.insertBefore(card, viewer.firstChild);
        NB.blocks.prepareSvg(svg, { mod: spec.mod || "svg", card: card });
        return card;
      },
      measure(card) {
        const vp = card && card.querySelector(":scope > .nb-figure-viewport");
        if (!vp) return { missing: true };
        const svg = vp.querySelector("svg");
        if (!svg) return { missing: true };
        const sr = svg.getBoundingClientRect();
        const vr = vp.getBoundingClientRect();
        const cs = getComputedStyle(vp);
        return {
          mode: vp.dataset.nbMode || "",
          sizing: svg.dataset.nbSizing || "",
          nbW: svg.dataset.nbW || "",
          nbH: svg.dataset.nbH || "",
          widthAttr: svg.getAttribute("width"),
          heightAttr: svg.getAttribute("height"),
          inlineWidth: svg.style.width || "",
          inlineHeight: svg.style.height || "",
          vpInlineHeight: vp.style.height || "",
          vpInlineMaxHeight: vp.style.maxHeight || "",
          vpInlineOverflowY: vp.style.overflowY || "",
          vpInlineScrollbarGutter: vp.style.scrollbarGutter || "",
          textScreenFont: (() => {
            const text = svg.querySelector("text");
            const ctm = text && text.getScreenCTM && text.getScreenCTM();
            return text && ctm ? parseFloat(getComputedStyle(text).fontSize) * ctm.a : null;
          })(),
          textFontAttr: (() => {
            const text = svg.querySelector("text");
            return text ? text.getAttribute("font-size") : null;
          })(),
          svgWidth: sr.width,
          svgHeight: sr.height,
          viewportWidth: vr.width,
          viewportHeight: vr.height,
          clientWidth: vp.clientWidth,
          clientHeight: vp.clientHeight,
          scrollHeight: vp.scrollHeight,
          scrollWidth: vp.scrollWidth,
          cardHeight: card.getBoundingClientRect().height,
          viewerScrollHeight: document.getElementById("viewer-content").scrollHeight,
          overflowY: cs.overflowY,
          inlineOverflowY: vp.style.overflowY || "",
          inlineMaxHeight: vp.style.maxHeight || "",
          overscrollY: cs.overscrollBehaviorY,
          tabindex: vp.getAttribute("tabindex"),
          role: vp.getAttribute("role"),
          ariaLabel: vp.getAttribute("aria-label"),
          centerSkew: Math.abs((sr.left - vr.left) - (vr.right - sr.right)),
        };
      },
    };
  });

  async function boot(file) {
    await page.goto(BASE + "/?file=" + encodeURIComponent(file));
    await page.waitForFunction(
      () => window.NB && NB.blocks && NB.viewer && NB.app,
      null, { timeout: 20000 });
    await page.waitForSelector("#viewer-content h1", { timeout: 15000 });
    await page.waitForTimeout(100);
  }

  async function installFigures(specs) {
    await page.evaluate((list) => {
      window.__nbSizing.clear();
      list.forEach((spec) => window.__nbSizing.build(spec));
    }, specs);
    // Let the debounced viewer-scoped relayout settle with real metrics.
    await page.waitForTimeout(220);
  }

  async function applyLayout(map) {
    await page.evaluate((entries) => {
      Object.keys(entries).forEach((id) => {
        const card = document.getElementById(id);
        if (card) NB.blocks.layoutFigure(card, entries[id]);
      });
    }, map);
  }

  async function measure(id) {
    return page.evaluate((cardId) => {
      const card = document.getElementById(cardId);
      return window.__nbSizing.measure(card);
    }, id);
  }

  /* Build + prepare + lay out with explicit metrics and measure in one
   * synchronous evaluation, so the auto relayout timer cannot intervene. */
  async function installAndLayout(spec, metrics) {
    return page.evaluate(({ s, m }) => {
      window.__nbSizing.clear();
      const card = window.__nbSizing.build(s);
      NB.blocks.layoutFigure(card, m);
      return window.__nbSizing.measure(card);
    }, { s: spec, m: metrics });
  }

  function setFontSize(name) {
    return page.evaluate((n) => {
      NB.app.setFontSize(n);
      return getComputedStyle(document.documentElement)
        .getPropertyValue("--font-scale").trim();
    }, name);
  }

  async function box(selector) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height,
        right: r.right, bottom: r.bottom };
    }, selector);
  }

  try {
    await waitForServer();

    // ---------------------------------------------------------------
    section("1. font-scale response");
    await boot("Welcome.md");
    await setFontSize("medium");
    await page.waitForTimeout(150);
    await installFigures([{
      id: "f-font", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 200 100" },
    }]);
    const mid = await measure("f-font");
    check("medium: natural size, not upscaled to the measure",
      mid.mode === "normal" && near(mid.svgWidth, 200) &&
      mid.svgWidth < mid.clientWidth - 20,
      JSON.stringify({ mode: mid.mode, w: mid.svgWidth, client: mid.clientWidth }));
    check("medium: height keeps the viewBox aspect ratio",
      near(mid.svgHeight, 100), JSON.stringify({ h: mid.svgHeight }));

    const scaleCases = [
      { name: "small", mult: 0.9 },
      { name: "large", mult: 1.15 },
      { name: "xlarge", mult: 1.3 },
    ];
    const scaleWidths = {};
    for (const c of scaleCases) {
      const raw = await setFontSize(c.name);
      await page.waitForTimeout(220);
      const m = await measure("f-font");
      scaleWidths[c.name] = m.svgWidth;
      check(c.name + ": diagram scales to viewBox x font-scale",
        raw === String(c.mult) && m.mode === "normal" &&
        near(m.svgWidth, 200 * c.mult, 2) &&
        near(m.svgHeight, 100 * c.mult, 2),
        JSON.stringify({ raw: raw, w: m.svgWidth, h: m.svgHeight,
          mode: m.mode }));
    }
    check("font scale grows monotonically with no upscaling at medium",
      scaleWidths.small < 200 && scaleWidths.large > 200 &&
      scaleWidths.xlarge > scaleWidths.large,
      JSON.stringify(scaleWidths));
    await setFontSize("medium");
    await page.waitForTimeout(150);

    // ---------------------------------------------------------------
    section("1b. real Mermaid render smoke");
    await boot("Mermaid.md");
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .mermaid-container .nb-figure-viewport svg"),
      null, { timeout: 30000 });
    await page.waitForTimeout(220);
    const realMermaid = await page.evaluate(() => {
      const card = document.querySelector("#viewer-content .mermaid-container");
      const svg = card && card.querySelector(".nb-figure-viewport > svg");
      if (!svg) return { missing: true };
      const r = svg.getBoundingClientRect();
      return {
        sizing: svg.dataset.nbSizing || "",
        viewBox: svg.getAttribute("viewBox") || "",
        width: r.width,
        height: r.height,
        mode: (card.querySelector(".nb-figure-viewport") || {}).dataset.nbMode || "",
        hasViewport: !!card.querySelector(".nb-figure-viewport"),
        error: !!document.querySelector("#viewer-content .mermaid-error"),
      };
    });
    check("real mermaid: rendered SVG is registered for shared sizing",
      !realMermaid.missing && realMermaid.hasViewport &&
      realMermaid.sizing === "font" && /^\s*[\d.]+[\s,]+[\d.]+/.test(realMermaid.viewBox),
      JSON.stringify(realMermaid));
    check("real mermaid: laid out at a positive size without an error box",
      realMermaid.width > 0 && realMermaid.height > 0 &&
      !realMermaid.error && !!realMermaid.mode,
      JSON.stringify(realMermaid));

    // ---------------------------------------------------------------
    section("2. layout matrix (wide / tall / huge / tiny)");
    const wide = await installAndLayout({
      id: "f-wide", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 800 300" },
    }, { contentW: 400, ref: 14, viewportH: 500 });
    check("wide-but-short fits the width (400x150)",
      wide.mode === "normal" && near(wide.svgWidth, 400) &&
      near(wide.svgHeight, 150),
      JSON.stringify({ mode: wide.mode, w: wide.svgWidth, h: wide.svgHeight }));

    const tall = await installAndLayout({
      id: "f-tall", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 100 1000" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("tall-but-narrow grows the card with no inner scrollbar",
      tall.mode === "tall" && near(tall.svgWidth, 100) &&
      near(tall.svgHeight, 1000) &&
      tall.vpInlineHeight === "" && tall.vpInlineMaxHeight === "" &&
      tall.vpInlineOverflowY === "" && tall.vpInlineScrollbarGutter === "" &&
      tall.overflowY === "visible" &&
      tall.tabindex === null && tall.role === null && tall.ariaLabel === null &&
      tall.scrollHeight <= tall.clientHeight + 1,
      JSON.stringify({ mode: tall.mode, clientH: tall.clientHeight,
        scrollH: tall.scrollHeight, overflow: tall.overflowY,
        vpH: tall.vpInlineHeight, vpOverflow: tall.vpInlineOverflowY,
        svgH: tall.inlineHeight }));
    check("tall-but-narrow is width-fitted and grows the note page",
      near(tall.svgWidth, 100) && tall.cardHeight >= tall.svgHeight - 1 &&
      tall.viewerScrollHeight > tall.svgHeight,
      JSON.stringify({ w: tall.svgWidth, cardH: tall.cardHeight,
        viewerSH: tall.viewerScrollHeight }));

    const huge = await installAndLayout({
      id: "f-huge", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 100 2000" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("a diagram over 3 viewports uses fit mode",
      huge.mode === "fit" && near(huge.svgHeight, 500) &&
      huge.svgHeight <= 500 + 1,
      JSON.stringify({ mode: huge.mode, w: huge.svgWidth, h: huge.svgHeight }));
    // No mode gets a bounded wrapper or an inner scrollbar.
    check("fit mode shrinks without an inner scrollbar",
      huge.vpInlineHeight === "" && huge.vpInlineMaxHeight === "" &&
      huge.vpInlineOverflowY === "" && huge.vpInlineScrollbarGutter === "" &&
      huge.overflowY === "visible" &&
      huge.scrollHeight <= huge.clientHeight + 1 &&
      near(huge.svgHeight, 500),
      JSON.stringify({ vpH: huge.vpInlineHeight,
        vpOverflow: huge.vpInlineOverflowY, scrollH: huge.scrollHeight,
        clientH: huge.clientHeight, h: huge.svgHeight }));

    const tiny = await installAndLayout({
      id: "f-tiny", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 100 50" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("tiny diagram stays natural size and centered",
      tiny.mode === "normal" && near(tiny.svgWidth, 100) &&
      tiny.centerSkew <= 1.5,
      JSON.stringify({ mode: tiny.mode, w: tiny.svgWidth,
        skew: tiny.centerSkew }));

    // ---------------------------------------------------------------
    section("3. per-engine units and inline-SVG sizing");
    const mermaidUnit = await installAndLayout({
      id: "f-unit-mermaid", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 200 100" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("mermaid: viewBox units are CSS px at the 14px base",
      mermaidUnit.sizing === "font" &&
      near(parseFloat(mermaidUnit.nbW), 200 / 14, 0.01) &&
      near(mermaidUnit.svgWidth, 200) && near(mermaidUnit.svgHeight, 100),
      JSON.stringify({ sizing: mermaidUnit.sizing, nbW: mermaidUnit.nbW,
        w: mermaidUnit.svgWidth }));

    const wavedrom = await installAndLayout({
      id: "f-unit-wavedrom", mod: "wavedrom", cardClass: "wavedrom-container",
      attrs: { viewBox: "0 0 480 60", width: "480", height: "60" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("wavedrom: width/height attributes are px",
      wavedrom.sizing === "font" && near(wavedrom.svgWidth, 480) &&
      near(wavedrom.svgHeight, 60) &&
      near(parseFloat(wavedrom.nbW), 480 / 14, 0.01),
      JSON.stringify({ mode: wavedrom.mode, w: wavedrom.svgWidth,
        h: wavedrom.svgHeight, nbW: wavedrom.nbW }));

    const graphviz = await installAndLayout({
      id: "f-unit-viz", mod: "viz", cardClass: "viz-container",
      attrs: { viewBox: "0 0 200 100", width: "120pt", height: "60pt" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("graphviz: 120pt width becomes 160 CSS px",
      graphviz.sizing === "font" && near(graphviz.svgWidth, 160) &&
      near(graphviz.svgHeight, 80) &&
      near(parseFloat(graphviz.nbW), (120 * 4 / 3) / 14, 0.01),
      JSON.stringify({ w: graphviz.svgWidth, h: graphviz.svgHeight,
        nbW: graphviz.nbW, heightAttr: graphviz.heightAttr }));

    const viewBox = await installAndLayout({
      id: "f-viewbox", mod: "svg", cardClass: "svg-container",
      attrs: { viewBox: "0 0 100 50" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("inline svg: viewBox-only renders at its natural size, not the card width",
      viewBox.sizing === "font" && viewBox.mode === "normal" &&
      near(viewBox.svgWidth, 100) && near(viewBox.svgHeight, 50) &&
      viewBox.widthAttr === "100" &&
      viewBox.svgWidth < viewBox.clientWidth - 100,
      JSON.stringify({ mode: viewBox.mode, w: viewBox.svgWidth,
        client: viewBox.clientWidth, widthAttr: viewBox.widthAttr }));

    const percent = await installAndLayout({
      id: "f-percent", mod: "svg", cardClass: "svg-container",
      attrs: { viewBox: "0 0 100 50", width: "100%" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("inline svg: width=100% is still its natural size, not the card width",
      percent.sizing === "font" && near(percent.svgWidth, 100) &&
      percent.widthAttr === "100" &&
      percent.svgWidth < percent.clientWidth - 100,
      JSON.stringify({ sizing: percent.sizing, w: percent.svgWidth,
        client: percent.clientWidth, widthAttr: percent.widthAttr }));

    const explicit = await installAndLayout({
      id: "f-explicit", mod: "svg", cardClass: "svg-container",
      attrs: { viewBox: "0 0 100 50", width: "120", height: "60" },
    }, { contentW: 1000, ref: 14, viewportH: 500 });
    check("inline svg: explicit author width/height wins",
      explicit.sizing === "explicit" && near(explicit.svgWidth, 120) &&
      near(explicit.svgHeight, 60) && explicit.heightAttr === "60",
      JSON.stringify({ sizing: explicit.sizing, w: explicit.svgWidth,
        h: explicit.svgHeight, heightAttr: explicit.heightAttr }));

    // A viewBox-only inline SVG follows the prose font scale like the
    // other diagrams.
    await installFigures([{
      id: "f-font-scale", mod: "svg", cardClass: "svg-container",
      attrs: { viewBox: "0 0 100 50" },
    }]);
    const fontMid = await measure("f-font-scale");
    await setFontSize("xlarge");
    await page.waitForTimeout(240);
    const fontLarge = await measure("f-font-scale");
    check("inline svg: viewBox-only width follows the font scale",
      fontLarge.sizing === "font" &&
      near(fontLarge.svgWidth, fontMid.svgWidth * 1.3, 2),
      JSON.stringify({ medium: fontMid.svgWidth, large: fontLarge.svgWidth }));
    await setFontSize("medium");
    await page.waitForTimeout(150);

    // Real-note regression: notebook/Syntax.md's block diagram is
    // viewBox 0 0 420 120 with 13px internal text. It must stay 420px
    // (13px text) at medium and 546px at xlarge, never the card width.
    const real420 = await installAndLayout({
      id: "f-real420", mod: "svg", cardClass: "svg-container",
      attrs: { viewBox: "0 0 420 120" },
      text: "Block diagram", textSize: "13",
    }, { contentW: 1200, ref: 14, viewportH: 500 });
    check("inline svg regression: 420x120 is 420px with 13px text at medium",
      real420.sizing === "font" && near(real420.svgWidth, 420) &&
      near(real420.svgHeight, 120) && near(real420.textScreenFont, 13, 0.3) &&
      real420.textFontAttr === "13",
      JSON.stringify({ mode: real420.mode, w: real420.svgWidth,
        h: real420.svgHeight, text: real420.textScreenFont }));

    const real420xl = await installAndLayout({
      id: "f-real420xl", mod: "svg", cardClass: "svg-container",
      attrs: { viewBox: "0 0 420 120" },
      text: "Block diagram", textSize: "13",
    }, { contentW: 1200, ref: 18.2, viewportH: 500 });
    check("inline svg regression: 420x120 is 546px with ~16.9px text at xlarge",
      near(real420xl.svgWidth, 546) && near(real420xl.svgHeight, 156) &&
      near(real420xl.textScreenFont, 16.9, 0.3),
      JSON.stringify({ w: real420xl.svgWidth, h: real420xl.svgHeight,
        text: real420xl.textScreenFont }));

    const real420wide = await installAndLayout({
      id: "f-real420wide", mod: "svg", cardClass: "svg-container",
      attrs: { viewBox: "0 0 420 120" },
      text: "Block diagram", textSize: "13",
    }, { contentW: 4000, ref: 18.2, viewportH: 500 });
    check("inline svg regression: a wide card never upscales past 546px at xlarge",
      near(real420wide.svgWidth, 546) &&
      near(real420wide.textScreenFont, 16.9, 0.3),
      JSON.stringify({ w: real420wide.svgWidth,
        text: real420wide.textScreenFont }));

    // ---------------------------------------------------------------
    section("3b. diagram cursor matches the lightbox click target");
    const cursorSpecs = [
      { id: "cur-mermaid", mod: "mermaid", cardClass: "mermaid-container",
        attrs: { viewBox: "0 0 200 100" }, marker: "mermaid" },
      { id: "cur-wavedrom", mod: "wavedrom", cardClass: "wavedrom-container",
        attrs: { viewBox: "0 0 480 60", width: "480", height: "60" },
        marker: "wavedrom" },
      { id: "cur-viz", mod: "viz", cardClass: "viz-container",
        attrs: { viewBox: "0 0 200 100", width: "120pt", height: "60pt" },
        marker: "viz" },
      { id: "cur-svg", mod: "svg", cardClass: "svg-container",
        attrs: { viewBox: "0 0 420 120" }, marker: "svg" },
    ];
    await installFigures(cursorSpecs);
    const cursorOverlays = {
      "cur-mermaid": "#mermaid-lightbox",
      "cur-wavedrom": "#wavedrom-lightbox",
      "cur-viz": "#viz-lightbox",
      "cur-svg": "#svg-lightbox",
    };
    for (const spec of cursorSpecs) {
      const cursors = await page.evaluate((cardId) => {
        const card = document.getElementById(cardId);
        const svg = card && card.querySelector(".nb-figure-viewport > svg");
        return {
          card: card ? getComputedStyle(card).cursor : "",
          svg: svg ? getComputedStyle(svg).cursor : "",
        };
      }, spec.id);
      check(spec.mod + ": the card and SVG use the same zoom-in cursor",
        cursors.card === "zoom-in" && cursors.svg === "zoom-in",
        JSON.stringify(cursors));

      const card = page.locator("#" + spec.id);
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      // Click the card's left padding, outside the SVG: the whole card is
      // the lightbox target, so this must open the overlay.
      await page.mouse.click(box.x + 4, box.y + box.height / 2);
      await page.waitForTimeout(120);
      const opened = await page.evaluate((sel) => {
        const overlay = document.querySelector(sel);
        return !!overlay && !overlay.hidden;
      }, cursorOverlays[spec.id]);
      check(spec.mod + ": clicking the card padding opens its lightbox", opened);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
    }

    // ---------------------------------------------------------------
    section("4. tall diagrams and page scroll");
    await boot("Long.md");
    await installFigures([
      { id: "f-a11y-scroll", mod: "mermaid", cardClass: "mermaid-container",
        attrs: { viewBox: "0 0 100 1000" } },
      { id: "f-a11y-normal", mod: "mermaid", cardClass: "mermaid-container",
        attrs: { viewBox: "0 0 100 50" } },
    ]);
    await applyLayout({
      "f-a11y-scroll": { contentW: 1000, ref: 14, viewportH: 500 },
      "f-a11y-normal": { contentW: 1000, ref: 14, viewportH: 500 },
    });
    const a11yScroll = await measure("f-a11y-scroll");
    const a11yNormal = await measure("f-a11y-normal");
    check("tall diagram has no inner scroller or scroll a11y",
      a11yScroll.mode === "tall" && a11yScroll.tabindex === null &&
      a11yScroll.role === null && a11yScroll.ariaLabel === null &&
      a11yScroll.overscrollY === "auto" &&
      a11yScroll.vpInlineHeight === "" && a11yScroll.vpInlineMaxHeight === "" &&
      a11yScroll.vpInlineOverflowY === "" &&
      a11yScroll.vpInlineScrollbarGutter === "" &&
      a11yScroll.overflowY === "visible" &&
      a11yScroll.scrollHeight <= a11yScroll.clientHeight + 1,
      JSON.stringify({ mode: a11yScroll.mode, tabindex: a11yScroll.tabindex,
        role: a11yScroll.role, aria: a11yScroll.ariaLabel,
        overscroll: a11yScroll.overscrollY, vpH: a11yScroll.vpInlineHeight,
        vpOverflow: a11yScroll.vpInlineOverflowY,
        overflow: a11yScroll.overflowY }));
    check("normal diagram is not a focus/scroll trap",
      a11yNormal.mode === "normal" && a11yNormal.tabindex === null &&
      a11yNormal.role === null && a11yNormal.ariaLabel === null &&
      a11yNormal.overscrollY === "auto" &&
      a11yNormal.vpInlineHeight === "" && a11yNormal.vpInlineOverflowY === "",
      JSON.stringify({ tabindex: a11yNormal.tabindex, role: a11yNormal.role,
        overscroll: a11yNormal.overscrollY,
        vpH: a11yNormal.vpInlineHeight }));

    // Wheel over the tall diagram: the note page scrolls; the wrapper
    // never does (there is no nested scroller).
    await page.evaluate(() => {
      const viewer = document.getElementById("viewer-content");
      viewer.scrollTop = 0;
      document.querySelector("#f-a11y-scroll .nb-figure-viewport").scrollTop = 0;
    });
    let sb = await box("#f-a11y-scroll .nb-figure-viewport");
    await page.mouse.move(sb.left + sb.width / 2, sb.top + Math.min(80, sb.height / 2));
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(250);
    const scrollState = await page.evaluate(() => ({
      viewer: document.getElementById("viewer-content").scrollTop,
      inner: document.querySelector("#f-a11y-scroll .nb-figure-viewport").scrollTop,
    }));
    check("wheel over a tall diagram scrolls the note page, not an inner scroller",
      scrollState.viewer > 0 && scrollState.inner === 0,
      JSON.stringify(scrollState));

    // Wheel over the normal diagram: the page-level scroller also
    // receives the event.
    await page.evaluate(() => {
      const viewer = document.getElementById("viewer-content");
      viewer.scrollTop = 0;
    });
    const beforePage = await page.evaluate(
      () => document.getElementById("viewer-content").scrollTop);
    const nb = await box("#f-a11y-normal svg");
    await page.mouse.move(nb.left + nb.width / 2, nb.top + nb.height / 2);
    await page.mouse.wheel(0, 320);
    await page.waitForTimeout(250);
    const afterPage = await page.evaluate(
      () => document.getElementById("viewer-content").scrollTop);
    check("wheel over a normal diagram still scrolls the page",
      afterPage > beforePage,
      JSON.stringify({ before: beforePage, after: afterPage }));

    // ---------------------------------------------------------------
    section("5. lightbox from a tall diagram");
    await installFigures([{
      id: "f-lb", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 100 1000" },
    }]);
    await applyLayout({
      "f-lb": { contentW: 1000, ref: 14, viewportH: 500 },
    });
    await page.evaluate(() => {
      document.getElementById("viewer-content").scrollTop = 50;
    });
    const lbSvg = await box("#f-lb .nb-figure-viewport > svg");
    const beforeLb = await page.evaluate(() => ({
      page: document.getElementById("viewer-content").scrollTop,
    }));
    await page.mouse.click(lbSvg.left + Math.min(20, lbSvg.width / 2),
      Math.max(0, lbSvg.top) + 40);
    await page.waitForTimeout(200);
    const opened = await page.evaluate(() => {
      const overlay = document.getElementById("mermaid-lightbox");
      const body = document.getElementById("mermaid-lightbox-body");
      return {
        open: !!overlay && !overlay.hidden,
        fit: !!body && body.classList.contains("svg-fit"),
        clone: !!(body && body.querySelector("svg")),
        percent: (document.getElementById("mlb-zoom-pct") || {}).textContent,
      };
    });
    check("clicking a tall diagram opens the lightbox in fit mode",
      opened.open && opened.fit && opened.clone,
      JSON.stringify(opened));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => ({
      hidden: document.getElementById("mermaid-lightbox").hidden,
      empty: document.getElementById("mermaid-lightbox-body").children.length === 0,
      page: document.getElementById("viewer-content").scrollTop,
    }));
    check("closing restores the page scroll position",
      closed.hidden && closed.empty && closed.page === beforeLb.page,
      JSON.stringify({ before: beforeLb, after: closed }));

    const gutter = await page.evaluate(() => {
      const vp = document.querySelector("#f-lb .nb-figure-viewport");
      const r = vp.getBoundingClientRect();
      // Left gutter: inside the wrapper, outside the centred SVG and
      // below the top bar.
      return { x: r.left + 6, y: r.top + 80 };
    });
    await page.mouse.click(gutter.x, gutter.y);
    await page.waitForTimeout(200);
    const gutterState = await page.evaluate(() => {
      const overlay = document.getElementById("mermaid-lightbox");
      const vp = document.querySelector("#f-lb .nb-figure-viewport");
      const hit = document.elementFromPoint(
        vp.getBoundingClientRect().left + 6,
        vp.getBoundingClientRect().top + 80);
      return {
        hidden: overlay.hidden,
        hitIsViewport: hit === vp,
      };
    });
    check("clicking the wrapper gutter opens the lightbox normally",
      !gutterState.hidden,
      JSON.stringify(gutterState));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    // ---------------------------------------------------------------
    section("6. phone / media tokens");
    await page.setViewportSize(PHONE_VIEW);
    await boot("Phone.md");
    const phoneRef = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-9999px;top:0;width:var(--nb-ref-size);height:1px";
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return {
        width: w,
        token: getComputedStyle(document.documentElement)
          .getPropertyValue("--nb-ref-size").trim(),
        uiMode: getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-mode").trim(),
      };
    });
    check("phone: --nb-ref-size is 16px at medium",
      phoneRef.uiMode === "phone" && near(phoneRef.width, 16, 0.5),
      JSON.stringify(phoneRef));
    await setFontSize("large");
    await page.waitForTimeout(200);
    const phoneRefLarge = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-9999px;top:0;width:var(--nb-ref-size);height:1px";
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    });
    check("phone: --nb-ref-size follows the font scale (16 x 1.15)",
      near(phoneRefLarge, 16 * 1.15, 0.5),
      JSON.stringify({ width: phoneRefLarge }));
    await setFontSize("medium");
    await page.waitForTimeout(150);

    await installFigures([{
      id: "f-phone", mod: "mermaid", cardClass: "mermaid-container",
      attrs: { viewBox: "0 0 140 800" },
    }]);
    const phoneFigure = await measure("f-phone");
    check("phone: a tall diagram grows the page with no inner scroller",
      phoneFigure.mode === "tall" && phoneFigure.overflowY === "visible" &&
      phoneFigure.vpInlineHeight === "" && phoneFigure.vpInlineMaxHeight === "" &&
      phoneFigure.vpInlineOverflowY === "" &&
      phoneFigure.tabindex === null && phoneFigure.role === null &&
      phoneFigure.ariaLabel === null &&
      phoneFigure.clientHeight > 0 &&
      phoneFigure.scrollHeight <= phoneFigure.clientHeight + 1 &&
      phoneFigure.cardHeight >= phoneFigure.svgHeight - 1,
      JSON.stringify({ mode: phoneFigure.mode, clientH: phoneFigure.clientHeight,
        scrollH: phoneFigure.scrollHeight, h: phoneFigure.svgHeight,
        cardH: phoneFigure.cardHeight, vpH: phoneFigure.vpInlineHeight }));
    check("phone: the diagram fits the measure without upscaling",
      phoneFigure.svgWidth <= phoneFigure.clientWidth + 1,
      JSON.stringify({ w: phoneFigure.svgWidth, client: phoneFigure.clientWidth }));
    const phoneOverflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      inner: window.innerWidth,
    }));
    check("phone: no page horizontal scroll",
      phoneOverflow.doc <= phoneOverflow.inner + 1 &&
      phoneOverflow.body <= phoneOverflow.inner + 1,
      JSON.stringify(phoneOverflow));
    await page.setViewportSize(VIEW);
    await page.waitForTimeout(150);

    // ---------------------------------------------------------------
    section("7. HTML export tokens and print cap");
    await boot("ExportFig.md");
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .svg-container .nb-figure-viewport svg"),
      null, { timeout: 20000 });
    const dlPromise = page.waitForEvent("download", { timeout: 40000 })
      .then((d) => ({ download: d }), (err) => ({ error: err }));
    await page.evaluate(() => NB.export.exportHtml("current"));
    const dlEvent = await dlPromise;
    let htmlText = "";
    let htmlPath = "";
    if (dlEvent.error) {
      check("HTML export fires a real download event", false,
        String(dlEvent.error));
    } else {
      htmlPath = path.join(tmp, "figure-export.html");
      await dlEvent.download.saveAs(htmlPath);
      htmlText = fs.readFileSync(htmlPath, "utf8");
      check("HTML export fires a real download event", htmlText.length > 0,
        "bytes=" + htmlText.length);
      check("exported HTML keeps the figure wrapper and ref token",
        htmlText.includes("nb-figure-viewport") &&
        /--nb-ref-size:\s*16px/.test(htmlText) &&
        !/--nb-viewport-h/.test(htmlText),
        "wrapper=" + htmlText.includes("nb-figure-viewport"));
      check("exported HTML carries the font figure sizing rule, not fluid",
        (/data-nb-sizing=\\"font\\"/.test(htmlText) ||
         /data-nb-sizing="font"/.test(htmlText)) &&
        !/data-nb-sizing=\\"fluid\\"/.test(htmlText) &&
        !/data-nb-sizing="fluid"/.test(htmlText),
        "has font rule=" + /data-nb-sizing="font"/.test(htmlText));
      check("exported print CSS caps a figure at 180mm",
        /@media print/.test(htmlText) &&
        /\.nb-figure-viewport\{max-height:180mm!important/.test(htmlText),
        "180mm=" + htmlText.includes("180mm"));
    }
    if (htmlPath) {
      const page2 = await ctx.newPage();
      const page2Errors = [];
      const page2Console = [];
      page2.on("pageerror", (e) => recordPageError(page2Errors, e));
      page2.on("console", (m) => {
        if (m.type() === "error") page2Console.push(m.text());
      });
      await page2.goto("file://" + htmlPath, { waitUntil: "load", timeout: 20000 });
      await page2.waitForTimeout(300);
      const exported = await page2.evaluate(() => {
        const vp = document.querySelector(".nb-figure-viewport");
        if (!vp) return { missing: true };
        const cs = getComputedStyle(vp);
        const svg = vp.querySelector("svg");
        return {
          mode: vp.dataset.nbMode || "",
          overflowY: cs.overflowY,
          inlineHeight: vp.style.height || "",
          inlineOverflowY: vp.style.overflowY || "",
          clientHeight: vp.clientHeight,
          scrollHeight: vp.scrollHeight,
          svgHeight: svg ? svg.getBoundingClientRect().height : 0,
          pageScrollHeight: document.documentElement.scrollHeight,
          token: getComputedStyle(document.documentElement)
            .getPropertyValue("--nb-ref-size").trim(),
        };
      });
      check("exported HTML has no inner figure scrollbar and grows the page",
        !exported.missing && exported.overflowY === "visible" &&
        exported.inlineHeight === "" && exported.inlineOverflowY === "" &&
        exported.scrollHeight <= exported.clientHeight + 1 &&
        exported.svgHeight > 900 && exported.pageScrollHeight > exported.svgHeight,
        JSON.stringify(exported));
      check("exported HTML page has no errors",
        page2Errors.length === 0 && page2Console.length === 0,
        JSON.stringify(page2Errors.concat(page2Console)));
      await page2.close();
    }

    // ---------------------------------------------------------------
    section("8. hybrid round-trip of a tall diagram");
    await boot("Roundtrip.md");
    const original = fs.readFileSync(path.join(DATA, "Roundtrip.md"));
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .svg-container .nb-figure-viewport svg"),
      null, { timeout: 20000 });
    await page.waitForTimeout(220);
    const roundtripMode = await page.evaluate(() =>
      (document.querySelector("#viewer-content .svg-container .nb-figure-viewport") || {})
        .dataset.nbMode || "");
    check("hybrid fixture renders in tall mode before editing",
      roundtripMode === "tall", "mode=" + roundtripMode);
    await page.click("#hybrid-toggle");
    await page.waitForFunction(() => NB.hybrid.isActive(), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const diagBox = await box("#viewer-content .svg-container .nb-figure-viewport > svg");
    await page.mouse.click(diagBox.left + Math.min(20, diagBox.width / 2),
      diagBox.top + 40);
    const editing = await page.waitForFunction(
      () => document.querySelector("#viewer-content pre.hybrid-plugin-editing"),
      null, { timeout: 8000 }).then(() => true).catch(() => false);
    check("hybrid: clicking the rendered diagram opens its fence source",
      editing);
    if (editing) {
      await page.keyboard.press("Escape");
    }
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .svg-container .nb-figure-viewport svg"),
      null, { timeout: 20000 }).catch(() => {});
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(700);
    const after = fs.readFileSync(path.join(DATA, "Roundtrip.md"));
    check("hybrid: saving a tall diagram leaves the source byte-identical",
      Buffer.compare(original, after) === 0,
      "before=" + original.length + "B after=" + after.length + "B " +
        JSON.stringify(after.toString("utf8").slice(0, 120)));

    // ---------------------------------------------------------------
    section("9. real Mermaid: natural width and label scale");
    await boot("FigMermaid.md");
    await setFontSize("medium");
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .mermaid-container .nb-figure-viewport svg"),
      null, { timeout: 30000 });
    await page.waitForTimeout(350);

    // Mermaid emits width="100%" plus an inline max-width holding the
    // natural size. prepareSvg clears the max-width once it records the
    // factor, so read a fresh library render to keep the original value.
    const mermaidRaw = await page.evaluate(async (src) => {
      const rendered = await window.mermaid.render("nb-natural-probe", src);
      const host = document.createElement("div");
      host.innerHTML = rendered.svg;
      const svg = host.querySelector("svg");
      const vb = String(svg.getAttribute("viewBox") || "")
        .trim().split(/[\s,]+/).map(Number);
      const stray = document.getElementById("dnb-natural-probe");
      if (stray) stray.remove();
      return {
        widthAttr: svg.getAttribute("width"),
        maxWidth: svg.style.maxWidth || "",
        viewBoxW: vb.length === 4 ? vb[2] : 0,
        viewBoxH: vb.length === 4 ? vb[3] : 0,
      };
    }, FIGURE_MERMAID);
    const mermaidNatural = parseFloat(mermaidRaw.maxWidth);
    check("mermaid: fresh library render still exposes its natural max-width",
      mermaidRaw.widthAttr === "100%" && mermaidNatural > 0 &&
      mermaidRaw.viewBoxW > 0,
      JSON.stringify(mermaidRaw));

    async function measureMermaidFigure() {
      return page.evaluate(() => {
        const card = document.querySelector("#viewer-content .mermaid-container");
        const vp = card && card.querySelector(".nb-figure-viewport");
        const svg = vp && vp.querySelector("svg");
        if (!svg) return { missing: true };
        const vb = String(svg.getAttribute("viewBox") || "")
          .trim().split(/[\s,]+/).map(Number);
        const sr = svg.getBoundingClientRect();
        const scale = vb.length === 4 && vb[2] > 0 ? sr.width / vb[2] : 0;
        let label = null;
        // Mermaid v11 flowcharts label nodes with HTML in a foreignObject,
        // so getScreenCTM does not apply. The viewBox-to-display scale is
        // the equivalent transform for the HTML label.
        const htmlLabel = svg.querySelector("foreignObject .nodeLabel");
        if (htmlLabel) {
          const lr = htmlLabel.getBoundingClientRect();
          const font = parseFloat(getComputedStyle(htmlLabel).fontSize);
          label = {
            kind: "html", text: htmlLabel.textContent, font: font,
            screen: font * scale, width: lr.width, height: lr.height,
          };
        } else {
          const text = svg.querySelector("text");
          if (text) {
            const ctm = text.getScreenCTM && text.getScreenCTM();
            const font = parseFloat(getComputedStyle(text).fontSize);
            label = {
              kind: "svg-text", text: text.textContent, font: font,
              screen: ctm ? font * ctm.a : null, width: 0, height: 0,
            };
          }
        }
        return {
          viewBoxW: vb.length === 4 ? vb[2] : 0,
          viewBoxH: vb.length === 4 ? vb[3] : 0,
          width: sr.width,
          height: sr.height,
          scale: scale,
          mode: vp.dataset.nbMode || "",
          cardWidth: card.getBoundingClientRect().width,
          cardContentWidth: vp.clientWidth,
          ref: parseFloat(getComputedStyle(card).fontSize),
          label: label,
        };
      });
    }

    const mermaidMid = await measureMermaidFigure();
    check("mermaid: medium uses the natural width, not an inflated viewBox",
      !mermaidMid.missing && mermaidMid.mode === "normal" &&
      near(mermaidMid.width, mermaidNatural, 1) &&
      mermaidMid.width <= mermaidNatural + 1 &&
      mermaidMid.width < mermaidMid.cardContentWidth,
      JSON.stringify({ width: mermaidMid.width, natural: mermaidNatural,
        viewBoxW: mermaidMid.viewBoxW, mode: mermaidMid.mode,
        cardContent: mermaidMid.cardContentWidth }));
    check("mermaid: medium keeps the viewBox aspect ratio",
      near(mermaidMid.height,
        mermaidMid.viewBoxH * (mermaidMid.width / mermaidMid.viewBoxW), 1),
      JSON.stringify({ width: mermaidMid.width, height: mermaidMid.height,
        viewBoxW: mermaidMid.viewBoxW, viewBoxH: mermaidMid.viewBoxH }));
    check("mermaid: a visible label is prose-plausible and matches the display scale",
      !!mermaidMid.label && mermaidMid.label.screen >= 10 &&
      mermaidMid.label.screen <= 24 && near(mermaidMid.scale, 1, 0.03) &&
      near(mermaidMid.label.screen, mermaidMid.label.font * mermaidMid.scale, 0.5),
      JSON.stringify({ label: mermaidMid.label, scale: mermaidMid.scale }));

    await setFontSize("xlarge");
    await page.waitForTimeout(350);
    const mermaidXl = await measureMermaidFigure();
    check("mermaid: xlarge scales the laid-out SVG ~1.3x",
      near(mermaidXl.width, mermaidMid.width * 1.3, 2) &&
      near(mermaidXl.height, mermaidMid.height * 1.3, 2) &&
      near(mermaidXl.scale, 1.3, 0.03),
      JSON.stringify({ medium: [mermaidMid.width, mermaidMid.height],
        xlarge: [mermaidXl.width, mermaidXl.height],
        scale: mermaidXl.scale }));
    check("mermaid: label grows with the diagram, no huge text",
      !!mermaidXl.label &&
      near(mermaidXl.label.screen, mermaidMid.label.screen * 1.3, 1) &&
      mermaidXl.label.screen <= 32 &&
      near(mermaidXl.label.width, mermaidMid.label.width * 1.3, 2),
      JSON.stringify({ medium: mermaidMid.label,
        xlarge: mermaidXl.label }));
    await setFontSize("medium");
    await page.waitForTimeout(200);

    // ---------------------------------------------------------------
    section("10. real WaveDrom: text scale");
    await boot("FigWavedrom.md");
    await setFontSize("medium");
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .wavedrom-container .nb-figure-viewport svg"),
      null, { timeout: 30000 });
    await page.waitForTimeout(350);

    async function measureWaveDromFigure() {
      return page.evaluate(() => {
        const card = document.querySelector("#viewer-content .wavedrom-container");
        const vp = card && card.querySelector(".nb-figure-viewport");
        const svg = vp && vp.querySelector("svg");
        if (!svg) return { missing: true };
        const vb = String(svg.getAttribute("viewBox") || "")
          .trim().split(/[\s,]+/).map(Number);
        const sr = svg.getBoundingClientRect();
        const text = svg.querySelector("text");
        const ctm = text && text.getScreenCTM && text.getScreenCTM();
        const font = text ? parseFloat(getComputedStyle(text).fontSize) : null;
        return {
          viewBoxW: vb.length === 4 ? vb[2] : 0,
          viewBoxH: vb.length === 4 ? vb[3] : 0,
          width: sr.width,
          height: sr.height,
          mode: vp.dataset.nbMode || "",
          cardContentWidth: vp.clientWidth,
          ref: parseFloat(getComputedStyle(card).fontSize),
          label: text ? {
            text: text.textContent,
            font: font,
            ctm: ctm ? ctm.a : null,
            screen: ctm ? font * ctm.a : null,
          } : null,
        };
      });
    }

    const waveMid = await measureWaveDromFigure();
    check("wavedrom: real waveform is at its natural size with no huge text",
      !waveMid.missing && waveMid.mode === "normal" &&
      near(waveMid.width, waveMid.viewBoxW, 1) &&
      near(waveMid.height, waveMid.viewBoxH, 1) &&
      waveMid.width < waveMid.cardContentWidth &&
      !!waveMid.label && waveMid.label.screen >= 9 &&
      waveMid.label.screen <= 24,
      JSON.stringify({ width: waveMid.width, height: waveMid.height,
        viewBox: [waveMid.viewBoxW, waveMid.viewBoxH],
        label: waveMid.label }));
    check("wavedrom: label screen size tracks the viewBox-to-display matrix",
      !!waveMid.label && waveMid.label.ctm > 0 &&
      near(waveMid.label.screen,
        waveMid.label.font * (waveMid.width / waveMid.viewBoxW), 0.3),
      JSON.stringify(waveMid.label));

    await setFontSize("xlarge");
    await page.waitForTimeout(350);
    const waveXl = await measureWaveDromFigure();
    check("wavedrom: xlarge scales the SVG and its labels ~1.3x",
      near(waveXl.width, waveMid.width * 1.3, 2) &&
      near(waveXl.height, waveMid.height * 1.3, 2) &&
      !!waveXl.label &&
      near(waveXl.label.screen, waveMid.label.screen * 1.3, 0.5) &&
      waveXl.label.screen <= 32,
      JSON.stringify({ medium: [waveMid.width, waveMid.height,
        waveMid.label.screen], xlarge: [waveXl.width, waveXl.height,
        waveXl.label.screen] }));
    await setFontSize("medium");
    await page.waitForTimeout(200);

    // ---------------------------------------------------------------
    section("11. real Graphviz: pt to CSS px and text scale");
    await boot("FigDot.md");
    await setFontSize("medium");
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .viz-container .nb-figure-viewport svg"),
      null, { timeout: 90000 });
    await page.waitForTimeout(400);

    async function measureVizFigure() {
      return page.evaluate(() => {
        const card = document.querySelector("#viewer-content .viz-container");
        const vp = card && card.querySelector(".nb-figure-viewport");
        const svg = vp && vp.querySelector("svg");
        if (!svg) return { missing: true };
        const vb = String(svg.getAttribute("viewBox") || "")
          .trim().split(/[\s,]+/).map(Number);
        const sr = svg.getBoundingClientRect();
        const text = svg.querySelector("text");
        const ctm = text && text.getScreenCTM && text.getScreenCTM();
        const font = text ? parseFloat(getComputedStyle(text).fontSize) : null;
        return {
          viewBoxW: vb.length === 4 ? vb[2] : 0,
          viewBoxH: vb.length === 4 ? vb[3] : 0,
          origWidth: svg.dataset.nbOrigWidth || "",
          origHeight: svg.dataset.nbOrigHeight || "",
          width: sr.width,
          height: sr.height,
          mode: vp.dataset.nbMode || "",
          cardContentWidth: vp.clientWidth,
          ref: parseFloat(getComputedStyle(card).fontSize),
          label: text ? {
            text: text.textContent,
            font: font,
            ctm: ctm ? ctm.a : null,
            screen: ctm ? font * ctm.a : null,
          } : null,
        };
      });
    }

    const vizMid = await measureVizFigure();
    const vizPtW = parseFloat(vizMid.origWidth);
    check("graphviz: the captured pt width becomes 4/3 CSS px at medium",
      !vizMid.missing && /pt$/.test(vizMid.origWidth) && vizPtW > 0 &&
      near(vizMid.width, vizPtW * 4 / 3, 1) &&
      vizMid.mode === "normal" &&
      vizMid.width < vizMid.cardContentWidth,
      JSON.stringify({ orig: vizMid.origWidth, width: vizMid.width,
        expected: vizPtW * 4 / 3, viewBoxW: vizMid.viewBoxW,
        mode: vizMid.mode }));
    check("graphviz: no huge text; label matches the viewBox-to-display scale",
      !!vizMid.label && vizMid.label.screen >= vizMid.ref * 0.8 &&
      vizMid.label.screen <= vizMid.ref * 2 &&
      near(vizMid.label.screen,
        vizMid.label.font * (vizMid.width / vizMid.viewBoxW), 0.5),
      JSON.stringify(vizMid.label));

    await setFontSize("xlarge");
    await page.waitForTimeout(350);
    const vizXl = await measureVizFigure();
    check("graphviz: xlarge scales the graph and its labels ~1.3x",
      near(vizXl.width, vizMid.width * 1.3, 2) &&
      near(vizXl.height, vizMid.height * 1.3, 2) &&
      near(vizXl.width, vizPtW * 4 / 3 * 1.3, 2) &&
      !!vizXl.label &&
      near(vizXl.label.screen, vizMid.label.screen * 1.3, 0.5) &&
      vizXl.label.screen <= 32,
      JSON.stringify({ medium: [vizMid.width, vizMid.height,
        vizMid.label.screen], xlarge: [vizXl.width, vizXl.height,
        vizXl.label.screen] }));
    await setFontSize("medium");
    await page.waitForTimeout(200);

    // ---------------------------------------------------------------
    section("12. real KaTeX: fit-to-width, wrapped code, no inner scroll");
    await boot("FigKatex.md");
    await setFontSize("medium");
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .katex-container .katex-display"),
      null, { timeout: 30000 });
    await page.waitForTimeout(300);

    async function measureKatex() {
      return page.evaluate(() => {
        const card = document.querySelector("#viewer-content .katex-container");
        const display = card && card.querySelector(".katex-display");
        if (!display) return { missing: true };
        const katex = display.querySelector(".katex");
        const prose = document.querySelector("#viewer-content p");
        const dr = display.getBoundingClientRect();
        return {
          cardFont: parseFloat(getComputedStyle(card).fontSize),
          displayFont: parseFloat(getComputedStyle(display).fontSize),
          katexFont: katex ? parseFloat(getComputedStyle(katex).fontSize) : null,
          katexWidth: katex ? katex.getBoundingClientRect().width : null,
          proseFont: prose ? parseFloat(getComputedStyle(prose).fontSize) : null,
          hasViewport: !!card.querySelector(".nb-figure-viewport"),
          displayWidth: dr.width,
          scrollWidth: display.scrollWidth,
          clientWidth: display.clientWidth,
          overflowX: getComputedStyle(display).overflowX,
          cardOverflowX: getComputedStyle(card).overflowX,
          cardWidth: card.getBoundingClientRect().width,
          pageScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
    }

    const katexMid = await measureKatex();
    check("katex: the display equation is prose/card sized, not figure-scaled",
      !katexMid.missing && !katexMid.hasViewport &&
      near(katexMid.displayFont, katexMid.proseFont, 1) &&
      near(katexMid.cardFont, katexMid.proseFont, 1),
      JSON.stringify(katexMid));
    check("katex: the typeset block keeps its own 1.21em ratio, no second scale",
      katexMid.katexFont != null &&
      near(katexMid.katexFont, katexMid.displayFont * 1.21, 0.2),
      JSON.stringify({ display: katexMid.displayFont,
        katex: katexMid.katexFont }));

    await setFontSize("xlarge");
    await page.waitForTimeout(350);
    const katexXl = await measureKatex();
    check("katex: xlarge follows prose exactly (display = prose = x1.3)",
      near(katexXl.displayFont, katexXl.proseFont, 1) &&
      near(katexXl.displayFont, katexMid.displayFont * 1.3, 0.4) &&
      katexXl.katexFont != null &&
      near(katexXl.katexFont, katexXl.displayFont * 1.21, 0.2),
      JSON.stringify({ medium: [katexMid.displayFont, katexMid.proseFont,
        katexMid.katexFont], xlarge: [katexXl.displayFont, katexXl.proseFont,
        katexXl.katexFont] }));
    await setFontSize("medium");
    await page.waitForTimeout(200);

    await boot("FigWideKatex.md");
    await setFontSize("medium");
    await page.waitForFunction(
      () => document.querySelector("#viewer-content .katex-container .katex-display"),
      null, { timeout: 30000 });
    await page.waitForTimeout(300);
    for (const fsName of ["medium", "xlarge"]) {
      if (fsName !== "medium") {
        await setFontSize(fsName);
        await page.waitForTimeout(350);
      }
      const wide = await measureKatex();
      check("katex " + fsName + ": a wide equation fits by reducing its font, no scrollbar",
        !wide.missing && wide.overflowX !== "auto" &&
        wide.scrollWidth <= wide.clientWidth + 1 &&
        wide.katexWidth != null && wide.katexWidth <= wide.clientWidth + 1 &&
        wide.displayFont < wide.proseFont - 0.5 &&
        wide.pageScrollWidth <= wide.innerWidth + 1 &&
        wide.bodyScrollWidth <= wide.innerWidth + 1,
        JSON.stringify({ overflowX: wide.overflowX,
          scrollW: wide.scrollWidth, clientW: wide.clientWidth,
          katexW: wide.katexWidth, displayFont: wide.displayFont,
          proseFont: wide.proseFont,
          pageScrollW: wide.pageScrollWidth, innerW: wide.innerWidth }));
    }

    // Long single-line code fence in the same note: it must wrap, not
    // create an inner horizontal scrollbar.
    async function measureWrappedCode() {
      return page.evaluate(() => {
        const pre = document.querySelector("#viewer-content pre");
        const code = pre && pre.querySelector("code");
        if (!pre || !code) return { missing: true };
        return {
          codeClass: code.className,
          preScrollWidth: pre.scrollWidth,
          preClientWidth: pre.clientWidth,
          preWhiteSpace: getComputedStyle(pre).whiteSpace,
          preOverflowX: getComputedStyle(pre).overflowX,
          codeScrollWidth: code.scrollWidth,
          codeClientWidth: code.clientWidth,
          codeWhiteSpace: getComputedStyle(code).whiteSpace,
          codeOverflowX: getComputedStyle(code).overflowX,
          pageScrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
    }
    const codeMid = await measureWrappedCode();
    check("code: a long single line wraps with no inner horizontal scrollbar",
      !codeMid.missing &&
      codeMid.preScrollWidth <= codeMid.preClientWidth + 1 &&
      codeMid.codeScrollWidth <= codeMid.codeClientWidth + 1 &&
      codeMid.preWhiteSpace === "pre-wrap" &&
      codeMid.codeWhiteSpace === "pre-wrap" &&
      codeMid.preOverflowX !== "auto" &&
      codeMid.codeOverflowX !== "auto" &&
      codeMid.pageScrollWidth <= codeMid.innerWidth + 1,
      JSON.stringify(codeMid));
    check("code: the highlighted code element carries the app wrap override",
      !codeMid.missing && /\bhljs\b/.test(codeMid.codeClass || ""),
      JSON.stringify({ codeClass: codeMid.codeClass }));

    // Exported HTML: same no-scroll CSS, plus the standalone inline
    // fit-to-width script for the downloaded doc and the Paged.js iframe.
    const mathDlPromise = page.waitForEvent("download", { timeout: 40000 });
    await page.evaluate(() => NB.export.exportHtml("current"));
    const mathDl = await mathDlPromise;
    const mathExportPath = path.join(tmp, "math-code-export.html");
    await mathDl.saveAs(mathExportPath);
    const mathHtml = fs.readFileSync(mathExportPath, "utf8");
    check("exported HTML carries the inline standalone math fit script",
      /__nbFitMath/.test(mathHtml) &&
      /function fitOne/.test(mathHtml) &&
      /katex-display/.test(mathHtml));
    check("exported HTML has no math/code scrollbar CSS",
      /\.markdown-body pre\{[^}]*white-space:pre-wrap[^}]*overflow-x:clip/.test(mathHtml) &&
      /\.katex-container \.katex-display\{[^}]*text-align:center/.test(mathHtml) &&
      !/\.katex-container \.katex-display\{[^}]*overflow-x:auto/.test(mathHtml) &&
      /\.mermaid-source[^{]*\{[^}]*overflow-x:clip/.test(mathHtml),
      "preWrap=" + /\.markdown-body pre\{[^}]*white-space:pre-wrap/.test(mathHtml));

    const mathPage = await ctx.newPage();
    const mathErrors = [];
    mathPage.on("pageerror", (e) => mathErrors.push(String(e)));
    await mathPage.goto("file://" + mathExportPath, { waitUntil: "load", timeout: 20000 });
    await mathPage.waitForTimeout(600);
    const mathExport = await mathPage.evaluate(() => {
      const display = document.querySelector(".katex-container .katex-display");
      const pre = document.querySelector("pre");
      const code = pre && pre.querySelector("code");
      return {
        hasFitScript: typeof window.__nbFitMath === "function",
        displayOverflowX: display ? getComputedStyle(display).overflowX : null,
        displayClientWidth: display ? display.clientWidth : 0,
        displayScrollWidth: display ? display.scrollWidth : 0,
        preScrollWidth: pre ? pre.scrollWidth : 0,
        preClientWidth: pre ? pre.clientWidth : 0,
        preWhiteSpace: pre ? getComputedStyle(pre).whiteSpace : null,
        codeScrollWidth: code ? code.scrollWidth : 0,
        codeClientWidth: code ? code.clientWidth : 0,
        codeWhiteSpace: code ? getComputedStyle(code).whiteSpace : null,
        pageScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    check("exported HTML math/code has no inner scrollbar and no page overflow",
      mathExport.hasFitScript &&
      mathExport.displayOverflowX !== "auto" &&
      mathExport.displayScrollWidth <= mathExport.displayClientWidth + 1 &&
      mathExport.preScrollWidth <= mathExport.preClientWidth + 1 &&
      mathExport.preWhiteSpace === "pre-wrap" &&
      mathExport.codeScrollWidth <= mathExport.codeClientWidth + 1 &&
      mathExport.codeWhiteSpace === "pre-wrap" &&
      mathExport.pageScrollWidth <= mathExport.innerWidth + 1,
      JSON.stringify(mathExport));
    check("exported HTML fit script runs without page errors",
      mathErrors.length === 0, JSON.stringify(mathErrors));
    await mathPage.close();

    await setFontSize("medium");
    await page.waitForTimeout(200);

    // ---------------------------------------------------------------
    section("13. real html-live: frame width, font isolation, auto-fit");
    // A sandboxed srcdoc frame trips Playwright's service-worker probe
    // when the context blocks service workers, so use a separate context
    // that leaves the service-worker option at its default. This keeps
    // the suite's existing "no uncaught page errors" check untouched.
    const htmlCtx = await browser.newContext({ viewport: VIEW });
    const htmlPage = await htmlCtx.newPage();
    const htmlErrors = [];
    htmlPage.on("pageerror", (e) => recordPageError(htmlErrors, e));

    async function bootHtml(file) {
      await htmlPage.goto(BASE + "/?file=" + encodeURIComponent(file));
      await htmlPage.waitForFunction(
        () => window.NB && NB.htmlpreview && NB.app,
        null, { timeout: 20000 });
      await htmlPage.waitForSelector("#viewer-content h1", { timeout: 15000 });
      await htmlPage.waitForFunction(
        () => document.querySelector("#viewer-content .htmlpreview-card iframe"),
        null, { timeout: 20000 });
      await htmlPage.waitForTimeout(900);
    }
    async function setHtmlFont(name) {
      await htmlPage.evaluate((n) => NB.app.setFontSize(n), name);
      await htmlPage.waitForTimeout(600);
    }
    async function measureHtmlCard() {
      return htmlPage.evaluate(() => {
        const card = document.querySelector("#viewer-content .htmlpreview-card");
        const frame = card && card.querySelector("iframe.htmlpreview-frame");
        if (!frame) return { missing: true };
        const fr = frame.getBoundingClientRect();
        return {
          cardWidth: card.getBoundingClientRect().width,
          cardContentWidth: card.clientWidth,
          frameWidth: fr.width,
          frameHeight: fr.height,
          styleHeight: frame.style.height,
          sandbox: frame.getAttribute("sandbox"),
        };
      });
    }
    async function measureHtmlFrame() {
      const frame = htmlPage.frames().find((f) => f !== htmlPage.mainFrame());
      if (!frame) return { missing: true };
      return frame.evaluate(() => {
        const demo = document.querySelector(".demo");
        return {
          demoFont: demo ? parseFloat(getComputedStyle(demo).fontSize) : null,
          bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
          docScrollH: document.documentElement.scrollHeight,
          bodyScrollH: document.body.scrollHeight,
          innerH: window.innerHeight,
          clientH: document.documentElement.clientHeight,
          docScrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
          demoHeight: demo ? demo.getBoundingClientRect().height : null,
          demoScrollH: demo ? demo.scrollHeight : null,
          demoClientH: demo ? demo.clientHeight : null,
          demoOverflowY: demo ? getComputedStyle(demo).overflowY : null,
        };
      });
    }

    await bootHtml("FigHtmlLive.md");
    await setHtmlFont("medium");
    const htmlMidCard = await measureHtmlCard();
    const htmlMidFrame = await measureHtmlFrame();
    check("html-live: the iframe spans the card content width",
      !htmlMidCard.missing && !htmlMidFrame.missing &&
      near(htmlMidCard.frameWidth, htmlMidCard.cardContentWidth, 1) &&
      htmlMidCard.frameWidth < htmlMidCard.cardWidth,
      JSON.stringify(htmlMidCard));
    check("html-live: default preview has no inner scrollbar and fits its content",
      !htmlMidFrame.missing &&
      htmlMidFrame.docScrollH <= htmlMidFrame.innerH + 1 &&
      htmlMidFrame.bodyScrollH <= htmlMidFrame.innerH + 1 &&
      htmlMidCard.frameHeight >= htmlMidFrame.demoHeight - 1,
      JSON.stringify({ outer: htmlMidCard, frame: htmlMidFrame }));
    check("html-live: the demo keeps its authored 20px font at medium",
      near(htmlMidFrame.demoFont, 20, 0.5),
      "demoFont=" + htmlMidFrame.demoFont);

    await setHtmlFont("xlarge");
    const htmlXlCard = await measureHtmlCard();
    const htmlXlFrame = await measureHtmlFrame();
    check("html-live: the app font scale does not resize the sandboxed demo",
      !htmlXlFrame.missing &&
      near(htmlXlFrame.demoFont, htmlMidFrame.demoFont, 0.5) &&
      near(htmlXlCard.frameWidth, htmlXlCard.cardContentWidth, 1),
      JSON.stringify({ medium: htmlMidFrame.demoFont,
        xlarge: htmlXlFrame.demoFont,
        frameWidth: htmlXlCard.frameWidth,
        cardContent: htmlXlCard.cardContentWidth }));
    check("html-live: font-scale change leaves the auto-fitted card unchanged",
      near(htmlXlCard.frameHeight, htmlMidCard.frameHeight, 1) &&
      htmlXlFrame.docScrollH <= htmlXlFrame.innerH + 1,
      JSON.stringify({ medium: htmlMidCard.frameHeight,
        xlarge: htmlXlCard.frameHeight }));

    await bootHtml("FigHtmlLiveTall.md");
    await setHtmlFont("medium");
    const tallCard = await measureHtmlCard();
    const tallFrame = await measureHtmlFrame();
    check("html-live: a tall demo grows the frame to fit, with no inner scrollbar",
      !tallCard.missing && !tallFrame.missing &&
      tallFrame.demoHeight >= 600 &&
      tallCard.frameHeight >= tallFrame.demoHeight - 1 &&
      parseFloat(tallCard.styleHeight) >= tallFrame.demoHeight - 1 &&
      tallFrame.docScrollH <= tallFrame.innerH + 1 &&
      tallFrame.bodyScrollH <= tallFrame.innerH + 1,
      JSON.stringify({ outer: tallCard, frame: tallFrame }));
    await setHtmlFont("xlarge");
    const tallXlCard = await measureHtmlCard();
    const tallXlFrame = await measureHtmlFrame();
    check("html-live: a tall demo keeps its fitted height across font scales",
      near(tallXlCard.frameHeight, tallCard.frameHeight, 1) &&
      near(tallXlFrame.demoFont, tallFrame.demoFont, 0.5) &&
      tallXlFrame.docScrollH <= tallXlFrame.innerH + 1,
      JSON.stringify({ medium: tallCard.frameHeight,
        xlarge: tallXlCard.frameHeight }));

    await bootHtml("FigHtmlLiveScroll.md");
    await setHtmlFont("medium");
    const scrollCard = await measureHtmlCard();
    const scrollFrame = await measureHtmlFrame();
    check("html-live: authored overflow still scrolls inside the demo box",
      !scrollFrame.missing &&
      scrollFrame.demoOverflowY === "auto" &&
      scrollFrame.demoScrollH > scrollFrame.demoClientH + 1 &&
      scrollFrame.docScrollH <= scrollFrame.innerH + 1,
      JSON.stringify({ outer: scrollCard, frame: scrollFrame }));
    check("html-live: no uncaught page errors on the preview page",
      htmlErrors.length === 0, htmlErrors.slice(0, 3).join(" | "));

    try { await htmlPage.close(); } catch (_) {}
    try { await htmlCtx.close(); } catch (_) {}

    // ---------------------------------------------------------------
    section("14. error boxes: prose-sized source, no figure matrix");
    await boot("FigErrors.md");
    await setFontSize("medium");
    await page.waitForFunction(
      () => document.querySelectorAll(
        "#viewer-content .mermaid-error, #viewer-content .wavedrom-error, " +
        "#viewer-content .viz-error, #viewer-content .svg-error").length >= 4,
      null, { timeout: 90000 });
    await page.waitForTimeout(400);

    async function measureErrorBoxes() {
      return page.evaluate(() => {
        const out = {};
        for (const key of ["mermaid", "wavedrom", "viz", "svg"]) {
          const box = document.querySelector("#viewer-content ." + key + "-error");
          const head = box && box.querySelector("." + key + "-error-head");
          const src = box && box.querySelector("." + key + "-source");
          const br = box ? box.getBoundingClientRect() : null;
          const sr = src ? src.getBoundingClientRect() : null;
          out[key] = {
            present: !!box,
            headFont: head ? parseFloat(getComputedStyle(head).fontSize) : null,
            srcFont: src ? parseFloat(getComputedStyle(src).fontSize) : null,
            srcWhiteSpace: src ? getComputedStyle(src).whiteSpace : null,
            srcOverflowX: src ? getComputedStyle(src).overflowX : null,
            boxWidth: br ? br.width : 0,
            srcWidth: sr ? sr.width : 0,
            srcScrollWidth: src ? src.scrollWidth : 0,
            hasViewport: !!(box && box.querySelector(".nb-figure-viewport")),
          };
        }
        const prose = document.querySelector("#viewer-content p");
        out.ref = prose ? parseFloat(getComputedStyle(prose).fontSize) : null;
        return out;
      });
    }

    const errMid = await measureErrorBoxes();
    for (const key of ["mermaid", "wavedrom", "viz", "svg"]) {
      const e = errMid[key];
      check(key + " error box: header/source are prose-sized, not figure-scaled",
        e.present && !e.hasViewport && errMid.ref > 0 &&
        e.headFont >= 9 && e.headFont <= errMid.ref * 1.05 &&
        e.srcFont >= 9 && e.srcFont <= errMid.ref * 1.05 &&
        e.srcWidth <= e.boxWidth + 1 && e.srcScrollWidth <= e.srcWidth + 1 &&
        e.srcWhiteSpace === "pre-wrap" && e.srcOverflowX !== "auto",
        JSON.stringify(e));
    }

    await setFontSize("xlarge");
    await page.waitForTimeout(350);
    const errXl = await measureErrorBoxes();
    for (const key of ["mermaid", "wavedrom", "viz", "svg"]) {
      const mid = errMid[key];
      const xl = errXl[key];
      check(key + " error box: text follows the prose scale (x1.3), no figure matrix",
        xl.present && !xl.hasViewport &&
        near(xl.headFont, mid.headFont * 1.3, 0.3) &&
        near(xl.srcFont, mid.srcFont * 1.3, 0.3) &&
        xl.srcFont < 24,
        JSON.stringify({ medium: mid, xlarge: xl }));
    }

    // KaTeX's throwOnError:false renders bad input in red instead of
    // throwing, so its defensive error box only opens on a real throw.
    // Drive that production branch by making the vendored renderer throw
    // for one call, then restore it immediately.
    async function forceKatexError() {
      return page.evaluate(async () => {
        if (!(await NB.katex.whenReady())) return { unavailable: true };
        const viewer = document.getElementById("viewer-content");
        viewer.querySelectorAll(".katex-error").forEach((n) => n.remove());
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.className = "language-math";
        code.textContent = "\\frac{1}{2}";
        pre.appendChild(code);
        viewer.appendChild(pre);
        const original = window.katex.renderToString;
        window.katex.renderToString = function () {
          throw new Error("forced katex failure");
        };
        try {
          await NB.katex.renderAll(viewer);
        } finally {
          window.katex.renderToString = original;
        }
        const box = viewer.querySelector(".katex-error");
        if (!box) return { missing: true };
        const head = box.querySelector(".katex-error-head");
        const src = box.querySelector(".katex-source");
        return {
          head: head.textContent,
          headFont: parseFloat(getComputedStyle(head).fontSize),
          srcFont: parseFloat(getComputedStyle(src).fontSize),
          hasViewport: !!box.querySelector(".nb-figure-viewport"),
          boxWidth: box.getBoundingClientRect().width,
          srcWidth: src.getBoundingClientRect().width,
        };
      });
    }

    await setFontSize("medium");
    await page.waitForTimeout(250);
    const katexErrMid = await forceKatexError();
    check("katex error box: header/source are prose-sized with no figure matrix",
      !katexErrMid.missing && !katexErrMid.unavailable &&
      !katexErrMid.hasViewport && errMid.ref > 0 &&
      katexErrMid.headFont >= 9 &&
      katexErrMid.headFont <= errMid.ref * 1.05 &&
      katexErrMid.srcFont >= 9 &&
      katexErrMid.srcFont <= errMid.ref * 1.05 &&
      katexErrMid.srcWidth <= katexErrMid.boxWidth + 1,
      JSON.stringify(katexErrMid));

    await setFontSize("xlarge");
    await page.waitForTimeout(250);
    const katexErrXl = await forceKatexError();
    check("katex error box: text follows the prose scale (x1.3), no figure matrix",
      !katexErrXl.missing && !katexErrXl.unavailable &&
      !katexErrXl.hasViewport &&
      near(katexErrXl.headFont, katexErrMid.headFont * 1.3, 0.3) &&
      near(katexErrXl.srcFont, katexErrMid.srcFont * 1.3, 0.3),
      JSON.stringify({ medium: katexErrMid, xlarge: katexErrXl }));
    await setFontSize("medium");
    await page.waitForTimeout(200);

    // ---------------------------------------------------------------
    section("page errors");
    check("no uncaught page errors", pageErrors.length === 0,
      pageErrors.slice(0, 3).join(" | "));
  } catch (err) {
    failed++;
    console.log("  FAIL harness: " + String((err && err.stack) || err));
    console.log("  server log tail: " + serverLog.split("\n").slice(-12).join(" | "));
  } finally {
    try { await ctx.close(); } catch (_) {}
    try { await browser.close(); } catch (_) {}
    try { child.kill("SIGTERM"); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("\nRESULT: " + (failed ? "FAIL" : "PASS") +
    "  (" + passed + " ok, " + failed + " failed)");
  process.exit(failed ? 1 : 0);
}

main();
