# Product requirements — Notebook Server

## 1. What this product is

A small, self-hosted, single-user Markdown notebook. One person runs it on
their own machine and uses it to read, write, and organize their own plain
`.md` files. The server listens on the LAN by default (`0.0.0.0:5000`) so the
same notebook is reachable from another device on the network; it can also be
bound to loopback only.

- **User:** one owner. There is no account model and no per-user data.
- **Content:** a folder of ordinary Markdown files. The server stores note
  bodies as plain text and never renders Markdown itself.
- **Reach:** served over HTTP on the local network. Optional password gate.
- **Access model:** open by default. If the owner sets an admin password, every
  read and write requires a login. A second, optional viewer password adds a
  read-only identity; it is a login option, not a separate read switch.

The backend is one Flask file (`app.py`) serving a JSON API and one HTML page.
The frontend is a vanilla-JS single-page app that renders Markdown in the
browser. There is no database and no runtime build step.

See [backend](../architecture/backend.md), [frontend](../architecture/frontend.md),
and [configuration](../contracts/configuration.md) for the implementation.

## 2. Product goals and non-goals

**Goals**

- Keep the owner's notes as readable, hand-editable Markdown files on disk.
- Make reading and editing those notes fast in a browser, including on the LAN.
- Render diagrams, math, timing charts, and live HTML inline in a note.
- Let the owner edit without thinking in Markdown, while the saved file stays
  clean Markdown.
- Allow optional AI help that proposes changes the owner reviews before they
  are written.
- Keep setup small: run a script, open a browser, write notes.

**Non-goals**

- Multi-user collaboration, shared editing, or permissions beyond
  admin/viewer.
- A database or any server-side index of note content.
- A runtime build step (the one exception is an offline-built CodeMirror
  bundle; see [frontend](../architecture/frontend.md)).
- Cloud sync or hosted storage. Files live in a local folder the owner controls.

## 3. Feature scope

The shipped surface, summarized. Each item is implemented today; see the
linked documents for detail.

**Files and navigation**

- File tree with folders and an ordered bookmark list, both driven by
  right-click context menus: open, new file/folder, rename/move, copy, delete,
  Export… (per-file [sidebar](../architecture/frontend.md)).
- Recent view with fuzzy quick-open.
- Deep links to a file and a heading (`?file=…&heading=…`).
- Multi-tab editor with drag-reorder, pinning, and a per-file content cache so
  unsaved edits survive tab switches.

**Rendering**

- Markdown via vendored `marked.js` (GFM mode) with `highlight.js` syntax
  highlighting.
- Five special fenced renderers, registered through the `NB.blocks` registry:
  Mermaid 11.16 (`securityLevel: strict`), WaveDrom 3.3, KaTeX 0.16
  (`math` / `katex`), Graphviz 2.40.1 / Viz.js 2.1.2 (`dot` / `graphviz`), and a
  sandboxed `html-live` iframe. Details and versions in
  [markdown](../architecture/markdown.md).
- Obsidian-style `[[wikilinks]]` between notes and a force-directed wikilink
  graph view.

**Editing**

- Source editor: CodeMirror 6, with an optional Vim keybinding mode and a
  configurable non-Vim keymap.
- WYSIWYG "hybrid" mode: `contentEditable` on the rendered note, converted back
  to Markdown on save. See [hybrid editing](../architecture/hybrid-editing.md).
- Preview-only table controls: hide rows/columns and sort one column without
  touching the note source.
- Heading outline (right-side minimap) with scroll-spy and click-to-jump.
- In-page search across all `.md` files, with `<<…>>` snippet markers rewrapped
  as `<mark>` via `textContent`.
- External-change detection: File System Observer where available, else a
  5-second conditional-GET poll.

**Presentation**

- Theme selector (auto / light / dark), font-size scale, wallpaper pattern /
  color / intensity / scroll, and a code-highlight stylesheet that follows the
  body theme.

**App shell**

- Installable PWA with a service worker that caches the app shell. `/api/*` is
  never cached. See [frontend](../architecture/frontend.md).

**Access**

- Optional two-password gate (admin + viewer), bcrypt cost 12, per-IP login
  rate limit. Named bearer tokens (`nbtk_…`) let agents and scripts
  authenticate without the cookie login. See
  [configuration](../contracts/configuration.md).

