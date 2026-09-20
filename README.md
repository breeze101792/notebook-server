# Notebook Server

A small, single-user Markdown notebook server. A Flask backend with a JSON
API, and a vanilla-JS frontend that renders Markdown client-side. Notebooks
are plain `.md` files on disk — no database, no build step.

> **Documentation.** [`docs/`](docs/README.md) holds the deep guides:
> [architecture](docs/architecture.md), [frontend](docs/frontend.md),
> [API reference](docs/api.md), [configuration](docs/configuration.md),
> [Markdown rendering](docs/markdown.md), the
> [AI assistant](docs/ai-assistant.md), and
> [development](docs/development.md).

## Features

- File tree with folders, bookmarks, and right-click context menus (open,
  new file/folder, rename/move, copy, delete, Export…).
- Markdown rendering with syntax highlighting (vendored `marked.js` +
  `highlight.js`) and five special fenced-block renderers: Mermaid,
  WaveDrom, KaTeX, Graphviz, and sandboxed live HTML.
- Obsidian-style `[[wikilinks]]` between notes, plus a force-directed
  wikilink graph view.
- Multi-tab editor (CodeMirror 6) with a per-file content cache so unsaved
  edits survive tab switches, an optional Vim keybinding mode, and a
  WYSIWYG "hybrid" edit mode that round-trips rendered DOM back to Markdown.
- Preview table controls: hide rows/columns and sort a column without
  touching the note's source.
- Heading outline (right-side minimap) with scroll-spy and click-to-jump.
- In-page search across all `.md` files with safe snippet highlighting
  (the server returns `<<…>>` markers; the client rewraps them as `<mark>`
  via `textContent`, never `innerHTML`).
- External-change detection: a File System Observer where available, else a
  5-second conditional-GET poll, so edits made in another app show up.
- Drag-resizable sidebar / outline, collapsible panels, theme selector,
  font-size scale, wallpaper patterns, and a per-theme code-block highlight
  stylesheet.
- Installable as a PWA with a service worker that caches the app shell.
- Optional two-password gate (admin + viewer) with bcrypt-hashed
  credentials stored in `config/auth.json`, plus named bearer tokens for
  agents and scripts.
- Optional AI assistant (✨) that drives any OpenAI-compatible endpoint and
  proposes notebook edits as reviewable Apply/Reject cards.
- Export the current note or a single section to **PDF** or a
  self-contained **HTML** file, preserving diagrams and syntax
  highlighting exactly as rendered.
- All UI state (open files, widths, theme, recent files, bookmarks, …) is
  persisted to `config/config.json` and restored on next launch.

## Markdown syntax

Notebooks are rendered client-side by **marked v12** (GFM mode, `breaks`
off) with **highlight.js** for code blocks, then post-processed by the
`NB.blocks` renderer registry. Headings get stable anchor ids, used by the
outline and by `?file=…&heading=…` deep links.

- **Everything GFM v12 supports** — headings + TOC, bold/italic/strike,
  inline code, blockquotes, ordered/unordered lists, nested lists,
  links + autolinks (bare URLs), tables (incl. column alignment), task
  lists (`- [ ]` / `- [x]`), fenced code blocks with language labels,
  horizontal rules, and HTML passthrough.
- **Syntax highlighting** — a fenced block tagged with a language
  (e.g. ` ```js ` or ` ```python `) gets highlight.js colors; the
  code highlight theme follows the light/dark body theme.
- **Mermaid diagrams** — a fenced block tagged with the ` mermaid `
  language renders as a live SVG diagram (flowcharts, sequence, class,
  state, ER, gantt, pie, journey, mindmap, timeline, gitGraph, …). Click
  an SVG in the viewer to open a lightbox; a diagram with a syntax error
  is marked in place with a toast. Rendering is asynchronous, so the raw
  Mermaid source stays in your note. Mermaid 11.16, `securityLevel: strict`.
