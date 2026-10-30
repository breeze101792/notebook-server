# Frontend architecture

## 1. Overview

The frontend is a single-page app with no build step at runtime. There is
no bundler, no transpiler, and no framework. `templates/index.html` loads
vendored libraries and app modules as plain `<script>` tags.

The one exception is CodeMirror. `static/vendor/codemirror.bundle.js` is
an esbuild IIFE built offline from `static/vendor/codemirror.entry.js`.
No script in the repository regenerates it; the esbuild invocation is
undocumented. For every other module, the served file is the source file.

Every app module is an IIFE that extends the shared `window.NB` namespace.
`templates/index.html` is 1502 lines; the 41 modules live under `static/js/`.
Siblings: [backend.md](backend.md) for the server side,
[markdown.md](markdown.md) for the render pipeline, and
[hybrid-editing.md](hybrid-editing.md) for the WYSIWYG write-back
contract. How to run the test suites is in
[`../testing/README.md`](../testing/README.md); the repo-level layout and
checklists are in [`../operations/development.md`](../operations/development.md).

### Script load order

`templates/index.html` loads scripts in three groups:

1. **Eager, non-`defer`**: `api.js`, `dialog.js`, then `auth.js`, so the
   login prompt can appear before the heavy assets load and the shared
   dialog helper exists before `auth.js` boots.
2. **Deferred vendored libraries**: `marked.min.js`, `highlight.min.js`,
   `turndown.browser.js`, `turndown-plugin-gfm.browser.js`.
3. **Deferred app modules in dependency order**, after the vendored
   libraries.

Deferred scripts run in document order after parsing, so the dependency
order is load-bearing: each module expects the ones before it to have
registered already.

```
cm-bridge → lightbox → blocks → menu → mermaid → wavedrom → katex → viz →
htmlpreview → svg → copy-image → viewer → editbar → hybrid → table-edit →
list-edit → table-view → table-select → watcher → outline → sidebar → graph →
tabs → windows → settings → export → mermaid-designer →
designer-shell → dot-designer → wavedrom-designer → vimnav → ai → activity →
bookmarks → shortcuts → mobile → app
```

Renderer registration order (mermaid, wavedrom, katex, viz, htmlpreview,
svg) equals script order equals render order. `blocks.js` loads before the
renderers, and every renderer before `viewer.js`.

## 2. Boot sequence

### `auth.js` — eager boot

`auth.js` runs at script parse time (comment at `auth.js:164`, the boot
call at `auth.js:171`). It calls `GET /api/auth`. If auth is enabled and
no role is present, it shows the login modal and dims the UI with
`body.auth-locked`. A successful login calls `window.location.reload()`
so every other module boots with a known-good session. It wires the
top-bar logout button.

`api.js` emits `NB.evt("auth:required")` on any 401 (`api.js:38`,
`api.js:110`) so a session that expires mid-use re-shows the modal.

### First-paint boot state

`boot_state()` (`app.py:742`) renders a sanitized config subset into the
HTML shell before any script runs, avoiding a visible reflow once the
async `GET /api/config` lands. The values become an inline style on
`<html>` (`index.html:2`), classes on `<body>`/`#viewer-content`, and the
`hidden` attribute on every `.side-panel-view` host except the active view.

Only chrome values are embedded: theme, site title, font scale, pane
widths, collapse state, the active side-panel view, and wallpaper classes.
Notebook content (`recentFiles`, `openFiles`, `bookmarks`) is never embedded,
because the page is served before auth (`app.py:711-713`). When auth is on
and no session exists, only the theme is embedded and everything else falls
back to defaults (`app.py:818-825`). The embedded defaults must stay in sync
with `DEFAULTS` in `app.js:7-87`. `_ACTIVE_VIEWS`
(`app.py:744`) must equal the views `activity.js` registers and the
`data-view` hosts in `index.html`; `tests/test_app.py` enforces the sync.

### `app.js` — the orchestrator

`app.js` registers a `DOMContentLoaded` listener (`app.js:652`). Its
`boot()` function (`app.js:644`) wires DOM handlers, applies the server
config over `DEFAULTS`, refreshes the sidebar tree, enables the vim keymap
if `cfg.vimMode` is set, restores open tabs filtered to existing files,
and opens any deep link before stripping it with `history.replaceState`
(`app.js:630-641`).

