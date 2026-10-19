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
 *   no-op check -> validate -> guard hybrid mode -> re-resolve the target
 *   -> swap in a raw fence -> await the re-render -> mark the editor dirty.
 * The held element is never trusted across the modal's lifetime because
 * the note can re-render underneath it.
 *
 * The edit UI is three regions for the three scoped families
 * (flowchart, sequence, pie): a build sidebar, the canvas stage, and a
 * contextual inspector. Every required edit has a named control there;
 * the vendor popover is hidden. Other families keep the add-only palette.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const BUNDLE_SRC = "/static/vendor/visimer.bundle.js";
  const FENCE_LANG = "mermaid";
  const CONTAINER_SEL = ".mermaid-container, .mermaid-error";
  const TOAST_MS = 4000;
  const EMPTY_SEED = "flowchart TD\n";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DISCARD_MESSAGE =
    "Discard unsaved diagram changes? The note will stay unchanged.";

  /* The three families that get the inspector + type-specific add forms.
   * Everything else keeps the original add-only sidebar. */
  const SCOPED_FAMILIES = ["flowchart", "sequence", "pie"];
  const FAMILY_LABEL = { flowchart: "Flowchart", sequence: "Sequence", pie: "Pie" };
  const FAMILY_HINT = {
    flowchart: "Select a node or edge to edit it \u00b7 use Add to create one",
    sequence: "Select a participant, message, or note \u00b7 use Add to create one",
    pie: "Select a slice to edit it \u00b7 use Add to create one",
  };
  const FAMILY_REST = {
    flowchart: "Select a node or edge on the canvas. Node edits: label, shape, " +
      "connect, delete. Edge edits: label, line, arrows, reverse, delete.",
    sequence: "Select a participant, message, or note. Participant edits: name, " +
      "type, message, delete. Message edits: text, arrow, order, reverse, delete.",
    pie: "Select a slice to edit its label and value. The title stays in the source.",
  };
  const DEFAULT_EMPTY_COPY = "Use the palette to add your first item.";
  const EMPTY_COPY = {
    flowchart: "Add your first node from the sidebar.",
    sequence: "Add your first participant from the sidebar.",
    pie: "Add your first slice from the sidebar.",
  };
  const PIE_TITLE_NOTE =
    "Title is kept from the source. Editing it visually is deferred.";

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

  /* Inline SVG inner markup per shape, drawn in a 16x16 box. */
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

  const ADD_ICON = '<path d="M8 3.5v9M3.5 8h9"/>';

  /* Families whose canvas supports drag-to-connect. */
  const CONNECTABLE = ["flowchart", "state", "class", "er"];

  /* Field defaults for the single-action add buttons (non-scoped families). */
  const ADD_DEFAULTS = {
    stateLabel: "New state",
    className: "NewClass",
    entityName: "NewEntity",
    ganttSection: "",
    ganttName: "New task",
    ganttMeta: "1d",
  };

  /* family -> the one labelled add button, backed by editor.dispatch(). */
  const ADD_ACTIONS = {
    state: { label: "Add state", op: function () { return { type: "st.addState", label: ADD_DEFAULTS.stateLabel }; } },
    class: { label: "Add class", op: function () { return { type: "cl.addClass", name: ADD_DEFAULTS.className }; } },
    er: { label: "Add entity", op: function () { return { type: "er.addEntity", name: ADD_DEFAULTS.entityName }; } },
    gantt: { label: "Add task", op: function () { return { type: "gantt.addTask", section: ADD_DEFAULTS.ganttSection, name: ADD_DEFAULTS.ganttName, meta: ADD_DEFAULTS.ganttMeta }; } },
    lineitem: { label: "Add line", op: function () { return { type: "li.addItem" }; } },
  };

  const DIRECTIONS = [
    { id: "TD", label: "Top-down (TD)" },
    { id: "TB", label: "Top-bottom (TB)" },
    { id: "BT", label: "Bottom-top (BT)" },
    { id: "LR", label: "Left-right (LR)" },
    { id: "RL", label: "Right-left (RL)" },
  ];

  const EDGE_LINES = [
    { id: "solid", label: "Solid" },
    { id: "dotted", label: "Dotted" },
    { id: "thick", label: "Thick" },
  ];

  /* The inspector presents head styles as one choice. Each maps to the
   * model's (arrowStart, arrowEnd) pair; `connect` only accepts arrowEnd,
   * so a start head or double head is completed with setEdgeStyle. */
  const ARROW_STYLES = [
    { id: "none", label: "No arrow", start: "open", end: "open" },
    { id: "arrow", label: "Arrow", start: "open", end: "arrow" },
    { id: "double", label: "Double", start: "arrow", end: "arrow" },
    { id: "cross", label: "Cross", start: "open", end: "cross" },
    { id: "doublecross", label: "Double cross", start: "cross", end: "cross" },
    { id: "dot", label: "Dot", start: "open", end: "circle" },
    { id: "doubledot", label: "Double dot", start: "circle", end: "circle" },
  ];

  const PARTICIPANT_TYPES = [
    { id: "participant", label: "Participant" },
    { id: "actor", label: "Actor" },
    { id: "boundary", label: "Boundary" },
    { id: "control", label: "Control" },
    { id: "entity", label: "Entity" },
    { id: "database", label: "Database" },
    { id: "collections", label: "Collections" },
    { id: "queue", label: "Queue" },
  ];

  const MESSAGE_OPS = [
    { id: "->", label: "Solid line (->)" },
    { id: "->>", label: "Solid arrow (->>)" },
    { id: "-->", label: "Dotted line (-->)" },
    { id: "-->>", label: "Dotted arrow (-->>)" },
    { id: "-x", label: "Solid cross (-x)" },
    { id: "--x", label: "Dotted cross (--x)" },
    { id: "-)", label: "Solid async (-)" },
    { id: "--)", label: "Dotted async (--)" },
  ];

  const NOTE_PLACEMENTS = [
    { id: "over", label: "Over" },
    { id: "left of", label: "Left of" },
    { id: "right of", label: "Right of" },
  ];

  /* A participant with no alias uses its name as the Mermaid id, so the
   * name must be a safe id. An alias may contain spaces, but separators
   * still break the statement. */
  const PARTICIPANT_ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  const PARTICIPANT_NAME_BAD_RE = /[,;:\r\n]/;

  const POSITION_END = "end";
  const POSITION_START = "start";
  const POSITION_AFTER_PREFIX = "after:";

  const ADD_TABS = {
    flowchart: [{ id: "node", label: "Node" }, { id: "edge", label: "Edge" }],
    sequence: [
      { id: "participant", label: "Participant" },
      { id: "message", label: "Message" },
      { id: "note", label: "Note" },
    ],
    pie: [{ id: "slice", label: "Slice" }],
  };

  const ADD_TEXT_FIELDS = ["label", "text", "name", "value"];

  const KIND_LABEL = {
    node: "Node", edge: "Edge", participant: "Participant",
    message: "Message", note: "Note", slice: "Slice",
  };
  const KIND_GLYPH = {
    node: "N", edge: "E", participant: "P",
    message: "M", note: "T", slice: "S",
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
  const addTabsEl = document.getElementById("designer-add-tabs");
  const addFormEl = document.getElementById("designer-add-form");
  const addFieldsEl = document.getElementById("designer-add-fields");
  const addSubmitEl = document.getElementById("designer-add-submit");
  const addErrorEl = document.getElementById("designer-add-error");
  const addNoteEl = document.getElementById("designer-add-note");
  const chartEl = document.getElementById("designer-chart");
  const chartDividerEl = document.getElementById("designer-chart-divider");
  const directionEl = document.getElementById("designer-direction");
  const autonumberEl = document.getElementById("designer-autonumber");
  const autonumberInputEl = document.getElementById("designer-autonumber-input");
  const autonumberWordEl = document.getElementById("designer-autonumber-word");
  const inspectorEl = document.getElementById("designer-inspector");
  const inspectorHeadEl = document.getElementById("designer-inspector-head");
  const inspectorKindEl = document.getElementById("designer-inspector-kind");
  const inspectorMetaEl = document.getElementById("designer-inspector-meta");
  const inspectorGlyphEl = document.getElementById("designer-inspector-glyph");
  const inspectorClearEl = document.getElementById("designer-inspector-clear");
  const inspectorBodyEl = document.getElementById("designer-inspector-body");
  const grabberEl = document.getElementById("designer-inspector-grabber");
  const grabberLabelEl = document.getElementById("designer-inspector-grabber-label");
  const alertEl = document.getElementById("designer-alert");
  const alertMsgEl = document.getElementById("designer-alert-msg");
  const alertDismissEl = document.getElementById("designer-alert-dismiss");

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
  let unsubSelection = null;  // editor "selectionChange" unsubscribe
  let target = null;          // {parent, index, source} captured at open
  let openSource = "";
  let baselineSource = "";
  let hitRef = null;
  let invoker = null;
  let applying = false;
  let mountToken = 0;
  let stateName = "loading";
  let paletteFamily = null;   // current add-sidebar family, or null
  let scopeFamily = null;     // one of SCOPED_FAMILIES, or null
  let connectable = false;
  let hasRendered = false;
  let dispatching = false;
  let alertKind = null;
  let rekeyingParticipant = false;
  let vendorPointerGuards = [];

  let selection = null;       // {kind, id, entity}
  let selectionSig = null;
  let addTab = {};            // family -> active tab id
  let addDrafts = {};         // "family:tab" -> field values
  let addNoteText = "";
  let addErrorSticky = false;

  function isOpen() { return !!overlay && !overlay.hidden; }
  function isScoped() { return SCOPED_FAMILIES.indexOf(scopeFamily) !== -1; }

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

  function showAlert(msg, kind) {
    if (!alertEl) return;
    if (alertMsgEl) alertMsgEl.textContent = msg || "";
    alertEl.hidden = false;
    alertKind = kind || "op";
  }

  function clearAlert() {
    alertKind = null;
    if (!alertEl) return;
    alertEl.hidden = true;
    if (alertMsgEl) alertMsgEl.textContent = "";
  }

  function updateHint() {
    if (!hintEl) return;
    const show = stateName === "ready" && !selection && isScoped();
    if (!show) {
      hintEl.hidden = true;
      if (modalEl) modalEl.removeAttribute("aria-describedby");
      return;
    }
    hintEl.textContent = FAMILY_HINT[scopeFamily] || "";
    hintEl.hidden = false;
    if (modalEl) modalEl.setAttribute("aria-describedby", "designer-hint");
  }

  function setState(name) {
    stateName = name;
    for (const k in STATE_EL) {
      const el = STATE_EL[k];
      if (el) el.hidden = (k !== name);
    }
    const ready = name === "ready";
    if (sidebarEl) sidebarEl.hidden = !(ready && !!paletteFamily);
    if (inspectorEl) inspectorEl.hidden = !(ready && isScoped());
    if (emptyEl) emptyEl.hidden = true;
    if (applyBtn) applyBtn.disabled = !ready;
    updateHint();
    if (!ready) updateGrabber();
  }

  function setNotEditable() {
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
    if (editor.code === baselineSource) setStatus("Ready", "ok");
    else setStatus("Unsaved changes", "");
  }

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

  function arrowStyle(id) {
    for (const s of ARROW_STYLES) if (s.id === id) return s;
    return ARROW_STYLES[1];
  }

  function arrowStyleId(start, end) {
    for (const s of ARROW_STYLES) if (s.start === start && s.end === end) return s.id;
    return "custom";
  }

  function participantNameError(value, hasAlias) {
    const v = String(value == null ? "" : value).trim();
    if (!v) return "A participant needs a name.";
    if (PARTICIPANT_NAME_BAD_RE.test(v)) {
      return "Commas, semicolons, and colons break Mermaid. Use letters, numbers, _ or -.";
    }
    if (!hasAlias && !PARTICIPANT_ID_RE.test(v)) {
      return "This participant has no alias, so the name is its Mermaid id. " +
        "Use letters, numbers, _ or - (no spaces).";
    }
    return "";
  }

  function optionList(list) {
    return list.map(function (o) { return { value: o.id, label: o.label }; });
  }

  /* --- add-sidebar palette (non-scoped families) ------------------- */

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

  function clearAddForm() {
    addTab = {};
    addDrafts = {};
    addNoteText = "";
    addErrorSticky = false;
    if (addTabsEl) { addTabsEl.innerHTML = ""; addTabsEl.hidden = true; }
    if (addFormEl) { addFormEl.hidden = true; addFormEl.removeAttribute("aria-labelledby"); }
    if (addFieldsEl) addFieldsEl.innerHTML = "";
    if (addErrorEl) { addErrorEl.textContent = ""; addErrorEl.hidden = true; }
    if (addNoteEl) { addNoteEl.textContent = ""; addNoteEl.hidden = true; }
    if (addSubmitEl) addSubmitEl.disabled = true;
  }

  function clearChart() {
    addNoteText = addNoteText || "";
    if (directionEl) { directionEl.innerHTML = ""; directionEl.hidden = true; }
    if (autonumberEl) autonumberEl.hidden = true;
    if (autonumberInputEl) autonumberInputEl.checked = false;
    if (autonumberWordEl) autonumberWordEl.textContent = "Off";
    if (chartEl) chartEl.hidden = true;
    if (chartDividerEl) chartDividerEl.hidden = true;
  }

  function resetPanels() {
    if (paletteEl) paletteEl.innerHTML = "";
    if (paletteEl) paletteEl.hidden = false;
    if (addTitleEl) addTitleEl.textContent = "";
    clearAddForm();
    clearChart();
    clearAlert();
    selection = null;
    selectionSig = null;
    if (inspectorEl) {
      inspectorEl.hidden = true;
      inspectorEl.classList.remove("collapsed");
    }
    if (inspectorBodyEl) inspectorBodyEl.innerHTML = "";
    if (inspectorClearEl) inspectorClearEl.hidden = true;
    if (grabberEl) grabberEl.hidden = true;
    if (hintEl) { hintEl.textContent = ""; hintEl.hidden = true; }
    if (emptyEl) {
      const msg = emptyEl.querySelector(".designer-state-msg");
      if (msg) msg.textContent = DEFAULT_EMPTY_COPY;
    }
    if (overlay) overlay.removeAttribute("data-designer-family");
    if (modalEl) modalEl.removeAttribute("data-designer-family");
  }

  function clearPalette() {
    paletteFamily = null;
    scopeFamily = null;
    connectable = false;
    if (sidebarEl) sidebarEl.hidden = true;
    if (toolConnectBtn) { toolConnectBtn.hidden = false; toolConnectBtn.disabled = false; }
    resetPanels();
  }

  function buildPalette(ed, info) {
    clearPalette();
    const family = familyFor(ed, info);
    paletteFamily = family;
    scopeFamily = SCOPED_FAMILIES.indexOf(family) !== -1 ? family : null;
    connectable = CONNECTABLE.indexOf(family) !== -1;
    if (toolConnectBtn) {
      toolConnectBtn.hidden = !connectable;
      toolConnectBtn.disabled = !connectable;
    }
    if (!family) return;
    if (scopeFamily) {
      if (overlay) overlay.setAttribute("data-designer-family", scopeFamily);
      if (modalEl) modalEl.setAttribute("data-designer-family", scopeFamily);
      if (addTitleEl) addTitleEl.textContent = "Add";
      if (paletteEl) { paletteEl.innerHTML = ""; paletteEl.hidden = true; }
      buildAddForm(ed, scopeFamily);
      buildChart(ed, scopeFamily);
      updateEmptyCopy(scopeFamily);
      return;
    }
    if (!paletteEl) return;
    const action = ADD_ACTIONS[family];
    if (!action) { paletteFamily = null; return; }
    if (addTitleEl) addTitleEl.textContent = "Add";
    paletteEl.hidden = false;
    paletteEl.appendChild(addButton(action.label, toolAction(function (v, ed2) {
      if (ed2) ed2.dispatch(action.op());
    })));
  }

  function updateEmptyCopy(family) {
    if (!emptyEl) return;
    const msg = emptyEl.querySelector(".designer-state-msg");
    if (msg && EMPTY_COPY[family]) msg.textContent = EMPTY_COPY[family];
  }

  /* --- add forms --------------------------------------------------- */

  function addKey(family, tab) { return family + ":" + tab; }

  function currentAddTab() {
    const tabs = ADD_TABS[scopeFamily] || [];
    const id = addTab[scopeFamily];
    return (id && tabs.some(function (t) { return t.id === id; })) ? id : (tabs[0] && tabs[0].id);
  }

  function addDraft() {
    const key = addKey(scopeFamily, currentAddTab());
    addDrafts[key] = addDrafts[key] || {};
    return addDrafts[key];
  }

  function fieldValue(id) {
    const el = document.getElementById(id);
    return el ? String(el.value == null ? "" : el.value) : "";
  }

  function bindDraft(el, field) {
    const draft = addDraft();
    el.value = draft[field] != null ? String(draft[field]) : (el.value || "");
    el.addEventListener("input", function () {
      draft[field] = el.value;
      addErrorSticky = false;
      refreshAddState();
    });
    el.addEventListener("change", function () {
      draft[field] = el.value;
      addErrorSticky = false;
      refreshAddState();
    });
    return el;
  }

  function fieldRow(fields, labelText, control, extraClass) {
    const row = document.createElement("div");
    row.className = "designer-field-row" + (extraClass ? " " + extraClass : "");
    if (control && control.id) {
      const lab = document.createElement("label");
      lab.className = "designer-field-label";
      lab.htmlFor = control.id;
      lab.textContent = labelText;
      row.appendChild(lab);
    } else {
      const span = document.createElement("span");
      span.className = "designer-field-label";
      span.textContent = labelText;
      row.appendChild(span);
    }
    row.appendChild(control);
    fields.appendChild(row);
    return row;
  }

  function textField(fields, labelText, id, field, opts) {
    const input = document.createElement("input");
    input.type = (opts && opts.type) || "text";
    input.id = id;
    input.className = "designer-field";
    input.setAttribute("data-field", field);
    if (opts && opts.placeholder) input.placeholder = opts.placeholder;
    if (opts && opts.min != null) input.min = String(opts.min);
    if (opts && opts.step != null) input.step = String(opts.step);
    bindDraft(input, field);
    fieldRow(fields, labelText, input);
    return input;
  }

  function selectField(fields, labelText, id, field, options, opts) {
    const sel = document.createElement("select");
    sel.id = id;
    sel.className = "designer-field";
    sel.setAttribute("data-field", field);
    if (opts && opts.placeholder) {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = opts.placeholder;
      sel.appendChild(ph);
    }
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    const draft = addDraft();
    const wanted = draft[field] != null ? String(draft[field])
      : (opts && opts.value != null ? String(opts.value) : "");
    if (wanted && Array.prototype.some.call(sel.options, function (o) { return o.value === wanted; })) {
      sel.value = wanted;
    } else {
      sel.value = (opts && opts.placeholder) ? "" : (options[0] ? options[0].value : "");
    }
    draft[field] = sel.value;
    sel.addEventListener("change", function () {
      draft[field] = sel.value;
      addErrorSticky = false;
      refreshAddState();
    });
    fieldRow(fields, labelText, sel);
    return sel;
  }

  function shapeButton(shape, onClick, pressed, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "designer-shape";
    b.title = shape.title;
    b.setAttribute("aria-label",
      action === "set" ? shape.label + " node shape" : shape.aria);
    b.setAttribute("aria-pressed", String(!!pressed));
    b.appendChild(iconSvg(SHAPE_GLYPHS[shape.id] || ""));
    const cap = document.createElement("span");
    cap.className = "designer-shape-caption";
    cap.textContent = shape.label;
    b.appendChild(cap);
    b.addEventListener("click", onClick);
    return b;
  }

  function shapeGrid(fields, selected, onSelect) {
    const grid = document.createElement("div");
    grid.className = "designer-shapes";
    const buttons = [];
    FLOWCHART_SHAPES.forEach(function (shape) {
      const b = shapeButton(shape, function () {
        onSelect(shape.id);
        buttons.forEach(function (btn) {
          btn.setAttribute("aria-pressed", String(btn === b));
        });
      }, shape.id === selected);
      buttons.push(b);
      grid.appendChild(b);
    });
    fieldRow(fields, "Shape", grid, "designer-field-row--shapes");
    return grid;
  }

  function nodeOptionLabel(node) {
    return node.id + " \u00b7 " + node.label;
  }

  function positionOptions(seq) {
    const opts = [
      { value: POSITION_END, label: "End of diagram" },
      { value: POSITION_START, label: "Start (before first event)" },
    ];
    seq.events.forEach(function (ev, i) {
      opts.push({ value: POSITION_AFTER_PREFIX + ev.entityId, label: "After: " + eventLabel(ev, i) });
    });
    return opts;
  }

  function eventLabel(ev, i) {
    const n = (i + 1) + ". ";
    if (ev.kind === "message") {
      return n + ev.stmt.source + " \u2192 " + ev.stmt.target + ": " + (ev.stmt.text || "").trim();
    }
    return n + "Note " + ev.stmt.placement + " " + ev.stmt.targets.join(",") + ": " +
      (ev.stmt.text || "").trim();
  }

  function positionAfterEvent(value) {
    if (value === POSITION_START) return null;
    if (value && value.indexOf(POSITION_AFTER_PREFIX) === 0) {
      return value.slice(POSITION_AFTER_PREFIX.length);
    }
    return undefined;
  }

  function buildAddForm(ed, family) {
    clearAddForm();
    if (!addTabsEl || !addFormEl || !addFieldsEl) return;
    const tabs = ADD_TABS[family] || [];
    if (tabs.length > 1) {
      addTabsEl.hidden = false;
      tabs.forEach(function (tab) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "designer-tab";
        b.id = "designer-add-tab-" + tab.id;
        b.setAttribute("role", "tab");
        b.setAttribute("data-tab", tab.id);
        b.setAttribute("aria-controls", "designer-add-form");
        b.setAttribute("aria-selected", "false");
        b.tabIndex = -1;
        b.textContent = tab.label;
        b.addEventListener("click", function () { switchAddTab(tab.id); });
        addTabsEl.appendChild(b);
      });
    } else {
      addTabsEl.hidden = true;
    }
    if (!addTab[family]) addTab[family] = tabs[0] ? tabs[0].id : "";
    renderAddForm();
  }

  function renderAddForm() {
    if (!isScoped() || !addFormEl || !addFieldsEl) return;
    const family = scopeFamily;
    const tab = currentAddTab();
    if (!tab) { addFormEl.hidden = true; return; }
    addFormEl.hidden = false;
    const tabs = ADD_TABS[family] || [];
    addFormEl.setAttribute("aria-labelledby",
      tabs.length > 1 ? "designer-add-tab-" + tab : "designer-add-title");
    if (addTabsEl) {
      Array.prototype.forEach.call(addTabsEl.querySelectorAll("[role=tab]"), function (b) {
        const on = b.getAttribute("data-tab") === tab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
    }
    addFieldsEl.innerHTML = "";
    addNoteText = "";
    addErrorSticky = false;
    if (addErrorEl) { addErrorEl.textContent = ""; addErrorEl.hidden = true; }

    const draft = addDraft();
    const r = editor && editor.result;
    if (family === "flowchart" && tab === "node") {
      const selectedShape = draft.shape || "rect";
      shapeGrid(addFieldsEl, selectedShape, function (id) {
        draft.shape = id;
      });
      textField(addFieldsEl, "Label", "designer-add-label", "label",
        { placeholder: "Start" });
      setAddSubmitText("Add node");
    } else if (family === "flowchart" && tab === "edge") {
      const nodes = (r && r.flowchart) ? r.flowchart.nodes : [];
      const nodeOpts = nodes.map(function (n) { return { value: n.id, label: nodeOptionLabel(n) }; });
      selectField(addFieldsEl, "From", "designer-add-from", "from", nodeOpts,
        { placeholder: "Choose a node" });
      selectField(addFieldsEl, "To", "designer-add-to", "to", nodeOpts,
        { placeholder: "Choose a node" });
      textField(addFieldsEl, "Label (optional)", "designer-add-label", "label",
        { placeholder: "approved" });
      selectField(addFieldsEl, "Line", "designer-add-line", "line",
        optionList(EDGE_LINES), { value: "solid" });
      selectField(addFieldsEl, "Arrow", "designer-add-arrow", "arrow",
        optionList(ARROW_STYLES), { value: "arrow" });
      addNoteText = nodes.length < 2 ? "Add two nodes before connecting them." : "";
      setAddSubmitText("Add edge");
    } else if (family === "sequence" && tab === "participant") {
      textField(addFieldsEl, "Name", "designer-add-name", "name",
        { placeholder: "Alice" });
      selectField(addFieldsEl, "Type", "designer-add-type", "ptype",
        optionList(PARTICIPANT_TYPES), { value: "participant" });
      setAddSubmitText("Add participant");
    } else if (family === "sequence" && tab === "message") {
      const seq = (r && r.sequence) ? r.sequence : { participants: [], events: [] };
      const parts = seq.participants.map(function (p) {
        return { value: p.id, label: p.id + " \u00b7 " + p.label };
      });
      selectField(addFieldsEl, "From", "designer-add-from", "from", parts,
        { placeholder: "Choose a participant" });
      selectField(addFieldsEl, "To", "designer-add-to", "to", parts,
        { placeholder: "Choose a participant" });
      textField(addFieldsEl, "Text", "designer-add-text", "text",
        { placeholder: "Request" });
      selectField(addFieldsEl, "Arrow", "designer-add-op", "op",
        optionList(MESSAGE_OPS), { value: "->>" });
      selectField(addFieldsEl, "Position", "designer-add-position", "position",
        positionOptions(seq), { value: POSITION_END });
      addNoteText = parts.length < 1 ? "Add a participant before adding a message." : "";
      setAddSubmitText("Add message");
    } else if (family === "sequence" && tab === "note") {
      const seq = (r && r.sequence) ? r.sequence : { participants: [], events: [] };
      const parts = seq.participants.map(function (p) {
        return { value: p.id, label: p.id + " \u00b7 " + p.label };
      });
      selectField(addFieldsEl, "Participant", "designer-add-participant", "participant", parts,
        { placeholder: "Choose a participant" });
      selectField(addFieldsEl, "Placement", "designer-add-placement", "placement",
        optionList(NOTE_PLACEMENTS), { value: "over" });
      textField(addFieldsEl, "Text", "designer-add-text", "text",
        { placeholder: "Remember this" });
      selectField(addFieldsEl, "Position", "designer-add-position", "position",
        positionOptions(seq), { value: POSITION_END });
      addNoteText = parts.length < 1 ? "Add a participant before adding a note." : "";
      setAddSubmitText("Add note");
    } else if (family === "pie") {
      textField(addFieldsEl, "Label", "designer-add-label", "label",
        { placeholder: "Search" });
      textField(addFieldsEl, "Value", "designer-add-value", "value",
        { type: "number", min: 0, step: "any", placeholder: "10" });
      addNoteText = PIE_TITLE_NOTE;
      setAddSubmitText("Add slice");
    }
    if (addNoteEl) {
      addNoteEl.textContent = addNoteText;
      addNoteEl.hidden = !addNoteText;
    }
    refreshAddState();
  }

  function setAddSubmitText(text) {
    if (addSubmitEl) addSubmitEl.textContent = text;
  }

  function switchAddTab(tab, prefill) {
    if (!isScoped()) return;
    const tabs = ADD_TABS[scopeFamily] || [];
    if (!tabs.some(function (t) { return t.id === tab; })) return;
    addTab[scopeFamily] = tab;
    if (prefill) {
      const draft = addDraft();
      for (const k in prefill) draft[k] = prefill[k];
    }
    renderAddForm();
    const first = addFieldsEl && addFieldsEl.querySelector("input, select");
    if (first && first.focus) {
      try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
    }
  }

  function setAddError(msg, sticky) {
    if (!addErrorEl) return;
    addErrorEl.textContent = msg || "";
    addErrorEl.hidden = !msg;
    addErrorSticky = !!sticky;
  }

  function validateAddValues() {
    const family = scopeFamily;
    const tab = currentAddTab();
    if (family === "flowchart" && tab === "node") {
      if (!fieldValue("designer-add-label").trim()) return { ok: false };
    } else if (family === "flowchart" && tab === "edge") {
      const nodes = (editor.result.flowchart && editor.result.flowchart.nodes) || [];
      if (nodes.length < 2) return { ok: false, note: "Add two nodes before connecting them." };
      if (!fieldValue("designer-add-from") || !fieldValue("designer-add-to")) return { ok: false };
    } else if (family === "sequence" && tab === "participant") {
      const name = fieldValue("designer-add-name").trim();
      if (!name) return { ok: false };
      const problem = participantNameError(name, false);
      if (problem) return { ok: false, error: problem };
    } else if (family === "sequence" && tab === "message") {
      if (!fieldValue("designer-add-from") || !fieldValue("designer-add-to") ||
        !fieldValue("designer-add-text").trim()) return { ok: false };
    } else if (family === "sequence" && tab === "note") {
      if (!fieldValue("designer-add-participant") || !fieldValue("designer-add-text").trim()) {
        return { ok: false };
      }
    } else if (family === "pie") {
      const label = fieldValue("designer-add-label").trim();
      const raw = fieldValue("designer-add-value");
      const value = Number(raw);
      if (!label) return { ok: false };
      if (raw === "" || !Number.isFinite(value) || value < 0) {
        return { ok: false, error: "Enter a finite value of 0 or more." };
      }
    }
    return { ok: true };
  }

  function refreshAddState() {
    if (!isScoped() || !addFormEl || addFormEl.hidden) return;
    const v = validateAddValues();
    if (addSubmitEl) addSubmitEl.disabled = !v.ok;
    const badId = v.error
      ? (scopeFamily === "pie" ? "designer-add-value"
        : (scopeFamily === "sequence" && currentAddTab() === "participant" ? "designer-add-name" : null))
      : null;
    if (v.error) {
      setAddError(v.error, false);
      if (badId) {
        const badField = document.getElementById(badId);
        if (badField) {
          badField.setAttribute("aria-invalid", "true");
          badField.setAttribute("aria-describedby", "designer-add-error");
        }
      }
    } else {
      if (!addErrorSticky && addErrorEl) { addErrorEl.textContent = ""; addErrorEl.hidden = true; }
    }
    ["designer-add-value", "designer-add-name"].forEach(function (id) {
      if (id === badId) return;
      const field = document.getElementById(id);
      if (field) {
        field.removeAttribute("aria-invalid");
        field.removeAttribute("aria-describedby");
      }
    });
    if (addNoteEl) {
      const note = v.note || addNoteText;
      addNoteEl.textContent = note;
      addNoteEl.hidden = !note;
    }
  }

  function clearAddText() {
    const draft = addDraft();
    for (const f of ADD_TEXT_FIELDS) delete draft[f];
  }

  function submitAdd(e) {
    if (e) e.preventDefault();
    if (!isScoped() || !editor) return;
    clearAlert();
    const family = scopeFamily;
    const tab = currentAddTab();
    const v = validateAddValues();
    if (!v.ok) {
      refreshAddState();
      if (v.error) setAddError(v.error, false);
      return;
    }
    if (family === "flowchart" && tab === "node") {
      const draft = addDraft();
      const res = runOperation({
        type: "addNode", shape: draft.shape || "rect", label: fieldValue("designer-add-label"),
      }, "created");
      if (!res) { setAddError("The model rejected that node.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "flowchart" && tab === "edge") {
      const arrow = arrowStyle(fieldValue("designer-add-arrow"));
      const label = fieldValue("designer-add-label").trim();
      let res = null;
      let created = null;
      dispatching = true;
      try {
        res = editor.dispatch({
          type: "connect",
          source: fieldValue("designer-add-from"),
          target: fieldValue("designer-add-to"),
          line: fieldValue("designer-add-line") || "solid",
          arrowEnd: arrow.end,
          label: label || undefined,
        });
        created = res && res.created && res.created[0];
        if (created && arrow.start !== "open") {
          editor.dispatch({ type: "setEdgeStyle", edgeId: created, arrowStart: arrow.start, arrowEnd: arrow.end });
        }
      } finally {
        dispatching = false;
      }
      if (!res) { setAddError("The model rejected that edge.", true); return; }
      selectEntityOrClear(created);
      if (created) {
        const resolved = resolveEntity(created);
        if (resolved) { selection = resolved; selectionSig = signatureOf(resolved); }
      }
      updateStatus();
      updateHistoryButtons();
      renderInspector();
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "sequence" && tab === "participant") {
      const res = runOperation({
        type: "seq.addParticipant",
        name: fieldValue("designer-add-name").trim(),
        ptype: fieldValue("designer-add-type") || "participant",
      }, "created");
      if (!res) { setAddError("The model rejected that participant.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "sequence" && (tab === "message" || tab === "note")) {
      const pos = positionAfterEvent(fieldValue("designer-add-position"));
      if (pos && pos !== null) {
        const seq = editor.result.sequence;
        if (!seq || !seq.events.some(function (ev) { return ev.entityId === pos; })) {
          setAddError("The chosen position no longer exists. Pick another.", true);
          return;
        }
      }
      let op;
      if (tab === "message") {
        op = {
          type: "seq.addMessage",
          source: fieldValue("designer-add-from"),
          target: fieldValue("designer-add-to"),
          text: fieldValue("designer-add-text").trim(),
          op: fieldValue("designer-add-op") || "->>",
        };
      } else {
        op = {
          type: "seq.addNote",
          participant: fieldValue("designer-add-participant"),
          placement: fieldValue("designer-add-placement") || "over",
          text: fieldValue("designer-add-text").trim(),
        };
      }
      if (pos !== undefined) op.afterEvent = pos;
      const res = runOperation(op, "created");
      if (!res) { setAddError("The model rejected that item.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "pie" && tab === "slice") {
      const label = fieldValue("designer-add-label").trim();
      const value = Number(fieldValue("designer-add-value"));
      if (!label || !Number.isFinite(value) || value < 0) {
        setAddError("Enter a label and a finite value of 0 or more.", false);
        return;
      }
      const res = runOperation({ type: "pie.addSlice", label: label, value: value }, "created");
      if (!res) { setAddError("The model rejected that slice.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
    }
  }

  function focusAddForm() {
    if (!addFieldsEl) return;
    const first = addFieldsEl.querySelector("input, select");
    if (first && first.focus) {
      try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
    }
  }

  function handleAddTabsKey(e) {
    if (!addTabsEl) return;
    const tabs = Array.prototype.slice.call(addTabsEl.querySelectorAll("[role=tab]"));
    if (!tabs.length) return;
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      switchAddTab(tabs[idx].getAttribute("data-tab"));
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    switchAddTab(tabs[next].getAttribute("data-tab"));
    tabs[next].focus();
  }

  /* --- chart controls ---------------------------------------------- */

  function buildChart(ed, family) {
    clearChart();
    if (family === "flowchart") {
      const graph = ed.result.flowchart;
      if (chartEl) chartEl.hidden = false;
      if (chartDividerEl) chartDividerEl.hidden = false;
      if (directionEl) {
        directionEl.hidden = false;
        const current = (graph && graph.direction) || "TD";
        DIRECTIONS.forEach(function (dir) {
          const label = document.createElement("label");
          label.className = "designer-chip";
          const input = document.createElement("input");
          input.type = "radio";
          input.name = "designer-direction";
          input.value = dir.id;
          input.id = "designer-direction-" + dir.id.toLowerCase();
          input.setAttribute("aria-label", dir.label);
          input.checked = dir.id === current;
          input.addEventListener("change", function () {
            if (!input.checked) return;
            runOperation({ type: "setDirection", direction: dir.id }, "keep");
            updateChartControls();
          });
          const text = document.createElement("span");
          text.className = "designer-chip-text";
          text.textContent = dir.id;
          label.appendChild(input);
          label.appendChild(text);
          directionEl.appendChild(label);
        });
      }
      return;
    }
    if (family === "sequence") {
      if (chartEl) chartEl.hidden = false;
      if (chartDividerEl) chartDividerEl.hidden = false;
      if (autonumberEl) autonumberEl.hidden = false;
      updateChartControls();
    }
  }

  function updateChartControls() {
    if (!editor || !isScoped()) return;
    if (scopeFamily === "flowchart" && directionEl) {
      const graph = editor.result.flowchart;
      const current = (graph && graph.direction) || "TD";
      Array.prototype.forEach.call(directionEl.querySelectorAll("input[type=radio]"), function (input) {
        input.checked = input.value === current;
      });
    }
    if (scopeFamily === "sequence" && autonumberInputEl) {
      const seq = editor.result.sequence;
      const on = !!(seq && seq.autonumber && seq.autonumber.enabled);
      autonumberInputEl.checked = on;
      if (autonumberWordEl) autonumberWordEl.textContent = on ? "On" : "Off";
    }
  }

  /* --- selection + inspector --------------------------------------- */

  function resolveEntity(id) {
    const r = editor && editor.result;
    if (!r || !id) return null;
    if (r.flowchart) {
      if (id.indexOf("node:") === 0) {
        const n = r.flowchart.nodeById.get(id.slice(5));
        return n ? { kind: "node", id: id, entity: n } : null;
      }
      if (id.indexOf("edge:") === 0) {
        const e = r.flowchart.edges.find(function (x) { return x.entityId === id; });
        return e ? { kind: "edge", id: id, entity: e } : null;
      }
    }
    if (r.sequence) {
      if (id.indexOf("participant:") === 0) {
        const p = r.sequence.participantById.get(id.slice(12));
        return p ? { kind: "participant", id: id, entity: p } : null;
      }
      if (id.indexOf("event:") === 0) {
        const ev = r.sequence.events.find(function (x) { return x.entityId === id; });
        if (!ev) return null;
        return { kind: ev.kind === "message" ? "message" : "note", id: id, entity: ev };
      }
    }
    if (r.pie && id.indexOf("slice:") === 0) {
      const s = r.pie.slices.find(function (x) { return x.entityId === id; });
      return s ? { kind: "slice", id: id, entity: s } : null;
    }
    return null;
  }

  function signatureOf(sel) {
    const e = sel.entity;
    if (sel.kind === "node") return "node:" + e.id;
    if (sel.kind === "edge") return "edge:" + e.entityId;
    if (sel.kind === "participant") return "participant:" + e.id;
    if (sel.kind === "message") {
      const anchor = e.stmt.textSpan && typeof e.stmt.textSpan.start === "number"
        ? e.stmt.textSpan.start : (e.stmt.text || "");
      return "message:" + e.lineIndex + ":" + e.stmt.source + "->" + e.stmt.target +
        ":" + anchor + ":" + (e.stmt.op || "");
    }
    if (sel.kind === "note") {
      const anchor = e.stmt.textSpan && typeof e.stmt.textSpan.start === "number"
        ? e.stmt.textSpan.start : (e.stmt.text || "");
      return "note:" + e.lineIndex + ":" + e.stmt.targets.join(",") + ":" + anchor;
    }
    if (sel.kind === "slice") return "slice:" + e.lineIndex + ":" + e.label;
    return sel.kind + ":" + sel.id;
  }

  function selectionMeta(sel) {
    if (sel.kind === "node") return sel.entity.id;
    if (sel.kind === "edge") return sel.entity.source + " \u2192 " + sel.entity.target;
    if (sel.kind === "participant") return sel.entity.id;
    if (sel.kind === "message" || sel.kind === "note") {
      const seq = editor && editor.result && editor.result.sequence;
      const evs = (seq && seq.events) || [];
      const idx = evs.indexOf(sel.entity);
      return (idx + 1) + " of " + evs.length;
    }
    if (sel.kind === "slice") return sel.entity.label;
    return sel.id;
  }

  function updateInspectorHead() {
    if (!inspectorEl) return;
    if (!selection) {
      if (inspectorKindEl) inspectorKindEl.textContent = "Nothing selected";
      if (inspectorMetaEl) inspectorMetaEl.textContent = FAMILY_LABEL[scopeFamily] || "";
      if (inspectorGlyphEl) inspectorGlyphEl.textContent = "\u25c7";
      if (inspectorClearEl) inspectorClearEl.hidden = true;
    } else {
      if (inspectorKindEl) inspectorKindEl.textContent = KIND_LABEL[selection.kind] || selection.kind;
      if (inspectorMetaEl) inspectorMetaEl.textContent = selectionMeta(selection);
      if (inspectorGlyphEl) inspectorGlyphEl.textContent = KIND_GLYPH[selection.kind] || "?";
      if (inspectorClearEl) inspectorClearEl.hidden = false;
    }
    updateGrabber();
  }

  function updateGrabber() {
    if (!grabberEl) return;
    const usable = stateName === "ready" && isScoped();
    grabberEl.hidden = !usable;
    if (!usable) return;
    if (grabberLabelEl) {
      grabberLabelEl.textContent = selection
        ? (KIND_LABEL[selection.kind] || selection.kind) + " \u00b7 " + selectionMeta(selection)
        : "Inspector";
    }
    grabberEl.setAttribute("aria-expanded", String(!inspectorEl.classList.contains("collapsed")));
  }

  function inspectorGroup(title) {
    const g = document.createElement("section");
    g.className = "designer-group";
    if (title) {
      const h = document.createElement("h5");
      h.className = "designer-group-title";
      h.textContent = title;
      g.appendChild(h);
    }
    return g;
  }

  function inspectorRow(group, labelText, control) {
    const row = document.createElement("div");
    row.className = "designer-field-row";
    const lab = document.createElement("label");
    lab.className = "designer-field-label";
    lab.htmlFor = control.id;
    lab.textContent = labelText;
    row.appendChild(lab);
    row.appendChild(control);
    group.appendChild(row);
    return row;
  }

  function inspectorInput(id, value, opts) {
    const input = document.createElement("input");
    input.type = (opts && opts.type) || "text";
    input.id = id;
    input.className = "designer-field";
    input.value = value == null ? "" : String(value);
    if (opts && opts.min != null) input.min = String(opts.min);
    if (opts && opts.step != null) input.step = String(opts.step);
    return input;
  }

  function inspectorSelect(id, value, options) {
    const sel = document.createElement("select");
    sel.id = id;
    sel.className = "designer-field";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = value;
    return sel;
  }

  function fieldError(group, control, text) {
    const p = document.createElement("p");
    p.className = "designer-field-error";
    if (control && control.id) {
      p.id = control.id + "-error";
      control.setAttribute("aria-describedby", p.id);
    }
    p.textContent = text;
    p.hidden = !text;
    group.appendChild(p);
    return p;
  }

  function actionButton(label, variant, onClick, id) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "designer-btn" + (variant ? " designer-btn--" + variant : "");
    if (id) b.id = id;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function consequence(group, text) {
    const p = document.createElement("p");
    p.className = "designer-consequence";
    p.textContent = text;
    group.appendChild(p);
  }

  function renderInspector() {
    if (!inspectorEl) return;
    if (!isScoped() || stateName !== "ready") {
      inspectorEl.hidden = true;
      updateHint();
      updateGrabber();
      return;
    }
    inspectorEl.hidden = false;
    updateInspectorHead();
    if (!inspectorBodyEl) return;
    inspectorBodyEl.innerHTML = "";
    if (!selection) {
      const rest = document.createElement("div");
      rest.className = "designer-rest";
      const glyph = document.createElement("span");
      glyph.className = "designer-rest-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = "\u25c7";
      const title = document.createElement("p");
      title.className = "designer-rest-title";
      title.textContent = "Nothing selected";
      const copy = document.createElement("p");
      copy.className = "designer-rest-copy";
      copy.textContent = FAMILY_REST[scopeFamily] || "";
      rest.appendChild(glyph);
      rest.appendChild(title);
      rest.appendChild(copy);
      inspectorBodyEl.appendChild(rest);
      updateHint();
      return;
    }
    if (selection.kind === "node") renderNodeInspector(selection.entity);
    else if (selection.kind === "edge") renderEdgeInspector(selection.entity);
    else if (selection.kind === "participant") renderParticipantInspector(selection.entity);
    else if (selection.kind === "message") renderMessageInspector(selection.entity);
    else if (selection.kind === "note") renderNoteInspector(selection.entity);
    else if (selection.kind === "slice") renderSliceInspector(selection.entity);
    updateHint();
    updateGrabber();
  }

  function currentSelected() {
    if (!selection || !editor) return null;
    const resolved = resolveEntity(selection.id);
    if (!resolved) return null;
    selection = resolved;
    selectionSig = signatureOf(resolved);
    return resolved.entity;
  }

  function renderNodeInspector(node) {
    const labelGroup = inspectorGroup("Label");
    const label = inspectorInput("designer-node-label", node.label);
    inspectorRow(labelGroup, "Label", label);
    const labelErr = fieldError(labelGroup, label, "");
    label.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({ type: "renameNode", id: cur.id, label: label.value }, "keep");
      if (!res) {
        const restored = currentSelected();
        label.value = restored ? restored.label : "";
        label.setAttribute("aria-invalid", "true");
        labelErr.textContent = "The model rejected that label.";
        labelErr.hidden = false;
      } else {
        label.removeAttribute("aria-invalid");
        labelErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(labelGroup);

    const shapeGroup = inspectorGroup("Shape");
    const selected = (selection && selection.entity) ? selection.entity.shape : node.shape;
    const grid = document.createElement("div");
    grid.className = "designer-shapes";
    FLOWCHART_SHAPES.forEach(function (shape) {
      const b = shapeButton(shape, function () {
        const cur = currentSelected();
        if (!cur) return;
        const res = runOperation({ type: "setNodeShape", id: cur.id, shape: shape.id }, "keep");
        if (!res) return;
        Array.prototype.forEach.call(grid.querySelectorAll("button"), function (btn) {
          btn.setAttribute("aria-pressed", String(btn === b));
        });
        if (selection && selection.entity) selection.entity.shape = shape.id;
      }, shape.id === selected, "set");
      grid.appendChild(b);
    });
    const shapeRow = document.createElement("div");
    shapeRow.className = "designer-field-row designer-field-row--shapes";
    const shapeLab = document.createElement("span");
    shapeLab.className = "designer-field-label";
    shapeLab.textContent = "Shape";
    shapeRow.appendChild(shapeLab);
    shapeRow.appendChild(grid);
    shapeGroup.appendChild(shapeRow);
    inspectorBodyEl.appendChild(shapeGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Connect from this node", "", function () {
      const cur = currentSelected();
      if (cur) switchAddTab("edge", { from: cur.id });
    }, "designer-node-connect"));
    actions.appendChild(actionButton("Delete node", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "deleteNode", id: cur.id }, "clear");
    }, "designer-node-delete"));
    consequence(actions, "Its edges are removed too. Undo restores.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderEdgeInspector(edge) {
    const labelGroup = inspectorGroup("Label");
    const label = inspectorInput("designer-edge-label", edge.label || "");
    inspectorRow(labelGroup, "Label", label);
    const labelErr = fieldError(labelGroup, label, "");
    label.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({ type: "setEdgeLabel", edgeId: cur.entityId, label: label.value }, "keep");
      if (!res) {
        const restored = currentSelected();
        label.value = restored ? (restored.label || "") : "";
        label.setAttribute("aria-invalid", "true");
        labelErr.textContent = "The model rejected that label.";
        labelErr.hidden = false;
      } else {
        label.removeAttribute("aria-invalid");
        labelErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(labelGroup);

    const lineGroup = inspectorGroup("Line");
    const lines = EDGE_LINES.slice();
    if (edge.seg.line === "invisible") lines.push({ id: "invisible", label: "Invisible" });
    const lineSel = inspectorSelect("designer-edge-line", edge.seg.line,
      lines.map(function (x) { return { value: x.id, label: x.label }; }));
    inspectorRow(lineGroup, "Line", lineSel);
    lineSel.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({ type: "setEdgeStyle", edgeId: cur.entityId, line: lineSel.value }, "keep");
      if (!res) {
        const restored = currentSelected();
        lineSel.value = restored ? restored.seg.line : edge.seg.line;
      }
    });
    inspectorBodyEl.appendChild(lineGroup);

    const arrowGroup = inspectorGroup("Arrows");
    const styleId = arrowStyleId(edge.seg.arrowStart, edge.seg.arrowEnd);
    const arrowOpts = ARROW_STYLES.map(function (x) { return { value: x.id, label: x.label }; });
    if (styleId === "custom") {
      arrowOpts.push({
        value: "custom",
        label: "Custom (" + edge.seg.arrowStart + " / " + edge.seg.arrowEnd + ")",
      });
    }
    const arrowSel = inspectorSelect("designer-edge-arrow", styleId, arrowOpts);
    inspectorRow(arrowGroup, "Arrows", arrowSel);
    arrowSel.addEventListener("change", function () {
      if (arrowSel.value === "custom") return;
      const cur = currentSelected();
      if (!cur) return;
      const style = arrowStyle(arrowSel.value);
      if (!style) return;
      const res = runOperation({
        type: "setEdgeStyle", edgeId: cur.entityId,
        arrowStart: style.start, arrowEnd: style.end,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        arrowSel.value = restored
          ? arrowStyleId(restored.seg.arrowStart, restored.seg.arrowEnd)
          : arrowStyleId(edge.seg.arrowStart, edge.seg.arrowEnd);
      }
    });
    inspectorBodyEl.appendChild(arrowGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Reverse direction", "", function () {
      const cur = currentSelected();
      if (!cur) return;
      if (!runOperation({ type: "reverseEdge", edgeId: cur.entityId }, "clear")) {
        showAlert("This edge can\u2019t be reversed without rewiring a chain. Edit it in the source.");
      }
    }, "designer-edge-reverse"));
    actions.appendChild(actionButton("Delete edge", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "deleteEdge", edgeId: cur.entityId }, "clear");
    }, "designer-edge-delete"));
    consequence(actions, "Undo restores the edge.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderParticipantInspector(part) {
    const nameGroup = inspectorGroup("Display name");
    const name = inspectorInput("designer-participant-name", part.label);
    inspectorRow(nameGroup, "Display name", name);
    const nameErr = fieldError(nameGroup, name, "");
    name.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const hadAlias = !!(cur.decl && cur.decl.alias);
      const value = name.value;
      const problem = participantNameError(value, hadAlias);
      if (problem) {
        name.value = cur.label;
        name.setAttribute("aria-invalid", "true");
        nameErr.textContent = problem;
        nameErr.hidden = false;
        return;
      }
      const sanitized = value.trim().replace(/[:;]/g, "");
      const res = runOperation({
        type: "seq.renameParticipant", id: cur.id, name: value,
      }, hadAlias ? "keep" : "none");
      if (!res) {
        const restored = currentSelected();
        name.value = restored ? restored.label : "";
        name.setAttribute("aria-invalid", "true");
        nameErr.textContent = "The model rejected that name.";
        nameErr.hidden = false;
        return;
      }
      name.removeAttribute("aria-invalid");
      nameErr.hidden = true;
      if (!hadAlias) {
        const newId = "participant:" + sanitized;
        if (editor.entityExists(newId)) {
          rekeyingParticipant = true;
          editor.setSelection([newId], "ui");
          rekeyingParticipant = false;
          if (selection && selection.id !== newId) {
            const resolved = resolveEntity(newId);
            if (resolved) {
              selection = resolved;
              selectionSig = signatureOf(resolved);
              updateInspectorHead();
            }
          }
        } else {
          editor.clearSelection("ui");
        }
      }
    });
    inspectorBodyEl.appendChild(nameGroup);

    const typeGroup = inspectorGroup("Type");
    const typeSel = inspectorSelect("designer-participant-type", part.ptype,
      optionList(PARTICIPANT_TYPES));
    inspectorRow(typeGroup, "Type", typeSel);
    typeSel.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "seq.setParticipantType", id: cur.id, ptype: typeSel.value,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        typeSel.value = restored ? restored.ptype : part.ptype;
      }
    });
    inspectorBodyEl.appendChild(typeGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Message from this participant", "", function () {
      const cur = currentSelected();
      if (cur) switchAddTab("message", { from: cur.id });
    }, "designer-participant-message"));
    actions.appendChild(actionButton("Delete participant", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "seq.deleteParticipant", id: cur.id }, "clear");
    }, "designer-participant-delete"));
    consequence(actions, "Its messages are removed. No other message is lost. Undo restores.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderMessageInspector(ev) {
    const textGroup = inspectorGroup("Text");
    const text = inspectorInput("designer-message-text", (ev.stmt.text || "").trim());
    inspectorRow(textGroup, "Text", text);
    const textErr = fieldError(textGroup, text, "");
    text.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "seq.setEventText", eventId: cur.entityId, text: text.value,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        text.value = restored ? (restored.stmt.text || "").trim() : "";
        text.setAttribute("aria-invalid", "true");
        textErr.textContent = "The model rejected that text.";
        textErr.hidden = false;
      } else {
        text.removeAttribute("aria-invalid");
        textErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(textGroup);

    const arrowGroup = inspectorGroup("Arrow");
    const opSel = inspectorSelect("designer-message-op", ev.stmt.op, optionList(MESSAGE_OPS));
    inspectorRow(arrowGroup, "Arrow", opSel);
    opSel.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "seq.setMessageOp", eventId: cur.entityId, op: opSel.value,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        opSel.value = restored ? restored.stmt.op : ev.stmt.op;
      }
    });
    inspectorBodyEl.appendChild(arrowGroup);

    const seq = editor.result.sequence;
    const idx = seq.events.indexOf(ev);
    const orderGroup = inspectorGroup("Order");
    const orderRow = document.createElement("div");
    orderRow.className = "designer-action-row";
    const up = actionButton("Move up", "", function () {
      const cur = currentSelected();
      if (!cur) return;
      const s = editor.result.sequence;
      const at = s.events.indexOf(cur);
      if (at <= 0) return;
      const after = at >= 2 ? s.events[at - 2].entityId : null;
      runOperation({
        type: "seq.moveEvent", eventId: cur.entityId, afterEvent: after,
      }, "created");
    });
    up.disabled = idx <= 0;
    up.id = "designer-message-up";
    const down = actionButton("Move down", "", function () {
      const cur = currentSelected();
      if (!cur) return;
      const s = editor.result.sequence;
      const at = s.events.indexOf(cur);
      if (at < 0 || at >= s.events.length - 1) return;
      runOperation({
        type: "seq.moveEvent", eventId: cur.entityId, afterEvent: s.events[at + 1].entityId,
      }, "created");
    }, "designer-message-down");
    down.disabled = idx < 0 || idx >= seq.events.length - 1;
    orderRow.appendChild(up);
    orderRow.appendChild(down);
    orderGroup.appendChild(orderRow);
    inspectorBodyEl.appendChild(orderGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Reverse direction", "", function () {
      const cur = currentSelected();
      if (!cur) return;
      if (!runOperation({ type: "seq.reverseMessage", eventId: cur.entityId }, "keep")) {
        showAlert("The model rejected reversing this message.");
      }
    }, "designer-message-reverse"));
    actions.appendChild(actionButton("Delete message", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "seq.deleteEvent", eventId: cur.entityId }, "clear");
    }, "designer-message-delete"));
    consequence(actions, "Deleting removes only this message. Undo restores.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderNoteInspector(ev) {
    const textGroup = inspectorGroup("Text");
    const text = inspectorInput("designer-note-text", (ev.stmt.text || "").trim());
    inspectorRow(textGroup, "Text", text);
    const textErr = fieldError(textGroup, text, "");
    text.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "seq.setEventText", eventId: cur.entityId, text: text.value,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        text.value = restored ? (restored.stmt.text || "").trim() : "";
        text.setAttribute("aria-invalid", "true");
        textErr.textContent = "The model rejected that text.";
        textErr.hidden = false;
      } else {
        text.removeAttribute("aria-invalid");
        textErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(textGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Delete note", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "seq.deleteEvent", eventId: cur.entityId }, "clear");
    }, "designer-note-delete"));
    consequence(actions, "Undo restores the note.");
    inspectorBodyEl.appendChild(actions);
  }

  function sliceAmbiguous(slice) {
    const r = editor && editor.result;
    const slices = (r && r.pie && r.pie.slices) || [];
    const label = slice.label;
    return slices.some(function (other) {
      if (other === slice) return false;
      if (other.label === label) return true;
      if (!other.label || !label) return false;
      return other.label.indexOf(label) === 0 || label.indexOf(other.label) === 0;
    });
  }

  function updateSliceInspectorInPlace() {
    if (!selection || selection.kind !== "slice") return;
    const slice = selection.entity;
    const ambiguous = sliceAmbiguous(slice);
    const label = document.getElementById("designer-slice-label");
    const value = document.getElementById("designer-slice-value");
    if (label) {
      label.disabled = ambiguous;
      if (ambiguous && document.activeElement === label && label.blur) label.blur();
    }
    if (value) value.disabled = ambiguous;
    const note = document.getElementById("designer-slice-ambiguity");
    if (note) note.hidden = !ambiguous;
    updateInspectorHead();
  }

  function renderSliceInspector(slice) {
    const ambiguous = sliceAmbiguous(slice);
    const ambiguity = inspectorGroup("");
    ambiguity.id = "designer-slice-ambiguity";
    ambiguity.hidden = !ambiguous;
    const p = document.createElement("p");
    p.className = "designer-scope-note";
    p.textContent = "This label matches another slice. Edit it in the source editor.";
    ambiguity.appendChild(p);
    inspectorBodyEl.appendChild(ambiguity);

    const labelGroup = inspectorGroup("Label");
    const label = inspectorInput("designer-slice-label", slice.label);
    label.disabled = ambiguous;
    inspectorRow(labelGroup, "Label", label);
    const labelErr = fieldError(labelGroup, label, "");
    label.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "pie.setLabel", sliceId: cur.entityId, label: label.value,
      }, "keep", { rerender: true });
      if (!res) {
        const restored = currentSelected();
        label.value = restored ? restored.label : "";
        label.setAttribute("aria-invalid", "true");
        labelErr.textContent = "The model rejected that label.";
        labelErr.hidden = false;
      } else {
        label.removeAttribute("aria-invalid");
        labelErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(labelGroup);

    const valueGroup = inspectorGroup("Value");
    const value = inspectorInput("designer-slice-value", slice.value,
      { type: "number", min: 0, step: "any" });
    value.disabled = ambiguous;
    inspectorRow(valueGroup, "Value", value);
    const valueErr = fieldError(valueGroup, value, "");
    value.addEventListener("input", function () {
      const n = Number(value.value);
      const bad = value.value === "" || !Number.isFinite(n) || n < 0;
      value.setAttribute("aria-invalid", String(bad));
      valueErr.textContent = bad ? "Enter a finite value of 0 or more." : "";
      valueErr.hidden = !bad;
    });
    value.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const n = Number(value.value);
      if (value.value === "" || !Number.isFinite(n) || n < 0) {
        const restored = currentSelected();
        value.value = restored ? restored.value : "";
        value.setAttribute("aria-invalid", "true");
        valueErr.textContent = "Enter a finite value of 0 or more.";
        valueErr.hidden = false;
        return;
      }
      const res = runOperation({
        type: "pie.setValue", sliceId: cur.entityId, value: n,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        value.value = restored ? restored.value : "";
        value.setAttribute("aria-invalid", "true");
        valueErr.textContent = "The model rejected that value.";
        valueErr.hidden = false;
      } else {
        value.removeAttribute("aria-invalid");
        valueErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(valueGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Delete slice", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "pie.deleteSlice", sliceId: cur.entityId }, "clear");
    }, "designer-slice-delete"));
    consequence(actions, "Undo restores the slice.");
    inspectorBodyEl.appendChild(actions);
  }

  function selectEntityOrClear(id) {
    if (!editor) return;
    if (id && editor.entityExists(id)) editor.setSelection([id], "ui");
    else editor.clearSelection("ui");
  }

  function onSelectionChange(payload) {
    if (!isScoped()) {
      selection = null;
      selectionSig = null;
      return;
    }
    const ids = (payload && payload.entityIds) || (editor && editor.selection) || [];
    if (!ids.length) {
      selection = null;
      selectionSig = null;
      renderInspector();
      return;
    }
    const resolved = resolveEntity(ids[0]);
    if (!resolved) {
      selection = null;
      selectionSig = null;
      if (editor && editor.selection && editor.selection.length) {
        try { editor.clearSelection("ui"); } catch (_) {}
      }
      renderInspector();
      return;
    }
    const focusInInspector = !!(inspectorBodyEl && inspectorBodyEl.contains(document.activeElement));
    const sameKind = !!(selection && selection.kind === resolved.kind);
    const rekey = rekeyingParticipant;
    rekeyingParticipant = false;
    selection = resolved;
    selectionSig = signatureOf(resolved);
    if (inspectorEl) inspectorEl.classList.remove("collapsed");
    if (focusInInspector && sameKind && rekey) {
      // A participant rename without an alias re-keys the id. Keep the
      // user's field and caret, and update the header in place.
      updateInspectorHead();
      return;
    }
    renderInspector();
  }

  function checkSelectionDrift() {
    if (!selection) return;
    const resolved = resolveEntity(selection.id);
    if (!resolved || signatureOf(resolved) !== selectionSig) {
      selection = null;
      selectionSig = null;
      if (editor && editor.selection && editor.selection.length) {
        try { editor.clearSelection("ui"); } catch (_) {}
      }
      renderInspector();
      return;
    }
    selection = resolved;
    renderInspector();
  }

  function runOperation(op, policy, opts) {
    if (!editor) return null;
    clearAlert();
    dispatching = true;
    let res = null;
    try { res = editor.dispatch(op); } finally { dispatching = false; }
    const created = res && res.created && res.created[0];
    if (!res) {
      // Rejected op: leave the selection and the field alone; the caller
      // restores the field value and shows the error.
    } else if (policy === "created") {
      selectEntityOrClear(created);
    } else if (policy === "none") {
      // The caller owns the selection change (participant re-key).
    } else if (policy === "clear") {
      selection = null;
      selectionSig = null;
      editor.clearSelection("ui");
      renderInspector();
    } else if (selection) {
      const resolved = resolveEntity(selection.id);
      if (resolved) {
        selection = resolved;
        selectionSig = signatureOf(resolved);
        if (opts && opts.rerender) {
          if (inspectorBodyEl && inspectorBodyEl.contains(document.activeElement)) {
            updateSliceInspectorInPlace();
          } else {
            renderInspector();
          }
        } else if (!inspectorBodyEl || !inspectorBodyEl.contains(document.activeElement)) {
          renderInspector();
        } else {
          updateInspectorHead();
        }
      } else {
        selection = null;
        selectionSig = null;
        editor.clearSelection("ui");
        renderInspector();
      }
    }
    updateStatus();
    updateHistoryButtons();
    updateChartControls();
    if (isScoped() && addFormEl && !addFormEl.contains(document.activeElement)) renderAddForm();
    return res;
  }

  /* --- capability probe (used by hybrid's menu gate) --------------- */

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
    baselineSource = (source.trim() === "") ? EMPTY_SEED : source;
    return true;
  }

  function open(hit) {
    if (!overlay || !hit || !hit.el) return;
    if (isOpen()) { focusCanvas(); return; }
    if (!captureTarget(hit)) {
      notify("Can\u2019t open the designer for this block");
      return;
    }
    hitRef = hit;
    invoker = document.activeElement;
    overlay.hidden = false;
    hasRendered = false;
    setStatus("Loading\u2026", "");
    setState("loading");
    clearAlert();
    focusCanvas();
    mount(++mountToken);
  }

  function close(force) {
    if (!overlay || !isOpen()) return;
    if (applying) return;   // Apply owns the close; Cancel/Esc wait for it
    if (!force && editor && editor.code !== baselineSource) {
      if (!window.confirm(DISCARD_MESSAGE)) return;
    }
    destroyView();
    overlay.hidden = true;
    setState("loading");
    restoreFocus();
  }

  function destroyView() {
    if (unsubChange) { try { unsubChange(); } catch (_) {} unsubChange = null; }
    if (unsubSelection) { try { unsubSelection(); } catch (_) {} unsubSelection = null; }
    if (view) { try { view.destroy(); } catch (_) {} view = null; }
    releaseVendorPointerGuards();
    editor = null;
    if (canvasEl) canvasEl.innerHTML = "";
    resetToolbar();
    clearPalette();
    hasRendered = false;
  }

  /* Visimer's canvas registers a document-level pointerdown capture listener
   * that clears the editor selection when the target is outside the canvas
   * (view.ts `docPointerDown`). The inspector, build sidebar, header, and
   * footer are outside #designer-canvas, so that listener would clear the
   * selection before our controls run. Wrap addEventListener only while the
   * view is constructed: the vendor's listener is wrapped to ignore targets
   * inside the designer overlay but outside the canvas. Canvas-background and
   * page clicks still reach the vendor unchanged. The vendor bundle is not
   * modified. */
  function releaseVendorPointerGuards() {
    if (!vendorPointerGuards.length) return;
    for (const g of vendorPointerGuards) {
      try { document.removeEventListener("pointerdown", g.wrapped, g.options); } catch (_) {}
    }
    vendorPointerGuards = [];
  }

  function createCanvasView(opts) {
    releaseVendorPointerGuards();
    const doc = document;
    const originalAdd = doc.addEventListener;
    const guards = [];
    doc.addEventListener = function (type, cb, options) {
      const capture = options === true || !!(options && options.capture);
      if (type === "pointerdown" && capture && typeof cb === "function") {
        const wrapped = function (event) {
          const target = event && event.target;
          if (target && overlay && overlay.contains(target) &&
              !(canvasEl && canvasEl.contains(target))) {
            return;
          }
          return cb.call(this, event);
        };
        guards.push({ wrapped: wrapped, options: options });
        return originalAdd.call(doc, type, wrapped, options);
      }
      return originalAdd.call(doc, type, cb, options);
    };
    let created = null;
    try {
      created = new window.Visimer.MermaidCanvasView(opts);
    } catch (err) {
      for (const g of guards) {
        try { doc.removeEventListener("pointerdown", g.wrapped, g.options); } catch (_) {}
      }
      throw err;
    } finally {
      doc.addEventListener = originalAdd;
    }
    vendorPointerGuards = vendorPointerGuards.concat(guards);
    return created;
  }

  function focusCanvas() {
    if (canvasEl && canvasEl.focus) {
      try { canvasEl.focus({ preventScroll: true }); } catch (_) { canvasEl.focus(); }
    }
  }

  function restoreFocus() {
    const el = invoker;
    invoker = null;
    const inMenu = el && el.closest && el.closest(".context-menu");
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
    try {
      await NB.lazyload.script(BUNDLE_SRC);
    } catch (_) {
      if (token !== mountToken) return;
      notify("The diagram editor couldn\u2019t be loaded");
      close(true);
      return;
    }
    if (token !== mountToken) return;
    if (!window.Visimer || typeof window.Visimer.MermaidWysiwygEditor !== "function") {
      setError("The diagram editor couldn\u2019t be loaded.", "");
      return;
    }
    let ready = false;
    try { ready = await NB.mermaid.whenReady(); } catch (_) { ready = false; }
    if (token !== mountToken) return;
    if (!ready || !window.mermaid) {
      setError("The diagram renderer couldn\u2019t be loaded.", "");
      return;
    }
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
    hasRendered = false;
    if (typeEl) typeEl.textContent = info.id || "";
    buildPalette(ed, info);
    try {
      view = createCanvasView({
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
    unsubSelection = ed.on("selectionChange", onSelectionChange);
    unsubChange = ed.on("change", function () {
      if (emptyEl) emptyEl.hidden = !(stateName === "ready" && modelEmpty(ed));
      updateStatus();
      updateHistoryButtons();
      if (!dispatching) {
        checkSelectionDrift();
        if (isScoped() && addFormEl && !addFormEl.contains(document.activeElement)) {
          renderAddForm();
        }
        updateChartControls();
      }
    });
    view.on("render", function (payload) {
      if (token !== mountToken || !isOpen()) return;
      if (payload && payload.ok === false) {
        if (!hasRendered) {
          setError("The diagram failed to render.", firstLine(payload.error));
          return;
        }
        showAlert("Preview can\u2019t render this change. Apply still validates before saving.", "preview");
        setStatus("Preview error", "error");
        return;
      }
      if (alertKind === "preview") clearAlert();
      hasRendered = true;
      setState("ready");
      if (emptyEl) emptyEl.hidden = !modelEmpty(ed);
      updateStatus();
      updateHint();
      // Keep focus and the caret in a field the user is still in; the
      // field already shows the committed value and the header is updated
      // by the operation that caused the render.
      if (!inspectorBodyEl || !inspectorBodyEl.contains(document.activeElement)) {
        renderInspector();
      }
    });
    try { await view.render(); } catch (_) { /* the render event reports */ }
  }

  function retry() {
    if (!isOpen()) return;
    clearAlert();
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

  function sourceOf(el) {
    if (!NB.blocks) return "";
    const d = (NB.blocks.forElement && NB.blocks.forElement(el)) ||
      (NB.blocks.forLang && NB.blocks.forLang(FENCE_LANG));
    return (d && NB.blocks.sourceOf) ? NB.blocks.sourceOf(d, el) : "";
  }

  function resolveTarget() {
    if (!target || !target.parent || target.index < 0) return null;
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
      close(true);
      return;
    }
    applying = true;
    if (applyBtn) applyBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    clearAlert();
    setStatus("Applying\u2026", "");
    try {
      await window.mermaid.parse(code);
    } catch (err) {
      applying = false;
      if (applyBtn) applyBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      setStatus("Couldn\u2019t apply \u2014 invalid diagram", "error");
      showAlert("Couldn\u2019t apply \u2014 the diagram is not valid. " + firstLine(err), "apply");
      return;
    }
    if (!NB.hybrid || typeof NB.hybrid.isActive !== "function" || !NB.hybrid.isActive()) {
      applying = false;
      notify("Can\u2019t apply \u2014 the editor is no longer active");
      close(true);
      return;
    }
    const el = resolveTarget();
    if (!el) {
      applying = false;
      notify("Couldn\u2019t apply \u2014 the diagram changed");
      close(true);
      return;
    }
    if (NB.hybrid && typeof NB.hybrid.flushPendingSnapshot === "function") {
      NB.hybrid.flushPendingSnapshot();
    }
    el.replaceWith(rawFence(code));
    try { await NB.mermaid.renderAll(viewerContentEl); } catch (_) {}
    if (NB.hybrid && typeof NB.hybrid.onContentChange === "function") {
      NB.hybrid.onContentChange();
    }
    applying = false;
    if (cancelBtn) cancelBtn.disabled = false;
    close(true);
  }

  /* --- keyboard: Esc, Ctrl/Cmd+Z isolation, focus trap -------------- */

  function focusables() {
    if (!modalEl) return [];
    return Array.from(modalEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) {
      return !el.disabled && el.offsetParent !== null && !el.hidden;
    });
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

  function undoRedo(shift) {
    if (!editor) return;
    if (shift) editor.redo(); else editor.undo();
    // Undo/redo restores a filtered old selection; line-index families can
    // point at a different entity after a structural step. Clear it rather
    // than let the inspector edit the wrong item.
    if (scopeFamily === "sequence" || scopeFamily === "pie") {
      selection = null;
      selectionSig = null;
      editor.clearSelection("ui");
      renderInspector();
    } else {
      checkSelectionDrift();
    }
    updateStatus();
    updateHistoryButtons();
    updateChartControls();
  }

  document.addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      e.stopPropagation();
      if (!editor) return;
      if (canvasEl && canvasEl.contains(e.target)) return;
      undoRedo(e.shiftKey);
      return;
    }
    if (e.key === "Tab") trapTab(e);
  });

  /* --- wiring ------------------------------------------------------- */

  function editSourceFallback() {
    let node = (hitRef && hitRef.el) || null;
    if (target && target.parent && target.parent.children) {
      const live = target.parent.children[target.index];
      if (live) node = live;
    }
    const hit = (node && NB.hybrid && typeof NB.hybrid.codeBlockAt === "function")
      ? NB.hybrid.codeBlockAt(node) : null;
    close(true);
    if (hit && NB.hybrid && typeof NB.hybrid.editPluginSource === "function") {
      NB.hybrid.editPluginSource(hit);
    }
  }

  if (applyBtn) applyBtn.addEventListener("click", apply);
  if (cancelBtn) cancelBtn.addEventListener("click", function () { close(false); });
  if (closeBtn) closeBtn.addEventListener("click", function () { close(false); });
  if (retryBtn) retryBtn.addEventListener("click", retry);
  if (editSrcBtn) editSrcBtn.addEventListener("click", editSourceFallback);
  if (alertDismissEl) alertDismissEl.addEventListener("click", clearAlert);

  function toolAction(fn) {
    return function () { if (view && stateName === "ready") fn(view, editor); };
  }
  if (toolSelectBtn) toolSelectBtn.addEventListener("click", toolAction(function (v) { v.setTool("select"); }));
  if (toolConnectBtn) toolConnectBtn.addEventListener("click", toolAction(function (v) { v.setTool("connect"); }));
  if (undoBtn) undoBtn.addEventListener("click", toolAction(function (v, ed) {
    if (!ed) return;
    undoRedo(false);
  }));
  if (redoBtn) redoBtn.addEventListener("click", toolAction(function (v, ed) {
    if (!ed) return;
    undoRedo(true);
  }));
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close(false);
    });
  }
  if (addFormEl) addFormEl.addEventListener("submit", submitAdd);
  if (addTabsEl) addTabsEl.addEventListener("keydown", handleAddTabsKey);
  if (autonumberInputEl) {
    autonumberInputEl.addEventListener("change", function () {
      runOperation({ type: "seq.toggleAutonumber" }, "clear");
      updateChartControls();
    });
  }
  if (inspectorClearEl) {
    inspectorClearEl.addEventListener("click", function () {
      selection = null;
      selectionSig = null;
      if (editor) editor.clearSelection("ui");
      renderInspector();
      focusCanvas();
    });
  }
  if (grabberEl) {
    grabberEl.addEventListener("click", function () {
      if (!inspectorEl) return;
      inspectorEl.classList.toggle("collapsed");
      updateGrabber();
    });
  }

  NB.mermaidDesign = {
    open: open,
    close: function () { close(false); },
    isOpen: isOpen,
    apply: apply,
    capabilityFor: capabilityFor,
  };
})();
