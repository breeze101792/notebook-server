# Notebook Server documentation

This folder holds the project documentation, organized as a project-design
tree. The root [`README.md`](../README.md) is the user-facing overview;
these guides go deeper for people working on or integrating with the app.

The server is a single-user Markdown notebook: a Flask backend (`app.py`)
that serves a JSON API and one HTML page, and a vanilla-JS frontend that
renders Markdown in the browser. Notes are plain `.md` files on disk.
There is no database and no runtime build step.

## How to read this tree

- **Current** documents describe the shipped code and are kept in sync with
  it. When a current document and the code disagree, the code wins; fix the
  document.
- **Design records** document a decision that has shipped. They preserve the
  reasoning and the original mockup, and are not updated line by line. Their
  status line says so.
- **Superseded** documents are kept for history and name the document that
  replaced them.
- **Research** documents are dated fact packs. Treat figures as of their
  date.

Start here depending on the job:

| Job | Read |
| --- | --- |
| Run the server | [`../README.md`](../README.md) quick start, then [`operations/build.md`](operations/build.md) |
| Work on the code | [`operations/development.md`](operations/development.md), then the matching architecture guide |
| Call the HTTP API | [`contracts/http-api.md`](contracts/http-api.md); an AI agent fetches [`../agent.md`](../agent.md) from a running server |
| Change configuration | [`contracts/configuration.md`](contracts/configuration.md) |
| Write or run tests | [`testing/README.md`](testing/README.md) |
| Change a feature's behavior | The matching [`requirements/`](requirements/README.md) or [`product/`](product/mobile.md) definition first |

## Folders

| Folder | Entry point | Owns |
| --- | --- | --- |
| [`requirements/`](requirements/README.md) | [`requirements/README.md`](requirements/README.md) | What the product does and why: scope, flows, edge cases, acceptance criteria, maintenance. |
| [`architecture/`](architecture/backend.md) | [`architecture/backend.md`](architecture/backend.md) | Backend structure, frontend modules, the Markdown pipeline, hybrid editing, and the AI assistant. |
| [`contracts/`](contracts/http-api.md) | [`contracts/http-api.md`](contracts/http-api.md) | The HTTP endpoint reference and the configuration-file contracts. |
| [`testing/`](testing/README.md) | [`testing/README.md`](testing/README.md) | The test strategy, the backend suite, and the frontend DOM/browser suites. |
| [`operations/`](operations/README.md) | [`operations/README.md`](operations/README.md) | Repo layout, build/toolchain, vendoring, and the change checklists. |
| [`product/`](product/mobile.md) | [`product/mobile.md`](product/mobile.md) | Shipped feature definitions: behavior, edge cases, acceptance criteria. |
| [`archive/`](archive/README.md) | [`archive/README.md`](archive/README.md) | Frozen old design records, kept for history. Not maintained and not part of the current design. |
| [`ui/`](ui/foundations.md) | [`ui/foundations.md`](ui/foundations.md) | The current UI design set: foundations, controls, shell frame, tab strip, side-panel views, Search, and the AI panel. |
| [`research/`](research/mobile-support.md) | [`research/mobile-support.md`](research/mobile-support.md) | Dated fact packs: browsers, libraries, protocols, and device constraints. |

## Architecture

