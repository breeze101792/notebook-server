/* Real-browser test: the AI panel's reply bubbles run the shared block
 * registry (NB.blocks), so a special fenced block in a reply renders as it
 * does in a note.
 *
 * Boots the REAL Flask app against a temp notebook in headless Chromium and
 * streams one assistant reply carrying all six fences (mermaid, wavedrom,
 * math, dot, svg, html-live) through the real Flask proxy from a local
 * OpenAI-compatible SSE stub. Pins the container each fence becomes, that
 * ```wavedrom stays raw in the panel while the note still renders it, that a
 * chat figure fits the chat log and not #viewer-content, the per-host
 * relayout, the image copy button, the click-to-zoom lightbox, the prose
 * fence's single text button, and that a tool fence still renders nothing.
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium \
 *         node tests/browser/test_ai_blocks_browser.js
 * Env:  CHROMIUM_PATH, PORT (default 5092).
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
const PORT = Number(process.env.PORT || 5092);
const BASE = "http://127.0.0.1:" + PORT;
const VIEW = { width: 1280, height: 900 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-ai-blocks-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

/* The note fixture renders its own mermaid and wavedrom figures, so the
 * chat figures have wider figures to be compared against, and the panel's
 * wavedrom exclusion can be contrasted with the note path. */
const NOTE = "blocks.md";

const MERMAID_SRC = [
  "flowchart LR",
  "  A[Alpha] --> B[Beta]",
  "  B --> C[Gamma]",
  "  C --> D[Delta]",
].join("\n");

const WAVEDROM_SRC = [
  "{signal: [",
  "  {name: 'clk', wave: 'p.....|...'},",
  "  {name: 'data', wave: 'x.345x|=.x', data: ['head', 'body', 'tail']}",
  "]}",
].join("\n");

fs.writeFileSync(path.join(DATA, NOTE), [
  "# Blocks Note",
  "",
  "Prose before the note diagram.",
  "",
  "```mermaid",
  MERMAID_SRC,
  "```",
  "",
  "```wavedrom",
  WAVEDROM_SRC,
  "```",
  "",
].join("\n"));
fs.writeFileSync(path.join(DATA, "Welcome.md"), "# Welcome\n\nAI block test.\n");

const KATEX_SRC = "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}";

const DOT_SRC = [
  "digraph G {",
  "  rankdir=LR;",
  "  A -> B;",
  "  B -> C;",
  "}",
].join("\n");

const SVG_SRC = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120" height="60">',
  '  <rect x="1" y="1" width="118" height="58" rx="8" fill="none" stroke="currentColor"/>',
  '  <text x="20" y="36" font-size="14" fill="currentColor">SVG</text>',
  "</svg>",
].join("\n");

const HTML_LIVE_SRC = '<div class="demo"><strong>Live HTML</strong><p>Body.</p></div>';

const JS_SRC = 'console.log("ai-fence-marker");';

const BLOCKS_REPLY = [
  "BLOCKS_REPLY_PROSE here.",
  "",
  "```mermaid",
  MERMAID_SRC,
  "```",
  "",
  "```wavedrom",
  WAVEDROM_SRC,
  "```",
  "",
  "```math",
  KATEX_SRC,
  "```",
  "",
  "```dot",
  DOT_SRC,
  "```",
  "",
  "```svg",
  SVG_SRC,
  "```",
  "",
  "```html-live",
  HTML_LIVE_SRC,
  "```",
  "",
  "And a prose fence:",
  "",
  "```js",
  JS_SRC,
  "```",
].join("\n");

const TOOL_REPLY = "TOOL_TURN_PROSE here.\n\n" +
  "```nb-tool\n" + JSON.stringify({ tool: "list" }) + "\n```\n";

/* A reply that tries to act: an event handler, a javascript: link, a
 * password field, and an SVG fence carrying script + SMIL animation. The
 * panel sanitizes the marked HTML and the rendered SVG, so none of it may
 * reach the log, while the plain markdown around it still renders. */
const ATTACK_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120" height="60">',
  "  <script>window.__aiPwned = 1;</script>",
  '  <animate attributeName="href" values="javascript:alert(1)"/>',
  '  <rect x="1" y="1" width="118" height="58" fill="none" stroke="currentColor"/>',
  '  <text x="20" y="36" font-size="14" fill="currentColor">SVG</text>',
  "</svg>",
].join("\n");