`boot()` does not paint the active side-panel view: the shell already
rendered it and `activity.js` adopts it at load (`adoptShellView`). Boot
reconciles only if a successful `GET /api/config` names a different view
and the user has not switched since (`resolveBootView`). On a failed fetch
it restores the shell-painted panel (`shellPanelState`) instead of
repainting `DEFAULTS`.

### Service worker

`index.html` registers `/sw.js` with scope `/` at the end of the body.
The worker must live at the root: a script served from `/static/sw.js` can
only control `/static/`, so it could never serve the app shell offline
(`app.py` serves `/sw.js` from `static/sw.js`).

## 3. Module inventory

All 41 modules, in script load order. Namespace and purpose are as
implemented today.

| File | Lines | Namespace | Purpose |
| --- | --- | --- | --- |
| `api.js` | 220 | `NB.api`, `NB.lazyload`, `NB.evt` | Fetch wrappers for every `/api` route (`credentials: same-origin`), on-demand vendor loader, tiny pub/sub. Emits `auth:required` on 401. |
| `dialog.js` | 122 | `NB.dialog` | Shared containment for the body-level modal overlays: `open()` makes every other direct body child inert, focuses the requested control (default: the dialog container), and wraps Tab/Shift+Tab so the container counts as both ends of the cycle. `close()` clears the inert flags and restores focus to the opener, then the caller's `fallbackFocus`. Each surface keeps its own Esc and backdrop handling. |
| `auth.js` | 221 | `NB.auth` | Login modal. Boots immediately, dims the UI with `body.auth-locked`, reloads the page on login, wires logout. |
| `cm-bridge.js` | 611 | `NB.cmEditor` | Thin CodeMirror 6 wrapper. Lazy view creation, stable API, `setVimMode`, `compileVimrc`. |
| `lightbox.js` | 296 | `NB.lightbox` | Factory shared by mermaid/wavedrom/viz. Zoom/pan overlay, 0.25–5×, Esc and Ctrl+±. |
| `blocks.js` | 331 | `NB.blocks` | The one authoritative code-block renderer registry: `renderAll`, `restoreForMarkdown`, `pluginTypes`, `forLang`, `forElement`, `selectorFor`, `sourceOf`. |
| `menu.js` | 211 | `NB.menu` | Shared right-click context-menu module. One singleton `#nb-menu` on `document.body`, descriptor-driven rendering, measured four-edge positioning, one close dispatcher (outside click, outside-scope right-click, Esc), and keyboard nav. Surfaces decide *when* a menu opens and *what* its items are; the module owns *how*. |
| `mermaid.js` | 388 | `NB.mermaid` | ` ```mermaid ` renderer, `securityLevel: "strict"`. |
| `wavedrom.js` | 306 | `NB.wavedrom` | ` ```wavedrom ` renderer. Lenient JSON (unquoted keys). |
| `katex.js` | 153 | `NB.katex` | ` ```math ` / ` ```katex ` renderer (KaTeX display mode). |
| `viz.js` | 228 | `NB.viz` | ` ```dot ` / ` ```graphviz ` renderer via WASM `Viz.renderString`. |
| `htmlpreview.js` | 303 | `NB.htmlpreview` | ` ```html-live ` renderer into a sandboxed iframe `srcdoc` (`allow-scripts`, no `allow-same-origin`). |
| `svg.js` | 160 | `NB.svg` | ` ```svg ` renderer. Parses the fence as SVG XML, strips script / `foreignObject` / `on*` / external refs, inlines the result, and opens it in the shared lightbox on click. |
| `copy-image.js` | 848 | `NB.copyButton` | One owner of the Copy affordances: source text for code/KaTeX, PNG rasterization for mermaid/wavedrom/graphviz/html-live, and the clipboard fallback. |
| `viewer.js` | 1537 | `NB.viewer`, `NB.slugify` | Markdown render pipeline (marked + highlight.js), per-file content/edit cache, edit/view toggle, wikilink extension, and the stashed-draft Recover/Discard bar. |
| `editbar.js` | 1073 | `NB.editbar` | Formatting toolbar in edit mode. Talks only to `NB.cmEditor`. Table insert/edit ops. |
| `hybrid.js` | 8028 | `NB.hybrid` | WYSIWYG ("hybrid") edit mode. The largest module. `contentEditable` viewer, Turndown round-trip back to Markdown, the in-place fence editor, undo snapshots, raw-HTML preservation, table mutation API, and draft stash/recover. See [hybrid-editing.md](hybrid-editing.md). |
| `table-edit.js` | 806 | `NB.tableEdit` | Hybrid-mode table drag handles overlaid outside the `contentEditable` subtree. Row/column reorder via Pointer Events. |
| `list-edit.js` | 647 | `NB.listEdit` | Hybrid-mode list-item drag handles and reorder overlay (Pointer Events, outside the contentEditable subtree). |
| `table-view.js` | 1242 | `NB.tableView` | Preview-only table controls: hide rows/columns, single-column sort. A title click toggles the sort; the per-header menu icon opens the column menu. Persisted in `localStorage` under `nb:tableView` (schema v2). An entry applies only when header, full-cell hash and same-header ordinal all match; otherwise it is ignored. Tears down before hybrid edit. |
| `table-select.js` | 433 | `NB.tableSelect` | Ctrl+drag (Cmd on macOS) over table cells paints a rectangle; Ctrl+C copies it as TSV (`text/plain`) plus an HTML `<table>` (`text/html`). One engine for preview and hybrid edit. The selection classes are transient chrome, stripped before serialization and undo snapshots. |
| `watcher.js` | 338 | `NB.watcher` | External-change detection. File System Observer API when granted, else a 5s poll that re-checks the tree via `/api/tree` (refresh on a JSON diff) and open files via `/api/file?ifModifiedSince=`. Pauses when the tab is hidden; a window `focus` event forces an immediate tree check. The first tick runs on a macrotask so `NB.sidebar` exists (deferred load order puts watcher.js before sidebar.js). |
| `outline.js` | 175 | `NB.outline` | Right-side H1–H6 TOC minimap with scroll-spy and click-to-jump. |
| `sidebar.js` | 1589 | `NB.sidebar` | File tree, bookmarks, and the item sets for the tree-row, folder, bookmark, and root menus (new, rename/move, copy, delete, Export…, copy path/link). Ctrl/Cmd+click toggles a row and Shift+click selects the visible range; a multi-selection moves together via the row menu's "Move N items to…" or a multi-item drag (the Pinned section has no multi-select). The Explorer header carries a ↻ button that re-fetches `/api/tree` on demand (bypassing the watcher's JSON-diff short-circuit) with a one-shot spin animation. |
| `graph.js` | 961 | `NB.graph` | Force-directed wikilink graph view on special tab `§graph`. Canvas physics, pan/zoom/filter, optional particles. |
| `tabs.js` | 934 | `NB.tabs` | Top-bar file tabs, drag-reorder, pinning, bulk close, special-tab registry. A dirty switch stashes the buffer instead of prompting. Owns the two-region split (`#tab-pinned` + `#tab-list`) and the width-freeze / release / ghost-close machinery (see [design/tab-equalization.md](design/tab-equalization.md) and [design/tab-close-animation.md](design/tab-close-animation.md)). |
| `windows.js` | 279 | `NB.windows` | Makes each settings modal a draggable/resizable floating window. Geometry in `localStorage` under `nb:windowGeometry`. |
| `settings.js` | 1728 | `NB.settings` | Settings modal with six tabs: General, Appearance, Shortcuts, Security, AI, About. Draft-then-commit for live fields. |
| `export.js` | 965 | `NB.export` | Export modal. PDF via vendored Paged.js in a hidden same-origin iframe plus `window.print()`; HTML via `Blob`. Options: format, width (fit/80%/full), colors (light/dark), table of contents, scope (current file / section). Reachable from the file-tree, bookmark, and tab right-click menus. There is no top-bar Export button. |
| `mermaid-designer.js` | 3870 | `NB.mermaidDesigner` | Visual Mermaid editor modal; lazy-loads Visimer and writes Mermaid back through the hybrid path. |
| `designer-shell.js` | 847 | `NB.designerShell` | Shared lifecycle for the Graphviz and WaveDrom design windows: overlay, dirty guard, target re-resolution, Apply order. Focus containment is delegated to `NB.dialog`. |
| `dot-designer.js` | 2184 | `NB.dotDesigner` | Graphviz design window over a line-local single-graph subset; untouched lines stay byte-identical. |
| `wavedrom-designer.js` | 1588 | `NB.wavedromDesigner` | WaveDrom design window; the parsed object is the model and Apply writes strict JSON. |
| `vimnav.js` | 564 | `NB.vimnav` | Shell-level vim keymap. Sidebar, editor, and outline act as three windows; Ctrl+W cycles, j/k/gg/G navigate. Vim only — there is no Emacs mode. |
| `ai.js` | 2687 | `NB.ai` | Agentic assistant. SSE chat; six tools (`list`/`read`/`write`/`patch`/`fetch`/`search`) as ` ```nb-tool ` JSON blocks; legacy ` ```nb-edit ` cards; a versioned transcript persisted in `localStorage["nb:aiChat"]`; `MAX_TOOL_ROUNDS = 5`. See [ai-assistant.md](ai-assistant.md). |
| `activity.js` | 610 | `NB.activity` | Left activity bar and side-panel view switcher. Registers six views: Explorer, Pinned, Bookmarks, Recent (fuzzy quick-open), Search, AI. `openSearch()` activates Search, expands the panel or phone drawer, and focuses the query. Boots into whichever `.side-panel-view` host the server rendered visible (`adoptShellView`). |
| `bookmarks.js` | 373 | `NB.bookmarks` | Bookmarks side-panel view: ordered list, star toggle, drag reorder, context menu, auto-prune, rename re-key. |
| `shortcuts.js` | 392 | `NB.shortcuts` | Configurable non-vim keymap. Defaults include save `Mod+S`, openSearch `/`, tabPrev `Alt+H`, tabNext `Alt+L`, toggleEdit `Mod+E`, toggleHybrid `Mod+Shift+E`, windowCycle `Mod+W`, toggleTopbar `Mod+Shift+T`, openSettings `Mod+comma`. |
| `mobile.js` | 1157 | `NB.mobile` | Phone shell: mode mirror, drawer, Home list, quick capture, mobile settings sheet. |
| `app.js` | 1090 | `NB.app` | Bootstrap: `DEFAULTS` config schema, config load/merge, theme/font/wallpaper/topbar, pane resize/collapse, deep links, toast, debounced `persistConfig`. |