| Guide | Covers |
| --- | --- |
| [`architecture/backend.md`](architecture/backend.md) | Import-time path resolution and seeding, `safe_path` and atomic writes, the auth layer, workspaces, the AI proxy, and the design trade-offs. |
| [`architecture/frontend.md`](architecture/frontend.md) | Script load order, the boot sequence, the `static/js/` modules, the code-block renderer registry, persistence, the service worker, and the UI surfaces. |
| [`architecture/sessions.md`](architecture/sessions.md) | Session tab groups: the live-view ownership model, config shape, normalisation and migration, the swap algorithm and its tokens, file operations across stored sessions, the empty state, and test seams. |
| [`architecture/markdown.md`](architecture/markdown.md) | The Markdown pipeline, supported GFM syntax, the six special fenced blocks and their vendored versions, wikilinks, and the `html-live` sandbox. |
| [`architecture/hybrid-editing.md`](architecture/hybrid-editing.md) | The construct-by-construct behavior spec for hybrid (WYSIWYG) editing: every syntax construct at every caret position, the decided behavior, and the open questions. |
| [`architecture/context-menus.md`](architecture/context-menus.md) | The one shared `NB.menu` module: placement, keyboard, submenus, `onClose`, and the three pre-migration menus it replaced. |
| [`architecture/window-maximize.md`](architecture/window-maximize.md) | Shared window behavior: drag, resize, maximize/restore, the overlay inventory, and geometry persistence. |
| [`architecture/ai-assistant.md`](architecture/ai-assistant.md) | The built-in assistant: provider setup, ACP profiles, the six tools, the tool loop, and reviewing edits. |
| [`architecture/acp-provider-review.md`](architecture/acp-provider-review.md) | Superseded design review of the ACP provider; read `ai-assistant.md` for the as-built contract. |
| [`architecture/table-select.md`](architecture/table-select.md) | Rectangular table-cell selection and TSV/HTML clipboard copy. |
| [`architecture/table-editor.md`](architecture/table-editor.md) | The hybrid "Edit table" modal: model, modal containment, grid, in-modal undo/redo, Apply ordering, sort/transpose, the merged-cell refusal, and the test seams. |
| [`architecture/dot-wavedrom-designer.md`](architecture/dot-wavedrom-designer.md) | The Graphviz and WaveDrom design windows: parsing subsets, preview, and Apply order. |
| [`architecture/mermaid-designer.md`](architecture/mermaid-designer.md) | The visual Mermaid editor: the Visimer decision, the modal, parse/serialize boundaries, history keys, and Apply. |
| [`architecture/mermaid-designer-coverage.md`](architecture/mermaid-designer-coverage.md) | The add-sidebar coverage per Mermaid diagram type. |
| [`architecture/mobile.md`](architecture/mobile.md) | The mobile v1 implementation record: mode signal, bottom rail, drawer, persistence gate, capture request, and the test plan. |
| [`architecture/bugfix-preview-overflow-tabs-focus.md`](architecture/bugfix-preview-overflow-tabs-focus.md) | Shipped structural fixes for preview overflow, modal focus, and tab-strip scroll. |
| [`architecture/typography.md`](architecture/typography.md) | The type-size contract: root cause, roles, `--font-scale` semantics, the static check, the browser audit, and the per-surface migration order. |

## Contracts

| Guide | Covers |
| --- | --- |
| [`contracts/http-api.md`](contracts/http-api.md) | The full HTTP endpoint reference: every route, parameter, status code, the `/api/edit` op schema, and worked `curl` examples. |
| [`contracts/configuration.md`](contracts/configuration.md) | `start.sh` flags, environment variables, first-run seeding, and every key in `config/config.json`, `config/auth.json`, `config/ai.json`, and `config/acp.json`. |

## Requirements

| Guide | Covers |
| --- | --- |
| [`requirements/README.md`](requirements/README.md) | Product scope, users, maintenance, the runtime floor, and the feature scope. |
| [`requirements/features/sessions.md`](requirements/features/sessions.md) | Session tab groups: goals, model and invariants, flows, the edge-case table, acceptance criteria, and what must not regress. |
| [`requirements/features/acp-provider.md`](requirements/features/acp-provider.md) | ACP as a second AI provider: profile shape, agent discovery, context preamble, trace, and acceptance criteria. |
| [`requirements/features/ai-attachments.md`](requirements/features/ai-attachments.md) | Images and large text files in the AI composer: limits, resize pipeline, and failure messages. |
| [`requirements/features/context-menus.md`](requirements/features/context-menus.md) | The unified right-click menu requirement across the tree, tabs, and hybrid blocks. |
| [`requirements/features/mermaid-visual-editor.md`](requirements/features/mermaid-visual-editor.md) | The visual Mermaid editor requirement; the shipped design is in `architecture/mermaid-designer.md`. |

## Product definitions

| Guide | Covers |
| --- | --- |
| [`product/mobile.md`](product/mobile.md) | Mobile v1 product definition: ranked jobs, flows, edge cases, acceptance criteria, and the v2 boundary. |
| [`product/table-editor.md`](product/table-editor.md) | Table edit window: the two entry points, grid and toolbar behavior, in-modal undo/redo, Apply/Cancel, merged-cell refusal, edge cases, and AC1–AC18 plus AC45–AC46. |
| [`product/table-editor-selection.md`](product/table-editor-selection.md) | Range selection and clipboard for the table editor: gestures, copy/cut/paste/clear, the TSV + HTML contract, grid growth, accessibility, AC19–AC44. |
| [`product/mermaid-chart-editing.md`](product/mermaid-chart-editing.md) | Mermaid chart editing: what the visual editor must offer over typing the fence. |
| [`product/dot-wavedrom-design-window.md`](product/dot-wavedrom-design-window.md) | Graphviz and WaveDrom design windows: entry points, scope, and Apply behavior. |
| [`product/search-options.md`](product/search-options.md) | Side-panel Search options; the shipped control set is in `archive/design/search-panel-advanced.md`. |
| [`product/search-gaps.md`](product/search-gaps.md) | Search gap analysis with the open gaps marked. |
| [`product/hybrid-shortcuts.md`](product/hybrid-shortcuts.md) | Hybrid editing shortcuts; the behavior contract is `architecture/hybrid-editing.md`. |
| [`product/hybrid-block-marker-backspace.md`](product/hybrid-block-marker-backspace.md) | Removing a block marker at the content start. |
| [`product/side-panel-view-restore.md`](product/side-panel-view-restore.md) | Restoring the active side-panel view and its first paint. |
| [`product/bugfix-preview-overflow-tabs-focus.md`](product/bugfix-preview-overflow-tabs-focus.md) | The bugfix spec for preview overflow, Settings focus, and tab-strip visibility. |

