/* Real-browser audit of the non-code hybrid blocks: lists, task items,
 * tables (view controls + cell selection), images and wikilinks.
 *
 * jsdom drives the model; these checks exist because the native engine
 * owns list-item Enter, the real pointer geometry owns the table drag,
 * and the clipboard is a real OS-level channel.
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium node tests/browser/test_hybrid_blocks_browser.js
 * Env:  PORT (default 5082), CHROMIUM_PATH.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const PORT = Number(process.env.PORT || 5082);
const BASE = "http://127.0.0.1:" + PORT;
const { findChromium } = require("./chromium");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || findChromium();
const NOTE = "blocks.md";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-hybrid-blocks-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}
function writeNote(body) { fs.writeFileSync(path.join(DATA, NOTE), body); }
function readNote() { return fs.readFileSync(path.join(DATA, NOTE), "utf8"); }
// Touched list blocks canonicalize their marker spacing ("- " -> "-   ");
// compare semantics, not that documented canonical form.
function normList(md) { return md.replace(/^(\s*)- {1,3}/gm, "$1- "); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForFile(pred, timeout) {
  const deadline = Date.now() + (timeout || 4000);
  while (Date.now() < deadline) {
    try { if (pred(readNote())) return true; } catch (_) {}
    await sleep(50);
  }
  return false;
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

const LISTS = "# Lists\n\n- one\n- two\n- three\n";
const TASKS = "# Tasks\n\n- [ ] first\n- [x] second\n";
const TABLE = "# Table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n";
const MEDIA = "# Media\n\n[[Other]]\n\n![pic](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSJibHVlIi8+PC9zdmc+)\n";

async function main() {
  fs.writeFileSync(path.join(DATA, "Other.md"), "# Other\n\nsecond note\n");
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
    child.kill("SIGTERM");
    process.exit(2);
  }

  try {
    await waitForServer();
    const ctx = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    const boot = async (src) => {
      writeNote(src);
      await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
      await page.waitForSelector("#viewer-content h1", { timeout: 15000 });
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await sleep(120);
    };
    const bootPreview = async (src) => {
      writeNote(src);
      await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
      await page.waitForSelector("#viewer-content h1", { timeout: 15000 });
      await sleep(120);
    };
    const save = async () => {
      await page.click("#viewer-content h1");
      await sleep(200);
      await page.keyboard.press("Control+s");
      await sleep(200);
    };
    const caretAtEnd = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }, sel);

    // --- list item Enter ------------------------------------------------
    console.log("\n== lists ==");
    await boot(LISTS);
    await caretAtEnd("#viewer-content li");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("inserted");
    await sleep(100);
    await save();
    check("list: Enter on an item creates a sibling and keeps the marker",
      (await waitForFile((md) => /- one\n- inserted\n- two\n- three/.test(normList(md)))),
      JSON.stringify(normList(readNote())));

    await boot(LISTS);
    await caretAtEnd("#viewer-content li");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("after");
    await sleep(100);
    await save();
    check("list: Enter twice on an empty item exits the list",
      (await waitForFile((md) => /- one\n\nafter\n*- two\n- three/.test(normList(md)))),
      JSON.stringify(normList(readNote())));

    await boot(LISTS);
    await caretAtEnd("#viewer-content li + li");
    await page.keyboard.press("Tab");
    await sleep(120);
    const nested = await page.evaluate(
      () => !!document.querySelector("#viewer-content li li"));
    check("list: Tab nests the item", nested);
    await save();
    check("list: nested save keeps the item text",
      (await waitForFile((md) => /- one\n\s+- two\n- three/.test(normList(md)))),
      JSON.stringify(normList(readNote())));

    // --- task item ------------------------------------------------------
    console.log("\n== tasks ==");
    await boot(TASKS);
    await page.click("#viewer-content input[type=\"checkbox\"]");
    await sleep(150);
    await save();
    check("task: clicking an unchecked box saves [x]",
      (await waitForFile((md) => /- \[x\] first/.test(md))), JSON.stringify(readNote()));
    await boot(TASKS);
    const boxes = page.locator("#viewer-content input[type=\"checkbox\"]");
    check("task: both boxes are rendered interactive", (await boxes.count()) === 2);
    await boxes.nth(1).click();
    await sleep(150);
    await save();
    check("task: clicking a checked box saves [ ]",
      (await waitForFile((md) => /- \[ \] second/.test(md))), JSON.stringify(readNote()));

    // --- raw HTML blocks ----------------------------------------------
    console.log("\n== raw HTML ==");
    const RAW = "# Raw\n\n<div id=\"raw-block\">hello</div>\n\nAfter.\n";
    await boot(RAW);
    await page.click("#viewer-content h1");
    await page.keyboard.press("Control+s");
    await sleep(250);
    check("raw HTML: an untouched block stays byte-identical", readNote() === RAW,
      JSON.stringify(readNote()));
    await page.evaluate(() => {
      const el = document.querySelector("#viewer-content #raw-block");
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("!");
    await sleep(100);
    await save();
    check("raw HTML: an edited block keeps its tag and attributes",
      readNote() === "# Raw\n\n<div id=\"raw-block\">hello!</div>\n\nAfter.\n",
      JSON.stringify(readNote()));

    // --- empty blockquote line exits the quote ------------------------
    console.log("\n== blockquote ==");
    const QUOTE = "# Q\n\n> quote\n\nAfter.\n";
    await boot(QUOTE);
    await page.evaluate(() => {
      const p = document.querySelector("#viewer-content blockquote p");
      const r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press("Enter");
    await sleep(100);
    await page.keyboard.press("Enter");
    await sleep(100);
    await page.keyboard.type("X");
    await sleep(100);
    await save();
    check("blockquote: Enter on an empty line exits to a paragraph",
      (await waitForFile((md) => md === "# Q\n\n> quote\n\nX\n\nAfter.\n")),
      JSON.stringify(readNote()));

    // --- hybrid draft survives a tab switch ---------------------------
    console.log("\n== hybrid tab switch ==");
    await boot(LISTS);
    await page.evaluate(() => NB.app.setAutosave(false));
    await page.evaluate(() => {
      const vc = document.getElementById("viewer-content");
      vc.insertAdjacentHTML("beforeend", "<p>DRAFT_HYBRID_TOKEN</p>");
      vc.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(250);
    check("hybrid switch: the edit is dirty",
      await page.evaluate(() => NB.hybrid.isDirty()));
    await page.evaluate(() => NB.tabs.open("Other.md"));
    await page.waitForFunction(() => NB.tabs.getActive() === "Other.md", null, { timeout: 8000 });
    check("hybrid switch: the draft is kept for the source tab",
      await page.evaluate(() => !!NB.viewer.getDraft("blocks.md")));
    check("hybrid switch: no draft bar on the other tab",
      await page.locator("#draft-bar").isHidden());
    await page.evaluate(() => NB.tabs.activate("blocks.md"));
    await page.waitForFunction(() => NB.tabs.getActive() === "blocks.md", null, { timeout: 8000 });
    check("hybrid switch: the Recover bar appears on return",
      await page.locator("#draft-bar").isVisible());
    await page.click("#draft-recover");
    await page.waitForFunction(() => NB.hybrid.isActive(), null, { timeout: 8000 });
    check("hybrid switch: Recover restores the WYSIWYG buffer",
      await page.evaluate(() =>
        document.getElementById("viewer-content").textContent.includes("DRAFT_HYBRID_TOKEN") &&
        NB.hybrid.isDirty()));
    check("hybrid switch: nothing was written to disk",
      readNote() === LISTS, JSON.stringify(readNote()));
    await page.evaluate(() => NB.hybrid.exit(false));
    await sleep(150);

    // --- table view controls -------------------------------------------
    console.log("\n== tables: view controls ==");
    await bootPreview(TABLE);
    const table = page.locator("#viewer-content table").first();
    await table.hover();
    await page.click("#viewer .nb-tv-toggle");
    await sleep(120);
    check("table view: the toolbar opens",
      await page.locator("#viewer .nb-tv-toolbar").isVisible());
    await page.click("#viewer .nb-tv-btn:has-text(\"Rows\")");
    await sleep(100);
    const rowChecks = page.locator("#viewer .nb-tv-pop input[type=\"checkbox\"]");
    check("table view: the row chooser lists rows", (await rowChecks.count()) >= 2);
    await rowChecks.nth(1).click();
    await sleep(120);
    const hiddenRows = await page.locator("#viewer-content .nb-tv-hide-row").count();
    check("table view: hiding a row is class-based", hiddenRows >= 1, "hidden=" + hiddenRows);
    check("table view: view state never reaches the note", readNote() === TABLE,
      JSON.stringify(readNote()));
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    const hiddenAfterEnter = await page.locator("#viewer-content .nb-tv-hide-row").count();
    check("table view: entering hybrid strips the view state", hiddenAfterEnter === 0,
      "hidden=" + hiddenAfterEnter);

    // --- Enter inside a cell must not split the row -------------------
    console.log("\n== tables: cell Enter ==");
    await boot(TABLE);
    await page.evaluate(() => {
      const c = document.querySelectorAll("#viewer-content td")[0];
      const r = document.createRange();
      r.selectNodeContents(c);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("X");
    await sleep(120);
    await save();
    const cellFile = readNote();
    check("table cell: Enter does not write a newline into the row",
      !/\| 1  \nX \|/.test(cellFile) && /^\| 1X \| 2 \|$/m.test(cellFile),
      JSON.stringify(cellFile));
    check("table cell: typing after the refused Enter stays in the cell",
      /\| 1X \| 2 \|/.test(cellFile), JSON.stringify(cellFile));

    // --- table cell selection + copy -----------------------------------
    console.log("\n== tables: cell selection ==");
    await boot(TABLE);
    const cells = await page.locator("#viewer-content td").all();
    const b0 = await cells[0].boundingBox();
    const b1 = await cells[3].boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await sleep(150);
    const rangeCells = await page.locator("#viewer-content td.nb-ts-range").count();
    check("table select: Ctrl+drag paints a rectangle", rangeCells === 4,
      "cells=" + rangeCells);
    await page.keyboard.press("Control+c");
    await sleep(150);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check("table select: the clipboard is TSV for the rectangle",
      clip === "1\t2\n3\t4", JSON.stringify(clip));
    check("table select: selecting never writes the note", readNote() === TABLE,
      JSON.stringify(readNote()));

    // --- image + wikilink ----------------------------------------------
    console.log("\n== media and links ==");
    await boot(MEDIA);
    await page.click("#viewer-content a[data-wikilink], #viewer-content a.wikilink");
    await page.waitForFunction(
      () => (document.getElementById("viewer-content") || {}).textContent
        && /second note/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 8000 }).catch(() => {});
    const navOk = await page.evaluate(
      () => /second note/.test(document.getElementById("viewer-content").textContent));
    check("wikilink: clicking opens the target note", navOk);

    check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
    await page.screenshot({ path: path.join(tmp, "hybrid-blocks.png") });
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
