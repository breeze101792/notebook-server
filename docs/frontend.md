# Frontend

## 1. Overview

The frontend is a single-page app with no build step at runtime. There is
no bundler, no transpiler, and no framework. `templates/index.html` loads
vendored libraries and app modules as plain `<script>` tags.

The one exception is CodeMirror. `static/vendor/codemirror.bundle.js` is
an esbuild IIFE built offline from `static/vendor/codemirror.entry.js`.
No script in the repository regenerates it; the esbuild invocation is
undocumented. For every other module, the served file is the source file.

Every app module is an IIFE that extends the shared `window.NB` namespace.
`templates/index.html` is 971 lines; the 29 modules live under `static/js/`.

### Script load order

`templates/index.html` loads scripts in three groups:

1. **Eager, non-`defer`** (`index.html:314-315`): `api.js` then `auth.js`,
   so the login prompt can appear before the heavy assets load.
2. **Deferred vendored libraries** (`index.html:935-938`): `marked.min.js`,
   `highlight.min.js`, `turndown.browser.js`,
   `turndown-plugin-gfm.browser.js`.
3. **Deferred app modules in dependency order** (`index.html:939-965`).

Deferred scripts run in document order after parsing, so the dependency
order is load-bearing: each module expects the ones before it to have
registered already.

```
cm-bridge → lightbox → blocks → mermaid → wavedrom → katex → viz →
htmlpreview → viewer → editbar → hybrid → table-edit → table-view →
watcher → outline → sidebar → search → graph → tabs → windows →
settings → export → vimnav → ai → activity → shortcuts → app
```

Renderer registration order (mermaid, wavedrom, katex, viz, htmlpreview)
equals script order equals render order. `blocks.js` loads before the
renderers, and every renderer before `viewer.js`.

## 2. Boot sequence

### `auth.js` — eager boot

`auth.js` runs at script parse time (`auth.js:164`). It calls
`GET /api/auth`. If auth is enabled and no role is present, it shows the
login modal and dims the UI with `body.auth-locked`. A successful login
calls `window.location.reload()` so every other module boots with a
known-good session. It wires the top-bar logout button.

`api.js` emits `NB.evt("auth:required")` on any 401 (`api.js:38`,
`api.js:110`) so a session that expires mid-use re-shows the modal.

### First-paint boot state

`boot_state()` (`app.py:737`) renders a sanitized config subset into the
HTML shell before any script runs, avoiding a visible reflow once the
async `GET /api/config` lands. The values become an inline style on
`<html>` (`index.html:2`) and classes on `<body>`/`#viewer-content`.

Only chrome values are embedded: theme, site title, font scale, pane
widths, collapse state, and wallpaper classes. Notebook content
(`recentFiles`, `openFiles`, `bookmarks`) is never embedded, because the
page is served before auth (`app.py:712-713`). When auth is on and no
session exists, only the theme is embedded and everything else falls back
to defaults (`app.py:818-825`). The embedded defaults must stay in sync
with `DEFAULTS` in `app.js:7-87`.

### `app.js` — the orchestrator

`app.js` registers a `DOMContentLoaded` listener (`app.js:652`). Its
`boot()` function (`app.js:595`) wires DOM handlers, applies the server
config over `DEFAULTS`, refreshes the sidebar tree, enables the vim keymap
if `cfg.vimMode` is set, restores open tabs filtered to existing files,
and opens any deep link before stripping it with `history.replaceState`
(`app.js:630-641`).

### Service worker

`index.html` registers `/static/sw.js` at the end of the body
(`index.html:966-970`).

## 3. Module inventory

All 29 modules, in script load order. Namespace and purpose are as
implemented today.

