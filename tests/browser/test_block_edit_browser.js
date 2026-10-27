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
 *   - a multi-line paste or Enter must keep every line in the fence body,
 *     including plugin fences with no highlight markup;
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
      // A just-issued save may still be clearing dirty state. The old
      // page flushes a dirty hybrid buffer on visibilitychange during
      // navigation, which would rewrite the file we are about to load.
      try {
        await page.waitForFunction(
          () => !window.NB || !window.NB.hybrid || !window.NB.hybrid.isDirty(),
          null, { timeout: 2000 });
      } catch (_) {}
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
        codes: pre ? pre.querySelectorAll("code").length : 0,
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
    check("chip: Enter keeps the block editable", s.editing, JSON.stringify(s));
    check("chip: Enter keeps the language chip", s.hasPill, JSON.stringify(s));
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
    // Esc cancels the language edit and hands the caret back to the fence,
    // so the block stays editable with the original language.
    check("chip Esc: previous language restored", s.lang === "js",
      JSON.stringify({ lang: s.lang, pill: s.pill }));
    check("chip Esc: block stays editable", s.editing, JSON.stringify(s));

    // --- 5b. the chip returns a live caret to the fence ----------------
    await boot(JS);
    await openBlock();
    await chip().click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("javascript");
    await page.keyboard.press("Enter");
    await sleep(150);
    s = await state();
    check("chip return: the fence is re-highlighted",
      /language-javascript/.test(s.codeClass || "") && /<span/.test(s.html || ""),
      JSON.stringify({ cls: s.codeClass, html: (s.html || "").slice(0, 60) }));
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type("Q");
    await sleep(120);
    s = await state();
    check("chip return: typing after Enter lands in the fence",
      /const x = 1;Q/.test(s.text || ""), JSON.stringify(s.text));
    await page.keyboard.press("Control+s");
    check("chip return: save writes the typed text",
      (await waitForFile((md) => /const x = 1;Q/.test(md))) === true,
      JSON.stringify(readNote()));

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

    // --- 8b. a multi-line paste keeps every line in the fence ----------
    console.log("\n== fence editor: multi-line paste ==");
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
      await navigator.clipboard.writeText("line one\nline two\nline three");
    });
    await page.keyboard.press("Control+V");
    await sleep(200);
    const multi = await page.evaluate(() => {
      const pre = document.querySelector("#viewer-content pre");
      const code = pre && pre.querySelector("code");
      return {
        codes: pre ? pre.querySelectorAll("code").length : 0,
        text: code ? code.textContent : null,
      };
    });
    check("multi-line paste: every line lands in one fence body",
      multi.codes === 1 &&
        multi.text === "print(\"hello\")line one\nline two\nline three\n",
      JSON.stringify(multi));
    await page.keyboard.press("Control+Z");
    await sleep(200);
    const multiUndo = await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      return code ? code.textContent : null;
    });
    check("multi-line paste: Ctrl+Z undoes the whole paste",
      multiUndo === "print(\"hello\")\n", JSON.stringify(multiUndo));
    await page.keyboard.press("Control+Shift+Z");
    await sleep(200);
    await commitAndSave();
    check("multi-line paste: save keeps every line",
      readNote() ===
        "# Code\n\n```python\nprint(\"hello\")line one\nline two\nline three\n```\n",
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

    // --- 9b. Enter adds a newline inside the fence ---------------------
    console.log("\n== fence editor: Enter ==");
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
    await page.keyboard.press("Enter");
    await page.keyboard.type("line two");
    await sleep(150);
    s = await state();
    check("Enter: adds a line inside the fence, not a sibling <code>",
      s.codes === 1 && s.text === "const x = 1;\nline two", JSON.stringify(s));
    await commitAndSave();
    check("Enter: save keeps both lines",
      readNote() === "# JS\n\n```js\nconst x = 1;\nline two\n```\n",
      JSON.stringify(readNote()));

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

    // --- 15b. plugin fence keeps multi-line paste and Enter -----------
    console.log("\n== fence editor: plugin multi-line ==");
    await boot(MERMAID);
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await page.click("#viewer-content .mermaid-container");
    await page.waitForSelector("#viewer-content pre.hybrid-plugin-editing", { timeout: 5000 });
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.evaluate(async () =>
      navigator.clipboard.writeText("graph TD;\nA-->B;\nB-->C;"));
    await page.keyboard.press("Control+V");
    await sleep(200);
    s = await state();
    check("plugin multi-line paste: source stays in one code body",
      s.codes === 1 && s.text === "graph TD;\nA-->B;\nB-->C;\n",
      JSON.stringify(s));
    await page.click("#viewer-content h1");
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await page.keyboard.press("Control+s");
    await sleep(300);
    check("plugin multi-line paste: save keeps every line",
      readNote() === "# Diagram\n\n```mermaid\ngraph TD;\nA-->B;\nB-->C;\n```\n",
      JSON.stringify(readNote()));

    await boot(MERMAID);
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await page.click("#viewer-content .mermaid-container");
    await page.waitForSelector("#viewer-content pre.hybrid-plugin-editing", { timeout: 5000 });
    await page.evaluate(() => {
      const code = document.querySelector("#viewer-content pre code");
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("B-->C;");
    await sleep(150);
    s = await state();
    check("plugin Enter: adds a source line inside the same code body",
      s.codes === 1 && s.text === "graph TD; A-->B;\nB-->C;",
      JSON.stringify(s));
    await page.click("#viewer-content h1");
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await page.keyboard.press("Control+s");
    await sleep(300);
    check("plugin Enter: save keeps both lines",
      readNote() === "# Diagram\n\n```mermaid\ngraph TD; A-->B;\nB-->C;\n```\n",
      JSON.stringify(readNote()));

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
    // The caret was moved beside the restored fence, so click it to
    // resume editing before Esc commits it.
    await page.click("#viewer-content pre.hybrid-plugin-editing");
    await sleep(100);
    await page.keyboard.press("Escape");
    await sleep(200);
    check("empty: Esc commits a re-opened editing fence and keeps its language",
      (await page.evaluate(() => {
        const pre = document.querySelector("#viewer-content pre");
        return !!pre && pre.getAttribute("contenteditable") !== "true" &&
          pre.getAttribute("data-fence-lang") === "js";
      })) === true);

    // Undo must not stall when the restored snapshot contains an editing
    // fence. The caret is placed beside it, so the next Ctrl+Z stays
    // hybrid's own undo instead of the rebuilt fence's empty native stack.
    await boot(EMPTY_NOTE);
    await openBlock();
    await selectCode();
    await page.keyboard.press("Backspace");
    await sleep(650);                       // snapshot the emptied editor
    await page.keyboard.press("Backspace"); // remove the block
    await sleep(200);
    await page.keyboard.press("Control+z");
    await sleep(300);
    const firstUndo = await page.evaluate(() => {
      const pre = document.querySelector("#viewer-content pre");
      const sel = window.getSelection();
      let node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      return {
        blocks: document.querySelectorAll("#viewer-content pre").length,
        editing: !!pre && pre.getAttribute("contenteditable") === "true",
        caretInFence: !!(node && node.closest &&
          node.closest("pre.hybrid-plugin-editing")),
      };
    });
    check("empty: undo restores the emptied editing fence",
      firstUndo.blocks === 1 && firstUndo.editing, JSON.stringify(firstUndo));
    check("empty: the restored fence does not capture the caret",
      !firstUndo.caretInFence, JSON.stringify(firstUndo));
    await page.keyboard.press("Control+z");
    await sleep(300);
    const secondUndo = await page.evaluate(() => ({
      blocks: document.querySelectorAll("#viewer-content pre").length,
      editing: !!document.querySelector(
        "#viewer-content pre.hybrid-plugin-editing"),
    }));
    check("empty: the second undo goes further back, not a no-op",
      secondUndo.blocks !== firstUndo.blocks ||
        secondUndo.editing !== firstUndo.editing,
      JSON.stringify({ first: firstUndo, second: secondUndo }));

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

    // A fence nested in a list item is removed from the live DOM too; its
    // container stays (an empty item is a valid editable state).
    await boot("# L\n\n- item\n\n  ```js\n  x\n  ```\n\nafter\n");
    await openBlock();
    await selectCode();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("empty: a nested fence is removed from the live DOM",
      (await blockCount()) === 0);
    check("empty: the nested fence's list item survives",
      (await page.evaluate(
        () => !!document.querySelector("#viewer-content li"))) === true);
    const nestedCaret = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      let node = r.startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      const li = node && node.closest && node.closest("li");
      if (!li) return null;
      const before = document.createRange();
      before.selectNodeContents(li);
      before.setEnd(r.startContainer, r.startOffset);
      const after = document.createRange();
      after.selectNodeContents(li);
      after.setStart(r.startContainer, r.startOffset);
      return { before: before.toString(), after: after.toString() };
    });
    check("empty: the caret stays at the removed fence's position",
      nestedCaret && nestedCaret.before === "item" && nestedCaret.after === "",
      JSON.stringify(nestedCaret));
    await page.keyboard.type("Z");
    await sleep(100);
    check("empty: typing lands at the fence position, not the item start",
      (await page.evaluate(
        () => document.querySelector("#viewer-content li").textContent)) === "itemZ");
    await page.keyboard.press("Control+s");
    check("empty: saving drops the nested fence and keeps the typed text",
      await waitForFile((md) => !/```/.test(md) && /itemZ/.test(md)),
      JSON.stringify(readNote()));

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

    // Shared gestures for the atomic-block, table, and task-item cases.
    const placeCaretInText = (needle, offset) => page.evaluate(({ needle, offset }) => {
      const walker = document.createTreeWalker(
        document.getElementById("viewer-content"), NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.nodeValue.indexOf(needle);
        if (idx !== -1) {
          const r = document.createRange();
          r.setStart(node, idx + offset);
          r.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          return true;
        }
      }
      return false;
    }, { needle, offset });
    const selectBetweenTexts = (startText, startOff, endText, endOff) =>
      page.evaluate(({ startText, startOff, endText, endOff }) => {
        const find = (needle) => {
          const walker = document.createTreeWalker(
            document.getElementById("viewer-content"), NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const idx = node.nodeValue.indexOf(needle);
            if (idx !== -1) return { node, idx };
          }
          return null;
        };
        const start = find(startText);
        const end = find(endText);
        if (!start || !end) return false;
        const r = document.createRange();
        r.setStart(start.node, start.idx + startOff);
        r.setEnd(end.node, end.idx + endOff);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }, { startText, startOff, endText, endOff });

    // --- 18. an atomic plugin block is one character at a block edge ---
    console.log("\n== hybrid blocks: atomic plugin delete ==");
    const PLUGIN_NOTE = "# P1\n\nBefore block.\n\n```mermaid\n" +
      "graph TD; A-->B;\n```\n\nAfter block.\n";
    const diagramCount = () => page.evaluate(
      () => document.querySelectorAll("#viewer-content .mermaid-container").length);
    const fenceSourceCount = () => page.evaluate(
      () => document.querySelectorAll(
        "#viewer-content [data-mermaid-source]").length);
    const paragraphText = () => page.evaluate(
      () => Array.from(document.querySelectorAll("#viewer-content p"))
        .map((p) => p.textContent).join("|"));

    await boot(PLUGIN_NOTE);
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    check("atomic: the plugin block renders", (await diagramCount()) === 1);
    await placeCaretInText("After block.", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    check("atomic: Backspace removes the plugin container",
      (await diagramCount()) === 0);
    check("atomic: Backspace removes the fence source", (await fenceSourceCount()) === 0);
    check("atomic: Backspace keeps both neighbouring paragraphs",
      (await paragraphText()) === "Before block.|After block.",
      JSON.stringify(await paragraphText()));
    ci = await caretInfo();
    check("atomic: Backspace leaves the caret at the previous block's end",
      ci && ci.block === "P" && ci.atEnd, "caret=" + JSON.stringify(ci));
    await page.keyboard.press("Control+s");
    check("atomic: Backspace saves without the fence",
      await waitForFile((md) => md === "# P1\n\nBefore block.\n\nAfter block.\n"),
      JSON.stringify(readNote()));
    await page.keyboard.press("Control+z");
    await sleep(300);
    // The enter-time snapshot can predate the lazy mermaid render, so
    // undo may restore the fence as a raw <pre>. Either shape is the
    // block returning with its source intact.
    const restoredSource = await page.evaluate(() => {
      const container = document.querySelector("#viewer-content .mermaid-container");
      if (container) return container.getAttribute("data-mermaid-source") || "";
      const pre = document.querySelector("#viewer-content pre");
      return pre ? pre.textContent : "";
    });
    check("atomic: undo restores the removed block and its source",
      /graph TD; A-->B;/.test(restoredSource), JSON.stringify(restoredSource));

    await boot(PLUGIN_NOTE);
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await placeCaretInText("Before block.", "Before block.".length);
    await page.keyboard.press("Delete");
    await sleep(250);
    check("atomic: Delete removes the plugin container",
      (await diagramCount()) === 0);
    check("atomic: Delete removes the fence source", (await fenceSourceCount()) === 0);
    check("atomic: Delete keeps both neighbouring paragraphs",
      (await paragraphText()) === "Before block.|After block.",
      JSON.stringify(await paragraphText()));
    ci = await caretInfo();
    check("atomic: Delete leaves the caret at the next block's start",
      ci && ci.block === "P" && ci.atStart, "caret=" + JSON.stringify(ci));
    await page.keyboard.press("Control+s");
    check("atomic: Delete saves without the fence",
      await waitForFile((md) => md === "# P1\n\nBefore block.\n\nAfter block.\n"),
      JSON.stringify(readNote()));

    // A raw fence that is not being edited is atomic too.
    await boot("# C\n\n```js\nconst x = 1;\n```\n\nAfter\n");
    await placeCaretInText("After", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    check("atomic: a non-editing raw fence is removed as one block",
      (await blockCount()) === 0);
    await page.keyboard.press("Control+s");
    check("atomic: the raw-fence removal drops its source",
      await waitForFile((md) => md === "# C\n\nAfter\n"),
      JSON.stringify(readNote()));

    // A plain block edge is not an atomic edge; the engine's own merge
    // must stay untouched.
    await boot("# P\n\nAlpha\n\nBeta\n");
    await placeCaretInText("Beta", 0);
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("atomic: a plain paragraph edge is not claimed",
      (await page.evaluate(
        () => document.querySelectorAll("#viewer-content p").length)) === 1,
      JSON.stringify(await paragraphText()));
    check("atomic: the native paragraph merge keeps both words",
      (await page.evaluate(
        () => document.querySelector("#viewer-content p").textContent)) === "AlphaBeta");

    // A non-empty in-place fence owns its own delete keys: Backspace at
    // the start of its body must not claim the diagram before it.
    await boot("# F\n\n```mermaid\ngraph TD; A-->B;\n```\n\n" +
      "```js\nconst x = 1;\n```\n\nTail\n");
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await openBlock();
    await page.evaluate(() => {
      const code = document.querySelector(
        "#viewer-content pre.hybrid-plugin-editing code");
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode() || code;
      const r = document.createRange();
      r.setStart(node, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("atomic: Backspace in a non-empty fence keeps the diagram",
      (await diagramCount()) === 1);
    check("atomic: the non-empty fence stays in edit mode",
      (await page.evaluate(
        () => !!document.querySelector("#viewer-content pre.hybrid-plugin-editing"))) === true);
    check("atomic: the fence body is not merged away",
      /const x = 1;/.test(await page.evaluate(
        () => document.querySelector("#viewer-content pre code").textContent)));

    // A leading image is content: Backspace at the text start deletes the
    // image character, never the diagram above it.
    const PIC = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSJibHVlIi8+PC9zdmc+";
    await boot("# I\n\n```mermaid\ngraph TD; A-->B;\n```\n\n" +
      "![pic](" + PIC + ")alpha\n");
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await placeCaretInText("alpha", 0);
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("atomic: a leading image keeps the diagram",
      (await diagramCount()) === 1);
    check("atomic: Backspace deletes the image character",
      (await page.evaluate(
        () => document.querySelectorAll("#viewer-content img").length)) === 0);

    // A caret at an element boundary at the true start of the following
    // block is still the block's start.
    await boot("# E\n\n```mermaid\ngraph TD; A-->B;\n```\n\n**After**\n");
    await page.waitForSelector("#viewer-content .mermaid-container", { timeout: 10000 });
    await page.evaluate(() => {
      const strong = document.querySelector("#viewer-content p strong");
      const r = document.createRange();
      r.setStart(strong, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press("Backspace");
    await sleep(200);
    check("atomic: an element-boundary caret removes the diagram",
      (await diagramCount()) === 0);
    check("atomic: the following block survives",
      (await page.evaluate(
        () => document.querySelector("#viewer-content p").textContent)) === "After");

    // --- 19. a multi-cell table selection keeps the table shape --------
    console.log("\n== hybrid blocks: table selection delete ==");
    const TABLE_NOTE = "# Table\n\n| A | B |\n| --- | --- |\n" +
      "| 1 | 2 |\n| 3 | 4 |\n";
    const tableShape = () => page.evaluate(() => {
      const table = document.querySelector("#viewer-content table");
      if (!table) return null;
      return {
        rows: table.rows.length,
        cols: Array.from(table.rows).map((row) => row.cells.length),
        text: Array.from(table.rows)
          .map((row) => Array.from(row.cells).map((cell) => cell.textContent)),
      };
    });

    await boot(TABLE_NOTE);
    check("table: the fixture renders a 3x2 table",
      (await tableShape()).rows === 3);
    await selectBetweenTexts("A", 0, "4", 1);
    await page.keyboard.press("Delete");
    await sleep(250);
    let shape = await tableShape();
    check("table: the text selection was not empty",
      shape && shape.text.flat().every((t) => t.trim() === ""),
      JSON.stringify(shape));
    check("table: multi-cell Delete keeps every row",
      shape && shape.rows === 3, JSON.stringify(shape));
    check("table: multi-cell Delete keeps every column",
      shape && shape.cols.every((n) => n === 2), JSON.stringify(shape));
    await page.keyboard.press("Control+s");
    check("table: multi-cell Delete saves valid GFM",
      await waitForFile((md) => !/<br/i.test(md) &&
        (md.match(/^\|/gm) || []).length === 4 &&
        /^\|\s*\|\s*\|$/m.test(md)),
      JSON.stringify(readNote()));
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content table", { timeout: 10000 });
    shape = await tableShape();
    check("table: reload keeps the 3x2 shape",
      shape && shape.rows === 3 && shape.cols.every((n) => n === 2),
      JSON.stringify(shape));
    check("table: reload keeps every cell empty",
      shape && shape.text.flat().every(
        (t) => t.replace(/[▾▴]/g, "").trim() === ""),
      JSON.stringify(shape));

    // A fully emptied cell must save as an empty GFM cell, never a soft
    // line break inside the row.
    await boot(TABLE_NOTE);
    await selectBetweenTexts("1", 0, "2", 1);
    await page.keyboard.press("Delete");
    await sleep(250);
    shape = await tableShape();
    check("table: a row selection keeps all three rows",
      shape && shape.rows === 3, JSON.stringify(shape));
    check("table: a row selection empties only the selected row",
      shape && shape.text[1][0].trim() === "" &&
        shape.text[2][0].trim() === "3" && shape.text[2][1].trim() === "4",
      JSON.stringify(shape));
    await page.keyboard.press("Control+s");
    check("table: an emptied cell saves as an empty GFM cell",
      await waitForFile((md) => /^\|\s*\|\s*\|$/m.test(md) &&
        /^\| 3 \| 4 \|$/m.test(md) && !/<br/i.test(md)),
      JSON.stringify(readNote()));

    // A single-cell selection keeps the engine's own intra-cell delete.
    await boot(TABLE_NOTE);
    await selectBetweenTexts("1", 0, "1", 1);
    await page.keyboard.press("Delete");
    await sleep(250);
    shape = await tableShape();
    check("table: single-cell delete still works",
      shape && shape.rows === 3 &&
        shape.text[1][0].trim() === "" && shape.text[2][1].trim() === "4",
      JSON.stringify(shape));
    await page.keyboard.press("Control+s");
    check("table: single-cell delete saves an empty cell",
      await waitForFile((md) => /^\|\s*\|\s*2\s*\|$/m.test(md) && !/<br/i.test(md)),
      JSON.stringify(readNote()));

    // A selection from a cell to the paragraph after the table must not
    // let the engine remove rows.
    await boot("# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\ntail\n");
    await selectBetweenTexts("2", 0, "tail", 4);
    await page.keyboard.press("Delete");
    await sleep(250);
    shape = await tableShape();
    check("table: a cell-to-paragraph selection keeps every row",
      shape && shape.rows === 3 && shape.cols.every((n) => n === 2),
      JSON.stringify(shape));
    await page.keyboard.press("Control+s");
    check("table: a cell-to-paragraph selection saves valid GFM",
      await waitForFile((md) => !/<br/i.test(md) &&
        (md.match(/^\|/gm) || []).length === 4),
      JSON.stringify(readNote()));

    // A partly covered cell keeps the caret at the original deletion
    // start, not at the cell's start.
    await boot("# T\n\n| A | B |\n| --- | --- |\n| hello | 2 |\n");
    await page.waitForFunction(
      () => /hello/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await selectBetweenTexts("hello", 2, "2", 1);
    await page.keyboard.press("Delete");
    await sleep(200);
    await page.keyboard.type("Z");
    await sleep(100);
    shape = await tableShape();
    check("table: a partial-cell delete keeps the deletion start",
      shape && shape.text[1][0].trim() === "heZ" &&
        shape.text[1][1].trim() === "",
      JSON.stringify(shape));

    // Ctrl+X over a multi-cell selection must cut the text and keep the
    // table's shape. Chromium reports deleteByCut through beforeinput.
    await boot(TABLE_NOTE);
    await selectBetweenTexts("A", 0, "4", 1);
    await page.keyboard.press("Control+x");
    await sleep(250);
    shape = await tableShape();
    check("table: Ctrl+X keeps every row and column",
      shape && shape.rows === 3 && shape.cols.every((n) => n === 2) &&
        shape.text.flat().every((t) => t.trim() === ""),
      JSON.stringify(shape));
    await page.keyboard.press("Control+s");
    check("table: Ctrl+X saves valid GFM",
      await waitForFile((md) => !/<br/i.test(md) &&
        (md.match(/^\|/gm) || []).length === 4 &&
        /^\|\s*\|\s*\|$/m.test(md)),
      JSON.stringify(readNote()));
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content table", { timeout: 10000 });
    shape = await tableShape();
    check("table: Ctrl+X reloads as the same table",
      shape && shape.rows === 3 && shape.cols.every((n) => n === 2),
      JSON.stringify(shape));

    // Shift+Delete is cut on Linux/Windows and reaches the same beforeinput
    // path; it must not corrupt the table either.
    await boot(TABLE_NOTE);
    await selectBetweenTexts("A", 0, "4", 1);
    await page.keyboard.press("Shift+Delete");
    await sleep(250);
    shape = await tableShape();
    check("table: Shift+Delete keeps every row and column",
      shape && shape.rows === 3 && shape.cols.every((n) => n === 2),
      JSON.stringify(shape));

    // A cut that crosses the table boundary must delete the outside text
    // too, matching what was copied, while keeping the table intact.
    await boot("# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n" +
      "| 3 | 4 |\n\ntail\n");
    await selectBetweenTexts("2", 0, "tail", 4);
    await page.keyboard.press("Control+x");
    await sleep(250);
    shape = await tableShape();
    check("table: a cell-to-paragraph cut keeps every row and column",
      shape && shape.rows === 3 && shape.cols.every((n) => n === 2),
      JSON.stringify(shape));
    check("table: a cell-to-paragraph cut empties the selected cells",
      shape && shape.text[1][0].trim() === "1" &&
        shape.text[1][1].trim() === "" &&
        shape.text[2][0].trim() === "" && shape.text[2][1].trim() === "",
      JSON.stringify(shape));
    check("table: a cell-to-paragraph cut deletes the outside paragraph",
      !/tail/.test(await page.evaluate(
        () => document.getElementById("viewer-content").textContent)),
      await page.evaluate(
        () => document.getElementById("viewer-content").textContent));
    await page.keyboard.press("Control+s");
    check("table: a cell-to-paragraph cut saves valid GFM",
      await waitForFile((md) => !/tail/.test(md) && !/<br/i.test(md) &&
        (md.match(/^\|/gm) || []).length === 4),
      JSON.stringify(readNote()));
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content table", { timeout: 10000 });
    shape = await tableShape();
    check("table: a cell-to-paragraph cut reloads as the same table",
      shape && shape.rows === 3 && shape.cols.every((n) => n === 2),
      JSON.stringify(shape));

    // --- 20. task item merges at the checkbox --------------------------
    console.log("\n== hybrid blocks: task item merge ==");
    const TASK_NOTE = "# Tasks\n\n- [ ] alpha\n- [ ] beta\n";
    const taskState = () => page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("#viewer-content li"));
      return {
        count: items.length,
        boxes: document.querySelectorAll(
          '#viewer-content input[type="checkbox"]').length,
        texts: items.map((li) => li.textContent.replace(/\u200B/g, "")),
      };
    });

    await boot(TASK_NOTE);
    await placeCaretInText("beta", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    let tasks = await taskState();
    check("task: Backspace merges the second item into the first",
      tasks.count === 1 && tasks.boxes === 1, JSON.stringify(tasks));
    check("task: Backspace keeps both words and drops the second box",
      tasks.texts[0] === "alphabeta", JSON.stringify(tasks));
    await page.keyboard.press("Control+s");
    check("task: Backspace saves one task with the joined text",
      await waitForFile((md) => md.trim() === "# Tasks\n\n- [ ] alphabeta" &&
        !/\[ \].*\[ \]/.test(md)),
      JSON.stringify(readNote()));

    await boot(TASK_NOTE);
    await placeCaretInText("alpha", "alpha".length);
    await page.keyboard.press("Delete");
    await sleep(250);
    tasks = await taskState();
    check("task: Delete merges the next item into the current one",
      tasks.count === 1 && tasks.boxes === 1, JSON.stringify(tasks));
    check("task: Delete keeps both words and drops the next box",
      tasks.texts[0] === "alphabeta", JSON.stringify(tasks));
    await page.keyboard.press("Control+s");
    check("task: Delete saves one task with the joined text",
      await waitForFile((md) => md.trim() === "# Tasks\n\n- [ ] alphabeta" &&
        !/\[ \].*\[ \]/.test(md)),
      JSON.stringify(readNote()));

    // The first item has no previous sibling item: it joins the block
    // above and gives up its marker.
    await boot("# T\n\nIntro\n\n- [ ] alpha\n- [ ] beta\n");
    await placeCaretInText("alpha", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    tasks = await taskState();
    check("task: the first item joins the preceding block",
      (await page.evaluate(
        () => document.querySelector("#viewer-content p").textContent)) ===
        "Introalpha" && tasks.count === 1 && tasks.texts[0] === "beta",
      JSON.stringify(tasks));
    await page.keyboard.press("Control+s");
    check("task: the first-item merge saves clean Markdown",
      await waitForFile((md) => md === "# T\n\nIntroalpha\n\n- [ ] beta\n"),
      JSON.stringify(readNote()));

    // A plain list item has no checkbox: its native merge stays intact.
    await boot("# L\n\n- one\n- two\n");
    await placeCaretInText("two", 0);
    await page.keyboard.press("Backspace");
    await sleep(200);
    const plainItems = await page.evaluate(
      () => Array.from(document.querySelectorAll("#viewer-content li"))
        .map((li) => li.textContent));
    check("task: plain list items still merge natively",
      plainItems.length === 1 && plainItems[0] === "onetwo",
      JSON.stringify(plainItems));

    // A loose task item's nested list and extra paragraph must survive
    // the merge, not vanish with the source item.
    await boot("# T\n\n- [ ] alpha\n- [ ] beta\n\n" +
      "  second paragraph\n\n  - [ ] sub\n");
    await placeCaretInText("beta", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    const looseMerge = await page.evaluate(() => {
      const outer = document.querySelector("#viewer-content > ul > li");
      return {
        text: outer ? outer.textContent.replace(/\u200B/g, "") : "",
        paragraphs: outer ? Array.from(outer.querySelectorAll(":scope > p"))
          .map((p) => p.textContent.replace(/\u200B/g, "")) : [],
        nested: outer ? Array.from(outer.querySelectorAll(":scope > ul > li"))
          .map((li) => li.textContent.replace(/\u200B/g, "")) : [],
        topLevelItems: Array.from(
          document.querySelectorAll("#viewer-content > ul > li"))
          .map((li) => li.firstChild && li.firstChild.nodeType === 3 ?
            li.textContent : ""),
      };
    });
    check("task loose: the merged item keeps its nested list",
      looseMerge.nested.includes("sub"), JSON.stringify(looseMerge));
    check("task loose: the merged item keeps its extra paragraph",
      looseMerge.paragraphs.some((p) => /second paragraph/.test(p)),
      JSON.stringify(looseMerge));
    check("task loose: both item texts survive",
      /alpha/.test(looseMerge.text) && /beta/.test(looseMerge.text),
      JSON.stringify(looseMerge));
    await page.keyboard.press("Control+s");
    check("task loose: saving preserves the paragraph and nested item",
      await waitForFile((md) => /second paragraph/.test(md) &&
        /sub/.test(md) && !/\[ \] beta/.test(md)),
      JSON.stringify(readNote()));

    // A tight task item with a nested list claims Delete at its content
    // end (the nested list is not its text end).
    const TIGHT_NEST = "# T\n\n- [ ] alpha\n  - [ ] sub\n- [ ] beta\n";
    await boot(TIGHT_NEST);
    await placeCaretInText("alpha", "alpha".length);
    await page.keyboard.press("Delete");
    await sleep(250);
    let nestedState = await page.evaluate(() => ({
      outer: document.querySelector("#viewer-content > ul > li").textContent
        .replace(/\u200B/g, ""),
      nested: Array.from(document.querySelectorAll("#viewer-content li li"))
        .map((li) => li.textContent.replace(/\u200B/g, "")),
      boxes: document.querySelectorAll(
        '#viewer-content input[type="checkbox"]').length,
    }));
    check("task nested: Delete merges the next item without corrupting",
      /alphabeta/.test(nestedState.outer) &&
        nestedState.nested.includes("sub"), JSON.stringify(nestedState));
    check("task nested: the nested checkbox survives",
      nestedState.boxes === 2, JSON.stringify(nestedState));
    await page.keyboard.press("Control+s");
    check("task nested: saving keeps the nested item",
      await waitForFile((md) => /- \[ \] sub/.test(md) &&
        /alphabeta/.test(md)),
      JSON.stringify(readNote()));

    // Backspace joins before the target's nested list, so later typing
    // cannot land inside the child item.
    await boot(TIGHT_NEST);
    await placeCaretInText("beta", 0);
    await page.keyboard.press("Backspace");
    await sleep(200);
    await page.keyboard.type("Z");
    await sleep(100);
    nestedState = await page.evaluate(() => ({
      outer: document.querySelector("#viewer-content > ul > li").textContent
        .replace(/\u200B/g, ""),
      nested: Array.from(document.querySelectorAll("#viewer-content li li"))
        .map((li) => li.textContent.replace(/\u200B/g, "")),
    }));
    check("task nested: Backspace joins before the nested list",
      /alphaZbeta/.test(nestedState.outer), JSON.stringify(nestedState));
    check("task nested: typing does not land in the child item",
      nestedState.nested.includes("sub"), JSON.stringify(nestedState));

    // The first item of a NESTED list joins its parent item, not the
    // block above the whole outer list.
    await boot("# H\n\n- [ ] outer\n  - [ ] sub\n");
    await placeCaretInText("sub", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    const nestedFirst = await page.evaluate(() => ({
      heading: document.querySelector("#viewer-content h1").textContent,
      outer: document.querySelector("#viewer-content > ul > li").textContent
        .replace(/\u200B/g, ""),
      nestedCount: document.querySelectorAll("#viewer-content li li").length,
      boxes: document.querySelectorAll(
        '#viewer-content input[type="checkbox"]').length,
    }));
    check("task nested-first: the heading is not corrupted",
      nestedFirst.heading === "H", JSON.stringify(nestedFirst));
    check("task nested-first: the child joins the parent item",
      /outersub/.test(nestedFirst.outer), JSON.stringify(nestedFirst));
    check("task nested-first: the emptied nested list is gone",
      nestedFirst.nestedCount === 0 && nestedFirst.boxes === 1,
      JSON.stringify(nestedFirst));

    // A non-list target keeps the source's nested list AFTER the block,
    // never inside its paragraph.
    await boot("# T\n\nIntro\n\n- [ ] alpha\n\n  - [ ] sub\n");
    await page.waitForFunction(
      () => /Intro/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await placeCaretInText("alpha", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    const firstPara = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("#viewer-content p"))
        .find((el) => /Introalpha/.test(el.textContent));
      return {
        text: p ? p.textContent : "",
        nestedInside: p ? p.querySelectorAll("ul,ol").length : -1,
        siblingList: p && p.nextElementSibling &&
          p.nextElementSibling.tagName === "UL" ?
          p.nextElementSibling.textContent.replace(/\u200B/g, "") : "",
      };
    });
    check("task first-item: the joined text lands in the paragraph",
      firstPara.text === "Introalpha", JSON.stringify(firstPara));
    check("task first-item: the nested list stays outside the paragraph",
      firstPara.nestedInside === 0 && /sub/.test(firstPara.siblingList),
      JSON.stringify(firstPara));

    // --- 21. delete edges around tables, task items, and images -------
    console.log("\n== hybrid blocks: delete edge guards ==");

    // Ctrl+A + Delete must clear the whole note. A table fully inside the
    // selection is an ordinary block; the table guard must not claim a
    // selection whose endpoints are both outside cells.
    await boot("# Title\n\nPara one.\n\n| A | B |\n| --- | --- |\n" +
      "| 1 | 2 |\n\nPara two.\n");
    await page.waitForFunction(
      () => /Para one/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await page.click("#viewer-content p");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await sleep(250);
    const cleared = await page.evaluate(() => {
      const root = document.getElementById("viewer-content");
      const p = root.querySelector(":scope > p[data-hybrid-caret]");
      return {
        table: root.querySelectorAll("table").length,
        h1: root.querySelectorAll("h1").length,
        children: root.children.length,
        caretP: !!p,
        text: root.textContent.trim(),
      };
    });
    check("delete edge: Ctrl+A + Delete clears the table",
      cleared.table === 0, JSON.stringify(cleared));
    check("delete edge: Ctrl+A + Delete leaves one plain caret paragraph",
      cleared.children === 1 && cleared.caretP && cleared.text === "",
      JSON.stringify(cleared));
    await page.keyboard.type("hello");
    await sleep(100);
    check("delete edge: typing after Ctrl+A + Delete is plain text",
      (await page.evaluate(() => {
        const root = document.getElementById("viewer-content");
        return root.children.length === 1 &&
          root.firstElementChild.tagName === "P" &&
          root.textContent.trim() === "hello";
      })) === true);
    await page.keyboard.press("Control+s");
    check("delete edge: typing after Ctrl+A + Delete saves plain text",
      await waitForFile((md) => md.trim() === "hello"), JSON.stringify(readNote()));
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await sleep(150);
    await page.keyboard.press("Control+s");
    check("delete edge: saving the empty state emits no heading junk",
      await waitForFile((md) => /^\s*$/.test(md) && !/#/.test(md)),
      JSON.stringify(readNote()));

    // An empty first block is still a block. Selecting only the text in a
    // later block must not be read as a whole-note clear.
    await boot("# \n\nHello\n");
    await page.waitForFunction(
      () => /Hello/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await selectBetweenTexts("Hello", 0, "Hello", 5);
    await page.keyboard.press("Delete");
    await sleep(200);
    const partialClear = await page.evaluate(() => ({
      h1: document.querySelectorAll("#viewer-content h1").length,
      caretP: document.querySelectorAll(
        "#viewer-content p[data-hybrid-caret]").length,
      text: document.getElementById("viewer-content").textContent
        .replace(/\u200B/g, ""),
    }));
    check("delete edge: a later-block selection is not a whole-note clear",
      partialClear.h1 === 1 && partialClear.caretP === 0,
      JSON.stringify(partialClear));
    check("delete edge: the partial delete removes only the selected text",
      !/Hello/.test(partialClear.text), JSON.stringify(partialClear));

    // Ctrl+A + Ctrl+X clears the whole note to one plain paragraph; the
    // clipboard side is untouched.
    await boot("# Title\n\nParagraph.\n");
    await page.waitForFunction(
      () => /Paragraph/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await page.click("#viewer-content p");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+x");
    await sleep(250);
    const cutClear = await page.evaluate(() => {
      const root = document.getElementById("viewer-content");
      return {
        h1: root.querySelectorAll("h1").length,
        children: root.children.length,
        caretP: !!root.querySelector(":scope > p[data-hybrid-caret]"),
        text: root.textContent.trim(),
      };
    });
    check("delete edge: Ctrl+A + Ctrl+X leaves one plain caret paragraph",
      cutClear.h1 === 0 && cutClear.children === 1 &&
        cutClear.caretP && cutClear.text === "", JSON.stringify(cutClear));
    await page.keyboard.type("hello");
    await sleep(100);
    check("delete edge: typing after a whole-note cut is plain text",
      (await page.evaluate(() => {
        const root = document.getElementById("viewer-content");
        return root.children.length === 1 &&
          root.firstElementChild.tagName === "P" &&
          root.textContent.trim() === "hello";
      })) === true);
    await page.keyboard.press("Control+s");
    check("delete edge: a whole-note cut saves plain text",
      await waitForFile((md) => md.trim() === "hello"), JSON.stringify(readNote()));
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await sleep(150);
    await page.keyboard.press("Control+s");
    check("delete edge: saving after a whole-note cut emits no heading junk",
      await waitForFile((md) => /^\s*$/.test(md) && !/#/.test(md)),
      JSON.stringify(readNote()));

    // Delete at the end of a plain item whose next item is a task must
    // merge the text and drop the checkbox, not write a literal [ ].
    await boot("# L\n\n- one\n- [ ] two\n");
    await page.waitForFunction(
      () => /one/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await placeCaretInText("one", "one".length);
    await page.keyboard.press("Delete");
    await sleep(250);
    const mergedPlain = await page.evaluate(() => ({
      items: document.querySelectorAll("#viewer-content li").length,
      boxes: document.querySelectorAll(
        '#viewer-content input[type="checkbox"]').length,
      text: document.querySelector("#viewer-content li").textContent
        .replace(/\u200B/g, ""),
    }));
    check("delete edge: a plain item absorbs the following task",
      mergedPlain.items === 1 && mergedPlain.boxes === 0 &&
        mergedPlain.text.trim() === "onetwo", JSON.stringify(mergedPlain));
    await page.keyboard.press("Control+s");
    check("delete edge: the merged plain item saves no literal [ ]",
      await waitForFile((md) => /onetwo/.test(md) && !/\[ \]/.test(md)),
      JSON.stringify(readNote()));

    // A caret AT a nested list boundary is not the outer item's content
    // end: Delete must not merge the following outer item.
    await boot("# T\n\n- [ ] alpha\n  - sub\n- [ ] beta\n");
    await page.waitForFunction(
      () => /beta/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await page.evaluate(() => {
      const nested = document.querySelector("#viewer-content ul ul");
      const r = document.createRange();
      r.setStart(nested, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press("Delete");
    await sleep(250);
    const boundary = await page.evaluate(() => ({
      outer: document.querySelectorAll("#viewer-content > ul > li").length,
      boxes: document.querySelectorAll(
        '#viewer-content input[type="checkbox"]').length,
      text: document.getElementById("viewer-content").textContent
        .replace(/\u200B/g, ""),
    }));
    check("delete edge: a nested-list boundary keeps the next outer item",
      boundary.outer === 2 && boundary.boxes === 2 &&
        /beta/.test(boundary.text), JSON.stringify(boundary));

    // A leading image inside a task item is content: Backspace deletes
    // the image, not the item's start/merge.
    await boot("# T\n\n- [ ] ![](" + PIC + ")alpha\n");
    await page.waitForFunction(
      () => /alpha/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await placeCaretInText("alpha", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    const taskImage = await page.evaluate(() => ({
      images: document.querySelectorAll("#viewer-content img").length,
      items: document.querySelectorAll("#viewer-content li").length,
      boxes: document.querySelectorAll(
        '#viewer-content input[type="checkbox"]').length,
      text: document.getElementById("viewer-content").textContent
        .replace(/\u200B/g, ""),
    }));
    check("delete edge: a leading task image is deleted, not the item",
      taskImage.images === 0 && taskImage.items === 1 &&
        taskImage.boxes === 1 && /alpha/.test(taskImage.text),
      JSON.stringify(taskImage));

    // Same rule at an <hr> edge: the image is the character Backspace
    // removes, not the rule.
    await boot("# H\n\n---\n\n![](" + PIC + ")alpha\n");
    await page.waitForFunction(
      () => /alpha/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await placeCaretInText("alpha", 0);
    await page.keyboard.press("Backspace");
    await sleep(250);
    const ruleImage = await page.evaluate(() => ({
      rules: document.querySelectorAll("#viewer-content hr").length,
      images: document.querySelectorAll("#viewer-content img").length,
      text: document.getElementById("viewer-content").textContent
        .replace(/\u200B/g, ""),
    }));
    check("delete edge: a leading image after a rule is deleted, not the rule",
      ruleImage.rules === 1 && ruleImage.images === 0 &&
        /alpha/.test(ruleImage.text), JSON.stringify(ruleImage));

    // Table context-menu items must be disabled on the shapes the delete
    // actions already refuse.
    const openTableMenu = async (selector = "#viewer-content td") => {
      await page.click(selector);
      await page.evaluate((sel) => {
        const cell = document.querySelector(sel);
        cell.dispatchEvent(new MouseEvent("contextmenu",
          { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      }, selector);
      await sleep(100);
    };
    const tableMenuState = () => page.evaluate(() => {
      const menu = document.getElementById("nb-menu");
      const wrap = Array.from(menu.querySelectorAll("button.submenu"))
        .find((b) => b.firstChild && b.firstChild.nodeType === Node.TEXT_NODE &&
          b.firstChild.nodeValue.trim() === "Table");
      if (!wrap) return null;
      const buttons = Array.from(wrap.querySelectorAll("button"));
      const pick = (label) => buttons.find((b) => b.textContent.trim() === label);
      const row = pick("Delete row");
      const col = pick("Delete column");
      return {
        row: row && { disabled: row.disabled, title: row.title },
        col: col && { disabled: col.disabled, title: col.title },
        rows: menu.ownerDocument
          .querySelectorAll("#viewer-content table tr").length,
      };
    });

    await boot("# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    await page.waitForFunction(
      () => /1/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await openTableMenu();
    let menuState = await tableMenuState();
    check("table menu: Delete row is disabled for header + one row",
      menuState && menuState.row && menuState.row.disabled &&
        /header/.test(menuState.row.title), JSON.stringify(menuState));
    // The header row has its own reason, not the header+body-row reason.
    await boot("# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n");
    await page.waitForFunction(
      () => /3/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await openTableMenu("#viewer-content th");
    menuState = await tableMenuState();
    check("table menu: deleting the header row states the header cause",
      menuState && menuState.row && menuState.row.disabled &&
        /header row cannot be deleted/.test(menuState.row.title),
      JSON.stringify(menuState));

    await boot("# T\n\n| A |\n| --- |\n| 1 |\n");
    await page.waitForFunction(
      () => /1/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await openTableMenu();
    menuState = await tableMenuState();
    check("table menu: Delete column is disabled for one column",
      menuState && menuState.col && menuState.col.disabled &&
        /column/.test(menuState.col.title), JSON.stringify(menuState));

    await boot("# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n");
    await page.waitForFunction(
      () => /3/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await openTableMenu();
    menuState = await tableMenuState();
    check("table menu: an ordinary table keeps both deletes enabled",
      menuState && menuState.row && !menuState.row.disabled &&
        menuState.col && !menuState.col.disabled, JSON.stringify(menuState));
    await page.evaluate(() => {
      const menu = document.getElementById("nb-menu");
      const wrap = Array.from(menu.querySelectorAll("button.submenu"))
        .find((b) => b.firstChild && b.firstChild.nodeType === Node.TEXT_NODE &&
          b.firstChild.nodeValue.trim() === "Table");
      const row = wrap && Array.from(wrap.querySelectorAll("button"))
        .find((b) => b.textContent.trim() === "Delete row");
      if (row && !row.disabled) row.click();
    });
    await sleep(150);
    check("table menu: enabled Delete row removes that row",
      (await page.evaluate(
        () => document.querySelectorAll("#viewer-content table tr").length)) === 2,
      JSON.stringify(await tableShape()));
    await page.keyboard.press("Control+s");
    check("table menu: enabled Delete row saves the shortened table",
      await waitForFile((md) => (md.match(/^\|/gm) || []).length === 3 &&
        /\| 3 \| 4 \|/.test(md) && !/\| 1 \| 2 \|/.test(md)),
      JSON.stringify(readNote()));

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