## 4. Code-block renderer pipeline

### The registry

`blocks.js` owns the one authoritative renderer list. Each renderer module
calls `NB.blocks.register(desc)` at load (`register()` at `blocks.js:63`,
exported at `blocks.js:193`). Registration order is script order, which is
also render order.

A registered descriptor carries the module name, container class, fence
name, the language aliases, a selector, and the module's `renderAll`
function (fields documented at `blocks.js:44-63`). The registry
(`const registry` at `blocks.js:42`, exported at `blocks.js:192-202`) is
the single source for three consumers:

- `renderAll(container)` (`blocks.js:167`) runs every registered
  renderer's `renderAll` concurrently.
- `restoreForMarkdown(clone)` (`blocks.js:144`) replaces each rendered
  container or error box with its fenced source. This is the hybrid Save
  round-trip: it runs for every registered type, so a new renderer cannot
  be silently dropped by Turndown.
- `pluginTypes()` (`blocks.js:182`) derives the hybrid click-to-edit type
  table, replacing the hard-coded list hybrid.js used to carry.

### The six renderers

| Fence | Library | Notes |
| --- | --- | --- |
| ` ```mermaid ` | Mermaid 11.16 | `securityLevel: "strict"` disables interactive click/link directives. |
| ` ```wavedrom ` | WaveDrom 3.3 | Body is WaveDrom JSON; unquoted keys are allowed. |
| ` ```math ` / ` ```katex ` | KaTeX 0.16 | Display mode. Only KaTeX-supported commands. |
| ` ```dot ` / ` ```graphviz ` | Graphviz 2.40.1 / Viz.js 2.1.2 | Older Graphviz; avoid syntax newer than 2.40. |
| ` ```html-live ` | sandboxed iframe | `allow-scripts` without `allow-same-origin`. Opaque origin. |
| ` ```svg ` | none (native XML parser) | Parsed as SVG XML and sanitized: no `<script>`, `<foreignObject>`, `on*`, or external refs. |

