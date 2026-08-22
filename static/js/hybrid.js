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
  const closeEditBtn   = document.getElementById("close-edit-btn");
  const topbar         = document.getElementById("topbar");
  const menuEl         = document.getElementById("hybrid-context-menu");

  let active = false;       // hybrid mode currently on
  let activePath = null;    // path of the file being hybrid-edited
  let turndownSvc = null;   // lazily created TurndownService instance

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
    let md = td.turndown(clone);
    // Turndown sometimes leaves a leading newline; trim it.
    return md.replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
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
   * inside #viewer-content. */
  function wrapBlock(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let range = sel.getRangeAt(0);
    // Expand to the whole block (the nearest block ancestor).
    let block = range.commonAncestorContainer;
    if (block.nodeType === Node.TEXT_NODE) block = block.parentElement;
    while (block && block !== viewerContentEl) {
      const display = window.getComputedStyle(block).display;
      if (display === "block" || /^(H[1-6]|P|UL|OL|BLOCKQUOTE|PRE|LI)$/.test(block.tagName)) break;
      block = block.parentElement;
    }
    if (!block || block === viewerContentEl) return;
    // Toggle: if already this tag, convert back to <p>.
    if (block.tagName === tag.toUpperCase()) {
      const p = document.createElement("p");
      while (block.firstChild) p.appendChild(block.firstChild);
      block.replaceWith(p);
    } else {
      const el = document.createElement(tag);
      while (block.firstChild) el.appendChild(block.firstChild);
      block.replaceWith(el);
    }
    onContentChange();
  }

  /* Toggle a list type on the current block. Creates a <ul>/<ol> if
   * the block isn't already a list, or converts between ul/ol. */
  function toggleList(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let block = sel.getRangeAt(0).commonAncestorContainer;
    if (block.nodeType === Node.TEXT_NODE) block = block.parentElement;
    while (block && block !== viewerContentEl) {
      if (/^(P|UL|OL|LI|DIV)$/.test(block.tagName)) break;
      block = block.parentElement;
    }
    if (!block || block === viewerContentEl) return;
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
      }
    } else {
      // Create a new list from the current paragraph.
      const li = document.createElement("li");
      const list = document.createElement(tag);
      while (block.firstChild) li.appendChild(block.firstChild);
      list.appendChild(li);
      block.replaceWith(list);
    }
    onContentChange();
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

  /* Paste from the clipboard at the current selection. Tries the async
   * Clipboard API (navigator.clipboard.readText) first; falls back to
   * document.execCommand("paste") which is often blocked outside the
   * user-gesture path, then to inserting the text as a plain text node.
   * Falls back gracefully in jsdom where the Clipboard API is absent. */
  async function doPaste() {
    viewerContentEl.focus();
    let text = null;
    if (navigator.clipboard && navigator.clipboard.readText) {
      try { text = await navigator.clipboard.readText(); }
      catch (_) { text = null; }
    }
    if (text != null) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        sel.collapseToEnd();
      }
      onContentChange();
      return;
    }
    // execCommand fallback (may be blocked by the browser).
    try { document.execCommand("paste"); }
    catch (_) {}
    onContentChange();
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
    clearTimeout(inputDebounce);
    inputDebounce = setTimeout(onContentChange, 50);
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

    // Focus the content.
    viewerContentEl.focus();

    // Wire listeners.
    viewerContentEl.addEventListener("input", onInput);
    editBar.addEventListener("click", onEditBarClick, true);
    if (saveBtn) saveBtn.addEventListener("click", onSave, true);
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
    editBar.removeEventListener("click", onEditBarClick, true);
    if (saveBtn) saveBtn.removeEventListener("click", onSave, true);
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
    // Also tell the watcher to ignore the self-save echo.
    if (NB.watcher) NB.watcher.noteSelfSave(activePath);
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
      const md = domToMarkdown();
      await doSave(md);
      if (NB.app && NB.app.notify) NB.app.notify("Saved");
    } catch (err) {
      alert("Save failed: " + (err && err.message ? err.message : err));
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

  function buildMenu() {
    menuEl.innerHTML = "";

    // Clipboard (top-level)
    addMenuItem("Copy", () => doCopy());
    addMenuItem("Paste", () => doPaste());

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
    buildMenu();
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
    isActive,
    isDirty,
    domToMarkdown,
    updateButtonVisibility,
    commitForTabSwitch,
  };
})();