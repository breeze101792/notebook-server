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
 * The edit UI is three regions for the six scoped families
 * (flowchart, sequence, pie, state, class, er): a build sidebar, the canvas
 * stage, and a contextual inspector. Every required edit has a named control
 * there; the vendor popover is hidden. Other families keep the add-only
 * palette.
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

  /* The families that get the inspector + type-specific add forms.
   * Everything else keeps the original add-only sidebar. */
  const SCOPED_FAMILIES = ["flowchart", "sequence", "pie", "state", "class", "er"];
  const FAMILY_LABEL = {
    flowchart: "Flowchart", sequence: "Sequence", pie: "Pie",
    state: "State", class: "Class", er: "ER",
  };
  const FAMILY_HINT = {
    flowchart: "Select a node or edge to edit it \u00b7 use Add to create one",
    sequence: "Select a participant, message, or note \u00b7 use Add to create one",
    pie: "Select a slice to edit it \u00b7 use Add to create one",
    state: "Select a state or transition \u00b7 use Add to create one",
    class: "Select a class or relation \u00b7 use Add to create one",
    er: "Select an entity or relation \u00b7 use Add to create one",
  };
  const FAMILY_REST = {
    flowchart: "Select a node or edge on the canvas. Node edits: label, shape, " +
      "connect, colors, delete. Edge edits: label, line, arrows, color, reverse, delete.",
    sequence: "Select a participant, message, or note. Participant edits: name, id, " +
      "type, message, delete. Message edits: text, arrow, order, wrap, reverse, delete.",
    pie: "Select a slice to edit its label and value. Edit the title and data values in Chart.",
    state: "Select a state or transition. State edits: label, type, note, connect, " +
      "delete. Transition edits: label, reverse, delete.",
    class: "Select a class or relation. Class edits: name, annotation, members, note, " +
      "delete. Relation edits: type, label, cardinality, reverse, delete.",
    er: "Select an entity or relation. Entity edits: name, attributes, delete. " +
      "Relation edits: cardinalities, identifying, label, delete.",
  };
  const DEFAULT_EMPTY_COPY = "Use the palette to add your first item.";
  const EMPTY_COPY = {
    flowchart: "Add your first node from the sidebar.",
    sequence: "Add your first participant from the sidebar.",
    pie: "Add your first slice from the sidebar.",
    state: "Add your first state from the sidebar.",
    class: "Add your first class from the sidebar.",
    er: "Add your first entity from the sidebar.",
  };

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
    ganttSection: "",
    ganttName: "New task",
    ganttMeta: "1d",
  };

  /* family -> the one labelled add button, backed by editor.dispatch(). */
  const ADD_ACTIONS = {
    gantt: { label: "Add task", op: function () { return { type: "gantt.addTask", section: ADD_DEFAULTS.ganttSection, name: ADD_DEFAULTS.ganttName, meta: ADD_DEFAULTS.ganttMeta }; } },
    lineitem: { label: "Add line", op: function () { return { type: "li.addItem" }; } },
  };

  const DEFAULT_NOTE_TEXT = "note";
  const PIE_HEADER_NOTE =
    "This pie header can\u2019t be rewritten safely; edit it in the source.";
  const CLASS_RENAME_GUARD =
    "This class has a note or annotation the visual editor can\u2019t update. Edit it in the source.";
  const CLASS_DELETE_GUARD =
    "This class has a note the visual editor can\u2019t update. Edit it in the source.";
  const STATE_DELETE_GUARD =
    "This state has a note the visual editor can\u2019t update. Edit it in the source.";
  const BLOCK_ANNOTATION_NOTE =
    "This class uses a block; edit its annotation in the source.";
  const SHARED_LINKSTYLE_NOTE =
    "This edge shares a linkStyle line; edit it in the source.";

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

  const STATE_TYPES = [
    { id: "state", label: "State" },
    { id: "choice", label: "Choice" },
    { id: "fork", label: "Fork" },
    { id: "join", label: "Join" },
  ];

  const FRAGMENT_KINDS = [
    { id: "loop", label: "loop" },
    { id: "alt", label: "alt" },
    { id: "opt", label: "opt" },
    { id: "par", label: "par" },
    { id: "critical", label: "critical" },
    { id: "break", label: "break" },
    { id: "rect", label: "rect" },
  ];

  /* Exact `RelationOp` values from core/class/parse.ts. */
  const CLASS_RELATION_OPS = [
    { id: "<|--", label: "<|--  Inheritance" },
    { id: "--|>", label: "--|>  Inheritance" },
    { id: "<|..", label: "<|..  Realization" },
    { id: "..|>", label: "..|>  Realization" },
    { id: "*--", label: "*--  Composition" },
    { id: "--*", label: "--*  Composition" },
    { id: "o--", label: "o--  Aggregation" },
    { id: "--o", label: "--o  Aggregation" },
    { id: "<--", label: "<--  Association" },
    { id: "-->", label: "-->  Association" },
    { id: "<..", label: "<..  Dependency" },
    { id: "..>", label: "..>  Dependency" },
    { id: "--", label: "--  Link" },
    { id: "..", label: "..  Link" },
  ];

  /* Exact `ErCardinality` values from core/er/ops.ts plus the glyphs the
   * parsed relation carries. */
  const ER_CARDINALITIES = [
    { id: "zero-or-one", label: "Zero or one (|o / o|)", left: "|o", right: "o|" },
    { id: "exactly-one", label: "Exactly one (||)", left: "||", right: "||" },
    { id: "zero-or-more", label: "Zero or more (}o / o{)", left: "}o", right: "o{" },
    { id: "one-or-more", label: "One or more (}| / |{)", left: "}|", right: "|{" },
  ];

  const DIRECTION_OP = {
    flowchart: "setDirection",
    state: "st.setDirection",
    class: "cl.setDirection",
  };

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
  const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]+$/;
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
    state: [{ id: "state", label: "State" }, { id: "transition", label: "Transition" }],
    class: [{ id: "class", label: "Class" }, { id: "relation", label: "Relation" }],
    er: [{ id: "entity", label: "Entity" }, { id: "relation", label: "Relation" }],
  };

  const ADD_TEXT_FIELDS = ["label", "text", "name", "value"];

  const KIND_LABEL = {
    node: "Node", edge: "Edge", participant: "Participant",
    message: "Message", note: "Note", slice: "Slice",
    state: "State", transition: "Transition", class: "Class",
    relation: "Relation", entity: "Entity", erelation: "Relation",
  };
  const KIND_GLYPH = {
    node: "N", edge: "E", participant: "P",
    message: "M", note: "T", slice: "S",
    state: "S", transition: "T", class: "C",
    relation: "R", entity: "E", erelation: "R",
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
  const pieTitleRowEl = document.getElementById("designer-pie-title-row");
  const pieTitleInputEl = document.getElementById("designer-pie-title");
  const pieShowDataEl = document.getElementById("designer-pie-showdata");
  const pieShowDataInputEl = document.getElementById("designer-pie-showdata-input");
  const pieShowDataWordEl = document.getElementById("designer-pie-showdata-word");
  const pieHeaderNoteEl = document.getElementById("designer-pie-header-note");
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

  function participantIdError(value) {
    const v = String(value == null ? "" : value).trim();
    if (!v) return "A participant id needs letters, numbers, _ or -.";
    if (!PARTICIPANT_ID_RE.test(v) || PARTICIPANT_NAME_BAD_RE.test(v)) {
      return "Use letters, numbers, _ or - (no spaces or separators).";
    }
    return "";
  }

  function rekeyParticipant(nextId) {
    if (!editor) return;
    const newEntityId = "participant:" + nextId;
    if (!editor.entityExists(newEntityId)) {
      editor.clearSelection("ui");
      return;
    }
    rekeyingParticipant = true;
    editor.setSelection([newEntityId], "ui");
    rekeyingParticipant = false;
    if (selection && selection.id !== newEntityId) {
      const resolved = resolveEntity(newEntityId);
      if (resolved) {
        selection = resolved;
        selectionSig = signatureOf(resolved);
        updateInspectorHead();
      }
    }
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
    if (pieTitleRowEl) pieTitleRowEl.hidden = true;
    if (pieTitleInputEl) pieTitleInputEl.value = "";
    if (pieShowDataEl) pieShowDataEl.hidden = true;
    if (pieShowDataInputEl) pieShowDataInputEl.checked = false;
    if (pieShowDataWordEl) pieShowDataWordEl.textContent = "Off";
    if (pieHeaderNoteEl) { pieHeaderNoteEl.hidden = true; pieHeaderNoteEl.textContent = ""; }
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

  function stateOptions(states) {
    const opts = states.map(function (s) {
      return { value: s.id, label: s.id + " \u00b7 " + s.label };
    });
    opts.push({ value: "[*]", label: "[*] \u00b7 start / end" });
    return opts;
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
    } else if (family === "state" && tab === "state") {
      textField(addFieldsEl, "Label", "designer-add-label", "label",
        { placeholder: "Idle" });
      selectField(addFieldsEl, "Type", "designer-add-stype", "stype",
        optionList(STATE_TYPES), { value: "state" });
      setAddSubmitText("Add state");
    } else if (family === "state" && tab === "transition") {
      const states = (r && r.state) ? r.state.states : [];
      const opts = stateOptions(states);
      selectField(addFieldsEl, "From", "designer-add-from", "from", opts,
        { placeholder: "Choose a state" });
      selectField(addFieldsEl, "To", "designer-add-to", "to", opts,
        { placeholder: "Choose a state" });
      textField(addFieldsEl, "Label (optional)", "designer-add-label", "label",
        { placeholder: "go" });
      setAddSubmitText("Add transition");
    } else if (family === "class" && tab === "class") {
      textField(addFieldsEl, "Name", "designer-add-name", "name",
        { placeholder: "Order" });
      setAddSubmitText("Add class");
    } else if (family === "class" && tab === "relation") {
      const classes = (r && r.classGraph) ? r.classGraph.classes : [];
      const opts = classes.map(function (c) { return { value: c.id, label: c.id }; });
      selectField(addFieldsEl, "From", "designer-add-from", "from", opts,
        { placeholder: "Choose a class" });
      selectField(addFieldsEl, "To", "designer-add-to", "to", opts,
        { placeholder: "Choose a class" });
      selectField(addFieldsEl, "Type", "designer-add-op", "op",
        optionList(CLASS_RELATION_OPS), { value: "-->" });
      textField(addFieldsEl, "Label (optional)", "designer-add-label", "label",
        { placeholder: "uses" });
      setAddSubmitText("Add relation");
    } else if (family === "er" && tab === "entity") {
      textField(addFieldsEl, "Name", "designer-add-name", "name",
        { placeholder: "ORDER" });
      setAddSubmitText("Add entity");
    } else if (family === "er" && tab === "relation") {
      const entities = (r && r.er) ? r.er.entities : [];
      const opts = entities.map(function (e) { return { value: e.id, label: e.id }; });
      selectField(addFieldsEl, "From", "designer-add-from", "from", opts,
        { placeholder: "Choose an entity" });
      selectField(addFieldsEl, "To", "designer-add-to", "to", opts,
        { placeholder: "Choose an entity" });
      textField(addFieldsEl, "Label", "designer-add-label", "label",
        { placeholder: "places" });
      setAddSubmitText("Add relation");
    } else if (family === "pie") {
      textField(addFieldsEl, "Label", "designer-add-label", "label",
        { placeholder: "Search" });
      textField(addFieldsEl, "Value", "designer-add-value", "value",
        { type: "number", min: 0, step: "any", placeholder: "10" });
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
    } else if (family === "state" && tab === "state") {
      if (!fieldValue("designer-add-label").trim()) return { ok: false };
    } else if (family === "state" && tab === "transition") {
      if (!fieldValue("designer-add-from") || !fieldValue("designer-add-to")) return { ok: false };
    } else if (family === "class" && tab === "class") {
      if (!fieldValue("designer-add-name").trim()) return { ok: false };
    } else if (family === "class" && tab === "relation") {
      if (!fieldValue("designer-add-from") || !fieldValue("designer-add-to") ||
        !fieldValue("designer-add-op")) return { ok: false };
    } else if (family === "er" && tab === "entity") {
      if (!fieldValue("designer-add-name").trim()) return { ok: false };
    } else if (family === "er" && tab === "relation") {
      if (!fieldValue("designer-add-from") || !fieldValue("designer-add-to")) return { ok: false };
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
    if (family === "state" && tab === "state") {
      const label = fieldValue("designer-add-label").trim();
      const stype = fieldValue("designer-add-stype") || "state";
      const res = runOperation({ type: "st.addState", label: label }, "created");
      if (!res) { setAddError("The model rejected that state.", true); return; }
      const created = res.created && res.created[0];
      if (created && stype !== "state") {
        runOperation({ type: "st.setStateType", id: created.slice("state:".length), stype: stype }, "keep");
      }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "state" && tab === "transition") {
      const res = runOperation({
        type: "st.connect",
        source: fieldValue("designer-add-from"),
        target: fieldValue("designer-add-to"),
        label: fieldValue("designer-add-label").trim() || undefined,
      }, "created");
      if (!res) { setAddError("The model rejected that transition.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "class" && tab === "class") {
      const res = runOperation({
        type: "cl.addClass", name: fieldValue("designer-add-name").trim(),
      }, "created");
      if (!res) { setAddError("The model rejected that class.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "class" && tab === "relation") {
      const res = runOperation({
        type: "cl.connect",
        source: fieldValue("designer-add-from"),
        target: fieldValue("designer-add-to"),
        op: fieldValue("designer-add-op") || "-->",
        label: fieldValue("designer-add-label").trim() || undefined,
      }, "created");
      if (!res) { setAddError("The model rejected that relation.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "er" && tab === "entity") {
      const res = runOperation({
        type: "er.addEntity", name: fieldValue("designer-add-name").trim(),
      }, "created");
      if (!res) { setAddError("The model rejected that entity.", true); return; }
      clearAddText();
      renderAddForm();
      focusAddForm();
      return;
    }
    if (family === "er" && tab === "relation") {
      const res = runOperation({
        type: "er.connect",
        source: fieldValue("designer-add-from"),
        target: fieldValue("designer-add-to"),
        label: fieldValue("designer-add-label").trim() || undefined,
      }, "created");
      if (!res) { setAddError("The model rejected that relation.", true); return; }
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

  /* The parsed graph exposes `direction` as a string (flowchart) or as
   * `{value}` (state/class). Keep the mapping in one place. */
  function currentDirection(family) {
    const r = editor && editor.result;
    if (!r) return "TD";
    if (family === "flowchart") return (r.flowchart && r.flowchart.direction) || "TD";
    if (family === "state") return (r.state && r.state.direction && r.state.direction.value) || "TD";
    if (family === "class") {
      return (r.classGraph && r.classGraph.direction && r.classGraph.direction.value) || "TD";
    }
    return "TD";
  }

  function buildDirectionChips(family) {
    if (!directionEl) return;
    directionEl.hidden = false;
    directionEl.setAttribute("aria-label",
      (FAMILY_LABEL[family] || "Diagram") + " direction");
    const current = currentDirection(family);
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
        runOperation({ type: DIRECTION_OP[family], direction: dir.id }, "keep");
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

  function buildChart(ed, family) {
    clearChart();
    if (DIRECTION_OP[family]) {
      if (chartEl) chartEl.hidden = false;
      if (chartDividerEl) chartDividerEl.hidden = false;
      buildDirectionChips(family);
      return;
    }
    if (family === "sequence") {
      if (chartEl) chartEl.hidden = false;
      if (chartDividerEl) chartDividerEl.hidden = false;
      if (autonumberEl) autonumberEl.hidden = false;
      updateChartControls();
      return;
    }
    if (family === "pie") {
      if (chartEl) chartEl.hidden = false;
      if (chartDividerEl) chartDividerEl.hidden = false;
      if (pieTitleRowEl) pieTitleRowEl.hidden = false;
      if (pieShowDataEl) pieShowDataEl.hidden = false;
      updateChartControls();
    }
    void ed;
  }

  /* --- pie header (title + showData) -------------------------------
   * PieGraph carries `showData` but no title, and has no title op. The
   * header line is edited directly: replace only that line, byte-for-byte,
   * through editor.setCode(..., "ui"). A no-op writes nothing. */

  function codeLines(code) {
    const out = [];
    let start = 0;
    let index = 0;
    const text = String(code == null ? "" : code);
    while (start <= text.length) {
      let nl = text.indexOf("\n", start);
      if (nl === -1) nl = text.length;
      const lineText = text.slice(start, nl);
      const indentM = /^[ \t]*/.exec(lineText);
      out.push({
        index: index, text: lineText, start: start, end: nl,
        indent: indentM ? indentM[0] : "",
      });
      index++;
      if (nl === text.length) break;
      start = nl + 1;
    }
    return out;
  }

  function pieHeaderInfo() {
    if (!editor) return null;
    const code = editor.code;
    const lines = [];
    let start = 0;
    while (start <= code.length) {
      const nl = code.indexOf("\n", start);
      const hasNl = nl !== -1;
      const end = hasNl ? nl : code.length;
      let raw = code.slice(start, end);
      // Keep the terminator out of the content span; replacing only the
      // content preserves CRLF and a missing final newline.
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      lines.push({ start: start, end: end, raw: raw, contentEnd: start + raw.length });
      if (!hasNl) break;
      start = end + 1;
    }
    const r = editor.result;
    let idx = (r && typeof r.headerIndex === "number") ? r.headerIndex : -1;
    if (idx < 0 || !lines[idx] || !/^\s*pie\b/.test(lines[idx].raw)) {
      idx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*pie\b/.test(lines[i].raw)) { idx = i; break; }
      }
    }
    if (idx < 0) return null;
    const lineText = lines[idx].raw;
    const commentAt = lineText.indexOf("%%");
    const codePartRaw = commentAt >= 0 ? lineText.slice(0, commentAt) : lineText;
    const gapMatch = /[ \t]*$/.exec(codePartRaw);
    const gap = commentAt >= 0 ? gapMatch[0] : "";
    const codePart = commentAt >= 0 ? codePartRaw.slice(0, gapMatch.index) : codePartRaw;
    const comment = commentAt >= 0 ? lineText.slice(commentAt) : "";
    const m = /^([ \t]*)pie\b(.*)$/.exec(codePart);
    if (!m) return { valid: false, lineIndex: idx };
    let rest = m[2].trim();
    let showData = false;
    if (/^showData\b/.test(rest)) {
      showData = true;
      rest = rest.slice("showData".length).trim();
    }
    let title = "";
    if (rest) {
      const tm = /^title\b([\s\S]*)$/.exec(rest);
      // Unknown tokens after `pie` cannot be reconstructed losslessly.
      if (!tm) return { valid: false, lineIndex: idx };
      title = tm[1].trim();
    }
    return {
      valid: true, indent: m[1], showData: showData, title: title,
      start: lines[idx].start, contentEnd: lines[idx].contentEnd,
      lineIndex: idx, gap: gap, comment: comment,
    };
  }

  function writePieHeader(title, showData) {
    if (!editor) return false;
    const info = pieHeaderInfo();
    if (!info || !info.valid) return false;
    const nextTitle = String(title == null ? "" : title).trim();
    const nextShow = !!showData;
    if (info.title === nextTitle && info.showData === nextShow) return false;
    const header = info.indent + "pie" +
      (nextShow ? " showData" : "") +
      (nextTitle ? " title " + nextTitle : "") +
      info.gap + info.comment;
    const nextCode = editor.code.slice(0, info.start) + header +
      editor.code.slice(info.contentEnd);
    editor.setCode(nextCode, "ui");
    return true;
  }

  function updateChartControls() {
    if (!editor || !isScoped()) return;
    if (DIRECTION_OP[scopeFamily] && directionEl) {
      const current = currentDirection(scopeFamily);
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
    if (scopeFamily === "pie") {
      const info = pieHeaderInfo();
      const valid = !!(info && info.valid);
      if (pieTitleInputEl) {
        pieTitleInputEl.disabled = !valid;
        if (!valid) pieTitleInputEl.value = "";
        else if (document.activeElement !== pieTitleInputEl) {
          pieTitleInputEl.value = info.title;
        }
      }
      const on = valid && info.showData;
      if (pieShowDataInputEl) {
        pieShowDataInputEl.disabled = !valid;
        pieShowDataInputEl.checked = on;
      }
      if (pieShowDataWordEl) pieShowDataWordEl.textContent = on ? "On" : "Off";
      if (pieHeaderNoteEl) {
        pieHeaderNoteEl.textContent = valid ? "" : PIE_HEADER_NOTE;
        pieHeaderNoteEl.hidden = valid;
      }
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
    if (r.state) {
      if (id.indexOf("state:") === 0) {
        const s = r.state.stateById.get(id.slice("state:".length));
        return s ? { kind: "state", id: id, entity: s } : null;
      }
      if (id.indexOf("trans:") === 0) {
        const t = r.state.transitions.find(function (x) { return x.entityId === id; });
        return t ? { kind: "transition", id: id, entity: t } : null;
      }
    }
    if (r.classGraph) {
      if (id.indexOf("class:") === 0) {
        const c = r.classGraph.classById.get(id.slice("class:".length));
        return c ? { kind: "class", id: id, entity: c } : null;
      }
      if (id.indexOf("rel:") === 0) {
        const rel = r.classGraph.relations.find(function (x) { return x.entityId === id; });
        return rel ? { kind: "relation", id: id, entity: rel } : null;
      }
    }
    if (r.er) {
      if (id.indexOf("entity:") === 0) {
        const e = r.er.entityById.get(id.slice("entity:".length));
        return e ? { kind: "entity", id: id, entity: e } : null;
      }
      if (id.indexOf("erel:") === 0) {
        const rel = r.er.relations.find(function (x) { return x.entityId === id; });
        return rel ? { kind: "erelation", id: id, entity: rel } : null;
      }
    }
    return null;
  }

  function signatureOf(sel) {
    const e = sel.entity;
    if (sel.kind === "node") return "node:" + e.id;
    if (sel.kind === "edge") return "edge:" + e.entityId;
    if (sel.kind === "participant") return "participant:" + e.id;
    if (sel.kind === "state") return "state:" + e.id;
    if (sel.kind === "transition") return "transition:" + e.entityId + ":" + e.lineIndex;
    if (sel.kind === "class") return "class:" + e.id;
    if (sel.kind === "relation") return "relation:" + e.entityId + ":" + e.lineIndex;
    if (sel.kind === "entity") return "entity:" + e.id;
    if (sel.kind === "erelation") return "erelation:" + e.entityId + ":" + e.lineIndex;
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
    if (sel.kind === "state") return sel.entity.id;
    if (sel.kind === "transition") return sel.entity.source + " \u2192 " + sel.entity.target;
    if (sel.kind === "class") return sel.entity.id;
    if (sel.kind === "relation") return sel.entity.source + " \u2192 " + sel.entity.target;
    if (sel.kind === "entity") return sel.entity.id;
    if (sel.kind === "erelation") return sel.entity.source + " \u2192 " + sel.entity.target;
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
    const labelled = (control && control.id) ? control
      : (control && control.querySelector ? control.querySelector("input, select") : null);
    if (labelled && labelled.id) lab.htmlFor = labelled.id;
    lab.textContent = labelText;
    row.appendChild(lab);
    row.appendChild(control);
    group.appendChild(row);
    return row;
  }

  function srLabel(id, text) {
    const label = document.createElement("label");
    label.className = "designer-sr-only";
    label.htmlFor = id;
    label.textContent = text;
    return label;
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
    else if (selection.kind === "state") renderStateInspector(selection.entity);
    else if (selection.kind === "transition") renderTransitionInspector(selection.entity);
    else if (selection.kind === "class") renderClassInspector(selection.entity);
    else if (selection.kind === "relation") renderClassRelationInspector(selection.entity);
    else if (selection.kind === "entity") renderErEntityInspector(selection.entity);
    else if (selection.kind === "erelation") renderErRelationInspector(selection.entity);
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

  function unquote(value) {
    const s = String(value == null ? "" : value).trim();
    if (s.length >= 2 &&
        ((s[0] === '"' && s[s.length - 1] === '"') ||
         (s[0] === "'" && s[s.length - 1] === "'"))) {
      return s.slice(1, -1).trim();
    }
    return s;
  }

  /* Return a #rrggbb value only when the source is a readable hex color.
   * A named/rgb value is not turned into black; callers disable the color
   * input and point at the source instead. */
  function hexColor(value) {
    let s = unquote(value);
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : "";
  }

  /* Split a declaration list on top-level commas only. Commas inside
   * parentheses, quotes, or nested brackets are part of a value
   * (`fill:rgb(255,0,0)`). `safe:false` means the list cannot be
   * re-serialized without guessing. */
  function splitTopLevel(text) {
    const source = String(text || "");
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
      if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) return { parts: parts, safe: false, nested: false };
        depth--;
        continue;
      }
      if (ch === "," && depth === 0) {
        parts.push({ text: source.slice(start, i) });
        start = i + 1;
      }
    }
    parts.push({ text: source.slice(start) });
    const safe = !quote && depth === 0;
    const nested = parts.some(function (p) { return p.text.indexOf(",") !== -1; });
    return { parts: parts, safe: safe, nested: nested };
  }

  function stylePropsInfo(text) {
    const split = splitTopLevel(text);
    const props = {};
    let safe = split.safe;
    split.parts.forEach(function (part) {
      const pair = part.text.trim();
      if (!pair) return;
      const at = pair.indexOf(":");
      if (at <= 0) { safe = false; return; }
      props[pair.slice(0, at).trim()] = unquote(pair.slice(at + 1));
    });
    return { props: props, safe: safe, nested: split.nested, parts: split.parts };
  }

  /* A `style` statement can target several ids (`style A,B fill:...`).
   * setNodeColor only understands one id and would rewrite the line for
   * the first id, so multi-id lines disable the color controls. */
  function flowStyleLine(nodeId) {
    const graph = editor && editor.result && editor.result.flowchart;
    if (!graph || !graph.statements) return null;
    const lines = codeLines(editor.code);
    let found = null;
    graph.statements.forEach(function (stmt, lineIndex) {
      if (found || !stmt || stmt.kind !== "style") return;
      const text = (lines[lineIndex] && lines[lineIndex].text || "").trim();
      const m = /^style\s+(\S+)\s*(.*)$/.exec(text);
      if (!m) return;
      const ids = m[1].split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (ids.indexOf(nodeId) === -1) return;
      found = {
        lineIndex: lineIndex,
        indent: lines[lineIndex].indent,
        idToken: m[1],
        ids: ids,
        body: m[2],
        info: stylePropsInfo(m[2]),
      };
    });
    return found;
  }

  function flowStyleFor(nodeId) {
    const line = flowStyleLine(nodeId);
    if (!line) return { multi: false, props: {}, safe: true, nested: false };
    return {
      multi: line.ids.length > 1,
      props: line.info.props,
      safe: line.info.safe,
      nested: line.info.nested,
    };
  }

  /* linkStyle accepts an index list (`linkStyle 0,1 stroke:#f00`). A shared
   * line cannot be rewritten for one edge without affecting the others, so
   * the control is disabled. Multiple matching lines with different strokes
   * are ambiguous and show no value. */
  function flowEdgeStyleInfo(edge) {
    const graph = editor && editor.result && editor.result.flowchart;
    if (!graph || !graph.statements) return { disabled: false, stroke: "" };
    const lines = codeLines(editor.code);
    const matches = [];
    graph.statements.forEach(function (stmt, lineIndex) {
      if (!stmt || stmt.kind !== "linkStyle") return;
      const text = (lines[lineIndex] && lines[lineIndex].text || "").trim();
      const m = /^linkStyle\s+([\d,\s]+)\s*(.*)$/.exec(text);
      if (!m) return;
      const indices = m[1].split(",").map(function (s) {
        return Number(s.trim());
      }).filter(function (n) { return Number.isInteger(n); });
      if (indices.indexOf(edge.order) === -1) return;
      const info = stylePropsInfo(m[2]);
      matches.push({
        multi: indices.length > 1,
        props: info.props,
        unsafe: !info.safe || info.nested,
      });
    });
    if (!matches.length) return { disabled: false, stroke: "" };
    const unsafe = matches.some(function (m) { return m.unsafe; });
    if (matches.length > 1 || unsafe) {
      const values = [];
      matches.forEach(function (m) {
        const v = m.props.stroke || "";
        if (v && values.indexOf(v) === -1) values.push(v);
      });
      return {
        disabled: true,
        stroke: values.length === 1 ? values[0] : "",
        reason: unsafe ? "unsafe" : "shared",
      };
    }
    return {
      disabled: matches[0].multi,
      stroke: matches[0].props.stroke || "",
      reason: matches[0].multi ? "shared" : "",
    };
  }

  function renderColorRow(group, labelText, id, value, disabled, onCommit, onClear, clearId) {
    const raw = value == null ? "" : String(value).trim();
    const hex = hexColor(raw);
    const unsupported = !!raw && !hex;
    const blocked = !!disabled || unsupported;
    const input = inspectorInput(id, hex || "#000000", { type: "color" });
    input.disabled = blocked;
    const clear = actionButton("Clear", "small", function () {
      if (blocked) return;
      onClear();
      input.value = "#000000";
    }, clearId);
    clear.setAttribute("aria-label",
      "Clear " + (id.indexOf("designer-edge-") === 0 ? "edge " : "node ") +
      labelText.toLowerCase());
    clear.disabled = blocked;
    const wrap = document.createElement("span");
    wrap.className = "designer-color-control";
    wrap.appendChild(input);
    wrap.appendChild(clear);
    inspectorRow(group, labelText, wrap);
    if (unsupported) {
      const note = document.createElement("p");
      note.className = "designer-scope-note";
      note.textContent = "This color is not a hex value; edit it in the source.";
      group.appendChild(note);
    }
    input.addEventListener("change", function () {
      if (blocked) return;
      onCommit(input.value);
    });
    return input;
  }

  /* setNodeColor reads the style line with a naive comma split, so a value
   * such as rgb(255,0,0) would be shredded. When the existing line has a
   * nested comma, rewrite only the target declaration and keep the other
   * declaration text byte-for-byte. */
  function safeSetNodeColor(nodeId, prop, value) {
    const line = flowStyleLine(nodeId);
    if (!line || line.ids.length > 1 || !line.info.safe) return false;
    const keyOf = function (text) {
      const pair = String(text || "").trim();
      const at = pair.indexOf(":");
      return at > 0 ? pair.slice(0, at).trim() : null;
    };
    let parts = line.info.parts.map(function (p) { return p.text; });
    if (value == null) {
      parts = parts.filter(function (part) {
        const key = keyOf(part);
        if (key === prop) return false;
        if (prop === "stroke" && key === "stroke-width") return false;
        return true;
      });
    } else {
      let replaced = false;
      parts = parts.map(function (part) {
        if (!replaced && keyOf(part) === prop) {
          replaced = true;
          return prop + ":" + value;
        }
        return part;
      });
      if (!replaced) parts.push(prop + ":" + value);
      if (prop === "stroke" &&
          !parts.some(function (part) { return keyOf(part) === "stroke-width"; })) {
        parts.push("stroke-width:2px");
      }
    }
    if (parts.length) {
      const nextLine = line.indent + "style " + line.idToken + " " + parts.join(",");
      const lines = codeLines(editor.code);
      const row = lines[line.lineIndex];
      const contentLen = row.text.endsWith("\r") ? row.text.length - 1 : row.text.length;
      const nextCode = editor.code.slice(0, row.start) + nextLine +
        editor.code.slice(row.start + contentLen);
      editor.setCode(nextCode, "ui");
    } else {
      const lines = codeLines(editor.code);
      const row = lines[line.lineIndex];
      let start = row.start;
      let end = row.end;
      if (editor.code[end] === "\n") end++;
      else if (start > 0 && editor.code[start - 1] === "\n") start--;
      editor.setCode(editor.code.slice(0, start) + editor.code.slice(end), "ui");
    }
    return true;
  }

  function renderNodeColors(node) {
    const info = flowStyleFor(node.id);
    const blocked = info.multi || !info.safe;
    const group = inspectorGroup("Color");
    if (info.multi) {
      const note = document.createElement("p");
      note.className = "designer-scope-note";
      note.textContent = "This node shares a style line; edit it in the source.";
      group.appendChild(note);
    } else if (!info.safe) {
      const note = document.createElement("p");
      note.className = "designer-scope-note";
      note.textContent = "This style line can\u2019t be parsed safely; edit it in the source.";
      group.appendChild(note);
    }
    ["fill", "stroke", "color"].forEach(function (prop) {
      const label = prop === "fill" ? "Fill" : prop === "stroke" ? "Stroke" : "Text";
      renderColorRow(group, label, "designer-node-" + prop, info.props[prop], blocked,
        function (value) {
          const cur = currentSelected();
          if (!cur) return;
          if (info.nested) {
            if (!safeSetNodeColor(cur.id, prop, value)) {
              showAlert("The model rejected that color.");
            }
            return;
          }
          const res = runOperation({ type: "setNodeColor", id: cur.id, prop: prop, value: value }, "keep");
          if (!res) showAlert("The model rejected that color.");
        },
        function () {
          const cur = currentSelected();
          if (!cur) return;
          if (info.nested) {
            safeSetNodeColor(cur.id, prop, null);
            return;
          }
          runOperation({ type: "setNodeColor", id: cur.id, prop: prop, value: null }, "keep");
        },
        "designer-node-" + prop + "-clear");
    });
    inspectorBodyEl.appendChild(group);
  }

  function renderEdgeColor(edge) {
    const info = flowEdgeStyleInfo(edge);
    const group = inspectorGroup("Color");
    if (info.disabled) {
      const note = document.createElement("p");
      note.className = "designer-scope-note";
      note.textContent = info.reason === "unsafe"
        ? "This linkStyle line can\u2019t be parsed safely; edit it in the source."
        : SHARED_LINKSTYLE_NOTE;
      group.appendChild(note);
    }
    renderColorRow(group, "Stroke", "designer-edge-stroke", info.stroke, info.disabled,
      function (value) {
        const cur = currentSelected();
        if (!cur) return;
        const res = runOperation({ type: "setEdgeColor", edgeId: cur.entityId, value: value }, "keep");
        if (!res) showAlert("The model rejected that color.");
      },
      function () {
        const cur = currentSelected();
        if (!cur) return;
        runOperation({ type: "setEdgeColor", edgeId: cur.entityId, value: null }, "keep");
      },
      "designer-edge-stroke-clear");
    inspectorBodyEl.appendChild(group);
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

    renderNodeColors(node);

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

    renderEdgeColor(edge);

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
      if (!hadAlias && sanitized !== cur.id &&
          editor.entityExists("participant:" + sanitized)) {
        restoreInput(name, cur.label);
        nameErr.textContent = "That participant id is already in use.";
        nameErr.hidden = false;
        return;
      }
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
      if (!hadAlias) rekeyParticipant(sanitized);
    });
    inspectorBodyEl.appendChild(nameGroup);

    const alias = !!(part.decl && part.decl.alias);
    const idGroup = inspectorGroup("Id");
    const idInput = inspectorInput("designer-participant-id", part.id);
    idInput.disabled = alias;
    inspectorRow(idGroup, "Id", idInput);
    if (alias) {
      const note = document.createElement("p");
      note.className = "designer-scope-note";
      note.textContent = "This participant uses an alias; edit the display name.";
      idGroup.appendChild(note);
    } else {
      const idErr = fieldError(idGroup, idInput, "");
      idInput.addEventListener("change", function () {
        const cur = currentSelected();
        if (!cur) return;
        const value = idInput.value.trim();
        const problem = participantIdError(value);
        if (problem) {
          restoreInput(idInput, cur.id);
          idErr.textContent = problem;
          idErr.hidden = false;
          return;
        }
        if (value === cur.id) {
          clearInputError(idInput);
          idErr.hidden = true;
          return;
        }
        if (editor.entityExists("participant:" + value)) {
          restoreInput(idInput, cur.id);
          idErr.textContent = "That participant id is already in use.";
          idErr.hidden = false;
          return;
        }
        const res = runOperation({
          type: "seq.renameParticipant", id: cur.id, name: value,
        }, "none");
        if (!res) {
          restoreInput(idInput, cur.id);
          idErr.textContent = "The model rejected that id.";
          idErr.hidden = false;
          return;
        }
        clearInputError(idInput);
        idErr.hidden = true;
        rekeyParticipant(value);
      });
    }
    inspectorBodyEl.appendChild(idGroup);

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

  function renderWrapGroup(kind) {
    const group = inspectorGroup("Wrap in");
    const select = inspectorSelect(
      kind === "note" ? "designer-note-wrap" : "designer-message-wrap", "",
      [{ value: "", label: "Choose a fragment" }].concat(optionList(FRAGMENT_KINDS)));
    inspectorRow(group, "Fragment", select);
    select.addEventListener("change", function () {
      if (!select.value) return;
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "seq.wrapInFragment", eventId: cur.entityId, kind: select.value,
      }, "clear");
      if (!res) {
        select.value = "";
        showAlert("The model rejected that fragment.");
      }
    });
    inspectorBodyEl.appendChild(group);
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

    renderWrapGroup("message");

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

    renderWrapGroup("note");

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

  /* --- state / class / ER inspectors ------------------------------- */

  function inspectorCheckbox(id, checked) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = !!checked;
    return input;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function sourceHasLine(re) {
    if (!editor) return false;
    return String(editor.code).split(/\r?\n/).some(function (line) {
      return re.test(line.trim());
    });
  }

  function classNoteReferences(id) {
    const esc = escapeRegExp(id);
    return sourceHasLine(new RegExp("^note\\s+for\\s+" + esc + "(?:\\s+|\"|$)"));
  }

  function stateNoteReferences(id) {
    const esc = escapeRegExp(id);
    return sourceHasLine(new RegExp("^note\\s+(?:left|right)\\s+of\\s+" + esc + "(?:\\s*:|\\s*$)"));
  }

  function classHasAnnotation(id) {
    const graph = editor && editor.result && editor.result.classGraph;
    if (!graph || !graph.statements) return false;
    let found = false;
    graph.statements.forEach(function (stmt) {
      if (stmt.kind === "annotation" && stmt.parts[1] === id) found = true;
    });
    return found;
  }

  function classAnnotationFor(cls) {
    const graph = editor && editor.result && editor.result.classGraph;
    if (!graph || !graph.statements) return "";
    let value = "";
    graph.statements.forEach(function (stmt) {
      if (stmt.kind === "annotation" && stmt.parts[1] === cls.id) {
        value = stmt.parts[0] || "";
      }
    });
    return value;
  }

  function restoreInput(input, value) {
    input.value = value == null ? "" : String(value);
    input.setAttribute("aria-invalid", "true");
  }

  function clearInputError(input) {
    input.removeAttribute("aria-invalid");
  }

  function renderStateInspector(state) {
    const labelGroup = inspectorGroup("Label");
    const label = inspectorInput("designer-state-label", state.label);
    inspectorRow(labelGroup, "Label", label);
    const labelErr = fieldError(labelGroup, label, "");
    label.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({ type: "st.setStateLabel", id: cur.id, label: label.value }, "keep");
      if (!res) {
        restoreInput(label, cur.label);
        labelErr.textContent = "The model rejected that label.";
        labelErr.hidden = false;
      } else {
        clearInputError(label);
        labelErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(labelGroup);

    const typeGroup = inspectorGroup("Type");
    const type = inspectorSelect("designer-state-type", state.stereotype || "state",
      optionList(STATE_TYPES));
    inspectorRow(typeGroup, "Type", type);
    type.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({ type: "st.setStateType", id: cur.id, stype: type.value }, "keep");
      if (!res) {
        const restored = currentSelected();
        type.value = restored ? (restored.stereotype || "state") : (state.stereotype || "state");
      }
    });
    inspectorBodyEl.appendChild(typeGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Add note left", "", function () {
      const cur = currentSelected();
      if (cur) runOperation({
        type: "st.addStateNote", id: cur.id, side: "left", text: DEFAULT_NOTE_TEXT,
      }, "keep");
    }, "designer-state-note-left"));
    actions.appendChild(actionButton("Add note right", "", function () {
      const cur = currentSelected();
      if (cur) runOperation({
        type: "st.addStateNote", id: cur.id, side: "right", text: DEFAULT_NOTE_TEXT,
      }, "keep");
    }, "designer-state-note-right"));
    actions.appendChild(actionButton("Connect from this state", "", function () {
      const cur = currentSelected();
      if (cur) switchAddTab("transition", { from: cur.id });
    }, "designer-state-connect"));
    actions.appendChild(actionButton("Delete state", "danger", function () {
      const cur = currentSelected();
      if (!cur) return;
      if (stateNoteReferences(cur.id)) {
        showAlert(STATE_DELETE_GUARD);
        return;
      }
      if (!runOperation({ type: "st.deleteState", id: cur.id }, "clear")) {
        showAlert("This state can\u2019t be deleted visually. Edit it in the source.");
      }
    }, "designer-state-delete"));
    consequence(actions, "Deleting removes the state and its transitions. Undo restores.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderTransitionInspector(trans) {
    const labelGroup = inspectorGroup("Label");
    const label = inspectorInput("designer-transition-label", trans.label || "");
    inspectorRow(labelGroup, "Label", label);
    const labelErr = fieldError(labelGroup, label, "");
    label.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "st.setTransitionLabel", transId: cur.entityId, label: label.value,
      }, "keep");
      if (!res) {
        restoreInput(label, cur.label || "");
        labelErr.textContent = "The model rejected that label.";
        labelErr.hidden = false;
      } else {
        clearInputError(label);
        labelErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(labelGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Reverse direction", "", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "st.reverseTransition", transId: cur.entityId }, "clear");
    }, "designer-transition-reverse"));
    actions.appendChild(actionButton("Delete transition", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "st.deleteTransition", transId: cur.entityId }, "clear");
    }, "designer-transition-delete"));
    consequence(actions, "Undo restores the transition.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderClassInspector(cls) {
    const nameGroup = inspectorGroup("Name");
    const name = inspectorInput("designer-class-name", cls.id);
    inspectorRow(nameGroup, "Name", name);
    const nameErr = fieldError(nameGroup, name, "");
    name.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const value = name.value.trim();
      if (classNoteReferences(cur.id) || classHasAnnotation(cur.id)) {
        restoreInput(name, cur.id);
        nameErr.textContent = CLASS_RENAME_GUARD;
        nameErr.hidden = false;
        return;
      }
      const res = runOperation({ type: "cl.renameClass", id: cur.id, name: value }, "none");
      if (!res) {
        restoreInput(name, cur.id);
        nameErr.textContent = "The model rejected that name.";
        nameErr.hidden = false;
        return;
      }
      clearInputError(name);
      nameErr.hidden = true;
      const next = value.replace(/[^\w.~]/g, "");
      if (next && editor.entityExists("class:" + next)) editor.setSelection(["class:" + next], "ui");
      else editor.clearSelection("ui");
    });
    inspectorBodyEl.appendChild(nameGroup);

    const annoGroup = inspectorGroup("Annotation");
    const anno = inspectorInput("designer-class-annotation", classAnnotationFor(cls));
    anno.disabled = !!cls.block;
    inspectorRow(annoGroup, "Annotation", anno);
    if (cls.block) {
      const note = document.createElement("p");
      note.className = "designer-scope-note";
      note.textContent = BLOCK_ANNOTATION_NOTE;
      annoGroup.appendChild(note);
    } else {
      anno.addEventListener("change", function () {
        const cur = currentSelected();
        if (!cur) return;
        const value = anno.value.trim();
        const res = runOperation({
          type: "cl.setAnnotation", id: cur.id, annotation: value || null,
        }, "keep");
        if (!res) {
          restoreInput(anno, classAnnotationFor(cur));
          anno.setAttribute("aria-invalid", "true");
        } else {
          clearInputError(anno);
          renderInspector();
        }
      });
    }
    inspectorBodyEl.appendChild(annoGroup);

    const membersGroup = inspectorGroup("Members");
    const list = document.createElement("div");
    list.className = "designer-member-list";
    (cls.members || []).forEach(function (member, index) {
      const row = document.createElement("div");
      row.className = "designer-member-row";
      const input = inspectorInput("designer-class-member-" + member.lineIndex, member.text);
      row.appendChild(srLabel(input.id, "Member " + (index + 1)));
      input.addEventListener("change", function () {
        const cur = currentSelected();
        if (!cur) return;
        const res = runOperation({
          type: "cl.setMemberText", id: cur.id,
          memberLine: member.lineIndex, text: input.value,
        }, "keep");
        if (!res) restoreInput(input, member.text);
        else {
          clearInputError(input);
          if (!input.value.trim()) renderInspector();
        }
      });
      const del = actionButton("Delete", "small", function () {
        const cur = currentSelected();
        if (!cur) return;
        if (runOperation({
          type: "cl.deleteMember", id: cur.id, memberLine: member.lineIndex,
        }, "keep")) renderInspector();
      }, "designer-class-member-delete-" + member.lineIndex);
      row.appendChild(input);
      row.appendChild(del);
      list.appendChild(row);
    });
    membersGroup.appendChild(list);
    const addRow = document.createElement("div");
    addRow.className = "designer-action-row";
    const newMember = inspectorInput("designer-class-member-new", "");
    newMember.placeholder = "+field : Type";
    addRow.appendChild(srLabel(newMember.id, "New member"));
    const addMember = actionButton("Add member", "", function () {
      const cur = currentSelected();
      if (!cur) return;
      const text = newMember.value.trim();
      const res = runOperation({ type: "cl.addMember", id: cur.id, text: text || undefined }, "keep");
      if (!res) showAlert("The model rejected that member.");
      else { newMember.value = ""; renderInspector(); }
    }, "designer-class-member-add");
    addRow.appendChild(newMember);
    addRow.appendChild(addMember);
    membersGroup.appendChild(addRow);
    inspectorBodyEl.appendChild(membersGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Add note", "", function () {
      const cur = currentSelected();
      if (cur) runOperation({
        type: "cl.addNoteFor", id: cur.id, text: DEFAULT_NOTE_TEXT,
      }, "keep");
    }, "designer-class-note"));
    actions.appendChild(actionButton("Delete class", "danger", function () {
      const cur = currentSelected();
      if (!cur) return;
      if (classNoteReferences(cur.id)) {
        showAlert(CLASS_DELETE_GUARD);
        return;
      }
      runOperation({ type: "cl.deleteClass", id: cur.id }, "clear");
    }, "designer-class-delete"));
    consequence(actions, "Deleting removes the class, its members, and its relations. Undo restores.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderClassRelationInspector(rel) {
    const typeGroup = inspectorGroup("Type");
    const type = inspectorSelect("designer-relation-type", rel.stmt.op,
      optionList(CLASS_RELATION_OPS));
    inspectorRow(typeGroup, "Type", type);
    type.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "cl.setRelationType", relId: cur.entityId, op: type.value,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        type.value = restored ? restored.stmt.op : rel.stmt.op;
      }
    });
    inspectorBodyEl.appendChild(typeGroup);

    const labelGroup = inspectorGroup("Label");
    const label = inspectorInput("designer-relation-label", rel.label || "");
    inspectorRow(labelGroup, "Label", label);
    const labelErr = fieldError(labelGroup, label, "");
    label.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "cl.setRelationLabel", relId: cur.entityId, label: label.value,
      }, "keep");
      if (!res) {
        restoreInput(label, cur.label || "");
        labelErr.textContent = "The model rejected that label.";
        labelErr.hidden = false;
      } else {
        clearInputError(label);
        labelErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(labelGroup);

    const cardGroup = inspectorGroup("Cardinality");
    const source = inspectorInput("designer-relation-source-card", rel.stmt.sourceCard || "");
    source.placeholder = "1";
    inspectorRow(cardGroup, "Source", source);
    source.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const value = source.value.trim();
      const res = runOperation({
        type: "cl.setCardinality", relId: cur.entityId, side: "source", value: value || null,
      }, "keep");
      if (!res) restoreInput(source, cur.stmt.sourceCard || "");
      else clearInputError(source);
    });
    const target = inspectorInput("designer-relation-target-card", rel.stmt.targetCard || "");
    target.placeholder = "0..*";
    inspectorRow(cardGroup, "Target", target);
    target.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const value = target.value.trim();
      const res = runOperation({
        type: "cl.setCardinality", relId: cur.entityId, side: "target", value: value || null,
      }, "keep");
      if (!res) restoreInput(target, cur.stmt.targetCard || "");
      else clearInputError(target);
    });
    inspectorBodyEl.appendChild(cardGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Reverse direction", "", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "cl.reverseRelation", relId: cur.entityId }, "clear");
    }, "designer-relation-reverse"));
    actions.appendChild(actionButton("Delete relation", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "cl.deleteRelation", relId: cur.entityId }, "clear");
    }, "designer-relation-delete"));
    consequence(actions, "Undo restores the relation.");
    inspectorBodyEl.appendChild(actions);
  }

  function erCardFor(glyph, side) {
    for (const card of ER_CARDINALITIES) {
      if (side === "left" ? card.left === glyph : card.right === glyph) return card.id;
    }
    return "exactly-one";
  }

  function renderErEntityInspector(entity) {
    const nameGroup = inspectorGroup("Name");
    const name = inspectorInput("designer-entity-name", entity.id);
    inspectorRow(nameGroup, "Name", name);
    const nameErr = fieldError(nameGroup, name, "");
    name.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const value = name.value.trim();
      const res = runOperation({ type: "er.renameEntity", id: cur.id, name: value }, "none");
      if (!res) {
        restoreInput(name, cur.id);
        nameErr.textContent = "The model rejected that name.";
        nameErr.hidden = false;
        return;
      }
      clearInputError(name);
      nameErr.hidden = true;
      const next = value.replace(/[^\w-]/g, "");
      if (next && editor.entityExists("entity:" + next)) editor.setSelection(["entity:" + next], "ui");
      else editor.clearSelection("ui");
    });
    inspectorBodyEl.appendChild(nameGroup);

    const attrsGroup = inspectorGroup("Attributes");
    const list = document.createElement("div");
    list.className = "designer-member-list";
    (entity.attributes || []).forEach(function (attr, index) {
      const row = document.createElement("div");
      row.className = "designer-member-row";
      const input = inspectorInput("designer-entity-attr-" + attr.lineIndex, attr.text);
      row.appendChild(srLabel(input.id, "Attribute " + (index + 1)));
      input.addEventListener("change", function () {
        const cur = currentSelected();
        if (!cur) return;
        const res = runOperation({
          type: "er.setAttributeText", id: cur.id,
          attrLine: attr.lineIndex, text: input.value,
        }, "keep");
        if (!res) restoreInput(input, attr.text);
        else {
          clearInputError(input);
          if (!input.value.trim()) renderInspector();
        }
      });
      row.appendChild(input);
      list.appendChild(row);
    });
    attrsGroup.appendChild(list);
    const addRow = document.createElement("div");
    addRow.className = "designer-action-row";
    const newAttr = inspectorInput("designer-entity-attr-new", "");
    newAttr.placeholder = "string name";
    addRow.appendChild(srLabel(newAttr.id, "New attribute"));
    const addAttr = actionButton("Add attribute", "", function () {
      const cur = currentSelected();
      if (!cur) return;
      const text = newAttr.value.trim();
      const res = runOperation({ type: "er.addAttribute", id: cur.id, text: text || undefined }, "keep");
      if (!res) showAlert("The model rejected that attribute.");
      else { newAttr.value = ""; renderInspector(); }
    }, "designer-entity-attr-add");
    addRow.appendChild(newAttr);
    addRow.appendChild(addAttr);
    attrsGroup.appendChild(addRow);
    inspectorBodyEl.appendChild(attrsGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Delete entity", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "er.deleteEntity", id: cur.id }, "clear");
    }, "designer-entity-delete"));
    consequence(actions, "Deleting removes the entity, its attributes, and its relations. Undo restores.");
    inspectorBodyEl.appendChild(actions);
  }

  function renderErRelationInspector(rel) {
    const cardGroup = inspectorGroup("Cardinality");
    const left = inspectorSelect("designer-er-left-card", erCardFor(rel.stmt.leftCard, "left"),
      optionList(ER_CARDINALITIES));
    inspectorRow(cardGroup, "Left", left);
    left.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "er.setCardinality", relId: cur.entityId, side: "left", card: left.value,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        left.value = restored ? erCardFor(restored.stmt.leftCard, "left") : erCardFor(rel.stmt.leftCard, "left");
      }
    });
    const right = inspectorSelect("designer-er-right-card", erCardFor(rel.stmt.rightCard, "right"),
      optionList(ER_CARDINALITIES));
    inspectorRow(cardGroup, "Right", right);
    right.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "er.setCardinality", relId: cur.entityId, side: "right", card: right.value,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        right.value = restored ? erCardFor(restored.stmt.rightCard, "right") : erCardFor(rel.stmt.rightCard, "right");
      }
    });
    inspectorBodyEl.appendChild(cardGroup);

    const idGroup = inspectorGroup("Identifying");
    const identifying = inspectorCheckbox("designer-er-identifying", rel.stmt.line === "--");
    inspectorRow(idGroup, "Identifying", identifying);
    identifying.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "er.setIdentifying", relId: cur.entityId, identifying: identifying.checked,
      }, "keep");
      if (!res) {
        const restored = currentSelected();
        identifying.checked = restored ? restored.stmt.line === "--" : rel.stmt.line === "--";
      }
    });
    inspectorBodyEl.appendChild(idGroup);

    const labelGroup = inspectorGroup("Label");
    const label = inspectorInput("designer-er-relation-label", rel.label || "");
    inspectorRow(labelGroup, "Label", label);
    const labelErr = fieldError(labelGroup, label, "");
    label.addEventListener("change", function () {
      const cur = currentSelected();
      if (!cur) return;
      const res = runOperation({
        type: "er.setRelationLabel", relId: cur.entityId, label: label.value,
      }, "keep");
      if (!res) {
        restoreInput(label, cur.label || "");
        labelErr.textContent = "The model rejected that label.";
        labelErr.hidden = false;
      } else {
        clearInputError(label);
        labelErr.hidden = true;
      }
    });
    inspectorBodyEl.appendChild(labelGroup);

    const actions = inspectorGroup("Actions");
    actions.appendChild(actionButton("Delete relation", "danger", function () {
      const cur = currentSelected();
      if (cur) runOperation({ type: "er.deleteRelation", relId: cur.entityId }, "clear");
    }, "designer-er-relation-delete"));
    consequence(actions, "Undo restores the relation.");
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
    if (NB.dialog) {
      // The rendered block, not a context-menu item that close() destroys.
      const fallback = target && target.parent
        ? target.parent.children[target.index] : null;
      NB.dialog.open(overlay, { fallbackFocus: fallback });
    }
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
    if (NB.dialog) NB.dialog.close(overlay);
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

  /* --- keyboard: Esc and Ctrl/Cmd+Z isolation ----------------------- */

  function undoRedo(shift) {
    if (!editor) return;
    if (shift) editor.redo(); else editor.undo();
    // Undo/redo restores a filtered old selection; line-index families can
    // point at a different entity after a structural step. Clear it rather
    // than let the inspector edit the wrong item.
    if (scopeFamily === "sequence" || scopeFamily === "pie" ||
        scopeFamily === "state" || scopeFamily === "class" || scopeFamily === "er") {
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
  if (pieTitleInputEl) {
    pieTitleInputEl.addEventListener("change", function () {
      const info = pieHeaderInfo();
      writePieHeader(pieTitleInputEl.value, info ? info.showData : false);
      updateChartControls();
    });
  }
  if (pieShowDataInputEl) {
    pieShowDataInputEl.addEventListener("change", function () {
      const info = pieHeaderInfo();
      writePieHeader(info ? info.title : "", pieShowDataInputEl.checked);
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
