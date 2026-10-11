/* mermaid-designer.js -- the in-app visual Mermaid editor ("designer").
 *
 * Opened from the hybrid (WYSIWYG) right-click menu's "Design diagram…"
 * item. It is a modal that renders the diagram THROUGH our own vendored
 * mermaid (via the injected-mermaid adapter in mermaid.js) and writes
 * plain Mermaid text back into the note on Apply. The note itself is
 * never touched until Apply; Cancel/Esc/backdrop write nothing.
 *
 * The third-party canvas (Visimer) is lazy-loaded: the ~264 KB bundle is
 * fetched only when the modal first opens, so note loading stays cheap.
 * All library calls live here; mermaid.js owns the renderer + adapter.
 *
 * Write-back is the hybrid DOM path, in a fixed order (F1/F3/F5):
 *   validate -> guard hybrid mode -> re-resolve the target -> swap in a
 *   raw fence -> await the re-render -> mark the editor dirty.
 * The held element is never trusted across the modal's lifetime because
 * the note can re-render underneath it.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const BUNDLE_SRC = "/static/vendor/visimer.bundle.js";
  const FENCE_LANG = "mermaid";
  const CONTAINER_SEL = ".mermaid-container, .mermaid-error";
  const TOAST_MS = 4000;
  // Seed used when the source is an empty ```mermaid block: opening it must
  // start a blank flowchart the user can build on, not fail as "not
  // editable". The baseline for the no-op guard is this seed when seeded, so
  // Apply-with-no-edits still writes nothing and the block stays empty.
  const EMPTY_SEED = "flowchart TD\n";
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* Add-sidebar palette. The 14 node shapes MermaidCanvasView.addNode()
   * accepts; the title carries the Mermaid syntax the shape produces.
   * `label` is the grid caption, `aria` the full accessible name, and
   * `id` doubles as the SHAPE_GLYPHS key so the button shows the shape. */
  const FLOWCHART_SHAPES = [
    { id: "rect", label: "Rect", aria: "Add rectangle node", title: "Rectangle \u00b7 n1[N]" },
    { id: "round", label: "Round", aria: "Add rounded rectangle node", title: "Rounded \u00b7 n1(N)" },
    { id: "stadium", label: "Stadium", aria: "Add stadium node", title: "Stadium \u00b7 n1([N])" },
    { id: "subroutine", label: "Subrtn", aria: "Add subroutine node", title: "Subroutine \u00b7 n1[[N]]" },
    { id: "cylinder", label: "Cylinder", aria: "Add cylinder (database) node", title: "Cylinder / database \u00b7 n1[(N)]" },
    { id: "circle", label: "Circle", aria: "Add circle node", title: "Circle \u00b7 n1((N))" },
    { id: "doublecircle", label: "Double", aria: "Add double circle node", title: "Double circle \u00b7 n1(((N)))" },
    { id: "diamond", label: "Decision", aria: "Add diamond node", title: "Decision \u00b7 n1{N}" },
    { id: "hexagon", label: "Hexagon", aria: "Add hexagon node", title: "Hexagon \u00b7 n1{{N}}" },
    { id: "lean_r", label: "Lean R", aria: "Add lean-right node", title: "Lean right \u00b7 n1[/N/]" },
    { id: "lean_l", label: "Lean L", aria: "Add lean-left node", title: "Lean left \u00b7 n1[\\N\\]" },
    { id: "trap_t", label: "Trap T", aria: "Add trapezoid-top node", title: "Trapezoid top \u00b7 n1[\\N/]" },
    { id: "trap_b", label: "Trap B", aria: "Add trapezoid-bottom node", title: "Trapezoid bottom \u00b7 n1[/N\\]" },
    { id: "odd", label: "Odd", aria: "Add asymmetric node", title: "Odd \u00b7 n1>N]" },
  ];

  /* Inline SVG inner markup per shape, drawn in a 16x16 box. Each glyph
   * mirrors the Mermaid outline: the rect family differs only in corner
   * radius, subroutine adds the two inner borders, cylinder an elliptical
   * rim, doublecircle a second ring; the lean pairs are mirrored
   * parallelograms and the trap pair mirrored trapezoids; `odd` is the
   * asymmetric pennant (point on the left). Kept as strings so the shape
   * table above stays the single source of the id -> presentation mapping. */
  const SHAPE_GLYPHS = {
    rect: '<rect x="2.5" y="4.5" width="11" height="7"/>',
    round: '<rect x="2.5" y="4.5" width="11" height="7" rx="2.5"/>',
    stadium: '<rect x="2.5" y="4.5" width="11" height="7" rx="3.5"/>',
    subroutine: '<rect x="2.5" y="4.5" width="11" height="7"/>' +
      '<path d="M4.8 4.5v7M11.2 4.5v7"/>',
    cylinder: '<path d="M2.5 5.5v5a5.5 1.5 0 0 0 11 0v-5"/>' +
      '<ellipse cx="8" cy="5.5" rx="5.5" ry="1.5"/>',
    circle: '<circle cx="8" cy="8" r="4.7"/>',
    doublecircle: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="3.2"/>',
    diamond: '<path d="M8 3l6 5-6 5-6-5z"/>',
    hexagon: '<path d="M5.5 4.5h5l3 3.5-3 3.5h-5l-3-3.5z"/>',
    lean_r: '<path d="M5.5 4.5h8l-3 7h-8z"/>',
    lean_l: '<path d="M2.5 4.5h8l3 7h-8z"/>',
    trap_t: '<path d="M2.5 4.5h11l-2.5 7h-6z"/>',
    trap_b: '<path d="M5.5 4.5h5l3 7h-11z"/>',
    odd: '<path d="M2.5 8l3-3.5h8v7h-8z"/>',
  };

  /* Tool/history/add glyphs. The tool icons live inline in index.html;
   * this table is used only for the dynamically built non-flowchart add
   * button, which pairs the "+" glyph with its label. */
  const ADD_ICON = '<path d="M8 3.5v9M3.5 8h9"/>';

  /* Families whose canvas supports drag-to-connect (the library wires the
   * entity prefixes node:/state:/class:/entity:). Every other family hides
   * the Connect tool. Sequence connects through the library's lifeline
   * "+" buttons instead. */
  const CONNECTABLE = ["flowchart", "state", "class", "er"];

  /* Field defaults for the single-action add buttons. The library treats
   * every one as optional; naming them here keeps magic strings out of the
   * op builders. */
  const ADD_DEFAULTS = {
    stateLabel: "New state",
    className: "NewClass",
    entityName: "NewEntity",
    sliceLabel: "New slice",
    sliceValue: 10,
    ganttSection: "",
    ganttName: "New task",
    ganttMeta: "1d",
    participantName: "NewParticipant",
  };

  /* family -> the one labelled add button, backed by editor.dispatch(). The
   * generic line-item family omits `text` so the library's own per-type
   * addTemplate supplies a sensible line. */
  const ADD_ACTIONS = {
    state: { label: "Add state", op: function () { return { type: "st.addState", label: ADD_DEFAULTS.stateLabel }; } },
    class: { label: "Add class", op: function () { return { type: "cl.addClass", name: ADD_DEFAULTS.className }; } },
    er: { label: "Add entity", op: function () { return { type: "er.addEntity", name: ADD_DEFAULTS.entityName }; } },
    pie: { label: "Add slice", op: function () { return { type: "pie.addSlice", label: ADD_DEFAULTS.sliceLabel, value: ADD_DEFAULTS.sliceValue }; } },
    gantt: { label: "Add task", op: function () { return { type: "gantt.addTask", section: ADD_DEFAULTS.ganttSection, name: ADD_DEFAULTS.ganttName, meta: ADD_DEFAULTS.ganttMeta }; } },
    sequence: { label: "Add participant", op: function () { return { type: "seq.addParticipant", name: ADD_DEFAULTS.participantName }; } },
    lineitem: { label: "Add line", op: function () { return { type: "li.addItem" }; } },
  };

  const overlay = document.getElementById("designer-overlay");
  const modalEl = overlay && overlay.querySelector(".settings-modal");
  const canvasEl = document.getElementById("designer-canvas");
  const typeEl = document.getElementById("designer-type");
  const statusEl = document.getElementById("designer-status");
  const applyBtn = document.getElementById("designer-apply");
  const cancelBtn = document.getElementById("designer-cancel");
  const closeBtn = document.getElementById("designer-close");
  const retryBtn = document.getElementById("designer-retry");
  const editSrcBtn = document.getElementById("designer-edit-source");
  const hintEl = document.getElementById("designer-hint");
  const emptyEl = document.getElementById("designer-empty");
  const errorMsgEl = document.getElementById("designer-error-msg");
  const errorDetEl = document.getElementById("designer-error-detail");
  const toolSelectBtn = document.getElementById("designer-tool-select");
  const toolConnectBtn = document.getElementById("designer-tool-connect");
  const undoBtn = document.getElementById("designer-undo");
  const redoBtn = document.getElementById("designer-redo");
  const sidebarEl = document.getElementById("designer-sidebar");
  const addTitleEl = document.getElementById("designer-add-title");
  const paletteEl = document.getElementById("designer-palette");

  // The four mutually exclusive canvas-state overlays (the empty overlay
  // is separate: it is pointer-events:none chrome that coexists with ready).
  const STATE_EL = {
    loading: document.getElementById("designer-loading"),
    error: document.getElementById("designer-error"),
    readonly: document.getElementById("designer-readonly"),
    ready: null,
  };

  const viewerContentEl = document.getElementById("viewer-content");

  let editor = null;          // Visimer.MermaidWysiwygEditor
  let view = null;            // Visimer.MermaidCanvasView
  let unsubChange = null;     // editor "change" unsubscribe
  let target = null;          // {parent, index, source} captured at open
  let openSource = "";        // source at open
  let baselineSource = "";    // no-op baseline (EMPTY_SEED when the block was empty)
  let hitRef = null;          // the hybrid codeBlockAt hit (for Edit source)
  let invoker = null;         // focused element at open (focus return)
  let applying = false;
  let mountToken = 0;         // invalidates stale async mounts
  let stateName = "loading";  // loading | error | readonly | ready
  let paletteFamily = null;   // current add-sidebar family, or null
  let connectable = false;    // whether the Connect tool applies to the type

  function isOpen() { return !!overlay && !overlay.hidden; }

  /* --- small helpers ---------------------------------------------- */

  function notify(msg, cls) {
    if (NB.app && NB.app.notify) NB.app.notify(msg, TOAST_MS, cls || "warn");
  }

  function firstLine(err) {
    if (!err) return "";
    return String(err.message || err).split(/\r?\n/)[0].slice(0, 300);
  }

  function accentColor() {
    try {
      const v = getComputedStyle(document.body).getPropertyValue("--accent").trim();
      return v || undefined;
    } catch (_) {
      return undefined;
    }
  }

  function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "designer-status" + (cls ? " " + cls : "");
  }

  function setState(name) {
    stateName = name;
    for (const k in STATE_EL) {
      const el = STATE_EL[k];
      if (el) el.hidden = (k !== name);
    }
    // The canvas stays in the layout (and focusable) underneath; the four
    // opaque state overlays cover it. Hiding it with visibility would make
    // the open-time focus() land nowhere.
    if (hintEl) hintEl.hidden = (name !== "ready");
    if (emptyEl) emptyEl.hidden = true;   // re-shown by onRender when empty
    if (sidebarEl) sidebarEl.hidden = !(name === "ready" && !!paletteFamily);
    if (applyBtn) applyBtn.disabled = (name !== "ready");
    // The hint is the meaningful description only in the ready state.
    if (modalEl) {
      if (name === "ready") modalEl.setAttribute("aria-describedby", "designer-hint");
      else modalEl.removeAttribute("aria-describedby");
    }
  }

  function setNotEditable() {
    // F6: a type the library can render but not edit (or an undetected
    // type). One inline notice with a single fallback button.
    if (errorMsgEl) {
      errorMsgEl.textContent =
        "This diagram can\u2019t be edited visually \u2014 edit the source instead.";
    }
    if (errorDetEl) { errorDetEl.textContent = ""; errorDetEl.hidden = true; }
    if (retryBtn) retryBtn.hidden = true;
    if (editSrcBtn) editSrcBtn.hidden = false;
    setState("error");
  }

  function setError(msg, detail) {
    if (errorMsgEl) errorMsgEl.textContent = msg || "The diagram failed to render.";
    if (errorDetEl) {
      if (detail) { errorDetEl.textContent = detail; errorDetEl.hidden = false; }
      else { errorDetEl.textContent = ""; errorDetEl.hidden = true; }
    }
    if (retryBtn) retryBtn.hidden = false;
    if (editSrcBtn) editSrcBtn.hidden = false;
    setState("error");
  }

  /* Whether the model has no editable entities (drives the empty-state
   * hint). Different diagram families report their contents differently,
   * so probe the ones the core parser exposes. */
  function modelEmpty(ed) {
    const r = ed && ed.result;
    if (!r) return false;
    if (r.flowchart) return r.flowchart.nodes.length === 0;
    if (r.sequence) return r.sequence.participants.length === 0 && r.sequence.events.length === 0;
    if (r.state) return r.state.states.length === 0 && r.state.transitions.length === 0;
    if (r.classGraph) return r.classGraph.classes.length === 0 && r.classGraph.relations.length === 0;
    if (r.er) return r.er.entities.length === 0 && r.er.relations.length === 0;
    if (r.pie) return r.pie.slices.length === 0;
    if (r.gantt) return r.gantt.tasks.length === 0;
    if (r.lineItems) return r.lineItems.items.length === 0;
    return false;
  }

  function updateStatus() {
    if (applying) return;
    if (!editor) return;
    if (editor.code === baselineSource) setStatus("Ready", "");
    else setStatus("Unsaved changes", "");
  }

  /* The sidebar tool buttons (Select / Connect) and history buttons
   * (Undo / Redo). Visimer exposes setTool()/undo()/redo() as methods only,
   * so the UI is ours and reflects state from the library's own events. */
  function setActiveTool(tool) {
    if (toolSelectBtn) toolSelectBtn.setAttribute("aria-pressed", String(tool === "select"));
    if (toolConnectBtn) toolConnectBtn.setAttribute("aria-pressed", String(tool === "connect"));
  }

  function updateHistoryButtons() {
    const canUndo = !!(editor && editor.canUndo);
    const canRedo = !!(editor && editor.canRedo);
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
  }

  function resetToolbar() {
    setActiveTool("select");
    updateHistoryButtons();
  }

  /* --- add-sidebar palette ----------------------------------------- */

  /* Map the mounted editor's parsed model to a palette family. The result
   * carries one non-null graph object per parsed family; `lineItems` marks
   * the generic line-item types. info.id is the fallback. */
  function familyFor(ed, info) {
    const r = ed && ed.result;
    if (r) {
      if (r.flowchart) return "flowchart";
      if (r.sequence) return "sequence";
      if (r.state) return "state";
      if (r.classGraph) return "class";
      if (r.er) return "er";
      if (r.pie) return "pie";
      if (r.gantt) return "gantt";
      if (r.lineItems) return "lineitem";
    }
    const id = info && info.id;
    if (id === "flowchart" || id === "graph") return "flowchart";
    if (ADD_ACTIONS[id]) return id;
    return null;
  }

  /* An inline SVG in the shared 16x16 icon box. `inner` is trusted static
   * markup from SHAPE_GLYPHS / ADD_ICON, never note content. currentColor
   * is inherited so the glyph follows the button's hover/active color. */
  function iconSvg(inner) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = inner || "";
    return svg;
  }

  /* One flowchart shape cell: its SVG glyph over a short caption. */
  function shapeButton(shape, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "designer-shape";
    b.title = shape.title;
    b.setAttribute("aria-label", shape.aria);
    b.appendChild(iconSvg(SHAPE_GLYPHS[shape.id] || ""));
    const cap = document.createElement("span");
    cap.className = "designer-shape-caption";
    cap.textContent = shape.label;
    b.appendChild(cap);
    b.addEventListener("click", onClick);
    return b;
  }

  /* One non-flowchart add button: a "+" glyph then the label text. */
  function addButton(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "designer-add";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.appendChild(iconSvg(ADD_ICON));
    b.appendChild(document.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  }

  /* Reset the sidebar to its hidden, empty state and restore the default
   * Connect tool visibility. Called on destroy and before every rebuild. */
  function clearPalette() {
    paletteFamily = null;
    connectable = false;
    if (paletteEl) paletteEl.innerHTML = "";
    if (addTitleEl) addTitleEl.textContent = "";
    if (sidebarEl) sidebarEl.hidden = true;
    if (toolConnectBtn) { toolConnectBtn.hidden = false; toolConnectBtn.disabled = false; }
  }

  /* Build the palette for the mounted type. Flowchart gets a 14-shape grid
   * (view.addNode opens the inline label editor); every other editable
   * family gets one dispatch()-backed button. Shown by setState("ready"). */
  function buildPalette(ed, info) {
    clearPalette();
    const family = familyFor(ed, info);
    paletteFamily = family;
    connectable = CONNECTABLE.indexOf(family) !== -1;
    if (toolConnectBtn) {
      toolConnectBtn.hidden = !connectable;
      toolConnectBtn.disabled = !connectable;
    }
    if (!paletteEl || !family) return;
    if (family === "flowchart") {
      if (addTitleEl) addTitleEl.textContent = "Shapes";
      const grid = document.createElement("div");
      grid.className = "designer-shapes";
      FLOWCHART_SHAPES.forEach(function (shape) {
        grid.appendChild(shapeButton(shape, toolAction(function (v) {
          v.addNode(shape.id);
        })));
      });
      paletteEl.appendChild(grid);
      return;
    }
    const action = ADD_ACTIONS[family];
    if (!action) { paletteFamily = null; return; }
    if (addTitleEl) addTitleEl.textContent = "Add";
    paletteEl.appendChild(addButton(action.label, toolAction(function (v, ed2) {
      if (ed2) ed2.dispatch(action.op());
    })));
  }

  /* --- capability probe (used by hybrid's menu gate) --------------- */

  /* capabilityFor(source) -> "edit" | "render" | null.
   * Returns null when the Visimer bundle is not loaded yet (a cold menu
   * open): the failure is not knowable at menu time, so the item stays
   * enabled and the modal surfaces the truth. When the bundle IS loaded
   * we can disable the render-only item up front. */
  function capabilityFor(source) {
    const V = window.Visimer;
    if (!V || typeof V.parse !== "function") return null;
    try {
      const r = V.parse(source || "");
      return (r && r.typeInfo) ? r.typeInfo.capability : null;
    } catch (_) {
      return null;
    }
  }

  /* --- open / close ------------------------------------------------- */

  function captureTarget(hit) {
    const el = hit && hit.el;
    const parent = el && el.parentNode;
    if (!el || !parent) return false;
    const index = Array.prototype.indexOf.call(parent.children, el);
    if (index < 0) return false;
    const source = (hit.plugin && hit.plugin.src) ? (hit.plugin.src(el) || "") : "";
    target = { parent: parent, index: index, source: source };
    openSource = source;
    // An empty fence opens on the seeded blank flowchart; the baseline is
    // the seed so an untouched Apply still leaves the block as it was.
    baselineSource = (source.trim() === "") ? EMPTY_SEED : source;
    return true;
  }

  function open(hit) {
    if (!overlay || !hit || !hit.el) return;
    if (isOpen()) { focusCanvas(); return; }   // never open twice
    if (!captureTarget(hit)) {
      notify("Can\u2019t open the designer for this block");
      return;
    }
    hitRef = hit;
    invoker = document.activeElement;
    overlay.hidden = false;
    setStatus("Loading\u2026", "");
    setState("loading");
    focusCanvas();
    mount(++mountToken);
  }

  function close() {
    if (!overlay) return;
    destroyView();
    overlay.hidden = true;
    setState("loading");   // reset for the next open
    restoreFocus();
  }

  function destroyView() {
    if (unsubChange) { try { unsubChange(); } catch (_) {} unsubChange = null; }
    if (view) { try { view.destroy(); } catch (_) {} view = null; }
    editor = null;
    if (canvasEl) canvasEl.innerHTML = "";
    resetToolbar();
    clearPalette();
  }

  function focusCanvas() {
    if (canvasEl && canvasEl.focus) {
      try { canvasEl.focus({ preventScroll: true }); } catch (_) { canvasEl.focus(); }
    }
  }

  function restoreFocus() {
    const el = invoker;
    invoker = null;
    // The invoker is usually the hybrid menu item, which the menu hides on
    // click; focusing it would go nowhere. Fall back to the diagram block
    // so keyboard focus lands back in the note.
    const inMenu = el && el.closest && el.closest(".context-menu, #hybrid-context-menu");
    if (el && el.isConnected && !inMenu && typeof el.focus === "function") {
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

  /* --- mount the library ------------------------------------------- */

  async function mount(token) {
    destroyView();
    // 1. Lazy-load the Visimer bundle (F9: on failure, toast + close).
    try {
      await NB.lazyload.script(BUNDLE_SRC);
    } catch (_) {
      if (token !== mountToken) return;
      notify("The diagram editor couldn\u2019t be loaded");
      close();
      return;
    }
    if (token !== mountToken) return;
    if (!window.Visimer || typeof window.Visimer.MermaidWysiwygEditor !== "function") {
      setError("The diagram editor couldn\u2019t be loaded.", "");
      return;
    }
    // 2. The canvas calls mermaid.initialize synchronously in its
    //    constructor, so mermaid itself must be present first.
    let ready = false;
    try { ready = await NB.mermaid.whenReady(); } catch (_) { ready = false; }
    if (token !== mountToken) return;
    if (!ready || !window.mermaid) {
      setError("The diagram renderer couldn\u2019t be loaded.", "");
      return;
    }
    // 3. Build the headless editor and read its capability.
    let ed;
    try {
      ed = new window.Visimer.MermaidWysiwygEditor({ code: baselineSource });
    } catch (err) {
      setError("The diagram couldn\u2019t be opened.", firstLine(err));
      return;
    }
    const info = (ed.result && ed.result.typeInfo) ? ed.result.typeInfo : null;
    if (!info || info.capability !== "edit") {
      setNotEditable();
      return;
    }
    editor = ed;
    if (typeEl) typeEl.textContent = info.id || "";
    buildPalette(ed, info);
    // 4. Mount the interactive canvas through our mermaid adapter.
    try {
      view = new window.Visimer.MermaidCanvasView({
        editor: ed,
        container: canvasEl,
        mermaid: NB.mermaid.designerMermaid(),
        mermaidConfig: {},
        readOnly: false,
        panZoom: true,
        accentColor: accentColor(),
        defaultEdge: { line: "solid", arrowEnd: "arrow" },
      });
    } catch (err) {
      editor = null;
      setError("The diagram couldn\u2019t be opened.", firstLine(err));
      return;
    }
    view.on("toolChange", function (tool) { setActiveTool(tool); });
    setActiveTool("select");
    updateHistoryButtons();
    unsubChange = ed.on("change", function () {
      if (emptyEl) emptyEl.hidden = !(stateName === "ready" && modelEmpty(ed));
      updateStatus();
      updateHistoryButtons();
    });
    view.on("render", function (payload) {
      if (token !== mountToken || !isOpen()) return;
      if (payload && payload.ok === false) {
        setError("The diagram failed to render.", firstLine(payload.error));
        return;
      }
      setState("ready");
      if (emptyEl) emptyEl.hidden = !modelEmpty(ed);
      updateStatus();
    });
    // The library renders in its constructor; render() here is a no-op if
    // that first pass already completed and dedupes on unchanged code.
    try { await view.render(); } catch (_) { /* the render event reports */ }
  }

  function retry() {
    if (!isOpen()) return;
    setStatus("Loading\u2026", "");
    setState("loading");
    mount(++mountToken);
  }

  /* --- Apply (the only note write) ---------------------------------- */

  function rawFence(code) {
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.className = "language-" + FENCE_LANG;
    codeEl.textContent = code || "";
    pre.appendChild(codeEl);
    return pre;
  }

  /* Read a rendered block's original source through the block registry,
   * which owns the container-vs-error-box lookup and the descriptor's
   * sourceClass. Re-implementing it here could drift from the hybrid
   * round-trip's extractor. */
  function sourceOf(el) {
    if (!NB.blocks) return "";
    const d = (NB.blocks.forElement && NB.blocks.forElement(el)) ||
      (NB.blocks.forLang && NB.blocks.forLang(FENCE_LANG));
    return (d && NB.blocks.sourceOf) ? NB.blocks.sourceOf(d, el) : "";
  }

  /* Re-resolve the captured target (F1). A held element does not survive a
   * re-render, so look the block up by parent-relative index and verify it
   * is still the same source. Any mismatch aborts the write. */
  function resolveTarget() {
    if (!target || !target.parent || target.index < 0) return null;
    // F1/Fix 1: require the captured parent and the resolved block to still
    // be connected and inside the live viewer. Without this an external
    // re-render leaves a matching container in the detached subtree, and
    // Apply would mutate that tree -- re-rendering nothing, losing the edit
    // on save.
    if (!target.parent.isConnected) return null;
    const el = target.parent.children[target.index];
    if (!el || !el.isConnected || !el.matches || !el.matches(CONTAINER_SEL)) return null;
    if (!viewerContentEl || !viewerContentEl.contains(el)) return null;
    if (sourceOf(el) !== target.source) return null;
    return el;
  }

  async function apply() {
    if (applying || !editor || !isOpen()) return;
    const code = editor.code;
    if (code === baselineSource) {
      setStatus("No changes to apply", "");
      close();
      return;
    }
    applying = true;
    if (applyBtn) applyBtn.disabled = true;
    setStatus("Applying\u2026", "");
    // F5: reject invalid Mermaid before touching the note; stay open.
    try {
      await window.mermaid.parse(code);
    } catch (err) {
      applying = false;
      if (applyBtn) applyBtn.disabled = false;
      setStatus("Couldn\u2019t apply \u2014 invalid diagram", "error");
      setError("The diagram failed to validate.", firstLine(err));
      return;
    }
    // F3: an external edit can exit hybrid while the modal is open.
    if (!NB.hybrid || typeof NB.hybrid.isActive !== "function" || !NB.hybrid.isActive()) {
      applying = false;
      notify("Can\u2019t apply \u2014 the editor is no longer active");
      close();
      return;
    }
    // F1: re-resolve + source-verify.
    const el = resolveTarget();
    if (!el) {
      applying = false;
      notify("Couldn\u2019t apply \u2014 the diagram changed");
      close();
      return;
    }
    // Swap the rendered block for a raw fence, then await the re-render so
    // the debounced history snapshot (and the no-op baseline) capture the
    // rendered container, not the raw fence (F3). One onContentChange is
    // one undo step (F8).
    // Fix 2: commit any debounced typing snapshot first, so the diagram
    // write is its own undo step instead of coalescing with prior keystrokes.
    if (NB.hybrid && typeof NB.hybrid.flushPendingSnapshot === "function") {
      NB.hybrid.flushPendingSnapshot();
    }
    el.replaceWith(rawFence(code));
    try { await NB.mermaid.renderAll(viewerContentEl); } catch (_) {}
    if (NB.hybrid && typeof NB.hybrid.onContentChange === "function") {
      NB.hybrid.onContentChange();
    }
    applying = false;
    close();
  }

  /* --- keyboard: Esc, Ctrl/Cmd+Z isolation, focus trap -------------- */

  function focusables() {
    if (!modalEl) return [];
    return Array.from(modalEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function trapTab(e) {
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  document.addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
      // The canvas owns undo/redo while focused (the library's own handler
      // already ran); only forward when focus is elsewhere. Either way the
      // note's history must never see this key (F2 + architecture test 9).
      e.preventDefault();
      e.stopPropagation();
      if (!editor) return;
      if (canvasEl && canvasEl.contains(e.target)) return;
      if (e.shiftKey) editor.redo(); else editor.undo();
      return;
    }
    if (e.key === "Tab") trapTab(e);
  });

  /* --- wiring ------------------------------------------------------- */

  function editSourceFallback() {
    // Fix 5: the held hit's element may have been replaced by a re-render.
    // Re-resolve from the live DOM via codeBlockAt (it rejects detached
    // nodes, so a stale block safely no-ops) before delegating.
    let node = (hitRef && hitRef.el) || null;
    if (target && target.parent && target.parent.children) {
      const live = target.parent.children[target.index];
      if (live) node = live;
    }
    const hit = (node && NB.hybrid && typeof NB.hybrid.codeBlockAt === "function")
      ? NB.hybrid.codeBlockAt(node) : null;
    close();
    if (hit && NB.hybrid && typeof NB.hybrid.editPluginSource === "function") {
      NB.hybrid.editPluginSource(hit);
    }
  }

  if (applyBtn) applyBtn.addEventListener("click", apply);
  if (cancelBtn) cancelBtn.addEventListener("click", close);
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (retryBtn) retryBtn.addEventListener("click", retry);
  if (editSrcBtn) editSrcBtn.addEventListener("click", editSourceFallback);

  // Tool row actions. Each is a no-op unless the canvas is live.
  function toolAction(fn) {
    return function () { if (view && stateName === "ready") fn(view, editor); };
  }
  if (toolSelectBtn) toolSelectBtn.addEventListener("click", toolAction(function (v) { v.setTool("select"); }));
  if (toolConnectBtn) toolConnectBtn.addEventListener("click", toolAction(function (v) { v.setTool("connect"); }));
  if (undoBtn) undoBtn.addEventListener("click", toolAction(function (v, ed) { if (ed) ed.undo(); }));
  if (redoBtn) redoBtn.addEventListener("click", toolAction(function (v, ed) { if (ed) ed.redo(); }));
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();   // backdrop click
    });
  }

  NB.mermaidDesign = { open, close, isOpen, apply, capabilityFor };
})();
