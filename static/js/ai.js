/* ai.js -- AI assistant side-panel view: agentic tool loop + reviewable
 * edit cards.
 *
 * The assistant has four NOTEBOOK TOOLS, declared in the system prompt and
 * emitted by the model as fenced ```nb-tool JSON blocks inside its reply:
 *
 *   list   -- tree listing (auto-approved, read-only)
 *   read   -- one file's content (auto, read-only)
 *   write  -- CREATE a new file (needs the user's permission)
 *   patch  -- update an existing file (needs permission)
 *
 * The module runs a TOOL LOOP around the SSE relay: after each assistant
 * message, any nb-tool block is executed (or queued as a permission card)
 * and the result is fed back as a tool-role follow-up message, so the
 * model sees its own tools' output and can continue (multi-step flows
 * like "list, then read, then propose patches").
 *
 * Permission model (enforced here, never by the model):
 *   - read/list run immediately, results shown as trace lines.
 *   - write/patch become CARDS with Apply/Reject. Apply performs:
 *       write  -> POST /api/create (with content)
 *       patch  -> POST /api/edit (find_replace/reline ops)
 *     If the model calls write on an EXISTING file, the card is blocked
 *     with an explicit "use patch instead" error -- overwrite-via-write is
 *     not a supported flow. Patch anchors are re-verified against the
 *     current on-disk file by /api/edit (400 on stale/ambiguous finds).
 *
 * Memory: this module owns the conversation. Every send re-uploads the
 * full history (system + past turns + tool records), so follow-up
 * questions keep context without the model re-reading files.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const MAX_TOOL_ROUNDS = 5;   // safety cap per user turn

  /* ------------------------------------------------------------------ *
   * nb-edit parsing (user-facing proposal cards) + nb-tool blocks
   * ------------------------------------------------------------------ */

  /* A patch proposal is a fenced block:
   *     ```nb-edit
   *     {"op": "replace", "find": "...", "replace": "..."}
   *     ```
   * The brace-scan fallback catches models that emit the bare JSON
   * object without (or with a mangled) fence.
   *
   * collectFenced() scans for ```<lang> blocks and returns the full span
   * plus the inner JSON text. It is BRACKET/QUOTE-AWARE: it walks the
   * body tracking JSON {} / [] depth and string state (quotes + escapes),
   * and only treats a line-leading ``` run as the true closing fence once
   * the JSON is back to depth 0 and outside any string. A naive
   * non-greedy "``` close at the first backtick run" would truncate the
   * block whenever a patch's find/append content legitimately contains
   * its own fenced code (e.g. a mermaid ```flowchart block) -- the inner
   * backticks always sit inside a JSON string, so they never satisfy the
   * depth-0 + not-in-string close condition and the scanner keeps going. */
  function collectFenced(text, lang) {
    const headerRe = new RegExp(
      "```[ \\t]*" + lang + "[ \\t]*[^\\n]*\\n", "g");
    const out = [];
    let m;
    while ((m = headerRe.exec(text)) !== null) {
      const contentStart = m.index + m[0].length;
      let i = contentStart;
      let depth = 0;
      let inStr = false;
      let esc = false;
      let closeStart = -1;
      const len = text.length;
      while (i < len) {
        const c = text[i];
        if (!inStr && (i === contentStart || text[i - 1] === "\n")) {
          // A backtick run that begins a line is a fence candidate.
          if (c === "`") {
            let j = i;
            while (j < len && text[j] === "`") j++;
            if (j - i >= 3 && depth === 0) {
              closeStart = i;      // real close: JSON balanced, not in a string
              break;
            }
            i = j;                 // inner content backticks; skip the run
            continue;
          }
        }
        if (esc) { esc = false; i++; continue; }
        if (inStr) {
          if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          i++;
          continue;
        }
        if (c === '"') { inStr = true; i++; continue; }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        i++;
      }
      if (closeStart >= 0) {
        out.push({
          start: m.index,
          end: closeStart + 3,
          content: text.slice(contentStart, closeStart),
        });
      } else {
        // Unbalanced fence (model never closed it). Treat what we saw as
        // a block so the caller's JSON.parse still has a chance to work.
        out.push({ start: m.index, end: len, content: text.slice(contentStart) });
      }
    }
    return out;
  }

  function tryParseProposal(raw) {
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    // Tolerate models that nest the payload one level deep under "edit".
    const inner = (obj.edit && typeof obj.edit === "object" &&
                   !Array.isArray(obj.edit)) ? obj.edit : obj;
    const op = inner.op;
    if (op === "replace") {
      if (typeof inner.find !== "string" || typeof inner.replace !== "string") {
        return null;
      }
    } else if (op === "append" || op === "prepend") {
      if (typeof inner.replace !== "string") return null;
    } else {
      return null;
    }
    return {
      op,
      find: op === "replace" ? inner.find : "",
      replace: inner.replace,
      path: typeof inner.path === "string" && inner.path ? inner.path : null,
      description:
        typeof inner.description === "string" ? inner.description : "",
      json: raw,
    };
  }

  /* Segment-split an assistant message into prose text vs. the two
   * fenced kinds. Tool spans are cut out so their JSON never shows as
   * prose; cards are later attached at render time. */
  function parseProposals(text) {
    const spans = [];       // {start, end, kind, p}
    for (const b of collectFenced(text, "nb-edit")) {
      const p = tryParseProposal(b.content);
      if (p) spans.push({ start: b.start, end: b.end, kind: "card", p });
    }
    // Tool blocks are collected separately so a card's JSON can never be
    // mistaken for a (or hide inside a) tool call, and vice versa.
    const toolBlocks = collectFenced(text, "nb-tool");
    const sawTool = toolBlocks.length > 0;
    for (const b of toolBlocks) {
      spans.push({ start: b.start, end: b.end, kind: "tool", p: b.content });
    }
    // Fallback ONLY for standalone nb-edit JSON with no fence at all and
    // no tool blocks present (keeps the old tolerant path alive without
    // mangling tool call blocks).
    if (!spans.length && !sawTool && !/```/.test(text)) {
      const objRe = /\{[^{}]*"op"\s*:[^{}]*\}/g;
      let m;
      while ((m = objRe.exec(text)) !== null) {
        const p = tryParseProposal(m[0]);
        if (p) spans.push({ start: m.index, end: m.index + m[0].length, kind: "card", p });
      }
    }
    spans.sort((a, b) => a.start - b.start);
    const segments = [];
    let cursor = 0;
    for (const s of spans) {
      if (s.start < cursor) continue;   // overlap with a previous card
      if (s.start > cursor) {
        segments.push({ type: "text", text: text.slice(cursor, s.start) });
      }
      segments.push(s.kind === "card"
        ? { type: "card", proposal: s.p }
        : { type: "tool", raw: s.p });
      cursor = s.end;
    }
    if (cursor < text.length) {
      segments.push({ type: "text", text: text.slice(cursor) });
    }
    return { segments, count: segments.filter(s => s.type === "card").length };
  }

  function tryParseTool(raw) {
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const tool = obj.tool;
    if (tool === "list") return { tool: "list" };
    if (tool === "read") {
      return typeof obj.path === "string" && obj.path
        ? { tool: "read", path: obj.path } : null;
    }
    if (tool === "write") {
      return (typeof obj.path === "string" && obj.path &&
              typeof obj.content === "string")
        ? { tool: "write", path: obj.path, content: obj.content }
        : null;
    }
    if (tool === "patch") {
      return (typeof obj.path === "string" && obj.path && Array.isArray(obj.edits))
        ? { tool: "patch", path: obj.path, edits: obj.edits }
        : null;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Diff (small, dependency-free) -- for patch cards
   * ------------------------------------------------------------------ */

  /* Row list for oldText -> newText with a 3-line context window.
   * Trimmed common prefix/suffix find the changed middle; everything
   * outside it is context. Honest for single-hunk patches; degrades to
   * showing the whole span for multi-hunk input. Also used to PREVIEW a
   * whole-file write/patch: the caller computes the patched text via the
   * same op semantics the server applies, then diffs. */
  function diffRows(oldText, newText) {
    const oldLines = (oldText ?? "").split("\n");
    const newLines = (newText ?? "").split("\n");
    let start = 0;
    while (start < oldLines.length && start < newLines.length &&
           oldLines[start] === newLines[start]) start++;
    let endOld = oldLines.length, endNew = newLines.length;
    while (endOld > start && endNew > start &&
           oldLines[endOld - 1] === newLines[endNew - 1]) { endOld--; endNew--; }
    const rows = [];
    const ctxFrom = Math.max(0, start - 3);
    for (let i = ctxFrom; i < start; i++) {
      rows.push({ type: "ctx", text: oldLines[i], oldNum: i + 1, newNum: i + 1 });
    }
    for (let i = start; i < endOld; i++) {
      rows.push({ type: "del", text: oldLines[i], oldNum: i + 1 });
    }
    for (let i = start; i < endNew; i++) {
      rows.push({ type: "add", text: newLines[i], newNum: i + 1 });
    }
    const adds = endNew - start;
    for (let i = endOld; i < Math.min(endOld + 3, oldLines.length); i++) {
      rows.push({ type: "ctx", text: oldLines[i], oldNum: i + 1,
                  newNum: i + 1 + adds });
    }
    if (!rows.length) {   // identical texts: show one unchanged line
      rows.push({ type: "ctx", text: oldLines[0] || "", oldNum: 1, newNum: 1 });
    }
    return rows;
  }

  /* Hunk summary line, git-style: "@@ -12,3 +12,5 @@". Rendered as the
   * first row of the diff so the change is located at a glance. */
  function hunkLabel(rows) {
    const firstOld = rows.find(r => r.oldNum != null);
    const firstNew = rows.find(r => r.newNum != null);
    let del = 0, add = 0;
    for (const r of rows) {
      if (r.type === "del") del++;
      else if (r.type === "add") add++;
    }
    const oldPart = firstOld ? ("-" + firstOld.oldNum +
      (del ? "," + del : "")) : "-0,0";
    const newPart = firstNew ? ("+" + firstNew.newNum +
      (add ? "," + add : "")) : "+0,0";
    return "@@ " + oldPart.slice(1) + " " + newPart.slice(1) + " @@";
  }

  function buildDiffEl(oldText, newText) {
    const rows = diffRows(oldText, newText);
    const el = document.createElement("div");
    el.className = "ai-diff";
    let del = 0, add = 0;
    for (const r of rows) {
      if (r.type === "del") del++;
      else if (r.type === "add") add++;
    }
    const header = document.createElement("div");
    header.className = "diff-row diff-hunk";
    header.textContent = hunkLabel(rows);
    el.appendChild(header);
    for (const row of rows) {
      const line = document.createElement("div");
      line.className = "diff-row diff-" + row.type;
      // Dual gutter, unified-grid style: old number | new number | sign |
      // code. Deleted lines blank the new number; added lines blank the
      // old one — same convention as a GitHub split view.
      const oldNum = document.createElement("span");
      oldNum.className = "diff-num diff-num-old";
      oldNum.textContent = row.oldNum != null ? String(row.oldNum) : "";
      const newNum = document.createElement("span");
      newNum.className = "diff-num diff-num-new";
      newNum.textContent = row.newNum != null ? String(row.newNum) : "";
      const sign = document.createElement("span");
      sign.className = "diff-sign";
      sign.textContent = row.type === "add" ? "+" :
                         row.type === "del" ? "−" : "";
      const txt = document.createElement("span");
      txt.className = "diff-text";
      txt.textContent = row.text;
      line.append(oldNum, newNum, sign, txt);
      el.appendChild(line);
    }
    el.dataset.del = String(del);
    el.dataset.add = String(add);
    return el;
  }

  /* "-2 +5" change badges for the card header. */
  function changeStats(el) {
    const wrap = document.createElement("span");
    wrap.className = "ai-diff-stats";
    wrap.appendChild(statBadge("del", el.dataset.del || "0"));
    wrap.appendChild(statBadge("add", el.dataset.add || "0"));
    return wrap;
  }

  function statBadge(kind, count) {
    const b = document.createElement("span");
    b.className = "ai-stat " + kind;
    b.textContent = (kind === "del" ? "−" : "+") + count;
    return b;
  }

  /* Client-side preview of what a batch of /api/edit ops does to `text`.
   * Mirrors the server's find_replace (literal, count) and append/prepend
   * semantics; ops the client can't simulate (line ops, regex) return
   * null -> the card shows a "patch ops" summary instead of a diff. */
  function previewPatch(text, edits) {
    let t = text;
    for (const e of (edits || [])) {
      if (e.op === "find_replace" && typeof e.find === "string" &&
          typeof e.replace_with === "string" && !e.regex) {
        if (!t.includes(e.find)) return null;
        t = e.count === 1 ? t.replace(e.find, e.replace_with)
          : t.split(e.find).join(e.replace_with);
      } else if (e.op === "append" && typeof e.text === "string") {
        t = t + e.text;
      } else if (e.op === "prepend" && typeof e.text === "string") {
        t = e.text + t;
      } else {
        return null;
      }
    }
    return t;
  }

  /* ------------------------------------------------------------------ *
   * Cards: patch (nb-edit), write (new file), and legacy single-op apply
   * ------------------------------------------------------------------ */

  function makeStatus(cls, text) {
    const el = document.createElement("div");
    el.className = "ai-card-status " + cls;
    el.textContent = text;
    return el;
  }

  function removeActions(card) {
    const a = card.querySelector(".ai-edit-actions");
    if (a) a.remove();
  }

  function applyButtons(card, applyLabel, onApply, onReject) {
    const actions = document.createElement("div");
    actions.className = "ai-edit-actions";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "ai-btn ai-apply";
    applyBtn.textContent = applyLabel;
    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "ai-btn ai-reject";
    rejectBtn.textContent = "Reject";
    applyBtn.addEventListener("click", onApply);
    rejectBtn.addEventListener("click", () => {
      card.classList.add("rejected");
      removeActions(card);
      card.appendChild(makeStatus("rejected",
        "✖ Rejected — the AI will be told you declined this change"));
      rejectBtn.disabled = true;
      if (onReject) onReject();
    });
    actions.append(applyBtn, rejectBtn);
    card.appendChild(actions);
    return applyBtn;
  }

  /* PATCH card: renders the proposed ops, previews the diff when all ops
   * are client-simulatable, applies via /api/edit. */
  function makePatchCard(t) {
    const card = document.createElement("div");
    card.className = "ai-edit-card";
    card.dataset.op = "patch";
    card.dataset.testPatchCard = "1";

    const head = document.createElement("div");
    head.className = "ai-edit-head";
    const opBadge = document.createElement("span");
    opBadge.className = "ai-edit-op";
    opBadge.textContent = "patch";
    const file = document.createElement("span");
    file.className = "ai-edit-path";
    file.textContent = t.path;
    head.append(opBadge, file);
    card.appendChild(head);
    if (t.description) {
      const desc = document.createElement("div");
      desc.className = "ai-edit-desc";
      desc.textContent = t.description;
      card.appendChild(desc);
    }

    const applied = async () => {
      /* The patch landed. Tell the watcher to expect our own mtime echo
       * (prevents a poller "changed externally" event for our own
       * write), fetch the fresh content, then refresh through the same
       * event path the viewer refreshes on. The event carries the fresh
       * data so an already-open tab is updated immediately (the watcher
       * suppress above is why we can't rely on file:external-change). */
      if (NB.watcher) NB.watcher.noteSelfSave(t.path);
      let data = null;
      try {
        const fresh = await NB.api.getFile(t.path);
        if (fresh && fresh.content !== undefined) data = fresh;
      } catch (_) { /* tab refresh best-effort; next open refetches */ }
      NB.evt.emit("ai:applied", { path: t.path, data });
    };

    const applyBtnRef = { current: null };
    async function onApply() {
      applyBtnRef.current.disabled = true;
      applyBtnRef.current.textContent = "Applying…";
      card.classList.add("applying");
      let res;
      try {
        res = await NB.api.applyEdits(t.path, t.edits);
      } catch (e) {
        card.classList.remove("applying");
        card.classList.add("errored");
        removeActions(card);
        card.appendChild(makeStatus("error", "✖ " + (e.message || "apply failed")));
        recordToolOutcome(t, "error", "apply failed: " + (e.message || e));
        return;
      }
      card.classList.remove("applying");
      card.classList.add("ok");
      removeActions(card);
      card.appendChild(makeStatus("applied",
        "✔ Applied to " + res.path + " (" + res.applied + " edit" +
        (res.applied === 1 ? "" : "s") + ")"));
      applied();
      recordToolOutcome(t, "ok", "patch applied to " + t.path);
    }
    applyBtnRef.current = applyButtons(card, "Apply", onApply, () => {
      recordToolOutcome(t, "rejected", "patch rejected by user");
    });

    /* Diff preview: fetch the file and simulate. Failure to fetch must
     * never block applying -- the server is the final authority. When the
     * ops can't be simulated client-side, show an ops list instead so the
     * card is never a bare "trust me". */
    (async () => {
      try {
        const data = await NB.api.getFile(t.path);
        // The card is in the DOM by now (the caller appends it after
        // makePatchCard returns; the await above let that happen), so the
        // log can be found. Whether to keep following the bottom is
        // decided BEFORE the insert: the diff grows the card by up to
        // ~260px, which by itself moves the log away from "near bottom".
        const log = card.closest(".ai-chat-log");
        const wasFollowing = !log ||
          (log.scrollHeight - log.scrollTop - log.clientHeight < 80);
        const preview = previewPatch(data.content || "", t.edits);
        if (preview !== null) {
          const diff = buildDiffEl(data.content || "", preview);
          card.insertBefore(diff, card.querySelector(".ai-edit-actions"));
          head.appendChild(changeStats(diff));
        } else {
          const note = document.createElement("div");
          note.className = "ai-patch-ops-note";
          note.textContent = t.edits.length + " op" +
            (t.edits.length === 1 ? "" : "s") + " · preview unavailable (applied atomically)";
          card.insertBefore(note, card.querySelector(".ai-edit-actions"));
        }
        if (wasFollowing && log) scrollLog(log);
      } catch (_) { /* no preview */ }
    })();
    return card;
  }

  /* WRITE card: create a new file. Existing targets are blocked with an
   * explicit "use patch instead" error -- write never overwrites. */
  function makeWriteCard(t) {
    const card = document.createElement("div");
    card.className = "ai-edit-card ai-write-card";
    card.dataset.op = "write";
    card.dataset.testWriteCard = "1";

    const head = document.createElement("div");
    head.className = "ai-edit-head";
    const opBadge = document.createElement("span");
    opBadge.className = "ai-edit-op";
    opBadge.textContent = "write";
    const file = document.createElement("span");
    file.className = "ai-edit-path";
    file.textContent = t.path + " (new file)";
    head.append(opBadge, file);
    card.appendChild(head);
    if (t.description) {
      const desc = document.createElement("div");
      desc.className = "ai-edit-desc";
      desc.textContent = t.description;
      card.appendChild(desc);
    }

    /* Whole-file diff: everything is an addition against an empty base.
     * buildDiffEl gives the same dual gutter + hunk header as patch
     * cards; rows beyond 40 are elided with a footer note. */
    const lines = t.content.split("\n");
    const shown = lines.slice(0, 40);
    const body = buildDiffEl("", t.content.split("\n").slice(0, 40).join("\n"));
    if (lines.length > 40) {
      const more = document.createElement("div");
      more.className = "diff-row diff-more";
      more.textContent = "… " + (lines.length - 40) + " more line" +
        (lines.length - 40 === 1 ? "" : "s");
      body.appendChild(more);
    }
    card.appendChild(body);
    head.appendChild(changeStats(body));

    const applyBtnRef = { current: null };
    async function onApply() {
      applyBtnRef.current.disabled = true;
      applyBtnRef.current.textContent = "Creating…";
      card.classList.add("applying");
      let exists = false;
      try {
        await NB.api.getFile(t.path);
        exists = true;               // readable -> exists -> block
      } catch (_) { /* 404 -> good */ }
      if (exists) {
        card.classList.remove("applying");
        card.classList.add("errored");
        removeActions(card);
        card.appendChild(makeStatus("error",
          "✖ File already exists — write cannot overwrite. Ask the AI to patch it instead."));
        return;
      }
      let res;
      try {
        res = await NB.api.createItem(t.path, "file", t.content);
      } catch (e) {
        card.classList.remove("applying");
        card.classList.add("errored");
        removeActions(card);
        card.appendChild(makeStatus("error", "✖ " + (e.message || "create failed")));
        recordToolOutcome(t, "error", "write failed: " + (e.message || e));
        return;
      }
      card.classList.remove("applying");
      card.classList.add("ok");
      removeActions(card);
      card.appendChild(makeStatus("applied", "✔ Created " + res.path));
      if (NB.sidebar && NB.sidebar.refresh) NB.sidebar.refresh();
      recordToolOutcome(t, "ok", "created " + t.path);
    }
    applyBtnRef.current = applyButtons(card, "Create", onApply, () => {
      recordToolOutcome(t, "rejected", "write rejected by user");
    });
    return card;
  }

  /* ------------------------------------------------------------------ *
   * Tool execution + trace
   * ------------------------------------------------------------------ */

  function makeTrace(tool, path) {
    const el = document.createElement("div");
    el.className = "ai-tool-trace";
    el.dataset.testToolTrace = tool;
    const name = document.createElement("span");
    name.className = "ai-tool-name";
    name.textContent = tool;
    el.appendChild(name);
    if (path) {
      const p = document.createElement("span");
      p.className = "ai-tool-path";
      p.textContent = path;
      el.appendChild(p);
    }
    const out = document.createElement("span");
    out.className = "ai-tool-out";
    el.appendChild(out);
    return el;
  }

  function setTraceOut(el, text, cls) {
    const out = el.querySelector(".ai-tool-out");
    if (out) { out.textContent = text; if (cls) out.className = "ai-tool-out " + cls; }
  }

  /* read/list run immediately and surface as trace lines; write/patch
   * become permission cards and resolve through their buttons. */
  async function runAutoTool(t, logEl) {
    if (t.tool === "list") {
      const el = makeTrace("list", "");
      logEl.appendChild(el);
      try {
        const tree = await NB.api.getTree();
        const lines = [];
        const walk = (nodes, depth) => {
          for (const n of nodes) {
            lines.push("  ".repeat(depth) + (n.type === "dir" ? n.path + "/" : n.path));
            if (n.children) walk(n.children, depth + 1);
          }
        };
        walk(tree || [], 0);
        setTraceOut(el, lines.slice(0, 200).join("\n") +
          (lines.length > 200 ? "\n… (%d more)" : ""), "");
        return { ok: true, text: lines.slice(0, 400).join("\n") || "(empty notebook)" };
      } catch (e) {
        setTraceOut(el, "failed: " + (e.message || e), "err");
        return { ok: false, text: "list failed: " + (e.message || e) };
      }
    }
    if (t.tool === "read") {
      const el = makeTrace("read", t.path);
      logEl.appendChild(el);
      try {
        const data = await NB.api.getFile(t.path);
        setTraceOut(el, data.content.length + " chars", "");
        return { ok: true, text: "Contents of " + t.path + ":\n" + data.content };
      } catch (e) {
        setTraceOut(el, "failed: " + (e.message || e), "err");
        return { ok: false, text: "read " + t.path + " failed: " + (e.message || e) };
      }
    }
    return null;
  }

  /* write/patch become permission cards and resolve through their
   * buttons. The append scrolls the log like every other append: the
   * loop STOPS here until the user decides, so the card must land on
   * screen -- with a long history it would otherwise sit below the
   * fold and the turn would look stuck. */
  function runPendingTool(t, logEl) {
    if (t.tool === "patch") {
      logEl.appendChild(makePatchCard(t));
      scrollLog(logEl);
      return "asked-permission";
    }
    if (t.tool === "write") {
      logEl.appendChild(makeWriteCard(t));
      scrollLog(logEl);
      return "asked-permission";
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Conversation state (memory)
   * ------------------------------------------------------------------ */
  /* The module owns the full transcript: system prompt + all user turns
   * + assistant replies + tool results. Every send() re-uploads it, so
   * the model keeps context across turns ("add more detail to THAT list"
   * keeps working after a read). Tool outcomes are appended so the model
   * knows which of its proposals were applied/rejected/blocked. */

  let conversation = [];   // {role, content} minuse the system prompt
  let systemCache = null;  // reset when the active file changes

  function currentPath() {
    return NB.viewer.getPath() || "";
  }

  function systemPrompt() {
    /* The agentic contract: tool syntax, capability boundaries, the
     * write-vs-patch rule, and the current-file context. Rebuilt when
     * the active file changes. */
    const path = currentPath();
    return [
      "You are the built-in assistant of a markdown notebook web app.",
      "The user's current file is: " + (path || "(none open)"),
      "",
      "You have four tools to work with the notebook. Call one by outputting a fenced code block:",
      "",
      "```nb-tool",
      '{"tool": "list"}',
      "```",
      '```nb-tool',
      '{"tool": "read", "path": "folder/file.md"}',
      "```",
      '```nb-tool',
      '{"tool": "write", "path": "folder/file.md", "content": "full new file content"}',
      "```",
      '```nb-tool',
      '{"tool": "patch", "path": "folder/file.md", "edits": [{"op": "find_replace", "find": "<exact text, appears once>", "replace_with": "<new text>"}, {"op": "append", "text": "..."}, {"op": "prepend", "text": "..."}]}',
      "```",
      "",
      "list and read run automatically and you will see the output.",
      "write and patch need the user's approval: they appear as cards the user applies manually.",
      "RULES:",
      "- To UPDATE an existing file you MUST use patch. write on an existing file is blocked by the app.",
      "- Use write only for creating a NEW file.",
      "- In patch edits, find must match the file EXACTLY and appear exactly once (verbatim, whitespace included).",
      "- To modify the user's current file, patch that path unless told otherwise.",
      "- One logical change per patch tool call; several patch calls are fine.",
      "- After the tool result arrives, continue your answer in normal prose.",
      "- Read the relevant file(s) BEFORE proposing patches; never invent file content.",
      "When the user just asks a question, answer in prose with no nb-tool blocks.",
    ].join("\n") + customPromptSuffix();
  }

  /* GLOBAL custom instructions (Settings → AI → Custom prompt). One text
   * shared by every provider: stored in config/ai.json outside the server
   * list and appended to the built-in contract. The tool syntax stays
   * fixed here — the custom text may only steer style/focus, never
   * invent tools. */
  function customPromptSuffix() {
    const p = typeof globalCustomPrompt === "string"
      ? globalCustomPrompt.trim() : "";
    return p
      ? ("\n\nAdditional instructions from the user (follow them; the tool rules above always win):\n" + p)
      : "";
  }

  function systemCacheKey() { return currentPath(); }

  function getSystem() {
    /* Return a chat message ({role, content}), not a bare string. */
    if (!systemCache) {
      systemCache = { role: "system", content: systemPrompt() };
    }
    return systemCache;
  }

  function invalidateSystem() { systemCache = null; }

  /* Tool outcome ledger: appended to the conversation so the model sees
   * what happened to each of its proposals (applied / rejected / block). */
  function recordToolOutcome(t, status, note) {
    conversation.push({
      role: "user",
      content: "(tool result) " + t.tool + " -> " + note,
    });
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function appendMessage(log, role, text) {
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-" + role;
    if (role === "user") {
      const pre = document.createElement("div");
      pre.className = "ai-user-text";
      pre.textContent = text;
      div.appendChild(pre);
      log.appendChild(div);
      scrollLog(log);
      return div;
    }
    log.appendChild(div);
    scrollLog(log);
    return div;
  }

  function scrollLog(log) {
    log.scrollTop = log.scrollHeight;
  }

  /* Render a prose blob as markdown (same pipeline as the viewer:
   * marked + highlight.js, then post-process). Return a fragment.
   * Falls back to a plain-text node when marked is unavailable so the
   * message never disappears. Not sanitized -- same trust model as the
   * notebook itself (the user's own files), per the viewer's note. */
  function renderMarkdown(text) {
    const frag = document.createDocumentFragment();
    const host = document.createElement("div");
    frag.appendChild(host);
    if (window.marked) {
      host.innerHTML = marked.parse(text, { gfm: true, breaks: false });
    } else {
      const span = document.createElement("span");
      span.className = "ai-prose-span";
      span.textContent = text;
      host.appendChild(span);
      return frag;
    }
    if (window.hljs) {
      host.querySelectorAll("pre code").forEach(el => {
        try { hljs.highlightElement(el); }
        catch (e) { /* leave as plain text */ }
      });
    }
    host.querySelectorAll("pre").forEach(pre => {
      if (NB.app && NB.app.copyToClipboard) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "code-copy-btn";
        btn.textContent = "Copy";
        btn.setAttribute("aria-label", "Copy code to clipboard");
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            await NB.app.copyToClipboard(pre.textContent);
            btn.textContent = "Copied!";
            btn.classList.add("copied");
            setTimeout(() => {
              btn.textContent = "Copy";
              btn.classList.remove("copied");
            }, 1200);
          } catch (_) { /* toast path not available here */ }
        });
        pre.appendChild(btn);
      }
    });
    return frag;
  }

  /* Streaming bubble renderer: re-parses the whole text on every delta;
   * when the structure is unchanged, updates only the last prose node.
   * Prose renders as markdown (headings, lists, code fences, tables). */
  function renderAssistantContent(bubble, fullText, state) {
    const parsed = parseProposals(fullText);
    const shape = parsed.segments.map(s =>
      s.type === "card" ? "c" + JSON.stringify(s.proposal.json)
        : s.type === "tool" ? "k" + s.raw.length
        : "t" + s.text.length).join("|");
    if (shape === state.lastShape) {
      const last = parsed.segments[parsed.segments.length - 1];
      if (last && last.type === "text") {
        const node = bubble.lastChild;
        if (node && node.classList && node.classList.contains("ai-prose-span")) {
          node.replaceChildren(renderMarkdown(last.text));
        }
      }
      scrollLog(bubble.parentNode);
      return;
    }
    state.lastShape = shape;
    bubble.innerHTML = "";
    for (const seg of parsed.segments) {
      if (seg.type === "text") {
        if (!seg.text) continue;
        const span = document.createElement("span");
        span.className = "ai-prose-span";
        span.appendChild(renderMarkdown(seg.text));
        bubble.appendChild(span);
      } else if (seg.type === "card") {
        bubble.appendChild(makePatchCardFromProposal(seg.proposal));
      }
      // tool segments render nothing here; the tool loop handles them
    }
    scrollLog(bubble.parentNode);
  }

  /* Legacy single-op nb-edit block (no tool call): still renders a
   * permission card, still applies through /api/edit, but targets the
   * CURRENT file when no path was given. */
  function makePatchCardFromProposal(p) {
    const edits = p.op === "replace"
      ? [{ op: "find_replace", find: p.find, replace_with: p.replace, count: 1 }]
      : [{ op: p.op, text: p.replace }];
    return makePatchCard({
      tool: "patch",
      path: p.path || currentPath() || "(current file)",
      edits,
      description: p.description,
    });
  }

  /* ------------------------------------------------------------------ *
   * The tool loop
   * ------------------------------------------------------------------ */

  async function send(log, userText, ui) {
    ui.begin();
    appendMessage(log, "user", userText);
    conversation.push({ role: "user", content: userText });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const bubble = appendMessage(log, "assistant", "");
      const state = { lastShape: "" };
      let text = "";
      let aborted = false;
      try {
        await NB.api.aiChat(
          { server: currentServer, messages: [getSystem(), ...conversation] },
          (delta) => { text += delta; renderAssistantContent(bubble, text, state); },
          ui.signal());
      } catch (e) {
        if (e && e.name === "AbortError") aborted = true;
        else {
          const errEl = document.createElement("div");
          errEl.className = "ai-error";
          errEl.textContent = "AI request failed: " + (e.message || e);
          bubble.appendChild(errEl);
        }
        break;
      }
      renderAssistantContent(bubble, text, state);
      if (aborted) break;

      /* Extract nb-tool calls from the reply. */
      const toolCalls = [];
      for (const b of collectFenced(text, "nb-tool")) {
        const t = tryParseTool(b.content);
        if (t) toolCalls.push(t);
      }
      conversation.push({ role: "assistant", content: text });

      if (!toolCalls.length) break;   // plain answer; the turn ends

      /* Execute every tool in order; reads run now, writes/patches ask. */
      let anyPending = false;         // a card is waiting for the user
      const followUps = [];
      for (const t of toolCalls) {
        if (t.tool === "list" || t.tool === "read") {
          const res = await runAutoTool(t, log);
          followUps.push({
            role: "user",
            content: "(tool " + t.tool + (t.path ? " " + t.path : "") + " result)\n" +
                     (res ? res.text : "unavailable"),
          });
        } else {
          const kind = runPendingTool(t, log);
          if (kind === "asked-permission") {
            anyPending = true;
            followUps.push({
              role: "user",
              content: "(tool " + t.tool + " " + t.path +
                " awaiting user approval; the user will apply or reject it)",
            });
          }
        }
      }
      conversation.push(...followUps);
      if (anyPending) {
        // A permission card is pending; stop polling the model until the
        // user clicks Apply/Reject. The outcome lands in the conversation
        // via recordToolOutcome, so the model may continue on the NEXT
        // user message.
        break;
      }
      // Read-only tools: loop again so the model can use their output.
    }
    ui.end();
  }

  /* ------------------------------------------------------------------ *
   * Side-panel view mount
   * ------------------------------------------------------------------ */

  function mount(host) {
    host.innerHTML = "";

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "AI Assistant";
    header.appendChild(title);
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "ai-clear";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Clear the conversation (the model forgets context)";
    clearBtn.addEventListener("click", () => {
      conversation = [];
      systemCache = null;
      log.innerHTML = "";
    });
    header.appendChild(clearBtn);
    host.appendChild(header);

    const hint = document.createElement("div");
    hint.className = "ai-config-hint";
    hint.id = "ai-config-hint";
    hint.hidden = true;
    hint.textContent = "No AI provider configured. Open Settings → AI to add one (any OpenAI-compatible endpoint works).";
    host.appendChild(hint);

    const modelBar = document.createElement("div");
    modelBar.className = "ai-model-bar";
    const sel = document.createElement("select");
    sel.id = "ai-model-select";
    sel.className = "ai-model-select";
    sel.addEventListener("change", () => {
      currentServer = sel.value;
      // The prompt is global now, so switching providers doesn't change
      // the instructions; still cheap to keep the cache coherent.
      invalidateSystem();
    });
    modelBar.appendChild(sel);
    host.appendChild(modelBar);

    const log = document.createElement("div");
    log.className = "ai-chat-log";
    log.id = "ai-chat-log";
    host.appendChild(log);

    const form = document.createElement("form");
    form.className = "ai-input-row";
    const ta = document.createElement("textarea");
    ta.id = "ai-input";
    ta.className = "ai-input";
    ta.rows = 3;
    ta.placeholder = "Ask the AI to write or edit notes; it can list and read files…";
    const sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.className = "ai-send";
    sendBtn.textContent = "↑";
    sendBtn.title = "Send (Enter)";
    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "ai-stop";
    stopBtn.textContent = "■";
    stopBtn.title = "Stop generating";
    stopBtn.hidden = true;
    form.append(ta, sendBtn, stopBtn);
    host.appendChild(form);

    let ctl = null;
    const ui = {
      begin() {
        ctl = new AbortController();
        sendBtn.disabled = true;
        stopBtn.hidden = false;
      },
      end() {
        sendBtn.disabled = false;
        stopBtn.hidden = true;
        ctl = null;
      },
      signal() { return ctl ? ctl.signal : undefined; },
    };
    sendBtn.dataset.testSend = "1";

    async function onSubmit(e) {
      e.preventDefault();
      if (ctl) return;                      // a request is already running
      const q = ta.value.trim();
      if (!q) return;
      if (!currentServer) {
        const errEl = document.createElement("div");
        errEl.className = "ai-error";
        errEl.textContent = "No AI provider configured — open Settings → AI.";
        log.appendChild(errEl);
        scrollLog(log);
        return;
      }
      ta.value = "";
      await send(log, q, ui);
    }
    form.addEventListener("submit", onSubmit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit(e);
      }
    });
    stopBtn.addEventListener("click", () => {
      if (ctl) ctl.abort();
    });

    // Populate the provider picker from the server. Settings-side edits
    // funnel through NB.ai.loadAiConfig (settings.js calls it after every
    // save) so a re-mount isn't needed to see new providers.
    loadAiConfig();

    // The system prompt names the user's current file: rebuild it when
    // the active file changes (also see app.js's NB viewer events).
    NB.evt.on("file:open", () => invalidateSystem());
    NB.evt.on("file:external-change", () => invalidateSystem());
  }

  let servers = [];
  let currentServer = "";
  let globalCustomPrompt = "";   // Settings → AI → Custom prompt (global)

  async function loadAiConfig() {
    try {
      const cfg = await NB.api.aiGetConfig();
      servers = (cfg && cfg.servers) || [];
      currentServer = (cfg && cfg.default) ||
        (servers.length ? servers[0].name : "");
      globalCustomPrompt =
        cfg && typeof cfg.customPrompt === "string" ? cfg.customPrompt : "";
    } catch (e) {
      servers = [];
      currentServer = "";
      // Keep the last known prompt — a config fetch hiccup shouldn't
      // silently drop the user's instructions mid-session.
    }
    // The custom prompt (or the provider list) may have changed; the
    // system prompt needs rebuilding.
    invalidateSystem();
    refreshServerBar();
  }

  function refreshServerBar() {
    const sel = document.getElementById("ai-model-select");
    const hint = document.getElementById("ai-config-hint");
    if (!sel) return;
    sel.innerHTML = "";
    if (!servers.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "no provider configured";
      sel.appendChild(opt);
      if (hint) hint.hidden = false;
      return;
    }
    for (const s of servers) {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name + " · " + (s.model || s.baseUrl);
      sel.appendChild(opt);
    }
    if (!servers.some(s => s.name === currentServer)) {
      currentServer = servers[0].name;
    }
    sel.value = currentServer;
    if (hint) hint.hidden = true;
  }

  NB.ai = {
    mount,
    collectFenced,
    parseProposals,
    tryParseProposal,
    tryParseTool,
    diffRows,
    previewPatch,
    refreshServerBar,
    loadAiConfig,
    systemPrompt,
    /* Ask the module to rebuild the system prompt (active file changed). */
    invalidateSystem: invalidateSystem,
    recordToolOutcomeForTests: recordToolOutcome,
    /* Test hooks (tests/dom/test_dom.js resets state between blocks). */
    _setServersForTests(list, deflt) {
      servers = list || [];
      currentServer = deflt || (servers.length ? servers[0].name : "");
      refreshServerBar();
    },
    _getCurrentServer: () => currentServer,
    _getConversationForTests: () => conversation.slice(),
    _resetForTests() {
      conversation = [];
      systemCache = null;
    },
  };
})();