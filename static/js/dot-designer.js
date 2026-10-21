/* dot-designer.js -- the Graphviz (```dot / ```graphviz) design window.
 *
 * The editor is deliberately line-local over a strict single-graph subset
 * (docs/architecture/dot-wavedrom-designer.md §5): untouched lines stay
 * byte-identical; only the statement whose label/endpoint changed, the
 * standalone rankdir line, and appended statements are rewritten. Anything
 * outside the subset reports capability "render" and stays on the source
 * path; the window never guesses and never drops a construct.
 *
 * The shared lifecycle (open/close/focus/apply) lives in designer-shell.js.
 * This module supplies the model, the parser/serializer, the preview, and
 * the sidebar/inspector/canvas UI.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const LANG = "dot";
  const CONTAINER_SEL = ".viz-container, .viz-error";
  const BADGE = "Graphviz";
  const HINT = "Select a node or edge to edit it";
  const DISABLED_TITLE =
    "This graph can\u2019t be edited visually \u2014 use Edit source";
  const EMPTY_COPY = "Add your first node.";
  const DEFAULT_INDENT = "  ";
  const PREVIEW_DEBOUNCE = 150;
  const MIN_HIT_SIZE = 28;
  const DIRECTIONS = ["TB", "LR", "BT", "RL"];
  const DIRECTION_LABEL = {
    TB: "Top-bottom (TB)",
    LR: "Left-right (LR)",
    BT: "Bottom-top (BT)",
    RL: "Right-left (RL)",
  };
  const SHAPES = [
    { key: "box", label: "Box" },
    { key: "ellipse", label: "Ellipse" },
    { key: "circle", label: "Circle" },
    { key: "diamond", label: "Diamond" },
    { key: "hexagon", label: "Hexagon" },
    { key: "cylinder", label: "Cylinder" },
    { key: "note", label: "Note" },
    { key: "plaintext", label: "Plain" },
  ];
  const NODE_STYLES = [
    { key: "default", label: "Default", value: null },
    { key: "filled", label: "Filled", value: "filled" },
    { key: "rounded", label: "Rounded", value: "rounded" },
    { key: "filledRounded", label: "Filled + rounded", value: '"filled,rounded"' },
    { key: "dashed", label: "Dashed", value: "dashed" },
    { key: "dotted", label: "Dotted", value: "dotted" },
  ];
  const EDGE_LINES = [
    { key: "solid", label: "Solid", value: "solid" },
    { key: "dashed", label: "Dashed", value: "dashed" },
    { key: "dotted", label: "Dotted", value: "dotted" },
    { key: "bold", label: "Bold", value: "bold" },
  ];
  const EDGE_ARROWS = [
    { key: "none", label: "No arrow" },
    { key: "normal", label: "Normal" },
    { key: "vee", label: "Vee" },
    { key: "diamond", label: "Diamond" },
    { key: "dot", label: "Dot" },
    { key: "both", label: "Both ends" },
  ];
  const SHAPE_KEYS = SHAPES.map(function (x) { return x.key; });
  const NODE_STYLE_BY_KEY = {};
  NODE_STYLES.forEach(function (x) { NODE_STYLE_BY_KEY[x.key] = x; });
  const EDGE_LINE_BY_KEY = {};
  EDGE_LINES.forEach(function (x) { EDGE_LINE_BY_KEY[x.key] = x; });
  const EDGE_ARROW_BY_KEY = {};
  EDGE_ARROWS.forEach(function (x) { EDGE_ARROW_BY_KEY[x.key] = x; });
  const ADD_NODE = "node";
  const ADD_EDGE = "edge";
  const NODE_LABEL_ID = "dw-node-label";
  const EDGE_LABEL_ID = "dw-edge-label";
  const EDGE_FROM_ID = "dw-edge-from";
  const EDGE_TO_ID = "dw-edge-to";
  const ADD_ID = "dw-add-node-id";
  const ADD_LABEL_ID = "dw-add-node-label";
  const ADD_FROM_ID = "dw-add-edge-from";
  const ADD_TO_ID = "dw-add-edge-to";
  const ADD_EDGE_LABEL_ID = "dw-add-edge-label";
  const ADD_STYLE_ID = "dw-add-node-style";
  const ADD_LINE_ID = "dw-add-edge-line";
  const ADD_ARROW_ID = "dw-add-edge-arrow";
  const NODE_STYLE_ID = "dw-node-style";
  const EDGE_LINE_ID = "dw-edge-line";
  const EDGE_ARROW_ID = "dw-edge-arrow";

  const BARE_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const NUMERAL_ID_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const ATTR_BAD_CHARS_RE = /[+<>|{};]/;

  let model = null;
  let selection = null;       // {kind:"node", id} | {kind:"edge", from, to, ordinal}
  let activeTab = ADD_NODE;
  let addShape = "box";
  let addStyle = "default";
  let addLine = "solid";
  let addArrow = "normal";
  let edgePrefill = null;
  let previewTimer = null;

  /* --- small DOM helpers ------------------------------------------- */

  function make(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function fieldRow(labelText, control, id) {
    const row = make("div", "designer-field-row");
    const label = make("label", "designer-field-label", labelText);
    label.setAttribute("for", id);
    row.appendChild(label);
    row.appendChild(control);
    return row;
  }

  function inputEl(id, value, placeholder) {
    const input = document.createElement("input");
    input.id = id;
    input.className = "designer-field";
    input.type = "text";
    input.value = value == null ? "" : value;
    input.autocomplete = "off";
    if (placeholder) input.placeholder = placeholder;
    return input;
  }

  function selectEl(id, values, current) {
    const sel = document.createElement("select");
    sel.id = id;
    sel.className = "designer-select";
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v.value;
      opt.textContent = v.label;
      if (v.value === current) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  /* --- lexer -------------------------------------------------------- */

  function readQuoted(text, i) {
    let j = i + 1;
    let value = "";
    while (j < text.length) {
      const c = text[j];
      if (c === "\\") {
        const n = text[j + 1];
        if (n === "n") { value += "\\n"; j += 2; continue; }
        if (n === '"' || n === "\\") { value += n; j += 2; continue; }
        throw new Error("Unsupported escape in a quoted value");
      }
      if (c === '"') return { value: value, raw: text.slice(i, j + 1), end: j + 1 };
      value += c;
      j++;
    }
    throw new Error("Unterminated quoted value");
  }

  function readId(text, i) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return null;
    if (text[i] === '"') {
      const q = readQuoted(text, i);
      return { value: q.value, raw: q.raw, end: q.end, bare: false };
    }
    if (text[i] === "-" && text[i + 1] === "-") return null;
    const rest = text.slice(i);
    let m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (!m) m = NUMERAL_ID_RE.exec(rest);
    if (!m) return null;
    return { value: m[0], raw: m[0], end: i + m[0].length, bare: true };
  }

  function readValue(text, i) {
    if (text[i] === '"') {
      const q = readQuoted(text, i);
      return { value: q.value, raw: q.raw, end: q.end };
    }
    const m = /^[^\s,\]]+/.exec(text.slice(i));
    if (!m) return null;
    const tok = m[0];
    if (ATTR_BAD_CHARS_RE.test(tok)) {
      throw new Error("Unsupported attribute value " + tok);
    }
    if (tok.indexOf("//") === 0 || tok.indexOf("/*") === 0) {
      throw new Error("Comments are source-only");
    }
    return { value: tok, raw: tok, end: i + tok.length };
  }

  function splitParts(text, base) {
    const parts = [];
    let start = 0;
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === "\\") { i++; continue; }
        if (c === '"') inQuote = false;
        continue;
      }
      if (c === '"') { inQuote = true; continue; }
      if (c === ",") {
        parts.push({ start: base + start, end: base + i });
        start = i + 1;
      }
    }
    parts.push({ start: base + start, end: base + text.length });
    return parts;
  }

  function parseAttrList(text, i) {
    let j = i + 1;
    let inQuote = false;
    while (j < text.length) {
      const c = text[j];
      if (inQuote) {
        if (c === "\\") { j += 2; continue; }
        if (c === '"') inQuote = false;
        j++;
        continue;
      }
      if (c === '"') { inQuote = true; j++; continue; }
      if (c === "]") break;
      j++;
    }
    if (j >= text.length) throw new Error("Unterminated attribute list");
    const inner = text.slice(i + 1, j);
    const parts = [];
    for (const span of splitParts(inner, i + 1)) {
      let s = span.start;
      let e = span.end;
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (s >= e) continue;
      const key = readId(text, s);
      if (!key || key.end > e) throw new Error("Invalid attribute");
      let k = key.end;
      while (k < e && /\s/.test(text[k])) k++;
      let value = null;
      let valueStart = null;
      let valueEnd = null;
      if (text[k] === "=") {
        k++;
        while (k < e && /\s/.test(text[k])) k++;
        const val = readValue(text, k);
        if (!val || val.end > e) throw new Error("Invalid attribute value");
        value = val.value;
        valueStart = k;
        valueEnd = val.end;
        k = val.end;
        while (k < e && /\s/.test(text[k])) k++;
      }
      if (k !== e) throw new Error("Invalid attribute");
      if (key.value.toLowerCase() === "rankdir") {
        throw new Error("rankdir inside an attribute list is source-only");
      }
      if (key.value === "label") {
        if (value != null && value.indexOf("|") !== -1) {
          throw new Error("Record labels are source-only");
        }
        if (value != null && value.charAt(0) === "<") {
          throw new Error("HTML-like labels are source-only");
        }
      }
      if (key.value === "shape" && value != null &&
          value.toLowerCase() === "mrecord") {
        throw new Error("Mrecord shapes are source-only");
      }
      parts.push({
        key: key.value,
        keyRaw: key.raw,
        keyEnd: key.end,
        value: value,
        valueRaw: value == null ? null : text.slice(valueStart, valueEnd),
        valueStart: valueStart,
        valueEnd: valueEnd,
        raw: text.slice(s, e),
        start: s,
        end: e,
      });
    }
    return { listStart: i, listEnd: j + 1, parts: parts };
  }

  function skipWs(text, i) {
    while (i < text.length && /\s/.test(text[i])) i++;
    return i;
  }

  function findAttr(attrs, key) {
    if (!attrs) return null;
    for (const p of attrs.parts) {
      if (p.key === key) return p;
    }
    return null;
  }

  function parseStatement(raw, lineIndex, col, model) {
    if (!raw || raw === ";") return null;
    let m = /^rankdir\s*=\s*([^;]+?)\s*;?$/i.exec(raw);
    if (m) {
      const value = m[1].trim().toUpperCase();
      if (DIRECTIONS.indexOf(value) === -1) {
        throw new Error("Unsupported rankdir value");
      }
      return {
        kind: "rankdir", value: value, raw: raw, lineIndex: lineIndex,
        col: col, indent: indentOf(raw),
      };
    }
    m = /^(graph|node|edge)\s*\[/i.exec(raw);
    if (m) {
      const bracket = raw.indexOf("[");
      const attrs = parseAttrList(raw, bracket);
      let k = skipWs(raw, attrs.listEnd);
      if (raw[k] === ";") k = skipWs(raw, k + 1);
      if (k !== raw.length) throw new Error("Invalid default-attribute line");
      return {
        kind: "defattr", name: m[1].toLowerCase(), attrs: attrs, raw: raw,
        lineIndex: lineIndex, col: col, indent: indentOf(raw),
      };
    }

    const head = readId(raw, 0);
    if (!head) throw new Error("Unsupported statement");
    validateId(head.value, model.op);
    let i = skipWs(raw, head.end);
    let edge = false;
    let tail = null;
    if (raw.substr(i, 2) === "->" || raw.substr(i, 2) === "--") {
      if (raw.substr(i, 2) !== model.op) {
        throw new Error("Wrong edge operator for this graph kind");
      }
      edge = true;
      tail = readId(raw, i + 2);
      if (!tail) throw new Error("Missing edge endpoint");
      validateId(tail.value, model.op);
      i = skipWs(raw, tail.end);
      if (raw.substr(i, 2) === "->" || raw.substr(i, 2) === "--") {
        throw new Error("Edge chains are source-only");
      }
    }
    let attrs = null;
    if (raw[i] === "[") {
      attrs = parseAttrList(raw, i);
      i = attrs.listEnd;
    }
    i = skipWs(raw, i);
    if (raw[i] === ";") i = skipWs(raw, i + 1);
    if (i !== raw.length) throw new Error("Unsupported statement");

    const labelAttr = findAttr(attrs, "label");
    const label = labelAttr ? labelAttr.value : null;
    if (edge) {
      return {
        kind: "edge", from: head.value, to: tail.value,
        fromRaw: head.raw, toRaw: tail.raw,
        fromSpan: { start: head.end - head.raw.length, end: head.end },
        toSpan: { start: tail.end - tail.raw.length, end: tail.end },
        attrs: attrs, labelAttr: labelAttr, label: label, raw: raw,
        lineIndex: lineIndex, col: col, indent: indentOf(raw),
      };
    }
    return {
      kind: "node", id: head.value, idRaw: head.raw,
      attrs: attrs, labelAttr: labelAttr, label: label, raw: raw,
      lineIndex: lineIndex, col: col, indent: indentOf(raw),
    };
  }

  function indentOf(raw) {
    const m = /^[ \t]*/.exec(raw);
    return m ? m[0] : "";
  }

  function validateId(value, op) {
    if (value.indexOf(":") !== -1) throw new Error("Ports are source-only");
    if (value.indexOf(op) !== -1) throw new Error("Ambiguous edge id");
  }

  /* --- source scanning --------------------------------------------- */

  function stripQuoted(text) {
    let out = "";
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === "\\") { out += " "; i++; continue; }
        if (c === '"') inQuote = false;
        out += " ";
        continue;
      }
      if (c === '"') { inQuote = true; out += " "; continue; }
      out += c;
    }
    return out;
  }

  function hasComment(text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (/^\s*#/.test(line)) return true;
    }
    const bare = stripQuoted(text);
    return bare.indexOf("//") !== -1 || bare.indexOf("/*") !== -1;
  }

  function hasWord(text, word) {
    const bare = stripQuoted(text);
    const re = new RegExp("\\b" + word + "\\b", "i");
    return re.test(bare);
  }

  function hasUnquotedBrace(text) {
    const bare = stripQuoted(text);
    return bare.indexOf("{") !== -1 || bare.indexOf("}") !== -1;
  }

  function findUnquotedChar(text, ch, from) {
    let inQuote = false;
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === "\\") { i++; continue; }
        if (c === '"') inQuote = false;
        continue;
      }
      if (c === '"') { inQuote = true; continue; }
      if (c === ch) return i;
    }
    return -1;
  }

  function findMatchingBrace(text, openAbs) {
    let depth = 0;
    let inQuote = false;
    for (let i = openAbs; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === "\\") { i++; continue; }
        if (c === '"') inQuote = false;
        continue;
      }
      if (c === '"') { inQuote = true; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function lineOffsets(lines) {
    const out = [];
    let pos = 0;
    for (const line of lines) {
      out.push(pos);
      pos += line.length + 1;
    }
    return out;
  }

  function lineIndexAt(offsets, abs) {
    let found = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i] <= abs) found = i;
      else break;
    }
    return found;
  }

  function splitStatements(text, baseAbs) {
    const out = [];
    let start = -1;
    let depth = 0;
    let inQuote = false;
    const push = function (a, b) {
      let s = a;
      let e = b;
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (s < e) {
        out.push({ start: baseAbs + s, end: baseAbs + e, raw: text.slice(s, e) });
      }
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === "\\") { i++; continue; }
        if (c === '"') inQuote = false;
        continue;
      }
      if (c === '"') { inQuote = true; if (start < 0) start = i; continue; }
      if (c === "[") { depth++; if (start < 0) start = i; continue; }
      if (c === "]") { if (depth > 0) depth--; continue; }
      if (depth === 0 && (c === ";" || c === "\n" || c === "\r")) {
        const end = c === ";" ? i + 1 : i;
        push(start < 0 ? i : start, end);
        start = -1;
        continue;
      }
      if (start < 0) start = i;
    }
    if (start >= 0) push(start, text.length);
    return out;
  }

  /* --- model -------------------------------------------------------- */

  function buildModel(source) {
    const raw = String(source == null ? "" : source);
    if (!raw.trim()) throw new Error("Empty Graphviz source");
    if (hasComment(raw)) throw new Error("Comments are source-only");

    const lines = raw.split("\n");
    const offsets = lineOffsets(lines);
    let headerLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { headerLine = i; break; }
    }
    if (headerLine < 0) throw new Error("Empty Graphviz source");
    const header = lines[headerLine];
    const hm = /^(\s*)(strict\s+)?(digraph|graph)\b/i.exec(header);
    if (!hm) throw new Error("Not a single digraph or graph");
    const openCol = findUnquotedChar(header, "{", hm[0].length);
    if (openCol < 0) throw new Error("Missing opening brace");
    const between = header.slice(hm[0].length, openCol).trim();
    if (between) {
      const name = readId(between, 0);
      if (!name || name.end !== between.length) {
        throw new Error("Unsupported graph header");
      }
    }
    const openAbs = offsets[headerLine] + openCol;
    const closeAbs = findMatchingBrace(raw, openAbs);
    if (closeAbs < 0) throw new Error("Missing closing brace");
    if (raw.slice(closeAbs + 1).trim() !== "") {
      throw new Error("Only one graph is supported");
    }
    const body = raw.slice(openAbs + 1, closeAbs);
    if (hasUnquotedBrace(body)) {
      throw new Error("Subgraphs, clusters and grouped endpoints are source-only");
    }
    if (hasWord(body, "subgraph") || hasWord(body, "cluster")) {
      throw new Error("Subgraphs and clusters are source-only");
    }
    const closeLine = lineIndexAt(offsets, closeAbs);
    const kind = hm[3].toLowerCase();
    const model = {
      source: raw,
      lines: lines,
      headerLine: headerLine,
      openAbs: openAbs,
      openCol: openCol,
      closeAbs: closeAbs,
      closeLine: closeLine,
      closeCol: closeAbs - offsets[closeLine],
      kind: kind,
      op: kind === "digraph" ? "->" : "--",
      strict: !!hm[2],
      nameRaw: between,
      singleLine: closeLine === headerLine,
      entries: [],
      nodes: [],
      edges: [],
      direction: null,
      rankdir: null,
      nodeById: new Map(),
      snapshot: null,
    };

    function ensureNode(id, idRaw) {
      let node = model.nodeById.get(id);
      if (node) return node;
      node = {
        kind: "node", id: id, idRaw: idRaw, lineIndex: null, col: null,
        attrs: null, labelAttr: null, label: null, raw: "", implicit: true,
      };
      model.nodes.push(node);
      model.nodeById.set(id, node);
      return node;
    }

    for (const stmt of splitStatements(body, openAbs + 1)) {
      const lineIndex = lineIndexAt(offsets, stmt.start);
      const col = stmt.start - offsets[lineIndex];
      const multiLine = /[\r\n]/.test(stmt.raw);
      let entry = multiLine
        ? parseMultiLineStatement(stmt.raw, lineIndex, col, model)
        : parseStatement(stmt.raw, lineIndex, col, model);
      if (!entry) continue;
      entry.stmtStart = stmt.start;
      entry.stmtEnd = stmt.end;
      entry.lineIndex = lineIndex;
      entry.col = col;
      entry.raw = stmt.raw;
      entry.indent = /^[ \t]*/.exec(lines[lineIndex])[0] || "";
      entry.multiLine = multiLine;
      if (multiLine) entry.readOnly = true;
      if (entry.kind === "rankdir") {
        if (model.rankdir) throw new Error("More than one rankdir is source-only");
        model.rankdir = entry;
        model.direction = entry.value;
      } else if (entry.kind === "node") {
        const existing = model.nodeById.get(entry.id);
        if (existing && existing.lineIndex != null) {
          throw new Error("Duplicate node statements are source-only");
        }
        if (existing) {
          Object.assign(existing, entry, { implicit: false });
          entry = existing;
        } else {
          model.nodes.push(entry);
          model.nodeById.set(entry.id, entry);
        }
      } else if (entry.kind === "edge") {
        ensureNode(entry.from, entry.fromRaw);
        ensureNode(entry.to, entry.toRaw);
        model.edges.push(entry);
      }
      model.entries.push(entry);
    }

    if (model.strict) {
      const seen = new Set();
      for (const edge of model.edges) {
        const key = kind === "graph"
          ? [edge.from, edge.to].sort().join("\u0000")
          : edge.from + "\u0000" + edge.to;
        if (seen.has(key)) {
          throw new Error("Duplicate edges in a strict graph are source-only");
        }
        seen.add(key);
      }
    }
    model.snapshot = signature(model);
    return model;
  }

  function parseMultiLineStatement(raw, lineIndex, col, model) {
    try {
      const parsed = parseStatement(raw.trim(), lineIndex, col, model);
      if (parsed) {
        parsed.readOnly = true;
        parsed.multiLine = true;
        return parsed;
      }
    } catch (err) {
      if (/source-only/.test(err.message || "")) throw err;
    }
    const first = raw.split(/\r?\n/)[0].trim();
    if (/^(graph|node|edge)\s*\[/i.test(first)) {
      return {
        kind: "defattr", name: (first.match(/^(graph|node|edge)/i) || ["node"])[0].toLowerCase(),
        attrs: null, raw: raw, lineIndex: lineIndex, col: col,
        indent: "", readOnly: true, multiLine: true,
      };
    }
    const head = readId(first, 0);
    if (!head) throw new Error("Unsupported multi-line statement");
    validateId(head.value, model.op);
    let i = skipWs(first, head.end);
    if (first.substr(i, 2) === model.op) {
      const tail = readId(first, i + 2);
      if (!tail) throw new Error("Missing edge endpoint");
      validateId(tail.value, model.op);
      i = skipWs(first, tail.end);
      if (first.substr(i, 2) === model.op) {
        throw new Error("Edge chains are source-only");
      }
      if (i < first.length && first[i] !== "[") {
        throw new Error("Unsupported multi-line statement");
      }
      return {
        kind: "edge", from: head.value, to: tail.value,
        fromRaw: head.raw, toRaw: tail.raw,
        fromSpan: { start: head.end - head.raw.length, end: head.end },
        toSpan: { start: tail.end - tail.raw.length, end: tail.end },
        attrs: null, labelAttr: null, label: null, raw: raw,
        lineIndex: lineIndex, col: col, indent: "",
        readOnly: true, multiLine: true,
      };
    }
    if (i < first.length && first[i] !== "[") {
      throw new Error("Unsupported multi-line statement");
    }
    return {
      kind: "node", id: head.value, idRaw: head.raw,
      attrs: null, labelAttr: null, label: null, raw: raw,
      lineIndex: lineIndex, col: col, indent: "",
      readOnly: true, multiLine: true,
    };
  }

  function signature(model) {
    return JSON.stringify({
      d: model.direction || "",
      n: model.nodes.map(function (n) {
        return [n.id, n.label || "", attrValue(n, "shape") || "",
          attrValue(n, "style") || ""];
      }),
      e: model.edges.map(function (e) {
        return [e.from, e.to, e.label || "", attrValue(e, "style") || "",
          attrValue(e, "dir") || "", attrValue(e, "arrowhead") || ""];
      }),
    });
  }

  function capabilityFor(source) {
    try {
      buildModel(source);
      return "edit";
    } catch (_) {
      return "render";
    }
  }

  /* reparseLines() -- build the replacement model from a candidate line
   * array and only then commit. A throw leaves the current model (and the
   * note draft) untouched, so a failed edit can never half-rewrite source. */
  function reparseLines(model, nextLines) {
    const snapshot = model.snapshot;
    const next = buildModel(nextLines.join("\n"));
    Object.assign(model, next);
    model.snapshot = snapshot;
  }

  function prevailingIndent(model) {
    for (let i = model.entries.length - 1; i >= 0; i--) {
      const e = model.entries[i];
      if (e.lineIndex == null || e.multiLine) continue;
      const m = /^[ \t]*/.exec(model.lines[e.lineIndex]);
      const indent = m ? m[0] : "";
      if (e.col === indent.length) return indent;
    }
    return DEFAULT_INDENT;
  }

  function appendStatement(model, text) {
    const next = model.lines.slice();
    const indent = prevailingIndent(model);
    const line = next[model.closeLine];
    const before = line.slice(0, model.closeCol);
    if (before.trim() === "") {
      next.splice(model.closeLine, 0, indent + text);
    } else {
      next.splice(model.closeLine, 1,
        before.replace(/\s+$/, ""), indent + text, line.slice(model.closeCol));
    }
    reparseLines(model, next);
  }

  function replaceStatement(model, entry, newRaw) {
    if (!entry || entry.lineIndex == null || entry.multiLine) {
      throw new Error("This statement cannot be edited in place");
    }
    const next = model.lines.slice();
    const line = next[entry.lineIndex];
    next[entry.lineIndex] = line.slice(0, entry.col) +
      newRaw + line.slice(entry.col + entry.raw.length);
    reparseLines(model, next);
  }

  function removeStatements(model, entries) {
    const next = model.lines.slice();
    const list = entries.filter(function (e) {
      return e && e.lineIndex != null && !e.multiLine;
    }).sort(function (a, b) {
      return b.lineIndex - a.lineIndex || b.col - a.col;
    });
    for (const entry of list) {
      if (next[entry.lineIndex] == null) continue;
      const line = next[entry.lineIndex];
      const before = line.slice(0, entry.col);
      const after = line.slice(entry.col + entry.raw.length);
      const lead = (before.match(/^[ \t]*/) || [""])[0];
      const beforeTrim = before.replace(/[ \t]+$/, "");
      let merged;
      if (beforeTrim.trim() === "") {
        if (/^[\r\n]/.test(after) || after.trim() === "") {
          next.splice(entry.lineIndex, 1);
          continue;
        }
        merged = lead + after.replace(/^[ \t]+/, "");
      } else {
        merged = beforeTrim + after;
      }
      if (merged.indexOf("\n") !== -1) {
        next.splice(entry.lineIndex, 1, ...merged.split("\n"));
      } else if (merged.trim() === "") {
        next.splice(entry.lineIndex, 1);
      } else {
        next[entry.lineIndex] = merged;
      }
    }
    reparseLines(model, next);
  }

  function quoteLabel(text) {
    const value = String(text == null ? "" : text).replace(/\r?\n/g, " ");
    let out = "";
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === "\\") {
        const next = value[i + 1];
        if (next === "n" || next === "\\" || next === '"') {
          out += "\\" + next;
          i++;
        } else {
          out += "\\\\";
        }
      } else if (c === '"') {
        out += '\\"';
      } else {
        out += c;
      }
    }
    return '"' + out + '"';
  }

  function encodeId(value) {
    const v = String(value);
    if (BARE_ID_RE.test(v) || NUMERAL_ID_RE.test(v)) return v;
    return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function parseIdText(text) {
    const value = String(text == null ? "" : text).trim();
    if (!value) throw new Error("Enter an ID");
    const id = readId(value, 0);
    if (!id || skipWs(value, id.end) !== value.length) {
      throw new Error("Use a bare or quoted Graphviz ID");
    }
    validateId(id.value, "->");
    return id;
  }

  function attrValue(entry, key) {
    const part = findAttr(entry && entry.attrs, key);
    return part ? part.value : null;
  }

  function encodeAttrValue(value) {
    const v = String(value);
    if (BARE_ID_RE.test(v) || NUMERAL_ID_RE.test(v) ||
        /^#[0-9A-Fa-f]{3,8}$/.test(v)) return v;
    return quoteLabel(v);
  }

  function nodeShapeKey(node) {
    const raw = attrValue(node, "shape");
    if (raw == null || raw === "") return "box";
    const value = raw.toLowerCase();
    return SHAPE_KEYS.indexOf(value) !== -1 ? value : null;
  }

  function nodeStyleKey(node) {
    const raw = attrValue(node, "style");
    if (raw == null || raw === "") return "default";
    const value = raw.toLowerCase().replace(/\s+/g, "");
    if (value === "filled") return "filled";
    if (value === "rounded") return "rounded";
    if (value === "filled,rounded" || value === "rounded,filled") {
      return "filledRounded";
    }
    if (value === "dashed") return "dashed";
    if (value === "dotted") return "dotted";
    return null;
  }

  function edgeLineKey(edge) {
    const raw = attrValue(edge, "style");
    if (raw == null || raw === "") return "solid";
    const value = raw.toLowerCase();
    return EDGE_LINE_BY_KEY[value] ? value : null;
  }

  function edgeArrowKey(edge) {
    const dir = attrValue(edge, "dir");
    const head = attrValue(edge, "arrowhead");
    const d = dir == null ? "" : dir.toLowerCase();
    const h = head == null ? "" : head.toLowerCase();
    if (d && d !== "both") return null;
    if (d === "both") {
      return (h === "" || h === "normal") ? "both" : null;
    }
    if (!h || h === "normal") return "normal";
    if (h === "none" || h === "vee" || h === "diamond" || h === "dot") return h;
    return null;
  }

  /* rewriteAttrs() -- change/remove attrs on one statement, preserving the
   * order and raw text of attrs it does not touch. The candidate line is
   * parsed before the model is committed. */
  function rewriteAttrs(model, entry, changes) {
    if (!entry) return null;
    if (entry.readOnly || entry.multiLine) return entry;
    if (entry.lineIndex == null) {
      if (entry.kind !== "node") return null;
      const attrs = [];
      for (const ch of changes) {
        if (ch.value != null) attrs.push(ch.key + "=" + ch.value);
      }
      if (!attrs.length) return entry;
      appendStatement(model, encodeId(entry.id) + " [" + attrs.join(", ") + "];");
      return model.nodeById.get(entry.id);
    }
    let raw = entry.raw;
    const existing = entry.attrs;
    const parts = existing ? existing.parts.map(function (p) {
      return { key: p.key, keyRaw: p.keyRaw, raw: p.raw };
    }) : [];
    for (const ch of changes) {
      const at = parts.findIndex(function (p) { return p.key === ch.key; });
      if (ch.value == null) {
        if (at >= 0) parts.splice(at, 1);
      } else if (at >= 0) {
        parts[at] = {
          key: ch.key,
          keyRaw: parts[at].keyRaw,
          raw: parts[at].keyRaw + "=" + ch.value,
        };
      } else {
        parts.push({ key: ch.key, keyRaw: ch.key, raw: ch.key + "=" + ch.value });
      }
    }
    if (parts.length) {
      const inner = parts.map(function (p) { return p.raw; }).join(", ");
      if (existing) {
        raw = raw.slice(0, existing.listStart + 1) + inner +
          raw.slice(existing.listEnd - 1);
      } else {
        const semi = raw.endsWith(";") ? raw.length - 1 : -1;
        const insert = " [" + inner + "]";
        raw = semi >= 0
          ? raw.slice(0, semi) + insert + raw.slice(semi)
          : raw + insert;
      }
    } else if (existing) {
      let start = existing.listStart;
      const end = existing.listEnd;
      while (start > 0 && raw[start - 1] === " ") start--;
      raw = raw.slice(0, start) + raw.slice(end);
    } else {
      return entry;
    }
    const ordinal = entry.kind === "edge" ? edgeOrdinal(model, entry) : 0;
    replaceStatement(model, entry, raw);
    if (entry.kind === "node") return model.nodeById.get(entry.id);
    return findEdge(model, entry.from, entry.to, ordinal);
  }

  function setShape(model, node, shape) {
    if (SHAPE_KEYS.indexOf(shape) === -1) throw new Error("Unsupported shape");
    if (nodeShapeKey(node) === shape) return node;
    return rewriteAttrs(model, node, [{ key: "shape", value: shape }]);
  }

  function setStyle(model, node, key) {
    const style = NODE_STYLE_BY_KEY[key];
    if (!style) throw new Error("Unsupported node style");
    if (nodeStyleKey(node) === key) return node;
    return rewriteAttrs(model, node, [{ key: "style", value: style.value }]);
  }

  function setEdgeStyle(model, edge, key) {
    const line = EDGE_LINE_BY_KEY[key];
    if (!line) throw new Error("Unsupported line style");
    if (edgeLineKey(edge) === key) return edge;
    return rewriteAttrs(model, edge, [{ key: "style", value: line.value }]);
  }

  function setArrow(model, edge, key) {
    if (!EDGE_ARROW_BY_KEY[key]) throw new Error("Unsupported arrow");
    if (edgeArrowKey(edge) === key) return edge;
    const changes = [];
    if (key === "normal") {
      changes.push({ key: "dir", value: null });
      const head = attrValue(edge, "arrowhead");
      if (head != null && head.toLowerCase() === "normal") {
        changes.push({ key: "arrowhead", value: null });
      } else if (head != null) {
        changes.push({ key: "arrowhead", value: "normal" });
      }
    } else if (key === "both") {
      changes.push({ key: "dir", value: "both" });
      changes.push({ key: "arrowhead", value: "normal" });
    } else {
      changes.push({ key: "dir", value: null });
      changes.push({ key: "arrowhead", value: key });
    }
    return rewriteAttrs(model, edge, changes);
  }

  function nextNodeId(model) {
    let n = 1;
    while (model.nodeById.has("n" + n)) n++;
    return "n" + n;
  }

  function nodeAttrsText(label, shape, style) {
    const attrs = [];
    if (label) attrs.push("label=" + quoteLabel(label));
    if (shape && shape !== "box") attrs.push("shape=" + shape);
    const styleDef = NODE_STYLE_BY_KEY[style || "default"];
    if (styleDef && styleDef.value) attrs.push("style=" + styleDef.value);
    return attrs;
  }

  function edgeAttrsText(label, line, arrow) {
    const attrs = [];
    if (label) attrs.push("label=" + quoteLabel(label));
    const lineDef = EDGE_LINE_BY_KEY[line || "solid"];
    if (lineDef && lineDef.key !== "solid") attrs.push("style=" + lineDef.value);
    if (arrow && arrow !== "normal") {
      if (arrow === "both") {
        attrs.push("dir=both");
        attrs.push("arrowhead=normal");
      } else {
        attrs.push("arrowhead=" + arrow);
      }
    }
    return attrs;
  }

  function setLabel(model, entry, text) {
    const value = String(text == null ? "" : text).replace(/\r?\n/g, " ");
    if (entry.readOnly || entry.multiLine) return entry;
    if (entry.kind === "node" && entry.lineIndex == null) {
      appendStatement(model, encodeId(entry.id) +
        (value ? " [label=" + quoteLabel(value) + "]" : "") + ";");
      return model.nodeById.get(entry.id);
    }
    if (entry.lineIndex == null) return entry;
    let raw = entry.raw;
    const attrs = entry.attrs;
    const labelAttr = entry.labelAttr;
    if (!value) {
      if (!labelAttr) return entry;
      const rest = attrs.parts.filter(function (p) { return p.key !== "label"; });
      if (!rest.length) {
        let start = attrs.listStart;
        const end = attrs.listEnd;
        while (start > 0 && raw[start - 1] === " ") start--;
        raw = raw.slice(0, start) + raw.slice(end);
      } else {
        const inner = rest.map(function (p) { return p.raw; }).join(", ");
        raw = raw.slice(0, attrs.listStart + 1) + inner +
          raw.slice(attrs.listEnd - 1);
      }
    } else {
      const enc = quoteLabel(value);
      if (labelAttr) {
        if (labelAttr.valueStart != null) {
          raw = raw.slice(0, labelAttr.valueStart) + enc +
            raw.slice(labelAttr.valueEnd);
        } else {
          raw = raw.slice(0, labelAttr.keyEnd) + "=" + enc +
            raw.slice(labelAttr.keyEnd);
        }
      } else if (attrs) {
        const inner = attrs.parts.map(function (p) { return p.raw; })
          .concat(["label=" + enc]).join(", ");
        raw = raw.slice(0, attrs.listStart + 1) + inner +
          raw.slice(attrs.listEnd - 1);
      } else {
        const semi = raw.endsWith(";") ? raw.length - 1 : -1;
        raw = semi >= 0
          ? raw.slice(0, semi) + " [label=" + enc + "]" + raw.slice(semi)
          : raw + " [label=" + enc + "]";
      }
    }
    replaceStatement(model, entry, raw);
    return entry.kind === "node"
      ? model.nodeById.get(entry.id)
      : findEdge(model, entry.from, entry.to, edgeOrdinal(model, entry));
  }

  function edgeOrdinal(model, edge) {
    let n = 0;
    for (const e of model.edges) {
      if (e.from === edge.from && e.to === edge.to) {
        if (e === edge) return n;
        n++;
      }
    }
    return 0;
  }

  function findEdge(model, from, to, ordinal) {
    let n = 0;
    for (const e of model.edges) {
      if (e.from === from && e.to === to) {
        if (n === ordinal) return e;
        n++;
      }
    }
    return null;
  }

  function setEndpoint(model, edge, which, newId) {
    if (!model.nodeById.has(newId)) throw new Error("Pick an existing node");
    if (edge.readOnly || edge.multiLine) return edge;
    const span = which === "from" ? edge.fromSpan : edge.toSpan;
    if (!span) return edge;
    const key = which === "from" ? { from: newId, to: edge.to } : { from: edge.from, to: newId };
    const ord = edgeOrdinal(model, edge);
    const raw = edge.raw.slice(0, span.start) + encodeId(newId) +
      edge.raw.slice(span.end);
    replaceStatement(model, edge, raw);
    return findEdge(model, key.from, key.to, ord);
  }

  function setDirection(model, value) {
    if (value === (model.direction || "")) return;
    if (!value) {
      if (model.rankdir) removeStatements(model, [model.rankdir]);
      return;
    }
    if (model.rankdir) {
      const r = model.rankdir;
      const m = /(rankdir\s*=\s*)([^;]+?)(\s*;?\s*)$/i.exec(r.raw);
      if (!m) throw new Error("Could not update rankdir");
      replaceStatement(model, r, r.raw.slice(0, m.index) + m[1] + value + m[3]);
      return;
    }
    const headerAfter = model.lines[model.headerLine]
      .slice(model.openCol + 1).trim();
    if (model.closeLine !== model.headerLine && headerAfter === "") {
      const next = model.lines.slice();
      next.splice(model.headerLine + 1, 0,
        prevailingIndent(model) + "rankdir=" + value + ";");
      reparseLines(model, next);
      return;
    }
    appendStatement(model, "rankdir=" + value + ";");
  }

  function addNode(model, idText, label, shape, style) {
    const text = String(label == null ? "" : label).trim();
    if (!text) throw new Error("Label is required");
    let id;
    if (String(idText == null ? "" : idText).trim()) {
      id = parseIdText(idText);
      if (model.nodeById.has(id.value)) throw new Error("That ID already exists");
    } else {
      const auto = nextNodeId(model);
      id = { value: auto, raw: auto };
    }
    const attrs = nodeAttrsText(text, shape || "box", style || "default");
    appendStatement(model, id.raw +
      (attrs.length ? " [" + attrs.join(", ") + "]" : "") + ";");
    return model.nodeById.get(id.value);
  }

  function addEdge(model, from, to, label, line, arrow) {
    if (!from || !to) throw new Error("Pick two nodes");
    if (from === to) throw new Error("From and To must differ");
    if (!model.nodeById.has(from) || !model.nodeById.has(to)) {
      throw new Error("Pick two existing nodes");
    }
    if (model.strict) {
      const key = model.kind === "graph"
        ? [from, to].sort().join("\u0000")
        : from + "\u0000" + to;
      for (const e of model.edges) {
        const cur = model.kind === "graph"
          ? [e.from, e.to].sort().join("\u0000")
          : e.from + "\u0000" + e.to;
        if (cur === key) throw new Error("That edge already exists");
      }
    }
    const attrs = edgeAttrsText(label, line || "solid", arrow || "normal");
    appendStatement(model, encodeId(from) + " " + model.op + " " + encodeId(to) +
      (attrs.length ? " [" + attrs.join(", ") + "]" : "") + ";");
    const matches = model.edges.filter(function (e) {
      return e.from === from && e.to === to;
    });
    return matches[matches.length - 1] || null;
  }

  function deleteNode(model, id) {
    const node = model.nodeById.get(id);
    if (!node) return;
    if (node.readOnly || node.multiLine) return;
    const entries = [];
    if (node.lineIndex != null) entries.push(node);
    for (const e of model.edges) {
      if (e.from === id || e.to === id) {
        if (e.readOnly || e.multiLine) return;
        entries.push(e);
      }
    }
    removeStatements(model, entries);
  }

  function deleteEdge(model, from, to, ordinal) {
    const edge = findEdge(model, from, to, ordinal);
    if (!edge || edge.lineIndex == null || edge.readOnly || edge.multiLine) return;
    removeStatements(model, [edge]);
  }

  /* --- selection ---------------------------------------------------- */

  function resolveSelection(model) {
    if (!selection) return null;
    if (selection.kind === "node") {
      return model.nodeById.get(selection.id) || null;
    }
    return findEdge(model, selection.from, selection.to, selection.ordinal);
  }

  function clearLabelError() {
    if (NB.designerShell) NB.designerShell.setBlocked(false);
  }

  function syncSheet() {
    if (NB.designerShell && NB.designerShell.syncInspectorSheet) {
      NB.designerShell.syncInspectorSheet();
    }
  }

  function selectNode(id) {
    selection = { kind: "node", id: id };
    clearLabelError();
    renderInspector();
    updateSelectionChrome();
    syncSheet();
  }

  function selectEdge(from, to, ordinal) {
    selection = { kind: "edge", from: from, to: to, ordinal: ordinal || 0 };
    clearLabelError();
    renderInspector();
    updateSelectionChrome();
    syncSheet();
  }

  function clearSelection() {
    selection = null;
    clearLabelError();
    renderInspector();
    updateSelectionChrome();
    syncSheet();
  }

  /* --- UI ----------------------------------------------------------- */

  function uiRefs() {
    return NB.designerShell ? NB.designerShell.ui : {};
  }

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      previewTimer = null;
      if (NB.designerShell && NB.designerShell.isOpen()) NB.designerShell.preview();
    }, PREVIEW_DEBOUNCE);
  }

  function nodeLabel(node) {
    return node.label == null ? "" : node.label;
  }

  function makeShapeGrid(selected, disabled, onPick) {
    const grid = make("div", "dw-shape-grid");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Shape");
    if (disabled) grid.setAttribute("aria-disabled", "true");
    for (const shape of SHAPES) {
      const b = make("button", "dw-shape-btn", shape.label);
      b.type = "button";
      b.dataset.shape = shape.key;
      b.setAttribute("aria-pressed", shape.key === selected ? "true" : "false");
      b.disabled = !!disabled;
      b.addEventListener("click", function () { onPick(shape.key); });
      grid.appendChild(b);
    }
    return grid;
  }

  function paintShapeGrid(grid, selected) {
    if (!grid) return;
    Array.from(grid.querySelectorAll(".dw-shape-btn")).forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.shape === selected ? "true" : "false");
    });
  }

  function defsSelect(id, defs, current, disabled) {
    const sel = selectEl(id, defs.map(function (d) {
      return { value: d.key, label: d.label };
    }), current);
    sel.disabled = !!disabled;
    if (disabled) sel.setAttribute("aria-disabled", "true");
    return sel;
  }

  function buildTabs(ui) {
    ui.addTabs.innerHTML = "";
    ui.addTabs.hidden = false;
    for (const tab of [ADD_NODE, ADD_EDGE]) {
      const b = make("button", "designer-tab", tab === ADD_NODE ? "Node" : "Edge");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("data-tab", tab);
      b.setAttribute("aria-selected", tab === activeTab ? "true" : "false");
      b.addEventListener("click", function () {
        if (tab === ADD_NODE) edgePrefill = null;
        activeTab = tab;
        buildTabs(ui);
        renderAddForm(ui, model);
      });
      ui.addTabs.appendChild(b);
    }
  }

  function edgeValues(model) {
    return model.nodes.map(function (n) {
      const label = nodeLabel(n);
      return { value: n.id, label: label ? n.id + " · " + label : n.id };
    });
  }

  function renderAddForm(ui, model) {
    ui.addFields.innerHTML = "";
    ui.addError.hidden = true;
    ui.addNote.hidden = true;
    const ids = model.nodes.map(function (n) { return n.id; });

    if (activeTab === ADD_NODE) {
      ui.addSubmit.textContent = "Add node";
      const id = inputEl(ADD_ID, "", "auto: n1");
      const label = inputEl(ADD_LABEL_ID, "", "Flask app");
      const style = defsSelect(ADD_STYLE_ID, NODE_STYLES, addStyle, false);
      const shapeGrid = makeShapeGrid(addShape, false, function (shape) {
        addShape = shape;
        paintShapeGrid(shapeGrid, addShape);
      });
      const sync = function () {
        ui.addSubmit.disabled = !label.value.trim();
      };
      label.addEventListener("input", sync);
      style.addEventListener("change", function () { addStyle = style.value; });
      ui.addFields.appendChild(fieldRow("ID", id, ADD_ID));
      ui.addFields.appendChild(fieldRow("Label", label, ADD_LABEL_ID));
      const shapeRow = make("div", "designer-field-row");
      shapeRow.appendChild(make("span", "designer-field-label", "Shape"));
      shapeRow.appendChild(shapeGrid);
      ui.addFields.appendChild(shapeRow);
      ui.addFields.appendChild(fieldRow("Style", style, ADD_STYLE_ID));
      sync();
      return;
    }

    ui.addSubmit.textContent = "Add edge";
    const values = edgeValues(model);
    const fromId = (edgePrefill && model.nodeById.has(edgePrefill))
      ? edgePrefill : (ids[0] || "");
    const toId = ids.find(function (id) { return id !== fromId; }) || "";
    const from = selectEl(ADD_FROM_ID, values, fromId);
    const to = selectEl(ADD_TO_ID, values, toId);
    const label = inputEl(ADD_EDGE_LABEL_ID, "", "serve");
    const line = defsSelect(ADD_LINE_ID, EDGE_LINES, addLine, false);
    const arrow = defsSelect(ADD_ARROW_ID, EDGE_ARROWS, addArrow, false);
    const sync = function () {
      const f = from.value;
      const t = to.value;
      const fewer = ids.length < 2;
      const same = !!f && !!t && f === t;
      ui.addSubmit.disabled = fewer || !f || !t || same;
      if (fewer) {
        ui.addNote.textContent = "Add a second node first.";
        ui.addNote.hidden = false;
      } else if (same) {
        ui.addNote.textContent = "From and To must differ.";
        ui.addNote.hidden = false;
      } else {
        ui.addNote.hidden = true;
      }
    };
    from.addEventListener("change", function () {
      edgePrefill = from.value;
      sync();
    });
    to.addEventListener("change", sync);
    line.addEventListener("change", function () { addLine = line.value; });
    arrow.addEventListener("change", function () { addArrow = arrow.value; });
    ui.addFields.appendChild(fieldRow("From", from, ADD_FROM_ID));
    ui.addFields.appendChild(fieldRow("To", to, ADD_TO_ID));
    ui.addFields.appendChild(fieldRow("Label", label, ADD_EDGE_LABEL_ID));
    ui.addFields.appendChild(fieldRow("Line", line, ADD_LINE_ID));
    ui.addFields.appendChild(fieldRow("Arrow", arrow, ADD_ARROW_ID));
    sync();
  }

  function buildChart(ui, model) {
    ui.chart.hidden = false;
    ui.chartDivider.hidden = false;
    ui.chart.innerHTML = "";
    ui.chart.appendChild(make("h3", "designer-sidebar-title", "Chart"));
    const group = make("div", "designer-chips");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Graph direction");
    const current = model.direction || "";
    const options = DIRECTIONS.map(function (v) {
      return { value: v, label: DIRECTION_LABEL[v] };
    }).concat([{ value: "", label: "Default (top to bottom)" }]);
    for (const opt of options) {
      const b = make("label", "designer-chip");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "dw-rankdir";
      radio.value = opt.value;
      radio.checked = opt.value === current;
      radio.className = "designer-chip-input";
      radio.addEventListener("change", function () {
        if (!radio.checked) return;
        try {
          setDirection(model, opt.value);
          NB.designerShell.markDirty(true);
          buildChart(ui, model);
          renderAddForm(ui, model);
          schedulePreview();
        } catch (err) {
          NB.designerShell.alert(err.message || "Could not change direction");
        }
      });
      b.appendChild(radio);
      b.appendChild(make("span", "designer-chip-text", opt.label));
      group.appendChild(b);
    }
    ui.chart.appendChild(group);
  }

  function setLabelError(errorEl, message) {
    if (!errorEl) return;
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
    if (NB.designerShell) NB.designerShell.setBlocked(!!message);
  }

  function renderInspector() {
    const ui = uiRefs();
    if (!ui.inspectorBody || !model) return;
    const body = ui.inspectorBody;
    body.innerHTML = "";
    const selected = resolveSelection(model);
    if (!selected) {
      selection = null;
      if (ui.inspectorKind) ui.inspectorKind.textContent = "Nothing selected";
      if (ui.inspectorMeta) ui.inspectorMeta.textContent = "";
      if (ui.inspectorClear) ui.inspectorClear.hidden = true;
      const rest = make("div", "designer-rest");
      rest.appendChild(make("span", "designer-rest-glyph", "◇"));
      rest.appendChild(make("p", "designer-rest-title", "Select an item"));
      rest.appendChild(make("p", "designer-rest-copy",
        "Select a node or edge on the stage to edit it."));
      body.appendChild(rest);
      if (ui.hint) ui.hint.hidden = false;
      return;
    }
    if (ui.inspectorClear) ui.inspectorClear.hidden = false;
    if (ui.hint) ui.hint.hidden = true;

    if (selected.kind === "node") {
      if (ui.inspectorKind) ui.inspectorKind.textContent = "Node";
      if (ui.inspectorMeta) {
        ui.inspectorMeta.textContent = selected.id +
          (nodeLabel(selected) ? " · " + nodeLabel(selected) : "");
      }
      const readOnly = !!selected.readOnly || !!selected.multiLine;
      const shapeKey = nodeShapeKey(selected);
      const styleKey = nodeStyleKey(selected);
      if (readOnly) {
        body.appendChild(make("p", "designer-scope-note",
          "This statement spans multiple lines and is read-only."));
      }
      const label = inputEl(NODE_LABEL_ID, nodeLabel(selected), "Node label");
      label.disabled = readOnly;
      const labelError = make("p", "designer-field-error", "");
      labelError.hidden = true;
      label.addEventListener("input", function () {
        if (readOnly) return;
        if (!label.value.trim()) {
          setLabelError(labelError, "Label is required.");
          return;
        }
        setLabelError(labelError, updateNodeLabel(selected.id, label.value));
      });
      body.appendChild(fieldRow("Label", label, NODE_LABEL_ID));
      body.appendChild(labelError);

      const shapeRow = make("div", "designer-field-row");
      shapeRow.appendChild(make("span", "designer-field-label", "Shape"));
      const shapeGrid = makeShapeGrid(shapeKey, readOnly || shapeKey === null, function (shape) {
        try {
          setShape(model, selected, shape);
          NB.designerShell.markDirty(true);
          renderInspector();
          NB.designerShell.preview();
        } catch (err) {
          NB.designerShell.alert(err.message || "Could not change the shape");
        }
      });
      shapeRow.appendChild(shapeGrid);
      body.appendChild(shapeRow);
      if (!readOnly && shapeKey === null) {
        body.appendChild(make("p", "designer-scope-note",
          "This shape is source-only; edit the source to change it."));
      }

      const style = defsSelect(NODE_STYLE_ID, NODE_STYLES,
        styleKey || "", readOnly || styleKey === null);
      if (styleKey === null) {
        const custom = document.createElement("option");
        custom.value = "";
        custom.textContent = "Custom (source)";
        custom.selected = true;
        style.insertBefore(custom, style.firstChild);
      }
      style.addEventListener("change", function () {
        try {
          setStyle(model, selected, style.value);
          NB.designerShell.markDirty(true);
          renderInspector();
          NB.designerShell.preview();
        } catch (err) {
          NB.designerShell.alert(err.message || "Could not change the style");
        }
      });
      body.appendChild(fieldRow("Style", style, NODE_STYLE_ID));
      if (!readOnly && styleKey === null) {
        body.appendChild(make("p", "designer-scope-note",
          "This style is source-only; edit the source to change it."));
      }

      const actions = make("div", "designer-group");
      actions.appendChild(make("h5", "designer-group-title", "Actions"));
      const addEdge = make("button", "designer-btn", "Add edge from this node");
      addEdge.type = "button";
      addEdge.addEventListener("click", function () {
        activeTab = ADD_EDGE;
        edgePrefill = selected.id;
        buildTabs(ui);
        renderAddForm(ui, model);
        const first = ui.addFields && ui.addFields.querySelector("select");
        if (first) first.focus();
      });
      actions.appendChild(addEdge);
      const del = make("button", "designer-btn designer-btn--danger", "Delete node");
      del.type = "button";
      del.disabled = readOnly || shapeKey === null || styleKey === null;
      if (del.disabled) {
        del.title = readOnly ? "This statement is read-only."
          : "This node has a source-only shape or style.";
      }
      del.addEventListener("click", function () {
        deleteNode(model, selected.id);
        selection = null;
        NB.designerShell.markDirty(true);
        NB.designerShell.preview().then(function () {
          buildChart(ui, model);
          renderAddForm(ui, model);
        });
      });
      actions.appendChild(del);
      actions.appendChild(make("p", "designer-consequence",
        "Its edges are removed too. Undo restores."));
      body.appendChild(actions);
      return;
    }

    if (ui.inspectorKind) ui.inspectorKind.textContent = "Edge";
    if (ui.inspectorMeta) {
      ui.inspectorMeta.textContent = selected.from + " → " + selected.to;
    }
    const readOnly = !!selected.readOnly || !!selected.multiLine;
    if (readOnly) {
      body.appendChild(make("p", "designer-scope-note",
        "This statement spans multiple lines and is read-only."));
    }
    const lineKey = edgeLineKey(selected);
    const arrowKey = edgeArrowKey(selected);
    const ids = model.nodes.map(function (n) { return n.id; });
    const values = ids.map(function (id) {
      const n = model.nodeById.get(id);
      const text = nodeLabel(n);
      return { value: id, label: text ? id + " · " + text : id };
    });
    const from = selectEl(EDGE_FROM_ID, values, selected.from);
    const to = selectEl(EDGE_TO_ID, values, selected.to);
    from.disabled = readOnly;
    to.disabled = readOnly;
    from.addEventListener("change", function () {
      updateEndpoint(selected, "from", from.value);
    });
    to.addEventListener("change", function () {
      updateEndpoint(selected, "to", to.value);
    });
    const row = make("div", "designer-row");
    row.appendChild(fieldRow("From", from, EDGE_FROM_ID));
    row.appendChild(fieldRow("To", to, EDGE_TO_ID));
    body.appendChild(row);

    const label = inputEl(EDGE_LABEL_ID, selected.label == null ? "" : selected.label, "Edge label");
    label.disabled = readOnly;
    const labelError = make("p", "designer-field-error", "");
    labelError.hidden = true;
    label.addEventListener("input", function () {
      if (readOnly) return;
      setLabelError(labelError, updateEdgeLabel(selected, label.value));
    });
    body.appendChild(fieldRow("Label", label, EDGE_LABEL_ID));
    body.appendChild(labelError);

    const line = defsSelect(EDGE_LINE_ID, EDGE_LINES,
      lineKey || "", readOnly || lineKey === null);
    if (lineKey === null) {
      const custom = document.createElement("option");
      custom.value = "";
      custom.textContent = "Custom (source)";
      custom.selected = true;
      line.insertBefore(custom, line.firstChild);
    }
    line.addEventListener("change", function () {
      try {
        setEdgeStyle(model, selected, line.value);
        NB.designerShell.markDirty(true);
        renderInspector();
        NB.designerShell.preview();
      } catch (err) {
        NB.designerShell.alert(err.message || "Could not change the line style");
      }
    });
    body.appendChild(fieldRow("Line", line, EDGE_LINE_ID));
    if (!readOnly && lineKey === null) {
      body.appendChild(make("p", "designer-scope-note",
        "This line style is source-only; edit the source to change it."));
    }

    const arrow = defsSelect(EDGE_ARROW_ID, EDGE_ARROWS,
      arrowKey || "", readOnly || arrowKey === null);
    if (arrowKey === null) {
      const custom = document.createElement("option");
      custom.value = "";
      custom.textContent = "Custom (source)";
      custom.selected = true;
      arrow.insertBefore(custom, arrow.firstChild);
    }
    arrow.addEventListener("change", function () {
      try {
        setArrow(model, selected, arrow.value);
        NB.designerShell.markDirty(true);
        renderInspector();
        NB.designerShell.preview();
      } catch (err) {
        NB.designerShell.alert(err.message || "Could not change the arrow");
      }
    });
    body.appendChild(fieldRow("Arrow", arrow, EDGE_ARROW_ID));
    if (!readOnly && arrowKey === null) {
      body.appendChild(make("p", "designer-scope-note",
        "This arrow is source-only; edit the source to change it."));
    }

    const actions = make("div", "designer-group");
    actions.appendChild(make("h5", "designer-group-title", "Actions"));
    const del = make("button", "designer-btn designer-btn--danger", "Delete edge");
    del.type = "button";
    del.disabled = readOnly || lineKey === null || arrowKey === null;
    if (del.disabled) {
      del.title = readOnly ? "This statement is read-only."
        : "This edge has a source-only line or arrow.";
    }
    del.addEventListener("click", function () {
      const cur = currentEdge(selected);
      deleteEdge(model, cur.from, cur.to, cur.ordinal);
      selection = null;
      NB.designerShell.markDirty(true);
      NB.designerShell.preview().then(function () {
        renderAddForm(ui, model);
      });
    });
    actions.appendChild(del);
    body.appendChild(actions);
  }

  function updateNodeLabel(id, text) {
    const node = model && model.nodeById.get(id);
    if (!node) return null;
    try {
      setLabel(model, node, text);
    } catch (err) {
      return (err && err.message) ? err.message : "That label is source-only";
    }
    selection = { kind: "node", id: id };
    NB.designerShell.markDirty();
    schedulePreview();
    return null;
  }

  function currentEdge(fallback) {
    const from = selection && selection.kind === "edge" ? selection.from : fallback.from;
    const to = selection && selection.kind === "edge" ? selection.to : fallback.to;
    const ordinal = selection && selection.kind === "edge"
      ? (selection.ordinal || 0) : 0;
    return {
      edge: findEdge(model, from, to, ordinal) || fallback,
      from: from,
      to: to,
      ordinal: ordinal,
    };
  }

  function updateEdgeLabel(edge, text) {
    const cur = currentEdge(edge);
    try {
      setLabel(model, cur.edge, text);
    } catch (err) {
      return (err && err.message) ? err.message : "That label is source-only";
    }
    selection = { kind: "edge", from: cur.edge.from, to: cur.edge.to,
      ordinal: cur.ordinal };
    NB.designerShell.markDirty();
    schedulePreview();
    return null;
  }

  function updateEndpoint(edge, which, value) {
    try {
      const cur = currentEdge(edge);
      const next = setEndpoint(model, cur.edge, which, value);
      selection = next
        ? { kind: "edge", from: next.from, to: next.to, ordinal: cur.ordinal }
        : null;
      NB.designerShell.markDirty(true);
      schedulePreview();
    } catch (err) {
      NB.designerShell.alert(err.message || "Could not change the endpoint");
    }
  }

  function submitAdd() {
    const ui = uiRefs();
    if (!model) return;
    ui.addError.hidden = true;
    try {
      if (activeTab === ADD_NODE) {
        const idInput = document.getElementById(ADD_ID);
        const labelInput = document.getElementById(ADD_LABEL_ID);
        const node = addNode(model, idInput ? idInput.value : "",
          labelInput ? labelInput.value : "", addShape, addStyle);
        selection = { kind: "node", id: node.id };
        if (idInput) idInput.value = "";
        if (labelInput) labelInput.value = "";
      } else {
        const from = document.getElementById(ADD_FROM_ID);
        const to = document.getElementById(ADD_TO_ID);
        const label = document.getElementById(ADD_EDGE_LABEL_ID);
        const fromId = from ? from.value : "";
        const toId = to ? to.value : "";
        const edge = addEdge(model, fromId, toId, label ? label.value : "",
          addLine, addArrow);
        selection = edge
          ? { kind: "edge", from: edge.from, to: edge.to,
              ordinal: edgeOrdinal(model, edge) }
          : null;
        edgePrefill = null;
        if (label) label.value = "";
      }
      NB.designerShell.markDirty(true);
      renderAddForm(ui, model);
      buildChart(ui, model);
      NB.designerShell.preview();
    } catch (err) {
      ui.addError.textContent = err.message || "Could not add that item";
      ui.addError.hidden = false;
    }
  }

  function makeHitButton(cls, rect, cardRect, pad) {
    const b = document.createElement("button");
    const p = pad || 0;
    b.type = "button";
    b.tabIndex = -1;
    b.className = "dw-hit " + cls;
    const left = (rect && rect.left ? rect.left - p - cardRect.left : 0);
    const top = (rect && rect.top ? rect.top - p - cardRect.top : 0);
    const width = (rect && rect.width ? rect.width + 2 * p : MIN_HIT_SIZE);
    const height = (rect && rect.height ? rect.height + 2 * p : MIN_HIT_SIZE);
    b.style.left = Math.max(0, left) + "px";
    b.style.top = Math.max(0, top) + "px";
    b.style.width = Math.max(MIN_HIT_SIZE, width) + "px";
    b.style.height = Math.max(MIN_HIT_SIZE, height) + "px";
    b.addEventListener("mouseenter", function () { b.classList.add("is-hover"); });
    b.addEventListener("mouseleave", function () { b.classList.remove("is-hover"); });
    return b;
  }

  function clearEdgePathHits(svg) {
    svg.querySelectorAll(".dw-edge-hit-path").forEach(function (el) { el.remove(); });
  }

  function edgeMidpoint(g, svg) {
    const label = g.querySelector("text");
    if (label && label.getBoundingClientRect) {
      const r = label.getBoundingClientRect();
      if (r && (r.width || r.height)) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    const path = g.querySelector("path");
    if (path && typeof path.getTotalLength === "function" &&
        typeof path.getScreenCTM === "function" && svg.createSVGPoint) {
      try {
        const len = path.getTotalLength();
        if (len > 0) {
          const p = path.getPointAtLength(len / 2);
          const matrix = path.getScreenCTM();
          const pt = svg.createSVGPoint();
          pt.x = p.x;
          pt.y = p.y;
          const screen = pt.matrixTransform(matrix);
          return { x: screen.x, y: screen.y };
        }
      } catch (_) { /* fall through to the bbox */ }
    }
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function addEdgePathHits(g, from, to, ordinal) {
    for (const path of Array.from(g.querySelectorAll("path"))) {
      const hit = path.cloneNode(true);
      hit.classList.add("dw-edge-hit-path");
      hit.removeAttribute("id");
      hit.removeAttribute("stroke-width");
      hit.removeAttribute("style");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("fill", "none");
      hit.style.pointerEvents = "stroke";
      hit.dataset.edgeFrom = from;
      hit.dataset.edgeTo = to;
      hit.dataset.edgeOrdinal = String(ordinal);
      hit.addEventListener("mouseenter", function () { hit.classList.add("is-hover"); });
      hit.addEventListener("mouseleave", function () { hit.classList.remove("is-hover"); });
      hit.addEventListener("click", function (e) {
        e.stopPropagation();
        selectEdge(from, to, ordinal);
      });
      path.parentNode.insertBefore(hit, path.nextSibling);
    }
  }

  function buildHits(model) {
    const ui = uiRefs();
    if (!ui.overlayLayer || !ui.card) return;
    ui.overlayLayer.innerHTML = "";
    const svg = ui.card.querySelector("svg");
    if (!svg) return;
    clearEdgePathHits(svg);
    const cardRect = ui.card.getBoundingClientRect();
    const nodeButtons = [];
    const edgeButtons = [];

    for (const g of Array.from(svg.querySelectorAll("g.edge"))) {
      const title = g.querySelector("title");
      const text = title ? (title.textContent || "").trim() : "";
      const parts = text.split(model.op);
      if (parts.length !== 2) continue;
      const from = parts[0];
      const to = parts[1];
      const ordinal = edgeButtons.filter(function (x) {
        return x.dataset.edgeFrom === from && x.dataset.edgeTo === to;
      }).length;
      const edge = findEdge(model, from, to, ordinal);
      if (!edge) continue;
      addEdgePathHits(g, from, to, ordinal);
      const mid = edgeMidpoint(g, svg);
      const b = makeHitButton("dw-edge-midpoint", {
        left: mid.x - MIN_HIT_SIZE / 2,
        top: mid.y - MIN_HIT_SIZE / 2,
        width: MIN_HIT_SIZE,
        height: MIN_HIT_SIZE,
      }, cardRect);
      b.dataset.edgeFrom = from;
      b.dataset.edgeTo = to;
      b.dataset.edgeOrdinal = String(ordinal);
      const fromNode = model.nodeById.get(from);
      const toNode = model.nodeById.get(to);
      const fromText = fromNode && fromNode.label ? fromNode.label : from;
      const toText = toNode && toNode.label ? toNode.label : to;
      b.setAttribute("aria-label", "Edge " + fromText + " → " + toText +
        (edge.label ? ", label " + edge.label : ""));
      b.addEventListener("click", function () {
        selectEdge(from, to, ordinal);
      });
      edgeButtons.push(b);
    }

    for (const g of Array.from(svg.querySelectorAll("g.node"))) {
      const title = g.querySelector("title");
      const id = title ? (title.textContent || "").trim() : "";
      const node = model.nodeById.get(id);
      if (!node) continue;
      const b = makeHitButton("dw-node-hit", g.getBoundingClientRect(),
        cardRect, 4);
      b.dataset.nodeId = id;
      b.setAttribute("aria-label", "Node " + id +
        (node.label ? ", label " + node.label : ""));
      const focusLabel = function () {
        selectNode(id);
        const field = document.getElementById(NODE_LABEL_ID);
        if (field) {
          void field.offsetWidth;
          field.focus();
        }
        window.setTimeout(function () {
          const again = document.getElementById(NODE_LABEL_ID);
          if (again) again.focus();
        }, 0);
      };
      b.addEventListener("click", function (e) {
        selectNode(id);
        if (e.detail === 2) focusLabel();
      });
      b.addEventListener("dblclick", focusLabel);
      nodeButtons.push(b);
    }

    // Edge midpoint hits first, node hits after, so nodes win an overlap.
    for (const b of edgeButtons) ui.overlayLayer.appendChild(b);
    for (const b of nodeButtons) ui.overlayLayer.appendChild(b);
  }

  function updateSelectionChrome() {
    const ui = uiRefs();
    if (!ui.overlayLayer || !ui.card) return;
    const svg = ui.card.querySelector("svg");
    const buttons = Array.from(ui.overlayLayer.querySelectorAll(".dw-hit"));
    for (const b of buttons) {
      b.classList.remove("is-selected");
      b.tabIndex = -1;
      const badge = b.querySelector(".designer-sel-badge");
      if (badge) badge.remove();
    }
    if (svg) {
      svg.querySelectorAll(".dw-edge-hit-path.is-selected").forEach(function (el) {
        el.classList.remove("is-selected");
      });
    }
    if (!selection) return;
    const tag = selection.kind === "node" ? "Node" : "Edge";
    for (const b of buttons) {
      let match = false;
      if (selection.kind === "node") {
        match = b.dataset.nodeId === selection.id;
      } else {
        match = b.dataset.edgeFrom === selection.from &&
          b.dataset.edgeTo === selection.to &&
          Number(b.dataset.edgeOrdinal) === (selection.ordinal || 0);
      }
      if (match) {
        b.classList.add("is-selected");
        b.tabIndex = 0;
        const badge = make("span", "designer-sel-badge", tag);
        badge.setAttribute("aria-hidden", "true");
        b.appendChild(badge);
        break;
      }
    }
    if (selection.kind === "edge" && svg) {
      svg.querySelectorAll(".dw-edge-hit-path").forEach(function (el) {
        if (el.dataset.edgeFrom === selection.from &&
            el.dataset.edgeTo === selection.to &&
            Number(el.dataset.edgeOrdinal) === (selection.ordinal || 0)) {
          el.classList.add("is-selected");
        }
      });
    }
  }

  function afterRender(modelArg) {
    const ui = uiRefs();
    model = modelArg;
    if (!ui.card) return;
    if (!resolveSelection(model)) selection = null;
    buildHits(model);
    updateSelectionChrome();
    if (!selection) {
      if (ui.inspectorKind) ui.inspectorKind.textContent = "Nothing selected";
      if (ui.inspectorMeta) ui.inspectorMeta.textContent = "";
      if (ui.inspectorClear) ui.inspectorClear.hidden = true;
    }
    if (ui.empty) {
      ui.empty.hidden = !(model.nodes.length === 0 && model.edges.length === 0);
    }
    if (ui.hint) ui.hint.hidden = !!selection;
    const active = document.activeElement;
    if (!ui.inspectorBody || !ui.inspectorBody.contains(active)) renderInspector();
    if (!ui.addFields || !ui.addFields.contains(active)) renderAddForm(ui, model);
  }

  function mountUI(modelArg, ui) {
    model = modelArg;
    activeTab = ADD_NODE;
    addShape = "box";
    addStyle = "default";
    addLine = "solid";
    addArrow = "normal";
    edgePrefill = null;
    if (ui.addTitle) ui.addTitle.textContent = "Add";
    if (ui.addForm) {
      ui.addForm.hidden = false;
      ui.addForm.classList.add("dw-add-form");
    }
    if (ui.addTabs) buildTabs(ui);
    buildChart(ui, model);
    if (ui.editSource) ui.editSource.hidden = false;
    if (ui.inspector) ui.inspector.hidden = false;
    if (ui.empty) {
      const msg = ui.empty.querySelector(".dw-empty-msg");
      if (msg) msg.textContent = EMPTY_COPY;
      ui.empty.hidden = !(model.nodes.length === 0 && model.edges.length === 0);
    }
    renderAddForm(ui, model);
    selection = null;
    renderInspector();
  }

  function unmountUI() {
    model = null;
    selection = null;
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    const ui = uiRefs();
    if (ui.addFields) ui.addFields.innerHTML = "";
    if (ui.inspectorBody) ui.inspectorBody.innerHTML = "";
    if (ui.chart) ui.chart.innerHTML = "";
  }

  /* --- canvas keyboard --------------------------------------------- */

  function entities(model) {
    const out = [];
    for (const n of model.nodes) out.push({ kind: "node", id: n.id });
    for (const e of model.edges) out.push({ kind: "edge", from: e.from, to: e.to });
    return out;
  }

  function moveSelection(delta) {
    if (!model) return;
    const list = entities(model);
    if (!list.length) return;
    const current = resolveSelection(model);
    let index = 0;
    if (current) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if ((item.kind === "node" && current.kind === "node" && item.id === current.id) ||
            (item.kind === "edge" && current.kind === "edge" &&
             item.from === current.from && item.to === current.to)) {
          index = i;
          break;
        }
      }
    }
    index = Math.max(0, Math.min(list.length - 1, index + delta));
    const item = list[index];
    if (item.kind === "node") selectNode(item.id);
    else selectEdge(item.from, item.to, 0);
  }

  function initCanvas() {
    const ui = uiRefs();
    if (!ui.canvas) return;
    ui.canvas.addEventListener("keydown", function (e) {
      if (!model) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        const list = entities(model);
        if (list.length) {
          if (list[0].kind === "node") selectNode(list[0].id);
          else selectEdge(list[0].from, list[0].to, 0);
        }
      } else if (e.key === "End") {
        e.preventDefault();
        const list = entities(model);
        const last = list[list.length - 1];
        if (last) {
          if (last.kind === "node") selectNode(last.id);
          else selectEdge(last.from, last.to, 0);
        }
      } else if (e.key === "Enter") {
        const first = ui.inspectorBody && ui.inspectorBody.querySelector("input, select");
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
    const form = ui.addForm;
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitAdd();
      });
    }
  }

  initCanvas();

  function readOnlyReason(source) {
    return capabilityFor(source) === "edit"
      ? null : "This graph uses source-only constructs.";
  }

  function restore(source) {
    if (!model) return false;
    const baseline = model.snapshot;
    const next = buildModel(source);
    Object.assign(model, next);
    model.snapshot = baseline;
    selection = null;
    edgePrefill = null;
    clearLabelError();
    const ui = uiRefs();
    renderAddForm(ui, model);
    buildChart(ui, model);
    renderInspector();
    return true;
  }

  const controller = {
    lang: LANG,
    badge: BADGE,
    menuLabel: "Design graph\u2026",
    windowTitle: "Design graph",
    noun: "graph",
    hint: HINT,
    containerSel: CONTAINER_SEL,
    disabledTitle: DISABLED_TITLE,
    emptyCopy: EMPTY_COPY,
    capabilityFor: capabilityFor,
    buildModel: buildModel,
    isNoOp: function (model) { return signature(model) === model.snapshot; },
    serialize: function (model) { return model.lines.join("\n"); },
    renderSource: function (source) { return NB.viz.renderSvgElement(source); },
    renderNote: function () {
      return NB.viz.renderAll(document.getElementById("viewer-content"));
    },
    mountUI: mountUI,
    afterRender: afterRender,
    unmountUI: unmountUI,
    clearSelection: clearSelection,
    snapshot: function () { return model ? model.lines.join("\n") : ""; },
    restore: restore,
    readOnlyReason: readOnlyReason,
  };

  NB.dotDesign = {
    open: function (hit) { NB.designerShell.open(controller, hit); },
    capabilityFor: capabilityFor,
    disabledTitle: DISABLED_TITLE,
    menuLabel: "Design graph\u2026",
    windowTitle: "Design graph",
    noun: "graph",
  };
})();
