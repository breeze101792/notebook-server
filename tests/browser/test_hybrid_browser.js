/* Real-browser test for hybrid (WYSIWYG) mode.
 *
 * jsdom cannot exercise contentEditable: it has no editing engine, no
 * selection, and no native markup insertion, so the DOM a real browser
 * produces (a <div>/<p> on Enter, an atomic caret walk, IME) never
 * appears there. This harness drives the REAL app in a REAL browser via
 * Playwright and asserts the write-back contract against the file on
 * disk.
 *
 * It boots the Flask app against a temp notebook, opens a note, enters
 * hybrid mode through the actual UI button, edits through the real
 * editing engine, and reads the file back from disk.
 *
 * Run:  node tests/browser/test_hybrid_browser.js
 * Env:  BROWSER=chromium|firefox   (default chromium)
 *       CHROMIUM_PATH / FIREFOX_PATH  override the browser binary.
 *       With no override Playwright's bundled browser is used; on
 *       NixOS that bundled build cannot start (its dynamic loader is a
 *       stub), so point the path at a nix-provided browser instead.
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
const { findChromium } = require("./chromium");
const BROWSER_PATH = process.env[
  BROWSER === "firefox" ? "FIREFOX_PATH" : "CHROMIUM_PATH"
] || (BROWSER === "chromium" ? findChromium() : undefined);
const PORT = Number(process.env.PORT || 5099);
const BASE = "http://127.0.0.1:" + PORT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-browser-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

// The reported trigger: an empty heading and a heading whose only
// content is an inline code run of spaces.
const NOTE = "notes/reported.md";
const SOURCE = "## Commands\n\n###\n\n### `   `\n\nRun `audiochat chat`.\n";

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

// Put the caret at the end of a block's contents. An empty block has zero
// height, so a real click cannot land on it; the app's own caret helpers
// build the same range. Typing afterwards is still the native engine.
async function caretInBlock(page, selector, index) {
  await page.evaluate(({ selector, index }) => {
    const all = document.querySelectorAll(selector);
    const el = all[index < 0 ? all.length + index : (index || 0)];
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, { selector, index });
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
  const p = writeNote(NOTE, SOURCE);
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
    // A missing or unlaunchable browser is an environment problem, not a
    // product failure: say so plainly instead of dumping the Playwright
    // stack, and make the exit code distinct from a failed assertion.
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

    // Boot straight to the note via the app's own deep link.
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content h2", { timeout: 15000 });

    // --- no-op: enter hybrid, change nothing, exit -----------------
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await page.click("#close-edit-btn");
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    check("real browser: clean enter+exit preserves the file bytes",
      readNote(NOTE) === SOURCE, JSON.stringify(readNote(NOTE)));

    // --- no-op: clean Save then exit issues no write --------------------
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    const mtimeBefore = fs.statSync(p).mtimeMs;
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 400));
    check("real browser: clean Save then exit leaves the file untouched",
      readNote(NOTE) === SOURCE && fs.statSync(p).mtimeMs === mtimeBefore,
      JSON.stringify(readNote(NOTE)));

    // --- the real edit path a browser produces ---------------------
    // Type into the paragraph (the empty heading has zero height in a
    // real browser, so a caret placed there is redirected by the engine
    // -- a separate, pre-existing bug). This exercises native
    // contentEditable markup, which jsdom cannot produce.
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content p", -1);
    await page.keyboard.press("End");
    await page.keyboard.type(" Now.");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    const afterType = readNote(NOTE);
    check("real browser: a native paragraph edit lands",
      /Run `audiochat chat`\. Now\./.test(afterType), JSON.stringify(afterType));
    check("real browser: the empty heading line survives the edit",
      afterType.indexOf("\n###\n") !== -1, JSON.stringify(afterType));
    check("real browser: the code-space heading survives the edit",
      afterType.indexOf("### `   `") !== -1, JSON.stringify(afterType));
    check("real browser: no HTML tag reached the file",
      !/<\/?[a-zA-Z][^>]*>/.test(afterType), JSON.stringify(afterType));

    // --- a second edit: headings keep their bytes ------------------
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content h2", 0);
    await page.keyboard.press("End");
    await page.keyboard.type(" today");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    const afterPara = readNote(NOTE);
    check("real browser: an h2 edit lands",
      afterPara.indexOf("## Commands today") !== -1, JSON.stringify(afterPara));
    check("real browser: untouched empty-heading line unchanged",
      afterPara.indexOf("\n###\n") !== -1, JSON.stringify(afterPara));
    check("real browser: untouched code-space line unchanged",
      afterPara.indexOf("### `   `") !== -1, JSON.stringify(afterPara));

    check("real browser: no uncaught page errors", pageErrors.length === 0,
      pageErrors.join(" | "));

    // --- locality: editing one block must not reformat the others ----
    // A note whose untouched regions a whole-DOM re-serialize would
    // canonicalize (`*` bullets -> `-`, blank run collapse, setext -> atx,
    // indented -> fenced). Editing ONE paragraph must leave every other
    // byte alone.
    const LOCALITY = "para one\n\n* a\n* b\n\nTitle\n=====\n\n    code\n\nlast para\n";
    writeNote("notes/locality.md", LOCALITY);
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/locality.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content p", -1);
    await page.keyboard.press("End");
    await page.keyboard.type(" EDITED");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    const localityOut = readNote("notes/locality.md");
    check("real browser: the edited paragraph changed",
      localityOut.indexOf("last para EDITED") !== -1, JSON.stringify(localityOut));
    check("real browser: untouched star bullets kept their marker",
      localityOut.indexOf("* a\n* b") !== -1, JSON.stringify(localityOut));
    check("real browser: untouched setext heading kept its form",
      localityOut.indexOf("Title\n=====") !== -1, JSON.stringify(localityOut));
    check("real browser: untouched indented code kept its form",
      localityOut.indexOf("    code") !== -1, JSON.stringify(localityOut));

    check("real browser: no uncaught page errors after locality",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- behavior catalog: empty heading accepts text (Q12) ----------
    // An empty heading has zero height; before the fix the caret was
    // redirected so typed text landed in the next block. Typing at the
    // empty h3 must stay in the heading.
    writeNote("notes/emptyhead.md", "## Commands\n###\n### `   `\n\nbody\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/emptyhead.md"));
    await page.waitForSelector("#viewer-content h2", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    {
      const box = await page.evaluate(() => {
        const h = document.querySelectorAll("#viewer-content h3")[0];
        const b = h.getBoundingClientRect();
        return { x: b.x + 5, y: b.y + b.height / 2, height: b.height };
      });
      check("real browser: an empty heading has a line box (height > 0)",
        box.height > 0, "height=" + box.height);
      await page.mouse.click(box.x, box.y);
      await page.keyboard.type("Overview");
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const eh = readNote("notes/emptyhead.md");
      check("real browser: typed text lands in the empty heading",
        eh.indexOf("### Overview") !== -1, JSON.stringify(eh));
      check("real browser: the code-space heading is untouched",
        eh.indexOf("### `   `") !== -1, JSON.stringify(eh));
      check("real browser: no HTML tag reached the file",
        !/<\/?[a-zA-Z][^>]*>/.test(eh), JSON.stringify(eh));
    }

    // --- behavior catalog: empty list item saves as a bare marker (Q18) -
    // The browser marks the new empty item with a <br>; left in it saved
    // as junk. Enter on a list item must produce a clean marker.
    writeNote("notes/listenter.md", "- item\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/listenter.md"));
    await page.waitForSelector("#viewer-content li", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content li", 0);
    await page.keyboard.press("Enter");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    {
      const le = readNote("notes/listenter.md");
      check("real browser: Enter on a list item saves a clean bare marker",
        le.indexOf("-   item\n-") !== -1 &&
        !/[ \t]+\n/.test(le.replace(/\n+$/g, "\n")),
        JSON.stringify(le));
    }

    // --- behavior catalog: emptied blockquote keeps its marker (Q7) --
    writeNote("notes/emptyquote.md", "> quote\n\nbody\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/emptyquote.md"));
    await page.waitForSelector("#viewer-content blockquote", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await page.evaluate(() => {
      const p = document.querySelector("#viewer-content blockquote p");
      p.textContent = "";
      p.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    {
      const eq = readNote("notes/emptyquote.md");
      check("real browser: an emptied blockquote survives as '>'",
        /^>/m.test(eq) && eq.indexOf("body") !== -1, JSON.stringify(eq));
    }

    check("real browser: no uncaught page errors after catalog cases",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- behavior catalog: structural edit keeps untouched bytes (Q1) -
    // Enter (a new block) must not canonicalize the rest of the file:
    // star bullets, a setext heading, and indented code must survive.
    const STRUCT = "first\n\n* star a\n* star b\n\nTitle\n=====\n\n    indented\n";
    writeNote("notes/struct.md", STRUCT);
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/struct.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content p", 0);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("newpara");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    {
      const so = readNote("notes/struct.md");
      check("real browser Q1: structural Enter keeps star-bullet bytes",
        so.indexOf("* star a\n* star b") !== -1, JSON.stringify(so));
      check("real browser Q1: structural Enter keeps the setext heading",
        so.indexOf("Title\n=====") !== -1, JSON.stringify(so));
      check("real browser Q1: structural Enter keeps indented code",
        so.indexOf("    indented") !== -1, JSON.stringify(so));
      check("real browser Q1: the new block is written",
        so.indexOf("newpara") !== -1, JSON.stringify(so));
      check("real browser Q1: no canonicalized artifact",
        so.indexOf("```undefined") === -1 && so.indexOf("-   star") === -1,
        JSON.stringify(so));
    }

    check("real browser: no uncaught page errors after Q1",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- spec contract: native editing engine rows (🌐) ---------------
    // The rows jsdom cannot produce: Enter/Shift+Enter splits, and the
    // exact file bytes after a real keypress. Spec:
    // docs/architecture/hybrid-editing.md §5.1, I9/Q16 (one Enter, one
    // break), Q1 (structural edits preserve untouched bytes).

    // (🌐) Merging a block into a heading must not inflate the heading's
    // text. The real editing engine wraps text carried across a
    // Backspace/Delete merge in a presentational <span style="font-size:
    // …"> copied from the source block, so joining a second heading into
    // the title rendered the moved words a size bigger inside it (and
    // each split/join compounded it). hybrid.js clears that engine style;
    // the file bytes were always correct, so this asserts the live DOM.
    writeNote("notes/headmerge.md", "## Title Middle End\n\nbody\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/headmerge.md"));
    await page.waitForSelector("#viewer-content h2", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    {
      // Caret mid-title, after "Title".
      await page.evaluate(() => {
        const h = document.querySelector("#viewer-content h2");
        const r = document.createRange();
        r.setStart(h.firstChild, 5);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(120);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(120);
      const maxFs = await page.evaluate(() => {
        const h = document.querySelector("#viewer-content h2");
        let max = parseFloat(getComputedStyle(h).fontSize);
        h.querySelectorAll("*").forEach((d) => {
          max = Math.max(max, parseFloat(getComputedStyle(d).fontSize));
        });
        return max;
      });
      const baseFs = await page.evaluate(
        () => parseFloat(getComputedStyle(
          document.querySelector("#viewer-content h2")).fontSize));
      check("real browser heading merge: rejoined title text keeps the heading size",
        Math.abs(maxFs - baseFs) < 0.5,
        "heading=" + baseFs + " maxDescendant=" + maxFs);
      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      check("real browser heading merge: the join still preserves the file bytes",
        readNote("notes/headmerge.md") === "## Title Middle End\n\nbody\n",
        JSON.stringify(readNote("notes/headmerge.md")));
    }

    // (a) A single Enter at the end of a paragraph is one block break:
    // never several newlines, never a <br>.
    writeNote("notes/entersplit.md", "alpha beta\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/entersplit.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content p", 0);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("gamma");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    {
      const es = readNote("notes/entersplit.md");
      check("real browser Enter: the new line holds the typed text",
        /alpha beta[\s\S]*gamma/.test(es), JSON.stringify(es));
      check("real browser Enter: one Enter writes one block break",
        es.indexOf("alpha beta\n\ngamma") !== -1, JSON.stringify(es));
      check("real browser Enter: one Enter never adds several newlines",
        es.indexOf("\n\n\n") === -1, JSON.stringify(es));
      check("real browser Enter: no <br> reached the file",
        es.indexOf("<br") === -1, JSON.stringify(es));
    }

    // (b) Shift+Enter adds a single break and no <br>. Q15 (soft break
    // vs block) is still open, so assert the invariant common to both:
    // at most one break, never a tag.
    writeNote("notes/softenter.md", "soft line\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/softenter.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content p", 0);
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("next");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    {
      const se = readNote("notes/softenter.md");
      check("real browser Shift+Enter: the typed text lands on the new line",
        /soft line[\s\S]*next/.test(se), JSON.stringify(se));
      check("real browser Shift+Enter: never several newlines",
        se.indexOf("\n\n\n") === -1, JSON.stringify(se));
      check("real browser Shift+Enter: no <br> reached the file",
        se.indexOf("<br") === -1, JSON.stringify(se));
    }

    // (c) Q1 structural locality after a real Shift+Enter keypress. The
    // C1 defect: an empty-line insert falls back to the whole-DOM
    // serializer, canonicalizing every untouched block (`* star` -> `-`,
    // setext -> atx, indented -> fenced ```undefined). Every untouched
    // block must keep its exact bytes.
    const SHIFT_STRUCT =
      "first\n\n* star a\n* star b\n\nTitle\n=====\n\n    indented\n";
    writeNote("notes/shiftstruct.md", SHIFT_STRUCT);
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/shiftstruct.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content p", 0);
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Enter");
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    {
      const ss = readNote("notes/shiftstruct.md");
      check("real browser Q1 C1: Shift+Enter keeps star-bullet bytes",
        ss.indexOf("* star a\n* star b") !== -1, JSON.stringify(ss));
      check("real browser Q1 C1: Shift+Enter keeps the setext heading",
        ss.indexOf("Title\n=====") !== -1, JSON.stringify(ss));
      check("real browser Q1 C1: Shift+Enter keeps indented code",
        ss.indexOf("    indented") !== -1, JSON.stringify(ss));
      check("real browser Q1 C1: no canonicalized artifact",
        ss.indexOf("```undefined") === -1 && ss.indexOf("-   star") === -1,
        JSON.stringify(ss));
    }

    // (d) Byte-identity after enter+exit on real hand-written notes —
    // the §8.3 corpus additions. Preservation must hold with the real
    // renderer and the real editing engine.
    const ENTER_EXIT_CORPUS = [
      ["owner", "## Commands\n###\n### `   `\n"],
      ["tilde", "~~~\ntext\n~~~\n"],
      ["nestedquote", "> outer\n> > inner\n"],
      ["task", "- [ ] task\n- [x] task\n"],
      ["hardbreak", "a  \nb\n"],
    ];
    for (const [label, src] of ENTER_EXIT_CORPUS) {
      const rel = "notes/corpus-" + label + ".md";
      writeNote(rel, src);
      await page.goto(BASE + "/?file=" + encodeURIComponent(rel));
      await page.waitForSelector("#viewer-content > *", { timeout: 15000 });
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      check("real browser corpus " + label +
        ": clean enter+exit is byte-identical",
        readNote(rel) === src, JSON.stringify(readNote(rel)));
    }

    check("real browser: no uncaught page errors after spec contract",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- selectable horizontal rule (PLAN — Selectable horizontal rule) -
    // A rule is selectable like a character, using the browser's own
    // selection engine -- the same engine in hybrid and preview mode. A
    // real drag that starts on the <hr> must leave it inside the native
    // selection and mark it with nb-hr-selected (its only painted pixel is
    // the border, so the native highlight is invisible on it); a plain
    // click on the rule must still repair the caret to the clicked side.
    // The selection chrome must never reach the file.
    writeNote("notes/rule.md", "first paragraph\n\n---\n\nsecond paragraph\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/rule.md"));
    // state: attached -- an <hr>'s content box is zero-height, which
    // Playwright's "visible" heuristic treats as hidden.
    await page.waitForSelector("#viewer-content hr",
      { state: "attached", timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    {
      const ruleBox = await page.evaluate(() => {
        const hr = document.querySelector("#viewer-content > hr");
        const b = hr.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2,
          top: b.top, height: b.height, width: b.width };
      });
      const paraBox = await page.evaluate(() => {
        const ps = document.querySelectorAll("#viewer-content > p");
        const b = ps[ps.length - 1].getBoundingClientRect();
        return { x: b.x + 40, y: b.y + b.height / 2 };
      });
      const clip = {
        x: Math.max(0, Math.round(ruleBox.x - ruleBox.width / 2 - 4)),
        y: Math.max(0, Math.round(ruleBox.top - 6)),
        width: Math.round(ruleBox.width + 8),
        height: Math.max(12, Math.round(ruleBox.height + 12)),
      };
      const beforePixels = await page.screenshot({ clip });

      // Real drag: press on the rule, move into the paragraph below. The
      // native selection must stand -- a rule press is no longer cancelled.
      await page.mouse.move(ruleBox.x, ruleBox.y);
      await page.mouse.down();
      await page.mouse.move(paraBox.x, paraBox.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(120);

      const selected = await page.evaluate(() => {
        const sel = window.getSelection();
        // Does the selected range actually cover the void rule? This is
        // the reported behaviour: "if you select it, it is selected".
        const hr = document.querySelector("#viewer-content > hr");
        const r = sel.rangeCount ? sel.getRangeAt(0) : null;
        return {
          collapsed: sel.isCollapsed,
          text: sel.toString(),
          coversRule: !!(r && (r.intersectsNode(hr) ||
            sel.containsNode(hr, true))),
          classes: hr.className,
        };
      });
      check("real browser hr: a real drag from the rule creates a selection",
        selected.collapsed === false && selected.text.length > 0,
        JSON.stringify(selected));
      check("real browser hr: the selected range covers the rule",
        selected.coversRule === true, JSON.stringify(selected));
      check("real browser hr: a selected rule in hybrid mode is marked",
        selected.classes.split(/\s+/).indexOf("nb-hr-selected") !== -1,
        "class=" + selected.classes);
      // Pixel proof: the rule region must paint differently when selected.
      const afterPixels = await page.screenshot({ clip });
      check("real browser hr: the selected rule is actually painted",
        !afterPixels.equals(beforePixels),
        "bytes=" + beforePixels.length + "->" + afterPixels.length);

      // Preview parity: the same drag in preview mode (no hybrid) must
      // produce the same selection shape AND the same highlight class --
      // selection logic is identical in both modes. Exiting hybrid changes
      // the editor chrome above the note (the format bar is removed), so
      // the rule shifts vertically; the boxes captured in hybrid mode are
      // stale and the drag would miss it. Re-measure in preview first.
      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const previewRuleBox = await page.evaluate(() => {
        const hr = document.querySelector("#viewer-content > hr");
        const b = hr.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      const previewParaBox = await page.evaluate(() => {
        const ps = document.querySelectorAll("#viewer-content > p");
        const b = ps[ps.length - 1].getBoundingClientRect();
        return { x: b.x + 40, y: b.y + b.height / 2 };
      });
      await page.mouse.move(previewRuleBox.x, previewRuleBox.y);
      await page.mouse.down();
      await page.mouse.move(previewParaBox.x, previewParaBox.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(120);
      const preview = await page.evaluate(() => {
        const sel = window.getSelection();
        const hr = document.querySelector("#viewer-content > hr");
        const r = sel.rangeCount ? sel.getRangeAt(0) : null;
        return {
          collapsed: sel.isCollapsed,
          text: sel.toString(),
          coversRule: !!(r && (r.intersectsNode(hr) ||
            sel.containsNode(hr, true))),
          classes: hr.className,
        };
      });
      check("real browser hr: preview mode selects the rule the same way",
        preview.collapsed === false && preview.coversRule === true,
        JSON.stringify(preview));
      check("real browser hr: preview mode marks the selected rule too",
        preview.classes.split(/\s+/).indexOf("nb-hr-selected") !== -1,
        "class=" + preview.classes);

      // Collapse the selection with a plain click in a paragraph: the
      // mark must come off in preview mode. Use the preview box -- the
      // hybrid box is stale.
      await page.mouse.click(previewParaBox.x, previewParaBox.y);
      await page.waitForTimeout(120);
      const collapsedCls = await page.evaluate(
        () => document.querySelector("#viewer-content > hr").className);
      check("real browser hr: collapsing the selection clears the mark",
        collapsedCls.split(/\s+/).indexOf("nb-hr-selected") === -1,
        "class=" + collapsedCls);

      // Back to hybrid for the click-repair check: a plain click on the
      // rule must still park the caret at the rule (the original fix).
      await page.evaluate(() => window.getSelection().removeAllRanges());
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await page.mouse.click(ruleBox.x, ruleBox.y);
      await page.waitForTimeout(120);
      const clickState = await page.evaluate(() => {
        const sel = window.getSelection();
        const vc = document.getElementById("viewer-content");
        return { collapsed: sel.isCollapsed,
          host: sel.anchorNode === vc ? "#viewer-content" :
            (sel.anchorNode && sel.anchorNode.nodeName) };
      });
      check("real browser hr: a plain click still parks the caret on the rule",
        clickState.collapsed === true && clickState.host === "#viewer-content",
        JSON.stringify(clickState));

      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const savedRuleFile = readNote("notes/rule.md");
      check("real browser hr: the file is byte-identical after selecting a rule",
        savedRuleFile === "first paragraph\n\n---\n\nsecond paragraph\n",
        JSON.stringify(savedRuleFile));
    }

    check("real browser: no uncaught page errors after rule selection",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- arrow-key caret navigation inside a table ------------------
    // The reported defect: a contentEditable caret engine traverses a
    // table's cells in DOM order for VERTICAL movement, so ArrowDown from
    // a body cell lands in the next cell to the RIGHT (same as
    // ArrowRight) and ArrowUp in the previous cell. hybrid.js moves the
    // caret to the spatially adjacent cell instead. Horizontal movement
    // is claimed only at the cell's text edge, so moving within the
    // cell's own text stays native. jsdom has no layout or selection
    // engine, so this is real-browser only.
    writeNote("notes/table-nav.md",
      "before\n\n| A | B | C |\n| --- | --- | --- |\n" +
      "| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n\nafter\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/table-nav.md"));
    await page.waitForSelector("#viewer-content table", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    {
      // Caret location as {row, col} relative to the table, or null when
      // the caret left the table.
      const where = () => page.evaluate(() => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        let n = sel.getRangeAt(0).startContainer;
        if (n.nodeType === 3) n = n.parentElement;
        const cell = n && n.closest ? n.closest("td,th") : null;
        if (!cell) return null;
        const table = cell.closest("table");
        const row = cell.parentElement;
        return { row: Array.from(table.rows).indexOf(row), col: cell.cellIndex };
      });
      // Place the caret at the START of a cell, or at its END when
      // `atEnd` is set (needed to cross a cell boundary horizontally).
      const put = (ri, ci, atEnd) => page.evaluate(({ ri, ci, atEnd }) => {
        const cell = document.querySelector("#viewer-content table")
          .rows[ri].cells[ci];
        cell.focus();
        const r = document.createRange();
        r.selectNodeContents(cell);
        r.collapse(!atEnd);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }, { ri, ci, atEnd });

      // ArrowRight at the cell's end: next cell in the SAME row.
      await put(1, 0, true);
      await page.keyboard.press("ArrowRight");
      const afterRight = await where();
      check("real browser table-nav: ArrowRight at cell end -> next cell, same row",
        afterRight && afterRight.row === 1 && afterRight.col === 1,
        JSON.stringify(afterRight));

      // ArrowDown: the NEXT ROW, same column -- the reported defect was
      // that this moved right instead. Start mid-cell to prove the claim
      // does not depend on the caret being at an edge.
      await put(1, 1, false);
      await page.keyboard.press("ArrowDown");
      const afterDown = await where();
      check("real browser table-nav: ArrowDown -> next row, SAME column",
        afterDown && afterDown.row === 2 && afterDown.col === 1,
        JSON.stringify(afterDown));

      // ArrowUp: the previous row, same column.
      await put(2, 1, false);
      await page.keyboard.press("ArrowUp");
      const afterUp = await where();
      check("real browser table-nav: ArrowUp -> previous row, SAME column",
        afterUp && afterUp.row === 1 && afterUp.col === 1,
        JSON.stringify(afterUp));

      // ArrowLeft at the cell's start: previous cell in the SAME row.
      await put(1, 2, false);
      await page.keyboard.press("ArrowLeft");
      const afterLeft = await where();
      check("real browser table-nav: ArrowLeft at cell start -> previous cell, same row",
        afterLeft && afterLeft.row === 1 && afterLeft.col === 1,
        JSON.stringify(afterLeft));

      // In-cell text movement is NOT stolen: with the caret in the middle
      // of a cell's text, ArrowLeft/ArrowRight move one character inside
      // the cell (same cell, different offset), not to the neighbour.
      const offset = () => page.evaluate(() => {
        const sel = window.getSelection();
        return sel && sel.rangeCount ? sel.getRangeAt(0).startOffset : -1;
      });
      await put(1, 1, false);              // start of "b1"
      await page.keyboard.press("ArrowRight");
      const inCell = await where();
      check("real browser table-nav: ArrowRight inside cell text stays in the cell",
        inCell && inCell.row === 1 && inCell.col === 1 && (await offset()) === 1,
        JSON.stringify(inCell) + " off=" + (await offset()));

      // ArrowRight at the table's last column is not claimed (there is no
      // cell to the right); the native engine takes over and the caret
      // leaves the table rather than being trapped in the cell.
      await put(1, 2, true);
      await page.keyboard.press("ArrowRight");
      const atRightEdge = await where();
      check("real browser table-nav: ArrowRight at the last column is left to the browser",
        atRightEdge === null ||
          (atRightEdge.row === 1 && atRightEdge.col === 2),
        JSON.stringify(atRightEdge));

      // ArrowUp at the top row leaves the table (the header is the top
      // row; above it is a caret-holding paragraph).
      await put(0, 1, false);
      await page.keyboard.press("ArrowUp");
      const above = await where();
      check("real browser table-nav: ArrowUp from the header leaves the table",
        above === null, JSON.stringify(above));

      // Preview parity first: navigation alone never writes the note (the
      // DOM mutation in the multi-line check below must not be pending
      // when this is asserted).
      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const untouched = readNote("notes/table-nav.md");
      check("real browser table-nav: navigation alone never writes the note",
        untouched ===
          "before\n\n| A | B | C |\n| --- | --- | --- |\n" +
          "| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n\nafter\n",
        JSON.stringify(untouched));

      // A MULTI-LINE cell must still move line-by-line: from the first
      // line ArrowDown goes to the cell's second line (same cell), not to
      // the next row. Only from the cell's LAST line does it cross. The
      // mutation below is deliberate and local to this fresh hybrid session.
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      const lineTop = () => page.evaluate(() => {
        const sel = window.getSelection();
        return sel && sel.rangeCount
          ? Math.round(sel.getRangeAt(0).getBoundingClientRect().top) : -1;
      });
      const putLineFirst = () => page.evaluate(() => {
        const cell = document.querySelector("#viewer-content table").rows[1].cells[1];
        cell.focus();
        const r = document.createRange();
        r.setStart(cell.firstChild, 0);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      });

      // The seeded note's cells are single-line; inject a <br> to make
      // cell (1,1) multi-line, matching what Shift+Enter produces.
      await page.evaluate(() => {
        const cell = document.querySelector("#viewer-content table").rows[1].cells[1];
        cell.appendChild(document.createElement("br"));
        cell.appendChild(document.createTextNode("b1b"));
      });
      await putLineFirst();
      const lineA = await lineTop();
      await page.keyboard.press("ArrowDown");
      const lineB = await lineTop();
      const stillCell = await where();
      check("real browser table-nav: ArrowDown inside a multi-line cell moves a line",
        lineB > lineA && stillCell && stillCell.row === 1 && stillCell.col === 1,
        JSON.stringify(stillCell) + " lines " + lineA + "->" + lineB);
      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    }

    check("real browser: no uncaught page errors after table navigation",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- brand-new empty note: the first "# " becomes an <h1> ---------
    // Reported defect: in a brand-new (empty) note the first characters
    // live as a bare text node directly under #viewer-content (there is
    // no <p> to type into). The block-rule guard refused any root caret
    // whose container had a firstChild, so "# " stayed literal and saved
    // as an escaped "\# " instead of becoming a heading. This is the real
    // editing engine writing native markup, so it cannot run in jsdom.
    writeNote("notes/newnote.md", "");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/newnote.md"));
    await page.waitForFunction(
      () => { const b = document.getElementById("hybrid-toggle"); return b && !b.hidden; },
      null, { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    // The app focuses #viewer-content on enter; type straight into it the
    // way a user starting a new note would.
    await page.keyboard.type("#");
    await page.keyboard.type(" ");
    await page.waitForTimeout(200);
    {
      const madeHeading = await page.evaluate(
        () => !!document.querySelector("#viewer-content h1"));
      check("real browser new note: '# ' typed into the empty note becomes an <h1>",
        madeHeading,
        "html=" + (await page.evaluate(
          () => document.getElementById("viewer-content").innerHTML)));
      await page.keyboard.type("Title");
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const nn = readNote("notes/newnote.md");
      check("real browser new note: the saved note is '# Title'",
        nn.indexOf("# Title") !== -1 && nn.indexOf("\\#") === -1,
        JSON.stringify(nn));
      check("real browser new note: no HTML tag reached the file",
        !/<\/?[a-zA-Z][^>]*>/.test(nn), JSON.stringify(nn));
    }

    check("real browser: no uncaught page errors after new-note case",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- task lists: checkbox toggle + edit-bar Task button -----------
    // The rendered checkbox must be interactive in hybrid mode (marked
    // emits it disabled), and the edit-bar Task button must build and
    // remove the task shape. The click and the CSS below only exist with
    // a real editing engine and a real stylesheet, so this is real-browser
    // only. The checkbox round-trip is asserted against the file bytes.
    {
      const TASK_SRC = "- [ ] task\n";
      writeNote("notes/tasktoggle.md", TASK_SRC);
      await page.goto(BASE + "/?file=" + encodeURIComponent("notes/tasktoggle.md"));
      await page.waitForSelector("#viewer-content li", { timeout: 15000 });

      // Rendered (preview) state: marked emits a bare <li> with the
      // checkbox as a direct child; style.css suppresses the bullet.
      const renderState = await page.evaluate(() => {
        const li = document.querySelector("#viewer-content li");
        const cb = li && li.querySelector('input[type="checkbox"]');
        return {
          cbDirect: !!(cb && cb.parentElement === li),
          disabled: cb ? cb.disabled : null,
          listStyle: li ? getComputedStyle(li).listStyleType : null,
        };
      });
      check("real browser task: the rendered checkbox is a direct <li> child",
        renderState.cbDirect, JSON.stringify(renderState));
      check("real browser task: the rendered bullet is suppressed (list-style none)",
        renderState.listStyle === "none", JSON.stringify(renderState));

      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      const startChecked = await page.evaluate(
        () => document.querySelector('#viewer-content input[type="checkbox"]').checked);
      check("real browser task: checkbox starts unchecked", startChecked === false,
        "checked=" + startChecked);

      // Two real clicks flip the native `checked` both ways; jsdom cannot
      // run the checkbox's own toggle.
      await page.click('#viewer-content input[type="checkbox"]');
      await page.waitForTimeout(80);
      const afterFirst = await page.evaluate(
        () => document.querySelector('#viewer-content input[type="checkbox"]').checked);
      check("real browser task: first checkbox click checks it",
        afterFirst === true, "checked=" + afterFirst);
      await page.click('#viewer-content input[type="checkbox"]');
      await page.waitForTimeout(80);
      const afterSecond = await page.evaluate(
        () => document.querySelector('#viewer-content input[type="checkbox"]').checked);
      check("real browser task: a second checkbox click unchecks it",
        afterSecond === false, "checked=" + afterSecond);

      // One more click leaves it checked, then Save then exit must write [x].
      await page.click('#viewer-content input[type="checkbox"]');
      await page.waitForTimeout(80);
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const savedChecked = readNote("notes/tasktoggle.md");
      check("real browser task: a checked checkbox saves as '[x]'",
        savedChecked.indexOf("[x]") !== -1 &&
        savedChecked.indexOf("[ ]") === -1 && savedChecked.indexOf("task") !== -1,
        JSON.stringify(savedChecked));
      check("real browser task: no HTML tag reached the file",
        !/<\/?[a-zA-Z][^>]*>/.test(savedChecked), JSON.stringify(savedChecked));

      // Re-enter: the checkbox renders checked from the saved [x]; one
      // click unchecks it and one Save then exit must write [ ] back.
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      const rechecked = await page.evaluate(
        () => document.querySelector('#viewer-content input[type="checkbox"]').checked);
      check("real browser task: the re-rendered checkbox is checked",
        rechecked === true, "checked=" + rechecked);
      await page.click('#viewer-content input[type="checkbox"]');
      await page.waitForTimeout(80);
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const savedUnchecked = readNote("notes/tasktoggle.md");
      check("real browser task: an unchecked checkbox saves as '[ ]'",
        savedUnchecked.indexOf("[ ]") !== -1 &&
        savedUnchecked.indexOf("[x]") === -1,
        JSON.stringify(savedUnchecked));
    }

    // Enter before the first character of a checkbox item -- the caret a
    // checkbox click leaves -- still opens the new item BELOW and puts the
    // caret in it. The caret is put at the item text's offset 0 in the real
    // editing engine, then a real Enter keypress types into the new item;
    // the saved bytes prove the text landed second, not first.
    {
      writeNote("notes/taskstartenter.md", "- [ ] first\n- [ ] second\n");
      await page.goto(BASE + "/?file=" + encodeURIComponent("notes/taskstartenter.md"));
      await page.waitForSelector("#viewer-content li", { timeout: 15000 });
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await page.evaluate(() => {
        const vc = document.getElementById("viewer-content");
        vc.focus();
        const li = vc.querySelector("li");
        const text = li && li.lastChild;
        const r = document.createRange();
        r.setStart(text, 0);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("added");
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      const lines = readNote("notes/taskstartenter.md").trimEnd().split("\n");
      check("real browser task: Enter at the first character opens an item below",
        lines.length === 3 && /^- \[ \] first$/.test(lines[0]) &&
        /^- \[ \] added$/.test(lines[1]) && lines[2].indexOf("second") !== -1,
        JSON.stringify(lines));
    }

    // The edit-bar Task button: first press builds the task item, a
    // second press removes it (the toolbar toggle contract).
    writeNote("notes/taskbutton.md", "hello\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/taskbutton.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await caretInBlock(page, "#viewer-content p", 0);
    await page.click('#edit-bar [data-act="task"]');
    await page.waitForTimeout(80);
    {
      const made = await page.evaluate(() => {
        const li = document.querySelector("#viewer-content li.task-list-item");
        const cb = li && li.querySelector('input[type="checkbox"]');
        return { li: !!li, cbDirect: !!(cb && cb.parentElement === li) };
      });
      check("real browser task button: a press builds a task item",
        made.li && made.cbDirect, JSON.stringify(made));
    }
    await page.click('#edit-bar [data-act="task"]');
    await page.waitForTimeout(80);
    {
      // The second press returns the item to a plain PARAGRAPH, not a
      // bullet: source mode's Task button strips the whole "- [ ] "
      // marker, so the WYSIWYG toggle must end outside the list too.
      const gone = await page.evaluate(() => {
        const vc = document.getElementById("viewer-content");
        const p = vc.querySelector("p");
        return {
          ul: vc.querySelectorAll("ul").length,
          p: !!p && !p.closest("li"),
          text: p && p.textContent,
          task: vc.querySelectorAll("li.task-list-item").length,
          cb: vc.querySelectorAll('input[type="checkbox"]').length,
        };
      });
      check("real browser task button: a second press returns the item to a paragraph",
        gone.ul === 0 && gone.p && gone.text === "hello" &&
        gone.task === 0 && gone.cb === 0, JSON.stringify(gone));
    }
    await page.click("#close-edit-btn");
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    check("real browser task button: no uncaught page errors",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- reselectBlock: the selection survives a block transform ------
    // wrapBlock/toggleList replace the selected node; without re-anchoring,
    // the live range collapses to the editor root and a second toggle
    // resolves to nothing. A real browser selection is the only way to
    // observe this.
    writeNote("notes/reselect.md", "alpha\n\nbeta\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/reselect.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });

    const selectParagraph = (index) => page.evaluate((i) => {
      const p = document.querySelectorAll("#viewer-content p")[i];
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }, index);

    await selectParagraph(0);
    await page.click('#edit-bar [data-act="h1"]');
    await page.waitForTimeout(80);
    {
      const s = await page.evaluate(() => {
        const sel = window.getSelection();
        const made = document.querySelector("#viewer-content h1");
        return {
          collapsed: sel.isCollapsed,
          inside: !!(made && sel.rangeCount && made.contains(sel.anchorNode)),
          h1: !!made,
        };
      });
      check("real browser reselect: selection stays inside the new h1",
        s.h1 && s.collapsed === false && s.inside === true, JSON.stringify(s));
    }
    await selectParagraph(0);
    await page.click('#edit-bar [data-act="ul"]');
    await page.waitForTimeout(80);
    {
      const s = await page.evaluate(() => {
        const sel = window.getSelection();
        const made = document.querySelector("#viewer-content ul");
        return {
          collapsed: sel.isCollapsed,
          inside: !!(made && sel.rangeCount && made.contains(sel.anchorNode)),
          ul: !!made,
        };
      });
      check("real browser reselect: selection stays inside the new ul",
        s.ul && s.collapsed === false && s.inside === true, JSON.stringify(s));
    }
    await page.click("#close-edit-btn");
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    check("real browser reselect: no uncaught page errors",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- task <-> bullet toggle: the leading text must stay "- " -------
    // The user's report: toggling a list item between a checkbox and a
    // plain bullet must not shift the item's text. The rendered marker
    // (bullet) and the checkbox must occupy the same column, so the text
    // after it stays at the same x. The fixture mixes a plain bullet, a
    // task, and an ordered item, then toggles the task on/off and compares
    // the text's left edge against the plain bullet's.
    writeNote("notes/togglegeom.md",
      "- plain a\n- [ ] task b\n- plain c\n\n1. one\n2. two\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/togglegeom.md"));
    await page.waitForSelector("#viewer-content li", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await page.waitForTimeout(80);

    // The text left edge of a list item's first rendered text node.
    const textLeftX = (pageRef, contains) => pageRef.evaluate((needle) => {
      const li = Array.from(document.querySelectorAll("#viewer-content li"))
        .find((l) => l.textContent.replace(/\u200B/g, "").includes(needle));
      if (!li) return null;
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue.replace(/\u200B/g, "").trim()) {
          const r = document.createRange();
          r.selectNodeContents(n);
          return r.getBoundingClientRect().x;
        }
      }
      return null;
    }, contains);

    const plainX = await textLeftX(page, "plain a");
    const taskX = await textLeftX(page, "task b");
    check("real browser task geom: plain bullet and task text align",
      plainX !== null && taskX !== null && Math.abs(plainX - taskX) < 1.5,
      "plain=" + plainX + " task=" + taskX);

    // The leading glyph (bullet vs checkbox) must occupy the same column.
    // A bullet is drawn centred ~0.8em left of the text; the checkbox
    // must be centred on the same point, or the marker jumps sideways on
    // every toggle. Measure the checkbox's box centre and compare it to a
    // plain item's marker centre, which is the text left edge minus the
    // bullet's offset from it.
    const centerDelta = await page.evaluate(() => {
      const lis = Array.from(document.querySelectorAll("#viewer-content li"));
      const plain = lis.find((l) => l.textContent.replace(/\u200B/g, "").includes("plain a"));
      const task = lis.find((l) => l.textContent.replace(/\u200B/g, "").includes("task b"));
      const cb = task.querySelector(':scope > input, :scope > p > input');
      if (!plain || !cb) return null;
      const textX = (el) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          if (n.nodeValue.replace(/\u200B/g, "").trim()) {
            const r = document.createRange();
            r.selectNodeContents(n);
            return r.getBoundingClientRect().x;
          }
        }
        return null;
      };
      const cbBox = cb.getBoundingClientRect();
      return {
        cbCenter: (cbBox.x + cbBox.right) / 2,
        plainTextX: textX(plain),
        fontPx: parseFloat(getComputedStyle(plain).fontSize),
      };
    });
    // A `disc` bullet is drawn with its centre ~0.86em left of the text
    // edge. The checkbox must be centred on that same point, or the
    // leading glyph jumps when toggling. Measured in em so the assertion
    // survives the app's font-size scale.
    const bulletOffsetEm = centerDelta
      ? (centerDelta.plainTextX - centerDelta.cbCenter) / centerDelta.fontPx
      : null;
    check("real browser task geom: the checkbox is centred on the bullet column",
      bulletOffsetEm !== null && bulletOffsetEm > 0.7 && bulletOffsetEm < 1.0,
      "offsetEm=" + bulletOffsetEm);

    // Toggle the task off, then on. The off state is a plain paragraph
    // (the list is ended), matching source mode; toggling back on
    // restores the task item with its text at the same x.
    const caretOnTask = () => page.evaluate(() => {
      const li = Array.from(document.querySelectorAll("#viewer-content li"))
        .find((l) => l.textContent.replace(/\u200B/g, "").includes("task b"));
      const r = document.createRange();
      r.selectNodeContents(li);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    const textAfter = async () => page.evaluate((needle) => {
      const li = Array.from(document.querySelectorAll("#viewer-content li"))
        .find((l) => l.textContent.replace(/\u200B/g, "").includes(needle));
      if (!li) return null;
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue.replace(/\u200B/g, "").trim()) {
          const r = document.createRange();
          r.selectNodeContents(n);
          return r.getBoundingClientRect().x;
        }
      }
      return null;
    }, "task b");

    await caretOnTask();
    await page.click('#edit-bar [data-act="task"]');
    await page.waitForTimeout(80);
    {
      // The item leaves the list as a plain paragraph. It sits mid-list,
      // so the list splits around it and the neighbours keep their text.
      const offShape = await page.evaluate(() => {
        const vc = document.getElementById("viewer-content");
        const p = Array.from(vc.querySelectorAll("p"))
          .find((el) => el.textContent.includes("task b"));
        const inLi = Array.from(vc.querySelectorAll("li"))
          .some((li) => li.textContent.includes("task b"));
        const kept = ["plain a", "plain c"].every((t) =>
          Array.from(vc.querySelectorAll("li")).some((li) => li.textContent.includes(t)));
        return { p: !!p, inLi: inLi, kept: kept };
      });
      check("real browser task geom: toggling off makes the item a paragraph",
        offShape.p && !offShape.inLi && offShape.kept, JSON.stringify(offShape));
    }
    await page.click('#edit-bar [data-act="task"]');
    await page.waitForTimeout(80);
    const onX = await textAfter();
    check("real browser task geom: toggling back to a checkbox keeps the text x",
      onX !== null && Math.abs(onX - taskX) < 1.5,
      "task=" + taskX + " on=" + onX);

    // The persisted bytes: the leading text is still the list marker form,
    // never a bare checkbox with no marker or a doubled "- -".
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const geomBytes = readNote("notes/togglegeom.md");
    check("real browser task geom: saved task keeps its '- ' list marker",
      /- +\[ \] +task b/.test(geomBytes) && !/\n\[ \]/.test(geomBytes),
      JSON.stringify(geomBytes));
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await page.click("#close-edit-btn");
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    check("real browser task geom: no uncaught page errors",
      pageErrors.length === 0, pageErrors.join(" | "));

    // --- list-type model: dot / number / checkbox transitions ---------
    // Each list button sets the caret ITEM's type; pressing its own type
    // removes it from the list; a different type converts it and drops any
    // checkbox. Verified in the DOM and after a save+re-render round
    // trip, so the persisted bytes match the live shape.
    const listShape = () => page.evaluate(() => {
      const shape = (el) => {
        if (el.tagName === "P") return "p";
        if (el.tagName === "BLOCKQUOTE") {
          return "quote(" + Array.from(el.children).map(shape).join(",") + ")";
        }
        const cb = el.querySelector('input[type="checkbox"]');
        return el.tagName.toLowerCase() + (cb ? "+task" : "");
      };
      return Array.from(document.querySelectorAll("#viewer-content > *"))
        .filter((el) => el.tagName === "UL" || el.tagName === "OL" ||
          el.tagName === "BLOCKQUOTE" ||
          (el.tagName === "P" && el.textContent.trim()))
        .map(shape).join(",");
    });
    const caretFirstItem = () => page.evaluate(() => {
      const el = document.querySelector("#viewer-content li, #viewer-content p");
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    const openNote = async (file, src) => {
      writeNote(file, src);
      await page.goto(BASE + "/?file=" + encodeURIComponent(file));
      await page.waitForSelector("#viewer-content li, #viewer-content p", { timeout: 15000 });
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await page.waitForTimeout(80);
    };
    const LIST_MODEL = [
      ["notes/lm1.md", "a\n",            "ul",   "ul"],
      ["notes/lm2.md", "a\n",            "ol",   "ol"],
      ["notes/lm3.md", "a\n",            "task", "ul+task"],
      ["notes/lm4.md", "- a\n",          "ul",   "p"],
      ["notes/lm5.md", "- a\n",          "ol",   "ol"],
      ["notes/lm6.md", "- a\n",          "task", "ul+task"],
      ["notes/lm7.md", "1. a\n",         "ul",   "ul"],
      ["notes/lm8.md", "1. a\n",         "ol",   "p"],
      ["notes/lm9.md", "1. a\n",         "task", "ol+task"],
      ["notes/lm10.md", "- [ ] a\n",     "ul",   "ul"],
      ["notes/lm11.md", "- [ ] a\n",     "ol",   "ol"],
      ["notes/lm12.md", "- [ ] a\n",     "task", "p"],
      // Quote wraps the top-level block: a paragraph or a whole list,
      // never a blockquote nested inside a list.
      ["notes/q1.md", "a\n",             "quote", "quote(p)"],
      ["notes/q2.md", "- a\n",           "quote", "quote(ul)"],
      ["notes/q3.md", "1. a\n",          "quote", "quote(ol)"],
      ["notes/q4.md", "- [ ] a\n",       "quote", "quote(ul+task)"],
      ["notes/q5.md", "> a\n",           "quote", "p"],
    ];
    let modelBad = [];
    for (const [file, src, act, expect] of LIST_MODEL) {
      await openNote(file, src);
      await caretFirstItem();
      await page.click('#edit-bar [data-act="' + act + '"]');
      await page.waitForTimeout(100);
      const dom = await listShape();
      if (dom !== expect) modelBad.push(src + "+" + act + "=" + dom);
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      // Re-render the saved bytes and confirm the shape round-trips.
      await page.waitForSelector("#viewer-content li, #viewer-content p", { timeout: 15000 });
      const again = await listShape();
      if (again !== expect) modelBad.push("bytes " + src + "+" + act + "=" + again);
    }
    check("real browser list model: every dot/number/checkbox/quote transition is defined",
      modelBad.length === 0, modelBad.join(" | "));

    // A mid-list item splits the list and the neighbours keep their bytes.
    await openNote("notes/lmsplit.md", "- a\n- b\n- c\n");
    await page.evaluate(() => {
      const li = Array.from(document.querySelectorAll("#viewer-content li"))
        .find((n) => n.textContent.includes("b"));
      const r = document.createRange();
      r.selectNodeContents(li);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.click('#edit-bar [data-act="task"]');
    await page.waitForTimeout(100);
    check("real browser list model: a mid-list item becomes a task in place",
      (await listShape()) === "ul+task", "got=" + (await listShape()));
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    await page.waitForSelector("#viewer-content li", { timeout: 15000 });
    // Plain items keep turndown's canonical "-   " padding; the converted
    // task item serializes compactly ("- [ ] b"), the deliberate contract
    // (normalizeTaskListSpacing in hybrid.js).
    check("real browser list model: the neighbours survive the save",
      readNote("notes/lmsplit.md") === "-   a\n- [ ] b\n-   c\n",
      JSON.stringify(readNote("notes/lmsplit.md")));

    // --- list-item drag reorder: pointer/geometry (§4.7.2, AC9-AC17) ---
    // jsdom cannot read layout, so the pointer path lives here: the grip
    // reveal/hide, the before/after split at the hit-region midline, the
    // checkbox-gutter hit region, the indent-rail depth clamp, the drop
    // line, subtree carrying, and the touch contract. The DOM mutation and
    // the saved bytes are asserted here too, against the real file on disk.
    {
      // #viewer-content's list geometry: the container's left edge, one
      // nesting step (the CSS list indent), and each top-level item's rect.
      const geom = () => page.evaluate(() => {
        const ul = document.querySelector("#viewer-content ul");
        const step = parseFloat(getComputedStyle(ul).paddingLeft) || 26;
        const r = ul.getBoundingClientRect();
        const lis = Array.from(ul.children).filter((n) => n.tagName === "LI")
          .map((li) => {
            const b = li.getBoundingClientRect();
            return { text: li.textContent.replace(/\u200B/g, "").trim(),
              x: b.x, y: b.y, h: b.height, bottom: b.bottom,
              cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
          });
        const p = document.querySelector("#viewer-content p");
        const pr = p ? p.getBoundingClientRect() : null;
        return { step: step, baseX: r.x + step, lis: lis,
          paraY: pr ? pr.y + pr.height / 2 : null };
      });
      // The live drag state: resolved (target/side/depth) and the drop line.
      const dragState = () => page.evaluate(() => {
        const d = window.NB.listEdit.drag;
        if (!d) return { noDrag: true };
        const line = document.querySelector(".nb-drop-line");
        const visible = !!line && line.offsetWidth > 0 &&
          getComputedStyle(line).display !== "none";
        return { noDrag: false, resolved: !!d.resolved,
          side: d.resolved ? d.resolved.side : null,
          depth: d.resolved ? d.resolved.depth : null,
          target: d.resolved && d.resolved.target
            ? d.resolved.target.textContent.replace(/\u200B/g, "").trim() : null,
          lineVisible: visible,
          lineTop: line ? line.getBoundingClientRect().top : null };
      });
      const gripAt = () => page.evaluate(() => {
        const g = document.querySelector(".nb-list-overlay .nb-list-grip");
        if (!g) return null;
        const b = g.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, left: b.x };
      });
      const ownOrder = () => page.evaluate(() =>
        Array.from(document.querySelectorAll("#viewer-content ul > li")).map((li) => {
          const c = li.cloneNode(true);
          c.querySelectorAll("ul,ol,input").forEach((n) => n.remove());
          return c.textContent.replace(/\u200B/g, "").trim();
        }));
      // list-edit.js exports startDrag as a test seam (line 531). jsdom
      // drives moveListItem directly; here we drive the pointer geometry
      // through the seam with synthetic pointer events on #viewer, because
      // the real grip cannot be pressed (see the defect checks below).
      const hookStart = (idx) => page.evaluate((i) => {
        const vc = document.getElementById("viewer-content");
        const item = Array.from(vc.querySelectorAll("li"))[i];
        const viewer = document.getElementById("viewer");
        const orig = viewer.setPointerCapture;
        viewer.setPointerCapture = () => {};   // no real pointer to capture
        window.NB.listEdit.startDrag({ pointerId: 1, clientX: 1, clientY: 1,
          preventDefault() {}, stopPropagation() {} }, item);
        viewer.setPointerCapture = orig;
        return !!window.NB.listEdit.drag;
      }, idx);
      const hookMove = (x, y) => page.evaluate(({ x, y }) => {
        document.getElementById("viewer").dispatchEvent(new PointerEvent(
          "pointermove", { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
      }, { x, y });
      const hookUp = () => page.evaluate(() => {
        document.getElementById("viewer").dispatchEvent(new PointerEvent(
          "pointerup", { bubbles: true, pointerId: 1 }));
      });
      const hookCancel = () => page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent("keydown",
          { key: "Escape", bubbles: true, cancelable: true }));
      });

      // Session 1: flat list.
      await openNote("notes/listdrag.md", "para\n\n- a\n- b\n- c\n- d\n");
      check("real browser list drag: overlay is outside #viewer-content",
        await page.evaluate(() => {
          const ov = document.querySelector(".nb-list-overlay");
          const vc = document.getElementById("viewer-content");
          return !!ov && !vc.contains(ov);
        }));
      const g1 = await geom();

      // Grip reveal on hover: the grip appears in the left gutter, left of
      // the item's own box.
      await page.mouse.move(g1.lis[1].cx, g1.lis[1].cy);
      await page.waitForTimeout(80);
      const grip1 = await gripAt();
      check("real browser list drag: hovering an item reveals its grip",
        !!grip1, JSON.stringify(grip1));
      check("real browser list drag: the grip sits in the left gutter",
        !!grip1 && grip1.left < g1.lis[1].x - 4,
        "grip=" + (grip1 && grip1.left) + " item=" + g1.lis[1].x);
      // The reported bug: on a plain dot/number list the grip used to sit
      // at the item's own left edge, on top of the marker. It must clear
      // the marker column -- the list's left padding, left of the item box.
      const markerClear = await page.evaluate(() => {
        const li = document.querySelectorAll("#viewer-content ul > li")[1];
        const ul = li.parentElement;
        const g = document.querySelector(".nb-list-overlay .nb-list-grip");
        if (!g) return null;
        return { gripRight: g.getBoundingClientRect().right,
                 ulLeft: ul.getBoundingClientRect().left };
      });
      check("real browser list drag: the grip clears the bullet marker column",
        !!markerClear && markerClear.gripRight <= markerClear.ulLeft + 0.5,
        JSON.stringify(markerClear));
      check("real browser list drag: the active item is the hovered one",
        (await page.evaluate(() => {
          const it = window.NB.listEdit.activeItem;
          return it ? it.textContent.replace(/\u200B/g, "").trim() : null;
        })) === "b");

      // Hide after the pointer leaves the list.
      await page.mouse.move(2, 2);
      await page.waitForTimeout(320);
      check("real browser list drag: the grip hides after the pointer leaves",
        (await page.evaluate(() =>
          document.querySelectorAll(".nb-list-overlay .nb-list-grip").length)) === 0);

      // Hover-intent lock: the grip must survive the pointer crossing from
      // the item onto the grip. The strip between the item's left edge and
      // the grip is part of the item's hit region (list-edit.js hitRect /
      // GUTTER_X), so the pointer never enters a dead band; a pointerdown on
      // the grip then starts a drag. These two checks guard that invariant.
      await page.mouse.move(g1.lis[3].cx, g1.lis[3].cy);
      await page.waitForTimeout(80);
      const gripD = await gripAt();
      await page.mouse.move(gripD.x, gripD.y);
      await page.waitForTimeout(30);
      check("real browser list drag: the hover-intent lock keeps the item on the grip",
        (await page.evaluate(() => {
          const it = window.NB.listEdit.activeItem;
          return it ? it.textContent.trim() : null;
        })) === "d");
      await page.mouse.move(g1.lis[3].cx, g1.lis[3].cy);   // re-reveal
      await page.waitForTimeout(80);
      const gripD2 = await gripAt();
      await page.mouse.move(gripD2.x, gripD2.y);
      await page.mouse.down();
      await page.waitForTimeout(30);
      check("real browser list drag: pointerdown on the grip starts a drag",
        await page.evaluate(() => !!window.NB.listEdit.drag &&
          document.body.classList.contains("nb-list-drag")));
      await page.mouse.up();
      await page.waitForTimeout(40);

      // The rest of the pointer path is driven through the startDrag seam so
      // the resolver, drop line, and commit run against real layout.
      check("real browser list drag: the exported drag hook starts a drag",
        await hookStart(3));   // item d
      check("real browser list drag: the ghost and proxy are drawn in the overlay",
        await page.evaluate(() => {
          const ov = document.querySelector(".nb-list-overlay");
          const vc = document.getElementById("viewer-content");
          return ov.querySelectorAll(".nb-drag-ghost").length === 1 &&
            ov.querySelectorAll(".nb-drag-proxy").length === 1 &&
            !vc.querySelector(".nb-drag-ghost,.nb-drag-proxy,.nb-drop-line");
        }));

      // A drop over the paragraph above the list is refused (non-list).
      await hookMove(g1.baseX, g1.paraY);
      await page.waitForTimeout(70);
      const stRefuse = await dragState();
      check("real browser list drag: a drop onto a non-list block is refused",
        !stRefuse.noDrag && !stRefuse.resolved && !stRefuse.lineVisible,
        JSON.stringify(stRefuse));

      // A drop at d's current position (after c) is a no-op: line hidden.
      await hookMove(g1.baseX, g1.lis[2].bottom - 2);
      await page.waitForTimeout(70);
      const stNoop = await dragState();
      check("real browser list drag: a drop at the current position hides the line",
        !stNoop.noDrag && !stNoop.resolved && !stNoop.lineVisible,
        JSON.stringify(stNoop));

      // Before/after split: the top half of b is "before", the bottom half
      // is "after". The drop line is drawn at the resolved boundary.
      await hookMove(g1.baseX, g1.lis[1].y + g1.lis[1].h * 0.25);
      await page.waitForTimeout(70);
      const stBefore = await dragState();
      check("real browser list drag: the top half of an item resolves 'before'",
        stBefore.resolved && stBefore.side === "before" &&
        stBefore.target === "b" && stBefore.lineVisible, JSON.stringify(stBefore));
      await hookMove(g1.baseX, g1.lis[1].y + g1.lis[1].h * 0.75);
      await page.waitForTimeout(70);
      const stAfter = await dragState();
      check("real browser list drag: the bottom half of an item resolves 'after'",
        stAfter.resolved && stAfter.side === "after" && stAfter.lineVisible,
        JSON.stringify(stAfter));
      check("real browser list drag: the drop line sits on the resolved boundary",
        stAfter.lineTop !== null &&
        Math.abs(stAfter.lineTop - g1.lis[1].bottom) < 6,
        "line=" + stAfter.lineTop + " bottom=" + g1.lis[1].bottom);

      // Commit the drop after b: [a,b,d,c].
      await hookUp();
      await page.waitForTimeout(120);
      check("real browser list drag: a completed drag reorders the list",
        JSON.stringify(await ownOrder()) === JSON.stringify(["a", "b", "d", "c"]),
        JSON.stringify(await ownOrder()));
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      check("real browser list drag: the reordered list saves canonical bytes",
        readNote("notes/listdrag.md") === "para\n\n-   a\n-   b\n-   d\n-   c\n",
        JSON.stringify(readNote("notes/listdrag.md")));

      // Session 2: the indent rail nests the item one level under item b.
      await openNote("notes/listindent.md", "- a\n- b\n- c\n");
      const g2 = await geom();
      await hookStart(2);   // item c
      // One rail right of the base, on b's bottom half -> depth 1, after b.
      await hookMove(g2.baseX + g2.step, g2.lis[1].y + g2.lis[1].h * 0.75);
      await page.waitForTimeout(70);
      const stDepth = await dragState();
      check("real browser list drag: the indent rail picks depth 1",
        stDepth.resolved && stDepth.depth === 1 && stDepth.side === "after",
        JSON.stringify(stDepth));
      await hookUp();
      await page.waitForTimeout(120);
      check("real browser list drag: a depth-1 drop nests the item under its target",
        await page.evaluate(() => {
          // b's textContent now includes the nested c; match on its own text.
          const b = Array.from(document.querySelectorAll("#viewer-content li"))
            .find((li) => {
              const c = li.cloneNode(true);
              c.querySelectorAll("ul,ol").forEach((n) => n.remove());
              return c.textContent.replace(/\u200B/g, "").trim() === "b";
            });
          const child = b && b.querySelector(":scope > ul");
          return !!child && child.children.length === 1 &&
            child.children[0].textContent.trim() === "c";
        }));
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      check("real browser list drag: the nested drop saves nested Markdown",
        readNote("notes/listindent.md") === "-   a\n-   b\n    -   c\n",
        JSON.stringify(readNote("notes/listindent.md")));

      // Session 3: the checkbox-gutter hit region. A task checkbox hangs
      // LEFT of its item's box; pointing at it must still resolve the item,
      // both for the grip reveal and for the drop target.
      await openNote("notes/listtaskdrag.md", "- [ ] a\n- [x] b\n- [ ] c\n");
      const cb = await page.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll("#viewer-content li"))
          .map((li) => {
            const inp = li.querySelector('input[type="checkbox"]');
            const cr = inp.getBoundingClientRect();
            return { liLeft: li.getBoundingClientRect().x,
              cx: cr.x + cr.width / 2, cy: cr.y + cr.height / 2 };
          });
        return boxes;
      });
      check("real browser list drag: a task checkbox hangs outside the item box",
        cb[1].cx < cb[1].liLeft, "cb=" + cb[1].cx + " li=" + cb[1].liLeft);
      await page.mouse.move(cb[1].cx, cb[1].cy);
      await page.waitForTimeout(80);
      check("real browser list drag: the checkbox gutter still resolves the item",
        await page.evaluate(() => {
          const it = window.NB.listEdit.activeItem;
          const g = document.querySelector(".nb-list-overlay .nb-list-grip");
          return !!g && !!it && it.textContent.replace(/\u200B/g, "").includes("b");
        }));
      // The grip column must not depend on the item type: a task item's
      // grip shares the same list rail as a dot/number item's.
      const taskRail = await page.evaluate(() => {
        const ul = document.querySelector("#viewer-content ul");
        const g = document.querySelector(".nb-list-overlay .nb-list-grip");
        if (!g) return null;
        return { gripRight: g.getBoundingClientRect().right,
                 ulLeft: ul.getBoundingClientRect().left };
      });
      check("real browser list drag: a task item's grip shares the list rail",
        !!taskRail && Math.abs(taskRail.gripRight - taskRail.ulLeft) < 1,
        JSON.stringify(taskRail));
      // The same union decides the drop target: dragging item a over c's
      // checkbox gutter resolves c.
      await hookStart(0);   // item a
      await hookMove(cb[2].cx, cb[2].cy);
      await page.waitForTimeout(70);
      const stCb = await dragState();
      check("real browser list drag: the checkbox gutter resolves the drop target",
        stCb.resolved && stCb.target === "c", JSON.stringify(stCb));
      await hookCancel();
      await page.waitForTimeout(40);

      // Session 4: a parent drag carries its whole nested subtree.
      await openNote("notes/listsubtree.md", "- a\n    - a1\n    - a2\n- b\n");
      const g4 = await geom();
      // The grip must sit on the parent's OWN line, not the middle of its
      // nested subtree (the reported "icon off the item's line").
      await page.mouse.move(g4.lis[0].cx, g4.lis[0].y + g4.lis[0].h * 0.15);
      await page.waitForTimeout(80);
      const gripParent = await page.evaluate(() => {
        const g = document.querySelector(".nb-list-overlay .nb-list-grip");
        const li = window.NB.listEdit.activeItem;
        if (!g || !li) return null;
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        let n, lineMid = null;
        while ((n = walker.nextNode())) {
          if (!n.nodeValue.replace(/\u200B/g, "").trim()) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          const c = r.getClientRects()[0];
          lineMid = c.top + c.height / 2;
          break;
        }
        const gb = g.getBoundingClientRect();
        const box = li.getBoundingClientRect();
        return { gripMid: gb.top + gb.height / 2, lineMid: lineMid,
                 boxMid: box.top + box.height / 2 };
      });
      check("real browser list drag: the grip aligns with the item's own line",
        !!gripParent && gripParent.lineMid != null &&
        Math.abs(gripParent.gripMid - gripParent.lineMid) < 2 &&
        gripParent.boxMid - gripParent.lineMid > 8,
        JSON.stringify(gripParent));
      await hookStart(0);   // parent item a
      await hookMove(g4.baseX, g4.lis[1].y + g4.lis[1].h * 0.75);
      await page.waitForTimeout(70);
      await hookUp();
      await page.waitForTimeout(120);
      check("real browser list drag: a parent drag carries its nested subtree",
        await page.evaluate(() => {
          const ul = document.querySelector("#viewer-content > ul");
          const lis = Array.from(ul.children).filter((n) => n.tagName === "LI");
          const a = lis.find((li) => li.textContent.trim().startsWith("a"));
          const nested = a && a.querySelector(":scope > ul");
          return lis[0].textContent.trim() === "b" && !!nested &&
            Array.from(nested.children).map((x) => x.textContent.trim())
              .join(",") === "a1,a2";
        }));
      await saveAndExit(page);
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      check("real browser list drag: the subtree drag saves intact Markdown",
        readNote("notes/listsubtree.md") ===
          "-   b\n-   a\n    -   a1\n    -   a2\n",
        JSON.stringify(readNote("notes/listsubtree.md")));

      // Session 5: the touch contract. With no hover the grip is shown for
      // the item containing the caret and carries touch-action: none (a
      // touch drag must not become a scroll). The pointerdown-on-grip path
      // is blocked by the defect marker above; Esc cancels a drag with no
      // mutation or write.
      await openNote("notes/listtouch.md", "- a\n- b\n");
      await page.mouse.move(2, 2);   // ensure no hover
      await page.waitForTimeout(80);
      await page.evaluate(() => {
        const li = document.querySelectorAll("#viewer-content li")[1];
        const r = document.createRange();
        r.selectNodeContents(li);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        li.dispatchEvent(new Event("focusin", { bubbles: true }));
      });
      await page.waitForTimeout(60);
      const touch = await page.evaluate(() => {
        const g = document.querySelector(".nb-list-overlay .nb-list-grip");
        const it = window.NB.listEdit.activeItem;
        return { hasGrip: !!g, item: it ? it.textContent.trim() : null,
          touchAction: g ? getComputedStyle(g).touchAction : null };
      });
      check("real browser list drag: no hover shows the grip for the caret item",
        touch.hasGrip && touch.item === "b", JSON.stringify(touch));
      check("real browser list drag: the grip carries touch-action: none",
        touch.touchAction === "none", String(touch.touchAction));
      // Esc mid-drag cancels with no mutation and no write.
      const touchGeo = await geom();
      await hookStart(1);   // item b
      await hookMove(touchGeo.baseX, touchGeo.lis[0].y + touchGeo.lis[0].h * 0.25);
      await page.waitForTimeout(70);
      await hookCancel();
      await page.waitForTimeout(60);
      check("real browser list drag: Esc cancels the drag with no mutation",
        (await page.evaluate(() => !window.NB.listEdit.drag &&
          !document.body.classList.contains("nb-list-drag"))) &&
        JSON.stringify(await ownOrder()) === JSON.stringify(["a", "b"]) &&
        readNote("notes/listtouch.md") === "- a\n- b\n",
        JSON.stringify(readNote("notes/listtouch.md")));
      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });

      check("real browser list drag: no uncaught page errors",
        pageErrors.length === 0, pageErrors.join(" | "));
    }

    // --- native menu fall-through on plain prose (right-click) --------
    // A real right-click on prose must leave the event uncancelled so the
    // browser's own menu (with spellcheck) shows; a right-click on
    // structural content keeps the custom menu. A bubble-phase document
    // listener records defaultPrevented after the hybrid handler runs.
    writeNote("notes/ctxmenu.md",
      "hello world prose\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/ctxmenu.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await page.evaluate(() => {
      window.__ctx = null;
      document.addEventListener("contextmenu", (e) => {
        window.__ctx = {
          defaultPrevented: e.defaultPrevented,
          x: e.clientX, y: e.clientY,
        };
      });
    });
    {
      const proseBox = await page.evaluate(() => {
        const p = document.querySelector("#viewer-content p");
        const r = p.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(proseBox.x, proseBox.y, { button: "right" });
      await page.waitForTimeout(120);
      const proseCtx = await page.evaluate(() => window.__ctx);
      const menuHidden = await page.evaluate(
        () => document.getElementById("nb-menu").hidden);
      check("real browser: prose right-click is not defaultPrevented",
        proseCtx && proseCtx.defaultPrevented === false, JSON.stringify(proseCtx));
      check("real browser: prose right-click keeps the custom menu hidden",
        menuHidden, "hidden=" + menuHidden);
    }
    {
      const cellBox = await page.evaluate(() => {
        const td = document.querySelector("#viewer-content td");
        const r = td.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(cellBox.x, cellBox.y, { button: "right" });
      await page.waitForTimeout(120);
      const cellCtx = await page.evaluate(() => window.__ctx);
      const menuOpen = await page.evaluate(
        () => !document.getElementById("nb-menu").hidden);
      check("real browser: structural right-click is defaultPrevented",
        cellCtx && cellCtx.defaultPrevented === true, JSON.stringify(cellCtx));
      check("real browser: structural right-click opens the custom menu",
        menuOpen, "open=" + menuOpen);
    }
    await page.click("#close-edit-btn");
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });

    // --- hybrid chord core: preventDefault + selection survives prompt ---
    // AC13 is browser-only: jsdom does not blur on prompt() and cannot prove
    // that Ctrl+K / Ctrl+\ call preventDefault (Ctrl+K would otherwise focus
    // the address bar). This case drives the real prompt path and asserts the
    // link lands on the ORIGINAL selection after the prompt closes.
    writeNote("notes/chords.md", "click here\n\nsecond para\n");
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/chords.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });

    // Record each keydown AFTER hybrid's own handler has run (bubble phase
    // on document), so defaultPrevented reflects the handler's decision.
    await page.evaluate(() => {
      window.__chordKeys = [];
      document.addEventListener("keydown", (e) => {
        window.__chordKeys.push({ code: e.code, defaultPrevented: e.defaultPrevented });
      });
    });
    const lastKey = () => page.evaluate(
      () => window.__chordKeys[window.__chordKeys.length - 1] || null);

    // Select "here" and answer the URL prompt.
    await page.evaluate(() => {
      const tn = document.querySelector("#viewer-content p").firstChild;
      const r = document.createRange();
      r.setStart(tn, 6); r.setEnd(tn, 10);
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
    });
    let dialogSeen = null;
    page.once("dialog", async (d) => {
      dialogSeen = { type: d.type(), defaultValue: d.defaultValue() };
      await d.accept("https://example.com");
    });
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(200);
    const kKey = await lastKey();
    const linkState = await page.evaluate(() => {
      const a = document.querySelector("#viewer-content p a");
      return {
        hasLink: !!a,
        href: a && a.getAttribute("href"),
        label: a && a.textContent,
        selection: window.getSelection().toString(),
      };
    });
    check("real browser chords: Ctrl+K is defaultPrevented",
      kKey && kKey.defaultPrevented === true, JSON.stringify(kKey));
    check("real browser chords: the URL prompt is prefilled with https://",
      !!dialogSeen && dialogSeen.defaultValue === "https://",
      JSON.stringify(dialogSeen));
    check("real browser chords: the link lands on the original selection",
      linkState.hasLink && linkState.href === "https://example.com" &&
      linkState.label === "here" && linkState.selection === "here",
      JSON.stringify(linkState));

    // Ctrl+\ must preventDefault too.
    await page.evaluate(() => {
      const p = document.querySelector("#viewer-content p");
      const r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press("Control+Backslash");
    await page.waitForTimeout(120);
    const clearKey = await lastKey();
    check("real browser chords: Ctrl+\\ is defaultPrevented",
      clearKey && clearKey.code === "Backslash" && clearKey.defaultPrevented === true,
      JSON.stringify(clearKey));

    // A new chord matched on e.code: Ctrl+Shift+7 (Shift makes e.key "&")
    // must make an ordered list and type no "&".
    writeNote("notes/chordlist.md", "alpha\n");
    await page.click("#close-edit-btn");
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    await page.goto(BASE + "/?file=" + encodeURIComponent("notes/chordlist.md"));
    await page.waitForSelector("#viewer-content p", { timeout: 15000 });
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await page.evaluate(() => {
      const p = document.querySelector("#viewer-content p");
      p.focus();
      const r = document.createRange();
      r.setStart(p.firstChild, 5);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press("Control+Shift+Digit7");
    await page.waitForTimeout(150);
    const listState = await page.evaluate(() => ({
      ordered: !!document.querySelector("#viewer-content ol li"),
      text: document.querySelector("#viewer-content").textContent,
    }));
    check("real browser chords: Ctrl+Shift+7 makes an ordered list, types no '&'",
      listState.ordered && listState.text.indexOf("&") === -1,
      JSON.stringify(listState));
    check("real browser chords: no uncaught page errors",
      pageErrors.length === 0, pageErrors.join(" | "));
    await saveAndExit(page);
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    check("real browser chords: the list chord saves valid Markdown",
      readNote("notes/chordlist.md").indexOf("1.  alpha") === 0,
      JSON.stringify(readNote("notes/chordlist.md")));

    await page.screenshot({ path: path.join(tmp, "hybrid.png") });
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
