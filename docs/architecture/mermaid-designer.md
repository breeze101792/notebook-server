# Mermaid visual editor — architecture and plan

Status: locked 2026-10-10, amended after architecture + UI review. Owner: `build`.

> Replaces an earlier draft that hand-built the canvas and parsers. The decision
> is to use a third-party library instead. `docs/requirements/features/mermaid-visual-editor.md`
> still describes the desired UX; where it assumes a custom canvas, this document
> wins. The acceptance criteria this plan defers are listed at the end.

## Goal

Open a draw.io-like visual editor from a rendered ```mermaid block, edit the
diagram, and write plain **Mermaid text** back into the note — the note keeps a
```mermaid fence. Mermaid text carries no coordinates, so the editor owns
structure and labels; layout stays Mermaid's job.

## Decision

**Use Visimer** — `@visimer/core` + `@visimer/dom` (MIT, v1.1.2).

| | Visimer | `@react-markdown-kit/mermaid` | Mermify |
| --- | --- | --- | --- |
| Importable library | Yes (headless core + DOM canvas) | Yes | No (self-host app) |
| Round-trips to Mermaid text | Yes | Yes | Yes |
| Diagram types | 23 (22 edit, 1 render) | 2 | 2 |
| Extra runtime | none (zero-dep core) | React + ReactDOM + Lexical | separate service |
| Renders through our mermaid | **Yes** (injected) | No (own renderer) | No |
| License / maturity | MIT, active | MIT npm / no repo license, 1★ | MIT, v0.3.0 |

**Rejected:** `@react-markdown-kit/mermaid`; Mermify; draw.io embed and
Excalidraw (one-way — cannot write Mermaid back).

**Entry point (v1):** the hybrid (WYSIWYG) right-click menu only. No preview
hover icon. Write-back stays on the pure DOM path — no server route, no
staleness logic, no event rename.

## Verification gate — PASSED (2026-10-10)

Run in `/tmp/opencode/visimer-gate` (outside the repo):

- **Detection:** all 23 diagram types detected; 22 `capability: "edit"`
  (flowchart, sequence, class, state, er, journey, gantt, pie, quadrant,
  requirement, gitgraph, c4, mindmap, timeline, sankey, xychart, block, packet,
  kanban, architecture, radar, treemap); `zenuml` is render-only.
- **Round-trip:** byte-identical for every fixture — flowchart (subgraph, `%%`
  comment, `classDef`), sequence, class, state, er, pie, gantt, timeline.
  `parse(code).code === code`.
- **Editor:** `new MermaidWysiwygEditor({code})` byte-identical on open;
  `dispatch({type:'addNode'})` inserts one line; undo/redo restore exactly.
- **Bundle:** esbuild → IIFE, **263,997 bytes** unminified, no React, exposes
  `Visimer.MermaidWysiwygEditor` + `Visimer.MermaidCanvasView`. Loads as a
  global and edits in Node.

**Gate gaps to close before/at build:** empty source (no fixture was empty),
and the view-mounted open→Apply no-op (Playwright #7 below is the mandatory
guard).

## Architecture

The note renderer does **not** change. `static/js/mermaid.js` stays the one
renderer for viewer, hybrid, export, and the blocks registry. The editor is a
modal that renders *through* our vendored mermaid.

```
static/js/mermaid.js              note renderer + designerMermaid() adapter
static/vendor/visimer.bundle.js   built at dev time, lazy-loaded, window.Visimer
static/vendor/visimer.css         library styles
static/js/mermaid-designer.js     NB.mermaidDesign: modal + apply
```

### New module: `static/js/mermaid-designer.js` (eager, `NB.mermaidDesign`)

Roughly 300 lines (compare `export.js`, 959). Do **not** register it with
`NB.blocks` — it is not a renderer, and registering would drag in the
ai.js/agent.md completeness requirements (`tests/dom/test_dom.js:3131-3142`).

- Owns `#designer-overlay`: **`class="settings-overlay"`** so the app's existing
  keyboard-modal guards already see it (F2), `hidden` toggle,
  `role="dialog" aria-modal="true"`, Esc, backdrop click.
- On open: capture `document.activeElement` for focus return; lazy-load the
  bundle; `new MermaidWysiwygEditor({code})` and
  `new MermaidCanvasView({editor, container, mermaid: NB.mermaid.designerMermaid(),
  mermaidConfig, ...})`; render.