Each renderer owns its own `renderOne` and lazy-load gate. The library
glue is genuinely different per renderer, so only the plumbing is shared
through the registry.

### The `html-live` sandbox

The iframe has an opaque origin. Scripts run, but cookies, `localStorage`,
`sessionStorage`, the parent DOM, `/api/*`, same-origin fetch, form
submission, `window.open`, file downloads, `alert`/`confirm`/`prompt`, and
top-level navigation are all blocked. External fetch is subject to CORS.

### The doc-sync rule

The fence languages, library versions, and constraints are documented for
two audiences that must stay in sync: the assistant's system prompt
(`ai.js:768-774`) and `/agent.md`. Tests assert the versions appear in
both, so changing a fence name, a vendored version, or a constraint means
updating both files in the same change. See
[markdown.md](markdown.md) for the full renderer contract.

## 5. Persistence

There is no IndexedDB and no `sessionStorage` anywhere in the frontend.

### `config/config.json` — server-persisted UI state

The server stores this file verbatim with no validation. The authoritative
schema is `DEFAULTS` in `app.js:7-87`:

| Key | Default | Notes |
| --- | --- | --- |
| `theme` | `"auto"` | `auto` / `light` / `dark` |
| `fontSize` | `"medium"` | `small` / `medium` / `large` / `xlarge` |
| `wallpaper` | `"none"` | none / lines / grid |
| `wallpaperColor` | `"neutral"` | neutral / blue / green / purple / amber |
| `wallpaperIntensity` | `"subtle"` | subtle / medium / bold |
| `wallpaperScroll` | `"scroll"` | scroll / fixed |
| `lastFile` | `null` | |
| `recentFiles` | `[]` | |
| `openFiles` | `[]` | |
| `activeFile` | `null` | |
| `pinnedFiles` | `[]` | |
| `sidebarWidth` | `240` | |
| `outlineWidth` | `220` | |
| `sidebarCollapsed` | `false` | |
| `outlineCollapsed` | `false` | |
| `activeView` | `"explorer"` | Active side-panel view (explorer / bookmarks / recent / search / ai) |
| `searchCaseSensitive` | `false` | Read by the side-panel Search view |
| `searchUnique` | `true` | Side-panel Search: one row per note (`unique=1`) |
| `searchSort` | `"path"` | Side-panel Search order: `path` / `mtime` / `count` |
| `graphParticles` | `false` | |
| `hideTopbar` | `false` | |
| `siteTitle` | `"Notebook"` | |
| `bookmarks` | `[]` | Ordered file paths |
| `vimrc` | `""` | VIM initial script, plain string |
| `settingsModalWidth` | `"medium"` | compact / medium / wide |
| `settingsModalHeight` | `"medium"` | compact / medium / wide |
| `vimMode` | `false` | |
| `autosave` | `true` | Hybrid mode only. When on, a tab switch saves silently; when off, a dirty switch stashes a recoverable draft. |
| `watchEnabled` | `true` | Starts the external-change watcher; `false` stops the polling fallback once config arrives. |
| `shortcuts` | `{}` | Per-action chord overrides; missing keys fall back to `shortcuts.js` defaults |

