/* spellcheck.js -- the app's en_US spelling verdict, suggest list and
 * misspelling underline (NB.spellcheck).
 *
 * Contract: docs/architecture/spellcheck.md. The module answers "is this
 * word misspelled?" and "what should replace it?", and paints the underline
 * through the CSS Custom Highlight API (no DOM mutation). It never writes
 * prose, touches the selection, or decides when a menu opens -- hybrid owns
 * the write path and the menu, app.js owns the config.
 *
 * Load order: after blocks.js (the exclusion list reads the renderer
 * registry) and menu.js, before the renderers.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Paint granularity, not undo granularity: HISTORY_COALESCE_MS (400) in
  // hybrid.js is a different concern.
  const REFRESH_DEBOUNCE_MS = 200;
  const MAX_SUGGESTIONS = 5;
  const MAX_WORD_LENGTH = 64;
  const WORD_LIST_MAX = 1000;
  const HIGHLIGHT_NAME = "nb-spelling";
  const VENDOR_SCRIPT = "/static/vendor/typo.js";
  const DICTIONARY_LANG = "en_US";
  const AFF_PATH = "/static/vendor/dictionaries/en_US/en_US.aff";
  const DIC_PATH = "/static/vendor/dictionaries/en_US/en_US.dic";
  const SOFTWARE_TERMS_PATH = "/static/vendor/dictionaries/softwareTerms.txt";
  // ASCII-only en_US. An interior hyphen is part of the token
  // (mother-in-law); digits, "_", "/", "@" and "." are not, which is what
  // rejects I2C and 0x20.
  const TOKEN_RE = /[A-Za-z][A-Za-z'\u2019\-]*[A-Za-z]/g;
  const TOKEN_FULL_RE = /^[A-Za-z][A-Za-z'\-]*[A-Za-z]$/;
  // Characters that glue a token to its neighbours: a match next to one of
  // these was cut out of a longer run (foo_bar, user@host, well-\nknown).
  const JOINER_RE = /[\p{L}\p{N}_\-\/@]/u;
  const WORD_CHAR_RE = /[\p{L}\p{N}_'\u2019\-]/u;
  const SHOW_TEXT = (typeof NodeFilter !== "undefined")
    ? NodeFilter.SHOW_TEXT : 0x4;
  const CURLY_APOSTROPHE_RE = /\u2019/g;

  // Literal content and rendered blocks are not prose. Links and table
  // cells ARE checked: their text serializes to Markdown. Derived from the
  // renderer registry so a new plugin is covered by construction (the same
  // derivation hybrid.js uses for its blocked-target list).
  const PLUGIN_SELECTORS = [];
  if (NB.blocks && NB.blocks.all) {
    for (const d of NB.blocks.all()) {
      const sel = NB.blocks.selectorFor(d);
      if (sel) PLUGIN_SELECTORS.push(sel);
    }
  }
  const EXCLUSION_SELECTOR =
    "code, pre, kbd, img, [contenteditable=\"false\"]" +
    (PLUGIN_SELECTORS.length ? ", " + PLUGIN_SELECTORS.join(", ") : "");

  let lifecycle = "idle";   // "idle" | "loading" | "ready" | "failed"
  let dict = null;          // the Typo instance, cached across sessions
  let softwareTerms = null; // Set of lower-case software words, or null
  let codeVocab = new Set(); // lower-case tokens used in this note's code
  let root = null;          // the editing element, one hybrid session
  const sessionIgnored = new Set();
  let refreshTimer = null;
  let idleHandle = null;
  let passWarned = false;

  /* --- helpers ------------------------------------------------------ */

  // The dictionary's own form: the .aff ICONV table maps U+2019 to "'",
  // but the module does not depend on it (§4).
  function fold(word) {
    return String(word == null ? "" : word).replace(CURLY_APOSTROPHE_RE, "'");
  }

  function highlightRegistry() {
    return (typeof CSS !== "undefined" && CSS) ? CSS.highlights : null;
  }

  function hasHighlightApi() {
    return !!(highlightRegistry() && typeof window.Highlight === "function");
  }

  function setLifecycle(next) {
    lifecycle = next;
    if (NB.evt) NB.evt.emit("spellcheck:state", lifecycle);
  }

  /* The switch, read call-time (app.js loads last). */
  function enabled() {
    if (NB.app && NB.app.getSpellcheck) return NB.app.getSpellcheck();
    return true;
  }

  /* The personal list, normalised and lower-cased. app.js caps it on read
   * and write; the cap here keeps a hand-edited config honest. */
  function personalWords() {
    let list = null;
    if (NB.app && NB.app.getSpellcheckWords) list = NB.app.getSpellcheckWords();
    else if (NB.app && NB.app.getCfg) list = NB.app.getCfg().spellcheckWords;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const w of list) {
      if (typeof w !== "string") continue;
      const clean = fold(w).trim().toLowerCase();
      if (clean) out.push(clean);
    }
    return out.slice(-WORD_LIST_MAX);
  }

  function isExcludedWord(word) {
    const key = fold(word).toLowerCase();
    return sessionIgnored.has(key) || personalWords().indexOf(key) !== -1;
  }

  function isCheckable(word) {
    return word.length > 0 && word.length <= MAX_WORD_LENGTH &&
      TOKEN_FULL_RE.test(word);
  }

  /* Accepted technical shapes (architecture §4.1), so a notebook's own
   * vocabulary is not flagged. `word` keeps its case; the apostrophe is
   * already folded by the caller or here. */
  const ACRONYM_RE = /^[A-Z]{2,}$/;
  const POSSESSIVE_RE = /['’]s$/i;
  // Inflection suffixes, longest first; the base keeps the word's case so
  // `APIs` can resolve to the acronym `API`.
  const INFLECTIONS = [
    ["ies", "y"], ["ied", "y"], ["ing", ""], ["est", ""], ["ed", ""],
    ["es", ""], ["es", "e"], ["er", ""], ["er", "e"], ["ly", ""],
    ["s", ""],
  ];

  function baseForms(word) {
    const out = [];
    const lower = word.toLowerCase();
    for (const [suffix, tail] of INFLECTIONS) {
      if (!lower.endsWith(suffix)) continue;
      let base = word.slice(0, word.length - suffix.length) + tail;
      // A doubled consonant before -ed/-ing/-er: mapped -> map.
      if (/(?:ed|ing|er|est)$/.test(suffix) && base.length > 2 &&
          base[base.length - 1].toLowerCase() ===
            base[base.length - 2].toLowerCase()) {
        out.push(base.slice(0, -1));
      }
      if (suffix === "s" && !lower.endsWith("ss")) out.push(base);
      else if (suffix !== "s") out.push(base);
    }
    return out.filter((b) => b.length >= 2 && b !== word);
  }

  /* One known-word test, no inflection: the sources are the personal list,
   * the note's code vocabulary, the software-terms list, the dictionary,
   * and the accepted shapes. */
  function isKnownDirect(word) {
    const w = fold(word).trim();
    if (!w || !TOKEN_FULL_RE.test(w)) return false;
    if (isExcludedWord(w)) return true;
    if (codeVocab.has(w.toLowerCase())) return true;
    if (softwareTerms && softwareTerms.has(w.toLowerCase())) return true;
    if (ACRONYM_RE.test(w)) return true;
    if (/[A-Z]/.test(w.slice(1))) return true;
    if (dict && dict.check(w)) return true;
    // A possessive of a known word: check the stem, not the ’s.
    const stem = w.replace(POSSESSIVE_RE, "");
    if (stem !== w) {
      if (isExcludedWord(stem)) return true;
      if (ACRONYM_RE.test(stem) || /[A-Z]/.test(stem.slice(1))) return true;
      if (dict && dict.check(stem)) return true;
    }
    // A hyphen compound: every part of 2+ letters must be known, so a
    // personal `html` accepts `html-live` without listing the compound.
    if (w.indexOf("-") !== -1) {
      const parts = w.split("-").filter((p) => /^[A-Za-z]{2,}$/.test(p));
      if (parts.length > 1 && parts.every((p) =>
        isExcludedWord(p) || (dict && dict.check(p)) ||
        codeVocab.has(p.toLowerCase()) ||
        (softwareTerms && softwareTerms.has(p.toLowerCase())))) return true;
    }
    return false;
  }

  /* Known, or an inflection of a known word (subfolders, flashed, APIs),
   * two levels deep so `renderers` can reach `render`. */
  function isKnownWord(word) {
    const w = fold(word).trim();
    if (isKnownDirect(w)) return true;
    for (const base of baseForms(w)) {
      if (isKnownDirect(base)) return true;
      for (const deeper of baseForms(base)) {
        if (isKnownDirect(deeper)) return true;
      }
    }
    // A compound whose parts are inflected (sub-folders).
    if (w.indexOf("-") !== -1) {
      const parts = w.split("-").filter((p) => /^[A-Za-z]{2,}$/.test(p));
      if (parts.length > 1 && parts.every((p) =>
        isKnownDirect(p) || baseForms(p).some((b) => isKnownDirect(b)))) {
        return true;
      }
    }
    return false;
  }

  function isExcluded(node) {
    const parent = node.parentElement;
    return !!(parent && parent.closest(EXCLUSION_SELECTOR));
  }

  // Inline-flow boundaries: an adjacent sibling that is a block element is
  // a new block, so its text never continues this word.
  const BLOCK_TAGS = new Set([
    "P", "LI", "DIV", "BLOCKQUOTE", "TD", "TH", "H1", "H2", "H3", "H4",
    "H5", "H6", "FIGCAPTION", "DT", "DD",
  ]);

  /* The character just past `node` in the given direction, walking out
   * through inline ancestors and descending into the sibling's edge text.
   * Returns "" at a block boundary or at the editor root. */
  function edgeChar(node, dir, edge) {
    let cur = node;
    while (cur && cur !== root) {
      const sib = cur[dir];
      if (sib) {
        if (sib.nodeType === 1 && BLOCK_TAGS.has(sib.tagName)) return "";
        let el = sib;
        while (el && el.nodeType === 1) {
          const kids = el.childNodes;
          if (!kids.length) return "";
          el = edge === "last" ? kids[kids.length - 1] : kids[0];
        }
        if (el && el.nodeType === 3) {
          const data = el.data || "";
          if (!data) return "";
          return edge === "last"
            ? data.charAt(data.length - 1) : data.charAt(0);
        }
        return "";
      }
      cur = cur.parentNode;
    }
    return "";
  }

  /* True when the token at [start,end) of `data` continues into a
   * neighbour, so it was cut out of a longer run rather than being a whole
   * word (§4). A sentence period does not glue ("end."), but a dotted
   * extension does ("file.txt"). */
  function touchesJoin(data, start, end, node) {
    if (start > 0 && JOINER_RE.test(data.charAt(start - 1))) return true;
    if (end < data.length && JOINER_RE.test(data.charAt(end))) return true;
    if (start >= 2 && data.charAt(start - 1) === "." &&
        /[A-Za-z0-9]/.test(data.charAt(start - 2))) return true;
    if (end + 1 < data.length && data.charAt(end) === "." &&
        /[A-Za-z0-9]/.test(data.charAt(end + 1))) return true;
    // A word split by inline markup (un<em>believ</em>able): the rest of
    // the word sits in a neighbouring text node, possibly one element
    // away. Guessing would corrupt the word.
    if (start === 0) {
      const tail = edgeChar(node, "previousSibling", "last");
      if (tail && WORD_CHAR_RE.test(tail)) return true;
    }
    if (end === data.length) {
      const head = edgeChar(node, "nextSibling", "first");
      if (head && WORD_CHAR_RE.test(head)) return true;
    }
    return false;
  }

  /* The whole token containing character index `offset`, or null. Refused
   * when the target is outside the root, excluded, or not the whole word
   * inside one text node. */
  function hitAt(node, offset) {
    if (!root || !node || node.nodeType !== 3) return null;
    if (!root.contains(node)) return null;
    if (isExcluded(node)) return null;
    const data = node.data;
    if (typeof data !== "string" || !data) return null;
    if (offset < 0 || offset > data.length) return null;
    for (const m of data.matchAll(TOKEN_RE)) {
      const start = m.index;
      const end = start + m[0].length;
      if (offset < start || offset >= end) continue;
      if (m[0].length > MAX_WORD_LENGTH) return null;
      if (touchesJoin(data, start, end, node)) return null;
      return { node, start, end, word: m[0] };
    }
    return null;
  }

  /* --- loading ------------------------------------------------------ */

  // Every failure path lands here: the caller never sees a throw, the state
  // says the browser's spellcheck is in charge, and the next enter() retries.
  function fail(why, err) {
    dict = null;
    setLifecycle("failed");
    console.warn("spellcheck: " + why, err || "");
  }

  function load() {
    setLifecycle("loading");
    if (!NB.lazyload || !NB.lazyload.scripts) {
      fail("no script loader");
      return;
    }
    NB.lazyload.scripts([VENDOR_SCRIPT])
      .then(() => Promise.all([
        fetchText(AFF_PATH),
        fetchText(DIC_PATH),
        fetchText(SOFTWARE_TERMS_PATH),
      ]))
      .then((data) => {
        if (typeof window.Typo !== "function") {
          throw new Error("window.Typo is missing after " + VENDOR_SCRIPT);
        }
        const instance = new window.Typo(DICTIONARY_LANG, data[0], data[1]);
        if (!instance || !instance.loaded) {
          throw new Error("the dictionary did not parse");
        }
        dict = instance;
        softwareTerms = parseTerms(data[2]);
        setLifecycle("ready");
      })
      .catch((err) => {
        fail("the dictionary could not be loaded", err);
      })
      .then(() => {
        // Paint whatever is on screen now; the load settles after enter().
        if (root) refresh();
      });
  }

  function fetchText(path) {
    return fetch(path).then((res) => {
      if (!res.ok) {
        throw new Error("could not fetch " + path + " (" + res.status + ")");
      }
      return res.text();
    });
  }

  /* One word per line, `#` comments; the list is a membership set, it never
   * produces suggestions. */
  function parseTerms(text) {
    const set = new Set();
    for (const line of String(text || "").split("\n")) {
      const word = line.trim().toLowerCase();
      if (!word || word.charAt(0) === "#") continue;
      set.add(word);
    }
    return set;
  }

  /* Every token this note already uses as code is one of its terms. The
   * walk is over the excluded subtrees only (code, fences, plugin cards). */
  function collectCodeVocab() {
    codeVocab = new Set();
    if (!root) return;
    const walker = document.createTreeWalker(root, SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      if (isExcluded(node) && typeof node.data === "string") {
        for (const m of node.data.matchAll(TOKEN_RE)) {
          codeVocab.add(m[0].toLowerCase());
        }
      }
      node = walker.nextNode();
    }
  }

  /* --- refresh and paint -------------------------------------------- */

  function cancelRefresh() {
    if (refreshTimer != null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (idleHandle != null) {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      idleHandle = null;
    }
  }

  function clearHighlight() {
    const registry = highlightRegistry();
    if (registry) registry.delete(HIGHLIGHT_NAME);
  }

  function collectRanges(node, skip, out) {
    const data = node.data;
    if (typeof data !== "string" || !data) return;
    for (const m of data.matchAll(TOKEN_RE)) {
      const word = m[0];
      const start = m.index;
      const end = start + word.length;
      if (word.length > MAX_WORD_LENGTH) continue;
      if (touchesJoin(data, start, end, node)) continue;
      const key = fold(word).toLowerCase();
      if (skip.has(key)) continue;
      if (isKnownWord(word)) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      out.push(range);
    }
  }

  function paint() {
    if (!root || lifecycle !== "ready") return;
    const registry = highlightRegistry();
    if (!registry || typeof window.Highlight !== "function") return;
    if (!enabled()) { clearHighlight(); return; }
    collectCodeVocab();
    const skip = new Set(sessionIgnored);
    for (const w of personalWords()) skip.add(w);
    const ranges = [];
    const walker = document.createTreeWalker(root, SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      if (!isExcluded(node)) collectRanges(node, skip, ranges);
      node = walker.nextNode();
    }
    // Replace the entry, never append: the previous ranges point at nodes
    // an innerHTML replacement detached (invariant 3).
    if (!ranges.length) { clearHighlight(); return; }
    registry.set(HIGHLIGHT_NAME, new window.Highlight(...ranges));
  }

  function runPass() {
    try {
      paint();
    } catch (err) {
      clearHighlight();
      if (!passWarned) {
        passWarned = true;
        console.warn("spellcheck: the repaint failed", err);
      }
    }
  }

  /* --- public API --------------------------------------------------- */

  function state() {
    return lifecycle;
  }

  function enter(el) {
    if (!el) return;
    root = el;
    sessionIgnored.clear();
    passWarned = false;
    collectCodeVocab();
    // A browser without the highlight API loses the feature outright; the
    // browser's spellcheck stays on (§2.5).
    if (!hasHighlightApi()) {
      fail("this browser has no CSS Highlight API");
      return;
    }
    if (lifecycle === "ready") {
      refresh();
      return;
    }
    if (lifecycle === "loading") return;
    load();
  }

  function exit() {
    root = null;
    sessionIgnored.clear();
    cancelRefresh();
    clearHighlight();
  }

  function refresh(opts) {
    if (!root) return;
    if (opts && opts.immediate) {
      cancelRefresh();
      runPass();
      return;
    }
    cancelRefresh();
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(() => {
          idleHandle = null;
          runPass();
        });
        return;
      }
      runPass();
    }, REFRESH_DEBOUNCE_MS);
  }

  /* Resolve a pointer to the word under it. The caret APIs are the only
   * way to hit-test a text node; jsdom has neither, so this returns null. */
  function wordAtPoint(x, y) {
    if (!root) return null;
    let node = null;
    let offset = 0;
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (!range) return null;
      node = range.startContainer;
      offset = range.startOffset;
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      node = pos.offsetNode;
      offset = pos.offset;
    }
    return hitAt(node, offset);
  }

  /* The same hit from the selection anchor: the keyboard route
   * (Shift+F10 / the Menu key). */
  function wordAtCaret() {
    if (!root) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return hitAt(range.startContainer, range.startOffset);
  }

  /* true / false, or null when the dictionary is not ready or the word is
   * not checkable. A personal or ignored word is correct by definition. */
  function check(word) {
    if (lifecycle !== "ready" || !dict) return null;
    const w = fold(word).trim();
    if (!isCheckable(w)) return null;
    try {
      return isKnownWord(w);
    } catch (_) {
      return null;
    }
  }

  function suggest(word, n) {
    if (lifecycle !== "ready" || !dict) return [];
    const w = fold(word).trim();
    if (!isCheckable(w)) return [];
    const limit = (typeof n === "number" && n > 0)
      ? Math.min(Math.floor(n), MAX_SUGGESTIONS) : MAX_SUGGESTIONS;
    try {
      const out = dict.suggest(w, limit);
      return Array.isArray(out) ? out.slice(0, limit) : [];
    } catch (_) {
      return [];
    }
  }

  /* `Add to dictionary`: persist the word and hand the caret back. A failed
   * POST (app.js warns) leaves the word active for this session, because
   * cfg still carries it. */
  function addToDictionary(word, cb) {
    const w = fold(word).toLowerCase();
    if (NB.app && NB.app.getSpellcheckWords && NB.app.setSpellcheckWords) {
      const words = NB.app.getSpellcheckWords();
      if (words.indexOf(w) === -1) {
        words.push(w);
        NB.app.setSpellcheckWords(words);
      }
    } else {
      sessionIgnored.add(w);
    }
    refresh({ immediate: true });
    if (cb && typeof cb.done === "function") cb.done();
  }

  /* `Ignore`: session-scoped, cleared by exit(). */
  function ignoreWord(word, cb) {
    sessionIgnored.add(fold(word).toLowerCase());
    refresh({ immediate: true });
    if (cb && typeof cb.done === "function") cb.done();
  }

  /* Descriptors for the Spelling block, or [] when the hit is not a
   * misspelling the user can act on (docs/ui/spellcheck.md §2.1). */
  function menuItems(hit, cb) {
    if (!hit || !hit.word || lifecycle !== "ready") return [];
    // The switch is the user's verdict: off means no block anywhere, even on
    // the structural targets that still open the app menu.
    if (!enabled()) return [];
    if (check(hit.word) !== false) return [];
    const callbacks = cb || {};
    const items = [];
    const suggestions = suggest(hit.word, MAX_SUGGESTIONS);
    if (suggestions.length) {
      for (const word of suggestions) {
        items.push({
          label: word,
          handler: () => {
            if (typeof callbacks.pick === "function") callbacks.pick(word);
          },
        });
      }
    } else {
      items.push({ label: "No spelling suggestions", disabled: true });
    }
    items.push({ separator: true });
    items.push({
      label: "Add to dictionary",
      handler: () => addToDictionary(hit.word, callbacks),
    });
    items.push({
      label: "Ignore",
      handler: () => ignoreWord(hit.word, callbacks),
    });
    items.push({ separator: true });
    return items;
  }

  NB.spellcheck = {
    state,
    enter,
    exit,
    refresh,
    wordAtPoint,
    wordAtCaret,
    check,
    suggest,
    menuItems,
  };
})();