| File | Lines | Namespace | Purpose |
| --- | --- | --- | --- |
| `api.js` | 202 | `NB.api`, `NB.lazyload`, `NB.evt` | Fetch wrappers for every `/api` route (`credentials: same-origin`), on-demand vendor loader, tiny pub/sub. Emits `auth:required` on 401. |
| `auth.js` | 172 | `NB.auth` | Login modal. Boots immediately, dims the UI with `body.auth-locked`, reloads the page on login, wires logout. |
| `cm-bridge.js` | 421 | `NB.cmEditor` | Thin CodeMirror 6 wrapper. Lazy view creation, stable API, `setVimMode`, `compileVimrc`. |
| `lightbox.js` | 296 | `NB.lightbox` | Factory shared by mermaid/wavedrom/viz. Zoom/pan overlay, 0.25–5×, Esc and Ctrl+±. |
| `blocks.js` | 203 | `NB.blocks` | The one authoritative code-block renderer registry: `renderAll`, `restoreForMarkdown`, `pluginTypes`, `forLang`, `forElement`, `selectorFor`, `sourceOf`. |
| `mermaid.js` | 324 | `NB.mermaid` | ` ```mermaid ` renderer, `securityLevel: "strict"`. |
| `wavedrom.js` | 300 | `NB.wavedrom` | ` ```wavedrom ` renderer. Lenient JSON (unquoted keys). |
| `katex.js` | 153 | `NB.katex` | ` ```math ` / ` ```katex ` renderer (KaTeX display mode). |
| `viz.js` | 212 | `NB.viz` | ` ```dot ` / ` ```graphviz ` renderer via WASM `Viz.renderString`. |
| `htmlpreview.js` | 303 | `NB.htmlpreview` | ` ```html-live ` renderer into a sandboxed iframe `srcdoc` (`allow-scripts`, no `allow-same-origin`). |
| `viewer.js` | 1228 | `NB.viewer`, `NB.slugify` | Markdown render pipeline (marked + highlight.js), per-file content/edit cache, edit/view toggle, wikilink extension. |
| `editbar.js` | 401 | `NB.editbar` | Formatting toolbar in edit mode. Talks only to `NB.cmEditor`. Table insert/edit ops. |
| `hybrid.js` | 3330 | `NB.hybrid` | WYSIWYG ("hybrid") edit mode. The largest module. `contentEditable` viewer, Turndown round-trip back to Markdown, undo snapshots, table mutation API. |
| `table-edit.js` | 802 | `NB.tableEdit` | Hybrid-mode table drag handles overlaid outside the `contentEditable` subtree. Row/column reorder via Pointer Events. |
| `table-view.js` | 1099 | `NB.tableView` | Preview-only table controls: hide rows/columns, single-column sort. Persisted in `localStorage` under `nb:tableView` (schema v1). Tears down before hybrid edit. |
| `watcher.js` | 299 | `NB.watcher` | External-change detection. File System Observer API when granted, else a 5s conditional-GET poll of `/api/file?ifModifiedSince=`. Pauses when the tab is hidden. |
| `outline.js` | 167 | `NB.outline` | Right-side H1–H6 TOC minimap with scroll-spy and click-to-jump. |
| `sidebar.js` | 997 | `NB.sidebar` | File tree, bookmarks, and right-click menus (new, rename/move, copy, delete, Export…). |
| `search.js` | 339 | `NB.search` | Search UI. Server `<<…>>` snippets rewrapped as `<mark>` via `textContent`. |
| `graph.js` | 961 | `NB.graph` | Force-directed wikilink graph view on special tab `§graph`. Canvas physics, pan/zoom/filter, optional particles. |
| `tabs.js` | 586 | `NB.tabs` | Top-bar file tabs, drag-reorder, pinning, bulk close, special-tab registry. |
| `windows.js` | 179 | `NB.windows` | Makes each settings modal a draggable/resizable floating window. Geometry in `localStorage` under `nb:windowGeometry`. |
| `settings.js` | 1483 | `NB.settings` | Settings modal with six tabs: General, Appearance, Shortcuts, Security, AI, About. Draft-then-commit for live fields. |
| `export.js` | 926 | `NB.export` | Export modal. PDF via vendored Paged.js in a hidden same-origin iframe plus `window.print()`; HTML via `Blob`. Options: format, width (fit/80%/full), colors (light/dark), table of contents, scope (current file / section). Reachable from the file-tree, bookmark, and tab right-click menus. There is no top-bar Export button. |
| `vimnav.js` | 552 | `NB.vimnav` | Shell-level vim keymap. Sidebar, editor, and outline act as three windows; Ctrl+W cycles, j/k/gg/G navigate. Vim only — there is no Emacs mode. |
| `ai.js` | 1227 | `NB.ai` | Agentic assistant. SSE chat; six tools (`list`/`read`/`write`/`patch`/`fetch`/`search`) as ` ```nb-tool ` JSON blocks; legacy ` ```nb-edit ` cards; full in-memory transcript; `MAX_TOOL_ROUNDS = 5`. |
| `activity.js` | 524 | `NB.activity` | Left activity bar and side-panel view switcher. Registers four views: Explorer, Recent (fuzzy quick-open), Search, AI. |
| `shortcuts.js` | 392 | `NB.shortcuts` | Configurable non-vim keymap. Defaults include save `Mod+S`, openSearch `/`, tabPrev `Alt+H`, tabNext `Alt+L`, toggleEdit `Mod+E`, toggleHybrid `Mod+Shift+E`, windowCycle `Mod+W`, toggleTopbar `Mod+Shift+T`, openSettings `Mod+comma`. |
| `app.js` | 821 | `NB.app` | Bootstrap: `DEFAULTS` config schema, config load/merge, theme/font/wallpaper/topbar, pane resize/collapse, deep links, toast, debounced `persistConfig`. |

## 4. Code-block renderer pipeline

### The registry

`blocks.js` owns the one authoritative renderer list. Each renderer module
calls `NB.blocks.register(desc)` at load (`blocks.js:63`). Registration
order is script order, which is also render order.

A registered descriptor carries the module name, container class, fence
name, the language aliases, a selector, and the module's `renderAll`
function (`blocks.js:44-63`). The registry is the single source for three
consumers:

- `renderAll(container)` (`blocks.js:167`) runs every registered
  renderer's `renderAll` concurrently.
- `restoreForMarkdown(clone)` (`blocks.js:144`) replaces each rendered
  container or error box with its fenced source. This is the hybrid Save
  round-trip: it runs for every registered type, so a new renderer cannot
  be silently dropped by Turndown.
- `pluginTypes()` (`blocks.js:182`) derives the hybrid click-to-edit type
  table, replacing the hard-coded list hybrid.js used to carry.

### The five renderers

| Fence | Library | Notes |
| --- | --- | --- |
| ` ```mermaid ` | Mermaid 11.16 | `securityLevel: "strict"` disables interactive click/link directives. |
| ` ```wavedrom ` | WaveDrom 3.3 | Body is WaveDrom JSON; unquoted keys are allowed. |
| ` ```math ` / ` ```katex ` | KaTeX 0.16 | Display mode. Only KaTeX-supported commands. |
| ` ```dot ` / ` ```graphviz ` | Graphviz 2.40.1 / Viz.js 2.1.2 | Older Graphviz; avoid syntax newer than 2.40. |
| ` ```html-live ` | sandboxed iframe | `allow-scripts` without `allow-same-origin`. Opaque origin. |

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
(`ai.js:769-774`) and `/agent.md`. Tests assert the versions appear in
both, so changing a fence name, a vendored version, or a constraint means
updating both files in the same change.