- **WaveDrom timing diagrams** — a fenced block tagged with the
  ` wavedrom ` language renders as a waveform / timing plot
  (`` ```wavedrom `` + a WaveDrom JSON object). Ideal for digital logic
  and bus timing in a note. WaveDrom's lenient JSON notation (unquoted
  keys, JS object syntax) is accepted; malformed blocks fall back to an
  inline error box with a toast. WaveDrom 3.3.
- **KaTeX math** — a fenced block tagged with the ` math ` (or
  ` katex `) language renders as a typeset equation (`` ```math `` +
  LaTeX). Fast, offline, theme-independent. KaTeX 0.16.
- **Graphviz diagrams** — a fenced block tagged with the ` dot ` (or
  ` graphviz `) language renders as a Graphviz graph (state machines,
  dependency graphs, …). Compiled to WASM, runs offline. Click a graph
  to open it full-size with zoom in/out. Graphviz 2.40.1 / Viz.js 2.1.2.
- **Live HTML previews** — a fenced block tagged `` html-live `` is
  replaced with a sandboxed iframe that actually runs the markup (CSS /
  SVG animation, inline `` <script> ``, canvas, …). Plain `` ```html ``
  keeps its usual meaning and stays highlighted source. The preview is
  sandboxed with `` allow-scripts `` and **not** `` allow-same-origin ``,
  so it runs but cannot read the app's cookies, DOM, or authenticated
  API. A `` <!-- height: 480 --> `` comment sets a minimum frame height;
  the frame still grows to fit taller content, so the preview never
  scrolls internally and the note keeps the only scrollbar. Edit the
  source from hybrid mode's right-click "Edit source".
- **Copy button** — every fenced code block gets a hover "Copy" that
  copies the raw source (pre-highlight).
- **Wikilinks** — Obsidian-style `[[Target]]` internal note links. A
  bare stem resolves to a note by basename (`[[README]]` and
  `[[README.md]]` both link to `README.md`), a path is relative to the
  current note's folder, and a trailing `#anchor` deep-links to a
  heading. `[[Target|label]]` sets the link text. Unresolvable targets
  render as plain text (no dead link). Clicking a wikilink opens the
  target in place (SPA, no page reload).

Emoji are not translated into images (there is no emoji shortcode
plugin) — type them as unicode or HTML entities. `breaks` is off, so a
single newline does **not** start a new paragraph: use a blank line.
Markdown is rendered **un-sanitized** (see *Security note*), so HTML
inside a note is emitted as-is.

See [`docs/markdown.md`](docs/markdown.md) for the full rendering pipeline
and the exact `html-live` sandbox limits.

## AI assistant

The ✨ pane in the left activity bar is an agentic assistant for working
on your notes. It talks to any OpenAI-compatible
`/v1/chat/completions` endpoint (OpenAI, openai-compatible local
servers such as ollama/LM Studio, OpenRouter, …) through a server-side
SSE relay — your API keys never leave the server.

