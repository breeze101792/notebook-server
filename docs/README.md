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
| [`design/`](design/settings-modal.md) | [`design/settings-modal.md`](design/settings-modal.md) | UI design handoffs and reference mockups for shipped features. |
| [`ui/`](ui/workspaces.md) | [`ui/workspaces.md`](ui/workspaces.md) | Design handoffs for the workspace picker, the Sessions view, and the top-bar session picker. |
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
| [`architecture/table-editor.md`](architecture/table-editor.md) | The hybrid "Edit table" modal: model, modal containment, grid, Apply ordering, sort/transpose, the merged-cell refusal, and the test seams. |
| [`architecture/dot-wavedrom-designer.md`](architecture/dot-wavedrom-designer.md) | The Graphviz and WaveDrom design windows: parsing subsets, preview, and Apply order. |
| [`architecture/mermaid-designer.md`](architecture/mermaid-designer.md) | The visual Mermaid editor: the Visimer decision, the modal, parse/serialize boundaries, and Apply. |
| [`architecture/mermaid-designer-coverage.md`](architecture/mermaid-designer-coverage.md) | The add-sidebar coverage per Mermaid diagram type. |
| [`architecture/mobile.md`](architecture/mobile.md) | The mobile v1 implementation record: mode signal, bottom rail, drawer, persistence gate, capture request, and the test plan. |
| [`architecture/bugfix-preview-overflow-tabs-focus.md`](architecture/bugfix-preview-overflow-tabs-focus.md) | Shipped structural fixes for preview overflow, modal focus, and tab-strip scroll. |
| [`architecture/design/`](architecture/design/tab-equalization.md) | Sub-design notes that belong to the architecture of one widget: tab equalization, tab-close animation, and the Mermaid designer UI handoff. |
| [`architecture/design/tab-equalization.md`](architecture/design/tab-equalization.md) | Tab-bar width re-equalization. Mockup: [`architecture/design/tab-equalize-mockup.html`](architecture/design/tab-equalize-mockup.html). |
| [`architecture/design/tab-close-animation.md`](architecture/design/tab-close-animation.md) | Tab close animation. |
| [`architecture/design/mermaid-designer-ui.md`](architecture/design/mermaid-designer-ui.md) | Mermaid designer UI handoff. Mockup: [`architecture/design/mermaid-designer-mockup.html`](architecture/design/mermaid-designer-mockup.html). |

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
| [`product/table-editor.md`](product/table-editor.md) | Table edit window: the two entry points, grid and toolbar behavior, Apply/Cancel, merged-cell refusal, edge cases, and AC1–AC18. |
| [`product/table-editor-selection.md`](product/table-editor-selection.md) | Range selection and clipboard for the table editor: gestures, copy/cut/paste/clear, the TSV + HTML contract, grid growth, accessibility, AC19–AC40. |
| [`product/mermaid-chart-editing.md`](product/mermaid-chart-editing.md) | Mermaid chart editing: what the visual editor must offer over typing the fence. |
| [`product/dot-wavedrom-design-window.md`](product/dot-wavedrom-design-window.md) | Graphviz and WaveDrom design windows: entry points, scope, and Apply behavior. |
| [`product/search-options.md`](product/search-options.md) | Side-panel Search options; the shipped control set is in `design/search-panel-advanced.md`. |
| [`product/search-gaps.md`](product/search-gaps.md) | Search gap analysis with the open gaps marked. |
| [`product/hybrid-shortcuts.md`](product/hybrid-shortcuts.md) | Hybrid editing shortcuts; the behavior contract is `architecture/hybrid-editing.md`. |
| [`product/hybrid-block-marker-backspace.md`](product/hybrid-block-marker-backspace.md) | Removing a block marker at the content start. |
| [`product/side-panel-view-restore.md`](product/side-panel-view-restore.md) | Restoring the active side-panel view and its first paint. |
| [`product/bugfix-preview-overflow-tabs-focus.md`](product/bugfix-preview-overflow-tabs-focus.md) | The bugfix spec for preview overflow, Settings focus, and tab-strip visibility. |

