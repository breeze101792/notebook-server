#!/usr/bin/env node
/* Spellcheck host test -- docs/architecture/spellcheck.md §10 (T-SPELL-01,
 * T-SPELL-02, T-SPELL-03).
 *
 * Loads the real `static/js/spellcheck.js` into a jsdom window with the NB
 * stubs the module requires, the real typo-js vendor script, and the real
 * en_US dictionary read from disk (injected through a stubbed `fetch`). A
 * stand-in `CSS.highlights` registry keeps the module on its live path
 * instead of its degraded one.
 *
 * Covered here, and nowhere else:
 *   - T-SPELL-01 (§4) the word predicate: whitespace, digits (I2C, 0x20),
 *     joiners (foo_bar, user@host, file.txt), split words, the exclusion
 *     set, links and table cells (deliberately not excluded), the curly
 *     apostrophe and the interior hyphen;
 *   - T-SPELL-02 (§2) `check`/`suggest` against the vendored dictionary,
 *     the 5-suggestion cap, the curly-apostrophe fold, and the
 *     `null`/`[]` answers before the dictionary is ready;
 *   - T-SPELL-03 (§7) `app.js` personal-list normalisation: trim,
 *     lower-case, dedupe, curly-apostrophe fold, the 64-character refusal,
 *     the token rule, and the 1,000-entry cap with the oldest dropped.
 *
 * The paint, the pointer hit-test in a real engine, the menu descriptors and
 * the write path are browser-only (tests/browser/test_hybrid_browser.js). The
 * jsdom degraded path is tests/dom/test_dom.js.
 *
 * Run:  node tests/static/test_spellcheck.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PROJ = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(PROJ, rel), "utf8");

function resolveJsdom() {
  for (const candidate of [
    path.join(PROJ, "node_modules", "jsdom"),
    path.join(process.env.TMPDIR || "", "node_modules", "jsdom"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("jsdom not found. Run `npm install` in the project root.");
}
const { JSDOM } = require(resolveJsdom());

let pass = 0;
let fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  FAIL " + label + (extra ? "  [" + extra + "]" : "")); }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/* Base-26 name for the 1,000-cap case: letters only, so the token rule
 * keeps every generated word. */
function wordAt(index) {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return "z" + out;
}