## Design handoffs

The current UI design set. Each `.md` has a sibling `.html` mockup; open the mockup
directly in a browser.

| Guide | Covers |
| --- | --- |
| [`ui/guidelines.md`](ui/guidelines.md) | The rulebook for the whole design set: document format, control ladder, token scoping, ownership, geometry canon, exceptions, mockup rules and review checklist. |
| [`ui/foundations.md`](ui/foundations.md) | The token layer every screen references: principles, colour with contrast ratios, type, space, shape, elevation, z-bands, motion, breakpoints, iconography, accessibility, and the implementation contract. Mockup: [`ui/foundations-mockup.html`](ui/foundations-mockup.html). |
| [`ui/controls.md`](ui/controls.md) | The component layer: inventory and verdict, 16 components with anatomy, states, markup, ARIA, keyboard contract, state matrix, phone rules, acceptance criteria, and migration order. Mockup: [`ui/controls-mockup.html`](ui/controls-mockup.html). |
| [`ui/shell-frame.md`](ui/shell-frame.md) | The shell frame: grid, topbar, activity rail, side-panel frame, outline pane, phone conversion, keyboard and ARIA. Mockup: [`ui/shell-frame-mockup.html`](ui/shell-frame-mockup.html). |
| [`ui/tab-bar.md`](ui/tab-bar.md) | The file tab strip: structure, anatomy, equal-width algorithm, overflow, states, drag, close animation, ARIA, and phone. Mockup: [`ui/tab-bar-mockup.html`](ui/tab-bar-mockup.html). |
| [`ui/side-panel-views.md`](ui/side-panel-views.md) | Explorer, Pinned, Bookmarks and Recent, plus the shared view conventions: headers, rows, top-section modes, menus, states, keyboard and phone. Mockup: [`ui/side-panel-views-mockup.html`](ui/side-panel-views-mockup.html). |
| [`ui/sessions.md`](ui/sessions.md) | The Sessions view: header, rows, counts, dirty dot, row menu, cap, read-only, keyboard and phone. Mockup: [`ui/sessions-mockup.html`](ui/sessions-mockup.html). |
| [`ui/search-view.md`](ui/search-view.md) | The Search view: query row, options, Advanced filters, result listbox, every state, copy, ARIA and phone. Mockup: [`ui/search-view-mockup.html`](ui/search-view-mockup.html). |
| [`ui/ai-panel.md`](ui/ai-panel.md) | The AI view: header, provider, messages, tool trace, edit cards and diffs, composer, attachments and states. Mockup: [`ui/ai-panel-mockup.html`](ui/ai-panel-mockup.html). |
| [`ui/reader.md`](ui/reader.md) | The reading surface: page, type scale, block rhythm, inline elements, selection, states, accessibility, phone and print. Mockup: [`ui/reader-mockup.html`](ui/reader-mockup.html). |
| [`ui/content-blocks.md`](ui/content-blocks.md) | Code fences, tables, figures, math, diagram cards and html-live: anatomy, states, actions, tokens and proposals. Mockup: [`ui/content-blocks-mockup.html`](ui/content-blocks-mockup.html). |
| [`ui/edit-window.md`](ui/edit-window.md) | The shared edit-window chrome: header, action bar, footer, geometry, maximize, history, focus and responsive. Mockup: [`ui/edit-window-mockup.html`](ui/edit-window-mockup.html). |
| [`ui/table-editor.md`](ui/table-editor.md) | The table editor: grid, selection, clipboard, toolbar, blocked state, history, Apply and phone. Mockup: [`ui/table-editor-mockup.html`](ui/table-editor-mockup.html). |
| [`ui/diagram-designers.md`](ui/diagram-designers.md) | The Mermaid and Graphviz/WaveDrom designers: stage, sidebar, inspector, states, Apply and phone. Mockup: [`ui/diagram-designers-mockup.html`](ui/diagram-designers-mockup.html). |
| [`ui/settings-modal.md`](ui/settings-modal.md) | Settings and its seven tabs: nav, rows, forms, lists, auth states, keyboard and phone. Mockup: [`ui/settings-modal-mockup.html`](ui/settings-modal-mockup.html). |
| [`ui/dialogs.md`](ui/dialogs.md) | Auth, workspace, session, export and the shared dialog frame: validation, states and phone. Mockup: [`ui/dialogs-mockup.html`](ui/dialogs-mockup.html). |
| [`ui/lightboxes.md`](ui/lightboxes.md) | The four full-screen viewers: open/close, controls, gestures, states, keyboard and phone. Mockup: [`ui/lightboxes-mockup.html`](ui/lightboxes-mockup.html). |
| [`ui/source-editor.md`](ui/source-editor.md) | Markdown source mode: edit bar, CodeMirror surface, split preview, save/dirty, draft bar and phone. Mockup: [`ui/source-editor-mockup.html`](ui/source-editor-mockup.html). |
| [`ui/hybrid-mode.md`](ui/hybrid-mode.md) | WYSIWYG mode: page state, block chrome, grips, overlays, code chip, save and conflict. Mockup: [`ui/hybrid-mode-mockup.html`](ui/hybrid-mode-mockup.html). |
| [`ui/graph-view.md`](ui/graph-view.md) | The `§graph` tab: header, controls, canvases, gestures, states, keyboard and phone. Mockup: [`ui/graph-view-mockup.html`](ui/graph-view-mockup.html). |
| [`ui/mobile-shell.md`](ui/mobile-shell.md) | The phone shell: mode, topbar, rail, drawer, Home, capture, settings sheet, history and states. Mockup: [`ui/mobile-shell-mockup.html`](ui/mobile-shell-mockup.html). |
| [`ui/welcome.md`](ui/welcome.md) | Welcome, no tabs, empty/no workspace, load failure, offline and first run. Mockup: [`ui/welcome-mockup.html`](ui/welcome-mockup.html). |

