/* Real-browser audit of the hybrid fence editor (code blocks and the
 * rendered plugin fences that share the same path).
 *
 * jsdom can drive the model but not the native editing engine: selection
 * ownership, paste flavour, Tab focus traversal, and native undo all differ
 * in a real browser. Each UI interaction below is a separate group so a
 * failure names the gesture that broke.
 *
 * Regression cases pinned here (found in the audit):
 *   - a bare fence must stay bare after being touched (highlight.js used
 *     to add an auto-detected `language-*` class that turndown wrote back);
 *   - Ctrl+A in the language chip must select the chip, not the note (a
 *     contenteditable chip selected the whole document and retyping it
 *     replaced the note);
 *   - a rich-HTML paste must land as plain text inside the fence;
 *   - Tab must indent, not focus the Copy button;
 *   - Ctrl+Z inside the fence must be the browser's undo, not hybrid's
 *     whole-note snapshot;
 *   - clearing the chip must remove the fence language;
 *   - an invalid language must be refused without changing the note.
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium node tests/browser/test_block_edit_browser.js
 * Env:  PORT (default 5091), CHROMIUM_PATH override the binary.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const PORT = Number(process.env.PORT || 5091);
const BASE = "http://127.0.0.1:" + PORT;
const { findChromium } = require("./chromium");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || findChromium();
const NOTE = "code.md";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-block-edit-"));
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

const PLAIN = "# Code\n\n```python\nprint(\"hello\")\n```\n";
const BARE = "# Bare\n\n```\nplain text line\n```\n";
const JS = "# JS\n\n```js\nconst x = 1;\n```\n";
const TILDE = "# Tilde\n\n~~~js\nconst y = 2;\n~~~\n";
const MERMAID = "# Diagram\n\n```mermaid\ngraph TD; A-->B;\n```\n";

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

  try {
    await waitForServer();
    const ctx = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    const boot = async (src) => {
      writeNote(src);
      await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
      await page.waitForSelector("#viewer-content h1, #viewer-content pre", { timeout: 15000 });
      await page.click("#hybrid-toggle");
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
      await sleep(100);
    };
    const block = () => page.locator("#viewer-content pre").first();
    const chip = () => page.locator("#viewer-content .hybrid-lang-pill").first();
    const openBlock = async () => {
      await block().click({ position: { x: 60, y: 60 } });
      await page.waitForFunction(
        () => !!document.querySelector("#viewer-content pre.hybrid-plugin-editing"),
        null, { timeout: 5000 });
      await sleep(80);
    };
    const state = () => page.evaluate(() => {
      const pre = document.querySelector("#viewer-content pre");
      const code = pre && pre.querySelector("code");
      const pill = document.querySelector("#viewer-content .hybrid-lang-pill");
      return {
        editing: pre ? pre.getAttribute("contenteditable") === "true" : false,
        lang: pre ? pre.getAttribute("data-fence-lang") : null,
        codeClass: code ? code.className : null,
        text: code ? code.textContent : null,
        pill: pill ? pill.value : null,
        hasPill: !!pill,
        html: code ? code.innerHTML : null,
      };
    });
    const commitAndSave = async () => {
      await page.click("#viewer-content h1");
      await sleep(250);
      await page.keyboard.press("Control+s");
      await sleep(150);
      return waitForFile(() => true, 500);
    };

    // --- 1. click-to-edit enters the raw fence --------------------------
    console.log("\n== fence editor: open ==");
    await boot(PLAIN);
    await openBlock();
    let s = await state();
    check("open: block is editable", s.editing, JSON.stringify(s));
    check("open: chip shows the authored language", s.pill === "python", "pill=" + s.pill);
    check("open: source is unchanged", s.text === "print(\"hello\")\n",
      JSON.stringify(s.text));

    // --- 2. select-all in the chip must not touch the note --------------
    console.log("\n== fence editor: language chip ==");
    await chip().click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("javascript");
    const noteTextBeforeEnter = await page.evaluate(
      () => document.getElementById("viewer-content").innerText);
    check("chip: Ctrl+A selects only the chip",
      /print\("hello"\)/.test(noteTextBeforeEnter),
      JSON.stringify(noteTextBeforeEnter.slice(0, 80)));
    await page.keyboard.press("Enter");
    await sleep(150);
    s = await state();
    check("chip: Enter applies the typed language", s.lang === "javascript",
      "lang=" + s.lang);
    await commitAndSave();
    check("chip: save writes the new info string and keeps the body",
      readNote() === "# Code\n\n```javascript\nprint(\"hello\")\n```\n",
      JSON.stringify(readNote()));

    // --- 3. clearing the chip removes the info string -------------------
    await boot(JS);
    await openBlock();
    await chip().click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await sleep(120);
    s = await state();
    check("clear: language is removed", s.lang === "" && s.codeClass === "",
      JSON.stringify({ lang: s.lang, cls: s.codeClass }));
    await commitAndSave();
    check("clear: save writes a bare fence",
      readNote() === "# JS\n\n```\nconst x = 1;\n```\n", JSON.stringify(readNote()));

    // --- 4. invalid language is refused --------------------------------
    await boot(JS);
    await openBlock();
    await chip().click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("my lang");
    await page.keyboard.press("Enter");
    await sleep(150);
    s = await state();
    check("invalid: chip keeps the previous language", s.pill === "js", "pill=" + s.pill);
    check("invalid: block stays in edit mode", s.editing, JSON.stringify(s));
    await commitAndSave();
    check("invalid: note is unchanged", readNote() === JS, JSON.stringify(readNote()));
    check("invalid: no page error", pageErrors.length === 0, pageErrors.join(" | "));

    // --- 5. Esc on the chip restores the previous value ----------------
    await boot(JS);
    await openBlock();
    await chip().click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("python");
    await page.keyboard.press("Escape");
    await sleep(120);
    s = await state();
    // Esc cancels the language edit; the click-out/blur model may then
    // commit the block, so the chip is allowed to be gone -- what must
    // survive is the original language.
    check("chip Esc: previous language restored", s.lang === "js",
      JSON.stringify({ lang: s.lang, pill: s.pill }));

    // --- 6. a bare fence stays bare after being touched ----------------
    console.log("\n== fence editor: authored language ==");
    await boot(BARE);
    await openBlock();
    s = await state();
    check("bare: chip is empty", s.pill === "", "pill=" + s.pill);
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("!");
    await commitAndSave();
    check("bare: touching it does not invent a language",
      readNote() === "# Bare\n\n```\nplain text line!\n```\n", JSON.stringify(readNote()));

    // --- 7. an authored alias is not replaced by the full name ---------
    await boot(JS);
    await openBlock();
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("X");
    await commitAndSave();
    check("alias: js stays js (not javascript)",
      readNote() === "# JS\n\n```js\nconst x = 1;X\n```\n", JSON.stringify(readNote()));

    // --- 8. rich paste stays plain text -------------------------------
    console.log("\n== fence editor: paste ==");
    await boot(PLAIN);
    await openBlock();
    await page.evaluate(async () => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob(["<b>bold</b>"], { type: "text/html" }),
        "text/plain": new Blob(["bold"], { type: "text/plain" }),
      })]);
    });
    await page.keyboard.press("Control+V");
    await sleep(200);
    s = await state();
    check("paste: no HTML element reaches the fence",
      !/<(b|i|span[^>]*style)/i.test(s.html || ""), JSON.stringify(s.html));
    check("paste: the plain text lands", /bold/.test(s.text || ""), JSON.stringify(s.text));
    await commitAndSave();
    check("paste: save keeps only text",
      readNote() === "# Code\n\n```python\nprint(\"hello\")bold\n```\n",
      JSON.stringify(readNote()));

    // --- 9. Tab indents and never focuses the Copy button --------------
    console.log("\n== fence editor: keyboard ==");
    await boot(JS);
    await openBlock();
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press("Tab");
    await sleep(100);
    s = await state();
    const focusedClass = await page.evaluate(
      () => document.activeElement && document.activeElement.className);
    check("Tab: inserts two spaces", / {2}\n?$/.test(s.text || ""), JSON.stringify(s.text));
    check("Tab: focus does not jump to the Copy button",
      !/code-copy-btn/.test(focusedClass || ""), "active=" + focusedClass);
    await page.keyboard.press("Shift+Tab");
    await sleep(80);
    s = await state();
    check("Shift+Tab: keeps the editor focused",
      s.editing &&
        !/code-copy-btn/.test(await page.evaluate(() => document.activeElement.className)),
      JSON.stringify(s));

    // --- 10. native undo inside the fence ------------------------------
    await boot(JS);
    await openBlock();
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("XYZ");
    await sleep(100);
    await page.keyboard.press("Control+z");
    await sleep(200);
    s = await state();
    check("undo: the typed text is reverted", s.text === "const x = 1;\n",
      JSON.stringify(s.text));
    check("undo: the block stays in edit mode", s.editing, JSON.stringify(s));
    await commitAndSave();
    check("undo: save writes the original", readNote() === JS, JSON.stringify(readNote()));

    // --- 11. save mid-edit keeps the editor alive ---------------------
    await boot(JS);
    await openBlock();
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("SAVED");
    await page.keyboard.press("Control+s");
    await sleep(300);
    check("save mid-edit: the source is on disk",
      (await waitForFile((md) => /const x = 1;SAVED/.test(md))) === true,
      JSON.stringify(readNote()));
    s = await state();
    check("save mid-edit: the block is still editable", s.editing, JSON.stringify(s));
    await commitAndSave();
    check("save mid-edit: a second save commits cleanly",
      /const x = 1;SAVED/.test(readNote()), JSON.stringify(readNote()));

    // --- 12. Esc on the source commits and exits ----------------------
    await boot(JS);
    await openBlock();
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("Y");
    await page.keyboard.press("Escape");
    await sleep(200);
    s = await state();
    check("Esc: leaves edit mode", !s.editing, JSON.stringify(s));
    check("Esc: the typed source is kept", s.text === "const x = 1;Y\n",
      JSON.stringify(s.text));

    // --- 13. re-entering the same fence works -------------------------
    await openBlock();
    await page.keyboard.type("Z");
    await commitAndSave();
    check("re-enter: a second edit commits and saves",
      readNote() === "# JS\n\n```js\nconst x = 1;YZ\n```\n", JSON.stringify(readNote()));

    // --- 14. a tilde fence canonicalizes only when touched -------------
    console.log("\n== fence editor: tilde fence ==");
    await boot(TILDE);
    await page.click("#viewer-content h1");
    await page.keyboard.press("Control+s");
    await sleep(250);
    check("~~~ untouched: bytes are preserved", readNote() === TILDE,
      JSON.stringify(readNote()));
    await openBlock();
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("W");
    await commitAndSave();
    check("~~~ touched: canonical backticks, source kept",
      readNote() === "# Tilde\n\n```js\nconst y = 2;W\n```\n",
      JSON.stringify(readNote()));

    // --- 15. a plugin fence re-renders through the same path ----------
    console.log("\n== fence editor: plugin fence ==");
    await boot(MERMAID);
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await page.click("#viewer-content .mermaid-container");
    await page.waitForSelector("#viewer-content pre.hybrid-plugin-editing", { timeout: 5000 });
    s = await state();
    check("plugin: click swaps the diagram for its source",
      /graph TD/.test(s.text || ""), JSON.stringify(s.text));
    check("plugin: chip shows mermaid", s.pill === "mermaid", "pill=" + s.pill);
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("\n  B-->C;");
    await page.click("#viewer-content h1");
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    check("plugin: blur restores the rendered diagram",
      (await page.locator("#viewer-content .mermaid-container").count()) >= 1);
    await page.keyboard.press("Control+s");
    await sleep(300);
    check("plugin: save writes the edited source",
      (await waitForFile((md) => /B-->C;/.test(md))) === true, JSON.stringify(readNote()));

    // --- 16. copy button works while the fence is being edited --------
    await boot(PLAIN);
    await openBlock();
    await page.click("#viewer-content .code-copy-btn");
    await sleep(200);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check("copy: the copy button copies the fence source",
      /print\("hello"\)/.test(copied), JSON.stringify(copied));
    s = await state();
    check("copy: the block stays in edit mode", s.editing, JSON.stringify(s));

    // --- 17. an emptied fence is removed by Backspace/Delete ----------
    console.log("\n== fence editor: emptied block ==");
    const EMPTY_NOTE = "# Empty\n\n```js\nconst x = 1;\n```\n\nafter\n";
    const selectCode = async () => page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    const putCaret = (offset) => page.evaluate((off) => {
      const code = document.querySelector("#viewer-content pre code");
      let node = code.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        node = document.createTextNode("");
        code.insertBefore(node, code.firstChild);
      }
      const r = document.createRange();
      r.setStart(node, Math.min(off, node.nodeValue.length));
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }, offset);
    const blockCount = () => page.evaluate(
      () => document.querySelectorAll("#viewer-content pre").length);
    const caretInfo = () => page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      const root = document.getElementById("viewer-content");
      let node = r.startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      while (node && node.parentElement !== root) node = node.parentElement;
      if (!node) return null;
      const before = document.createRange();
      before.selectNodeContents(node);
      before.setEnd(r.startContainer, r.startOffset);
      const after = document.createRange();
      after.selectNodeContents(node);
      after.setStart(r.startContainer, r.startOffset);
      return { block: node.tagName, atStart: before.toString() === "",
        atEnd: after.toString() === "" };
    });

    await boot(EMPTY_NOTE);
    await openBlock();
    await selectCode();
    await page.keyboard.press("Backspace");   // deletes the source, keeps the block
    check("empty: the block survives the text deletion", (await blockCount()) === 1);

    await page.keyboard.press("Backspace");   // removes the empty block
    await sleep(200);
    check("empty: the next Backspace removes the block", (await blockCount()) === 0);
    let ci = await caretInfo();
    check("empty: the caret lands at the previous block's end",
      ci && ci.block === "H1" && ci.atEnd, "caret=" + JSON.stringify(ci));
    await page.keyboard.press("Control+s");
    check("empty: save writes the note without the fence",
      await waitForFile((md) => md === "# Empty\n\nafter\n"), JSON.stringify(readNote()));

    await page.keyboard.press("Control+z");
    await sleep(300);
    check("empty: undo restores the removed block", (await blockCount()) === 1);
    check("empty: undo restores the fence source",
      /const x = 1;/.test(await page.evaluate(
        () => document.querySelector("#viewer-content pre code").textContent)));

    await boot(EMPTY_NOTE);
    await openBlock();
    await selectCode();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");
    await sleep(200);
    check("empty: Delete removes the block too", (await blockCount()) === 0);
    ci = await caretInfo();
    check("empty: Delete leaves the caret at the next block's start",
      ci && ci.block === "P" && ci.atStart, "caret=" + JSON.stringify(ci));
    await page.keyboard.press("Control+s");
    check("empty: the Delete path saves the same note",
      await waitForFile((md) => md === "# Empty\n\nafter\n"), JSON.stringify(readNote()));

    // Undo can land on a snapshot taken while the emptied fence was
    // still in edit mode; that restored editor must keep its commit path.
    await boot(EMPTY_NOTE);
    await openBlock();
    await selectCode();
    await page.keyboard.press("Backspace");
    await sleep(600);                          // snapshot the emptied editor
    await page.keyboard.press("Backspace");    // remove the block
    await sleep(200);
    await page.keyboard.press("Control+z");
    await sleep(300);
    check("empty: undo can restore the emptied fence",
      (await blockCount()) === 1);
    await page.keyboard.press("Escape");
    await sleep(200);
    check("empty: Esc commits a restored editing fence and keeps its language",
      (await page.evaluate(() => {
        const pre = document.querySelector("#viewer-content pre");
        return !!pre && pre.getAttribute("contenteditable") !== "true" &&
          pre.getAttribute("data-fence-lang") === "js";
      })) === true);

    // A caret in the middle of a whitespace-only fence is a character
    // delete, not a block removal.
    await boot("# W\n\n```js\n   \n```\n\nafter\n");
    await openBlock();
    await putCaret(2);
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("empty: a mid-fence Backspace keeps a whitespace-only block",
      (await blockCount()) === 1);
    check("empty: the mid-fence Backspace deletes one character",
      (await page.evaluate(
        () => document.querySelector("#viewer-content pre code").textContent)) === "  \n");
    await putCaret(0);
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("empty: the edge Backspace then removes the block",
      (await blockCount()) === 0);

    // Text parked between </code> and the Copy button is still source.
    await boot("# S\n\n```js\n\n```\n\nafter\n");
    await openBlock();
    await page.evaluate(() => {
      const pre = document.querySelector("#viewer-content pre");
      const code = pre.querySelector("code");
      pre.insertBefore(document.createTextNode("hello"), code.nextSibling);
      const r = document.createRange();
      r.setStart(code.firstChild || code, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("empty: stray fence text is not removed with the block",
      (await blockCount()) === 1);
    check("empty: stray fence text is absorbed into the code",
      /hello/.test(await page.evaluate(
        () => document.querySelector("#viewer-content pre code").textContent)));

    // A fence nested in a list cannot be lifted out; the key is claimed
    // so the native merge cannot destroy its <code> element.
    await boot("# L\n\n- item\n\n  ```js\n  x\n  ```\n\nafter\n");
    await openBlock();
    await selectCode();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("empty: a nested fence is not removed", (await blockCount()) === 1);
    check("empty: a nested fence keeps its <code> element",
      (await page.evaluate(
        () => !!document.querySelector("#viewer-content pre code"))) === true);

    // No neighbour at all: a fresh caret line takes the block's place.
    await boot("```js\nx\n```\n");
    await openBlock();
    await selectCode();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("empty: the only block is removed", (await blockCount()) === 0);
    check("empty: a fallback caret line replaces it",
      (await page.evaluate(() => {
        const p = document.querySelector("#viewer-content p[data-hybrid-caret]");
        return !!p && !p.textContent.trim();
      })) === true);
    ci = await caretInfo();
    check("empty: the fallback line takes the caret",
      ci && ci.block === "P" && ci.atStart, "caret=" + JSON.stringify(ci));

    check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
    await page.screenshot({ path: path.join(tmp, "block-edit.png") });
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