**Tools.** The assistant has six tools it can call with fenced
`` ```nb-tool `` JSON blocks:

- `list` — enumerate notes (runs automatically, shown as a trace line).
- `read` — fetch a note's content (runs automatically).
- `fetch` — fetch a web page server-side (runs automatically; CORS-safe).
- `search` — query a SearXNG instance (runs automatically).
- `patch` — edit an existing note (an Apply/Reject card appears).
- `write` — create a **new** note (an Apply/Reject card appears).

`read`/`list`/`fetch`/`search` execute immediately and their output is fed
back so the model can continue. `patch`/`write` always surface as
reviewable cards with a color-coded diff (dual line numbers + `@@ hunk @@`
header); you Apply or Reject each one. Nothing is written to disk until you
click Apply. Writes are blocked on paths that already exist ("use patch
instead"), and patch anchors are re-verified against the current file at
apply time, so a stale proposal fails closed instead of damaging a note.
Assistant replies are rendered as Markdown (headings, lists, tables,
code fences with syntax highlighting + a Copy button).

**Conversation.** The assistant keeps the full transcript in memory, so
follow-ups retain context; the **Clear** button resets it. Switching
tabs changes the "current file" it references.

**Settings → AI.** Add/name/remove provider profiles (base URL, model,
API key), pick a default, and Test connectivity. The **Custom prompt**
applied to whichever provider is active sits below the provider list, and
the **Web search** field sets the SearXNG instance for the `search` tool.

See [`docs/ai-assistant.md`](docs/ai-assistant.md) for the tool loop and
review flow.

## Export

The Export modal is reachable from the **Export…** item in the file
tree's right-click menu, the bookmark list's right-click menu, and a
tab's right-click menu — each targets that specific file (which need not
be the active tab). There is no top-bar Export button.

- **PDF** — paginates the note with the vendored Paged.js polyfill in a
  hidden same-origin iframe, then opens the browser's print dialog;
  choose "Save as PDF". A print stylesheet hides the app chrome (topbar,
  sidebars, tabs, outline) and prints only the rendered note, so the PDF
  matches what you see in the viewer — including Mermaid / WaveDrom /
  Graphviz diagrams, KaTeX math, and syntax-highlighted code blocks.
  Printing the top-level page (not the subframe) is what makes Firefox
  actually save a file.
- **HTML** — downloads a self-contained `.html` file with the rendered
  note and embedded styles (the app's markdown rules + the light
  highlight.js theme). Diagrams are baked in as inline SVG, so the file
  opens anywhere with no network.

Options: **Width** (fit / 80% / full), **Colors** (light / dark), **Table
of contents**, and **Scope**:

- **Current file** — the entire selected note.
- **Section** — pick an `h1`–`h3` heading from a dropdown; only that
  section (from the heading up to the next heading of the same or
  higher level) is exported.

Export is purely client-side: the note is re-rendered from the viewer's
content cache through the same pipeline the app uses, so there is no
backend dependency and the output always matches the on-screen
rendering.

## Quick start

```bash
# Run the server (creates/refreshes the per-host venv, installs deps, runs app.py)
./start.sh                       # 0.0.0.0:5000, debug off (reachable from LAN)
./start.sh --host 127.0.0.1      # bind loopback only
./start.sh --debug               # enable Flask auto-reload
./start.sh --port 8080 --debug
./start.sh --help                # all app.py CLI flags
```

Then open <http://127.0.0.1:5000> in your browser. On first launch the
server copies `notebook.template/` into `notebook/` (starter notes:
`Welcome.md`, `README.md`, `Syntax.md`) and creates an empty
`config/config.json`.

The venv path is `.venv_<hostname>` so the same checkout is safe to use
on multiple machines without one machine's pip cache stomping the other.
A legacy `data/` folder at the project root is auto-migrated to
`notebook/` on first run.

## Requirements

- Python 3.8+ (for `start.sh`'s venv bootstrap)
- Node.js (only for the frontend DOM tests — not needed to run the app)

Python deps are pinned in `requirements.txt`: Flask 3.0 and bcrypt 5.0.

## Project layout

```
app.py                Flask backend (single file), all routes under /api/*
agent.md              agent guide served at /agent.md (plain Markdown, easy to edit)
start.sh              per-host venv bootstrap + launcher
requirements.txt      Python dependencies
package.json          frontend test + CodeMirror bundling dependencies (not runtime)
notebook.template/    starter notebook (copied into notebook/ on first run)
templates/
  index.html          single page, loads vendored libs + app modules
static/
  js/                 29 app modules sharing window.NB (loaded in dependency order)
  vendor/             marked, highlight.js, CodeMirror, Mermaid, WaveDrom, KaTeX,
                      Viz.js, Turndown, Paged.js (vendored, no CDN)
  css/                style.css, vimnav.css
  sw.js               service worker (cache notebook-v5)
  manifest.json       PWA manifest
  icons/ favicon.svg  PWA icons
notebook/             your notebooks (.md files) — created on first run
config/               config.json (UI state), auth.json (passwords), ai.json (AI) — created on first run
tests/
  test_app.py         stdlib unittest, hits the real Flask app via test client
  dom/test_dom.js     jsdom tests, loads real vendor bundles + app modules
docs/                 project documentation (see docs/README.md)
```

`notebook/` and `config/` are deliberately separate folders and can be
redirected at import time via `NOTEBOOK_DATA_DIR` / `NOTEBOOK_CONFIG_DIR`
(the test suite uses this so it never touches your real files).

`static/js/` holds 29 modules, all extending the shared `window.NB`
namespace. The list is documented in
[`docs/frontend.md`](docs/frontend.md), which also covers the code-block
renderer registry, persistence, and the service worker.

The one asset that is built rather than copied: `static/vendor/codemirror.bundle.js`
is an esbuild IIFE generated offline from `static/vendor/codemirror.entry.js`.
See [`docs/development.md`](docs/development.md) for details.

## API

All endpoints return JSON, except `GET /` (HTML), `GET /agent.md`
(Markdown), and `POST /api/ai/chat` (an SSE relay). AI agents and scripts
should read `GET /agent.md` — it serves `agent.md` (this repo's
plain-Markdown agent guide) with the current auth state filled in.

| Method | Path                  | Purpose                                            |
| ------ | --------------------- | -------------------------------------------------- |
| GET    | `/api/auth`           | Auth state (`{enabled, hasAdmin, hasViewer, role}`) |
| POST   | `/api/login`          | Try admin, then viewer password; rate-limited      |
| POST   | `/api/logout`         | End the current session                            |
| POST   | `/api/auth/passwords` | Set/rotate/clear admin + viewer password (admin)   |
| GET    | `/api/auth/tokens`    | List named bearer tokens (admin)                   |
| POST   | `/api/auth/tokens`    | Create a named bearer token, shown once (admin)    |
| DELETE | `/api/auth/tokens/<name>` | Revoke a named token (admin)                   |
| GET    | `/api/config`         | Read the persisted UI config                       |
| POST   | `/api/config`         | Replace the persisted UI config (admin)            |
| GET    | `/api/info`           | Absolute `data_dir` / `config_dir`                 |
| GET    | `/api/tree`           | File tree of the notebook directory                |
| GET    | `/api/ls`             | Non-recursive listing of ONE folder (`?path=…`)    |
| GET    | `/api/file`           | Read a file (`?path=…`)                            |
| POST   | `/api/file`           | Save a file (`{path, content}`)                    |
| POST   | `/api/file/append`    | Atomic append (`{path, content[, create]}`)        |
| POST   | `/api/edit`           | All-or-nothing patch batch (`{path, edits}`)       |
| POST   | `/api/create`         | Create file/folder; `upsert: true` = idempotent    |
| POST   | `/api/move`           | Rename / move; `onConflict: error\|skip\|overwrite` |
| POST   | `/api/copy`           | Copy file/folder; same `onConflict` modes          |
| POST   | `/api/delete`         | Delete a file or folder                            |
| GET    | `/api/search`         | Search `.md` files (`?q=…&regex=&file=&glob=&order=…`) |
| GET    | `/api/graph`          | Wikilink / link graph between notes                |
| GET    | `/api/ai/config`      | Masked AI provider config (admin)                  |
| POST   | `/api/ai/config`      | Save AI provider config (admin)                    |
| GET    | `/api/ai/probe`       | Provider reachability check (admin)                |
| POST   | `/api/ai/chat`        | SSE relay to the selected provider (admin)         |
| POST   | `/api/ai/fetch`       | Server-side URL fetch for the fetch tool (admin)   |
| POST   | `/api/ai/search`      | SearXNG search for the search tool (admin)         |
| GET    | `/agent.md`           | Agent API guide, auth state substituted            |

All file routes resolve the user-supplied relative path through
`safe_path()`, which rejects absolute input and `..` traversal. Writes use
atomic temp-file + `os.replace`. Search is a line-by-line scan (literal by
default, `regex=1` for Python regex per line) with default caps
`MAX_TOTAL_MATCHES=200` and `MAX_MATCHES_PER_FILE=20`, raisable per
request via `limit=`/`perFile=` up to hard ceilings (2000/200); matches
return a snippet with the hit wrapped in `<<…>>` so the client can
re-highlight without parsing HTML. `POST /api/file/append` writes with a
single O_APPEND syscall (concurrent appends never clobber each other), and
`POST /api/edit` applies an ordered op batch in memory and writes once — a
failed op rejects the whole batch untouched.

The full reference, with every parameter and status code, is in
[`docs/api.md`](docs/api.md).

## Optional: password protection

By default the server is open. To put a password gate in front of the
API, open the Settings modal (⚙ button in the activity bar) →
**Security** → Passwords:

- **Admin password** (required to enable auth): set this first. Once set,
  **all reads and writes require a login**, whether or not a viewer
  password is also set.
- **Viewer password** (optional): a second, read-only login identity. It
  lets someone sign in to read without holding the admin password.

Passwords are sent over the wire as plain text, hashed server-side with
bcrypt (cost 12), and never stored in plaintext. A failed-login rate
limiter trips 429 after 5 wrong attempts in 60s per client IP. The
**Logout** button in the top bar (visible only when auth is on and the
user is signed in) ends the current session.

To turn auth back off, clear the admin password in the same Passwords
section (enter the current admin password, submit an empty new one); this
also clears the viewer password and all API tokens. Deleting
`config/auth.json` and restarting removes the auth layer entirely.

Named **API tokens** (same Security tab) let agents and scripts skip the
login dance. Issue one, copy the full `nbtk_…` string (shown once), and
send it as `Authorization: Bearer nbtk_…`. A presented-but-invalid token
fails hard with 401 and shares the login rate limiter.

### Recovery: hand-writing `config/auth.json`

If you'd rather not use the UI (headless setup, scripted deploys, or a
full reset), write the file directly:

```bash
# 1. Hash your admin password
HASH_ADMIN=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_ADMIN_PW', bcrypt.gensalt(12)).decode())")
# 2. (optional) hash a viewer password; omit the key to keep it unset
HASH_VIEWER=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_VIEWER_PW', bcrypt.gensalt(12)).decode())")
# 3. write the file (the server generates the session-signing secret on first start)
python -c "
import json
open('config/auth.json', 'w').write(json.dumps({
    'admin_password_hash': '$HASH_ADMIN',
    'viewer_password_hash': '$HASH_VIEWER',
}, indent=2))
"
# 4. restart the server -- the login modal will appear on next page load
```

See [`docs/configuration.md`](docs/configuration.md) for the full auth
model.

## Tests

```bash
# Backend (stdlib unittest, uses Flask's test client)
.venv_$(hostname)/bin/python -m unittest discover -s tests -v

# Single test class / method
.venv_$(hostname)/bin/python -m unittest tests.test_app.TestSearch.test_case_insensitive_finds_all -v

# Frontend (jsdom — loads real vendor bundles + all app modules,
# stubs fetch, drives the app via real DOM events)
npm install && npm test
node tests/dom/test_dom.js        # equivalent if jsdom already resolvable
```

The backend tests redirect `notebook/` and `config/` to a temp dir
before importing `app`, so your real notebooks are never touched. The
auth test classes reset the in-memory failure tracker between tests so
the rate limiter doesn't leak. The frontend harness loads the real
vendor bundles and ~30 app modules into jsdom and covers 73 sections,
including auth, the AI tool loop, hybrid editing, and export.

## Security note

Markdown is rendered **un-sanitized** because the notebooks are your
own files in `notebook/`. If you ever load untrusted content (pastes
from elsewhere, shared files), add a vendored DOMPurify and sanitize
before `innerHTML` in `viewer.js`. The `html-live` renderer is the one
exception: it runs inside a sandboxed iframe with `allow-scripts` and
without `allow-same-origin`, so it cannot reach the app's cookies, DOM,
or API.
