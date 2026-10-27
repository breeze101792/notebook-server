/* designer-shell.js -- the shared lifecycle for the Graphviz and WaveDrom
 * design windows (#dw-designer-overlay).
 *
 * The Mermaid designer (mermaid-designer.js) owns its own overlay and its
 * own copy of the capture/apply/close lifecycle. These two languages share
 * one sibling overlay (D1) and one lifecycle (D2): this module owns the
 * overlay, states, dirty guard, target re-resolution and the fixed Apply
 * order. Focus containment is delegated to NB.dialog. Each language module
 * (dot-designer.js, wavedrom-designer.js) passes a plain controller object
 * with only the genuinely different pieces: the model, serialization,
 * preview and UI.
 *
 * The Apply order mirrors mermaid-designer.js exactly:
 *   no-op -> serialize -> validate by rendering -> hybrid guard ->
 *   re-resolve target -> raw fence swap -> await renderNote ->
 *   onContentChange exactly once -> close.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const OVERLAY_ID = "dw-designer-overlay";
  const DISCARD_MESSAGE =
    "Discard unsaved diagram changes? The note will stay unchanged.";
  const TOAST_MS = 4000;
  const STATUS_DIRTY = "Unsaved changes";
  const STATUS_APPLYING = "Applying\u2026";
  const STATUS_LOADING = "Loading\u2026";
  const STATUS_NOOP = "No changes to apply";
  const HISTORY_COALESCE_MS = 350;
  const PREVIEW_FAIL =
    "Preview can\u2019t render this change. Apply still validates before saving.";

  const overlay = document.getElementById(OVERLAY_ID);
  const viewerContentEl = document.getElementById("viewer-content");

  const ui = {
    title: document.getElementById("dw-title"),
    type: document.getElementById("dw-type"),
    close: document.getElementById("dw-close"),
    sidebar: document.getElementById("dw-sidebar"),
    addTitle: document.getElementById("dw-add-title"),
    addTabs: document.getElementById("dw-add-tabs"),
    addForm: document.getElementById("dw-add-form"),
    addFields: document.getElementById("dw-add-fields"),
    addError: document.getElementById("dw-add-error"),
    addNote: document.getElementById("dw-add-note"),
    addSubmit: document.getElementById("dw-add-submit"),
    chart: document.getElementById("dw-chart"),
    chartDivider: document.getElementById("dw-chart-divider"),
    editSource: document.getElementById("dw-edit-source"),
    canvas: document.getElementById("dw-canvas"),
    card: document.getElementById("dw-diagram-card"),
    overlayLayer: document.getElementById("dw-overlay-layer"),
    hint: document.getElementById("dw-hint"),
    empty: document.getElementById("dw-empty"),
    loading: document.getElementById("dw-loading"),
    error: document.getElementById("dw-error"),
    errorMsg: document.getElementById("dw-error-msg"),
    retry: document.getElementById("dw-retry"),
    errorEditSource: document.getElementById("dw-error-edit-source"),
    alert: document.getElementById("dw-alert"),
    alertMsg: document.getElementById("dw-alert-msg"),
    inspector: document.getElementById("dw-inspector"),
    inspectorHead: document.getElementById("dw-inspector-head"),
    inspectorKind: document.getElementById("dw-inspector-kind"),
    inspectorMeta: document.getElementById("dw-inspector-meta"),
    inspectorClear: document.getElementById("dw-inspector-clear"),
    inspectorBody: document.getElementById("dw-inspector-body"),
    status: document.getElementById("dw-status"),
    cancel: document.getElementById("dw-cancel"),
    apply: document.getElementById("dw-apply"),
    undo: document.getElementById("dw-undo"),
    redo: document.getElementById("dw-redo"),
    stageScroll: document.getElementById("dw-stage-scroll"),
    sliceRuler: document.getElementById("dw-slice-ruler"),
    sliceBand: document.getElementById("dw-slice-band"),
    readonly: document.getElementById("dw-readonly"),
    readonlyMsg: document.getElementById("dw-readonly-msg"),
    readonlyEditSource: document.getElementById("dw-readonly-edit-source"),
    compactNav: document.querySelector(
      "#dw-designer-overlay .dw-compact-nav"),
    addSection: document.getElementById("dw-add-section"),
    compactSheet: document.getElementById("dw-compact-sheet"),
    compactSheetBody: document.getElementById("dw-compact-sheet-body"),
    sheetClose: document.getElementById("dw-sheet-close"),
  };

  const STATE_EL = {
    empty: ui.empty,
    loading: ui.loading,
    error: ui.error,
    readonly: ui.readonly,
  };

  let controller = null;
  let model = null;
  let target = null;
  let invoker = null;
  let applying = false;
  let mountToken = 0;
  let previewToken = 0;
  let stateName = "loading";
  let blocked = false;
  let alertKind = null;
  let sheetKind = null;
  const sheetAnchors = { add: null, chart: null };
  let sheetInvoker = null;
  const history = {
    stack: [],
    index: -1,
    lastAt: 0,
    lastKind: null,
    restoring: false,
  };

  function isOpen() {
    return !!overlay && !overlay.hidden;
  }

  function notify(msg, cls) {
    if (NB.app && NB.app.notify) NB.app.notify(msg, TOAST_MS, cls || "warn");
  }

  function firstLine(err) {
    if (!err) return "";
    return String(err.message || err).split(/\r?\n/)[0].slice(0, 300);
  }

  function setStatus(text, kind) {
    if (!ui.status) return;
    ui.status.textContent = text || "";
    ui.status.className = "designer-status" + (kind ? " " + kind : "");
  }

  function alert(msg, kind) {
    if (!ui.alert) return;
    alertKind = kind || "apply";
    if (ui.alertMsg) ui.alertMsg.textContent = msg || "";
    ui.alert.hidden = false;
  }

  function clearAlert() {
    alertKind = null;
    if (!ui.alert) return;
    ui.alert.hidden = true;
    if (ui.alertMsg) ui.alertMsg.textContent = "";
  }

  function syncApply() {
    if (!ui.apply) return;
    // A clean open must still expose Apply: the no-op branch in apply()
    // reports "No changes to apply" and closes without writing (A15).
    ui.apply.disabled = !(stateName === "ready" && !applying && !blocked);
  }

  function setBlocked(flag) {
    blocked = !!flag;
    syncApply();
  }

  function markDirty(structural) {
    if (stateName !== "ready") return;
    setStatus(STATUS_DIRTY, "");
    syncApply();
    captureHistory(!!structural);
  }

  function noun() {
    return (controller && controller.noun) ? controller.noun : "diagram";
  }

  function discardMessage() {
    if (!controller || !controller.noun) return DISCARD_MESSAGE;
    return "Discard unsaved changes to this " + controller.noun +
      "? The note will stay unchanged.";
  }

  function historySupported() {
    return !!(controller && typeof controller.snapshot === "function" &&
      typeof controller.restore === "function");
  }

  function updateHistoryButtons() {
    const can = historySupported();
    if (ui.undo) ui.undo.disabled = !can || history.index <= 0;
    if (ui.redo) {
      ui.redo.disabled = !can || history.index >= history.stack.length - 1;
    }
  }

  function resetHistory() {
    history.stack = [];
    history.index = -1;
    history.lastAt = 0;
    history.lastKind = null;
    if (historySupported()) {
      history.stack = [controller.snapshot()];
      history.index = 0;
    }
    updateHistoryButtons();
  }

  function captureHistory(structural) {
    if (!historySupported() || history.restoring) return;
    const snap = controller.snapshot();
    if (!history.stack.length) {
      history.stack = [snap];
      history.index = 0;
      updateHistoryButtons();
      return;
    }
    if (snap === history.stack[history.index]) return;
    const now = Date.now();
    if (!structural && history.lastKind === "text" &&
        now - history.lastAt <= HISTORY_COALESCE_MS &&
        history.index === history.stack.length - 1) {
      history.stack[history.index] = snap;
    } else {
      history.stack = history.stack.slice(0, history.index + 1);
      history.stack.push(snap);
      history.index++;
    }
    history.lastKind = structural ? "structural" : "text";
    history.lastAt = now;
    updateHistoryButtons();
  }

  async function restoreHistory() {
    if (!historySupported() || history.index < 0) return;
    const source = history.stack[history.index];
    history.restoring = true;
    try {
      const ok = controller.restore(source);
      if (ok === false) throw new Error("The saved state could not be restored");
    } catch (err) {
      history.restoring = false;
      alert("Couldn’t restore history — " + firstLine(err));
      updateHistoryButtons();
      return;
    }
    history.restoring = false;
    history.lastKind = null;
    history.lastAt = 0;
    setStatus(controller.isNoOp(model) ? "Ready" : STATUS_DIRTY, "");
    syncApply();
    try {
      await preview();
    } catch (_) {
      alert(PREVIEW_FAIL, "preview");
    }
    updateHistoryButtons();
    focusCanvas();
  }

  function undo() {
    if (!historySupported() || history.index <= 0) return;
    history.index--;
    restoreHistory();
  }

  function redo() {
    if (!historySupported() || history.index >= history.stack.length - 1) return;
    history.index++;
    restoreHistory();
  }

  function isCompactSheetOpen() {
    return !!(ui.compactSheet && !ui.compactSheet.hidden);
  }

  function sheetSection(kind) {
    return kind === "chart" ? ui.chart : ui.addSection;
  }

  function openCompactSheet(kind, invoker) {
    if (!overlay || !overlay.classList.contains("is-compact")) {
      const target = kind === "chart" ? ui.chart : ui.addForm;
      if (target && target.scrollIntoView) {
        try { target.scrollIntoView({ block: "nearest" }); } catch (_) {}
      }
      if (target && target.querySelector) {
        const field = target.querySelector("input, select, button");
        if (field) field.focus();
      }
      return;
    }
    if (!ui.compactSheet || !ui.compactSheetBody) return;
    if (isCompactSheetOpen()) closeCompactSheet(false);
    const section = sheetSection(kind);
    if (!section || !section.parentNode) return;
    const anchor = document.createComment("dw-sheet-anchor");
    section.parentNode.insertBefore(anchor, section);
    sheetAnchors[kind] = anchor;
    ui.compactSheetBody.appendChild(section);
    sheetKind = kind;
    sheetInvoker = invoker || null;
    ui.compactSheet.hidden = false;
    ui.compactSheet.setAttribute("aria-hidden", "false");
    overlay.classList.add("is-sheet-open");
    if (ui.inspector) ui.inspector.classList.add("is-sheet-hidden");
    if (sheetInvoker && sheetInvoker.setAttribute) {
      sheetInvoker.setAttribute("aria-expanded", "true");
    }
    const focusFirst = function () {
      const field = ui.compactSheetBody.querySelector("input, select, textarea") ||
        ui.compactSheetBody.querySelector("button");
      if (field) {
        void field.offsetWidth;
        field.focus();
      }
    };
    focusFirst();
    window.setTimeout(focusFirst, 0);
    if (window.requestAnimationFrame) window.requestAnimationFrame(focusFirst);
  }

  function closeCompactSheet(restoreFocus) {
    if (!isCompactSheetOpen()) return;
    const kind = sheetKind;
    const section = sheetSection(kind);
    const anchor = sheetAnchors[kind];
    if (section && anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(section, anchor.nextSibling);
      anchor.remove();
    }
    sheetAnchors[kind] = null;
    sheetKind = null;
    ui.compactSheet.hidden = true;
    ui.compactSheet.setAttribute("aria-hidden", "true");
    overlay.classList.remove("is-sheet-open");
    if (sheetInvoker) {
      sheetInvoker.setAttribute("aria-expanded", "false");
      if (restoreFocus && sheetInvoker.isConnected) sheetInvoker.focus();
    }
    sheetInvoker = null;
    syncInspectorSheet();
  }

  function syncInspectorSheet() {
    if (!overlay || !ui.inspector) return;
    const compact = overlay.classList.contains("is-compact");
    const kind = ui.inspectorKind
      ? (ui.inspectorKind.textContent || "") : "";
    const active = !!kind && kind !== "Nothing selected";
    if (compact && active && isCompactSheetOpen()) closeCompactSheet(false);
    ui.inspector.classList.toggle("is-sheet-hidden", compact && !active);
  }

  function syncCompact() {
    if (!overlay || !window.matchMedia) return;
    const compact = window.matchMedia("(max-width: 960px)").matches;
    if (!compact) closeCompactSheet(false);
    overlay.classList.toggle("is-compact", compact);
    syncInspectorSheet();
  }

  function setState(name) {
    stateName = name;
    for (const k in STATE_EL) {
      const el = STATE_EL[k];
      if (el) el.hidden = k !== name;
    }
    const ready = name === "ready";
    if (ui.sidebar) ui.sidebar.hidden = !ready;
    if (ui.inspector) ui.inspector.hidden = !ready;
    syncApply();
  }

  function setError(msg, detail) {
    if (ui.errorMsg) {
      ui.errorMsg.textContent = detail
        ? msg + " " + firstLine(detail)
        : (msg || "The diagram couldn\u2019t be opened.");
    }
    if (ui.retry) ui.retry.hidden = false;
    if (ui.errorEditSource) ui.errorEditSource.hidden = false;
    setState("error");
  }

  function setReadonly(reason) {
    if (ui.readonlyMsg) ui.readonlyMsg.textContent = reason || "";
    if (ui.readonlyEditSource) ui.readonlyEditSource.hidden = false;
    setState("readonly");
  }

  function focusCanvas() {
    if (ui.canvas && ui.canvas.focus) {
      try { ui.canvas.focus({ preventScroll: true }); } catch (_) { ui.canvas.focus(); }
    }
  }

  function restoreFocus() {
    const el = invoker;
    invoker = null;
    const usable = el && el !== document.body && el !== document.documentElement;
    const inMenu = usable && el.closest && el.closest(".context-menu");
    if (usable && el.isConnected && !inMenu && typeof el.focus === "function") {
      try { el.focus({ preventScroll: true }); } catch (_) {}
      return;
    }
    if (target && target.parent) {
      const node = target.parent.children[target.index];
      if (node && typeof node.focus === "function") {
        try { node.focus({ preventScroll: true }); } catch (_) {}
      }
    }
  }

  function sourceOf(hitEl) {
    if (!hitEl || !NB.blocks) return "";
    const desc = NB.blocks.forElement ? NB.blocks.forElement(hitEl) : null;
    return (desc && NB.blocks.sourceOf) ? (NB.blocks.sourceOf(desc, hitEl) || "") : "";
  }

  function captureTarget(hit) {
    const el = hit && hit.el;
    const parent = el && el.parentNode;
    if (!el || !parent) return false;
    const index = Array.prototype.indexOf.call(parent.children, el);
    if (index < 0) return false;
    const source = (hit.plugin && hit.plugin.src)
      ? (hit.plugin.src(el) || "")
      : sourceOf(el);
    target = { parent: parent, index: index, source: source };
    return true;
  }

  function clearCard() {
    if (!ui.card) return;
    Array.from(ui.card.children).forEach(function (child) {
      if (child !== ui.overlayLayer && child !== ui.sliceBand) child.remove();
    });
  }

  /* preview() -- serialize the model, render it through the language's
   * renderSource, and mount the SVG in the card. Controllers call this
   * after a model edit; open() calls it with throwOnError. */
  async function preview(throwOnError) {
    if (!controller || !model || !ui.card) return null;
    const token = ++previewToken;
    let svg;
    try {
      const src = controller.serialize(model);
      svg = await controller.renderSource(src, ui.card);
    } catch (err) {
      if (throwOnError) throw err;
      if (token === previewToken) alert(PREVIEW_FAIL, "preview");
      return null;
    }
    if (token !== previewToken || !isOpen()) return null;
    if (alertKind === "preview") clearAlert();
    clearCard();
    if (svg) ui.card.insertBefore(svg, ui.overlayLayer);
    if (controller.afterRender) controller.afterRender(model);
    syncInspectorSheet();
    return svg;
  }

  function renderChrome() {
    const lang = controller ? controller.lang : "";
    if (ui.card) ui.card.className = "dw-card dw-card--" + lang;
    if (ui.type) ui.type.textContent = controller ? controller.badge : "";
    if (ui.title) {
      ui.title.textContent = controller && controller.windowTitle
        ? controller.windowTitle : "Design diagram";
    }
    if (ui.hint) ui.hint.textContent = controller ? controller.hint : "";
    if (ui.empty) {
      const emptyMsg = ui.empty.querySelector(".dw-empty-msg");
      if (emptyMsg) emptyMsg.textContent = controller ? controller.emptyCopy : "";
    }
    if (ui.loading) {
      const loadingMsg = ui.loading.querySelector(".designer-state-msg");
      if (loadingMsg) {
        loadingMsg.textContent = controller
          ? "Loading " + controller.badge + "\u2026"
          : "Loading diagram\u2026";
      }
    }
    if (overlay && controller) overlay.setAttribute("data-designer-lang", controller.lang);
  }

  async function mount(token) {
    clearCard();
    if (ui.overlayLayer) ui.overlayLayer.innerHTML = "";
    clearAlert();
    blocked = false;
    setStatus(STATUS_LOADING, "");
    if (typeof controller.readOnlyReason === "function") {
      let reason = null;
      try { reason = controller.readOnlyReason(target.source); } catch (_) {}
      if (reason) {
        renderChrome();
        setReadonly(reason);
        setStatus("", "");
        focusCanvas();
        return;
      }
    }
    let built;
    try {
      built = controller.buildModel(target.source);
    } catch (err) {
      if (token !== mountToken) return;
      setError("Couldn\u2019t open this " + noun() + ".", err);
      return;
    }
    if (token !== mountToken) return;
    model = built;
    renderChrome();
    try {
      controller.mountUI(model, ui);
    } catch (err) {
      if (token !== mountToken) return;
      setError("Couldn\u2019t open this " + noun() + ".", err);
      return;
    }
    try {
      await preview(true);
    } catch (err) {
      if (token !== mountToken) return;
      setError("Couldn\u2019t open this " + noun() + ".", err);
      return;
    }
    if (token !== mountToken) return;
    setState("ready");
    if (controller.afterRender) controller.afterRender(model);
    syncInspectorSheet();
    resetHistory();
    setStatus("Ready", "");
    syncApply();
    focusCanvas();
  }

  function open(controllerArg, hit) {
    if (!overlay || !controllerArg || !hit || !hit.el) return;
    if (isOpen()) { focusCanvas(); return; }
    if (!captureTarget(hit)) {
      notify("Can\u2019t open the designer for this block");
      return;
    }
    closeCompactSheet(false);
    controller = controllerArg;
    model = null;
    invoker = document.activeElement;
    overlay.hidden = false;
    if (NB.dialog) {
      // The rendered block, not a context-menu item that close() destroys.
      const fallback = target && target.parent
        ? target.parent.children[target.index] : null;
      NB.dialog.open(overlay, { fallbackFocus: fallback });
    }
    syncCompact();
    if (ui.apply) ui.apply.disabled = true;
    setStatus(STATUS_LOADING, "");
    setState("loading");
    renderChrome();
    focusCanvas();
    mount(++mountToken);
  }

  function close(force) {
    if (!overlay || !isOpen()) return;
    if (applying) return;
    if (!force && model && controller && !controller.isNoOp(model)) {
      if (!window.confirm(discardMessage())) return;
    }
    closeCompactSheet(false);
    mountToken++;
    previewToken++;
    if (controller && controller.unmountUI) {
      try { controller.unmountUI(); } catch (_) {}
    }
    clearCard();
    if (ui.overlayLayer) ui.overlayLayer.innerHTML = "";
    overlay.hidden = true;
    if (NB.dialog) NB.dialog.close(overlay);
    overlay.removeAttribute("data-designer-lang");
    setInert(false);
    if (ui.sidebar) ui.sidebar.hidden = true;
    if (ui.inspector) ui.inspector.hidden = true;
    if (ui.hint) ui.hint.hidden = true;
    model = null;
    controller = null;
    history.stack = [];
    history.index = -1;
    history.lastKind = null;
    history.lastAt = 0;
    history.restoring = false;
    updateHistoryButtons();
    applying = false;
    blocked = false;
    setState("loading");
    restoreFocus();
    target = null;
  }

  function resolveTarget() {
    if (!target || !target.parent || target.index < 0) return null;
    if (!target.parent.isConnected) return null;
    const el = target.parent.children[target.index];
    if (!el || !el.isConnected || !el.matches) return null;
    if (!controller || !el.matches(controller.containerSel)) return null;
    if (!viewerContentEl || !viewerContentEl.contains(el)) return null;
    const desc = NB.blocks && NB.blocks.forElement ? NB.blocks.forElement(el) : null;
    const src = (desc && NB.blocks.sourceOf) ? (NB.blocks.sourceOf(desc, el) || "") : "";
    if (src !== target.source) return null;
    return el;
  }

  function rawFence(lang, code) {
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.className = "language-" + lang;
    codeEl.textContent = code || "";
    pre.appendChild(codeEl);
    return pre;
  }

  function setInert(flag) {
    if (ui.sidebar) ui.sidebar.inert = !!flag;
    if (ui.inspector) ui.inspector.inert = !!flag;
  }

  function focusAfterApplyFailure() {
    const first = ui.inspectorBody &&
      ui.inspectorBody.querySelector("input, select, textarea, button");
    if (first && typeof first.focus === "function") {
      try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
      return;
    }
    focusCanvas();
  }

  async function apply() {
    if (applying || !controller || !model || !isOpen()) return;
    if (controller.isNoOp(model)) {
      setStatus(STATUS_NOOP, "");
      close(true);
      return;
    }
    const ctl = controller;
    const mod = model;
    applying = true;
    setInert(true);
    if (ui.apply) ui.apply.disabled = true;
    if (ui.cancel) ui.cancel.disabled = true;
    clearAlert();
    setStatus(STATUS_APPLYING, "");
    let candidate;
    try {
      candidate = ctl.serialize(mod);
    } catch (err) {
      applying = false;
      setInert(false);
      if (ui.cancel) ui.cancel.disabled = false;
      setStatus("Couldn\u2019t apply \u2014 invalid " + ctl.badge + " source", "error");
      alert("Couldn\u2019t apply \u2014 " + firstLine(err));
      syncApply();
      focusAfterApplyFailure();
      return;
    }
    const host = document.createElement("div");
    try {
      await ctl.renderSource(candidate, host);
    } catch (err) {
      applying = false;
      setInert(false);
      if (ui.cancel) ui.cancel.disabled = false;
      setStatus("Couldn\u2019t apply \u2014 invalid " + ctl.badge + " source", "error");
      alert("Couldn\u2019t apply \u2014 " + firstLine(err));
      syncApply();
      focusAfterApplyFailure();
      return;
    }
    if (!NB.hybrid || typeof NB.hybrid.isActive !== "function" || !NB.hybrid.isActive()) {
      applying = false;
      setInert(false);
      if (ui.cancel) ui.cancel.disabled = false;
      notify("Can\u2019t apply \u2014 the editor is no longer active");
      close(true);
      return;
    }
    const el = resolveTarget();
    if (!el) {
      applying = false;
      setInert(false);
      if (ui.cancel) ui.cancel.disabled = false;
      notify("Couldn\u2019t apply \u2014 the " + noun() + " changed");
      close(true);
      return;
    }
    if (NB.hybrid.flushPendingSnapshot) NB.hybrid.flushPendingSnapshot();
    el.replaceWith(rawFence(ctl.lang, candidate));
    try {
      await ctl.renderNote();
    } catch (_) {
      /* the raw fence round-trips through turndown as-is */
    }
    if (NB.hybrid.onContentChange) NB.hybrid.onContentChange();
    applying = false;
    setInert(false);
    if (ui.cancel) ui.cancel.disabled = false;
    close(true);
  }

  /* editSourceNow() -- the Edit source instead fallback. Never prompts
   * (product §7), closes first, then delegates to the existing inline
   * fence editor for the same block. A stale target closes with a notice. */
  function editSourceNow() {
    if (!isOpen()) return;
    const node = resolveTarget();
    if (!node) {
      notify("Couldn’t open the source — the " + noun() + " changed");
      close(true);
      return;
    }
    const hit = (NB.hybrid && typeof NB.hybrid.codeBlockAt === "function")
      ? NB.hybrid.codeBlockAt(node) : null;
    close(true);
    if (hit && NB.hybrid && typeof NB.hybrid.editPluginSource === "function") {
      NB.hybrid.editPluginSource(hit);
    }
  }

  function compactAction(action) {
    if (action === "source") { editSourceNow(); return; }
    if (action === "undo") { undo(); return; }
    if (action === "redo") { redo(); return; }
    if (action === "add" || action === "chart") {
      openCompactSheet(action, lastCompactInvoker);
    }
  }

  document.addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (isCompactSheetOpen()) closeCompactSheet(true);
      else close(false);
      return;
    }
    const key = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
      const t = e.target;
      const editable = t && (
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" || t.isContentEditable ||
        (t.closest && t.closest("input, textarea, select, [contenteditable='true']"))
      );
      if (!editable) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (key === "z" && e.shiftKey) redo();
        else if (key === "z") undo();
        else if (key === "y") redo();
      }
      return;
    }
  });

  function retry() {
    if (!isOpen()) return;
    clearAlert();
    blocked = false;
    setStatus(STATUS_LOADING, "");
    setState("loading");
    mount(++mountToken);
  }

  if (ui.apply) ui.apply.addEventListener("click", apply);
  if (ui.undo) ui.undo.addEventListener("click", undo);
  if (ui.redo) ui.redo.addEventListener("click", redo);
  if (ui.cancel) ui.cancel.addEventListener("click", function () { close(false); });
  if (ui.close) ui.close.addEventListener("click", function () { close(false); });
  if (ui.retry) ui.retry.addEventListener("click", retry);
  if (ui.errorEditSource) ui.errorEditSource.addEventListener("click", editSourceNow);
  if (ui.readonlyEditSource) {
    ui.readonlyEditSource.addEventListener("click", editSourceNow);
  }
  let lastCompactInvoker = null;
  if (ui.compactNav) {
    ui.compactNav.addEventListener("click", function (e) {
      const button = e.target.closest("[data-compact]");
      if (!button) return;
      lastCompactInvoker = button;
      compactAction(button.dataset.compact);
    });
  }
  if (ui.sheetClose) {
    ui.sheetClose.addEventListener("click", function () {
      closeCompactSheet(true);
    });
  }
  if (ui.editSource) ui.editSource.addEventListener("click", editSourceNow);
  if (ui.alert) {
    const dismiss = ui.alert.querySelector(".designer-alert-dismiss");
    if (dismiss) dismiss.addEventListener("click", clearAlert);
  }
  if (ui.inspectorClear) ui.inspectorClear.addEventListener("click", function () {
    if (controller && controller.clearSelection) controller.clearSelection();
  });
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close(false);
    });
  }

  window.addEventListener("resize", syncCompact);
  syncCompact();

  NB.designerShell = {
    open: open,
    close: close,
    isOpen: isOpen,
    alert: alert,
    clearAlert: clearAlert,
    setStatus: setStatus,
    markDirty: markDirty,
    setBlocked: setBlocked,
    preview: preview,
    editSourceNow: editSourceNow,
    syncCompact: syncCompact,
    syncInspectorSheet: syncInspectorSheet,
    ui: ui,
  };
})();