## 5. Persistence

There is no IndexedDB and no `sessionStorage` anywhere in the frontend.

### `config/config.json` — server-persisted UI state

The server stores this file verbatim with no validation. The authoritative
schema is `DEFAULTS` in `app.js:7-87`:

| Key | Default | Notes |
| --- | --- | --- |
| `theme` | `"auto"` | `auto` / `light` / `dark` |
| `fontSize` | `"medium"` | `small` / `medium` / `large` / `xlarge` |
| `wallpaper` | `"none"` | `none` / `lines` / `grid` |
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
| `searchCaseSensitive` | `false` | |
| `graphParticles` | `false` | |
| `hideTopbar` | `false` | |
| `siteTitle` | `"Notebook"` | |
| `bookmarks` | `[]` | Ordered file paths |
| `vimrc` | `""` | VIM initial script, plain string |
| `settingsModalWidth` | `"medium"` | compact / medium / wide |
| `settingsModalHeight` | `"medium"` | compact / medium / wide |
| `vimMode` | `false` | |
| `autosave` | `true` | Hybrid mode only |
| `shortcuts` | `{}` | Per-action chord overrides; missing keys fall back to `shortcuts.js` defaults |

`app.js` writes this through a debounced `persistConfig()`
(`app.js:353`).

### `localStorage`

