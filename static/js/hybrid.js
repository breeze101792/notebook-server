/* hybrid.js -- WYSIWYG ("hybrid") edit mode.
 *
 * A third editing mode that sits on top of the existing preview/edit
 * duality. When the user clicks the ✎ button in the top bar while in
 * preview mode, #viewer-content becomes contentEditable and the user
 * can edit the rendered Markdown directly -- like a word processor.
 * The edit bar appears so formatting buttons work; Save commits the
 * DOM back to Markdown source via TurndownService.
 *
 * Relationship to viewer.js:
 *   - viewer.js owns the cache entry { content, editMode, savedContent }.
 *   - hybrid.js does NOT replace editMode; it layers on top of preview
 *     mode. When hybrid is on, the file is NOT in viewer's editMode;
 *     instead hybrid.js owns a parallel "hybridMode" flag on the cache
 *     entry. This keeps the viewer's save/close/dirty logic intact and
 *     avoids touching the CM6 pipeline.
 *   - The dirty state is computed by comparing the current DOM (via
 *     turndown) to savedContent, so isDirty() in viewer.js stays
 *     accurate only for the CM6 path. hybrid.js exposes its own
 *     isHybridDirty() and the Save button is wired here.
 *
 * Data flow:
 *   enter() -> render markdown into #viewer-content (same as preview)
 *              -> make #viewer-content contentEditable
 *              -> show edit bar (formatting buttons operate on the DOM)
 *   exit()  -> turndown DOM -> markdown string
 *              -> save or discard
 *              -> remove contentEditable, re-render as normal preview
 *   save()  -> turndown DOM -> markdown string
 *              -> NB.api.saveFile(path, md)
 *              -> update cache entry's content + savedContent
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const viewerContentEl = document.getElementById("viewer-content");
  const viewerEl       = document.getElementById("viewer");
  const editBar        = document.getElementById("edit-bar");
  const hybridBtn      = document.getElementById("hybrid-toggle");
  const saveBtn        = document.getElementById("save-btn");
  const saveExitBtn    = document.getElementById("save-exit-btn");
  const closeEditBtn   = document.getElementById("close-edit-btn");
  const topbar         = document.getElementById("topbar");
  const menuEl         = document.getElementById("hybrid-context-menu");

  let active = false;       // hybrid mode currently on
  let activePath = null;    // path of the file being hybrid-edited
  let turndownSvc = null;   // lazily created TurndownService instance
  let savedRange = null;    // caret range captured when the context menu opens

  function ensureTurndown() {
    if (turndownSvc) return turndownSvc;
    if (!window.TurndownService) return null;
    turndownSvc = new window.TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      strongDelimiter: "**",
      linkStyle: "inlined",
    });
    if (window.TurndownPluginGfm && window.TurndownPluginGfm.gfm) {
      turndownSvc.use(window.TurndownPluginGfm.gfm);
    }
    // Round-trip [[wikilinks]]: viewer.js renders them as
    // <a data-wikilink>. Without this rule turndown would emit a normal
    // [text](href) link; with it, the original [[Target|label]] form is
    // preserved so a WYSIWYG edit doesn't rewrite internal links.
    turndownSvc.addRule("wikilink", {
      filter: (node) =>
        node.nodeName === "A" && node.getAttribute("data-wikilink") === "1",
      replacement: (content, node) => {
        const target = node.getAttribute("href") || "";
        return "[[" + target + (content === target ? "" : "|" + content) + "]]";
      },
    });
    // Preserve blank lines. Turndown's default `blank` rule drops empty
    // paragraphs entirely (it matches any element with no text content),
    // so blank lines the user adds in hybrid mode would silently vanish
    // on save. Two changes:
    //   1. Exclude <p> AND <div> from the `blank` rule so empty blocks
    //      aren't swallowed before the paragraph rule sees them. (<div>
    //      matters because a real browser's contentEditable inserts
    //      <div><br></div> when the user presses Enter, even when the
    //      surrounding content is <p>-based.)
    //   2. Override the `paragraph` rule for both tags. An empty block
    //      (only <br> or whitespace) emits an explicit <p><br></p> HTML
    //      line rather than bare newlines, for two reasons:
    //        - turndown's join() collapses consecutive "\n\n" outputs,
    //          so N blank lines would collapse into one;
    //        - marked collapses consecutive blank lines when rendering,
    //          so the space would visually disappear on reopen anyway.
    //      <p><br></p> is passed through by marked as an HTML block, so
    //      the empty line renders, survives save, and round-trips
    //      stably (empty block -> <p><br></p> -> renders as empty block).
    turndownSvc.addRule("blank", {
      filter(node) {
        if (node.nodeName === "P" || node.nodeName === "DIV") return false;
        return ["A", "IFRAME", "OBJECT", "EMBED", "IMG", "BR", "HR",
                "INPUT", "TEXTAREA", "SELECT", "BUTTON"].indexOf(node.nodeName) === -1 &&
               !node.textContent.trim();
      },
      replacement: () => "",
    });
    turndownSvc.addRule("paragraph", {
      filter: ["p", "div"],
      replacement(content, node) {
        if (!node.textContent.trim()) return "\n\n<p><br></p>\n\n";
        return "\n\n" + content + "\n\n";
      },
    });
    return turndownSvc;
  }

  function isActive() { return active; }

  /* --- DOM <-> Markdown helpers ----------------------------------- */

  /* Convert the current #viewer-content DOM back to a Markdown string.
   * We clone the node so turndown's DOM mutation doesn't affect the
   * live element. Strip copy buttons (they are injected by viewer.js
   * and are not part of the content). */
  function domToMarkdown() {
    const td = ensureTurndown();
    if (!td) return "";
    const clone = viewerContentEl.cloneNode(true);
    // Remove injected copy buttons so they don't appear in the output.
    clone.querySelectorAll(".code-copy-btn").forEach((b) => b.remove());
    // Restore mermaid diagrams: replace each .mermaid-container (which
    // holds a rendered SVG) with a <pre><code class="language-mermaid">
    // block containing the original source, so turndown produces a
    // ```mermaid fenced block instead of stripping the SVG to text.
    clone.querySelectorAll(".mermaid-container").forEach((c) => {
      const src = c.dataset.mermaidSource || "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-mermaid";
      code.textContent = src;
      pre.appendChild(code);
      c.replaceWith(pre);
    });
    // Also restore mermaid error blocks (.mermaid-error) the same way,
    // using the .mermaid-source <pre> inside them.
    clone.querySelectorAll(".mermaid-error").forEach((e) => {
      const srcEl = e.querySelector(".mermaid-source");
      const src = srcEl ? srcEl.textContent : "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-mermaid";
      code.textContent = src;
      pre.appendChild(code);
      e.replaceWith(pre);
    });
    // Same round-trip for WaveDrom waveform diagrams: replace each
    // .wavedrom-container (a rendered SVG) and .wavedrom-error box with a
    // <pre><code class="language-wavedrom"> of the original source so
    // turndown produces a ```wavedrom fenced block instead of stripping
    // the SVG to text.
    clone.querySelectorAll(".wavedrom-container").forEach((c) => {
      const src = c.dataset.wavedromSource || "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-wavedrom";
      code.textContent = src;
      pre.appendChild(code);
      c.replaceWith(pre);
    });
    clone.querySelectorAll(".wavedrom-error").forEach((e) => {
      const srcEl = e.querySelector(".wavedrom-source");
      const src = srcEl ? srcEl.textContent : "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-wavedrom";
      code.textContent = src;
      pre.appendChild(code);
      e.replaceWith(pre);
    });
    // Same round-trip for KaTeX math: replace each .katex-container (a
    // typeset equation) and .katex-error box with a <pre><code
    // class="language-math"> of the original source so turndown produces
    // a ```math fenced block instead of stripping the HTML to text.
    clone.querySelectorAll(".katex-container").forEach((c) => {
      const src = c.dataset.katexSource || "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-math";
      code.textContent = src;
      pre.appendChild(code);
      c.replaceWith(pre);
    });
    clone.querySelectorAll(".katex-error").forEach((e) => {
      const srcEl = e.querySelector(".katex-source");
      const src = srcEl ? srcEl.textContent : "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-math";
      code.textContent = src;
      pre.appendChild(code);
      e.replaceWith(pre);
    });
    // Same round-trip for Graphviz diagrams: replace each .viz-container
    // (a rendered SVG) and .viz-error box with a <pre><code
    // class="language-dot"> of the original source so turndown produces a
    // ```dot fenced block instead of stripping the SVG to text.
    clone.querySelectorAll(".viz-container").forEach((c) => {
      const src = c.dataset.vizSource || "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-dot";
      code.textContent = src;
      pre.appendChild(code);
      c.replaceWith(pre);
    });
    clone.querySelectorAll(".viz-error").forEach((e) => {
      const srcEl = e.querySelector(".viz-source");
      const src = srcEl ? srcEl.textContent : "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-dot";
      code.textContent = src;
      pre.appendChild(code);
      e.replaceWith(pre);
    });
    // Turndown's bundled postProcess() trims trailing whitespace from
    // its final output, which would silently drop blank lines the user
    // added at the end of a note (whether they live in <p>, <div>, or
    // bare <br> elements -- a real browser's contentEditable produces
    // all three). postProcess is a module-scoped closure that cannot be
    // overridden on the instance, so instead append a non-whitespace
    // sentinel text node as the clone's LAST child: the trim then can't
    // eat anything before it. Run the conversion, cut the sentinel off.
    const SENTINEL = "\u0000nbsave";
    clone.appendChild(document.createTextNode(SENTINEL));
    let md = td.turndown(clone);
    const cut = md.indexOf(SENTINEL);
    if (cut >= 0) md = md.slice(0, cut);
    return md;
  }

  /* Re-render Markdown into #viewer-content (same pipeline as
   * viewer.js's render, minus the outline/scroll-sync setup which the
   * viewer already owns). We call NB.viewer's internal render by
   * emitting a file:open event which causes a re-activate; but simpler:
   * we just set innerHTML via marked directly, then post-process. */
  function renderMarkdown(md) {
    if (!window.marked) return;
    viewerContentEl.innerHTML = marked.parse(md, { gfm: true, breaks: false });
    viewerContentEl.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      // Reuse viewer's slugify for heading id consistency.
      if (NB.slugify) h.id = NB.slugify(h.textContent);
    });
    if (window.hljs) {
      viewerContentEl.querySelectorAll("pre code").forEach((el) => {
        try { hljs.highlightElement(el); } catch (_) {}
      });
    }
    if (NB.mermaid && NB.mermaid.renderAll) {
      NB.mermaid.renderAll(viewerContentEl);
    }
    if (NB.wavedrom && NB.wavedrom.renderAll) {
      NB.wavedrom.renderAll(viewerContentEl);
    }
    if (NB.katex && NB.katex.renderAll) {
      NB.katex.renderAll(viewerContentEl);
    }
    if (NB.viz && NB.viz.renderAll) {
      NB.viz.renderAll(viewerContentEl);
    }
    // Make task-list checkboxes interactive: marked renders them
    // disabled, so remove the disabled flag so the user can click to
    // toggle. The click handler below flips `checked` and marks dirty;
    // turndown then emits [x]/[ ] on save.
    enableCheckboxes();
  }

  /* --- edit bar integration -------------------------------------- */

  /* The edit bar's buttons (editbar.js) talk to NB.cmEditor, which is
   * the CodeMirror bridge. In hybrid mode there is no CM editor -- the
   * user is editing the DOM directly. We intercept the edit bar clicks
   * and run document.execCommand formatting instead, which is the
   * classic contentEditable approach and works well for inline
   * formatting (bold, italic, etc.). Line-level actions (headings,
   * lists) are handled by toggling the semantic element. */
  function execCommand(cmd, value) {
    try { document.execCommand(cmd, false, value); }
    catch (_) { /* jsdom / browsers without execCommand -- no-op */ }
    viewerContentEl.focus();
    onContentChange();
  }

  /* Wrap the selection in an element with the given tag. Used for
   * headings (h1-h6) and blockquote. Operates on the current selection
   * inside #viewer-content. Returns the element the block became
   * (the new tag, or the <p> it toggled back to). */
  function wrapBlock(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let range = sel.getRangeAt(0);
    // Expand to the whole block (the nearest block ancestor).
    let block = range.commonAncestorContainer;
    if (block.nodeType === Node.TEXT_NODE) block = block.parentElement;
    while (block && block !== viewerContentEl) {
      const display = window.getComputedStyle(block).display;
      if (display === "block" || /^(H[1-6]|P|UL|OL|BLOCKQUOTE|PRE|LI)$/.test(block.tagName)) break;
      block = block.parentElement;
    }
    if (!block || block === viewerContentEl) return null;
    // Toggle: if already this tag, convert back to <p>.
    let made = null;
    if (block.tagName === tag.toUpperCase()) {
      const p = document.createElement("p");
      while (block.firstChild) p.appendChild(block.firstChild);
      block.replaceWith(p);
      made = p;
    } else {
      const el = document.createElement(tag);
      while (block.firstChild) el.appendChild(block.firstChild);
      block.replaceWith(el);
      made = el;
    }
    onContentChange();
    return made;
  }

  /* Toggle a list type on the current block. Creates a <ul>/<ol> if
   * the block isn't already a list, or converts between ul/ol. Returns
   * the list element created/toggled (null when nothing changed). */
  function toggleList(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let block = sel.getRangeAt(0).commonAncestorContainer;
    if (block.nodeType === Node.TEXT_NODE) block = block.parentElement;
    while (block && block !== viewerContentEl) {
      if (/^(P|UL|OL|LI|DIV)$/.test(block.tagName)) break;
      block = block.parentElement;
    }
    if (!block || block === viewerContentEl) return null;
    let made = null;
    // Find the nearest list ancestor.
    let listAncestor = block.closest("ul,ol");
    if (listAncestor && listAncestor !== viewerContentEl) {
      if (listAncestor.tagName === tag.toUpperCase()) {
        // Convert list to paragraphs.
        const items = Array.from(listAncestor.querySelectorAll("li"));
        items.forEach((li) => {
          const p = document.createElement("p");
          while (li.firstChild) p.appendChild(li.firstChild);
          li.replaceWith(p);
        });
        // Unwrap the list.
        while (listAncestor.firstChild) listAncestor.parentNode.insertBefore(listAncestor.firstChild, listAncestor);
        listAncestor.remove();
      } else {
        // Convert ul <-> ol.
        const newList = document.createElement(tag);
        while (listAncestor.firstChild) newList.appendChild(listAncestor.firstChild);
        listAncestor.replaceWith(newList);
        made = newList;
      }
    } else {
      // Create a new list from the current paragraph.
      const li = document.createElement("li");
      const list = document.createElement(tag);
      while (block.firstChild) li.appendChild(block.firstChild);
      list.appendChild(li);
      block.replaceWith(list);
      made = list;
    }
    onContentChange();
    return made;
  }

  /* --- live markdown input rules ------------------------------------ */
  /* Typora-style live syntax: the user types raw markdown (### , - ,
   * > , 1. , [ ] , **bold**) inside the contentEditable and it becomes
   * the rendered element immediately, instead of surviving as literal
   * "#"-text that turndown then escapes on save. Runs synchronously on
   * every input event; each rule is a cheap caret-text regex test.
   *
   * BLOCK rules fire only when the paragraph consists of exactly the
   * trigger text (typed into an empty block) -- never mid-paragraph,
   * where "#" may be real content. INLINE rules fire on the closing
   * delimiter of an emphasized span inside one text node. */

  function caretContext() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    let block = range.startContainer;
    if (block.nodeType === Node.TEXT_NODE) block = block.parentElement;
    if (!block || !viewerContentEl.contains(block)) return null;
    const blockEl = block.closest(
      "p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,div");
    if (!blockEl || !viewerContentEl.contains(blockEl)) return null;
    return { sel, range, blockEl };
  }

  /* Text from the block's start up to the caret. */
  function textBeforeCaret(blockEl, range) {
    const r = document.createRange();
    r.selectNodeContents(blockEl);
    r.setEnd(range.startContainer, range.startOffset);
    // Browsers type \u00A0 (non-breaking space) inside contentEditable
    // instead of a plain space; normalize so the rule patterns match.
    return r.toString().replace(/\u00A0/g, " ");
  }

  /* Delete the first `len` characters of a block's text content
   * (the trigger text) and leave the caret where it lands. Only used on
   * blocks whose entire text is the trigger, so the walk is short. */
  function deleteBlockPrefix(blockEl, len) {
    let remaining = len;
    const walker = document.createTreeWalker(
      blockEl, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (remaining <= 0) break;
      if (n.nodeValue.length <= remaining) {
        remaining -= n.nodeValue.length;
        n.remove();
      } else {
        n.nodeValue = n.nodeValue.slice(remaining);
        remaining = 0;
      }
    }
  }

  /* Put the caret at the start of `el`'s editable content (after a
   * block transform the selection is often stale). An empty block gets
   * a <br> line box first: without it Chrome has no line to attach the
   * caret to and draws it on the neighboring line instead. */
  function caretToStart(el) {
    if (!el) return;
    if (!el.textContent && !el.querySelector("img,br,canvas,svg,iframe")) {
      el.appendChild(document.createElement("br"));
    }
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  const INPUT_RULES = [
    { re: /^(#{1,6}) $/, apply: (m) => {
      const made = wrapBlock("h" + m[1].length);
      if (made) caretToStart(made);
    } },
    { re: /^(-|\*) $/, apply: () => {
      const made = toggleList("ul");
      if (made) {
        const li = made.querySelector("li");
        if (li) caretToStart(li);
      }
    } },
    { re: /^\d+\. $/, apply: () => {
      const made = toggleList("ol");
      if (made) {
        const li = made.querySelector("li");
        if (li) caretToStart(li);
      }
    } },
    { re: /^> $/, apply: () => {
      const made = wrapBlock("blockquote");
      if (made) caretToStart(made);
    } },
    { re: /^\[([ xX])\] $/, apply: (m) => {
      // Task item: same DOM shape marked produces so turndown's gfm
      // taskListItems rule round-trips it ([x]/[ ]).
      const made = toggleList("ul");
      const li = made && made.querySelector("li");
      if (li) {
        li.classList.add("task-list-item");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = m[1] !== " ";
        li.insertBefore(cb, li.firstChild);
        caretToStart(li);
      }
    } },
  ];

  /* One inline rule set: the pattern must end exactly at the caret and
   * live inside a single text node. `tag` is the element to produce. */
  const INLINE_RULES = [
    { re: /\*\*([^\s*][^*]*?)\*\*$/, tag: "strong" },
    { re: /(?<!\*)\*([^*\s][^*]*?)\*(?!\*)$/, tag: "em" },
    { re: /~~([^~]+)~~$/, tag: "del" },
    { re: /`([^`]+)`$/, tag: "code" },
  ];

  function applyBlockRules() {
    const ctx = caretContext();
    if (!ctx) return false;
    const { blockEl, range, sel } = ctx;
    // Only plain paragraphs convert (never inside lists, headings,
    // blockquotes, code blocks -- those are already formatted).
    if (blockEl.tagName !== "P" && blockEl.tagName !== "DIV") return false;
    // The trigger must be at the very start of the line; whatever text
    // follows the caret (or before it on the same line) is preserved and
    // becomes the content of the new element.
    const before = textBeforeCaret(blockEl, range);
    for (const rule of INPUT_RULES) {
      const m = before.match(rule.re);
      if (!m) continue;
      deleteBlockPrefix(blockEl, m[0].length);
      // Re-anchor the caret INSIDE this block before the transform:
      // deleteBlockPrefix removed the text nodes holding the selection,
      // and the helpers below (wrapBlock/toggleList) operate on wherever
      // the browser dropped the caret -- often the NEXT line. Anchoring
      // here keeps both the transform and the final caret on this block.
      const r = document.createRange();
      r.selectNodeContents(blockEl);
      r.collapse(false);   // end of the (now trigger-less) block
      sel.removeAllRanges();
      sel.addRange(r);
      rule.apply(m);
      onContentChange();
      return true;
    }
    return false;
  }

  function applyInlineRules() {
    const ctx = caretContext();
    if (!ctx) return false;
    const { range, sel } = ctx;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    const text = node.nodeValue.slice(0, range.startOffset);
    for (const rule of INLINE_RULES) {
      const m = text.match(rule.re);
      if (!m) continue;
      const inner = m[1];
      const after = node.nodeValue.slice(range.startOffset);
      const before = node.nodeValue.slice(0, text.length - m[0].length);
      const el = document.createElement(rule.tag);
      el.textContent = inner;
      node.nodeValue = before;
      const parent = node.parentElement;
      if (!parent) return false;
      const marker = document.createTextNode("");
      parent.insertBefore(marker, node.nextSibling);
      parent.insertBefore(el, marker);
      parent.insertBefore(document.createTextNode(after), marker);
      marker.remove();
      // Caret just after the new element.
      const r = document.createRange();
      r.setStartAfter(el);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      onContentChange();
      return true;
    }
    return false;
  }

  function applyInputRules() {
    if (!active) return;
    if (applyBlockRules()) return;
    applyInlineRules();
  }

  /* --- inline-format shortcuts --------------------------------------- */
  /* Toggle bold/italic/strike/inline-code on the current selection with
   * the keyboard (Ctrl/Cmd+B / I / Shift+X / Shift+C). DOM-based, not
   * execCommand, so it behaves identically in every browser: if the
   * selection is inside a matching element it UNWRAPS (toggle off),
   * otherwise it WRAPS the selection contents in the element. With a
   * collapsed caret an empty element is created and the caret placed
   * inside, so the next typed characters are styled (Typora behavior).
   * Chords are chosen to avoid the app's global bindings (Mod+E is
   * toggleEdit, so inline code uses Mod+Shift+C). */
  function toggleInline(tag) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    if (!viewerContentEl.contains(sel.anchorNode)) return;
    if (!viewerContentEl.contains(sel.focusNode)) return;
    const range = sel.getRangeAt(0);
    // Closest matching ancestor of the selection's start, but never the
    // editor root itself.
    const startEl = (sel.anchorNode.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement : sel.anchorNode);
    const inside = (startEl && startEl !== viewerContentEl)
      ? startEl.closest(tag) : null;
    const wrapAncestor = (inside && inside !== viewerContentEl &&
      viewerContentEl.contains(inside)) ? inside : null;
    if (range.collapsed && !wrapAncestor) {
      // Caret with no selection: create the empty element so the next
      // typed text is styled. The inline input rules will keep the
      // caret sensible.
      const el = document.createElement(tag);
      const marker = document.createTextNode("");
      range.insertNode(el);
      el.appendChild(marker);
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      onContentChange();
      return;
    }
    if (wrapAncestor) {
      // Toggle OFF: unwrap the ancestor of the selection. Clear the
      // selection FIRST: its live Range points into nodes that are
      // about to move, and both jsdom and (as caret glitches) real
      // browsers misbehave when a selected node is detached mid-flight.
      const parent = wrapAncestor.parentNode;
      if (!parent) return;
      const first = wrapAncestor.firstChild;
      const last = wrapAncestor.lastChild;
      sel.removeAllRanges();
      while (wrapAncestor.firstChild) {
        parent.insertBefore(wrapAncestor.firstChild, wrapAncestor);
      }
      parent.removeChild(wrapAncestor);
      // Keep what the element wrapped selected, so a second toggle or
      // continued typing acts on the same text.
      const r3 = document.createRange();
      if (first && last) { r3.setStartBefore(first); r3.setEndAfter(last); }
      else r3.selectNodeContents(parent);
      sel.removeAllRanges();
      sel.addRange(r3);
      onContentChange();
      return;
    }
    if (range.collapsed) return;
    // Toggle ON: wrap the selection contents.
    const el = document.createElement(tag);
    try {
      range.surroundContents(el);
    } catch (_) {
      // Selection crosses block boundaries -- wrap the intersection in
      // each affected block instead of failing.
      const frag = range.extractContents();
      el.appendChild(frag);
      range.insertNode(el);
    }
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.addRange(r);
    onContentChange();
  }

  /* When the user clicks (mousedown) outside an actively-edited plugin
   * block, commit it back to preview mode.  This covers the case where
   * focus stays inside the same contentEditable tree (e.g. clicking a
   * sibling paragraph) and focusout never fires on the <pre>. */
  function onContentMouseDown(e) {
    if (!active) return;
    const editing = viewerContentEl.querySelector("pre.hybrid-plugin-editing");
    if (!editing) return;
    if (editing.contains(e.target)) return;          // click inside the block – let it handle itself
    editing.dispatchEvent(new FocusEvent("focusout", { relatedTarget: e.target, bubbles: true }));
  }

  /* Click-to-edit: in hybrid mode, a click on a rendered plugin block
   * (mermaid / wavedrom / katex / graphviz container or error box) or
   * a plain code fence swaps it straight into the editable source fence
   * with a language pill. Blur (or Esc) restores render mode. Clicks
   * inside a block that is already being edited are ignored (the code
   * and the language chip handle their own interaction). */
  function onBlockClick(e) {
    if (!active) return;
    if (e.target.closest(".hybrid-lang-pill")) return;
    if (e.target.closest("pre.hybrid-plugin-editing")) return;
    const hit = codeBlockAt(e.target);
    if (!hit) return;
    e.preventDefault();
    editPluginSource(hit);
  }

  /* keydown handler for hybrid mode: the markdown input rules that need
   * a key (``` + Enter, list outdent) plus the inline-format shortcuts. */
  function onEnterKey(e) {
    if (!active) return;
    // Inline-format shortcuts. Only when the caret/selection is inside
    // the contentEditable (checked inside toggleInline too, but skip
    // earlier when it clearly isn't ours).
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = (e.key || "").toLowerCase();
      if (!e.shiftKey && k === "b") {
        e.preventDefault();
        toggleInline("strong");
        return;
      }
      if (!e.shiftKey && k === "i") {
        e.preventDefault();
        toggleInline("em");
        return;
      }
      if (e.shiftKey && k === "x") {
        e.preventDefault();
        toggleInline("del");
        return;
      }
      if (e.shiftKey && k === "c") {
        e.preventDefault();
        toggleInline("code");
        return;
      }
    }
    const ctx = caretContext();
    if (!ctx) return;
    const { blockEl, range } = ctx;
    // ``` + Enter -> code block.
    if ((blockEl.tagName === "P" || blockEl.tagName === "DIV") &&
        /^```[^\n]*$/.test(blockEl.textContent.trim())) {
      e.preventDefault();
      const m = blockEl.textContent.trim().match(/^```(.*)$/);
      const lang = m ? m[1].trim() : "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (lang) code.className = "language-" + lang;
      pre.appendChild(code);
      blockEl.replaceWith(pre);
      caretToStart(code);
      onContentChange();
      return;
    }
    // Empty list item -> outdent to a paragraph.
    const li = blockEl.closest("li");
    if (li && li.textContent.trim() === "") {
      e.preventDefault();
      const list = li.closest("ul,ol");
      if (list) {
        const p = document.createElement("p");
        const atEnd = list.lastElementChild === li;
        if (atEnd) {
          list.after(p);
          li.remove();
          if (!list.firstElementChild) list.remove();
        } else {
          // Split the list and drop the empty item between.
          const rest = document.createElement(list.tagName);
          let cur = li.nextElementSibling;
          while (cur) { const nx = cur.nextElementSibling; rest.appendChild(cur); cur = nx; }
          list.after(p, rest);
          li.remove();
          if (!list.firstElementChild) list.remove();
        }
        caretToStart(p);
        onContentChange();
      }
    }
  }

  /* The edit bar click handler. We intercept clicks that would normally
   * go to NB.cmEditor and redirect them to DOM operations. */
  function onEditBarClick(e) {
    if (!active) return;
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    switch (act) {
      case "bold":   execCommand("bold"); break;
      case "italic": execCommand("italic"); break;
      case "strike": execCommand("strikeThrough"); break;
      case "code":   execCommand("code"); break;  // inline code via execCommand may be limited
      case "h1":     wrapBlock("h1"); break;
      case "h2":     wrapBlock("h2"); break;
      case "h3":     wrapBlock("h3"); break;
      case "h4":     wrapBlock("h4"); break;
      case "h5":     wrapBlock("h5"); break;
      case "h6":     wrapBlock("h6"); break;
      case "ul":     toggleList("ul"); break;
      case "ol":     toggleList("ol"); break;
      case "quote":  wrapBlock("blockquote"); break;
      case "link": {
        const url = prompt("Link URL:", "https://");
        if (url) execCommand("createLink", url);
        break;
      }
      case "image": {
        const url = prompt("Image URL:", "https://");
        if (url) execCommand("insertImage", url);
        break;
      }
      case "codeblock": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        const sel = window.getSelection();
        const text = sel && sel.rangeCount ? sel.toString() : "code";
        code.textContent = text;
        pre.appendChild(code);
        document.execCommand("insertHTML", false, pre.outerHTML);
        onContentChange();
        break;
      }
      case "hr": {
        const hr = document.createElement("hr");
        document.execCommand("insertHTML", false, hr.outerHTML);
        onContentChange();
        break;
      }
      case "table": {
        const html = '<table><thead><tr><th>Column 1</th><th>Column 2</th></tr></thead>' +
          '<tbody><tr><td>cell</td><td>cell</td></tr></tbody></table>';
        document.execCommand("insertHTML", false, html);
        onContentChange();
        break;
      }
      case "table-menu": {
        const menu = document.querySelector(".eb-table-menu");
        if (menu) menu.hidden = !menu.hidden;
        break;
      }
      case "table-row-above": {
        const row = getRowFromSelection();
        if (row) insertRow(row, "above");
        break;
      }
      case "table-row-below": {
        const row = getRowFromSelection();
        if (row) insertRow(row, "below");
        break;
      }
      case "table-row-delete": {
        const row = getRowFromSelection();
        if (row) deleteRow(row);
        break;
      }
      case "table-col-left": {
        const cell = getCellFromSelection();
        if (cell) insertCol(cell, "left");
        break;
      }
      case "table-col-right": {
        const cell = getCellFromSelection();
        if (cell) insertCol(cell, "right");
        break;
      }
      case "table-col-delete": {
        const cell = getCellFromSelection();
        if (cell) deleteCol(cell);
        break;
      }
      case "table-header": {
        const table = getTableFromSelection();
        if (table) toggleHeaderRow(table);
        break;
      }
      case "table-delete": {
        const table = getTableFromSelection();
        if (table) deleteTable(table);
        break;
      }
      case "undo": execCommand("undo"); break;
      case "redo": execCommand("redo"); break;
      case "clear": {
        // Strip formatting from selection.
        execCommand("removeFormat");
        break;
      }
      // Save / Close / Preview are handled by their own listeners.
    }
  }

  /* Copy the current selection to the clipboard. Tries the async
   * Clipboard API first (navigator.clipboard.writeText), falling back
   * to document.execCommand("copy"). Either way the user's selection
   * stays intact so a subsequent Paste re-inserts at the cursor. */
  async function doCopy() {
    const sel = window.getSelection();
    const text = sel && sel.rangeCount ? sel.toString() : "";
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); }
      catch (_) { try { document.execCommand("copy"); } catch (__) {} }
    } else {
      try { document.execCommand("copy"); } catch (_) {}
    }
    viewerContentEl.focus();
  }

  /* Paste from the clipboard at the caret. Uses document.execCommand
   * ("paste") synchronously so it runs inside the user-gesture (the
   * menu click) and the browser pastes natively without a permission
   * prompt. We deliberately do NOT fall back to the async Clipboard
   * API here: navigator.clipboard.readText() loses the user-gesture
   * context and triggers a browser permission prompt. */
  function doPaste() {
    restoreCaret();
    try { document.execCommand("paste"); } catch (_) {}
    onContentChange();
  }

  /* Paste from the clipboard as plain text, stripping any formatting.
   * Triggers a native paste via execCommand("paste") (runs in the user
   * gesture, no permission prompt) but intercepts the resulting paste
   * event and inserts only the plain-text representation, so rich HTML
   * (bold, links, etc.) never survives. */
  function doPastePlain() {
    restoreCaret();
    const handler = (e) => {
      e.preventDefault();
      const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
      if (text) insertTextAtCaret(text);
      onContentChange();
      viewerContentEl.removeEventListener("paste", handler);
    };
    viewerContentEl.addEventListener("paste", handler);
    try { document.execCommand("paste"); } catch (_) {}
  }

  /* Insert `text` as a plain text node at the caret, then place the
   * caret AFTER the inserted text. We can't use setStartAfter(node)
   * directly because browsers merge an adjacent text node, detaching
   * `node` and breaking the range. Instead we locate the text node that
   * now holds the end of the range and set the caret to its end. */
  function insertTextAtCaret(text) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    // After insertNode the range's end sits at the end of the inserted
    // text. If the browser merged adjacent text nodes, `node` is detached
    // and the endContainer is the parent element; find the text node at
    // endOffset - 1 and place the caret at its end.
    const endContainer = range.endContainer;
    const endOffset = range.endOffset;
    let caretNode = endContainer;
    let caretOffset = endOffset;
    if (endContainer.nodeType === Node.ELEMENT_NODE) {
      const child = endContainer.childNodes[endOffset - 1];
      if (child && child.nodeType === Node.TEXT_NODE) {
        caretNode = child;
        caretOffset = child.textContent.length;
      }
    }
    const newRange = document.createRange();
    newRange.setStart(caretNode, caretOffset);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  /* Restore focus + the caret captured when the context menu opened,
   * so a paste lands at the right-click position. Clicking a menu item
   * moves focus to the button, which would otherwise lose the caret. */
  function restoreCaret() {
    viewerContentEl.focus();
    const sel = window.getSelection();
    if (savedRange) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  /* --- dirty tracking -------------------------------------------- */

  let dirty = false;
  function onContentChange() {
    dirty = true;
    saveBtn.hidden = false;
    closeEditBtn.classList.add("unsaved");
    NB.evt.emit("viewer:dirty-changed", { path: activePath, dirty: true });
  }

  function isDirty() { return dirty; }

  /* Reset dirty after save. */
  function resetDirty() {
    dirty = false;
    saveBtn.hidden = true;
    closeEditBtn.classList.remove("unsaved");
    NB.evt.emit("viewer:dirty-changed", { path: activePath, dirty: false });
  }

  /* --- input listener -------------------------------------------- */

  let inputDebounce = null;
  function onInput() {
    // contentEditable fires 'input' on every keystroke; we just mark dirty.
    // Live markdown input rules run first (they mutate the DOM and move
    // the caret, and themselves mark dirty on success).
    applyInputRules();
    clearTimeout(inputDebounce);
    inputDebounce = setTimeout(onContentChange, 50);
  }

  /* Toggle task-list checkboxes on click. marked renders them disabled;
   * we re-enable them in renderMarkdown and let the browser handle the
   * native toggle. The `change` event fires after the native toggle, so
   * we just mark dirty there. Turndown picks up the new state on save
   * ([x]/[ ]). */
  function onCheckboxChange(e) {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    onContentChange();
  }

  /* Re-enable task-list checkboxes in the current DOM. marked renders
   * them with the disabled attribute; hybrid mode needs them clickable.
   * Called on enter (the DOM is already rendered by viewer.js) and after
   * any re-render. */
  function enableCheckboxes() {
    viewerContentEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.removeAttribute("disabled");
    });
  }

  /* --- public API ------------------------------------------------- */

  async function enter(path) {
    if (active) return;
    const t = NB.viewer && NB.viewer.getPath ? null : null;
    // Get the current file's content from the viewer cache.
    activePath = path || (NB.viewer && NB.viewer.getPath ? NB.viewer.getPath() : null);
    if (!activePath) return;
    active = true;
    dirty = false;

    // Make the viewer content editable.
    viewerContentEl.setAttribute("contenteditable", "true");
    // Make Enter produce <p> blocks (matching the rendered structure)
    // instead of the browser default <div>. Blank <p> blocks round-trip
    // to markdown blank lines on save; <div>s are handled too, but <p>
    // keeps the DOM consistent with what marked rendered.
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch (_) {}
    viewerContentEl.classList.add("hybrid-editing");
    viewerEl.classList.add("hybrid-active");
    topbar.classList.add("editing");
    hybridBtn.classList.add("active");

    // Show the edit bar (without entering CM6 edit mode).
    if (NB.editbar) NB.editbar.show();
    // Hide the Preview button (it's for CM6 split mode) and the
    // Close button text should say "Exit WYSIWYG".
    const previewBtn = document.getElementById("preview-btn");
    if (previewBtn) previewBtn.hidden = true;
    if (closeEditBtn) {
      closeEditBtn.hidden = false;
      closeEditBtn.textContent = "Exit";
    }
    if (saveBtn) saveBtn.hidden = true;
    // The hybrid flow adds Save+Exit as its primary affordance (Save
    // alone is the CM6-mode button). Save+Exit is always visible while
    // hybrid-editing; the plain Save only appears once dirty.
    if (saveExitBtn) saveExitBtn.hidden = false;

    // Focus the content.
    viewerContentEl.focus();
    // The DOM is already rendered by viewer.js (checkboxes disabled);
    // re-enable them so the user can toggle task items.
    enableCheckboxes();

    // Wire listeners.
    viewerContentEl.addEventListener("input", onInput);
    viewerContentEl.addEventListener("change", onCheckboxChange);
    viewerContentEl.addEventListener("keydown", onEnterKey);
    viewerContentEl.addEventListener("click", onBlockClick);
    viewerContentEl.addEventListener("mousedown", onContentMouseDown);
    editBar.addEventListener("click", onEditBarClick, true);
    if (saveBtn) saveBtn.addEventListener("click", onSave, true);
    if (saveExitBtn) saveExitBtn.addEventListener("click", onSaveExit, true);
    if (closeEditBtn) closeEditBtn.addEventListener("click", onClose, true);

    NB.evt.emit("hybrid:entered", activePath);
  }

  async function exit(save) {
    if (!active) return;
    let md = null;
    if (save) {
      md = domToMarkdown();
      await doSave(md);
    }
    // Unwire listeners.
    viewerContentEl.removeEventListener("input", onInput);
    viewerContentEl.removeEventListener("change", onCheckboxChange);
    viewerContentEl.removeEventListener("keydown", onEnterKey);
    viewerContentEl.removeEventListener("click", onBlockClick);
    viewerContentEl.removeEventListener("mousedown", onContentMouseDown);
    editBar.removeEventListener("click", onEditBarClick, true);
    if (saveBtn) saveBtn.removeEventListener("click", onSave, true);
    if (saveExitBtn) saveExitBtn.removeEventListener("click", onSaveExit, true);
    if (closeEditBtn) closeEditBtn.removeEventListener("click", onClose, true);
    hideMenu();

    // Remove contentEditable.
    viewerContentEl.removeAttribute("contenteditable");
    viewerContentEl.classList.remove("hybrid-editing");
    viewerEl.classList.remove("hybrid-active");
    topbar.classList.remove("editing");
    hybridBtn.classList.remove("active");

    // Restore edit bar state.
    if (NB.editbar) NB.editbar.hide();
    const previewBtn = document.getElementById("preview-btn");
    if (previewBtn) previewBtn.hidden = false;
    if (closeEditBtn) {
      closeEditBtn.textContent = "Close";
    }
    if (saveExitBtn) saveExitBtn.hidden = true;

    active = false;
    const path = activePath;
    activePath = null;
    resetDirty();

    // Re-render the file as normal preview (from the cache, which
    // doSave updated if we saved; otherwise from the original content).
    if (path && NB.viewer) {
      // Force a re-render by re-activating the file. The viewer's
      // cache already has the (possibly updated) content.
      const viewer = NB.viewer;
      // If we saved, the cache was updated via doSave -> we just need
      // to re-render. If we didn't save, the cache still has the
      // original content. Either way, re-activating is safe.
      if (viewer.activate) {
        await viewer.activate(path);
      }
    }

    NB.evt.emit("hybrid:exited", path);
  }

  async function doSave(md) {
    if (!activePath || md == null) return;
    await NB.api.saveFile(activePath, md);
    // Update the viewer's cache so the next activate shows the saved content.
    // We emit file:saved so the watcher etc. stay in sync.
    NB.evt.emit("file:saved", activePath);
    // Tell the viewer the cache now holds the saved bytes (avoids a stale
    // re-render after exit), and the watcher to ignore the self-save echo.
    if (NB.viewer && NB.viewer.noteSaved) NB.viewer.noteSaved(activePath, md);
    else if (NB.watcher) NB.watcher.noteSelfSave(activePath);
    // Re-fetch to pick up the new mtime.
    try {
      const data = await NB.api.getFile(activePath);
      if (data && data.mtime != null && NB.watcher) {
        NB.watcher.noteOpened(activePath, data.mtime);
      }
    } catch (_) {}
    resetDirty();
  }

  async function onSave(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (!active) return;
    try {
      await save();
    } catch (err) {
      alert("Save failed: " + (err && err.message ? err.message : err));
    }
  }

  /* Save the current hybrid-edited DOM back to Markdown. Exposed via
   * NB.hybrid.save so the keyboard shortcut (NB.viewer.save()) can
   * delegate here. Returns a promise that resolves once the save is
   * written (rejects on failure). Also shows a transient "Saved" toast. */
  async function save() {
    if (!active) return;
    try {
      const md = domToMarkdown();
      await doSave(md);
      if (NB.app && NB.app.notify) NB.app.notify("Saved");
    } catch (err) {
      alert("Save failed: " + (err && err.message ? err.message : err));
      throw err;
    }
  }

  async function onClose(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (!active) return;
    if (dirty) {
      const ok = confirm('You have unsaved changes in "' + activePath + '".\n\n' +
        'Save them before exiting WYSIWYG mode?');
      if (ok) {
        try {
          const md = domToMarkdown();
          await doSave(md);
        } catch (err) {
          alert("Save failed: " + (err && err.message ? err.message : err));
          return;
        }
      }
    }
    await exit(false);
  }

  async function onSaveExit(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (!active) return;
    try {
      const md = domToMarkdown();
      await doSave(md);
      if (NB.app && NB.app.notify) NB.app.notify("Saved");
      await exit(false);
    } catch (err) {
      alert("Save failed: " + (err && err.message ? err.message : err));
    }
  }

  function toggle() {
    if (active) exit(false);
    else enter();
  }

  /* Commit before navigating away (tab switch). If hybrid mode is
   * active with unsaved changes, prompt the user to save; on Cancel
   * or a failed save, abort the switch (return false). If clean or
   * the user saves successfully, exit hybrid mode and return true so
   * the caller can proceed. If hybrid mode is not active, return true
   * immediately (no-op guard). */
  async function commitForTabSwitch() {
    if (!active) return true;
    if (!dirty) {
      await exit(false);
      return true;
    }
    const ok = confirm('Save changes to "' + activePath + '" before switching tabs?');
    if (ok) {
      try {
        const md = domToMarkdown();
        await doSave(md);
      } catch (err) {
        alert("Save failed: " + (err && err.message ? err.message : err));
        return false;
      }
    } else {
      // User cancelled -- stay in hybrid mode, abort the switch.
      return false;
    }
    await exit(false);
    return true;
  }

  /* --- right-click context menu ----------------------------------- */
  /* A formatting context menu that pops up on right-click inside
   * #viewer-content while hybrid mode is active. It mirrors the edit
   * bar's actions so the user can format without reaching for the top
   * of the screen. The menu is built fresh on each open (so item labels
   * can adapt to the current selection context in the future) and
   * closes on any outside click or Esc. */

  function addMenuItem(label, handler, danger) {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (danger) btn.classList.add("danger");
    btn.addEventListener("click", () => { hideMenu(); handler(); });
    menuEl.appendChild(btn);
  }

  function addMenuSep() {
    menuEl.appendChild(document.createElement("hr"));
  }

  /* Add a submenu item: a button labeled `label` with a nested
   * .context-menu flyout containing the items returned by `buildFn`.
   * `buildFn` receives the submenu element and calls addSubItem on it.
   * The flyout opens on hover (CSS) and on click (toggle .open). */
  function addSubmenu(label, buildFn) {
    const wrap = document.createElement("button");
    wrap.className = "submenu";
    wrap.textContent = label;
    const fly = document.createElement("div");
    fly.className = "context-menu";
    fly.hidden = false;   // CSS controls visibility via .submenu:hover/.open
    buildFn(fly);
    wrap.appendChild(fly);
    // Click toggles .open so touch devices can navigate.
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close any other open submenus.
      menuEl.querySelectorAll(".submenu.open").forEach((s) => {
        if (s !== wrap) s.classList.remove("open");
      });
      wrap.classList.toggle("open");
    });
    menuEl.appendChild(wrap);
  }

  /* Helper: add a plain button to a submenu element (not the root menu). */
  function addSubItem(subEl, label, handler) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      hideMenu();
      handler();
    });
    subEl.appendChild(btn);
  }

  function hideMenu() {
    if (menuEl) {
      menuEl.hidden = true;
      menuEl.querySelectorAll(".submenu.open").forEach((s) => s.classList.remove("open"));
    }
  }

  /* --- table operations ------------------------------------------- */

  /* Find the <table> that contains the current selection/caret, or null. */
  function getTableFromSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !node.closest) return null;
    const table = node.closest("table");
    return table && viewerContentEl.contains(table) ? table : null;
  }

  /* The <tr> that holds the current caret, or null. */
  function getRowFromSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !node.closest) return null;
    const row = node.closest("tr");
    return row && viewerContentEl.contains(row) ? row : null;
  }

  /* The <td>/<th> that holds the current caret, or null. */
  function getCellFromSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !node.closest) return null;
    const cell = node.closest("td,th");
    return cell && viewerContentEl.contains(cell) ? cell : null;
  }

  /* Insert a row above or below the given row. Copies the cell count
   * from the row's own cells so the new row lines up. */
  function insertRow(row, position) {
    if (!row) return;
    const table = row.closest("table");
    const cells = Array.from(row.cells);
    const newRow = document.createElement("tr");
    cells.forEach((cell) => {
      const tag = cell.tagName === "TH" ? "th" : "td";
      const nc = document.createElement(tag);
      nc.innerHTML = "&nbsp;";
      newRow.appendChild(nc);
    });
    if (position === "above") row.parentNode.insertBefore(newRow, row);
    else if (row.nextSibling) row.parentNode.insertBefore(newRow, row.nextSibling);
    else row.parentNode.appendChild(newRow);
    onContentChange();
  }

  /* Delete the given row. If it's the only row, remove the whole table. */
  function deleteRow(row) {
    if (!row) return;
    const table = row.closest("table");
    const rows = Array.from(table.rows);
    if (rows.length <= 1) { deleteTable(table); return; }
    row.remove();
    onContentChange();
  }

  /* Insert a column to the left or right of the current cell's column.
   * Adds a cell to every row at the matching index. */
  function insertCol(cell, position) {
    if (!cell) return;
    const table = cell.closest("table");
    const idx = cell.cellIndex;
    Array.from(table.rows).forEach((row) => {
      const cells = Array.from(row.cells);
      const ref = cells[idx];
      const tag = ref && ref.tagName === "TH" ? "th" : "td";
      const nc = document.createElement(tag);
      nc.innerHTML = "&nbsp;";
      if (ref) {
        if (position === "left") ref.parentNode.insertBefore(nc, ref);
        else if (ref.nextSibling) ref.parentNode.insertBefore(nc, ref.nextSibling);
        else ref.parentNode.appendChild(nc);
      } else {
        row.appendChild(nc);
      }
    });
    onContentChange();
  }

  /* Delete the current cell's column from every row. */
  function deleteCol(cell) {
    if (!cell) return;
    const table = cell.closest("table");
    const idx = cell.cellIndex;
    Array.from(table.rows).forEach((row) => {
      const cells = Array.from(row.cells);
      if (cells[idx]) cells[idx].remove();
    });
    onContentChange();
  }

  /* Remove the whole table element. */
  function deleteTable(table) {
    if (!table) return;
    table.remove();
    onContentChange();
  }

  /* Toggle the first row between header (th) and body (td) cells. */
  function toggleHeaderRow(table) {
    if (!table) return;
    const first = table.rows[0];
    if (!first) return;
    const isHeader = Array.from(first.cells).some((c) => c.tagName === "TH");
    Array.from(first.cells).forEach((c) => {
      const tag = isHeader ? "td" : "th";
      const nc = document.createElement(tag);
      while (c.firstChild) nc.appendChild(c.firstChild);
      c.replaceWith(nc);
    });
    onContentChange();
  }

  /* Build the Table submenu for the given table. */
  function buildTableMenu(fly, table) {
    addSubItem(fly, "Insert row above", () => insertRow(getRowFromSelection(), "above"));
    addSubItem(fly, "Insert row below", () => insertRow(getRowFromSelection(), "below"));
    addSubItem(fly, "Delete row", () => deleteRow(getRowFromSelection()));
    fly.appendChild(document.createElement("hr"));
    addSubItem(fly, "Insert column left", () => insertCol(getCellFromSelection(), "left"));
    addSubItem(fly, "Insert column right", () => insertCol(getCellFromSelection(), "right"));
    addSubItem(fly, "Delete column", () => deleteCol(getCellFromSelection()));
    fly.appendChild(document.createElement("hr"));
    addSubItem(fly, "Toggle header row", () => toggleHeaderRow(table));
    addSubItem(fly, "Delete table", () => deleteTable(table));
  }

  /* --- code & plugin blocks: edit source / change language ---------- */
  /* Rendered plugin blocks keep their original source in a data
   * attribute (.mermaid-container -> dataset.mermaidSource, etc.) so
   * domToMarkdown can round-trip them. "Edit source" turns the rendered
   * block back into a plain editable <pre><code class="language-X"> so
   * the user can fix the text, then re-renders on blur/Esc. The same
   * flow works for ANY code block: a raw <pre><code> is focused in
   * place, and "Language…" re-types the fence's language (shell ->
   * python, mermaid -> python, ...). */
  const PLUGIN_TYPES = [
    { sel: ".mermaid-container,.mermaid-error", lang: "mermaid", name: "mermaid", mod: "mermaid",
      src: (el) => el.dataset.mermaidSource ||
        (el.querySelector(".mermaid-source") || {}).textContent || "" },
    { sel: ".wavedrom-container,.wavedrom-error", lang: "wavedrom", name: "WaveDrom", mod: "wavedrom",
      src: (el) => el.dataset.wavedromSource ||
        (el.querySelector(".wavedrom-source") || {}).textContent || "" },
    { sel: ".katex-container,.katex-error", lang: "math", name: "math", mod: "katex",
      src: (el) => el.dataset.katexSource ||
        (el.querySelector(".katex-source") || {}).textContent || "" },
    { sel: ".viz-container,.viz-error", lang: "dot", name: "Graphviz", mod: "viz",
      src: (el) => el.dataset.vizSource ||
        (el.querySelector(".viz-source") || {}).textContent || "" },
  ];
  const PLUGIN_BY_LANG = {};
  for (const t of PLUGIN_TYPES) PLUGIN_BY_LANG[t.lang] = t;

  /* Which plugin module (if any) should re-render a language on commit. */
  function renderModuleFor(lang) {
    const t = PLUGIN_BY_LANG[(lang || "").toLowerCase()];
    return t ? NB[t.mod] : null;
  }

  /* Resolve the right-clicked target to an editable block. Returns
   * {el, plugin, raw} where `el` is the DOM element to swap/focus
   * (a rendered plugin container/error, or the <pre> of a raw code
   * block), `plugin` is the PLUGIN_TYPES entry when rendered, and
   * `raw` is true when the block is already an editable fence. */
  function codeBlockAt(target) {
    if (!target || !target.closest) return null;
    for (const t of PLUGIN_TYPES) {
      const el = target.closest(t.sel);
      if (el && viewerContentEl.contains(el)) return { el, plugin: t, raw: false };
    }
    const pre = target.closest("pre");
    if (pre && viewerContentEl.contains(pre) && pre.querySelector("code")) {
      return { el: pre, plugin: null, raw: true };
    }
    return null;
  }

  /* Current source text of a resolved block. */
  function blockSource(hit) {
    if (!hit) return "";
    if (hit.plugin) return hit.plugin.src(hit.el) || "";
    const code = hit.el.querySelector("code");
    return code ? code.textContent : "";
  }

  /* Current language class of the block ("" when the fence is bare). */
  function blockLanguage(hit) {
    if (!hit) return "";
    let code = null;
    if (hit.plugin) return hit.plugin.lang;
    code = hit.el.querySelector("code");
    if (!code) return "";
    const m = (code.className || "").match(/language-([\w-]+)/);
    return m ? m[1] : "";
  }

  /* Swap a rendered plugin container (or any block) for a raw editable
   * <pre><code class="language-X">. Returns the new <pre>. */
  function toRawBlock(hit, lang, src) {
    const pre = document.createElement("pre");
    pre.className = "hybrid-plugin-editing";
    const code = document.createElement("code");
    code.className = lang ? "language-" + lang : "";
    code.textContent = src;
    pre.appendChild(code);
    hit.el.replaceWith(pre);
    onContentChange();
    return pre;
  }

  function editPluginSource(hit) {
    if (!hit) return;
    // Rendered plugin containers become a raw fence first; raw code
    // blocks are focused where they are.
    let pre, code, lang;
    if (hit.plugin) {
      lang = hit.plugin.lang;
      pre = toRawBlock(hit, lang, hit.plugin.src(hit.el) || "");
      code = pre.querySelector("code");
    } else {
      pre = hit.el;
      code = pre.querySelector("code");
      lang = blockLanguage(hit);
      if (!code) return;
      pre.classList.add("hybrid-plugin-editing");
      onContentChange();
    }
    // Focus and put the caret at the end of the source.
    pre.setAttribute("contenteditable", "true");
    pre.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(code);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    addLanguagePill(pre, code);
    wireCommit(pre, lang);
  }

  /* The language chip: an inline editable label rendered on the block
   * while editing -- on the LEFT side, above the code. Click it and it
   * becomes a small text input right there (no prompt window): type
   * "python", "mermaid", ... and Enter commits, Esc/blur cancels. The
   * chip is a <span contenteditable> so it never steals focus from the
   * block on click (mousedown is prevented on the wrapper). */
  function addLanguagePill(pre, code) {
    const chip = document.createElement("span");
    chip.className = "hybrid-lang-pill";
    chip.setAttribute("contenteditable", "true");
    chip.setAttribute("spellcheck", "false");
    const label = () => {
      const m = (code.className || "").match(/language-([\w-]+)/);
      chip.textContent = m ? m[1] : "";
    };
    label();
    chip.addEventListener("mousedown", (e) => {
      // Let clicks focus the chip's own caret (it is contenteditable
      // itself); do not let them reach the <pre> and disturb the code
      // selection.
      e.stopPropagation();
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const next = (chip.textContent || "").trim().toLowerCase();
        code.className = next ? "language-" + next : "";
        onContentChange();
        chip.blur();
        pre.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        label();   // restore the current language, discard edits
        chip.blur();
        pre.focus();
      }
    });
    chip.addEventListener("blur", () => {
      // Commit whatever was typed on blur too (blur from Enter/Esc
      // re-runs this but the class is already set, so it's a no-op).
      const next = (chip.textContent || "").trim().toLowerCase();
      const m = (code.className || "").match(/language-([\w-]+)/);
      const cur = m ? m[1] : "";
      if (next && next !== cur) {
        code.className = next ? "language-" + next : "";
        onContentChange();
      } else {
        label();
      }
    });
    pre.appendChild(chip);
  }

  /* Wire the commit-on-blur/Esc behavior for a block being edited.
   * The blur path is the "restore render mode": when focus leaves the
   * block it is committed -- a plugin language re-renders through its
   * module's renderAll, plain code stays a raw fence -- and the
   * editing decorations (contenteditable, pill) are removed. */
  function wireCommit(pre, lang) {
    const commit = () => {
      pre.removeEventListener("focusout", onFocusOut);
      pre.removeAttribute("contenteditable");
      pre.classList.remove("hybrid-plugin-editing");
      const pill = pre.querySelector(".hybrid-lang-pill");
      if (pill) pill.remove();
      const curLang = blockLanguage({ el: pre, plugin: null, raw: true });
      const mod = renderModuleFor(curLang);
      if (mod && mod.renderAll) {
        Promise.resolve(mod.renderAll(viewerContentEl))
          .then(() => { onContentChange(); })
          .catch(() => {});
      } else {
        onContentChange();
      }
    };
    const onFocusOut = (e) => {
      // Don't commit when focus moves to a child (e.g. the lang-pill).
      if (e.relatedTarget && pre.contains(e.relatedTarget)) return;
      commit();
    };
    pre.addEventListener("focusout", onFocusOut);
    pre.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        pre.blur();
      }
    });
  }

  function buildMenu(e) {
    menuEl.innerHTML = "";

    // Clipboard (top-level)
    addMenuItem("Copy", () => doCopy());
    addMenuItem("Paste", () => doPaste());
    addMenuItem("Paste without formatting", () => doPastePlain());

    addMenuSep();

    // Inline formatting submenu
    addSubmenu("Inline", (fly) => {
      addSubItem(fly, "Bold", () => execCommand("bold"));
      addSubItem(fly, "Italic", () => execCommand("italic"));
      addSubItem(fly, "Strikethrough", () => execCommand("strikeThrough"));
      addSubItem(fly, "Inline code", () => execCommand("code"));
      addSubItem(fly, "Clear formatting", () => execCommand("removeFormat"));
    });

    // Heading submenu
    addSubmenu("Heading", (fly) => {
      addSubItem(fly, "Heading 1", () => wrapBlock("h1"));
      addSubItem(fly, "Heading 2", () => wrapBlock("h2"));
      addSubItem(fly, "Heading 3", () => wrapBlock("h3"));
      addSubItem(fly, "Heading 4", () => wrapBlock("h4"));
      addSubItem(fly, "Heading 5", () => wrapBlock("h5"));
      addSubItem(fly, "Heading 6", () => wrapBlock("h6"));
    });

    // List & quote submenu
    addSubmenu("List", (fly) => {
      addSubItem(fly, "Bulleted list", () => toggleList("ul"));
      addSubItem(fly, "Numbered list", () => toggleList("ol"));
      addSubItem(fly, "Quote", () => wrapBlock("blockquote"));
    });

    // Table submenu -- only shown when the click is inside a table.
    const table = e && e.target && e.target.closest ? e.target.closest("table") : null;
    if (table && viewerContentEl.contains(table)) {
      addSubmenu("Table", (fly) => buildTableMenu(fly, table));
    }

    // Code & plugin blocks (mermaid / wavedrom / katex / graphviz / any
    // fenced code): edit the raw source. The fence language is edited
    // via a pill rendered on the block while editing, not from the menu.
    const blockHit = codeBlockAt(e && e.target);
    if (blockHit) {
      addMenuSep();
      if (blockHit.plugin) {
        addMenuItem("Edit " + blockHit.plugin.name + " source", () => editPluginSource(blockHit));
      } else {
        addMenuItem("Edit code block", () => editPluginSource(blockHit));
      }
    }

    // Insert submenu
    addSubmenu("Insert", (fly) => {
      addSubItem(fly, "Link…", () => {
        const url = prompt("Link URL:", "https://");
        if (url) execCommand("createLink", url);
      });
      addSubItem(fly, "Image…", () => {
        const url = prompt("Image URL:", "https://");
        if (url) execCommand("insertImage", url);
      });
      addSubItem(fly, "Code block", () => {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        const sel = window.getSelection();
        const text = sel && sel.rangeCount ? sel.toString() : "code";
        code.textContent = text;
        pre.appendChild(code);
        try { document.execCommand("insertHTML", false, pre.outerHTML); }
        catch (_) {}
        onContentChange();
      });
      addSubItem(fly, "Table", () => {
        const html = '<table><thead><tr><th>Column 1</th><th>Column 2</th></tr></thead>' +
          '<tbody><tr><td>cell</td><td>cell</td></tr></tbody></table>';
        try { document.execCommand("insertHTML", false, html); }
        catch (_) {}
        onContentChange();
      });
      addSubItem(fly, "Horizontal rule", () => {
        const hr = document.createElement("hr");
        try { document.execCommand("insertHTML", false, hr.outerHTML); }
        catch (_) {}
        onContentChange();
      });
    });

    addMenuSep();

    // History
    addSubmenu("History", (fly) => {
      addSubItem(fly, "Undo", () => execCommand("undo"));
      addSubItem(fly, "Redo", () => execCommand("redo"));
    });

    // Save (top-level)
    addMenuItem("Save", () => onSave());
  }

  function openMenu(e) {
    if (!active || !menuEl) return;
    e.preventDefault();
    // Capture the caret position at the right-click point so paste
    // actions can restore it after the menu steals focus.
    const sel = window.getSelection();
    savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
    buildMenu(e);
    menuEl.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - menuEl.offsetHeight - 10);
    menuEl.style.left = x + "px";
    menuEl.style.top = y + "px";
  }

  // Wire the contextmenu event on #viewer-content. Only fires when
  // hybrid mode is active (openMenu guards on `active`).
  if (viewerContentEl) {
    viewerContentEl.addEventListener("contextmenu", (e) => openMenu(e));
  }
  // Close the menu on any click outside it, or on Esc.
  document.addEventListener("click", (e) => {
    if (menuEl && !menuEl.hidden && !menuEl.contains(e.target)) hideMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuEl && !menuEl.hidden) hideMenu();
  });
  // Close on another contextmenu event outside #viewer-content (e.g.
  // right-clicking the sidebar) so the hybrid menu doesn't stay open.
  document.addEventListener("contextmenu", (e) => {
    if (menuEl && !menuEl.hidden && !viewerContentEl.contains(e.target)) hideMenu();
  }, true);

  /* --- top-bar button wiring ------------------------------------- */

  if (hybridBtn) {
    hybridBtn.addEventListener("click", () => toggle());
  }

  /* Show/hide the hybrid button based on whether a file is open.
   * The button should only be visible when in preview mode (not in
   * CM6 edit mode) and a file is active. We listen to file:open and
   * the viewer's mode-change events. */
  function updateButtonVisibility() {
    if (!hybridBtn) return;
    const path = NB.viewer && NB.viewer.getPath ? NB.viewer.getPath() : null;
    // Don't show the button if we're in CM6 edit mode (the viewer's
    // editMode is true). We check the edit-toggle button's class.
    const inEditMode = document.getElementById("edit-toggle").classList.contains("editing");
    hybridBtn.hidden = !path || inEditMode || active;
  }

  NB.evt.on("file:open", updateButtonVisibility);
  NB.evt.on("viewer:dirty-changed", updateButtonVisibility);

  /* If the user enters CM6 edit mode while hybrid is on (shouldn't
   * happen since the button is hidden, but guard anyway), exit hybrid. */
  NB.evt.on("viewer:dirty-changed", () => {
    // The edit-toggle gets .editing when CM6 edit mode starts.
    if (active && document.getElementById("edit-toggle").classList.contains("editing")) {
      exit(false);
    }
  });

  /* --- external change handling ---------------------------------- */
  /* If the file changes on disk while hybrid-editing, re-render. The
   * viewer's file:external-change handler will also fire; we intercept
   * here to stay in hybrid mode with the fresh content. */
  NB.evt.on("file:external-change", async ({ path }) => {
    if (!active || path !== activePath) return;
    // Re-fetch and re-render. If dirty, the viewer's handler will
    // prompt; we let it handle the conflict flow and just exit hybrid.
    if (dirty) {
      // The viewer's handler will prompt; we exit hybrid to avoid
      // clobbering the user's edits. The viewer will re-render.
      await exit(false);
    } else {
      // Re-render from the fresh content.
      try {
        const data = await NB.api.getFile(path);
        if (data && data.content != null) {
          renderMarkdown(data.content);
        }
      } catch (_) {}
    }
  });

  NB.hybrid = {
    enter,
    exit,
    toggle,
    save,
    isActive,
    isDirty,
    domToMarkdown,
    updateButtonVisibility,
    commitForTabSwitch,
  };
})();