- On Apply: see Write-back. On Cancel/Esc: `view.destroy()`, restore focus,
  write nothing.
- Availability: allowed when auth is off **or** role is admin (F4).
- Load/build failure and uneditable types: see Open-failure path (F6/F9).

### Hybrid hook

- `static/js/mermaid.js`: add an optional `design: "mermaidDesign"` flag to the
  `NB.blocks.register({...})` descriptor (`mermaid.js:310-323`).
- `static/js/blocks.js`: carry the optional flag through `pluginTypes()`
  (`blocks.js:182-190`) — one line.
- `static/js/hybrid.js`: in `buildMenu`, add "Design diagram…" **first**, then
  the existing "Edit <name> source", under the separator
  (`hybrid.js:5172-5183`). Shown only when the plugin has `design`,
  `NB[plugin.design]` exists, and the role allows it; hidden for a viewer;
  disabled for render-only types; absent for non-mermaid blocks.

### Write-back (hybrid DOM path) — fixed order

0. **No-op check:** if `editor.code === baselineSource`, close and write
   nothing (no parse, no history step).
1. **Validate:** `await window.mermaid.parse(editor.code)`; on failure keep the
   modal open, show the non-blocking `#designer-alert` banner, and write
   nothing (F5).
2. **Guard mode:** abort visibly if `!NB.hybrid.isActive()` (external edits can
   exit hybrid while the modal is open) (F3).
3. **Re-resolve the target** — a held element does not survive a re-render. At
   open, capture `{parent: container.parentNode, index: indexOf(parent.children,
   container), source: plugin.src(container)}`. At Apply, resolve
   `parent.children[index]` and require it to be `.mermaid-container` /
   `.mermaid-error` **whose source matches**; else abort via `NB.app.notify`
   (`app.js:669`, the `mermaid.js:207-208` pattern). Source-verify also guards
   against external changes (F1). Parent-relative indexing matches
   `captureCaret` (`hybrid.js:3804-3806`) and works inside lists/blockquotes.
4. `container.replaceWith(fence)` — a raw
   `<pre><code class="language-mermaid">` holding `editor.code` (same swap as
   `toRawBlock`, `hybrid.js:4994-5005`).
5. **`await NB.mermaid.renderAll(viewerContentEl)`** (F3). `renderAll` is async;
   awaiting prevents the debounced history snapshot (`HISTORY_COALESCE_MS` 400ms,
   `hybrid.js:3792,3824-3831`) from capturing the raw fence. `renderAll`
   re-renders only the new fence (`mermaid.js:237-245`) and `renderOne` sets
   `dataset.mermaidSource`, so `restoreForMarkdown` (`blocks.js:144-158`) and
   `isNoOpMarkdown` (`hybrid.js:4234`) keep working.
6. `NB.hybrid.onContentChange()` (`hybrid.js:5400`) — dirty, autosave, one undo
   step. `view.destroy()`; restore focus.

If the source is unchanged from open, write nothing (no-op) — the gate verified
byte-identity, so this is a belt-and-braces guard.

No server changes. No `ai.js` / `agent.md` changes.

### Injected-mermaid adapter (F7)

Naive forwarding to `window.mermaid` clobbers config: mermaid's `initialize`
deep-merges into live config, and `mermaid.js`'s `initializedFor` guard
(`mermaid.js:95-119`) would then skip re-init forever. Export the adapter from
`mermaid.js` so the invariants live once:

```js
// NB.mermaid.designerMermaid()
// - force startOnLoad:false, securityLevel:"strict", the app font stack,
//   and theme = currentTheme() (body[data-theme]) — the canvas and the note
//   can never disagree
// - mint ids `nb-designer-N` that never collide with `mermaid-svg-N`
// - on render failure, remove mermaid's stray `d<id>` node (mermaid.js:215)
```

Refactor: extract the config literal at `mermaid.js:110-117` into one shared
builder used by both `ensureInitialized` and `designerMermaid()`.

### Keyboard-modal integration (F2)

`#designer-overlay` MUST carry `class="settings-overlay"`. `modalIsOpen()` is a
hardcoded selector duplicated in `shortcuts.js:244-247`, `vimnav.js:48-51`,
`table-select.js:58-61`; without that class, Mod+Shift+E / Mod+E / Mod+S /
Ctrl+, fire under the modal and can tear down the hybrid session. Do not add a
fourth copy of `modalIsOpen`.