async function main() {
  const html = `<!doctype html><html><body>
    <div id="viewer-content">
      <p id="plain">hello world</p>
      <p id="digits">I2C bus and 0x20 here</p>
      <p id="joiners">foo_bar user@host file.txt end.</p>
      <p id="split">un<em id="split-mid">believ</em>able</p>
      <div id="literal"><code id="code">tpyo</code></div>
      <pre id="pre">tpyo</pre>
      <p><kbd id="kbd">tpyo</kbd></p>
      <p id="atomic"><span id="ce-false" contenteditable="false">tpyo</span></p>
      <div class="svg-container" id="plugin">tpyo</div>
      <p id="prose-inline"><a id="link" href="#">tpyo</a></p>
      <table><tbody><tr><td id="cell">tpyo</td></tr></tbody></table>
      <p id="apostrophe">don\u2019t mother-in-law</p>
    </div>
  </body></html>`;

  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "http://127.0.0.1:5000/",
  });
  const window = dom.window;
  const ctx = dom.getInternalVMContext();
  const document = window.document;
  const evalIn = (src) => vm.runInContext(src, ctx);

  // Let jsdom's own DOMContentLoaded fire before app.js registers `boot`,
  // so loading the module does not run the whole bootstrap in a bare window.
  await tick(60);

  // The highlight registry the module paints into (jsdom has no CSS.highlights).
  const registry = new Map();
  window.CSS = { highlights: registry };
  window.Highlight = class Highlight {
    constructor(...ranges) { this.ranges = ranges; }
  };

  // The dictionary, read once from disk.
  const AFF = read("static/vendor/dictionaries/en_US/en_US.aff");
  const DIC = read("static/vendor/dictionaries/en_US/en_US.dic");

  // NB stubs. `blocks` and `evt` must exist before spellcheck.js loads: the
  // exclusion list is built at module load from the renderer registry.
  window.NB = {
    blocks: {
      all: () => [{ selector: ".mermaid-container" }, { selector: ".svg-container" }],
      selectorFor: (d) => d.selector,
    },
    lazyload: { scripts: async (srcs) => srcs.slice() },
    evt: { on() {}, off() {}, emit() {} },
    // app.js's debounced persist path is not under test here.
    api: {
      saveConfig: async () => ({ ok: true }),
      saveWorkspaceState: async () => ({}),
    },
  };

  // Every dictionary/source fetch goes through here; the two dictionary
  // paths answer with the real files, any other path fails the test loudly.
  const fetched = [];
  window.fetch = async (url) => {
    fetched.push(String(url));
    const body = /\.aff(?:$|\?)/.test(url) ? AFF
      : /\.dic(?:$|\?)/.test(url) ? DIC : null;
    if (body == null) {
      return { ok: false, status: 404, text: async () => "" };
    }
    return { ok: true, status: 200, text: async () => body };
  };

  // The vendor script defines window.Typo; the module's load() expects it
  // after NB.lazyload.scripts resolves.
  evalIn(read("static/vendor/typo.js"));
  evalIn(read("static/js/app.js"));
  evalIn(read("static/js/spellcheck.js"));

  const sc = window.NB.spellcheck;
  check("spellcheck: NB.spellcheck is published",
    !!sc && typeof sc.check === "function");
  if (!sc) {
    console.log("\nRESULT: FAIL  (" + pass + " ok, " + fail + " failed)");
    process.exit(1);
  }

  console.log("== T-SPELL-02: dictionary verdicts ==");

  // Before enter(): "idle" is not "ready", so both answers must be the
  // "no verdict" shape rather than a guess.
  check("T-SPELL-02: state is idle before enter()", sc.state() === "idle",
    "state=" + sc.state());
  check("T-SPELL-02: check() is null before the dictionary is ready",
    sc.check("hello") === null, String(sc.check("hello")));
  check("T-SPELL-02: suggest() is [] before the dictionary is ready",
    Array.isArray(sc.suggest("helo")) && sc.suggest("helo").length === 0);

  const root = document.getElementById("viewer-content");
  sc.enter(root);
  check("T-SPELL-02: enter() reports loading immediately",
    sc.state() === "loading", "state=" + sc.state());
  for (let i = 0; i < 200 && sc.state() !== "ready" && sc.state() !== "failed"; i++) {
    await tick(10);
  }
  check("T-SPELL-02: the real en_US pair loads to ready",
    sc.state() === "ready", "state=" + sc.state());
  check("T-SPELL-02: both dictionary files were fetched once",
    fetched.filter((u) => /\.aff/.test(u)).length === 1 &&
    fetched.filter((u) => /\.dic/.test(u)).length === 1,
    JSON.stringify(fetched));

  check("T-SPELL-02: a correct word is true", sc.check("hello") === true);
  check("T-SPELL-02: a misspelling is false", sc.check("helo") === false);
  check("T-SPELL-02: a capitalised word is true", sc.check("Hello") === true);
  check("T-SPELL-02: an all-caps word is true", sc.check("HELLO") === true);
  check("T-SPELL-02: the curly apostrophe folds to the dictionary's form",
    sc.check("don\u2019t") === true && sc.check("don't") === true);
  check("T-SPELL-18: an all-caps acronym is accepted",
    sc.check("SCPI") === true);
  check("T-SPELL-18: an identifier with an internal capital is accepted",
    sc.check("currentColor") === true && sc.check("KaTeX") === true);
  check("T-SPELL-18: a hyphen compound of known parts is accepted",
    sc.check("box-shadow") === true && sc.check("one-click") === true);
  check("T-SPELL-18: a possessive of a known word is accepted",
    sc.check("dog's") === true && sc.check("frobnicator's") === false);
  check("T-SPELL-18: a lower-case typo is still flagged",
    sc.check("recieve") === false && sc.check("firmwar") === false);

  const sug = sc.suggest("helo", 5);
  check("T-SPELL-02: suggest() ranks a real correction",
    Array.isArray(sug) && sug.indexOf("hello") !== -1, JSON.stringify(sug));
  check("T-SPELL-02: suggest() returns at most 5", sug.length <= 5,
    "n=" + sug.length);
  check("T-SPELL-02: an explicit n caps the list",
    sc.suggest("helo", 2).length <= 2, "n=" + sc.suggest("helo", 2).length);
  check("T-SPELL-02: n is capped at MAX_SUGGESTIONS (5)",
    sc.suggest("helo", 99).length <= 5, "n=" + sc.suggest("helo", 99).length);
  check("T-SPELL-02: suggest() is [] for a correct word",
    sc.suggest("hello").length === 0, JSON.stringify(sc.suggest("hello")));
  check("T-SPELL-02: a non-checkable word gets no suggestions",
    sc.suggest("12345").length === 0 && sc.suggest("foo_bar").length === 0);

  check("T-SPELL-02: digits are not checkable (null)",
    sc.check("12345") === null && sc.check("I2C") === null);
  check("T-SPELL-02: a 65-character word is not checkable (null)",
    sc.check("a".repeat(65)) === null);
  check("T-SPELL-02: a 64-character word is checkable (not null)",
    sc.check("a".repeat(64)) !== null);

  console.log("== T-SPELL-01: word predicate ==");

  // The predicate is private; wordAtPoint is its public surface. A stub
  // caretRangeFromPoint stands in for the real hit-test (jsdom has none).
  function hitAt(node, offset) {
    document.caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      return r;
    };
    return sc.wordAtPoint(10, 10);
  }
  const firstText = (id) => document.getElementById(id).firstChild;
  const hitWord = (id, offset) => {
    const hit = hitAt(firstText(id), offset);
    return hit ? hit.word : null;
  };
  const hitDetail = (hit) => hit
    ? JSON.stringify({ word: hit.word, start: hit.start, end: hit.end })
    : "null";

  const plain = hitAt(firstText("plain"), 8);
  check("T-SPELL-01: the word under the pointer resolves with its offsets",
    !!plain && plain.word === "world" && plain.start === 6 && plain.end === 11,
    hitDetail(plain));
  check("T-SPELL-01: whitespace between words resolves to no word",
    hitWord("plain", 5) === null, String(hitWord("plain", 5)));

  check("T-SPELL-01: I2C resolves to no word (digits refuse the token)",
    hitWord("digits", 0) === null && hitWord("digits", 2) === null,
    "0=" + hitWord("digits", 0) + " 2=" + hitWord("digits", 2));
  check("T-SPELL-01: 0x20 resolves to no word",
    hitWord("digits", 13) === null && hitWord("digits", 15) === null,
    "13=" + hitWord("digits", 13) + " 15=" + hitWord("digits", 15));

  check("T-SPELL-01: foo_bar resolves to no word (both halves are refused)",
    hitWord("joiners", 1) === null && hitWord("joiners", 5) === null);
  check("T-SPELL-01: user@host resolves to no word",
    hitWord("joiners", 10) === null);
  check("T-SPELL-01: file.txt is refused as a dotted extension",
    hitWord("joiners", 20) === null && hitWord("joiners", 24) === null);
  check("T-SPELL-01: a sentence period does not glue the word",
    hitWord("joiners", 28) === "end", String(hitWord("joiners", 28)));

  check("T-SPELL-01: a link label is prose and resolves",
    (() => {
      const hit = hitAt(firstText("link"), 1);
      return !!hit && hit.word === "tpyo";
    })());
  check("T-SPELL-01: a table cell is prose and resolves",
    (() => {
      const hit = hitAt(firstText("cell"), 1);
      return !!hit && hit.word === "tpyo";
    })());

  check("T-SPELL-01: code text is excluded",
    hitAt(firstText("code"), 1) === null);
  check("T-SPELL-01: pre text is excluded",
    hitAt(document.getElementById("pre").firstChild, 1) === null);
  check("T-SPELL-01: kbd text is excluded",
    hitAt(firstText("kbd"), 1) === null);
  check("T-SPELL-01: contenteditable=false is excluded",
    hitAt(firstText("ce-false"), 1) === null);
  check("T-SPELL-01: a renderer-registry plugin container is excluded",
    hitAt(firstText("plugin"), 1) === null);

  check("T-SPELL-01: the curly apostrophe is part of the token",
    hitWord("apostrophe", 2) === "don\u2019t",
    String(hitWord("apostrophe", 2)));
  check("T-SPELL-01: an interior hyphen is part of the token",
    hitWord("apostrophe", 9) === "mother-in-law",
    String(hitWord("apostrophe", 9)));

  // §4 rule 2: "the whole word lies inside that one text node"; a word split
  // by inline markup (un<em>believ</em>able) is refused rather than guessed.
  {
    const lead = hitAt(firstText("split"), 1);
    const middle = hitAt(document.getElementById("split-mid").firstChild, 2);
    const tail = hitAt(document.getElementById("split").lastChild, 1);
    check("T-SPELL-01: a word split by inline markup is refused at every part",
      lead === null && middle === null && tail === null,
      "lead=" + hitDetail(lead) + " middle=" + hitDetail(middle) +
      " tail=" + hitDetail(tail));
  }

  const caretNode = firstText("plain");
  {
    const r = document.createRange();
    r.setStart(caretNode, 8);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  const caretHit = sc.wordAtCaret();
  check("T-SPELL-01: wordAtCaret resolves the word at the selection anchor",
    !!caretHit && caretHit.word === "world", hitDetail(caretHit));
  {
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    document.caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(outside.firstChild, 3);
      r.collapse(true);
      return r;
    };
    check("T-SPELL-01: a text node outside the editing root resolves to null",
      sc.wordAtPoint(10, 10) === null);
    outside.remove();
  }
  {
    document.caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(document.getElementById("plain"), 0);
      r.collapse(true);
      return r;
    };
    check("T-SPELL-01: a caret on an element (not a text node) resolves to null",
      sc.wordAtPoint(10, 10) === null);
  }
  delete document.caretRangeFromPoint;

  console.log("== T-SPELL-03: personal-list normalisation ==");
  // §7: app.js owns the shape every reader sees. The applyConfig path and
  // the setter both call this one function; the public surface is exercised
  // through get/setSpellcheckWords.
  const app = window.NB.app;
  check("T-SPELL-03: NB.app exposes the pair",
    !!app && typeof app.getSpellcheckWords === "function" &&
    typeof app.setSpellcheckWords === "function");

  app.setSpellcheckWords(["Hello", "HELLO", "  hello  ", "World"]);
  check("T-SPELL-03: trimmed, lower-cased and deduped in first-seen order",
    JSON.stringify(app.getSpellcheckWords()) === JSON.stringify(["hello", "world"]),
    JSON.stringify(app.getSpellcheckWords()));

  app.setSpellcheckWords(["don\u2019t"]);
  check("T-SPELL-03: the curly apostrophe folds to ASCII",
    JSON.stringify(app.getSpellcheckWords()) === JSON.stringify(["don't"]),
    JSON.stringify(app.getSpellcheckWords()));

  app.setSpellcheckWords(["a".repeat(64), "a".repeat(65)]);
  check("T-SPELL-03: 64 characters are kept, 65 are refused",
    app.getSpellcheckWords().length === 1 &&
    app.getSpellcheckWords()[0].length === 64,
    "len=" + (app.getSpellcheckWords()[0] || "").length);

  app.setSpellcheckWords([
    "bad word", "foo_bar", "user@host", "123", "-lead", "trail-", "ok", 7, null,
  ]);
  check("T-SPELL-03: entries outside the token rule and non-strings are dropped",
    JSON.stringify(app.getSpellcheckWords()) === JSON.stringify(["ok"]),
    JSON.stringify(app.getSpellcheckWords()));

  const many = [];
  for (let i = 0; i < 1005; i++) many.push(wordAt(i));
  app.setSpellcheckWords(many);
  {
    const kept = app.getSpellcheckWords();
    check("T-SPELL-03: the list is capped at 1,000",
      kept.length === 1000, "len=" + kept.length);
    check("T-SPELL-03: the cap drops the oldest entries, keeping the newest",
      kept[0] === wordAt(5) && kept[kept.length - 1] === wordAt(1004),
      "first=" + kept[0] + " last=" + kept[kept.length - 1]);
  }

  app.setSpellcheckWords(["tpyo"]);
  check("T-SPELL-02: a personal word is correct by definition",
    sc.check("tpyo") === true);
  app.setSpellcheckWords([]);
  check("T-SPELL-02: clearing the list restores the dictionary verdict",
    sc.check("tpyo") === false);

  app.setSpellcheckWords(["html"]);
  check("T-SPELL-18: a personal part accepts the compound",
    sc.check("html-live") === true);
  app.setSpellcheckWords([]);
  check("T-SPELL-18: without the part the compound is flagged",
    sc.check("html-live") === false);

  console.log("");
  if (fail) {
    console.log("RESULT: FAIL  (" + pass + " ok, " + fail + " failed)");
    process.exit(1);
  }
  console.log("RESULT: PASS  (" + pass + " ok, 0 failed)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  console.log("\nRESULT: FAIL  (harness error)");
  process.exit(1);
});
