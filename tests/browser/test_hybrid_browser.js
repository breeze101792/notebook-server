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
const BROWSER_PATH = process.env[
  BROWSER === "firefox" ? "FIREFOX_PATH" : "CHROMIUM_PATH"
] || undefined;
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

    // --- no-op: clean Save+Exit issues no write --------------------
    await page.click("#hybrid-toggle");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    const mtimeBefore = fs.statSync(p).mtimeMs;
    await page.click("#save-exit-btn");
    await page.waitForFunction(
      () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 400));
    check("real browser: clean Save+Exit leaves the file untouched",
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
    await page.click("#save-exit-btn");
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
    await page.click("#save-exit-btn");
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
    await page.click("#save-exit-btn");
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
      await page.click("#save-exit-btn");
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
    await page.click("#save-exit-btn");
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
    await page.click("#save-exit-btn");
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
    await page.click("#save-exit-btn");
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
    // docs/hybrid-editing-behavior.md §5.1, I9/Q16 (one Enter, one
    // break), Q1 (structural edits preserve untouched bytes).

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
    await page.click("#save-exit-btn");
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
    await page.click("#save-exit-btn");
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
    await page.click("#save-exit-btn");
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
      // selection logic is identical in both modes.
      await page.click("#close-edit-btn");
      await page.waitForFunction(
        () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
      await page.mouse.move(ruleBox.x, ruleBox.y);
      await page.mouse.down();
      await page.mouse.move(paraBox.x, paraBox.y, { steps: 8 });
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
      // mark must come off in preview mode.
      await page.mouse.click(paraBox.x, paraBox.y);
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