**Optional AI assistant**

- OpenAI-compatible provider profiles; the browser talks only to this server,
  which relays to the provider and never echoes the stored API key back to the
  browser. All `/api/ai/*` routes are admin-gated only while auth is on.
- Six tools: `list`, `read`, `fetch`, `search` run automatically; `write` and
  `patch` require Apply. See [AI assistant](../architecture/ai-assistant.md).

**Export**

- Current note or one section to PDF (Paged.js, browser print) or a
  self-contained HTML file (Blob download), rendered through the same pipeline
  as the viewer so output matches the screen.

The full route list is in the [HTTP API reference](../contracts/http-api.md).

## 4. Functional flows

### 4.1 First run

1. The owner runs `./start.sh`. It creates a per-host virtualenv, installs
   `requirements.txt` when changed, then runs `app.py`.
2. At import, the server resolves the notes folder and config folder, and
   creates `config/config.json` if missing.
3. If the notes folder is missing, the server copies `notebook.template/`
   (starter notes `Welcome.md`, `README.md`, `Syntax.md`) into `notebook/`.
   The template is copied, not symlinked, so editing notes never changes it.
4. A legacy `data/` folder is migrated to `notebook/` once, only when the notes
   folder is the project default.
5. The server prints the notes folder, the config folder, and one URL per
   reachable address. The owner opens the URL.

### 4.2 Opening, editing, and saving a note

1. The owner opens a note from the tree, a wikilink, a tab, or a deep link.
2. The viewer renders it client-side (marked + highlight.js + the five
   renderers).
3. The owner edits in the source editor or in hybrid mode.
4. Saving posts the file content; the server resolves the path through
   `safe_path()` and writes atomically (temp file + `os.replace`).
5. If another app changed the file on disk, external-change detection prompts
   the owner rather than silently overwriting.

### 4.3 Hybrid edit and save round-trip

1. Entering hybrid mode makes the rendered note `contentEditable` and captures
   a baseline of the source and the serialized DOM.
2. The owner edits the rendered view directly.
3. On save, the DOM is converted back to Markdown with Turndown plus the GFM
   plugin. Before conversion, `NB.blocks.restoreForMarkdown` replaces every
   rendered special block (and every error box) with its original fenced
   source, so diagrams and math survive.
4. A structural edit (Enter, Backspace/Delete merge, list outdent, paste)
   splices only the changed region; untouched blocks keep their original bytes.
5. If the serialized result equals the baseline, the save is a no-op and
   nothing is written.

### 4.4 Enabling auth

1. Open Settings → Security → Passwords.
2. Set the admin password (minimum 6 characters). This gates all reads and
   writes on the next page load.
3. Optionally set a viewer password as a second, read-only login identity.
4. To turn auth off, enter the current admin password and submit an empty new
   one; this clears the admin hash, the viewer hash, and all tokens.
5. Named API tokens are issued from the same tab: the full `nbtk_…` string is
   shown once, and only a bcrypt hash is stored.

### 4.5 Using the AI assistant

1. The owner configures a provider profile in Settings → AI (name, base URL,
   model, API key) and marks one as the default.
2. In the ✨ panel, the owner sends a message. The full conversation is
   re-uploaded each turn, so follow-ups keep context.