Two keys, both namespaced:

| Key | Owner | Contents |
| --- | --- | --- |
| `nb:windowGeometry` | `windows.js:20` | Per-modal position and size for the floating settings windows. |
| `nb:tableView` | `table-view.js:55` | Per-file, per-table view state, schema v1. Caps: `MAX_FILES = 50`, `MAX_TABLES = 20`, `MAX_BYTES = 100000`. |

`nb:tableView` data never reaches the note, the server, or an export.

### In-memory only

The AI transcript is in-memory only (`ai.js`) and is lost on reload. The
**Clear** button in the panel header resets it.

## 6. PWA and offline

`static/manifest.json` declares `display: "standalone"`, name
`"Notebook"`, `start_url` `/`, and three PNG icons (180, 192, 512).

`static/sw.js` uses cache version `notebook-v5` (`sw.js:16`) with three
strategies:

- **Pages and static assets**: network-first. A successful response is
  mirrored into the cache; the cache is used only when offline
  (`sw.js:106-118`). This trades a cheap LAN request per asset for
  always-fresh code.
- **`/api/*`**: network-only. Data is never cached. Offline returns an
  explicit 503 JSON error (`sw.js:92-101`).
- **Non-GET requests**: passed through untouched (`sw.js:82`).

`install` precaches the list and calls `skipWaiting`; `activate` deletes
every cache whose name differs from the current one (`sw.js:73-78`). The
precache list is 41 entries (`sw.js:23-65`): the shell, manifest, icons,
both stylesheets, the four vendored base libraries, and every app module.

The heavy renderer bundles (mermaid, graphviz, CodeMirror, KaTeX,
WaveDrom, Paged.js) are deliberately **not** precached. Precaching them
would add megabytes to the first load. They are fetched on first use and
mirror into the cache through the network-first handler, so offline works
once a note has used that renderer.

Change any precached asset and bump `CACHE` in `sw.js:16`. Bumping the
name makes every installed worker re-run install and activate, refreshing
the assets and deleting the old cache. Without the bump, a network-first
asset still updates, but the install-time copy stays stale.

## 7. UI surfaces

### Activity bar views

`NB.activity` registers four side-panel views (`activity.js:491-515`):

| View | What it shows |
| --- | --- |
| Explorer | File tree and bookmarks |
| Recent | Fuzzy quick-open over recent files |
| Search | Side-panel search input and results |
| AI | Assistant chat panel |

Mounts are lazy: a view's host stays empty until the first activation.

### Special tabs

Tabs whose id starts with `§` open a non-file view instead of a note
(`tabs.js:30-38`). Each registers through `NB.tabs.registerSpecial`.
Two exist:

- `§search` (`search.js:18`) — search results.
- `§graph` (`graph.js:36`) — the wikilink graph.

### Settings modal tabs

Six tabs (`index.html:339-344`): General, Appearance, Shortcuts, Security,
AI, About.

- Appearance and General are live. Editing a field mutates an in-memory
  draft; an Apply / Save / Cancel footer commits or reverts it.
- Security holds the admin/viewer passwords and the API tokens list, with
  its own per-section Save/Remove buttons and a page reload on success.
- AI edits provider profiles against `GET/POST /api/ai/config`. Editing an
  existing profile never re-sends its key; a blank `apiKey` with
  `replaceSecret: true` carries the stored key over server-side. The Web
  search field sets the SearXNG URL and has its own Save button.
- About shows version and project information.

### Hybrid mode

Hybrid mode makes `#viewer-content` `contentEditable` (`hybrid.js:5`).
Saving runs the Turndown round-trip: `restoreForMarkdown` swaps every
rendered block back to its fenced source so the diagram survives.
`table-view.js` tears down its view state at `hybrid:will-enter`, the
last synchronous moment before the snapshot.

### Table view and table edit

Table view adds hover/focus controls over a GFM table in preview: hide
rows, hide columns, single-column sort. Hiding is class-based; sorting
moves `<tr>` nodes. Table edit (`table-edit.js`) overlays drag handles
outside the `contentEditable` subtree for row/column reorder.

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

The registry-completeness test (`tests/dom/test_dom.js:3108-3124`)
enforces steps 3, 4, and 5.