const HOSTILE_REPLY = [
  "HOSTILE_REPLY_PROSE with **bold** and a list:",
  "",
  "- item one",
  "- item two",
  "",
  '<img src="x" onerror="window.__aiPwned = 1">',
  "",
  "[bad link](javascript:alert('x'))",
  "",
  '<form action="#"><input type="password" name="pw"></form>',
  "",
  "```svg",
  ATTACK_SVG,
  "```",
].join("\n");

/* The five fences the panel renders: each of these descriptors is safe on
 * model output. ```wavedrom is deliberately absent -- the panel passes
 * {untrusted:true} and wavedrom.js registers untrustedSafe:false because its
 * source parser falls back to eval. */
const RENDERED = [
  { fence: "mermaid", sel: ".mermaid-container" },
  { fence: "math", sel: ".katex-container" },
  { fence: "dot", sel: ".viz-container" },
  { fence: "svg", sel: ".svg-container" },
  { fence: "html-live", sel: ".htmlpreview-card" },
];
const SKIPPED = { fence: "wavedrom", sel: ".wavedrom-container" };

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}
function section(name) { console.log("\n== " + name + " =="); }

/* Playwright's service-worker probe throws inside sandboxed html-live
 * frames. The sandbox is working as intended; that is not an app page
 * error, so keep it out of the collector (same filter as the figure
 * sizing suite). */
const SANDBOX_SW_PROBE =
  /Service worker is disabled because the context is sandboxed/;
function recordPageError(list, e) {
  const msg = String((e && e.stack) || e);
  if (!SANDBOX_SW_PROBE.test(msg)) list.push(msg);
}

/* ---- local OpenAI-compatible SSE stub ------------------------------- */
let stubServer = null;
let stubPort = 0;

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
        const prompt = lastUserText(body);
        let reply = "ASSISTANT_PROSE_OK from the local stub.";
        if (prompt.includes("BLOCKS_TURN")) reply = BLOCKS_REPLY;
        else if (prompt.includes("TOOL_TURN")) reply = TOOL_REPLY;
        else if (prompt.includes("HOSTILE_TURN")) reply = HOSTILE_REPLY;
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
}