Old design records — the previous per-feature handoffs (`settings-modal`, `mobile-shell`,
`table-editor`, `search-panel*`, the AI composer, the edit windows, Sessions, the workspace
picker, the tab animations) — are frozen under [`archive/`](archive/README.md). They are
history and source material, not current specs.

## Research

| Guide | Covers |
| --- | --- |
| [`research/mobile-support.md`](research/mobile-support.md) | Mobile fact pack: measured layout failures, touch gaps, PWA/service-worker scope, auth and storage facts. |
| [`research/copy-image-to-clipboard-browsers.md`](research/copy-image-to-clipboard-browsers.md) | Which browsers can copy an image to the system clipboard and how. |
| [`research/mermaid-visual-editor-options.md`](research/mermaid-visual-editor-options.md) | Library options for a visual Mermaid editor in a no-build-step app. |
| [`research/mermaid-editor-parse-serialize.md`](research/mermaid-editor-parse-serialize.md) | Parsing and serializing a Mermaid graph model. |
| [`research/python-acp-sdk.md`](research/python-acp-sdk.md) | The official Python SDK for the Agent Client Protocol. |
| [`research/acp-agent-commands.md`](research/acp-agent-commands.md) | Exact stdio launch commands for each supported ACP agent. |
| [`research/acp-agent-integration.md`](research/acp-agent-integration.md) | What wiring an external coding agent into a web app means. |
| [`research/pkm-naming-conventions.md`](research/pkm-naming-conventions.md) | PKM and AI-agent folder/file naming conventions. |

## Testing and operations

| Guide | Covers |
| --- | --- |
| [`testing/README.md`](testing/README.md) | The test strategy and how to run all three layers. |
| [`testing/backend.md`](testing/backend.md) | The stdlib `unittest` suite against the real Flask app. |
| [`testing/frontend.md`](testing/frontend.md) | The jsdom harness and the Playwright browser suites. |
| [`testing/browser-audit.md`](testing/browser-audit.md) | The real-Chromium audit: coverage, defects found and fixed, and remaining decisions. |
| [`testing/hybrid-regression-checklist.md`](testing/hybrid-regression-checklist.md) | The manual and automated hybrid edit-mode regression gate. |
| [`operations/development.md`](operations/development.md) | Repo layout, the change checklists, and conventions. |
| [`operations/build.md`](operations/build.md) | `start.sh`, dependencies, vendoring, the two build artifacts, and the service worker. |

## Other entry points

- [`../README.md`](../README.md) — user-facing feature overview and quick start.
- [`../agent.md`](../agent.md) — the machine-readable API guide served at
  `GET /agent.md`, with the current auth state substituted into it.
- [`../CLAUDE.md`](../CLAUDE.md) — orientation notes for coding agents working
  in this repository.
- [`../PLAN.md`](../PLAN.md) — historical planning notes; not current.

## Scope

`contracts/http-api.md` is the human-facing API reference. `agent.md` is the
companion an AI agent or script can fetch from a running server to learn how
to authenticate and call the API. Both describe the same routes; when they
disagree with the code, the code in `app.py` is authoritative.
