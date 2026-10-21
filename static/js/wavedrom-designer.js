/* wavedrom-designer.js -- the WaveDrom (```wavedrom) design window.
 *
 * Line-local editing is impossible for a JS object literal with nested
 * groups, so the parsed object IS the model (docs/architecture/
 * dot-wavedrom-designer.md §6): unknown keys ride along untouched, and
 * Apply writes strict JSON. A no-op Apply compares field values, never
 * bytes, so an untouched window never normalizes a lenient source.
 *
 * The shared lifecycle lives in designer-shell.js.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const LANG = "wavedrom";
  const CONTAINER_SEL = ".wavedrom-container, .wavedrom-error";
  const BADGE = "WaveDrom";
  const HINT = "Select a signal to edit its wave";
  const DISABLED_TITLE =
    "This waveform can\u2019t be edited visually \u2014 use Edit source";
  const EMPTY_COPY = "Add your first signal.";
  const PREVIEW_DEBOUNCE = 150;
  const ADD_NAME_ID = "dw-wave-add-name";
  const ADD_WAVE_ID = "dw-wave-add-wave";
  const ADD_PERIOD_ID = "dw-wave-add-period";
  const SIGNAL_NAME_ID = "dw-wave-name";
  const SIGNAL_WAVE_ID = "dw-wave-wave";
  const SIGNAL_PERIOD_ID = "dw-wave-period";
  const HSCALE_ID = "dw-hscale";
  const DATA_LABEL_ID = "dw-data-label";
  const TRACK_ID = "dw-wave-track";
  const STRUCTURE_NOTE = "Wave groups and arcs stay in the source.";
  const CHART_NOTE =
    "Head/foot text, groups, and arcs stay in the source.";
  const EDGE_NOTE = "Arcs stay in the source; signal names are read-only.";
  const MIN_HIT_SIZE = 28;
  const DATA_HIT_PAD = 6;
  const PERIOD_MIN = 1;
  const PERIOD_MAX = 16;
  const HSCALE_MIN = 1;
  const HSCALE_MAX = 10;
  const GLYPHS = [
    { ch: "0", title: "Low" },
    { ch: "1", title: "High" },
    { ch: "x", title: "Unknown" },
    { ch: "z", title: "High-Z" },
    { ch: "=", title: "Data" },
    { ch: "2", title: "Data 2" },
    { ch: "3", title: "Data 3" },
    { ch: "4", title: "Data 4" },
    { ch: "5", title: "Data 5" },
    { ch: ".", title: "Extend" },
    { ch: "p", title: "Positive clock" },
    { ch: "n", title: "Negative clock" },
    { ch: "|", title: "Gap" },
  ];
  const GLYPH_MEANING = {};
  GLYPHS.forEach(function (g) { GLYPH_MEANING[g.ch] = g.title; });

  let model = null;
  let selection = null;       // index into model.signals
  let sliceIndex = null;      // 0-based time slice
  let cellIndex = null;       // 0-based wave character
  let dataLabelSelection = null; // { signalIndex, labelIndex }
  let addPeriod = 1;
  let previewTimer = null;
  const invalidFields = new Map();

  /* --- helpers ------------------------------------------------------ */

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

  function inputEl(id, value, type) {
    const input = document.createElement("input");
    input.id = id;
    input.className = "designer-field";
    input.type = type || "text";
    if (type === "number") {
      input.step = "any";
      input.min = "0";
    }
    input.value = value == null ? "" : value;
    input.autocomplete = "off";
    return input;
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" &&
      !Array.isArray(value) &&
      Object.prototype.toString.call(value) === "[object Object]";
  }

  function assertJson(value, seen) {
    const type = typeof value;
    if (value === null || type === "string" || type === "boolean") return;
    if (type === "number") {
      if (!isFinite(value)) throw new Error("Non-finite numbers are source-only");
      return;
    }
    if (type !== "object") {
      throw new Error("Only JSON values can be written back");
    }
    if (seen.has(value)) throw new Error("Cyclic values are source-only");
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) assertJson(item, seen);
      seen.delete(value);
      return;
    }
    if (!isPlainObject(value)) {
      throw new Error("Only plain objects can be written back");
    }
    for (const key of Object.keys(value)) assertJson(value[key], seen);
    seen.delete(value);
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (const key of ka) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
      }
      return true;
    }
    return false;
  }

  function hasComment(text) {
    let inQuote = false;
    let quote = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) inQuote = false;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inQuote = true;
        quote = c;
        continue;
      }
      if (c === "/" && text[i + 1] === "/") return true;
      if (c === "/" && text[i + 1] === "*") return true;
    }
    return false;
  }

  /* --- model -------------------------------------------------------- */

  function validateSignal(signal) {
    if (!isPlainObject(signal)) return "readOnly";
    const keys = Object.keys(signal);
    if (!keys.length) return "gap";
    if (signal.bricks || signal.analog ||
        typeof signal.wave !== "string" || !signal.wave) {
      return "readOnly";
    }
    if (Object.prototype.hasOwnProperty.call(signal, "name") &&
        typeof signal.name !== "string") {
      return "readOnly";
    }
    if (Object.prototype.hasOwnProperty.call(signal, "data")) {
      if (!Array.isArray(signal.data) ||
          signal.data.some(function (v) { return typeof v !== "string"; })) {
        return "readOnly";
      }
    }
    if (Object.prototype.hasOwnProperty.call(signal, "period")) {
      const p = signal.period;
      if (typeof p !== "number" || !isFinite(p) || p <= 0) {
        return "readOnly";
      }
    }
    return "signal";
  }

  function buildModel(source) {
    const raw = String(source == null ? "" : source);
    if (!raw.trim()) throw new Error("Empty WaveDrom source");
    if (!NB.wavedrom || typeof NB.wavedrom.parseSource !== "function") {
      throw new Error("The WaveDrom parser is unavailable");
    }
    let strict = true;
    try { JSON.parse(raw.trim()); } catch (_) { strict = false; }
    const obj = NB.wavedrom.parseSource(raw);
    if (!isPlainObject(obj)) throw new Error("A WaveDrom source must be an object");
    if (!strict && hasComment(raw)) {
      throw new Error("Comments are source-only");
    }
    assertJson(obj, new Set());
    const model = {
      obj: obj,
      entries: [],
      signals: [],
      hasGroups: false,
      hasGaps: false,
      hasEdges: Array.isArray(obj.edge) && obj.edge.length > 0,
      readOnlyReason: null,
      snapshot: null,
    };
    model.snapshot = JSON.parse(JSON.stringify(obj));
    if (!Array.isArray(obj.signal)) {
      model.readOnlyReason = "This waveform has no signal array.";
      return model;
    }
    if (obj.analog || obj.bricks) {
      model.readOnlyReason = "This waveform uses analog bricks.";
      return model;
    }

    function visit(array, start) {
      for (let i = start || 0; i < array.length; i++) {
        const item = array[i];
        if (Array.isArray(item)) {
          if (!item.length || typeof item[0] !== "string") {
            throw new Error("A group array starts with a label");
          }
          model.hasGroups = true;
          model.entries.push({ kind: "group", label: item[0] });
          visit(item, 1);
          continue;
        }
        const kind = validateSignal(item);
        if (kind === "gap") {
          model.hasGaps = true;
          model.entries.push({ kind: "gap" });
          continue;
        }
        const entry = {
          kind: "signal", signal: item, parent: array, index: i,
          signalIndex: model.signals.length, readOnly: kind === "readOnly",
        };
        model.entries.push(entry);
        model.signals.push(entry);
      }
    }
    visit(obj.signal, 0);
    return model;
  }

  function readOnlyReason(source) {
    try {
      return buildModel(source).readOnlyReason || null;
    } catch (_) {
      return null;
    }
  }

  function capabilityFor(source) {
    try {
      return buildModel(source).readOnlyReason ? "render" : "edit";
    } catch (_) {
      return "render";
    }
  }

  function rebuildInPlace(model) {
    const snapshot = model.snapshot;
    const next = buildModel(JSON.stringify(model.obj, null, 2));
    Object.assign(model, next);
    model.snapshot = snapshot;
    invalidFields.clear();
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

  function structuralDisabled(model) {
    return model.hasGroups || model.hasGaps || model.hasEdges;
  }

  function signalName(entry) {
    return entry && entry.signal && typeof entry.signal.name === "string"
      ? entry.signal.name : "";
  }

  function selectedEntry(model) {
    if (selection == null) return null;
    return model.signals[selection] || null;
  }

  function signalWave(entry) {
    return entry && entry.signal && typeof entry.signal.wave === "string"
      ? entry.signal.wave : "";
  }

  function dataLabels(entry) {
    const data = entry && entry.signal && entry.signal.data;
    return Array.isArray(data) ? data : [];
  }

  function periodOf(entry) {
    const p = entry && entry.signal && entry.signal.period;
    return (typeof p === "number" && p >= PERIOD_MIN && p <= PERIOD_MAX) ? p : 1;
  }

  function sliceCount(entry) {
    const len = signalWave(entry).length;
    const period = periodOf(entry);
    return len ? Math.ceil(len / period) : 0;
  }

  function hscaleValue(model) {
    const config = model.obj.config;
    const v = config && config.hscale;
    return (typeof v === "number" && v >= HSCALE_MIN && v <= HSCALE_MAX) ? v : 1;
  }

  function glyphMeaning(ch) {
    const m = GLYPH_MEANING[ch];
    return m ? m.charAt(0).toLowerCase() + m.slice(1) : "unknown";
  }

  function dataGlyphIndices(wave) {
    const out = [];
    for (let i = 0; i < wave.length; i++) {
      if ("2345".indexOf(wave.charAt(i)) !== -1) out.push(i);
    }
    return out;
  }

  function labelForCell(entry, cell) {
    const at = dataGlyphIndices(signalWave(entry)).indexOf(cell);
    if (at < 0) return null;
    const labels = dataLabels(entry);
    return labels[at] == null ? null : labels[at];
  }

  function glyphClass(ch) {
    if (ch === "1") return "dw-glyph--high";
    if (ch === "0") return "dw-glyph--low";
    if (ch === "p" || ch === "n") return "dw-glyph--clock";
    if ("2345=".indexOf(ch) !== -1) return "dw-glyph--data";
    if (ch === "|") return "dw-glyph--gap";
    if (ch === ".") return "dw-glyph--extend";
    return "dw-glyph--unknown";
  }

  function renderTrackCells(container, wave, period, mini, onCell) {
    container.innerHTML = "";
    for (let i = 0; i < wave.length; i++) {
      const cell = make("div", mini ? "dw-cell dw-cell--mini" : "dw-cell");
      cell.dataset.index = String(i);
      if (!mini) {
        cell.setAttribute("role", "option");
        cell.setAttribute("aria-selected", cellIndex === i ? "true" : "false");
        if (cellIndex === i) cell.classList.add("is-selected");
      }
      if (i % period === 0) cell.classList.add("dw-cell-period");
      if (!mini && i % period === 0) {
        cell.appendChild(make("span", "dw-cell-slice",
          String(Math.floor(i / period) + 1)));
      }
      const glyph = make("span", "dw-cell-glyph " + glyphClass(wave.charAt(i)));
      glyph.setAttribute("aria-hidden", "true");
      cell.appendChild(glyph);
      cell.appendChild(make("span", "dw-cell-char", wave.charAt(i)));
      cell.addEventListener("click", function () { onCell(i); });
      container.appendChild(cell);
    }
  }

  function paintTrack(track) {
    if (!track) return;
    Array.from(track.querySelectorAll(".dw-cell")).forEach(function (cell) {
      const at = Number(cell.dataset.index);
      const on = cellIndex === at;
      cell.classList.toggle("is-selected", on);
      cell.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function scrollTrackCell(track) {
    if (!track || cellIndex == null) return;
    const cell = track.querySelector('.dw-cell[data-index="' + cellIndex + '"]');
    if (cell && cell.scrollIntoView) {
      try { cell.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      catch (_) {}
    }
  }

  function readoutText(entry) {
    if (cellIndex == null) return "Select a cell to edit it";
    const wave = signalWave(entry);
    if (cellIndex >= wave.length) return "Select a cell to edit it";
    const ch = wave.charAt(cellIndex);
    const label = labelForCell(entry, cellIndex);
    const parts = ["Cell " + (cellIndex + 1)];
    if (label != null) parts.push("data label \u201c" + label + "\u201d");
    parts.push(glyphMeaning(ch));
    return parts.join(" \u00b7 ");
  }

  function setInspectorMeta(entry) {
    const ui = uiRefs();
    if (!ui.inspectorMeta) return;
    const name = signalName(entry) || "unnamed";
    let meta = name + " \u00b7 " + sliceCount(entry) + " slices";
    if (sliceIndex != null) meta += " \u00b7 slice " + (sliceIndex + 1);
    ui.inspectorMeta.textContent = meta;
  }

  function currentSignalIndex() {
    if (dataLabelSelection) return dataLabelSelection.signalIndex;
    return selection;
  }

  function currentEntry() {
    const index = currentSignalIndex();
    return index == null ? null : (model.signals[index] || null);
  }

  function buildChart(ui, model) {
    ui.chart.hidden = false;
    ui.chartDivider.hidden = false;
    ui.chart.innerHTML = "";
    ui.chart.appendChild(make("h3", "designer-sidebar-title", "Chart"));
    const values = [];
    for (let n = HSCALE_MIN; n <= HSCALE_MAX; n++) {
      values.push({ value: String(n), label: String(n) });
    }
    const scale = selectEl(HSCALE_ID, values, String(hscaleValue(model)));
    scale.addEventListener("change", function () {
      try {
        setHscale(model, Number(scale.value));
        renderAddForm(ui, model);
        NB.designerShell.markDirty(true);
        NB.designerShell.preview();
      } catch (err) {
        NB.designerShell.alert(err.message || "Could not set the time scale");
      }
    });
    ui.chart.appendChild(fieldRow("Time scale", scale, HSCALE_ID));
    ui.chart.appendChild(make("p", "designer-scope-note", CHART_NOTE));
  }

  function setHscale(model, value) {
    if (!Number.isInteger(value) || value < HSCALE_MIN || value > HSCALE_MAX) {
      throw new Error("Time scale must be 1-10");
    }
    if (value === 1) {
      if (model.obj.config) {
        delete model.obj.config.hscale;
        if (!Object.keys(model.obj.config).length) delete model.obj.config;
      }
      return;
    }
    if (!isPlainObject(model.obj.config)) model.obj.config = {};
    model.obj.config.hscale = value;
  }

  function buildAddMiniTrack(wave, period) {
    const track = make("div", "dw-mini-track");
    renderTrackCells(track, wave, period, true, function () {});
    return track;
  }

  function renderAddForm(ui, model) {
    ui.addFields.innerHTML = "";
    ui.addError.hidden = true;
    ui.addNote.hidden = true;
    ui.addSubmit.textContent = "Add signal";
    const disabled = structuralDisabled(model);
    const name = inputEl(ADD_NAME_ID, "", "clk");
    const wave = inputEl(ADD_WAVE_ID, "", "p.....|...");
    const period = inputEl(ADD_PERIOD_ID, String(addPeriod), "number");
    period.step = "1";
    period.min = String(PERIOD_MIN);
    period.max = String(PERIOD_MAX);
    name.disabled = disabled;
    wave.disabled = disabled;
    period.disabled = disabled;
    const mini = buildAddMiniTrack(wave.value, addPeriod);
    const miniWrap = make("div", "dw-mini-track-wrap");
    miniWrap.appendChild(mini);
    const syncAdd = function () {
      ui.addSubmit.disabled = disabled ||
        !name.value.trim() || !wave.value.trim();
      renderTrackCells(mini, wave.value, addPeriod, true, function () {});
    };
    name.addEventListener("input", syncAdd);
    wave.addEventListener("input", syncAdd);
    period.addEventListener("input", function () {
      const n = Number(period.value);
      if (Number.isInteger(n) && n >= PERIOD_MIN && n <= PERIOD_MAX) {
        addPeriod = n;
        renderTrackCells(mini, wave.value, addPeriod, true, function () {});
      }
    });
    ui.addFields.appendChild(fieldRow("Name", name, ADD_NAME_ID));
    ui.addFields.appendChild(fieldRow("Wave", wave, ADD_WAVE_ID));
    ui.addFields.appendChild(fieldRow("Period", period, ADD_PERIOD_ID));
    ui.addFields.appendChild(miniWrap);
    syncAdd();
    if (disabled) {
      ui.addNote.textContent = STRUCTURE_NOTE;
      ui.addNote.hidden = false;
    }
  }

  function renderWaveEditor(body, entry, ui) {
    const signal = entry.signal;
    const input = inputEl(SIGNAL_WAVE_ID, signalWave(entry));
    input.classList.add("dw-mono");
    input.setAttribute("aria-describedby", "dw-wave-error");
    const error = make("p", "designer-field-error", "");
    error.id = "dw-wave-error";
    error.hidden = true;
    const track = make("div", "dw-wave-track");
    track.id = TRACK_ID;
    track.setAttribute("role", "listbox");
    track.setAttribute("aria-label", "Wave characters");
    track.tabIndex = 0;
    const readout = make("p", "dw-readout", readoutText(entry));
    const palette = make("div", "dw-glyph-palette");
    palette.id = "dw-glyph-palette";
    palette.setAttribute("role", "group");
    palette.setAttribute("aria-label", "Wave glyph palette");

    function refreshTrack() {
      renderTrackCells(track, signalWave(entry), periodOf(entry), false, function (i) {
        setCell(i);
      });
      paintTrack(track);
      scrollTrackCell(track);
      readout.textContent = readoutText(entry);
      syncRuler(model);
      updateSliceBand();
      setInspectorMeta(entry);
    }

    function setCell(index) {
      const len = signalWave(entry).length;
      if (!len) { cellIndex = null; sliceIndex = null; }
      else {
        cellIndex = Math.max(0, Math.min(len - 1, index));
        sliceIndex = cellIndex;
      }
      paintTrack(track);
      readout.textContent = readoutText(entry);
      syncRuler(model);
      updateSliceBand();
      setInspectorMeta(entry);
    }

    function applyWave(next) {
      if (!next) {
        fieldBad(signal, "wave", true);
        input.setAttribute("aria-invalid", "true");
        error.textContent = "Wave is required.";
        error.hidden = false;
        return;
      }
      fieldBad(signal, "wave", false);
      input.removeAttribute("aria-invalid");
      error.hidden = true;
      signal.wave = next;
      const len = next.length;
      if (cellIndex != null) cellIndex = Math.min(cellIndex, len - 1);
      sliceIndex = cellIndex;
      NB.designerShell.markDirty();
      schedulePreview();
      refreshTrack();
    }

    input.addEventListener("input", function () {
      applyWave(input.value);
    });

    track.addEventListener("keydown", function (e) {
      const wave = signalWave(entry);
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCell((cellIndex == null ? 0 : cellIndex) - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCell((cellIndex == null ? -1 : cellIndex) + 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setCell(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCell(wave.length - 1);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        if (cellIndex == null) return;
        const next = wave.slice(0, cellIndex) + wave.slice(cellIndex + 1);
        applyWave(next);
        if (next.length) setCell(Math.min(cellIndex, next.length - 1));
        else { cellIndex = null; sliceIndex = null; setCell(0); }
        input.value = next;
      } else if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey &&
                 !e.altKey && /\S/.test(e.key)) {
        e.preventDefault();
        let next;
        let at;
        if (cellIndex == null) {
          next = wave + e.key;
          at = next.length - 1;
        } else {
          next = wave.slice(0, cellIndex) + e.key + wave.slice(cellIndex + 1);
          at = Math.min(cellIndex + 1, next.length - 1);
        }
        applyWave(next);
        setCell(at);
        input.value = next;
      }
    });

    for (const glyph of GLYPHS) {
      const b = make("button", "dw-glyph-btn", glyph.ch);
      b.type = "button";
      b.title = glyph.title;
      b.setAttribute("aria-label", glyph.title);
      b.addEventListener("click", function () {
        const wave = signalWave(entry);
        let next;
        let at;
        if (cellIndex == null) {
          next = wave + glyph.ch;
          at = next.length - 1;
        } else {
          next = wave.slice(0, cellIndex) + glyph.ch + wave.slice(cellIndex + 1);
          at = Math.min(cellIndex + 1, next.length - 1);
        }
        applyWave(next);
        setCell(at);
        input.value = next;
      });
      palette.appendChild(b);
    }

    body.appendChild(fieldRow("Wave", input, SIGNAL_WAVE_ID));
    body.appendChild(error);
    const trackWrap = make("div", "dw-track-wrap");
    trackWrap.appendChild(track);
    body.appendChild(trackWrap);
    body.appendChild(readout);
    body.appendChild(palette);
    refreshTrack();
  }

  function renderDataLabelInspector(ui, entry) {
    const labels = dataLabels(entry);
    const labelIndex = dataLabelSelection.labelIndex;
    const label = labels[labelIndex];
    if (ui.inspectorKind) ui.inspectorKind.textContent = "Data label";
    const glyphs = dataGlyphIndices(signalWave(entry));
    const slice = glyphs[labelIndex] == null
      ? (sliceIndex == null ? 0 : sliceIndex)
      : Math.floor(glyphs[labelIndex] / periodOf(entry));
    if (ui.inspectorMeta) {
      ui.inspectorMeta.textContent = (signalName(entry) || "unnamed") +
        " · slice " + (slice + 1);
    }
    const input = inputEl(DATA_LABEL_ID, label);
    input.addEventListener("input", function () {
      labels[labelIndex] = input.value;
      NB.designerShell.markDirty();
      schedulePreview();
    });
    ui.inspectorBody.appendChild(fieldRow("Label", input, DATA_LABEL_ID));
    ui.inspectorBody.appendChild(make("p", "designer-scope-note",
      "Data glyph " + (labelIndex + 1) + " of " + labels.length +
      " \u00b7 slice " + (slice + 1)));
    const actions = make("div", "designer-group");
    actions.appendChild(make("h5", "designer-group-title", "Actions"));
    const del = make("button", "designer-btn designer-btn--danger", "Delete label");
    del.type = "button";
    del.addEventListener("click", function () {
      labels.splice(labelIndex, 1);
      if (!labels.length) delete entry.signal.data;
      dataLabelSelection = null;
      NB.designerShell.markDirty(true);
      renderInspector();
      syncRuler(model);
      updateSliceBand();
      NB.designerShell.preview();
    });
    actions.appendChild(del);
    actions.appendChild(make("p", "designer-consequence",
      "The glyph stays; the remaining labels shift."));
    ui.inspectorBody.appendChild(actions);
  }

  function renderSignalInspector(ui, entry) {
    const uiBody = ui.inspectorBody;
    if (ui.inspectorKind) ui.inspectorKind.textContent = "Signal";
    setInspectorMeta(entry);
    if (entry.readOnly) {
      uiBody.appendChild(make("p", "designer-scope-note",
        "This signal uses a source-only construct."));
      const roName = inputEl(SIGNAL_NAME_ID, signalName(entry), "clk");
      roName.disabled = true;
      uiBody.appendChild(fieldRow("Name", roName, SIGNAL_NAME_ID));
      const roWave = inputEl(SIGNAL_WAVE_ID, signalWave(entry), "wave");
      roWave.disabled = true;
      roWave.classList.add("dw-mono");
      uiBody.appendChild(fieldRow("Wave", roWave, SIGNAL_WAVE_ID));
      const roPeriod = inputEl(SIGNAL_PERIOD_ID, String(periodOf(entry)), "number");
      roPeriod.disabled = true;
      uiBody.appendChild(fieldRow("Period", roPeriod, SIGNAL_PERIOD_ID));
      const del = make("button", "designer-btn designer-btn--danger",
        "Delete signal");
      del.type = "button";
      del.disabled = true;
      del.title = "This signal is source-only.";
      const actions = make("div", "designer-group");
      actions.appendChild(make("h5", "designer-group-title", "Actions"));
      actions.appendChild(del);
      uiBody.appendChild(actions);
      return;
    }
    const signal = entry.signal;
    const name = inputEl(SIGNAL_NAME_ID, signalName(entry), "clk");
    if (model.hasEdges) {
      name.readOnly = true;
      name.setAttribute("aria-readonly", "true");
    }
    const nameError = make("p", "designer-field-error", "");
    nameError.hidden = true;
    name.addEventListener("input", function () {
      if (model.hasEdges) return;
      if (!name.value.trim()) {
        fieldBad(signal, "name", true);
        nameError.textContent = "Name is required.";
        nameError.hidden = false;
        return;
      }
      fieldBad(signal, "name", false);
      nameError.hidden = true;
      signal.name = name.value;
      NB.designerShell.markDirty();
      schedulePreview();
      setInspectorMeta(entry);
    });
    uiBody.appendChild(fieldRow("Name", name, SIGNAL_NAME_ID));
    uiBody.appendChild(nameError);
    if (model.hasEdges) {
      uiBody.appendChild(make("p", "designer-scope-note", EDGE_NOTE));
    }

    renderWaveEditor(uiBody, entry, ui);

    const period = inputEl(SIGNAL_PERIOD_ID, String(periodOf(entry)), "number");
    period.step = "1";
    period.min = String(PERIOD_MIN);
    period.max = String(PERIOD_MAX);
    const periodError = make("p", "designer-field-error", "");
    periodError.id = "dw-period-error";
    periodError.hidden = true;
    period.setAttribute("aria-describedby", "dw-period-error");
    period.addEventListener("input", function () {
      if (period.value === "") {
        delete signal.period;
        fieldBad(signal, "period", false);
        period.removeAttribute("aria-invalid");
        periodError.hidden = true;
        NB.designerShell.markDirty(true);
        renderInspector();
        NB.designerShell.preview();
        return;
      }
      const n = Number(period.value);
      if (!Number.isInteger(n) || n < PERIOD_MIN || n > PERIOD_MAX) {
        fieldBad(signal, "period", true);
        period.setAttribute("aria-invalid", "true");
        periodError.textContent = "Use a whole number 1-16.";
        periodError.hidden = false;
        return;
      }
      fieldBad(signal, "period", false);
      period.removeAttribute("aria-invalid");
      periodError.hidden = true;
      if (n === 1) delete signal.period; else signal.period = n;
      NB.designerShell.markDirty(true);
      renderInspector();
      NB.designerShell.preview();
    });
    uiBody.appendChild(fieldRow("Period", period, SIGNAL_PERIOD_ID));
    uiBody.appendChild(periodError);

    const dataGroup = make("div", "designer-group");
    dataGroup.appendChild(make("h5", "designer-group-title", "Data labels"));
    const labels = dataLabels(entry);
    if (!labels.length) {
      dataGroup.appendChild(make("p", "designer-scope-note", "No data labels."));
    } else {
      labels.forEach(function (text, index) {
        const row = make("div", "designer-row dw-data-row");
        row.appendChild(make("span", "dw-data-index", String(index + 1)));
        const preview = String(text == null ? "" : text).slice(0, 20);
        row.appendChild(make("span", "dw-data-preview", preview || "\u2014"));
        const select = make("button", "designer-btn designer-btn--ghost", "Select");
        select.type = "button";
        const glyphs = dataGlyphIndices(signalWave(entry));
        const labelSlice = glyphs[index] == null ? 0
          : Math.floor(glyphs[index] / periodOf(entry));
        select.setAttribute("aria-label", "Select data label " + (index + 1) +
          " of " + labels.length + ", signal " +
          (signalName(entry) || "unnamed") + ", slice " + (labelSlice + 1));
        select.addEventListener("click", function () {
          selectDataLabel(selection, index);
        });
        row.appendChild(select);
        dataGroup.appendChild(row);
      });
    }
    uiBody.appendChild(dataGroup);

    const actions = make("div", "designer-group");
    actions.appendChild(make("h5", "designer-group-title", "Actions"));
    const moveDisabled = structuralDisabled(model) || model.hasEdges ||
      entry.readOnly;
    const up = make("button", "designer-btn", "Move up");
    up.type = "button";
    up.disabled = moveDisabled || selection <= 0;
    up.title = moveDisabled ? STRUCTURE_NOTE : "Move this signal up";
    up.addEventListener("click", function () { moveSignal(-1); });
    const down = make("button", "designer-btn", "Move down");
    down.type = "button";
    down.disabled = moveDisabled || selection >= model.signals.length - 1;
    down.title = moveDisabled ? STRUCTURE_NOTE : "Move this signal down";
    down.addEventListener("click", function () { moveSignal(1); });
    actions.appendChild(up);
    actions.appendChild(down);
    const del = make("button", "designer-btn designer-btn--danger",
      "Delete signal");
    del.type = "button";
    del.disabled = structuralDisabled(model);
    if (del.disabled) del.title = STRUCTURE_NOTE;
    del.addEventListener("click", function () {
      deleteSignal(model, selection);
    });
    actions.appendChild(del);
    actions.appendChild(make("p", "designer-consequence",
      "Its labels are removed too. Undo restores."));
    uiBody.appendChild(actions);
  }

  function renderInspector() {
    const ui = uiRefs();
    if (!ui.inspectorBody || !model) return;
    const body = ui.inspectorBody;
    body.innerHTML = "";
    let entry = selectedEntry(model);
    if (dataLabelSelection) {
      entry = model.signals[dataLabelSelection.signalIndex] || null;
      if (!entry || dataLabelSelection.labelIndex >= dataLabels(entry).length) {
        dataLabelSelection = null;
      }
    }
    if (!entry) {
      selection = null;
      dataLabelSelection = null;
      if (ui.inspectorKind) ui.inspectorKind.textContent = "Nothing selected";
      if (ui.inspectorMeta) ui.inspectorMeta.textContent = "";
      if (ui.inspectorClear) ui.inspectorClear.hidden = true;
      const rest = make("div", "designer-rest");
      rest.appendChild(make("span", "designer-rest-glyph", "◇"));
      rest.appendChild(make("p", "designer-rest-title", "Select a signal"));
      rest.appendChild(make("p", "designer-rest-copy",
        "Select a signal on the stage to edit its wave and data labels."));
      body.appendChild(rest);
      if (ui.hint) ui.hint.hidden = false;
      return;
    }
    if (ui.inspectorClear) ui.inspectorClear.hidden = false;
    if (ui.hint) ui.hint.hidden = true;
    if (dataLabelSelection) renderDataLabelInspector(ui, entry);
    else renderSignalInspector(ui, entry);
  }

  function fieldBad(signal, field, bad) {
    let fields = invalidFields.get(signal);
    if (!fields) {
      if (!bad) return;
      fields = new Set();
      invalidFields.set(signal, fields);
    }
    if (bad) fields.add(field); else fields.delete(field);
    if (!fields.size) invalidFields.delete(signal);
    NB.designerShell.setBlocked(invalidFields.size > 0);
  }

  function deleteSignal(model, index) {
    if (structuralDisabled(model)) return;
    const entry = model.signals[index];
    if (!entry || entry.readOnly) return;
    entry.parent.splice(entry.index, 1);
    selection = null;
    dataLabelSelection = null;
    sliceIndex = null;
    cellIndex = null;
    invalidFields.clear();
    rebuildInPlace(model);
    NB.designerShell.setBlocked(false);
    NB.designerShell.markDirty(true);
    renderInspector();
    renderAddForm(uiRefs(), model);
    syncRuler(model);
    updateSliceBand();
    NB.designerShell.preview();
  }

  function moveSignal(delta) {
    if (selection == null) return;
    if (structuralDisabled(model)) return;
    const target = selection + delta;
    if (target < 0 || target >= model.signals.length) return;
    const list = model.obj.signal;
    const entry = model.signals[selection];
    if (!entry || entry.readOnly) return;
    const item = list.splice(entry.index, 1)[0];
    list.splice(entry.index + delta, 0, item);
    rebuildInPlace(model);
    selection = null;
    dataLabelSelection = null;
    sliceIndex = null;
    cellIndex = null;
    NB.designerShell.markDirty(true);
    renderInspector();
    renderAddForm(uiRefs(), model);
    syncRuler(model);
    updateSliceBand();
    NB.designerShell.preview();
  }

  function clearInvalid() {
    invalidFields.clear();
    NB.designerShell.setBlocked(false);
  }

  function syncSheet() {
    if (NB.designerShell && NB.designerShell.syncInspectorSheet) {
      NB.designerShell.syncInspectorSheet();
    }
  }

  function selectSignal(index) {
    selection = index;
    dataLabelSelection = null;
    clearInvalid();
    const entry = model.signals[index];
    if (entry && sliceIndex != null && sliceIndex >= signalWave(entry).length) {
      sliceIndex = null;
      cellIndex = null;
    }
    if (entry && cellIndex != null && cellIndex >= signalWave(entry).length) {
      cellIndex = null;
    }
    renderInspector();
    updateSelectionChrome();
    syncRuler(model);
    updateSliceBand();
    scrollTrackCell(document.getElementById(TRACK_ID));
    syncSheet();
  }

  function selectDataLabel(signalIndex, labelIndex) {
    const entry = model.signals[signalIndex];
    if (!entry || entry.readOnly) return;
    const glyphs = dataGlyphIndices(signalWave(entry));
    selection = signalIndex;
    dataLabelSelection = { signalIndex: signalIndex, labelIndex: labelIndex };
    if (glyphs[labelIndex] != null) {
      sliceIndex = Math.floor(glyphs[labelIndex] / periodOf(entry));
      cellIndex = glyphs[labelIndex];
    }
    clearInvalid();
    renderInspector();
    updateSelectionChrome();
    syncRuler(model);
    updateSliceBand();
    scrollTrackCell(document.getElementById(TRACK_ID));
    syncSheet();
  }

  function selectSlice(index) {
    let entry = currentEntry();
    if (!entry) {
      if (!model.signals.length) return;
      selection = 0;
      entry = model.signals[0];
    }
    if (dataLabelSelection) dataLabelSelection = null;
    const len = signalWave(entry).length;
    if (!len) return;
    const count = sliceCount(entry);
    sliceIndex = Math.max(0, Math.min(count - 1, index));
    cellIndex = Math.min(len - 1, sliceIndex * periodOf(entry));
    clearInvalid();
    renderInspector();
    updateSelectionChrome();
    syncRuler(model);
    updateSliceBand();
    scrollTrackCell(document.getElementById(TRACK_ID));
    syncSheet();
  }

  function clearSelection() {
    if (dataLabelSelection) {
      dataLabelSelection = null;
      renderInspector();
      updateSelectionChrome();
      syncRuler(model);
      updateSliceBand();
      syncSheet();
      return;
    }
    selection = null;
    dataLabelSelection = null;
    sliceIndex = null;
    cellIndex = null;
    clearInvalid();
    renderInspector();
    updateSelectionChrome();
    syncRuler(model);
    updateSliceBand();
    syncSheet();
  }

  function submitAdd() {
    const ui = uiRefs();
    if (!model || structuralDisabled(model)) return;
    clearInvalid();
    ui.addError.hidden = true;
    const name = document.getElementById(ADD_NAME_ID);
    const wave = document.getElementById(ADD_WAVE_ID);
    const period = document.getElementById(ADD_PERIOD_ID);
    const nameValue = name ? name.value : "";
    const waveValue = wave ? wave.value : "";
    if (!nameValue.trim()) {
      ui.addError.textContent = "Name is required.";
      ui.addError.hidden = false;
      return;
    }
    if (!waveValue) {
      ui.addError.textContent = "Wave is required.";
      ui.addError.hidden = false;
      return;
    }
    const signal = { name: nameValue, wave: waveValue };
    if (period && period.value !== "") {
      const n = Number(period.value);
      if (!Number.isInteger(n) || n < PERIOD_MIN || n > PERIOD_MAX) {
        ui.addError.textContent = "Use a whole number 1-16.";
        ui.addError.hidden = false;
        return;
      }
      if (n > 1) signal.period = n;
    }
    model.obj.signal.push(signal);
    rebuildInPlace(model);
    selection = model.signals.length - 1;
    dataLabelSelection = null;
    sliceIndex = null;
    cellIndex = null;
    addPeriod = 1;
    if (name) name.value = "";
    if (wave) wave.value = "";
    if (period) period.value = "1";
    NB.designerShell.markDirty(true);
    renderInspector();
    renderAddForm(ui, model);
    syncRuler(model);
    updateSliceBand();
    NB.designerShell.preview();
  }

  function makeHitButton(rect, cardRect, pad) {
    const b = document.createElement("button");
    const p = pad || 0;
    b.type = "button";
    b.tabIndex = -1;
    b.className = "dw-hit dw-wave-hit";
    const left = rect && rect.left ? rect.left - p - cardRect.left : 0;
    const top = rect && rect.top ? rect.top - p - cardRect.top : 0;
    b.style.left = Math.max(0, left) + "px";
    b.style.top = Math.max(0, top) + "px";
    b.style.width = "100%";
    b.style.height = Math.max(MIN_HIT_SIZE,
      rect && rect.height ? rect.height + 2 * p : MIN_HIT_SIZE) + "px";
    b.addEventListener("mouseenter", function () { b.classList.add("is-hover"); });
    b.addEventListener("mouseleave", function () { b.classList.remove("is-hover"); });
    return b;
  }

  function makeDataHit(rect, cardRect) {
    const b = document.createElement("button");
    b.type = "button";
    b.tabIndex = -1;
    b.className = "dw-hit dw-data-hit";
    const left = rect && rect.left ? rect.left - DATA_HIT_PAD - cardRect.left : 0;
    const top = rect && rect.top ? rect.top - DATA_HIT_PAD - cardRect.top : 0;
    const width = Math.max(MIN_HIT_SIZE,
      rect && rect.width ? rect.width + 2 * DATA_HIT_PAD : MIN_HIT_SIZE);
    const height = Math.max(MIN_HIT_SIZE,
      rect && rect.height ? rect.height + 2 * DATA_HIT_PAD : MIN_HIT_SIZE);
    b.style.left = Math.max(0, left) + "px";
    b.style.top = Math.max(0, top) + "px";
    b.style.width = width + "px";
    b.style.height = height + "px";
    b.addEventListener("mouseenter", function () { b.classList.add("is-hover"); });
    b.addEventListener("mouseleave", function () { b.classList.remove("is-hover"); });
    return b;
  }

  function laneGroups(svg) {
    if (!svg) return [];
    const out = [];
    for (const g of Array.from(svg.querySelectorAll("g[id]"))) {
      const id = g.getAttribute("id") || "";
      if (id.indexOf("wavelane_draw_") === 0) continue;
      const m = /^wavelane_(\d+)_\d+$/.exec(id);
      if (!m) continue;
      out.push({ index: Number(m[1]), el: g });
    }
    out.sort(function (a, b) { return a.index - b.index; });
    return out;
  }

  function buildHits(model) {
    const ui = uiRefs();
    if (!ui.overlayLayer || !ui.card) return;
    ui.overlayLayer.innerHTML = "";
    const svg = ui.card.querySelector("svg");
    const lanes = laneGroups(svg);
    if (!lanes.length) return;
    const selectable = model.entries.filter(function (entry) {
      return entry.kind === "signal" || entry.kind === "gap";
    });
    let entries = null;
    if (lanes.length === model.entries.length) entries = model.entries;
    else if (lanes.length === selectable.length) entries = selectable;
    if (!entries) return;
    const cardRect = ui.card.getBoundingClientRect();
    lanes.forEach(function (lane, laneIndex) {
      const entry = entries[laneIndex];
      const b = makeHitButton(lane.el.getBoundingClientRect(), cardRect, 0);
      if (entry.kind === "signal") {
        b.dataset.signalIndex = String(entry.signalIndex);
        b.setAttribute("aria-label",
          "Signal " + (signalName(entry) || "unnamed") + ", " +
          sliceCount(entry) + " slices");
        b.addEventListener("click", function () {
          selectSignal(entry.signalIndex);
        });
      } else {
        b.classList.add("dw-wave-gap-hit");
        b.dataset.entryKind = entry.kind;
        b.setAttribute("aria-label", entry.kind === "gap" ? "Gap" : "Group");
        b.addEventListener("click", function () { clearSelection(); });
      }
      ui.overlayLayer.appendChild(b);

      // Data labels use the rendered lane index, not the flat signal index:
      // a gap or group before the signal shifts wavelane_draw_<index>_.
      if (entry.kind !== "signal" || entry.readOnly) return;
      const labels = dataLabels(entry);
      if (!labels.length) return;
      const draw = svg.querySelector(
        'g[id^="wavelane_draw_' + laneIndex + '_"]');
      if (!draw) return;
      const texts = Array.from(draw.querySelectorAll("text"));
      texts.forEach(function (text, labelIndex) {
        if (labelIndex >= labels.length) return;
        const rect = text.getBoundingClientRect();
        const hit = makeDataHit(rect, cardRect);
        hit.dataset.signalIndex = String(entry.signalIndex);
        hit.dataset.labelIndex = String(labelIndex);
        const glyphs = dataGlyphIndices(signalWave(entry));
        const labelSlice = glyphs[labelIndex] == null ? 0
          : Math.floor(glyphs[labelIndex] / periodOf(entry));
        hit.setAttribute("aria-label", "Data label " + (labelIndex + 1) +
          " of " + labels.length + ", signal " +
          (signalName(entry) || "unnamed") + ", slice " + (labelSlice + 1));
        hit.addEventListener("click", function () {
          selectDataLabel(entry.signalIndex, labelIndex);
        });
        ui.overlayLayer.appendChild(hit);
      });
    });
  }

  function updateSelectionChrome() {
    const ui = uiRefs();
    if (!ui.overlayLayer) return;
    const buttons = Array.from(ui.overlayLayer.querySelectorAll(".dw-hit"));
    for (const b of buttons) {
      b.classList.remove("is-selected");
      b.tabIndex = -1;
      const badge = b.querySelector(".designer-sel-badge");
      if (badge) badge.remove();
    }
    if (selection != null) {
      for (const b of buttons) {
        if (b.dataset.signalIndex === String(selection) &&
            b.classList.contains("dw-wave-hit")) {
          b.classList.add("is-selected");
          b.tabIndex = dataLabelSelection ? -1 : 0;
          const badge = make("span", "designer-sel-badge", "Signal");
          badge.setAttribute("aria-hidden", "true");
          b.appendChild(badge);
          break;
        }
      }
    }
    if (dataLabelSelection) {
      for (const b of buttons) {
        if (b.dataset.signalIndex === String(dataLabelSelection.signalIndex) &&
            b.dataset.labelIndex === String(dataLabelSelection.labelIndex)) {
          b.classList.add("is-selected");
          b.tabIndex = 0;
          const badge = make("span", "designer-sel-badge", "Data label");
          badge.setAttribute("aria-hidden", "true");
          b.appendChild(badge);
          break;
        }
      }
    }
  }

  function gridMetrics(entry) {
    const ui = uiRefs();
    const card = ui.card;
    const cardRect = card ? card.getBoundingClientRect()
      : { left: 0, right: 0, width: 0, top: 0, bottom: 0 };
    const wrapRect = ui.stageScroll ? ui.stageScroll.getBoundingClientRect()
      : cardRect;
    const svg = card && card.querySelector("svg");
    let gridLeft = cardRect.left + 16;
    let gridW = Math.max(0, cardRect.width - 32);
    const draw = svg && svg.querySelector('g[id^="wavelane_draw_"]');
    if (draw) {
      const r = draw.getBoundingClientRect();
      if (r.width > 0) {
        gridLeft = r.left;
        gridW = r.width;
      }
    }
    const count = sliceCount(entry);
    return {
      count: count,
      gridLeft: gridLeft,
      gridW: gridW,
      cellW: count ? gridW / count : 0,
      cardRect: cardRect,
      wrapRect: wrapRect,
    };
  }

  function syncRuler(model) {
    const ui = uiRefs();
    if (!ui.sliceRuler) return;
    const entry = currentEntry() || model.signals[0];
    const count = entry ? sliceCount(entry) : 0;
    if (!count) {
      ui.sliceRuler.innerHTML = "";
      ui.sliceRuler.hidden = true;
      return;
    }
    ui.sliceRuler.innerHTML = "";
    ui.sliceRuler.setAttribute("role", "listbox");
    ui.sliceRuler.setAttribute("aria-orientation", "horizontal");
    ui.sliceRuler.setAttribute("aria-label", "Time slices");
    const metrics = gridMetrics(entry);
    const cellW = Math.max(24, metrics.cellW || 24);
    ui.sliceRuler.style.setProperty("--dw-slice-cell-w", cellW + "px");
    ui.sliceRuler.style.alignSelf = "flex-start";
    ui.sliceRuler.style.marginLeft =
      Math.max(0, metrics.gridLeft - metrics.wrapRect.left) + "px";
    for (let i = 0; i < count; i++) {
      const b = make("button", "dw-slice-cell", String(i + 1));
      b.type = "button";
      b.setAttribute("role", "option");
      b.dataset.slice = String(i);
      b.setAttribute("aria-label", "Slice " + (i + 1) + " of " + count);
      b.setAttribute("aria-selected", sliceIndex === i ? "true" : "false");
      b.tabIndex = (sliceIndex == null ? i === 0 : sliceIndex === i) ? 0 : -1;
      if (sliceIndex === i) b.classList.add("is-selected");
      b.addEventListener("mouseenter", function () { b.classList.add("is-hover"); });
      b.addEventListener("mouseleave", function () { b.classList.remove("is-hover"); });
      b.addEventListener("click", function () { selectSlice(i); });
      ui.sliceRuler.appendChild(b);
    }
    ui.sliceRuler.hidden = false;
    const selected = ui.sliceRuler.querySelector(".dw-slice-cell.is-selected");
    if (selected && selected.scrollIntoView) {
      try { selected.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      catch (_) {}
    }
  }

  function updateSliceBand() {
    const ui = uiRefs();
    if (!ui.sliceBand) return;
    const entry = currentEntry();
    if (!entry || sliceIndex == null) {
      ui.sliceBand.hidden = true;
      return;
    }
    const count = sliceCount(entry);
    if (!count) {
      ui.sliceBand.hidden = true;
      return;
    }
    const metrics = gridMetrics(entry);
    const cellW = metrics.cellW || 24;
    const rulerRect = ui.sliceRuler
      ? ui.sliceRuler.getBoundingClientRect()
      : { bottom: 0, top: 0 };
    const top = Math.max(0, rulerRect.bottom - metrics.wrapRect.top);
    const height = Math.max(0, metrics.cardRect.bottom - rulerRect.bottom);
    ui.sliceBand.style.left =
      Math.max(0, metrics.gridLeft - metrics.wrapRect.left + sliceIndex * cellW) + "px";
    ui.sliceBand.style.top = top + "px";
    ui.sliceBand.style.width = Math.max(1, cellW) + "px";
    ui.sliceBand.style.height = height + "px";
    ui.sliceBand.hidden = false;
  }

  function afterRender(modelArg) {
    const ui = uiRefs();
    model = modelArg;
    if (!ui.card) return;
    if (selection != null && !model.signals[selection]) selection = null;
    if (dataLabelSelection) {
      const entry = model.signals[dataLabelSelection.signalIndex];
      if (!entry || dataLabelSelection.labelIndex >= dataLabels(entry).length) {
        dataLabelSelection = null;
      }
    }
    buildHits(model);
    updateSelectionChrome();
    if (ui.empty) ui.empty.hidden = model.signals.length !== 0;
    if (ui.hint) ui.hint.hidden = selection != null;
    const active = document.activeElement;
    if (!ui.inspectorBody || !ui.inspectorBody.contains(active)) renderInspector();
    if (!ui.addFields || !ui.addFields.contains(active)) renderAddForm(ui, model);
    buildChart(ui, model);
    syncRuler(model);
    updateSliceBand();
  }

  function mountUI(modelArg, ui) {
    model = modelArg;
    selection = null;
    dataLabelSelection = null;
    sliceIndex = null;
    cellIndex = null;
    addPeriod = 1;
    invalidFields.clear();
    NB.designerShell.setBlocked(false);
    if (ui.addTitle) ui.addTitle.textContent = "Add signal";
    if (ui.addTabs) ui.addTabs.hidden = true;
    if (ui.addForm) {
      ui.addForm.hidden = false;
      ui.addForm.classList.add("dw-add-form");
    }
    buildChart(ui, model);
    if (ui.editSource) ui.editSource.hidden = false;
    if (ui.inspector) ui.inspector.hidden = false;
    if (ui.empty) {
      const msg = ui.empty.querySelector(".dw-empty-msg");
      if (msg) msg.textContent = EMPTY_COPY;
      ui.empty.hidden = model.signals.length !== 0;
    }
    renderAddForm(ui, model);
    renderInspector();
    syncRuler(model);
    updateSliceBand();
    if (window.ResizeObserver && ui.card) {
      resizeObserver = new window.ResizeObserver(function () {
        syncRuler(model);
        updateSliceBand();
      });
      resizeObserver.observe(ui.card);
    }
  }

  function unmountUI() {
    model = null;
    selection = null;
    dataLabelSelection = null;
    sliceIndex = null;
    cellIndex = null;
    addPeriod = 1;
    invalidFields.clear();
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    const ui = uiRefs();
    if (ui.addFields) ui.addFields.innerHTML = "";
    if (ui.inspectorBody) ui.inspectorBody.innerHTML = "";
    if (ui.chart) ui.chart.innerHTML = "";
    if (ui.sliceRuler) { ui.sliceRuler.innerHTML = ""; ui.sliceRuler.hidden = true; }
    if (ui.sliceBand) ui.sliceBand.hidden = true;
  }

  function initCanvas() {
    const ui = uiRefs();
    if (!ui.canvas) return;
    ui.canvas.addEventListener("keydown", function (e) {
      if (!model) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const at = selection == null ? (e.key === "ArrowDown" ? -1 : 1)
          : selection + (e.key === "ArrowDown" ? 1 : -1);
        selectSignal(Math.max(0, Math.min(model.signals.length - 1, at)));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const entry = currentEntry() || model.signals[0];
        if (!entry) return;
        const len = signalWave(entry).length;
        if (!len) return;
        if (sliceIndex == null) {
          selectSlice(e.key === "ArrowLeft" ? len - 1 : 0);
        } else {
          selectSlice(sliceIndex + (e.key === "ArrowRight" ? 1 : -1));
        }
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const entry = currentEntry() || model.signals[0];
        if (!entry) return;
        const len = signalWave(entry).length;
        if (len) selectSlice(e.key === "Home" ? 0 : len - 1);
      } else if (e.key === "Enter") {
        const first = ui.inspectorBody && ui.inspectorBody.querySelector("input, select");
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
    if (ui.sliceRuler) {
      ui.sliceRuler.addEventListener("keydown", function (e) {
        if (!model) return;
        const entry = currentEntry() || model.signals[0];
        if (!entry) return;
        const count = sliceCount(entry);
        if (!count) return;
        const focusSlice = function () {
          const cell = ui.sliceRuler.querySelector(
            ".dw-slice-cell.is-selected") ||
            ui.sliceRuler.querySelector(".dw-slice-cell");
          if (cell) cell.focus();
        };
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          const at = sliceIndex == null
            ? (e.key === "ArrowLeft" ? count - 1 : 0)
            : sliceIndex + (e.key === "ArrowRight" ? 1 : -1);
          selectSlice(at);
          focusSlice();
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          e.stopPropagation();
          selectSlice(e.key === "Home" ? 0 : count - 1);
          focusSlice();
        } else if (e.key === "Enter") {
          const first = ui.inspectorBody &&
            ui.inspectorBody.querySelector("input, select");
          if (first) { e.preventDefault(); e.stopPropagation(); first.focus(); }
        }
      });
    }
    const form = ui.addForm;
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitAdd();
      });
    }
  }

  let resizeObserver = null;

  initCanvas();

  function restore(source) {
    if (!model) return false;
    const baseline = model.snapshot;
    const next = buildModel(source);
    if (next.readOnlyReason) return false;
    Object.assign(model, next);
    model.snapshot = baseline;
    selection = null;
    dataLabelSelection = null;
    sliceIndex = null;
    cellIndex = null;
    invalidFields.clear();
    NB.designerShell.setBlocked(false);
    renderAddForm(uiRefs(), model);
    buildChart(uiRefs(), model);
    renderInspector();
    syncRuler(model);
    updateSliceBand();
    return true;
  }

  const controller = {
    lang: LANG,
    badge: BADGE,
    menuLabel: "Design timing\u2026",
    windowTitle: "Design timing",
    noun: "waveform",
    hint: HINT,
    containerSel: CONTAINER_SEL,
    disabledTitle: DISABLED_TITLE,
    emptyCopy: EMPTY_COPY,
    capabilityFor: capabilityFor,
    readOnlyReason: readOnlyReason,
    buildModel: buildModel,
    isNoOp: function (model) { return deepEqual(model.obj, model.snapshot); },
    serialize: function (model) { return JSON.stringify(model.obj, null, 2); },
    renderSource: function (source) { return NB.wavedrom.renderSvgElement(source); },
    renderNote: function () {
      return NB.wavedrom.renderAll(document.getElementById("viewer-content"));
    },
    mountUI: mountUI,
    afterRender: afterRender,
    unmountUI: unmountUI,
    clearSelection: clearSelection,
    snapshot: function () {
      return model ? JSON.stringify(model.obj, null, 2) : "";
    },
    restore: restore,
  };

  NB.wavedromDesign = {
    open: function (hit) { NB.designerShell.open(controller, hit); },
    capabilityFor: capabilityFor,
    disabledTitle: DISABLED_TITLE,
    menuLabel: "Design timing\u2026",
    windowTitle: "Design timing",
    noun: "waveform",
  };
})();