/* ---- page helpers --------------------------------------------------- */
async function waitApp(page) {
  await page.waitForFunction(
    () => window.NB && NB.viewer && NB.tabs && NB.blocks,
    null, { timeout: 30000 });
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

    const ctx = await browser.newContext({ viewport: VIEW });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => recordPageError(pageErrors, e));

    section("note fixture: the viewer's own figures");
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE),
      { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#viewer-content h1", { timeout: 20000 });
    await waitApp(page);
    await page.waitForFunction(() =>
      !!document.querySelector(
        "#viewer-content .mermaid-container .nb-figure-viewport[data-nb-mode]"),
      null, { timeout: 60000 });
    const noteFig = await page.evaluate(() => {
      const card = document.querySelector("#viewer-content .mermaid-container");
      const vp = card.querySelector(":scope > .nb-figure-viewport");
      const svg = vp.querySelector("svg");
      return {
        mode: vp.dataset.nbMode || "",
        width: svg ? svg.getBoundingClientRect().width : 0,
        viewerW: document.getElementById("viewer-content").clientWidth,
      };
    });
    check("note: the mermaid fence renders a sized figure in #viewer-content",
      noteFig.width > 0 && !!noteFig.mode && noteFig.width <= noteFig.viewerW + 1,
      JSON.stringify(noteFig));

    // The panel skips wavedrom on model output; the note path must still
    // render it (renderAll is called there with no opts).
    await page.waitForFunction(
      () => !!document.querySelector("#viewer-content .wavedrom-container"),
      null, { timeout: 60000 });
    const noteWave = await page.evaluate(() => ({
      cards: document.querySelectorAll(
        "#viewer-content .wavedrom-container").length,
      raw: document.querySelectorAll(
        "#viewer-content pre > code.language-wavedrom").length,
    }));
    check("note: the viewer still renders its ```wavedrom fence",
      noteWave.cards === 1 && noteWave.raw === 0, JSON.stringify(noteWave));

    section("ai panel: one reply carrying all six fences");
    await page.click('.activity-btn[data-view="ai"]');
    await page.waitForSelector("#ai-input", { state: "visible", timeout: 10000 });
    await page.waitForFunction(() => {
      const sel = document.getElementById("ai-model-select");
      return !!(sel && sel.querySelector('option[value="stubai"]'));
    }, null, { timeout: 10000 });

    await sendAi(page, "BLOCKS_TURN please");
    // The renderers load their vendored bundles on first use, so the first
    // reply is the slow one.
    await page.waitForFunction((sels) => {
      const log = document.getElementById("ai-chat-log");
      return !!log && sels.every((sel) => !!log.querySelector(sel));
    }, RENDERED.map((c) => c.sel), { timeout: 90000 });

    const rendered = await page.evaluate((list) => {
      const log = document.getElementById("ai-chat-log");
      const bubble = Array.from(log.querySelectorAll(".ai-msg-assistant"))
        .find((b) => b.textContent.includes("BLOCKS_REPLY_PROSE"));
      const out = { inBubble: {}, inLog: {}, raw: {} };
      for (const c of list) {
        out.inBubble[c.fence] =
          !!(bubble && bubble.querySelector(c.sel));
        out.inLog[c.fence] = log.querySelectorAll(c.sel).length;
        out.raw[c.fence] = log.querySelectorAll(
          "pre > code.language-" + c.fence).length;
      }
      out.bubbleFound = !!bubble;
      return out;
    }, RENDERED);

    check("ai blocks: the reply bubble exists", rendered.bubbleFound);
    for (const c of RENDERED) {
      check("ai blocks: ```" + c.fence + " renders " + c.sel + " in the reply bubble",
        rendered.inBubble[c.fence] === true,
        "count=" + rendered.inLog[c.fence]);
      check("ai blocks: no raw ```" + c.fence + " code block survives in the panel",
        rendered.raw[c.fence] === 0, "raw=" + rendered.raw[c.fence]);
    }

    const skipped = await page.evaluate((skip) => {
      const log = document.getElementById("ai-chat-log");
      const bubble = Array.from(log.querySelectorAll(".ai-msg-assistant"))
        .find((b) => b.textContent.includes("BLOCKS_REPLY_PROSE"));
      const pre = bubble
        ? bubble.querySelector("pre > code.language-wavedrom") : null;
      return {
        containers: log.querySelectorAll(skip.sel).length,
        raw: bubble
          ? bubble.querySelectorAll("pre > code.language-wavedrom").length : -1,
        buttons: pre ? pre.parentElement
          .querySelectorAll(".code-copy-btn").length : -1,
        imageButtons: pre ? pre.parentElement
          .querySelectorAll(".nb-copy-img-btn").length : -1,
      };
    }, SKIPPED);
    check("ai blocks: a ```wavedrom fence in a reply stays a code block",
      skipped.containers === 0 && skipped.raw === 1,
      "containers=" + skipped.containers + " raw=" + skipped.raw);
    check("ai blocks: the skipped wavedrom fence keeps its text copy button",
      skipped.buttons === 1 && skipped.imageButtons === 0,
      JSON.stringify(skipped));

    section("ai blocks: the chat figure fits the chat log");
    await page.waitForFunction(() =>
      !!document.querySelector(
        "#ai-chat-log .mermaid-container .nb-figure-viewport[data-nb-mode]"),
      null, { timeout: 30000 });
    const chatFig = await page.evaluate(() => {
      const log = document.getElementById("ai-chat-log");
      const card = log.querySelector(".mermaid-container");
      const vp = card.querySelector(":scope > .nb-figure-viewport");
      const svg = vp.querySelector("svg");
      const cs = getComputedStyle(log);
      return {
        mode: vp.dataset.nbMode || "",
        width: svg ? svg.getBoundingClientRect().width : 0,
        cardW: card.clientWidth,
        contentW: log.clientWidth - parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight),
      };
    });
    check("ai blocks: the chat figure is laid out (data-nb-mode set)",
      chatFig.width > 0 && !!chatFig.mode && chatFig.mode !== "fallback",
      JSON.stringify(chatFig));
    check("ai blocks: the chat figure fits the chat log's content width",
      chatFig.width > 0 && chatFig.width <= chatFig.contentW + 1,
      JSON.stringify(chatFig));
    check("ai blocks: the chat figure fits its card",
      chatFig.width <= chatFig.cardW + 1,
      JSON.stringify({ width: chatFig.width, cardW: chatFig.cardW }));
    check("ai blocks: the note figure is not fitted to the chat log",
      noteFig.width > chatFig.contentW + 1,
      JSON.stringify({ note: noteFig.width, chatContent: chatFig.contentW }));
    check("ai blocks: the chat and note figures do not share dimensions",
      Math.abs(noteFig.width - chatFig.width) > 4,
      JSON.stringify({ note: noteFig.width, chat: chatFig.width }));

    section("ai blocks: copy button and lightbox in the chat");
    const copyState = await page.evaluate(() => {
      const log = document.getElementById("ai-chat-log");
      const card = log.querySelector(".mermaid-container");
      return {
        total: card.querySelectorAll(".code-copy-btn").length,
        image: card.querySelectorAll(".code-copy-btn.nb-copy-img-btn").length,
      };
    });
    check("ai blocks: the chat diagram card gets one image copy button",
      copyState.total === 1 && copyState.image === 1,
      JSON.stringify(copyState));

    await page.locator("#ai-chat-log .mermaid-container .nb-figure-viewport > svg")
      .first().click();
    await page.waitForTimeout(200);
    const lightboxOpen = await page.evaluate(() => {
      const overlay = document.getElementById("mermaid-lightbox");
      const body = document.getElementById("mermaid-lightbox-body");
      return {
        open: !!overlay && !overlay.hidden,
        clone: !!(body && body.querySelector("svg")),
      };
    });
    check("ai blocks: clicking a chat diagram opens the mermaid lightbox",
      lightboxOpen.open && lightboxOpen.clone, JSON.stringify(lightboxOpen));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const lightboxClosed = await page.evaluate(() => {
      const overlay = document.getElementById("mermaid-lightbox");
      const body = document.getElementById("mermaid-lightbox-body");
      return {
        hidden: !overlay || overlay.hidden,
        empty: !body || body.children.length === 0,
      };
    });
    check("ai blocks: Escape closes the lightbox",
      lightboxClosed.hidden && lightboxClosed.empty,
      JSON.stringify(lightboxClosed));

    /* The delegated handler sits on the body but is guarded by the reading
     * roots: a click elsewhere (the panel header) and a click on plain chat
     * prose must open nothing. */
    await page.click("#ai-view .panel-header");
    await page.waitForTimeout(150);
    check("ai blocks: a click outside the reading roots opens no lightbox",
      await page.evaluate(() =>
        document.getElementById("mermaid-lightbox").hidden));

    await page.locator("#ai-chat-log .ai-prose-span p").first().click();
    await page.waitForTimeout(150);
    check("ai blocks: a click on chat prose opens no lightbox",
      await page.evaluate(() =>
        document.getElementById("mermaid-lightbox").hidden));

    section("ai blocks: one relayout burst fits both hosts");
    // A note and the panel usually resize in the same burst. Both roots are
    // scheduled here after both figures are forced out of their fitted
    // size, so a single-root pass would leave one at 10px.
    const twoRoot = await page.evaluate(async () => {
      const noteCard = document.querySelector("#viewer-content .mermaid-container");
      const chatCard = document.querySelector("#ai-chat-log .mermaid-container");
      const noteSvg = noteCard.querySelector(".nb-figure-viewport > svg");
      const chatSvg = chatCard.querySelector(".nb-figure-viewport > svg");
      const noteWas = noteSvg.style.width;
      const chatWas = chatSvg.style.width;
      noteSvg.style.width = "10px";
      chatSvg.style.width = "10px";
      NB.blocks.scheduleRelayout(document.getElementById("viewer-content"));
      NB.blocks.scheduleRelayout(chatCard);
      await new Promise((r) => setTimeout(r, 300));
      return {
        noteWas: noteWas,
        chatWas: chatWas,
        note: noteSvg.style.width,
        chat: chatSvg.style.width,
      };
    });
    check("ai blocks: a two-root burst re-fits the note figure",
      twoRoot.note !== "10px" && twoRoot.note === twoRoot.noteWas,
      JSON.stringify(twoRoot));
    check("ai blocks: a two-root burst re-fits the chat figure",
      twoRoot.chat !== "10px" && twoRoot.chat === twoRoot.chatWas,
      JSON.stringify(twoRoot));

    // The same contract through a real window resize (the null-root pass
    // re-fits every observed host).
    await page.setViewportSize({ width: 980, height: 720 });
    await page.waitForTimeout(500);
    const resized = await page.evaluate(() => {
      const widthOf = (root) => {
        const svg = document.querySelector(
          root + " .mermaid-container .nb-figure-viewport > svg");
        return svg ? svg.getBoundingClientRect().width : 0;
      };
      const log = document.getElementById("ai-chat-log");
      const cs = getComputedStyle(log);
      return {
        note: widthOf("#viewer-content"),
        chat: widthOf("#ai-chat-log"),
        viewerW: document.getElementById("viewer-content").clientWidth,
        chatW: log.clientWidth - parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight),
      };
    });
    check("ai blocks: the note figure re-fits to the narrowed viewer",
      resized.note > 0 && resized.note <= resized.viewerW + 1,
      JSON.stringify(resized));
    check("ai blocks: the chat figure still fits the chat log after the resize",
      resized.chat > 0 && resized.chat <= resized.chatW + 1,
      JSON.stringify(resized));
    await page.setViewportSize(VIEW);
    await page.waitForTimeout(400);

    section("ai blocks: a prose fence keeps its text copy button");
    const proseFence = await page.evaluate((marker) => {
      const log = document.getElementById("ai-chat-log");
      const bubble = Array.from(log.querySelectorAll(".ai-msg-assistant"))
        .find((b) => b.textContent.includes("BLOCKS_REPLY_PROSE"));
      const pres = bubble ? Array.from(bubble.querySelectorAll("pre")) : [];
      const pre = pres.find((p) => p.textContent.includes(marker));
      return {
        found: !!pre,
        highlighted: !!(pre && pre.querySelector("code.hljs")),
        buttons: pre ? pre.querySelectorAll(".code-copy-btn").length : 0,
        imageButtons: pre ? pre.querySelectorAll(".nb-copy-img-btn").length : 0,
      };
    }, "ai-fence-marker");
    check("ai blocks: the ```js prose fence stays a highlighted code block",
      proseFence.found && proseFence.highlighted, JSON.stringify(proseFence));
    check("ai blocks: the prose fence keeps exactly one text copy button",
      proseFence.buttons === 1 && proseFence.imageButtons === 0,
      JSON.stringify(proseFence));

    section("ai blocks: a tool fence renders nothing");
    await sendAi(page, "TOOL_TURN please");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("#ai-chat-log .ai-msg-assistant"))
        .some((b) => b.textContent.includes("TOOL_TURN_PROSE")),
      null, { timeout: 30000 });
    await page.waitForTimeout(1000);
    const toolTurn = await page.evaluate((sels) => {
      const log = document.getElementById("ai-chat-log");
      const bubble = Array.from(log.querySelectorAll(".ai-msg-assistant"))
        .find((b) => b.textContent.includes("TOOL_TURN_PROSE"));
      const containers = {};
      for (const sel of sels) {
        containers[sel] = bubble ? bubble.querySelectorAll(sel).length : -1;
      }
      return {
        found: !!bubble,
        containers: containers,
        rawToolBlock: log.querySelectorAll("pre > code.language-nb-tool").length,
        text: bubble ? bubble.textContent : "",
      };
    }, RENDERED.map((c) => c.sel));
    check("ai tool turn: the tool-turn bubble renders its prose",
      toolTurn.found && /TOOL_TURN_PROSE/.test(toolTurn.text));
    check("ai tool turn: no diagram container appears in the tool turn",
      Object.keys(toolTurn.containers).every((k) => toolTurn.containers[k] === 0),
      JSON.stringify(toolTurn.containers));
    check("ai tool turn: the nb-tool block never reaches the prose",
      toolTurn.rawToolBlock === 0 && toolTurn.text.indexOf("nb-tool") === -1,
      "raw=" + toolTurn.rawToolBlock + " text=" +
        JSON.stringify(toolTurn.text.slice(0, 80)));

    section("ai sanitize: a hostile reply cannot act");
    await sendAi(page, "HOSTILE_TURN please");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("#ai-chat-log .ai-msg-assistant"))
        .some((b) => b.textContent.includes("HOSTILE_REPLY_PROSE")),
      null, { timeout: 30000 });
    // The svg fence renders (and is sanitized) after the turn ends.
    await page.waitForFunction(() =>
      !!document.querySelector("#ai-chat-log .svg-container svg"),
      null, { timeout: 30000 });
    await page.waitForTimeout(600);

    const hostile = await page.evaluate(() => {
      const log = document.getElementById("ai-chat-log");
      const bubble = Array.from(log.querySelectorAll(".ai-msg-assistant"))
        .find((b) => b.textContent.includes("HOSTILE_REPLY_PROSE"));
      const hrefs = Array.from(log.querySelectorAll("a"))
        .map((a) => a.getAttribute("href") || "");
      const svg = bubble
        ? bubble.querySelector(".svg-container svg") : null;
      return {
        found: !!bubble,
        handlers: log.querySelectorAll("[onerror]").length,
        scripts: log.querySelectorAll("script").length,
        unsafeHrefs: hrefs.filter((h) => /^\s*javascript:/i.test(h)),
        forms: log.querySelectorAll("form").length,
        textInputs: log.querySelectorAll("input:not([type=checkbox])").length,
        img: log.querySelectorAll("img[src]").length,
        svg: !!svg,
        smil: svg
          ? svg.querySelectorAll("script, animate, set, discard").length : -1,
        sizing: svg ? (svg.dataset.nbSizing || "") : "",
        strong: bubble ? bubble.querySelectorAll("strong").length : -1,
        items: bubble ? bubble.querySelectorAll("ul li").length : -1,
        pwned: !!window.__aiPwned,
      };
    });
    check("ai sanitize: the hostile reply bubble exists", hostile.found);
    check("ai sanitize: no event handler, script, or javascript: link survives",
      hostile.handlers === 0 && hostile.scripts === 0 &&
      hostile.unsafeHrefs.length === 0 && hostile.pwned === false,
      JSON.stringify(hostile));
    check("ai sanitize: no form and no non-checkbox input reaches the log",
      hostile.forms === 0 && hostile.textInputs === 0,
      JSON.stringify({ forms: hostile.forms, inputs: hostile.textInputs }));
    check("ai sanitize: the raw HTML rendered (the img kept, its handler gone)",
      hostile.img >= 1, "img=" + hostile.img);
    check("ai sanitize: the legitimate markdown around it still renders",
      hostile.strong >= 1 && hostile.items === 2, JSON.stringify(hostile));
    check("ai sanitize: the ```svg fence renders without script or SMIL",
      hostile.svg && hostile.smil === 0, JSON.stringify(hostile));
    check("ai sanitize: the sanitized SVG keeps its sizing attributes",
      hostile.sizing !== "", "sizing=" + hostile.sizing);

    // The normal reply is unaffected by the sanitizer: its mermaid figure is
    // still fitted to the chat log and still carries its image copy button.
    const normalStill = await page.evaluate(() => {
      const log = document.getElementById("ai-chat-log");
      const bubble = Array.from(log.querySelectorAll(".ai-msg-assistant"))
        .find((b) => b.textContent.includes("BLOCKS_REPLY_PROSE"));
      const card = bubble ? bubble.querySelector(".mermaid-container") : null;
      const vp = card && card.querySelector(":scope > .nb-figure-viewport");
      const svg = vp && vp.querySelector("svg");
      const cs = getComputedStyle(log);
      return {
        mode: vp ? (vp.dataset.nbMode || "") : "",
        width: svg ? svg.getBoundingClientRect().width : 0,
        contentW: log.clientWidth - parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight),
        buttons: card
          ? card.querySelectorAll(".code-copy-btn.nb-copy-img-btn").length : -1,
      };
    });
    check("ai sanitize: the normal reply's diagram is still fitted to the chat log",
      normalStill.width > 0 && !!normalStill.mode &&
      normalStill.width <= normalStill.contentW + 1,
      JSON.stringify(normalStill));
    check("ai sanitize: the normal reply's diagram still has its copy button",
      normalStill.buttons === 1, JSON.stringify(normalStill));

    check("no uncaught page errors in the AI blocks phase",
      pageErrors.length === 0, pageErrors.join(" | "));

    try { await ctx.close(); } catch (_) {}
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