`app.js` writes this through a debounced `persistConfig()`
(`app.js:353`).

### `localStorage`

Five keys, all namespaced:

| Key | Owner | Contents |
| --- | --- | --- |
| `nb:windowGeometry` | `windows.js` | Per-modal position and size for the floating settings windows. |
| `nb:tableView` | `table-view.js` | Per-file, per-table view state, schema v2. An entry stores the header signature (`sig`), a hash of every cell (`bodySig`), and the table's ordinal among tables with the same header; it applies only when all three match, so a shifted table fails closed. Caps: `MAX_FILES = 50`, `MAX_TABLES = 20`, `MAX_BYTES = 100000`. |
| `nb:aiChat` | `ai.js` | Versioned AI transcript (conversation + tool flags + newest prompt). Over-size image data URLs are replaced by a placeholder; **Clear** removes the key. |
| `nb:mobileResume` | `mobile.js` | Last file and scroll position for the phone Home screen. |
| `nb:captureDraft` | `mobile.js` | Quick-capture draft, kept across a 401. |

`nb:tableView` data never reaches the note, the server, or an export.

### AI transcript

The AI transcript is not in-memory only: `persistHistory()` writes a
versioned `localStorage["nb:aiChat"]` blob after every mutation and
`restoreHistory()` rebuilds it on mount. The **Clear** button in the panel
header resets the conversation and removes the key.

## 6. PWA and offline

`static/manifest.json` declares `display: "standalone"`, name
`"Notebook"`, `start_url` `/`, and the icon set (192, 512, 1024, all opaque
PNG). The phone Home Screen icon is `/static/icons/apple-touch-icon-v2.png`
(180 px); the root `/apple-touch-icon.png` and
`/apple-touch-icon-precomposed.png` routes serve the same file because iOS
probes those paths. Without them the SPA catch-all answered with HTML and iOS
cached a broken icon.