3. The assistant may emit ` ```nb-tool ` JSON blocks. `list`, `read`, `fetch`,
   and `search` run immediately and their results are fed back.
4. `write` (create a new note) and `patch` (edit an existing note) always
   surface as Apply/Reject cards. Nothing is written until the owner clicks
   Apply.
5. Applying a patch calls `/api/edit`; the server re-verifies every anchor
   against the current file. Applying a write calls `/api/create`.

## 5. Edge cases and documented constraints

- **A single newline does not start a paragraph.** The renderer runs with GFM
  `breaks: false`; the owner uses a blank line between paragraphs.
- **No emoji shortcodes.** `:smile:` stays literal text; emoji are typed as
  unicode or HTML entities.
- **Hybrid write-back preserves markers.** Empty headings and empty list items
  keep their markers on save; a whitespace-only inline code run is carried
  through a clone with NUL-prefixed sentinels and restored.
- **Tables always emit as GFM.** `normalizeTablesForGfm` rebuilds every table
  into the shape Turndown's GFM rule accepts; a raw `<table>` is never written
  as HTML.
- **A no-op hybrid save writes nothing.** `isNoOpMarkdown` compares the
  serialized DOM against the baseline captured at `enter()` and skips the write
  in every save caller.
- **One `Enter` adds one line break** in hybrid mode. No idle action adds a
  break, and no `<br>` reaches the file.
- **Structural edits preserve untouched blocks.** Only the changed region is
  re-serialized; the rest keeps its original bytes.
- **Patch anchors are re-verified server-side and fail closed.** `/api/edit`
  applies an ordered batch against the current file; a stale or ambiguous
  anchor returns HTTP 400 and rejects the whole batch untouched.
- **Writes are blocked on existing paths.** The assistant's `write` cannot
  overwrite; the owner or model must use `patch` instead.
- **Markdown is rendered un-sanitized.** Notes are the owner's own files. If
  untrusted content is ever introduced, a vendored DOMPurify pass is required
  before `innerHTML`.
- **`html-live` is the one sandboxed exception.** It runs in an iframe with
  `allow-scripts` and without `allow-same-origin`: an opaque origin with no
  access to cookies, storage, the parent DOM, or `/api/*`.
- **Writes are atomic but not power-loss durable.** The temp-file rename is
  atomic under concurrent writers; there is no `fsync`.
- **Search caps.** Default 200 total matches / 20 per file, raisable per
  request up to hard ceilings (2000 / 200).
- **Named limits are not hard-coded in this spec.** Concrete values live with
  their source (`AI_FETCH_MAX_BYTES` 512 KiB / 15 s, `AI_SEARXNG_MAX_RESULTS`
  10, `MAX_TOOL_ROUNDS` 5, service-worker cache version `notebook-v6`).

## 6. Acceptance criteria

The product is done when, on a machine that has only the repository and Python
installed:

1. `./start.sh` creates the virtualenv, installs dependencies, and serves the
   app without a manual database or build step.
2. A fresh install has `notebook/` seeded from `notebook.template/` and an
   existing `config/config.json`; the project's real notes are not touched.
3. Opening a note renders Markdown, syntax-highlighted code, wikilinks, and
   each of the five special fences (Mermaid, WaveDrom, KaTeX, Graphviz,
   `html-live`).
4. Saving an edited note writes valid Markdown that re-opens and renders
   identically.
5. Entering hybrid mode and saving without editing issues no write.
6. A hybrid save preserves empty headings, empty list items, whitespace-only
   inline code, diagrams, and tables as documented.
7. A patch whose anchor no longer matches fails with HTTP 400 and does not
   modify the file.
8. Setting the admin password makes every read and write require a login; a
   valid bearer token works in place of a session cookie; clearing the admin
   password disables auth.
9. The AI assistant runs `list`/`read`/`fetch`/`search` automatically and
   writes nothing until the owner clicks Apply on a `write` or `patch` card.
10. Export produces a PDF or self-contained HTML that matches the on-screen
    rendering, including diagrams and highlighted code.
11. Both documented test suites pass: `.venv_$(hostname)/bin/python -m unittest
    discover -s tests -v` and `node tests/dom/test_dom.js`.

## 7. Maintenance and end of life

This is a self-hosted personal tool. There is no update mechanism: the owner
updates by pulling the repository and restarting the server. Notes are plain
`.md` files on disk and remain fully usable in any text editor or other
Markdown tool without the server, so there is no data lock-in and no migration
step on disposal. End of life is deleting the project folder; notes in
`notebook/` can be kept or removed independently. The only stored secrets are
bcrypt hashes and a session-signing key in `config/auth.json`; deleting that
file disables auth.

## Related documents

- [Backend architecture](../architecture/backend.md)
- [Frontend architecture](../architecture/frontend.md)
- [Markdown rendering](../architecture/markdown.md)
- [Hybrid editing behavior](../architecture/hybrid-editing.md)
- [AI assistant](../architecture/ai-assistant.md)
- [HTTP API reference](../contracts/http-api.md)
- [Configuration](../contracts/configuration.md)