## Design handoffs

Each `.md` has a sibling `.html` mockup where one exists.

| Guide | Covers |
| --- | --- |
| [`design/settings-modal.md`](design/settings-modal.md) | Settings modal: seven tabs, layout, and states. |
| [`design/mobile-shell.md`](design/mobile-shell.md) | Mobile shell: breakpoints, anatomy, component states, tokens, and the file-by-file change list. |
| [`design/viewer-scroll-container.md`](design/viewer-scroll-container.md) | The shipped split of the preview into a scroll container and a page: wallpaper host per mode, scroller ownership, retarget map, and acceptance criteria. |
| [`design/table-editor.md`](design/table-editor.md) | Table editor: shell, grid, toolbar, sort, blocked state, keyboard, tokens, and responsive rules. |
| [`design/table-editor-selection.md`](design/table-editor-selection.md) | Selection and clipboard: the wash and edge treatment, the clipboard toolbar group, status strings, and the blocked state. |
| [`design/mermaid-editor.md`](design/mermaid-editor.md) | Mermaid editor: the edit UI redesign. |
| [`design/dot-wavedrom-editor.md`](design/dot-wavedrom-editor.md) | Graphviz and WaveDrom windows: edit UI. |
| [`design/graph-3d.md`](design/graph-3d.md) | Graph 3D renderer and its controls. |
| [`design/ai-composer-redesign.md`](design/ai-composer-redesign.md) | AI composer: attachments, controls, and layout. |
| [`design/ai-chat-message-area.md`](design/ai-chat-message-area.md) | AI chat message area: turn controls. |
| [`design/edit-bar-arrangement.md`](design/edit-bar-arrangement.md) | Edit-bar control order and grouping. |
| [`design/search-panel.md`](design/search-panel.md) | Side-panel Search: options and one-result-per-file. |
| [`design/search-panel-advanced.md`](design/search-panel-advanced.md) | Side-panel Search: the shipped Advanced disclosure. |
| [`design/search-panel-clear.md`](design/search-panel-clear.md) | Side-panel Search: the clear control. |
| [`design/search-panel-controls.md`](design/search-panel-controls.md) | Side-panel Search: the labelled filter stack (superseded by Advanced). |
| [`design/bugfix-preview-overflow-tabs-focus.md`](design/bugfix-preview-overflow-tabs-focus.md) | The visual fix for preview overflow, focus, and tab visibility. |
| [`ui/workspaces.md`](ui/workspaces.md) | Workspace picker: the bar, picker, add/rename dialog, Settings list, code-keyed error table, keyboard rules, and the shipped CSS. Mockup: [`ui/workspaces-mockup.html`](ui/workspaces-mockup.html). |
| [`ui/sessions.md`](ui/sessions.md) | Sessions side-panel view: activity-bar placement, header and rows, row menu, tab-menu item, name dialog, copy, keyboard/ARIA, and the CSS to add. Mockup: [`ui/sessions-mockup.html`](ui/sessions-mockup.html). |
| [`ui/topbar-session.md`](ui/topbar-session.md) | The top-bar session picker: placement after the workspace chip, the trigger and popover markup, CSS, the `sessions.js` picker, states, ARIA and acceptance criteria. Mockup: [`ui/topbar-session-mockup.html`](ui/topbar-session-mockup.html). |
| [`ui/workspace-placement-mockup.html`](ui/workspace-placement-mockup.html) | Workspace placement mockup. |
| [`ui/code-block-chip.md`](ui/code-block-chip.md) | Code fence header (E1): the padding that caused click growth, the chosen quiet top band carrying the language and the copy button, exact CSS, authored-language capture, the vendored-theme caveat, phone sizes, measured heights, and what to verify. Mockup: [`ui/code-block-chip-mockup.html`](ui/code-block-chip-mockup.html). |

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