### Role gating (F4)

`NB.auth` exposes no role today (`auth.js:157-162`). `auth.js` already fetches
`/api/auth` at boot (`auth.js:138`) and discards it — store it and expose
`NB.auth.status()` + `NB.auth.isAdmin()` (`enabled && role === "admin"`).
Availability = auth off OR admin, matching `settings.js:551`. The menu is built
synchronously in `buildMenu`, so it reads this cache. A stale role mid-session
falls through to the existing 401/403 → `auth:required` flow and writes nothing.

### Open-failure path (F6/F9)

`codeBlockAt` matches `.mermaid-error` boxes too, so "Design diagram…" can open
on broken sources; `zenuml` is render-only; the bundle can fail to load. Wrap
construction in try/catch and, on throw / non-editable capability / load
failure, show an inline modal notice ("This diagram can't be edited visually —
edit the source instead") with one button that closes the modal and calls
`editPluginSource(hit)` (`hybrid.js:5007`). On load failure, `.catch` on
`NB.lazyload.script` and close with a toast; no polling.

### Edit UI: inspector, selection, add forms (v1)

The three scoped families (`flowchart`/`graph`, `sequenceDiagram`, `pie`) get a
three-region body: the existing build sidebar (236px), the canvas stage, and a
contextual inspector (296px). Every other editable family keeps the old
add-only sidebar and shows no inspector. The vendor `.mw-popover` is hidden
inside `#designer-canvas`; inline label editing stays as an accelerator.

**Selection model.** `mermaid-designer.js` subscribes to
`editor.on("selectionChange")`. The event carries `entityIds` (a `string[]`);
the module resolves the first id against `editor.result`:

| Family | Entity ids | Inspector |
| --- | --- | --- |
| flowchart | `node:<id>`, `edge:<src>-><tgt>#<n>` | Node, Edge |
| sequence | `participant:<id>`, `event:<lineIndex>` | Participant, Message, Note |
| pie | `slice:<lineIndex>` | Slice |

The inspector renders a fixed header (type, read-only id/meta, clear button)
and a scrolling body. It writes on `change` (blur/Enter) for text fields and on
`change` for selects, never on every keystroke, so the focused field is not
rewritten and the caret does not jump. A rejected dispatch (`null`) restores
the field from the model and shows an inline error. The rest state names the
selected element's available edits.

**Safe re-resolution rule.** A selection stores `{id, kind, entity}` plus an
identity signature (node id, edge id, participant id, message source/target,
note targets, or slice line + label). After every model change:

- A **structural** dispatch (add, delete, reorder, autonumber, participant add)
  clears the selection, unless the dispatch returned `created[0]`; that id is
  selected and the inspector re-resolves it. `seq.moveEvent` selects its
  `created` event id.
- A **label/value/style** edit keeps the selection and re-resolves it. If the
  id no longer exists, the selection clears.
- Renaming a participant with an alias keeps the id. Renaming one without an
  alias rewrites the id at every reference, so the module computes the new
  sanitized id and selects `participant:<newId>`; if it does not exist the
  selection clears. A stale id is never left in the inspector.
- On an **external** change (canvas inline edit, drag-connect, popover action)
  the module re-resolves the stored id and compares its identity signature. A
  line-index id that now refers to a different message/note/slice clears the
  selection instead of editing the wrong entity.
- Undo/redo clears the selection for sequence and pie, because their ids are
  line-index based. Flowchart undo re-resolves; reverse-edge clears because the
  edge id changes.

**Add forms.** The sidebar Add section is tabbed per family
(`node`/`edge`, `participant`/`message`/`note`, `slice`). Forms are real
`<form>`s; Enter submits. Add buttons disable until required fields are
present, and the reason appears in `#designer-add-note`. Draft text survives a
tab switch; a successful add clears text fields but keeps the chosen
shape/type/line/arrow defaults.

- Flowchart node: shape grid + label. Dispatch `addNode {shape,label}` (not
  `view.addNode`), then select `created[0]`.
- Flowchart edge: From/To selects, optional label, line, arrow. `connect` only
  accepts `arrowEnd`; when the chosen head also has a source head (double,
  cross/dot pairs), the module dispatches `setEdgeStyle` on the created edge
  with the exact `arrowStart`/`arrowEnd`.
- Sequence message/note: From/To or participant, text, arrow/placement, and a
  position select (`End of diagram`, `Start`, `After: <event>`). The module
  maps that to `afterEvent`: omit for End, `null` for Start, the event entity id
  for After. It reads the id at submit time and refuses a position whose event
  no longer exists.
- Pie slice: label + value. The value is validated as finite and ≥ 0 before
  dispatch; a negative or non-numeric value shows an inline error and never
  reaches `pie.addSlice`. The title stays deferred (quiet sidebar note, no
  control).
- Chart controls: flowchart direction chips dispatch `setDirection` and
  preserve the source token; the sequence autonumber switch dispatches
  `seq.toggleAutonumber` and reflects `result.sequence.autonumber.enabled`.

**Apply error vs open error.** Open-time load/render/parse failures keep the
full-canvas `#designer-error` state with Retry / Edit source. An **Apply
validation** failure keeps the modal open, does not replace the canvas, writes
nothing, and shows the non-blocking `#designer-alert` banner plus a footer
status. A live-preview render failure after an edit shows the same banner and
keeps the last good canvas; Apply still validates. Dismissing the banner leaves
the modal usable.

**Dirty close.** Only user-initiated closes (Cancel, Esc, backdrop, header ×)
run the guard: if `editor.code !== baselineSource`, a native `confirm()` asks to
discard. Apply success, no-op Apply, load error, retry, and the
`editSourceFallback` path close with `force` and never prompt.

**Compact layout.** At a viewport/container width of 960px or less the scoped
families switch to a horizontal build strip above the stage and the inspector
becomes a bottom sheet with a 44px grabber that names the current selection
(`Node · A`, or `Inspector` at rest). The grabber collapses/expands the sheet;
a selection auto-expands it. The footer stays outside the stage. The
implementation uses the permitted `@media (max-width: 960px)` fallback rather
than a container query; the old 720px rule is scoped to
`:not([data-designer-family])` so the two cannot fight. All four font scales
and both themes are px-spaced/rem-typed with scrolling panels rather than
horizontal overflow.

## Built artifact: `static/vendor/visimer.bundle.js`

Built at **dev time** with esbuild (already a devDependency); committed like
`codemirror.bundle.js` (`docs/operations/build.md:61-103`). No runtime build step.

Entry (`static/vendor/visimer.entry.js`):

```js
export * from "@visimer/core";
export * from "@visimer/dom";
```

Build (to be a `package.json` script and recorded in `docs/operations/build.md`):

```bash
node_modules/.bin/esbuild static/vendor/visimer.entry.js \
  --bundle --format=iife --global-name=Visimer --minify \
  --outfile=static/vendor/visimer.bundle.js
```

Add `@visimer/core` and `@visimer/dom` pinned exact to `devDependencies`
(`package-lock.json` records the tarball integrity). Add a `static/vendor/NOTICE`
with MIT attribution, version, and source URL (F10).

## UI design

`docs/architecture/design/mermaid-designer-ui.md` + reference mockup
`docs/architecture/design/mermaid-designer-mockup.html`.

- Shell reuses `.settings-overlay` / `.settings-modal`; `.designer-modal` sizes
  to 1320px × 85vh (`96vw`/`92vh` clamps) and carries a three-region body
  (236px build sidebar, flexible stage, 296px inspector) for the scoped
  families.
- Canvas states: loading / empty / error / preview-only (`readOnly:true`) /
  ready — mutually exclusive. Apply failures use the banner, not the error
  state.
- New tokens: `--designer-canvas-bg`, `--designer-grid`, `--designer-grid-size`,
  `--designer-modal-w`, `--designer-modal-h`, `--accent-fg`.
- Ctrl+Z is captured on the overlay and gated so it never reaches the note; the
  only note write is Apply.
- Trigger order: "Design diagram…" first, "Edit mermaid source" second.
- Prerequisite: the `NB.auth.status()` role change (F4).

## Files to touch

| File | Change |
| --- | --- |
| `static/vendor/visimer.bundle.js` | new — built IIFE (lazy) |
| `static/vendor/visimer.entry.js` | new — esbuild entry |
| `static/vendor/visimer.css` | new — library styles |
| `static/vendor/NOTICE` | new — MIT attribution + version + source |
| `static/js/mermaid-designer.js` | new, eager — modal + dispatch + apply |
| `static/js/mermaid.js` | `design` flag; `designerMermaid()` adapter; shared config builder |
| `static/js/blocks.js` | carry `design` through `pluginTypes()` |
| `static/js/hybrid.js` | context-menu item |
| `static/js/auth.js` | cache `/api/auth`; `NB.auth.status()` / `isAdmin()` |
| `templates/index.html` | script tag + CSS link + `#designer-overlay` (`class="settings-overlay"`) |
| `static/css/style.css` | `.designer-*` styles + tokens |
| `static/sw.js` | CACHE bump v6→v7; PRECACHE `mermaid-designer.js` + `visimer.css` (bundle stays lazy) |
| `package.json` | `@visimer/*` devDeps + build script |
| `docs/operations/build.md` | record the artifact + command |
| `tests/dom/test_dom.js` | fixture + `evalIn` + new test block; lazy-guard `heavyEager` + precache-exclusion for the bundle |
| `tests/browser/` | Playwright canvas round-trip |

## Verification strategy

jsdom (canvas stubbed), in `tests/dom/test_dom.js`:

1. "Design diagram…" appears only for a block whose plugin has `design`, only
   for admin (or auth-off); absent for viewer and for non-mermaid blocks.
2. `#designer-overlay` carries `settings-overlay`; global shortcuts inert while
   open.
3. Open → Apply with no edit issues no write and closes.
4. Apply with an edit: validate → re-resolve → replace → awaited re-render →
   `onContentChange`; `domToMarkdown` emits the new fence through the real
   `restoreForMarkdown`.
5. Cancel/Esc writes nothing; focus returns to the invoker.
6. Completeness/lazy guards: `mermaid-designer.js` in index.html + PRECACHE +
   `evalIn`; `visimer.bundle.js` excluded from eager + precache lists.

Playwright (`tests/browser/`), real bundle + real mermaid:

7. Add/rename/connect on the canvas → Apply → expected fence in the note file,
   untouched lines byte-identical; **open→Apply with no gesture is
   byte-identical** (mandatory — closes the view-mounted no-op gate gap).
8. Apply → **one Ctrl+Z restores the previous fence** (the headline "one undo
   step" claim; F8).
9. Ctrl+Z inside the modal does not touch the note; Esc closes only the modal.
10. Theme: the canvas follows `body[data-theme]` via `designerMermaid()`.

Backend: no change → no new backend tests.

## Phasing

- **P1 (MVP):** vendor bundle, `mermaid-designer.js`, hybrid menu hook,
  `NB.auth.status()`, `designerMermaid()`, DOM write-back, modal, role gating,
  jsdom + Playwright.
- **P2:** preview-mode entry (hover chip) + server read-modify-write with an
  mtime staleness guard; the modal Source mode from the requirements doc.
- **P3:** large-diagram ceiling/warning; richer per-type polish.

## Deferred acceptance criteria (explicit)

Relative to `docs/requirements/features/mermaid-visual-editor.md`:

- Source-mode flows (§4/§5) → P2.
- Preview hover-chip entry (E1) → P2.
- Large-diagram ceiling warning (#26) → P3.
- Richer `classDef`/`style` editing → P3 (the library preserves them verbatim).

## Risks and mitigations

| Risk | Handling |
| --- | --- |
| Visimer is new; API may shift | Pin exact `1.1.2`; all library calls in one module; NOTICE + lockfile integrity. MIT. |
| Injected-mermaid config clobber | `designerMermaid()` adapter from `mermaid.js` (F7); shared config builder. |
| Target re-rendered / multiple blocks | Capture parent+index+source; source-verify at Apply (F1). |
| ESM-only dependency | Dev-time esbuild IIFE; committed bundle. |
| Keyboard shortcuts under the modal | Overlay carries `settings-overlay` (F2). |
| Unsupported/opaque syntax | Verbatim preservation (gate-verified); non-editable types fall back to `editPluginSource` (F6). |
| Cold-offline bundle load | `.catch` → toast + close (F9). |

## Out of scope (v1)

Preview hover icon; server write route; `ai.js` / `agent.md` changes; freeform
shape drawing; position persistence beyond the library's model.