`static/sw.js` uses cache version `notebook-v16` (`sw.js:29`) with three
strategies:

- **Pages and static assets**: network-first. A successful response is
  mirrored into the cache; the cache is used only when offline
  (`networkFirst`, `sw.js:106-118`). This trades a cheap LAN request per
  asset for always-fresh code.
- **`/api/*`**: network-only. Data is never cached. Offline returns an
  explicit 503 JSON error (`networkOnly`, `sw.js:92-101`).
- **Non-GET requests**: passed through untouched (`sw.js:82`).

`install` precaches the list and calls `skipWaiting`; `activate` deletes
every cache whose name differs from the current one. The precache list has
52 entries: the shell, manifest, icon set, both stylesheets, the four
vendored base libraries, and all 40 app modules.

The heavy renderer bundles (mermaid, graphviz, CodeMirror, KaTeX,
WaveDrom, Paged.js) are deliberately **not** precached. Precaching them
would add megabytes to the first load. They are fetched on first use and
mirror into the cache through the network-first handler, so offline works
once a note has used that renderer.

Change any precached asset and bump `CACHE` in `sw.js:29`. Bumping the
name makes every installed worker re-run install and activate, refreshing
the assets and deleting the old cache. Without the bump, a network-first
asset still updates, but the install-time copy stays stale.

## 7. UI surfaces

### Activity bar views

`NB.activity` registers four side-panel views (`activity.js:491-520`):

| View | What it shows |
| --- | --- |
| Explorer | File tree and bookmarks |
| Recent | Fuzzy quick-open over recent files |
| Search | Side-panel search input and results |
| AI | Assistant chat panel |

Mounts are lazy: a view's host stays empty until the first activation.

### Tab bar

`#tab-bar` holds three children in order (`index.html:128-142`):

| Child | Role |
| --- | --- |
| `#tab-pinned` (`.tab-pinned`) | Pinned tabs. A fixed region (`flex: 0 0 auto`), capped at half the bar and scrolling internally, so a long pinned set cannot squeeze the scroller out; hidden while nothing is pinned. Pinned tabs rest at their natural width (`.tab-pinned .tab { flex: 0 0 auto; max-width: none; }`, `style.css:470`). |
| `#tab-list` (`.tab-list`) | Unpinned tabs. The only part of the row that scrolls (`overflow-x: auto`). |
| `#outline-toggle` | The outline button, a fixed sibling at the right edge. |

`tabs.js` toggles the region's `hidden` attribute through
`syncPinnedRegion()` (`tabs.js:265-268`): `#tab-pinned` is hidden while
nothing is pinned and no pinned ghost is in flight. There is no separator
between the regions; the bar's own `2px` gap is the spacing.

`NB.tabs` owns the width-freeze / release / ghost-close machinery described
in [`design/tab-equalization.md`](design/tab-equalization.md) and
[`design/tab-close-animation.md`](design/tab-close-animation.md). Two points
matter for the bar's structure: `realTabs()` is **bar-scoped**
(`tabs.js:106-108`), so every width measurement spans both regions; and
the release class lives on `#tab-bar` (`.tab-bar.nb-tab-equalizing .tab`,
`style.css:1055`), not on the scroller, so it reaches a `.tab` in either
region.

Scroll ownership is also in `tabs.js`. `render()` reads `#tab-list`'s and
`#tab-pinned`'s `scrollLeft` before clearing their children and restores both
after `applyFrozenWidths()`, the last layout-mutating step. A rebuild caused
by a dirty marker, conflict badge, watcher tick, ghost close, pin, or reorder
therefore keeps the user's scroll position. `activate()` reveals the active
tab on every call, including re-activating the tab that is already active
(a sidebar click can land there after the strip was scrolled away): after
`render()` it clamps `#tab-list.scrollLeft` against the tab's and the strip's
`getBoundingClientRect()` edges, moving only far enough to show the tab in
full. It never calls `scrollIntoView()` (which would also move the window and
every scrollable ancestor). A pinned active tab and a hidden strip
(`clientWidth === 0`) are no-ops. The strip keeps its hidden scrollbar; there
is no fade or chevron affordance.

### Special tabs

