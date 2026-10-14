/* ai.js -- AI assistant side-panel view: agentic tool loop + reviewable
 * edit cards.
 *
 * The assistant has six NOTEBOOK TOOLS, declared in the system prompt and
 * emitted by the model as fenced ```nb-tool JSON blocks inside its reply:
 *
 *   list   -- tree listing (auto-approved, read-only)
 *   read   -- one file's content (auto, read-only)
 *   write  -- CREATE a new file (needs the user's permission)
 *   patch  -- update an existing file (needs permission)
 *   fetch  -- fetch a URL server-side (auto, read-only; CORS-safe)
 *   search -- query the configured SearXNG instance (auto, read-only)
 *
 * The module runs a TOOL LOOP around the SSE relay: after each assistant
 * message, any nb-tool block is executed (or queued as a permission card)
 * and the result is fed back as a tool-role follow-up message, so the
 * model sees its own tools' output and can continue (multi-step flows
 * like "list, then read, then propose patches").
 *
 * Permission model (enforced here, never by the model):
 *   - read/list/fetch/search run immediately, results shown as trace lines.
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
 *
 * Regenerate: once a turn finishes (success, error, or stop) the newest
 * assistant bubble carries a "↻ Regenerate" footer button. regenerate()
 * trims the conversation back to the latest genuine user turn and re-runs
 * the loop, re-sending that turn (image parts included) unchanged.
 *
 * Attachments: the user may attach images (PNG/JPEG/WebP/GIF) and local
 * text files. Text bodies are inlined into the user turn (128 KiB per
 * file, 512 KiB total). Images are read and downscaled/re-encoded locally
 * in the browser, then sent as OpenAI-compatible image_url content parts
 * (max 4 per message); a message carrying images uses a content-part
 * array instead of a plain string. Both kinds share one chip list (max 8
 * total) and one synchronous slot reservation. The visible bubble shows
 * text names and image thumbnails; the bodies/bytes live in the
 * conversation, so they are re-uploaded on every request and tool round.
 * Clear resets the attachments with the chat.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const MAX_TOOL_ROUNDS = 5;   // safety cap per user turn

  /* Turn controls under the newest turn: Edit restores the last prompt and
   * its attachments into the composer (no auto-send); Regenerate re-runs
   * the turn. Only the newest turn carries them. */
  const AI_EDIT_LABEL = "✎ Edit";
  const AI_EDIT_TITLE = "Edit your last question and resend";
  const AI_EDIT_DRAFT_TITLE = "Clear the draft and attachments first";

  /* Attachments: local text files inlined into the user turn, and local
   * images sent as content parts. The slot count and the per-file source
   * cap are reserved synchronously at selection time so an in-flight read
   * can never race the accounting; encoded-byte accounting settles when
   * the read/encode completes. */
  const AI_ATTACH_MAX_FILES = 8;               // text + image chips
  const AI_ATTACH_MAX_IMAGES = 4;              // image chips per message
  const AI_ATTACH_IMAGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
  const AI_ATTACH_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
  const AI_ATTACH_IMAGE_TARGET_BYTES = 768 * 1024;
  const AI_ATTACH_IMAGE_MAX_EDGE = 1568;       // longest edge after downscale
  const AI_ATTACH_IMAGE_SECOND_EDGE = 1024;    // one retry pass if still large
  const AI_ATTACH_IMAGE_QUALITY = 0.85;        // JPEG/WebP re-encode quality
  const AI_ATTACH_IMAGE_SECOND_QUALITY = 0.75; // second-pass quality
  const AI_ATTACH_IMAGE_MAX_PIXELS = 40 * 1000 * 1000;
  const AI_ATTACH_TEXT_MAX_BYTES = 128 * 1024;
  const AI_ATTACH_TEXT_MAX_TOTAL = 512 * 1024;
  const AI_ATTACH_MAX_WIRE_BYTES = 12 * 1024 * 1024;
  const AI_ATTACH_KB = 1024;
  const AI_ATTACH_MB = 1024 * 1024;
  const AI_ATTACH_NAME_MAX = 120;              // chars kept from a name
  const AI_ATTACH_NUL = "\u0000";              // binary-content sentinel
  const AI_ATTACH_CTRL_RE = /[\u0000-\u001f\u007f]+/g;
  const AI_ATTACH_BOM_UTF8 = [0xEF, 0xBB, 0xBF];
  const AI_ATTACH_BOM_UTF16LE = [0xFF, 0xFE];
  const AI_ATTACH_BOM_UTF16BE = [0xFE, 0xFF];
  const AI_ATTACH_MARK_OPEN = "[Attached file: ";
  const AI_ATTACH_MARK_SIZE = " (";
  const AI_ATTACH_MARK_OPEN_END = ")]";
  const AI_ATTACH_MARK_CLOSE = "[/Attached file: ";
  const AI_ATTACH_MARK_CLOSE_END = "]";
  const AI_ATTACH_ERR_BINARY = "binary";
  const AI_ATTACH_ERR_READ = "read failed";
  const AI_ATTACH_TYPE_ALLOW = [
    "application/json", "application/xml",
    "application/javascript", "application/x-yaml",
  ];
  const AI_ATTACH_EXT_ALLOW = [
    ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".csv", ".log",
    ".py", ".c", ".h", ".cc", ".cpp", ".hpp", ".js", ".mjs", ".ts", ".tsx",
    ".html", ".css", ".sh", ".bash", ".toml", ".ini", ".cfg", ".conf",
    ".xml", ".svg", ".rs", ".go", ".java", ".mk",
  ];
  /* SVG stays text (in the list above); only raster formats are images. */
  const AI_ATTACH_IMAGE_TYPES = [
    "image/png", "image/jpeg", "image/webp", "image/gif",
  ];
  const AI_ATTACH_IMAGE_EXTS = [
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ];
  /* Accept filter for the attach input while an ACP provider is active:
   * keeps the OS picker from offering raster images the agent cannot take.
   * The send path strips any image that still gets in (paste/drop). */
  const AI_ATTACH_TEXT_ACCEPT = "text/*";

  /* Chat history survives a reload through localStorage. The key follows
   * the nb:tableView / nb:windowGeometry convention; the payload is
   * versioned and toolFlags is parallel to the conversation so restored
   * tool follow-ups keep their structural tag. An over-size write drops
   * image data URLs (rewritten to a text placeholder) rather than
   * exhausting the quota, and is skipped entirely if it still doesn't
   * fit. */
  const AI_HISTORY_KEY = "nb:aiChat";
  const AI_HISTORY_VERSION = 1;
  const AI_HISTORY_MAX_BYTES = 4 * 1024 * 1024;
  const AI_HISTORY_IMAGE_PLACEHOLDER = "[image not saved in history]";
  /* Substring of the tool-loop's "awaiting user approval" follow-up; a
   * restored transcript whose last entry carries it gets an abandoned
   * outcome (the permission card is gone after reload). */
  const AI_ABANDONED_MARK = "awaiting user approval";

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
    if (tool === "fetch") {
      return (typeof obj.url === "string" && obj.url)
        ? { tool: "fetch", url: obj.url } : null;
    }
    if (tool === "search") {
      return (typeof obj.q === "string" && obj.q)
        ? { tool: "search", q: obj.q } : null;
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
    /* Resolving a permission card may unblock the turn controls. */
    updateTurnDisabled();
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
    if (t.tool === "fetch") {
      const el = makeTrace("fetch", t.url);
      logEl.appendChild(el);
      try {
        const data = await NB.api.aiFetch(t.url);
        setTraceOut(el, (data.contentType || "text") + " · " +
          data.content.length + " chars" + (data.truncated ? " (truncated)" : ""), "");
        return { ok: true, text: "Fetched " + t.url + " (content-type: " +
          (data.contentType || "unknown") + (data.truncated ? ", truncated" : "") +
          "):\n" + data.content };
      } catch (e) {
        setTraceOut(el, "failed: " + (e.message || e), "err");
        return { ok: false, text: "fetch " + t.url + " failed: " + (e.message || e) };
      }
    }
    if (t.tool === "search") {
      const el = makeTrace("search", t.q);
      logEl.appendChild(el);
      try {
        const data = await NB.api.aiSearch(t.q);
        const results = data.results || [];
        setTraceOut(el, results.length + " results", "");
        if (!results.length) {
          return { ok: true, text: "Search \"" + t.q + "\" returned no results." };
        }
        const lines = results.map((r, i) =>
          (i + 1) + ". " + (r.title || "(untitled)") + "\n   " + r.url +
          (r.snippet ? "\n   " + r.snippet : ""));
        return { ok: true, text: "Search results for \"" + t.q + "\":\n" +
          lines.join("\n") };
      } catch (e) {
        setTraceOut(el, "failed: " + (e.message || e), "err");
        return { ok: false, text: "search \"" + t.q + "\" failed: " + (e.message || e) };
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
  /* Structural tag for role-user entries that are tool follow-ups, not
   * genuine user turns. A WeakSet keeps sliced-away entries collectable
   * and adds nothing to the serialized entry (the wire body stays
   * {role, content}). */
  const toolMessages = new WeakSet();

  /* The mounted panel installs these so regenerate()/editLastMessage()
   * (exposed on NB.ai and wired to the turn-control buttons) can read the
   * live request/attachment state and the chat log without a DOM query.
   * regenBtn/editBtn are the newest turn's controls; runToolLoop() clears
   * them before every new turn. lastSentPrompt/lastSentFiles capture the
   * last sent turn for Edit; they hold the composer's own data only (never
   * the conversation entries, which serialize to the wire). */
  let mountLog = null;
  let mountUi = null;
  let mountIsBusy = () => false;
  let mountPendingReads = () => 0;
  /* Live composer state for the Edit guard: a non-empty draft or a
   * pending attachment chip means editLastMessage() (which clears the
   * attach bar and overwrites the textarea) would discard the user's
   * work, so Edit stays disabled. */
  let mountDraftNonEmpty = () => false;
  let mountHasPendingAttachments = () => false;
  let regenBtn = null;
  let editBtn = null;
  let lastSentPrompt = "";
  let lastSentFiles = [];
  /* Set by mount(); re-applies the attach control's ACP affordance when the
   * active provider changes (picker change or a config reload). */
  let mountSyncAttachAffordance = null;
  /* One inline ACP image notice per turn, however many rounds/requests. */
  let acpImageNoticeShown = false;

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
      "You have six tools to work with the notebook and the web. Call one by outputting a fenced code block:",
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
      '```nb-tool',
      '{"tool": "fetch", "url": "https://example.com/page"}',
      "```",
      '```nb-tool',
      '{"tool": "search", "q": "search query"}',
      "```",
      "",
      "list, read, fetch, and search run automatically and you will see the output.",
      "write and patch need the user's approval: they appear as cards the user applies manually.",
      "fetch retrieves a web page server-side (CORS-safe); use it to read a URL the user mentions.",
      "search queries the configured SearXNG instance; if it fails, no instance is configured and you should say so.",
      "RULES:",
      "- To UPDATE an existing file you MUST use patch. write on an existing file is blocked by the app.",
      "- Use write only for creating a NEW file.",
      "- In patch edits, find must match the file EXACTLY and appear exactly once (verbatim, whitespace included).",
      "- To modify the user's current file, patch that path unless told otherwise.",
      "- One logical change per patch tool call; several patch calls are fine.",
      "- After the tool result arrives, continue your answer in normal prose.",
      "- Read the relevant file(s) BEFORE proposing patches; never invent file content.",
      "When the user just asks a question, answer in prose with no nb-tool blocks.",
      "",
      "MARKDOWN RENDERING — the notebook renders these fenced languages specially. Use them when they make the note clearer. Each engine is a fixed vendored version, so use only syntax that version supports:",
      "- ```mermaid — Mermaid 11.16 diagram (flowchart / sequence / class / state / ER / gantt). Rendered with securityLevel:strict, so interactive click/link directives are disabled.",
      "- ```wavedrom — WaveDrom 3.3 timing / waveform diagram. The body is WaveDrom JSON: unquoted keys are allowed (e.g. {signal:[{name:'clk',wave:'p...'}]}), unlike strict JSON.",
      "- ```math or ```katex — KaTeX 0.16 LaTeX equation, rendered in display mode. Only KaTeX-supported LaTeX commands work (no full TeX macros).",
      "- ```dot or ```graphviz — Graphviz 2.40.1 (Viz.js 2.1.2). That is an older Graphviz; avoid syntax newer than 2.40.",
      "- ```html-live — a live preview that RUNS the markup (CSS / SVG animation, inline script, canvas). Plain ```html only shows the source. The frame auto-fits its content; an optional first-line comment like <!-- height: 480 --> sets a minimum height.",
      "  html-live restrictions: the preview is a sandboxed iframe with allow-scripts and NOT allow-same-origin, so it has an opaque origin. Scripts run, but these are BLOCKED: cookies, localStorage / sessionStorage (opaque origin throws), the parent page's DOM, the notebook API (/api/*), same-origin fetch, form submission, window.open / popups, file downloads, alert / confirm / prompt, and top-level navigation. External fetch is subject to CORS. Use it for self-contained, offline demos only.",
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

  /* Append a tool follow-up/outcome: it goes on the conversation AND into
   * the structural toolMessages set, so lastUserTurnIndex() can skip it
   * without sniffing the content. Every tool-role-user push uses this. */
  function pushToolMessage(entry) {
    conversation.push(entry);
    toolMessages.add(entry);
    persistHistory();
  }

  /* Tool outcome ledger: appended to the conversation so the model sees
   * what happened to each of its proposals (applied / rejected / block). */
  function recordToolOutcome(t, status, note) {
    pushToolMessage({
      role: "user",
      content: "(tool result) " + t.tool + " -> " + note,
    });
  }

  /* Index of the latest GENUINE user turn: the last role-user entry that
   * is not in toolMessages. A content-part array (an image turn) is never
   * tagged, so it is always genuine. -1 when none. */
  function lastUserTurnIndex() {
    for (let i = conversation.length - 1; i >= 0; i--) {
      const m = conversation[i];
      if (m.role !== "user") continue;
      if (toolMessages.has(m)) continue;
      return i;
    }
    return -1;
  }

  /* An image-bearing turn uses a content-part array with image_url parts. */
  function turnHasImages(entry) {
    return !!entry && Array.isArray(entry.content) &&
      entry.content.some((p) => p && p.type === "image_url");
  }

  /* ------------------------------------------------------------------ *
   * Persistence (chat history survives a reload)
   * ------------------------------------------------------------------ */
  /* The transcript is text and small except when a turn carries image
   * data URLs, which can be megabytes. persistHistory() is the single
   * write chokepoint: the size guard rewrites image parts to a text
   * placeholder before storing, and skips the write when even the
   * reduced copy is too large. Nothing here may throw -- a full or
   * disabled localStorage only means the chat is not restored. */
  function persistHistory() {
    try {
      const payload = {
        v: AI_HISTORY_VERSION,
        conversation: conversation,
        toolFlags: conversation.map((m) => toolMessages.has(m)),
        lastPrompt: typeof lastSentPrompt === "string" ? lastSentPrompt : "",
      };
      let serialized = JSON.stringify(payload);
      if (wireByteSize(serialized) > AI_HISTORY_MAX_BYTES) {
        payload.conversation = conversation.map(reduceHistoryEntry);
        serialized = JSON.stringify(payload);
      }
      if (wireByteSize(serialized) > AI_HISTORY_MAX_BYTES) return;
      localStorage.setItem(AI_HISTORY_KEY, serialized);
    } catch (e) {
      /* Quota exceeded or storage unavailable: keep any previous value. */
    }
  }

  /* An over-size entry loses its image_url parts; role and text parts
   * stay, so the restored turn still reads as the user's words. */
  function reduceHistoryEntry(m) {
    if (!m || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map((p) => {
      if (p && p.type === "image_url") {
        changed = true;
        return { type: "text", text: AI_HISTORY_IMAGE_PLACEHOLDER };
      }
      return p;
    });
    return changed ? Object.assign({}, m, { content }) : m;
  }

  function clearStoredHistory() {
    try { localStorage.removeItem(AI_HISTORY_KEY); } catch (e) { /* noop */ }
  }

  function isHistoryEntry(m) {
    return !!m && typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      (typeof m.content === "string" || Array.isArray(m.content));
  }

  /* The AI API is admin-only and the transcript can hold note contents the
   * assistant read or patched. Do not restore it into a viewer session on a
   * shared browser; keep the stored blob for the next admin mount. */
  function historyVisible() {
    const s = (NB.auth && NB.auth.status) ? NB.auth.status() : null;
    return !(s && s.enabled && s.role !== "admin");
  }

  /* A reload can land while a write/patch CARD awaits Apply/Reject: the
   * stored transcript ends with the "awaiting user approval" follow-up but
   * the card is gone after reload, so the model would wait forever. Record
   * the abandonment once so the transcript stays honest. */
  function resolveAbandonedPending() {
    const last = conversation[conversation.length - 1];
    if (!last || !toolMessages.has(last)) return;
    if (typeof last.content !== "string" ||
        last.content.indexOf(AI_ABANDONED_MARK) < 0) return;
    pushToolMessage({
      role: "user",
      content: "(tool result) " + AI_ABANDONED_MARK +
        ": the page was reloaded before the user decided",
    });
  }

  /* Rebuild the transcript and the visible log from a stored payload. An
   * invalid shape drops the key and is ignored. The system prompt is not
   * persisted (it names the current file), so it is rebuilt fresh. */
  function restoreHistory(log) {
    if (!historyVisible()) return;
    let raw = null;
    try { raw = localStorage.getItem(AI_HISTORY_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    let payload = null;
    try { payload = JSON.parse(raw); } catch (e) { payload = null; }
    if (!payload || payload.v !== AI_HISTORY_VERSION ||
        !Array.isArray(payload.conversation) ||
        !payload.conversation.every(isHistoryEntry)) {
      clearStoredHistory();
      return;
    }
    const flags = Array.isArray(payload.toolFlags) ? payload.toolFlags : [];
    conversation = [];
    for (let i = 0; i < payload.conversation.length; i++) {
      /* Rebuild clean {role, content} entries: anything extra a tampered
       * payload carried must never reach the wire body. */
      const entry = {
        role: payload.conversation[i].role,
        content: payload.conversation[i].content,
      };
      conversation.push(entry);
      if (flags[i] === true) toolMessages.add(entry);
    }
    lastSentPrompt = typeof payload.lastPrompt === "string"
      ? payload.lastPrompt : "";
    lastSentFiles = [];
    resolveAbandonedPending();   // persists on its own via pushToolMessage
    if (log) renderRestoredHistory(log);
    invalidateSystem();
  }

  /* Re-render the bubbles in order. Tool follow-ups are skipped (they were
   * never shown live). User turns show text and image thumbnails;
   * assistant replies show prose only -- historical permission cards are
   * not recreated, since their anchors may be stale. */
  function renderRestoredHistory(log) {
    let hasGenuineUser = false;
    for (const entry of conversation) {
      if (toolMessages.has(entry)) continue;
      if (entry.role === "user") {
        hasGenuineUser = true;
        renderRestoredUser(log, entry);
      } else if (entry.role === "assistant") {
        renderRestoredAssistant(log, entry);
      }
    }
    if (hasGenuineUser) restoreTurnControls(log);
  }

  function renderRestoredUser(log, entry) {
    const parts = Array.isArray(entry.content) ? entry.content : null;
    const text = parts
      ? parts.filter((p) => p && p.type === "text").map((p) => p.text || "").join("")
      : String(entry.content);
    const bubble = appendMessage(log, "user", stripAttachBlocks(text));
    if (!parts) return;
    const files = parts
      .filter((p) => p && p.type === "image_url" &&
        p.image_url && typeof p.image_url.url === "string")
      .map((p) => ({
        kind: "image", name: "image", size: 0, dataUrl: p.image_url.url,
      }));
    if (files.length) appendUserFiles(bubble, files);
  }

  function renderRestoredAssistant(log, entry) {
    const text = typeof entry.content === "string" ? entry.content : "";
    const prose = stripFencedSpans(text, ["nb-tool", "nb-edit"]);
    if (!prose.trim()) return;   // tool-only turn: nothing to show
    const bubble = appendMessage(log, "assistant", "");
    const span = document.createElement("span");
    span.className = "ai-prose-span";
    span.appendChild(renderMarkdown(prose));
    bubble.appendChild(span);
  }

  /* Remove the inline "[Attached file: NAME (SIZE)]...[/Attached file:
   * NAME]" blocks a text attachment appends to the user turn. A scanner
   * (not a regex) keeps a malformed or unterminated block from hanging:
   * the cursor always advances. */
  function stripAttachBlocks(text) {
    if (typeof text !== "string" || text.indexOf(AI_ATTACH_MARK_OPEN) < 0) {
      return typeof text === "string" ? text : "";
    }
    let out = "";
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf(AI_ATTACH_MARK_OPEN, i);
      if (open < 0) { out += text.slice(i); break; }
      out += text.slice(i, open);
      const nameStart = open + AI_ATTACH_MARK_OPEN.length;
      const headerEnd = text.indexOf(AI_ATTACH_MARK_OPEN_END, nameStart);
      if (headerEnd < 0) { out += text.slice(open); break; }  // malformed
      const sizeSep = text.lastIndexOf(AI_ATTACH_MARK_SIZE, headerEnd);
      const name = text.slice(nameStart,
        sizeSep >= nameStart ? sizeSep : headerEnd);
      const closeMark = AI_ATTACH_MARK_CLOSE + name + AI_ATTACH_MARK_CLOSE_END;
      const headerAfter = headerEnd + AI_ATTACH_MARK_OPEN_END.length;
      const close = text.indexOf(closeMark, headerAfter);
      if (close < 0) {
        // Unterminated: keep the header and resume past it, never loop.
        out += text.slice(open, headerAfter);
        i = headerAfter;
        continue;
      }
      i = close + closeMark.length;
    }
    /* The blocks are appended after the prompt separated by blank lines;
     * trim the separators they leave behind. */
    return out.replace(/\s+$/, "");
  }

  /* Blank out the given fenced spans (nb-tool / nb-edit) from an assistant
   * reply, leaving the prose. Overlapping spans are masked before removal
   * so a nested fence cannot shift an index. */
  function stripFencedSpans(text, langs) {
    const spans = [];
    for (const lang of langs) {
      for (const s of collectFenced(text, lang)) spans.push(s);
    }
    if (!spans.length) return text;
    const mask = new Uint8Array(text.length);
    for (const s of spans) {
      const from = Math.max(0, s.start);
      const to = Math.min(text.length, s.end);
      for (let i = from; i < to; i++) mask[i] = 1;
    }
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (mask[i]) { i++; continue; }
      let j = i;
      while (j < text.length && !mask[j]) j++;
      out += text.slice(i, j);
      i = j;
    }
    return out;
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
    // Delegate to the shared copy-button owner (copy-image.js) so the AI
    // panel's code blocks use the same affordance as every other block.
    host.querySelectorAll("pre").forEach(pre => {
      if (NB.copyButton && NB.copyButton.attachTextCopy) {
        NB.copyButton.attachTextCopy(pre);
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

  /* Serialized request size in UTF-8 bytes -- the quantity the wire cap
   * bounds, including the re-uploaded conversation. */
  function wireByteSize(str) {
    return new TextEncoder().encode(str).length;
  }

  /* Serialized size of a request body with the current conversation plus
   * optional extra messages -- the exact shape NB.api.aiChat sends, so the
   * tool loop can re-check the cap before every round. */
  function wireSizeOfMessages(extraMessages) {
    const body = {
      server: currentServer,
      messages: [getSystem(), ...conversation].concat(extraMessages || []),
    };
    return wireByteSize(JSON.stringify(body));
  }

  function wireSizeOfTurn(userContent) {
    return wireSizeOfMessages([{ role: "user", content: userContent }]);
  }

  function showSendTooLarge(log, size) {
    const errEl = document.createElement("div");
    errEl.className = "ai-error";
    errEl.textContent = "Message too large to send (" + humanSize(size) +
      ", limit " + (AI_ATTACH_MAX_WIRE_BYTES / AI_ATTACH_MB) +
      " MB); remove attachments or Clear the conversation.";
    log.appendChild(errEl);
    scrollLog(log);
  }

  /* An ACP profile (config/acp.json) is tagged client-side by loadAiConfig.
   * It runs a local agent process with no image input: the server answers
   * 400 for any image_url part, and because the whole transcript is
   * re-uploaded every turn one stale image would poison every later turn.
   * So an ACP turn drops image parts and says so. */
  function activeServerIsAcp() {
    return servers.some((s) => s && s.name === currentServer && s.acp === true);
  }

  /* Messages exactly as they go on the wire. For ACP, every image_url part
   * is removed and a mixed turn collapses to its text; the conversation
   * itself is left intact, so switching back to an OpenAI profile restores
   * the images. */
  function buildRequestMessages() {
    const messages = [getSystem(), ...conversation];
    if (!activeServerIsAcp()) return { messages, strippedImages: 0 };
    let strippedImages = 0;
    const out = messages.map((m) => {
      if (!m || !Array.isArray(m.content)) return m;
      const kept = m.content.filter((p) => !(p && p.type === "image_url"));
      if (kept.length === m.content.length) return m;
      strippedImages += m.content.length - kept.length;
      const text = kept.filter((p) => p && p.type === "text")
        .map((p) => p.text || "").join("");
      return Object.assign({}, m, { content: text });
    });
    return { messages: out, strippedImages };
  }

  /* The panel's send-problem notice element (.ai-error), shown at most once
   * per turn. */
  function showAcpImageNotice(log, count) {
    if (!log || acpImageNoticeShown) return;
    acpImageNoticeShown = true;
    const errEl = document.createElement("div");
    errEl.className = "ai-error";
    errEl.textContent = "ACP agents do not accept image attachments — " +
      (count === 1 ? "the image was not sent." : count + " images were not sent.");
    log.appendChild(errEl);
    scrollLog(log);
  }

  /* Does a write/patch permission card still await the user after the last
   * user bubble? The tool loop stops for that decision, so Regenerate stays
   * disabled until the card is applied or rejected (its actions removed). */
  function hasPendingCard(log) {
    const users = log.querySelectorAll(".ai-msg-user");
    const lastUser = users[users.length - 1];
    if (!lastUser) return false;
    let node = lastUser.nextElementSibling;
    while (node) {
      if (node.classList && node.classList.contains("ai-edit-card") &&
          node.querySelector(".ai-edit-actions")) return true;
      node = node.nextElementSibling;
    }
    return false;
  }

  /* Drop every sibling node after the last .ai-msg-user bubble: assistant
   * bubbles AND the .ai-tool-trace lines, .ai-error boxes, and cards the
   * tool loop appends directly to the log. Replacing the last turn is a
   * whole-tail operation -- trimming only .ai-msg siblings left stale
   * trace lines behind (duplicate traces after Regenerate). Regenerate
   * keeps the user bubble (the turn is re-run unchanged); Edit passes
   * includeUser to drop it too (the turn is re-added by the next send). */
  function clearLastTurnDom(log, includeUser) {
    if (!log) return;
    const users = log.querySelectorAll(".ai-msg-user");
    const lastUser = users[users.length - 1];
    if (!lastUser) return;
    let node = lastUser.nextElementSibling;
    while (node) {
      const next = node.nextElementSibling;
      node.remove();
      node = next;
    }
    if (includeUser) lastUser.remove();
  }

  /* Only the newest turn carries the turn controls (Edit + Regenerate). */
  function removeTurnControls(log) {
    if (log) {
      log.querySelectorAll(".ai-turn-control").forEach((b) => b.remove());
    }
    regenBtn = null;
    editBtn = null;
  }

  /* Disabled while a request is in flight, attachment reads are pending,
   * or a permission card is unresolved -- the guard's visual half. Edit is
   * additionally disabled while the composer holds a draft or pending
   * attachment chips, because restoring the last turn would clear them. */
  function updateTurnDisabled() {
    const busy = mountIsBusy() || mountPendingReads() > 0 ||
      (mountLog ? hasPendingCard(mountLog) : false);
    const hasDraft = mountDraftNonEmpty() || mountHasPendingAttachments();
    if (regenBtn) regenBtn.disabled = busy;
    if (editBtn) {
      editBtn.disabled = busy || hasDraft;
      editBtn.title = hasDraft ? AI_EDIT_DRAFT_TITLE : AI_EDIT_TITLE;
    }
  }

  /* The footer button under the newest assistant reply. */
  function appendRegenerate(bubble) {
    if (!bubble) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-turn-control ai-regenerate";
    btn.dataset.testRegenerate = "1";
    btn.textContent = "↻ Regenerate";
    btn.title = "Re-run the model on your last question";
    btn.addEventListener("click", () => { regenerate(); });
    bubble.appendChild(btn);
    regenBtn = btn;
    updateTurnDisabled();
  }

  /* The "✎ Edit" control on the newest user bubble. It restores the prompt
   * and attachments into the composer; it never auto-sends. */
  function appendEditControl(log) {
    const users = log ? log.querySelectorAll(".ai-msg-user") : [];
    const lastUser = users[users.length - 1];
    if (!lastUser) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-turn-control ai-edit";
    btn.dataset.testEdit = "1";
    btn.textContent = AI_EDIT_LABEL;
    btn.title = AI_EDIT_TITLE;
    btn.addEventListener("click", () => { editLastMessage(); });
    lastUser.appendChild(btn);
    editBtn = btn;
    updateTurnDisabled();
  }

  /* Re-add both controls to whatever is now the newest turn. Edit trims
   * the tail, so the previous turn loses its controls; this restores them
   * on that turn (no-op when no genuine user turn remains). Existing
   * controls are removed first to keep the single-set invariant. */
  function restoreTurnControls(log) {
    if (!log) return;
    removeTurnControls(log);
    const users = log.querySelectorAll(".ai-msg-user");
    if (!users.length) return;         // no previous turn to control
    const asst = log.querySelectorAll(".ai-msg-assistant");
    appendRegenerate(asst[asst.length - 1]);
    appendEditControl(log);
  }

  async function send(log, userText, ui, files) {
    ui.begin();
    acpImageNoticeShown = false;
    /* ACP has no image input. Strip image entries before they can enter the
     * transcript (they would otherwise be re-uploaded every turn) and say
     * so; text attachments and the prompt are kept. */
    let sendFiles = files || [];
    if (activeServerIsAcp()) {
      const images = sendFiles.filter((f) => f.kind === "image");
      if (images.length) {
        sendFiles = sendFiles.filter((f) => f.kind !== "image");
        showAcpImageNotice(log, images.length);
      }
    }
    const userContent = composeUserContent(userText, sendFiles);
    /* Backstop: refuse a request whose serialized body would exceed the
     * wire cap, before it is sent and before the conversation changes. */
    const size = wireSizeOfTurn(userContent);
    if (size > AI_ATTACH_MAX_WIRE_BYTES) {
      showSendTooLarge(log, size);
      ui.end();
      return;
    }
    /* Capture the turn for Edit. These live in module state only -- never
     * on the conversation entry, which serializes into the wire body (an
     * image entry's data URL would otherwise be duplicated). */
    lastSentPrompt = userText;
    lastSentFiles = sendFiles.slice();
    const userBubble = appendMessage(log, "user", userText);
    if (sendFiles.length) appendUserFiles(userBubble, sendFiles);
    conversation.push({ role: "user", content: userContent });
    persistHistory();
    await runToolLoop(log, ui);
  }

  /* One assistant turn: request the model, stream the reply, execute any
   * tool calls, and feed the results back for the next round. It operates
   * on the current conversation, so send() and regenerate() share it. It
   * always ends by releasing the request controller (ui.end()) and
   * offering the Regenerate control on the final assistant bubble. */
  async function runToolLoop(log, ui) {
    removeTurnControls(log);
    let lastBubble = null;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      /* Re-check the wire cap before every round: a near-limit image turn
       * can exceed it once tool follow-ups are appended mid-turn. Refuse
       * and stop cleanly rather than send an oversize body. */
      const built = buildRequestMessages();
      if (built.strippedImages) showAcpImageNotice(log, built.strippedImages);
      const size = wireByteSize(JSON.stringify(
        { server: currentServer, messages: built.messages }));
      if (size > AI_ATTACH_MAX_WIRE_BYTES) {
        showSendTooLarge(log, size);
        break;
      }
      const bubble = appendMessage(log, "assistant", "");
      lastBubble = bubble;
      const state = { lastShape: "" };
      let text = "";
      let aborted = false;
      try {
        await NB.api.aiChat(
          { server: currentServer, messages: built.messages },
          (delta) => { text += delta; renderAssistantContent(bubble, text, state); },
          ui.signal(),
          (frame) => {
            /* ACP agents run their own tool loop inside one turn, which can
             * take minutes; a trace frame keeps the panel from looking
             * frozen. Insert above the still-growing answer bubble so the
             * traces read chronologically. Inert for OpenAI providers. */
            if (frame.acp === "trace" &&
                typeof frame.text === "string" && frame.text) {
              log.insertBefore(makeTrace(frame.text), bubble);
              scrollLog(log);
            }
          });
      } catch (e) {
        if (e && e.name === "AbortError") aborted = true;
        else {
          const errEl = document.createElement("div");
          errEl.className = "ai-error";
          errEl.textContent = "AI request failed: " + (e.message || e);
          bubble.appendChild(errEl);
          /* A provider HTTP rejection on an image-bearing turn is the
           * signal the model likely has no vision. The image parts stay
           * in the conversation, so a retry (or a model switch) still
           * carries them. */
          if (e.status >= 400 &&
              turnHasImages(conversation[lastUserTurnIndex()])) {
            const hintEl = document.createElement("div");
            hintEl.className = "ai-error";
            hintEl.textContent = "This model rejected the image(s). The " +
              "selected model may not support image input — switch to a " +
              "vision model and retry.";
            bubble.appendChild(hintEl);
          }
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
      persistHistory();

      if (!toolCalls.length) break;   // plain answer; the turn ends

      /* Execute every tool in order; reads run now, writes/patches ask. */
      let anyPending = false;         // a card is waiting for the user
      for (const t of toolCalls) {
        if (t.tool === "list" || t.tool === "read" ||
            t.tool === "fetch" || t.tool === "search") {
          const res = await runAutoTool(t, log);
          pushToolMessage({
            role: "user",
            content: "(tool " + t.tool + (t.path ? " " + t.path : "") + " result)\n" +
                     (res ? res.text : "unavailable"),
          });
        } else {
          const kind = runPendingTool(t, log);
          if (kind === "asked-permission") {
            anyPending = true;
            pushToolMessage({
              role: "user",
              content: "(tool " + t.tool + " " + t.path +
                " awaiting user approval; the user will apply or reject it)",
            });
          }
        }
      }
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
    appendRegenerate(lastBubble);
    appendEditControl(log);
  }

  /* Re-run the model on the latest genuine user turn, replacing the prior
   * assistant reply for that turn. The user turn (image parts included) is
   * re-sent unchanged, so a provider rejection can be retried after a
   * model switch or a config fix. */
  async function regenerate() {
    const log = mountLog;
    const ui = mountUi;
    if (!log || !ui) return;
    if (mountIsBusy() || mountPendingReads() > 0) return;
    if (hasPendingCard(log)) return;    // loop stopped for an Apply/Reject
    const idx = lastUserTurnIndex();
    if (idx < 0) return;                // no genuine user turn to re-run
    /* Trim the DOM: drop the whole tail after the last user bubble (the old
     * assistant reply, trace lines, errors, and turn controls). */
    clearLastTurnDom(log);
    removeTurnControls(log);
    conversation = conversation.slice(0, idx + 1);
    persistHistory();
    ui.begin();
    acpImageNoticeShown = false;
    await runToolLoop(log, ui);
  }

  /* Edit the latest genuine user turn: drop its DOM tail and conversation
   * entries, then restore the prompt + attachments into the composer for
   * resending. It never auto-sends -- the user edits and presses Send. */
  function editLastMessage() {
    const log = mountLog;
    if (!log) return;
    if (mountIsBusy() || mountPendingReads() > 0) return;
    if (hasPendingCard(log)) return;    // loop stopped for an Apply/Reject
    /* Mirror the button's disabled rule so a direct call cannot silently
     * discard the user's draft or pending attachments. */
    if (mountDraftNonEmpty() || mountHasPendingAttachments()) return;
    const idx = lastUserTurnIndex();
    if (idx < 0) return;                // no genuine user turn to edit
    clearLastTurnDom(log, true);        // drop the user bubble + its tail
    removeTurnControls(log);
    /* Trim BEFORE the user turn: the edited prompt is re-added by the next
     * send. */
    conversation = conversation.slice(0, idx);
    persistHistory();
    if (attachRestore) attachRestore(lastSentFiles);
    composerSetPrompt(lastSentPrompt);
    composerFocus();
    /* The previous turn now has no controls; restore them. Run after the
     * composer restore so the Edit control's disabled state sees the draft
     * and the restored attachment chips. */
    restoreTurnControls(log);
  }

  /* ------------------------------------------------------------------ *
   * Attachments (text files inlined; images downscaled into content parts)
   * ------------------------------------------------------------------ */

  /* The mounted panel installs these so the test hooks can reach the
   * pending attachment list, the add path, and the reset without a live
   * DOM query. */
  let attachAddFiles = null;
  let attachGetPending = () => [];
  let attachReset = () => {};
  /* Edit restore path, installed by the mount: repopulate the pending
   * attachment bar from the last turn's entries, and drive the composer
   * textarea. */
  let attachRestore = null;
  let composerSetPrompt = () => {};
  let composerFocus = () => {};

  function humanSize(bytes) {
    if (bytes < AI_ATTACH_KB) return bytes + " B";
    if (bytes < AI_ATTACH_MB) return (bytes / AI_ATTACH_KB).toFixed(1) + " KB";
    return (bytes / AI_ATTACH_MB).toFixed(1) + " MB";
  }

  /* Strip control characters/newlines and bound the length so a crafted
   * name can never break the marker line. */
  function sanitizeAttachName(name) {
    return String(name || "").replace(AI_ATTACH_CTRL_RE, "").trim()
      .slice(0, AI_ATTACH_NAME_MAX);
  }

  function fileExt(name) {
    const n = String(name || "").toLowerCase();
    const dot = n.lastIndexOf(".");
    return dot >= 0 ? n.slice(dot) : "";
  }

  /* A file passes the type gate when its MIME type is known-text, when it
   * has no type at all (the content check decides), or when its extension
   * is on the allowlist. */
  function isTextLike(file) {
    const type = String(file.type || "").toLowerCase();
    if (type.startsWith("text/") ||
        AI_ATTACH_TYPE_ALLOW.indexOf(type) >= 0 ||
        type.endsWith("+json") || type.endsWith("+xml")) {
      return true;
    }
    if (type === "") return true;
    return AI_ATTACH_EXT_ALLOW.indexOf(fileExt(file.name)) >= 0;
  }

  /* Image classification is best-effort: MIME first, then extension. The
   * decode step is the final gate, so a text file named ".png" passes here
   * and is later rejected as unreadable. */
  function isImageLike(file) {
    const type = String(file.type || "").toLowerCase();
    if (AI_ATTACH_IMAGE_TYPES.indexOf(type) >= 0) return true;
    return AI_ATTACH_IMAGE_EXTS.indexOf(fileExt(file.name)) >= 0;
  }

  function isBom(bytes, bom) {
    if (bytes.length < bom.length) return false;
    for (let i = 0; i < bom.length; i++) {
      if (bytes[i] !== bom[i]) return false;
    }
    return true;
  }

  /* Decode a file's bytes, honouring a BOM. Returns null when the text
   * contains a NUL, i.e. the content looks binary. */
  function decodeAttachment(bytes) {
    let decoder;
    let offset = 0;
    if (isBom(bytes, AI_ATTACH_BOM_UTF8)) {
      decoder = new TextDecoder("utf-8");
      offset = AI_ATTACH_BOM_UTF8.length;
    } else if (isBom(bytes, AI_ATTACH_BOM_UTF16LE)) {
      decoder = new TextDecoder("utf-16le");
      offset = AI_ATTACH_BOM_UTF16LE.length;
    } else if (isBom(bytes, AI_ATTACH_BOM_UTF16BE)) {
      decoder = new TextDecoder("utf-16be");
      offset = AI_ATTACH_BOM_UTF16BE.length;
    } else {
      decoder = new TextDecoder("utf-8");   // non-fatal
    }
    const text = decoder.decode(bytes.subarray(offset));
    return text.indexOf(AI_ATTACH_NUL) >= 0 ? null : text;
  }

  function readFileArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === "function") {
      return Promise.resolve(file.arrayBuffer());
    }
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error(AI_ATTACH_ERR_READ));
      fr.readAsArrayBuffer(file);
    });
  }

  async function readAttachment(file) {
    const buf = await readFileArrayBuffer(file);
    const text = decodeAttachment(new Uint8Array(buf));
    if (text === null) throw new Error(AI_ATTACH_ERR_BINARY);
    return text;
  }

  /* ---- image codec seam ------------------------------------------------
   * All image mechanics (sniff, decode, re-encode, base64) go through this
   * codec so tests can replace the canvas path with a stub. The policy
   * (caps, pass-through vs downscale, the second pass) stays in ai.js. */
  function sniffImageMime(bytes) {
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E &&
        bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A &&
        bytes[6] === 0x1A && bytes[7] === 0x0A) {
      return "image/png";
    }
    if (bytes.length >= 3 &&
        bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return "image/jpeg";
    }
    if (bytes.length >= 6 &&
        bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
      return "image/gif";
    }
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 &&
        bytes[11] === 0x50) {
      return "image/webp";
    }
    return null;
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function dataUrlByteSize(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return Math.floor(b64.length * 3 / 4) - pad;
  }

  function dataUrlMime(dataUrl) {
    const semi = dataUrl.indexOf(";");
    return dataUrl.slice(5, semi >= 0 ? semi : dataUrl.length);
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image decode failed"));
      };
      img.src = url;
    });
  }

  function decodeDrawable(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file).then((bmp) => ({
        source: bmp, width: bmp.width, height: bmp.height,
        release() { if (bmp.close) bmp.close(); },
      }));
    }
    if (typeof document !== "undefined" && typeof Image === "function") {
      return loadImageElement(file).then((img) => ({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        release() {},
      }));
    }
    return Promise.reject(new Error("image decode unavailable"));
  }

  function builtinImageCodec() {
    return {
      probe(file) {
        return readFileArrayBuffer(file).then((buf) => {
          const bytes = new Uint8Array(buf);
          const mime = sniffImageMime(bytes);
          if (!mime) return { width: 0, height: 0, mime: null };
          return decodeDrawable(file).then((d) => {
            const out = { width: d.width, height: d.height, mime };
            d.release();
            return out;
          });
        });
      },
      render(file, opts) {
        const maxEdge = (opts && opts.maxEdge) || AI_ATTACH_IMAGE_MAX_EDGE;
        return Promise.all([readFileArrayBuffer(file), decodeDrawable(file)])
          .then(([buf, d]) => {
            try {
              const mime = sniffImageMime(new Uint8Array(buf));
              const scale = Math.min(1, maxEdge / Math.max(d.width, d.height));
              const w = Math.max(1, Math.round(d.width * scale));
              const h = Math.max(1, Math.round(d.height * scale));
              const canvas = document.createElement("canvas");
              canvas.width = w;
              canvas.height = h;
              canvas.getContext("2d").drawImage(d.source, 0, 0, w, h);
              const outMime = mime === "image/jpeg" ? "image/jpeg"
                : mime === "image/webp" ? "image/webp" : "image/png";
              const quality = outMime === "image/png" ? undefined
                : ((opts && opts.quality) || AI_ATTACH_IMAGE_QUALITY);
              const dataUrl = canvas.toDataURL(outMime, quality);
              return {
                dataUrl,
                bytes: dataUrlByteSize(dataUrl),
                mime: dataUrlMime(dataUrl),
              };
            } finally {
              d.release();
            }
          });
      },
      passthrough(file) {
        return readFileArrayBuffer(file).then((buf) => {
          const bytes = new Uint8Array(buf);
          const mime = sniffImageMime(bytes);
          if (!mime) throw new Error(AI_ATTACH_ERR_READ);
          return {
            dataUrl: "data:" + mime + ";base64," + bytesToBase64(bytes),
            bytes: bytes.length,
            mime,
          };
        });
      },
    };
  }

  const builtinCodecInstance = builtinImageCodec();
  let imageCodecOverride = null;
  function activeImageCodec() {
    return imageCodecOverride || builtinCodecInstance;
  }

  /* Read one image and apply the size policy. Returns
   * {dataUrl, bytes, mime, width, height}. */
  async function readImageAttachment(file, name) {
    const codec = activeImageCodec();
    const probed = await codec.probe(file);
    if (!probed || !probed.mime) {
      throw new Error(name + " could not be read as an image");
    }
    if (probed.width * probed.height > AI_ATTACH_IMAGE_MAX_PIXELS) {
      throw new Error(name + " could not be read as an image");
    }
    const longest = Math.max(probed.width, probed.height);
    let encoded;
    if (file.size <= AI_ATTACH_IMAGE_TARGET_BYTES &&
        longest <= AI_ATTACH_IMAGE_MAX_EDGE) {
      encoded = await codec.passthrough(file);
    } else {
      encoded = await codec.render(file, { maxEdge: AI_ATTACH_IMAGE_MAX_EDGE });
      if (encoded.bytes > AI_ATTACH_IMAGE_TARGET_BYTES) {
        encoded = await codec.render(file, {
          maxEdge: AI_ATTACH_IMAGE_SECOND_EDGE,
          quality: AI_ATTACH_IMAGE_SECOND_QUALITY,
        });
      }
    }
    if (encoded.bytes > AI_ATTACH_IMAGE_MAX_BYTES) {
      throw new Error(name + " could not be reduced below " +
        (AI_ATTACH_IMAGE_MAX_BYTES / AI_ATTACH_MB) + " MiB");
    }
    return {
      dataUrl: encoded.dataUrl,
      bytes: encoded.bytes,
      mime: encoded.mime,
      width: probed.width,
      height: probed.height,
    };
  }

  /* Unique chip/marker name: a repeated name gets a " (n)" suffix. The
   * length cap is applied to the FINAL name, suffix included. */
  function uniqueName(base, used) {
    const core = sanitizeAttachName(base) || "file";
    if (!used.has(core)) return core;
    let n = 2;
    let suffix = " (" + n + ")";
    let name = core.slice(0, AI_ATTACH_NAME_MAX - suffix.length) + suffix;
    while (used.has(name)) {
      n++;
      suffix = " (" + n + ")";
      name = core.slice(0, AI_ATTACH_NAME_MAX - suffix.length) + suffix;
    }
    return name;
  }

  /* Human-readable read failure. The binary sentinel is expanded with the
   * file's display name so the error chip is never the bare word. */
  function attachErrorMessage(name, err) {
    if (err && err.message === AI_ATTACH_ERR_BINARY) {
      return name + " is binary (not a UTF-8 text file)";
    }
    return err && err.message ? err.message : AI_ATTACH_ERR_READ;
  }

  /* Build the text portion of the user turn: the prompt plus one inline
   * block per text attachment. Images are not text and are skipped. */
  function composeUserText(userText, files) {
    let out = userText;
    for (const f of files || []) {
      if (f.kind === "image") continue;
      const block = AI_ATTACH_MARK_OPEN + f.name + AI_ATTACH_MARK_SIZE +
        humanSize(f.size) + AI_ATTACH_MARK_OPEN_END + "\n" +
        f.content + "\n" +
        AI_ATTACH_MARK_CLOSE + f.name + AI_ATTACH_MARK_CLOSE_END;
      out += (out ? "\n\n" : "") + block;
    }
    return out;
  }

  /* The model receives a plain string when there are no images, and an
   * OpenAI content-part array (one text part, one image_url part per
   * image) when there are. */
  function composeUserContent(userText, files) {
    const text = composeUserText(userText, files);
    const images = (files || []).filter((f) => f.kind === "image");
    if (!images.length) return text;
    const parts = [];
    if (text) parts.push({ type: "text", text });
    for (const f of images) {
      parts.push({ type: "image_url", image_url: { url: f.dataUrl } });
    }
    return parts;
  }

  function appendUserFiles(bubble, files) {
    const row = document.createElement("div");
    row.className = "ai-user-files";
    for (const f of files) {
      if (f.kind === "image") {
        const img = document.createElement("img");
        img.className = "ai-user-thumb";
        img.src = f.dataUrl;
        img.alt = f.name;
        img.title = f.name;
        row.appendChild(img);
      } else {
        const chip = document.createElement("span");
        chip.className = "ai-user-file";
        chip.textContent = f.name;
        chip.title = f.size + " bytes";
        row.appendChild(chip);
      }
    }
    bubble.appendChild(row);
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
    const actions = document.createElement("div");
    actions.className = "panel-header-actions";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "ai-clear";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Clear the conversation (the model forgets context)";
    clearBtn.addEventListener("click", () => {
      if (ctl) ctl.abort();   // an in-flight reply must not land in the reset
      conversation = [];
      systemCache = null;
      log.innerHTML = "";
      clearAttachments();
      removeTurnControls(log);
      lastSentPrompt = "";
      lastSentFiles = [];
      clearStoredHistory();   // a true reset: the chat must not come back
    });
    actions.appendChild(clearBtn);
    if (NB.activity && NB.activity.makeCollapseBtn) {
      actions.appendChild(NB.activity.makeCollapseBtn());
    }
    header.appendChild(actions);
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
      syncAttachAffordance();
    });
    modelBar.appendChild(sel);
    host.appendChild(modelBar);

    const log = document.createElement("div");
    log.className = "ai-chat-log";
    log.id = "ai-chat-log";
    host.appendChild(log);

    const attachBar = document.createElement("div");
    attachBar.className = "ai-attach-bar";
    attachBar.hidden = true;
    host.appendChild(attachBar);

    const form = document.createElement("form");
    form.className = "ai-input-row";
    const attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.id = "ai-attach";
    attachBtn.className = "ai-attach";
    attachBtn.title = "Attach files";
    attachBtn.textContent = "📎";
    const attachInput = document.createElement("input");
    attachInput.type = "file";
    attachInput.multiple = true;
    attachInput.id = "ai-attach-input";
    attachInput.className = "ai-attach-input";
    attachInput.hidden = true;
    /* The attach control's image path: hidden from the OS picker while an
     * ACP provider is active (ACP agents take no images). Text files stay
     * attachable; paste/drop still bypass accept, so send() strips too. */
    function syncAttachAffordance() {
      if (activeServerIsAcp()) {
        attachInput.accept = AI_ATTACH_TEXT_ACCEPT;
        attachBtn.title = "Attach text files (ACP agents do not accept images)";
      } else {
        attachInput.removeAttribute("accept");
        attachBtn.title = "Attach files";
      }
    }
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
    form.append(ta, attachBtn, sendBtn, stopBtn);
    form.appendChild(attachInput);
    host.appendChild(form);

    /* Attachment state lives with the mounted panel. The slot count and
     * the per-file source cap are reserved when the reading chip appears;
     * a rejected file reserves nothing and a failed read releases its
     * slot. reservedTotal tracks TEXT bytes only (the total text cap);
     * images are bounded per-image and by the combined wire guard. */
    const attachments = [];       // fully-read pending entries
    const usedNames = new Set();  // chip names (pending + read)
    let chipTotal = 0;            // attachment chips (excludes errors)
    let imageCount = 0;           // pending + read image chips
    let pendingReads = 0;         // in-flight reads
    let reservedTotal = 0;        // text bytes held by pending + read chips
    let attachEpoch = 0;          // bumped on reset; stale reads don't count
    let ctl = null;

    function syncSend() {
      sendBtn.disabled = !!ctl || pendingReads > 0;
      attachBtn.disabled = !!ctl;
      /* Keep the newest turn's controls in step with the live state. */
      updateTurnDisabled();
    }

    function addAttachError(msg) {
      const el = document.createElement("div");
      el.className = "ai-attach-chip error ai-attach-err";
      el.setAttribute("role", "alert");
      el.textContent = msg;
      attachBar.appendChild(el);
      attachBar.hidden = false;
    }

    function removeChip(chip) {
      const textBytes = Number(chip.dataset.textBytes) || 0;
      reservedTotal = Math.max(0, reservedTotal - textBytes);
      if (chip.dataset.kind === "image") {
        imageCount = Math.max(0, imageCount - 1);
      }
      const name = chip.dataset.name;
      if (name) {
        usedNames.delete(name);
        const idx = attachments.findIndex(a => a.name === name);
        if (idx >= 0) attachments.splice(idx, 1);
      }
      chipTotal = Math.max(0, chipTotal - 1);
      chip.remove();
      if (!attachBar.querySelector(".ai-attach-chip")) attachBar.hidden = true;
      syncSend();
    }

    function makeChip(name, kind) {
      const chip = document.createElement("div");
      chip.className = "ai-attach-chip reading";
      if (kind === "image") {
        const thumb = document.createElement("img");
        thumb.className = "ai-attach-chip-thumb";
        thumb.alt = "";
        thumb.hidden = true;
        chip.appendChild(thumb);
      }
      const nameEl = document.createElement("span");
      nameEl.className = "ai-attach-chip-name";
      nameEl.textContent = name;
      const sizeEl = document.createElement("span");
      sizeEl.className = "ai-attach-chip-size";
      sizeEl.textContent = "reading…";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ai-attach-chip-remove";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "Remove " + name);
      rm.addEventListener("click", () => removeChip(chip));
      chip.append(nameEl, sizeEl, rm);
      return chip;
    }

    async function readOne(kind, file, name, chip) {
      const epoch = attachEpoch;
      pendingReads++;
      syncSend();
      try {
        let entry;
        if (kind === "image") {
          const img = await readImageAttachment(file, name);
          if (!chip.parentNode) return;   // removed while reading
          entry = {
            kind: "image", name, size: file.size, mime: img.mime,
            bytes: img.bytes, dataUrl: img.dataUrl,
            width: img.width, height: img.height,
          };
          const thumb = chip.querySelector(".ai-attach-chip-thumb");
          if (thumb) { thumb.src = img.dataUrl; thumb.hidden = false; }
        } else {
          const content = await readAttachment(file);
          if (!chip.parentNode) return;   // removed while reading
          entry = { kind: "text", name, size: file.size, content };
        }
        chip.classList.remove("reading");
        chip.querySelector(".ai-attach-chip-size").textContent = humanSize(file.size);
        attachments.push(entry);
      } catch (e) {
        if (!chip.parentNode) return;   // already removed; slot released
        removeChip(chip);
        addAttachError(attachErrorMessage(name, e));
      } finally {
        /* The decrement and the re-sync always travel together. A read
         * abandoned by a reset must not touch the fresh counter. */
        if (epoch === attachEpoch) pendingReads--;
        syncSend();
      }
    }

    function addFiles(fileList) {
      if (ctl) return;                  // gated with the picker + drop
      const files = fileList ? Array.from(fileList) : [];
      for (const file of files) {
        if (chipTotal >= AI_ATTACH_MAX_FILES) {
          addAttachError("too many files (max " + AI_ATTACH_MAX_FILES + ")");
          continue;
        }
        const kind = isImageLike(file) ? "image"
          : isTextLike(file) ? "text" : null;
        if (kind === "image") {
          if (file.size > AI_ATTACH_IMAGE_SOURCE_MAX_BYTES) {
            addAttachError((sanitizeAttachName(file.name) || "file") +
              " is larger than " +
              (AI_ATTACH_IMAGE_SOURCE_MAX_BYTES / AI_ATTACH_MB) +
              " MiB — downscale it first");
            continue;
          }
          if (imageCount >= AI_ATTACH_MAX_IMAGES) {
            addAttachError("too many images (max " + AI_ATTACH_MAX_IMAGES + ")");
            continue;
          }
        } else if (kind === "text") {
          if (file.size > AI_ATTACH_TEXT_MAX_BYTES) {
            addAttachError((sanitizeAttachName(file.name) || "file") +
              " is larger than " + (AI_ATTACH_TEXT_MAX_BYTES / AI_ATTACH_KB) +
              " KiB");
            continue;
          }
          if (reservedTotal + file.size > AI_ATTACH_TEXT_MAX_TOTAL) {
            addAttachError("attachment size limit reached (" +
              (AI_ATTACH_TEXT_MAX_TOTAL / AI_ATTACH_KB) + " KiB total)");
            continue;
          }
        } else {
          addAttachError("unsupported file type: " +
            (sanitizeAttachName(file.name) || "file"));
          continue;
        }
        const name = uniqueName(file.name, usedNames);
        usedNames.add(name);
        chipTotal++;
        if (kind === "text") reservedTotal += file.size;
        else imageCount++;
        const chip = makeChip(name, kind);
        chip.dataset.kind = kind;
        chip.dataset.name = name;
        chip.dataset.textBytes = kind === "text" ? String(file.size) : "0";
        attachBar.appendChild(chip);
        attachBar.hidden = false;
        readOne(kind, file, name, chip);
      }
      syncSend();
    }

    function clearAttachments() {
      attachments.length = 0;
      usedNames.clear();
      chipTotal = 0;
      imageCount = 0;
      reservedTotal = 0;
      pendingReads = 0;
      attachEpoch++;
      attachBar.innerHTML = "";
      attachBar.hidden = true;
      syncSend();
    }

    /* Edit restore path: repopulate the pending bar from the last turn's
     * already-read entries -- no re-read, no re-decode. Rebuilds the same
     * chips a fresh attach produces (name/size, image thumbnail, remove
     * button) and the same slot/byte reservations, so a restored turn
     * sends identically. */
    function restoreAttachments(entries) {
      clearAttachments();   // no reads in flight: the Edit guard refuses then
      for (const entry of entries || []) {
        const kind = entry.kind === "image" ? "image" : "text";
        const size = Number(entry.size) || 0;
        attachments.push(entry);
        usedNames.add(entry.name);
        chipTotal++;
        if (kind === "image") imageCount++;
        else reservedTotal += size;
        const chip = makeChip(entry.name, kind);
        chip.classList.remove("reading");
        chip.dataset.kind = kind;
        chip.dataset.name = entry.name;
        chip.dataset.textBytes = kind === "text" ? String(size) : "0";
        chip.querySelector(".ai-attach-chip-size").textContent = humanSize(size);
        if (kind === "image") {
          const thumb = chip.querySelector(".ai-attach-chip-thumb");
          if (thumb && entry.dataUrl) {
            thumb.src = entry.dataUrl;
            thumb.hidden = false;
          }
        }
        attachBar.appendChild(chip);
      }
      attachBar.hidden = chipTotal === 0;
      syncSend();
    }

    const ui = {
      begin() {
        ctl = new AbortController();
        stopBtn.hidden = false;
        syncSend();
      },
      end() {
        stopBtn.hidden = true;
        ctl = null;
        syncSend();
      },
      signal() { return ctl ? ctl.signal : undefined; },
    };
    /* Hand regenerate() and the footer control's disabled check the live
     * controller state and the mounted log. */
    mountLog = log;
    mountUi = ui;
    mountIsBusy = () => !!ctl;
    mountPendingReads = () => pendingReads;
    mountDraftNonEmpty = () => ta.value.trim().length > 0;
    mountHasPendingAttachments = () => chipTotal > 0;
    mountSyncAttachAffordance = syncAttachAffordance;
    syncAttachAffordance();
    sendBtn.dataset.testSend = "1";

    async function onSubmit(e) {
      e.preventDefault();
      if (ctl) return;                      // a request is already running
      if (pendingReads > 0) return;         // wait for the attachment reads
      const q = ta.value.trim();
      const files = attachments.slice();
      if (!q && !files.length) return;
      if (!currentServer) {
        const errEl = document.createElement("div");
        errEl.className = "ai-error";
        errEl.textContent = "No AI provider configured — open Settings → AI.";
        log.appendChild(errEl);
        scrollLog(log);
        return;
      }
      /* Checked before clearing so a refused send keeps the pending chips
       * (and the typed prompt) for the user to adjust. Size the request as
       * it will actually go out: ACP drops image parts (see send()). */
      const sendFiles = activeServerIsAcp()
        ? files.filter((f) => f.kind !== "image") : files;
      const wireSize = wireSizeOfTurn(composeUserContent(q, sendFiles));
      if (wireSize > AI_ATTACH_MAX_WIRE_BYTES) {
        showSendTooLarge(log, wireSize);
        return;
      }
      ta.value = "";
      clearAttachments();
      await send(log, q, ui, files);
    }
    form.addEventListener("submit", onSubmit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit(e);
      }
    });
    /* Typing or clearing the draft flips the Edit control's disabled
     * state (see updateTurnDisabled). */
    ta.addEventListener("input", () => { updateTurnDisabled(); });
    /* Clipboard files (a copied screenshot) take the same add path. Plain
     * text paste is left alone so the default insertion happens. */
    ta.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) {
        e.preventDefault();
        addFiles(items);
      }
    });
    stopBtn.addEventListener("click", () => {
      if (ctl) ctl.abort();
    });
    attachBtn.addEventListener("click", () => attachInput.click());
    attachInput.addEventListener("change", () => {
      addFiles(attachInput.files);
      attachInput.value = "";
    });

    host.addEventListener("dragover", (e) => {
      e.preventDefault();               // stay a valid drop target
      if (ctl) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      host.classList.add("ai-drop-active");
    });
    host.addEventListener("dragleave", (e) => {
      if (!e.relatedTarget || !host.contains(e.relatedTarget)) {
        host.classList.remove("ai-drop-active");
      }
    });
    host.addEventListener("drop", (e) => {
      e.preventDefault();
      host.classList.remove("ai-drop-active");
      if (!ctl && e.dataTransfer) addFiles(e.dataTransfer.files);
    });

    attachAddFiles = (list) => addFiles(list);
    attachGetPending = () => attachments.map(a => Object.assign({}, a));
    attachReset = clearAttachments;
    attachRestore = restoreAttachments;
    composerSetPrompt = (text) => { ta.value = text; };
    composerFocus = () => { ta.focus(); };

    // Restore any history saved before the reload now that the log and the
    // panel's references exist. It does not need the provider list.
    restoreHistory(log);

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
      // ACP profiles live in config/acp.json, not the ai.json server list, so
      // the backend exposes one under "acp" for the picker only. Only its
      // name and a type label reach the browser; command/args stay server-side.
      if (cfg && cfg.acp && cfg.acp.name) {
        servers = servers.concat([{
          name: cfg.acp.name,
          baseUrl: "",
          model: cfg.acp.model || "ACP",
          acp: true,
        }]);
      }
      currentServer = (cfg && cfg.default) ||
        (servers.length ? servers[0].name : "");
      // An ACP profile can nominate itself as the startup pick.
      if (cfg && cfg.acp && cfg.acp.default && cfg.acp.name) {
        currentServer = cfg.acp.name;
      }
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
      if (mountSyncAttachAffordance) mountSyncAttachAffordance();
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
    if (mountSyncAttachAffordance) mountSyncAttachAffordance();
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
    /* Re-run the model on the latest genuine user turn (the footer button
     * calls this). */
    regenerate,
    /* Restore the latest genuine user turn's prompt + attachments into the
     * composer for resending (the Edit control calls this). */
    editLastMessage,
    /* Test hooks (tests/dom/test_dom.js resets state between blocks). */
    _setServersForTests(list, deflt) {
      servers = list || [];
      currentServer = deflt || (servers.length ? servers[0].name : "");
      refreshServerBar();
    },
    _getCurrentServer: () => currentServer,
    _getConversationForTests: () => conversation.slice(),
    _addFilesForTests(list) { if (attachAddFiles) attachAddFiles(list); },
    _getAttachmentsForTests: () => attachGetPending(),
    /* Image codec seam: jsdom has no canvas, so tests inject a stub with
     * probe/render/passthrough. _resetImageCodec restores the browser one. */
    _setImageCodec(codec) { imageCodecOverride = codec || null; },
    _resetImageCodec() { imageCodecOverride = null; },
    _resetForTests() {
      conversation = [];
      systemCache = null;
      attachReset();
      if (mountLog) removeTurnControls(mountLog);
      regenBtn = null;
      editBtn = null;
      lastSentPrompt = "";
      lastSentFiles = [];
      clearStoredHistory();   // isolate test blocks
    },
    /* Erase in-memory state WITHOUT touching localStorage, so a test can
     * persist, drop memory, then restore from what was stored. */
    _resetMemoryForTests() {
      conversation = [];
      systemCache = null;
      attachReset();
      if (mountLog) {
        removeTurnControls(mountLog);
        mountLog.innerHTML = "";
      }
      regenBtn = null;
      editBtn = null;
      lastSentPrompt = "";
      lastSentFiles = [];
    },
    _restoreHistoryForTests(log) { restoreHistory(log); },
    _getStoredHistoryForTests() {
      try {
        const raw = localStorage.getItem(AI_HISTORY_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
  };
})();