Tabs whose id starts with `§` open a non-file view instead of a note
(`tabs.js:43-45`). Each registers through `NB.tabs.registerSpecial`
(`tabs.js:861-864`). One exists:

- `§graph` (`graph.js:36`) — the wikilink graph.

### Draft recovery on tab switch

`viewer.commitForTabSwitch()` does not prompt. With autosave off and a dirty
source or hybrid session, it stores `{content, mode}` on the file's cache
entry, leaves the tab marked dirty, and switches; the preview shows the
saved bytes. On return, `#draft-bar` offers **Recover** and **Discard**.
Source recovery loads the saved document first and applies the draft as one
CodeMirror transaction, so Ctrl+Z returns to saved (Ctrl+Shift+Z re-applies);
hybrid recovery enters on the saved baseline, swaps in the draft and records
an undo snapshot. Discard deletes the draft and reloads saved bytes. Autosave
on keeps the silent-save behavior, and closing a tab with a draft still warns.

### Settings modal tabs

Six tabs (`index.html:348-353`): General, Appearance, Shortcuts, Security,
AI, About.

- Appearance and General are live. Editing a field mutates an in-memory
  draft; an Apply / Save / Cancel footer commits or reverts it.
- Security holds the admin/viewer passwords and the API tokens list, with
  its own per-section Save/Remove buttons and a page reload on success.
- AI edits provider profiles against `GET/POST /api/ai/config`. Editing
  an existing profile never re-sends its key; a blank `apiKey` with
  `replaceSecret: true` carries the stored key over server-side. The Web
  search field sets the SearXNG URL and has its own Save button.
- About shows version and project information.

### Hybrid mode

Hybrid mode makes `#viewer-content` `contentEditable` (`enter()` at
`hybrid.js:3237` sets the attribute at `hybrid.js:3255`). Saving runs the
Turndown round-trip: `restoreForMarkdown` swaps every rendered block back
to its fenced source so the diagram survives. `table-view.js` tears down
its view state at `hybrid:will-enter`, the last synchronous moment before
the snapshot. The full contract is
[hybrid-editing.md](hybrid-editing.md).

### Table view and table edit

Table view adds hover/focus controls over a GFM table in preview: hide
rows, hide columns, single-column sort. Clicking a column title toggles
the sort (none/descending -> ascending, ascending -> descending); the one
icon at the right of the title opens the column menu (sort
ascending/descending, clear sort, hide column) and doubles as the sort
indicator (up/down glyph, accent-coloured). Hiding is class-based;
sorting moves `<tr>` nodes. Table edit (`table-edit.js`) overlays drag
handles outside the `contentEditable` subtree for row/column reorder.
Table select (`table-select.js`) adds rectangular cell selection in both
preview and hybrid edit: a platform modifier + drag over an eligible table
paints an inclusive rectangle, and Ctrl+C copies it as TSV plus an HTML
table. It never touches the note — the classes are gesture chrome and are
stripped before any save or undo snapshot.

### Bookmarks, wallpaper, floating modals

The sidebar keeps an ordered `bookmarks` array, reordered by drag-and-drop
and pruned silently on the next tree refresh. The Appearance tab sets the
wallpaper pattern, color, intensity, and scroll mode; the server paints
the resulting classes on first load through `boot_state()`. `windows.js`
makes each settings modal a draggable, resizable window whose geometry
persists per modal under `nb:windowGeometry`.

## 8. Adding a module or renderer

### Adding an app module

1. Create `static/js/<name>.js` as an IIFE extending `window.NB`.
2. Add the `<script defer>` tag in `index.html` at the correct dependency
   position.
3. Add the path to the `PRECACHE` list in `sw.js`.
4. If the module needs to boot on load, register its own
   `DOMContentLoaded` handler or listen for the relevant `NB.evt` event.

### Adding a code-block renderer

1. Create the renderer module.
2. Call `NB.blocks.register({ mod, containerClass, fence, langs,
   selector, renderAll })` at load.
3. Add the `<script defer>` tag after `blocks.js` and before `viewer.js`.
4. Add the path to `sw.js` `PRECACHE`.
5. Document the fence, library version, and constraints in **both**
   `ai.js`'s `systemPrompt()` and `agent.md`.
6. Bump the service-worker cache version.

The registry-completeness test (`tests/dom/test_dom.js:3111-3130`, inside
the `== blocks registry ==` block) enforces steps 3, 4, and 5.